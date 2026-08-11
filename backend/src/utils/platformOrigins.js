import mongoose from 'mongoose'
import ConfiguracaoHome from '../models/ConfiguracaoHome.js'
import { getCredential } from './credentialStore.js'

const runtimeOrigins = new Set()
let hydratedAt = 0
let hydrating = null

function normalize(origin='') {
  try {
    const u=new URL(String(origin).trim())
    return `${u.protocol}//${u.host}`
  } catch { return '' }
}

function envOrigins() {
  return String(process.env.FRONTEND_URL || '')
    .split(',')
    .map(normalize)
    .filter(Boolean)
}

export function registerPlatformOrigin(origin) {
  const n=normalize(origin)
  if(n) runtimeOrigins.add(n)
  return n
}

export function platformOrigins() {
  return [...new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    ...envOrigins(),
    ...runtimeOrigins,
  ])]
}

export function isPlatformOriginAllowed(origin) {
  const n=normalize(origin)
  if(!n) return false
  if(platformOrigins().includes(n)) return true
  if(process.env.ALLOW_VERCEL_PREVIEWS==='true') {
    try { return new URL(n).hostname.endsWith('.vercel.app') } catch {}
  }
  return false
}

export async function hydratePlatformOrigins({ remote=true, force=false } = {}) {
  if(mongoose.connection.readyState!==1) return platformOrigins()
  if(!force && Date.now()-hydratedAt<30000) return platformOrigins()
  if(hydrating) return hydrating

  hydrating=(async()=>{
    try {
      // Em uma sincronização forçada reconstrói a lista em memória; assim uma
      // URL antiga de deployment não continua autorizada até o próximo restart.
      if(force)runtimeOrigins.clear()
      const docs=await ConfiguracaoHome.find({chave:{$in:['site_url','frontend_url']}}).lean().catch(()=>[])
      for(const d of docs) registerPlatformOrigin(d.valor)

      const vercel=await getCredential('vercel','VERCEL_TOKEN').catch(()=>null)
      const meta=vercel?.metadata||{}
      registerPlatformOrigin(meta.productionOrigin)
      for(const d of Array.isArray(meta.domains)?meta.domains:[]) registerPlatformOrigin(d)

      // Em produção autoriza os domínios associados ao projeto principal,
      // não a URL única de cada deployment/preview. Previews só entram quando
      // ALLOW_VERCEL_PREVIEWS=true na validação de CORS.
      if(remote && vercel?.value && meta.primaryProjectId) {
        const url=new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(meta.primaryProjectId)}/domains`)
        url.searchParams.set('limit','100')
        if(meta.teamId) url.searchParams.set('teamId',meta.teamId)
        const r=await fetch(url,{headers:{Authorization:`Bearer ${vercel.value}`,Accept:'application/json'}})
        if(r.ok) {
          const data=await r.json()
          for(const d of data.domains||[]) {
            if(d?.name&&!d.gitBranch)registerPlatformOrigin(`https://${d.name}`)
          }
        }
      }
      hydratedAt=Date.now()
      return platformOrigins()
    } finally { hydrating=null }
  })()

  return hydrating
}
