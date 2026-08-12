import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { configuracoesService } from '../services/api'

const BrandingContext = createContext(null)

function clean(value) {
  return String(value ?? '').trim()
}

function initialConfig() {
  if (typeof window === 'undefined') return {}
  return window.__AL_PUBLIC_CONFIG__ || {}
}

export function BrandingProvider({ children }) {
  const [config, setConfig] = useState(initialConfig)
  const [loading, setLoading] = useState(() => !Object.keys(initialConfig()).length)

  const reload = useCallback(async (force = false) => {
    try {
      const data = await configuracoesService.listar(force)
      if (data && typeof data === 'object') setConfig(data)
      return data || {}
    } catch {
      return config
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const data = await configuracoesService.listar()
        if (alive && data && typeof data === 'object') setConfig(data)
      } catch {
        // Branding nunca deve impedir login/admin de abrir.
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    const onRefresh = (event) => {
      const incoming = event?.detail?.config
      if (incoming && typeof incoming === 'object') { setConfig(incoming); setLoading(false); return }
      load()
    }
    window.addEventListener('alsistemas:branding-refresh', onRefresh)
    return () => {
      alive = false
      window.removeEventListener('alsistemas:branding-refresh', onRefresh)
    }
  }, [])

  useEffect(() => {
    const favicon = clean(config.site_favicon)
    if (!favicon || typeof document === 'undefined') return
    let link = document.querySelector('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = favicon
  }, [config.site_favicon])

  const value = useMemo(() => {
    const siteName = clean(config.nome_site) || clean(config.site_titulo) || 'Portal de notícias'
    const siteTitle = clean(config.site_titulo) || siteName
    const productName = clean(import.meta.env.VITE_APP_NAME) || 'AL Sistemas'
    return {
      config,
      loading,
      siteName,
      siteTitle,
      siteDescription: clean(config.site_descricao),
      siteUrl: clean(config.site_url),
      favicon: clean(config.site_favicon),
      logo: clean(config.logo_url || config.site_logo || config.site_imagem),
      organization: clean(config.organizacao),
      productName,
      panelSubtitle: 'Painel administrativo',
      reload,
    }
  }, [config, loading, reload])

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export function useBranding() {
  const ctx = useContext(BrandingContext)
  if (!ctx) throw new Error('useBranding deve ser usado dentro de <BrandingProvider>')
  return ctx
}
