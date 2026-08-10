import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import http from 'node:http'
import crypto from 'node:crypto'
import { ROOT_DIR, STATE_DIR, STAGING_DIR, SNAPSHOT_DIR, JOB_DIR, HISTORY_FILE, PRESERVE_PATHS, TRANSACTION_DIR, verifyStageIntegrity, touchUpdateLock, releaseUpdateLock } from '../services/systemUpdateService.js'
import { gravarErroSistemaSpool } from '../services/systemErrorSpool.js'

const jobFile = process.argv[2]
if (!jobFile) process.exit(2)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const exists = async f => { try { await fs.access(f); return true } catch { return false } }
const readJson = async f => JSON.parse(await fs.readFile(f,'utf8'))
const writeJson = async (f,v) => {
  await fs.mkdir(path.dirname(f),{recursive:true})
  const tmp=`${f}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  await fs.writeFile(tmp,JSON.stringify(v,null,2))
  await fs.rename(tmp,f)
}
const recoveryMode=process.argv.includes('--recover')
let job = await readJson(jobFile)
let heartbeatTimer=null

async function updateJob(patch){ job={...job,...patch,heartbeatAt:new Date().toISOString()}; await writeJson(jobFile,job) }
async function phase(key,label,progress,extra={}) {
  const entry={key,label,progress,at:new Date().toISOString(),...extra}
  const timeline=[...(job.timeline||[]),entry].slice(-30)
  await updateJob({phase:key,phaseLabel:label,phaseAt:new Date().toISOString(),progress,timeline,...extra})
}

function startHeartbeat(){
  if(heartbeatTimer)return
  heartbeatTimer=setInterval(()=>{void touchUpdateLock(job.id,recoveryMode?'recovering':'running')},5000)
  heartbeatTimer.unref?.()
  void touchUpdateLock(job.id,recoveryMode?'recovering':'running')
}
function stopHeartbeat(){if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null}}

const WATCHDOG_SOURCE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'updateWatchdog.cjs')
const RECOVERY_CLI_SOURCE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'updateRecoveryCli.cjs')
const RUNTIME_DIR=path.join(STATE_DIR,'runtime')
const WATCHDOG_RUNTIME=path.join(RUNTIME_DIR,'updateWatchdog.cjs')
const RECOVERY_CLI_RUNTIME=path.join(RUNTIME_DIR,'recoverPending.cjs')
const PENDING_RECOVERY_FILE=path.join(STATE_DIR,'pending-recovery.json')
let watchdogProcess=null

async function ensureWatchdogRuntime(){
  await fs.mkdir(RUNTIME_DIR,{recursive:true})
  await fs.copyFile(WATCHDOG_SOURCE,WATCHDOG_RUNTIME)
  await fs.copyFile(RECOVERY_CLI_SOURCE,RECOVERY_CLI_RUNTIME)
  return WATCHDOG_RUNTIME
}
async function startWatchdog(){
  if(recoveryMode||watchdogProcess)return
  const script=await ensureWatchdogRuntime()
  await writeJson(PENDING_RECOVERY_FILE,{jobId:job.id,jobFile,rootDir:ROOT_DIR,stateDir:STATE_DIR,snapshotId:job.snapshotId,createdAt:new Date().toISOString(),recoveryCli:RECOVERY_CLI_RUNTIME})
  watchdogProcess=spawn(process.execPath,[script,jobFile,ROOT_DIR,STATE_DIR,String(process.pid)],{detached:true,stdio:'ignore'})
  watchdogProcess.unref()
  await updateJob({watchdog:{pid:watchdogProcess.pid,runtime:WATCHDOG_RUNTIME,recoveryCli:RECOVERY_CLI_RUNTIME,startedAt:new Date().toISOString()}})
}

let monitorServer=null
let monitorStarted=false

async function urlOk(url,timeout=1800){
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(timeout),redirect:'manual'})
    return r.status>=200 && r.status<500
  }catch{return false}
}

function monitorHtml(){
  const safeReturn=JSON.stringify(`${job.frontendUrl||'http://127.0.0.1:5173'}${job.returnPath||'/admin/atualizacoes'}?updateJob=${encodeURIComponent(job.id)}`)
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atualizando AL Sistemas</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{min-height:100vh;display:grid;place-items:center;padding:18px}.card{width:min(100%,620px);background:#fff;border:1px solid #dfe6ef;border-radius:18px;padding:22px;box-shadow:0 18px 50px rgba(15,23,42,.10)}
.eyebrow{font-size:11px;font-weight:800;letter-spacing:.08em;color:#64748b}.title{font-size:24px;margin:6px 0 5px}.sub{color:#64748b;font-size:13px;line-height:1.5}
.row{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-top:18px}.pct{font-size:25px;font-weight:800;color:#2563eb}
.bar{height:10px;background:#e8eef6;border-radius:999px;overflow:hidden;margin:12px 0 16px}.fill{height:100%;width:0;background:#2563eb;transition:width .35s ease}
.status{font-weight:750;font-size:17px}.timeline{display:grid;gap:7px;margin-top:14px}.step{display:grid;grid-template-columns:18px 1fr auto;gap:8px;font-size:12px;color:#64748b}.step.current{color:#172033;font-weight:700}
.note{margin-top:16px;padding:11px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.5}
.error{border-color:#fecaca;background:#fff7f7;color:#b91c1c}.ok{border-color:#bbf7d0;background:#f0fdf4;color:#166534}
.small{font-size:11px;color:#94a3b8;margin-top:10px;overflow-wrap:anywhere}
</style></head>
<body><div class="wrap"><main class="card">
<div class="eyebrow">AL SISTEMAS · ATUALIZAÇÃO SEGURA</div>
<div class="row"><div><h1 class="title">Servidor sendo atualizado</h1><div class="sub">Esta página é independente do Vite/React e continuará aberta enquanto os arquivos do sistema forem substituídos.</div></div><div id="pct" class="pct">0%</div></div>
<div class="bar"><div id="fill" class="fill"></div></div>
<div id="status" class="status">Preparando atualização…</div>
<div id="timeline" class="timeline"></div>
<div id="note" class="note">A conexão com o painel pode cair temporariamente. Não feche esta página.</div>
<div id="job" class="small">Job ${job.id}</div>
</main></div>
<script>
const RETURN_URL=${safeReturn};
let terminalSeen=false,redirectTimer=null,offlineCount=0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function tick(){
 try{
   const r=await fetch('/status?job=${encodeURIComponent(job.id)}',{cache:'no-store'});
   const d=await r.json(); const j=d.job||{};
   offlineCount=0;
   const p=Math.max(0,Math.min(100,Number(j.progress||0)));
   document.getElementById('pct').textContent=p+'%'; document.getElementById('fill').style.width=p+'%';
   document.getElementById('status').textContent=j.phaseLabel||j.status||'Atualizando…';
   const tl=(j.timeline||[]).slice(-9);
   document.getElementById('timeline').innerHTML=tl.map((x,i)=>'<div class="step '+(i===tl.length-1?'current':'')+'"><span>'+(i===tl.length-1&&!d.terminal?'●':'✓')+'</span><span>'+esc(x.label||x.key)+'</span><span>'+esc(x.progress??'')+(x.progress!==undefined?'%':'')+'</span></div>').join('');
   const note=document.getElementById('note');
   if(j.error){note.className='note error';note.innerHTML='<b>Erro:</b> '+esc(j.error);}
   else if(d.terminal && d.frontendReady){
     note.className='note ok';note.innerHTML='<b>Atualização finalizada.</b> O painel voltou a responder. Retornando automaticamente…';
     if(!redirectTimer) redirectTimer=setTimeout(()=>location.replace(RETURN_URL),2200);
   }else if(d.terminal){
     note.className='note';note.textContent='A operação terminou. Aguardando o frontend voltar a responder…';
   }else if(!d.backendReady){
     note.className='note';note.textContent='Backend reiniciando. O atualizador externo continua trabalhando normalmente…';
   }else{
     note.className='note';note.textContent='Atualização em andamento. A conexão com o painel pode ser interrompida temporariamente.';
   }
 }catch(e){
   offlineCount++;
   document.getElementById('note').textContent='Aguardando comunicação com o atualizador externo… tentativa '+offlineCount;
 }
}
tick();setInterval(tick,1200);
</script></body></html>`
}

async function startMonitor(){
  if(!job.monitorPort || monitorStarted) return
  await new Promise((resolve,reject)=>{
    monitorServer=http.createServer(async(req,res)=>{
      res.setHeader('Cache-Control','no-store')
      res.setHeader('Access-Control-Allow-Origin','*')
      if(req.url?.startsWith('/health')){
        res.setHeader('Content-Type','application/json')
        return res.end(JSON.stringify({ok:true,jobId:job.id}))
      }
      if(req.url?.startsWith('/status')){
        let fresh=job
        try{fresh=await readJson(jobFile)}catch{}
        const terminal=['completed','restart-required','rolled-back','failed'].includes(fresh.status)
        const [backendReady,frontendReady]=await Promise.all([
          urlOk(fresh.healthUrl||job.healthUrl),
          urlOk(fresh.frontendUrl||job.frontendUrl),
        ])
        res.setHeader('Content-Type','application/json; charset=utf-8')
        return res.end(JSON.stringify({job:fresh,terminal,backendReady,frontendReady}))
      }
      res.setHeader('Content-Type','text/html; charset=utf-8')
      res.end(monitorHtml())
    })
    monitorServer.once('error',reject)
    monitorServer.listen(job.monitorPort,'127.0.0.1',()=>{monitorStarted=true;resolve()})
  })
}

async function finishWithMonitor(code=0){
  stopHeartbeat()
  await releaseUpdateLock(job.id).catch(()=>{})
  await fs.rm(PENDING_RECOVERY_FILE,{force:true}).catch(()=>{})
  // Mantém a página externa viva o bastante para ela detectar frontend/backend
  // e redirecionar de volta ao painel. Sem monitor, encerra imediatamente.
  if(!monitorStarted) return process.exit(code)
  const deadline=Date.now()+120000
  while(Date.now()<deadline){
    if(await urlOk(job.frontendUrl||'http://127.0.0.1:5173',1500)){
      await sleep(6000)
      break
    }
    await sleep(1500)
  }
  try{monitorServer?.close()}catch{}
  process.exit(code)
}
async function history(entry){ let h=[]; try{h=await readJson(HISTORY_FILE)}catch{}; h.unshift(entry); await writeJson(HISTORY_FILE,h.slice(0,100)) }

const MAINTENANCE_FILE=path.join(STATE_DIR,'maintenance.json')

async function setMaintenance(active,detail={}){
  if(!job.maintenanceMode) return
  if(!active){
    await fs.rm(MAINTENANCE_FILE,{force:true}).catch(()=>{})
    return
  }
  await writeJson(MAINTENANCE_FILE,{
    active:true,jobId:job.id,fromVersion:job.fromVersion,toVersion:job.toVersion,
    startedAt:new Date().toISOString(),message:'O AL Sistemas está aplicando uma atualização. Tente novamente em instantes.',
    ...detail,
  })
}

async function pruneSnapshots(keep=3){
  const items=[]
  for(const name of await fs.readdir(SNAPSHOT_DIR).catch(()=>[])){
    try{
      const meta=await readJson(path.join(SNAPSHOT_DIR,name,'snapshot.json'))
      items.push({name,createdAt:new Date(meta.createdAt||0).getTime(),safe:meta.safe!==false})
    }catch{}
  }
  items.sort((a,b)=>b.createdAt-a.createdAt)
  const protectedNames=new Set(items.slice(0,Math.max(1,keep)).map(x=>x.name))
  if(job.snapshotId) protectedNames.add(job.snapshotId)
  const removed=[]
  for(const item of items){
    if(protectedNames.has(item.name)) continue
    await fs.rm(path.join(SNAPSHOT_DIR,item.name),{recursive:true,force:true})
    removed.push(item.name)
  }
  return removed
}

async function pruneStateFiles(dir,keep,currentName){
  const items=[]
  for(const name of await fs.readdir(dir).catch(()=>[])){
    if(name===currentName)continue
    try{const st=await fs.stat(path.join(dir,name));items.push({name,mtime:st.mtimeMs})}catch{}
  }
  items.sort((a,b)=>b.mtime-a.mtime)
  for(const item of items.slice(Math.max(1,keep)))await fs.rm(path.join(dir,item.name),{recursive:true,force:true}).catch(()=>{})
}
async function housekeeping(){
  await pruneStateFiles(TRANSACTION_DIR,20,`${job.id}.json`).catch(()=>{})
  await pruneStateFiles(JOB_DIR,100,`${job.id}.json`).catch(()=>{})
}
function durationMs(){return Math.max(0,Date.now()-new Date(job.startedAt||job.createdAt||Date.now()).getTime())}

async function finalizeReport(status,extra={}){
  const report={
    generatedAt:new Date().toISOString(),
    operation:job.type,
    status,
    fromVersion:job.fromVersion,
    toVersion:job.toVersion,
    durationMs:durationMs(),
    snapshotId:job.snapshotId||null,
    restartStrategy:job.restart?.strategy||'none',
    preflight:job.preflight||null,
    dependenciesProcessed:(job.preflight?.dependencies?.areas||[]),
    migrationsPlanned:job.preflight?.migrations?.count||0,
    viteCacheCleared:Boolean(job.viteCacheCleared),
    applyOperations:Number(job.applyOperations||job.transaction?.operations||0),
    watchdog:job.watchdog||null,
    stageIntegrity:job.stageIntegrity||null,
    timeline:job.timeline||[],
    ...extra,
  }
  await updateJob({finalReport:report})
  return report
}
function preserved(rel){ rel=rel.replace(/\\/g,'/').replace(/^\.\//,''); return rel==='.update-meta.json' || rel==='al-update.json' || PRESERVE_PATHS.some(p=>rel===p||rel.startsWith(`${p}/`)) || rel==='.git' || rel.startsWith('.git/') || rel==='node_modules' || rel.includes('/node_modules/') }
function preserveAncestor(rel){ rel=rel.replace(/\\/g,'/').replace(/^\.\//,''); return PRESERVE_PATHS.some(p=>p.startsWith(`${rel}/`)) || '.git'.startsWith(`${rel}/`) }

async function copyTree(src,dst,{skipPreserved=false}={}){
  const walk=async (s,d,rel='')=>{ await fs.mkdir(d,{recursive:true}); for(const ent of await fs.readdir(s,{withFileTypes:true})){ const r=rel?`${rel}/${ent.name}`:ent.name; if(skipPreserved&&preserved(r)) continue; const a=path.join(s,ent.name),b=path.join(d,ent.name); if(ent.isDirectory()) await walk(a,b,r); else if(ent.isSymbolicLink()){ const link=await fs.readlink(a); await fs.rm(b,{force:true,recursive:true}).catch(()=>{}); await fs.symlink(link,b) } else await fs.copyFile(a,b) } }; await walk(src,dst)
}
async function snapshot(version){
  const id=`snapshot_${Date.now()}_${version}`
  const dir=path.join(SNAPSHOT_DIR,id,'files')
  await fs.mkdir(dir,{recursive:true})
  await copyTree(ROOT_DIR,dir,{skipPreserved:true})
  await initCrypto()
  // A instalação continua em execução enquanto o snapshot é criado. Comparar o
  // hash da árvore viva com o backup depois da cópia gera falso positivo se um
  // arquivo gerenciado mudar nesse intervalo. O próprio fs.copyFile já falha se
  // a cópia não puder ser concluída; aqui validamos a cópia fechada e registramos
  // seu digest para que rollback/recovery possam conferir exatamente esse estado.
  const snapshotManifest=await managedDigest(dir)
  const requiredSnapshotFiles=['backend/package.json','frontend/package.json']
  const missingRequired=[]
  for(const rel of requiredSnapshotFiles) if(!await exists(path.join(dir,rel))) missingRequired.push(rel)
  if(snapshotManifest.fileCount<2 || missingRequired.length){
    await fs.rm(path.join(SNAPSHOT_DIR,id),{recursive:true,force:true})
    throw new Error(`Falha ao verificar o snapshot: arquivos essenciais ausentes${missingRequired.length?` (${missingRequired.join(', ')})`:''}. A atualização foi cancelada antes de alterar arquivos.`)
  }
  // Só invalida snapshots anteriores depois que o novo backup foi copiado e verificado.
  for(const name of await fs.readdir(SNAPSHOT_DIR).catch(()=>[])){
    if(name===id)continue
    try{
      const mf=path.join(SNAPSHOT_DIR,name,'snapshot.json')
      const old=await readJson(mf)
      if(old.safe!==false){
        old.safe=false
        old.invalidatedReason='Somente o snapshot imediatamente anterior pode ter rollback manual garantido.'
        await writeJson(mf,old)
      }
    }catch{}
  }
  const meta={id,version,createdAt:new Date().toISOString(),safe:true,integrity:snapshotManifest}
  await writeJson(path.join(SNAPSHOT_DIR,id,'snapshot.json'),meta)
  return meta
}

async function managedFiles(base){
  const map=new Map(),dirs=[]
  async function walk(dir,rel=''){
    for(const ent of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
      const r=rel?`${rel}/${ent.name}`:ent.name
      if(preserved(r))continue
      const full=path.join(dir,ent.name)
      if(ent.isDirectory()){dirs.push(r);await walk(full,r)}
      else if(ent.isFile())map.set(r,full)
    }
  }
  await walk(base)
  return {map,dirs}
}
async function pathHash(file){
  const h=crypto.createHash('sha256')
  const fh=await fs.open(file,'r')
  try{
    const buf=Buffer.alloc(1024*1024)
    let pos=0
    while(true){
      const {bytesRead}=await fh.read(buf,0,buf.length,pos)
      if(!bytesRead)break
      h.update(buf.subarray(0,bytesRead));pos+=bytesRead
    }
  }finally{await fh.close()}
  return h.digest('hex')
}

async function managedDigest(base){
  const {map}=await managedFiles(base)
  const items=[]
  for(const [rel,full] of map){
    const st=await fs.stat(full)
    items.push({rel,size:st.size,hash:await pathHash(full)})
  }
  items.sort((a,b)=>a.rel.localeCompare(b.rel))
  const h=crypto.createHash('sha256')
  let bytes=0
  for(const item of items){h.update(item.rel).update('\0').update(item.hash).update('\0');bytes+=item.size}
  return {sha256:h.digest('hex'),fileCount:items.length,totalBytes:bytes}
}

async function fileEqual(a,b){
  try{
    const [sa,sb]=await Promise.all([fs.stat(a),fs.stat(b)])
    if(sa.size!==sb.size)return false
    const [ha,hb]=await Promise.all([pathHash(a),pathHash(b)])
    return ha===hb
  }catch{return false}
}
function cryptoHash(buf){return crypto.createHash('sha256').update(buf).digest('hex')}
async function initCrypto(){return true}

async function ensureDirectory(dir){
  if(path.resolve(dir)===path.resolve(ROOT_DIR))return
  try{
    const st=await fs.lstat(dir)
    if(st.isDirectory())return
    await fs.rm(dir,{recursive:true,force:true})
  }catch{}
  await ensureDirectory(path.dirname(dir))
  await fs.mkdir(dir,{recursive:true})
}
async function copyFileAtomic(src,dst){
  await ensureDirectory(path.dirname(dst))
  const tmp=path.join(path.dirname(dst),`.al-update-${job.id}-${Math.random().toString(16).slice(2)}.tmp`)
  await fs.copyFile(src,tmp)
  try{const st=await fs.stat(src);await fs.chmod(tmp,st.mode)}catch{}
  try{await fs.rename(tmp,dst)}
  catch{
    await fs.rm(dst,{recursive:true,force:true}).catch(()=>{})
    await fs.rename(tmp,dst)
  }
}
async function applyFiles(src,mode='apply',options={}){
  await initCrypto()
  await fs.mkdir(TRANSACTION_DIR,{recursive:true})
  const txFile=path.join(TRANSACTION_DIR,`${job.id}.json`)
  const source=await managedFiles(src)
  const current=await managedFiles(ROOT_DIR)
  const incremental=options.packageType==='incremental'
  const explicitRemoved=new Set((options.removedFiles||[]).map(r=>String(r).replace(/\\/g,'/').replace(/^\.\//,'')))
  const preRemoves=[],writes=[],removes=[]
  const sourceKeys=[...source.map.keys()]
  const sourceSet=new Set(sourceKeys)
  const hasSourceDescendant=rel=>sourceKeys.some(p=>p.startsWith(`${rel}/`))
  const hasSourceFileAncestor=rel=>{
    const parts=rel.split('/')
    for(let i=parts.length-1;i>0;i--)if(sourceSet.has(parts.slice(0,i).join('/')))return true
    return false
  }
  for(const [rel,to] of current.map){
    if(sourceSet.has(rel))continue
    if(hasSourceDescendant(rel))preRemoves.push({type:'remove',rel,to,reason:'file-to-directory'})
    else if(incremental){
      if(explicitRemoved.has(rel))removes.push({type:'remove',rel,to,reason:'incremental-manifest'})
    }else if(!hasSourceFileAncestor(rel))removes.push({type:'remove',rel,to})
  }
  if(incremental){
    for(const rel of explicitRemoved){
      if(current.map.has(rel))continue
      const to=path.join(ROOT_DIR,rel)
      if(await exists(to))removes.push({type:'remove',rel,to,reason:'incremental-manifest'})
    }
  }
  for(const [rel,from] of source.map){
    const to=path.join(ROOT_DIR,rel)
    if(!(await fileEqual(from,to)))writes.push({type:'write',rel,from,to})
  }
  const unique=new Map()
  for(const op of [...preRemoves,...writes,...removes]) unique.set(`${op.type}:${op.rel}`,op)
  const ops=[...unique.values()]
  const journal={jobId:job.id,mode,packageType:incremental?'incremental':'full',status:'running',startedAt:new Date().toISOString(),total:ops.length,done:0,lastOperation:null}
  await writeJson(txFile,journal)
  let done=0
  for(const op of ops){
    journal.lastOperation={type:op.type,path:op.rel,state:'started',at:new Date().toISOString()}
    await writeJson(txFile,{...journal,done})
    if(op.type==='write')await copyFileAtomic(op.from,op.to)
    else await fs.rm(op.to,{recursive:true,force:true})
    done++
    journal.lastOperation={type:op.type,path:op.rel,state:'done',at:new Date().toISOString()}
    await writeJson(txFile,{...journal,done})
  }
  for(const rel of current.dirs.sort((a,b)=>b.length-a.length)){
    if(preserveAncestor(rel))continue
    await fs.rmdir(path.join(ROOT_DIR,rel)).catch(()=>{})
  }
  await writeJson(txFile,{...journal,status:'completed',done,completedAt:new Date().toISOString()})
  await updateJob({transaction:{mode,packageType:incremental?'incremental':'full',status:'completed',operations:ops.length,done}})
  return {operations:ops.length,writes:writes.length,removes:removes.length,packageType:incremental?'incremental':'full'}
}

async function clearFrontendViteCache(){
  const nodeModules=path.join(ROOT_DIR,'frontend','node_modules')
  if(!(await exists(nodeModules))) return true
  for(const name of await fs.readdir(nodeModules).catch(()=>[])){
    if(name==='.vite' || name.startsWith('.vite-')) await fs.rm(path.join(nodeModules,name),{recursive:true,force:true}).catch(()=>{})
  }
  return true
}
async function run(cmd,args,cwd,options={}){
  const timeoutMs=Math.max(5000,Number(options.timeoutMs||10*60*1000))
  const slowAfterMs=Math.min(timeoutMs-1000,Math.max(30000,Number(options.slowAfterMs||120000)))
  await new Promise((resolve,reject)=>{
    let settled=false,timer=null,forceTimer=null,progressTimer=null,slowReported=false
    let stdoutTail='',stderrTail='',lastOutputAt=Date.now()
    const startedMs=Date.now()
    const child=spawn(cmd,args,{cwd,stdio:['ignore','pipe','pipe'],shell:false,env:{...process.env,CI:process.env.CI||'1',NO_COLOR:process.env.NO_COLOR||'1'}})
    const startedAt=new Date().toISOString()
    const command=`${cmd} ${args.join(' ')}`
    const pushTail=(current,chunk)=>`${current}${String(chunk||'')}`.slice(-12000)
    const onData=(kind,chunk)=>{
      lastOutputAt=Date.now()
      if(kind==='stdout')stdoutTail=pushTail(stdoutTail,chunk)
      else stderrTail=pushTail(stderrTail,chunk)
    }
    child.stdout?.on('data',chunk=>onData('stdout',chunk))
    child.stderr?.on('data',chunk=>onData('stderr',chunk))
    void updateJob({externalProcess:{pid:child.pid,cmd,args,command,cwd,startedAt,timeoutMs,elapsedMs:0,lastOutputAt:new Date(lastOutputAt).toISOString(),stdoutTail:'',stderrTail:''}})
    const clear=()=>{if(timer)clearTimeout(timer);if(forceTimer)clearTimeout(forceTimer);if(progressTimer)clearInterval(progressTimer)}
    const incident=async(message,extra={})=>{
      await gravarErroSistemaSpool({
        tipo:'update',mensagem:message,stack:null,rota:'/admin/atualizacoes',
        dados:{source:'update-worker',jobId:job.id,phase:job.phase,phaseLabel:job.phaseLabel,fromVersion:job.fromVersion,toVersion:job.toVersion,command,cwd,pid:child.pid,elapsedMs:Date.now()-startedMs,stdoutTail,stderrTail,...extra},
      }).catch(()=>{})
    }
    const finish=async err=>{
      if(settled)return;settled=true;clear()
      const elapsedMs=Date.now()-startedMs
      await updateJob({externalProcess:null,lastExternalProcess:{command,cwd,pid:child.pid,startedAt,finishedAt:new Date().toISOString(),elapsedMs,exitError:err?.message||null,stdoutTail,stderrTail}}).catch(()=>{})
      if(err)await incident(err.message,{terminal:true,exitError:err.message})
      err?reject(err):resolve()
    }
    progressTimer=setInterval(()=>{
      const elapsedMs=Date.now()-startedMs
      const silentMs=Date.now()-lastOutputAt
      void updateJob({externalProcess:{pid:child.pid,cmd,args,command,cwd,startedAt,timeoutMs,elapsedMs,silentMs,lastOutputAt:new Date(lastOutputAt).toISOString(),stdoutTail,stderrTail}}).catch(()=>{})
      if(!slowReported && elapsedMs>=slowAfterMs){
        slowReported=true
        void incident(`Processo do atualizador demorando em ${job.phaseLabel||job.phase||'etapa desconhecida'}: ${command}`,{slow:true,silentMs})
      }
    },2000)
    progressTimer.unref?.()
    timer=setTimeout(()=>{
      const err=new Error(`${command} excedeu o limite de ${Math.round(timeoutMs/1000)}s e foi interrompido.`)
      try{child.kill('SIGTERM')}catch{}
      forceTimer=setTimeout(()=>{try{child.kill('SIGKILL')}catch{}},5000)
      forceTimer.unref?.()
      child.once('exit',()=>void finish(err))
      setTimeout(()=>void finish(err),6500).unref?.()
    },timeoutMs)
    timer.unref?.()
    child.once('error',err=>void finish(err))
    child.once('exit',(code,signal)=>{
      if(settled)return
      if(code===0)return void finish()
      void finish(new Error(`${command} falhou (${code ?? signal ?? 'desconhecido'})`))
    })
  })
}
async function dependencies(meta){
  for(const area of ['backend','frontend']){
    const dep=meta.dependencies?.[area]
    if(!dep?.installRequired) continue
    const cwd=path.join(ROOT_DIR,area)
    const hasLock=await exists(path.join(cwd,'package-lock.json'))

    // Se o lock não mudou, mas a instalação está corrompida, removemos apenas
    // os pacotes afetados e pedimos ao npm para restaurá-los, priorizando cache.
    if(!dep.lockChanged && dep.repairPackages?.length){
      for(const name of dep.repairPackages){
        await fs.rm(path.join(cwd,'node_modules',name),{recursive:true,force:true})
      }
      await run('npm',['install','--prefer-offline','--omit=optional','--no-audit','--no-fund'],cwd,{timeoutMs:15*60*1000})
      continue
    }

    await run('npm',[hasLock?'ci':'install','--prefer-offline','--omit=optional','--no-audit','--no-fund'],cwd,{timeoutMs:15*60*1000})
  }
}
async function restoreDependencies(areas=[]){
  for(const area of [...new Set(areas)]){
    if(!['backend','frontend'].includes(area))continue
    const cwd=path.join(ROOT_DIR,area)
    if(!(await exists(path.join(cwd,'package.json'))))continue
    const hasLock=await exists(path.join(cwd,'package-lock.json'))
    await run('npm',[hasLock?'ci':'install','--prefer-offline','--omit=optional','--no-audit','--no-fund'],cwd,{timeoutMs:15*60*1000})
  }
}
async function migrate(){ if(await exists(path.join(ROOT_DIR,'backend/migrate-mongo-config.js'))||await exists(path.join(ROOT_DIR,'backend/migrate-mongo-config.cjs'))){ await run('npm',['run','migrate'],path.join(ROOT_DIR,'backend'),{timeoutMs:5*60*1000}) } }
async function migrateDown(count){ for(let i=0;i<count;i++) await run('npm',['run','migrate:down'],path.join(ROOT_DIR,'backend'),{timeoutMs:5*60*1000}) }
const IS_TERMUX_RUNTIME=Boolean(process.env.TERMUX_VERSION||String(process.env.PREFIX||'').includes('com.termux'))
async function buildFrontend(){
  const pkg=await readJson(path.join(ROOT_DIR,'frontend/package.json'))
  if(!pkg.scripts?.build) return {skipped:true,reason:'no-build-script'}
  if(process.env.AL_UPDATE_BUILD_FRONTEND==='false') return {skipped:true,reason:'disabled-by-env'}
  // No Termux o portal roda pelo servidor Vite de desenvolvimento; gerar dist durante
  // a atualização é apenas uma validação pesada e pode fazer o Android encerrar o app
  // por pressão de memória. O build continua disponível de forma explícita com
  // AL_UPDATE_BUILD_FRONTEND=true e permanece normal em CI/Vercel/servidores.
  if(IS_TERMUX_RUNTIME && process.env.AL_UPDATE_BUILD_FRONTEND!=='true'){
    await updateJob({frontendBuild:{skipped:true,reason:'termux-dev-runtime',at:new Date().toISOString()}})
    return {skipped:true,reason:'termux-dev-runtime'}
  }
  await run('npm',['run','build'],path.join(ROOT_DIR,'frontend'),{timeoutMs:8*60*1000})
  await updateJob({frontendBuild:{skipped:false,completedAt:new Date().toISOString()}})
  return {skipped:false}
}
async function restart(cfg){ if(cfg.strategy==='none') return false; if(cfg.strategy==='pm2') await run('pm2',['restart',cfg.pm2Name,'--update-env'],ROOT_DIR,{timeoutMs:90*1000}); else if(cfg.strategy==='systemd') await run('systemctl',['restart',cfg.systemdService],ROOT_DIR,{timeoutMs:90*1000}); else throw new Error(`Estratégia de reinício desconhecida: ${cfg.strategy}`); return true }
async function health(url,tries=12){ for(let i=0;i<tries;i++){ await sleep(2500); try{ const r=await fetch(url,{signal:AbortSignal.timeout(4000)}); if(r.ok) return true }catch{} } return false }
async function versionHealthy(url,expected,tries=16){
  for(let i=0;i<tries;i++){
    await sleep(1800)
    try{
      const r=await fetch(url,{signal:AbortSignal.timeout(2500)})
      const d=await r.json().catch(()=>({}))
      if(r.ok&&d.version===expected)return true
    }catch{}
  }
  return false
}
async function restoreSnapshot(meta){ await applyFiles(path.join(SNAPSHOT_DIR,meta.id,'files')); await clearFrontendViteCache() }

try{
  await fs.mkdir(STATE_DIR,{recursive:true})
  startHeartbeat()
  await startMonitor().catch(async e=>{ await updateJob({monitorError:e.message}).catch(()=>{}) })
  await updateJob({status:recoveryMode?'recovering':'running',workerPid:process.pid,startedAt:job.startedAt||new Date().toISOString(),progress:2,timeline:job.timeline||[]})
  if(recoveryMode){
    await phase('recovery','Recuperando atualização interrompida',8,{recovery:true})
    if(!job.snapshotId)throw new Error('Recuperação automática sem snapshot disponível; nenhuma restauração foi executada.')
    const snap=await readJson(path.join(SNAPSHOT_DIR,job.snapshotId,'snapshot.json'))
    await setMaintenance(true,{phase:'recovery'})
    await phase('recovery-files','Restaurando snapshot após interrupção',42)
    await applyFiles(path.join(SNAPSHOT_DIR,snap.id,'files'),'recovery')
    await clearFrontendViteCache()
    await phase('recovery-restart','Reiniciando após recuperação',74)
    const did=await restart(job.restart)
    await phase('recovery-health','Validando instalação restaurada',90)
    const healthy=did?await health(job.healthUrl):true
    await updateJob({status:'rolled-back',recovered:true,rollbackHealthy:healthy,completedAt:new Date().toISOString()})
    await finalizeReport('rolled-back',{recovered:true,healthCheck:healthy?'approved':'failed'})
    await setMaintenance(false)
    await history({id:job.id,type:'recovery',status:'rolled-back',fromVersion:job.toVersion,toVersion:snap.version,createdAt:new Date().toISOString(),snapshotId:snap.id,recovered:true})
    await phase('rolled-back',healthy?'Recuperação concluída':'Recuperação concluída com alerta',100,{recovered:true})
    await housekeeping()
    await finishWithMonitor(healthy?0:1)
  }
  await phase('starting','Iniciando operação',5)
  if(job.type==='rollback'){
    await phase('rollback-prepare','Preparando rollback',10)
    const snap=await readJson(path.join(SNAPSHOT_DIR,job.snapshotId,'snapshot.json')); if(snap.safe===false) throw new Error('Snapshot não é seguro para rollback manual.')
    if(snap.migrations?.length){ await phase('rollback-migrations','Revertendo migrações do banco',25); await migrateDown(snap.migrations.length) }
    await setMaintenance(true,{phase:'rollback'})
    await phase('rollback-files','Restaurando arquivos do snapshot',45); await restoreSnapshot(snap)
    if(snap.dependencyAreas?.length){await phase('rollback-dependencies','Restaurando dependências da versão anterior',60);await restoreDependencies(snap.dependencyAreas)}
    await phase('rollback-restart','Reiniciando o AL Sistemas',70); await restart(job.restart)
    await phase('rollback-health','Verificando funcionamento após rollback',88); const ok=job.restart.strategy==='none'?true:await health(job.healthUrl); if(!ok) throw new Error('Health check falhou após rollback.')
    await phase('completed','Rollback concluído',100); await updateJob({status:'completed',completedAt:new Date().toISOString()}); await finalizeReport('success',{healthCheck:'approved'}); await setMaintenance(false); await history({id:job.id,type:'rollback',status:'success',fromVersion:job.fromVersion,toVersion:snap.version,createdAt:new Date().toISOString(),snapshotId:snap.id,durationMs:durationMs()}); await housekeeping(); await finishWithMonitor(0)
  }
  const stage=path.join(STAGING_DIR,job.stageId), meta=await readJson(path.join(stage,'.update-meta.json'))
  await phase('integrity','Verificando integridade do staging',9)
  await verifyStageIntegrity(job.stageId)
  await phase('backup','Criando snapshot da versão atual',12)
  const snap=await snapshot(job.fromVersion); snap.safe=meta.migrationRollbackSafe!==false; snap.migrations=meta.migrations||[]; snap.dependencyAreas=['backend','frontend'].filter(a=>meta.dependencies?.[a]?.installRequired); await writeJson(path.join(SNAPSHOT_DIR,snap.id,'snapshot.json'),snap); await updateJob({snapshotId:snap.id,status:'backup-created'})
  await phase('backup-done','Backup concluído e verificado',22,{snapshotId:snap.id})
  await startWatchdog()
  const removedSnapshots=await pruneSnapshots(job.snapshotRetention||3)
  if(removedSnapshots.length) await phase('snapshot-cleanup',`Snapshots antigos removidos (${removedSnapshots.length})`,24,{removedSnapshots})
  let migrationsApplied=false
  let dependenciesTouched=false
  try{
    await setMaintenance(true,{phase:'files'})
    await phase('maintenance','Modo manutenção ativado',28)
    await phase('files','Aplicando arquivos da nova versão com transação',32); const applyResult=await applyFiles(stage,'update',{packageType:meta.packageType||'full',removedFiles:meta.removedFiles||[]})
    const versions=await readJson(path.join(ROOT_DIR,'backend/package.json'))
    if(versions.version!==job.toVersion)throw new Error(`Versão aplicada inconsistente: esperado ${job.toVersion}, encontrado ${versions.version}.`)
    await updateJob({applyOperations:applyResult.operations})
    if(meta.frontendCacheResetRequired){
      await phase('cache','Invalidando cache do frontend',42); await clearFrontendViteCache(); await updateJob({status:'cache-cleared',viteCacheCleared:true})
    } else {
      await phase('cache-kept','Cache do frontend preservado',42); await updateJob({viteCacheCleared:false})
    }
    const needsDeps=['backend','frontend'].some(a=>meta.dependencies?.[a]?.installRequired)
    if(needsDeps){ dependenciesTouched=true; await phase('dependencies','Verificando/reparando dependências',52); await dependencies(meta) }
    else await phase('dependencies-ok','Dependências já estão íntegras',56)
    await phase('build',IS_TERMUX_RUNTIME?'Atualizando interface local':'Preparando frontend',64)
    const frontendBuild=await buildFrontend()
    if(frontendBuild?.skipped){
      const label=frontendBuild.reason==='termux-dev-runtime'
        ? 'Arquivos atualizados — build não é necessário no Termux'
        : 'Build do frontend dispensado'
      await phase('build-skipped',label,68,{frontendBuild})
    }
    if(meta.migrations?.length){ await phase('migrations','Executando migrações do banco',72); await migrate(); migrationsApplied=true }
    else await phase('migrations-none','Nenhuma migração necessária',74)
    await updateJob({status:'files-applied'})
    await phase('restart','Reiniciando o AL Sistemas',82); const explicitlyRestarted=await restart(job.restart)
    await phase('health','Executando liveness e conferindo versão ativa',90)
    const live=await health(job.healthUrl,explicitlyRestarted?12:8)
    const correctVersion=live?await versionHealthy(job.versionUrl,job.toVersion,explicitlyRestarted?12:8):false
    if(explicitlyRestarted && (!live||!correctVersion)) throw new Error('Health check/versionamento falhou após a atualização.')
    const restarted=explicitlyRestarted||correctVersion
    await phase(restarted?'completed':'restart-required',restarted?'Atualização concluída e versão confirmada':'Arquivos aplicados — reinício manual necessário',100)
    await updateJob({status: restarted?'completed':'restart-required',completedAt:new Date().toISOString(),health:{live,correctVersion}}); await finalizeReport(restarted?'success':'restart-required',{healthCheck:restarted?'approved':'not-run',versionConfirmed:correctVersion,removedSnapshots}); await setMaintenance(false); await history({id:job.id,type:'update',status:restarted?'success':'restart-required',fromVersion:job.fromVersion,toVersion:job.toVersion,createdAt:new Date().toISOString(),snapshotId:snap.id,restartStrategy:job.restart.strategy,durationMs:durationMs()}); await fs.rm(stage,{recursive:true,force:true}).catch(()=>{}); await housekeeping(); await finishWithMonitor(0)
  }catch(err){
    await gravarErroSistemaSpool({
      tipo:'update', mensagem:err.message, stack:err.stack, rota:'/admin/atualizacoes',
      dados:{source:'update-worker',jobId:job.id,phase:job.phase,phaseLabel:job.phaseLabel,progress:job.progress,fromVersion:job.fromVersion,toVersion:job.toVersion,externalProcess:job.externalProcess||job.lastExternalProcess||null,snapshotId:job.snapshotId||null},
    }).catch(()=>{})
    let migrationRollbackError=null, dependencyRollbackError=null
    await phase('rollback-auto','Falha detectada — iniciando rollback automático',84,{failure:err.message})
    if(migrationsApplied && meta.migrations?.length && meta.migrationRollbackSafe!==false){ try{ await phase('rollback-auto-migrations','Revertendo migrações',86); await migrateDown(meta.migrations.length) }catch(e){ migrationRollbackError=e.message } }
    await phase('rollback-auto-files','Restaurando versão anterior',90); await restoreSnapshot(snap)
    if(dependenciesTouched&&snap.dependencyAreas?.length){try{await phase('rollback-auto-dependencies','Restaurando dependências anteriores',93);await restoreDependencies(snap.dependencyAreas)}catch(e){dependencyRollbackError=e.message}}
    let rollbackHealthy=true; try{ const did=await restart(job.restart); if(did){ await phase('rollback-auto-health','Verificando versão restaurada',96); rollbackHealthy=await health(job.healthUrl) } }catch{ rollbackHealthy=false }
    if(migrationRollbackError||dependencyRollbackError) rollbackHealthy=false; await phase('rolled-back',rollbackHealthy?'Rollback automático concluído':'Rollback concluído com alerta',100,{error:err.message}); await updateJob({status:'rolled-back',error:err.message,migrationRollbackError,dependencyRollbackError,rollbackHealthy,completedAt:new Date().toISOString()}); await finalizeReport('rolled-back',{error:err.message,migrationRollbackError,dependencyRollbackError,rollbackHealthy,healthCheck:rollbackHealthy?'approved':'failed',removedSnapshots}); await setMaintenance(false); await history({id:job.id,type:'update',status:'rolled-back',fromVersion:job.fromVersion,toVersion:job.toVersion,createdAt:new Date().toISOString(),snapshotId:snap.id,error:err.message,migrationRollbackError,dependencyRollbackError,rollbackHealthy,durationMs:durationMs()}); await finishWithMonitor(1)
  }
}catch(err){ await phase('failed','Atualização interrompida',100,{error:err.message}).catch(()=>{}); await updateJob({status:'failed',error:err.message,completedAt:new Date().toISOString()}).catch(()=>{}); await finalizeReport('failed',{error:err.message}).catch(()=>{}); await setMaintenance(false).catch(()=>{}); await finishWithMonitor(1) }
