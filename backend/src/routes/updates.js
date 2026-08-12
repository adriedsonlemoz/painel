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
import mongoose from 'mongoose'
import { statusRssJob } from '../jobs/rssJob.js'
import { runGithubPublish } from '../update/githubPublishWorker.js'
import UpdateRelease from '../models/UpdateRelease.js'
import { storeUpdatePackage, downloadUpdatePackage, deleteUpdatePackage, testR2UpdateStorage } from '../services/cloudUpdateStorage.js'
import { runUpdateSelfTest } from '../update/updateSelfTest.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { installedVersion, validateAndStage, listStaged, readHistory, createJob, createRollbackJob, listSnapshots, deleteStaged, deleteSnapshot, getUpdatePreflight, getUpdaterDiagnostics, reserveUpdateLock, releaseUpdateLock, readUpdateLock, JOB_DIR, STATE_DIR, ROOT_DIR, IS_VERCEL, IS_RENDER, IS_MANAGED_PLATFORM, IS_TERMUX } from '../services/systemUpdateService.js'

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

async function readModuleVersion(area,name){
  const modulePkg=path.join(ROOT_DIR,area,'node_modules',...name.split('/'),'package.json')
  try{
    const data=JSON.parse(await fs.readFile(modulePkg,'utf8'))
    if(data?.version)return {version:data.version,source:'installed'}
  }catch{}
  try{
    const pkg=JSON.parse(await fs.readFile(path.join(ROOT_DIR,area,'package.json'),'utf8'))
    const spec=pkg.dependencies?.[name]||pkg.devDependencies?.[name]||pkg.optionalDependencies?.[name]||null
    if(spec)return {version:String(spec),source:'declared'}
  }catch{}
  return {version:null,source:'unknown'}
}

function npmRuntimeVersion(){
  const ua=String(process.env.npm_config_user_agent||'')
  return ua.match(/(?:^|\s)npm\/([^\s]+)/)?.[1]||null
}

async function runtimeStack(){
  const [react,reactRouter,vite,express]=await Promise.all([
    readModuleVersion('frontend','react'),
    readModuleVersion('frontend','react-router-dom'),
    readModuleVersion('frontend','vite'),
    readModuleVersion('backend','express'),
  ])
  const mongoStates=['desconectado','conectado','conectando','desconectando']
  return {
    react,reactRouter,vite,express,
    mongoose:{version:mongoose.version||null,source:'installed'},
    mongodb:{state:mongoose.connection.readyState,stateLabel:mongoStates[mongoose.connection.readyState]||'desconhecido',database:mongoose.connection.name||null},
  }
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

function cloudReleaseView(doc){
  const d=doc?.toObject?doc.toObject():doc
  if(!d)return null
  return {
    id:d.releaseId,releaseId:d.releaseId,type:'cloud-release',version:d.version,fromVersion:d.fromVersion||'',toVersion:d.version,filename:d.filename,
    packageType:d.packageType||'full',createdAt:d.createdAt,changelog:d.changelog||'',
    sha256:d.packageSha256,integrity:d.integrity||{},status:d.status||'ready',
    cloudStored:true,storage:d.storage||'r2',bucket:d.bucket,objectKey:d.objectKey,
    packageBytes:d.packageBytes||0,repository:d.repository||'',branch:d.branch||'main',
    publishMode:d.publishMode||'project',commitSha:d.commitSha||'',commitUrl:d.commitUrl||'',
    githubStatus:d.githubStatus||'pending',githubVerified:Boolean(d.githubVerified),githubVerifiedAt:d.githubVerifiedAt||null,githubVerification:d.githubVerification||{},
    productionTarget:d.productionTarget||{},targetLockedAt:d.targetLockedAt||null,
    publishJob:{id:d.publishJobId||'',status:d.publishStatus||'',phase:d.publishPhase||'',phaseLabel:d.publishPhaseLabel||'',progress:Number(d.publishProgress||0),heartbeatAt:d.publishHeartbeatAt||null,startedAt:d.publishStartedAt||null,completedAt:d.publishCompletedAt||null,attempts:Number(d.publishAttempts||0),error:d.publishError||'',commitMessage:d.publishCommitMessage||'',candidateSha:d.publishCandidateSha||'',candidateUrl:d.publishCandidateUrl||'',timeline:Array.isArray(d.publishTimeline)?d.publishTimeline:[],fileLog:Array.isArray(d.publishFileLog)?d.publishFileLog:[],currentFile:d.publishCurrentFile||null,filesDone:Number(d.publishFilesDone||0),filesTotal:Number(d.publishFilesTotal||0)},
    trackingStartedAt:d.trackingStartedAt||null,lastCheckedAt:d.lastCheckedAt||null,trackingAttempts:Number(d.trackingAttempts||0),
    stalledAt:d.stalledAt||null,interruptedAt:d.interruptedAt||null,recovery:d.recovery||{},vercel:d.vercel||{},render:d.render||{},
    productionReady:Boolean(d.productionReady),error:d.error||'',publishedAt:d.publishedAt||null,
    completedAt:d.completedAt||null,
  }
}
async function listCloudReleases(limit=20){
  if(mongoose.connection.readyState!==1)return []
  const docs=await UpdateRelease.find({}).sort({createdAt:-1}).limit(limit)
  for(const doc of docs){
    if(doc.status==='publishing'&&!doc.commitSha) await ensureManagedPublishContinuity(doc)
  }
  const fresh=await UpdateRelease.find({_id:{$in:docs.map(d=>d._id)}}).sort({createdAt:-1}).lean()
  return fresh.map(cloudReleaseView)
}
async function cloudStorageStatus(){
  try{return await testR2UpdateStorage()}
  catch(e){return {ok:false,error:e.message,code:e.code||null}}
}

function normalizeGithubRepository(value=''){
  let raw=String(value||'').trim()
  if(!raw)return ''
  raw=raw.replace(/^https?:\/\/(?:www\.)?github\.com\//i,'').replace(/^git@github\.com:/i,'').replace(/\.git$/i,'').replace(/^\/+|\/+$/g,'')
  const m=raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  return m?`${m[1]}/${m[2]}`:''
}

async function resolveProductionGitTarget(){
  const [vercelCred,renderCred]=await Promise.all([
    getCredential('vercel','VERCEL_TOKEN'),
    getCredential('render','RENDER_API_KEY'),
  ])
  const result={ok:false,repository:'',branch:'',sources:{vercel:null,render:null},message:'',conflict:false}
  if(vercelCred.value&&vercelCred.metadata?.primaryProjectId){
    try{
      const teamId=vercelCred.metadata?.teamId||process.env.VERCEL_TEAM_ID||''
      const r=await fetch(vercelApiUrl(`/v9/projects/${encodeURIComponent(vercelCred.metadata.primaryProjectId)}`,teamId),{headers:{Authorization:`Bearer ${vercelCred.value}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
      const body=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(body.error?.message||`Vercel respondeu ${r.status}`)
      const project=body.project||body||{}
      const link=project.link||{}
      const repoRaw=String(link.repo||'')
      const repo=normalizeGithubRepository(repoRaw)||(repoRaw&&link.org?normalizeGithubRepository(`${link.org}/${repoRaw}`):'')
      result.sources.vercel={configured:true,projectId:project.id||vercelCred.metadata.primaryProjectId,name:project.name||'',repository:repo,branch:String(link.productionBranch||'').trim()||''}
    }catch(e){result.sources.vercel={configured:true,error:e.message,repository:'',branch:''}}
  }else result.sources.vercel={configured:Boolean(vercelCred.value),repository:'',branch:'',message:vercelCred.value?'Projeto principal não selecionado.':'Vercel não configurada.'}

  if(renderCred.value&&renderCred.metadata?.primaryServiceId){
    try{
      const r=await fetch(`https://api.render.com/v1/services/${encodeURIComponent(renderCred.metadata.primaryServiceId)}`,{headers:{Authorization:`Bearer ${renderCred.value}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
      const body=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(body?.message||body?.error||`Render respondeu ${r.status}`)
      const service=body.service||body||{}
      result.sources.render={configured:true,serviceId:service.id||renderCred.metadata.primaryServiceId,name:service.name||'',repository:normalizeGithubRepository(service.repo||''),branch:String(service.branch||'').trim()||''}
    }catch(e){result.sources.render={configured:true,error:e.message,repository:'',branch:''}}
  }else result.sources.render={configured:Boolean(renderCred.value),repository:'',branch:'',message:renderCred.value?'Serviço principal não selecionado.':'Render não configurada.'}

  const repos=[result.sources.vercel?.repository,result.sources.render?.repository].filter(Boolean)
  const uniqueRepos=[...new Set(repos.map(x=>x.toLowerCase()))]
  if(uniqueRepos.length>1){
    result.conflict=true
    result.message=`Vercel e Render estão ligados a repositórios diferentes (${repos.join(' / ')}). Corrija os vínculos na Central de Plataformas antes de atualizar.`
    return result
  }
  const branches=[result.sources.vercel?.branch,result.sources.render?.branch].filter(Boolean)
  const uniqueBranches=[...new Set(branches.map(x=>x.toLowerCase()))]
  if(uniqueBranches.length>1){
    result.conflict=true
    result.repository=repos[0]||''
    result.message=`Vercel e Render usam branches diferentes (${branches.join(' / ')}). Alinhe a branch de produção antes de atualizar.`
    return result
  }
  result.repository=repos[0]||''
  result.branch=branches[0]||'main'
  result.ok=Boolean(result.repository)
  result.message=result.ok?`Produção vinculada a ${result.repository} @ ${result.branch}.`:'Não foi possível determinar automaticamente o repositório de produção. Vincule Vercel ou Render na Central de Plataformas.'
  return result
}

async function verifyGithubReleaseCommit({token,repository,branch,commitSha,version}){
  const normalized=normalizeGithubRepository(repository)
  if(!normalized||!commitSha)throw new Error('Não foi possível verificar o commit: destino GitHub ou SHA ausente.')
  const [owner,repo]=normalized.split('/')
  const commit=await githubApi(token,`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(commitSha)}`)
  if(String(commit.sha||'').toLowerCase()!==String(commitSha).toLowerCase())throw new Error('O GitHub retornou um commit diferente do SHA publicado.')
  const file=await githubApi(token,`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/al-sistemas.json?ref=${encodeURIComponent(commitSha)}`)
  if(!file?.content)throw new Error('O commit foi criado, mas al-sistemas.json não foi encontrado na raiz do repositório.')
  let manifest
  try{manifest=JSON.parse(Buffer.from(String(file.content).replace(/\n/g,''),'base64').toString('utf8'))}catch{throw new Error('O commit foi criado, mas al-sistemas.json não pôde ser validado.') }
  if(String(manifest.version||'')!==String(version||''))throw new Error(`O commit publicado contém AL Sistemas ${manifest.version||'sem versão'}, mas a release preparada é ${version}.`)
  let headSha=''
  let branchContainsCommit=false
  let branchRelation='unknown'
  try{
    const branchData=await githubApi(token,`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch||'main')}`)
    headSha=branchData?.commit?.sha||''
    if(headSha&&headSha.toLowerCase()===String(commitSha).toLowerCase()){
      branchContainsCommit=true
      branchRelation='head'
    }else if(headSha){
      const compare=await githubApi(token,`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(commitSha)}...${encodeURIComponent(branch||'main')}`)
      branchRelation=String(compare?.status||'unknown')
      branchContainsCommit=['ahead','identical'].includes(branchRelation)
    }
  }catch(e){
    throw new Error(`O commit existe, mas não foi possível confirmar a branch ${branch||'main'}: ${e.message}`)
  }
  if(!branchContainsCommit)throw new Error(`O commit ${String(commitSha).slice(0,12)} existe no GitHub, porém a branch ${branch||'main'} não aponta para ele nem o contém em sua história (estado: ${branchRelation}).`)
  return {ok:true,repository:normalized,branch:branch||'main',commitSha:commit.sha,branchHeadSha:headSha,branchContainsCommit,branchRelation,version:String(manifest.version||''),verifiedAt:new Date()}
}
async function platformDeployState(release){
  const [vercelCred,renderCred]=await Promise.all([
    getCredential('vercel','VERCEL_TOKEN'),
    getCredential('render','RENDER_API_KEY'),
  ])
  const commitSha=String(release.commitSha||'')
  const out={
    vercel:{id:'',status:vercelCred.value?'waiting':'not-configured',url:vercelCred.metadata?.productionOrigin||'',message:'',checkedAt:new Date()},
    render:{id:'',status:renderCred.value?'waiting':'not-configured',url:renderCred.metadata?.backendUrl||'',message:'',checkedAt:new Date()},
  }
  if(vercelCred.value&&vercelCred.metadata?.primaryProjectId&&commitSha){
    try{
      const teamId=vercelCred.metadata?.teamId||process.env.VERCEL_TEAM_ID||''
      const r=await fetch(vercelApiUrl(`/v6/deployments?projectId=${encodeURIComponent(vercelCred.metadata.primaryProjectId)}&limit=20`,teamId),{headers:{Authorization:`Bearer ${vercelCred.value}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
      const body=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(body.error?.message||`Vercel respondeu ${r.status}`)
      const found=(body.deployments||[]).find(d=>String(d.meta?.githubCommitSha||'').toLowerCase()===commitSha.toLowerCase() && String(d.target||'').toLowerCase()==='production')
        ||(body.deployments||[]).find(d=>String(d.meta?.githubCommitSha||'').toLowerCase()===commitSha.toLowerCase())
      if(found){
        out.vercel={id:found.uid||'',status:String(found.state||'').toUpperCase()||'UNKNOWN',url:vercelCred.metadata?.productionOrigin||(found.url?`https://${found.url}`:''),message:found.meta?.githubCommitMessage||'',checkedAt:new Date()}
      }
    }catch(e){out.vercel={...out.vercel,status:'error',message:e.message}}
  }else if(vercelCred.value&&!vercelCred.metadata?.primaryProjectId){out.vercel={...out.vercel,status:'not-linked',message:'Selecione o projeto Vercel principal na Central de Plataformas.'}}

  if(renderCred.value&&renderCred.metadata?.primaryServiceId&&commitSha){
    try{
      const r=await fetch(`https://api.render.com/v1/services/${encodeURIComponent(renderCred.metadata.primaryServiceId)}/deploys?limit=20`,{headers:{Authorization:`Bearer ${renderCred.value}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
      const body=await r.json().catch(()=>[])
      if(!r.ok)throw new Error(body?.message||body?.error||`Render respondeu ${r.status}`)
      const rows=Array.isArray(body)?body:[]
      const found=rows.map(x=>x?.deploy||x||{}).find(d=>String(d.commit?.id||'').toLowerCase()===commitSha.toLowerCase())
      if(found){out.render={id:found.id||'',status:String(found.status||'').toLowerCase()||'unknown',url:renderCred.metadata?.backendUrl||'',message:found.commit?.message||'',checkedAt:new Date()}}
    }catch(e){out.render={...out.render,status:'error',message:e.message}}
  }else if(renderCred.value&&!renderCred.metadata?.primaryServiceId){out.render={...out.render,status:'not-linked',message:'Selecione o serviço Render principal na Central de Plataformas.'}}
  return out
}
function deploymentReady(state){
  const vc=String(state.vercel?.status||'').toUpperCase()==='READY'
  const rd=['live','succeeded','deployed'].includes(String(state.render?.status||'').toLowerCase())
  return vc&&rd
}
async function refreshCloudRelease(release,{force=false}={}){
  if(!release?.commitSha)return cloudReleaseView(release)
  const target=await resolveProductionGitTarget()
  const publishedRepo=normalizeGithubRepository(release.repository||'')
  if(target.ok && publishedRepo && publishedRepo.toLowerCase()!==target.repository.toLowerCase()){
    const error=`O commit foi publicado em ${publishedRepo}, mas a produção está ligada a ${target.repository}. Acompanhamento interrompido para evitar esperar por um deploy que nunca chegará.`
    const updated=await UpdateRelease.findOneAndUpdate({releaseId:release.releaseId},{$set:{
      status:'deploy-target-mismatch',productionReady:false,error,productionTarget:target,lastCheckedAt:new Date(),stalledAt:new Date(),completedAt:new Date(),
      recovery:{action:'republish',message:'Publique novamente o mesmo pacote do R2 usando o repositório de produção detectado.',detectedAt:new Date()},
    },$inc:{trackingAttempts:1}},{new:true})
    return cloudReleaseView(updated)
  }
  if(target.conflict){
    const updated=await UpdateRelease.findOneAndUpdate({releaseId:release.releaseId},{$set:{
      status:'deploy-blocked',productionReady:false,error:target.message,productionTarget:target,lastCheckedAt:new Date(),completedAt:new Date(),
    },$inc:{trackingAttempts:1}},{new:true})
    return cloudReleaseView(updated)
  }

  const platform=await platformDeployState(release)
  const ready=deploymentReady(platform)
  const failed=String(platform.vercel?.status||'').toUpperCase()==='ERROR'||/fail|error|cancel/i.test(String(platform.render?.status||''))
  const blocked=['not-configured','not-linked'].includes(String(platform.vercel?.status||''))||['not-configured','not-linked'].includes(String(platform.render?.status||''))
  const startedAt=new Date(release.trackingStartedAt||release.publishedAt||release.updatedAt||release.createdAt||Date.now()).getTime()
  const ageMs=Math.max(0,Date.now()-startedAt)
  const vc=String(platform.vercel?.status||'waiting')
  const rd=String(platform.render?.status||'waiting')
  const vcWaiting=['waiting','pending',''].includes(vc.toLowerCase())
  const rdWaiting=['waiting','pending',''].includes(rd.toLowerCase())
  const vcWorking=['BUILDING','QUEUED','INITIALIZING','PENDING'].includes(vc.toUpperCase())
  const rdWorking=/build|progress|queued|pending|update|create/i.test(rd)
  const recognitionTimeout=Math.max(2*60*1000,Number(process.env.AL_UPDATE_DEPLOY_RECOGNITION_TIMEOUT_MS||8*60*1000))
  const buildTimeout=Math.max(recognitionTimeout,Number(process.env.AL_UPDATE_DEPLOY_BUILD_TIMEOUT_MS||45*60*1000))
  const stalled=!ready&&!failed&&!blocked&&((vcWaiting&&rdWaiting&&ageMs>recognitionTimeout)||((vcWorking||rdWorking||vcWaiting||rdWaiting)&&ageMs>buildTimeout))

  let status=ready?'completed':failed?'deploy-failed':blocked?'deploy-blocked':stalled?'deploy-stalled':'deploying'
  let error=''
  if(blocked) error=[platform.vercel?.message,platform.render?.message].filter(Boolean).join(' ')||'Vincule Vercel e Render na Central de Plataformas.'
  else if(failed) error=[platform.vercel?.message,platform.render?.message].filter(Boolean).join(' ')||'Um dos deploys falhou.'
  else if(stalled) error=vcWaiting&&rdWaiting
    ?`Vercel e Render não reconheceram o commit ${String(release.commitSha).slice(0,12)} dentro do tempo esperado. O acompanhamento foi pausado; o pacote continua preservado no R2.`
    :'O deploy excedeu o tempo esperado. O acompanhamento foi pausado para não deixar a Central travada indefinidamente.'

  const set={vercel:platform.vercel,render:platform.render,productionReady:ready,status,error,productionTarget:target,lastCheckedAt:new Date(),completedAt:ready||failed||blocked||stalled?new Date():null}
  if(stalled)set.stalledAt=new Date()
  if(ready)set.stalledAt=null
  if(stalled)set.recovery={action:'reconcile-or-republish',message:'Reconsultar as plataformas ou publicar novamente o pacote preservado no R2.',detectedAt:new Date()}
  const updated=await UpdateRelease.findOneAndUpdate({releaseId:release.releaseId},{$set:set,$inc:{trackingAttempts:1}},{new:true})
  return cloudReleaseView(updated)
}
async function maybeTriggerRenderCommit(commitSha){
  const cred=await getCredential('render','RENDER_API_KEY')
  const serviceId=cred.metadata?.primaryServiceId||''
  if(!cred.value||!serviceId||!commitSha)return {triggered:false,reason:'not-configured'}
  try{
    const serviceResp=await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}`,{headers:{Authorization:`Bearer ${cred.value}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
    const serviceBody=await serviceResp.json().catch(()=>({}))
    const service=serviceBody?.service||serviceBody||{}
    const auto=String(service.autoDeploy??'').toLowerCase()
    if(['yes','true','on_commit','on-commit'].includes(auto)||service.autoDeploy===true)return {triggered:false,reason:'auto-deploy'}
    const r=await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys`,{
      method:'POST',headers:{Authorization:`Bearer ${cred.value}`,Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify({commitId:commitSha,clearCache:'do_not_clear'}),
    })
    const body=await r.json().catch(()=>({}))
    if(!r.ok)throw new Error(body?.message||body?.error||`Render respondeu ${r.status}`)
    const deploy=body?.deploy||body||{}
    return {triggered:true,deployId:deploy.id||''}
  }catch(e){return {triggered:false,reason:'error',error:e.message}}
}

const cloudPublishRunners=new Set()
const CLOUD_PUBLISH_STALE_MS=Math.max(15_000,Number(process.env.AL_UPDATE_PUBLISH_HEARTBEAT_STALE_MS||35_000))
const CLOUD_PUBLISH_MAX_ATTEMPTS=Math.max(1,Math.min(6,Number(process.env.AL_UPDATE_PUBLISH_MAX_ATTEMPTS||3)))
const CLOUD_PUBLISH_TOTAL_TIMEOUT_MS=Math.max(5*60_000,Number(process.env.AL_UPDATE_GITHUB_PUBLISH_TIMEOUT_MS||25*60_000))

function managedPublishRetryable(err){
  const status=Number(err?.status||0)
  return [408,425,429,500,502,503,504].includes(status)||/timeout|temporar|ECONN|ETIMEDOUT|fetch failed|network/i.test(String(err?.message||''))
}

async function updateManagedPublishProgress(releaseId,current={}){
  const state=await UpdateRelease.findOne({releaseId}).select('status').lean().catch(()=>null)
  if(state?.status==='interrupted'){
    const e=new Error('Publicação encerrada pelo usuário. O pacote permanece no R2.');e.code='UPDATE_PUBLISH_INTERRUPTED';e.status=409;throw e
  }
  const timeline=Array.isArray(current.timeline)?current.timeline.slice(-30):[]
  const fileLog=Array.isArray(current.fileLog)?current.fileLog.slice(-60):[]
  await UpdateRelease.updateOne({releaseId},{$set:{
    publishStatus:current.status||'running',publishPhase:current.phase||'',publishPhaseLabel:current.phaseLabel||'',publishProgress:Number(current.progress||0),
    publishHeartbeatAt:new Date(),publishError:current.error||'',publishTimeline:timeline,githubStatus:current.status==='failed'?'failed':'running',
    publishFileLog:fileLog,publishCurrentFile:current.currentFile||{},publishFilesDone:Number(current.filesDone||current.filesProgress?.done||0),publishFilesTotal:Number(current.filesTotal||current.filesProgress?.total||0),
  }}).catch(()=>{})
}

function scheduleManagedReleasePublish(releaseId,{delayMs=0}={}){
  if(!releaseId||cloudPublishRunners.has(releaseId))return false
  const launch=()=>{
    if(cloudPublishRunners.has(releaseId))return
    cloudPublishRunners.add(releaseId)
    void executeManagedReleasePublish(releaseId)
      .catch(async err=>{
        const current=await UpdateRelease.findOne({releaseId}).select('status').lean().catch(()=>null)
        if(current?.status==='publishing')await UpdateRelease.updateOne({releaseId},{$set:{status:'failed',githubStatus:'failed',publishStatus:'failed',publishPhase:'failed',publishPhaseLabel:'Falha antes de iniciar a publicação',publishProgress:100,publishCompletedAt:new Date(),publishError:String(err?.message||err),error:String(err?.message||err),completedAt:new Date()}}).catch(()=>{})
      })
      .finally(()=>cloudPublishRunners.delete(releaseId))
  }
  if(delayMs>0){const t=setTimeout(launch,delayMs);t.unref?.()}else setImmediate(launch)
  return true
}

async function ensureManagedPublishContinuity(doc){
  if(!doc||doc.status!=='publishing'||doc.commitSha)return doc
  const now=Date.now()
  const heartbeat=new Date(doc.publishHeartbeatAt||doc.updatedAt||doc.createdAt||0).getTime()
  const started=new Date(doc.publishStartedAt||doc.createdAt||0).getTime()
  const attempts=Number(doc.publishAttempts||0)
  const totalAge=started?now-started:0
  const stale=!heartbeat||now-heartbeat>CLOUD_PUBLISH_STALE_MS
  if(totalAge>CLOUD_PUBLISH_TOTAL_TIMEOUT_MS||attempts>=CLOUD_PUBLISH_MAX_ATTEMPTS&&stale){
    await UpdateRelease.updateOne({_id:doc._id},{$set:{
      status:'publish-stalled',githubStatus:'interrupted',publishStatus:'stalled',publishCompletedAt:new Date(),stalledAt:new Date(),completedAt:new Date(),
      error:'A publicação persistente não conseguiu confirmar o GitHub dentro do limite de segurança. O ZIP continua preservado no R2.',
      publishError:'Limite de retomadas automáticas atingido.',recovery:{action:'republish',message:'Use “Publicar novamente do R2” para iniciar uma nova tentativa no destino bloqueado.',detectedAt:new Date()},
    }}).catch(()=>{})
    return doc
  }
  if(stale)scheduleManagedReleasePublish(doc.releaseId)
  return doc
}

async function executeManagedReleasePublish(releaseId){
  let tempDir=null,packageRoot=null,heartbeat=null
  const release=await UpdateRelease.findOne({releaseId})
  if(!release||release.status!=='publishing'||release.commitSha)return
  const attempt=Number(release.publishAttempts||0)+1
  if(attempt>CLOUD_PUBLISH_MAX_ATTEMPTS){await ensureManagedPublishContinuity(release);return}
  const repository=normalizeGithubRepository(release.repository||'')
  const branch=String(release.branch||'main').trim()||'main'
  if(!repository)throw new Error('Destino GitHub congelado ausente na release persistente.')
  const frozenRepo=normalizeGithubRepository(release.productionTarget?.repository||'')
  const frozenBranch=String(release.productionTarget?.branch||'main').trim()||'main'
  if(frozenRepo&&frozenRepo.toLowerCase()!==repository.toLowerCase())throw new Error('O destino persistido da release diverge do destino GitHub congelado.')
  if(frozenRepo&&frozenBranch.toLowerCase()!==branch.toLowerCase())throw new Error('A branch persistida da release diverge da branch de produção congelada.')
  const token=await githubToken()
  if(!token)throw Object.assign(new Error('GitHub não conectado. Configure a credencial em Integrações e APIs.'),{status:401})
  const now=new Date()
  // Se o Render reiniciou depois do push, confirme primeiro o SHA candidato já persistido.
  // Isso evita criar um segundo commit apenas porque a verificação pós-push foi interrompida.
  if(release.publishCandidateSha){
    await UpdateRelease.updateOne({_id:release._id},{$set:{publishStatus:'running',publishPhase:'github-verify',publishPhaseLabel:'Retomando confirmação do commit já enviado',publishProgress:96,publishHeartbeatAt:now,githubStatus:'running',publishError:'',error:''},$inc:{publishAttempts:1}})
    try{
      const githubVerification=await verifyGithubReleaseCommit({token,repository,branch,commitSha:release.publishCandidateSha,version:release.version})
      const renderKick=await maybeTriggerRenderCommit(release.publishCandidateSha)
      const finished=new Date()
      const saved=await UpdateRelease.findOneAndUpdate({releaseId},{$set:{
        status:'deploying',githubStatus:'completed',githubVerified:true,githubVerifiedAt:finished,githubVerification,repository,branch,
        commitSha:release.publishCandidateSha,commitUrl:release.publishCandidateUrl||'',publishedAt:finished,trackingStartedAt:finished,lastCheckedAt:null,trackingAttempts:0,
        publishStatus:'completed',publishPhase:'completed',publishPhaseLabel:'GitHub confirmado após retomada',publishProgress:100,publishHeartbeatAt:finished,publishCompletedAt:finished,publishError:'',
        publishCandidateSha:'',publishCandidateUrl:'',publishCandidateAt:null,stalledAt:null,interruptedAt:null,recovery:{},completedAt:null,error:'',...(renderKick?.deployId?{'render.id':renderKick.deployId,'render.status':'queued'}:{}),
      }},{new:true})
      await refreshCloudRelease(saved)
      return
    }catch(err){
      const message=String(err?.message||'Não foi possível confirmar o commit candidato no GitHub.')
      const retry=managedPublishRetryable(err)&&attempt<CLOUD_PUBLISH_MAX_ATTEMPTS
      if(retry){
        const delay=Math.min(30_000,Math.max(4000,Number(err?.retryAfterMs||0)||5000*attempt))
        await UpdateRelease.updateOne({releaseId},{$set:{
          status:'publishing',githubStatus:'retrying',publishStatus:'retry-wait',publishPhase:'retry-wait',publishPhaseLabel:`Confirmação do GitHub interrompida · retomando em ${Math.ceil(delay/1000)} s`,publishHeartbeatAt:new Date(),publishError:message,error:'',
          recovery:{action:'auto-resume-candidate',message:'O SHA já enviado foi preservado. A próxima tentativa confirmará o mesmo commit antes de qualquer nova publicação.',detectedAt:new Date()},
        }})
        const resumeTimer=setTimeout(()=>scheduleManagedReleasePublish(releaseId),delay);resumeTimer.unref?.()
      }else{
        const recoverable=managedPublishRetryable(err)
        await UpdateRelease.updateOne({releaseId},{$set:{
          status:recoverable?'publish-stalled':'failed',githubStatus:'failed',githubVerified:false,publishStatus:recoverable?'stalled':'failed',publishPhase:'github-verify-failed',publishPhaseLabel:'Commit enviado, mas não confirmado na branch',publishProgress:100,publishHeartbeatAt:new Date(),publishCompletedAt:new Date(),publishError:message,error:message,stalledAt:recoverable?new Date():null,completedAt:new Date(),
          recovery:{action:'reconcile-candidate',message:'O SHA candidato e o ZIP continuam preservados. Reconsulte antes de publicar novamente.',detectedAt:new Date()},
        }})
      }
      return
    }
  }
  await UpdateRelease.updateOne({_id:release._id},{$set:{
    publishStatus:'running',publishPhase:'r2-download',publishPhaseLabel:'Baixando pacote preservado do R2',publishProgress:5,publishHeartbeatAt:now,
    publishStartedAt:release.publishStartedAt||now,publishCompletedAt:null,publishError:'',githubStatus:'running',error:'',completedAt:null,
  },$inc:{publishAttempts:1}})
  heartbeat=setInterval(()=>{void UpdateRelease.updateOne({releaseId},{$set:{publishHeartbeatAt:new Date()}}).catch(()=>{})},5000);heartbeat.unref?.()
  try{
    tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'alsistemas-r2-release-'))
    const tempZip=path.join(tempDir,release.filename)
    await downloadUpdatePackage(release,tempZip)
    await UpdateRelease.updateOne({releaseId},{$set:{publishPhase:'package-validate',publishPhaseLabel:'Validando pacote recuperado do R2',publishProgress:10,publishHeartbeatAt:new Date()}})
    const meta=await validateAndStage(tempZip,release.filename,{persist:false})
    packageRoot=meta._packageRoot
    if(meta.sha256!==release.packageSha256)throw new Error('O SHA-256 do pacote recuperado do R2 não corresponde ao pacote validado originalmente.')
    const [owner,repo]=repository.split('/')
    let previousCommitSha=release.previousCommitSha||''
    if(!previousCommitSha){try{const head=await githubApi(token,`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`);previousCommitSha=head.sha||''}catch{}}
    const jobId=release.publishJobId||`cloudpub_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    if(!release.publishJobId)await UpdateRelease.updateOne({releaseId},{$set:{publishJobId:jobId}})
    const job={
      id:jobId,type:'github-publish',stageId:releaseId,stagePath:packageRoot,fromVersion:release.fromVersion||(await installedVersion()).version,toVersion:release.version,
      repository,branch,publishMode:release.publishMode||'project',commitMessage:String(release.publishCommitMessage||`Atualiza AL Sistemas para ${release.version}`).slice(0,200),
      status:'queued',progress:12,createdAt:release.publishStartedAt?.toISOString?.()||new Date().toISOString(),sourceType:'r2',
    }
    const finalJob=await runGithubPublish(job,token,{jobFile:null,persistHistory:false,onUpdate:current=>updateManagedPublishProgress(releaseId,current)})
    await UpdateRelease.updateOne({releaseId},{$set:{publishPhase:'github-verify',publishPhaseLabel:'Confirmando commit e branch no GitHub',publishProgress:96,publishHeartbeatAt:new Date(),publishCandidateSha:finalJob.commitSha||'',publishCandidateUrl:finalJob.commitUrl||'',publishCandidateAt:new Date()}})
    const githubVerification=await verifyGithubReleaseCommit({token,repository,branch,commitSha:finalJob.commitSha||'',version:release.version})
    const renderKick=await maybeTriggerRenderCommit(finalJob.commitSha||'')
    const finished=new Date()
    const saved=await UpdateRelease.findOneAndUpdate({releaseId},{$set:{
      status:'deploying',githubStatus:'completed',githubVerified:true,githubVerifiedAt:finished,githubVerification,repository,branch,
      commitSha:finalJob.commitSha||'',commitUrl:finalJob.commitUrl||'',previousCommitSha,publishedAt:finished,trackingStartedAt:finished,lastCheckedAt:null,trackingAttempts:0,
      publishStatus:'completed',publishPhase:'completed',publishPhaseLabel:'GitHub confirmado',publishProgress:100,publishHeartbeatAt:finished,publishCompletedAt:finished,publishError:'',publishCandidateSha:'',publishCandidateUrl:'',publishCandidateAt:null,
      stalledAt:null,interruptedAt:null,recovery:{},completedAt:null,error:'',...(renderKick?.deployId?{'render.id':renderKick.deployId,'render.status':'queued'}:{}),
    }},{new:true})
    await refreshCloudRelease(saved)
  }catch(err){
    const current=await UpdateRelease.findOne({releaseId}).lean().catch(()=>null)
    if(current?.status==='interrupted'||err?.code==='UPDATE_PUBLISH_INTERRUPTED')return
    const attempts=Number(current?.publishAttempts||attempt)
    const retry=managedPublishRetryable(err)&&attempts<CLOUD_PUBLISH_MAX_ATTEMPTS
    const message=String(err?.message||'Falha na publicação persistente.')
    if(retry){
      const delay=Math.min(30_000,Math.max(4000,Number(err?.retryAfterMs||0)||5000*attempts))
      await UpdateRelease.updateOne({releaseId},{$set:{
        status:'publishing',githubStatus:'retrying',publishStatus:'retry-wait',publishPhase:'retry-wait',publishPhaseLabel:`Conexão interrompida · retomando automaticamente em ${Math.ceil(delay/1000)} s`,publishHeartbeatAt:new Date(),publishError:message,error:'',
        recovery:{action:'auto-resume',message:'A publicação será retomada automaticamente usando o mesmo ZIP do R2 e o mesmo destino congelado.',detectedAt:new Date()},
      }}).catch(()=>{})
      const resumeTimer=setTimeout(()=>scheduleManagedReleasePublish(releaseId),delay);resumeTimer.unref?.()
    }else{
      const recoverable=managedPublishRetryable(err)
      await UpdateRelease.updateOne({releaseId},{$set:{
        status:recoverable?'publish-stalled':'failed',githubStatus:'failed',githubVerified:false,publishStatus:recoverable?'stalled':'failed',publishPhase:'failed',publishPhaseLabel:'Publicação não confirmada',publishProgress:100,publishHeartbeatAt:new Date(),publishCompletedAt:new Date(),publishError:message,
        error:message,stalledAt:recoverable?new Date():null,completedAt:new Date(),recovery:recoverable?{action:'republish',message:'O ZIP permanece no R2. Publique novamente sem reenviar o arquivo.',detectedAt:new Date()}: {},
      }}).catch(()=>{})
    }
  }finally{
    if(heartbeat)clearInterval(heartbeat)
    if(packageRoot)await fs.rm(packageRoot,{recursive:true,force:true}).catch(()=>{})
    if(tempDir)await fs.rm(tempDir,{recursive:true,force:true}).catch(()=>{})
  }
}

router.get('/',async(_req,res,next)=>{try{
  const isTermux=IS_TERMUX
  const processManager=IS_VERCEL?'Vercel Functions':IS_RENDER?'Render Service':process.env.pm_id!==undefined?'PM2':process.env.INVOCATION_ID?'systemd':isTermux?'Termux/manual':'manual'
  const activeOperation=IS_MANAGED_PLATFORM?null:await readUpdateLock()
  const stack=await runtimeStack()
  const cloudReleases=IS_MANAGED_PLATFORM?await listCloudReleases():[]
  const cloudStorage=IS_MANAGED_PLATFORM?await cloudStorageStatus():null
  const cloudReady=cloudReleases.filter(x=>['ready','publishing','publish-stalled','deploying','deploy-stalled','deploy-target-mismatch','deploy-failed','deploy-blocked','failed','interrupted'].includes(x.status))
  const cloudHistory=cloudReleases.filter(x=>['completed','publish-stalled','deploy-stalled','deploy-target-mismatch','deploy-failed','deploy-blocked','failed','interrupted'].includes(x.status))
  res.json({
    installed:await installedVersion(),staged:IS_MANAGED_PLATFORM?cloudReady:await listStaged(),history:IS_MANAGED_PLATFORM?cloudHistory:await readHistory(),snapshots:IS_MANAGED_PLATFORM?[]:await listSnapshots(),activeOperation,cloudStorage,
    runtime:{
      environment:IS_VERCEL?'Vercel':IS_RENDER?'Render':isTermux?'Termux':process.platform==='linux'?'Linux/VPS':process.platform,
      node:process.version,npm:npmRuntimeVersion(),arch:process.arch,platform:process.platform,processManager,
      termuxVersion:process.env.TERMUX_VERSION||null,
      stack,
    },
    restart:{strategy:process.env.AL_UPDATE_RESTART_STRATEGY||(isTermux?'termux':'none'),pm2Name:process.env.AL_UPDATE_PM2_NAME||'al-sistemas',systemdService:process.env.AL_UPDATE_SYSTEMD_SERVICE||'al-sistemas.service'},
    updateCapabilities:{
      environment:IS_VERCEL?'vercel':IS_RENDER?'render':'persistent-server',
      persistentStaging:!IS_MANAGED_PLATFORM,
      localInstall:!IS_MANAGED_PLATFORM,
      githubPublish:true,
      incrementalPackages:!IS_MANAGED_PLATFORM,
      fullPackages:true,
      packageStorage:IS_MANAGED_PLATFORM?'r2':'external-staging',
      detachedMonitor:!IS_MANAGED_PLATFORM,
      stateStorage:IS_MANAGED_PLATFORM?'mongodb':'outside-project',
      preflight:!IS_MANAGED_PLATFORM,
      maintenanceMode:!IS_MANAGED_PLATFORM,
      snapshotRetention:IS_MANAGED_PLATFORM?0:Number(process.env.AL_UPDATE_SNAPSHOT_KEEP||3),
      finalReport:true,
      stageIntegrity:true,
      exclusiveLock:!IS_MANAGED_PLATFORM,
      transactionalApply:!IS_MANAGED_PLATFORM,
      automaticRecovery:!IS_MANAGED_PLATFORM,
      externalWatchdog:!IS_MANAGED_PLATFORM,
      zipHardening:true,
      engineSelfTest:!IS_MANAGED_PLATFORM,
      stageRetention:Number(process.env.AL_UPDATE_STAGE_KEEP||5),
      emergencyRecoveryCommand:IS_MANAGED_PLATFORM?null:`node "${path.join(STATE_DIR,'runtime','recoverPending.cjs')}" "${STATE_DIR}"`,
      productionFlow:IS_MANAGED_PLATFORM?'r2-github-vercel-render':'local-install',
    }
  })
}catch(e){next(e)}})

async function githubApi(token,pathName){
  let r
  try{
    r=await fetch(`https://api.github.com${pathName}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'AL-Sistemas','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(20000)})
  }catch(err){const e=new Error(`GitHub não respondeu a tempo: ${err.message}`);e.status=504;e.code='GITHUB_TIMEOUT';throw e}
  const data=await r.json().catch(()=>({}))
  if(!r.ok){const e=new Error(data.message||`GitHub respondeu ${r.status}`);e.status=r.status;const retry=Number(r.headers.get('retry-after')||0);if(retry)e.retryAfterMs=retry*1000;throw e}
  return data
}
function vercelApiUrl(pathName,teamId=''){
  const u=new URL(`https://api.vercel.com${pathName}`)
  if(teamId)u.searchParams.set('teamId',teamId)
  return u.toString()
}
router.get('/production-target',async(_req,res,next)=>{try{
  if(!IS_MANAGED_PLATFORM)return res.json({ok:false,managed:false,repository:'',branch:'main',message:'Destino automático é usado apenas em Vercel/Render.'})
  const target=await resolveProductionGitTarget()
  res.status(target.ok?200:409).json({...target,managed:true})
}catch(e){next(e)}})

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
  const rd=await getCredential('render','RENDER_API_KEY')
  let render={configured:Boolean(rd.value),ok:null,services:[],serviceId:'',repo:'',branch:'',message:rd.value?'Verificando serviços vinculados…':'Render não configurada.'}
  if(rd.value){
    try{
      const rr=await fetch('https://api.render.com/v1/services?limit=100',{headers:{Authorization:`Bearer ${rd.value}`,Accept:'application/json'}})
      const rb=await rr.json().catch(()=>[])
      if(!rr.ok)throw new Error(rb?.message||rb?.error||`Render respondeu ${rr.status}`)
      const services=(Array.isArray(rb)?rb:[]).map(row=>row?.service||row||{}).filter(Boolean)
      const repoLower=repository.toLowerCase()
      const matches=services.filter(s=>{
        const repoUrl=String(s.repo||'')
        const normalized=repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//i,'').replace(/\.git$/i,'').replace(/^git@github\.com:/i,'').toLowerCase()
        const sameRepo=normalized===repoLower
        const sameBranch=!s.branch||String(s.branch).toLowerCase()===branch.toLowerCase()
        return sameRepo&&sameBranch
      }).map(s=>({id:s.id,name:s.name,type:s.type||'',repo:s.repo||'',branch:s.branch||'',autoDeploy:s.autoDeploy,url:s.url||s.serviceDetails?.url||null}))
      const first=matches[0]||null
      render={configured:true,ok:true,services:matches,serviceId:first?.id||'',repo:first?.repo||'',branch:first?.branch||'',message:matches.length?`${matches.length} serviço(s) Render vinculado(s) a este repositório/branch.`:'Render conectada, mas nenhum serviço vinculado a este repositório/branch foi identificado.'}
    }catch(e){render={...render,ok:false,message:e.message}}
  }
  let productionTarget=null
  if(IS_MANAGED_PLATFORM){
    productionTarget=await resolveProductionGitTarget()
    if(productionTarget.ok){
      const repoMatch=normalizeGithubRepository(repository).toLowerCase()===productionTarget.repository.toLowerCase()
      const branchMatch=String(branch).toLowerCase()===String(productionTarget.branch||'main').toLowerCase()
      github.productionTarget=productionTarget
      github.targetMismatch=!repoMatch||!branchMatch
      if(github.targetMismatch){
        github.ok=false
        github.message=`A produção está vinculada a ${productionTarget.repository} @ ${productionTarget.branch}. O atualizador não publicará em ${repository} @ ${branch}.`
      }
    }else if(productionTarget.conflict){
      github.ok=false;github.targetMismatch=true;github.message=productionTarget.message
    }
  }
  res.json({ok:github.writable&&!github.targetMismatch,github,vercel,render,productionTarget})
}catch(e){next(e)}})

router.post('/self-test',async(_req,res,next)=>{try{
  const result=await runUpdateSelfTest()
  res.status(result.ok?200:500).json({selfTest:result})
}catch(e){next(e)}})

router.get('/diagnostics',async(_req,res,next)=>{try{
  const diagnostics=await getUpdaterDiagnostics()
  res.json({diagnostics})
}catch(e){next(e)}})

async function timedCheck(id,label,required,fn){
  const started=Date.now()
  try{
    const detail=await fn()
    return {id,label,required,status:'pass',ok:true,detail,durationMs:Date.now()-started}
  }catch(error){
    return {id,label,required,status:required?'fail':'warn',ok:false,detail:error?.message||String(error),durationMs:Date.now()-started}
  }
}

router.post('/post-install-self-test',async(req,res,next)=>{try{
  const startedAt=new Date().toISOString()
  const isTermux=Boolean(process.env.TERMUX_VERSION||String(process.env.PREFIX||'').includes('com.termux'))
  const frontendUrl=String(req.body?.frontendUrl||'').trim()
  const checks=[]

  checks.push(await timedCheck('backend','Backend respondendo',true,async()=>({
    node:process.version,
    pid:process.pid,
    uptimeSeconds:Math.round(process.uptime()),
  })))

  checks.push(await timedCheck('mongo','MongoDB',true,async()=>{
    if(mongoose.connection.readyState!==1)throw new Error(`MongoDB não conectado (estado ${mongoose.connection.readyState}).`)
    await mongoose.connection.db.admin().ping()
    return {database:mongoose.connection.name,host:mongoose.connection.host}
  }))

  checks.push(await timedCheck('versions','Versões sincronizadas',true,async()=>{
    const installed=await installedVersion()
    const backendPkg=JSON.parse(await fs.readFile(path.join(ROOT_DIR,'backend','package.json'),'utf8'))
    const frontendPkg=JSON.parse(await fs.readFile(path.join(ROOT_DIR,'frontend','package.json'),'utf8'))
    const manifest=JSON.parse(await fs.readFile(path.join(ROOT_DIR,'al-sistemas.json'),'utf8'))
    const versions=[installed.version,backendPkg.version,frontendPkg.version,manifest.version]
    if(new Set(versions).size!==1)throw new Error(`Versões divergentes: ${versions.join(' / ')}`)
    return {version:versions[0]}
  }))

  checks.push(await timedCheck('files','Arquivos essenciais',true,async()=>{
    const requiredFiles=['backend/src/server.js','backend/package.json','frontend/src/main.jsx','frontend/index.html','frontend/package.json','al-sistemas.json']
    const missing=[]
    for(const rel of requiredFiles){try{await fs.access(path.join(ROOT_DIR,rel))}catch{missing.push(rel)}}
    if(missing.length)throw new Error(`Ausentes: ${missing.join(', ')}`)
    return {checked:requiredFiles.length}
  }))

  checks.push(await timedCheck('write','Gravação da instalação e estado',true,async()=>{
    const probes=[path.join(ROOT_DIR,'.al-selftest-write'),path.join(STATE_DIR,'.al-selftest-write')]
    for(const file of probes){
      await fs.mkdir(path.dirname(file),{recursive:true})
      await fs.writeFile(file,`ok ${Date.now()}`)
      await fs.rm(file,{force:true})
    }
    return {root:ROOT_DIR,state:STATE_DIR}
  }))

  checks.push(await timedCheck('health','Health check local',true,async()=>{
    const url=`http://127.0.0.1:${process.env.PORT||3001}/api/health/live`
    const r=await fetch(url,{signal:AbortSignal.timeout(5000)})
    if(!r.ok)throw new Error(`Health respondeu HTTP ${r.status}`)
    return {url,status:r.status}
  }))

  checks.push(await timedCheck('rss','Agendador RSS',false,async()=>{
    const status=statusRssJob()
    if(!status.ativo)throw new Error('Scheduler RSS não está ativo.')
    return {ativo:status.ativo,emExecucao:status.emExecucao,ultimoCiclo:status.ultimoCiclo||null}
  }))

  const github=await getCredential('github','GITHUB_TOKEN')
  if(github.value){
    checks.push(await timedCheck('github','GitHub conectado',false,async()=>{
      const user=await githubApi(github.value,'/user')
      return {login:user.login,name:user.name||null}
    }))
  }else checks.push({id:'github',label:'GitHub conectado',required:false,status:'skip',ok:true,detail:'Não configurado — teste ignorado.',durationMs:0})

  const vercel=await getCredential('vercel','VERCEL_TOKEN')
  if(vercel.value){
    checks.push(await timedCheck('vercel','Vercel conectada',false,async()=>{
      const r=await fetch('https://api.vercel.com/v2/user',{headers:{Authorization:`Bearer ${vercel.value}`},signal:AbortSignal.timeout(6000)})
      const body=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(body.error?.message||`Vercel respondeu HTTP ${r.status}`)
      const u=body.user||body
      return {account:u.username||u.name||u.email||u.id||'Conta identificada'}
    }))
  }else checks.push({id:'vercel',label:'Vercel conectada',required:false,status:'skip',ok:true,detail:'Não configurada — teste ignorado.',durationMs:0})

  if(frontendUrl){
    checks.push(await timedCheck('frontend','Portal/frontend acessível',true,async()=>{
      const u=new URL(frontendUrl)
      const r=await fetch(u.toString(),{redirect:'follow',signal:AbortSignal.timeout(7000)})
      if(!r.ok)throw new Error(`Frontend respondeu HTTP ${r.status}`)
      return {url:u.toString(),status:r.status}
    }))
  }else checks.push({id:'frontend',label:'Portal/frontend acessível',required:false,status:'skip',ok:true,detail:'URL do navegador não informada.',durationMs:0})

  const required=checks.filter(c=>c.required)
  const failures=required.filter(c=>!c.ok)
  const warnings=checks.filter(c=>c.status==='warn')
  const passed=checks.filter(c=>c.status==='pass').length
  const considered=checks.filter(c=>c.status!=='skip').length
  const score=considered?Math.round((passed/considered)*100):100
  const installed=await installedVersion()
  const report={
    ok:failures.length===0,
    score,
    version:installed.version,
    environment:IS_VERCEL?'Vercel':IS_RENDER?'Render':isTermux?'Termux':process.platform,
    startedAt,
    finishedAt:new Date().toISOString(),
    checks,
    summary:{passed,failed:failures.length,warnings:warnings.length,skipped:checks.filter(c=>c.status==='skip').length,total:checks.length},
  }
  res.json({selfTest:report})
}catch(e){next(e)}})

router.post('/prepare',upload.single('package'),async(req,res,next)=>{try{
  if(!req.file)return res.status(400).json({erro:'Envie o pacote no campo package.'})
  const meta=await validateAndStage(req.file.path,req.file.originalname,{persist:!IS_MANAGED_PLATFORM})
  if(IS_MANAGED_PLATFORM){
    if(meta.packageType==='incremental')throw new Error('Na produção Vercel/Render use o pacote completo da versão.')
    const storage=await storeUpdatePackage(req.file.path,{version:meta.version,filename:req.file.originalname,sha256:meta.sha256})
    const release=await UpdateRelease.findOneAndUpdate(
      {releaseId:meta.id},
      {$set:{
        releaseId:meta.id,version:meta.version,fromVersion:(await installedVersion()).version,filename:req.file.originalname,packageType:meta.packageType||'full',
        packageSha256:meta.sha256,packageBytes:storage.bytes,bucket:storage.bucket,objectKey:storage.objectKey,storage:'r2',
        changelog:meta.changelog||'',integrity:meta.integrity||{},status:'ready',githubStatus:'pending',githubVerified:false,githubVerifiedAt:null,githubVerification:{},error:'',
        productionTarget:{},trackingStartedAt:null,lastCheckedAt:null,trackingAttempts:0,stalledAt:null,interruptedAt:null,recovery:{},
        vercel:{status:'pending'},render:{status:'pending'},productionReady:false,completedAt:null,
      }},
      {upsert:true,new:true,setDefaultsOnInsert:true},
    )
    if(meta._packageRoot)await fs.rm(meta._packageRoot,{recursive:true,force:true}).catch(()=>{})
    return res.status(201).json({
      message:`Pacote ${meta.version} validado e armazenado no R2. Ele permanece disponível mesmo se o navegador ou a Render reiniciar.`,
      update:cloudReleaseView(release),ephemeral:false,cloudStored:true,
    })
  }
  if(meta._packageRoot) await fs.rm(meta._packageRoot,{recursive:true,force:true}).catch(()=>{})
  const clean={...meta}; delete clean._packageRoot
  res.status(201).json({message:'Pacote validado e preparado.',update:clean,ephemeral:false})
}catch(e){next(e)}finally{if(req.file)await fs.rm(req.file.path,{force:true}).catch(()=>{})}})
router.delete('/staged/:stageId',async(req,res,next)=>{try{
  if(IS_MANAGED_PLATFORM){
    const release=await UpdateRelease.findOne({releaseId:req.params.stageId})
    if(!release)return res.status(404).json({erro:'Pacote armazenado não encontrado.'})
    if(release.objectKey)await deleteUpdatePackage(release).catch(e=>{throw new Error(`Não foi possível remover o ZIP do R2: ${e.message}`)})
    await release.deleteOne()
    return res.json({message:`Pacote ${release.version} removido do R2 e do histórico de preparação.`,removed:cloudReleaseView(release)})
  }
  const active=await readUpdateLock()
  if(active)return res.status(409).json({erro:'Não é possível excluir pacotes enquanto existe uma atualização/rollback em andamento.'})
  const removed=await deleteStaged(req.params.stageId)
  res.json({message:`Pacote ${removed.version} removido do staging.`,removed})
}catch(e){next(e)}})

router.delete('/snapshots/:snapshotId',async(req,res,next)=>{try{
  if(IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Snapshots locais não são usados em Render/Vercel.'})
  const active=await readUpdateLock()
  if(active)return res.status(409).json({erro:'Não é possível excluir snapshots enquanto existe uma atualização/rollback em andamento.'})
  const removed=await deleteSnapshot(req.params.snapshotId)
  res.json({message:`Snapshot da versão ${removed.version} excluído.`,removed})
}catch(e){next(e)}})

router.get('/:stageId/preflight',async(req,res,next)=>{try{
  if(IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Instalação local não se aplica a Render/Vercel. Publique pelo GitHub para gerar um novo deploy.'})
  const report=await getUpdatePreflight(req.params.stageId)
  res.json({preflight:report})
}catch(e){next(e)}})

router.post('/:stageId/install',async(req,res,next)=>{try{
  if(IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Instalação local desativada em plataforma gerenciada. Publique pelo GitHub; Render/Vercel farão o deploy da nova release.'})
  const alreadyActive=await readUpdateLock()
  if(alreadyActive)return res.status(409).json({erro:`Já existe uma operação de atualização em andamento (${alreadyActive.jobId}).`,codigo:'UPDATE_BUSY',active:alreadyActive})
  const preflight=await getUpdatePreflight(req.params.stageId)
  if(preflight.repair?.sameVersion&&preflight.repair?.noChanges)return res.status(409).json({erro:`A versão ${preflight.toVersion} já está íntegra. A reaplicação foi cancelada porque a comparação arquivo por arquivo não encontrou nada para reparar.`,codigo:'UPDATE_NO_CHANGES',preflight})
  if(!preflight.ok)return res.status(409).json({erro:'O pré-check bloqueou a instalação. Revise espaço em disco/migrações antes de continuar.',preflight})
  const job=await createJob(req.params.stageId,{...(req.body||{}),preflight})
  await reserveUpdateLock(job)
  try{ await launch(job) }catch(e){ await releaseUpdateLock(job.id); throw e }
  const monitorReady=await waitForMonitor(job)
  res.status(202).json({message:'Atualização iniciada.',job,monitorUrl:monitorUrl(job),monitorReady})
}catch(e){
  if(e.code==='UPDATE_BUSY')return res.status(409).json({erro:e.message,codigo:e.code,active:e.active})
  if(e.code==='UPDATE_NO_CHANGES')return res.status(409).json({erro:e.message,codigo:e.code})
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
  if(IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Recuperação de processo local não se aplica a Render/Vercel.'})
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
  if(IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Rollback local não é usado em Render/Vercel. Faça rollback/deploy pela plataforma ou GitHub.'})
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
  if(!IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Esta rota direta é exclusiva de Render/Vercel.'})
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
  const target=await resolveProductionGitTarget()
  if(!target.ok)return res.status(409).json({erro:target.message||'Destino de produção não identificado.',codigo:target.conflict?'UPDATE_TARGET_CONFLICT':'UPDATE_TARGET_UNKNOWN',productionTarget:target})
  if(normalizeGithubRepository(repository).toLowerCase()!==target.repository.toLowerCase()||String(branch).toLowerCase()!==String(target.branch||'main').toLowerCase())return res.status(409).json({erro:`Destino bloqueado: a produção usa ${target.repository} @ ${target.branch}.`,codigo:'UPDATE_TARGET_MISMATCH',productionTarget:target})
  const id=`job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  const job={
    id,type:'github-publish',stageId:meta.id,stagePath:packageRoot,
    fromVersion:(await installedVersion()).version,toVersion:meta.version,
    repository,branch,publishMode,
    commitMessage:String(req.body?.commitMessage||`Atualiza AL Sistemas para ${meta.version}`).slice(0,200),
    status:'queued',progress:0,createdAt:new Date().toISOString(),
  }
  const finalJob=await runGithubPublishInline(job,token)
  const githubVerification=await verifyGithubReleaseCommit({token,repository,branch,commitSha:finalJob.commitSha||'',version:meta.version})
  res.status(200).json({message:'Publicação no GitHub concluída e verificada no destino de produção.',job:finalJob,githubVerification,productionTarget:target})
}catch(e){next(e)}finally{
  if(req.file)await fs.rm(req.file.path,{force:true}).catch(()=>{})
  if(packageRoot)await fs.rm(packageRoot,{recursive:true,force:true}).catch(()=>{})
}})


router.post('/publish-current-github',async(req,res,next)=>{try{
  if(IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Em Render/Vercel a instalação em disco não é a origem da release. Envie o pacote completo e publique no GitHub.'})
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

router.post('/:stageId/publish-github',async(req,res,next)=>{let tempZip=null,packageRoot=null;try{
  const stageId=req.params.stageId
  const repository=String(req.body?.repository||'').trim()
  const branch=String(req.body?.branch||'main').trim()||'main'
  const publishMode=String(req.body?.publishMode||'project')
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))return res.status(400).json({erro:'Selecione um repositório GitHub válido.'})
  if(!['project','frontend-folder','frontend-root','backend-folder'].includes(publishMode))return res.status(400).json({erro:'Destino de publicação inválido.'})
  if(IS_MANAGED_PLATFORM&&publishMode!=='project')return res.status(400).json({erro:'Em produção Vercel + Render, atualizações do AL Sistemas devem publicar o projeto completo para manter frontend e backend no mesmo commit.'})
  const token=await githubToken()
  if(!token)return res.status(400).json({erro:'GitHub não conectado. Configure-o em Integrações e APIs.'})

  let managedTarget=null
  if(IS_MANAGED_PLATFORM){
    managedTarget=await resolveProductionGitTarget()
    if(!managedTarget.ok){
      return res.status(409).json({erro:managedTarget.message||'Não foi possível determinar o repositório de produção.',codigo:managedTarget.conflict?'UPDATE_TARGET_CONFLICT':'UPDATE_TARGET_UNKNOWN',productionTarget:managedTarget})
    }
    const requestedRepo=normalizeGithubRepository(repository)
    if(requestedRepo.toLowerCase()!==managedTarget.repository.toLowerCase()||String(branch).toLowerCase()!==String(managedTarget.branch||'main').toLowerCase()){
      return res.status(409).json({erro:`Destino bloqueado: a produção está vinculada a ${managedTarget.repository} @ ${managedTarget.branch}. O atualizador do AL não publicará em ${repository} @ ${branch}.`,codigo:'UPDATE_TARGET_MISMATCH',productionTarget:managedTarget})
    }
  }

  if(IS_MANAGED_PLATFORM){
    const release=await UpdateRelease.findOne({releaseId:stageId})
    if(!release)return res.status(404).json({erro:'Pacote persistente não encontrado no histórico de atualizações.'})
    if(release.packageType==='incremental')return res.status(409).json({erro:'Na produção Vercel/Render use o pacote completo da versão.'})
    if(release.status==='publishing'&&!release.commitSha){
      await ensureManagedPublishContinuity(release)
      const current=await UpdateRelease.findOne({releaseId:stageId})
      return res.status(202).json({message:'A publicação desta release já está em andamento e continuará a ser retomada automaticamente se o Render reiniciar.',job:{id:`cloud_${stageId}`,type:'cloud-release',releaseId:stageId,status:'running',phase:current.publishPhase||'github-publish',phaseLabel:current.publishPhaseLabel||'Publicando no GitHub',progress:Number(current.publishProgress||25),version:current.version,bucket:current.bucket,objectKey:current.objectKey},release:cloudReleaseView(current)})
    }
    const now=new Date()
    const publishJobId=`cloudpub_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    const frozenTarget={...managedTarget,repository:managedTarget.repository,branch:managedTarget.branch||'main',lockedAt:now.toISOString()}
    const updated=await UpdateRelease.findOneAndUpdate({_id:release._id},{$set:{
      status:'publishing',githubStatus:'queued',githubVerified:false,githubVerifiedAt:null,githubVerification:{},productionTarget:frozenTarget,targetLockedAt:now,
      repository,branch,publishMode,error:'',completedAt:null,stalledAt:null,interruptedAt:null,recovery:{},publishCommitMessage:String(req.body?.commitMessage||`Atualiza AL Sistemas para ${release.version}`).slice(0,200),
      publishJobId,publishStatus:'queued',publishPhase:'queued',publishPhaseLabel:'Publicação persistente criada',publishProgress:2,publishHeartbeatAt:now,publishStartedAt:now,publishCompletedAt:null,publishAttempts:0,publishError:'',publishCandidateSha:'',publishCandidateUrl:'',publishCandidateAt:null,publishTimeline:[{key:'queued',label:'Destino congelado e job persistido no MongoDB',progress:2,at:now.toISOString()}],
    },$unset:{commitSha:'',commitUrl:''}},{new:true})
    scheduleManagedReleasePublish(stageId)
    return res.status(202).json({
      message:`Publicação persistente do AL Sistemas ${release.version} iniciada. Você pode fechar a tela; o pacote está no R2 e o estado do job está no MongoDB.`,
      job:{id:`cloud_${stageId}`,type:'cloud-release',releaseId:stageId,status:'running',phase:'queued',phaseLabel:'Preparando publicação persistente',progress:22,version:release.version,filename:release.filename,bucket:release.bucket,objectKey:release.objectKey},
      release:cloudReleaseView(updated),productionTarget:frozenTarget,
    })
  }

  const staged=await listStaged()
  const stage=staged.find(s=>s.id===stageId)
  if(!stage)return res.status(404).json({erro:'Pacote preparado não encontrado.'})
  if(stage.packageType==='incremental')return res.status(409).json({erro:'Pacotes incrementais são destinados à instalação local. Para GitHub/Vercel, use o pacote completo da versão.'})
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
  if(IS_MANAGED_PLATFORM&&req.params.stageId)await UpdateRelease.updateOne({releaseId:req.params.stageId},{$set:{status:'failed',githubStatus:'failed',error:e.message}}).catch(()=>{})
  if(e.code==='UPDATE_BUSY')return res.status(409).json({erro:e.message,codigo:e.code,active:e.active})
  next(e)
}finally{
  if(packageRoot)await fs.rm(packageRoot,{recursive:true,force:true}).catch(()=>{})
  if(tempZip)await fs.rm(path.dirname(tempZip),{recursive:true,force:true}).catch(()=>{})
}})

router.get('/cloud-releases/:releaseId/status',async(req,res,next)=>{try{
  if(!IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Acompanhamento cloud é usado somente em Render/Vercel.'})
  let release=await UpdateRelease.findOne({releaseId:req.params.releaseId})
  if(!release)return res.status(404).json({erro:'Release cloud não encontrada.'})
  if(release.status==='publishing'&&!release.commitSha){
    await ensureManagedPublishContinuity(release)
    release=await UpdateRelease.findOne({releaseId:req.params.releaseId})
    return res.json({release:cloudReleaseView(release)})
  }
  const refreshed=await refreshCloudRelease(release)
  res.json({release:refreshed})
}catch(e){next(e)}})

router.post('/cloud-releases/:releaseId/reconcile',async(req,res,next)=>{try{
  if(!IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Reconciliação cloud é usada somente em Render/Vercel.'})
  let release=await UpdateRelease.findOne({releaseId:req.params.releaseId})
  if(!release)return res.status(404).json({erro:'Release cloud não encontrada.'})
  if(release.status==='publishing'&&!release.commitSha){
    await ensureManagedPublishContinuity(release)
    release=await UpdateRelease.findOne({releaseId:req.params.releaseId})
    return res.json({message:'Publicação persistente reconsultada. Se o Render tiver reiniciado, a retomada automática foi solicitada.',release:cloudReleaseView(release),githubVerification:release.githubVerification||{}})
  }
  const token=await githubToken()
  let verification=release.githubVerification||{}
  if(token&&release.commitSha&&release.repository){
    try{verification=await verifyGithubReleaseCommit({token,repository:release.repository,branch:release.branch,commitSha:release.commitSha,version:release.version});await UpdateRelease.updateOne({_id:release._id},{$set:{githubVerified:true,githubVerifiedAt:new Date(),githubVerification:verification}})}
    catch(e){verification={ok:false,error:e.message,checkedAt:new Date()};await UpdateRelease.updateOne({_id:release._id},{$set:{githubVerified:false,githubVerification:verification}})}
  }
  const current=await UpdateRelease.findById(release._id)
  const refreshed=await refreshCloudRelease(current,{force:true})
  res.json({message:'Estado da publicação reconciliado com GitHub, Vercel e Render.',release:refreshed,githubVerification:verification})
}catch(e){next(e)}})

router.post('/cloud-releases/:releaseId/retry-deploy',async(req,res,next)=>{try{
  if(!IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Retentativa cloud é usada somente em Render/Vercel.'})
  const release=await UpdateRelease.findOne({releaseId:req.params.releaseId})
  if(!release)return res.status(404).json({erro:'Release cloud não encontrada.'})
  if(!release.commitSha)return res.status(409).json({erro:'Esta release ainda não possui commit confirmado no GitHub. Publique o pacote novamente.'})
  const target=await resolveProductionGitTarget()
  if(!target.ok)return res.status(409).json({erro:target.message||'Destino de produção indisponível.',codigo:'UPDATE_TARGET_UNKNOWN',productionTarget:target})
  if(normalizeGithubRepository(release.repository).toLowerCase()!==target.repository.toLowerCase())return res.status(409).json({erro:`O commit está em ${release.repository}, mas a produção usa ${target.repository}. Publique novamente o pacote do R2 no destino correto.`,codigo:'UPDATE_TARGET_MISMATCH',productionTarget:target})
  const token=await githubToken()
  if(!token)return res.status(400).json({erro:'GitHub não conectado.'})
  const verification=await verifyGithubReleaseCommit({token,repository:release.repository,branch:release.branch,commitSha:release.commitSha,version:release.version})
  const renderKick=await maybeTriggerRenderCommit(release.commitSha)
  const now=new Date()
  const reset=await UpdateRelease.findOneAndUpdate({_id:release._id},{$set:{status:'deploying',error:'',productionReady:false,githubVerified:true,githubVerifiedAt:now,githubVerification:verification,productionTarget:target,trackingStartedAt:now,lastCheckedAt:null,trackingAttempts:0,stalledAt:null,interruptedAt:null,completedAt:null,recovery:{action:'retry-deploy',startedAt:now},...(renderKick?.deployId?{'render.id':renderKick.deployId,'render.status':'queued'}:{})}},{new:true})
  const refreshed=await refreshCloudRelease(reset,{force:true})
  res.json({message:renderKick?.triggered?'Render recebeu uma nova solicitação de deploy; Vercel e Render voltaram a ser acompanhados.':'Acompanhamento reiniciado. Vercel e Render serão reconsultados usando o commit já verificado.',release:refreshed,render:renderKick})
}catch(e){next(e)}})

router.post('/cloud-releases/:releaseId/interrupt',async(req,res,next)=>{try{
  if(!IS_MANAGED_PLATFORM)return res.status(409).json({erro:'Interrupção cloud é usada somente em Render/Vercel.'})
  const release=await UpdateRelease.findOne({releaseId:req.params.releaseId})
  if(!release)return res.status(404).json({erro:'Release cloud não encontrada.'})
  const now=new Date()
  const updated=await UpdateRelease.findOneAndUpdate({_id:release._id},{$set:{status:'interrupted',productionReady:false,interruptedAt:now,completedAt:now,error:String(req.body?.reason||'Acompanhamento encerrado manualmente. O ZIP continua preservado no R2.'),publishStatus:release.status==='publishing'?'cancelled':release.publishStatus,publishPhase:release.status==='publishing'?'cancelled':release.publishPhase,publishPhaseLabel:release.status==='publishing'?'Publicação encerrada pelo usuário':release.publishPhaseLabel,publishCompletedAt:release.status==='publishing'?now:release.publishCompletedAt,recovery:{action:'manual-interrupt',at:now,message:'O pacote permanece no R2 e pode ser publicado novamente sem novo upload.'}}},{new:true})
  res.json({message:'Acompanhamento encerrado. O pacote permanece no R2 e pode ser publicado novamente depois.',release:cloudReleaseView(updated)})
}catch(e){next(e)}})

router.get('/jobs/:jobId',async(req,res,next)=>{try{if(!/^job_[0-9]+_[a-f0-9]+$/.test(req.params.jobId))return res.status(400).json({erro:'Job inválido.'}); res.json({job:JSON.parse(await fs.readFile(path.join(JOB_DIR,`${req.params.jobId}.json`),'utf8'))})}catch(e){next(e)}})

// Recuperação autônoma: não depende de o navegador permanecer aberto.
// Em um novo processo Render, o MongoDB informa quais publicações ficaram no meio do caminho.
async function recoverManagedCloudOperations(){
  if(!IS_MANAGED_PLATFORM||mongoose.connection.readyState!==1)return
  try{
    const publishing=await UpdateRelease.find({status:'publishing',commitSha:''}).sort({updatedAt:1}).limit(5)
    for(const release of publishing)await ensureManagedPublishContinuity(release)
    const deploying=await UpdateRelease.find({status:'deploying',commitSha:{$ne:''}}).sort({lastCheckedAt:1,updatedAt:1}).limit(3)
    for(const release of deploying){
      const last=new Date(release.lastCheckedAt||0).getTime()
      if(!last||Date.now()-last>60_000)await refreshCloudRelease(release).catch(()=>{})
    }
  }catch{}
}
if(IS_MANAGED_PLATFORM&&!globalThis.__AL_UPDATE_CLOUD_RECOVERY_TIMER__){
  const first=setTimeout(()=>{void recoverManagedCloudOperations()},8_000);first.unref?.()
  const timer=setInterval(()=>{void recoverManagedCloudOperations()},30_000);timer.unref?.()
  globalThis.__AL_UPDATE_CLOUD_RECOVERY_TIMER__=timer
}

export default router
