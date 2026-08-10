import crypto from 'node:crypto'
import PlataformaCredencial from '../models/PlataformaCredencial.js'
import { bootstrapValue, credentialEncryptionMaterial } from './localVault.js'

function keyFrom(base) {
  if (!base) return null
  return crypto.createHash('sha256').update(String(base)).digest()
}
function encryptionKey() {
  return keyFrom(credentialEncryptionMaterial())
}
function legacyEncryptionKey() {
  // Compatibilidade com versões <= 1.0.32, que criptografavam credenciais
  // usando CREDENTIALS_MASTER_KEY/JWT_SECRET do bootstrap.
  return keyFrom(bootstrapValue('CREDENTIALS_MASTER_KEY', 'CREDENTIALS_MASTER_KEY') || bootstrapValue('JWT_SECRET', 'JWT_SECRET'))
}
function decryptWithKey(value,key) {
  if(!key) throw new Error('Chave de criptografia indisponível.')
  const [iv, tag, encrypted] = String(value || '').split('.')
  if (!iv || !tag || !encrypted) throw new Error('Credencial armazenada inválida.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, encrypted].map(b => b.toString('base64url')).join('.')
}

export function decryptSecret(value) {
  try { return { value:decryptWithKey(value,encryptionKey()), legacy:false } }
  catch (primaryError) {
    const legacy=legacyEncryptionKey()
    try { return { value:decryptWithKey(value,legacy), legacy:true } }
    catch {
      const err=new Error('Credencial protegida por uma chave de outra instalação.')
      err.code='CREDENTIAL_KEY_MISMATCH'
      err.cause=primaryError
      throw err
    }
  }
}

export async function getCredential(plataforma, envName = '') {
  const doc = await PlataformaCredencial.findOne({ plataforma }).lean()
  if (doc?.segredo) {
    try {
      const decoded=decryptSecret(doc.segredo)
      if(decoded.legacy){
        // Migração transparente: ao conseguir abrir uma credencial antiga,
        // regrava imediatamente com a chave estável externa ao projeto.
        await PlataformaCredencial.updateOne({_id:doc._id},{segredo:encryptSecret(decoded.value)})
      }
      return { value: decoded.value, metadata: doc.metadata || {}, source: 'vault', updatedAt: doc.updatedAt, locked:false }
    } catch(e) {
      if(e.code==='CREDENTIAL_KEY_MISMATCH'){
        // Não quebra a tela e, principalmente, não impede substituir a chave.
        return { value:'', metadata:doc.metadata||{}, source:'vault', updatedAt:doc.updatedAt, locked:true, errorCode:e.code }
      }
      throw e
    }
  }
  return { value: envName ? (process.env[envName] || '') : '', metadata: {}, source: envName && process.env[envName] ? 'environment' : null, updatedAt: null, locked:false }
}

export async function setCredential(plataforma, value, metadata = {}) {
  return PlataformaCredencial.findOneAndUpdate(
    { plataforma },
    { segredo: encryptSecret(value), metadata, origem: 'painel' },
    { upsert: true, new: true, runValidators: true },
  )
}

export async function deleteCredential(plataforma) {
  return PlataformaCredencial.deleteOne({ plataforma })
}
