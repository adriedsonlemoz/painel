import crypto from 'node:crypto'
import mongoose from 'mongoose'
import SecurityEvent from '../models/SecurityEvent.js'
import SecurityPolicy from '../models/SecurityPolicy.js'
import { getCredential } from '../utils/credentialStore.js'
import { getRedis, isRedisDisponivel } from '../utils/redis.js'
import { logger } from '../utils/logger.js'

const severityRank = { baixa: 1, media: 2, alta: 3, critica: 4 }
const localBlocks = new Map()
const localCooldown = new Map()

function assertSafeWebhookUrl(value) {
  let url
  try { url = new URL(String(value || '')) } catch { throw new Error('Webhook inválido.') }
  if (url.protocol !== 'https:') throw new Error('Webhook deve usar HTTPS.')
  const host = url.hostname.toLowerCase()
  const privateHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '[::1]' ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^0\./.test(host)
  if (privateHost) throw new Error('Webhook não pode apontar para endereço local ou privado.')
  return url.toString()
}

export async function getSecurityPolicy() {
  return SecurityPolicy.findOneAndUpdate(
    { chave: 'default' },
    { $setOnInsert: { chave: 'default' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
}

function retentionDate(days = 180) {
  return new Date(Date.now() + Math.max(30, Number(days) || 180) * 86400000)
}

function fingerprintFor(event = {}) {
  if (event.fingerprint) return String(event.fingerprint).slice(0, 180)
  const raw = [event.tipo, event.ip || '-', event.usuario_id || event.usuario_email || '-', event.rota || '-'].join('|')
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

function cleanRoute(route = '') {
  return String(route || '').split('?')[0].slice(0, 300)
}

function cleanData(data) {
  if (!data || typeof data !== 'object') return data || null
  const secret = /senha|password|token|secret|api[_-]?key|authorization|cookie|credential|mongo[_-]?uri/i
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    if (secret.test(k)) out[k] = '[REDACTED]'
    else if (typeof v === 'string') out[k] = v.slice(0, 500)
    else out[k] = v
  }
  return out
}

async function cooldownOk(key, minutes) {
  const ttl = Math.max(60, Number(minutes || 15) * 60)
  if (isRedisDisponivel() && getRedis()) {
    const result = await getRedis().set(`sec:alert:${key}`, '1', 'EX', ttl, 'NX').catch(() => null)
    return result === 'OK'
  }
  const now = Date.now()
  const until = localCooldown.get(key) || 0
  if (until > now) return false
  localCooldown.set(key, now + ttl * 1000)
  return true
}

async function sendWebhook(payload) {
  const cred = await getCredential('security-alert-webhook')
  if (!cred.value) return { ok: false, reason: 'nao_configurado' }
  const target = assertSafeWebhookUrl(cred.value)
  const response = await fetch(target, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Webhook retornou HTTP ${response.status}`)
  return { ok: true }
}

async function sendTelegram(payload) {
  const cred = await getCredential('security-alert-telegram')
  if (!cred.value) return { ok: false, reason: 'nao_configurado' }
  const cfg = JSON.parse(cred.value)
  if (!cfg.botToken || !cfg.chatId) return { ok: false, reason: 'incompleto' }
  const text = `🔐 AL Sistemas — ${payload.severidade.toUpperCase()}\n${payload.mensagem}\n${payload.ip ? `IP: ${payload.ip}\n` : ''}${payload.usuario ? `Conta: ${payload.usuario}\n` : ''}${payload.rota ? `Rota: ${payload.rota}` : ''}`.slice(0, 3900)
  const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chatId, text }), signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Telegram retornou HTTP ${response.status}`)
  return { ok: true }
}

async function sendEmail(payload, destination) {
  const cred = await getCredential('security-alert-email')
  if (!cred.value || !destination) return { ok: false, reason: 'nao_configurado' }
  const cfg = JSON.parse(cred.value)
  const nodemailer = await import('nodemailer')
  const transporter = nodemailer.default.createTransport({
    host: cfg.host, port: Number(cfg.port || 587), secure: Boolean(cfg.secure),
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
  })
  await transporter.sendMail({
    from: cfg.from || cfg.user,
    to: destination,
    subject: `[AL Sistemas] Segurança ${payload.severidade}: ${payload.tipo}`,
    text: `${payload.mensagem}\n\nIP: ${payload.ip || '—'}\nUsuário: ${payload.usuario || '—'}\nRota: ${payload.rota || '—'}\nHorário: ${new Date().toISOString()}`,
  })
  return { ok: true }
}

export async function dispatchSecurityAlert(event, policy = null) {
  policy ||= await getSecurityPolicy()
  const cfg = policy.alertas || {}
  if (!['alertar', 'proteger'].includes(policy.resposta_automatica)) return []
  if ((severityRank[event.severidade] || 0) < (severityRank[cfg.severidade_minima] || 3)) return []
  const key = `${event.fingerprint || event.tipo}:${event.severidade}`
  if (!(await cooldownOk(key, cfg.cooldown_minutos))) return []
  const payload = {
    tipo: event.tipo, severidade: event.severidade, mensagem: event.mensagem,
    ip: event.ip || null, usuario: event.usuario_email || null, rota: event.rota || null,
    request_id: event.request_id || null,
  }
  const attempts = []
  if (cfg.webhook_ativo) attempts.push(['webhook', () => sendWebhook(payload)])
  if (cfg.telegram_ativo) attempts.push(['telegram', () => sendTelegram(payload)])
  if (cfg.email_ativo) attempts.push(['email', () => sendEmail(payload, cfg.email_destino)])
  const result = []
  for (const [channel, fn] of attempts) {
    try { result.push({ channel, ...(await fn()) }) }
    catch (error) {
      logger.warn({ channel, err: error.message }, 'Falha ao enviar alerta de segurança')
      result.push({ channel, ok: false, reason: error.message })
    }
  }
  return result
}

export async function blockIp(ip, minutes = 30, reason = 'proteção automática') {
  if (!ip) return false
  const ttl = Math.max(300, Number(minutes || 30) * 60)
  if (isRedisDisponivel() && getRedis()) {
    await getRedis().set(`sec:block:${ip}`, reason, 'EX', ttl).catch(() => {})
  } else localBlocks.set(ip, { until: Date.now() + ttl * 1000, reason })
  return true
}

export async function unblockIp(ip) {
  if (!ip) return false
  if (isRedisDisponivel() && getRedis()) await getRedis().del(`sec:block:${ip}`).catch(() => {})
  localBlocks.delete(ip)
  return true
}

export async function blockedIp(ip) {
  if (!ip) return null
  if (isRedisDisponivel() && getRedis()) {
    const reason = await getRedis().get(`sec:block:${ip}`).catch(() => null)
    if (!reason) return null
    const ttl = await getRedis().ttl(`sec:block:${ip}`).catch(() => -1)
    return { reason, ttl }
  }
  const item = localBlocks.get(ip)
  if (!item) return null
  if (item.until <= Date.now()) { localBlocks.delete(ip); return null }
  return { reason: item.reason, ttl: Math.ceil((item.until - Date.now()) / 1000) }
}

export async function detectCredentialAttackPatterns({ ip=null, usuario_email=null, request_id=null } = {}) {
  if (mongoose.connection.readyState !== 1) return []
  const since = new Date(Date.now() - 10 * 60 * 1000)
  const base = { tipo:{ $in:['login_senha_incorreta','login_usuario_inexistente'] }, ultima_ocorrencia_em:{ $gte:since } }
  const alerts=[]
  if (ip) {
    const accounts = await SecurityEvent.distinct('usuario_email', { ...base, ip, usuario_email:{ $nin:[null,''] } }).catch(()=>[])
    if (accounts.length >= 3) alerts.push(await recordSecurityEvent({
      tipo:'credential_stuffing_ip', severidade:'alta', mensagem:`Um mesmo IP tentou autenticar em ${accounts.length} contas diferentes em até 10 minutos.`,
      ip, request_id, dados:{contas_distintas:accounts.length}, allow_auto_block:true, fingerprint:`credential-stuffing:${ip}`,
    }))
  }
  if (usuario_email) {
    const ips = await SecurityEvent.distinct('ip', { ...base, usuario_email, ip:{ $nin:[null,''] } }).catch(()=>[])
    if (ips.length >= 3) alerts.push(await recordSecurityEvent({
      tipo:'ataque_distribuido_conta', severidade:'alta', mensagem:`A mesma conta recebeu tentativas de login a partir de ${ips.length} IPs em até 10 minutos.`,
      usuario_email, request_id, dados:{ips_distintos:ips.length}, allow_auto_block:false, fingerprint:`distributed-login:${usuario_email}`,
    }))
  }
  return alerts.filter(Boolean)
}

export async function detectSensitiveActionBurst({ tipo, usuario_id=null, usuario_email=null, ip=null, threshold=5, windowMinutes=10, alertType='acao_sensivel_em_massa', message='Volume incomum de ações sensíveis detectado.' } = {}) {
  if (!tipo || mongoose.connection.readyState !== 1) return null
  const since = new Date(Date.now() - Math.max(1, Number(windowMinutes)||10) * 60 * 1000)
  const match = { tipo, ultima_ocorrencia_em:{ $gte:since } }
  if (usuario_id) match.usuario_id = new mongoose.Types.ObjectId(String(usuario_id))
  else if (usuario_email) match.usuario_email = usuario_email
  else if (ip) match.ip = ip
  const rows = await SecurityEvent.aggregate([
    { $match: match },
    { $group: { _id:null, total:{ $sum:'$ocorrencias' } } },
  ]).catch(()=>[])
  const total=Number(rows?.[0]?.total||0)
  if(total < threshold) return null
  return recordSecurityEvent({
    tipo:alertType, severidade:'alta', mensagem:message, ip, usuario_id, usuario_email,
    dados:{acao:tipo,total,janela_minutos:windowMinutes,limite:threshold}, allow_auto_block:false,
    fingerprint:`${alertType}:${usuario_id||usuario_email||ip||'global'}`,
  })
}

export async function recordSecurityEvent(input = {}) {
  if (mongoose.connection.readyState !== 1) return null
  const policy = await getSecurityPolicy().catch(() => null)
  const now = new Date()
  const fp = fingerprintFor(input)
  const windowSince = new Date(Date.now() - 15 * 60 * 1000)
  const route = cleanRoute(input.rota)
  const update = {
    $set: {
      severidade: input.severidade || 'media', mensagem: String(input.mensagem || input.tipo || 'Evento de segurança').slice(0, 1000),
      ip: input.ip || null, rota: route || null, metodo: input.metodo || null, status_http: input.status_http ?? input.status ?? null,
      usuario_id: input.usuario_id || null, usuario_email: input.usuario_email || null,
      request_id: input.request_id || null, dados: cleanData(input.dados), ultima_ocorrencia_em: now,
      expira_em: retentionDate(policy?.retencao_eventos_dias || 180),
    },
    $setOnInsert: { tipo: input.tipo || 'evento', fingerprint: fp, ocorrencias: 0, primeira_ocorrencia_em: now, estado: 'novo', resolvido: false },
    $inc: { ocorrencias: 1 },
  }
  if (input.request_id) update.$addToSet = { ...(update.$addToSet || {}), request_ids: String(input.request_id).slice(0, 120) }
  if (route) update.$addToSet = { ...(update.$addToSet || {}), rotas: route }

  let event = await SecurityEvent.findOneAndUpdate(
    { fingerprint: fp, estado: { $in: ['novo', 'investigando'] }, ultima_ocorrencia_em: { $gte: windowSince } },
    update, { new: true },
  )
  if (!event) event = await SecurityEvent.create({
    tipo: input.tipo || 'evento', fingerprint: fp, severidade: input.severidade || 'media',
    mensagem: String(input.mensagem || input.tipo || 'Evento de segurança').slice(0, 1000),
    ip: input.ip || null, rota: route || null, metodo: input.metodo || null,
    status_http: input.status_http ?? input.status ?? null, usuario_id: input.usuario_id || null,
    usuario_email: input.usuario_email || null, request_id: input.request_id || null,
    request_ids: input.request_id ? [String(input.request_id).slice(0, 120)] : [], rotas: route ? [route] : [],
    dados: cleanData(input.dados), ocorrencias: 1, primeira_ocorrencia_em: now, ultima_ocorrencia_em: now,
    expira_em: retentionDate(policy?.retencao_eventos_dias || 180),
  })

  const alertResult = policy && input.skip_alert !== true ? await dispatchSecurityAlert(event, policy) : []
  if (policy?.resposta_automatica === 'proteger' && ['alta', 'critica'].includes(event.severidade) && input.ip && input.allow_auto_block === true) {
    await blockIp(input.ip, policy.bloqueio_ip_minutos, `Evento ${event.tipo}`)
    event.resposta_automatica = { bloqueio_ip: true, minutos: policy.bloqueio_ip_minutos, alertas: alertResult }
    await event.save().catch(() => {})
  } else if (alertResult.length) {
    event.resposta_automatica = { alertas: alertResult }
    await event.save().catch(() => {})
  }
  return event
}
