/**
 * cloudflare.js — Rotas de gerenciamento da conta Cloudflare.
 *
 * Rotas disponíveis:
 *   GET  /status            — Verifica token + info da conta
 *   GET  /zonas             — Lista todas as zonas (domínios)
 *   GET  /zonas/:id/dns     — Lista registros DNS de uma zona
 *   POST /zonas/:id/dns     — Cria um registro DNS
 *   PUT  /zonas/:id/dns/:r  — Atualiza um registro DNS
 *   DEL  /zonas/:id/dns/:r  — Remove um registro DNS
 *   GET  /zonas/:id/analytics — Analytics de tráfego (últimas 24h)
 *   GET  /zonas/:id/pagerules — Regras de página ativas
 *   GET  /zonas/:id/firewall  — Eventos de firewall recentes
 *   GET  /workers           — Workers da conta
 *   GET  /zonas/:id/ssl     — Status SSL/TLS da zona
 *
 * Credenciais: configuradas em Admin → Integrações e APIs → Cloudflare.
 * Variáveis CF_* permanecem somente como fallback para instalações antigas.
 */
import { Router }              from 'express'
import multer                  from 'multer'
import { autenticar }          from '../middleware/auth.js'
import { verificarPermissao }  from '../middleware/verificarPermissao.js'
import { logger }              from '../utils/logger.js'
import { S3Client, PutObjectCommand, ListBucketsCommand, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { hydrateCloudflareEnv, getCloudflareConfig } from '../utils/cloudflareConfig.js'
import { getCredential, setCredential } from '../utils/credentialStore.js'

const router = Router()
router.use(autenticar)
router.use(verificarPermissao('configuracoes.gerenciar'))
// Cloudflare passa a usar a configuração central do cofre/MongoDB. Variáveis de ambiente
// continuam apenas como fallback para instalações antigas.
router.use(async (_req,_res,next)=>{ try { await hydrateCloudflareEnv(); next() } catch(e){ next(e) } })

// ── Upload em memória (até 50 MB) ─────────────────────────────
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// ── S3 Client para R2 ─────────────────────────────────────────
function r2S3Client() {
  return new S3Client({
    region:   'auto',
    endpoint: process.env.CF_R2_ENDPOINT || `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.CF_R2_ACCESS_KEY_ID     || '',
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY || '',
    },
  })
}

async function scanR2BucketUsage(bucket,{maxPages=20}={}){
  let bytes=0,objects=0,token,pages=0,truncated=false
  do{
    const page=await r2S3Client().send(new ListObjectsV2Command({Bucket:bucket,ContinuationToken:token,MaxKeys:1000}))
    for(const o of page.Contents||[]){bytes+=Number(o.Size||0);objects++}
    pages++
    token=page.IsTruncated?page.NextContinuationToken:undefined
    if(token&&pages>=maxPages){truncated=true;break}
  }while(token)
  return {name:bucket,bytes,objects,truncated,pages}
}

// ── Helpers ────────────────────────────────────────────────────

const CF_BASE = 'https://api.cloudflare.com/client/v4'

function cfHeaders() {
  const token = process.env.CF_API_TOKEN
  if (!token) throw new Error('CF_API_TOKEN não configurado.')
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  }
}

async function cfFetch(path, opts = {}) {
  const url = `${CF_BASE}${path}`
  const res = await fetch(url, { ...opts, headers: { ...cfHeaders(), ...opts.headers } })
  const json = await res.json().catch(() => ({}))
  if (!json.success) {
    const msg = json.errors?.[0]?.message || `Erro ${res.status}`
    throw new Error(`Cloudflare: ${msg}`)
  }
  return json
}

function accountId() {
  const id = process.env.CF_ACCOUNT_ID
  if (!id) throw new Error('CF_ACCOUNT_ID não configurado.')
  return id
}

async function verifyCloudflareToken() {
  try { return await cfFetch(`/accounts/${accountId()}/tokens/verify`) }
  catch { return cfFetch('/user/tokens/verify') }
}


function cfErrorKind(err) {
  const msg=String(err?.message||err||'')
  if(/not authorized|permission|forbidden|authentication|10000|9109|403/i.test(msg))return 'sem-permissao'
  if(/not entitled|not found|10007|404|route for the uri/i.test(msg))return 'indisponivel'
  return 'erro'
}

async function capabilityProbe({id,label,path,manager='',description=''}) {
  const started=Date.now()
  try {
    const data=await cfFetch(path)
    const result=data?.result
    const count=Number(
      data?.result_info?.total_count ??
      data?.result_info?.count ??
      (Array.isArray(result) ? result.length :
        Array.isArray(result?.buckets) ? result.buckets.length :
        Array.isArray(result?.result) ? result.result.length : 0)
    )
    return {id,label,ok:true,state:'acessivel',count:Number.isFinite(count)?count:0,manager,description,latencyMs:Date.now()-started}
  } catch(err) {
    return {id,label,ok:false,state:cfErrorKind(err),count:null,manager,description,error:String(err.message||err),latencyMs:Date.now()-started}
  }
}

const CF_CAPABILITY_CATALOG = [
  {id:'zones',label:'Zonas e DNS',manager:'zones',description:'Domínios, DNS, SSL, cache e segurança.',path:()=>`/zones?account.id=${accountId()}&per_page=1`},
  {id:'r2',label:'R2 Storage',manager:'r2',description:'Buckets e objetos persistentes.',path:()=>`/accounts/${accountId()}/r2/buckets?per_page=1`},
  {id:'workers',label:'Workers',manager:'workers',description:'Scripts executados na borda.',path:()=>`/accounts/${accountId()}/workers/scripts`},
  {id:'pages',label:'Pages',manager:'resources',description:'Projetos web e deployments.',path:()=>`/accounts/${accountId()}/pages/projects?per_page=1`},
  {id:'kv',label:'Workers KV',manager:'resources',description:'Namespaces chave/valor.',path:()=>`/accounts/${accountId()}/storage/kv/namespaces?per_page=1`},
  {id:'d1',label:'D1',manager:'resources',description:'Bancos SQL serverless.',path:()=>`/accounts/${accountId()}/d1/database?per_page=10`},
  {id:'queues',label:'Queues',manager:'resources',description:'Filas de mensagens.',path:()=>`/accounts/${accountId()}/queues`},
  {id:'vectorize',label:'Vectorize',manager:'resources',description:'Índices vetoriais para IA e busca.',path:()=>`/accounts/${accountId()}/vectorize/v2/indexes`},
  {id:'ai-gateway',label:'AI Gateway',manager:'resources',description:'Gateways de observabilidade e controle de IA.',path:()=>`/accounts/${accountId()}/ai-gateway/gateways?per_page=1`},
]

async function capabilitySnapshot() {
  return Promise.all(CF_CAPABILITY_CATALOG.map(item=>capabilityProbe({...item,path:item.path()})))
}

function resultList(data) {
  if(Array.isArray(data?.result))return data.result
  if(Array.isArray(data?.result?.buckets))return data.result.buckets
  return []
}

function normalizePublicDomain(domain) {
  const clean=String(domain||'').trim().replace(/^https?:\/\//i,'').replace(/\/+$/,'')
  return clean ? `https://${clean}` : ''
}

async function discoverR2PublicAccess(bucket) {
  const encoded=encodeURIComponent(bucket)
  const [managedResult,customResult]=await Promise.allSettled([
    cfFetch(`/accounts/${accountId()}/r2/buckets/${encoded}/domains/managed`),
    cfFetch(`/accounts/${accountId()}/r2/buckets/${encoded}/domains/custom`),
  ])

  const managedRaw=managedResult.status==='fulfilled' ? managedResult.value?.result : null
  const managed=managedRaw ? {
    domain:managedRaw.domain||null,
    enabled:Boolean(managedRaw.enabled),
    url:managedRaw.enabled ? normalizePublicDomain(managedRaw.domain) : '',
  } : null

  const customRaw=customResult.status==='fulfilled'
    ? (customResult.value?.result?.domains || customResult.value?.result || [])
    : []
  const customDomains=(Array.isArray(customRaw)?customRaw:[]).map(item=>({
    domain:item?.domain||null,
    enabled:Boolean(item?.enabled),
    ownership:item?.status?.ownership||null,
    ssl:item?.status?.ssl||null,
    url:item?.enabled ? normalizePublicDomain(item?.domain) : '',
  }))

  // Domínio personalizado só é escolhido quando propriedade e SSL já estão
  // ativos. Um domínio ainda em propagação não deve substituir um r2.dev que
  // já funciona, pois essa URL alimenta o fallback público do portal.
  const customActive=customDomains.find(d=>d.enabled && d.ownership==='active' && d.ssl==='active')
  const selected=customActive?.url
    ? {url:customActive.url,source:'custom',domain:customActive.domain}
    : managed?.url
      ? {url:managed.url,source:'r2.dev',domain:managed.domain}
      : {url:'',source:null,domain:null}

  return {
    bucket,
    publicUrl:selected.url||null,
    source:selected.source,
    managed,
    customDomains,
    errors:{
      managed:managedResult.status==='rejected' ? String(managedResult.reason?.message||managedResult.reason) : null,
      custom:customResult.status==='rejected' ? String(customResult.reason?.message||customResult.reason) : null,
    },
  }
}

// ── GET /status ─────────────────────────────────────────────────
router.get('/status', async (_req, res, next) => {
  try {
    const cfg=await getCloudflareConfig()
    const [verify, account, capabilities, s3] = await Promise.all([
      verifyCloudflareToken(),
      cfFetch(`/accounts/${accountId()}`).catch(() => null),
      capabilitySnapshot(),
      (async()=>{
        if(!cfg.r2AccessKeyId || !cfg.r2SecretAccessKey)return {configured:false,ok:false,buckets:[],reason:'Credenciais S3 não configuradas'}
        try{
          const out=await r2S3Client().send(new ListBucketsCommand({}))
          return {configured:true,ok:true,buckets:(out.Buckets||[]).map(x=>({name:x.Name,creationDate:x.CreationDate||null}))}
        }catch(err){return {configured:true,ok:false,buckets:[],reason:String(err.message||err)}}
      })(),
    ])
    res.json({
      ok:true,
      token:verify.result,
      conta:account?.result ?? null,
      account_id:accountId(),
      endpoint_s3:cfg.r2Endpoint,
      capabilities,
      s3Credentials:{
        configurado:Boolean(cfg.r2AccessKeyId && cfg.r2SecretAccessKey),
        valido:Boolean(s3.ok),
        bucket:cfg.r2Bucket||null,
        buckets:s3.buckets||[],
        erro:s3.ok?null:s3.reason||null,
        endpoint:cfg.r2Endpoint,
        publicUrl:cfg.r2PublicUrl||null,
        accessKeyMasked:cfg.r2AccessKeyId?`••••••••${cfg.r2AccessKeyId.slice(-4)}`:null,
        secretMasked:cfg.r2SecretAccessKey?'••••••••••••':null,
      },
    })
  } catch (err) {
    if (err.message.includes('não configurado')) return res.json({ok:false,erro:err.message})
    next(err)
  }
})


// ── GET /dashboard — resumo moderno da conta para a Central Cloudflare ────────
router.get('/dashboard', async (_req,res,next)=>{
  try{
    const cfg=await getCloudflareConfig()
    const optional=async(path)=>{ try{return {ok:true,data:await cfFetch(path)}}catch(err){return {ok:false,error:String(err.message||err)}} }
    const [account,accounts,subscriptions,zones,buckets]=await Promise.all([
      optional(`/accounts/${accountId()}`),
      optional('/accounts?per_page=50'),
      optional(`/accounts/${accountId()}/subscriptions`),
      optional(`/zones?account.id=${accountId()}&per_page=50`),
      optional(`/accounts/${accountId()}/r2/buckets?per_page=100`),
    ])
    let s3Usage={totalBytes:0,totalObjetos:0,buckets:[],available:false}
    if(cfg.r2AccessKeyId&&cfg.r2SecretAccessKey){
      try{
        const list=await r2S3Client().send(new ListBucketsCommand({}))
        const bucketNames=(list.Buckets||[]).map(x=>x.Name).filter(Boolean)
        const details=[]
        for(const name of bucketNames)details.push(await scanR2BucketUsage(name,{maxPages:20}))
        s3Usage={available:true,buckets:details,totalBytes:details.reduce((a,b)=>a+b.bytes,0),totalObjetos:details.reduce((a,b)=>a+b.objects,0),partial:details.some(x=>x.truncated)}
      }catch(err){s3Usage={...s3Usage,error:String(err.message||err)}}
    }
    const zoneList=resultList(zones.data)
    const planCounts={}
    for(const z of zoneList){const n=z?.plan?.name||z?.plan?.legacy_id||'Sem plano informado';planCounts[n]=(planCounts[n]||0)+1}
    res.json({
      ok:true,
      account:account.ok?account.data?.result:null,
      accounts:accounts.ok?resultList(accounts.data):[],
      accountsAvailable:accounts.ok,
      subscriptions:subscriptions.ok?resultList(subscriptions.data):[],
      subscriptionsAvailable:subscriptions.ok,
      zones:{count:zoneList.length,plans:planCounts,items:zoneList.map(z=>({id:z.id,name:z.name,status:z.status,plan:z.plan?.name||z.plan?.legacy_id||null}))},
      r2:{...s3Usage,defaultBucket:cfg.r2Bucket||null,endpoint:cfg.r2Endpoint||null,publicUrl:cfg.r2PublicUrl||null},
      unavailable:[!accounts.ok&&{name:'accounts',error:accounts.error},!subscriptions.ok&&{name:'subscriptions',error:subscriptions.error}].filter(Boolean),
    })
  }catch(err){next(err)}
})

// ── GET /capabilities — autodetecção real das superfícies acessíveis ─────────
router.get('/capabilities', async (_req,res,next)=>{
  try{
    const cfg=await getCloudflareConfig()
    const capabilities=await capabilitySnapshot()
    let s3={configured:Boolean(cfg.r2AccessKeyId&&cfg.r2SecretAccessKey),ok:false,buckets:[]}
    if(s3.configured){
      try{
        const r=await r2S3Client().send(new ListBucketsCommand({}))
        s3={...s3,ok:true,buckets:(r.Buckets||[]).map(b=>({name:b.Name,creationDate:b.CreationDate||null}))}
      }catch(e){s3.error=String(e.message||e)}
    }
    res.json({
      accountId:accountId(),
      endpointS3:cfg.r2Endpoint,
      capabilities,
      summary:{
        accessible:capabilities.filter(x=>x.ok).length,
        restricted:capabilities.filter(x=>x.state==='sem-permissao').length,
        unavailable:capabilities.filter(x=>x.state==='indisponivel').length,
        errors:capabilities.filter(x=>x.state==='erro').length,
      },
      s3,
    })
  }catch(err){next(err)}
})

// ── GET /zonas ──────────────────────────────────────────────────
router.get('/zonas', async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page  || '1')
    const limit = parseInt(req.query.limit || '20')
    const q     = req.query.q ? `&name=${encodeURIComponent(req.query.q)}` : ''

    const data = await cfFetch(
      `/zones?account.id=${accountId()}&page=${page}&per_page=${limit}&status=active${q}`
    )
    res.json({
      zonas:     data.result,
      total:     data.result_info?.total_count ?? data.result.length,
      pagina:    data.result_info?.page ?? page,
      totalPags: data.result_info?.total_pages ?? 1,
    })
  } catch (err) { next(err) }
})

// ── GET /zonas/:zoneId/dns ──────────────────────────────────────
router.get('/zonas/:zoneId/dns', async (req, res, next) => {
  try {
    const { zoneId } = req.params
    const page  = parseInt(req.query.page  || '1')
    const limit = parseInt(req.query.limit || '50')
    const tipo  = req.query.tipo ? `&type=${req.query.tipo}` : ''
    const q     = req.query.q    ? `&name=${encodeURIComponent(req.query.q)}` : ''

    const data = await cfFetch(
      `/zones/${zoneId}/dns_records?page=${page}&per_page=${limit}${tipo}${q}`
    )
    res.json({
      registros:  data.result,
      total:      data.result_info?.total_count ?? data.result.length,
      pagina:     data.result_info?.page ?? page,
      totalPags:  data.result_info?.total_pages ?? 1,
    })
  } catch (err) { next(err) }
})

// ── POST /zonas/:zoneId/dns ─────────────────────────────────────
router.post('/zonas/:zoneId/dns', async (req, res, next) => {
  try {
    const { zoneId } = req.params
    const { type, name, content, ttl = 1, proxied = false, priority } = req.body

    if (!type || !name || !content) {
      return res.status(400).json({ erro: 'Campos obrigatórios: type, name, content' })
    }

    const payload = { type: type.toUpperCase(), name, content, ttl, proxied }
    if (['MX', 'SRV', 'URI'].includes(type.toUpperCase()) && priority !== undefined) {
      payload.priority = Number(priority)
    }

    const data = await cfFetch(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body:   JSON.stringify(payload),
    })
    logger.info({ dns: data.result.id }, 'DNS record criado')
    res.status(201).json({ registro: data.result })
  } catch (err) { next(err) }
})

// ── PUT /zonas/:zoneId/dns/:recordId ────────────────────────────
router.put('/zonas/:zoneId/dns/:recordId', async (req, res, next) => {
  try {
    const { zoneId, recordId } = req.params
    const { type, name, content, ttl = 1, proxied = false, priority } = req.body

    if (!type || !name || !content) {
      return res.status(400).json({ erro: 'Campos obrigatórios: type, name, content' })
    }

    const payload = { type: type.toUpperCase(), name, content, ttl, proxied }
    if (['MX', 'SRV', 'URI'].includes(type.toUpperCase()) && priority !== undefined) {
      payload.priority = Number(priority)
    }

    const data = await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'PUT',
      body:   JSON.stringify(payload),
    })
    res.json({ registro: data.result })
  } catch (err) { next(err) }
})

// ── DELETE /zonas/:zoneId/dns/:recordId ─────────────────────────
router.delete('/zonas/:zoneId/dns/:recordId', async (req, res, next) => {
  try {
    const { zoneId, recordId } = req.params
    await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' })
    logger.info({ recordId }, 'DNS record removido')
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// ── GET /zonas/:zoneId/analytics ───────────────────────────────
router.get('/zonas/:zoneId/analytics', async (req, res, next) => {
  try {
    const { zoneId } = req.params
    const horas = parseInt(req.query.horas || '24')
    const since = new Date(Date.now() - horas * 3600 * 1000).toISOString()
    const until = new Date().toISOString()

    const data = await cfFetch(
      `/zones/${zoneId}/analytics/dashboard?since=${since}&until=${until}&continuous=true`
    )
    res.json({ analytics: data.result })
  } catch (err) { next(err) }
})

// ── GET /zonas/:zoneId/pagerules ────────────────────────────────
router.get('/zonas/:zoneId/pagerules', async (req, res, next) => {
  try {
    const { zoneId } = req.params
    const data = await cfFetch(`/zones/${zoneId}/pagerules?status=active`)
    res.json({ pagerules: data.result })
  } catch (err) { next(err) }
})

// ── GET /zonas/:zoneId/firewall ─────────────────────────────────
router.get('/zonas/:zoneId/firewall', async (req, res, next) => {
  try {
    const { zoneId } = req.params
    const limit = Math.min(100, parseInt(req.query.limit || '50'))

    const data = await cfFetch(
      `/zones/${zoneId}/firewall/events?per_page=${limit}`
    )
    res.json({ eventos: data.result || [] })
  } catch (err) {
    // Firewall events pode não estar disponível em todos os planos
    if (err.message.includes('1001') || err.message.includes('not authorized')) {
      return res.json({ eventos: [], aviso: 'Requer plano Pro ou superior.' })
    }
    next(err)
  }
})

// ── GET /zonas/:zoneId/ssl ──────────────────────────────────────
router.get('/zonas/:zoneId/ssl', async (req, res, next) => {
  try {
    const { zoneId } = req.params
    const [ssl, certs] = await Promise.all([
      cfFetch(`/zones/${zoneId}/settings/ssl`),
      cfFetch(`/zones/${zoneId}/ssl/certificate_packs`).catch(() => ({ result: [] })),
    ])
    res.json({
      modo:  ssl.result,
      certs: certs.result,
    })
  } catch (err) { next(err) }
})

// ── POST /zonas/:zoneId/purge — Purga cache ─────────────────────
router.post('/zonas/:zoneId/purge', async (req, res, next) => {
  try {
    const { zoneId } = req.params
    const { tudo, urls } = req.body
    if (!tudo && (!Array.isArray(urls) || !urls.length)) {
      return res.status(400).json({ erro: 'Forneça tudo: true ou urls: ["https://..."]' })
    }
    const payload = tudo ? { purge_everything: true } : { files: urls }
    await cfFetch(`/zones/${zoneId}/purge_cache`, { method: 'POST', body: JSON.stringify(payload) })
    logger.info({ zoneId, tudo, urlCount: urls?.length }, 'Cache purgado')
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// ── GET /workers ────────────────────────────────────────────────
router.get('/workers', async (_req, res, next) => {
  try {
    const data = await cfFetch(`/accounts/${accountId()}/workers/scripts`)
    res.json({ workers: data.result || [] })
  } catch (err) {
    if (err.message.includes('not entitled') || err.message.includes('10007')) {
      return res.json({ workers: [], aviso: 'Workers não disponíveis nesta conta.' })
    }
    next(err)
  }
})

// ── POST /r2/buckets/:bucket/upload — Upload via S3 API ────────
router.post('/r2/buckets/:bucket/upload', uploadMem.single('file'), async (req, res, next) => {
  try {
    const { bucket } = req.params
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' })

    const accessKeyId     = process.env.CF_R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY
    if (!accessKeyId || !secretAccessKey) {
      return res.status(500).json({ erro: 'CF_R2_ACCESS_KEY_ID e CF_R2_SECRET_ACCESS_KEY são obrigatórios.' })
    }

    const prefix = (req.body.prefix || '').replace(/^\//, '')
    const key    = prefix ? `${prefix}${req.file.originalname}` : req.file.originalname

    await r2S3Client().send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream',
    }))

    logger.info({ bucket, key, size: req.file.size }, 'R2 objeto enviado via CF module')
    res.json({ ok: true, key, size: req.file.size })
  } catch (err) { next(err) }
})


// ═══════════════════════════════════════════════════════════════
// HUB DE RECURSOS CLOUDFLARE
// Apenas operações oficiais e tipadas entram aqui. Acesso é determinado
// pela resposta real da API; o painel não presume que um token tenha escrita.
// ═══════════════════════════════════════════════════════════════

router.get('/resources', async (_req,res,next)=>{
  try{
    const specs=[
      ['pages','Pages',`/accounts/${accountId()}/pages/projects?per_page=100`],
      ['kv','Workers KV',`/accounts/${accountId()}/storage/kv/namespaces?per_page=100`],
      ['d1','D1',`/accounts/${accountId()}/d1/database?per_page=100`],
      ['queues','Queues',`/accounts/${accountId()}/queues`],
      ['vectorize','Vectorize',`/accounts/${accountId()}/vectorize/v2/indexes`],
      ['ai-gateway','AI Gateway',`/accounts/${accountId()}/ai-gateway/gateways?per_page=100`],
    ]
    const resources={}
    await Promise.all(specs.map(async([id,label,pathName])=>{
      try{
        const d=await cfFetch(pathName)
        resources[id]={ok:true,label,items:resultList(d),count:Number(d?.result_info?.total_count ?? resultList(d).length)}
      }catch(e){
        resources[id]={ok:false,label,items:[],count:0,state:cfErrorKind(e),error:String(e.message||e)}
      }
    }))
    res.json({resources})
  }catch(err){next(err)}
})

router.get('/pages/:project/deployments', async(req,res,next)=>{
  try{
    const d=await cfFetch(`/accounts/${accountId()}/pages/projects/${encodeURIComponent(req.params.project)}/deployments?per_page=20`)
    res.json({deployments:resultList(d),total:d?.result_info?.total_count??resultList(d).length})
  }catch(err){next(err)}
})

router.post('/pages', async(req,res,next)=>{
  try{
    const name=String(req.body?.name||'').trim()
    const production_branch=String(req.body?.production_branch||'main').trim()||'main'
    if(!name)return res.status(400).json({erro:'Informe o nome do projeto Pages.'})
    const d=await cfFetch(`/accounts/${accountId()}/pages/projects`,{
      method:'POST',body:JSON.stringify({name,production_branch}),
    })
    logger.info({name,production_branch},'Cloudflare Pages project criado')
    res.status(201).json({ok:true,project:d.result})
  }catch(err){next(err)}
})

router.get('/kv/namespaces', async(_req,res,next)=>{
  try{
    const d=await cfFetch(`/accounts/${accountId()}/storage/kv/namespaces?per_page=100`)
    res.json({namespaces:resultList(d),total:d?.result_info?.total_count??resultList(d).length})
  }catch(err){next(err)}
})
router.post('/kv/namespaces', async(req,res,next)=>{
  try{
    const title=String(req.body?.title||'').trim()
    if(!title)return res.status(400).json({erro:'Informe o nome do namespace.'})
    const d=await cfFetch(`/accounts/${accountId()}/storage/kv/namespaces`,{method:'POST',body:JSON.stringify({title})})
    res.status(201).json({ok:true,namespace:d.result})
  }catch(err){next(err)}
})
router.put('/kv/namespaces/:id', async(req,res,next)=>{
  try{
    const title=String(req.body?.title||'').trim()
    if(!title)return res.status(400).json({erro:'Informe o novo nome.'})
    const d=await cfFetch(`/accounts/${accountId()}/storage/kv/namespaces/${encodeURIComponent(req.params.id)}`,{method:'PUT',body:JSON.stringify({title})})
    res.json({ok:true,namespace:d.result})
  }catch(err){next(err)}
})
router.delete('/kv/namespaces/:id', async(req,res,next)=>{
  try{
    await cfFetch(`/accounts/${accountId()}/storage/kv/namespaces/${encodeURIComponent(req.params.id)}`,{method:'DELETE'})
    res.json({ok:true})
  }catch(err){next(err)}
})

router.get('/d1/databases', async(_req,res,next)=>{
  try{
    const d=await cfFetch(`/accounts/${accountId()}/d1/database?per_page=100`)
    res.json({databases:resultList(d),total:d?.result_info?.total_count??resultList(d).length})
  }catch(err){next(err)}
})
router.post('/d1/databases', async(req,res,next)=>{
  try{
    const name=String(req.body?.name||'').trim()
    if(!name)return res.status(400).json({erro:'Informe o nome do banco D1.'})
    const d=await cfFetch(`/accounts/${accountId()}/d1/database`,{method:'POST',body:JSON.stringify({name})})
    res.status(201).json({ok:true,database:d.result})
  }catch(err){next(err)}
})
router.delete('/d1/databases/:id', async(req,res,next)=>{
  try{
    await cfFetch(`/accounts/${accountId()}/d1/database/${encodeURIComponent(req.params.id)}`,{method:'DELETE'})
    res.json({ok:true})
  }catch(err){next(err)}
})

router.get('/queues', async(_req,res,next)=>{
  try{
    const d=await cfFetch(`/accounts/${accountId()}/queues`)
    res.json({queues:resultList(d),total:d?.result_info?.total_count??resultList(d).length})
  }catch(err){next(err)}
})
router.post('/queues', async(req,res,next)=>{
  try{
    const queue_name=String(req.body?.queue_name||'').trim()
    if(!queue_name)return res.status(400).json({erro:'Informe o nome da fila.'})
    const d=await cfFetch(`/accounts/${accountId()}/queues`,{method:'POST',body:JSON.stringify({queue_name})})
    res.status(201).json({ok:true,queue:d.result})
  }catch(err){next(err)}
})
router.delete('/queues/:id', async(req,res,next)=>{
  try{
    await cfFetch(`/accounts/${accountId()}/queues/${encodeURIComponent(req.params.id)}`,{method:'DELETE'})
    res.json({ok:true})
  }catch(err){next(err)}
})

router.get('/vectorize', async(_req,res,next)=>{
  try{
    const d=await cfFetch(`/accounts/${accountId()}/vectorize/v2/indexes`)
    res.json({indexes:resultList(d),total:resultList(d).length})
  }catch(err){next(err)}
})

router.get('/ai-gateway', async(_req,res,next)=>{
  try{
    const d=await cfFetch(`/accounts/${accountId()}/ai-gateway/gateways?per_page=100`)
    res.json({gateways:resultList(d),total:d?.result_info?.total_count??resultList(d).length})
  }catch(err){next(err)}
})

router.delete('/pages/:project', async(req,res,next)=>{
  try{
    await cfFetch(`/accounts/${accountId()}/pages/projects/${encodeURIComponent(req.params.project)}`,{method:'DELETE'})
    res.json({ok:true})
  }catch(err){next(err)}
})

router.post('/vectorize', async(req,res,next)=>{
  try{
    const name=String(req.body?.name||'').trim()
    const dimensions=Math.max(1,Math.min(1536,Number(req.body?.dimensions||768)))
    const metric=['cosine','euclidean','dot-product'].includes(req.body?.metric)?req.body.metric:'cosine'
    if(!name)return res.status(400).json({erro:'Informe o nome do índice Vectorize.'})
    const d=await cfFetch(`/accounts/${accountId()}/vectorize/v2/indexes`,{
      method:'POST',
      body:JSON.stringify({name,description:String(req.body?.description||'').trim(),config:{dimensions,metric}}),
    })
    res.status(201).json({ok:true,index:d.result})
  }catch(err){next(err)}
})
router.delete('/vectorize/:name', async(req,res,next)=>{
  try{
    await cfFetch(`/accounts/${accountId()}/vectorize/v2/indexes/${encodeURIComponent(req.params.name)}`,{method:'DELETE'})
    res.json({ok:true})
  }catch(err){next(err)}
})

router.post('/ai-gateway', async(req,res,next)=>{
  try{
    const id=String(req.body?.id||'').trim()
    if(!id)return res.status(400).json({erro:'Informe o ID do AI Gateway.'})
    const d=await cfFetch(`/accounts/${accountId()}/ai-gateway/gateways`,{
      method:'POST',
      body:JSON.stringify({
        id,
        cache_invalidate_on_update:true,
        cache_ttl:0,
        collect_logs:req.body?.collect_logs!==false,
        rate_limiting_interval:0,
        rate_limiting_limit:0,
      }),
    })
    res.status(201).json({ok:true,gateway:d.result})
  }catch(err){next(err)}
})
router.delete('/ai-gateway/:id', async(req,res,next)=>{
  try{
    await cfFetch(`/accounts/${accountId()}/ai-gateway/gateways/${encodeURIComponent(req.params.id)}`,{method:'DELETE'})
    res.json({ok:true})
  }catch(err){next(err)}
})

router.post('/r2/default-bucket', async(req,res,next)=>{
  try{
    const bucket=String(req.body?.bucket||'').trim()
    if(!bucket)return res.status(400).json({erro:'Selecione um bucket.'})
    const current=await getCredential('cloudflare','CF_API_TOKEN')
    if(!current.value)return res.status(409).json({erro:'Cloudflare ainda não está configurada em Integrações e APIs.'})
    let secrets={}
    try{secrets=JSON.parse(current.value)}catch{secrets={apiToken:current.value}}
    const list=await cfFetch(`/accounts/${accountId()}/r2/buckets?per_page=100`)
    const buckets=resultList(list)
    if(!buckets.some(b=>b.name===bucket))return res.status(404).json({erro:'Bucket não encontrado ou não acessível pelo token.'})

    // A seleção do bucket também tenta descobrir automaticamente seu endereço
    // público (custom domain ou r2.dev), eliminando a configuração manual usada
    // pela contingência do portal sempre que o token possuir permissão de R2.
    const publicAccess=await discoverR2PublicAccess(bucket)
    const previousBucket=String(current.metadata?.r2Bucket||'').trim()
    const keepPrevious=previousBucket===bucket ? String(current.metadata?.r2PublicUrl||'').trim() : ''
    const r2PublicUrl=publicAccess.publicUrl||keepPrevious
    await setCredential('cloudflare',JSON.stringify(secrets),{
      ...(current.metadata||{}),
      r2Bucket:bucket,
      r2Endpoint:`https://${accountId()}.r2.cloudflarestorage.com`,
      r2PublicUrl,
      r2PublicUrlSource:publicAccess.publicUrl?publicAccess.source:(r2PublicUrl?'manual':null),
      r2PublicUrlDetectedAt:new Date().toISOString(),
    })
    await hydrateCloudflareEnv()
    res.json({
      ok:true,
      bucket,
      publicAccess,
      publicUrl:r2PublicUrl||null,
      mensagem:r2PublicUrl
        ? `${bucket} definido como bucket padrão. URL pública detectada automaticamente.`
        : `${bucket} definido como bucket padrão. Nenhuma URL pública ativa foi detectada.`,
    })
  }catch(err){next(err)}
})

// ── GET /r2/buckets/:bucket/public-url ─────────────────────────
// Consulta somente a Cloudflare: não depende das credenciais S3 e não expõe
// segredo algum ao frontend. Retorna domínio custom ativo ou r2.dev habilitado.
router.get('/r2/buckets/:bucket/public-url', async(req,res,next)=>{
  try{
    const bucket=String(req.params.bucket||'').trim()
    if(!bucket)return res.status(400).json({erro:'Bucket obrigatório.'})
    const access=await discoverR2PublicAccess(bucket)
    res.json({ok:true,...access})
  }catch(err){next(err)}
})

export default router

// ═══════════════════════════════════════════════════════════════
// CLOUDFLARE R2 — Gerenciamento de buckets e objetos
//
// Rotas:
//   GET  /r2/buckets                        — lista buckets
//   POST /r2/buckets                        — cria bucket
//   DEL  /r2/buckets/:bucket               — deleta bucket
//   GET  /r2/buckets/:bucket/objects        — lista objetos (?prefix=&cursor=&limit=)
//   DEL  /r2/buckets/:bucket/objects        — deleta múltiplos objetos (body: keys[])
//   DEL  /r2/buckets/:bucket/objects/:key   — deleta um objeto
//   GET  /r2/usage                          — uso total da conta (bytes, objetos)
// ═══════════════════════════════════════════════════════════════

// ── GET /r2/buckets ────────────────────────────────────────────
router.get('/r2/buckets', async (_req, res, next) => {
  try {
    // O Explorer deve continuar funcional mesmo quando o API Token da conta não
    // possui a permissão REST de R2, desde que as chaves S3 tenham sido salvas.
    if (process.env.CF_R2_ACCESS_KEY_ID && process.env.CF_R2_SECRET_ACCESS_KEY) {
      try {
        const out = await r2S3Client().send(new ListBucketsCommand({}))
        return res.json({
          buckets: (out.Buckets || []).map(b => ({
            name: b.Name,
            creation_date: b.CreationDate || null,
          })),
          source: 's3',
        })
      } catch (s3Err) {
        logger.warn({ err: s3Err?.message }, 'Falha ao listar buckets pelo R2 S3; tentando API Cloudflare')
      }
    }
    const data = await cfFetch(`/accounts/${accountId()}/r2/buckets?per_page=100`)
    res.json({ buckets: data.result?.buckets ?? data.result ?? [], source: 'cloudflare-api' })
  } catch (err) { next(err) }
})

// ── POST /r2/buckets ───────────────────────────────────────────
router.post('/r2/buckets', async (req, res, next) => {
  try {
    const { name, locationHint } = req.body
    if (!name?.trim()) return res.status(400).json({ erro: 'Nome do bucket é obrigatório.' })
    const payload = { name: name.trim() }
    if (locationHint) payload.locationHint = locationHint
    const data = await cfFetch(`/accounts/${accountId()}/r2/buckets`, {
      method: 'POST',
      body:   JSON.stringify(payload),
    })
    logger.info({ bucket: name }, 'R2 bucket criado')
    res.status(201).json({ bucket: data.result })
  } catch (err) { next(err) }
})

// ── DELETE /r2/buckets/:bucket ─────────────────────────────────
router.delete('/r2/buckets/:bucket', async (req, res, next) => {
  try {
    await cfFetch(`/accounts/${accountId()}/r2/buckets/${req.params.bucket}`, {
      method: 'DELETE',
    })
    logger.info({ bucket: req.params.bucket }, 'R2 bucket deletado')
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// ── GET /r2/buckets/:bucket/objects ────────────────────────────
router.get('/r2/buckets/:bucket/objects', async (req, res, next) => {
  try {
    const { bucket }  = req.params
    const limit  = Math.min(1000, Math.max(1, parseInt(req.query.limit || '250') || 250))
    const prefix = String(req.query.prefix || '')
    const cursor = String(req.query.cursor || '')
    const delim  = String(req.query.delim || '')

    // Quando as credenciais S3 do R2 existem, use a API S3-compatible para listar.
    // Ela é a mesma credencial usada pelo upload e evita depender do formato REST
    // da Cloudflare, que passou a retornar `result` como array + `result_info`.
    if (process.env.CF_R2_ACCESS_KEY_ID && process.env.CF_R2_SECRET_ACCESS_KEY) {
      const data = await r2S3Client().send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        Delimiter: delim || undefined,
        MaxKeys: limit,
        ContinuationToken: cursor || undefined,
      }))
      return res.json({
        objetos: (data.Contents || []).map(o => ({
          key: o.Key,
          size: o.Size || 0,
          etag: String(o.ETag || '').replace(/^"|"$/g, ''),
          uploaded: o.LastModified || null,
          storage_class: o.StorageClass || null,
        })),
        prefixos: (data.CommonPrefixes || []).map(x => x.Prefix).filter(Boolean),
        truncated: Boolean(data.IsTruncated),
        cursor: data.NextContinuationToken || null,
      })
    }

    // Fallback REST para instalações antigas que ainda não configuraram S3.
    const params = new URLSearchParams({ per_page: String(limit) })
    if (prefix) params.set('prefix', prefix)
    if (cursor) params.set('cursor', cursor)
    if (delim)  params.set('delimiter', delim)
    const data = await cfFetch(`/accounts/${accountId()}/r2/buckets/${bucket}/objects?${params}`)
    const info = data.result_info || {}
    const objetos = Array.isArray(data.result) ? data.result : (data.result?.objects || [])
    return res.json({
      objetos,
      prefixos: info.delimited || data.result?.delimited_prefixes || [],
      truncated: Boolean(info.is_truncated ?? data.result?.truncated ?? false),
      cursor: info.cursor || data.result?.cursor || null,
    })
  } catch (err) { next(err) }
})


function normalizeR2Key(value=''){
  return String(value||'').replace(/^\/+/, '').replace(/[\u0000-\u001f]/g,'').slice(0,1024)
}

// Cria uma pasta lógica no R2. S3/R2 não possui diretórios reais; um objeto .keep
// mantém a pasta visível mesmo antes de receber arquivos.
router.post('/r2/buckets/:bucket/folders', async(req,res,next)=>{
  try{
    const {bucket}=req.params
    if(!process.env.CF_R2_ACCESS_KEY_ID||!process.env.CF_R2_SECRET_ACCESS_KEY)return res.status(409).json({erro:'Configure as credenciais S3 do R2 em Integrações e APIs.'})
    const parent=normalizeR2Key(req.body?.prefix||'')
    const raw=normalizeR2Key(req.body?.name||'').replace(/\/+$/,'')
    if(!raw)return res.status(400).json({erro:'Informe o nome da pasta.'})
    const key=`${parent}${parent&&!parent.endsWith('/')?'/':''}${raw}/.keep`
    await r2S3Client().send(new PutObjectCommand({Bucket:bucket,Key:key,Body:'',ContentType:'application/x-directory'}))
    res.status(201).json({ok:true,prefix:key.replace(/\.keep$/,'')})
  }catch(err){next(err)}
})

// Metadados de um objeto, usados pelo painel lateral do Explorer.
router.get('/r2/buckets/:bucket/object-info', async(req,res,next)=>{
  try{
    const key=normalizeR2Key(req.query?.key||'')
    if(!key)return res.status(400).json({erro:'Informe a chave do objeto.'})
    const out=await r2S3Client().send(new HeadObjectCommand({Bucket:req.params.bucket,Key:key}))
    res.json({ok:true,key,size:Number(out.ContentLength||0),contentType:out.ContentType||'application/octet-stream',lastModified:out.LastModified||null,etag:String(out.ETag||'').replace(/^"|"$/g,''),metadata:out.Metadata||{},cacheControl:out.CacheControl||null})
  }catch(err){if(err?.$metadata?.httpStatusCode===404||err?.name==='NotFound')return res.status(404).json({erro:'Arquivo não encontrado.'});next(err)}
})

// Visualização/download autenticado. Evita exigir que o bucket seja público.
router.get('/r2/buckets/:bucket/object', async(req,res,next)=>{
  try{
    const key=normalizeR2Key(req.query?.key||'')
    if(!key)return res.status(400).json({erro:'Informe a chave do objeto.'})
    const out=await r2S3Client().send(new GetObjectCommand({Bucket:req.params.bucket,Key:key}))
    res.setHeader('Content-Type',out.ContentType||'application/octet-stream')
    if(out.ContentLength!=null)res.setHeader('Content-Length',String(out.ContentLength))
    if(out.ETag)res.setHeader('ETag',String(out.ETag))
    const name=key.split('/').filter(Boolean).pop()||'arquivo'
    res.setHeader('Content-Disposition',`${String(req.query.download)==='1'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`)
    res.setHeader('Cache-Control','private, max-age=60')
    if(out.Body?.pipe)return out.Body.pipe(res)
    const bytes=out.Body?.transformToByteArray?await out.Body.transformToByteArray():new Uint8Array()
    res.end(Buffer.from(bytes))
  }catch(err){if(err?.$metadata?.httpStatusCode===404||err?.name==='NoSuchKey')return res.status(404).json({erro:'Arquivo não encontrado.'});next(err)}
})

// Renomeia ou move um objeto (copy + delete, sem baixar o arquivo para o servidor).
router.post('/r2/buckets/:bucket/move', async(req,res,next)=>{
  try{
    const bucket=req.params.bucket
    const from=normalizeR2Key(req.body?.from||''),to=normalizeR2Key(req.body?.to||'')
    if(!from||!to)return res.status(400).json({erro:'Informe origem e destino.'})
    if(from===to)return res.json({ok:true,key:to})
    await r2S3Client().send(new CopyObjectCommand({Bucket:bucket,Key:to,CopySource:`${encodeURIComponent(bucket)}/${from.split('/').map(encodeURIComponent).join('/')}`}))
    await r2S3Client().send(new DeleteObjectCommand({Bucket:bucket,Key:from}))
    logger.info({bucket,from,to},'R2 objeto movido')
    res.json({ok:true,key:to})
  }catch(err){next(err)}
})

// ── DELETE /r2/buckets/:bucket/objects  (lote) ─────────────────
router.delete('/r2/buckets/:bucket/objects', async (req, res, next) => {
  try {
    const { bucket } = req.params
    const { keys }   = req.body           // string[]
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ erro: 'Forneça um array "keys" com as chaves a deletar.' })
    }
    let erros=[]
    if(process.env.CF_R2_ACCESS_KEY_ID&&process.env.CF_R2_SECRET_ACCESS_KEY){
      const out=await r2S3Client().send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:keys.slice(0,1000).map(Key=>({Key})),Quiet:false}}))
      erros=(out.Errors||[]).map(e=>`${e.Key}: ${e.Message||e.Code||'falha'}`)
    }else{
      const resultados=await Promise.allSettled(keys.map(k=>cfFetch(`/accounts/${accountId()}/r2/buckets/${bucket}/objects/${encodeURIComponent(k)}`,{method:'DELETE'})))
      erros=resultados.map((r,i)=>r.status==='rejected'?`${keys[i]}: ${r.reason?.message}`:null).filter(Boolean)
    }
    logger.info({ bucket, total: keys.length, erros: erros.length }, 'R2 objetos deletados em lote')
    res.json({ ok: erros.length === 0, deletados: keys.length - erros.length, erros })
  } catch (err) { next(err) }
})

// ── DELETE /r2/buckets/:bucket/objects/:key ────────────────────
router.delete('/r2/buckets/:bucket/objects/:key(*)', async (req, res, next) => {
  try {
    const { bucket, key } = req.params
    if(process.env.CF_R2_ACCESS_KEY_ID&&process.env.CF_R2_SECRET_ACCESS_KEY)await r2S3Client().send(new DeleteObjectCommand({Bucket:bucket,Key:key}))
    else await cfFetch(`/accounts/${accountId()}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`,{method:'DELETE'})
    logger.info({ bucket, key }, 'R2 objeto deletado')
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// ── GET /r2/usage ──────────────────────────────────────────────
router.get('/r2/usage', async (_req, res, next) => {
  try {
    if(process.env.CF_R2_ACCESS_KEY_ID&&process.env.CF_R2_SECRET_ACCESS_KEY){
      const list=await r2S3Client().send(new ListBucketsCommand({}))
      const detalhes=[]
      for(const b of list.Buckets||[]){
        if(!b.Name)continue
        const u=await scanR2BucketUsage(b.Name,{maxPages:20})
        detalhes.push({nome:b.Name,criado:b.CreationDate||null,bytes:u.bytes,objetos:u.objects,uploads:null,parcial:u.truncated})
      }
      return res.json({buckets:detalhes,totalBytes:detalhes.reduce((a,b)=>a+b.bytes,0),totalObjetos:detalhes.reduce((a,b)=>a+b.objetos,0),parcial:detalhes.some(x=>x.parcial),source:'s3'})
    }
    const bucketsData=await cfFetch(`/accounts/${accountId()}/r2/buckets?per_page=100`)
    const buckets=bucketsData.result?.buckets??bucketsData.result??[]
    const metricas=await Promise.allSettled(buckets.map(b=>cfFetch(`/accounts/${accountId()}/r2/buckets/${b.name}/usage`).catch(()=>null)))
    const detalhes=buckets.map((b,i)=>{const m=metricas[i].status==='fulfilled'?metricas[i].value?.result:null;return {nome:b.name,criado:b.creation_date,bytes:m?.payload_size??0,objetos:m?.object_count??0,uploads:m?.upload_count??0}})
    res.json({buckets:detalhes,totalBytes:detalhes.reduce((s,d)=>s+d.bytes,0),totalObjetos:detalhes.reduce((s,d)=>s+d.objetos,0),source:'rest'})
  } catch (err) { next(err) }
})
