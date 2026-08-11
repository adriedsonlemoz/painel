import mongoose from 'mongoose'
import crypto from 'node:crypto'
import Usuario from '../models/Usuario.js'
import SistemaBootstrap from '../models/SistemaBootstrap.js'
import {
  bootstrapValue,
  credentialEncryptionMaterial,
  readBootstrap,
  setRuntimeBootstrapSecrets,
} from './localVault.js'
import { IS_MANAGED_PLATFORM, runtimeLabel } from './runtimeEnvironment.js'

let cached = null
let cachedAt = 0
const TTL = 15000

function bootstrapSealKey() {
  const uri=String(bootstrapValue('MONGO_URI')||process.env.MONGO_URI||'').trim()
  if(!uri) return null
  return crypto.createHash('sha256').update(`al-sistemas:hosted-bootstrap:v1:${uri}`).digest()
}

function sealHostedSecret(value='') {
  const plain=String(value||'')
  if(!plain)return ''
  const key=bootstrapSealKey()
  if(!key)return plain
  const iv=crypto.randomBytes(12)
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv)
  const encrypted=Buffer.concat([cipher.update(plain,'utf8'),cipher.final()])
  const tag=cipher.getAuthTag()
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

function openHostedSecret(value='') {
  const raw=String(value||'')
  if(!raw.startsWith('enc:v1:'))return raw
  const key=bootstrapSealKey()
  if(!key)throw new Error('MONGO_URI indisponível para abrir o bootstrap persistente.')
  const [,version,iv64,tag64,data64]=raw.split(':')
  if(version!=='v1'||!iv64||!tag64||!data64)throw new Error('Bootstrap persistente inválido.')
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv64,'base64url'))
  decipher.setAuthTag(Buffer.from(tag64,'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data64,'base64url')),decipher.final()]).toString('utf8')
}

export async function ensurePersistentBootstrap({ force=false } = {}) {
  if (mongoose.connection.readyState !== 1) {
    return { installed:false, mongoReady:false, source:'mongo-offline' }
  }
  if (!force && cached && Date.now()-cachedAt<TTL) return cached

  const local = readBootstrap()
  const users = await Usuario.countDocuments({}).catch(()=>0)
  const installed = users > 0 || Boolean(local.INSTALL_COMPLETED)

  let doc = await SistemaBootstrap.findOne({ chave:'principal' })
  if (!doc) {
    doc = await SistemaBootstrap.create({
      chave:'principal',
      installCompleted: installed,
      installCompletedAt: installed ? new Date() : null,
      jwtSecret: sealHostedSecret(local.JWT_SECRET || process.env.JWT_SECRET || ''),
      credentialMasterKey: sealHostedSecret(credentialEncryptionMaterial()),
      origem: IS_MANAGED_PLATFORM ? runtimeLabel().toLowerCase() : 'local-migration',
      ultimaMigracao: new Date(),
    })
  } else {
    let dirty=false
    if (installed && !doc.installCompleted) {
      doc.installCompleted=true
      doc.installCompletedAt ||= new Date()
      dirty=true
    }
    // Ao rodar primeiro no Termux/VPS, preserva no Mongo a chave que já
    // criptografa Integrações e APIs. Render/Vercel passam a reutilizá-la.
    if (!doc.credentialMasterKey) {
      doc.credentialMasterKey=sealHostedSecret(credentialEncryptionMaterial())
      dirty=true
    }
    if (!doc.jwtSecret) {
      doc.jwtSecret=sealHostedSecret(local.JWT_SECRET || process.env.JWT_SECRET || '')
      dirty=true
    }
    if (dirty) {
      doc.ultimaMigracao=new Date()
      await doc.save()
    }
  }

  const jwtSecret=openHostedSecret(doc.jwtSecret)
  const credentialMasterKey=openHostedSecret(doc.credentialMasterKey)

  // Migração automática de uma eventual versão de desenvolvimento que tenha
  // gravado os valores sem envelope criptográfico.
  if(doc.jwtSecret && !String(doc.jwtSecret).startsWith('enc:v1:')) {
    doc.jwtSecret=sealHostedSecret(jwtSecret)
    doc.ultimaMigracao=new Date()
    await doc.save()
  }
  if(doc.credentialMasterKey && !String(doc.credentialMasterKey).startsWith('enc:v1:')) {
    doc.credentialMasterKey=sealHostedSecret(credentialMasterKey)
    doc.ultimaMigracao=new Date()
    await doc.save()
  }

  setRuntimeBootstrapSecrets({
    jwtSecret,
    credentialMasterKey,
    installCompleted: doc.installCompleted || users>0,
  })

  cached = {
    installed: Boolean(doc.installCompleted || users>0),
    users,
    mongoReady:true,
    source:'mongo',
    environment:runtimeLabel(),
    persistedSecrets:Boolean(doc.jwtSecret && doc.credentialMasterKey),
  }
  cachedAt=Date.now()
  return cached
}

export async function markInstallationCompleted() {
  if (mongoose.connection.readyState !== 1) return null
  const current = await ensurePersistentBootstrap({ force:true })
  const doc = await SistemaBootstrap.findOneAndUpdate(
    { chave:'principal' },
    {
      $set: {
        installCompleted:true,
        installCompletedAt:new Date(),
        ultimaMigracao:new Date(),
      },
      $setOnInsert: {
        jwtSecret: sealHostedSecret(process.env.JWT_SECRET || ''),
        credentialMasterKey: sealHostedSecret(credentialEncryptionMaterial()),
        origem:runtimeLabel().toLowerCase(),
      },
    },
    { upsert:true,new:true }
  )
  setRuntimeBootstrapSecrets({
    jwtSecret:openHostedSecret(doc.jwtSecret),
    credentialMasterKey:openHostedSecret(doc.credentialMasterKey),
    installCompleted:true,
  })
  cached={...current,installed:true,users:Math.max(1,current.users||0)}
  cachedAt=Date.now()
  return cached
}

export async function installationState() {
  if (mongoose.connection.readyState !== 1) {
    const local=readBootstrap()
    return {
      installed:Boolean(local.INSTALL_COMPLETED),
      users:null,
      mongoReady:false,
      source:local.INSTALL_COMPLETED?'local':'offline',
    }
  }
  return ensurePersistentBootstrap()
}
