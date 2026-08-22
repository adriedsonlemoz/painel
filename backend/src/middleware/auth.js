import { bootstrapValue } from '../utils/localVault.js'
import jwt from 'jsonwebtoken'
import Usuario from '../models/Usuario.js'
import SecuritySession from '../models/SecuritySession.js'
import SecurityPolicy from '../models/SecurityPolicy.js'

async function resolveAuth(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : null
  const token = bearer || req.cookies?.alsistemas_token
  if (!token) return { token: null, decoded: null, usuario: null, transport: 'none' }

  const decoded = jwt.verify(token, bootstrapValue('JWT_SECRET'))
  const usuario = await Usuario.findById(decoded.id).populate('perfil_id', 'nome cor permissoes')
  if (!usuario || !usuario.ativo) return { token, decoded, usuario: null, transport: bearer ? 'bearer' : 'cookie' }
  if (Number(decoded.sv || 0) !== Number(usuario.sessao_versao || 0)) return { token, decoded, usuario: null, transport: bearer ? 'bearer' : 'cookie', revoked: true }

  if (decoded.jti) {
    const session = await SecuritySession.findOne({ jti: decoded.jti }).lean()
    if (!session || session.revogada_em || new Date(session.expira_em) <= new Date()) {
      return { token, decoded, usuario: null, transport: bearer ? 'bearer' : 'cookie', revoked: true }
    }
    const last = new Date(session.ultimo_acesso_em || 0).getTime()
    if (Date.now() - last > 5 * 60 * 1000) {
      void SecuritySession.updateOne({ jti: decoded.jti }, { ultimo_acesso_em: new Date(), ip: req.ip || session.ip }).catch(() => {})
    }
  }
  return { token, decoded, usuario, transport: bearer ? 'bearer' : 'cookie' }
}

export async function autenticar(req, res, next) {
  try {
    const resolved = await resolveAuth(req)
    if (!resolved.token) return res.status(401).json({ erro: 'Token não fornecido' })
    if (!resolved.usuario) return res.status(401).json({ erro: resolved.revoked ? 'Sessão revogada. Faça login novamente.' : 'Conta desativada ou não encontrada.' })
    req.usuario = resolved.usuario
    req.authPayload = resolved.decoded
    req.authTransport = resolved.transport
    next()
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' })
  }
}

export async function autenticarOpcional(req, _res, next) {
  try {
    const resolved = await resolveAuth(req)
    if (resolved.usuario) {
      req.usuario = resolved.usuario
      req.authPayload = resolved.decoded
      req.authTransport = resolved.transport
    }
  } catch { /* token inválido → continua como visitante */ }
  next()
}

export function exigirStepUp(req, res, next) {
  try {
    const token = String(req.headers['x-step-up-token'] || '')
    if (!token) return res.status(428).json({ erro: 'Confirme sua identidade para continuar.', codigo: 'STEP_UP_REQUIRED' })
    const decoded = jwt.verify(token, bootstrapValue('JWT_SECRET'))
    if (decoded.purpose !== 'step-up' || String(decoded.id) !== String(req.usuario?._id || '')) {
      return res.status(401).json({ erro: 'Confirmação de identidade inválida.', codigo: 'STEP_UP_INVALID' })
    }
    if (decoded.jti && req.authPayload?.jti && decoded.jti !== req.authPayload.jti) {
      return res.status(401).json({ erro: 'A confirmação pertence a outra sessão.', codigo: 'STEP_UP_INVALID' })
    }
    req.stepUp = decoded
    next()
  } catch {
    return res.status(401).json({ erro: 'Confirmação expirada. Confirme sua identidade novamente.', codigo: 'STEP_UP_EXPIRED' })
  }
}


let stepPolicyCache={at:0,enabled:true}
export async function exigirStepUpSePolitica(req,res,next){
  try{
    if(Date.now()-stepPolicyCache.at>30_000){
      const p=await SecurityPolicy.findOne({chave:'default'}).select('step_up_critico').lean().catch(()=>null)
      stepPolicyCache={at:Date.now(),enabled:p?.step_up_critico!==false}
    }
    if(!stepPolicyCache.enabled)return next()
    return exigirStepUp(req,res,next)
  }catch(error){next(error)}
}
