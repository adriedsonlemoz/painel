import { api } from './http.js'
import { isPublicFallbackEligible, snapshotCollection } from '../publicFallback.js'

let cache = null
let pending = null

function emitBranding(config = null) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('alsistemas:branding-refresh', { detail: { config } }))
}

async function listar(force = false) {
  if (!force && cache) return cache
  if (!force && typeof window !== 'undefined' && window.__AL_PUBLIC_CONFIG__) {
    cache = window.__AL_PUBLIC_CONFIG__
    return cache
  }
  if (!force && pending) return pending
  if (!force && typeof window !== 'undefined' && window.__AL_PUBLIC_CONFIG_PROMISE__) {
    pending = Promise.resolve(window.__AL_PUBLIC_CONFIG_PROMISE__)
      .then(async data => {
        if (data && typeof data === 'object' && Object.keys(data).length) {
          cache = data
          return cache
        }
        // Na Vercel, o bootstrap HTML usa /api/configuracoes same-origin e pode
        // não encontrar uma Function com esse nome. Antes de recorrer ao snapshot,
        // consulta a API real definida em VITE_API_URL.
        try {
          const live = await api('/configuracoes')
          cache = live || {}
          return cache
        } catch (error) {
          if (!isPublicFallbackEligible(error)) throw error
          const fallback = await snapshotCollection('configuracoes', {}).catch(() => { throw error })
          cache = fallback || {}
          return cache
        }
      })
      .finally(() => { pending = null })
    return pending
  }
  pending = api('/configuracoes')
    .then(data => { cache = data || {}; return cache })
    .catch(error => {
      if (!isPublicFallbackEligible(error)) throw error
      return snapshotCollection('configuracoes', {}).catch(() => { throw error })
    })
    .finally(() => { pending = null })
  return pending
}

function sincronizarPublicConfig(data = {}) {
  cache = data || {}
  if (typeof window !== 'undefined') {
    window.__AL_PUBLIC_CONFIG__ = cache
    window.__AL_PUBLIC_CONFIG_PROMISE__ = Promise.resolve(cache)
  }
  emitBranding(cache)
  return cache
}

function invalidar() { cache = null }

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
