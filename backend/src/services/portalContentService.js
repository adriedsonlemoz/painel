import ConfiguracaoHome from '../models/ConfiguracaoHome.js'
import Noticia from '../models/Noticia.js'
import { cacheGet, cacheSet } from '../utils/cache.js'
import { getCredential } from '../utils/credentialStore.js'
import { enviarMensagem } from '../utils/aiClient.js'

const WEATHER_CACHE = 'portal:weather:v1'
const FOOTBALL_LIVE_CACHE = 'portal:football:live:v1'
const FOOTBALL_TODAY_CACHE = 'portal:football:today:v1'
const RSS_CACHE = 'portal:rss-world:v1'

const DEFAULT_CONFIG = {
  portal_weather_enabled: 'true',
  portal_weather_city: 'Iguatama, MG',
  portal_weather_lat: '',
  portal_weather_lon: '',
  portal_weather_days: '4',
  portal_horoscope_enabled: 'false',
  portal_football_enabled: 'false',
  portal_rss_world_enabled: 'true',
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return !['0', 'false', 'off', 'no', 'nao', 'não'].includes(String(value).trim().toLowerCase())
}

async function contentConfig() {
  // Configuração pequena e lida diretamente do MongoDB para que alterações feitas
  // no painel passem a valer na Home sem aguardar expiração de cache.
  const docs = await ConfiguracaoHome.find({ chave: { $in: Object.keys(DEFAULT_CONFIG) } }).lean()
  const cfg = { ...DEFAULT_CONFIG }
  for (const doc of docs) cfg[doc.chave] = String(doc.valor ?? '')
  return cfg
}

async function fetchJson(url, options = {}, timeoutMs = 12_000) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = body?.errors?.[0]?.message || body?.error?.message || body?.message || `API respondeu ${r.status}`
    const err = new Error(msg)
    err.status = r.status
    throw err
  }
  return { body, headers: r.headers }
}

function weatherLabel(code) {
  if (code === 0) return 'Céu limpo'
  if ([1, 2].includes(code)) return 'Parcialmente nublado'
  if (code === 3) return 'Nublado'
  if ([45, 48].includes(code)) return 'Neblina'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Garoa'
  if ([61, 63, 65, 66, 67].includes(code)) return 'Chuva'
  if ([71, 73, 75, 77].includes(code)) return 'Neve'
  if ([80, 81, 82].includes(code)) return 'Pancadas de chuva'
  if ([85, 86].includes(code)) return 'Pancadas de neve'
  if ([95, 96, 99].includes(code)) return 'Tempestade'
  return 'Tempo variável'
}

async function geocodeCity(city) {
  const name = String(city || '').split(',')[0].trim() || 'Iguatama'
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.searchParams.set('name', name)
  url.searchParams.set('count', '8')
  url.searchParams.set('language', 'pt')
  url.searchParams.set('format', 'json')
  const { body } = await fetchJson(url)
  const results = Array.isArray(body.results) ? body.results : []
  if (!results.length) throw new Error(`Cidade não encontrada para previsão: ${name}`)
  const br = results.find(x => String(x.country_code || '').toUpperCase() === 'BR') || results[0]
  return {
    latitude: Number(br.latitude),
    longitude: Number(br.longitude),
    name: br.name || name,
    admin1: br.admin1 || null,
    country: br.country || null,
    timezone: br.timezone || 'America/Sao_Paulo',
  }
}

export async function getWeather() {
  const cfg = await contentConfig()
  if (!boolValue(cfg.portal_weather_enabled, true)) return { available: false, reason: 'disabled' }
  const cacheKey = `${WEATHER_CACHE}:${cfg.portal_weather_city}:${cfg.portal_weather_lat}:${cfg.portal_weather_lon}:${cfg.portal_weather_days}`
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  let location
  const lat = Number(cfg.portal_weather_lat)
  const lon = Number(cfg.portal_weather_lon)
  if (Number.isFinite(lat) && Number.isFinite(lon) && cfg.portal_weather_lat !== '' && cfg.portal_weather_lon !== '') {
    location = { latitude: lat, longitude: lon, name: cfg.portal_weather_city || 'Local configurado', timezone: 'auto' }
  } else {
    location = await geocodeCity(cfg.portal_weather_city)
  }

  const days = Math.max(3, Math.min(7, Number(cfg.portal_weather_days) || 4))
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(location.latitude))
  url.searchParams.set('longitude', String(location.longitude))
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', String(days))
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,weather_code,cloud_cover,wind_speed_10m')
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset')
  const { body } = await fetchJson(url)

  const daily = (body.daily?.time || []).map((date, i) => ({
    date,
    weatherCode: body.daily.weather_code?.[i],
    condition: weatherLabel(body.daily.weather_code?.[i]),
    max: body.daily.temperature_2m_max?.[i],
    min: body.daily.temperature_2m_min?.[i],
    rainChance: body.daily.precipitation_probability_max?.[i],
    sunrise: body.daily.sunrise?.[i],
    sunset: body.daily.sunset?.[i],
  }))

  const out = {
    available: true,
    source: 'Open-Meteo',
    attributionUrl: 'https://open-meteo.com/',
    location: { ...location, timezone: body.timezone || location.timezone },
    current: {
      temperature: body.current?.temperature_2m,
      apparentTemperature: body.current?.apparent_temperature,
      humidity: body.current?.relative_humidity_2m,
      precipitation: body.current?.precipitation,
      rain: body.current?.rain,
      cloudCover: body.current?.cloud_cover,
      windSpeed: body.current?.wind_speed_10m,
      weatherCode: body.current?.weather_code,
      condition: weatherLabel(body.current?.weather_code),
      isDay: Boolean(body.current?.is_day),
      time: body.current?.time,
    },
    daily,
    fetchedAt: new Date().toISOString(),
  }
  await cacheSet(cacheKey, out, 10 * 60)
  return out
}

const ZODIAC = new Set(['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'])

async function maybeTranslateHoroscope(text, metadata = {}) {
  if (!text || metadata.translatePtBr === false) return text
  try {
    const out = await enviarMensagem({
      systemPrompt: 'Traduza textos de horóscopo para português do Brasil. Preserve o sentido, não acrescente previsões, fatos ou conselhos novos. Responda apenas com a tradução, sem markdown.',
      pergunta: String(text).slice(0, 2500),
      profile:'translation', task:'portal:horoscopo:traducao', priority:'low', dataClass:'general',
    })
    return String(out.resposta || text).trim() || text
  } catch {
    return text
  }
}

export async function getHoroscope(sign) {
  const cfg = await contentConfig()
  if (!boolValue(cfg.portal_horoscope_enabled, false)) return { available: false, reason: 'disabled' }
  const zodiac = String(sign || '').toLowerCase().trim()
  if (!ZODIAC.has(zodiac)) return { available: true, configured: Boolean((await getCredential('api_ninjas', 'API_NINJAS_KEY')).value), requiresSign: true }

  const credential = await getCredential('api_ninjas', 'API_NINJAS_KEY')
  if (!credential.value) return { available: false, reason: 'not-configured' }
  const horoscopeMetadata = {
    ...(credential.metadata || {}),
    translatePtBr: credential.metadata?.translatePtBr ?? (String(process.env.API_NINJAS_TRANSLATE_PT_BR || 'true').toLowerCase() !== 'false'),
  }
  const day = new Date().toISOString().slice(0, 10)
  const cacheKey = `portal:horoscope:${day}:${zodiac}`
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const url = new URL('https://api.api-ninjas.com/v1/horoscope')
  url.searchParams.set('zodiac', zodiac)
  const { body } = await fetchJson(url, { headers: { 'X-Api-Key': credential.value } })
  const rawText = body.horoscope || body.prediction || body.text || ''
  const text = await maybeTranslateHoroscope(rawText, horoscopeMetadata)
  const out = {
    available: true,
    sign: zodiac,
    date: body.date || day,
    text,
    source: 'API Ninjas',
    fetchedAt: new Date().toISOString(),
  }
  await cacheSet(cacheKey, out, 12 * 60 * 60)
  return out
}

function parseLeagueIds(value) {
  return String(value || '').split(',').map(x => x.trim()).filter(Boolean).map(Number).filter(Number.isFinite)
}

function normalizeFixture(row) {
  const status = row.fixture?.status || {}
  return {
    id: row.fixture?.id,
    date: row.fixture?.date,
    timestamp: row.fixture?.timestamp,
    status: status.short || null,
    statusLong: status.long || null,
    elapsed: status.elapsed ?? null,
    league: {
      id: row.league?.id,
      name: row.league?.name,
      country: row.league?.country,
      logo: row.league?.logo,
      round: row.league?.round,
    },
    home: { id: row.teams?.home?.id, name: row.teams?.home?.name, logo: row.teams?.home?.logo, winner: row.teams?.home?.winner },
    away: { id: row.teams?.away?.id, name: row.teams?.away?.name, logo: row.teams?.away?.logo, winner: row.teams?.away?.winner },
    goals: { home: row.goals?.home, away: row.goals?.away },
    score: row.score || {},
  }
}

function filterFixtures(rows, metadata = {}) {
  const ids = parseLeagueIds(metadata.leagueIds)
  const includeInternational = metadata.showInternational !== false
  let list = Array.isArray(rows) ? rows : []
  if (ids.length) list = list.filter(x => ids.includes(Number(x.league?.id)))
  else if (!includeInternational) list = list.filter(x => String(x.league?.country || '').toLowerCase() === 'brazil')
  else {
    const br = list.filter(x => String(x.league?.country || '').toLowerCase() === 'brazil')
    const others = list.filter(x => String(x.league?.country || '').toLowerCase() !== 'brazil')
    list = [...br, ...others]
  }
  const max = Math.max(2, Math.min(12, Number(metadata.maxMatches) || 6))
  return list.slice(0, max).map(normalizeFixture)
}

async function footballRequest(path, credential) {
  const { body, headers } = await fetchJson(`https://v3.football.api-sports.io${path}`, {
    headers: { 'x-apisports-key': credential.value },
  }, 15_000)
  return {
    rows: body.response || [],
    quota: {
      remaining: headers.get('x-ratelimit-requests-remaining') || headers.get('x-ratelimit-remaining') || null,
      limit: headers.get('x-ratelimit-requests-limit') || headers.get('x-ratelimit-limit') || null,
    },
  }
}

export async function getFootball() {
  const cfg = await contentConfig()
  if (!boolValue(cfg.portal_football_enabled, false)) return { available: false, reason: 'disabled' }
  const credential = await getCredential('api_football', 'API_FOOTBALL_KEY')
  if (!credential.value) return { available: false, reason: 'not-configured' }
  const footballMetadata = {
    ...(credential.metadata || {}),
    leagueIds: credential.metadata?.leagueIds || process.env.API_FOOTBALL_LEAGUES || '',
    maxMatches: credential.metadata?.maxMatches || Number(process.env.API_FOOTBALL_MAX_MATCHES) || 6,
    showInternational: credential.metadata?.showInternational ?? (String(process.env.API_FOOTBALL_SHOW_INTERNATIONAL || 'true').toLowerCase() !== 'false'),
    liveCacheSeconds: Math.max(60, Math.min(900, Number(credential.metadata?.liveCacheSeconds || process.env.API_FOOTBALL_LIVE_CACHE_SECONDS) || 300)),
  }

  const liveCache = await cacheGet(FOOTBALL_LIVE_CACHE)
  let livePayload = liveCache
  if (!livePayload) {
    try {
      livePayload = await footballRequest('/fixtures?live=all', credential)
      // Sem jogo ao vivo, segura a consulta por 30 min para poupar a cota.
      // Quando há partida, usa o intervalo configurado (5 min por padrão).
      await cacheSet(FOOTBALL_LIVE_CACHE, livePayload, livePayload.rows?.length ? footballMetadata.liveCacheSeconds : 30 * 60)
    } catch (e) {
      livePayload = { rows: [], error: e.message }
    }
  }
  const live = filterFixtures(livePayload.rows, footballMetadata)
  if (live.length) return { available: true, mode: 'live', matches: live, quota: livePayload.quota || null, source: 'API-Football', fetchedAt: new Date().toISOString() }

  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const pv = Object.fromEntries(parts.map(p => [p.type, p.value]))
  const today = `${pv.year}-${pv.month}-${pv.day}`
  const todayKey = `${FOOTBALL_TODAY_CACHE}:${today}`
  let todayPayload = await cacheGet(todayKey)
  if (!todayPayload) {
    todayPayload = await footballRequest(`/fixtures?date=${encodeURIComponent(today)}&timezone=${encodeURIComponent('America/Sao_Paulo')}`, credential)
    await cacheSet(todayKey, todayPayload, 30 * 60)
  }
  return { available: true, mode: 'today', matches: filterFixtures(todayPayload.rows, footballMetadata), quota: todayPayload.quota || null, source: 'API-Football', fetchedAt: new Date().toISOString() }
}

export async function getRssWorld() {
  const cfg = await contentConfig()
  if (!boolValue(cfg.portal_rss_world_enabled, true)) return { available: false, reason: 'disabled', items: [] }

  // RSS é somente uma porta de entrada editorial. A Home nunca consulta feeds externos:
  // ela mostra apenas matérias já importadas e publicadas pelo módulo Notícias.
  const noticias = await Noticia.find({ importado: true, status: 'publicado' })
    .select('_id titulo imagem_url publicado_em criado_em fonte_id categoria_id')
    .populate('fonte_id', 'nome')
    .populate('categoria_id', 'nome')
    .sort({ publicado_em: -1, criado_em: -1 })
    .limit(12)
    .lean()

  const items = noticias.map(n => ({
    id: String(n._id),
    title: n.titulo,
    url: `/noticia/${n._id}`,
    source: n.fonte_id?.nome || 'Redação',
    image: n.imagem_url || null,
    publishedAt: (n.publicado_em || n.criado_em || new Date()).toISOString?.() || new Date(n.publicado_em || n.criado_em).toISOString(),
    category: n.categoria_id?.nome || null,
    internal: true,
  }))

  return { available: true, items, sources: new Set(items.map(x => x.source)).size, fetchedAt: new Date().toISOString(), editorial: true }
}

export async function getPortalHomeContent() {
  const [weather, football, rssWorld, horoscopeStatus] = await Promise.allSettled([
    getWeather(),
    getFootball(),
    getRssWorld(),
    getHoroscope(null),
  ])
  const val = (r, fallback) => r.status === 'fulfilled' ? r.value : { ...fallback, error: r.reason?.message || 'Falha ao carregar' }
  return {
    weather: val(weather, { available: false }),
    football: val(football, { available: false, matches: [] }),
    rssWorld: val(rssWorld, { available: false, items: [] }),
    horoscope: val(horoscopeStatus, { available: false }),
    fetchedAt: new Date().toISOString(),
  }
}
