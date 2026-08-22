import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const TEXT_EXT = new Set(['.js','.jsx','.mjs','.cjs','.ts','.tsx','.json','.md','.txt','.yml','.yaml','.toml','.env','.sh','.css','.html','.xml','.properties','.conf'])
const SKIP_DIRS = new Set(['node_modules','.git','dist','build','coverage','.cache'])

const PATTERNS = [
  { id:'private_key', severity:'critica', re:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { id:'github_token', severity:'critica', re:/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { id:'aws_access_key', severity:'alta', re:/\bAKIA[0-9A-Z]{16}\b/g },
  { id:'mongodb_credential_uri', severity:'critica', re:/mongodb(?:\+srv)?:\/\/[^\s:@/]+:[^\s@/]+@[^\s"'`]+/gi },
  { id:'jwt_secret_assignment', severity:'alta', re:/\bJWT_SECRET\s*=\s*["']?([A-Za-z0-9_+\/=.-]{20,})["']?/g },
  { id:'generic_secret_assignment', severity:'alta', re:/\b(?:API[_-]?KEY|SECRET[_-]?KEY|ACCESS[_-]?TOKEN|BOT[_-]?TOKEN|PASSWORD|SENHA)\s*[=:]\s*["']?([A-Za-z0-9_+\/=.-]{24,})["']?/gi },
]

function isPlaceholder(value='', context='') {
  const text=String(value||'')
  const around=String(context||'')
  if (/example|exemplo|changeme|your[_-]|seu[_-]|placeholder|xxxxxxxx|process\.env|\$\{|<[^>]+>|gere[-_ ]|mínimo|minimo|\.\.\./i.test(text)) return true
  if (/mongodb(?:\+srv)?:\/\/(?:usuario|user|username|admin):(?:senha|password|pass|senha[^@]*)@(?:cluster|host|localhost|exemplo|example)/i.test(text)) return true
  if (/^(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*(?:\(.*\))?$/.test(text)) return true
  if (/\b(?:placeholder|expected|exemplo|example)\s*[:=]/i.test(around)) return true
  return false
}
function redact(value='') {
  const s=String(value)
  if (s.length <= 10) return '[REDACTED]'
  return `${s.slice(0,4)}…${s.slice(-4)}`
}
async function walk(root, base=root, out=[]) {
  const entries=await fs.readdir(root,{withFileTypes:true}).catch(()=>[])
  for(const e of entries){
    if(SKIP_DIRS.has(e.name)) continue
    const full=path.join(root,e.name)
    if(e.isDirectory()) await walk(full,base,out)
    else if(e.isFile()) out.push({full,rel:path.relative(base,full).replace(/\\/g,'/')})
  }
  return out
}

export async function scanSecrets(root,{maxFiles=8000,maxBytes=2*1024*1024}={}){
  const files=(await walk(root)).slice(0,maxFiles)
  const findings=[]
  let scanned=0
  for(const file of files){
    const ext=path.extname(file.rel).toLowerCase()
    const base=path.basename(file.rel).toLowerCase()
    if(!TEXT_EXT.has(ext) && !base.startsWith('.env')) continue
    if(file.rel.endsWith('securityScanner.js')) continue
    const st=await fs.stat(file.full).catch(()=>null)
    if(!st||st.size>maxBytes) continue
    const text=await fs.readFile(file.full,'utf8').catch(()=>null)
    if(text==null) continue
    scanned+=1
    for(const pattern of PATTERNS){
      pattern.re.lastIndex=0
      let m
      while((m=pattern.re.exec(text))){
        const value=m[1]||m[0]
        const context=text.slice(Math.max(0,m.index-100),Math.min(text.length,m.index+m[0].length+100))
        if(isPlaceholder(value,context)) continue
        const before=text.slice(0,m.index)
        const line=before.split('\n').length
        findings.push({file:file.rel,line,rule:pattern.id,severity:pattern.severity,preview:redact(value)})
        if(findings.length>=100) break
      }
      if(findings.length>=100) break
    }
    if(findings.length>=100) break
  }
  return {scannedFiles:scanned,findings,critical:findings.filter(x=>x.severity==='critica').length,high:findings.filter(x=>x.severity==='alta').length,blocked:findings.some(x=>x.severity==='critica')}
}

async function manifestInfo(dir){
  try{
    const pkg=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'))
    return {name:pkg.name||path.basename(dir),dependencies:Object.keys(pkg.dependencies||{}).length,devDependencies:Object.keys(pkg.devDependencies||{}).length,version:pkg.version||null}
  }catch{return null}
}

async function auditOne(dir){
  const lock=await fs.stat(path.join(dir,'package-lock.json')).then(()=>true).catch(()=>false)
  const manifest=await manifestInfo(dir)
  if(!manifest) return {available:false,reason:'package_json_ausente'}
  if(!lock) return {available:false,reason:'lockfile_ausente',manifest}
  try{
    const {stdout}=await execFileAsync('npm',['audit','--json','--omit=dev'],{cwd:dir,timeout:45000,maxBuffer:8*1024*1024,env:{...process.env,npm_config_update_notifier:'false'}})
    const data=JSON.parse(stdout||'{}')
    return {available:true,manifest,metadata:data.metadata||{},vulnerabilities:data.vulnerabilities||{}}
  }catch(error){
    try{
      const data=JSON.parse(error.stdout||'{}')
      return {available:true,manifest,metadata:data.metadata||{},vulnerabilities:data.vulnerabilities||{},nonZero:true}
    }catch{return {available:false,reason:'audit_falhou',manifest,error:String(error.message||error).slice(0,300)}}
  }
}

export async function auditDependencies(projectRoot){
  const [backend,frontend]=await Promise.all([auditOne(path.join(projectRoot,'backend')),auditOne(path.join(projectRoot,'frontend'))])
  const counts={critical:0,high:0,moderate:0,low:0,total:0}
  for(const part of [backend,frontend]){
    const v=part?.metadata?.vulnerabilities||{}
    for(const key of ['critical','high','moderate','low']) counts[key]+=Number(v[key]||0)
    counts.total+=Number(v.total||0)
  }
  return {backend,frontend,counts,checkedAt:new Date().toISOString()}
}
