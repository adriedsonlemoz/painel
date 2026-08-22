/**
 * Infraestrutura — AL Sistemas
 *
 * Módulo para gerenciar MongoDB e Cloudinary diretamente pelo painel admin.
 *
 * Rotas:
 *   ── Conexões ──────────────────────────────────────────────────
 *   POST /testar-conexoes       → testa MongoDB + Cloudinary com as credenciais atuais
 *
 *   ── MongoDB ───────────────────────────────────────────────────
 *   GET  /mongodb/status        → info da conexão (DB, versão, uptime)
 *   GET  /mongodb/colecoes      → lista coleções com contagens e tamanho estimado
 *   GET  /mongodb/colecoes/:nome          → documentos paginados de uma coleção
 *   DELETE /mongodb/colecoes/:nome/doc/:id → apaga um documento pelo _id
 *
 *   ── Cloudinary ────────────────────────────────────────────────
 *   GET  /cloudinary/status     → uso de conta (storage, bandwidth, créditos)
 *   GET  /cloudinary/recursos   → lista recursos (imagens/vídeos) com paginação
 *   DELETE /cloudinary/recursos → apaga um recurso pelo public_id
 */
import { Router }   from 'express'
import fsSync from 'node:fs'
import mongoose      from 'mongoose'
import PlataformaCredencial from '../models/PlataformaCredencial.js'
import ErroLog from '../models/ErroLog.js'
import ConfiguracaoHome from '../models/ConfiguracaoHome.js'
import { registerPlatformOrigin, isPlatformOriginAllowed, hydratePlatformOrigins, platformOrigins } from '../utils/platformOrigins.js'
import { ensurePersistentBootstrap } from '../utils/hostedBootstrap.js'
import { getCredential, setCredential, deleteCredential } from '../utils/credentialStore.js'
import { getCloudflareConfig } from '../utils/cloudflareConfig.js'
import { v2 as cloudinary } from 'cloudinary'
import { configurarCloudinary as configurarCloudinaryCentral } from '../config/index.js'
import { autenticar, exigirStepUpSePolitica } from '../middleware/auth.js'
import { runtimeLabel, IS_RENDER, IS_VERCEL, IS_TERMUX, IS_MANAGED_PLATFORM } from '../utils/runtimeEnvironment.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'

let BACKEND_VERSION='desconhecida'
try { BACKEND_VERSION=JSON.parse(fsSync.readFileSync(new URL('../../package.json', import.meta.url),'utf8')).version||BACKEND_VERSION } catch {}

const router = Router()
router.use(autenticar)

// Métricas, compatibilidade de ambiente e manutenção de cache pertencem ao
// módulo Sistema. O restante desta rota continua protegido pela permissão de
// Configurações, pois inclui credenciais e operações de infraestrutura.
const permitirConfiguracoes = verificarPermissao('configuracoes.gerenciar')
const permitirSistema = verificarPermissao('sistema.gerenciar')
router.use((req, res, next) => {
  const sistemaPath =
    (req.method === 'GET' && (req.path === '/sistema/metricas' || req.path === '/plataformas/compatibilidade')) ||
    (req.method === 'POST' && req.path === '/sistema/limpar-cache')
  if (!sistemaPath) return permitirConfiguracoes(req, res, next)

  const u = req.usuario
  const perms = u?.perfil_id?.permissoes || []
  if (u?.role === 'superadmin' || perms.includes('*') || perms.includes('configuracoes.gerenciar')) return next()
  return permitirSistema(req, res, next)
})

// ─── helper: converte bytes para formato legível ───────────────
function fmtBytes(b) {
  if (!b || b === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return `${(b / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

// ═══════════════════════════════════════════════════════════════
//  POST /testar-conexoes
// ═══════════════════════════════════════════════════════════════
router.post('/testar-conexoes', async (_req, res, next) => {
  try {
    const resultados = { mongodb: {}, cloudinary: {} }

    // ── MongoDB ──
    const estadoMongo = mongoose.connection.readyState
    // 0=desconectado, 1=conectado, 2=conectando, 3=desconectando
    const estadoLabels = { 0: 'desconectado', 1: 'conectado', 2: 'conectando', 3: 'desconectando' }
    resultados.mongodb = {
      ok:    estadoMongo === 1,
      estado: estadoLabels[estadoMongo] || 'desconhecido',
      db:    mongoose.connection.name || '—',
      host:  mongoose.connection.host || '—',
    }

    // ── Cloudinary ──
    const temCredenciais = await configurarCloudinaryCentral()

    if (!temCredenciais) {
      resultados.cloudinary = { ok: false, erro: 'Credenciais não configuradas' }
    } else {
      try {
        const ping = await cloudinary.api.ping()
        resultados.cloudinary = { ok: ping.status === 'ok', status: ping.status }
      } catch (cErr) {
        resultados.cloudinary = { ok: false, erro: cErr.message }
      }
    }

    res.json(resultados)
  } catch (err) { next(err) }
})

// ═══════════════════════════════════════════════════════════════
//  MongoDB — status
// ═══════════════════════════════════════════════════════════════
router.get('/mongodb/status', async (_req, res, next) => {
  try {
    const conn  = mongoose.connection
    const admin = conn.db?.admin()
    let serverInfo = {}
    try {
      serverInfo = await admin?.serverInfo() || {}
    } catch { /* pode falhar em Atlas */ }

    let dbStats = {}
    try {
      dbStats = await conn.db?.stats() || {}
    } catch { /* pode falhar sem permissão */ }

    const estados = { 0: 'desconectado', 1: 'conectado', 2: 'conectando', 3: 'desconectando' }

    res.json({
      estado:      estados[conn.readyState] || 'desconhecido',
      conectado:   conn.readyState === 1,
      banco:       conn.name || '—',
      host:        conn.host || '—',
      porta:       conn.port || '—',
      versao:      serverInfo.version || '—',
      colecoes:    dbStats.collections ?? '—',
      objetos:     dbStats.objects ?? '—',
      tamanho_dados: fmtBytes(dbStats.dataSize),
      tamanho_armazenamento: fmtBytes(dbStats.storageSize),
      indice_tamanho: fmtBytes(dbStats.indexSize),
      mongo_uri_parcial: (process.env.MONGO_URI || '').replace(/:\/\/[^:]+:[^@]+@/, '://***:***@'),
    })
  } catch (err) { next(err) }
})

// ═══════════════════════════════════════════════════════════════
//  MongoDB — listar coleções
// ═══════════════════════════════════════════════════════════════
router.get('/mongodb/colecoes', async (_req, res, next) => {
  try {
    const db   = mongoose.connection.db
    const cols = await db.listCollections().toArray()

    const detalhes = await Promise.all(
      cols.map(async (col) => {
        const contagem = await db.collection(col.name).countDocuments().catch(() => -1)
        let tamanho = '—'
        try {
          const stats = await db.command({ collStats: col.name, scale: 1 })
          tamanho = fmtBytes(stats.size)
        } catch { /* sem permissão no Atlas — ignorar */ }
        return { nome: col.name, contagem, tamanho }
      })
    )

    // ordena por nome
    detalhes.sort((a, b) => a.nome.localeCompare(b.nome))
    res.json({ colecoes: detalhes })
  } catch (err) { next(err) }
})

// ═══════════════════════════════════════════════════════════════
//  MongoDB — documentos de uma coleção (paginado)
// ═══════════════════════════════════════════════════════════════
router.get('/mongodb/colecoes/:nome', async (req, res, next) => {
  try {
    const { nome } = req.params
    const page  = Math.max(1, parseInt(req.query.page  || '1'))
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20')))
    const q     = req.query.q?.trim() || ''

    const db  = mongoose.connection.db
    const col = db.collection(nome)

    // filtro simples por _id ou por texto se fornecido
    let filtro = {}
    if (q) {
      // tenta como ObjectId, senão faz regex nos campos string
      try {
        const { ObjectId } = await import('mongodb')
        if (ObjectId.isValid(q) && q.length === 24) {
          filtro = { _id: new ObjectId(q) }
        }
      } catch { /* não é ObjectId válido */ }
    }

    const total = await col.countDocuments(filtro)
    const docs  = await col
      .find(filtro)
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray()

    res.json({
      colecao:   nome,
      total,
      page,
      limit,
      paginas:   Math.ceil(total / limit),
      documentos: docs,
    })
  } catch (err) { next(err) }
})

// ═══════════════════════════════════════════════════════════════
//  MongoDB — excluir um documento
// ═══════════════════════════════════════════════════════════════
router.delete('/mongodb/colecoes/:nome/doc/:id', async (req, res, next) => {
  try {
    const { nome, id } = req.params
    const db  = mongoose.connection.db
    const col = db.collection(nome)

    const { ObjectId } = await import('mongodb')
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ erro: 'ID inválido' })
    }

    const resultado = await col.deleteOne({ _id: new ObjectId(id) })
    if (resultado.deletedCount === 0) {
      return res.status(404).json({ erro: 'Documento não encontrado' })
    }

    res.json({ ok: true, mensagem: 'Documento excluído com sucesso' })
  } catch (err) { next(err) }
})

// ═══════════════════════════════════════════════════════════════
//  Cloudinary — status / uso da conta
// ═══════════════════════════════════════════════════════════════
router.get('/cloudinary/status', async (_req, res, next) => {
  try {
    const temCredenciais = await configurarCloudinaryCentral()

    if (!temCredenciais) {
      return res.status(400).json({ erro: 'Cloudinary não configurado. Insira as credenciais na aba Configurações.' })
    }

    const uso = await cloudinary.api.usage()

    res.json({
      cloud_name:     cloudinary.config().cloud_name || '—',
      plano:          uso.plan            || '—',
      // Armazenamento
      storage_bytes:  uso.storage?.usage  ?? 0,
      storage_fmt:    fmtBytes(uso.storage?.usage ?? 0),
      storage_limite: fmtBytes(uso.storage?.limit ?? 0),
      storage_pct:    uso.storage?.usage_percent ?? 0,
      // Bandwidth
      bandwidth_bytes:  uso.bandwidth?.usage  ?? 0,
      bandwidth_fmt:    fmtBytes(uso.bandwidth?.usage ?? 0),
      bandwidth_limite: fmtBytes(uso.bandwidth?.limit ?? 0),
      bandwidth_pct:    uso.bandwidth?.usage_percent ?? 0,
      // Recursos
      total_imagens: uso.resources ?? 0,
      total_videos:  uso.video_count ?? 0,
      transformacoes: uso.transformations?.usage ?? 0,
      requests:       uso.requests?.usage ?? 0,
      // Créditos
      creditos_usados: uso.credits?.usage ?? 0,
      creditos_limite: uso.credits?.limit ?? 0,
    })
  } catch (err) {
    if (err.error?.http_code) {
      return res.status(err.error.http_code).json({
        erro: err.error.message || 'Erro na API do Cloudinary',
      })
    }
    next(err)
  }
})

// ═══════════════════════════════════════════════════════════════
//  Cloudinary — listar recursos (imagens/vídeos)
// ═══════════════════════════════════════════════════════════════
router.get('/cloudinary/recursos', async (req, res, next) => {
  try {
    const configurado = await configurarCloudinaryCentral()
    if (!configurado) return res.status(400).json({ erro: 'Cloudinary não configurado em Integrações e APIs.' })

    const tipo       = req.query.tipo       || 'image'  // image | video | raw
    const max        = Math.min(50, parseInt(req.query.max || '20'))
    const nextCursor = req.query.cursor     || undefined
    const prefixo    = req.query.prefixo    || ''

    const params = {
      resource_type: tipo,
      max_results:   max,
      next_cursor:   nextCursor,
    }
    if (prefixo) params.prefix = prefixo

    const resultado = await cloudinary.api.resources(params)

    const recursos = resultado.resources.map(r => ({
      public_id:   r.public_id,
      display_url: r.secure_url,
      tipo:        r.resource_type,
      formato:     r.format,
      largura:     r.width  || null,
      altura:      r.height || null,
      bytes:       r.bytes  || 0,
      bytes_fmt:   fmtBytes(r.bytes),
      criado_em:   r.created_at,
      pasta:       r.folder || '/',
    }))

    res.json({
      recursos,
      cursor_proximo: resultado.next_cursor || null,
      total_estimado: resultado.total_count || recursos.length,
    })
  } catch (err) {
    if (err.error?.http_code) {
      return res.status(err.error.http_code).json({ erro: err.error.message })
    }
    next(err)
  }
})

// ═══════════════════════════════════════════════════════════════
//  Cloudinary — excluir recurso
// ═══════════════════════════════════════════════════════════════
router.delete('/cloudinary/recursos', async (req, res, next) => {
  try {
    const configurado = await configurarCloudinaryCentral()
    if (!configurado) return res.status(400).json({ erro: 'Cloudinary não configurado em Integrações e APIs.' })

    const { public_id, tipo = 'image' } = req.body
    if (!public_id) return res.status(400).json({ erro: 'public_id é obrigatório' })

    const resultado = await cloudinary.uploader.destroy(public_id, {
      resource_type: tipo,
    })

    if (resultado.result !== 'ok' && resultado.result !== 'not found') {
      return res.status(400).json({ erro: `Cloudinary retornou: ${resultado.result}` })
    }

    res.json({ ok: true, resultado: resultado.result })
  } catch (err) {
    if (err.error?.http_code) {
      return res.status(err.error.http_code).json({ erro: err.error.message })
    }
    next(err)
  }
})
// ========== NOVAS ROTAS ==========

// ─── Estatísticas da coleção ─────────────────────────────────
router.get('/mongodb/colecoes/:nome/stats', async (req, res, next) => {
  try {
    const { nome } = req.params
    const db = mongoose.connection.db
    const stats = await db.command({ collStats: nome })
    res.json({
      tamanho: stats.size,
      armazenamento: stats.storageSize,
      indices: stats.nindexes,
      avgObjSize: stats.avgObjSize,
      count: stats.count,
    })
  } catch (err) { next(err) }
})

// ─── Listar índices de uma coleção ────────────────────────────
router.get('/mongodb/colecoes/:nome/indices', async (req, res, next) => {
  try {
    const { nome } = req.params
    const db = mongoose.connection.db
    // MongoDB Node Driver 6 (usado pelo Mongoose 8) não expõe getIndexes()
    // na Collection nativa. listIndexes().toArray() é a API oficial e retorna
    // os documentos completos dos índices, inclusive nome, chave e opções.
    const indices = await db.collection(nome).listIndexes().toArray()
    const lista = indices.map(spec => ({
      name: spec.name,
      key: spec.key || {},
      unique: Boolean(spec.unique),
      sparse: Boolean(spec.sparse),
      background: Boolean(spec.background),
    }))
    res.json({ indices: lista })
  } catch (err) { next(err) }
})

// ─── Criar índice composto (simples) ──────────────────────────
router.post('/mongodb/colecoes/:nome/indices', async (req, res, next) => {
  try {
    const { nome } = req.params
    const { campos, unique = false, background = true } = req.body
    if (!campos || typeof campos !== 'object') {
      return res.status(400).json({ erro: 'campos deve ser um objeto { campo: 1 ou -1 }' })
    }
    const db = mongoose.connection.db
    const nomeIndice = await db.collection(nome).createIndex(campos, { unique, background })
    res.json({ mensagem: `Índice ${nomeIndice} criado`, nome: nomeIndice })
  } catch (err) { next(err) }
})

// ─── Remover índice ───────────────────────────────────────────
router.delete('/mongodb/colecoes/:nome/indices/:nomeIndice', async (req, res, next) => {
  try {
    const { nome, nomeIndice } = req.params
    if (nomeIndice === '_id_') {
      return res.status(400).json({ erro: 'Não é possível remover o índice _id_' })
    }
    const db = mongoose.connection.db
    await db.collection(nome).dropIndex(nomeIndice)
    res.json({ mensagem: `Índice ${nomeIndice} removido` })
  } catch (err) { next(err) }
})

// ─── Métricas completas do sistema ────────────────────────────
import os from 'os'
import v8 from 'v8'

function formatarUptime(seg) {
  const d = Math.floor(seg / 86400)
  const h = Math.floor((seg % 86400) / 3600)
  const m = Math.floor((seg % 3600) / 60)
  const s = Math.floor(seg % 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

function filtrarInterfaces(ifaces) {
  const resultado = []
  for (const [nome, lista] of Object.entries(ifaces)) {
    if (/^lo/i.test(nome)) continue // ignora loopback
    for (const iface of lista) {
      if (iface.internal) continue
      resultado.push({
        nome,
        familia: iface.family,
        endereco: iface.address,
        mascara: iface.netmask,
        mac: iface.mac,
      })
    }
  }
  return resultado
}

router.get('/sistema/metricas', async (_req, res, next) => {
  try {
    const cpus      = os.cpus()
    const loadAvg   = os.loadavg()
    const totalMem  = os.totalmem()
    const freeMem   = os.freemem()
    const memUsage  = process.memoryUsage()
    const cpuUsage  = process.cpuUsage()
    const uptime    = process.uptime()
    const uptimeSo  = os.uptime()
    const heapStats = v8.getHeapStatistics()
    const ifaces    = os.networkInterfaces() || {}

    // Tenta ler versão do package.json
    let versaoApp = '—'
    try {
      const { createRequire } = await import('module')
      const req = createRequire(import.meta.url)
      versaoApp = req('../../package.json').version || '—'
    } catch { /* ok */ }

    const [geminiCfg, openrouterCfg] = await Promise.all([
      getCredential('gemini', 'GEMINI_API_KEY'),
      getCredential('openrouter', 'OPENROUTER_API_KEY'),
    ])
    const aiCandidates = [
      { id:'gemini', nome:'Google Gemini', cfg:geminiCfg, modelo:(['gemini-2.0-flash','gemini-2.0-flash-001','gemini-2.5-flash'].includes(geminiCfg?.metadata?.model)?'gemini-3.5-flash-lite':(geminiCfg?.metadata?.model || 'gemini-3.5-flash-lite')) },
      { id:'openrouter', nome:'OpenRouter', cfg:openrouterCfg, modelo:openrouterCfg?.metadata?.model || 'openrouter/free' },
    ].filter(x => (x.cfg?.value || x.cfg?.locked) && x.cfg?.metadata?.enabled !== false)
    aiCandidates.sort((a,b)=>Number(Boolean(b.cfg?.metadata?.primary))-Number(Boolean(a.cfg?.metadata?.primary)))
    const aiPrincipal = aiCandidates[0] || null

    res.json({
      // ── CPU ────────────────────────────────────────────────
      cpu: {
        cores:        cpus.length,
        modelo:       cpus[0]?.model?.trim() || '—',
        velocidadeMhz: cpus[0]?.speed ?? 0,
        loadAvg1min:  loadAvg[0],
        loadAvg5min:  loadAvg[1],
        loadAvg15min: loadAvg[2],
        usoUsuarioMs: Math.round(cpuUsage.user   / 1000),
        usoSistemaMs: Math.round(cpuUsage.system / 1000),
      },

      // ── Memória RAM ────────────────────────────────────────
      memoria: {
        total:         totalMem,
        livre:         freeMem,
        usada:         totalMem - freeMem,
        usoPercentual: ((totalMem - freeMem) / totalMem) * 100,
        rss:           memUsage.rss,
        heapTotal:     memUsage.heapTotal,
        heapUsed:      memUsage.heapUsed,
        externo:       memUsage.external,
        arrayBuffers:  memUsage.arrayBuffers,
      },

      // ── V8 Heap ────────────────────────────────────────────
      v8: {
        heapSizeLimit:      heapStats.heap_size_limit,
        totalHeapSize:      heapStats.total_heap_size,
        usedHeapSize:       heapStats.used_heap_size,
        totalAvailable:     heapStats.total_available_size,
        totalPhysical:      heapStats.total_physical_size,
        mallocedMemory:     heapStats.malloced_memory,
        peakMallocedMemory: heapStats.peak_malloced_memory,
        usoPercentual:      (heapStats.used_heap_size / heapStats.heap_size_limit) * 100,
      },

      // ── Sistema Operacional ────────────────────────────────
      sistema: {
        hostname:      os.hostname(),
        so:            os.type(),
        versaoSo:      os.release(),
        plataforma:    os.platform(),
        arquitetura:   os.arch(),
        endianness:    os.endianness(),
        uptimeSegundos: uptimeSo,
        uptimeFormatado: formatarUptime(uptimeSo),
        tmpdir:        os.tmpdir(),
      },

      // ── Processo Node.js ───────────────────────────────────
      processo: {
        uptimeSegundos:  uptime,
        uptimeFormatado: formatarUptime(uptime),
        versaoNode:      process.version,
        versaoApp,
        pid:             process.pid,
        ppid:            process.ppid,
        cwd:             process.cwd(),
        execPath:        process.execPath,
        titulo:          process.title,
        handles:         process._getActiveHandles?.()?.length ?? '—',
        requests:        process._getActiveRequests?.()?.length ?? '—',
      },

      // ── Variáveis de ambiente (apenas não-sensíveis) ───────
      ambiente: {
        nodeEnv:      process.env.NODE_ENV      || '—',
        porta:        process.env.PORT          || '—',
        tz:           process.env.TZ            || Intl.DateTimeFormat().resolvedOptions().timeZone || '—',
        aiProvider:   aiPrincipal?.nome || '—',
        aiModel:      aiPrincipal?.modelo || '—',
        aiConfigured: Boolean(aiCandidates.length),
        geminiConfigured: Boolean(geminiCfg?.value || geminiCfg?.locked),
        openrouterConfigured: Boolean(openrouterCfg?.value || openrouterCfg?.locked),
        logLevel:     process.env.LOG_LEVEL     || '—',
      },

      // ── Interfaces de rede ─────────────────────────────────
      rede: {
        interfaces: filtrarInterfaces(ifaces),
      },

      timestamp: new Date().toISOString(),
    })
  } catch (err) { next(err) }
})

// ─── Limpar todo o cache (Redis + memória) ────────────────────
import { cacheClearAll } from '../utils/cache.js'

router.post('/sistema/limpar-cache', async (req, res, next) => {
  try {
    const removidos = await cacheClearAll()
    res.json({ mensagem: `Cache limpo (${removidos} chaves removidas)` })
  } catch (err) { next(err) }
})

// ═══════════════════════════════════════════════════════════════
//  Plataformas — Render + Vercel
//  Status público (sem auth) + APIs autenticadas opcionais
// ═══════════════════════════════════════════════════════════════

const STATUSPAGE = {
  render: 'https://status.render.com/api/v2',
  vercel: 'https://www.vercel-status.com/api/v2',
}

async function fetchStatuspage(baseUrl, path, timeoutMs = 6000) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl}${path}`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.json()
  } catch { clearTimeout(timer); return null }
}

function statusEmoji(indicator) {
  const m = { none: 'operational', minor: 'minor', major: 'major', critical: 'critical' }
  return m[indicator] || indicator
}

function componentStatus(s) {
  return {
    operational:            { ok: true,  label: 'Operacional' },
    degraded_performance:   { ok: false, label: 'Desempenho degradado' },
    partial_outage:         { ok: false, label: 'Interrupção parcial' },
    major_outage:           { ok: false, label: 'Interrupção grave' },
    under_maintenance:      { ok: null,  label: 'Em manutenção' },
  }[s] || { ok: null, label: s || 'desconhecido' }
}

// ── GET /plataformas/status (status público das duas plataformas) ──
router.get('/plataformas/status', async (_req, res, next) => {
  try {
    const [
      rdStatus, rdComponents, rdIncidents, rdMaint,
      vlStatus, vlComponents, vlIncidents, vlMaint,
    ] = await Promise.all([
      fetchStatuspage(STATUSPAGE.render, '/status.json'),
      fetchStatuspage(STATUSPAGE.render, '/components.json'),
      fetchStatuspage(STATUSPAGE.render, '/incidents/unresolved.json'),
      fetchStatuspage(STATUSPAGE.render, '/scheduled-maintenances/upcoming.json'),
      fetchStatuspage(STATUSPAGE.vercel, '/status.json'),
      fetchStatuspage(STATUSPAGE.vercel, '/components.json'),
      fetchStatuspage(STATUSPAGE.vercel, '/incidents/unresolved.json'),
      fetchStatuspage(STATUSPAGE.vercel, '/scheduled-maintenances/upcoming.json'),
    ])

    function buildPlatform(status, components, incidents, manutencoes) {
      return {
        ok:          !!status,
        indicador:   statusEmoji(status?.status?.indicator),
        descricao:   status?.status?.description || '—',
        pagina_url:  status?.page?.url || null,
        atualizado:  status?.page?.updated_at || null,
        componentes: (components?.components || [])
          .filter(c => !c.group)
          .map(c => ({ nome: c.name, status: c.status, ...componentStatus(c.status), grupo_id: c.group_id })),
        incidentes: (incidents?.incidents || []).map(i => ({
          id:          i.id,
          nome:        i.name,
          impacto:     i.impact,
          status:      i.status,
          criado:      i.created_at,
          atualizacao: i.incident_updates?.[0]?.body || '',
        })),
        manutencoes: (manutencoes?.scheduled_maintenances || []).map(m => ({
          id:        m.id,
          nome:      m.name,
          estado:    m.status,
          inicio:    m.scheduled_for,
          fim:       m.scheduled_until,
          descricao: m.incident_updates?.[0]?.body || '',
        })),
      }
    }

    res.json({
      render:    buildPlatform(rdStatus, rdComponents, rdIncidents, rdMaint),
      vercel:    buildPlatform(vlStatus, vlComponents, vlIncidents, vlMaint),
      timestamp: new Date().toISOString(),
    })
  } catch (err) { next(err) }
})

// ── Render API autenticada ─────────────────────────────────────
router.get('/plataformas/render/servicos', async (_req, res, next) => {
  const { value: apiKey } = await getCredential('render', 'RENDER_API_KEY')
  if (!apiKey) return res.status(400).json({ erro: 'Render não configurado. Abra Integrações e APIs → Render.' })
  try {
    const r = await fetch('https://api.render.com/v1/services?limit=30', {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    if (!r.ok) return res.status(r.status).json({ erro: `Render API retornou ${r.status}` })
    const data = await r.json()
    const servicos = data.map(({ service: s }) => ({
      id:          s.id,
      nome:        s.name,
      tipo:        s.type,
      estado:      s.state,  // live | build_in_progress | suspended | etc.
      url:         s.serviceDetails?.url || null,
      regiao:      s.serviceDetails?.region || null,
      atualizado:  s.updatedAt,
      branch:      s.branch || null,
      repo:        s.repo   || null,
    }))
    res.json({ servicos, sincronizadoEm: new Date().toISOString() })
  } catch (err) { next(err) }
})

router.get('/plataformas/render/servicos/:serviceId/deploys', async (req, res, next) => {
  const { value: apiKey } = await getCredential('render', 'RENDER_API_KEY')
  if (!apiKey) return res.status(400).json({ erro: 'Render não configurado. Abra Integrações e APIs → Render.' })
  try {
    const { serviceId } = req.params
    const r = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=10`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    if (!r.ok) return res.status(r.status).json({ erro: `Render API retornou ${r.status}` })
    const data = await r.json()
    const deploys = data.map(({ deploy: d }) => ({
      id:         d.id,
      status:     d.status,   // live | build_in_progress | update_in_progress | canceled | deactivated | error
      criado:     d.createdAt,
      finalizado: d.finishedAt || null,
      duracao:    (d.finishedAt && d.createdAt)
        ? Math.round((new Date(d.finishedAt) - new Date(d.createdAt)) / 1000)
        : null,
      commit:     d.commit ? { hash: d.commit.id?.slice(0, 7), mensagem: d.commit.message } : null,
    }))
    res.json({ deploys })
  } catch (err) { next(err) }
})

// ── Cofre de credenciais do painel ─────────────────────────────
const CREDENTIAL_DEFS = {
  render:    { env: 'RENDER_API_KEY', label: 'Render API Key' },
  vercel:    { env: 'VERCEL_TOKEN', label: 'Vercel Token' },
  github:    { env: 'GITHUB_TOKEN', label: 'GitHub Token' },
  gemini:    { env: 'GEMINI_API_KEY', label: 'Google Gemini API Key' },
  openrouter:{ env: 'OPENROUTER_API_KEY', label: 'OpenRouter API Key' },
}

router.get('/credenciais', async (_req, res, next) => {
  try {
    const docs = await PlataformaCredencial.find({}).lean()
    const byName = Object.fromEntries(docs.map(d => [d.plataforma, d]))
    const items = await Promise.all(Object.entries(CREDENTIAL_DEFS).map(async ([id, def]) => {
      const stored = byName[id]
      const resolved = await getCredential(id, def.env)
      const envConfigured = Boolean(process.env[def.env])
      return {
        id, label: def.label,
        configurado: Boolean(resolved.value) || Boolean(resolved.locked),
        utilizavel: Boolean(resolved.value),
        bloqueada: Boolean(resolved.locked),
        origem: stored?.segredo ? 'cofre' : envConfigured ? 'ambiente' : null,
        valorMascarado: (resolved.value || resolved.locked) ? '••••••••••••' : '',
        metadata: stored?.metadata || {},
        atualizadoEm: stored?.updatedAt || null,
      }
    }))
    res.json({ items })
  } catch (err) { next(err) }
})

router.put('/credenciais/:plataforma', async (req, res, next) => {
  try {
    const plataforma = String(req.params.plataforma || '').toLowerCase()
    if (!CREDENTIAL_DEFS[plataforma]) return res.status(400).json({ erro: 'Integração não suportada.' })
    const segredo = String(req.body?.segredo || '').trim()
    if (!segredo) return res.status(400).json({ erro: 'Informe a credencial.' })
    await setCredential(plataforma, segredo, req.body?.metadata || {})
    res.json({ ok: true, mensagem: `${CREDENTIAL_DEFS[plataforma].label} salva no cofre criptografado.` })
  } catch (err) { next(err) }
})

router.delete('/credenciais/:plataforma', async (req, res, next) => {
  try {
    const plataforma = String(req.params.plataforma || '').toLowerCase()
    await deleteCredential(plataforma)
    res.json({ ok: true, mensagem: 'Credencial removida do cofre. A variável do ambiente, se existir, volta a ser usada.' })
  } catch (err) { next(err) }
})

async function obterConfigVercel() {
  const cfg = await getCredential('vercel', 'VERCEL_TOKEN')
  return {
    token: cfg.value,
    teamId: cfg.metadata?.teamId || process.env.VERCEL_TEAM_ID || '',
    origem: cfg.source,
  }
}

function vercelUrl(path, teamId = '') {
  const url = new URL(`https://api.vercel.com${path}`)
  if (teamId) url.searchParams.set('teamId', teamId)
  return url.toString()
}

router.get('/plataformas/vercel/configuracao', async (_req, res, next) => {
  try {
    const cfg = await obterConfigVercel()
    res.json({
      configurado: Boolean(cfg.token), origem: cfg.origem,
      teamId: cfg.teamId,
      tokenMascarado: cfg.token ? '••••••••••••' : '',
    })
  } catch (err) { next(err) }
})

router.put('/plataformas/vercel/configuracao', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim()
    const teamId = String(req.body?.teamId || '').trim()
    if (!token) return res.status(400).json({ erro: 'Informe o token da Vercel.' })
    const teste = await fetch(vercelUrl('/v2/user', teamId), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (!teste.ok) return res.status(400).json({ erro: `Token recusado pela Vercel (HTTP ${teste.status}).` })
    await setCredential('vercel', token, { teamId })
    res.json({ ok: true, mensagem: 'Integração com a Vercel salva no cofre e validada.', origem: 'cofre', teamId })
  } catch (err) { next(err) }
})

router.post('/plataformas/vercel/testar', async (req, res, next) => {
  try {
    const tokenInformado = String(req.body?.token || '').trim()
    const teamIdInformado = String(req.body?.teamId || '').trim()
    const cfg = tokenInformado ? { token: tokenInformado, teamId: teamIdInformado } : await obterConfigVercel()
    if (!cfg.token) return res.status(400).json({ erro: 'Vercel não configurada. Abra Integrações e APIs → Vercel.' })
    const r = await fetch(vercelUrl('/v2/user', cfg.teamId), { headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' } })
    if (!r.ok) return res.status(r.status).json({ erro: `Vercel API retornou ${r.status}` })
    const data = await r.json()
    res.json({ ok: true, usuario: data.user?.username || data.user?.name || data.user?.email || 'Conta conectada' })
  } catch (err) { next(err) }
})

router.delete('/plataformas/vercel/configuracao', async (_req, res, next) => {
  try {
    await deleteCredential('vercel')
    res.json({ ok: true, mensagem: process.env.VERCEL_TOKEN ? 'Credencial do cofre removida; o ambiente continuará sendo usado.' : 'Integração removida.' })
  } catch (err) { next(err) }
})

// ── Vercel API autenticada ─────────────────────────────────────
router.get('/plataformas/vercel/projetos', async (_req, res, next) => {
  try {
    const { token, teamId } = await obterConfigVercel()
    if (!token) return res.status(400).json({ erro: 'Vercel não configurada. Abra Integrações e APIs → Vercel.' })
    const r = await fetch(vercelUrl('/v9/projects?limit=30', teamId), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!r.ok) return res.status(r.status).json({ erro: `Vercel API retornou ${r.status}` })
    const data = await r.json()
    const projetos = (data.projects || []).map(p => ({
      id:         p.id,
      nome:       p.name,
      framework:  p.framework || '—',
      dominio:    p.alias?.[0] || null,
      atualizado: p.updatedAt,
      git:        p.link ? { tipo: p.link.type, repositorio: p.link.repo } : null,
    }))
    res.json({ projetos, sincronizadoEm: new Date().toISOString() })
  } catch (err) { next(err) }
})

router.get('/plataformas/vercel/projetos/:projetoId/deploys', async (req, res, next) => {
  try {
    const { token, teamId } = await obterConfigVercel()
    if (!token) return res.status(400).json({ erro: 'Vercel não configurada. Abra Integrações e APIs → Vercel.' })
    const { projetoId } = req.params
    const r = await fetch(vercelUrl(`/v6/deployments?projectId=${encodeURIComponent(projetoId)}&limit=10`, teamId), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!r.ok) return res.status(r.status).json({ erro: `Vercel API retornou ${r.status}` })
    const data = await r.json()
    const deploys = (data.deployments || []).map(d => ({
      id:       d.uid,
      url:      d.url ? `https://${d.url}` : null,
      estado:   d.state,   // READY | ERROR | BUILDING | CANCELED | QUEUED
      ambiente: d.target || 'preview', // production | preview
      criado:   d.createdAt,
      pronto:   d.ready   || null,
      duracao:  (d.ready && d.createdAt)
        ? Math.round((d.ready - d.createdAt) / 1000)
        : null,
      branch:   d.meta?.githubCommitRef || null,
      commit:   d.meta?.githubCommitMessage || null,
      hash:     d.meta?.githubCommitSha?.slice(0, 7) || null,
    }))
    res.json({ deploys })
  } catch (err) { next(err) }
})


// ═══════════════════════════════════════════════════════════════
//  Central inteligente de Plataformas — produção Render + Vercel
// ═══════════════════════════════════════════════════════════════
function maskCredential(value='', locked=false) {
  if(locked)return 'protegida por outra chave'
  const v=String(value||'')
  if(!v)return ''
  return `••••••••${v.slice(-4)}`
}
function normalizeOrigin(value='') {
  try { const u=new URL(String(value)); return `${u.protocol}//${u.host}` } catch { return '' }
}
function escapeRegex(value='') { return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&') }

async function smartRenderServices(apiKey) {
  if(!apiKey)return []
  const r=await fetch('https://api.render.com/v1/services?limit=30',{headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
  if(!r.ok)throw new Error(`Render API retornou ${r.status}`)
  const data=await r.json()
  return (Array.isArray(data)?data:[]).map(row=>{
    const s=row?.service||row||{}
    return ({
    id:s.id,nome:s.name,tipo:s.type,estado:s.state,
    ownerId:s.ownerId||s.owner_id||s.owner?.id||null,
    slug:s.slug||null,
    autoDeploy:s.autoDeploy,
    url:s.url||s.serviceDetails?.url||null,
    regiao:s.region||s.serviceDetails?.region||null,
    atualizado:s.updatedAt,branch:s.branch||null,repo:s.repo||null,
  })}).filter(x=>x.id)
}
async function smartRenderDeploys(apiKey,serviceId,limit=8) {
  if(!apiKey||!serviceId)return []
  const safeLimit=Math.max(1,Math.min(20,Number(limit)||8))
  const r=await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys?limit=${safeLimit}`,{headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
  if(!r.ok)throw new Error(`Render API retornou ${r.status}`)
  const data=await r.json()
  return (Array.isArray(data)?data:[]).map(row=>{
    const d=row?.deploy||row||{}
    return ({
    id:d.id,status:d.status,criado:d.createdAt,finalizado:d.finishedAt||null,
    duracao:d.finishedAt&&d.createdAt?Math.round((new Date(d.finishedAt)-new Date(d.createdAt))/1000):null,
    commit:d.commit?{hash:d.commit.id?.slice(0,7),mensagem:d.commit.message}:null,
  })}).filter(x=>x.id)
}
async function smartVercelProjects(token,teamId='') {
  if(!token)return []
  const r=await fetch(vercelUrl('/v9/projects?limit=30',teamId),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
  if(!r.ok)throw new Error(`Vercel API retornou ${r.status}`)
  const data=await r.json()
  return (data.projects||[]).map(p=>{
    const aliases=(Array.isArray(p.alias)?p.alias:[]).map(a=>String(a))
    const stable=aliases.find(a=>a.toLowerCase()===`${String(p.name||'').toLowerCase()}.vercel.app`)||null
    return {
      id:p.id,nome:p.name,framework:p.framework||'—',
      dominios:aliases,dominio:stable,
      atualizado:p.updatedAt,
      git:p.link?{
        tipo:p.link.type,
        repositorio:p.link.repo,
        owner:p.link.org||p.link.repoOwner||p.link.owner||null,
        slug:(p.link.org||p.link.repoOwner||p.link.owner)&&p.link.repo?`${p.link.org||p.link.repoOwner||p.link.owner}/${p.link.repo}`:(p.link.repo||null),
        repoId:p.link.repoId||null,
        branch:p.link.productionBranch||p.link.branch||null,
      }:null,
    }
  })
}

async function smartVercelProjectDomains(token,teamId='',projectId='') {
  if(!token||!projectId)return []
  const r=await fetch(vercelUrl(`/v9/projects/${encodeURIComponent(projectId)}/domains?limit=100`,teamId),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
  const data=await r.json().catch(()=>({}))
  if(!r.ok)throw new Error(data.error?.message||`Vercel Domains API retornou ${r.status}`)
  return (data.domains||[]).map(d=>({
    name:String(d.name||''),verified:d.verified!==false,gitBranch:d.gitBranch||null,redirect:d.redirect||null,
    createdAt:d.createdAt||null,updatedAt:d.updatedAt||null,
  })).filter(d=>d.name)
}
function chooseCanonicalVercelDomain(project,domains=[],storedOrigin='') {
  const productionDomains=domains.filter(d=>!d.gitBranch)
  const names=productionDomains.map(d=>String(d.name||'').toLowerCase()).filter(Boolean)
  let storedHost=''
  try{storedHost=new URL(storedOrigin).hostname.toLowerCase()}catch{}
  if(storedHost&&names.includes(storedHost))return storedHost
  const exact=`${String(project?.nome||'').toLowerCase()}.vercel.app`
  if(names.includes(exact))return exact
  const verifiedRoot=productionDomains.find(d=>d.verified!==false&&!d.redirect)?.name
  if(verifiedRoot)return String(verifiedRoot)
  const root=productionDomains[0]?.name
  if(root)return String(root)
  if(project?.dominio&&(!names.length||names.includes(String(project.dominio).toLowerCase())))return project.dominio
  return ''
}
async function smartVercelDeploys(token,teamId,projectId,limit=8) {
  if(!token||!projectId)return []
  const safeLimit=Math.max(1,Math.min(20,Number(limit)||8))
  const r=await fetch(vercelUrl(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${safeLimit}`,teamId),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
  if(!r.ok)throw new Error(`Vercel API retornou ${r.status}`)
  const data=await r.json()
  return (data.deployments||[]).map(d=>({
    id:d.uid,url:d.url?`https://${d.url}`:null,estado:d.state,
    ambiente:d.target||'preview',criado:d.createdAt,pronto:d.ready||null,
    duracao:d.ready&&d.createdAt?Math.round((d.ready-d.createdAt)/1000):null,
    branch:d.meta?.githubCommitRef||null,commit:d.meta?.githubCommitMessage||null,
    hash:d.meta?.githubCommitSha?.slice(0,7)||null,
  }))
}


async function renderApi(apiKey,pathName,{method='GET',body=null}={}) {
  const r=await fetch(`https://api.render.com${pathName}`,{
    method,
    headers:{
      Authorization:`Bearer ${apiKey}`,
      Accept:'application/json',
      ...(body?{'Content-Type':'application/json'}:{}),
    },
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(15000),
  })
  const payload=await r.json().catch(()=>null)
  if(!r.ok) {
    const detail=payload?.message||payload?.error||payload?.errors?.[0]?.message||`HTTP ${r.status}`
    throw new Error(`Render: ${detail}`)
  }
  return payload
}

async function vercelApi(token,pathName,teamId='',{method='GET',body=null}={}) {
  const url=vercelUrl(pathName,teamId)
  const r=await fetch(url,{
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      Accept:'application/json',
      ...(body?{'Content-Type':'application/json'}:{}),
    },
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(15000),
  })
  const payload=await r.json().catch(()=>null)
  if(!r.ok) {
    const detail=payload?.error?.message||payload?.message||`HTTP ${r.status}`
    throw new Error(`Vercel: ${detail}`)
  }
  return payload
}

function maskSecretValue(value='') {
  const v=String(value??'')
  if(!v)return '••••••••'
  if(v.length<=4)return '••••'
  return `••••••••${v.slice(-4)}`
}

async function smartRenderEnv(apiKey,serviceId) {
  const data=await renderApi(apiKey,`/v1/services/${encodeURIComponent(serviceId)}/env-vars?limit=100`)
  const list=Array.isArray(data)?data:(data?.envVars||[])
  return list.map(row=>{
    const item=row?.envVar||row||{}
    return {
      key:item.key||item.name||'',
      valueMasked:'••••••••••••••••',
      configured:true,
      valueAvailable:true,
      revealable:true,
      valueAvailability:'on-demand',
      status:'configured',
      origin:'Render', updatedAt:item.updatedAt||item.updated_at||null,
    }
  }).filter(x=>x.key)
}

async function smartVercelEnv(token,teamId,projectId) {
  const data=await vercelApi(token,`/v9/projects/${encodeURIComponent(projectId)}/env`,teamId)
  return (data?.envs||data?.env||[]).map(item=>({
    id:item.id||null,
    key:item.key||'',
    target:Array.isArray(item.target)?item.target:[item.target].filter(Boolean),
    type:item.type||'encrypted',
    gitBranch:item.gitBranch||null,
    valueMasked:'••••••••••••••••',
    valueAvailable:item.type!=='sensitive'&&Boolean(item.id),
    revealable:item.type!=='sensitive'&&Boolean(item.id),
    valueAvailability:item.type==='sensitive'?'provider-protected':'on-demand',
    providerLimitation:item.type==='sensitive'?'A Vercel não permite recuperar o valor original de variáveis sensíveis depois de salvas.':null,
    status:'configured',
    origin:'Vercel', updatedAt:item.updatedAt||item.updated_at||item.createdAt||null,
  })).filter(x=>x.key)
}

function normalizarLinhaLog(row={},index=0,prefix='log') {
  const payload=row?.payload||{}
  const info=payload?.info||{}
  const labels=row?.labels||payload?.labels||{}
  const texto=[
    row?.message,row?.text,row?.body,row?.msg,row?.log,
    payload?.text,payload?.message,payload?.error,
    info?.name,info?.step,labels?.message,
  ].find(v=>typeof v==='string'&&v.trim())||''
  const tipo=String(row?.type||payload?.type||labels?.type||'log')
  const nivel=String(row?.level||row?.severity||payload?.level||labels?.level||'')
  return {
    id:row?.id||payload?.id||`${prefix}-${index}`,
    criado:row?.timestamp||row?.createdAt||row?.created||payload?.created||payload?.timestamp||null,
    nivel,tipo,texto,statusCode:row?.statusCode||payload?.statusCode||null,
  }
}

function diagnosticarLogs(logs=[],provider='') {
  const relevantes=logs.filter(x=>/error|erro|failed|failure|falhou|cannot|could not|not found|invalid|exception|fatal|npm err|command failed|build failed|exit code|module not found|does not provide an export/i.test(String(x?.texto||'')))
  const principal=relevantes[0]?.texto||''
  const aviso=logs.find(x=>/warning|warn|aviso|deprecated/i.test(String(x?.texto||'')))?.texto||''
  return {
    provider,
    erroPrincipal:principal,
    avisoPrincipal:aviso,
    linhasRelevantes:relevantes.slice(0,12),
    encontrouErro:Boolean(principal),
  }
}

async function smartVercelLogs(token,teamId,deploymentId) {
  const data=await vercelApi(token,`/v3/deployments/${encodeURIComponent(deploymentId)}/events?direction=backward&limit=200`,teamId)
  const rows=Array.isArray(data)?data:(data?.events||data?.logs||data?.items||[])
  const logs=rows.map((event,index)=>normalizarLinhaLog(event,index,deploymentId)).filter(x=>x.texto)
  return {logs,diagnostico:diagnosticarLogs(logs,'vercel')}
}

async function smartRenderLogs(apiKey,ownerId,serviceId,{scope='all',hours=24,limit=100,startTime='',endTime='',allowFallback=true}={}) {
  if(!ownerId||!serviceId)return {logs:[],diagnostico:diagnosticarLogs([],'render'),janelaHoras:hours}
  const safeHours=Math.max(1,Math.min(24*14,Number(hours)||24))
  const safeLimit=Math.max(1,Math.min(100,Number(limit)||100))
  const fim=endTime?new Date(endTime):new Date()
  const inicio=startTime?new Date(startTime):new Date(fim.getTime()-(safeHours*60*60*1000))
  const p=new URLSearchParams({ownerId,direction:'backward',limit:String(safeLimit),startTime:inicio.toISOString(),endTime:fim.toISOString()})
  p.append('resource',serviceId)
  if(scope==='build')p.append('type','build')
  if(scope==='app')p.append('type','app')
  if(scope==='request')p.append('type','request')
  const data=await renderApi(apiKey,`/v1/logs?${p.toString()}`)
  const rows=data?.logs||data?.items||data?.results||[]
  let logs=rows.map((row,index)=>normalizarLinhaLog(row,index,serviceId)).filter(x=>x.texto)
  let janelaHoras=safeHours
  let fallback=false
  if(!logs.length && allowFallback && !startTime && safeHours<168) {
    const inicio7d=new Date(fim.getTime()-(168*60*60*1000))
    p.set('startTime',inicio7d.toISOString())
    const fallbackData=await renderApi(apiKey,`/v1/logs?${p.toString()}`)
    const fallbackRows=fallbackData?.logs||fallbackData?.items||fallbackData?.results||[]
    logs=fallbackRows.map((row,index)=>normalizarLinhaLog(row,index,`${serviceId}-7d`)).filter(x=>x.texto)
    janelaHoras=168
    fallback=true
  }
  if(scope==='errors')logs=logs.filter(x=>/error|erro|failed|failure|falhou|fatal|exception|exit code|build failed/i.test(String(x.texto||'')))
  return {logs,diagnostico:diagnosticarLogs(logs,'render'),janelaHoras,fallback,hasMore:Boolean(data?.hasMore)}
}




// ── Central unificada de projetos Vercel + Render ─────────────
function normalizeProjectName(value='') {
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
}
function normalizeRepoSlug(value='', owner='') {
  let raw=String(value||'').trim()
  if(!raw)return ''
  raw=raw.replace(/^git@github\.com:/i,'').replace(/^https?:\/\/github\.com\//i,'').replace(/^ssh:\/\/git@github\.com\//i,'')
  raw=raw.replace(/\.git$/i,'').replace(/^\/+|\/+$/g,'')
  if(owner && !raw.includes('/')) raw=`${String(owner).trim()}/${raw}`
  const parts=raw.split('/').filter(Boolean)
  if(parts.length>=2)return `${parts[parts.length-2]}/${parts[parts.length-1]}`.toLowerCase()
  return parts[0]?.toLowerCase()||''
}
function repoBase(value='') {
  const slug=normalizeRepoSlug(value)
  return slug.split('/').filter(Boolean).pop()||''
}
function platformProjectId(key='') {
  return `prj_${Buffer.from(String(key)).toString('base64url')}`
}
function deploymentFailed(value='') { return /fail|error|cancel/i.test(String(value||'')) }
function deploymentBusy(value='') { return /build|queue|progress|prepar|initializ|pending/i.test(String(value||'')) }
function deploymentReady(value='') { return /ready|live|operational|deployed|success|succeed/i.test(String(value||'')) }
function deploymentTime(d={}) {
  const raw=d.criado??d.createdAt??d.updatedAt??0
  const n=typeof raw==='number'?raw:new Date(raw||0).getTime()
  return Number.isFinite(n)?n:0
}
function compactDeploy(provider,d) {
  if(!d)return null
  return provider==='vercel'
    ? {provider,id:d.id,status:d.estado,criado:d.criado,duracao:d.duracao,url:d.url,ambiente:d.ambiente,branch:d.branch,hash:d.hash,mensagem:d.commit||'Deploy Vercel'}
    : {provider,id:d.id,status:d.status,criado:d.criado,duracao:d.duracao,url:null,ambiente:'production',branch:null,hash:d.commit?.hash||null,mensagem:d.commit?.mensagem||'Deploy Render'}
}
function analyzeUnifiedProject(project, renderDeploys=[], vercelDeploys=[]) {
  const alerts=[]
  const all=[...renderDeploys.map(d=>compactDeploy('render',d)),...vercelDeploys.map(d=>compactDeploy('vercel',d))].filter(Boolean).sort((a,b)=>deploymentTime(b)-deploymentTime(a))
  const latest=all[0]||null
  const failures=all.filter(d=>deploymentFailed(d.status)).length
  const busy=all.some(d=>deploymentBusy(d.status))
  const ready=latest ? deploymentReady(latest.status) : false
  if(latest&&deploymentFailed(latest.status))alerts.push({nivel:'erro',titulo:'Último deploy com problema',descricao:`${latest.provider==='vercel'?'Vercel':'Render'} informou ${latest.status}.`})
  if(project.render&&project.vercel){
    const rd=renderDeploys[0], vc=vercelDeploys[0]
    const renderRepo=normalizeRepoSlug(project.render.repo||'')
    const vercelRepo=normalizeRepoSlug(project.vercel.git?.slug||project.vercel.git?.repositorio||'',project.vercel.git?.owner||'')
    const sameRepo=Boolean(renderRepo&&vercelRepo&&(renderRepo===vercelRepo||((!renderRepo.includes('/')||!vercelRepo.includes('/'))&&repoBase(renderRepo)===repoBase(vercelRepo))))
    if(sameRepo){
      const rh=String(rd?.commit?.hash||'').toLowerCase(), vh=String(vc?.hash||'').toLowerCase()
      if(rh&&vh&&!vh.startsWith(rh)&&!rh.startsWith(vh))alerts.push({nivel:'aviso',titulo:'Commits diferentes entre frontend e backend',descricao:`Vercel ${vh} · Render ${rh}. Verifique se os dois pertencem à mesma release.`})
      const rb=String(project.render.branch||'').trim(), vb=String(project.vercel.git?.branch||vc?.branch||'').trim()
      if(rb&&vb&&rb!==vb)alerts.push({nivel:'aviso',titulo:'Branches diferentes',descricao:`Vercel usa ${vb}; Render usa ${rb}.`})
    }
  }
  if(!project.render&&!project.vercel)alerts.push({nivel:'aviso',titulo:'Projeto sem provedor',descricao:'Nenhum recurso Vercel ou Render foi associado.'})
  if(!all.length)alerts.push({nivel:'info',titulo:'Sem histórico de deploy',descricao:'Ainda não foi possível obter deploys recentes para este projeto.'})
  const newest=all[0]?.criado
  if(newest){
    const age=Date.now()-deploymentTime(all[0])
    if(age>45*24*60*60*1000)alerts.push({nivel:'info',titulo:'Projeto sem deploy recente',descricao:'O último deploy encontrado tem mais de 45 dias.'})
  }
  let estado='desconhecido'
  if(busy)estado='deploy'
  else if(latest&&deploymentFailed(latest.status))estado='erro'
  else if(ready||(!latest&&project.render&&/live/i.test(String(project.render.estado||''))))estado='online'
  else if(latest)estado='atencao'
  const durations=all.map(d=>Number(d.duracao)).filter(n=>Number.isFinite(n)&&n>0)
  return {
    estado,latest,alerts,
    stats:{amostra:all.length,falhas:failures,sucessos:all.filter(d=>deploymentReady(d.status)).length,duracaoMedia:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null},
    timeline:all,
  }
}
function buildUnifiedPlatformProjects(renderServices=[],vercelProjects=[],primary={}) {
  const records=[]
  for(const s of renderServices){
    const repo=normalizeRepoSlug(s.repo)
    records.push({provider:'render',item:s,repo,base:repoBase(repo),name:normalizeProjectName(s.nome)})
  }
  for(const p of vercelProjects){
    const repo=normalizeRepoSlug(p.git?.slug||p.git?.repositorio||'',p.git?.owner||'')
    records.push({provider:'vercel',item:p,repo,base:repoBase(repo),name:normalizeProjectName(p.nome)})
  }
  const fullByBase=new Map()
  for(const r of records){
    if(r.repo&&r.repo.includes('/')){
      const set=fullByBase.get(r.base)||new Set();set.add(r.repo);fullByBase.set(r.base,set)
    }
  }
  const groups=new Map()
  for(const r of records){
    let repo=r.repo
    if(repo&&!repo.includes('/')&&fullByBase.get(r.base)?.size===1)repo=[...fullByBase.get(r.base)][0]
    const isPrimary=(r.provider==='render'&&primary.renderServiceId&&r.item.id===primary.renderServiceId)||(r.provider==='vercel'&&primary.vercelProjectId&&r.item.id===primary.vercelProjectId)
    const key=isPrimary?'special:painel':(repo?`repo:${repo}`:`name:${r.name||r.item.id}`)
    const group=groups.get(key)||{key,id:platformProjectId(key),render:null,vercel:null,repo:repo||'',repoBase:repoBase(repo),linkedBy:isPrimary?'producao':repo?'repositorio':'nome'}
    group[r.provider]=r.item
    if(repo&&!group.repo)group.repo=repo
    groups.set(key,group)
  }
  return [...groups.values()].map(g=>{
    const especial=Boolean((primary.renderServiceId&&g.render?.id===primary.renderServiceId)||(primary.vercelProjectId&&g.vercel?.id===primary.vercelProjectId))
    const nome=especial?'Painel':(g.vercel?.nome||g.render?.nome||g.repoBase||'Projeto')
    const gitSlug=g.repo||normalizeRepoSlug(g.vercel?.git?.slug||g.vercel?.git?.repositorio||'',g.vercel?.git?.owner||'')||normalizeRepoSlug(g.render?.repo||'')
    const updated=Math.max(new Date(g.vercel?.atualizado||0).getTime()||0,new Date(g.render?.atualizado||0).getTime()||0)
    return {...g,nome,especial:especial?'painel':null,git:gitSlug?{slug:gitSlug,url:`https://github.com/${gitSlug}`} : null,atualizado:updated?new Date(updated).toISOString():null}
  })
}
async function mapLimit(items,limit,worker){
  const output=new Array(items.length);let next=0
  async function run(){while(true){const i=next++;if(i>=items.length)return;try{output[i]=await worker(items[i],i)}catch(error){output[i]={error}}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return output
}
async function loadUnifiedPlatformSource(){
  const [renderCred,vercelCred]=await Promise.all([getCredential('render','RENDER_API_KEY'),getCredential('vercel','VERCEL_TOKEN')])
  const result={renderCred,vercelCred,renderServices:[],vercelProjects:[],errors:{}}
  if(renderCred.value)try{result.renderServices=await smartRenderServices(renderCred.value)}catch(error){result.errors.render=error.message}
  if(vercelCred.value)try{result.vercelProjects=await smartVercelProjects(vercelCred.value,vercelCred.metadata?.teamId||'')}catch(error){result.errors.vercel=error.message}
  result.projects=buildUnifiedPlatformProjects(result.renderServices,result.vercelProjects,{renderServiceId:renderCred.metadata?.primaryServiceId||'',vercelProjectId:vercelCred.metadata?.primaryProjectId||''})
  return result
}

router.get('/plataformas/projetos-central', async (_req,res,next)=>{
  try{
    const src=await loadUnifiedPlatformSource()
    const enriched=await mapLimit(src.projects,6,async project=>{
      const [rd,vc]=await Promise.all([
        project.render&&src.renderCred.value?smartRenderDeploys(src.renderCred.value,project.render.id,1).catch(()=>[]):[],
        project.vercel&&src.vercelCred.value?smartVercelDeploys(src.vercelCred.value,src.vercelCred.metadata?.teamId||'',project.vercel.id,1).catch(()=>[]):[],
      ])
      const analise=analyzeUnifiedProject(project,rd,vc)
      return {...project,estado:analise.estado,ultimoDeploy:analise.latest,alertas:analise.alerts,stats:analise.stats}
    })
    enriched.sort((a,b)=>Number(b.especial==='painel')-Number(a.especial==='painel')||Number(b.estado==='erro')-Number(a.estado==='erro')||deploymentTime(b.ultimoDeploy||{})-deploymentTime(a.ultimoDeploy||{}))
    const problems=enriched.flatMap(p=>(p.alertas||[]).filter(a=>a.nivel==='erro'||a.nivel==='aviso').map((a,i)=>({...a,id:`${p.id}-${i}`,projetoId:p.id,projeto:p.nome})))
    res.json({
      sincronizadoEm:new Date().toISOString(),
      projetos:enriched,
      resumo:{total:enriched.length,online:enriched.filter(p=>p.estado==='online').length,deploy:enriched.filter(p=>p.estado==='deploy').length,problemas:enriched.filter(p=>p.estado==='erro'||(p.alertas||[]).some(a=>a.nivel==='erro'||a.nivel==='aviso')).length},
      problemas:problems.slice(0,20),
      provedores:{
        render:{configurado:Boolean(src.renderCred.value)||Boolean(src.renderCred.locked),utilizavel:Boolean(src.renderCred.value),erro:src.errors.render||null,servicos:src.renderServices},
        vercel:{configurado:Boolean(src.vercelCred.value)||Boolean(src.vercelCred.locked),utilizavel:Boolean(src.vercelCred.value),erro:src.errors.vercel||null,projetos:src.vercelProjects},
      },
      producao:{renderServiceId:src.renderCred.metadata?.primaryServiceId||'',vercelProjectId:src.vercelCred.metadata?.primaryProjectId||'',frontendOrigin:src.vercelCred.metadata?.productionOrigin||'',backendUrl:src.renderCred.metadata?.backendUrl||''},
    })
  }catch(err){next(err)}
})

router.get('/plataformas/projetos-central/:projectId', async (req,res,next)=>{
  try{
    const src=await loadUnifiedPlatformSource()
    const project=src.projects.find(p=>p.id===req.params.projectId)
    if(!project)return res.status(404).json({erro:'Projeto não encontrado nas contas Vercel/Render conectadas.'})
    const [renderDeploys,vercelDeploys,domains]=await Promise.all([
      project.render&&src.renderCred.value?smartRenderDeploys(src.renderCred.value,project.render.id,12).catch(()=>[]):[],
      project.vercel&&src.vercelCred.value?smartVercelDeploys(src.vercelCred.value,src.vercelCred.metadata?.teamId||'',project.vercel.id,12).catch(()=>[]):[],
      project.vercel&&src.vercelCred.value?smartVercelProjectDomains(src.vercelCred.value,src.vercelCred.metadata?.teamId||'',project.vercel.id).catch(()=>[]):[],
    ])
    const analise=analyzeUnifiedProject(project,renderDeploys,vercelDeploys)
    const vercelDomain=project.vercel?chooseCanonicalVercelDomain(project.vercel,domains,project.especial==='painel'?(src.vercelCred.metadata?.productionOrigin||''):''):''
    const frontendUrl=vercelDomain?`https://${vercelDomain}`:(vercelDeploys[0]?.url||null)
    const renderUrl=project.render?.url||null
    const painel=project.especial==='painel'?{
      frontendOrigin:normalizeOrigin(src.vercelCred.metadata?.productionOrigin||frontendUrl||''),
      backendUrl:normalizeOrigin(src.renderCred.metadata?.backendUrl||renderUrl||''),
      corsOk:Boolean(normalizeOrigin(src.vercelCred.metadata?.productionOrigin||frontendUrl||'')&&isPlatformOriginAllowed(normalizeOrigin(src.vercelCred.metadata?.productionOrigin||frontendUrl||''))),
      mongo:{conectado:mongoose.connection.readyState===1,banco:mongoose.connection.name||null},
      backendVersion:BACKEND_VERSION,
      runtime:runtimeLabel(),
    }:null
    res.json({
      projeto:{...project,estado:analise.estado,ultimoDeploy:analise.latest,alertas:analise.alerts,stats:analise.stats},
      provedores:{
        render:project.render?{...project.render,url:renderUrl,deploys:renderDeploys}:null,
        vercel:project.vercel?{...project.vercel,url:frontendUrl,domains,deploys:vercelDeploys}:null,
      },
      timeline:analise.timeline,
      analise:{alertas:analise.alerts,stats:analise.stats,linkedBy:project.linkedBy,repo:project.git||null},
      painel,
      links:{site:frontendUrl,api:renderUrl,github:project.git?.url||null},
      sincronizadoEm:new Date().toISOString(),
    })
  }catch(err){next(err)}
})

// ── GET /plataformas/compatibilidade ─────────────────────────────
// Diagnóstico unificado do mesmo pacote em Termux/VPS e Vercel/Render.
// Não altera configuração: apenas informa o transporte e as integrações vistas.
router.get('/plataformas/compatibilidade', async (req,res,next)=>{
  try {
    const origin=String(req.headers.origin||'').trim()
    let originNormalized=''
    try { if(origin) originNormalized=new URL(origin).origin } catch {}
    let crossOrigin=false
    try { crossOrigin=Boolean(originNormalized && new URL(originNormalized).host!==req.get('host')) } catch {}

    const [github,render,vercel,cloudflare]=await Promise.all([
      getCredential('github','GITHUB_TOKEN').catch(()=>({value:'',locked:false,source:null})),
      getCredential('render','RENDER_API_KEY').catch(()=>({value:'',locked:false,source:null})),
      getCredential('vercel','VERCEL_TOKEN').catch(()=>({value:'',locked:false,source:null})),
      getCredential('cloudflare','CF_API_TOKEN').catch(()=>({value:'',locked:false,source:null,metadata:{}})),
    ])
    const cloudflareResolved=await getCloudflareConfig().catch(()=>({}))
    const r2Configured=Boolean(cloudflareResolved.r2AccessKeyId&&cloudflareResolved.r2SecretAccessKey)

    const siteDoc=await ConfiguracaoHome.findOne({chave:'site_url'}).lean().catch(()=>null)
    const frontendOrigin=originNormalized||String(siteDoc?.valor||process.env.FRONTEND_URL||'').split(',')[0].trim()
    const corsAllowed=originNormalized ? isPlatformOriginAllowed(originNormalized) : null
    const bearerUsed=Boolean(req.headers.authorization?.startsWith('Bearer '))
    const checks=[
      {id:'database',label:'MongoDB',ok:mongoose.connection.readyState===1,detail:mongoose.connection.readyState===1?`Conectado em ${mongoose.connection.name||'banco atual'}`:'Banco ainda não conectado'},
      {id:'cors',label:'Origem do frontend',ok:originNormalized?Boolean(corsAllowed):true,detail:originNormalized?(corsAllowed?'Autorizada pelo backend':`Não autorizada: ${originNormalized}`):'Sem Origin nesta requisição'},
      {id:'auth',label:'Sessão administrativa',ok:true,detail:bearerUsed?'Bearer de compatibilidade cloud ativo':'Cookie HttpOnly ativo'},
      {id:'github',label:'GitHub',ok:Boolean(github.value),detail:github.value?'Credencial disponível':github.locked?'Configurado, mas protegido por outra instalação':'Não configurado'},
      {id:'vercel',label:'Vercel',ok:Boolean(vercel.value),detail:vercel.value?'Credencial disponível':vercel.locked?'Configurada, mas protegida por outra instalação':'Não configurada'},
      {id:'render',label:'Render',ok:Boolean(render.value),detail:render.value?'Credencial disponível':render.locked?'Configurada, mas protegida por outra instalação':'Não configurada'},
      {id:'r2',label:'R2 Storage',ok:r2Configured,detail:r2Configured?'Credenciais S3 disponíveis':'Não configurado'},
    ]

    res.json({
      ok:checks.filter(c=>['database','cors','auth'].includes(c.id)).every(c=>c.ok),
      runtime:{
        label:runtimeLabel(),managed:IS_MANAGED_PLATFORM,render:IS_RENDER,vercel:IS_VERCEL,termux:IS_TERMUX,
        platform:process.platform,node:process.version,pid:process.pid,
      },
      frontend:{origin:frontendOrigin||'',requestOrigin:originNormalized||'',apiMode:crossOrigin?'cross-origin':'same-origin'},
      backend:{host:req.get('host'),protocol:req.protocol,render:IS_RENDER,url:process.env.RENDER_EXTERNAL_URL||process.env.AL_PUBLIC_BACKEND_URL||'',version:BACKEND_VERSION,commit:process.env.RENDER_GIT_COMMIT||'',branch:process.env.RENDER_GIT_BRANCH||'',repo:process.env.RENDER_GIT_REPO_SLUG||''},
      auth:{
        requestTransport:bearerUsed?'bearer':'cookie',cookieSupported:true,bearerFallback:true,crossOrigin,
        recommended:crossOrigin?'cookie + Bearer de fallback':'cookie HttpOnly',
        note:crossOrigin?'O fallback Bearer evita depender de cookies de terceiro entre Vercel e Render.':'Ambiente same-origin/local continua usando o cookie HttpOnly tradicional.',
      },
      cors:{allowed:corsAllowed,origin:originNormalized||'',origins:platformOrigins()},
      integrations:{
        github:{configured:Boolean(github.value)||Boolean(github.locked),usable:Boolean(github.value),source:github.source||null,locked:Boolean(github.locked)},
        vercel:{configured:Boolean(vercel.value)||Boolean(vercel.locked),usable:Boolean(vercel.value),source:vercel.source||null,locked:Boolean(vercel.locked)},
        render:{configured:Boolean(render.value)||Boolean(render.locked),usable:Boolean(render.value),source:render.source||null,locked:Boolean(render.locked)},
        r2:{configured:r2Configured},
      },
      compatibility:{
        termux:true,vps:true,vercelRender:true,
        localMode:'Cookie HttpOnly + filesystem persistente quando disponível',
        cloudMode:'Cookie quando aceito + Bearer de sessão como fallback; persistência em MongoDB/R2/GitHub',
      },
      checks,
      checkedAt:new Date().toISOString(),
    })
  } catch(err){next(err)}
})

router.get('/plataformas/central', async (_req,res,next)=>{
  try {
    const [renderCred,vercelCred]=await Promise.all([
      getCredential('render','RENDER_API_KEY'),
      getCredential('vercel','VERCEL_TOKEN'),
    ])
    const bootstrap=await ensurePersistentBootstrap().catch(()=>({installed:false,persistedSecrets:false,source:'indisponivel'}))
    const result={
      sincronizadoEm:new Date().toISOString(),
      bootstrap,
      credenciais:{
        render:{configurado:Boolean(renderCred.value)||Boolean(renderCred.locked),utilizavel:Boolean(renderCred.value),bloqueada:Boolean(renderCred.locked),origem:renderCred.source||null,mascarada:maskCredential(renderCred.value,renderCred.locked),atualizadoEm:renderCred.updatedAt||null},
        vercel:{configurado:Boolean(vercelCred.value)||Boolean(vercelCred.locked),utilizavel:Boolean(vercelCred.value),bloqueada:Boolean(vercelCred.locked),origem:vercelCred.source||null,mascarada:maskCredential(vercelCred.value,vercelCred.locked),teamId:vercelCred.metadata?.teamId||'',atualizadoEm:vercelCred.updatedAt||null},
      },
      render:{servicos:[],selecionado:null,deploys:[],erro:null},
      vercel:{projetos:[],selecionado:null,deploys:[],erro:null},
      producao:{frontendOrigin:'',backendUrl:'',corsOk:false,ligada:false},
      problemas:[],
      acoes:{
        publicar:'/admin/atualizacoes?acao=publicar',
        integracoes:'/admin/integracoes',
        erros:'/admin/erros',
        criarRender:'https://dashboard.render.com/new',
        criarVercel:'https://vercel.com/new',
        docsRender:'https://api-docs.render.com/reference/authentication',
        docsVercel:'https://vercel.com/docs/rest-api',
      },
    }

    try { result.render.servicos=await smartRenderServices(renderCred.value) } catch(err){ result.render.erro=err.message }
    try { result.vercel.projetos=await smartVercelProjects(vercelCred.value,vercelCred.metadata?.teamId||'') } catch(err){ result.vercel.erro=err.message }

    let renderId=renderCred.metadata?.primaryServiceId||''
    let vercelId=vercelCred.metadata?.primaryProjectId||''
    if(!renderId&&result.render.servicos.length===1)renderId=result.render.servicos[0].id
    if(!vercelId&&result.vercel.projetos.length===1)vercelId=result.vercel.projetos[0].id

    result.render.selecionado=result.render.servicos.find(x=>x.id===renderId)||null
    result.vercel.selecionado=result.vercel.projetos.find(x=>x.id===vercelId)||null

    if(result.render.selecionado) {
      try { result.render.deploys=await smartRenderDeploys(renderCred.value,result.render.selecionado.id) } catch(err){ result.render.deployError=err.message }
    }
    if(result.vercel.selecionado) {
      try {
        const domains=await smartVercelProjectDomains(vercelCred.value,vercelCred.metadata?.teamId||'',result.vercel.selecionado.id)
        const canonical=chooseCanonicalVercelDomain(result.vercel.selecionado,domains,vercelCred.metadata?.productionOrigin||'')
        result.vercel.selecionado={...result.vercel.selecionado,domains,dominios:domains.map(d=>d.name),dominio:canonical||result.vercel.selecionado.dominio||null}
      } catch(err){ result.vercel.domainError=err.message }
      try { result.vercel.deploys=await smartVercelDeploys(vercelCred.value,vercelCred.metadata?.teamId||'',result.vercel.selecionado.id) } catch(err){ result.vercel.deployError=err.message }
    }

    const canonicalDomain=result.vercel.selecionado
      ? chooseCanonicalVercelDomain(result.vercel.selecionado,result.vercel.selecionado.domains||[],vercelCred.metadata?.productionOrigin||'')
      : ''
    let frontendOrigin=canonicalDomain?normalizeOrigin(`https://${canonicalDomain}`):''
    // Nunca usa a URL única de um deployment como origem pública. A URL longa
    // continua visível no histórico de deploys somente para diagnóstico.
    if(!frontendOrigin&&result.vercel.selecionado?.dominio)frontendOrigin=normalizeOrigin(`https://${result.vercel.selecionado.dominio}`)
    const backendUrl=normalizeOrigin(result.render.selecionado?.url||renderCred.metadata?.backendUrl||'')
    if(frontendOrigin){
      registerPlatformOrigin(frontendOrigin)
      // Autocura dados antigos que gravaram uma URL única de deployment como URL pública.
      // A URL canônica vem exclusivamente dos domínios associados ao projeto Vercel.
      if(normalizeOrigin(vercelCred.metadata?.productionOrigin||'')!==frontendOrigin){
        await Promise.all([
          setCredential('vercel',vercelCred.value,{...(vercelCred.metadata||{}),primaryProjectId:result.vercel.selecionado?.id||vercelId,productionOrigin:frontendOrigin,domains:(result.vercel.selecionado?.domains||[]).filter(d=>!d.gitBranch).map(d=>d.name)}),
          ConfiguracaoHome.findOneAndUpdate({chave:'site_url'},{$set:{valor:frontendOrigin,descricao:'URL pública canônica do portal em produção'}},{upsert:true}),
        ]).catch(()=>null)
        await hydratePlatformOrigins({remote:true,force:true}).catch(()=>null)
      }
    }

    const currentVercelDeployment=result.vercel.deploys.find(d=>d.ambiente==='production')||result.vercel.deploys[0]||null
    result.producao={
      frontendOrigin,backendUrl,
      productionDomain:frontendOrigin,
      currentDeploymentUrl:currentVercelDeployment?.url||'',
      corsOk:Boolean(frontendOrigin&&isPlatformOriginAllowed(frontendOrigin)),
      ligada:Boolean(frontendOrigin&&backendUrl),
      renderServiceId:result.render.selecionado?.id||'',
      vercelProjectId:result.vercel.selecionado?.id||'',
      origins:platformOrigins(),
    }

    if(!bootstrap.persistedSecrets)result.problemas.push({id:'bootstrap',nivel:'warning',titulo:'Bootstrap da nuvem ainda não confirmado',descricao:'A instalação ainda não confirmou no Mongo a chave estável usada por login e Integrações. Faça a migração antes de abandonar o ambiente antigo.',acao:'integracoes'})
    if(!renderCred.value)result.problemas.push({id:'render-credential',nivel:'warning',titulo:'Render não conectado',descricao:'Cadastre a API Key na Central de Integrações para ler serviços e deploys.',acao:'integracoes'})
    if(!vercelCred.value)result.problemas.push({id:'vercel-credential',nivel:'warning',titulo:'Vercel não conectada',descricao:'Cadastre o Access Token na Central de Integrações para ler projetos e deploys.',acao:'integracoes'})
    if(renderCred.locked||vercelCred.locked)result.problemas.push({id:'credential-key',nivel:'critical',titulo:'Credencial protegida por outra instalação',descricao:'A chave de criptografia precisa ser sincronizada ou a credencial deve ser substituída.',acao:'integracoes'})
    if(result.render.erro)result.problemas.push({id:'render-api',nivel:'error',titulo:'Render não respondeu como esperado',descricao:result.render.erro,acao:'docs-render'})
    if(result.vercel.erro)result.problemas.push({id:'vercel-api',nivel:'error',titulo:'Vercel não respondeu como esperado',descricao:result.vercel.erro,acao:'docs-vercel'})
    if(/fail|error/i.test(String(result.render.deploys[0]?.status||'')))result.problemas.push({id:'render-deploy',nivel:'error',titulo:'Último deploy do backend falhou',descricao:'O serviço selecionado na Render está com o deploy mais recente em erro.',acao:'render'})
    if(/fail|error/i.test(String(result.vercel.deploys[0]?.estado||'')))result.problemas.push({id:'vercel-deploy',nivel:'error',titulo:'Último deploy do frontend falhou',descricao:'O projeto selecionado na Vercel está com o deploy mais recente em erro.',acao:'vercel',url:result.vercel.deploys[0]?.url})
    if(frontendOrigin&&!result.producao.corsOk)result.problemas.push({id:'cors',nivel:'critical',titulo:'Frontend ainda não autorizado pelo backend',descricao:`A origem ${frontendOrigin} precisa entrar na conexão de produção.`,acao:'conectar-producao'})

    if(frontendOrigin) {
      const since=new Date(Date.now()-24*60*60*1000)
      const corsCount=await ErroLog.countDocuments({
        mensagem:{$regex:`CORS: origem não permitida.*${escapeRegex(frontendOrigin)}`,$options:'i'},
        criado_em:{$gte:since},
      }).catch(()=>0)
      if(corsCount>0)result.problemas.push({id:'cors-history',nivel:'warning',titulo:`${corsCount} bloqueio(s) CORS nas últimas 24h`,descricao:'O Monitor de Erros registrou requisições do frontend recusadas pelo backend.',acao:'erros'})
    }

    res.json(result)
  } catch(err){next(err)}
})

router.put('/plataformas/producao', async (req,res,next)=>{
  try {
    const renderServiceId=String(req.body?.renderServiceId||'').trim()
    const vercelProjectId=String(req.body?.vercelProjectId||'').trim()
    const originInformada=normalizeOrigin(req.body?.frontendOrigin||'')
    if(!renderServiceId||!vercelProjectId)return res.status(400).json({erro:'Selecione o serviço Render e o projeto Vercel da produção.'})

    const [renderCred,vercelCred]=await Promise.all([
      getCredential('render','RENDER_API_KEY'),
      getCredential('vercel','VERCEL_TOKEN'),
    ])
    if(!renderCred.value||!vercelCred.value)return res.status(409).json({erro:'Render e Vercel precisam estar conectadas em Integrações e APIs.'})

    const [servicos,projetos]=await Promise.all([
      smartRenderServices(renderCred.value),
      smartVercelProjects(vercelCred.value,vercelCred.metadata?.teamId||''),
    ])
    const service=servicos.find(x=>x.id===renderServiceId)
    const project=projetos.find(x=>x.id===vercelProjectId)
    if(!service||!project)return res.status(404).json({erro:'Serviço ou projeto não encontrado na conta conectada.'})

    const domains=await smartVercelProjectDomains(vercelCred.value,vercelCred.metadata?.teamId||'',project.id).catch(()=>[])
    const canonicalDomain=chooseCanonicalVercelDomain(project,domains,originInformada||vercelCred.metadata?.productionOrigin||'')
    const frontendOrigin=originInformada
      ? (()=>{try{const host=new URL(originInformada).hostname.toLowerCase();return domains.some(d=>d.name.toLowerCase()===host)?normalizeOrigin(originInformada):canonicalDomain?normalizeOrigin(`https://${canonicalDomain}`):''}catch{return ''}})()
      : canonicalDomain?normalizeOrigin(`https://${canonicalDomain}`):''
    if(!frontendOrigin)return res.status(400).json({erro:'Não foi possível determinar um domínio público associado ao projeto Vercel. Sincronize os domínios e tente novamente.'})
    const backendUrl=normalizeOrigin(service.url||'')

    await Promise.all([
      setCredential('render',renderCred.value,{...(renderCred.metadata||{}),primaryServiceId:service.id,backendUrl}),
      setCredential('vercel',vercelCred.value,{...(vercelCred.metadata||{}),primaryProjectId:project.id,productionOrigin:frontendOrigin,domains:domains.filter(d=>!d.gitBranch).map(d=>d.name)}),
      ConfiguracaoHome.findOneAndUpdate({chave:'site_url'},{$set:{valor:frontendOrigin,descricao:'URL pública canônica do portal em produção'}},{upsert:true}),
    ])
    registerPlatformOrigin(frontendOrigin)
    await hydratePlatformOrigins({remote:false,force:true}).catch(()=>null)

    res.json({
      ok:true,
      mensagem:'Produção conectada: Vercel → Render → MongoDB.',
      producao:{frontendOrigin,backendUrl,renderServiceId:service.id,vercelProjectId:project.id,corsOk:isPlatformOriginAllowed(frontendOrigin)},
    })
  } catch(err){next(err)}
})

router.post('/plataformas/recarregar-origens', async (_req,res,next)=>{
  try {
    const vercelCred=await getCredential('vercel','VERCEL_TOKEN')
    let correctedOrigin=''
    let domains=[]
    if(vercelCred.value&&vercelCred.metadata?.primaryProjectId){
      const projects=await smartVercelProjects(vercelCred.value,vercelCred.metadata?.teamId||'')
      const project=projects.find(p=>p.id===vercelCred.metadata.primaryProjectId)
      if(project){
        domains=await smartVercelProjectDomains(vercelCred.value,vercelCred.metadata?.teamId||'',project.id).catch(()=>[])
        const canonical=chooseCanonicalVercelDomain(project,domains,vercelCred.metadata?.productionOrigin||'')
        correctedOrigin=canonical?normalizeOrigin(`https://${canonical}`):''
        if(correctedOrigin){
          await Promise.all([
            setCredential('vercel',vercelCred.value,{...(vercelCred.metadata||{}),productionOrigin:correctedOrigin,domains:domains.filter(d=>!d.gitBranch).map(d=>d.name)}),
            ConfiguracaoHome.findOneAndUpdate({chave:'site_url'},{$set:{valor:correctedOrigin,descricao:'URL pública canônica do portal em produção'}},{upsert:true}),
          ])
          registerPlatformOrigin(correctedOrigin)
        }
      }
    }
    const origins=await hydratePlatformOrigins({remote:true,force:true})
    res.json({ok:true,origins,total:origins.length,correctedOrigin,domains:domains.map(d=>d.name),message:correctedOrigin?`URL pública sincronizada: ${correctedOrigin}`:'Origens recarregadas; nenhum domínio canônico novo foi encontrado.'})
  } catch(err){next(err)}
})


// ── Operações inteligentes Render ─────────────────────────────
router.get('/plataformas/render/servicos/:serviceId/env', async (req,res,next)=>{
  try {
    const cred=await getCredential('render','RENDER_API_KEY')
    if(!cred.value)return res.status(409).json({erro:'Render não conectada em Integrações e APIs.'})
    const env=await smartRenderEnv(cred.value,req.params.serviceId)
    res.json({env,total:env.length,segredosMascarados:true})
  } catch(err){next(err)}
})

router.post('/plataformas/render/servicos/:serviceId/env/:key/reveal', exigirStepUpSePolitica, async(req,res,next)=>{
  try{
    const cred=await getCredential('render','RENDER_API_KEY'); if(!cred.value)return res.status(409).json({erro:'Render não conectada.'})
    const key=String(req.params.key||'').trim()
    if(!key)return res.status(400).json({erro:'Informe a variável da Render.'})
    const raw=await renderApi(cred.value,`/v1/services/${encodeURIComponent(req.params.serviceId)}/env-vars/${encodeURIComponent(key)}`)
    const found=raw?.envVar||raw||{}
    const value=found?.value
    if(value===undefined||value===null||/^[*•]+$/.test(String(value)))return res.status(409).json({erro:'A Render não disponibilizou o valor original desta variável pela API. Substitua o valor para atualizá-la.'})
    res.set('Cache-Control','no-store, private');res.set('Pragma','no-cache');res.json({ok:true,value:String(value),source:'Render',updatedAt:found?.updatedAt||found?.updated_at||null})
  }catch(err){next(err)}
})

router.put('/plataformas/render/servicos/:serviceId/env/:key', exigirStepUpSePolitica, async (req,res,next)=>{
  try {
    const cred=await getCredential('render','RENDER_API_KEY')
    if(!cred.value)return res.status(409).json({erro:'Render não conectada em Integrações e APIs.'})
    const key=String(req.params.key||'').trim()
    const value=String(req.body?.value??'')
    const deployAfter=req.body?.deploy===true
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))return res.status(400).json({erro:'Nome de variável inválido.'})
    if(!value)return res.status(400).json({erro:'Informe o novo valor.'})
    await renderApi(cred.value,`/v1/services/${encodeURIComponent(req.params.serviceId)}/env-vars/${encodeURIComponent(key)}`,{
      method:'PUT',body:{value},
    })
    let deploy=null
    if(deployAfter){
      deploy=await renderApi(cred.value,`/v1/services/${encodeURIComponent(req.params.serviceId)}/deploys`,{
        method:'POST',body:{clearCache:'do_not_clear'},
      })
    }
    res.json({
      ok:true,key,valueMasked:maskSecretValue(value),deploy,
      mensagem:deployAfter?`${key} salva e novo deploy iniciado na Render.`:`${key} atualizada na Render. Faça um novo deploy para aplicar a mudança.`,
      requerDeploy:!deployAfter,
    })
  } catch(err){next(err)}
})

router.delete('/plataformas/render/servicos/:serviceId/env/:key', exigirStepUpSePolitica, async (req,res,next)=>{
  try {
    const cred=await getCredential('render','RENDER_API_KEY')
    if(!cred.value)return res.status(409).json({erro:'Render não conectada em Integrações e APIs.'})
    const key=String(req.params.key||'').trim()
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))return res.status(400).json({erro:'Nome de variável inválido.'})
    await renderApi(cred.value,`/v1/services/${encodeURIComponent(req.params.serviceId)}/env-vars/${encodeURIComponent(key)}`,{method:'DELETE'})
    res.json({ok:true,key,mensagem:`${key} removida da Render. Um novo deploy é necessário para aplicar a mudança.`,requerDeploy:true})
  } catch(err){next(err)}
})

router.post('/plataformas/render/servicos/:serviceId/deploy', async (req,res,next)=>{
  try {
    const cred=await getCredential('render','RENDER_API_KEY')
    if(!cred.value)return res.status(409).json({erro:'Render não conectada em Integrações e APIs.'})
    const clearCache=req.body?.clearCache===true?'clear':'do_not_clear'
    const commitId=String(req.body?.commitId||'').trim()
    const deploy=await renderApi(cred.value,`/v1/services/${encodeURIComponent(req.params.serviceId)}/deploys`,{
      method:'POST',
      body:{clearCache,...(commitId?{commitId}:{})},
    })
    res.status(201).json({ok:true,deploy,mensagem:clearCache==='clear'?'Deploy iniciado com limpeza do cache.':'Deploy iniciado na Render.'})
  } catch(err){next(err)}
})

router.post('/plataformas/render/servicos/:serviceId/restart', async (req,res,next)=>{
  try {
    const cred=await getCredential('render','RENDER_API_KEY')
    if(!cred.value)return res.status(409).json({erro:'Render não conectada em Integrações e APIs.'})
    await renderApi(cred.value,`/v1/services/${encodeURIComponent(req.params.serviceId)}/restart`,{method:'POST'})
    res.json({ok:true,mensagem:'Serviço reiniciado na Render.'})
  } catch(err){next(err)}
})

router.post('/plataformas/render/servicos/:serviceId/rollback', async (req,res,next)=>{
  try {
    const cred=await getCredential('render','RENDER_API_KEY')
    if(!cred.value)return res.status(409).json({erro:'Render não conectada em Integrações e APIs.'})
    const deployId=String(req.body?.deployId||'').trim()
    if(!deployId)return res.status(400).json({erro:'Selecione o deploy de destino.'})
    const deploy=await renderApi(cred.value,`/v1/services/${encodeURIComponent(req.params.serviceId)}/rollback`,{
      method:'POST',body:{deployId},
    })
    res.status(201).json({ok:true,deploy,mensagem:'Rollback solicitado na Render.'})
  } catch(err){next(err)}
})

router.post('/plataformas/render/servicos/:serviceId/deploys/:deployId/cancelar', async (req,res,next)=>{
  try {
    const cred=await getCredential('render','RENDER_API_KEY')
    if(!cred.value)return res.status(409).json({erro:'Render não conectada em Integrações e APIs.'})
    const result=await renderApi(cred.value,`/v1/services/${encodeURIComponent(req.params.serviceId)}/deploys/${encodeURIComponent(req.params.deployId)}/cancel`,{method:'POST'})
    res.json({ok:true,result,mensagem:'Cancelamento solicitado na Render.'})
  } catch(err){next(err)}
})

router.get('/plataformas/render/servicos/:serviceId/logs', async (req,res,next)=>{
  try {
    const cred=await getCredential('render','RENDER_API_KEY')
    if(!cred.value)return res.status(409).json({erro:'Render não conectada em Integrações e APIs.'})
    const services=await smartRenderServices(cred.value)
    const service=services.find(x=>x.id===req.params.serviceId)
    if(!service)return res.status(404).json({erro:'Serviço Render não encontrado.'})
    const deploymentId=String(req.query.deploymentId||'').trim()
    let range={startTime:'',endTime:'',allowFallback:true}
    let deployment=null
    if(deploymentId) {
      const depData=await renderApi(cred.value,`/v1/services/${encodeURIComponent(service.id)}/deploys/${encodeURIComponent(deploymentId)}`)
      deployment=depData?.deploy||depData||null
      const created=deployment?.createdAt?new Date(deployment.createdAt):null
      const finished=deployment?.finishedAt?new Date(deployment.finishedAt):new Date()
      if(created&&!Number.isNaN(created.getTime())) {
        range={
          startTime:new Date(created.getTime()-(5*60*1000)).toISOString(),
          endTime:new Date(finished.getTime()+(10*60*1000)).toISOString(),
          allowFallback:false,
        }
      }
    }
    const result=await smartRenderLogs(cred.value,service.ownerId,service.id,{
      scope:String(req.query.scope||'all'),
      hours:Number(req.query.hours||24),
      limit:Number(req.query.limit||100),
      ...range,
    })
    res.json({...result,total:result.logs.length,deploymentId:deploymentId||null,deploymentScoped:Boolean(range.startTime),service:{id:service.id,nome:service.nome}})
  } catch(err){next(err)}
})

// ── Inspeção segura Vercel ────────────────────────────────────
router.get('/plataformas/vercel/projetos/:projectId/env', async (req,res,next)=>{
  try {
    const cred=await getCredential('vercel','VERCEL_TOKEN')
    if(!cred.value)return res.status(409).json({erro:'Vercel não conectada em Integrações e APIs.'})
    const env=await smartVercelEnv(cred.value,cred.metadata?.teamId||'',req.params.projectId)
    res.json({env,total:env.length,segredosMascarados:true})
  } catch(err){next(err)}
})

router.post('/plataformas/vercel/projetos/:projectId/env/:key/reveal', exigirStepUpSePolitica, async(req,res,next)=>{
  try{
    const cred=await getCredential('vercel','VERCEL_TOKEN'); if(!cred.value)return res.status(409).json({erro:'Vercel não conectada.'})
    const projectId=String(req.params.projectId||'').trim(), key=String(req.params.key||'').trim(), envId=String(req.body?.envId||'').trim(), teamId=cred.metadata?.teamId||''
    const data=await vercelApi(cred.value,`/v9/projects/${encodeURIComponent(projectId)}/env`,teamId); const rows=data?.envs||data?.env||[]; const found=rows.find(x=>(envId&&x.id===envId)||(!envId&&x.key===key))
    if(!found)return res.status(404).json({erro:'Variável não encontrada na Vercel.'})
    if(found.type==='sensitive')return res.status(409).json({erro:'Esta variável é sensível. A Vercel não permite recuperar o valor original depois de salvo; apenas substituí-lo.'})
    const id=envId||found.id
    if(!id)return res.status(409).json({erro:'A Vercel não forneceu o ID necessário para recuperar esta variável.'})
    const detail=await vercelApi(cred.value,`/v1/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(id)}`,teamId)
    const value=detail?.value
    if(value===undefined||value===null||/^[*•]+$/.test(String(value)))return res.status(409).json({erro:'A Vercel não disponibilizou o valor original desta variável pela API. Substitua o valor para atualizá-la.'})
    res.set('Cache-Control','no-store, private');res.set('Pragma','no-cache');res.json({ok:true,value:String(value),source:'Vercel',updatedAt:detail?.updatedAt||found?.updatedAt||found?.createdAt||null})
  }catch(err){next(err)}
})

router.put('/plataformas/vercel/projetos/:projectId/env/:key', exigirStepUpSePolitica, async (req,res,next)=>{
  try {
    const cred=await getCredential('vercel','VERCEL_TOKEN')
    if(!cred.value)return res.status(409).json({erro:'Vercel não conectada em Integrações e APIs.'})
    const projectId=String(req.params.projectId||'').trim()
    const key=String(req.params.key||'').trim()
    const value=String(req.body?.value??'')
    const teamId=cred.metadata?.teamId||''
    const targetRaw=Array.isArray(req.body?.target)?req.body.target:[req.body?.target||'production']
    const target=[...new Set(targetRaw.map(x=>String(x||'').trim()).filter(x=>['production','preview','development'].includes(x)))]
    const envType=req.body?.sensitive===true?'sensitive':'encrypted'
    const deployAfter=req.body?.deploy===true
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))return res.status(400).json({erro:'Nome de variável inválido.'})
    if(!value)return res.status(400).json({erro:'Informe o novo valor.'})
    if(!target.length)target.push('production')
    const current=await smartVercelEnv(cred.value,teamId,projectId)
    const envId=String(req.body?.envId||'').trim()||current.find(x=>x.key===key&&target.some(t=>(x.target||[]).includes(t)))?.id||''
    let saved
    if(envId){
      saved=await vercelApi(cred.value,`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(envId)}`,teamId,{
        method:'PATCH',body:{key,value,target,type:envType},
      })
    }else{
      saved=await vercelApi(cred.value,`/v10/projects/${encodeURIComponent(projectId)}/env`,teamId,{
        method:'POST',body:{key,value,target,type:envType},
      })
    }
    let deploy=null
    if(deployAfter){
      const latest=(await smartVercelDeploys(cred.value,teamId,projectId,1))[0]
      if(latest?.id)deploy=await vercelApi(cred.value,'/v13/deployments',teamId,{method:'POST',body:{deploymentId:latest.id}})
    }
    res.json({ok:true,key,id:saved?.id||saved?.created?.id||envId||null,valueMasked:maskSecretValue(value),target,type:envType,deploy,
      mensagem:deployAfter?(deploy?`${key} salva e redeploy iniciado na Vercel.`:`${key} salva na Vercel; não havia deployment para refazer.`):`${key} salva na Vercel. Faça um novo deploy para aplicar a mudança.`,
      requerDeploy:!deployAfter||!deploy})
  } catch(err){next(err)}
})

router.delete('/plataformas/vercel/projetos/:projectId/env/:key', exigirStepUpSePolitica, async (req,res,next)=>{
  try {
    const cred=await getCredential('vercel','VERCEL_TOKEN')
    if(!cred.value)return res.status(409).json({erro:'Vercel não conectada em Integrações e APIs.'})
    const projectId=String(req.params.projectId||'').trim()
    const key=String(req.params.key||'').trim()
    const envId=String(req.query?.envId||'').trim()
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))return res.status(400).json({erro:'Nome de variável inválido.'})
    const idOrKey=envId||key
    await vercelApi(cred.value,`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(idOrKey)}`,cred.metadata?.teamId||'',{method:'DELETE'})
    res.json({ok:true,key,mensagem:`${key} removida da Vercel. Um novo deploy é necessário para aplicar a mudança.`,requerDeploy:true})
  } catch(err){next(err)}
})

router.put('/plataformas/producao/env/:provider/:key', exigirStepUpSePolitica, async (req,res,next)=>{
  try {
    const provider=String(req.params.provider||'').toLowerCase()
    const key=String(req.params.key||'').trim()
    const value=String(req.body?.value??'')
    const deployAfter=req.body?.deploy===true
    if(!['vercel','render'].includes(provider))return res.status(400).json({erro:'Provedor inválido.'})
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))return res.status(400).json({erro:'Nome de variável inválido.'})
    if(!value)return res.status(400).json({erro:'Informe o valor da variável.'})
    if(provider==='render'){
      const cred=await getCredential('render','RENDER_API_KEY')
      if(!cred.value)return res.status(409).json({erro:'Render não conectada.'})
      const serviceId=cred.metadata?.primaryServiceId||''
      if(!serviceId)return res.status(409).json({erro:'Defina primeiro o backend Render principal em Projetos e Deploys.'})
      await renderApi(cred.value,`/v1/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`,{method:'PUT',body:{value}})
      let deploy=null
      if(deployAfter)deploy=await renderApi(cred.value,`/v1/services/${encodeURIComponent(serviceId)}/deploys`,{method:'POST',body:{clearCache:'do_not_clear'}})
      return res.json({ok:true,provider,key,targetId:serviceId,deploy,mensagem:deployAfter?`${key} aplicada no backend principal e deploy iniciado.`:`${key} aplicada no backend principal.`})
    }
    const cred=await getCredential('vercel','VERCEL_TOKEN')
    if(!cred.value)return res.status(409).json({erro:'Vercel não conectada.'})
    const projectId=cred.metadata?.primaryProjectId||''
    const teamId=cred.metadata?.teamId||''
    if(!projectId)return res.status(409).json({erro:'Defina primeiro o frontend Vercel principal em Projetos e Deploys.'})
    const current=await smartVercelEnv(cred.value,teamId,projectId)
    const existing=current.find(x=>x.key===key&&(x.target||[]).includes('production'))
    if(existing?.id)await vercelApi(cred.value,`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(existing.id)}`,teamId,{method:'PATCH',body:{key,value,target:['production'],type:'encrypted'}})
    else await vercelApi(cred.value,`/v10/projects/${encodeURIComponent(projectId)}/env`,teamId,{method:'POST',body:{key,value,target:['production'],type:'encrypted'}})
    let deploy=null
    if(deployAfter){const latest=(await smartVercelDeploys(cred.value,teamId,projectId,1))[0];if(latest?.id)deploy=await vercelApi(cred.value,'/v13/deployments',teamId,{method:'POST',body:{deploymentId:latest.id}})}
    res.json({ok:true,provider,key,targetId:projectId,deploy,mensagem:deployAfter?(deploy?`${key} aplicada no frontend principal e redeploy iniciado.`:`${key} aplicada na Vercel; não havia deployment para refazer.`):`${key} aplicada no frontend principal.`})
  } catch(err){next(err)}
})

router.get('/plataformas/vercel/deploys/:deploymentId/logs', async (req,res,next)=>{
  try {
    const cred=await getCredential('vercel','VERCEL_TOKEN')
    if(!cred.value)return res.status(409).json({erro:'Vercel não conectada em Integrações e APIs.'})
    const result=await smartVercelLogs(cred.value,cred.metadata?.teamId||'',req.params.deploymentId)
    res.json({...result,total:result.logs.length,deploymentId:req.params.deploymentId})
  } catch(err){next(err)}
})

router.post('/plataformas/vercel/deploys/:deploymentId/redeploy', async (req,res,next)=>{
  try {
    const cred=await getCredential('vercel','VERCEL_TOKEN')
    if(!cred.value)return res.status(409).json({erro:'Vercel não conectada em Integrações e APIs.'})
    const deploymentId=String(req.params.deploymentId||'').trim()
    if(!deploymentId)return res.status(400).json({erro:'Deployment Vercel inválido.'})
    const body={deploymentId}
    const name=String(req.body?.name||'').trim()
    if(name)body.name=name
    const deploy=await vercelApi(cred.value,'/v13/deployments',cred.metadata?.teamId||'',{method:'POST',body})
    res.status(201).json({
      ok:true,deploy,
      mensagem:'Redeploy iniciado na Vercel usando as configurações do deployment selecionado.',
    })
  } catch(err){next(err)}
})

router.patch('/plataformas/vercel/deploys/:deploymentId/cancelar', async (req,res,next)=>{
  try {
    const cred=await getCredential('vercel','VERCEL_TOKEN')
    if(!cred.value)return res.status(409).json({erro:'Vercel não conectada em Integrações e APIs.'})
    const result=await vercelApi(
      cred.value,
      `/v12/deployments/${encodeURIComponent(req.params.deploymentId)}/cancel`,
      cred.metadata?.teamId||'',
      {method:'PATCH'},
    )
    res.json({ok:true,result,mensagem:'Cancelamento solicitado na Vercel.'})
  } catch(err){next(err)}
})

export default router
