import { useState, useEffect, useCallback } from 'react'
import { noticiasService, categoriasService } from '../services/api'

// useNoticias({ categoriaSlug, q, page, limit, dataInicio, dataFim, ordem, status })
export function useNoticias({ categoriaSlug, q, page = 1, limit = 9, dataInicio, dataFim, ordem, status } = {}) {
  const [noticias, setNoticias] = useState([])
  const [total,    setTotal]    = useState(0)
  const [paginas,  setPaginas]  = useState(1)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  const carregar = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true)
      setError(null)
      const data = await noticiasService.listar({
        categoria: categoriaSlug, page, limit, q,
        dataInicio, dataFim, ordem,
        status,
      })
      setNoticias(data.noticias ?? [])
      setTotal(data.total    ?? 0)
      setPaginas(data.paginas ?? 1)
    } catch (err) {
      if (!silent) setError(err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [categoriaSlug, q, page, limit, dataInicio, dataFim, ordem, status])

  useEffect(() => { void carregar() }, [carregar])

  useEffect(() => {
    const refresh = () => { void carregar({ silent: true }) }
    window.addEventListener('alsistemas:backend-ready', refresh)
    window.addEventListener('alsistemas:public-snapshot-updated', refresh)
    return () => {
      window.removeEventListener('alsistemas:backend-ready', refresh)
      window.removeEventListener('alsistemas:public-snapshot-updated', refresh)
    }
  }, [carregar])

  return { noticias, total, paginas, loading, error, recarregar: carregar }
}

export function useNoticia(id) {
  const [noticia, setNoticia] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const carregar = useCallback(async ({ silent = false } = {}) => {
    if (!id) return
    try {
      if (!silent) setLoading(true)
      setError(null)
      const data = await noticiasService.buscarPorId(id)
      setNoticia(data)
    } catch (err) {
      if (!silent) setError(err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [id])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => {
    const refresh = () => { void carregar({ silent: true }) }
    window.addEventListener('alsistemas:backend-ready', refresh)
    window.addEventListener('alsistemas:public-snapshot-updated', refresh)
    return () => {
      window.removeEventListener('alsistemas:backend-ready', refresh)
      window.removeEventListener('alsistemas:public-snapshot-updated', refresh)
    }
  }, [carregar])

  return { noticia, loading, error }
}

export function useCategorias() {
  const [categorias, setCategorias] = useState([])
  const [loading,    setLoading]    = useState(true)

  const carregar = useCallback(async ({ force = false, silent = false } = {}) => {
    try {
      if (!silent) setLoading(true)
      const data = await categoriasService.listar(force)
      setCategorias(data)
    } catch {
      if (!silent) setCategorias([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  useEffect(() => {
    const onReady = () => { void carregar({ force: true, silent: true }) }
    const onSnapshot = event => {
      const incoming = event?.detail?.snapshot?.categorias
      if (Array.isArray(incoming)) {
        categoriasService.invalidar()
        setCategorias(incoming)
      }
    }
    window.addEventListener('alsistemas:backend-ready', onReady)
    window.addEventListener('alsistemas:public-snapshot-updated', onSnapshot)
    return () => {
      window.removeEventListener('alsistemas:backend-ready', onReady)
      window.removeEventListener('alsistemas:public-snapshot-updated', onSnapshot)
    }
  }, [carregar])

  return { categorias, loading, recarregar: carregar }
}
