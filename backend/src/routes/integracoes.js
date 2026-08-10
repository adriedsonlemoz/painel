import { Router } from 'express'
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { v2 as cloudinary } from 'cloudinary'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { getCredential, setCredential, deleteCredential } from '../utils/credentialStore.js'
import { readBootstrap, writeBootstrap, deleteBootstrapKeys, vaultPaths } from '../utils/localVault.js'
import { conectarMongo, configurarCloudinary } from '../config/index.js'
import AuditLog from '../models/AuditLog.js'

const router = Router(); router.use(autenticar, verificarPermissao('configuracoes.gerenciar'))
const MASK='••••••••••••••••'
const EXPORT_MASK='****************'
const defs = { github:'GITHUB_TOKEN', cloudinary:'CLOUDINARY', groq:'GROQ_API_KEY', openai:'OPENAI_API_KEY', gemini:'GEMINI_API_KEY', anthropic:'ANTHROPIC_API_KEY', openrouter:'OPENROUTER_API_KEY', custom:'CUSTOM_AI_API_KEY' }
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
  const mongoUri=b.MONGO_URI||process.env.MONGO_URI||''
  let mongoHost=null
  try { mongoHost=mongoUri?new URL(mongoUri.replace(/^mongodb\+srv:/,'https:').replace(/^mongodb:/,'http:')).host:null } catch {}
  let mongoUsername=null
  try { mongoUsername=mongoUri?decodeURIComponent(new URL(mongoUri.replace(/^mongodb\+srv:/,'https:').replace(/^mongodb:/,'http:')).username||'')||null:null } catch {}
  const vercelCredential=await getCredential('vercel','VERCEL_TOKEN')
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
    vercel:{configured:Boolean(vercelCredential.value),identity:vercelCredential.metadata?.identity||null},
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

async function vercelIdentity() {
  const c=await getCredential('vercel','VERCEL_TOKEN')
  if(!c.value)return {available:false,provider:'vercel',reason:'not-configured',label:'Vercel não configurada'}
  const r=await fetch('https://api.vercel.com/v2/user',{headers:{Authorization:`Bearer ${c.value}`}})
  const body=await r.json().catch(()=>({}))
  if(!r.ok)throw new Error(body.error?.message||`Vercel respondeu ${r.status}`)
  const u=body.user||body
  return {available:true,provider:'vercel',kind:'user',label:u.name||u.username||u.email||'Conta Vercel',username:u.username||null,email:u.email||null,accountId:u.id||null,detectedAt:new Date().toISOString()}
}

async function integrationIdentity(id,c) {
  if(!c?.value)return {available:false,provider:id,reason:'not-configured',label:'Não configurada'}
  if(id==='github')return githubIdentity(c.value)
  if(id==='cloudinary'){
    let parsed={}; try{parsed=JSON.parse(c.value)}catch{}
    const cloudName=parsed.cloudName||c.metadata?.cloudName||null
    return {available:Boolean(cloudName),provider:id,kind:'product-environment',label:cloudName?`Cloud Name: ${cloudName}`:'Cloudinary configurado',cloudName,email:null,detectedAt:new Date().toISOString(),note:'A credencial identifica o ambiente Cloudinary; a API usada pelo AL Sistemas não expõe o e-mail da conta.'}
  }
  const labels={groq:'Groq',openai:'OpenAI',gemini:'Gemini',anthropic:'Anthropic',openrouter:'OpenRouter',custom:'API personalizada'}
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


router.put('/:id', async(req,res,next)=>{ try { const {id}=req.params; if(!defs[id])return res.status(404).json({erro:'Integração inválida.'}); const {secret,metadata={}}=req.body; if(!secret)return res.status(400).json({erro:'Credencial obrigatória.'}); await setCredential(id, id==='cloudinary'?JSON.stringify({...metadata,apiSecret:secret}):secret, metadata); if(id==='cloudinary') await configurarCloudinary(); const identity=await refreshStoredIdentity(id); await audit(req,`${id}.atualizar`,{campos:Object.keys(metadata),identity:identity?.label||null}); res.json({ok:true,status:safe(await getCredential(id,defs[id])),identity}) } catch(e){next(e)} })
router.delete('/:id', async(req,res,next)=>{ try { await deleteCredential(req.params.id); await audit(req,`${req.params.id}.remover`); res.json({ok:true}) } catch(e){next(e)} })
router.post('/:id/test', async(req,res)=>{ const {id}=req.params; try {
  const c=await getCredential(id,defs[id])
  if(c.locked)throw new Error('A credencial existe, mas foi criptografada por outra instalação. Substitua-a por uma nova chave.')
  if(!c.value)throw new Error('Credencial não configurada.')
  let result={ok:true}
  if(id==='github'){
    const r=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${c.value}`,'User-Agent':'AL-Sistemas'}})
    if(!r.ok)throw new Error(`GitHub respondeu ${r.status}`)
    result.user=(await r.json()).login
  } else if(id==='cloudinary'){
    await configurarCloudinary(); await cloudinary.api.ping()
    result.mensagem='Cloudinary conectado e credenciais válidas.'
  } else if(id==='groq'){
    const r=await fetch('https://api.groq.com/openai/v1/models',{headers:{Authorization:`Bearer ${c.value}`}})
    if(!r.ok)throw new Error(`Groq respondeu ${r.status}`)
    const body=await r.json().catch(()=>({}))
    result.mensagem=`Groq conectado${Array.isArray(body.data)?` • ${body.data.length} modelo(s) disponível(is)`:''}.`
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
    }else add(envName,c.value,c.source)
  }
  const vercel=await getCredential('vercel','VERCEL_TOKEN')
  if(vercel.value){
    add('VERCEL_TOKEN',vercel.value,vercel.source)
    add('VERCEL_TEAM_ID',vercel.metadata?.teamId||process.env.VERCEL_TEAM_ID||'',vercel.source)
  }
  return rows
}


router.post('/identities/refresh', async(req,res)=>{ try {
  const identities={}
  for(const id of Object.keys(defs)){
    const c=await getCredential(id,defs[id])
    if(c.value) identities[id]=await refreshStoredIdentity(id)
  }
  try{
    const v=await getCredential('vercel','VERCEL_TOKEN')
    if(v.value){ const identity=await vercelIdentity(); await setCredential('vercel',v.value,{...(v.metadata||{}),identity}); identities.vercel=identity }
  }catch(e){ identities.vercel={available:false,provider:'vercel',label:'Não foi possível identificar a conta',note:e.message} }
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
    const vc=await getCredential('vercel','VERCEL_TOKEN');if(vc.metadata?.identity)identityStatus.vercel=vc.metadata.identity
    const body={product:'AL Sistemas',exportedAt:new Date().toISOString(),encoding:'UTF-8',includesSecrets:includeSecrets,accounts:identityStatus,variables:Object.fromEntries(rows.map(r=>[r.name,r.value]))}
    res.attachment(`al-sistemas-integracoes-${new Date().toISOString().slice(0,10)}.json`)
    return res.type('application/json').send(JSON.stringify(body,null,2))
  }
  const lines=[
    '# AL Sistemas — backup de Integrações e APIs',
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

router.post('/password/generate', (_req,res)=>{ const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-_=?.'; let out=''; do { out=Array.from(crypto.randomBytes(36),b=>chars[b%chars.length]).join('') } while(!/[A-Z]/.test(out)||!/[a-z]/.test(out)||!/[0-9]/.test(out)||!/[!@#$%&*+\-_=?.]/.test(out)); res.json({password:out}) })
router.get('/diagnostics/run', async(_req,res)=>{ const checks=[]; checks.push({name:'MongoDB',ok:mongoose.connection.readyState===1,detail:mongoose.connection.readyState===1?mongoose.connection.name:'Desconectado'}); try{await configurarCloudinary();await cloudinary.api.ping();checks.push({name:'Cloudinary',ok:true})}catch(e){checks.push({name:'Cloudinary',ok:false,detail:e.message})}; for(const id of ['github','cloudinary','groq','openai','gemini','anthropic','openrouter','custom']){const c=await getCredential(id,defs[id]);checks.push({name:id,ok:Boolean(c.value),detail:c.locked?'Credencial existe, mas a chave de criptografia não corresponde':c.value?'Configurado':'Ausente'})}; const exposed=['.env','*.pem','*.key','bootstrap.vault.json']; res.json({ok:checks.every(c=>c.ok),checks,secretPatternsProtected:exposed}) })
export default router
