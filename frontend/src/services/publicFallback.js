const CACHE_KEY = 'alsistemas:public-snapshot:v1'
const SNAPSHOT_SCHEMA = 'alsistemas-public-snapshot-v1'
const memory = { snapshot: null, loadedAt: 0, source: '', activeState: null }
let pending = null

function browserReady() {
  return typeof window !== 'undefined' && typeof fetch === 'function'
}

function publicPortalAllowed() {
  if (!browserReady()) return false
  const path = window.location.pathname || '/'
  return !path.startsWith('/admin') && path !== '/login' && !path.startsWith('/redefinir-senha') && !path.startsWith('/esqueci-senha')
}

function validSnapshot(value) {
  return Boolean(value && typeof value === 'object' && value.schema === SNAPSHOT_SCHEMA && Array.isArray(value.noticias))
}

function saveLocal(snapshot) {
  if (!browserReady() || !validSnapshot(snapshot)) return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // Quota/localStorage bloqueado: o snapshot em memória ainda funciona.
  }
}

function readLocal() {
  if (!browserReady()) return null
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return validSnapshot(value) ? value : null
  } catch {
    return null
  }
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

export async function getPublicSnapshot({ force = false, allowLocal = true } = {}) {
  if (!publicPortalAllowed()) throw new Error('Fallback público indisponível em rotas administrativas.')
  if (!force && memory.snapshot && Date.now() - memory.loadedAt < 60_000) return memory.snapshot
  if (!force && pending) return pending

  pending = (async () => {
    let lastError = null
    for (const url of remoteCandidates()) {
      try {
        const snapshot = await fetchSnapshot(url)
        memory.snapshot = snapshot
        memory.loadedAt = Date.now()
        memory.source = url === '/api/news-fallback' ? 'vercel-r2' : 'r2-direct'
        saveLocal(snapshot)
        return snapshot
      } catch (error) {
        lastError = error
      }
    }

    if (allowLocal) {
      const local = readLocal()
      if (local) {
        memory.snapshot = local
        memory.loadedAt = Date.now()
        memory.source = 'browser-cache'
        return local
      }
    }
    throw lastError || new Error('Nenhum snapshot público de contingência disponível.')
  })().finally(() => { pending = null })

  return pending
}


export function isPublicFallbackEligible(error) {
  const status = Number(error?.status || 0)
  // Sem status = falha de rede/timeout. 429 e 5xx podem usar uma cópia pública;
  // 4xx funcionais (400/401/403/404...) continuam sendo respeitados.
  return !status || status === 429 || status >= 500
}

export function primePublicSnapshot() {
  if (!publicPortalAllowed()) return
  void getPublicSnapshot({ force: true, allowLocal: true }).catch(() => {})
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

export async function listarNoticiasFallback({ categoria, page = 1, limit = 9, q, cursor, dataInicio, dataFim, ordem, urgente } = {}) {
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
    markPublicFallbackActive(snapshot)
    return { noticias, nextCursor, fallback: true, snapshot_generated_at: snapshot.generated_at }
  }

  const pag = Math.max(1, Number(page) || 1)
  const total = items.length
  const inicio = (pag - 1) * lim
  const noticias = items.slice(inicio, inicio + lim)
  markPublicFallbackActive(snapshot)
  return {
    noticias,
    total,
    pagina: pag,
    paginas: Math.max(1, Math.ceil(total / lim)),
    fallback: true,
    snapshot_generated_at: snapshot.generated_at,
  }
}

export async function buscarNoticiaFallback(id) {
  const snapshot = await getPublicSnapshot()
  const ident = String(id || '')
  const noticia = snapshot.noticias.find(n =>
    String(n._id || '') === ident || String(n.id || '') === ident || String(n.slug || '') === ident
  )
  if (!noticia) throw new Error('Notícia não encontrada no último snapshot disponível.')
  markPublicFallbackActive(snapshot)
  return noticia
}

export async function sugestoesNoticiasFallback(q) {
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
  markPublicFallbackActive(snapshot)
  return out
}

export async function snapshotCollection(name, fallback = []) {
  const snapshot = await getPublicSnapshot()
  const value = snapshot?.[name]
  markPublicFallbackActive(snapshot)
  if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback
  return value && typeof value === 'object' ? value : fallback
}
