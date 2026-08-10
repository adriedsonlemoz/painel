import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname=path.dirname(fileURLToPath(import.meta.url))
const watchdog=path.join(__dirname,'updateWatchdog.cjs')
const recoveryCli=path.join(__dirname,'updateRecoveryCli.cjs')

const exists=async f=>{try{await fs.access(f);return true}catch{return false}}
async function runNode(args){
  await new Promise((resolve,reject)=>{
    const c=spawn(process.execPath,args,{stdio:'ignore'})
    c.once('error',reject)
    c.once('exit',code=>code===0?resolve():reject(new Error(`processo de teste encerrou com ${code}`)))
  })
}

export async function runUpdateSelfTest(){
  const started=Date.now()
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'alsistemas-updater-selftest-'))
  const root=path.join(base,'root'),state=path.join(base,'state')
  const snapshotId='snapshot_test'
  const jobId='job_100_test'
  const checks=[]
  try{
    await fs.mkdir(path.join(root,'backend/src/thing'),{recursive:true})
    await fs.mkdir(path.join(state,'snapshots',snapshotId,'files','backend/src/other'),{recursive:true})
    await fs.mkdir(path.join(state,'jobs'),{recursive:true})
    await fs.writeFile(path.join(root,'backend/src/server.js'),'NEW\n')
    await fs.writeFile(path.join(root,'backend/src/new.js'),'REMOVE\n')
    await fs.writeFile(path.join(root,'backend/.env'),'PRESERVE=1\n')
    await fs.writeFile(path.join(root,'backend/src/thing/a.js'),'old-child\n')
    await fs.writeFile(path.join(root,'backend/src/other'),'old-file\n')
    await fs.writeFile(path.join(state,'snapshots',snapshotId,'files','backend/src/server.js'),'OLD\n')
    await fs.writeFile(path.join(state,'snapshots',snapshotId,'files','backend/src/thing'),'snapshot-file\n')
    await fs.writeFile(path.join(state,'snapshots',snapshotId,'files','backend/src/other/b.js'),'snapshot-child\n')
    const job={id:jobId,type:'update',fromVersion:'1.0.0',toVersion:'1.0.1',status:'running',snapshotId,restart:{strategy:'none'}}
    await fs.writeFile(path.join(state,'jobs',`${jobId}.json`),JSON.stringify(job,null,2))
    await fs.writeFile(path.join(state,'update.lock.json'),JSON.stringify({jobId,status:'running'},null,2))
    await fs.mkdir(path.join(state,'runtime'),{recursive:true})
    await fs.copyFile(watchdog,path.join(state,'runtime','updateWatchdog.cjs'))
    await fs.copyFile(recoveryCli,path.join(state,'runtime','recoverPending.cjs'))
    await fs.writeFile(path.join(state,'pending-recovery.json'),JSON.stringify({
      jobId,jobFile:path.join(state,'jobs',`${jobId}.json`),rootDir:root,stateDir:state,snapshotId
    },null,2))

    await runNode([path.join(state,'runtime','recoverPending.cjs'),state])

    const final=JSON.parse(await fs.readFile(path.join(state,'jobs',`${jobId}.json`),'utf8'))
    const server=(await fs.readFile(path.join(root,'backend/src/server.js'),'utf8')).trim()
    const env=(await fs.readFile(path.join(root,'backend/.env'),'utf8')).trim()
    checks.push({name:'snapshot_restored',ok:server==='OLD'})
    checks.push({name:'new_file_removed',ok:!(await exists(path.join(root,'backend/src/new.js')))})
    checks.push({name:'persistent_env_preserved',ok:env==='PRESERVE=1'})
    checks.push({name:'directory_to_file_swap',ok:(await fs.stat(path.join(root,'backend/src/thing'))).isFile()})
    checks.push({name:'file_to_directory_swap',ok:(await fs.stat(path.join(root,'backend/src/other'))).isDirectory()})
    checks.push({name:'job_marked_recovered',ok:final.status==='rolled-back'&&final.recovered===true})
    checks.push({name:'lock_released',ok:!(await exists(path.join(state,'update.lock.json')))})
    checks.push({name:'pending_recovery_cleared',ok:!(await exists(path.join(state,'pending-recovery.json')))})
    const ok=checks.every(c=>c.ok)
    return {ok,durationMs:Date.now()-started,checks}
  }finally{
    await fs.rm(base,{recursive:true,force:true}).catch(()=>{})
  }
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const result=await runUpdateSelfTest()
  console.log(JSON.stringify(result,null,2))
  process.exit(result.ok?0:1)
}
