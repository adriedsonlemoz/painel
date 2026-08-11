import multer from 'multer'
import streamifier from 'streamifier'
import mongoose from 'mongoose'
import { cloudinary, configurarCloudinary } from '../config/index.js'
import { IS_MANAGED_PLATFORM } from '../utils/runtimeEnvironment.js'

// Multer guarda o arquivo em memória (sem disco, sem dependência de storage externo)
const storage = multer.memoryStorage()

const fileFilter = (_req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true)
  else cb(new Error('Apenas imagens são permitidas'), false)
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
})

// Faz upload do buffer para o Cloudinary via stream (compatível com v2)
export function uploadParaCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'alsistemas/noticias',
        transformation: [{ width: 1200, height: 800, crop: 'limit', quality: 'auto' }],
      },
      (error, result) => {
        if (error) reject(error)
        else resolve(result)
      }
    )
    streamifier.createReadStream(buffer).pipe(stream)
  })
}


function mediaBucket() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    throw new Error('MongoDB indisponível para armazenamento de mídia.')
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'midia_arquivos' })
}

export function uploadParaGridFS(file) {
  return new Promise((resolve, reject) => {
    try {
      const bucket=mediaBucket()
      const stream=bucket.openUploadStream(file.originalname || `midia-${Date.now()}`, {
        contentType:file.mimetype || 'application/octet-stream',
        metadata:{
          tipo:'portal-midia',
          originalName:file.originalname || '',
          uploadedAt:new Date(),
        },
      })
      stream.once('error',reject)
      stream.once('finish',()=>resolve({
        storage:'gridfs',
        id:String(stream.id),
        public_id:`gridfs:${stream.id}`,
        secure_url:`/api/upload/gridfs/${stream.id}`,
      }))
      stream.end(file.buffer)
    } catch(err) { reject(err) }
  })
}

export async function uploadMidia(file) {
  const preference=String(process.env.MEDIA_STORAGE || (IS_MANAGED_PLATFORM?'gridfs':'auto')).toLowerCase()

  if(preference!=='gridfs') {
    try {
      const configured=await configurarCloudinary()
      if(configured) {
        const result=await uploadParaCloudinary(file.buffer)
        return {...result,storage:'cloudinary'}
      }
      if(preference==='cloudinary') throw new Error('Cloudinary foi selecionado, mas não está configurado.')
    } catch(err) {
      if(preference==='cloudinary') throw err
    }
  }

  return uploadParaGridFS(file)
}

export function gridfsMediaBucket() { return mediaBucket() }
