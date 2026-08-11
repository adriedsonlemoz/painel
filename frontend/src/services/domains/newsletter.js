import { api } from './http.js'

export const newsletterService = {
  async assinar(email, nome = '') { return api('/newsletter/assinar', { method:'POST', body:JSON.stringify({ email, nome }) }) },
  async listarAssinantes({ page=1, limit=50, ativo, q='' }={}) { const p=new URLSearchParams({page,limit});if(ativo!==undefined)p.set('ativo',String(ativo));if(q)p.set('q',q);return api(`/newsletter/assinantes?${p}`) },
  async removerAssinante(id) { return api(`/newsletter/assinantes/${id}`, { method:'DELETE' }) },
  async alterarStatus(id, ativo) { return api(`/newsletter/assinantes/${id}/status`, { method:'PATCH', body:JSON.stringify({ ativo }) }) },
  async listarCampanhas(){return api('/newsletter/campanhas')},
  async criarCampanha(dados){return api('/newsletter/campanhas',{method:'POST',body:JSON.stringify(dados)})},
  async editarCampanha(id,dados){return api(`/newsletter/campanhas/${id}`,{method:'PUT',body:JSON.stringify(dados)})},
  async enviarTeste(id,email){return api(`/newsletter/campanhas/${id}/teste`,{method:'POST',body:JSON.stringify({email})})},
  async enviar(id,agendada_para=null){return api(`/newsletter/campanhas/${id}/enviar`,{method:'POST',body:JSON.stringify({agendada_para})})},
  async cancelarAgendamento(id){return api(`/newsletter/campanhas/${id}/cancelar-agendamento`,{method:'POST'})},
}
