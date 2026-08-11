import { bootstrapValue } from '../utils/localVault.js'
import jwt from 'jsonwebtoken'
import Usuario from '../models/Usuario.js'

// #1 — Lê token do cookie HttpOnly (seguro contra XSS) com fallback
// para Authorization: Bearer (compatibilidade com clientes externos/API).
export async function autenticar(req, res, next) {
  try {
    // Quando o frontend cloud envia Bearer explicitamente, ele tem prioridade.
    // Isso evita que um cookie cross-site antigo bloqueie uma sessão nova válida.
    const token =
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null) ||
      req.cookies?.alsistemas_token

    if (!token) {
      return res.status(401).json({ erro: 'Token não fornecido' })
    }

    const decoded = jwt.verify(token, bootstrapValue('JWT_SECRET'))

    const usuario = await Usuario.findById(decoded.id).populate('perfil_id', 'nome cor permissoes')

    if (usuario && Number(decoded.sv || 0) !== Number(usuario.sessao_versao || 0)) {
      return res.status(401).json({ erro: 'Sessão revogada. Faça login novamente.' })
    }

    // ── Correção crítica: conta desativada não deve operar ──────────────────
    if (!usuario || !usuario.ativo) {
      return res.status(401).json({ erro: 'Conta desativada ou não encontrada.' })
    }

    req.usuario = usuario
    next()
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' })
  }
}

/**
 * autenticarOpcional
 * Tenta identificar o usuário pelo token, mas NÃO rejeita se não houver token.
 * Usado em rotas públicas que precisam saber se o requisitante é admin
 * (ex.: GET /noticias — admin pode ver rascunhos, visitante só vê publicados).
 */
export async function autenticarOpcional(req, res, next) {
  try {
    // Quando o frontend cloud envia Bearer explicitamente, ele tem prioridade.
    // Isso evita que um cookie cross-site antigo bloqueie uma sessão nova válida.
    const token =
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null) ||
      req.cookies?.alsistemas_token

    if (token) {
      const decoded  = jwt.verify(token, bootstrapValue('JWT_SECRET'))
      const usuario  = await Usuario.findById(decoded.id).populate('perfil_id', 'nome cor permissoes')
      if (usuario?.ativo && Number(decoded.sv || 0) === Number(usuario.sessao_versao || 0)) req.usuario = usuario
    }
  } catch { /* token inválido → não autentica, mas continua */ }
  next()
}
