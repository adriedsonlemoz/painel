import { api } from './http.js'
import { isPublicFallbackEligible, snapshotCollection } from '../publicFallback.js'
export const eventosService = {
  async listar() {
    try { return await api('/eventos') }
    catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      return snapshotCollection('eventos', []).catch(() => { throw error })
    }
  },
  async listarTodos()     { return api('/eventos/todos') },
  async criar(dados)      { return api('/eventos', { method: 'POST', body: JSON.stringify(dados) }) },
  async editar(id, dados) { return api(`/eventos/${id}`, { method: 'PUT', body: JSON.stringify(dados) }) },
  async excluir(id)       { await api(`/eventos/${id}`, { method: 'DELETE' }); return true },
}
