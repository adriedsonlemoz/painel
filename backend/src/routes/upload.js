import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { autenticar } from '../middleware/auth.js'
import mongoose from 'mongoose'
import { upload, uploadMidia, gridfsMediaBucket } from '../middleware/upload.js'
import { cloudinary } from '../config/index.js'
import { uploadNewsImage, uploadContentImage, getR2Object, deleteR2ByPublicId } from '../services/r2MediaStorage.js'

const router = Router()

// #3 — Rate limit: máx 20 uploads por IP a cada 10 min
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitos uploads. Tente novamente em 10 minutos.' },
})


// POST /api/upload/noticias — capa de notícia armazenada no Cloudflare R2.
// O bucket e as credenciais vêm do módulo central Integrações e APIs.
router.post('/noticias', autenticar, uploadLimiter, upload.single('imagem'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' })
  try {
    const permitido = new Set(['image/jpeg', 'image/png', 'image/webp'])
    if (!permitido.has(String(req.file.mimetype || '').toLowerCase())) {
      return res.status(415).json({ erro: 'Use JPG, PNG ou WebP para a imagem de capa.' })
    }
    const resultado = await uploadNewsImage(req.file)
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
    const proxyPath = `/api/upload/r2/${encodeURIComponent(resultado.bucket)}/${resultado.key.split('/').map(encodeURIComponent).join('/')}`
    const url = resultado.public_url || `${proto}://${req.get('host')}${proxyPath}`
    res.json({
      url,
      public_id: resultado.public_id,
      storage: 'r2',
      bucket: resultado.bucket,
      key: resultado.key,
      mime: resultado.mime,
      size: resultado.size,
      largura: resultado.width || null,
      altura: resultado.height || null,
      original_name: resultado.original_name,
    })
  } catch (err) { next(err) }
})


// POST /api/upload/conteudo/:tipo — biblioteca/editorial (categorias, fontes, eventos e mídia geral).
router.post('/conteudo/:tipo', autenticar, uploadLimiter, upload.single('imagem'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' })
  try {
    const permitido = new Set(['image/jpeg', 'image/png', 'image/webp'])
    if (!permitido.has(String(req.file.mimetype || '').toLowerCase())) return res.status(415).json({ erro: 'Use JPG, PNG ou WebP.' })
    const tipo = String(req.params.tipo || 'midia').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 50) || 'midia'
    const resultado = await uploadContentImage(req.file, tipo)
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
    const proxyPath = `/api/upload/r2/${encodeURIComponent(resultado.bucket)}/${resultado.key.split('/').map(encodeURIComponent).join('/')}`
    const url = resultado.public_url || `${proto}://${req.get('host')}${proxyPath}`
    res.json({ url, public_id: resultado.public_id, storage:'r2', bucket:resultado.bucket, key:resultado.key, mime:resultado.mime, size:resultado.size, largura:resultado.width||null, altura:resultado.height||null, original_name:resultado.original_name })
  } catch (err) { next(err) }
})

// GET /api/upload/r2/:bucket/* — proxy público de leitura.
// Mantém as imagens do portal acessíveis mesmo quando o bucket R2 não usa r2.dev/domínio público.
router.get('/r2/:bucket/:key(*)', async (req, res, next) => {
  try {
    const out = await getR2Object(req.params.bucket, req.params.key)
    if (out.ContentType) res.setHeader('Content-Type', out.ContentType)
    if (out.ContentLength != null) res.setHeader('Content-Length', String(out.ContentLength))
    if (out.ETag) res.setHeader('ETag', out.ETag)
    res.setHeader('Cache-Control', out.CacheControl || 'public, max-age=86400, stale-while-revalidate=604800')
    if (out.Body?.pipe) return out.Body.on('error', next).pipe(res)
    const bytes = await out.Body?.transformToByteArray?.()
    if (bytes) return res.end(Buffer.from(bytes))
    return res.status(404).end()
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') return res.status(404).end()
    next(err)
  }
})

// POST /api/upload — autenticado
router.post('/', autenticar, uploadLimiter, upload.single('imagem'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' })
  try {
    const resultado = await uploadMidia(req.file)
    const proto=String(req.headers['x-forwarded-proto']||req.protocol||'http').split(',')[0].trim()
    const publicUrl=resultado.storage==='gridfs'
      ? `${proto}://${req.get('host')}${resultado.secure_url}`
      : resultado.secure_url
    res.json({
      url:publicUrl,
      public_id:resultado.public_id,
      storage:resultado.storage,
    })
  } catch (err) { next(err) }
})

// GET /api/upload/gridfs/:id — mídia pública persistida no MongoDB
router.get('/gridfs/:id', async (req, res, next) => {
  try {
    if(!mongoose.isValidObjectId(req.params.id)) return res.status(404).end()
    const id=new mongoose.Types.ObjectId(req.params.id)
    const bucket=gridfsMediaBucket()
    const files=await bucket.find({_id:id}).limit(1).toArray()
    const file=files[0]
    if(!file) return res.status(404).end()
    res.setHeader('Content-Type', file.contentType || file.metadata?.contentType || 'application/octet-stream')
    res.setHeader('Cache-Control','public, max-age=86400, stale-while-revalidate=604800')
    res.setHeader('ETag',`"${String(file._id)}-${file.length}"`)
    bucket.openDownloadStream(id).on('error',next).pipe(res)
  } catch(err) { next(err) }
})

// DELETE /api/upload — autenticado
router.delete('/', autenticar, async (req, res, next) => {
  try {
    const { public_id } = req.body
    if (!public_id) return res.status(400).json({ erro: 'public_id obrigatório' })
    if(String(public_id).startsWith('r2:')) {
      await deleteR2ByPublicId(public_id)
      return res.json({ mensagem:'Imagem removida do Cloudflare R2', storage:'r2' })
    }
    if(String(public_id).startsWith('gridfs:')) {
      const id=String(public_id).slice(7)
      if(!mongoose.isValidObjectId(id)) return res.status(400).json({erro:'ID GridFS inválido.'})
      await gridfsMediaBucket().delete(new mongoose.Types.ObjectId(id))
      return res.json({ mensagem:'Imagem removida do GridFS', storage:'gridfs' })
    }
    await cloudinary.uploader.destroy(public_id)
    res.json({ mensagem: 'Imagem removida', storage:'cloudinary' })
  } catch (err) { next(err) }
})

export default router
