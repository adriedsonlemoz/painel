import { api } from './http.js'
import { isBackendReady } from '../backendWake.js'
import {
  listarNoticiasFallback,
  buscarNoticiaFallback,
  sugestoesNoticiasFallback,
  markPrimaryApiAvailable,
  isPublicFallbackEligible,
  isPublicPortalRoute,
} from '../publicFallback.js'

function snapshotFirst() {
  return isPublicPortalRoute() && !isBackendReady()
}

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

    // O snapshot só contém conteúdo público. Consultas administrativas com
    // filtro de status continuam indo diretamente ao backend.
    if (!status && snapshotFirst()) {
      try {
        return await listarNoticiasFallback(
          { categoria, page, limit, q, cursor, dataInicio, dataFim, ordem, urgente },
          { markActive: false },
        )
      } catch { /* sem snapshot: tenta API */ }
    }

    try {
      const data = await api(`/noticias${qs ? `?${qs}` : ''}`)
      if (isPublicPortalRoute()) markPrimaryApiAvailable()
      return data
    } catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      return listarNoticiasFallback({ categoria, page, limit, q, cursor, dataInicio, dataFim, ordem, urgente }, { markActive: true })
        .catch(() => { throw error })
    }
  },
  async buscarPorId(id) {
    if (snapshotFirst()) {
      try { return await buscarNoticiaFallback(id, { markActive: false }) } catch { /* tenta live */ }
    }
    try {
      const data = await api(`/noticias/${id}`)
      if (isPublicPortalRoute()) markPrimaryApiAvailable()
      return data
    } catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      return buscarNoticiaFallback(id, { markActive: true }).catch(() => { throw error })
    }
  },
  async sugestoes(q) {
    if (snapshotFirst()) {
      try { return await sugestoesNoticiasFallback(q, { markActive: false }) } catch { /* tenta live */ }
    }
    try {
      return await api(`/noticias/sugestoes?q=${encodeURIComponent(q || '')}`)
    } catch (error) {
      if (!isPublicFallbackEligible(error)) throw error
      return sugestoesNoticiasFallback(q, { markActive: true }).catch(() => { throw error })
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
