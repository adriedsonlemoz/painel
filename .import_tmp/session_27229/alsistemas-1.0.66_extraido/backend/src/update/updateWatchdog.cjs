'use strict'
const fs=require('fs')
const fsp=require('fs/promises')
const path=require('path')
const {spawn}=require('child_process')

const [,,jobFile,rootDir,stateDir,workerPidArg,modeArg]=process.argv
if(!jobFile||!rootDir||!stateDir)process.exit(2)
const workerPid=Number(workerPidArg||0)
const recoverNow=modeArg==='--recover-now'
const lockFile=path.join(stateDir,'update.lock.json')
const maintenanceFile=path.join(stateDir,'maintenance.json')
const snapshotsDir=path.join(stateDir,'snapshots')
const historyFile=path.join(stateDir,'history.json')
const pendingFile=path.join(stateDir,'pending-recovery.json')
const terminal=new Set(['completed','restart-required','rolled-back','failed','recovered'])
const preserve=[
 '.env','backend/.env','backend/.al-sistemas','backend/uploads','uploads',
 'backend/backups','backups','backend/logs','logs','frontend/.env',
 'frontend/.env.local','frontend/.env.production.local'
]

const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function readJson(f){return JSON.parse(await fsp.readFile(f,'utf8'))}
async function atomicJson(f,v){
 await fsp.mkdir(path.dirname(f),{recursive:true})
 const tmp=`${f}.${process.pid}.watchdog.tmp`
 await fsp.writeFile(tmp,JSON.stringify(v,null,2))
 await fsp.rename(tmp,f)
}
function preserved(rel){
 rel=rel.replace(/\\/g,'/').replace(/^\.\//,'')
 return preserve.some(p=>rel===p||rel.startsWith(`${p}/`))||rel==='.git'||rel.startsWith('.git/')||rel==='node_modules'||rel.includes('/node_modules/')
}
function preserveAncestor(rel){
 rel=rel.replace(/\\/g,'/').replace(/^\.\//,'')
 return preserve.some(p=>p.startsWith(`${rel}/`))||'.git'.startsWith(`${rel}/`)
}
async function files(base){
 const map=new Map(),dirs=[]
 async function walk(dir,rel=''){
  for(const ent of await fsp.readdir(dir,{withFileTypes:true}).catch(()=>[])){
   const r=rel?`${rel}/${ent.name}`:ent.name
   if(preserved(r))continue
   const full=path.join(dir,ent.name)
   if(ent.isDirectory()){dirs.push(r);await walk(full,r)}
   else if(ent.isFile())map.set(r,full)
  }
 }
 await walk(base);return {map,dirs}
}
async function ensureDirectory(dir){
 if(path.resolve(dir)===path.resolve(rootDir))return
 try{const st=await fsp.lstat(dir);if(st.isDirectory())return;await fsp.rm(dir,{recursive:true,force:true})}catch{}
 await ensureDirectory(path.dirname(dir))
 await fsp.mkdir(dir,{recursive:true})
}
async function copyAtomic(src,dst){
 await ensureDirectory(path.dirname(dst))
 const tmp=path.join(path.dirname(dst),`.al-watchdog-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`)
 await fsp.copyFile(src,tmp)
 try{const st=await fsp.stat(src);await fsp.chmod(tmp,st.mode)}catch{}
 try{await fsp.rename(tmp,dst)}catch{await fsp.rm(dst,{recursive:true,force:true}).catch(()=>{});await fsp.rename(tmp,dst)}
}
async function restore(snapshotDir){
 const source=await files(snapshotDir),current=await files(rootDir)
 const sourceKeys=[...source.map.keys()],sourceSet=new Set(sourceKeys)
 const hasDesc=rel=>sourceKeys.some(p=>p.startsWith(`${rel}/`))
 const hasAncestor=rel=>{const parts=rel.split('/');for(let i=parts.length-1;i>0;i--)if(sourceSet.has(parts.slice(0,i).join('/')))return true;return false}
 for(const [rel,dst] of current.map)if(!sourceSet.has(rel)&&hasDesc(rel))await fsp.rm(dst,{recursive:true,force:true})
 for(const [rel,src] of source.map)await copyAtomic(src,path.join(rootDir,rel))
 for(const [rel,dst] of current.map)if(!sourceSet.has(rel)&&!hasDesc(rel)&&!hasAncestor(rel))await fsp.rm(dst,{recursive:true,force:true})
 for(const rel of current.dirs.sort((a,b)=>b.length-a.length)){
  if(preserveAncestor(rel))continue
  await fsp.rmdir(path.join(rootDir,rel)).catch(()=>{})
 }
}
async function command(cmd,args,cwd){
 await new Promise((resolve,reject)=>{
  const c=spawn(cmd,args,{cwd,stdio:'ignore'})
  c.once('error',reject);c.once('exit',code=>code===0?resolve():reject(new Error(`${cmd} falhou (${code})`)))
 })
}
async function restart(cfg){
 if(!cfg||cfg.strategy==='none')return false
 if(cfg.strategy==='pm2')await command('pm2',['restart',cfg.pm2Name,'--update-env'],rootDir)
 else if(cfg.strategy==='systemd')await command('systemctl',['restart',cfg.systemdService],rootDir)
 return true
}
async function touchLock(jobId,status='watchdog-recovery'){
 try{const l=await readJson(lockFile);if(l.jobId===jobId)await atomicJson(lockFile,{...l,status,heartbeatAt:new Date().toISOString()})}catch{}
}
async function restoreDependencies(areas=[]){
 for(const area of [...new Set(areas)]){
  if(!['backend','frontend'].includes(area))continue
  const cwd=path.join(rootDir,area)
  try{
   await fsp.access(path.join(cwd,'package.json'))
   let hasLock=true;try{await fsp.access(path.join(cwd,'package-lock.json'))}catch{hasLock=false}
   await command('npm',[hasLock?'ci':'install','--prefer-offline','--omit=optional','--no-audit','--no-fund'],cwd)
  }catch(e){throw new Error(`${area}: ${e.message}`)}
 }
}
async function release(jobId){
 try{const l=await readJson(lockFile);if(l.jobId===jobId)await fsp.rm(lockFile,{force:true})}catch{}
 await fsp.rm(maintenanceFile,{force:true}).catch(()=>{})
 await fsp.rm(pendingFile,{force:true}).catch(()=>{})
}
async function history(entry){
 let h=[];try{h=await readJson(historyFile)}catch{}
 h.unshift(entry);await atomicJson(historyFile,h.slice(0,100))
}
async function pidAlive(pid){
 if(!pid)return false
 try{process.kill(pid,0);return true}catch{return false}
}
async function killExternal(job){
 const pid=Number(job.externalProcess?.pid||0)
 if(!pid)return
 try{process.kill(pid,'SIGTERM')}catch{}
 await sleep(1200)
 try{process.kill(pid,'SIGKILL')}catch{}
}
async function recover(reason){
 let job
 try{job=await readJson(jobFile)}catch{return process.exit(1)}
 if(terminal.has(job.status))return process.exit(0)
 if(!job.snapshotId){
  job={...job,status:'failed',error:`Watchdog: ${reason}. Snapshot ainda não existia.`,completedAt:new Date().toISOString()}
  await atomicJson(jobFile,job);await release(job.id);return process.exit(1)
 }
 await killExternal(job)
 const snapDir=path.join(snapshotsDir,job.snapshotId,'files')
 let hb=null
 try{
  job={...job,status:'recovering',phase:'watchdog-recovery',phaseLabel:'Watchdog restaurando snapshot',watchdogReason:reason,heartbeatAt:new Date().toISOString()}
  await atomicJson(jobFile,job);await touchLock(job.id)
  hb=setInterval(()=>void touchLock(job.id),5000);hb.unref?.()
  await restore(snapDir)
  let dependencyRollbackError=null
  try{
   let snapMeta={}
   try{snapMeta=await readJson(path.join(snapshotsDir,job.snapshotId,'snapshot.json'))}catch{}
   if(snapMeta.dependencyAreas?.length)await restoreDependencies(snapMeta.dependencyAreas)
  }catch(e){dependencyRollbackError=e.message}
  let restarted=false,restartError=null
  try{restarted=await restart(job.restart)}catch(e){restartError=e.message}
  job={...job,status:'rolled-back',recovered:true,recoveredBy:'external-watchdog',rollbackHealthy:!(restartError||dependencyRollbackError),error:job.error||`Operação interrompida: ${reason}`,restartError,dependencyRollbackError,completedAt:new Date().toISOString(),finalReport:{
   generatedAt:new Date().toISOString(),operation:job.type,status:'rolled-back',fromVersion:job.fromVersion,toVersion:job.toVersion,
   recovered:true,recoveredBy:'external-watchdog',reason,restartStrategy:job.restart?.strategy||'none',restartAttempted:restarted,restartError,dependencyRollbackError
  }}
  await atomicJson(jobFile,job)
  if(hb)clearInterval(hb)
  await history({id:job.id,type:'recovery',status:'rolled-back',fromVersion:job.toVersion,toVersion:job.fromVersion,createdAt:new Date().toISOString(),snapshotId:job.snapshotId,recoveredBy:'external-watchdog',reason})
  await release(job.id)
  process.exit(restartError||dependencyRollbackError?1:0)
 }catch(e){
  if(hb)clearInterval(hb)
  job={...job,status:'failed',error:`Watchdog falhou ao restaurar snapshot: ${e.message}`,completedAt:new Date().toISOString()}
  await atomicJson(jobFile,job).catch(()=>{});await release(job.id);process.exit(1)
 }
}

;(async()=>{
 if(recoverNow)return recover('recuperação solicitada no boot')
 while(true){
  let job
  try{job=await readJson(jobFile)}catch{return process.exit(0)}
  if(terminal.has(job.status))return process.exit(0)
  if(await pidAlive(workerPid)){await sleep(2000);continue}
  // Pequena tolerância evita corrida durante encerramento normal.
  await sleep(6000)
  try{job=await readJson(jobFile)}catch{return process.exit(0)}
  if(terminal.has(job.status))return process.exit(0)
  return recover('worker de atualização encerrou inesperadamente')
 }
})().catch(()=>process.exit(1))
