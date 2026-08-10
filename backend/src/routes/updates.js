import { Router } from 'express'
import multer from 'multer'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { autenticar } from '../middleware/auth.js'
import crypto from 'node:crypto'
import { getCredential } from '../utils/credentialStore.js'
import { runGithubPublish } from '../update/githubPublishWorker.js'
import { runUpdateSelfTest } from '../update/updateSelfTest.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { installedVersion, validateAndStage, listStaged, readHistory, createJob, createRollbackJob, listSnapshots, getUpdatePreflight, getUpdaterDiagnostics, reserveUpdateLock, releaseUpdateLock, readUpdateLock, JOB_DIR, STATE_DIR, ROOT_DIR, IS_VERCEL } from '../services/systemUpdateService.js'

const router=Router(); router.use(autenticar); router.use(verificarPermissao('atualizacoes.gerenciar'))
const upload=multer({dest:path.join(os.tmpdir(),'alsistemas-uploads'),limits:{fileSize:250*1024*1024},fileFilter(_r,f,cb){cb(null,/\.zip$/i.test(f.originalname))}})
async function atomicWriteJson(file,value){
  await fs.mkdir(path.dirname(file),{recursive:true})
  const tmp=`${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
  await fs.writeFile(tmp,JSON.stringify(value,null,2))
  await fs.rename(tmp,file)
}
const worker=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../update/updateWorker.js')
const githubWorker=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../update/githubPublishWorker.js')

async function launch(job){
  const jobFile=path.join(JOB_DIR,`${job.id}.json`)
  const child=job.restart.strategy==='systemd'
    ? spawn('systemd-run',['--unit',`al-sistemas-update-${Date.now()}`,'--collect',process.execPath,worker,jobFile],{detached:true,stdio:'ignore'})
    : spawn(process.execPath,[worker,jobFile],{detached:true,stdio:'ignore'})
  await new Promise((resolve,reject)=>{
    child.once('spawn',resolve)
    child.once('error',reject)
  })
  child.unref()
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms))
function monitorUrl(job){
  if(process.env.AL_UPDATE_MONITOR_PUBLIC_URL){
    return `${process.env.AL_UPDATE_MONITOR_PUBLIC_URL.replace(/\/$/,'')}/?job=${encodeURIComponent(job.id)}`
  }
  return `http://127.0.0.1:${job.monitorPort}/?job=${encodeURIComponent(job.id)}`
}
async function waitForMonitor(job){
  const base=`http://127.0.0.1:${job.monitorPort}/health?job=${encodeURIComponent(job.id)}`
  for(let i=0;i<25;i++){
    try{
      const r=await fetch(base,{signal:AbortSignal.timeout(350)})
      const d=await r.json().catch(()=>({}))
      if(r.ok && d.jobId===job.id) return true
    }catch{}
    await sleep(80)
  }
  return false
}

async function githubToken(){
  const c=await getCredential('github','GITHUB_TOKEN')
  return c.value||''
}
async function launchGithubPublish(job,token){
  const jobFile=path.join(JOB_DIR,`${job.id}.json`)
  await atomicWriteJson(jobFile,job)
  const child=spawn(process.execPath,[githubWorker,jobFile],{
    detached:true,stdio:'ignore',
    env:{...process.env,AL_GITHUB_PUBLISH_TOKEN:token},
  })
  await new Promise((resolve,reject)=>{
    child.once('spawn',resolve)
    child.once('error',reject)
  })
  child.unref()
}

async function runGithubPublishInline(job,token){
  // Vercel: executa no mesmo processo/requisição. Não depende de processo
  // destacado nem de arquivos persistentes entre invocações.
  return runGithubPublish(job,token,{jobFile:null,persistHistory:false})
}
router.get('/',async(_req,res,next)=>{try{
  const isTermux=Boolean(process.env.TERMUX_VERSION||String(process.env.PREFIX||'').includes('com.termux'))
  const processManager=IS_VERCEL?'Vercel Functions':process.env.pm_id!==undefined?'PM2':process.env.INVOCATION_ID?'systemd':isTermux?'Termux/manual':'manual'
  const activeOperation=IS_VERCEL?null:await readUpdateLock()
  res.json({
    installed:await installedVersion(),staged:IS_VERCEL?[]:await listStaged(),history:IS_VERCEL?[]:await readHistory(),snapshots:IS_VERCEL?[]:await listSnapshots(),activeOperation,
    runtime:{environment:IS_VERCEL?'Vercel':isTermux?'Termux':process.platform==='linux'?'Linux/VPS':process.platform,node:process.version,arch:process.arch,processManager},
    restart:{strategy:process.env.AL_UPDATE_RESTART_STRATEGY||'none',pm2Name:process.env.AL_UPDATE_PM2_NAME||'al-sistemas',systemdService:process.env.AL_UPDATE_SYSTEMD_SERVICE||'al-sistemas.service'},
    updateCapabilities:{
      environment:IS_VERCEL?'vercel':'persistent-server',
      persistentStaging:!IS_VERCEL,
      localInstall:!IS_VERCEL,
      githubPublish:true,
      incrementalPackages:true,
      fullPackages:true,
      packageStorage:IS_VERCEL?'request-tmp':'external-staging',
      detachedMonitor:!IS_VERCEL,
      stateStorage:IS_VERCEL?'temporary':'outside-project',
      preflight:!IS_VERCEL,
      maintenanceMode:!IS_VERCEL,
      snapshotRetention:Number(process.env.AL_UPDATE_SNAPSHOT_KEEP||3),
      finalReport:true,
      stageIntegrity:true,
      exclusiveLock:true,
      transactionalApply:true,
      automaticRecovery:true,
      externalWatchdog:!IS_VERCEL,
      zipHardening:true,
      engineSelfTest:!IS_VERCEL,
      stageRetention:Number(process.env.AL_UPDATE_STAGE_KEEP||5),
      emergencyRecoveryCommand:IS_VERCEL?null:`node "${path.join(STATE_DIR,'runtime','recoverPending.cjs')}" "${STATE_DIR}"`,
    }
  })
}catch(e){next(e)}})

async function githubApi(token,pathName){
  const r=await fetch(`https://api.github.com${pathName}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'AL-Sistemas','X-GitHub-Api-Version':'2022-11-28'}})
  const data=await r.json().catch(()=>({}))
  if(!r.ok){const e=new Error(data.message||`GitHub respondeu ${r.status}`);e.status=r.status;throw e}
  return data
}
function vercelApiUrl(pathName,teamId=''){
  const u=new URL(`https://api.vercel.com${pathName}`)
  if(teamId)u.searchParams.set('teamId',teamId)
  return u.toString()
}
router.get('/deployment-check',async(req,res,next)=>{try{
  const repository=String(req.query.repository||'').trim()
  const branch=String(req.query.branch||'main').trim()||'main'
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))return res.status(400).json({erro:'Repositório inválido.'})
  const gh=await getCredential('github','GITHUB_TOKEN')
  if(!gh.value)return res.status(400).json({erro:'GitHub não conectado.'})
  const [owner,repo]=repository.split('/')
  const repoData=await githubApi(gh.value,`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)
  let branchExists=true
  try{await githubApi(gh.value,`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`)}catch(e){if(e.status===404)branchExists=false;else throw e}
  const writable=Boolean(repoData.permissions?.push||repoData.permissions?.maintain||repoData.permissions?.admin)
  const emptyRepository=Number(repoData.size||0)===0
  const github={
    ok:writable,
    repository:repoData.full_name,
    writable,
    branch,branchExists,branchWillBeCreated:!branchExists&&writable,canCreateBranch:!branchExists&&writable,emptyRepository,
    defaultBranch:repoData.default_branch||'main',private:Boolean(repoData.private),
  }
  const vc=await getCredential('vercel','VERCEL_TOKEN')
  let vercel={configured:Boolean(vc.value),ok:null,projects:[],message:vc.value?'Verificando projetos vinculados…':'Token da Vercel não configurado; o push continuará funcionando apenas pelo GitHub.'}
  if(vc.value){
    try{
      const teamId=vc.metadata?.teamId||process.env.VERCEL_TEAM_ID||''
      const r=await fetch(vercelApiUrl('/v9/projects?limit=100',teamId),{headers:{Authorization:`Bearer ${vc.value}`,Accept:'application/json'}})
      const body=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(body.error?.message||`Vercel respondeu ${r.status}`)
      const repoLower=repository.toLowerCase()
      const matches=(body.projects||[]).filter(p=>{
        const linked=String(p.link?.repo||'').toLowerCase()
        const org=String(p.link?.org||p.link?.repoOwnerId||'').toLowerCase()
        return linked===repoLower || linked===repo.toLowerCase() || `${org}/${linked}`===repoLower
      }).map(p=>({id:p.id,name:p.name,framework:p.framework||null,rootDirectory:p.rootDirectory||null,productionBranch:p.link?.productionBranch||null,repo:p.link?.repo||null,type:p.link?.type||null}))
      vercel={configured:true,ok:true,projects:matches,message:matches.length?`${matches.length} projeto(s) Vercel vinculado(s) encontrado(s).`:'Vercel conectada, mas nenhum projeto vinculado a este repositório foi identificado.'}
    }catch(e){vercel={configured:true,ok:false,projects:[],message:e.message}}
  }
  res.json({ok:github.writable,github,vercel})
}catch(e){next(e)}})

router.post('/self-test',async(_req,res,next)=>{try{
  const result=await runUpdateSelfTest()
  res.status(result.ok?200:500).json({selfTest:result})
}catch(e){next(e)}})

router.get('/diagnostics',async(_req,res,next)=>{try{
  const diagnostics=await getUpdaterDiagnostics()
  res.json({diagnostics})
}catch(e){next(e)}})

router.post('/prepare',upload.single('package'),async(req,res,next)=>{try{
  if(!req.file)return res.status(400).json({erro:'Envie o pacote no campo package.'})
  const meta=await validateAndStage(req.file.path,req.file.originalname,{persist:!IS_VERCEL})
  if(meta._packageRoot) await fs.rm(meta._packageRoot,{recursive:true,force:true}).catch(()=>{})
  const clean={...meta}; delete clean._packageRoot
  res.status(201).json({
    message:IS_VERCEL?'Pacote validado. Na Vercel ele não foi armazenado; o navegador manterá o arquivo até a publicação.':'Pacote validado e preparado.',
    update:clean,
    ephemeral:IS_VERCEL,
  })
}catch(e){next(e)}finally{if(req.file)await fs.rm(req.file.path,{force:true}).catch(()=>{})}})
router.get('/:stageId/preflight',async(req,res,next)=>{try{
  if(IS_VERCEL)return res.status(409).json({erro:'Pré-check de instalação local não se aplica à Vercel. Use GitHub/Vercel.'})
  const report=await getUpdatePreflight(req.params.stageId)
  res.json({preflight:report})
}catch(e){next(e)}})

router.post('/:stageId/install',async(req,res,next)=>{try{
  if(IS_VERCEL)return res.status(409).json({erro:'Instalação local desativada na Vercel. Publique esta versão pelo GitHub/Vercel.'})
  const alreadyActive=await readUpdateLock()
  if(alreadyActive)return res.status(409).json({erro:`Já existe uma operação de atualização em andamento (${alreadyActive.jobId}).`,codigo:'UPDATE_BUSY',active:alreadyActive})
  const preflight=await getUpdatePreflight(req.params.stageId)
  if(!preflight.ok)return res.status(409).json({erro:'O pré-check bloqueou a instalação. Revise espaço em disco/migrações antes de continuar.',preflight})
  const job=await createJob(req.params.stageId,{...(req.body||{}),preflight})
  await reserveUpdateLock(job)
  try{ await launch(job) }catch(e){ await releaseUpdateLock(job.id); throw e }
  const monitorReady=await waitForMonitor(job)
  res.status(202).json({message:'Atualização iniciada.',job,monitorUrl:monitorUrl(job),monitorReady})
}catch(e){
  if(e.code==='UPDATE_BUSY')return res.status(409).json({erro:e.message,codigo:e.code,active:e.active})
  next(e)
}})

async function processChildren(pid){
  try{
    const text=await fs.readFile(`/proc/${pid}/task/${pid}/children`,'utf8')
    return text.trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite)
  }catch{return []}
}
async function terminateTree(pid,signal='SIGTERM'){
  if(!Number.isFinite(Number(pid))||Number(pid)<=1)return
  for(const child of await processChildren(Number(pid)))await terminateTree(child,signal)
  try{process.kill(Number(pid),signal)}catch{}
}
router.post('/recover-active',async(_req,res,next)=>{try{
  if(IS_VERCEL)return res.status(409).json({erro:'Recuperação de processo local não se aplica à Vercel.'})
  const active=await readUpdateLock()
  if(!active?.jobId)return res.status(404).json({erro:'Nenhuma operação ativa encontrada.'})
  const jobFile=path.join(JOB_DIR,`${active.jobId}.json`)
  const job=JSON.parse(await fs.readFile(jobFile,'utf8'))
  if(['completed','restart-required','rolled-back','failed','recovered'].includes(job.status)){
    await releaseUpdateLock(job.id)
    return res.json({message:'A operação já havia terminado; o lock residual foi liberado.',jobId:job.id})
  }
  const externalPid=Number(job.externalProcess?.pid||0)
  const workerPid=Number(job.workerPid||0)
  if(externalPid){
    await terminateTree(externalPid,'SIGTERM')
    setTimeout(()=>void terminateTree(externalPid,'SIGKILL'),5000).unref?.()
    return res.status(202).json({message:'Interrupção solicitada. O worker detectará a falha e executará o rollback automático usando o snapshot.',jobId:job.id,phase:job.phaseLabel||job.phase})
  }
  if(workerPid){
    try{process.kill(workerPid,'SIGTERM')}catch{}
    return res.status(202).json({message:'Worker interrompido. O watchdog externo assumirá a recuperação automática do snapshot.',jobId:job.id,phase:job.phaseLabel||job.phase})
  }
  return res.status(409).json({erro:'A operação está ativa, mas não há PID seguro registrado para interrupção. Use a recuperação de emergência exibida no painel.',jobId:job.id})
}catch(e){next(e)}})

router.post('/rollback/:snapshotId',async(req,res,next)=>{try{
  const alreadyActive=await readUpdateLock()
  if(alreadyActive)return res.status(409).json({erro:`Já existe uma operação de atualização em andamento (${alreadyActive.jobId}).`,codigo:'UPDATE_BUSY',active:alreadyActive})
  const job=await createRollbackJob(req.params.snapshotId,req.body||{})
  await reserveUpdateLock(job)
  try{await launch(job)}catch(e){await releaseUpdateLock(job.id);throw e}
  const monitorReady=await waitForMonitor(job)
  res.status(202).json({message:'Rollback iniciado.',job,monitorUrl:monitorUrl(job),monitorReady})
}catch(e){
  if(e.code==='UPDATE_BUSY')return res.status(409).json({erro:e.message,codigo:e.code,active:e.active})
  next(e)
}})

router.post('/publish-github-direct',upload.single('package'),async(req,res,next)=>{let packageRoot=null;try{
  if(!IS_VERCEL)return res.status(409).json({erro:'Esta rota direta é exclusiva do ambiente Vercel.'})
  if(!req.file)return res.status(400).json({erro:'Envie o pacote no campo package.'})
  const meta=await validateAndStage(req.file.path,req.file.originalname,{persist:false})
  packageRoot=meta._packageRoot
  if(meta.packageType==='incremental')return res.status(409).json({erro:'Pacotes incrementais são destinados à instalação local. Para GitHub/Vercel, use o pacote completo da versão.'})
  const repository=String(req.body?.repository||'').trim()
  const branch=String(req.body?.branch||'main').trim()||'main'
  const publishMode=String(req.body?.publishMode||'project')
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))return res.status(400).json({erro:'Selecione um repositório GitHub válido.'})
  if(!['project','frontend-folder','frontend-root','backend-folder'].includes(publishMode))return res.status(400).json({erro:'Destino de publicação inválido.'})
  const token=await githubToken()
  if(!token)return res.status(400).json({erro:'GitHub não conectado. Configure-o em Integrações e APIs.'})
  const id=`job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  const job={
    id,type:'github-publish',stageId:meta.id,stagePath:packageRoot,
    fromVersion:(await installedVersion()).version,toVersion:meta.version,
    repository,branch,publishMode,
    commitMessage:String(req.body?.commitMessage||`Atualiza AL Sistemas para ${meta.version}`).slice(0,200),
    status:'queued',progress:0,createdAt:new Date().toISOString(),
  }
  const finalJob=await runGithubPublishInline(job,token)
  res.status(200).json({message:'Publicação no GitHub concluída.',job:finalJob})
}catch(e){next(e)}finally{
  if(req.file)await fs.rm(req.file.path,{force:true}).catch(()=>{})
  if(packageRoot)await fs.rm(packageRoot,{recursive:true,force:true}).catch(()=>{})
}})


router.post('/publish-current-github',async(req,res,next)=>{try{
  if(IS_VERCEL)return res.status(409).json({erro:'Na Vercel não existe uma instalação local persistente para publicar. Use o repositório GitHub como origem do deployment.'})
  const alreadyActive=await readUpdateLock()
  if(alreadyActive)return res.status(409).json({erro:`Já existe uma operação protegida em andamento (${alreadyActive.jobId}).`,codigo:'UPDATE_BUSY',active:alreadyActive})
  const repository=String(req.body?.repository||'').trim()
  const branch=String(req.body?.branch||'main').trim()||'main'
  const publishMode=String(req.body?.publishMode||'project')
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))return res.status(400).json({erro:'Selecione um repositório GitHub válido.'})
  if(!['project','frontend-folder','frontend-root','backend-folder'].includes(publishMode))return res.status(400).json({erro:'Destino de publicação inválido.'})
  const token=await githubToken()
  if(!token)return res.status(400).json({erro:'GitHub não conectado. Configure-o em Integrações e APIs.'})
  const current=await installedVersion()
  const id=`job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  const job={
    id,type:'github-publish',sourceType:'installed',stageId:null,stagePath:ROOT_DIR,
    fromVersion:current.version,toVersion:current.version,
    repository,branch,publishMode,
    commitMessage:String(req.body?.commitMessage||`Publica AL Sistemas ${current.version} instalado`).slice(0,200),
    status:'queued',progress:0,createdAt:new Date().toISOString(),
  }
  await reserveUpdateLock(job)
  try{await launchGithubPublish(job,token)}catch(e){await releaseUpdateLock(job.id);throw e}
  res.status(202).json({message:`Publicação da versão instalada ${current.version} iniciada.`,job})
}catch(e){
  if(e.code==='UPDATE_BUSY')return res.status(409).json({erro:e.message,codigo:e.code,active:e.active})
  next(e)
}})

router.post('/:stageId/publish-github',async(req,res,next)=>{try{
  const stageId=req.params.stageId
  const staged=await listStaged()
  const stage=staged.find(s=>s.id===stageId)
  if(!stage)return res.status(404).json({erro:'Pacote preparado não encontrado.'})
  if(stage.packageType==='incremental')return res.status(409).json({erro:'Pacotes incrementais são destinados à instalação local. Para GitHub/Vercel, use o pacote completo da versão.'})
  const repository=String(req.body?.repository||'').trim()
  const branch=String(req.body?.branch||'main').trim()||'main'
  const publishMode=String(req.body?.publishMode||'project')
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))return res.status(400).json({erro:'Selecione um repositório GitHub válido.'})
  if(!['project','frontend-folder','frontend-root','backend-folder'].includes(publishMode))return res.status(400).json({erro:'Destino de publicação inválido.'})
  const token=await githubToken()
  if(!token)return res.status(400).json({erro:'GitHub não conectado. Configure-o em Integrações e APIs.'})
  const id=`job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  const job={
    id,type:'github-publish',stageId,fromVersion:(await installedVersion()).version,toVersion:stage.version,
    repository,branch,publishMode,
    commitMessage:String(req.body?.commitMessage||`Atualiza AL Sistemas para ${stage.version}`).slice(0,200),
    status:'queued',progress:0,createdAt:new Date().toISOString(),
  }
  await reserveUpdateLock(job)
  try{await launchGithubPublish(job,token)}catch(e){await releaseUpdateLock(job.id);throw e}
  res.status(202).json({message:'Publicação no GitHub iniciada.',job})
}catch(e){
  if(e.code==='UPDATE_BUSY')return res.status(409).json({erro:e.message,codigo:e.code,active:e.active})
  next(e)
}})

router.get('/jobs/:jobId',async(req,res,next)=>{try{if(!/^job_[0-9]+_[a-f0-9]+$/.test(req.params.jobId))return res.status(400).json({erro:'Job inválido.'}); res.json({job:JSON.parse(await fs.readFile(path.join(JOB_DIR,`${req.params.jobId}.json`),'utf8'))})}catch(e){next(e)}})
export default router
