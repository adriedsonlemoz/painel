/**
 * Rotas de extras: Configurações, Módulos, Notícias Externas, Tópicos, Ônibus, Eventos.
 * #2  — Paginação por cursor em /eventos, /onibus, /noticias-externas.
 * #19 — Audit log nas mutações autenticadas.
 */
import { Router } from 'express'
import ConfiguracaoHome from '../models/ConfiguracaoHome.js'
import ModuloHome from '../models/ModuloHome.js'
import { NoticiaExterna, Topico } from '../models/Extras.js'
import { Onibus } from '../models/Onibus.js'
import { Evento } from '../models/Evento.js'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { auditLog } from '../middleware/auditLog.js'
import { cacheGet, cacheSet, cacheDel } from '../utils/cache.js'
import { enviarJson } from '../utils/aiClient.js'
import {
  regraConfiguracao, regraConfiguracaoLote,
  regraNoticiaExterna, regraTopico, regraOnibus, validar,
} from '../middleware/validacoes.js'

const router = Router()
const CACHE_KEY_CONFIG    = 'configuracoes_home'
const CACHE_KEY_CATEGORIAS = 'categorias_lista'
const CACHE_KEY_MODULOS    = 'modulos_ativos'
const CACHE_TTL = 60

const SEO_KEYS = new Set([
  'nome_site','site_titulo','site_descricao','site_author','site_keywords','site_url','site_favicon',
  'site_imagem','site_twitter_card','site_twitter_site','site_ga_id','site_gsc_verification','site_robots',
  'sitemap_changefreq','sitemap_priority','sitemap_limite','sitemap_cache_min',
])
function seoPermissao(req,res,next){
  const u=req.usuario
  if(!u)return res.status(401).json({erro:'Não autenticado.'})
  if(u.role==='superadmin')return next()
  const perms=u.perfil_id?.permissoes||[]
  if(perms.includes('*')||perms.includes('seo.gerenciar')||perms.includes('configuracoes.gerenciar'))return next()
  return res.status(403).json({erro:'Permissão insuficiente para SEO.'})
}


// ─── Helper: paginação por cursor genérica ────────────────────
/**
 * Pagina uma query Mongoose por cursor (campo `criado_em` decrescente).
 * @param {Model}  Model     - Modelo Mongoose
 * @param {Object} filtro    - Filtro base
 * @param {string} cursor    - ISO string do último criado_em visto
 * @param {number} lim       - Limite de itens
 * @param {Object} sortOpt   - Opção de sort (padrão: { criado_em: -1 })
 */
async function paginarPorCursor(Model, filtro, cursor, lim, sortOpt = { criado_em: -1 }) {
  const f = { ...filtro }
  if (cursor) {
    if (!f.criado_em) f.criado_em = {}
    f.criado_em.$lt = new Date(cursor)
  }
  const docs = await Model.find(f).sort(sortOpt).limit(lim)
  const nextCursor = docs.length === lim
    ? docs[docs.length - 1].criado_em?.toISOString()
    : null
  return { docs, nextCursor }
}

// ─── CONFIGURAÇÕES ──────────────────────────────────────────

router.get('/configuracoes', async (_req, res, next) => {
  try {
    const cached = await cacheGet(CACHE_KEY_CONFIG)
    if (cached) return res.json(cached)
    const configs = await ConfiguracaoHome.find().lean()
    const mapa = configs.reduce((acc, c) => ({ ...acc, [c.chave]: c.valor }), {})
    await cacheSet(CACHE_KEY_CONFIG, mapa, CACHE_TTL)
    res.json(mapa)
  } catch (err) { next(err) }
})

router.put('/configuracoes/:chave', autenticar, verificarPermissao('configuracoes.gerenciar'), auditLog('configuracoes'), regraConfiguracao, validar, async (req, res, next) => {
  try {
    const { valor } = req.body
    const config = await ConfiguracaoHome.findOneAndUpdate(
      { chave: req.params.chave }, { valor }, { new: true, upsert: true }
    )
    await cacheDel(CACHE_KEY_CONFIG)
    res.json(config)
  } catch (err) { next(err) }
})

router.put('/configuracoes-lote', autenticar, verificarPermissao('configuracoes.gerenciar'), auditLog('configuracoes'), regraConfiguracaoLote, validar, async (req, res, next) => {
  try {
    const { pares } = req.body
    await Promise.all(
      pares.map(({ chave, valor }) =>
        ConfiguracaoHome.findOneAndUpdate({ chave }, { valor }, { upsert: true })
      )
    )
    await cacheDel(CACHE_KEY_CONFIG)
    res.json({ mensagem: 'Configurações atualizadas' })
  } catch (err) { next(err) }
})



// ─── SEO ADMIN ───────────────────────────────────────────────
// Rotas dedicadas evitam a inconsistência entre a permissão da tela SEO e a
// permissão geral de Configurações, sem afrouxar as demais configurações do sistema.
router.get('/seo-configuracoes', autenticar, seoPermissao, async (_req,res,next)=>{
  try{
    const configs=await ConfiguracaoHome.find({chave:{$in:[...SEO_KEYS]}}).lean()
    res.json(configs.reduce((acc,c)=>({...acc,[c.chave]:c.valor}),{}))
  }catch(err){next(err)}
})
router.put('/seo-configuracoes', autenticar, seoPermissao, auditLog('seo'), regraConfiguracaoLote, validar, async (req,res,next)=>{
  try{
    const pares=(req.body?.pares||[]).filter(p=>SEO_KEYS.has(p?.chave))
    if(!pares.length)return res.status(400).json({erro:'Nenhuma configuração SEO válida recebida.'})
    await Promise.all(pares.map(({chave,valor})=>ConfiguracaoHome.findOneAndUpdate({chave},{valor:String(valor??'')},{upsert:true,new:true})))
    await cacheDel(CACHE_KEY_CONFIG)
    const configs=await ConfiguracaoHome.find({chave:{$in:[...SEO_KEYS]}}).lean()
    const mapa=configs.reduce((acc,c)=>({...acc,[c.chave]:c.valor}),{})
    res.json({ok:true,configuracoes:mapa})
  }catch(err){next(err)}
})
router.post('/seo/ia', autenticar, seoPermissao, async (req,res,next)=>{
  try{
    const {acao='auditar',configuracoes={}}=req.body||{}
    const allowed={}
    for(const k of SEO_KEYS)if(configuracoes[k]!==undefined)allowed[k]=String(configuracoes[k]??'').slice(0,3000)
    const systemPrompt='Você é um assistente de SEO editorial para um portal de notícias brasileiro. Não invente fatos, localidades, marcas ou serviços. Trabalhe apenas com os dados fornecidos. Sugestões não devem ser aplicadas automaticamente.'
    const pergunta=`AÇÃO: ${acao}
CONFIGURAÇÕES ATUAIS: ${JSON.stringify(allowed)}

Avalie o SEO atual. Regras: título SEO preferencialmente até 60 caracteres; descrição entre 120 e 160 caracteres; palavras-chave devem ser específicas e fiéis ao portal. Se um campo já estiver adequado, pode repetir o valor atual.`
    const schema={type:'object',properties:{pontuacao:{type:'number'},resumo:{type:'string'},alertas:{type:'array',items:{type:'string'}},sugestoes:{type:'object',properties:{site_titulo:{type:'string'},site_descricao:{type:'string'},site_keywords:{type:'string'}},required:['site_titulo','site_descricao','site_keywords'],additionalProperties:false}},required:['pontuacao','resumo','alertas','sugestoes'],additionalProperties:false}
    const out=await enviarJson({systemPrompt,pergunta,schema,schemaName:'seo_portal',profile:'seo',task:`seo:${acao}`,dataClass:'editorial',cacheTtlMs:acao==='auditar'?30*60_000:0})
    res.json({ok:true,...out.data,_meta:{provedor:out.provedor,modelo:out.modelo,fallback:Boolean(out.fallback),falhasAnteriores:out.falhasAnteriores||[],structuredMode:out.structuredMode}})
  }catch(err){next(err)}
})

// ─── MÓDULOS ────────────────────────────────────────────────

// #1 — Cache da lista de módulos ativos
router.get('/modulos', async (_req, res, next) => {
  try {
    const cached = await cacheGet(CACHE_KEY_MODULOS)
    if (cached) return res.json(cached)
    const modulos = await ModuloHome.find().sort({ ordem: 1 }).lean()
    await cacheSet(CACHE_KEY_MODULOS, modulos, CACHE_TTL)
    res.json(modulos)
  } catch (err) { next(err) }
})

router.put('/modulos/:id', autenticar, verificarPermissao('modulos.gerenciar'), auditLog('modulos'), async (req, res, next) => {
  try {
    const modulo = await ModuloHome.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!modulo) return res.status(404).json({ erro: 'Módulo não encontrado' })
    await cacheDel(CACHE_KEY_MODULOS)
    res.json(modulo)
  } catch (err) { next(err) }
})

// ─── NOTÍCIAS EXTERNAS ──────────────────────────────────────

/**
 * @swagger
 * /api/noticias-externas:
 *   get:
 *     summary: Lista notícias externas ativas com paginação por cursor
 *     tags: [Extras]
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 */
router.get('/noticias-externas', async (req, res, next) => {
  try {
    const { cursor, limit } = req.query
    const lim = Math.min(100, parseInt(limit) || 20)

    if (cursor) {
      const { docs, nextCursor } = await paginarPorCursor(
        NoticiaExterna, { ativo: true }, cursor, lim, { ordem: 1, criado_em: -1 }
      )
      return res.json({ noticias: docs, nextCursor })
    }

    const noticias = await NoticiaExterna.find({ ativo: true }).sort({ ordem: 1 })
    res.json(noticias)
  } catch (err) { next(err) }
})

router.get('/noticias-externas/todas', autenticar, async (_req, res, next) => {
  try {
    const noticias = await NoticiaExterna.find().sort({ ordem: 1 })
    res.json(noticias)
  } catch (err) { next(err) }
})

router.post('/noticias-externas', autenticar, verificarPermissao('extras.gerenciar'), auditLog('noticias-externas'), regraNoticiaExterna, validar, async (req, res, next) => {
  try {
    const noticia = await NoticiaExterna.create(req.body)
    res.status(201).json(noticia)
  } catch (err) { next(err) }
})

router.put('/noticias-externas/:id', autenticar, verificarPermissao('extras.gerenciar'), auditLog('noticias-externas'), regraNoticiaExterna, validar, async (req, res, next) => {
  try {
    const noticia = await NoticiaExterna.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!noticia) return res.status(404).json({ erro: 'Notícia externa não encontrada' })
    res.json(noticia)
  } catch (err) { next(err) }
})

router.delete('/noticias-externas/:id', autenticar, verificarPermissao('extras.gerenciar'), auditLog('noticias-externas'), async (req, res, next) => {
  try {
    await NoticiaExterna.findByIdAndDelete(req.params.id)
    res.json({ mensagem: 'Notícia externa excluída' })
  } catch (err) { next(err) }
})

// ─── TÓPICOS ────────────────────────────────────────────────

router.get('/topicos', async (_req, res, next) => {
  try {
    const topicos = await Topico.find({ ativo: true }).sort({ ordem: 1 })
    res.json(topicos)
  } catch (err) { next(err) }
})

router.get('/topicos/todos', autenticar, async (_req, res, next) => {
  try {
    const topicos = await Topico.find().sort({ ordem: 1 })
    res.json(topicos)
  } catch (err) { next(err) }
})

router.post('/topicos', autenticar, verificarPermissao('extras.gerenciar'), auditLog('topicos'), regraTopico, validar, async (req, res, next) => {
  try {
    const topico = await Topico.create(req.body)
    res.status(201).json(topico)
  } catch (err) { next(err) }
})

router.put('/topicos/:id', autenticar, verificarPermissao('extras.gerenciar'), auditLog('topicos'), regraTopico, validar, async (req, res, next) => {
  try {
    const topico = await Topico.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!topico) return res.status(404).json({ erro: 'Tópico não encontrado' })
    res.json(topico)
  } catch (err) { next(err) }
})

router.delete('/topicos/:id', autenticar, verificarPermissao('extras.gerenciar'), auditLog('topicos'), async (req, res, next) => {
  try {
    await Topico.findByIdAndDelete(req.params.id)
    res.json({ mensagem: 'Tópico excluído' })
  } catch (err) { next(err) }
})

// ─── ÔNIBUS ─────────────────────────────────────────────────

/**
 * @swagger
 * /api/onibus:
 *   get:
 *     summary: Lista linhas de ônibus ativas com paginação por cursor
 *     tags: [Extras]
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 */
router.get('/onibus', async (req, res, next) => {
  try {
    const { cursor, limit } = req.query
    const lim = Math.min(200, parseInt(limit) || 50)

    if (cursor) {
      const { docs, nextCursor } = await paginarPorCursor(
        Onibus, { ativo: true }, cursor, lim, { ordem: 1, destino: 1 }
      )
      return res.json({ linhas: docs, nextCursor })
    }

    const linhas = await Onibus.find({ ativo: true }).sort({ ordem: 1, destino: 1 })
    res.json(linhas)
  } catch (err) { next(err) }
})

router.get('/onibus/todos', autenticar, async (_req, res, next) => {
  try {
    const linhas = await Onibus.find().sort({ ordem: 1, destino: 1 })
    res.json(linhas)
  } catch (err) { next(err) }
})

const DIAS_ONIBUS_ORDEM = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']

function normalizarLinhaOnibus(body = {}) {
  const campos = [
    'codigo', 'destino', 'origem', 'empresa', 'descricao', 'embarque', 'telefone',
    'site', 'tarifa', 'duracao_min', 'observacao', 'cor', 'ativo', 'ordem',
  ]
  const dados = {}
  for (const campo of campos) {
    if (Object.prototype.hasOwnProperty.call(body, campo)) dados[campo] = body[campo]
  }

  if (Array.isArray(body.horarios)) {
    dados.horarios = body.horarios
      .map(h => ({
        hora: String(h.hora || '').trim(),
        dias: [...new Set(h.dias || [])].sort((a, b) => DIAS_ONIBUS_ORDEM.indexOf(a) - DIAS_ONIBUS_ORDEM.indexOf(b)),
        observacao: String(h.observacao || '').trim(),
      }))
      .sort((a, b) => a.hora.localeCompare(b.hora))
  }
  return dados
}

router.post('/onibus', autenticar, verificarPermissao('extras.gerenciar'), auditLog('onibus'), regraOnibus, validar, async (req, res, next) => {
  try {
    const linha = await Onibus.create(normalizarLinhaOnibus(req.body))
    res.status(201).json(linha)
  } catch (err) { next(err) }
})

router.put('/onibus/:id', autenticar, verificarPermissao('extras.gerenciar'), auditLog('onibus'), regraOnibus, validar, async (req, res, next) => {
  try {
    const linha = await Onibus.findByIdAndUpdate(
      req.params.id,
      normalizarLinhaOnibus(req.body),
      { new: true, runValidators: true }
    )
    if (!linha) return res.status(404).json({ erro: 'Linha não encontrada' })
    res.json(linha)
  } catch (err) { next(err) }
})

router.delete('/onibus/:id', autenticar, verificarPermissao('extras.gerenciar'), auditLog('onibus'), async (req, res, next) => {
  try {
    await Onibus.findByIdAndDelete(req.params.id)
    res.json({ mensagem: 'Linha excluída' })
  } catch (err) { next(err) }
})

// ─── EVENTOS ────────────────────────────────────────────────

const TIPOS_ENTRADA_EVENTO = new Set(['gratuito', 'pago', 'doacoes'])

function normalizarEventoPayload(body = {}) {
  const payload = {}

  if ('titulo' in body) payload.titulo = String(body.titulo || '').trim()
  if ('descricao' in body) payload.descricao = String(body.descricao || '').trim()
  if ('local' in body) payload.local = String(body.local || '').trim()
  if ('horario' in body) payload.horario = String(body.horario || '').trim()
  if ('ativo' in body) payload.ativo = Boolean(body.ativo)
  if ('destaque' in body) payload.destaque = Boolean(body.destaque)
  if ('arquivar_automaticamente' in body) payload.arquivar_automaticamente = Boolean(body.arquivar_automaticamente)
  if ('categoria_id' in body) payload.categoria_id = body.categoria_id || null
  for (const campo of ['endereco','mapa_url','organizador','telefone','site','ingresso_url','imagem_url','imagem_public_id','imagem_alt']) {
    if (campo in body) payload[campo] = String(body[campo] || '').trim() || null
  }
  if ('preco' in body) payload.preco = body.preco === '' || body.preco == null ? null : Number(body.preco)
  if ('horario_fim' in body) payload.horario_fim = String(body.horario_fim || '').trim()
  if ('recorrencia' in body) {
    const rec=String(body.recorrencia||'nenhuma').toLowerCase()
    if(!['nenhuma','semanal','mensal','anual'].includes(rec)){const err=new Error('Recorrência inválida.');err.status=400;throw err}
    payload.recorrencia=rec
  }
  if ('agendado_para' in body) {
    if (!body.agendado_para) payload.agendado_para = null
    else { const d=new Date(body.agendado_para); if(Number.isNaN(d.getTime())){const err=new Error('Agendamento inválido.');err.status=400;throw err} payload.agendado_para=d }
  }

  if ('data' in body) {
    const data = new Date(body.data)
    if (Number.isNaN(data.getTime())) {
      const err = new Error('Data do evento inválida.')
      err.status = 400
      throw err
    }
    payload.data = data
  }

  if ('tipoEntrada' in body) {
    const tipo = String(body.tipoEntrada || '').trim().toLowerCase()
    if (!TIPOS_ENTRADA_EVENTO.has(tipo)) {
      const err = new Error('Tipo de entrada inválido.')
      err.status = 400
      throw err
    }
    payload.tipoEntrada = tipo
  }

  if ('cor' in body) {
    const cor = String(body.cor || '').trim().toUpperCase()
    if (!/^#[0-9A-F]{6}$/.test(cor)) {
      const err = new Error('Cor inválida. Use o formato #RRGGBB.')
      err.status = 400
      throw err
    }
    payload.cor = cor
  }

  return payload
}

/**
 * @swagger
 * /api/eventos:
 *   get:
 *     summary: Lista eventos futuros publicados
 *     tags: [Extras]
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 */
router.get('/eventos', async (req, res, next) => {
  try {
    const { cursor } = req.query
    const paginado = cursor !== undefined || req.query.limit !== undefined
    const lim = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20))
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    const filtro = { ativo: true, data: { $gte: hoje }, $or: [{ agendado_para: null }, { agendado_para: { $lte: new Date() } }] }

    if (cursor) {
      const cursorData = new Date(cursor)
      if (Number.isNaN(cursorData.getTime())) {
        return res.status(400).json({ erro: 'Cursor de eventos inválido.' })
      }
      filtro.data.$gt = cursorData
    }

    const query = Evento.find(filtro).sort({ data: 1, _id: 1 })
    if (paginado) query.limit(lim)
    const eventos = await query.lean()

    if (!paginado) return res.json(eventos)

    const nextCursor = eventos.length === lim
      ? eventos[eventos.length - 1].data?.toISOString()
      : null
    res.json({ eventos, nextCursor })
  } catch (err) { next(err) }
})

router.get('/eventos/todos', autenticar, verificarPermissao('extras.gerenciar'), async (_req, res, next) => {
  try {
    const eventos = await Evento.find().sort({ data: 1, _id: 1 }).lean()
    res.json(eventos)
  } catch (err) { next(err) }
})

router.post('/eventos', autenticar, verificarPermissao('extras.gerenciar'), auditLog('eventos'), async (req, res, next) => {
  try {
    const payload = normalizarEventoPayload(req.body)
    if (payload.agendado_para && new Date(payload.agendado_para) > new Date()) payload.ativo = false
    if (!payload.titulo || !payload.data) {
      return res.status(400).json({ erro: 'Título e data são obrigatórios.' })
    }
    const evento = await Evento.create(payload)
    res.status(201).json(evento)
  } catch (err) { next(err) }
})

router.put('/eventos/:id', autenticar, verificarPermissao('extras.gerenciar'), auditLog('eventos'), async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-f\d]{24}$/i)) {
      return res.status(400).json({ erro: 'Identificador de evento inválido.' })
    }
    const payload = normalizarEventoPayload(req.body)
    if (payload.agendado_para && new Date(payload.agendado_para) > new Date()) payload.ativo = false
    if ('titulo' in payload && !payload.titulo) {
      return res.status(400).json({ erro: 'O título do evento não pode ficar vazio.' })
    }
    const evento = await Evento.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    )
    if (!evento) return res.status(404).json({ erro: 'Evento não encontrado.' })
    res.json(evento)
  } catch (err) { next(err) }
})

router.delete('/eventos/:id', autenticar, verificarPermissao('extras.gerenciar'), auditLog('eventos'), async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-f\d]{24}$/i)) {
      return res.status(400).json({ erro: 'Identificador de evento inválido.' })
    }
    const evento = await Evento.findByIdAndDelete(req.params.id)
    if (!evento) return res.status(404).json({ erro: 'Evento não encontrado.' })
    res.json({ mensagem: 'Evento excluído.' })
  } catch (err) { next(err) }
})

export default router
