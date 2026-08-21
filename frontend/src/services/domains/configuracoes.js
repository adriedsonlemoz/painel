import { api } from './http.js'
import {
  isPublicFallbackEligible,
  isPublicPortalRoute,
  markPrimaryApiAvailable,
  snapshotCollection,
} from '../publicFallback.js'
import { shouldServeSnapshotFirst } from '../publicData.js'
import { isBackendReady } from '../backendWake.js'

let cache = null
let cacheSource = ''
let pending = null

function emitBranding(config = null) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('alsistemas:branding-refresh', { detail: { config } }))
}

async function liveConfig() {
  const data = await api('/configuracoes')
  cache = data || {}
  cacheSource = 'live'
  if (isPublicPortalRoute()) markPrimaryApiAvailable()
  return cache
}

async function snapshotConfig(markActive = false) {
  const data = await snapshotCollection('configuracoes', {}, { markActive })
  cache = data || {}
  cacheSource = 'snapshot'
  return cache
}

async function listar(force = false) {
  if (!force && cache && !(cacheSource === 'snapshot' && !shouldServeSnapshotFirst())) return cache

  if (!force && typeof window !== 'undefined' && window.__AL_PUBLIC_CONFIG__ && shouldServeSnapshotFirst()) {
    cache = window.__AL_PUBLIC_CONFIG__
    cacheSource = 'snapshot'
    return cache
  }

  if (!force && pending) return pending

  pending = (async () => {
    if (!force && shouldServeSnapshotFirst()) {
      try { return await snapshotConfig(false) } catch { /* tenta live */ }
    }

    // O bootstrap HTML pode entregar a configuração pública antes do React.
    // Em rotas administrativas um resultado nulo não bloqueia: consultamos a API.
    if (!force && typeof window !== 'undefined' && window.__AL_PUBLIC_CONFIG_PROMISE__) {
      try {
        const data = await Promise.resolve(window.__AL_PUBLIC_CONFIG_PROMISE__)
        if (data && typeof data === 'object' && Object.keys(data).length) {
          cache = data
          cacheSource = isPublicPortalRoute() ? 'snapshot' : 'bootstrap'
          return cache
        }
      } catch { /* continua para live */ }
    }

    // Login/reset não disparam uma segunda chamada pesada enquanto o coordenador
    // de wake ainda está aguardando o Render. Branding pode usar a configuração
    // pública/cacheada e é recarregado assim que o backend fica pronto.
    if (!force && typeof window !== 'undefined') {
      const path = window.location.pathname || ''
      const authSurface = path === '/login' || path.startsWith('/esqueci-senha') || path.startsWith('/redefinir-senha')
      if (authSurface && !isBackendReady()) {
        cache = window.__AL_PUBLIC_CONFIG__ || cache || {}
        cacheSource = cache && Object.keys(cache).length ? 'bootstrap' : 'deferred'
        return cache
      }
    }

    try {
      return await liveConfig()
    } catch (error) {
      if (!isPublicPortalRoute() || !isPublicFallbackEligible(error)) throw error
      return snapshotConfig(true).catch(() => { throw error })
    }
  })().finally(() => { pending = null })

  return pending
}

function sincronizarPublicConfig(data = {}) {
  cache = data || {}
  cacheSource = 'snapshot'
  if (typeof window !== 'undefined') {
    window.__AL_PUBLIC_CONFIG__ = cache
    window.__AL_PUBLIC_CONFIG_PROMISE__ = Promise.resolve(cache)
  }
  emitBranding(cache)
  return cache
}

function invalidar() { cache = null; cacheSource = '' }

export const configuracoesService = {
  listar,
  async atualizar(chave, valor) {
    const out = await api(`/configuracoes/${chave}`, { method: 'PUT', body: JSON.stringify({ valor }) })
    invalidar()
    emitBranding()
    return out
  },
  async atualizarLote(pares) {
    const out = await api('/configuracoes-lote', { method: 'PUT', body: JSON.stringify({ pares }) })
    invalidar()
    emitBranding()
    return out
  },
  async listarSEO() { return api('/seo-configuracoes') },
  async atualizarSEO(pares) {
    const out = await api('/seo-configuracoes', { method: 'PUT', body: JSON.stringify({ pares }) })
    if (out?.configuracoes) sincronizarPublicConfig({ ...(cache || {}), ...out.configuracoes })
    return out
  },
  async analisarSEO(configuracoes, acao = 'auditar') { return api('/seo/ia', { method: 'POST', body: JSON.stringify({ configuracoes, acao }), timeoutMs: 60000 }) },
  sincronizarPublicConfig,
  invalidar,
}
