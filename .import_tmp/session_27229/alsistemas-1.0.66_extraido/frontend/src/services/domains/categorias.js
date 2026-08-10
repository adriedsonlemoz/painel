import { api } from './http.js'

let cache = null
let pending = null

async function listar(force = false) {
  if (!force && cache) return cache
  if (!force && pending) return pending
  pending = api('/categorias')
    .then(data => { cache = Array.isArray(data) ? data : []; return cache })
    .finally(() => { pending = null })
  return pending
}

function invalidar() { cache = null }

export const categoriasService = {
  listar,
  async criar(dados) { const out = await api('/categorias', { method: 'POST', body: JSON.stringify(dados) }); invalidar(); return out },
  async editar(id, dados) { const out = await api(`/categorias/${id}`, { method: 'PUT', body: JSON.stringify(dados) }); invalidar(); return out },
  async excluir(id) { await api(`/categorias/${id}`, { method: 'DELETE' }); invalidar(); return true },
  invalidar,
}
