/**
 * #8 — Endpoint /metrics para Prometheus.
 * Expõe métricas de processo (CPU, memória, event loop) e HTTP (duração, contagens).
 * Protegido por IP ou variável de ambiente METRICS_TOKEN em produção.
 */
import { Router } from 'express'
import { registry } from '../middleware/metricas.js'
import { bootstrapValue } from '../utils/localVault.js'

const router = Router()

router.get('/', async (req, res) => {
  // Segredo nunca é aceito em query string para não parar em histórico,
  // proxy/CDN logs ou ferramentas de observabilidade.
  const expectedToken = bootstrapValue('METRICS_TOKEN', 'METRICS_TOKEN')
  if (process.env.NODE_ENV === 'production' && expectedToken) {
    const authorization = String(req.headers.authorization || '')
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || ''
    const token = String(req.headers['x-metrics-token'] || bearer || '')
    if (token !== expectedToken) {
      return res.status(403).json({ erro: 'Não autorizado' })
    }
  }

  try {
    const metricas = await registry.metrics()
    res.set('Content-Type', registry.contentType)
    res.end(metricas)
  } catch (err) {
    res.status(500).json({ erro: err.message })
  }
})

export default router
