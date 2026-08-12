import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { TEMAS_MAP, TEMA_PADRAO_ID } from '../themes'

const STORAGE_KEY = 'alsistemas_adm_tema'
const ThemeContext = createContext(null)

/**
 * Aplica os tokens no nível raiz. Isso faz com que login, toasts, portals,
 * modais e qualquer overlay montado diretamente em document.body usem o
 * mesmo tema do painel. O .admin-shell continua recebendo as vars por
 * compatibilidade com estilos antigos.
 */
function aplicarVars(vars, temaId) {
  if (typeof document === 'undefined') return
  const targets = [document.documentElement, document.querySelector('.admin-shell')].filter(Boolean)
  targets.forEach(target => {
    Object.entries(vars).forEach(([k, v]) => target.style.setProperty(k, v))
  })
  document.documentElement.setAttribute('data-adm-tema', temaId)
}

export function ThemeProvider({ children }) {
  const [temaId, setTemaId] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || TEMA_PADRAO_ID } catch { return TEMA_PADRAO_ID }
  })

  const tema = TEMAS_MAP[temaId] ?? TEMAS_MAP[TEMA_PADRAO_ID]

  useEffect(() => {
    aplicarVars(tema.vars, temaId)
    // Reaplica após a montagem para páginas antigas que ainda dependem de
    // variáveis inline no .admin-shell.
    const t = setTimeout(() => aplicarVars(tema.vars, temaId), 0)
    return () => clearTimeout(t)
  }, [tema, temaId])

  const mudarTema = useCallback((id) => {
    if (!TEMAS_MAP[id]) return
    setTemaId(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch {}
  }, [])

  return (
    <ThemeContext.Provider value={{ temaId, tema, mudarTema }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme deve ser usado dentro de <ThemeProvider>')
  return ctx
}
