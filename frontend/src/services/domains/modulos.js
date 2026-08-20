import { api } from './http.js'
import { isPublicFallbackEligible, snapshotCollection } from '../publicFallback.js'
export const modulosService = {
  async listar() {
    try { return await api('/modulos') }
    catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      return snapshotCollection('modulos', []).catch(() => { throw error })
    }
  },
  async atualizar(id, upd)   { return api(`/modulos/${id}`, { method: 'PUT', body: JSON.stringify(upd) }) },
  async listarCompositor()    { return api('/conteudo/home') },
  async salvarCompositor(itens) { return api('/conteudo/home/ordem', { method: 'PUT', body: JSON.stringify({ itens }) }) },
}
