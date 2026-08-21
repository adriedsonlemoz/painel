const CACHE_KEY = 'alsistemas:public-snapshot:v1'
const SNAPSHOT_SCHEMA = 'alsistemas-public-snapshot-v1'
const DEFAULT_FRESH_MS = 10 * 60_000
const DEFAULT_HARD_CACHE_MS = 24 * 60 * 60_000
const REMOTE_REVALIDATE_MS = 60_000
const memory = { snapshot: null, loadedAt: 0, source: '', activeState: null, cachedAt: 0 }
let pending = null
let revalidatePending = null
let lastRemoteCheckAt = 0

function browserReady() {
  return typeof window !== 'undefined' && typeof fetch === 'function'
}

export function isPublicPortalRoute() {
  if (!browserReady()) return false
  const path = window.location.pathname || '/'
  return !path.startsWith('/admin') && path !== '/login' && !path.startsWith('/redefinir-senha') && !path.startsWith('/esqueci-senha')
}

function validSnapshot(value) {
  return Boolean(value && typeof value === 'object' && value.schema === SNAPSHOT_SCHEMA && Array.isArray(value.noticias))
}

function cacheFreshMs() {
  const configured = Number(import.meta.env.VITE_PUBLIC_CACHE_TTL_MS || DEFAULT_FRESH_MS)
  return Number.isFinite(configured) ? Math.max(60_000, Math.min(60 * 60_000, configured)) : DEFAULT_FRESH_MS
}

function hardCacheMs() {
  const configured = Number(import.meta.env.VITE_PUBLIC_CACHE_MAX_AGE_MS || DEFAULT_HARD_CACHE_MS)
  return Number.isFinite(configured) ? Math.max(60 * 60_000, Math.min(7 * 24 * 60 * 60_000, configured)) : DEFAULT_HARD_CACHE_MS
}

function snapshotGeneratedAt(snapshot) {
  const value = new Date(snapshot?.generated_at || 0).getTime()
  return Number.isFinite(value) ? value : 0
}

function normalizeStored(value) {
  if (validSnapshot(value)) {
    return { snapshot: value, cachedAt: snapshotGeneratedAt(value) || 0 }
  }
  if (value && typeof value === 'object' && validSnapshot(value.snapshot)) {
    const rawCachedAt = value.cached_at || value.cachedAt || 0
    const numericCachedAt = Number(rawCachedAt)
    const parsedCachedAt = Number.isFinite(numericCachedAt) && numericCachedAt > 0 ? numericCachedAt : new Date(rawCachedAt || 0).getTime()
    return { snapshot: value.snapshot, cachedAt: Number.isFinite(parsedCachedAt) ? parsedCachedAt : 0 }
  }
  return null
}

function saveLocal(snapshot) {
  if (!browserReady() || !validSnapshot(snapshot)) return
  const cachedAt = Date.now()
  memory.cachedAt = cachedAt
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      snapshot,
      cached_at: cachedAt,
      generated_at: snapshot.generated_at || null,
    }))
  } catch {
    // Quota/localStorage bloqueado: o snapshot em memória ainda funciona.
  }
}

function readLocal() {
  if (!browserReady()) return null
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    const normalized = normalizeStored(parsed)
    if (!normalized) return null
    const referenceAt = normalized.cachedAt || snapshotGeneratedAt(normalized.snapshot)
    if (referenceAt && Date.now() - referenceAt > hardCacheMs()) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return normalized
  } catch {
    return null
  }
}

function applySnapshot(snapshot, source, { save = false, notify = false } = {}) {
  if (!validSnapshot(snapshot)) return null
  const previousGeneratedAt = snapshotGeneratedAt(memory.snapshot)
  const nextGeneratedAt = snapshotGeneratedAt(snapshot)
  // Nunca rebaixa a interface para uma cópia remota mais antiga que a que já
  // está em memória. Isso protege contra propagação/race do R2 após uma edição.
  if (previousGeneratedAt && nextGeneratedAt && nextGeneratedAt < previousGeneratedAt) return memory.snapshot
  memory.snapshot = snapshot
  memory.loadedAt = Date.now()
  memory.source = source || memory.source || 'snapshot'
  if (save) saveLocal(snapshot)

  if (browserReady()) {
    const cfg = snapshot?.configuracoes
    if (cfg && typeof cfg === 'object') {
      window.__AL_PUBLIC_CONFIG__ = cfg
      window.__AL_PUBLIC_CONFIG_PROMISE__ = Promise.resolve(cfg)
      window.dispatchEvent(new CustomEvent('alsistemas:branding-refresh', { detail: { config: cfg } }))
    }
    if (notify && (!previousGeneratedAt || nextGeneratedAt >= previousGeneratedAt)) {
      window.dispatchEvent(new CustomEvent('alsistemas:public-snapshot-updated', {
        detail: {
          snapshot,
          source: memory.source,
          generatedAt: snapshot.generated_at || null,
          ageMs: Math.max(0, Date.now() - (nextGeneratedAt || Date.now())),
        },
      }))
    }
  }
  return snapshot
}

async function fetchSnapshot(url, timeoutMs = 4500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error(`Fallback HTTP ${response.status}`)
    const data = await response.json()
    if (!validSnapshot(data)) throw new Error('Snapshot público inválido.')
    return data
  } finally {
    clearTimeout(timer)
  }
}

function remoteCandidates() {
  const out = ['/api/news-fallback']
  const direct = String(import.meta.env.VITE_NEWS_FALLBACK_URL || '').trim()
  if (direct && !out.includes(direct)) out.push(direct)
  return out
}

async function fetchRemoteSnapshot() {
  let lastError = null
  for (const url of remoteCandidates()) {
    try {
      const snapshot = await fetchSnapshot(url)
      return { snapshot, source: url === '/api/news-fallback' ? 'vercel-r2' : 'r2-direct' }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('Nenhum snapshot público remoto disponível.')
}

export async function revalidatePublicSnapshot({ force = false } = {}) {
  if (!isPublicPortalRoute()) return null
  const now = Date.now()
  if (revalidatePending) return revalidatePending
  if (!force && now - lastRemoteCheckAt < REMOTE_REVALIDATE_MS) return memory.snapshot
  lastRemoteCheckAt = now

  revalidatePending = (async () => {
    const { snapshot, source } = await fetchRemoteSnapshot()
    return applySnapshot(snapshot, source, { save: true, notify: true })
  })().finally(() => { revalidatePending = null })

  return revalidatePending
}

export async function getPublicSnapshot({ force = false, allowLocal = true } = {}) {
  if (!isPublicPortalRoute()) throw new Error('Fallback público indisponível em rotas administrativas.')
  if (force) return revalidatePublicSnapshot({ force: true })

  if (memory.snapshot) {
    // O TTL curto só exige revalidação; a cópia continua visível enquanto uma
    // versão nova é buscada. Já o limite rígido impede que uma sessão/navegação
    // futura continue servindo indefinidamente uma cópia local muito antiga.
    const freshnessAt = memory.cachedAt || snapshotGeneratedAt(memory.snapshot) || memory.loadedAt
    const cacheAge = Date.now() - freshnessAt
    if (cacheAge > hardCacheMs()) {
      memory.snapshot = null
      memory.loadedAt = 0
      memory.cachedAt = 0
      memory.source = ''
      try { localStorage.removeItem(CACHE_KEY) } catch { /* armazenamento bloqueado */ }
    } else {
      if (cacheAge >= cacheFreshMs()) void revalidatePublicSnapshot().catch(() => {})
      return memory.snapshot
    }
  }

  if (pending) return pending
  pending = (async () => {
    if (allowLocal) {
      const local = readLocal()
      if (local?.snapshot) {
        memory.cachedAt = local.cachedAt
        const snapshot = applySnapshot(local.snapshot, 'browser-cache', { notify: false })
        // Cache-first + stale-while-revalidate: conteúdo aparece imediatamente e
        // a cópia do R2 é consultada em paralelo em todo novo carregamento.
        void revalidatePublicSnapshot({ force: true }).catch(() => {})
        return snapshot
      }
    }

    const { snapshot, source } = await fetchRemoteSnapshot()
    return applySnapshot(snapshot, source, { save: true, notify: false })
  })().finally(() => { pending = null })

  return pending
}

export function getPublicCacheInfo() {
  const snapshot = memory.snapshot || readLocal()?.snapshot || null
  const generatedAt = snapshot?.generated_at || null
  const generatedMs = snapshotGeneratedAt(snapshot)
  const ageMs = generatedMs ? Math.max(0, Date.now() - generatedMs) : null
  return {
    hasSnapshot: Boolean(snapshot),
    generatedAt,
    ageMs,
    fresh: ageMs == null ? false : ageMs <= cacheFreshMs(),
    ttlMs: cacheFreshMs(),
    hardTtlMs: hardCacheMs(),
    source: memory.source || (snapshot ? 'browser-cache' : ''),
  }
}

export function isPublicFallbackEligible(error) {
  const status = Number(error?.status || 0)
  // Sem status = falha de rede/timeout. 429 e 5xx podem usar uma cópia pública;
  // 4xx funcionais (400/401/403/404...) continuam sendo respeitados.
  return !status || status === 429 || status >= 500
}

export function primePublicSnapshot() {
  if (!isPublicPortalRoute()) return
  void getPublicSnapshot({ allowLocal: true }).catch(() => {})
  void revalidatePublicSnapshot().catch(() => {})
}

export function markPublicFallbackActive(snapshot, reason = 'backend-unavailable') {
  if (!browserReady()) return
  memory.activeState = {
    active: true,
    generatedAt: snapshot?.generated_at || null,
    source: memory.source || 'fallback',
    reason,
  }
  window.dispatchEvent(new CustomEvent('alsistemas:public-fallback', { detail: memory.activeState }))
}

export function getPublicFallbackState() {
  return memory.activeState
}

export function markPrimaryApiAvailable() {
  if (!browserReady()) return
  memory.activeState = null
  window.dispatchEvent(new CustomEvent('alsistemas:public-fallback', { detail: { active: false } }))
}

function toTime(value) {
  const n = new Date(value || 0).getTime()
  return Number.isFinite(n) ? n : 0
}

function text(value) {
  return String(value ?? '').toLocaleLowerCase('pt-BR')
}

function matchesSearch(noticia, q) {
  const needle = text(q).trim()
  if (!needle) return true
  const haystack = [
    noticia.titulo,
    noticia.resumo,
    noticia.conteudo,
    noticia.autor,
    ...(Array.isArray(noticia.tags) ? noticia.tags : []),
  ].map(text).join(' ')
  return haystack.includes(needle)
}

function matchesCategory(noticia, categoria) {
  if (!categoria) return true
  const slugs = String(categoria).split(',').map(v => v.trim()).filter(Boolean)
  if (!slugs.length) return true
  return slugs.includes(String(noticia.categoria_id?.slug || ''))
}

function matchesDate(noticia, dataInicio, dataFim) {
  const current = toTime(noticia.criado_em || noticia.publicado_em)
  if (!current) return true
  if (dataInicio) {
    const start = new Date(dataInicio)
    start.setHours(0, 0, 0, 0)
    if (current < start.getTime()) return false
  }
  if (dataFim) {
    const end = new Date(dataFim)
    end.setHours(23, 59, 59, 999)
    if (current > end.getTime()) return false
  }
  return true
}

function matchesUrgent(noticia, urgente) {
  if (!urgente) return true
  if (!noticia.urgente) return false
  // Snapshots antigos podiam conter plantão sem data final. Para não manter
  // urgência eterna quando o backend estiver dormindo, aplica 6 h de validade.
  if (!noticia.urgente_ate) {
    const inicio = toTime(noticia.criado_em || noticia.publicado_em)
    return Boolean(inicio && inicio + (6 * 60 * 60 * 1000) > Date.now())
  }
  return toTime(noticia.urgente_ate) > Date.now()
}

export async function listarNoticiasFallback({ categoria, page = 1, limit = 9, q, cursor, dataInicio, dataFim, ordem, urgente } = {}, { markActive = true } = {}) {
  const snapshot = await getPublicSnapshot()
  let items = snapshot.noticias.filter(n =>
    matchesCategory(n, categoria) && matchesSearch(n, q) && matchesDate(n, dataInicio, dataFim) && matchesUrgent(n, urgente)
  )

  items.sort((a, b) => toTime(b.criado_em || b.publicado_em) - toTime(a.criado_em || a.publicado_em))
  if (ordem === 'antigo') items.reverse()

  const lim = Math.max(1, Math.min(500, Number(limit) || 9))
  if (cursor) {
    const cursorTime = toTime(cursor)
    const cursorItems = cursorTime ? items.filter(n => toTime(n.criado_em || n.publicado_em) < cursorTime) : items
    const noticias = cursorItems.slice(0, lim)
    const nextCursor = noticias.length === lim ? (noticias[noticias.length - 1]?.criado_em || null) : null
    if (markActive) markPublicFallbackActive(snapshot)
    return { noticias, nextCursor, fallback: true, snapshot_generated_at: snapshot.generated_at }
  }

  const pag = Math.max(1, Number(page) || 1)
  const total = items.length
  const inicio = (pag - 1) * lim
  const noticias = items.slice(inicio, inicio + lim)
  if (markActive) markPublicFallbackActive(snapshot)
  return {
    noticias,
    total,
    pagina: pag,
    paginas: Math.max(1, Math.ceil(total / lim)),
    fallback: true,
    snapshot_generated_at: snapshot.generated_at,
  }
}

export async function buscarNoticiaFallback(id, { markActive = true } = {}) {
  const snapshot = await getPublicSnapshot()
  const ident = String(id || '')
  const noticia = snapshot.noticias.find(n =>
    String(n._id || '') === ident || String(n.id || '') === ident || String(n.slug || '') === ident
  )
  if (!noticia) throw new Error('Notícia não encontrada no último snapshot disponível.')
  if (markActive) markPublicFallbackActive(snapshot)
  return noticia
}

export async function sugestoesNoticiasFallback(q, { markActive = true } = {}) {
  const snapshot = await getPublicSnapshot()
  const query = String(q || '').trim()
  if (query.length < 2) return []
  const out = snapshot.noticias.filter(n => matchesSearch(n, query)).slice(0, 6).map(n => ({
    _id: n._id,
    id: n.id,
    titulo: n.titulo,
    slug: n.slug,
    categoria_id: n.categoria_id,
    publicado_em: n.publicado_em,
  }))
  if (markActive) markPublicFallbackActive(snapshot)
  return out
}

export async function snapshotCollection(name, fallback = [], { markActive = true } = {}) {
  const snapshot = await getPublicSnapshot()
  const value = snapshot?.[name]
  if (markActive) markPublicFallbackActive(snapshot)
  if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback
  return value && typeof value === 'object' ? value : fallback
}
