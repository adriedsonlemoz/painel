import mongoose from 'mongoose'
import { v2 as cloudinary } from 'cloudinary'
import { iniciarRedis } from '../utils/redis.js'
import { logger } from '../utils/logger.js'
import { bootstrapValue } from '../utils/localVault.js'
import { getCredential } from '../utils/credentialStore.js'

let mongoConnectPromise = null

export async function conectarMongo(uriOverride = '', dbNameOverride = '') {
  const uri = uriOverride || bootstrapValue('MONGO_URI')
  const dbName = (dbNameOverride || bootstrapValue('MONGO_DB_NAME') || 'alsistemas').trim()
  if (!uri) throw new Error('MongoDB não configurado. Cadastre a URL no painel de Banco de dados.')

  // Chamadas normais reutilizam a conexão/promise existente. Isso evita
  // disconnect/connect concorrentes durante o boot em aparelhos mais lentos.
  if (!uriOverride && mongoose.connection.readyState === 1) return mongoose.connection
  if (!uriOverride && mongoConnectPromise) return mongoConnectPromise

  const executar = async () => {
    // Override é usado pelo setup para trocar de servidor/banco explicitamente.
    if (uriOverride && mongoose.connection.readyState !== 0) await mongoose.disconnect()
    else if (mongoose.connection.readyState === 2) return mongoose.connection.asPromise()

    await mongoose.connect(uri, {
      dbName,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 15000,
      maxPoolSize: 10,
      minPoolSize: 0,
    })
    logger.info({ database: mongoose.connection.name }, 'MongoDB conectado')
    return mongoose.connection
  }

  if (uriOverride) return executar()
  mongoConnectPromise = executar().finally(() => { mongoConnectPromise = null })
  return mongoConnectPromise
}

export async function configurarCloudinary() {
  let cloudName = bootstrapValue('CLOUDINARY_CLOUD_NAME')
  let apiKey = bootstrapValue('CLOUDINARY_API_KEY')
  let apiSecret = bootstrapValue('CLOUDINARY_API_SECRET')
  if (mongoose.connection.readyState === 1) {
    const stored = await getCredential('cloudinary')
    if (stored.value) { const v = JSON.parse(stored.value); cloudName=v.cloudName||cloudName; apiKey=v.apiKey||apiKey; apiSecret=v.apiSecret||apiSecret }
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret })
  return Boolean(cloudName && apiKey && apiSecret)
}
export async function verificarCloudinary() { try { await configurarCloudinary(); await cloudinary.api.ping(); return { ok:true } } catch(err) { return { ok:false, erro:err.message } } }
export async function iniciarConexoes() { await conectarMongo(); await configurarCloudinary(); await iniciarRedis(process.env.REDIS_URL) }
export { cloudinary }
