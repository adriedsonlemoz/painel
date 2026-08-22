import jwt from 'jsonwebtoken'
import { bootstrapValue } from '../utils/localVault.js'
import { isPlatformOriginAllowed } from '../utils/platformOrigins.js'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

function sameOrigin(req, candidate) {
  if (!candidate) return false
  try {
    const u = new URL(candidate)
    return u.host === req.get('host') || isPlatformOriginAllowed(u.origin)
  } catch { return false }
}

export function csrfProtection(req, res, next) {
  if (SAFE.has(req.method)) return next()
  if (!req.path.startsWith('/api/')) return next()
  // Login/reset/setup não dependem de uma sessão autenticada por cookie.
  if (/^\/api\/(auth\/(login|login\/2fa|esqueci-senha|redefinir-senha)|setup)(\/|$)/.test(req.path)) return next()
  // Bearer não é enviado automaticamente pelo navegador, então não sofre CSRF clássico.
  if (req.headers.authorization?.startsWith('Bearer ')) return next()

  const token = req.cookies?.alsistemas_token
  if (!token) return next()
  let payload
  try { payload = jwt.verify(token, bootstrapValue('JWT_SECRET')) } catch { return next() }

  const origin = String(req.headers.origin || '')
  const referer = String(req.headers.referer || '')
  if (origin && !sameOrigin(req, origin)) return res.status(403).json({ erro: 'Origem rejeitada pela proteção CSRF.', codigo: 'CSRF_ORIGIN' })
  if (!origin && referer && !sameOrigin(req, referer)) return res.status(403).json({ erro: 'Referência rejeitada pela proteção CSRF.', codigo: 'CSRF_REFERER' })

  // Compatibilidade com sessões emitidas antes da 1.0.156: Origin/Referer já
  // protege a sessão antiga; novo login passa a usar também token vinculado ao JWT.
  if (!payload.csrf) {
    res.setHeader('X-CSRF-Renew', '1')
    return next()
  }
  const provided = String(req.headers['x-csrf-token'] || '')
  if (!provided || provided.length !== String(payload.csrf).length) return res.status(403).json({ erro: 'Token CSRF ausente ou inválido.', codigo: 'CSRF_TOKEN' })
  try {
    if (!Buffer.from(provided).equals(Buffer.from(String(payload.csrf)))) return res.status(403).json({ erro: 'Token CSRF inválido.', codigo: 'CSRF_TOKEN' })
  } catch { return res.status(403).json({ erro: 'Token CSRF inválido.', codigo: 'CSRF_TOKEN' }) }
  next()
}
