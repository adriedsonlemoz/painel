import { api } from './http.js'
import { isPublicFallbackEligible, snapshotCollection } from '../publicFallback.js'
export const topicosService = {
  async listar() {
    try { return await api('/topicos') }
    catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      return snapshotCollection('topicos', []).catch(() => { throw error })
    }
  },
  async listarTodos()     { return api('/topicos/todos') },
  async criar(dados)      { return api('/topicos', { method: 'POST', body: JSON.stringify(dados) }) },
  async editar(id, dados) { return api(`/topicos/${id}`, { method: 'PUT', body: JSON.stringify(dados) }) },
  async excluir(id)       { await api(`/topicos/${id}`, { method: 'DELETE' }); return true },
}
