import { api } from './http.js'
import { isPublicFallbackEligible, snapshotCollection } from '../publicFallback.js'
export const noticiasExternasService = {
  async listar() {
    try { return await api('/noticias-externas') }
    catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      return snapshotCollection('noticias_externas', []).catch(() => { throw error })
    }
  },
  async listarTodas()     { return api('/noticias-externas/todas') },
  async criar(dados)      { return api('/noticias-externas', { method: 'POST', body: JSON.stringify(dados) }) },
  async editar(id, dados) { return api(`/noticias-externas/${id}`, { method: 'PUT', body: JSON.stringify(dados) }) },
  async excluir(id)       { await api(`/noticias-externas/${id}`, { method: 'DELETE' }); return true },
}
