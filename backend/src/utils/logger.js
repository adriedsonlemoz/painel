/**
 * #7 — Logging estruturado com pino.
 * Nível controlado pela variável LOG_LEVEL (padrão: info).
 *
 * O stdout é usado diretamente, sem transport/worker thread.
 * Isso evita falhas do thread-stream em ambientes Termux/Node recentes.
 */
import pino from 'pino'

const destination = pino.destination({
  dest: 1, // stdout
  sync: true,
})

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'alsistemas-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
}, destination)

export default logger
