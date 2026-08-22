import { api } from './http.js'

const stepHeader = token => token ? { 'X-Step-Up-Token': token } : {}

export const securityService = {
  resumo: () => api('/admin/security/resumo'),
  eventos: (params = {}) => api(`/admin/security/eventos?${new URLSearchParams(params)}`),
  atualizarEvento: (id, data = {}) => api(`/admin/security/eventos/${id}`, { method:'PATCH', body:JSON.stringify(data) }),
  forense: (id) => api(`/admin/security/eventos/${id}/forense`),
  sessoes: () => api('/admin/security/sessoes'),
  revogarSessao: (jti, stepToken) => api(`/admin/security/sessoes/${encodeURIComponent(jti)}`, { method:'DELETE', headers:stepHeader(stepToken) }),
  revogarUsuario: (id, stepToken) => api(`/admin/security/sessoes/revogar-usuario/${id}`, { method:'POST', headers:stepHeader(stepToken) }),
  politica: () => api('/admin/security/politica'),
  salvarPolitica: (data, stepToken) => api('/admin/security/politica', { method:'PUT', headers:stepHeader(stepToken), body:JSON.stringify(data) }),
  salvarAlertas: (data, stepToken) => api('/admin/security/alertas/configuracao', { method:'PUT', headers:stepHeader(stepToken), body:JSON.stringify(data) }),
  testarAlertas: (stepToken, severidade='alta') => api('/admin/security/alertas/testar', { method:'POST', headers:stepHeader(stepToken), body:JSON.stringify({severidade}) }),
  desbloquearIp: (ip, stepToken) => api('/admin/security/ip/desbloquear', { method:'POST', headers:stepHeader(stepToken), body:JSON.stringify({ip}) }),
  scanSegredos: () => api('/admin/security/scan-segredos', { method:'POST', timeoutMs:60000 }),
  dependencias: () => api('/admin/security/dependencias', { timeoutMs:60000 }),
  auditoria: (limit=50) => api(`/admin/security/auditoria?limit=${limit}`),
}
