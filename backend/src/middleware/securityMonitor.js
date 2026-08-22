import { getRedis, isRedisDisponivel } from '../utils/redis.js'
import { blockedIp, recordSecurityEvent } from '../services/securityService.js'
import { logger } from '../utils/logger.js'

const localWindow = new Map()
const WINDOW_SEC = 10 * 60
const THRESHOLDS = { 401: 8, 403: 6, 404: 30, 429: 3 }
const suspiciousPath = /(\.env|wp-admin|wp-login|phpmyadmin|\.git\/|server-status|etc\/passwd|actuator|cgi-bin|vendor\/phpunit)/i

async function increment(key) {
  if (isRedisDisponivel() && getRedis()) {
    const redis = getRedis()
    const full = `sec:window:${key}`
    const count = await redis.incr(full)
    if (count === 1) await redis.expire(full, WINDOW_SEC)
    return count
  }
  const now = Date.now()
  let item = localWindow.get(key)
  if (!item || item.until <= now) item = { count: 0, until: now + WINDOW_SEC * 1000 }
  item.count += 1
  localWindow.set(key, item)
  if (localWindow.size > 1500) {
    for (const [k, v] of localWindow) if (v.until <= now) localWindow.delete(k)
  }
  return item.count
}

async function registerHttp(req, status, count) {
  const severity = status === 429 || status === 403 ? 'alta' : 'media'
  await recordSecurityEvent({
    tipo: `http_${status}_repetido`, severidade: severity,
    mensagem: `Padrão suspeito: ${count} respostas HTTP ${status} em até 10 minutos.`,
    ip: req.ip, rota: req.originalUrl, metodo: req.method, status_http: status,
    usuario_id: req.usuario?._id || null, usuario_email: req.usuario?.email || null,
    request_id: req.requestId || null,
    dados: { userAgent: String(req.headers['user-agent'] || '').slice(0, 300) },
    allow_auto_block: true,
  })
}

export function securityMonitor(req, res, next) {
  ;(async () => {
    const blocked = await blockedIp(req.ip)
    if (blocked) {
      res.setHeader('Retry-After', String(Math.max(1, blocked.ttl || 60)))
      return res.status(429).json({ erro: 'Acesso temporariamente bloqueado pela proteção automática.', codigo: 'SECURITY_IP_BLOCKED' })
    }

    if (suspiciousPath.test(req.originalUrl || '')) {
      void recordSecurityEvent({
        tipo: 'rota_sensivel_enumerada', severidade: 'alta',
        mensagem: 'Tentativa de acessar uma rota típica de enumeração ou arquivo sensível.',
        ip: req.ip, rota: req.originalUrl, metodo: req.method, request_id: req.requestId,
        dados: { userAgent: String(req.headers['user-agent'] || '').slice(0, 300) },
        allow_auto_block: true,
      }).catch(error => logger.warn({ err: error.message }, 'Falha ao registrar enumeração'))
    }

    res.on('finish', () => {
      const status = res.statusCode
      const limit = THRESHOLDS[status]
      if (!limit) return
      void increment(`${req.ip}|${status}`).then(count => {
        if (count === limit || (count > limit && count % limit === 0)) return registerHttp(req, status, count)
        return null
      }).catch(error => logger.warn({ err: error.message }, 'Falha no contador distribuído de segurança'))
    })
    return next()
  })().catch(next)
}
