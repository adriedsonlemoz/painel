import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getCloudflareConfig } from '../utils/cloudflareConfig.js'

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

export async function uploadNewsImage(file) {
  const cfg = await getR2MediaConfig()
  const client = clientFrom(cfg)
  const ext = extensionFor(file)
  const key = `alsistemas/noticias/capas/${monthPrefix()}/${randomUUID()}${ext}`
  const contentType = file.mimetype || 'application/octet-stream'

  await client.send(new PutObjectCommand({
    Bucket: cfg.r2Bucket,
    Key: key,
    Body: file.buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: {
      purpose: 'news-cover',
      originalname: String(file.originalname || '').slice(0, 500),
    },
  }))

  return {
    storage: 'r2',
    bucket: cfg.r2Bucket,
    key,
    public_id: encodeR2PublicId(cfg.r2Bucket, key),
    public_url: configuredPublicUrl(cfg, key),
    mime: contentType,
    size: Number(file.size || file.buffer?.length || 0),
    original_name: file.originalname || '',
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
  if (!safeKey.startsWith('alsistemas/noticias/')) {
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
  if (clean(bucket) !== cfg.r2Bucket || !safeKey.startsWith('alsistemas/noticias/')) {
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
