import { api, BASE_URL, authFetch } from './http.js'

const BASE_URL_ERROS = BASE_URL + '/erros'

const recentErrors = new Map()
const DEDUP_WINDOW_MS = 60_000

function errorKey(payload) {
  return [payload?.tipo || '', payload?.mensagem || '', window.location.pathname, String(payload?.stack || '').split('\n')[0]].join('|').slice(0, 1600)
}

function shouldSend(payload) {
  const now = Date.now()
  const key = errorKey(payload)
  const last = recentErrors.get(key) || 0
  if (now - last < DEDUP_WINDOW_MS) return false
  recentErrors.set(key, now)
  if (recentErrors.size > 100) {
    for (const [k, ts] of recentErrors) if (now - ts > DEDUP_WINDOW_MS) recentErrors.delete(k)
  }
  return true
}

export const errosService = {
  // Fire-and-forget: nunca lança exceção para não criar loop infinito
  async capturar({ tipo, mensagem, stack, dados } = {}) {
    try {
      if (!shouldSend({ tipo, mensagem, stack })) return { ok: true, deduplicado: true }
      const payload = {
        tipo,
        mensagem: String(mensagem || 'Erro desconhecido').slice(0, 2000),
        stack:    stack ? String(stack).slice(0, 5000) : null,
        url:      window.location.href,
        rota:     window.location.pathname,
        user_agent: navigator.userAgent,
        usuario_email: null,
        dados: dados || null,
      }
      await authFetch(BASE_URL_ERROS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
    } catch { /* silencioso */ }
  },

  async listar({ tipo, lido, status, page = 1, limit = 50 } = {}) {
    const p = new URLSearchParams({ page, limit })
    if (tipo   !== undefined) p.set('tipo', tipo)
    if (status !== undefined) p.set('status', status)
    if (lido   !== undefined && status === undefined) p.set('lido', String(lido))
    return api(`/erros?${p}`)
  },

  async diagnostico(registrar = true) { return api('/erros/diagnostico', { method: 'POST', body: JSON.stringify({ registrar }), timeoutMs: 30000 }) },
  async central() { return api('/erros/central', { timeoutMs: 30000 }) },
  async detalhesCentral(event) { return api('/erros/central/detalhes', { method: 'POST', body: JSON.stringify({ event }), timeoutMs: 30000 }) },
  async analisarCentral(event) { return api('/erros/central/analisar', { method: 'POST', body: JSON.stringify({ event }), timeoutMs: 60000 }) },
  async contagem()              { return api('/erros/contagem') },
  async marcarLido(id, lido = true) {
    return api(`/erros/${id}/lido`, { method: 'PATCH', body: JSON.stringify({ lido }) })
  },
  async atualizarStatus(id, status) {
    return api(`/erros/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
  },
  async marcarTodosLidos() {
    return api('/erros/marcar-todos-lidos', { method: 'PATCH', body: '{}' })
  },
  async excluir(id)             { await api(`/erros/${id}`, { method: 'DELETE' }) },
  async bulkDelete(ids)         { return api('/erros/bulk',        { method: 'DELETE', body: JSON.stringify({ ids }) }) },
  async bulkStatus(ids, status) { return api('/erros/bulk-status', { method: 'PATCH',  body: JSON.stringify({ ids, status }) }) },
  async limpar({ tipo, status, apenas_lidos } = {}) {
    const p = new URLSearchParams()
    if (tipo)         p.set('tipo', tipo)
    if (status)       p.set('status', status)
    if (apenas_lidos) p.set('apenas_lidos', 'true')
    return api(`/erros${p.toString() ? '?' + p : ''}`, { method: 'DELETE' })
  },
}
