import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { autenticar } from '../middleware/auth.js'
import mongoose from 'mongoose'
import { upload, uploadMidia, gridfsMediaBucket } from '../middleware/upload.js'
import { cloudinary } from '../config/index.js'

const router = Router()

// #3 — Rate limit: máx 20 uploads por IP a cada 10 min
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitos uploads. Tente novamente em 10 minutos.' },
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
