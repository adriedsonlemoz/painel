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
  const checked = useRef(false)
  const checkingPromise = useRef(null)

  const ensureSession = useCallback(async () => {
    if (checked.current) return user
    if (checkingPromise.current) return checkingPromise.current

    setLoading(true)
    checkingPromise.current = (async () => {
      try {
        const { data } = await authService.getSession({ restore: true })
        const sessionUser = data?.session?.user ?? null
        setUser(sessionUser)
        setAuthTransport(data?.auth?.transport || (sessionUser ? 'cookie' : 'none'))
        return sessionUser
      } catch {
        setUser(null)
        return null
      } finally {
        checked.current = true
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
    setUser(data.user)
    setAuthTransport(data?.auth?.transport || 'cookie')
    return data
  }

  async function logout() {
    await authService.logout()
    checked.current = true
    setSessionChecked(true)
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
    <AuthContext.Provider value={{ user, loading, sessionChecked, authTransport, ensureSession, login, logout, temPermissao, podeAcessarAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro do AuthProvider')
  return ctx
}
