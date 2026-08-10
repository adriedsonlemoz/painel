'use strict'
const fs=require('fs/promises')
const path=require('path')
const os=require('os')
const {spawn}=require('child_process')

const stateDir=path.resolve(process.argv[2]||path.join(os.homedir(),'.al-sistemas','updates'))
const pendingFile=path.join(stateDir,'pending-recovery.json')

async function main(){
 let pending
 try{pending=JSON.parse(await fs.readFile(pendingFile,'utf8'))}
 catch{return {ok:true,nothingPending:true}}
 const watchdog=path.join(stateDir,'runtime','updateWatchdog.cjs')
 await fs.access(watchdog)
 await new Promise((resolve,reject)=>{
  const c=spawn(process.execPath,[watchdog,pending.jobFile,pending.rootDir,stateDir,'0','--recover-now'],{stdio:'inherit'})
  c.once('error',reject)
  c.once('exit',code=>code===0?resolve():reject(new Error(`recuperação encerrou com ${code}`)))
 })
 return {ok:true,recoveredJob:pending.jobId}
}
main().then(r=>{console.log(JSON.stringify(r,null,2));process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})
