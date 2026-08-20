const DEFAULT_SERVICES = [
  {
    id: 'al-sistemas-api',
    name: 'AL Sistemas API',
    url: 'https://al-sistemas-api.onrender.com/api/health/live',
    provider: 'Render',
  },
  {
    id: 'guiadoa',
    name: 'GuiaDoA',
    url: 'https://guiadoa-agrq.onrender.com/',
    provider: 'Render',
  },
]

function safeServices() {
  const raw = String(process.env.STATUS_SERVICES_JSON || '').trim()
  if (!raw) return DEFAULT_SERVICES
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_SERVICES
    const out = parsed.slice(0, 20).map((item, index) => ({
      id: String(item?.id || `service-${index + 1}`).slice(0, 80),
      name: String(item?.name || item?.url || `Serviço ${index + 1}`).slice(0, 120),
      url: String(item?.url || '').trim(),
      provider: String(item?.provider || '').slice(0, 80),
    })).filter(item => /^https?:\/\//i.test(item.url))
    return out.length ? out : DEFAULT_SERVICES
  } catch {
    return DEFAULT_SERVICES
  }
}

function timeoutMs() {
  const value = Number(process.env.STATUS_TIMEOUT_MS || 9000)
  return Math.max(2000, Math.min(15000, Number.isFinite(value) ? value : 9000))
}

async function fetchWithTimeout(url, options = {}, ms = timeoutMs()) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function checkService(service) {
  const started = Date.now()
  try {
    const response = await fetchWithTimeout(service.url, {
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'User-Agent': 'AL-Sistemas-Status/1.0' },
    })
    const latencyMs = Date.now() - started
    const online = response.status >= 200 && response.status < 400
    const reachable = response.status < 500
    return {
      ...service,
      status: online ? 'online' : reachable ? 'reachable' : 'offline',
      httpStatus: response.status,
      latencyMs,
      checkedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      ...service,
      status: 'offline',
      httpStatus: null,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      error: error?.name === 'AbortError' ? 'timeout' : 'network_error',
    }
  }
}

async function renderStatus() {
  try {
    const [summaryResponse, incidentsResponse] = await Promise.all([
      fetchWithTimeout('https://status.render.com/api/v2/summary.json', { cache: 'no-store' }, 5000),
      fetchWithTimeout('https://status.render.com/api/v2/incidents/unresolved.json', { cache: 'no-store' }, 5000),
    ])
    const summary = summaryResponse.ok ? await summaryResponse.json() : null
    const incidentsData = incidentsResponse.ok ? await incidentsResponse.json() : null
    const incidents = Array.isArray(incidentsData?.incidents) ? incidentsData.incidents.map(incident => {
      const latest = Array.isArray(incident.incident_updates) ? incident.incident_updates[0] : null
      return {
        id: incident.id,
        name: incident.name,
        status: incident.status,
        impact: incident.impact,
        updatedAt: incident.updated_at,
        message: String(latest?.body || '').replace(/<[^>]+>/g, '').slice(0, 800),
      }
    }) : []
    return {
      available: Boolean(summary),
      indicator: summary?.status?.indicator || 'unknown',
      description: summary?.status?.description || 'Status indisponível',
      updatedAt: summary?.page?.updated_at || null,
      incidents,
      url: 'https://status.render.com/',
    }
  } catch {
    return { available: false, indicator: 'unknown', description: 'Não foi possível consultar o status oficial do Render.', incidents: [], url: 'https://status.render.com/' }
  }
}

async function fallbackStatus() {
  const publicBase = String(process.env.CF_R2_PUBLIC_URL || '').trim().replace(/\/+$/, '')
  const derived = publicBase ? `${publicBase}/alsistemas/fallback/public-snapshot-v1.json` : ''
  const url = String(process.env.NEWS_FALLBACK_URL || process.env.VITE_NEWS_FALLBACK_URL || derived || '').trim()
  if (!/^https?:\/\//i.test(url)) return { configured: false, available: false }
  const started = Date.now()
  try {
    const response = await fetchWithTimeout(url, { cache: 'no-store' }, 6000)
    if (!response.ok) return { configured: true, available: false, httpStatus: response.status, latencyMs: Date.now() - started }
    const data = await response.json()
    return {
      configured: true,
      available: data?.schema === 'alsistemas-public-snapshot-v1',
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      generatedAt: data?.generated_at || null,
      newsCount: Array.isArray(data?.noticias) ? data.noticias.length : null,
    }
  } catch (error) {
    return { configured: true, available: false, latencyMs: Date.now() - started, error: error?.name === 'AbortError' ? 'timeout' : 'network_error' }
  }
}

export default async function handler(_request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store, max-age=0')
  const services = safeServices()
  const [checks, render, fallback] = await Promise.all([
    Promise.all(services.map(checkService)),
    renderStatus(),
    fallbackStatus(),
  ])
  const online = checks.filter(item => item.status === 'online').length
  response.status(200).json({
    ok: true,
    generatedAt: new Date().toISOString(),
    monitor: { provider: 'Vercel Functions', independentFromRenderBackend: true },
    summary: { total: checks.length, online, unavailable: checks.length - online },
    services: checks,
    render,
    fallback,
  })
}
