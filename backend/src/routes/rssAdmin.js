/**
 * rssAdmin.js
 * ───────────
 * Rotas admin para gestão de fontes RSS e controle de importações.
 *
 * Endpoints:
 *   GET    /admin/rss/fontes             → lista fontes cadastradas
 *   POST   /admin/rss/fontes             → cadastra nova fonte
 *   PUT    /admin/rss/fontes/:id         → atualiza fonte
 *   DELETE /admin/rss/fontes/:id         → remove fonte
 *   POST   /admin/rss/fontes/:id/importar → importação manual de uma fonte
 *   POST   /admin/rss/importar-todas     → importação de todas as fontes ativas
 *   POST   /admin/rss/testar-url         → valida um feed antes de cadastrar
 *   GET    /admin/rss/status             → status do scheduler
 *   POST   /admin/rss/scheduler/iniciar  → (re)inicia o cron
 *   POST   /admin/rss/scheduler/parar    → para o cron
 */
import { Router } from 'express'
import RssFonte from '../models/RssFonte.js'
import Noticia from '../models/Noticia.js'
import { importarFonte, importarTodasFontes, parseFeed } from '../services/rssImporter.js'
import {
  iniciarRssJob,
  pararRssJob,
  dispararImportacaoManual,
  statusRssJob,
} from '../jobs/rssJob.js'
import { autenticar }         from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { logger }             from '../utils/logger.js'
import { sanitizeContent, makeExcerpt } from '../services/rssSanitizer.js'

const router   = Router()
const auth     = [autenticar]
const authEdit = [autenticar, verificarPermissao('noticias.criar')]

// ─── Fontes padrão pré-definidas ─────────────────────────────────────────────

const RSS_FONTES_PADRAO = [
  { nome: 'CNN Brasil — Últimas',   url: 'https://www.cnnbrasil.com.br/feed/', destaque: 'Feed geral com atualização frequente.' },
  { nome: 'CNN Brasil — Política',  url: 'https://www.cnnbrasil.com.br/tudo-sobre/politica/feed/', destaque: 'Editorias de política e assuntos públicos.' },
  { nome: 'CNN Brasil — Economia',  url: 'https://www.cnnbrasil.com.br/tudo-sobre/economia/feed/', destaque: 'Economia, mercado e negócios.' },
  { nome: 'Folha — Em Cima da Hora', url: 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml', destaque: 'Feed amplo e atualizado da Folha de S.Paulo.' },
]


async function validarFeedAntesDeSalvar(url) {
  const items = await parseFeed(url)
  if (!items.length) throw new Error('Feed acessível, mas sem itens RSS/Atom')
  return items
}

// ─── Fontes RSS: CRUD ─────────────────────────────────────────────────────────

/**
 * GET /admin/rss/fontes/padrao
 * Retorna a lista de fontes padrão disponíveis para cadastro rápido.
 * DEVE vir antes de /fontes/:id para evitar conflito de rota.
 */
router.get('/fontes/padrao', ...auth, (_req, res) => {
  res.json(RSS_FONTES_PADRAO)
})

/**
 * GET /admin/rss/fontes
 * Lista todas as fontes RSS com categoria populada.
 */
router.get('/fontes', ...auth, async (_req, res, next) => {
  try {
    const fontes = await RssFonte.find()
      .populate('categoria_id', 'id nome')
      .sort({ padrao: -1, nome: 1 })
    res.json(fontes)
  } catch (err) { next(err) }
})

/**
 * POST /admin/rss/fontes
 * Cadastra nova fonte RSS.
 *
 * Body: { nome, url, ativa?, categoria_id?, max_items?, auto_update?, intervalo_min? }
 */
router.post('/fontes', ...authEdit, async (req, res, next) => {
  try {
    const { nome, url, ativa, categoria_id, max_items, auto_update, intervalo_min, ia_ativa, ia_resumo, ia_tags, ia_categoria, ia_titulo, ia_max_itens } = req.body

    if (!nome?.trim())  return res.status(400).json({ erro: 'Campo "nome" é obrigatório' })
    if (!url?.trim())   return res.status(400).json({ erro: 'Campo "url" é obrigatório' })

    const existente = await RssFonte.findOne({ url: url.trim() })
    if (existente) return res.status(409).json({ erro: 'Já existe uma fonte com essa URL' })

    try {
      await validarFeedAntesDeSalvar(url.trim())
    } catch (err) {
      return res.status(422).json({ erro: `Não foi possível cadastrar esta fonte: ${err.message}` })
    }

    const fonte = await RssFonte.create({
      nome:          nome.trim(),
      url:           url.trim(),
      ativa:         ativa !== false,
      categoria_id:  categoria_id  || null,
      max_items:     max_items     || 10,
      auto_update:   auto_update   || false,
      intervalo_min: intervalo_min || 60,
      ia_ativa:Boolean(ia_ativa), ia_resumo:ia_resumo!==false, ia_tags:ia_tags!==false, ia_categoria:ia_categoria!==false, ia_titulo:Boolean(ia_titulo), ia_max_itens:Number(ia_max_itens)||3,
    })

    res.status(201).json(fonte)
  } catch (err) { next(err) }
})

/**
 * PUT /admin/rss/fontes/:id
 * Atualiza uma fonte RSS existente.
 */
router.put('/fontes/:id', ...authEdit, async (req, res, next) => {
  try {
    const { nome, url, ativa, categoria_id, max_items, auto_update, intervalo_min, ia_ativa, ia_resumo, ia_tags, ia_categoria, ia_titulo, ia_max_itens } = req.body

    if (url?.trim()) {
      try {
        await validarFeedAntesDeSalvar(url.trim())
      } catch (err) {
        return res.status(422).json({ erro: `A URL informada não foi salva: ${err.message}` })
      }
    }

    const fonte = await RssFonte.findByIdAndUpdate(
      req.params.id,
      { nome, url, ativa, categoria_id: categoria_id || null, max_items, auto_update, intervalo_min, ia_ativa:Boolean(ia_ativa), ia_resumo:ia_resumo!==false, ia_tags:ia_tags!==false, ia_categoria:ia_categoria!==false, ia_titulo:Boolean(ia_titulo), ia_max_itens:Number(ia_max_itens)||3 },
      { new: true, runValidators: true }
    ).populate('categoria_id', 'id nome')

    if (!fonte) return res.status(404).json({ erro: 'Fonte não encontrada' })
    res.json(fonte)
  } catch (err) { next(err) }
})

/**
 * DELETE /admin/rss/fontes/:id
 * Remove uma fonte RSS (não remove as notícias já importadas por ela).
 */
router.delete('/fontes/:id', ...authEdit, async (req, res, next) => {
  try {
    const fonte = await RssFonte.findByIdAndDelete(req.params.id)
    if (!fonte) return res.status(404).json({ erro: 'Fonte não encontrada' })
    res.json({ mensagem: 'Fonte removida com sucesso' })
  } catch (err) { next(err) }
})

// ─── Importação ───────────────────────────────────────────────────────────────

/**
 * POST /admin/rss/fontes/:id/importar
 * Importação manual de uma única fonte.
 *
 * Body: { categoria_id? }
 */
router.post('/fontes/:id/importar', ...authEdit, async (req, res, next) => {
  try {
    const fonte = await RssFonte.findById(req.params.id)
    if (!fonte) return res.status(404).json({ erro: 'Fonte não encontrada' })

    logger.info({ fonte: fonte.nome, usuario: req.usuario?.email }, '🖱️ Importação manual iniciada')

    const resultado = await importarFonte(fonte, {
      categoria_id: req.body.categoria_id,
    })

    res.json({
      mensagem: 'Importação concluída com sucesso',
      fonte:    fonte.nome,
      ...resultado,
    })
  } catch (err) {
    logger.error({ err: err.message, fonteId: req.params.id }, 'Erro na importação manual')
    next(err)
  }
})

/**
 * POST /admin/rss/importar-todas
 * Importação de todas as fontes ativas em paralelo controlado.
 */
router.post('/importar-todas', ...authEdit, async (_req, res, next) => {
  try {
    const resultados = await importarTodasFontes(3)

    const totais = resultados.reduce(
      (acc, r) => ({
        importadas:    acc.importadas    + (r.importadas    ?? 0),
        ignoradas:     acc.ignoradas     + (r.ignoradas     ?? 0),
        duplicadas:    acc.duplicadas    + (r.duplicadas    ?? 0),
        fontesComErro: acc.fontesComErro + (r.erro ? 1 : 0),
      }),
      { importadas: 0, ignoradas: 0, duplicadas: 0, fontesComErro: 0 }
    )

    res.json({
      mensagem:   'Importação em massa concluída',
      totalImportadas: totais.importadas,
      totalDuplicadas: totais.duplicadas,
      ...totais,
      resultados,
    })
  } catch (err) { next(err) }
})


/**
 * POST /admin/rss/reprocessar-importadas
 * Reaplica a sanitização editorial às notícias RSS já persistidas.
 * Útil após ajustes no sanitizador: remove publicidade/blocos relacionados e
 * recria o resumo em texto puro sem alterar título, fonte, URL ou datas.
 */
router.post('/reprocessar-importadas', ...authEdit, async (_req, res, next) => {
  try {
    const cursor = Noticia.find({ importado: true })
      .select('_id conteudo resumo')
      .lean()
      .cursor()

    let total = 0
    let atualizadas = 0
    let inalteradas = 0
    const ops = []

    const flush = async () => {
      if (!ops.length) return
      const lote = ops.splice(0, ops.length)
      const r = await Noticia.bulkWrite(lote, { ordered: false })
      atualizadas += Number(r.modifiedCount || 0)
    }

    for await (const noticia of cursor) {
      total += 1
      const conteudo = sanitizeContent(String(noticia.conteudo || ''))
      const resumo = makeExcerpt(conteudo || String(noticia.resumo || ''), 300)
      if (conteudo === String(noticia.conteudo || '') && resumo === String(noticia.resumo || '')) {
        inalteradas += 1
        continue
      }
      ops.push({
        updateOne: {
          filter: { _id: noticia._id },
          update: { $set: { conteudo, resumo } },
        },
      })
      if (ops.length >= 150) await flush()
    }
    await flush()

    logger.info({ total, atualizadas, inalteradas }, 'RSS: notícias importadas reprocessadas')
    res.json({
      ok: true,
      mensagem: 'Notícias RSS reprocessadas com sucesso',
      total,
      atualizadas,
      inalteradas,
    })
  } catch (err) { next(err) }
})

/**
 * POST /admin/rss/testar-url
 * Valida um feed RSS antes de cadastrar.
 * Retorna prévia dos primeiros 3 itens.
 *
 * Body: { url }
 */
router.post('/testar-url', ...authEdit, async (req, res, next) => {
  try {
    const { url } = req.body
    if (!url?.trim()) return res.status(400).json({ erro: 'URL é obrigatória' })

    let items
    try {
      items = await parseFeed(url.trim())
    } catch (err) {
      return res.status(422).json({ erro: `Feed inválido: ${err.message}` })
    }

    if (!items.length) {
      return res.status(422).json({ erro: 'Feed acessível mas sem itens — verifique se é RSS 2.0 ou Atom' })
    }

    res.json({
      valido:      true,
      total_itens: items.length,
      preview: items.slice(0, 3).map(i => ({
        titulo: i.title,
        link:   i.link,
        data:   i.pubDate || i.isoDate,
        temConteudo: !!(i.contentEncoded || i['content:encoded'] || i.content),
      })),
    })
  } catch (err) { next(err) }
})

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * GET /admin/rss/status
 * Retorna o estado atual do cron job + stats básicas de importação.
 */
router.get('/status', ...auth, async (_req, res, next) => {
  try {
    const scheduler = statusRssJob()

    // Stats rápidas do banco (não bloqueantes para UX)
    const [totalFontes, totalImportadas, fontesComErro, fontesAuto] = await Promise.all([
      RssFonte.countDocuments(),
      RssFonte.aggregate([{ $group: { _id: null, total: { $sum: '$total_importadas' } } }]),
      RssFonte.countDocuments({ ultimo_erro: { $ne: null } }),
      RssFonte.countDocuments({ ativa: true, auto_update: true }),
    ])

    res.json({
      scheduler,
      stats: {
        fontesCadastradas:  totalFontes,
        totalImportadas:    totalImportadas[0]?.total ?? 0,
        fontesComErro,
        fontesAutomaticas: fontesAuto,
      },
    })
  } catch (err) { next(err) }
})

/**
 * POST /admin/rss/scheduler/iniciar
 * (Re)inicia o cron job com a expressão fornecida.
 *
 * Body: { expressao? }  (padrão: '0 * * * *' = a cada hora)
 */
router.post('/scheduler/iniciar', ...authEdit, (req, res, next) => {
  try {
    const expressao = req.body.expressao || '0 * * * *'
    pararRssJob()          // para o anterior caso exista
    iniciarRssJob(expressao)
    res.json({ mensagem: 'Scheduler iniciado', expressao })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /admin/rss/scheduler/parar
 * Para o cron job.
 */
router.post('/scheduler/parar', ...authEdit, (_req, res) => {
  pararRssJob()
  res.json({ mensagem: 'Scheduler encerrado' })
})

/**
 * POST /admin/rss/scheduler/executar-agora
 * Dispara um ciclo manual imediato sem esperar o cron.
 */
router.post('/scheduler/executar-agora', ...authEdit, async (_req, res, next) => {
  try {
    // Responde imediatamente: o ciclo roda em background
    res.json({ mensagem: 'Ciclo de importação iniciado em background' })
    // Fire-and-forget — log é feito dentro do ciclo
    dispararImportacaoManual().catch(err =>
      logger.error({ err: err.message }, 'Erro no ciclo manual via scheduler')
    )
  } catch (err) { next(err) }
})

export default router
