import { api } from './http.js'
import {
  listarNoticiasFallback,
  buscarNoticiaFallback,
  sugestoesNoticiasFallback,
  markPrimaryApiAvailable,
  isPublicFallbackEligible,
} from '../publicFallback.js'

export const noticiasService = {
  async listar({ categoria, page = 1, limit = 9, q, cursor, dataInicio, dataFim, ordem, status, urgente } = {}) {
    const p = new URLSearchParams()
    if (categoria)         p.set('categoria', categoria)
    if (cursor)            p.set('cursor', cursor)
    else if (page > 1)     p.set('page', String(page))
    if (limit !== 9)       p.set('limit', String(limit))
    if (q?.trim())         p.set('q', q.trim())
    if (dataInicio)        p.set('dataInicio', dataInicio)
    if (dataFim)           p.set('dataFim', dataFim)
    if (ordem && ordem !== 'recente') p.set('ordem', ordem)
    if (status)            p.set('status', status)
    if (urgente)           p.set('urgente', 'true')
    const qs = p.toString()
    try {
      const data = await api(`/noticias${qs ? `?${qs}` : ''}`)
      markPrimaryApiAvailable()
      return data
    } catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      // O snapshot contém somente conteúdo público. Em /admin a própria
      // camada de fallback recusa a leitura para nunca mascarar falhas de escrita.
      return listarNoticiasFallback({ categoria, page, limit, q, cursor, dataInicio, dataFim, ordem, urgente })
        .catch(() => { throw error })
    }
  },
  async buscarPorId(id) {
    try {
      const data = await api(`/noticias/${id}`)
      markPrimaryApiAvailable()
      return data
    } catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      return buscarNoticiaFallback(id).catch(() => { throw error })
    }
  },
  async sugestoes(q) {
    try {
      return await api(`/noticias/sugestoes?q=${encodeURIComponent(q || '')}`)
    } catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      return sugestoesNoticiasFallback(q).catch(() => { throw error })
    }
  },
  async criar(dados)          { return api('/noticias', { method: 'POST', body: JSON.stringify(dados) }) },
  async editar(id, dados)     { return api(`/noticias/${id}`, { method: 'PUT', body: JSON.stringify(dados) }) },
  async excluir(id)           { await api(`/noticias/${id}`, { method: 'DELETE' }); return true },
  async atualizarStatus(id, status) {
    return api(`/noticias/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
  },
  async contagemStatus()      { return api('/noticias/contagem-status') },
}
