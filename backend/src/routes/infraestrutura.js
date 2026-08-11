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
import { v2 as cloudinary } from 'cloudinary'
import { autenticar }        from '../middleware/auth.js'
import { runtimeLabel, IS_RENDER, IS_VERCEL, IS_TERMUX, IS_MANAGED_PLATFORM } from '../utils/runtimeEnvironment.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'

let BACKEND_VERSION='desconhecida'
try { BACKEND_VERSION=JSON.parse(fsSync.readFileSync(new URL('../../package.json', import.meta.url),'utf8')).version||BACKEND_VERSION } catch {}

const router = Router()
router.use(autenticar)
router.use(verificarPermissao('configuracoes.gerenciar'))

// ─── helper: reconfigura Cloudinary com .env atual ────────────
function configurarCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME  || '',
    api_key:    process.env.CLOUDINARY_API_KEY      || '',
    api_secret: process.env.CLOUDINARY_API_SECRET   || '',
  })
}

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
    configurarCloudinary()
    const temCredenciais =
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY    &&
      process.env.CLOUDINARY_API_SECRET

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
    configurarCloudinary()

    const temCredenciais =
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY    &&
      process.env.CLOUDINARY_API_SECRET

    if (!temCredenciais) {
      return res.status(400).json({ erro: 'Cloudinary não configurado. Insira as credenciais na aba Configurações.' })
    }

    const uso = await cloudinary.api.usage()

    res.json({
      cloud_name:     process.env.CLOUDINARY_CLOUD_NAME,
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
    configurarCloudinary()

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
    configurarCloudinary()

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
    const indices = await db.collection(nome).getIndexes()
    // Transforma para formato amigável
    const lista = Object.entries(indices).map(([name, spec]) => ({
      name,
      key: spec.key,
      unique: spec.unique || false,
      sparse: spec.sparse || false,
      background: spec.background || false,
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
        aiProvider:   process.env.AI_PROVIDER   || '—',
        groqModel:    process.env.GROQ_MODEL    || '—',
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
  groq:      { env: 'GROQ_API_KEY', label: 'Groq API Key' },
  anthropic: { env: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key' },
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
  const r=await fetch('https://api.render.com/v1/services?limit=30',{headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'}})
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
async function smartRenderDeploys(apiKey,serviceId) {
  if(!apiKey||!serviceId)return []
  const r=await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys?limit=8`,{headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'}})
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
  const r=await fetch(vercelUrl('/v9/projects?limit=30',teamId),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}})
  if(!r.ok)throw new Error(`Vercel API retornou ${r.status}`)
  const data=await r.json()
  return (data.projects||[]).map(p=>{
    const aliases=(Array.isArray(p.alias)?p.alias:[]).map(a=>String(a))
    const stable=aliases.find(a=>a.toLowerCase()===`${String(p.name||'').toLowerCase()}.vercel.app`)||null
    return {
      id:p.id,nome:p.name,framework:p.framework||'—',
      dominios:aliases,dominio:stable,
      atualizado:p.updatedAt,
      git:p.link?{tipo:p.link.type,repositorio:p.link.repo,repoId:p.link.repoId||null}:null,
    }
  })
}

async function smartVercelProjectDomains(token,teamId='',projectId='') {
  if(!token||!projectId)return []
  const r=await fetch(vercelUrl(`/v9/projects/${encodeURIComponent(projectId)}/domains?limit=100`,teamId),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}})
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
async function smartVercelDeploys(token,teamId,projectId) {
  if(!token||!projectId)return []
  const r=await fetch(vercelUrl(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=8`,teamId),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}})
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
  })
  const payload=await r.json().catch(()=>null)
  if(!r.ok) {
    const detail=payload?.message||payload?.error||payload?.errors?.[0]?.message||`HTTP ${r.status}`
    throw new Error(`Render: ${detail}`)
  }
  return payload
}

async function vercelApi(token,pathName,teamId='') {
  const url=vercelUrl(pathName,teamId)
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}})
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
      valueMasked:maskSecretValue(item.value),
      configured:item.value!==undefined&&item.value!==null,
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
    valueMasked:item.value?maskSecretValue(item.value):'protegida',
  })).filter(x=>x.key)
}

async function smartVercelLogs(token,teamId,deploymentId) {
  const data=await vercelApi(token,`/v3/deployments/${encodeURIComponent(deploymentId)}/events?direction=backward&limit=100`,teamId)
  return (Array.isArray(data)?data:[]).map((event,index)=>({
    id:event?.payload?.id||`${deploymentId}-${index}`,
    tipo:event.type||'event',
    criado:event.created||event?.payload?.created||null,
    texto:event?.payload?.text||event?.payload?.info?.name||event?.payload?.info?.step||'',
    statusCode:event?.payload?.statusCode||null,
  })).filter(x=>x.texto||x.tipo)
}

async function smartRenderLogs(apiKey,ownerId,serviceId) {
  if(!ownerId||!serviceId)return []
  const p=new URLSearchParams({ownerId,direction:'backward',limit:'80'})
  p.append('resource',serviceId)
  const data=await renderApi(apiKey,`/v1/logs?${p.toString()}`)
  const rows=data?.logs||data?.items||[]
  return rows.map((row,index)=>({
    id:row.id||`${serviceId}-${index}`,
    criado:row.timestamp||row.createdAt||row.time||null,
    nivel:row.level||row.severity||'',
    tipo:row.type||'app',
    texto:row.message||row.text||row.body||'',
  })).filter(x=>x.texto)
}



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
    let r2Configured=false
    try {
      const parsed=JSON.parse(cloudflare.value||'{}')
      r2Configured=Boolean(parsed.r2AccessKeyId&&parsed.r2SecretAccessKey)
    } catch {
      r2Configured=Boolean(process.env.CF_R2_ACCESS_KEY_ID&&process.env.CF_R2_SECRET_ACCESS_KEY)
    }

    const siteDoc=await ConfiguracaoHome.findOne({chave:'site_url'}).lean().catch(()=>null)
    const frontendOrigin=originNormalized||String(siteDoc?.valor||process.env.FRONTEND_URL||'').split(',')[0].trim()
    const corsAllowed=originNormalized ? isPlatformOriginAllowed(originNormalized) : null
    const bearerUsed=Boolean(req.headers.authorization?.startsWith('Bearer '))
    const checks=[
      {id:'database',label:'MongoDB',ok:mongoose.connection.readyState===1,detail:mongoose.connection.readyState===1?`Conectado em ${mongoose.connection.name||'banco atual'}`:'Banco ainda não conectado'},
      {id:'cors',label:'Origem do frontend',ok:originNormalized?Boolean(corsAllowed):true,detail:originNormalized?(corsAllowed?'Autorizada pelo backend':`Não autorizada: ${originNormalized}`):'Sem Origin nesta requisição'},
      {id:'auth',label:'Sessão administrativa',ok:true,detail:bearerUsed?'Bearer de compatibilidade cloud ativo':'Cookie HttpOnly ativo'},
      {id:'github',label:'GitHub',ok:Boolean(github.value),detail:github.value?'Credencial disponível':'Não configurado'},
      {id:'vercel',label:'Vercel',ok:Boolean(vercel.value),detail:vercel.value?'Credencial disponível':'Não configurado'},
      {id:'render',label:'Render',ok:Boolean(render.value),detail:render.value?'Credencial disponível':'Não configurado'},
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
        github:{configured:Boolean(github.value),source:github.source||null,locked:Boolean(github.locked)},
        vercel:{configured:Boolean(vercel.value),source:vercel.source||null,locked:Boolean(vercel.locked)},
        render:{configured:Boolean(render.value),source:render.source||null,locked:Boolean(render.locked)},
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

router.put('/plataformas/render/servicos/:serviceId/env/:key', async (req,res,next)=>{
  try {
    const cred=await getCredential('render','RENDER_API_KEY')
    if(!cred.value)return res.status(409).json({erro:'Render não conectada em Integrações e APIs.'})
    const key=String(req.params.key||'').trim()
    const value=String(req.body?.value??'')
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))return res.status(400).json({erro:'Nome de variável inválido.'})
    if(!value)return res.status(400).json({erro:'Informe o novo valor.'})
    await renderApi(cred.value,`/v1/services/${encodeURIComponent(req.params.serviceId)}/env-vars/${encodeURIComponent(key)}`,{
      method:'PUT',body:{value},
    })
    res.json({
      ok:true,key,valueMasked:maskSecretValue(value),
      mensagem:`${key} atualizada na Render. Faça um novo deploy para aplicar a mudança.`,
      requerDeploy:true,
    })
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
    const logs=await smartRenderLogs(cred.value,service.ownerId,service.id)
    res.json({logs,total:logs.length,service:{id:service.id,nome:service.nome}})
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

router.get('/plataformas/vercel/deploys/:deploymentId/logs', async (req,res,next)=>{
  try {
    const cred=await getCredential('vercel','VERCEL_TOKEN')
    if(!cred.value)return res.status(409).json({erro:'Vercel não conectada em Integrações e APIs.'})
    const logs=await smartVercelLogs(cred.value,cred.metadata?.teamId||'',req.params.deploymentId)
    res.json({logs,total:logs.length,deploymentId:req.params.deploymentId})
  } catch(err){next(err)}
})

export default router
