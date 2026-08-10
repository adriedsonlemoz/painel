import { api } from './http.js'

let cache = null
let pending = null

async function listar(force = false) {
  if (!force && cache) return cache
  if (!force && typeof window !== 'undefined' && window.__AL_PUBLIC_CONFIG__) {
    cache = window.__AL_PUBLIC_CONFIG__
    return cache
  }
  if (!force && pending) return pending
  if (!force && typeof window !== 'undefined' && window.__AL_PUBLIC_CONFIG_PROMISE__) {
    pending = Promise.resolve(window.__AL_PUBLIC_CONFIG_PROMISE__)
      .then(data => { cache = data || {}; return cache })
      .finally(() => { pending = null })
    return pending
  }
  pending = api('/configuracoes')
    .then(data => { cache = data || {}; return cache })
    .finally(() => { pending = null })
  return pending
}

function invalidar() { cache = null }

export const configuracoesService = {
  listar,
  async atualizar(chave, valor) {
    const out = await api(`/configuracoes/${chave}`, { method: 'PUT', body: JSON.stringify({ valor }) })
    invalidar()
    return out
  },
  async atualizarLote(pares) {
    const out = await api('/configuracoes-lote', { method: 'PUT', body: JSON.stringify({ pares }) })
    invalidar()
    return out
  },
  invalidar,
}
