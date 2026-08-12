import { Router } from 'express'
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { v2 as cloudinary } from 'cloudinary'
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { getCredential, setCredential, deleteCredential } from '../utils/credentialStore.js'
import { readBootstrap, writeBootstrap, deleteBootstrapKeys, vaultPaths } from '../utils/localVault.js'
import { conectarMongo, configurarCloudinary } from '../config/index.js'
import AuditLog from '../models/AuditLog.js'
import { diagnosticarIA, testarProvedorIA, listarModelosIA, resetAiRuntime } from '../utils/aiClient.js'
import { getAiUsageSummary } from '../services/aiTelemetry.js'

const router = Router(); router.use(autenticar, verificarPermissao('configuracoes.gerenciar'))
const MASK='••••••••••••••••'
const EXPORT_MASK='****************'
const defs = { github:'GITHUB_TOKEN', cloudinary:'CLOUDINARY', cloudflare:'CF_API_TOKEN', render:'RENDER_API_KEY', vercel:'VERCEL_TOKEN', gemini:'GEMINI_API_KEY', openrouter:'OPENROUTER_API_KEY', api_ninjas:'API_NINJAS_KEY', api_football:'API_FOOTBALL_KEY', resend:'RESEND_API_KEY' }
const safe = (d) => ({
  configured:Boolean(d?.value)||Boolean(d?.locked),
  usable:Boolean(d?.value),
  locked:Boolean(d?.locked),
  masked:d?.value||d?.locked?MASK:'',
  source:d?.source||null,
  metadata:d?.metadata||{},
  updatedAt:d?.updatedAt||null,
  errorCode:d?.errorCode||null,
})
async function audit(req, acao, detalhes={}) { try { await AuditLog.create({ usuario_id:req.usuario?.id, acao, entidade:'integracoes', detalhes, ip:req.ip }) } catch {} }

router.get('/status', async (_req,res,next)=>{ try {
  const b=readBootstrap(); const integrations={}
  for (const id of Object.keys(defs)) integrations[id]=safe(await getCredential(id, defs[id]))
  if(['gemini-2.0-flash','gemini-2.0-flash-001','gemini-2.5-flash'].includes(String(integrations.gemini?.metadata?.model||''))){
    integrations.gemini.metadata={...(integrations.gemini.metadata||{}),migratedFromModel:integrations.gemini.metadata.model,model:'gemini-3.5-flash-lite'}
  }
  const mongoUri=b.MONGO_URI||process.env.MONGO_URI||''
  let mongoHost=null
  try { mongoHost=mongoUri?new URL(mongoUri.replace(/^mongodb\+srv:/,'https:').replace(/^mongodb:/,'http:')).host:null } catch {}
  let mongoUsername=null
  try { mongoUsername=mongoUri?decodeURIComponent(new URL(mongoUri.replace(/^mongodb\+srv:/,'https:').replace(/^mongodb:/,'http:')).username||'')||null:null } catch {}
  res.json({
    mongodb:{
      configured:Boolean(mongoUri),
      connected:mongoose.connection.readyState===1,
      database:mongoose.connection.name||b.MONGO_DB_NAME||null,
      provider:b.MONGO_PROVIDER||(mongoUri.startsWith('mongodb+srv://')?'atlas':mongoUri?'custom':null),
      source:b.MONGO_URI?'local-vault':process.env.MONGO_URI?'environment':null,
      host:mongoHost,
      identity:mongoUsername?{available:true,kind:'database-user',label:mongoUsername,username:mongoUsername,note:'Usuário do banco presente na URI. O MongoDB não informa o e-mail da conta Atlas por essa conexão.'}:null,
      persistentConfigPath:vaultPaths().dataDir,
    },
    integrations,
    vault:{ protected:true, localKey:!process.env.CREDENTIALS_MASTER_KEY, paths:Object.values(vaultPaths()).map(p=>p.split('/').pop()) }
  })
} catch(e){next(e)} })

router.post('/mongodb/test', async(req,res)=>{ const uri=req.body.uri||readBootstrap().MONGO_URI||process.env.MONGO_URI; if(!uri)return res.status(400).json({ok:false,erro:'URL não informada.'}); try { const c=await mongoose.createConnection(uri,{serverSelectionTimeoutMS:7000}).asPromise(); const db=c.name; await c.db.admin().ping(); await c.close(); res.json({ok:true,database:db}) } catch(e){res.status(400).json({ok:false,erro:e.message.replace(/mongodb(\+srv)?:\/\/[^@]+@/,'mongodb$1://***@')})} })
router.put('/mongodb', async(req,res,next)=>{ try { const {uri,databaseName}=req.body; if(!uri)return res.status(400).json({erro:'URL obrigatória.'}); writeBootstrap({MONGO_URI:uri,MONGO_DB_NAME:databaseName||'alsistemas',MONGO_PROVIDER:uri.startsWith('mongodb+srv://')?'atlas':'custom'}); await conectarMongo(uri,databaseName||'alsistemas'); await audit(req,'mongodb.atualizar',{databaseName}); res.json({ok:true,mensagem:'MongoDB salvo no cofre local e reconectado.'}) } catch(e){next(e)} })
router.delete('/mongodb', async(req,res,next)=>{ try { deleteBootstrapKeys(['MONGO_URI','MONGO_DB_NAME','MONGO_PROVIDER','MONGO_HOST','MONGO_PORT','MONGO_AUTH_SOURCE','MONGO_TLS','MONGO_USERNAME','MONGO_PASSWORD']); await mongoose.disconnect(); await audit(req,'mongodb.remover'); res.json({ok:true}) } catch(e){next(e)} })


const GH_HEADERS = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'AL-Sistemas',
}

async function githubRequest(token, path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { ...GH_HEADERS, Authorization:`Bearer ${token}` },
  })
  const data = await r.json().catch(()=>({}))
  if(!r.ok) {
    const err = new Error(data.message || `GitHub respondeu ${r.status}`)
    err.status = r.status
    throw err
  }
  return { data, headers:r.headers }
}



async function githubIdentity(token) {
  const { data:user } = await githubRequest(token,'/user')
  let email=user.email||null
  let emailSource=email?'profile':null
  if(!email){
    try{
      const {data:emails}=await githubRequest(token,'/user/emails')
      if(Array.isArray(emails)){
        const primary=emails.find(x=>x.primary&&x.verified)||emails.find(x=>x.verified)||emails[0]
        if(primary?.email){ email=primary.email; emailSource='emails-api' }
      }
    }catch{}
  }
  return {available:true,provider:'github',kind:'user',label:user.name||user.login,username:user.login||null,email,accountId:user.id?String(user.id):null,emailSource,detectedAt:new Date().toISOString()}
}

async function vercelIdentity(c) {
  if(!c?.value)return {available:false,provider:'vercel',reason:'not-configured',label:'Vercel não configurada'}
  const url=new URL('https://api.vercel.com/v2/user')
  if(c.metadata?.teamId)url.searchParams.set('teamId',c.metadata.teamId)
  const r=await fetch(url,{headers:{Authorization:`Bearer ${c.value}`,Accept:'application/json'}})
  const body=await r.json().catch(()=>({}))
  if(!r.ok)throw new Error(body.error?.message||`Vercel respondeu ${r.status}`)
  const u=body.user||body
  return {available:true,provider:'vercel',kind:'user',label:u.name||u.username||u.email||'Conta Vercel',username:u.username||null,email:u.email||null,accountId:u.id||null,teamId:c.metadata?.teamId||null,detectedAt:new Date().toISOString()}
}

async function renderIdentity(c) {
  if(!c?.value)return {available:false,provider:'render',reason:'not-configured',label:'Render não configurado'}
  const r=await fetch('https://api.render.com/v1/users',{headers:{Authorization:`Bearer ${c.value}`,Accept:'application/json'}})
  const body=await r.json().catch(()=>null)
  if(!r.ok)throw new Error(body?.message||body?.error||`Render respondeu ${r.status}`)
  const u=Array.isArray(body)?(body[0]?.user||body[0]||{}):(body?.user||body||{})
  return {available:true,provider:'render',kind:'user',label:u.name||u.email||'Conta Render',email:u.email||null,accountId:u.id||null,detectedAt:new Date().toISOString()}
}

async function integrationIdentity(id,c) {
  if(!c?.value)return {available:false,provider:id,reason:'not-configured',label:'Não configurada'}
  if(id==='github')return githubIdentity(c.value)
  if(id==='vercel')return vercelIdentity(c)
  if(id==='render')return renderIdentity(c)
  if(id==='cloudinary'){
    let parsed={}; try{parsed=JSON.parse(c.value)}catch{}
    const cloudName=parsed.cloudName||c.metadata?.cloudName||null
    return {available:Boolean(cloudName),provider:id,kind:'product-environment',label:cloudName?`Cloud Name: ${cloudName}`:'Cloudinary configurado',cloudName,email:null,detectedAt:new Date().toISOString(),note:'A credencial identifica o ambiente Cloudinary; a API usada pelo AL Sistemas não expõe o e-mail da conta.'}
  }
  if(id==='cloudflare'){
    let parsed={}; try{parsed=JSON.parse(c.value)}catch{}
    const accountId=c.metadata?.accountId||null
    return {available:Boolean(accountId),provider:id,kind:'cloud-account',label:accountId?`Conta Cloudflare: ${accountId}`:'Cloudflare configurado',accountId,email:null,detectedAt:new Date().toISOString(),note:'A API Token identifica a conta/permissões; o e-mail do proprietário não é necessário para o AL Sistemas.'}
  }
  const labels={gemini:'Gemini',openrouter:'OpenRouter',render:'Render',vercel:'Vercel',api_ninjas:'API Ninjas',api_football:'API-Football'}
  return {available:false,provider:id,kind:'api-key',label:`${labels[id]||id}: chave configurada`,email:null,detectedAt:new Date().toISOString(),note:'Este provedor não disponibiliza ao AL Sistemas o e-mail do proprietário por meio desta chave/API.'}
}

async function refreshStoredIdentity(id){
  const c=await getCredential(id,defs[id])
  if(!c.value)return integrationIdentity(id,c)
  let identity
  try{identity=await integrationIdentity(id,c)}catch(e){identity={available:false,provider:id,label:'Não foi possível identificar a conta',note:e.message,detectedAt:new Date().toISOString()}}
  await setCredential(id,c.value,{...(c.metadata||{}),identity})
  return identity
}

function githubRepoView(repo) {
  return {
    id:repo.id,
    name:repo.name,
    fullName:repo.full_name,
    owner:repo.owner?.login || null,
    private:Boolean(repo.private),
    defaultBranch:repo.default_branch || 'main',
    url:repo.html_url,
    archived:Boolean(repo.archived),
    permissions:{
      read:Boolean(repo.permissions?.pull ?? true),
      write:Boolean(repo.permissions?.push || repo.permissions?.maintain || repo.permissions?.admin),
      admin:Boolean(repo.permissions?.admin),
    },
  }
}

async function githubRepos(token) {
  // A API entrega apenas os repositórios que a credencial autenticada consegue acessar.
  // Pagina até o fim para que "sem repositório padrão" realmente possa trabalhar
  // com todos os repositórios autorizados pelo token, não apenas os primeiros 100.
  const all=[]
  for(let page=1; page<=20; page++){
    const {data}=await githubRequest(token,`/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`)
    if(!Array.isArray(data))break
    all.push(...data)
    if(data.length<100)break
  }
  return all.map(githubRepoView)
}

// Conecta em uma única ação: valida o token informado, descobre a conta e só
// então persiste a credencial. Repositório padrão é deliberadamente opcional.
router.post('/github/connect', async(req,res,next)=>{ try {
  const token=String(req.body?.token||req.body?.secret||'').trim()
  if(!token)return res.status(400).json({ok:false,erro:'Cole um Personal Access Token do GitHub para continuar.'})
  const [{data:user}, repos] = await Promise.all([
    githubRequest(token,'/user'),
    githubRepos(token),
  ])
  const identity=await githubIdentity(token)
  const previous=await getCredential('github',defs.github)
  const previousMeta=previous.metadata||{}
  const repository = repos.some(r=>r.fullName===previousMeta.repository || r.name===previousMeta.repository)
    ? previousMeta.repository
    : ''
  const metadata={
    ...previousMeta,
    user:user.login,
    accountName:user.name||user.login,
    avatarUrl:user.avatar_url||'',
    repository,
    branch:previousMeta.branch||'main',
    repositoryCount:repos.length,
    writableRepositoryCount:repos.filter(r=>r.permissions.write).length,
    tokenType:token.startsWith('github_pat_')?'fine-grained':token.startsWith('ghp_')?'classic':'personal-access-token',
    lastValidatedAt:new Date().toISOString(),
    identity,
  }
  await setCredential('github',token,metadata)
  await audit(req,'github.conectar',{user:user.login,repositories:repos.length,writable:metadata.writableRepositoryCount,tokenType:metadata.tokenType})
  res.json({
    ok:true,
    mensagem:`GitHub conectado como @${user.login}.`,
    account:{login:user.login,name:user.name||'',avatarUrl:user.avatar_url||'',email:identity.email||null},
    repositories:repos,
    preferences:{repository:metadata.repository||'',branch:metadata.branch||'main'},
    diagnostics:{
      tokenValid:true,
      accountDetected:true,
      repositoryRead:repos.length>0,
      repositoryWrite:repos.some(r=>r.permissions.write),
      repositoryCount:repos.length,
      writableRepositoryCount:metadata.writableRepositoryCount,
    },
  })
} catch(e){
  const status=e.status===401?401:e.status===403?403:400
  res.status(status).json({ok:false,erro:e.status===401?'Token inválido ou revogado.':e.status===403?'Token válido, mas sem permissão suficiente para concluir a conexão.':e.message})
} })

router.get('/github/repositories', async(req,res)=>{ try {
  const c=await getCredential('github',defs.github)
  if(!c.value)return res.status(404).json({ok:false,erro:'GitHub ainda não conectado.'})
  const [{data:user},repos]=await Promise.all([githubRequest(c.value,'/user'),githubRepos(c.value)])
  const meta=c.metadata||{}
  res.json({
    ok:true,
    account:{login:user.login,name:user.name||'',avatarUrl:user.avatar_url||'',email:c.metadata?.identity?.email||user.email||null},
    repositories:repos,
    preferences:{repository:meta.repository||'',branch:meta.branch||'main'},
    diagnostics:{
      tokenValid:true,
      accountDetected:true,
      repositoryRead:repos.length>0,
      repositoryWrite:repos.some(r=>r.permissions.write),
      repositoryCount:repos.length,
      writableRepositoryCount:repos.filter(r=>r.permissions.write).length,
    },
  })
} catch(e){
  res.status(e.status===401?401:e.status===403?403:400).json({ok:false,erro:e.message})
} })

router.put('/github/preferences', async(req,res,next)=>{ try {
  const c=await getCredential('github',defs.github)
  if(!c.value)return res.status(400).json({erro:'Conecte o GitHub antes de definir preferências.'})
  const repos=await githubRepos(c.value)
  const repository=String(req.body?.repository||'').trim()
  const branch=String(req.body?.branch||'main').trim()||'main'
  if(repository && !repos.some(r=>r.fullName===repository || r.name===repository)) {
    return res.status(400).json({erro:'O repositório padrão escolhido não está acessível por este token.'})
  }
  const meta={
    ...(c.metadata||{}),
    repository,
    branch,
    repositoryCount:repos.length,
    writableRepositoryCount:repos.filter(r=>r.permissions.write).length,
  }
  await setCredential('github',c.value,meta)
  await audit(req,'github.preferencias',{repository:repository||null,branch})
  res.json({ok:true,mensagem:repository?'Repositório padrão atualizado.':'Nenhum repositório padrão: o sistema perguntará quando necessário.',preferences:{repository,branch}})
} catch(e){next(e)} })

// Diagnóstico ativo da integração já armazenada.
router.post('/github/test', async(req,res)=>{ try {
  const c=await getCredential('github',defs.github)
  if(!c.value)throw new Error('GitHub ainda não conectado. Use “Testar e conectar”.')
  const [{data:user},repos]=await Promise.all([githubRequest(c.value,'/user'),githubRepos(c.value)])
  res.json({
    ok:true,
    mensagem:`Conexão válida como @${user.login}.`,
    user:user.login,
    diagnostics:{
      tokenValid:true,
      accountDetected:true,
      repositoryRead:repos.length>0,
      repositoryWrite:repos.some(r=>r.permissions.write),
      repositoryCount:repos.length,
      writableRepositoryCount:repos.filter(r=>r.permissions.write).length,
    },
  })
} catch(e){res.status(400).json({ok:false,erro:e.message})} })


function normalizeAiMetadata(id, metadata={}){
  if(!['gemini','openrouter'].includes(id))return metadata
  const out={...metadata}
  const maxTokens=Number(out.maxTokens??1200)
  const temperature=Number(out.temperature??0.25)
  if(!Number.isFinite(maxTokens)||maxTokens<32||maxTokens>32768)throw new Error('Limite de tokens deve ficar entre 32 e 32768.')
  if(!Number.isFinite(temperature)||temperature<0||temperature>2)throw new Error('Temperatura deve ficar entre 0 e 2.')
  out.maxTokens=Math.round(maxTokens)
  out.temperature=temperature
  out.enabled=out.enabled!==false
  if(out.primary)out.enabled=true
  out.apiUrl=id==='gemini'?'https://generativelanguage.googleapis.com/v1beta':'https://openrouter.ai/api/v1'
  out.model=String(out.model||(id==='gemini'?'gemini-3.5-flash-lite':'openrouter/free')).trim()
  if(id==='gemini'&&['gemini-2.0-flash','gemini-2.0-flash-001','gemini-2.5-flash'].includes(out.model))out.model='gemini-3.5-flash-lite'
  if(!out.model)throw new Error('Informe um modelo de IA.')
  out.systemInstructions=String(out.systemInstructions||'').slice(0,8000)
  out.privacy={
    githubLogs: out.privacy?.githubLogs!==false,
    vercelLogs: out.privacy?.vercelLogs!==false,
    renderLogs: out.privacy?.renderLogs!==false,
    rssContent: out.privacy?.rssContent!==false,
    readme: out.privacy?.readme!==false,
    editorial: out.privacy?.editorial!==false,
    mongoDocuments: out.privacy?.mongoDocuments===true,
  }
  out.profiles=out.profiles&&typeof out.profiles==='object'?out.profiles:{}
  return out
}

router.post('/:id/models', async(req,res)=>{ const {id}=req.params; try{
  if(!['gemini','openrouter'].includes(id))return res.status(404).json({erro:'Provedor de IA inválido.'})
  const stored=await getCredential(id,defs[id])
  const value=String(req.body?.secret||'').trim()||stored.value
  if(!value)throw new Error('Digite ou salve a credencial antes de carregar modelos.')
  const metadata=normalizeAiMetadata(id,{...(stored.metadata||{}),...(req.body?.metadata||{})})
  const models=await listarModelosIA({id,secret:value,metadata})
  res.json({ok:true,models:models.slice(0,300),count:models.length})
}catch(e){res.status(400).json({ok:false,erro:e.message})} })

router.put('/:id', async(req,res,next)=>{ try {
  const {id}=req.params
  if(!defs[id])return res.status(404).json({erro:'Integração inválida.'})
  const {secret,metadata={},secrets={}}=req.body
  const atual=await getCredential(id,defs[id])
  const merged=normalizeAiMetadata(id,{...(atual.metadata||{}),...metadata})
  let value=String(secret||'').trim()||atual.value
  if(id==='cloudinary'){
    let old={}
    try{old=JSON.parse(atual.value||'{}')}catch{old={apiSecret:atual.value||''}}
    const cloudName=String(merged.cloudName||old.cloudName||atual.metadata?.cloudName||'').trim()
    const apiKey=String(merged.apiKey||old.apiKey||atual.metadata?.apiKey||'').trim()
    const apiSecret=String(secret||'').trim()||old.apiSecret||''
    if(!cloudName)return res.status(400).json({erro:'Cloud Name do Cloudinary é obrigatório.'})
    if(!apiKey)return res.status(400).json({erro:'API Key do Cloudinary é obrigatória.'})
    if(!apiSecret)return res.status(400).json({erro:'API Secret do Cloudinary é obrigatório.'})
    merged.cloudName=cloudName
    merged.apiKey=apiKey
    value=JSON.stringify({cloudName,apiKey,apiSecret})
  }
  if(id==='cloudflare'){
    let old={}; try{old=JSON.parse(atual.value||'{}')}catch{old={apiToken:atual.value||''}}
    const apiToken=String(secret||'').trim()||old.apiToken||''
    const r2AccessKeyId=String(secrets.r2AccessKeyId||'').trim()||old.r2AccessKeyId||''
    const r2SecretAccessKey=String(secrets.r2SecretAccessKey||'').trim()||old.r2SecretAccessKey||''
    if(!apiToken)return res.status(400).json({erro:'API Token da Cloudflare é obrigatório.'})
    if(!merged.accountId)return res.status(400).json({erro:'Account ID da Cloudflare é obrigatório.'})
    merged.r2Endpoint=String(merged.r2Endpoint||`https://${merged.accountId}.r2.cloudflarestorage.com`).trim()
    value=JSON.stringify({apiToken,r2AccessKeyId,r2SecretAccessKey})
  }
  if(!value)return res.status(400).json({erro:'Credencial obrigatória.'})
  await setCredential(id, value, merged)
  if(['gemini','openrouter'].includes(id)) resetAiRuntime(id)
  if(merged.primary && ['gemini','openrouter'].includes(id)){ for(const other of ['gemini','openrouter']){ if(other===id)continue; const oc=await getCredential(other,defs[other]); if(oc.value&&oc.metadata?.primary) await setCredential(other,oc.value,{...(oc.metadata||{}),primary:false}); } }
  if(id==='cloudinary') await configurarCloudinary()
  const identity=await refreshStoredIdentity(id)
  await audit(req,`${id}.atualizar`,{campos:Object.keys(metadata),identity:identity?.label||null})
  res.json({ok:true,status:safe(await getCredential(id,defs[id])),identity})
} catch(e){next(e)} })
router.delete('/:id', async(req,res,next)=>{ try { await deleteCredential(req.params.id); await audit(req,`${req.params.id}.remover`); res.json({ok:true}) } catch(e){next(e)} })
router.post('/:id/test', async(req,res)=>{ const {id}=req.params; try {
  const stored=await getCredential(id,defs[id])
  const typed=String(req.body?.secret||'').trim()
  let c={...stored,value:typed||stored.value,metadata:normalizeAiMetadata(id,{...(stored.metadata||{}),...(req.body?.metadata||{})})}
  if(id==='cloudinary'){
    let old={}; try{old=JSON.parse(stored.value||'{}')}catch{old={apiSecret:stored.value||''}}
    c={...c,cloudinary:{
      cloudName:String(c.metadata?.cloudName||old.cloudName||stored.metadata?.cloudName||'').trim(),
      apiKey:String(c.metadata?.apiKey||old.apiKey||stored.metadata?.apiKey||'').trim(),
      apiSecret:typed||old.apiSecret||'',
    }}
    c.value=c.cloudinary.apiSecret
  }
  if(id==='cloudflare'){
    let old={}; try{old=JSON.parse(stored.value||'{}')}catch{old={apiToken:stored.value||''}}
    const apiToken=typed||old.apiToken||''
    c={...c,value:apiToken,secrets:{r2AccessKeyId:String(req.body?.secrets?.r2AccessKeyId||'').trim()||old.r2AccessKeyId||'',r2SecretAccessKey:String(req.body?.secrets?.r2SecretAccessKey||'').trim()||old.r2SecretAccessKey||''}}
  }
  if(stored.locked&&!typed)throw new Error('Digite uma nova credencial para testar.')
  if(!c.value)throw new Error('Digite a credencial acima ou salve-a antes de testar.')
  if(id==='gemini'&&c.value.startsWith('sk-or-'))throw new Error('Essa é uma chave OpenRouter. No Gemini, cole a chave do Google AI Studio.')
  if(id==='openrouter'&&!c.value.startsWith('sk-or-'))throw new Error('Essa chave não parece ser do OpenRouter (sk-or-...).')
  let result={ok:true}
  if(id==='github'){
    const r=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${c.value}`,'User-Agent':'AL-Sistemas'}})
    if(!r.ok)throw new Error(`GitHub respondeu ${r.status}`)
    result.user=(await r.json()).login
  } else if(id==='cloudinary'){
    const cfg=c.cloudinary||{}
    if(!cfg.cloudName||!cfg.apiKey||!cfg.apiSecret)throw new Error('Informe Cloud Name, API Key e API Secret do Cloudinary.')
    try{
      cloudinary.config({cloud_name:cfg.cloudName,api_key:cfg.apiKey,api_secret:cfg.apiSecret})
      const ping=await cloudinary.api.ping()
      if(ping?.status && ping.status!=='ok')throw new Error(`Cloudinary respondeu ${ping.status}`)
      result.mensagem=`Cloudinary conectado • cloud ${cfg.cloudName}.`
      result.cloud={name:cfg.cloudName,status:ping?.status||'ok'}
    } finally {
      // O teste não altera a credencial ativa até o usuário tocar em Salvar.
      await configurarCloudinary().catch(()=>{})
    }
  } else if(id==='cloudflare'){
    const accountId=String(c.metadata?.accountId||'').trim()
    if(!accountId)throw new Error('Informe o Account ID da Cloudflare.')
    const headers={Authorization:`Bearer ${c.value}`,Accept:'application/json'}
    let verifyResponse=await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/verify`,{headers})
    if(!verifyResponse.ok) verifyResponse=await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify',{headers})
    const accountResponse=await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`,{headers})
    const verify=await verifyResponse.json().catch(()=>({}))
    const account=await accountResponse.json().catch(()=>({}))
    if(!verifyResponse.ok || verify.success===false)throw new Error(verify.errors?.[0]?.message||`Cloudflare respondeu ${verifyResponse.status}`)
    if(!accountResponse.ok || account.success===false)throw new Error(account.errors?.[0]?.message||'O token não conseguiu acessar o Account ID informado.')

    const r2AccessKeyId=c.secrets?.r2AccessKeyId||''
    const r2SecretAccessKey=c.secrets?.r2SecretAccessKey||''
    let s3={configured:Boolean(r2AccessKeyId&&r2SecretAccessKey),ok:false,buckets:[]}
    if(s3.configured){
      try{
        const client=new S3Client({
          region:'auto',
          endpoint:`https://${accountId}.r2.cloudflarestorage.com`,
          credentials:{accessKeyId:r2AccessKeyId,secretAccessKey:r2SecretAccessKey},
        })
        const listed=await client.send(new ListBucketsCommand({}))
        s3={configured:true,ok:true,buckets:(listed.Buckets||[]).map(x=>x.Name).filter(Boolean)}
      }catch(e){s3={configured:true,ok:false,buckets:[],error:String(e.message||e)}}
    }

    result.token={status:verify.result?.status||'active',id:verify.result?.id||null}
    result.account={id:account.result?.id||accountId,name:account.result?.name||null}
    result.s3=s3
    result.endpointS3=`https://${accountId}.r2.cloudflarestorage.com`
    result.mensagem=`Cloudflare conectada • conta ${account.result?.name||accountId}${s3.configured?(s3.ok?` • R2 S3 válido (${s3.buckets.length} bucket(s))`:' • API REST válida, mas credenciais S3 precisam de revisão'):''}.`
  } else if(id==='render'){
    const r=await fetch('https://api.render.com/v1/users',{headers:{Authorization:`Bearer ${c.value}`,Accept:'application/json'}})
    const body=await r.json().catch(()=>null)
    if(!r.ok)throw new Error(body?.message||body?.error||`Render respondeu ${r.status}`)
    const u=Array.isArray(body)?(body[0]?.user||body[0]||{}):(body?.user||body||{})
    result.mensagem=`Render conectado${u.email?` • ${u.email}`:''}.`
  } else if(id==='vercel'){
    const url=new URL('https://api.vercel.com/v2/user')
    if(c.metadata?.teamId)url.searchParams.set('teamId',c.metadata.teamId)
    const r=await fetch(url,{headers:{Authorization:`Bearer ${c.value}`,Accept:'application/json'}})
    const body=await r.json().catch(()=>({}))
    if(!r.ok)throw new Error(body.error?.message||`Vercel respondeu ${r.status}`)
    const u=body.user||body
    result.mensagem=`Vercel conectada${u.username||u.email?` • ${u.username||u.email}`:''}.`
  } else if(id==='gemini'){
    result=await testarProvedorIA({id,secret:c.value,metadata:c.metadata})
  } else if(id==='api_ninjas'){
    const r=await fetch('https://api.api-ninjas.com/v1/horoscope?zodiac=aries',{headers:{'X-Api-Key':c.value}})
    const body=await r.json().catch(()=>({}))
    if(!r.ok)throw new Error(body.error||body.message||`API Ninjas respondeu ${r.status}`)
    result.mensagem='API Ninjas conectada • horóscopo disponível.'
  } else if(id==='api_football'){
    const r=await fetch('https://v3.football.api-sports.io/status',{headers:{'x-apisports-key':c.value}})
    const body=await r.json().catch(()=>({}))
    const apiErrors=body.errors
    const hasErrors=Array.isArray(apiErrors)?apiErrors.length>0:Boolean(apiErrors&&typeof apiErrors==='object'&&Object.keys(apiErrors).length)
    if(!r.ok||hasErrors)throw new Error(Array.isArray(apiErrors)?apiErrors[0]:Object.values(apiErrors||{})[0]||body.message||`API-Football respondeu ${r.status}`)
    result.mensagem='API-Football conectada • placares e jogos disponíveis.'
  } else if(id==='openrouter'){
    result=await testarProvedorIA({id,secret:c.value,metadata:c.metadata})
  } else if(id==='resend'){
    const r=await fetch('https://api.resend.com/domains',{headers:{Authorization:`Bearer ${c.value}`,Accept:'application/json'}})
    const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.message||`Resend respondeu ${r.status}`)
    result.mensagem=`Resend conectado${c.metadata?.from?` • remetente ${c.metadata.from}`:''}.`
  } else {
    const meta=c.metadata||{}
    const url=meta.apiUrl
    if(!url) result.mensagem='Credencial armazenada com segurança. Informe uma URL da API para teste ativo.'
    else {
      const r=await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${c.value}`}})
      if(!r.ok)throw new Error(`API respondeu ${r.status}`)
    }
  }
  res.json(result)
} catch(e){res.status(400).json({ok:false,erro:e.message})} })

function dotenvValue(value='') {
  const text=String(value??'')
  if(!text) return ''
  if(/^[A-Za-z0-9_./:@+,-]+$/.test(text) && !text.includes('#')) return text
  return JSON.stringify(text)
}

async function buildIntegrationExport({includeSecrets=false}={}) {
  const bootstrap=readBootstrap()
  const rows=[]
  const add=(name,value,source='')=>{
    if(value===undefined||value===null||value==='')return
    rows.push({name,value:includeSecrets?String(value):EXPORT_MASK,source})
  }
  const mongoUri=bootstrap.MONGO_URI||process.env.MONGO_URI||''
  add('MONGO_URI',mongoUri,bootstrap.MONGO_URI?'local-vault':process.env.MONGO_URI?'environment':'')
  add('MONGO_DB_NAME',bootstrap.MONGO_DB_NAME||process.env.MONGO_DB_NAME||mongoose.connection.name||'alsistemas',bootstrap.MONGO_DB_NAME?'local-vault':'environment/default')
  add('MONGO_PROVIDER',bootstrap.MONGO_PROVIDER||process.env.MONGO_PROVIDER||'',bootstrap.MONGO_PROVIDER?'local-vault':'environment')

  for(const [id,envName] of Object.entries(defs)){
    const c=await getCredential(id,envName)
    if(!c.value)continue
    if(id==='cloudinary'){
      let parsed={}
      try{parsed=JSON.parse(c.value)}catch{}
      add('CLOUDINARY_CLOUD_NAME',parsed.cloudName||c.metadata?.cloudName||'',c.source)
      add('CLOUDINARY_API_KEY',parsed.apiKey||c.metadata?.apiKey||'',c.source)
      add('CLOUDINARY_API_SECRET',parsed.apiSecret||c.value,c.source)
    }else if(id==='cloudflare'){
      let parsed={}; try{parsed=JSON.parse(c.value)}catch{parsed={apiToken:c.value}}
      add('CF_API_TOKEN',parsed.apiToken||'',c.source)
      add('CF_ACCOUNT_ID',c.metadata?.accountId||'',c.source)
      add('CF_R2_ACCESS_KEY_ID',parsed.r2AccessKeyId||'',c.source)
      add('CF_R2_SECRET_ACCESS_KEY',parsed.r2SecretAccessKey||'',c.source)
      add('CF_R2_BUCKET',c.metadata?.r2Bucket||'',c.source)
      add('CF_R2_PUBLIC_URL',c.metadata?.r2PublicUrl||'',c.source)
      add('CF_R2_ENDPOINT',c.metadata?.r2Endpoint||'',c.source)
    }else if(id==='vercel'){
      add('VERCEL_TOKEN',c.value,c.source)
      add('VERCEL_TEAM_ID',c.metadata?.teamId||process.env.VERCEL_TEAM_ID||'',c.source)
    }else if(id==='render'){
      add('RENDER_API_KEY',c.value,c.source)
    }else if(id==='api_ninjas'){
      add('API_NINJAS_KEY',c.value,c.source)
      add('API_NINJAS_TRANSLATE_PT_BR',String(c.metadata?.translatePtBr!==false),c.source)
    }else if(id==='api_football'){
      add('API_FOOTBALL_KEY',c.value,c.source)
      add('API_FOOTBALL_LEAGUES',c.metadata?.leagueIds||'',c.source)
      add('API_FOOTBALL_MAX_MATCHES',String(c.metadata?.maxMatches||6),c.source)
      add('API_FOOTBALL_LIVE_CACHE_SECONDS',String(c.metadata?.liveCacheSeconds||300),c.source)
      add('API_FOOTBALL_SHOW_INTERNATIONAL',String(c.metadata?.showInternational!==false),c.source)
    }else if(id==='resend'){add('RESEND_API_KEY',c.value,c.source);add('NEWSLETTER_FROM',c.metadata?.from||'',c.source);add('NEWSLETTER_REPLY_TO',c.metadata?.replyTo||'',c.source)}else add(envName,c.value,c.source)
  }
  return rows
}


router.post('/identities/refresh', async(req,res)=>{ try {
  const identities={}
  for(const id of Object.keys(defs)){
    const c=await getCredential(id,defs[id])
    if(c.value) identities[id]=await refreshStoredIdentity(id)
  }
  await audit(req,'integracoes.identidades.atualizar',{providers:Object.keys(identities)})
  res.json({ok:true,identities})
} catch(e){res.status(400).json({ok:false,erro:e.message})} })

router.post('/export', async(req,res,next)=>{ try {
  const includeSecrets=Boolean(req.body?.includeSecrets)
  const format=String(req.body?.format||'env').toLowerCase()
  const rows=await buildIntegrationExport({includeSecrets})
  await audit(req,'integracoes.exportar',{includeSecrets,format,count:rows.length})
  res.setHeader('Cache-Control','no-store')
  res.setHeader('Pragma','no-cache')
  if(format==='json'){
    const identityStatus={}
    for(const id of Object.keys(defs)){const c=await getCredential(id,defs[id]);if(c.metadata?.identity)identityStatus[id]=c.metadata.identity}
    const body={product:'AL Sistemas',backupVersion:2,sourceVersion:'1.0.127',migrationCompatible:true,portableSecrets:includeSecrets,exportedAt:new Date().toISOString(),encoding:'UTF-8',includesSecrets:includeSecrets,accounts:identityStatus,variables:Object.fromEntries(rows.map(r=>[r.name,r.value]))}
    res.attachment(`al-sistemas-integracoes-${new Date().toISOString().slice(0,10)}.json`)
    return res.type('application/json').send(JSON.stringify(body,null,2))
  }
  const lines=[
    '# AL Sistemas — backup de Integrações e APIs',
    '# Backup-Version: 2',
    '# Migration-Compatible: yes',
    `# Gerado em ${new Date().toISOString()}`,
    `# Segredos ${includeSecrets?'INCLUÍDOS — mantenha este arquivo privado':'mascarados — exportação segura para referência'}`,
    '',
    ...rows.map(r=>`${r.name}=${dotenvValue(r.value)}`),
    '',
  ]
  res.attachment(`al-sistemas-integracoes-${new Date().toISOString().slice(0,10)}.env`)
  res.setHeader('Content-Type','text/plain; charset=utf-8')
  return res.send('\uFEFF'+lines.join('\n'))
} catch(e){next(e)} })


router.post('/import', async(req,res,next)=>{ try {
  const vars=req.body?.variables
  if(!vars || typeof vars!=='object' || Array.isArray(vars)) return res.status(400).json({erro:'Arquivo de importação inválido.'})
  const isMasked=(v)=>!v || v===EXPORT_MASK || v===MASK || /^\*{6,}$/.test(String(v)) || /^•{6,}$/.test(String(v))
  const imported=[]
  const skipped=[]
  const val=(name)=>typeof vars[name]==='string'?vars[name].trim():''

  const mongoUri=val('MONGO_URI')
  if(mongoUri&&!isMasked(mongoUri)){
    writeBootstrap({MONGO_URI:mongoUri,MONGO_DB_NAME:val('MONGO_DB_NAME')||'alsistemas',MONGO_PROVIDER:mongoUri.startsWith('mongodb+srv://')?'atlas':'custom'})
    imported.push('MongoDB')
  }else if(mongoUri) skipped.push('MongoDB')

  const github=val('GITHUB_TOKEN')
  if(github&&!isMasked(github)){const old=await getCredential('github',defs.github);await setCredential('github',github,old.metadata||{});imported.push('GitHub')}else if(github)skipped.push('GitHub')

  const gemini=val('GEMINI_API_KEY')
  if(gemini&&!isMasked(gemini)){const old=await getCredential('gemini',defs.gemini);await setCredential('gemini',gemini,old.metadata||{});imported.push('Gemini')}else if(gemini)skipped.push('Gemini')

  const openrouter=val('OPENROUTER_API_KEY')
  if(openrouter&&!isMasked(openrouter)){const old=await getCredential('openrouter',defs.openrouter);await setCredential('openrouter',openrouter,old.metadata||{});imported.push('OpenRouter')}else if(openrouter)skipped.push('OpenRouter')

  const cloudName=val('CLOUDINARY_CLOUD_NAME'), apiKey=val('CLOUDINARY_API_KEY'), apiSecret=val('CLOUDINARY_API_SECRET')
  if(cloudName||apiKey||apiSecret){
    if(!isMasked(apiSecret) && cloudName && apiKey){await setCredential('cloudinary',JSON.stringify({cloudName,apiKey,apiSecret}),{cloudName,apiKey});imported.push('Cloudinary')}else skipped.push('Cloudinary')
  }

  const cfToken=val('CF_API_TOKEN'), cfAccount=val('CF_ACCOUNT_ID'), cfAccess=val('CF_R2_ACCESS_KEY_ID'), cfSecret=val('CF_R2_SECRET_ACCESS_KEY'), cfBucket=val('CF_R2_BUCKET'), cfPublic=val('CF_R2_PUBLIC_URL'), cfEndpoint=val('CF_R2_ENDPOINT')
  if(cfToken||cfAccount||cfAccess||cfSecret||cfBucket||cfPublic||cfEndpoint){
    if(!isMasked(cfToken) && cfToken && cfAccount){
      const old=await getCredential('cloudflare',defs.cloudflare); let parsed={}; try{parsed=JSON.parse(old.value||'{}')}catch{}
      await setCredential('cloudflare',JSON.stringify({apiToken:cfToken,r2AccessKeyId:!isMasked(cfAccess)&&cfAccess?cfAccess:parsed.r2AccessKeyId||'',r2SecretAccessKey:!isMasked(cfSecret)&&cfSecret?cfSecret:parsed.r2SecretAccessKey||''}),{...(old.metadata||{}),accountId:cfAccount,r2Bucket:cfBucket||old.metadata?.r2Bucket||'',r2PublicUrl:cfPublic||old.metadata?.r2PublicUrl||'',r2Endpoint:cfEndpoint||old.metadata?.r2Endpoint||`https://${cfAccount}.r2.cloudflarestorage.com`})
      imported.push('Cloudflare')
    }else skipped.push('Cloudflare')
  }

  const renderKey=val('RENDER_API_KEY')
  if(renderKey&&!isMasked(renderKey)){const old=await getCredential('render',defs.render);await setCredential('render',renderKey,old.metadata||{});imported.push('Render')}else if(renderKey)skipped.push('Render')

  const vercel=val('VERCEL_TOKEN')
  if(vercel&&!isMasked(vercel)){const old=await getCredential('vercel',defs.vercel);await setCredential('vercel',vercel,{...(old.metadata||{}),teamId:val('VERCEL_TEAM_ID')||old.metadata?.teamId||''});imported.push('Vercel')}else if(vercel)skipped.push('Vercel')

  const ninjas=val('API_NINJAS_KEY')
  if(ninjas&&!isMasked(ninjas)){const old=await getCredential('api_ninjas',defs.api_ninjas);const tr=val('API_NINJAS_TRANSLATE_PT_BR');await setCredential('api_ninjas',ninjas,{...(old.metadata||{}),translatePtBr:tr?tr!=='false':old.metadata?.translatePtBr!==false});imported.push('API Ninjas')}else if(ninjas)skipped.push('API Ninjas')

  const football=val('API_FOOTBALL_KEY')
  if(football&&!isMasked(football)){const old=await getCredential('api_football',defs.api_football);const max=Number(val('API_FOOTBALL_MAX_MATCHES'));const refresh=Number(val('API_FOOTBALL_LIVE_CACHE_SECONDS'));const intl=val('API_FOOTBALL_SHOW_INTERNATIONAL');await setCredential('api_football',football,{...(old.metadata||{}),leagueIds:val('API_FOOTBALL_LEAGUES')||old.metadata?.leagueIds||'',maxMatches:Number.isFinite(max)&&max>=2&&max<=12?max:(old.metadata?.maxMatches||6),liveCacheSeconds:Number.isFinite(refresh)&&refresh>=60&&refresh<=900?refresh:(old.metadata?.liveCacheSeconds||300),showInternational:intl?intl!=='false':old.metadata?.showInternational!==false});imported.push('API-Football')}else if(football)skipped.push('API-Football')

  await audit(req,'integracoes.importar',{imported,skipped})
  res.json({ok:true,imported,skipped,mensagem:imported.length?`${imported.length} configuração(ões) importada(s) com segurança.`:'Nenhuma credencial válida encontrada para importar.'})
} catch(e){next(e)} })

router.get('/ai/usage', async(req,res)=>{ try{
  const days=Math.max(1,Math.min(90,Number(req.query.days||7)))
  res.json({ok:true,...await getAiUsageSummary(days)})
}catch(e){res.status(500).json({ok:false,erro:e.message})} })

router.post('/ai/runtime/reset', async(req,res)=>{
  const provider=['gemini','openrouter'].includes(req.body?.provider)?req.body.provider:null
  resetAiRuntime(provider)
  res.json({ok:true,provider,mensagem:provider?`Estado temporário de ${provider} reiniciado.`:'Fila/estado de provedores liberados para nova tentativa.'})
})

router.post('/password/generate', (_req,res)=>{ const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-_=?.'; let out=''; do { out=Array.from(crypto.randomBytes(36),b=>chars[b%chars.length]).join('') } while(!/[A-Z]/.test(out)||!/[a-z]/.test(out)||!/[0-9]/.test(out)||!/[!@#$%&*+\-_=?.]/.test(out)); res.json({password:out}) })
router.get('/ai/diagnostics', async(_req,res,next)=>{ try {
  const d=await diagnosticarIA({deep:true})
  res.json(d)
} catch(e){ next(e) } })

router.get('/diagnostics/run', async(_req,res)=>{ const checks=[]; checks.push({name:'MongoDB',ok:mongoose.connection.readyState===1,detail:mongoose.connection.readyState===1?mongoose.connection.name:'Desconectado'}); try{await configurarCloudinary();await cloudinary.api.ping();checks.push({name:'Cloudinary',ok:true})}catch(e){checks.push({name:'Cloudinary',ok:false,detail:e.message})}; for(const id of Object.keys(defs)){const c=await getCredential(id,defs[id]);checks.push({name:id,ok:Boolean(c.value)||Boolean(c.locked),detail:c.locked?'Credencial existe, mas a chave de criptografia não corresponde':c.value?'Configurado':'Ausente'})}; try{const ia=await diagnosticarIA({deep:false});checks.push({name:'IA · Gemini/OpenRouter',ok:ia.ok,detail:ia.status})}catch(e){checks.push({name:'IA · Gemini/OpenRouter',ok:false,detail:e.message})}; const exposed=['.env','*.pem','*.key','bootstrap.vault.json']; res.json({ok:checks.filter(c=>!['api_ninjas','api_football'].includes(c.name)).every(c=>c.ok),checks,secretPatternsProtected:exposed}) })
export default router
