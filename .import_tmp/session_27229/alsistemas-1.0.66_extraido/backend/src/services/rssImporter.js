/**
 * rssImporter.js  — v2.2
 * ─────────────────────────────────────
 * Serviço central de importação de notícias via RSS.
 *
 * CORREÇÕES v2.1:
 *  1. parseFeed: wrapping de erro com mensagem clara + fallback via fetch nativo
 *     quando rss-parser é bloqueado pelo servidor remoto.
 *  2. importarTodasFontes: respeita auto_update e intervalo_min por fonte,
 *     comportamento antes feito pelo rssScheduler.js (agora descontinuado).
 *  3. Erros de fetch remoto são distinguidos de erros de configuração local.
 *
 * CORREÇÕES v2.2:
 *  4. fetchFeedXmlFallback: remove BOM UTF-8 (\uFEFF) e whitespace antes do XML.
 *     Corrige "Non-whitespace before first tag. Line: 0, Column: 1" em feeds de
 *     servidores Windows/IIS e geradores PHP legados.
 *  5. parseFeed fallback: em vez de re-lançar o erro original, agora tenta
 *     parser.parseString(xml) com o XML já limpo do BOM, permitindo importar
 *     feeds que o rss-parser recusava por esse motivo.
 *
 * Estratégia de deduplicação:
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  Índice único no campo `guid` do model Noticia                  │
 *   │  + insertMany({ ordered: false })                               │
 *   │  O MongoDB rejeita silenciosamente os docs já existentes        │
 *   └─────────────────────────────────────────────────────────────────┘
 */
import Parser from 'rss-parser'
import slugify from 'slugify'
import crypto  from 'node:crypto'

import RssFonte from '../models/RssFonte.js'
import Noticia  from '../models/Noticia.js'
import Fonte    from '../models/Fonte.js'
import Categoria from '../models/Categoria.js'
import { analisarNoticiaEditorial } from '../utils/aiClient.js'
import { sanitizeContent, makeExcerpt, extractFirstImage } from './rssSanitizer.js'
import { logger } from '../utils/logger.js'

// ─── Constantes ───────────────────────────────────────────────────────────────

const USER_AGENT = 'Mozilla/5.0 (compatible; ALSistemas/2.1 RSS Importer; +https://alsistemas.com.br)'

const FETCH_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
}

// ─── Parser RSS (rss-parser) ─────────────────────────────────────────────────

const parser = new Parser({
  timeout: 15_000,
  headers: FETCH_HEADERS,
  requestOptions: {
    // Segue redirecionamentos automaticamente
    rejectUnauthorized: false, // tolera SSL self-signed em fontes locais
  },
  customFields: {
    feed: [],
    item: [
      ['media:content',   'mediaContent',   { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail',  { keepArray: false }],
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'creator'],
      ['dc:date',    'dcDate'],
    ],
  },
})

// ─── Helpers internos ─────────────────────────────────────────────────────────

function normalizeArticleUrl(raw = '') {
  const value = String(raw || '').trim()
  if (!value) return null
  try {
    const u = new URL(value)
    u.hash = ''
    const tracking = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','fbclid','gclid','mc_cid','mc_eid']
    for (const key of tracking) u.searchParams.delete(key)
    u.hostname = u.hostname.toLowerCase()
    u.pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    u.searchParams.sort()
    return u.toString()
  } catch {
    return value
  }
}


function normalizeTitleTokens(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 4 && !['para','como','mais','sobre','pela','pelo','entre','apos','ainda','esta','este','essa','esse','isso','uma','com','sem','dos','das','nos','nas'].includes(t))
}

function titleSimilarity(a, b) {
  const A = new Set(normalizeTitleTokens(a))
  const B = new Set(normalizeTitleTokens(b))
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
    status: { $in: ['rascunho','revisao','agendado','publicado'] },
    criado_em: { $gte: desde },
  }).select('titulo').sort({ criado_em: -1 }).limit(400).lean()

  const aceitos = []
  let semelhantes = 0
  for (const doc of docs) {
    const candidatos = [...existentes, ...aceitos]
    const parecida = candidatos.some(n => titleSimilarity(doc.titulo, n.titulo) >= limite)
    if (parecida) semelhantes++
    else aceitos.push(doc)
  }
  return { docs: aceitos, semelhantes }
}

function buildGuid(item) {
  // Link canônico primeiro: vários feeds atribuem GUIDs diferentes à mesma matéria.
  const canonicalLink = normalizeArticleUrl(item.link)
  const raw = canonicalLink || String(item.guid || item.id || item.title || '').trim()
  if (!raw) return null
  return crypto.createHash('md5').update(raw).digest('hex')
}

function buildSlug(title = '') {
  const base = slugify(title, {
    lower:  true,
    strict: true,
    locale: 'pt',
    trim:   true,
  }).substring(0, 80)

  const suffix = Date.now().toString(36)
  return `${base || 'noticia'}-${suffix}`
}

function extractBestImage(item, rawContent = '') {
  return (
    item.enclosure?.url                          ||
    item.mediaContent?.$?.url                    ||
    item['media:content']?.$?.url                ||
    item.mediaThumbnail?.$?.url                  ||
    item['media:thumbnail']?.$?.url              ||
    extractFirstImage(rawContent)                ||
    extractFirstImage(item.contentSnippet || item.summary || '') ||
    null
  )
}

function parsePublishedAt(item) {
  const raw = item.pubDate || item.isoDate || item.dcDate || ''
  if (!raw) return new Date()
  const d = new Date(raw)
  return isNaN(d.getTime()) ? new Date() : d
}

function buildDoc(item, { fonteRssId, fonteId, categoriaId }) {
  const guid = buildGuid(item)
  if (!guid) return null

  const titulo = item.title?.trim()
  if (!titulo) return null

  const rawContent =
    item.contentEncoded              ||
    item['content:encoded']          ||
    item.content                     ||
    item.summary                     ||
    item.description                 ||
    ''

  const conteudoSanitizado = sanitizeContent(rawContent)
  const resumo = makeExcerpt(conteudoSanitizado || item.contentSnippet || '', 300)
  const imagem = extractBestImage(item, rawContent)

  return {
    guid,
    titulo,
    slug:        buildSlug(titulo),
    conteudo:    conteudoSanitizado || resumo || '(conteúdo não disponível)',
    resumo:      resumo || '',
    imagem_url:  imagem,
    url_original: normalizeArticleUrl(item.link),
    publicado_em: parsePublishedAt(item),
    fonte_id:    fonteId,
    categoria_id: categoriaId ?? null,
    rss_fonte_id: fonteRssId,
    status:    'rascunho',
    importado: true,
    autor:     item.creator || item.author || null,
  }
}

// ─── FIX: Fallback fetch para feeds que bloqueiam rss-parser ─────────────────

/**
 * Tenta buscar o feed via fetch nativo (fallback quando rss-parser é bloqueado).
 * Retorna o XML bruto como string ou lança erro.
 */
async function fetchFeedXmlFallback(url) {
  const res = await fetch(url, {
    headers: {
      ...FETCH_HEADERS,
      // Header extra que alguns servidores exigem
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    // FIX: mensagem clara distinguindo erro remoto de erro local
    const detail = res.status === 404
      ? 'Feed não encontrado (HTTP 404) — verifique se a URL do feed ainda é válida'
      : res.status === 403
        ? 'Acesso negado pelo servidor do feed (HTTP 403) — o site pode bloquear importadores'
        : res.status === 401
          ? 'Feed requer autenticação (HTTP 401)'
          : `Servidor do feed retornou HTTP ${res.status}`
    throw new Error(detail)
  }

  // FIX v2.2: Remove BOM UTF-8 (\uFEFF) e qualquer whitespace antes do primeiro '<'.
  // Isso resolve "Non-whitespace before first tag" — feeds que emitem BOM ou espaços
  // antes do prólogo XML, algo comum em servidores Windows/IIS e geradores PHP legados.
  let text = await res.text()
  text = text.replace(/^\uFEFF/, '').trimStart()

  if (!text.startsWith('<')) {
    throw new Error('Resposta do feed não é um XML válido — verifique se a URL é um feed RSS ou Atom')
  }
  return text
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Faz o parse de um feed RSS/Atom e retorna os itens brutos.
 *
 * FIX v2.1: Wrapping de erro com mensagem amigável + fallback via fetch nativo.
 * O fallback é acionado quando rss-parser falha (ex.: o servidor remoto bloqueia
 * o User-Agent do rss-parser mas aceita um User-Agent de navegador).
 *
 * @param {string} url
 * @returns {Promise<Object[]>}
 */
export async function parseFeed(url) {
  // Tentativa 1: rss-parser (suporte completo a RSS 2.0 + Atom + namespaces)
  try {
    const feed = await parser.parseURL(url)
    return feed.items ?? []
  } catch (errPrimario) {
    const msg = errPrimario.message || ''

    // FIX: identifica se o erro é HTTP do servidor remoto (não de configuração)
    const isHttpError = /status code \d{3}/i.test(msg)
    const isNetworkError = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket hang up/i.test(msg)

    if (isHttpError) {
      // Reformata o erro para ser mais claro ao usuário
      const statusMatch = msg.match(/(\d{3})/)
      const httpStatus  = statusMatch ? parseInt(statusMatch[1]) : 0

      if (httpStatus === 404) {
        throw new Error('Feed não encontrado (HTTP 404) — verifique se a URL do feed ainda é válida')
      }
      if (httpStatus === 403) {
        // 403 pode ser contorno via User-Agent de navegador — tenta fallback
        logger.warn({ url, err: msg }, '⚠️  rss-parser recebeu 403 — tentando fallback via fetch')
      } else {
        throw new Error(`Servidor do feed retornou HTTP ${httpStatus}`)
      }
    }

    if (isNetworkError) {
      throw new Error(`Não foi possível conectar ao feed: ${msg}`)
    }

    // Tentativa 2 (fallback): fetch nativo com User-Agent de navegador + stripagem de BOM.
    // FIX v2.2: Antes apenas validava o acesso HTTP e re-lançava o erro original.
    // Agora busca o XML, remove o BOM/whitespace e tenta parseString() diretamente.
    // Isso corrige feeds com BOM UTF-8 ou espaços antes do prólogo XML que causam
    // "Non-whitespace before first tag. Line: 0, Column: 1".
    logger.warn({ url, err: msg }, '⚠️  rss-parser falhou — tentando fallback com fetch nativo + BOM strip')
    try {
      const xml = await fetchFeedXmlFallback(url)  // já remove BOM e valida que começa com '<'

      // Tenta parsear o XML limpo diretamente (sem re-fetch pelo rss-parser)
      try {
        const feedFallback = await parser.parseString(xml)
        logger.info({ url }, '✅ Fallback com parseString bem-sucedido após remoção de BOM')
        return feedFallback.items ?? []
      } catch (parseErr) {
        // XML acessível mas estruturalmente inválido para RSS/Atom
        throw new Error(
          `Feed acessível, mas não pôde ser interpretado: ${parseErr.message}. Verifique se é RSS.`
        )
      }
    } catch (errFallback) {
      // Fallback de fetch também falhou (HTTP error, sem conectividade, XML inválido)
      const finalMsg = errFallback.message.startsWith('Feed')
        ? errFallback.message
        : `Falha ao importar feed: ${errPrimario.message}`
      throw new Error(finalMsg)
    }
  }
}

/**
 * Importa notícias de uma única fonte RSS e persiste no banco.
 *
 * @param {mongoose.Document} rssFonte
 * @param {Object}  [opts]
 * @param {string}  [opts.categoria_id]
 * @returns {Promise<{ importadas, ignoradas, erros, total }>}
 */
export async function importarFonte(rssFonte, opts = {}) {
  const inicio = Date.now()
  const ctx = { fonte: rssFonte.nome }
  await RssFonte.findByIdAndUpdate(rssFonte._id, { ultima_tentativa: new Date() })

  // ── 1. Resolve (ou cria) o documento Fonte correspondente ──────────────────
  let fonteDoc = await Fonte.findOne({ nome: rssFonte.nome })
  if (!fonteDoc) {
    fonteDoc = await Fonte.create({ nome: rssFonte.nome, url: rssFonte.url ?? null })
    logger.info({ ...ctx, fonteId: fonteDoc._id }, '🆕 Fonte criada automaticamente')
  }

  // ── 2. Parse do feed ───────────────────────────────────────────────────────
  let rawItems
  try {
    rawItems = await parseFeed(rssFonte.url)
  } catch (err) {
    const mensagem = String(err.message || err).slice(0, 500)
    const erroPermanente = /HTTP 404|Feed não encontrado|HTTP 410/i.test(mensagem)
    const update = {
      ultimo_erro: mensagem,
      ultima_duracao_ms: Date.now() - inicio,
      ...(erroPermanente ? {
        ativa: false,
        auto_update: false,
        desativada_automaticamente: true,
        motivo_desativacao: 'Feed indisponível permanentemente (404/410). Atualize a URL e teste antes de reativar.',
      } : {}),
      $inc: { falhas_consecutivas: 1 },
    }
    await RssFonte.findByIdAndUpdate(rssFonte._id, update)
    logger.error({ ...ctx, err: err.message, erroPermanente }, erroPermanente
      ? '⛔ Feed desativado automaticamente após erro permanente'
      : '❌ Falha ao buscar/parsear feed')
    throw err
  }

  const max   = Math.min(Number(rssFonte.max_items) || 10, rawItems.length)
  const slice = rawItems.slice(0, max)
  logger.debug({ ...ctx, total: rawItems.length, processando: slice.length }, '📥 Feed obtido')

  // ── 3. Conversão de itens → documentos ────────────────────────────────────
  const docs              = []
  const errosConversao    = []

  for (const item of slice) {
    try {
      const doc = buildDoc(item, {
        fonteRssId:  rssFonte._id,
        fonteId:     fonteDoc._id,
        categoriaId: opts.categoria_id ?? rssFonte.categoria_id ?? null,
      })
      if (doc) {
        docs.push(doc)
      } else {
        errosConversao.push({
          item: item?.title ?? '(sem título)',
          motivo: 'GUID ou título ausente',
        })
      }
    } catch (err) {
      errosConversao.push({ item: item?.title ?? '(sem título)', motivo: err.message })
      logger.warn({ ...ctx, item: item?.title, err: err.message }, '⚠️ Erro ao converter item')
    }
  }

  // Deduplicação preventiva no próprio lote e contra registros já existentes.
  const vistos = new Set()
  let duplicadas = 0
  let docsUnicos = docs.filter(doc => {
    const chave = `${doc.guid}|${doc.url_original || ''}`
    if (vistos.has(chave)) { duplicadas++; return false }
    vistos.add(chave)
    return true
  })

  if (docsUnicos.length) {
    const guids = docsUnicos.map(d => d.guid)
    const urls = docsUnicos.map(d => d.url_original).filter(Boolean)
    const existentes = await Noticia.find({
      $or: [
        { guid: { $in: guids } },
        ...(urls.length ? [{ url_original: { $in: urls } }] : []),
      ],
    }).select('guid url_original').lean()
    const guidsExistentes = new Set(existentes.map(n => n.guid).filter(Boolean))
    const urlsExistentes = new Set(existentes.map(n => normalizeArticleUrl(n.url_original)).filter(Boolean))
    docsUnicos = docsUnicos.filter(doc => {
      const jaExiste = guidsExistentes.has(doc.guid) || (doc.url_original && urlsExistentes.has(doc.url_original))
      if (jaExiste) duplicadas++
      return !jaExiste
    })
  }

  // Deduplicação semântica leve: evita republicar a mesma pauta com URL/GUID diferentes.
  // Compara títulos das últimas 72h e também itens aceitos no próprio lote.
  if (docsUnicos.length) {
    const sem = await removerSemelhantes(docsUnicos)
    docsUnicos = sem.docs
    duplicadas += sem.semelhantes
  }

  // Enriquecimento editorial opcional. Processa poucos itens para respeitar cotas gratuitas.
  if (rssFonte.ia_ativa && docsUnicos.length) {
    try {
      const categorias=await Categoria.find().select('nome').lean()
      const mapaCategorias=new Map(categorias.map(c=>[String(c.nome||'').toLowerCase(),c._id]))
      const limite=Math.min(Number(rssFonte.ia_max_itens)||3, docsUnicos.length, 5)
      for(let i=0;i<limite;i++){
        const doc=docsUnicos[i]
        try{
          const ai=await analisarNoticiaEditorial({titulo:doc.titulo,resumo:doc.resumo,conteudo:doc.conteudo,categorias:categorias.map(c=>c.nome),acao:'rss'})
          if(rssFonte.ia_resumo && ai.resumo) doc.resumo=String(ai.resumo).slice(0,300)
          if(rssFonte.ia_tags && Array.isArray(ai.tags)) doc.tags=ai.tags.slice(0,8)
          if(rssFonte.ia_titulo && ai.titulo) doc.titulo=String(ai.titulo).slice(0,200)
          if(rssFonte.ia_categoria && ai.categoria){ const id=mapaCategorias.get(String(ai.categoria).toLowerCase()); if(id) doc.categoria_id=id }
        }catch(aiErr){ logger.warn({...ctx,item:doc.titulo,err:aiErr.message},'IA editorial do RSS ignorada para este item') }
      }
    } catch(aiErr) { logger.warn({...ctx,err:aiErr.message},'Enriquecimento por IA do RSS indisponível; importação continuará normalmente') }
  }

  if (!docsUnicos.length) {
    const duracao = Date.now() - inicio
    await RssFonte.findByIdAndUpdate(rssFonte._id, {
      ultima_importacao: new Date(), ultimo_total_feed: rawItems.length,
      ultima_importadas: 0, ultima_duplicadas: duplicadas, ultima_duracao_ms: duracao,
      ultimo_erro: null, falhas_consecutivas: 0,
    })
    logger.info({ ...ctx, duplicadas, invalidas: errosConversao.length }, 'ℹ️ Feed sem notícias novas')
    return { importadas: 0, duplicadas, ignoradas: duplicadas + errosConversao.length, erros: errosConversao, total: slice.length }
  }

  // ── 4. Bulk insert com tolerância a duplicatas ─────────────────────────────
  let importadas  = 0
  let ignoradas   = errosConversao.length + duplicadas
  const errosBulk = []

  try {
    const result = await Noticia.insertMany(docsUnicos, { ordered: false })
    importadas = result.length
    const bulkDuplicadas = docsUnicos.length - result.length
    duplicadas += bulkDuplicadas
    ignoradas += bulkDuplicadas
  } catch (err) {
    const isDuplicateOrBulk =
      err.name === 'BulkWriteError'      ||
      err.name === 'MongoBulkWriteError' ||
      err.code  === 11000

    if (!isDuplicateOrBulk) {
      logger.error({ ...ctx, err: err.message }, '❌ Erro inesperado no bulk insert')
      throw err
    }

    importadas =
      err.insertedDocs?.length ??
      err.result?.nInserted    ??
      0

    const writeErrors =
      err.writeErrors                              ??
      err.result?.getWriteErrors?.()              ??
      []

    for (const we of writeErrors) {
      const code  = we.code ?? we.err?.code
      const errmsg = we.errmsg ?? we.err?.errmsg ?? ''
      if (code === 11000) {
        ignoradas++
        duplicadas++
      } else {
        errosBulk.push({ code, motivo: errmsg.substring(0, 200) })
        logger.warn({ ...ctx, code, errmsg }, '⚠️ Erro de escrita não-duplicata no bulk')
      }
    }
  }

  // ── 5. Atualiza estatísticas da fonte RSS ──────────────────────────────────
  const duracao = Date.now() - inicio
  await RssFonte.findByIdAndUpdate(rssFonte._id, {
    ultima_importacao: new Date(),
    ultimo_total_feed: rawItems.length,
    ultima_importadas: importadas,
    ultima_duplicadas: duplicadas,
    ultima_duracao_ms: duracao,
    ultimo_erro: null,
    falhas_consecutivas: 0,
    $inc: { total_importadas: importadas },
  })

  const todosErros = [...errosConversao, ...errosBulk]
  logger.info(
    { ...ctx, importadas, ignoradas, erros: todosErros.length },
    '📰 Feed importado com sucesso'
  )

  return { importadas, duplicadas, ignoradas, erros: todosErros, total: slice.length, duracao_ms: duracao }
}

/**
 * Importa todas as fontes RSS ativas em paralelo controlado.
 *
 * FIX v2.1: Respeita auto_update e intervalo_min por fonte — comportamento
 * antes implementado pelo rssScheduler.js (agora descontinuado). Isso garante
 * que fontes configuradas com auto_update=false NÃO sejam importadas pelo
 * scheduler automático, apenas pela importação manual do admin.
 *
 * @param {number}  [concorrencia=3]
 * @param {boolean} [respeitarIntervalo=false]
 *   Se true (uso pelo scheduler), respeita intervalo_min e auto_update por fonte.
 *   Se false (importação manual via admin), importa todas as fontes ativas.
 * @returns {Promise<Array>}
 */
export async function importarTodasFontes(concorrencia = 3, respeitarIntervalo = false) {
  // FIX: quando chamado pelo scheduler automático, filtra fontes com auto_update
  const query = respeitarIntervalo
    ? { ativa: true, auto_update: true }
    : { ativa: true }

  const fontes = await RssFonte.find(query).lean()

  if (!fontes.length) {
    logger.info('📭 Nenhuma fonte RSS ativa encontrada')
    return []
  }

  // FIX: quando chamado pelo scheduler, filtra fontes cujo intervalo ainda não venceu
  const agora = Date.now()
  const fontesParaImportar = respeitarIntervalo
    ? fontes.filter(f => {
        const ultimaMs    = f.ultima_importacao ? new Date(f.ultima_importacao).getTime() : 0
        const intervaloMs = (f.intervalo_min || 60) * 60 * 1_000
        return agora - ultimaMs >= intervaloMs
      })
    : fontes

  if (!fontesParaImportar.length) {
    logger.info('⏳ Nenhuma fonte RSS com intervalo vencido neste ciclo')
    return []
  }

  logger.info({ total: fontesParaImportar.length, concorrencia }, '🚀 Iniciando importação em massa')

  const resultados = []

  for (let i = 0; i < fontesParaImportar.length; i += concorrencia) {
    const lote = fontesParaImportar.slice(i, i + concorrencia)

    const loteResultados = await Promise.all(
      lote.map(async fonte => {
        try {
          const r = await importarFonte(fonte)
          return { fonte: fonte.nome, ...r, erro: null }
        } catch (err) {
          return {
            fonte:      fonte.nome,
            importadas: 0,
            duplicadas: 0,
            ignoradas:  0,
            erros:      [],
            total:      0,
            erro:       err.message,
          }
        }
      })
    )

    resultados.push(...loteResultados)
  }

  const totais = resultados.reduce(
    (acc, r) => ({
      importadas:    acc.importadas    + (r.importadas    ?? 0),
      ignoradas:     acc.ignoradas     + (r.ignoradas     ?? 0),
      duplicadas:    acc.duplicadas    + (r.duplicadas    ?? 0),
      fontesComErro: acc.fontesComErro + (r.erro ? 1 : 0),
    }),
    { importadas: 0, ignoradas: 0, duplicadas: 0, fontesComErro: 0 }
  )

  logger.info({ ...totais, fontes: fontesParaImportar.length }, '✅ Importação em massa concluída')
  return resultados
}
