/**
 * RSS admin — fontes de entrada integradas ao módulo Conteúdo.
 * Um feed sempre aponta para uma Fonte editorial e uma Categoria existentes.
 */
import { Router } from 'express'
import mongoose from 'mongoose'
import RssFonte from '../models/RssFonte.js'
import Noticia from '../models/Noticia.js'
import Fonte from '../models/Fonte.js'
import Categoria from '../models/Categoria.js'
import { importarFonte, importarTodasFontes, parseFeed, normalizeFeedText } from '../services/rssImporter.js'
import { iniciarRssJob, pararRssJob, dispararImportacaoManual, statusRssJob } from '../jobs/rssJob.js'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { logger } from '../utils/logger.js'
import { sanitizeContent, makeExcerpt } from '../services/rssSanitizer.js'

const router = Router()
const auth = [autenticar]
const authEdit = [autenticar, verificarPermissao('noticias.criar')]

const RSS_FONTES_PADRAO = [
  { nome: 'CNN Brasil — Últimas', fonte_nome: 'CNN Brasil', categoria_sugerida: 'Geral', url: 'https://www.cnnbrasil.com.br/feed/', destaque: 'Feed geral com atualização frequente.' },
  { nome: 'CNN Brasil — Política', fonte_nome: 'CNN Brasil', categoria_sugerida: 'Política', url: 'https://www.cnnbrasil.com.br/tudo-sobre/politica/feed/', destaque: 'Política e assuntos públicos.' },
  { nome: 'CNN Brasil — Economia', fonte_nome: 'CNN Brasil', categoria_sugerida: 'Economia', url: 'https://www.cnnbrasil.com.br/tudo-sobre/economia/feed/', destaque: 'Economia, mercado e negócios.' },
  { nome: 'Folha — Em Cima da Hora', fonte_nome: 'Folha de S.Paulo', categoria_sugerida: 'Geral', url: 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml', destaque: 'Feed amplo e atualizado da Folha de S.Paulo.' },
]

async function validarFeedAntesDeSalvar(url) {
  const items = await parseFeed(url)
  if (!items.length) throw new Error('Feed acessível, mas sem itens RSS/Atom')
  return items
}

async function validarAssociacoes(fonteId, categoriaId) {
  if (!mongoose.isValidObjectId(fonteId)) throw new Error('Selecione uma Fonte editorial válida')
  if (!mongoose.isValidObjectId(categoriaId)) throw new Error('Selecione uma Categoria padrão válida')
  const [fonte, categoria] = await Promise.all([
    Fonte.findById(fonteId).select('_id nome').lean(),
    Categoria.findById(categoriaId).select('_id nome').lean(),
  ])
  if (!fonte) throw new Error('Fonte editorial não encontrada')
  if (!categoria) throw new Error('Categoria padrão não encontrada')
  return { fonte, categoria }
}

router.get('/fontes/padrao', ...auth, (_req, res) => res.json(RSS_FONTES_PADRAO))

router.get('/fontes', ...auth, async (_req, res, next) => {
  try {
    const fontes = await RssFonte.find()
      .populate('fonte_id', 'id nome url')
      .populate('categoria_id', 'id nome slug')
      .sort({ padrao: -1, nome: 1 })
    res.json(fontes)
  } catch (err) { next(err) }
})

router.post('/fontes', ...authEdit, async (req, res, next) => {
  try {
    const {
      nome, url, fonte_id, categoria_id, ativa, max_items, auto_update, intervalo_min,
      ia_ativa, ia_resumo, ia_tags, ia_categoria, ia_titulo, ia_max_itens,
      copiar_imagem_r2, padrao,
    } = req.body
    if (!nome?.trim()) return res.status(400).json({ erro: 'Nome do feed é obrigatório' })
    if (!url?.trim()) return res.status(400).json({ erro: 'URL do feed é obrigatória' })
    try { await validarAssociacoes(fonte_id, categoria_id) } catch (e) { return res.status(400).json({ erro: e.message }) }

    const cleanUrl = url.trim()
    if (await RssFonte.exists({ url: cleanUrl })) return res.status(409).json({ erro: 'Já existe um feed com essa URL' })
    try { await validarFeedAntesDeSalvar(cleanUrl) } catch (err) {
      return res.status(422).json({ erro: `Não foi possível cadastrar este feed: ${err.message}` })
    }

    const isPadrao = Boolean(padrao && RSS_FONTES_PADRAO.some(p => p.url === cleanUrl))
    const fonte = await RssFonte.create({
      nome: nome.trim(), url: cleanUrl, fonte_id, categoria_id,
      ativa: ativa !== false,
      max_items: Math.max(1, Math.min(100, Number(max_items) || 10)),
      auto_update: Boolean(auto_update), intervalo_min: Math.max(5, Number(intervalo_min) || 60),
      ia_ativa: Boolean(ia_ativa), ia_resumo: ia_resumo !== false, ia_tags: ia_tags !== false,
      ia_categoria: ia_categoria !== false, ia_titulo: Boolean(ia_titulo),
      ia_max_itens: Math.max(1, Math.min(10, Number(ia_max_itens) || 3)),
      copiar_imagem_r2: copiar_imagem_r2 !== false,
      padrao: isPadrao,
    })
    await fonte.populate([{ path: 'fonte_id', select: 'id nome url' }, { path: 'categoria_id', select: 'id nome slug' }])
    res.status(201).json(fonte)
  } catch (err) { next(err) }
})

router.put('/fontes/:id', ...authEdit, async (req, res, next) => {
  try {
    const atual = await RssFonte.findById(req.params.id)
    if (!atual) return res.status(404).json({ erro: 'Feed não encontrado' })
    const {
      nome, url, fonte_id, categoria_id, ativa, max_items, auto_update, intervalo_min,
      ia_ativa, ia_resumo, ia_tags, ia_categoria, ia_titulo, ia_max_itens, copiar_imagem_r2,
    } = req.body
    const nextFonte = fonte_id || atual.fonte_id
    const nextCategoria = categoria_id || atual.categoria_id
    try { await validarAssociacoes(nextFonte, nextCategoria) } catch (e) { return res.status(400).json({ erro: e.message }) }

    const nextUrl = String(url || atual.url).trim()
    if (nextUrl !== atual.url) {
      if (await RssFonte.exists({ _id: { $ne: atual._id }, url: nextUrl })) return res.status(409).json({ erro: 'Já existe outro feed com essa URL' })
      try { await validarFeedAntesDeSalvar(nextUrl) } catch (err) {
        return res.status(422).json({ erro: `A URL informada não foi salva: ${err.message}` })
      }
    }

    atual.set({
      nome: String(nome ?? atual.nome).trim(), url: nextUrl, fonte_id: nextFonte, categoria_id: nextCategoria,
      ativa: ativa ?? atual.ativa,
      max_items: max_items == null ? atual.max_items : Math.max(1, Math.min(100, Number(max_items) || 10)),
      auto_update: auto_update ?? atual.auto_update,
      intervalo_min: intervalo_min == null ? atual.intervalo_min : Math.max(5, Number(intervalo_min) || 60),
      ia_ativa: ia_ativa ?? atual.ia_ativa,
      ia_resumo: ia_resumo ?? atual.ia_resumo,
      ia_tags: ia_tags ?? atual.ia_tags,
      ia_categoria: ia_categoria ?? atual.ia_categoria,
      ia_titulo: ia_titulo ?? atual.ia_titulo,
      ia_max_itens: ia_max_itens == null ? atual.ia_max_itens : Math.max(1, Math.min(10, Number(ia_max_itens) || 3)),
      copiar_imagem_r2: copiar_imagem_r2 ?? atual.copiar_imagem_r2,
    })
    await atual.save()
    await atual.populate([{ path: 'fonte_id', select: 'id nome url' }, { path: 'categoria_id', select: 'id nome slug' }])
    res.json(atual)
  } catch (err) { next(err) }
})

router.delete('/fontes/:id', ...authEdit, async (req, res, next) => {
  try {
    const fonte = await RssFonte.findById(req.params.id)
    if (!fonte) return res.status(404).json({ erro: 'Feed não encontrado' })
    if (fonte.padrao) return res.status(409).json({ erro: 'Este é um feed padrão. Desative-o em vez de excluir.' })
    const desvinculadas = await Noticia.countDocuments({ rss_fonte_id: fonte._id })
    await Noticia.updateMany({ rss_fonte_id: fonte._id }, { $set: { rss_fonte_id: null } })
    await fonte.deleteOne()
    res.json({ mensagem: 'Feed removido com sucesso', noticiasPreservadas: desvinculadas })
  } catch (err) { next(err) }
})

router.post('/fontes/:id/importar', ...authEdit, async (req, res, next) => {
  try {
    const fonte = await RssFonte.findById(req.params.id)
    if (!fonte) return res.status(404).json({ erro: 'Feed não encontrado' })
    logger.info({ fonte: fonte.nome, usuario: req.usuario?.email }, 'Importação RSS manual iniciada')
    const resultado = await importarFonte(fonte)
    res.json({ mensagem: 'Importação concluída', fonte: fonte.nome, ...resultado })
  } catch (err) { logger.error({ err: err.message, fonteId: req.params.id }, 'Erro na importação RSS manual'); next(err) }
})

router.post('/importar-todas', ...authEdit, async (_req, res, next) => {
  try {
    const resultados = await importarTodasFontes(3)
    const totais = resultados.reduce((acc, r) => ({
      importadas: acc.importadas + (r.importadas ?? 0),
      ignoradas: acc.ignoradas + (r.ignoradas ?? 0),
      duplicadas: acc.duplicadas + (r.duplicadas ?? 0),
      fontesComErro: acc.fontesComErro + (r.erro ? 1 : 0),
    }), { importadas: 0, ignoradas: 0, duplicadas: 0, fontesComErro: 0 })
    res.json({ mensagem: 'Importação em massa concluída', totalImportadas: totais.importadas, totalDuplicadas: totais.duplicadas, ...totais, resultados })
  } catch (err) { next(err) }
})

router.post('/reprocessar-importadas', ...authEdit, async (_req, res, next) => {
  try {
    const cursor = Noticia.find({ importado: true }).select('_id titulo conteudo resumo autor imagem_alt imagem_credito').lean().cursor()
    let total = 0, atualizadas = 0, inalteradas = 0
    const ops = []
    const flush = async () => {
      if (!ops.length) return
      const lote = ops.splice(0, ops.length)
      const r = await Noticia.bulkWrite(lote, { ordered: false })
      atualizadas += Number(r.modifiedCount || 0)
    }
    for await (const noticia of cursor) {
      total++
      const titulo = normalizeFeedText(noticia.titulo)
      const conteudo = sanitizeContent(normalizeFeedText(noticia.conteudo))
      const resumo = makeExcerpt(conteudo || normalizeFeedText(noticia.resumo), 300)
      const autor = normalizeFeedText(noticia.autor)
      const imagem_alt = normalizeFeedText(noticia.imagem_alt)
      const imagem_credito = normalizeFeedText(noticia.imagem_credito)
      const next = { titulo, conteudo, resumo, autor, imagem_alt, imagem_credito }
      const changed = Object.entries(next).some(([k, v]) => String(v || '') !== String(noticia[k] || ''))
      if (!changed) { inalteradas++; continue }
      ops.push({ updateOne: { filter: { _id: noticia._id }, update: { $set: next } } })
      if (ops.length >= 150) await flush()
    }
    await flush()
    res.json({ ok: true, mensagem: 'Notícias RSS reprocessadas', total, atualizadas, inalteradas })
  } catch (err) { next(err) }
})

router.post('/testar-url', ...authEdit, async (req, res, next) => {
  try {
    const url = String(req.body.url || '').trim()
    if (!url) return res.status(400).json({ erro: 'URL é obrigatória' })
    let items
    try { items = await parseFeed(url) } catch (err) { return res.status(422).json({ erro: `Feed inválido: ${err.message}` }) }
    if (!items.length) return res.status(422).json({ erro: 'Feed acessível, mas sem itens RSS/Atom' })
    res.json({
      valido: true, total_itens: items.length,
      preview: items.slice(0, 3).map(i => ({ titulo: i.title, link: i.link, data: i.pubDate || i.isoDate, temConteudo: Boolean(i.contentEncoded || i['content:encoded'] || i.content) })),
    })
  } catch (err) { next(err) }
})

router.get('/status', ...auth, async (_req, res, next) => {
  try {
    const [totalFontes, totalImportadas, fontesComErro, fontesAuto] = await Promise.all([
      RssFonte.countDocuments(),
      RssFonte.aggregate([{ $group: { _id: null, total: { $sum: '$total_importadas' } } }]),
      RssFonte.countDocuments({ ultimo_erro: { $ne: null } }),
      RssFonte.countDocuments({ ativa: true, auto_update: true }),
    ])
    res.json({ scheduler: statusRssJob(), stats: { fontesCadastradas: totalFontes, totalImportadas: totalImportadas[0]?.total ?? 0, fontesComErro, fontesAutomaticas: fontesAuto } })
  } catch (err) { next(err) }
})

router.post('/scheduler/iniciar', ...authEdit, (req, res, next) => {
  try { const expressao = req.body.expressao || '0 * * * *'; pararRssJob(); iniciarRssJob(expressao); res.json({ mensagem: 'Scheduler iniciado', expressao }) } catch (err) { next(err) }
})
router.post('/scheduler/parar', ...authEdit, (_req, res) => { pararRssJob(); res.json({ mensagem: 'Scheduler encerrado' }) })
router.post('/scheduler/executar-agora', ...authEdit, async (_req, res, next) => {
  try {
    res.json({ mensagem: 'Ciclo de importação iniciado em background' })
    dispararImportacaoManual().catch(err => logger.error({ err: err.message }, 'Erro no ciclo RSS manual via scheduler'))
  } catch (err) { next(err) }
})

export default router
