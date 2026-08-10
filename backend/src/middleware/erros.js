/**
 * Middleware centralizado de tratamento de erros.
 * #7 — Usa logger estruturado em vez de console.error.
 */
import { logger } from '../utils/logger.js'
import { registrarErro } from '../services/errorLogService.js'

export function tratarErros(err, req, res, _next) {
  const status = err.status || err.statusCode || 500
  const mensagem = err.message || 'Erro interno do servidor'

  // Loga detalhes completos no servidor
  logger.error({
    err: mensagem,
    stack:     status >= 500 ? err.stack : undefined,
    requestId: req.requestId,
    method:    req.method,
    url:       req.originalUrl,
    status,
  })

  // Captura falhas reais do backend no mesmo monitor administrativo.
  // É fire-and-forget para nunca atrasar nem causar recursão na resposta HTTP.
  if (status >= 500) {
    void registrarErro({
      tipo: 'backend',
      mensagem,
      stack: err.stack,
      rota: req.originalUrl,
      dados: {
        requestId: req.requestId,
        method: req.method,
        status,
        source: 'express-error-middleware',
      },
    }).catch(logErr => logger.warn({ err: logErr.message }, 'Falha ao registrar erro backend no monitor'))
  }

  // Resposta ao cliente — sem expor stack em produção
  res.status(status).json({
    erro: mensagem,
    ...(process.env.NODE_ENV !== 'production' && status >= 500
      ? { detalhe: err.stack }
      : {}),
  })
}
