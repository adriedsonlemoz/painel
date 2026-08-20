import mongoose from 'mongoose'
import Noticia from '../models/Noticia.js'
import Categoria from '../models/Categoria.js'
import RssFonte from '../models/RssFonte.js'
import ConfiguracaoHome from '../models/ConfiguracaoHome.js'
import ModuloHome from '../models/ModuloHome.js'
import { NoticiaExterna, Topico } from '../models/Extras.js'
import { Evento } from '../models/Evento.js'
import { Onibus } from '../models/Onibus.js'
import { putPublicFallbackJson } from './r2MediaStorage.js'
import { logger } from '../utils/logger.js'

export const PUBLIC_SNAPSHOT_KEY = 'alsistemas/fallback/public-snapshot-v1.json'

// Whitelist explícita: o snapshot fica em armazenamento público e não deve
// carregar campos de workflow editorial (responsável, revisor, comentários,
// IDs/chaves internas de mídia, autosave etc.).
const PUBLIC_NEWS_FIELDS = [
  'titulo', 'slug', 'conteudo', 'resumo', 'autor', 'tags',
  'imagem_url', 'imagem_legenda', 'imagem_alt', 'imagem_credito', 'imagem_fonte_url',
  'galeria.url', 'galeria.legenda',
  'categoria_id', 'fonte_id', 'status', 'destaque', 'urgente', 'urgente_ate',
  'views', 'url_original', 'publicado_em', 'criado_em', 'atualizado_em',
  'seo_titulo', 'seo_descricao', 'canonical_url', 'og_imagem_url', 'seo_noindex',
].join(' ')

let debounceTimer = null
let intervalTimer = null
let refreshInFlight = null
let refreshQueued = false
let lastConfigWarningAt = 0

function asNumber(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function publicConfigMap(configs = []) {
  // /api/configuracoes já é uma rota pública. O snapshot replica somente
  // os mesmos pares chave/valor que o portal público consegue consultar.
  return configs.reduce((acc, item) => {
    acc[item.chave] = item.valor
    return acc
  }, {})
}

async function categoriasPublicas() {
  // Mantém o mesmo formato de GET /api/categorias para o frontend não precisar
  // conhecer se a origem foi API ou snapshot.
  const [categorias, noticias, feeds] = await Promise.all([
    Categoria.find().populate('categoria_pai_id', 'nome slug').sort({ ordem: 1, nome: 1 }).lean(),
    Noticia.aggregate([{ $group: { _id: '$categoria_id', total: { $sum: 1 } } }]),
    RssFonte.aggregate([{ $group: { _id: '$categoria_id', total: { $sum: 1 } } }]),
  ])
  const mapaNoticias = new Map(noticias.map(item => [String(item._id), item.total]))
  const mapaFeeds = new Map(feeds.map(item => [String(item._id), item.total]))
  return categorias.map(c => ({
    ...c,
    id: String(c._id),
    total_noticias: mapaNoticias.get(String(c._id)) || 0,
    total_feeds_rss: mapaFeeds.get(String(c._id)) || 0,
  }))
}

async function construirSnapshot(reason = 'scheduled') {
  const newsLimit = asNumber(process.env.PUBLIC_SNAPSHOT_NEWS_LIMIT, 250, 25, 500)
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const [noticias, categorias, configs, modulos, topicos, externas, eventos, onibus] = await Promise.all([
    Noticia.find({ status: 'publicado' })
      .select(PUBLIC_NEWS_FIELDS)
      .populate('categoria_id', 'id nome slug cor descricao icone imagem_url imagem_alt seo_titulo seo_descricao')
      .populate('fonte_id', 'id nome url')
      .sort({ criado_em: -1 })
      .limit(newsLimit)
      .lean(),
    categoriasPublicas(),
    ConfiguracaoHome.find().lean(),
    ModuloHome.find().sort({ ordem: 1 }).lean(),
    Topico.find({ ativo: true }).sort({ ordem: 1 }).lean(),
    NoticiaExterna.find({ ativo: true }).sort({ ordem: 1, criado_em: -1 }).lean(),
    Evento.find({
      ativo: true,
      data: { $gte: hoje },
      $or: [{ agendado_para: null }, { agendado_para: { $lte: new Date() } }],
    }).sort({ data: 1, _id: 1 }).limit(100).lean(),
    Onibus.find({ ativo: true }).sort({ ordem: 1, destino: 1 }).limit(200).lean(),
  ])

  return {
    schema: 'alsistemas-public-snapshot-v1',
    generated_at: new Date().toISOString(),
    reason,
    source: 'mongodb-via-backend',
    news_limit: newsLimit,
    configuracoes: publicConfigMap(configs),
    categorias,
    modulos,
    topicos,
    noticias_externas: externas,
    eventos,
    onibus,
    noticias,
  }
}

export async function refreshPublicSnapshot({ reason = 'manual' } = {}) {
  if (mongoose.connection.readyState !== 1) {
    const err = new Error('MongoDB indisponível para gerar snapshot público.')
    err.code = 'PUBLIC_SNAPSHOT_DB_NOT_READY'
    throw err
  }

  if (refreshInFlight) {
    refreshQueued = true
    return refreshInFlight
  }

  refreshInFlight = (async () => {
    const snapshot = await construirSnapshot(reason)
    const stored = await putPublicFallbackJson(PUBLIC_SNAPSHOT_KEY, snapshot)
    logger.info({
      reason,
      key: stored.key,
      bytes: stored.size,
      noticias: snapshot.noticias.length,
      public_url: stored.public_url || undefined,
    }, 'Snapshot público de contingência atualizado no R2')
    if (!stored.public_url) {
      logger.warn('Snapshot R2 criado, mas CF_R2_PUBLIC_URL não está configurada; a Vercel precisará receber NEWS_FALLBACK_URL manualmente.')
    }
    return { ...stored, generated_at: snapshot.generated_at, noticias: snapshot.noticias.length }
  })()

  try {
    return await refreshInFlight
  } finally {
    refreshInFlight = null
    if (refreshQueued) {
      refreshQueued = false
      schedulePublicSnapshotRefresh('queued', 1200)
    }
  }
}

function reportRefreshError(err, reason) {
  const code = String(err?.code || '')
  if (['R2_NOT_CONFIGURED', 'R2_BUCKET_NOT_SELECTED'].includes(code)) {
    const now = Date.now()
    if (now - lastConfigWarningAt > 30 * 60_000) {
      lastConfigWarningAt = now
      logger.info({ code }, 'Snapshot público aguardando configuração do Cloudflare R2')
    }
    return
  }
  if (code === 'PUBLIC_SNAPSHOT_DB_NOT_READY') return
  logger.warn({ err: err?.message || String(err), code, reason }, 'Falha ao atualizar snapshot público de contingência')
}

export function schedulePublicSnapshotRefresh(reason = 'change', delayMs = 1200) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void refreshPublicSnapshot({ reason }).catch(err => reportRefreshError(err, reason))
  }, Math.max(100, Number(delayMs) || 1200))
  debounceTimer.unref?.()
}

export function startPublicSnapshotScheduler() {
  if (intervalTimer) return
  const intervalMs = asNumber(process.env.PUBLIC_SNAPSHOT_INTERVAL_MS, 5 * 60_000, 60_000, 60 * 60_000)
  schedulePublicSnapshotRefresh('startup', 1800)
  intervalTimer = setInterval(() => {
    void refreshPublicSnapshot({ reason: 'scheduled' }).catch(err => reportRefreshError(err, 'scheduled'))
  }, intervalMs)
  intervalTimer.unref?.()
  logger.info({ interval_ms: intervalMs, key: PUBLIC_SNAPSHOT_KEY }, 'Contingência pública do portal agendada')
}

export function stopPublicSnapshotScheduler() {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  debounceTimer = null
  intervalTimer = null
}
