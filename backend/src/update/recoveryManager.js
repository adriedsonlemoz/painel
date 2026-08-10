import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { JOB_DIR, listInterruptedJobs, releaseUpdateLock, touchUpdateLock } from '../services/systemUpdateService.js'

const updateDir=path.dirname(fileURLToPath(import.meta.url))
const watchdogSource=path.resolve(updateDir,'updateWatchdog.cjs')
const runtimeDir=path.join(path.dirname(JOB_DIR),'runtime')
const watchdogRuntime=path.join(runtimeDir,'updateWatchdog.cjs')
const ROOT_DIR=path.resolve(updateDir,'../../..')
const STATE_DIR=path.dirname(JOB_DIR)
let running=false

async function ensureExternalRecovery(){
  await fs.mkdir(runtimeDir,{recursive:true})
  try{await fs.access(watchdogRuntime)}catch{await fs.copyFile(watchdogSource,watchdogRuntime)}
  return watchdogRuntime
}

async function atomicWrite(file,value){
  const tmp=`${file}.${process.pid}.recover.tmp`
  await fs.writeFile(tmp,JSON.stringify(value,null,2))
  await fs.rename(tmp,file)
}

export async function recoverInterruptedUpdates(){
  if(running)return []
  running=true
  const actions=[]
  try{
    const jobs=await listInterruptedJobs()
    for(const job of jobs){
      // Worker vivo atualiza o lock a cada 5 s. Só intervir em jobs realmente abandonados.
      if(job.staleMs<30000)continue
      const file=path.join(JOB_DIR,`${job.id}.json`)
      if(!job.snapshotId){
        const failed={...job,status:'failed',error:'Operação interrompida antes da criação do snapshot. Nenhum arquivo precisou ser restaurado.',recoveryDetectedAt:new Date().toISOString(),completedAt:new Date().toISOString()}
        await atomicWrite(file,failed)
        await releaseUpdateLock(job.id)
        actions.push({jobId:job.id,action:'marked-failed-before-snapshot'})
        continue
      }
      await touchUpdateLock(job.id,'recovery-starting')
      await atomicWrite(file,{...job,status:'recovery-starting',recoveryDetectedAt:new Date().toISOString(),heartbeatAt:new Date().toISOString()})
      const recoveryScript=await ensureExternalRecovery()
      const child=spawn(process.execPath,[recoveryScript,file,ROOT_DIR,STATE_DIR,'0','--recover-now'],{detached:true,stdio:'ignore'})
      child.unref()
      actions.push({jobId:job.id,action:'external-watchdog-recovery-started'})
    }
    return actions
  }finally{running=false}
}
