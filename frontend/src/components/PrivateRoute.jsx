/**
 * PrivateRoute.jsx
 *
 * Mudança em relação ao original:
 * - AdminRoute: redireciona usuários sem permissão para /login
 *   (antes redirecionava para "/" que era a home pública — não existe mais)
 */
import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LoadingSpinner from './LoadingSpinner'

function SessionRecovery({ ensureSession }) {
  useEffect(() => {
    const timer = window.setTimeout(() => { void ensureSession() }, 3500)
    return () => window.clearTimeout(timer)
  }, [ensureSession])
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-sm">
        <div className="mx-auto mb-3 h-8 w-8 rounded-full border-2 border-gray-200 border-t-brand-500 animate-spin" aria-hidden="true" />
        <strong className="block text-sm text-gray-900">Reativando o servidor</strong>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">Sua sessão foi preservada. O painel tentará reconectar automaticamente sem pedir novo login.</p>
        <button type="button" className="mt-4 rounded-xl bg-brand-500 px-4 py-2 text-xs font-bold text-white" onClick={() => void ensureSession()}>Tentar agora</button>
      </div>
    </div>
  )
}

/** Rota que exige apenas login (qualquer usuário autenticado). */
export default function PrivateRoute({ children }) {
  const { user, loading, sessionChecked, sessionError, ensureSession } = useAuth()
  useEffect(() => { ensureSession() }, [ensureSession])
  if (!sessionChecked || loading) return <LoadingSpinner texto="Verificando sessão..." />
  if (!user && sessionError) return <SessionRecovery ensureSession={ensureSession} />
  return user ? children : <Navigate to="/login" replace />
}

/**
 * Rota exclusiva do painel admin.
 * Usuários sem permissões de admin são redirecionados para /login.
 */
export function AdminRoute({ children }) {
  const { user, loading, sessionChecked, sessionError, ensureSession, podeAcessarAdmin } = useAuth()
  useEffect(() => { ensureSession() }, [ensureSession])
  if (!sessionChecked || loading) return <LoadingSpinner texto="Verificando sessão..." />
  if (!user && sessionError) return <SessionRecovery ensureSession={ensureSession} />
  if (!user) return <Navigate to="/login" replace />
  if (!podeAcessarAdmin()) return <Navigate to="/login" replace />
  return children
}
