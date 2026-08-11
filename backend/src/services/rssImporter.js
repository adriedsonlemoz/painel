/**
 * Importador RSS integrado ao módulo Conteúdo.
 * - fetch remoto protegido contra SSRF e com limite de tamanho
 * - decoding por charset + correção de mojibake
 * - Fonte e Categoria editoriais obrigatórias
 * - imagens copiadas para Cloudflare R2 quando disponível
 * - IA executada depois da persistência, sem bloquear a importação
 */
import Parser from 'rss-parser'
import slugify from 'slugify'
import crypto from 'node:crypto'

import RssFonte from '../models/RssFonte.js'
import Noticia from '../models/Noticia.js'
import Fonte from '../models/Fonte.js'
import Categoria from '../models/Categoria.js'
import { analisarNoticiaEditorial } from '../utils/aiClient.js'
import { sanitizeContent, makeExcerpt, extractFirstImage } from './rssSanitizer.js'
import { uploadRssNewsImage, getR2MediaConfig } from './r2MediaStorage.js'
import { fetchRemoteText } from '../utils/remoteFetch.js'
import { logger } from '../utils/logger.js'

const USER_AGENT = 'Mozilla/5.0 (compatible; ALSistemas/1.0 RSS Importer)'
const FETCH_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain;q=0.8, */*;q=0.2',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7',
  'Cache-Control': 'no-cache',
}

const parser = new Parser({
  customFields: {
    feed: [],
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['media:credit', 'mediaCredit'],
      ['media:description', 'mediaDescription'],
      ['media:title', 'mediaTitle'],
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'creator'],
      ['dc:date', 'dcDate'],
    ],
  },
})

const MOJIBAKE_MAP = new Map([
  ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€', '”'], ['â€“', '–'], ['â€”', '—'],
  ['â€¦', '…'], ['Âº', 'º'], ['Âª', 'ª'], ['Â°', '°'], ['Â·', '·'], ['Â ', ' '],
])

function textBadness(value = '') {
  const s = String(value)
  return (s.match(/�/g) || []).length * 5 + (s.match(/(?:Ã.|Â.|â€|â€™|â€œ|â€|â€“|â€”)/g) || []).length * 2
}

export function normalizeFeedText(value = '') {
  if (value == null) return value
  let text = String(value).replace(/^\uFEFF/, '')
  for (const [bad, good] of MOJIBAKE_MAP) text = text.split(bad).join(good)
  if (/[ÃÂ]/.test(text)) {
    try {
      const candidate = Buffer.from(text, 'latin1').toString('utf8')
      if (textBadness(candidate) < textBadness(text)) text = candidate
    } catch {}
  }
  return text.normalize('NFC')
}

function normalizeObjectStrings(value, depth = 0) {
  if (depth > 8 || value == null) return value
  if (typeof value === 'string') return normalizeFeedText(value)
  if (Array.isArray(value)) return value.map(v => normalizeObjectStrings(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = normalizeObjectStrings(v, depth + 1)
    return out
  }
  return value
}

function normalizeArticleUrl(raw = '') {
  const value = String(raw || '').trim()
  if (!value) return null
  try {
    const u = new URL(value)
    u.hash = ''
    for (const key of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','fbclid','gclid','mc_cid','mc_eid']) u.searchParams.delete(key)
    u.hostname = u.hostname.toLowerCase()
    u.pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    u.searchParams.sort()
    return u.toString()
  } catch { return value }
}

function normalizeTitleTokens(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length >= 4 && !['para','como','mais','sobre','pela','pelo','entre','apos','ainda','esta','este','essa','esse','isso','uma','com','sem','dos','das','nos','nas'].includes(t))
}

function titleSimilarity(a, b) {
  const A = new Set(normalizeTitleTokens(a)); const B = new Set(normalizeTitleTokens(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const token of A) if (B.has(token)) inter++
  const union = new Set([...A, ...B]).size
  return union ? inter / union : 0
}

async function removerSemelhantes(docs = [], janelaHoras = 72, limite = 0.72) {
  if (!docs.length) return { docs, semelhantes: 0 }
  const desde = new Date(Date.now() - janelaHoras * 60 * 60 * 1000)
  const existentes = await Noticia.find({
    status: { $in: ['rascunho','revisao','agendado','publicado'] }, criado_em: { $gte: desde },
  }).select('titulo').sort({ criado_em: -1 }).limit(400).lean()
  const aceitos = []; let semelhantes = 0
  for (const doc of docs) {
    if ([...existentes, ...aceitos].some(n => titleSimilarity(doc.titulo, n.titulo) >= limite)) semelhantes++
    else aceitos.push(doc)
  }
  return { docs: aceitos, semelhantes }
}

function buildGuid(item) {
  const raw = normalizeArticleUrl(item.link) || String(item.guid || item.id || item.title || '').trim()
  return raw ? crypto.createHash('md5').update(raw).digest('hex') : null
}

function buildSlug(title = '', suffix = Date.now().toString(36)) {
  const base = slugify(title, { lower: true, strict: true, locale: 'pt', trim: true }).substring(0, 80)
  return `${base || 'noticia'}-${suffix}`
}

function extractBestImage(item, rawContent = '') {
  const raw = item.enclosure?.url || item.mediaContent?.$?.url || item['media:content']?.$?.url ||
    item.mediaThumbnail?.$?.url || item['media:thumbnail']?.$?.url || extractFirstImage(rawContent) ||
    extractFirstImage(item.contentSnippet || item.summary || '') || null
  if (!raw) return null
  try { return new URL(String(raw).trim(), item.link || undefined).toString() } catch { return String(raw).trim() || null }
}

function extractImageAlt(rawContent = '', item = {}) {
  const fromMedia = item.mediaDescription || item.mediaTitle || ''
  if (fromMedia) return makeExcerpt(String(fromMedia), 220)
  const m = String(rawContent).match(/<img[^>]*\balt=["']([^"']+)["']/i)
  return normalizeFeedText(m?.[1] || '').slice(0, 220)
}

function extractImageCredit(item = {}) {
  const raw = item.mediaCredit
  if (typeof raw === 'string') return normalizeFeedText(raw).slice(0, 220)
  return normalizeFeedText(raw?._ || raw?.$?.role || '').slice(0, 220)
}

function parsePublishedAt(item) {
  const d = new Date(item.pubDate || item.isoDate || item.dcDate || '')
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function buildDoc(item, { fonteRssId, fonteId, categoriaId, fonteNome }) {
  const guid = buildGuid(item)
  const titulo = normalizeFeedText(item.title || '').trim()
  if (!guid || !titulo) return null
  const rawContent = normalizeFeedText(item.contentEncoded || item['content:encoded'] || item.content || item.summary || item.description || '')
  const conteudo = sanitizeContent(rawContent)
  const resumo = makeExcerpt(conteudo || normalizeFeedText(item.contentSnippet || ''), 300)
  const imagem = extractBestImage(item, rawContent)
  return {
    guid, titulo, slug: buildSlug(titulo), conteudo: conteudo || resumo || '(conteúdo não disponível)', resumo: resumo || '',
    imagem_url: imagem, imagem_storage: imagem ? 'external' : null,
    imagem_alt: extractImageAlt(rawContent, item) || titulo.slice(0, 220),
    imagem_credito: extractImageCredit(item) || normalizeFeedText(fonteNome || '').slice(0, 220),
    imagem_fonte_url: imagem || null,
    url_original: normalizeArticleUrl(item.link), publicado_em: parsePublishedAt(item),
    fonte_id: fonteId, categoria_id: categoriaId, rss_fonte_id: fonteRssId,
    status: 'rascunho', importado: true, autor: normalizeFeedText(item.creator || item.author || '') || null,
  }
}

export async function parseFeed(url) {
  const remote = await fetchRemoteText(url, { headers: FETCH_HEADERS, timeoutMs: 15_000, maxBytes: 5 * 1024 * 1024 })
  let xml = remote.text.trimStart()
  if (!xml.startsWith('<')) throw new Error('A resposta não parece ser um feed RSS/Atom XML válido')
  let feed
  try { feed = await parser.parseString(xml) } catch (err) { throw new Error(`Feed acessível, mas não pôde ser interpretado: ${err.message}`) }
  return (feed.items || []).map(item => normalizeObjectStrings(item))
}

function baseFonteName(nome = '') {
  return String(nome || '').split(/\s+[—–-]\s+/)[0].trim() || String(nome || '').trim() || 'Fonte RSS'
}

async function resolveLegacyFonte(rssFonte) {
  if (rssFonte.fonte_id) {
    const found = await Fonte.findById(rssFonte.fonte_id)
    if (found) return found
  }
  const nome = baseFonteName(rssFonte.nome)
  let fonte = await Fonte.findOne({ nome: new RegExp(`^${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
  if (!fonte) fonte = await Fonte.create({ nome, url: null })
  await RssFonte.findByIdAndUpdate(rssFonte._id, { fonte_id: fonte._id })
  return fonte
}

async function resolveLegacyCategoria(rssFonte) {
  if (rssFonte.categoria_id) {
    const found = await Categoria.findById(rssFonte.categoria_id)
    if (found) return found
  }
  const geral = await Categoria.findOneAndUpdate(
    { slug: 'geral' },
    { $setOnInsert: { nome: 'Geral', slug: 'geral', cor: '#607D8B', descricao: 'Notícias gerais do portal.' }, $set: { protegida: true, ativa: true } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
  await RssFonte.findByIdAndUpdate(rssFonte._id, { categoria_id: geral._id })
  return geral
}

async function mirrorImagesToR2(insertedDocs, rssFonte, fonteDoc) {
  if (!rssFonte.copiar_imagem_r2 || !insertedDocs.some(d => d.imagem_url)) return
  try { await getR2MediaConfig() } catch (err) {
    logger.info({ fonte: rssFonte.nome, motivo: err.code || err.message }, 'RSS: R2 indisponível; imagens permanecerão externas')
    return
  }
  // A notícia já foi persistida antes desta etapa. Assim uma imagem lenta nunca
  // faz o botão “Importar” parecer travado; o R2 é enriquecimento em background.
  const queue = insertedDocs.filter(d => d.imagem_url).map(d => ({ id:d._id, titulo:d.titulo, url:d.imagem_url }))
  let cursor = 0
  const worker = async () => {
    while (cursor < queue.length) {
      const item = queue[cursor++]
      try {
        const img = await uploadRssNewsImage(item.url, { fonteNome: fonteDoc.nome, titulo: item.titulo })
        await Noticia.findByIdAndUpdate(item.id, { $set:{
          imagem_url:img.public_url, imagem_public_id:img.public_id, imagem_storage:'r2', imagem_key:img.key,
          imagem_mime:img.mime, imagem_tamanho:img.size, imagem_largura:img.width || null,
          imagem_altura:img.height || null, imagem_nome_original:img.original_name, imagem_fonte_url:item.url,
        } })
      } catch (err) {
        logger.warn({ fonte:rssFonte.nome, imagem:item.url, err:err.message }, 'RSS: falha ao copiar capa para R2; URL externa preservada')
      }
    }
  }
  await Promise.all([worker(), worker()])
}

async function processarIaDepoisDaImportacao(insertedDocs, rssFonte, fonteDoc, categoriaDoc) {
  if (!rssFonte.ia_ativa || !insertedDocs.length) return
  const limite = Math.min(Math.max(1, Number(rssFonte.ia_max_itens) || 3), insertedDocs.length, 10)
  try {
    const categorias = await Categoria.find().select('nome').lean()
    const mapa = new Map(categorias.map(c => [String(c.nome || '').toLowerCase(), c._id]))
    for (const doc of insertedDocs.slice(0, limite)) {
      try {
        const ai = await analisarNoticiaEditorial({
          titulo: doc.titulo, resumo: doc.resumo, conteudo: doc.conteudo,
          categorias: categorias.map(c => c.nome), acao: 'rss',
          categoriaAtual: categoriaDoc?.nome || '', fonte: fonteDoc?.nome || '',
        })
        const update = {}
        if (rssFonte.ia_resumo && ai.resumo) update.resumo = String(ai.resumo).slice(0, 300)
        if (rssFonte.ia_tags && Array.isArray(ai.tags)) update.tags = ai.tags.map(x => String(x).trim()).filter(Boolean).slice(0, 8)
        if (rssFonte.ia_categoria && ai.categoria) {
          const id = mapa.get(String(ai.categoria).toLowerCase())
          if (id) update.categoria_id = id
        }
        if (rssFonte.ia_titulo && ai.titulo) {
          const titulo = String(ai.titulo).trim().slice(0, 200)
          if (titulo && titulo !== doc.titulo) {
            update.titulo = titulo
            update.slug = buildSlug(titulo, String(doc._id).slice(-8))
          }
        }
        if (Object.keys(update).length) await Noticia.findByIdAndUpdate(doc._id, { $set: update })
      } catch (err) { logger.warn({ fonte: rssFonte.nome, noticia: doc._id, err: err.message }, 'RSS: IA editorial ignorada para uma matéria') }
    }
  } catch (err) { logger.warn({ fonte: rssFonte.nome, err: err.message }, 'RSS: processamento de IA em background falhou') }
}

export async function importarFonte(rssFonte) {
  const inicio = Date.now(); const ctx = { fonte: rssFonte.nome }
  await RssFonte.findByIdAndUpdate(rssFonte._id, { ultima_tentativa: new Date() })
  const [fonteDoc, categoriaDoc] = await Promise.all([resolveLegacyFonte(rssFonte), resolveLegacyCategoria(rssFonte)])

  let rawItems
  try { rawItems = await parseFeed(rssFonte.url) } catch (err) {
    const mensagem = String(err.message || err).slice(0, 500)
    const erroPermanente = /HTTP 404|HTTP 410|não encontrado|removido permanentemente/i.test(mensagem)
    await RssFonte.findByIdAndUpdate(rssFonte._id, {
      ultimo_erro: mensagem, ultima_duracao_ms: Date.now() - inicio,
      ...(erroPermanente ? { ativa: false, auto_update: false, desativada_automaticamente: true, motivo_desativacao: 'Feed indisponível permanentemente. Atualize e teste a URL antes de reativar.' } : {}),
      $inc: { falhas_consecutivas: 1 },
    })
    throw err
  }

  const slice = rawItems.slice(0, Math.min(Number(rssFonte.max_items) || 10, rawItems.length))
  const docs = []; const errosConversao = []
  for (const item of slice) {
    try {
      const doc = buildDoc(item, { fonteRssId: rssFonte._id, fonteId: fonteDoc._id, categoriaId: categoriaDoc._id, fonteNome: fonteDoc.nome })
      if (doc) docs.push(doc); else errosConversao.push({ item: item?.title || '(sem título)', motivo: 'GUID ou título ausente' })
    } catch (err) { errosConversao.push({ item: item?.title || '(sem título)', motivo: err.message }) }
  }

  const vistos = new Set(); let duplicadas = 0
  let docsUnicos = docs.filter(doc => { const k = `${doc.guid}|${doc.url_original || ''}`; if (vistos.has(k)) { duplicadas++; return false } vistos.add(k); return true })
  if (docsUnicos.length) {
    const guids = docsUnicos.map(d => d.guid); const urls = docsUnicos.map(d => d.url_original).filter(Boolean)
    const existentes = await Noticia.find({ $or: [{ guid: { $in: guids } }, ...(urls.length ? [{ url_original: { $in: urls } }] : [])] }).select('guid url_original').lean()
    const eg = new Set(existentes.map(n => n.guid).filter(Boolean)); const eu = new Set(existentes.map(n => normalizeArticleUrl(n.url_original)).filter(Boolean))
    docsUnicos = docsUnicos.filter(doc => { const hit = eg.has(doc.guid) || (doc.url_original && eu.has(doc.url_original)); if (hit) duplicadas++; return !hit })
  }
  if (docsUnicos.length) { const sem = await removerSemelhantes(docsUnicos); docsUnicos = sem.docs; duplicadas += sem.semelhantes }


  let importadas = 0; let ignoradas = errosConversao.length + duplicadas; const errosBulk = []; let insertedDocs = []
  if (docsUnicos.length) {
    try {
      insertedDocs = await Noticia.insertMany(docsUnicos, { ordered: false })
      importadas = insertedDocs.length
      const bulkDup = docsUnicos.length - insertedDocs.length; duplicadas += bulkDup; ignoradas += bulkDup
    } catch (err) {
      const bulk = err.name === 'BulkWriteError' || err.name === 'MongoBulkWriteError' || err.code === 11000
      if (!bulk) throw err
      insertedDocs = err.insertedDocs || []
      importadas = insertedDocs.length || err.result?.nInserted || 0
      for (const we of err.writeErrors || err.result?.getWriteErrors?.() || []) {
        const code = we.code ?? we.err?.code; const msg = we.errmsg ?? we.err?.errmsg ?? ''
        if (code === 11000) { duplicadas++; ignoradas++ } else { errosBulk.push({ code, motivo: msg.slice(0, 200) }); ignoradas++ }
      }
    }
  }

  const duracao = Date.now() - inicio
  await RssFonte.findByIdAndUpdate(rssFonte._id, {
    ultima_importacao: new Date(), ultimo_total_feed: rawItems.length, ultima_importadas: importadas,
    ultima_duplicadas: duplicadas, ultima_duracao_ms: duracao, ultimo_erro: null, falhas_consecutivas: 0,
    desativada_automaticamente: false, motivo_desativacao: null, $inc: { total_importadas: importadas },
  })

  if (rssFonte.copiar_imagem_r2 && insertedDocs.length) {
    setImmediate(() => mirrorImagesToR2(insertedDocs, rssFonte, fonteDoc).catch(err => logger.warn({ ...ctx, err:err.message }, 'RSS: cópia de imagens pós-importação falhou')))
  }
  if (rssFonte.ia_ativa && insertedDocs.length) {
    setImmediate(() => processarIaDepoisDaImportacao(insertedDocs, rssFonte, fonteDoc, categoriaDoc).catch(err => logger.warn({ ...ctx, err: err.message }, 'RSS: IA pós-importação falhou')))
  }
  logger.info({ ...ctx, importadas, duplicadas, ignoradas, iaEmBackground: Boolean(rssFonte.ia_ativa && insertedDocs.length) }, 'RSS importado')
  return { importadas, duplicadas, ignoradas, erros: [...errosConversao, ...errosBulk], total: slice.length, duracao_ms: duracao, ia_em_background:Boolean(rssFonte.ia_ativa && insertedDocs.length), imagens_em_background:Boolean(rssFonte.copiar_imagem_r2 && insertedDocs.some(d=>d.imagem_url)) }
}

export async function importarTodasFontes(concorrencia = 3, respeitarIntervalo = false) {
  const fontes = await RssFonte.find(respeitarIntervalo ? { ativa: true, auto_update: true } : { ativa: true }).lean()
  const agora = Date.now()
  const aptas = respeitarIntervalo ? fontes.filter(f => agora - (f.ultima_importacao ? new Date(f.ultima_importacao).getTime() : 0) >= (f.intervalo_min || 60) * 60_000) : fontes
  const resultados = []
  for (let i = 0; i < aptas.length; i += concorrencia) {
    resultados.push(...await Promise.all(aptas.slice(i, i + concorrencia).map(async fonte => {
      try { return { fonte: fonte.nome, ...(await importarFonte(fonte)), erro: null } }
      catch (err) { return { fonte: fonte.nome, importadas: 0, duplicadas: 0, ignoradas: 0, erros: [], total: 0, erro: err.message } }
    })))
  }
  return resultados
}
