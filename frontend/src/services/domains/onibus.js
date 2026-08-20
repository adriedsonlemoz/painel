import { api } from './http.js'
import { isPublicFallbackEligible, snapshotCollection } from '../publicFallback.js'
export const onibusService = {
  async listar() {
    try { return await api('/onibus') }
    catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      return snapshotCollection('onibus', []).catch(() => { throw error })
    }
  },
  async listarTodos()     { return api('/onibus/todos') },
  async criar(dados)      { return api('/onibus', { method: 'POST', body: JSON.stringify(dados) }) },
  async editar(id, dados) { return api(`/onibus/${id}`, { method: 'PUT', body: JSON.stringify(dados) }) },
  async excluir(id)       { await api(`/onibus/${id}`, { method: 'DELETE' }); return true },
}
