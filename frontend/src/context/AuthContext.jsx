import { createContext, useContext, useState, useRef, useCallback } from 'react'
import { authService } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  // A sessão não é consultada no boot do portal público. Ela só é necessária
  // para login/admin e passa a ser carregada sob demanda por ensureSession().
  const [loading, setLoading] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [authTransport, setAuthTransport] = useState('unknown')
  const [sessionError, setSessionError] = useState(null)
  const checked = useRef(false)
  const checkingPromise = useRef(null)

  const ensureSession = useCallback(async () => {
    if (checked.current) return user
    if (checkingPromise.current) return checkingPromise.current

    setLoading(true)
    let transientFailure = false
    checkingPromise.current = (async () => {
      try {
        const { data, error } = await authService.getSession({ restore: true })
        if (error || data?.auth?.unavailable) {
          transientFailure = true
          setSessionError(error || new Error('Servidor temporariamente indisponível.'))
          setAuthTransport(data?.auth?.transport || 'reconnecting')
          return user
        }
        const sessionUser = data?.session?.user ?? null
        setUser(sessionUser)
        setSessionError(null)
        setAuthTransport(data?.auth?.transport || (sessionUser ? 'cookie' : 'none'))
        return sessionUser
      } catch {
        transientFailure = true
        setSessionError(new Error('Não foi possível confirmar a sessão agora.'))
        return user
      } finally {
        // Falhas transitórias não invalidam a sessão e também não bloqueiam
        // uma nova tentativa automática/manual quando a Render terminar de acordar.
        checked.current = !transientFailure
        setSessionChecked(true)
        checkingPromise.current = null
        setLoading(false)
      }
    })()
    return checkingPromise.current
  }, [user])

  async function login(email, senha, manterConectado = false) {
    const { data, error } = await authService.login(email, senha, manterConectado)
    if (error) throw error
    checked.current = true
    setSessionChecked(true)
    setSessionError(null)
    setUser(data.user)
    setAuthTransport(data?.auth?.transport || 'cookie')
    return data
  }

  async function logout() {
    await authService.logout()
    checked.current = true
    setSessionChecked(true)
    setSessionError(null)
    setUser(null)
    setAuthTransport('none')
  }

  function temPermissao(permissao) {
    if (!user) return false
    if (user.role === 'superadmin') return true
    const perms = user.perfil_id?.permissoes || []
    return perms.includes('*') || perms.includes(permissao)
  }

  function podeAcessarAdmin() {
    if (!user) return false
    if (user.role === 'superadmin') return true
    const perms = user.perfil_id?.permissoes || []
    return perms.length > 0
  }

  return (
    <AuthContext.Provider value={{ user, loading, sessionChecked, authTransport, sessionError, ensureSession, login, logout, temPermissao, podeAcessarAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro do AuthProvider')
  return ctx
}
