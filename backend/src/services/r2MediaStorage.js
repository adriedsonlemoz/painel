import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getCloudflareConfig } from '../utils/cloudflareConfig.js'
import { fetchRemoteBuffer } from '../utils/remoteFetch.js'
import slugify from 'slugify'

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

function clean(v) { return String(v ?? '').trim() }

function clientFrom(cfg) {
  if (!cfg.r2Endpoint || !cfg.r2AccessKeyId || !cfg.r2SecretAccessKey) {
    const err = new Error('Cloudflare R2 não está configurado. Abra Integrações e APIs → Cloudflare → R2 Storage.')
    err.code = 'R2_NOT_CONFIGURED'
    throw err
  }
  return new S3Client({
    region: 'auto',
    endpoint: cfg.r2Endpoint,
    credentials: {
      accessKeyId: cfg.r2AccessKeyId,
      secretAccessKey: cfg.r2SecretAccessKey,
    },
  })
}

export async function getR2MediaConfig() {
  const cfg = await getCloudflareConfig()
  if (!cfg.r2Bucket) {
    const err = new Error('Nenhum bucket R2 foi definido para o AL Sistemas. Abra o módulo Cloudflare → R2 e escolha “Usar no AL”.')
    err.code = 'R2_BUCKET_NOT_SELECTED'
    throw err
  }
  clientFrom(cfg)
  return cfg
}

function extensionFor(file) {
  const mimeExt = MIME_EXT[String(file?.mimetype || '').toLowerCase()]
  if (mimeExt) return mimeExt
  const ext = extname(String(file?.originalname || '')).toLowerCase()
  if (/^\.(jpe?g|png|webp|gif)$/.test(ext)) return ext === '.jpeg' ? '.jpg' : ext
  return '.bin'
}



function sniffImageMime(buffer, declared = '') {
  const d = String(declared || '').split(';')[0].trim().toLowerCase()
  if (['image/jpeg','image/jpg','image/png','image/webp'].includes(d)) return d === 'image/jpg' ? 'image/jpeg' : d
  try {
    const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    if (b.length >= 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return 'image/png'
    if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  } catch {}
  return ''
}

function imageDimensions(buffer, mime = '') {
  try {
    const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
    const type = String(mime || '').toLowerCase()
    if (type === 'image/png' && b.length >= 24 && b.toString('ascii', 1, 4) === 'PNG') {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    }
    if ((type === 'image/jpeg' || type === 'image/jpg') && b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue }
        const marker = b[i + 1]
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
        }
        const len = b.readUInt16BE(i + 2)
        if (!len || len < 2) break
        i += 2 + len
      }
    }
    if (type === 'image/webp' && b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const kind = b.toString('ascii', 12, 16)
      if (kind === 'VP8X' && b.length >= 30) {
        const width = 1 + b[24] + (b[25] << 8) + (b[26] << 16)
        const height = 1 + b[27] + (b[28] << 8) + (b[29] << 16)
        return { width, height }
      }
      if (kind === 'VP8 ' && b.length >= 30) {
        return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
      }
    }
  } catch {}
  return { width: null, height: null }
}

function monthPrefix(date = new Date()) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}/${m}`
}

export function encodeR2PublicId(bucket, key) {
  return `r2:${bucket}:${key}`
}

export function parseR2PublicId(publicId) {
  const raw = clean(publicId)
  if (!raw.startsWith('r2:')) return null
  const rest = raw.slice(3)
  const idx = rest.indexOf(':')
  if (idx <= 0) return null
  const bucket = rest.slice(0, idx)
  const key = rest.slice(idx + 1)
  return bucket && key ? { bucket, key } : null
}

export function configuredPublicUrl(cfg, key) {
  const base = clean(cfg?.r2PublicUrl).replace(/\/+$/, '')
  if (!base) return ''
  const path = String(key).split('/').map(encodeURIComponent).join('/')
  return `${base}/${path}`
}

export async function uploadNewsImage(file, options = {}) {
  const cfg = await getR2MediaConfig()
  const client = clientFrom(cfg)
  const ext = extensionFor(file)
  const folder = String(options.folder || 'capas').replace(/[^a-zA-Z0-9/_-]+/g, '-').replace(/^\/+|\/+$/g, '') || 'capas'
  const root = options.root === 'conteudo' ? 'conteudo' : 'noticias'
  const key = `alsistemas/${root}/${folder}/${monthPrefix()}/${randomUUID()}${ext}`
  const contentType = file.mimetype || 'application/octet-stream'

  await client.send(new PutObjectCommand({
    Bucket: cfg.r2Bucket,
    Key: key,
    Body: file.buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: {
      purpose: String(options.purpose || 'news-cover').slice(0, 120),
      originalname: String(file.originalname || '').slice(0, 500),
      source: String(options.source || '').slice(0, 500),
    },
  }))

  const dimensions = imageDimensions(file.buffer, contentType)
  return {
    storage: 'r2',
    bucket: cfg.r2Bucket,
    key,
    public_id: encodeR2PublicId(cfg.r2Bucket, key),
    public_url: configuredPublicUrl(cfg, key),
    mime: contentType,
    size: Number(file.size || file.buffer?.length || 0),
    width: dimensions.width,
    height: dimensions.height,
    original_name: file.originalname || '',
  }
}

export async function uploadContentImage(file, kind = 'midia') {
  const safeKind = String(kind || 'midia').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 50) || 'midia'
  return uploadNewsImage(file, { root: 'conteudo', folder: safeKind, purpose: `content-${safeKind}` })
}

/**
 * Persiste um JSON público de contingência no mesmo R2 já configurado para o portal.
 * Somente o namespace alsistemas/fallback/ é aceito para evitar uso genérico
 * acidental deste helper em áreas sensíveis.
 */
export async function putPublicFallbackJson(key, payload, { cacheControl = 'public, max-age=60, stale-while-revalidate=300' } = {}) {
  const safeKey = clean(key)
  if (!safeKey.startsWith('alsistemas/fallback/') || !safeKey.endsWith('.json')) {
    const err = new Error('Chave inválida para snapshot público do R2.')
    err.code = 'R2_FALLBACK_KEY_INVALID'
    throw err
  }

  const cfg = await getR2MediaConfig()
  const client = clientFrom(cfg)
  const body = Buffer.from(JSON.stringify(payload), 'utf8')

  await client.send(new PutObjectCommand({
    Bucket: cfg.r2Bucket,
    Key: safeKey,
    Body: body,
    ContentType: 'application/json; charset=utf-8',
    CacheControl: cacheControl,
    Metadata: {
      purpose: 'public-portal-fallback',
      generatedat: new Date().toISOString(),
    },
  }))

  return {
    bucket: cfg.r2Bucket,
    key: safeKey,
    public_url: configuredPublicUrl(cfg, safeKey),
    size: body.length,
  }
}

export async function getR2Object(bucket, key) {
  const cfg = await getR2MediaConfig()
  if (clean(bucket) !== cfg.r2Bucket) {
    const err = new Error('Bucket R2 não autorizado para mídia pública.')
    err.code = 'R2_BUCKET_NOT_ALLOWED'
    err.status = 404
    throw err
  }
  const safeKey = clean(key)
  if (!safeKey.startsWith('alsistemas/noticias/') && !safeKey.startsWith('alsistemas/conteudo/')) {
    const err = new Error('Objeto R2 não autorizado para mídia pública.')
    err.code = 'R2_OBJECT_NOT_ALLOWED'
    err.status = 404
    throw err
  }
  const client = clientFrom(cfg)
  return client.send(new GetObjectCommand({ Bucket: cfg.r2Bucket, Key: safeKey }))
}

export async function deleteR2Object(bucket, key) {
  const cfg = await getR2MediaConfig()
  const safeKey = clean(key)
  if (clean(bucket) !== cfg.r2Bucket || (!safeKey.startsWith('alsistemas/noticias/') && !safeKey.startsWith('alsistemas/conteudo/'))) {
    const err = new Error('Objeto R2 não autorizado para remoção pelo módulo Notícias.')
    err.code = 'R2_OBJECT_NOT_ALLOWED'
    err.status = 403
    throw err
  }
  const client = clientFrom(cfg)
  await client.send(new DeleteObjectCommand({ Bucket: cfg.r2Bucket, Key: safeKey }))
}

export async function deleteR2ByPublicId(publicId) {
  const parsed = parseR2PublicId(publicId)
  if (!parsed) return false
  await deleteR2Object(parsed.bucket, parsed.key)
  return true
}


export async function uploadRssNewsImage(url, { fonteNome = 'rss', titulo = '' } = {}) {
  const safeName = slugify(String(fonteNome || 'rss'), { lower: true, strict: true, locale: 'pt', trim: true }).slice(0, 60) || 'rss'
  const remote = await fetchRemoteBuffer(url, {
    timeoutMs: 15_000,
    maxBytes: 5 * 1024 * 1024,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ALSistemas RSS Media/1.0)',
      'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.1',
    },
  })
  const mime = sniffImageMime(remote.buffer, remote.contentType)
  if (!mime) {
    throw new Error(`Imagem RSS com formato não suportado: ${String(remote.contentType || '').split(';')[0] || 'desconhecido'}`)
  }
  const pathname = new URL(remote.finalUrl).pathname
  const originalname = decodeURIComponent(pathname.split('/').pop() || `rss-${Date.now()}`)
  const file = { buffer: remote.buffer, mimetype: mime, size: remote.buffer.length, originalname }
  const out = await uploadNewsImage(file, { folder: `rss/${safeName}`, purpose: 'rss-news-cover', source: remote.finalUrl })
  const proxyPath = `/api/upload/r2/${encodeURIComponent(out.bucket)}/${out.key.split('/').map(encodeURIComponent).join('/')}`
  const backendBase = clean(process.env.AL_PUBLIC_BACKEND_URL || process.env.RENDER_EXTERNAL_URL).replace(/\/+$/, '')
  return { ...out, public_url: out.public_url || (backendBase ? `${backendBase}${proxyPath}` : proxyPath), source_url: remote.finalUrl, title: titulo }
}


export async function listR2MediaObjects({ limit = 1000 } = {}) {
  const cfg = await getR2MediaConfig()
  const client = clientFrom(cfg)
  const prefixes = ['alsistemas/noticias/', 'alsistemas/conteudo/']
  const out = []
  for (const Prefix of prefixes) {
    let ContinuationToken
    do {
      const page = await client.send(new ListObjectsV2Command({
        Bucket: cfg.r2Bucket,
        Prefix,
        ContinuationToken,
        MaxKeys: Math.min(1000, Math.max(1, limit - out.length)),
      }))
      for (const item of page.Contents || []) {
        if (!item.Key) continue
        out.push({
          key: item.Key,
          public_id: encodeR2PublicId(cfg.r2Bucket, item.Key),
          url: configuredPublicUrl(cfg, item.Key),
          size: Number(item.Size || 0),
          atualizado_em: item.LastModified || null,
          storage: 'r2',
        })
        if (out.length >= limit) break
      }
      ContinuationToken = out.length >= limit ? null : page.NextContinuationToken
    } while (ContinuationToken)
    if (out.length >= limit) break
  }
  return out
}
