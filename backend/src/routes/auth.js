import { bootstrapValue } from '../utils/localVault.js'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { rateLimit } from 'express-rate-limit'
import Usuario from '../models/Usuario.js'
import SecuritySession from '../models/SecuritySession.js'
import { autenticar, autenticarOpcional, exigirStepUp, exigirStepUpSePolitica } from '../middleware/auth.js'
import { regraLogin, validar } from '../middleware/validacoes.js'
import { validarForcaSenha } from '../routes/usuarios.js'
import { logger } from '../utils/logger.js'
import { getCredential, setCredential, deleteCredential } from '../utils/credentialStore.js'
import { randomBase32, verifyTotp, otpauthUri, recoveryCodes, hashRecoveryCode } from '../utils/totp.js'
import { recordSecurityEvent, detectCredentialAttackPatterns, getSecurityPolicy } from '../services/securityService.js'

const router = Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
})

function requestIsCrossOrigin(req) {
  const origin = String(req.headers.origin || '')
  try { return Boolean(origin && new URL(origin).host !== req.get('host')) } catch { return false }
}

function cookieOpts(req, persist = true) {
  const crossOrigin = requestIsCrossOrigin(req)
  const secure = crossOrigin || req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https')
  return { httpOnly: true, secure, sameSite: crossOrigin ? 'none' : 'lax', ...(persist ? { maxAge: 7 * 24 * 60 * 60 * 1000 } : {}), path: '/' }
}

const MAX_TENTATIVAS = 5
const BLOQUEIO_MINUTOS = 30

function deviceLabel(userAgent = '') {
  const ua = String(userAgent || '')
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Dispositivo'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ''
  return `${os}${browser ? ` · ${browser}` : ''}`
}

function gerarToken(usuario, expiresIn = process.env.JWT_EXPIRES_IN || '7d', extra = {}) {
  return jwt.sign({ id: usuario._id, sv: usuario.sessao_versao || 0, ...extra }, bootstrapValue('JWT_SECRET'), { expiresIn })
}

async function createSession(req, usuario, { jti, token, persistent = false, transport = 'cookie' }) {
  const decoded = jwt.decode(token) || {}
  const dispositivo = deviceLabel(req.headers['user-agent'])
  const knownDevice = await SecuritySession.exists({ usuario_id: usuario._id, dispositivo })
  const knownIp = req.ip ? await SecuritySession.exists({ usuario_id: usuario._id, ip: req.ip }) : true
  await SecuritySession.findOneAndUpdate(
    { jti },
    {
      $set: {
        usuario_id: usuario._id, usuario_email: usuario.email, persistente: persistent, transport,
        ip: req.ip || null, user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
        dispositivo, ultimo_acesso_em: new Date(),
        expira_em: new Date(Number(decoded.exp || 0) * 1000), revogada_em: null,
      },
      $setOnInsert: { primeiro_acesso_em: new Date() },
    },
    { upsert: true, new: true },
  )
  if (!knownDevice) {
    await recordSecurityEvent({
      tipo:'novo_dispositivo', severidade:'media', mensagem:'Novo dispositivo detectado para esta conta.',
      ip:req.ip, usuario_id:usuario._id, usuario_email:usuario.email, request_id:req.requestId,
      dados:{dispositivo}, allow_auto_block:false,
      fingerprint:`new-device-${usuario._id}-${dispositivo}`,
    }).catch(() => {})
  }
  if (!knownIp) {
    await recordSecurityEvent({
      tipo:'novo_ip', severidade:'media', mensagem:'Acesso realizado a partir de um novo endereço IP para esta conta.',
      ip:req.ip, usuario_id:usuario._id, usuario_email:usuario.email, request_id:req.requestId,
      dados:{dispositivo}, allow_auto_block:false,
      fingerprint:`new-ip-${usuario._id}-${req.ip}`,
    }).catch(() => {})
  }
}

async function finishLogin(req, res, usuario, manterConectado = false) {
  usuario.tentativas_login = 0
  usuario.bloqueado_ate = null
  usuario.ultimo_acesso = new Date()
  await usuario.save()

  const crossOrigin = requestIsCrossOrigin(req)
  const persistent = manterConectado === true
  const cloudExpires = persistent ? (process.env.JWT_CLOUD_PERSIST_EXPIRES_IN || '7d') : (process.env.JWT_CLOUD_EXPIRES_IN || '12h')
  const jti = crypto.randomUUID()
  const csrf = crypto.randomBytes(24).toString('base64url')
  const token = gerarToken(usuario, process.env.JWT_EXPIRES_IN || '7d', { jti, csrf })
  const cloudToken = crossOrigin ? gerarToken(usuario, cloudExpires, { jti, csrf, transport: 'cloud', persistent }) : ''
  await createSession(req, usuario, { jti, token: crossOrigin ? cloudToken : token, persistent, transport: crossOrigin ? 'cloud-bearer' : 'cookie' }).catch(() => {})

  await recordSecurityEvent({
    tipo: 'login_sucesso', severidade: 'baixa', mensagem: 'Login realizado com sucesso.',
    ip: req.ip, rota: '/api/auth/login', metodo: 'POST', usuario_id: usuario._id,
    usuario_email: usuario.email, request_id: req.requestId, allow_auto_block: false,
    dados: { dispositivo: deviceLabel(req.headers['user-agent']), mfa: Boolean(usuario.two_factor_enabled) },
  }).catch(() => {})

  res.cookie('alsistemas_token', token, cookieOpts(req, persistent))
  return res.json({
    usuario, csrf_token: csrf,
    ...(crossOrigin ? { access_token: cloudToken } : {}),
    auth: {
      transport: crossOrigin ? 'cookie+bearer-fallback' : 'cookie', crossOrigin,
      cookie: { httpOnly: true, secure: cookieOpts(req).secure, sameSite: cookieOpts(req).sameSite },
      bearerFallback: crossOrigin, bearerExpiresIn: crossOrigin ? cloudExpires : null, persistent,
      session_id: jti,
    },
  })
}

router.post('/login', loginLimiter, regraLogin, validar, async (req, res, next) => {
  try {
    const { email, senha, manter_conectado = false } = req.body
    const usuario = await Usuario.findOne({ email })
      .select('+token_reset_senha +token_reset_expira +two_factor_recovery_hashes')
      .populate('perfil_id', 'nome cor permissoes')

    if (!usuario) {
      await recordSecurityEvent({ tipo: 'login_usuario_inexistente', severidade: 'media', mensagem: 'Tentativa de login para uma conta inexistente.', ip: req.ip, usuario_email:String(email||'').trim().toLowerCase().slice(0,160)||null, rota: '/api/auth/login', metodo: 'POST', request_id: req.requestId, dados: { emailTentado: String(email || '').slice(0, 160) } }).catch(() => {})
      await detectCredentialAttackPatterns({ip:req.ip,usuario_email:String(email||'').trim().toLowerCase(),request_id:req.requestId}).catch(()=>{})
      return res.status(401).json({ erro: 'Email ou senha incorretos' })
    }
    if (!usuario.ativo) {
      await recordSecurityEvent({ tipo: 'login_conta_desativada', severidade: 'alta', mensagem: 'Tentativa de login em conta desativada.', ip: req.ip, usuario_id: usuario._id, usuario_email: usuario.email, rota: '/api/auth/login', metodo: 'POST', request_id: req.requestId }).catch(() => {})
      return res.status(403).json({ erro: 'Conta desativada. Contacte um administrador.' })
    }
    if (usuario.bloqueado_ate && usuario.bloqueado_ate > new Date()) {
      const minutos = Math.ceil((usuario.bloqueado_ate - new Date()) / 60000)
      await recordSecurityEvent({ tipo: 'login_conta_bloqueada', severidade: 'alta', mensagem: 'Tentativa de login durante bloqueio temporário da conta.', ip: req.ip, usuario_id: usuario._id, usuario_email: usuario.email, rota: '/api/auth/login', metodo: 'POST', request_id: req.requestId }).catch(() => {})
      return res.status(403).json({ erro: `Conta temporariamente bloqueada. Tente novamente em ${minutos} minuto(s).` })
    }

    const senhaOk = await usuario.verificarSenha(senha)
    if (!senhaOk) {
      usuario.tentativas_login = (usuario.tentativas_login || 0) + 1
      const blocked = usuario.tentativas_login >= MAX_TENTATIVAS
      if (blocked) usuario.bloqueado_ate = new Date(Date.now() + BLOQUEIO_MINUTOS * 60000)
      await usuario.save()
      await recordSecurityEvent({
        tipo: blocked ? 'login_conta_bloqueada_por_falhas' : 'login_senha_incorreta', severidade: blocked ? 'alta' : 'media',
        mensagem: blocked ? `Conta bloqueada após ${usuario.tentativas_login} senhas incorretas.` : 'Senha incorreta informada no login.',
        ip: req.ip, usuario_id: usuario._id, usuario_email: usuario.email, rota: '/api/auth/login', metodo: 'POST', request_id: req.requestId,
        dados: { tentativas: usuario.tentativas_login },
      }).catch(() => {})
      await detectCredentialAttackPatterns({ip:req.ip,usuario_email:usuario.email,request_id:req.requestId}).catch(()=>{})
      if (blocked) return res.status(403).json({ erro: `Muitas tentativas incorretas. Conta bloqueada por ${BLOQUEIO_MINUTOS} minutos.` })
      return res.status(401).json({ erro: `Email ou senha incorretos. ${MAX_TENTATIVAS - usuario.tentativas_login} tentativa(s) restante(s) antes do bloqueio.` })
    }

    if (usuario.two_factor_enabled) {
      const challenge = gerarToken(usuario, '5m', { purpose: '2fa-login', persistent: manter_conectado === true })
      return res.status(202).json({ requires_2fa: true, challenge_id: challenge, mensagem: 'Informe o código de autenticação em dois fatores.' })
    }
    return finishLogin(req, res, usuario, manter_conectado)
  } catch (err) { next(err) }
})

router.post('/login/2fa', loginLimiter, async (req, res, next) => {
  try {
    const { challenge_id, codigo } = req.body || {}
    if (!challenge_id || !codigo) return res.status(400).json({ erro: 'Desafio e código 2FA são obrigatórios.' })
    let payload
    try { payload = jwt.verify(challenge_id, bootstrapValue('JWT_SECRET')) } catch { return res.status(401).json({ erro: 'Desafio 2FA inválido ou expirado.' }) }
    if (payload.purpose !== '2fa-login') return res.status(401).json({ erro: 'Desafio 2FA inválido.' })
    const usuario = await Usuario.findById(payload.id).select('+two_factor_recovery_hashes').populate('perfil_id', 'nome cor permissoes')
    if (!usuario?.ativo || !usuario.two_factor_enabled || Number(payload.sv || 0) !== Number(usuario.sessao_versao || 0)) return res.status(401).json({ erro: 'Conta ou desafio 2FA inválido.' })
    const cred = await getCredential(`security-totp-${usuario._id}`)
    let valid = Boolean(cred.value && verifyTotp(cred.value, codigo))
    let usedRecovery = false
    if (!valid) {
      const hash = hashRecoveryCode(codigo)
      const idx = (usuario.two_factor_recovery_hashes || []).indexOf(hash)
      if (idx >= 0) {
        usuario.two_factor_recovery_hashes.splice(idx, 1)
        await usuario.save()
        valid = true
        usedRecovery = true
      }
    }
    if (!valid) {
      await recordSecurityEvent({ tipo: 'mfa_codigo_incorreto', severidade: 'alta', mensagem: 'Código MFA incorreto durante o login.', ip: req.ip, usuario_id: usuario._id, usuario_email: usuario.email, rota: '/api/auth/login/2fa', metodo: 'POST', request_id: req.requestId }).catch(() => {})
      return res.status(401).json({ erro: 'Código 2FA inválido.' })
    }
    if (usedRecovery) await recordSecurityEvent({ tipo: 'mfa_codigo_recuperacao_usado', severidade: 'media', mensagem: 'Login realizado com um código de recuperação 2FA.', ip: req.ip, usuario_id: usuario._id, usuario_email: usuario.email, request_id: req.requestId, allow_auto_block: false }).catch(() => {})
    return finishLogin(req, res, usuario, Boolean(payload.persistent))
  } catch (err) { next(err) }
})

router.get('/cookie-probe', async (req, res) => {
  const token = req.cookies?.alsistemas_token
  if (!token) return res.json({ ok: false, transport: 'none' })
  try {
    const payload = jwt.verify(token, bootstrapValue('JWT_SECRET'))
    const usuario = await Usuario.findById(payload.id).select('_id sessao_versao ativo').lean()
    const sessionOk = payload.jti ? Boolean(await SecuritySession.exists({ jti: payload.jti, revogada_em: null, expira_em: { $gt: new Date() } })) : true
    const ok = Boolean(usuario?.ativo && sessionOk && Number(usuario.sessao_versao || 0) === Number(payload.sv || 0))
    return res.json({ ok, transport: ok ? 'cookie' : 'none' })
  } catch { return res.json({ ok: false, transport: 'none' }) }
})

const stepUpIfChangingPassword = (req, res, next) => req.body?.senha ? exigirStepUpSePolitica(req, res, next) : next()

router.get('/me', autenticar, (req, res) => {
  res.json({ usuario: req.usuario, csrf_token: req.authPayload?.csrf || null, auth: { transport: req.authTransport || 'cookie', session_id: req.authPayload?.jti || null } })
})

router.put('/me', autenticar, stepUpIfChangingPassword, async (req, res, next) => {
  try {
    const { nome, senha } = req.body
    const usuario = await Usuario.findById(req.usuario._id)
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' })
    if (nome?.trim()) usuario.nome = nome.trim()
    if (senha) {
      if (!validarForcaSenha(senha)) return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres, incluindo letras, números e um símbolo.' })
      usuario.senha = senha
      usuario.sessao_versao = (usuario.sessao_versao || 0) + 1
      await SecuritySession.updateMany({ usuario_id: usuario._id, revogada_em: null }, { revogada_em: new Date(), motivo_revogacao: 'senha_alterada' })
      await recordSecurityEvent({ tipo: 'senha_alterada', severidade: 'media', mensagem: 'Senha da conta foi alterada e sessões anteriores foram revogadas.', ip: req.ip, usuario_id: usuario._id, usuario_email: usuario.email, request_id: req.requestId, allow_auto_block: false }).catch(() => {})
    }
    await usuario.save()
    res.json({ usuario, requer_novo_login: Boolean(senha) })
  } catch (err) { next(err) }
})

router.post('/logout', autenticarOpcional, async (req, res) => {
  if (req.authPayload?.jti) await SecuritySession.updateOne({ jti: req.authPayload.jti }, { revogada_em: new Date(), motivo_revogacao: 'logout' }).catch(() => {})
  res.clearCookie('alsistemas_token', { ...cookieOpts(req, false), maxAge: undefined })
  res.json({ mensagem: 'Logout realizado' })
})

router.get('/2fa/status', autenticar, async (req, res, next) => {
  try {
    const policy = await getSecurityPolicy()
    const isAdmin = ['admin', 'superadmin'].includes(req.usuario.role)
    const required = Boolean(policy.mfa_todos_obrigatorio || (policy.mfa_admin_obrigatorio && isAdmin))
    res.json({ enabled: Boolean(req.usuario.two_factor_enabled), confirmedAt: req.usuario.two_factor_confirmed_at || null, required })
  } catch (err) { next(err) }
})

router.post('/2fa/setup', autenticar, exigirStepUp, async (req, res, next) => {
  try {
    const secret = randomBase32()
    const uri = otpauthUri({ secret, email: req.usuario.email })
    await setCredential(`security-totp-pending-${req.usuario._id}`, secret, { purpose: 'totp-pending', userId: String(req.usuario._id) })
    let qr = null
    try { const qrcodeModule = await import('qrcode'); const qrcode = qrcodeModule.default || qrcodeModule; qr = await qrcode.toDataURL(uri, { width: 260, margin: 1 }) } catch { /* URI manual continua disponível */ }
    res.json({ secret, uri, qr })
  } catch (err) { next(err) }
})

router.post('/2fa/confirm', autenticar, exigirStepUp, async (req, res, next) => {
  try {
    const { codigo } = req.body || {}
    const pending = await getCredential(`security-totp-pending-${req.usuario._id}`)
    const pendingAge = pending.updatedAt ? Date.now() - new Date(pending.updatedAt).getTime() : Infinity
    if (!pending.value || pendingAge > 15 * 60 * 1000) {
      await deleteCredential(`security-totp-pending-${req.usuario._id}`).catch(()=>{})
      return res.status(410).json({ erro: 'A configuração 2FA expirou. Gere um novo QR Code.' })
    }
    if (!verifyTotp(pending.value, codigo)) return res.status(400).json({ erro: 'Código inválido. Verifique o autenticador e tente novamente.' })
    await setCredential(`security-totp-${req.usuario._id}`, pending.value, { purpose: 'totp', userId: String(req.usuario._id) })
    await deleteCredential(`security-totp-pending-${req.usuario._id}`)
    const codes = recoveryCodes()
    const usuario = await Usuario.findById(req.usuario._id).select('+two_factor_recovery_hashes')
    usuario.two_factor_enabled = true
    usuario.two_factor_confirmed_at = new Date()
    usuario.two_factor_recovery_hashes = codes.map(hashRecoveryCode)
    await usuario.save()
    await recordSecurityEvent({ tipo: 'mfa_ativado', severidade: 'baixa', mensagem: 'Autenticação em dois fatores ativada.', ip: req.ip, usuario_id: usuario._id, usuario_email: usuario.email, request_id: req.requestId, allow_auto_block: false }).catch(() => {})
    res.json({ enabled: true, recovery_codes: codes })
  } catch (err) { next(err) }
})

router.post('/2fa/disable', autenticar, async (req, res, next) => {
  try {
    const { senha, codigo } = req.body || {}
    const usuario = await Usuario.findById(req.usuario._id).select('+two_factor_recovery_hashes')
    const policy = await getSecurityPolicy()
    const mfaRequired = Boolean(policy.mfa_todos_obrigatorio || (policy.mfa_admin_obrigatorio && ['admin', 'superadmin'].includes(usuario?.role)))
    if (mfaRequired) return res.status(409).json({ erro: 'A política de segurança exige 2FA para esta conta. Desative a exigência antes de remover o autenticador.', codigo: 'MFA_REQUIRED_BY_POLICY' })
    if (!(await usuario.verificarSenha(senha || ''))) return res.status(401).json({ erro: 'Senha atual incorreta.' })
    if (usuario.two_factor_enabled) {
      const cred = await getCredential(`security-totp-${usuario._id}`)
      if (!cred.value || !verifyTotp(cred.value, codigo)) return res.status(401).json({ erro: 'Código 2FA inválido.' })
    }
    usuario.two_factor_enabled = false
    usuario.two_factor_confirmed_at = null
    usuario.two_factor_recovery_hashes = []
    usuario.sessao_versao = (usuario.sessao_versao || 0) + 1
    await usuario.save()
    await deleteCredential(`security-totp-${usuario._id}`)
    await SecuritySession.updateMany({ usuario_id: usuario._id, revogada_em: null }, { revogada_em: new Date(), motivo_revogacao: 'mfa_desativado' })
    await recordSecurityEvent({ tipo: 'mfa_desativado', severidade: 'alta', mensagem: 'Autenticação em dois fatores desativada.', ip: req.ip, usuario_id: usuario._id, usuario_email: usuario.email, request_id: req.requestId, allow_auto_block: false }).catch(() => {})
    res.json({ enabled: false, requer_novo_login: true })
  } catch (err) { next(err) }
})

router.post('/step-up', autenticar, async (req, res, next) => {
  try {
    const { senha, codigo } = req.body || {}
    const usuario = await Usuario.findById(req.usuario._id)
    if (!usuario || !(await usuario.verificarSenha(senha || ''))) return res.status(401).json({ erro: 'Senha atual incorreta.' })
    if (usuario.two_factor_enabled) {
      const cred = await getCredential(`security-totp-${usuario._id}`)
      if (!cred.value || !verifyTotp(cred.value, codigo)) return res.status(401).json({ erro: 'Código 2FA inválido.' })
    }
    const token = gerarToken(usuario, '10m', { purpose: 'step-up', jti: req.authPayload?.jti || null })
    res.json({ step_up_token: token, expires_in_seconds: 600 })
  } catch (err) { next(err) }
})

router.post('/esqueci-senha', async (req, res, next) => {
  try {
    const { email } = req.body
    if (!email?.trim()) return res.status(400).json({ erro: 'Email obrigatório.' })
    const generic = { mensagem: 'Se o email estiver cadastrado, você receberá as instruções em breve.' }
    const usuario = await Usuario.findOne({ email: email.trim().toLowerCase() }).select('+token_reset_senha +token_reset_expira')
    if (!usuario || !usuario.ativo) return res.json(generic)
    const token = crypto.randomBytes(32).toString('hex')
    usuario.token_reset_senha = crypto.createHash('sha256').update(token).digest('hex')
    usuario.token_reset_expira = new Date(Date.now() + 3600000)
    await usuario.save()
    await recordSecurityEvent({ tipo: 'reset_senha_solicitado', severidade: 'baixa', mensagem: 'Redefinição de senha solicitada.', ip: req.ip, usuario_id: usuario._id, usuario_email: usuario.email, request_id: req.requestId, allow_auto_block: false }).catch(() => {})
    if (process.env.NODE_ENV !== 'production') logger.info({ email: usuario.email }, 'Reset de senha gerado em desenvolvimento (token omitido do log)')
    else logger.warn({ email: usuario.email }, 'Reset de senha solicitado — integre com serviço de e-mail')
    res.json(generic)
  } catch (err) { next(err) }
})

router.post('/redefinir-senha', async (req, res, next) => {
  try {
    const { token, senha } = req.body
    if (!token || !senha) return res.status(400).json({ erro: 'Token e nova senha são obrigatórios.' })
    if (!validarForcaSenha(senha)) return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres, incluindo letras, números e um símbolo.' })
    const usuario = await Usuario.findOne({ token_reset_senha: crypto.createHash('sha256').update(token).digest('hex'), token_reset_expira: { $gt: new Date() }, ativo: true }).select('+token_reset_senha +token_reset_expira')
    if (!usuario) return res.status(400).json({ erro: 'Token inválido ou expirado. Solicite um novo link.' })
    usuario.senha = senha
    usuario.token_reset_senha = null
    usuario.token_reset_expira = null
    usuario.tentativas_login = 0
    usuario.bloqueado_ate = null
    usuario.sessao_versao = (usuario.sessao_versao || 0) + 1
    await usuario.save()
    await SecuritySession.updateMany({ usuario_id: usuario._id, revogada_em: null }, { revogada_em: new Date(), motivo_revogacao: 'reset_senha' }).catch(() => {})
    await recordSecurityEvent({ tipo: 'senha_redefinida', severidade: 'media', mensagem: 'Senha redefinida por token de recuperação; sessões anteriores foram revogadas.', ip: req.ip, usuario_id: usuario._id, usuario_email: usuario.email, request_id: req.requestId, allow_auto_block: false }).catch(() => {})
    res.json({ mensagem: 'Senha redefinida com sucesso. Faça login com a nova senha.' })
  } catch (err) { next(err) }
})

export default router
