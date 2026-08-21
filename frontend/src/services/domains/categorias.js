import { api } from './http.js'
import { isPublicFallbackEligible, isPublicPortalRoute, markPrimaryApiAvailable, snapshotCollection } from '../publicFallback.js'
import { shouldServeSnapshotFirst } from '../publicData.js'

let cache = null
let cacheSource = ''
let pending = null

async function listar(force = false) {
  if (!force && cache && !(cacheSource === 'snapshot' && !shouldServeSnapshotFirst())) return cache
  if (!force && pending) return pending

  pending = (async () => {
    if (!force && shouldServeSnapshotFirst()) {
      try {
        cache = await snapshotCollection('categorias', [], { markActive: false })
        cacheSource = 'snapshot'
        return cache
      } catch { /* tenta API ao vivo abaixo */ }
    }

    try {
      const data = await api('/categorias')
      cache = Array.isArray(data) ? data : []
      cacheSource = 'live'
      if (isPublicPortalRoute()) markPrimaryApiAvailable()
      return cache
    } catch (error) {
      if (!isPublicPortalRoute() || !isPublicFallbackEligible(error)) throw error
      cache = await snapshotCollection('categorias', [], { markActive: true }).catch(() => { throw error })
      cacheSource = 'snapshot'
      return cache
    }
  })().finally(() => { pending = null })

  return pending
}

function invalidar() { cache = null; cacheSource = '' }

export const categoriasService = {
  listar,
  async criar(dados) { const out = await api('/categorias', { method: 'POST', body: JSON.stringify(dados) }); invalidar(); return out },
  async editar(id, dados) { const out = await api(`/categorias/${id}`, { method: 'PUT', body: JSON.stringify(dados) }); invalidar(); return out },
  async excluir(id) { await api(`/categorias/${id}`, { method: 'DELETE' }); invalidar(); return true },
  invalidar,
}
