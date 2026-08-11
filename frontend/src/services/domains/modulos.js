import { api } from './http.js'
export const modulosService = {
  async listar()             { return api('/modulos') },
  async atualizar(id, upd)   { return api(`/modulos/${id}`, { method: 'PUT', body: JSON.stringify(upd) }) },
  async listarCompositor()    { return api('/conteudo/home') },
  async salvarCompositor(itens) { return api('/conteudo/home/ordem', { method: 'PUT', body: JSON.stringify({ itens }) }) },
}
