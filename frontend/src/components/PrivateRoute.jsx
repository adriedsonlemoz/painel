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

/** Rota que exige apenas login (qualquer usuário autenticado). */
export default function PrivateRoute({ children }) {
  const { user, loading, sessionChecked, ensureSession } = useAuth()
  useEffect(() => { ensureSession() }, [ensureSession])
  if (!sessionChecked || loading) return <LoadingSpinner texto="Verificando sessão..." />
  return user ? children : <Navigate to="/login" replace />
}

/**
 * Rota exclusiva do painel admin.
 * Usuários sem permissões de admin são redirecionados para /login.
 */
export function AdminRoute({ children }) {
  const { user, loading, sessionChecked, ensureSession, podeAcessarAdmin } = useAuth()
  useEffect(() => { ensureSession() }, [ensureSession])
  if (!sessionChecked || loading) return <LoadingSpinner texto="Verificando sessão..." />
  if (!user) return <Navigate to="/login" replace />
  if (!podeAcessarAdmin()) return <Navigate to="/login" replace />
  return children
}
