import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { ROOT_DIR, STATE_DIR } from './systemUpdateService.js'
import { registrarErro } from './errorLogService.js'

const IS_TERMUX = Boolean(process.env.TERMUX_VERSION || String(process.env.PREFIX || '').includes('com.termux'))
const MAX_FILES = 16
const MAX_BYTES = 80 * 1024
const ERROR_RE = /(npm\s+err|\berror\b|\bfail(?:ed|ure)?\b|exception|eaddrinuse|module_not_found|cannot find|uncaught|unhandled|sigkill|sigterm|killed|enomem|heap out of memory|permission denied)/i

async function exists(p){ try { await fs.access(p); return true } catch { return false } }
function redact(value=''){
  return String(value)
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi,'mongodb://***')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi,'$1***')
    .replace(/((?:api[_-]?key|token|secret|password|senha)\s*[:=]\s*)[^\s,"']+/gi,'$1***')
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g,'sk-or-v1-***')
}
async function tailFile(file, maxBytes=MAX_BYTES){
  try{
    const st=await fs.stat(file)
    const start=Math.max(0,st.size-maxBytes)
    const fh=await fs.open(file,'r')
    const buf=Buffer.alloc(Math.min(maxBytes,st.size))
    await fh.read(buf,0,buf.length,start)
    await fh.close()
    return redact(buf.toString('utf8'))
  }catch{return ''}
}
async function collectLogFiles(dir){
  if(!(await exists(dir))) return []
  const out=[]
  const walk=async(current,depth=0)=>{
    if(depth>2||out.length>=MAX_FILES)return
    for(const ent of await fs.readdir(current,{withFileTypes:true}).catch(()=>[])){
      if(out.length>=MAX_FILES)break
      const full=path.join(current,ent.name)
      if(ent.isDirectory()) await walk(full,depth+1)
      else if(/\.(?:log|txt|out|err)$/i.test(ent.name) || /log|error|backend|frontend|npm/i.test(ent.name)) out.push(full)
    }
  }
  await walk(dir)
  return out
}
function processAlive(pid){
  try{ if(!pid||pid<=1)return false; process.kill(pid,0); return true }catch{return false}
}
async function collectPids(dir){
  if(!(await exists(dir)))return []
  const items=[]
  for(const ent of (await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])).slice(0,40)){
    if(!ent.isFile())continue
    const file=path.join(dir,ent.name)
    const raw=(await fs.readFile(file,'utf8').catch(()=>'' )).slice(0,1200)
    const nums=[...raw.matchAll(/\b([1-9]\d{1,7})\b/g)].map(m=>Number(m[1]))
    const pid=nums.find(processAlive) || nums[0] || null
    items.push({arquivo:ent.name,pid,ativo:pid?processAlive(pid):false})
  }
  return items
}
async function localHealth(){
  const url=`http://127.0.0.1:${process.env.PORT||3001}/api/health/live`
  try{ const r=await fetch(url,{signal:AbortSignal.timeout(1800)}); return {ok:r.ok,status:r.status,url} }catch(e){ return {ok:false,status:null,url,erro:e.message} }
}
async function commandVersion(cmd,args=['--version']){
  return await new Promise(resolve=>{
    try{
      const child=spawn(cmd,args,{stdio:['ignore','pipe','ignore']})
      let out=''; const timer=setTimeout(()=>{try{child.kill('SIGKILL')}catch{};resolve(null)},1800)
      child.stdout.on('data',d=>{out+=d})
      child.on('error',()=>{clearTimeout(timer);resolve(null)})
      child.on('exit',()=>{clearTimeout(timer);resolve(out.trim().split('\n')[0]||null)})
    }catch{resolve(null)}
  })
}

export async function diagnosticarTermux({registrar=false}={}){
  const home=os.homedir()
  const managerDir=path.join(home,'scripts','manager')
  const sources=[
    {tipo:'projeto',dir:path.join(ROOT_DIR,'.logs')},
    {tipo:'manager-projeto',dir:path.join(home,'Painel','.logs')},
    {tipo:'manager',dir:path.join(managerDir,'logs')},
    {tipo:'atualizador',dir:STATE_DIR},
  ]
  const [health,node,npm,pids] = await Promise.all([
    localHealth(), commandVersion(process.execPath), commandVersion('npm'), collectPids(path.join(home,'Painel','.pids')),
  ])
  const achados=[]
  const arquivos=[]
  for(const src of sources){
    for(const file of await collectLogFiles(src.dir)){
      if(arquivos.some(x=>x.arquivo===file))continue
      const text=await tailFile(file)
      const lines=text.split(/\r?\n/).filter(Boolean)
      const errors=lines.filter(l=>ERROR_RE.test(l)).slice(-12)
      arquivos.push({origem:src.tipo,arquivo:file.replace(home,'~'),linhas:lines.length,erros:errors.length})
      for(const line of errors.slice(-6)) achados.push({origem:src.tipo,arquivo:file.replace(home,'~'),mensagem:line.slice(0,1200)})
    }
  }
  const joined=achados.map(a=>a.mensagem).join('\n')
  const hipoteses=[]
  if(/npm\s+err|npm install.*falhou|E404/i.test(joined)) hipoteses.push({codigo:'NPM_INSTALL',titulo:'Falha na instalação de dependências',acao:'Confira o detalhe do npm e evite reinstalar dependências quando package.json não mudou.'})
  if(/EADDRINUSE|address already in use/i.test(joined)) hipoteses.push({codigo:'PORTA_OCUPADA',titulo:'Porta já está em uso',acao:'Verifique PIDs antigos do Manager antes de iniciar outro backend.'})
  if(/MODULE_NOT_FOUND|Cannot find module/i.test(joined)) hipoteses.push({codigo:'MODULO_AUSENTE',titulo:'Módulo ausente ou node_modules incompleto',acao:'Repare somente as dependências afetadas antes de reiniciar.'})
  if(/ENOMEM|heap out of memory|killed/i.test(joined)) hipoteses.push({codigo:'MEMORIA',titulo:'Processo pode ter sido encerrado por memória',acao:'Reduza tarefas simultâneas e evite build pesado durante atualização no Termux.'})
  if(!health.ok) hipoteses.push({codigo:'BACKEND_OFFLINE',titulo:'Backend não respondeu',acao:'O atualizador deve tentar a recuperação local; consulte o log al-update-backend-recovery.log se falhar.'})

  const manager={
    instalado:await exists(path.join(managerDir,'manager.sh')),
    diretorio:managerDir.replace(home,'~'),
    logs:await exists(path.join(managerDir,'logs')),
    pidsDir:await exists(path.join(home,'Painel','.pids')),
  }
  const report={
    termux:IS_TERMUX,
    timestamp:new Date().toISOString(),
    runtime:{node:node||process.version,npm,platform:process.platform,arch:process.arch,pid:process.pid,ppid:process.ppid,memoriaLivreMB:Math.round(os.freemem()/1024/1024)},
    backend:health,
    manager,
    pids,
    fontes:arquivos,
    achados:achados.slice(-30),
    hipoteses,
    resumo:{arquivosAnalisados:arquivos.length,linhasSuspeitas:achados.length,pidsAtivos:pids.filter(p=>p.ativo).length},
  }
  if(registrar && achados.length){
    for(const item of achados.slice(-10)){
      await registrarErro({
        tipo:'termux',mensagem:item.mensagem,rota:'/admin/erros',
        dados:{source:'termux-diagnostics',origem:item.origem,arquivo:item.arquivo},dedupWindowMs:10*60*1000,
      }).catch(()=>{})
    }
  }
  return report
}
