/**
 * AL Sistemas — Servidor principal (backend).
 * Node.js + Express + Mongoose
 *
 * Melhorias implementadas neste arquivo:
 * #1  — Cache Redis (inicializado em iniciarConexoes)
 * #4  — Brotli ativo via compression() — suportado nativamente no Node 18+
 * #7  — Logging estruturado com pino-http
 * #8  — Métricas Prometheus via metricasMiddleware
 * #9  — Health check detalhado (MongoDB + Redis + Cloudinary)
 * #10 — X-Request-Id propagado em cada requisição
 * #13 — Swagger UI em /api/docs
 * #14 — Validação de env via Zod (importado antes de tudo)
 * #15 — Preparado para Docker (PORT via env, graceful shutdown)
 * #RSS — Importação de notícias via RSS com scheduler automático
 */
import './config/env.js'         // #14 — valida env antes de qualquer outra coisa (já carrega dotenv internamente)
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import mongoose from 'mongoose'
import pinoHttp from 'pino-http'
import swaggerUi from 'swagger-ui-express'
import fs from 'fs/promises'
import path from 'node:path'

import { iniciarConexoes, conectarMongo, configurarCloudinary, verificarCloudinary } from './config/index.js'
import { ensureBootstrapSecrets } from './utils/localVault.js'
import { iniciarRedis } from './utils/redis.js'
import { swaggerSpec }     from './config/swagger.js'
import { logger }          from './utils/logger.js'
import { requestIdMiddleware } from './middleware/requestId.js'
import { securityMonitor } from './middleware/securityMonitor.js'
import { metricasMiddleware }  from './middleware/metricas.js'
// FIX: scheduler unificado — usa rssJob.js (node-cron) em vez de rssScheduler.js
// Isso evita dois schedulers paralelos e garante que o painel admin reflita o estado real.
import { iniciarRssJob, pararRssJob } from './jobs/rssJob.js'
import Noticia from './models/Noticia.js'

// Não deixar consultas aguardarem ~10 s no buffer quando o Atlas ainda está conectando.
// A API responde 503 imediatamente e o frontend pode tentar novamente.
mongoose.set('bufferCommands', false)

// ─── Plugin global de toJSON ──────────────────────────────────
mongoose.plugin(schema => {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = ret._id?.toString()
      delete ret._id
      return ret
    },
  })
})

// ─── Importar rotas ───────────────────────────────────────────
import authRoutes       from './routes/auth.js'
import noticiasRoutes   from './routes/noticias.js'
import categoriasRoutes from './routes/categorias.js'
import fontesRoutes     from './routes/fontes.js'
import uploadRoutes     from './routes/upload.js'
import extrasRoutes     from './routes/extras.js'
import newsletterRoutes from './routes/newsletter.js'
import errosRoutes      from './routes/erros.js'
import healthRoutes     from './routes/health.js'
import metricsRoutes    from './routes/metrics.js'
import sitemapRoutes    from './routes/sitemap.js'
import rssRoutes        from './routes/rss.js'
import auditLogsRoutes  from './routes/auditLogs.js'
import setupRoutes      from './routes/setup.js'
import backupRoutes     from './routes/backup.js'
import usuariosRoutes   from './routes/usuarios.js'
import infraestruturaRoutes from './routes/infraestrutura.js'
import rssAdminRoutes   from './routes/rssAdmin.js'              // #RSS
import arquivosRoutes   from './routes/arquivos.js'             // Editor de arquivos de config
// ── Sprint 3: Novas integrações ────────────────────────────────
import projetosRoutes   from './routes/projetos.js'             // Projetos Locais
import githubRoutes     from './routes/github.js'               // GitHub Module (proxy seguro)
// ── Sprint 4: Inteligência + Análise ───────────────────────────
import analysisRoutes   from './routes/analysis.js'             // IA Assistant + Analysis Engine
import mongoAdminRoutes from './routes/mongoAdmin.js'            // MongoDB Admin Panel
import cloudflareRoutes  from './routes/cloudflare.js'
import securityRoutes    from './routes/security.js'
import integracoesRoutes from './routes/integracoes.js'
import updatesRoutes     from './routes/updates.js'
import { tratarErros }  from './middleware/erros.js'
import { STATE_DIR } from './services/systemUpdateService.js'
import { recoverInterruptedUpdates } from './update/recoveryManager.js'
import { registrarErro } from './services/errorLogService.js'
import { importarErrosAtualizadorSpool } from './services/updateErrorSpool.js'

ensureBootstrapSecrets()

const app  = express()
const PORT = process.env.PORT || 3001

app.get('/', (_req, res) => res.json({
  service: 'AL Sistemas API',
  status: 'online',
  version: '1.0.60',
  setup: 'Use /api/setup/status para verificar a instalação.',
}))

// ─── #10 — Request ID (antes de tudo para estar em todos os logs) ─
app.use(requestIdMiddleware)
app.use(securityMonitor)

// ─── #7 — Logging estruturado com pino-http ───────────────────
app.use(pinoHttp({
  logger,
  genReqId: (req) => req.requestId,
  customLogLevel: (_req, res) => res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  serializers: {
    req: (req) => ({ method: req.method, url: req.url, requestId: req.id }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}))

// ─── #8 — Métricas de performance ────────────────────────────
app.use(metricasMiddleware)

// ─── Segurança ────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))

// ─── #4 — Compressão Brotli + Gzip ───────────────────────────
app.use(compression({
  // Brotli é negociado pelo cliente via Accept-Encoding: br
  // O módulo `compression` suporta br nativamente no Node 18+
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false
    return compression.filter(req, res)
  },
  level: 6,
}))

// ─── CORS ────────────────────────────────────────────────────
// FRONTEND_URL aceita lista separada por vírgula para cobrir múltiplos domínios.
// Ex.: FRONTEND_URL=https://alsistemas.vercel.app
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  ...(process.env.FRONTEND_URL || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean),
])

app.use(cors({
  origin: (origin, callback) => {
    // Sem origin: Postman, curl ou testes — permitido
    if (!origin) return callback(null, true)
    if (allowedOrigins.has(origin)) return callback(null, true)
    // Opcional para Preview Deployments da Vercel. Mantém desativado por padrão
    // porque cookies administrativos não devem aceitar origens curingas sem intenção.
    if (process.env.ALLOW_VERCEL_PREVIEWS === 'true') {
      try {
        const host = new URL(origin).hostname
        if (host.endsWith('.vercel.app')) return callback(null, true)
      } catch {}
    }
    callback(new Error(`CORS: origem não permitida — ${origin}`))
  },
  credentials: true,
}))

// ─── Parsers ─────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(cookieParser())

// ─── Modo manutenção do atualizador ───────────────────────────
app.get('/api/maintenance/status', async (_req, res) => {
  const marker=path.join(STATE_DIR,'maintenance.json')
  try {
    const data=JSON.parse(await fs.readFile(marker,'utf8'))
    // Autolimpeza defensiva: um crash duro do worker não pode deixar o portal
    // preso eternamente em manutenção.
    const age=Date.now()-new Date(data.startedAt||0).getTime()
    if(age>45*60*1000){
      await fs.rm(marker,{force:true}).catch(()=>{})
      return res.json({active:false,staleCleared:true})
    }
    if(data.jobId){
      try{
        const job=JSON.parse(await fs.readFile(path.join(STATE_DIR,'jobs',`${data.jobId}.json`),'utf8'))
        if(['completed','restart-required','rolled-back','failed'].includes(job.status)){
          await fs.rm(marker,{force:true}).catch(()=>{})
          return res.json({active:false,lastJobStatus:job.status})
        }
      }catch{}
    }
    res.json({active:Boolean(data.active),...data})
  } catch {
    res.json({active:false})
  }
})

// ─── Disponibilidade do banco ─────────────────────────────────
// Evita o sintoma "backend não respondeu em 10 segundos": enquanto o Atlas
// conecta/reconecta, rotas que dependem do Mongo falham rápido com 503.
// Setup, health e atualizador continuam acessíveis em modo degradado.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next()
  const livres = [
    '/api/health', '/api/setup', '/api/docs', '/api/admin/updates', '/api/maintenance/status',
  ]
  if (livres.some(prefix => req.path.startsWith(prefix))) return next()
  if (mongoose.connection.readyState === 1) return next()
  return res.status(503).json({
    erro: 'Banco de dados ainda está conectando. Tente novamente em instantes.',
    codigo: 'DB_NOT_READY',
    mongo_state: mongoose.connection.readyState,
    retry_after_ms: 1000,
  })
})

// Liveness extremamente barato: confirma que o processo HTTP está vivo sem
// consultar MongoDB, Cloudinary, GitHub ou qualquer serviço externo.
app.get('/api/health/live', (_req, res) => res.json({
  ok: true,
  processo: 'online',
  mongodb: mongoose.connection.readyState,
  uptime_s: Math.round(process.uptime()),
}))

// ─── #16 / #17 — Sitemap e RSS (sem prefixo /api) ────────────
app.use('/sitemap.xml', sitemapRoutes)
app.use('/rss',         rssRoutes)

// ─── Rotas da API ─────────────────────────────────────────────
app.use('/api/auth',            authRoutes)
app.use('/api/noticias',        noticiasRoutes)
app.use('/api/categorias',      categoriasRoutes)
app.use('/api/fontes',          fontesRoutes)
app.use('/api/upload',          uploadRoutes)
app.use('/api/newsletter',      newsletterRoutes)
app.use('/api',                 extrasRoutes)
app.use('/api/erros',           errosRoutes)
app.use('/api/audit-logs',      auditLogsRoutes)
app.use('/api/setup',          setupRoutes)
app.use('/api/admin/backup',   backupRoutes)
app.use('/api/admin/usuarios', usuariosRoutes)
app.use('/api/admin/infraestrutura', infraestruturaRoutes)
app.use('/api/admin/rss',      rssAdminRoutes)               // #RSS
app.use('/api/admin/arquivos', arquivosRoutes)               // Editor de arquivos de config
// ── Sprint 3: Novas rotas — nada existente alterado ───────────
app.use('/api/projetos', projetosRoutes)                     // Projetos Locais
app.use('/api/github',   githubRoutes)                       // GitHub Module (proxy seguro)
// ── Sprint 4: Inteligência + Análise ───────────────────────────
app.use('/api/analysis', analysisRoutes)                     // IA Assistant + Analysis Engine
app.use('/api/admin/mongo', mongoAdminRoutes)                 // MongoDB Admin Panel
app.use('/api/admin/cloudflare', cloudflareRoutes)
app.use('/api/admin/security',   securityRoutes)
app.use('/api/admin/integracoes', integracoesRoutes)
app.use('/api/admin/updates',     updatesRoutes)

// ─── #9 — Health check detalhado ─────────────────────────────
app.use('/api/health', healthRoutes)

// ─── #8 — Métricas Prometheus ────────────────────────────────
app.use('/metrics', metricsRoutes)

// ─── #13 — Swagger UI ────────────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'AL Sistemas API Docs',
  swaggerOptions: { persistAuthorization: true },
}))
// Endpoint que retorna o spec em JSON (útil para geração de clientes)
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec))

// ─── Erro centralizado ────────────────────────────────────────
app.use(tratarErros)

// ─── Inicialização ────────────────────────────────────────────
async function iniciar() {
  // O HTTP deve ficar disponível imediatamente. Conexões externas não podem
  // impedir a abertura do painel/setup.
  const server = app.listen(PORT, () =>
    logger.info({ port: PORT }, `🚀 Backend rodando em http://localhost:${PORT}`)
  )

  // Supervisor de recuperação: se o aparelho/VPS cair durante uma atualização,
  // o próximo boot detecta jobs abandonados. Workers ainda vivos mantêm heartbeat
  // e não são tocados.
  const recuperarAtualizacoes=async()=>{
    try{
      const actions=await recoverInterruptedUpdates()
      if(actions.length)logger.warn({actions},'Recuperação automática de atualização acionada')
    }catch(err){logger.warn({err:err.message},'Falha ao verificar atualizações interrompidas')}
  }
  const recoveryTimer=setInterval(()=>void recuperarAtualizacoes(),30000)
  recoveryTimer.unref?.()
  setTimeout(()=>void recuperarAtualizacoes(),2500).unref?.()

  let encerrando = false
  let mongoRetryTimer = null
  let rssIniciado = false
  let noticiasTimer = null

  const promoverNoticiasAgendadas = async () => {
    if (mongoose.connection.readyState !== 1) return
    const agora = new Date()
    try {
      const resultado = await Noticia.updateMany(
        { status: 'agendado', agendado_para: { $lte: agora } },
        { $set: { status: 'publicado', publicado_em: agora }, $unset: { agendado_para: 1 } },
      )
      if (resultado.modifiedCount) logger.info({ total: resultado.modifiedCount }, 'Notícias agendadas publicadas')
    } catch (err) {
      logger.warn({ err: err.message }, 'Falha ao promover notícias agendadas')
    }
  }

  const garantirMongo = async (tentativa = 0) => {
    if (encerrando || mongoose.connection.readyState === 1) return
    try {
      await conectarMongo()
      await importarErrosAtualizadorSpool({limit:200}).catch(err => logger.warn({err:err.message}, 'Falha ao importar erros de workers'))
      if (!rssIniciado) {
        iniciarRssJob(process.env.RSS_CRON || '0 * * * *')
        rssIniciado = true
      }
      if (!noticiasTimer) {
        void promoverNoticiasAgendadas()
        noticiasTimer = setInterval(() => void promoverNoticiasAgendadas(), 30000)
        noticiasTimer.unref?.()
      }
    } catch (mongoErr) {
      if (String(mongoErr.message || '').includes('MongoDB não configurado')) {
        logger.info('MongoDB ainda não configurado — aguardando configuração pelo setup')
        return
      }
      const espera = Math.min(30000, 3000 + tentativa * 3000)
      logger.warn({ err: mongoErr.message, retry_ms: espera }, 'MongoDB indisponível — nova tentativa agendada')
      if (!encerrando) mongoRetryTimer = setTimeout(() => garantirMongo(tentativa + 1), espera)
    }
  }

  // O HTTP sobe primeiro; Mongo reconecta sozinho caso Atlas/rede ainda não estejam prontos.
  void garantirMongo()
  mongoose.connection.on('disconnected', () => {
    if (encerrando || mongoRetryTimer) return
    mongoRetryTimer = setTimeout(() => {
      mongoRetryTimer = null
      void garantirMongo()
    }, 3000)
  })
  mongoose.connection.on('connected', () => {
    if (mongoRetryTimer) { clearTimeout(mongoRetryTimer); mongoRetryTimer = null }
  })

  // Serviços opcionais não atrasam nem condicionam o portal público.
  void configurarCloudinary().catch(err => logger.warn({ err: err.message }, 'Cloudinary indisponível na inicialização'))
  void iniciarRedis(process.env.REDIS_URL).catch(err => logger.warn({ err: err.message }, 'Redis indisponível na inicialização'))

  const desligar = async (sinal) => {
    encerrando = true
    if (mongoRetryTimer) clearTimeout(mongoRetryTimer)
    if (noticiasTimer) clearInterval(noticiasTimer)
    clearInterval(recoveryTimer)
    logger.info({ sinal }, 'Desligando servidor...')
    pararRssJob()
    server.close(async () => {
      try { await mongoose.connection.close() } catch {}
      logger.info('Backend encerrado.')
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10000)
  }

  process.on('unhandledRejection', (reason) => {
    const err=reason instanceof Error?reason:new Error(String(reason))
    logger.error({err:err.message,stack:err.stack}, 'Promise não tratada no backend')
    void registrarErro({tipo:'worker',mensagem:err.message,stack:err.stack,rota:'backend-process',dados:{source:'unhandledRejection'}}).catch(()=>{})
  })
  process.on('uncaughtExceptionMonitor', (err, origin) => {
    logger.error({err:err.message,stack:err.stack,origin}, 'Exceção não capturada no backend')
    void registrarErro({tipo:'worker',mensagem:err.message,stack:err.stack,rota:'backend-process',dados:{source:'uncaughtExceptionMonitor',origin}}).catch(()=>{})
  })
  process.on('SIGTERM', () => desligar('SIGTERM'))
  process.on('SIGINT',  () => desligar('SIGINT'))
}

// Exporta app ANTES de iniciar o servidor.
// Quando os testes importam este módulo, eles recebem o Express app
// sem disparar o app.listen() — evita EADDRINUSE com múltiplos workers Jest.
export default app

// Só inicia o servidor se NÃO estiver em ambiente de teste.
// Em teste, cada arquivo de teste conecta ao MongoDB manualmente no beforeAll().
if (process.env.NODE_ENV !== 'test') {
  iniciar()
}
