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
      const docs=await ConfiguracaoHome.find({chave:{$in:['site_url','frontend_url']}}).lean().catch(()=>[])
      for(const d of docs) registerPlatformOrigin(d.valor)

      const vercel=await getCredential('vercel','VERCEL_TOKEN').catch(()=>null)
      const meta=vercel?.metadata||{}
      registerPlatformOrigin(meta.productionOrigin)
      for(const d of Array.isArray(meta.domains)?meta.domains:[]) registerPlatformOrigin(d)

      // Se a conta Vercel já está conectada, as URLs dos projetos da própria
      // conta podem ser autorizadas automaticamente sem depender de FRONTEND_URL.
      if(remote && vercel?.value) {
        const url=new URL('https://api.vercel.com/v9/projects')
        url.searchParams.set('limit','30')
        if(meta.teamId) url.searchParams.set('teamId',meta.teamId)
        const r=await fetch(url,{headers:{Authorization:`Bearer ${vercel.value}`,Accept:'application/json'}})
        if(r.ok) {
          const data=await r.json()
          const domains=[]
          for(const p of data.projects||[]) {
            for(const alias of Array.isArray(p.alias)?p.alias:[]) {
              const origin=registerPlatformOrigin(`https://${alias}`)
              if(origin)domains.push(origin)
            }
          }
        }
      }
      hydratedAt=Date.now()
      return platformOrigins()
    } finally { hydrating=null }
  })()

  return hydrating
}
