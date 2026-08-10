import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import { fileURLToPath } from 'url'
import unzipper from 'unzipper'
import mongoose from 'mongoose'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT_DIR = path.resolve(__dirname, '../../..')
export const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION)
// Em Vercel o filesystem da Function é somente leitura; /tmp é scratch temporário.
// Nunca tratamos este diretório como armazenamento persistente entre requisições.
export const STATE_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'al-sistemas-updates')
  : path.resolve(process.env.AL_UPDATE_STATE_DIR || path.join(os.homedir(), '.al-sistemas', 'updates'))
export const STAGING_DIR = path.join(STATE_DIR, 'staging')
export const SNAPSHOT_DIR = path.join(STATE_DIR, 'snapshots')
export const JOB_DIR = path.join(STATE_DIR, 'jobs')
export const HISTORY_FILE = path.join(STATE_DIR, 'history.json')
export const LOCK_FILE = path.join(STATE_DIR, 'update.lock.json')
export const TRANSACTION_DIR = path.join(STATE_DIR, 'transactions')

export const PRESERVE_PATHS = [
  '.env',
  'backend/.env',
  'backend/.al-sistemas',
  'backend/uploads',
  'uploads',
  'backend/backups',
  'backups',
  'backend/logs',
  'logs',
  'frontend/.env',
  'frontend/.env.local',
  'frontend/.env.production.local',
]

let updateDirsReady=false
export async function ensureUpdateDirs() {
  if(updateDirsReady) return
  // Migra o estado antigo que ficava dentro do projeto para ~/.al-sistemas.
  // Isso preserva staging, snapshots e histórico ao instalar a primeira versão
  // que usa o atualizador desacoplado.
  if(!IS_VERCEL){
    const legacy=path.join(ROOT_DIR,'backend','.al-sistemas','updates')
    try{
      await fs.access(legacy)
      let stateExists=false
      try{ stateExists=(await fs.readdir(STATE_DIR)).length>0 }catch{}
      if(!stateExists && path.resolve(legacy)!==path.resolve(STATE_DIR)){
        await fs.mkdir(path.dirname(STATE_DIR),{recursive:true})
        await fs.cp(legacy,STATE_DIR,{recursive:true,force:false})
      }
    }catch{}
  }
  await Promise.all([STATE_DIR, STAGING_DIR, SNAPSHOT_DIR, JOB_DIR, TRANSACTION_DIR].map(d => fs.mkdir(d, { recursive: true })))
  try { await fs.access(HISTORY_FILE) } catch { await fs.writeFile(HISTORY_FILE, '[]\n') }

  // Mantém a recuperação de emergência fora da árvore que será substituída.
  // Em uma instalação limpa esses arquivos já ficam disponíveis antes da
  // primeira atualização, em vez de só aparecerem depois que um job inicia.
  if(!IS_VERCEL){
    const runtimeDir=path.join(STATE_DIR,'runtime')
    await fs.mkdir(runtimeDir,{recursive:true})
    const updateDir=path.resolve(__dirname,'../update')
    const runtimeFiles=[
      ['updateWatchdog.cjs','updateWatchdog.cjs'],
      ['updateRecoveryCli.cjs','recoverPending.cjs'],
    ]
    for(const [sourceName,targetName] of runtimeFiles){
      const source=path.join(updateDir,sourceName),target=path.join(runtimeDir,targetName)
      try{
        const [srcHash,dstHash]=await Promise.all([hashFile(source),hashFile(target)])
        if(!dstHash||srcHash!==dstHash) await fs.copyFile(source,target)
      }catch{}
    }
  }
  updateDirsReady=true
}

export function validVersion(v) { return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(v || '')) }
export function compareVersions(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number), pb = String(b).split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return String(a).localeCompare(String(b))
}

async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')) }
async function atomicJson(file,value){
  await fs.mkdir(path.dirname(file),{recursive:true})
  const tmp=`${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
  await fs.writeFile(tmp,JSON.stringify(value,null,2))
  await fs.rename(tmp,file)
}
export async function installedVersion() {
  const [back, front] = await Promise.all([json(path.join(ROOT_DIR, 'backend/package.json')), json(path.join(ROOT_DIR, 'frontend/package.json'))])
  return { version: back.version, backend: back.version, frontend: front.version, synchronized: back.version === front.version }
}

function safeEntry(name) {
  const normalized = name.replace(/\\/g, '/')
  return !normalized.startsWith('/') && !normalized.split('/').includes('..') && !normalized.includes('\0')
}

async function hashFile(file) {
  try {
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
  } catch { return null }
}

async function locatePackageRoot(dir) {
  const direct = await exists(path.join(dir, 'backend/package.json')) && await exists(path.join(dir, 'frontend/package.json'))
  if (direct) return dir
  const entries = (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory())
  for (const e of entries) {
    const candidate = path.join(dir, e.name)
    if (await exists(path.join(candidate, 'backend/package.json')) && await exists(path.join(candidate, 'frontend/package.json'))) return candidate
  }
  throw new Error('Pacote inválido: estrutura backend/frontend não encontrada.')
}

async function exists(file) { try { await fs.access(file); return true } catch { return false } }

async function fileFingerprint(file) {
  try {
    const data = await fs.readFile(file)
    return crypto.createHash('sha256').update(data).digest('hex')
  } catch { return null }
}

async function buildStageManifest(base){
  const files=[]
  async function walk(dir,rel=''){
    for(const ent of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
      const r=rel?`${rel}/${ent.name}`:ent.name
      if(r==='.update-meta.json'||r==='node_modules'||r.includes('/node_modules/')||r==='.git'||r.startsWith('.git/')) continue
      const full=path.join(dir,ent.name)
      if(ent.isDirectory()) await walk(full,r)
      else if(ent.isFile()){
        const st=await fs.stat(full)
        files.push({path:r.replace(/\\/g,'/'),size:st.size,sha256:await hashFile(full)})
      }
    }
  }
  await walk(base)
  files.sort((a,b)=>a.path.localeCompare(b.path))
  const digest=crypto.createHash('sha256')
  let totalBytes=0
  for(const f of files){digest.update(f.path).update('\0').update(f.sha256).update('\0');totalBytes+=f.size}
  return {treeSha256:digest.digest('hex'),fileCount:files.length,totalBytes}
}

export async function verifyStageIntegrity(stageId){
  const meta=await getStage(stageId)
  const current=await buildStageManifest(path.join(STAGING_DIR,stageId))
  const expected=meta.integrity
  if(!expected) throw new Error('Pacote preparado sem manifesto de integridade. Valide o ZIP novamente.')
  const ok=current.treeSha256===expected.treeSha256 && current.fileCount===expected.fileCount && current.totalBytes===expected.totalBytes
  if(!ok){
    const err=new Error('O staging foi alterado depois da validação. A instalação foi bloqueada; valide o ZIP novamente.')
    err.code='STAGE_INTEGRITY_MISMATCH'
    throw err
  }
  return {ok:true,...current}
}

async function pruneStagedStorage(keep=5){
  if(IS_VERCEL)return []
  const items=[]
  for(const name of await fs.readdir(STAGING_DIR).catch(()=>[])){
    try{
      const meta=await json(path.join(STAGING_DIR,name,'.update-meta.json'))
      items.push({name,createdAt:new Date(meta.createdAt||0).getTime()})
    }catch{}
  }
  items.sort((a,b)=>b.createdAt-a.createdAt)
  let activeStage=null
  try{
    const lock=await readUpdateLock()
    if(lock?.jobId){
      const active=await json(path.join(JOB_DIR,`${lock.jobId}.json`))
      activeStage=active.stageId||null
    }
  }catch{}
  const removed=[]
  for(const item of items.slice(Math.max(1,keep))){
    if(item.name===activeStage)continue
    await fs.rm(path.join(STAGING_DIR,item.name),{recursive:true,force:true})
    removed.push(item.name)
  }
  return removed
}


function parsePackageFilename(name=''){
  const full=String(name).match(/^alsistemas-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.zip$/i)
  if(full) return {type:'full',version:full[1],baseVersion:null}
  const delta=String(name).match(/^alsistemas-update-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-to-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.zip$/i)
  if(delta) return {type:'incremental',baseVersion:delta[1],version:delta[2]}
  return null
}

async function locateIncrementalRoot(dir){
  if(await exists(path.join(dir,'al-update.json'))) return dir
  const entries=(await fs.readdir(dir,{withFileTypes:true})).filter(e=>e.isDirectory())
  for(const e of entries){
    const candidate=path.join(dir,e.name)
    if(await exists(path.join(candidate,'al-update.json'))) return candidate
  }
  throw new Error('Pacote incremental inválido: al-update.json não encontrado.')
}

function validateRemovedPaths(items=[]){
  const out=[]
  for(const raw of Array.isArray(items)?items:[]){
    const rel=String(raw||'').replace(/\\/g,'/').replace(/^\.\//,'')
    if(!safeEntry(rel)||!rel||!replaceablePath(rel)) throw new Error(`Caminho removido inválido no pacote incremental: ${raw}`)
    out.push(rel)
  }
  return [...new Set(out)].sort()
}


async function verifyIncrementalManifestFiles(root,manifest){
  if(!Array.isArray(manifest.files)||!manifest.files.length) throw new Error('Manifesto incremental sem lista de arquivos.')
  const declared=new Map()
  for(const item of manifest.files){
    const rel=String(item?.path||'').replace(/\\/g,'/').replace(/^\.\//,'')
    if(!safeEntry(rel)||!replaceablePath(rel)) throw new Error(`Arquivo inválido no manifesto incremental: ${item?.path}`)
    if(!/^[a-f0-9]{64}$/i.test(String(item?.sha256||''))) throw new Error(`SHA-256 inválido no manifesto incremental: ${rel}`)
    if(declared.has(rel)) throw new Error(`Arquivo duplicado no manifesto incremental: ${rel}`)
    declared.set(rel,item)
  }
  const actual=await scanTree(root)
  const actualPaths=[...actual.keys()].sort()
  const declaredPaths=[...declared.keys()].sort()
  if(actualPaths.length!==declaredPaths.length||actualPaths.some((v,i)=>v!==declaredPaths[i])) throw new Error('O conteúdo do pacote incremental não corresponde à lista de arquivos do manifesto.')
  for(const rel of declaredPaths){
    const info=actual.get(rel),item=declared.get(rel)
    if(Number(item.size)!==Number(info.size)) throw new Error(`Tamanho divergente no incremental: ${rel}`)
    const digest=await hashFile(info.full)
    if(digest!==String(item.sha256).toLowerCase()) throw new Error(`Hash divergente no incremental: ${rel}`)
  }
  return {fileCount:declaredPaths.length}
}

export async function validateAndStage(zipPath, originalName, { persist = !IS_VERCEL } = {}) {
  await ensureUpdateDirs()
  const packageInfo=parsePackageFilename(originalName)
  if(!packageInfo) throw new Error('Nome inválido. Use alsistemas-X.Y.Z.zip ou alsistemas-update-X.Y.Z-to-A.B.C.zip.')
  if(!validVersion(packageInfo.version)||(packageInfo.baseVersion&&!validVersion(packageInfo.baseVersion))) throw new Error('Versão do arquivo inválida.')

  const directory = await unzipper.Open.file(zipPath)
  if (!directory.files.length) throw new Error('Pacote ZIP vazio.')
  if (directory.files.length > 12000) throw new Error('Pacote rejeitado: quantidade excessiva de entradas no ZIP.')
  let totalExpanded=0
  for (const entry of directory.files) {
    if (!safeEntry(entry.path)) throw new Error(`Entrada insegura no ZIP: ${entry.path}`)
    if (entry.type && !['File','Directory'].includes(entry.type)) throw new Error(`Tipo de entrada não permitido no ZIP: ${entry.path}`)
    const expanded=Number(entry.vars?.uncompressedSize ?? entry.uncompressedSize ?? 0)
    const compressed=Number(entry.vars?.compressedSize ?? entry.compressedSize ?? 0)
    if (expanded > 250*1024*1024) throw new Error(`Arquivo excessivamente grande no ZIP: ${entry.path}`)
    totalExpanded+=Math.max(0,expanded)
    if (totalExpanded > 1024*1024*1024) throw new Error('Pacote rejeitado: tamanho descompactado excede 1 GB.')
    if (expanded > 20*1024*1024 && compressed > 0 && expanded/compressed > 250) throw new Error(`Pacote rejeitado por taxa de compressão suspeita: ${entry.path}`)
  }

  const id = `stage_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'alsistemas-update-'))
  try {
    await directory.extract({ path: temp })
    const current=await installedVersion()

    if(packageInfo.type==='incremental'){
      const packageRoot=await locateIncrementalRoot(temp)
      const updateManifest=await json(path.join(packageRoot,'al-update.json'))
      if(updateManifest.product!=='AL Sistemas'||updateManifest.packageType!=='incremental') throw new Error('Manifesto incremental inválido.')
      if(updateManifest.baseVersion!==packageInfo.baseVersion||updateManifest.version!==packageInfo.version) throw new Error('Versões do nome do arquivo e do manifesto incremental não correspondem.')
      if(current.version!==updateManifest.baseVersion) throw new Error(`Este pacote incremental exige AL Sistemas ${updateManifest.baseVersion}. A versão instalada é ${current.version}. Use o pacote completo ou um incremental compatível.`)
      if(compareVersions(updateManifest.version,current.version)<=0) throw new Error(`A versão ${updateManifest.version} não é superior à instalada (${current.version}).`)
      const backendPkg=await json(path.join(packageRoot,'backend/package.json')).catch(()=>null)
      const frontendPkg=await json(path.join(packageRoot,'frontend/package.json')).catch(()=>null)
      if(!backendPkg||!frontendPkg||backendPkg.name!=='al-sistemas-backend'||frontendPkg.name!=='al-sistemas'||backendPkg.version!==updateManifest.version||frontendPkg.version!==updateManifest.version) throw new Error('O incremental precisa incluir package.json sincronizados do backend e frontend.')
      const removedFiles=validateRemovedPaths(updateManifest.removed||[])
      await verifyIncrementalManifestFiles(packageRoot,updateManifest)
      const target=persist?path.join(STAGING_DIR,id):packageRoot
      if(persist) await fs.cp(packageRoot,target,{recursive:true,force:true})
      const deps=await dependencyPlan(target,{checkInstalled:persist})
      const integrity=await buildStageManifest(target)
      const changelog=String(updateManifest.changelog||'Atualização incremental do AL Sistemas.')
      const currentViteConfig=await fileFingerprint(path.join(ROOT_DIR,'frontend/vite.config.js'))
      const nextViteConfig=await fileFingerprint(path.join(target,'frontend/vite.config.js'))
      const meta={
        id,version:updateManifest.version,baseVersion:updateManifest.baseVersion,packageType:'incremental',filename:originalName,createdAt:new Date().toISOString(),
        changelog,dependencies:deps,...(await detectMigrations(target)),removedFiles,
        frontendCacheResetRequired:Boolean(deps.frontend?.installRequired||(nextViteConfig&&currentViteConfig!==nextViteConfig)),
        sha256:await hashFile(zipPath),integrity,status:'ready',ephemeral:!persist,
      }
      if(persist){
        await atomicJson(path.join(target,'.update-meta.json'),meta)
        await pruneStagedStorage(Math.max(2,Math.min(20,Number(process.env.AL_UPDATE_STAGE_KEEP||5))))
      }
      if(!persist){
        const ephemeralDir=await fs.mkdtemp(path.join(os.tmpdir(),'alsistemas-publish-'))
        await fs.cp(packageRoot,ephemeralDir,{recursive:true,force:true})
        return {...meta,_packageRoot:ephemeralDir}
      }
      return meta
    }

    const packageRoot = await locatePackageRoot(temp)
    const backendPkg = await json(path.join(packageRoot, 'backend/package.json'))
    const frontendPkg = await json(path.join(packageRoot, 'frontend/package.json'))
    if (backendPkg.name !== 'al-sistemas-backend' || frontendPkg.name !== 'al-sistemas') throw new Error('O pacote não foi identificado como AL Sistemas.')
    if (!validVersion(backendPkg.version) || backendPkg.version !== frontendPkg.version || backendPkg.version !== packageInfo.version) throw new Error('Versões do nome, backend e frontend não correspondem.')

    const manifestPath = path.join(packageRoot, 'al-sistemas.json')
    let manifest = null
    if (await exists(manifestPath)) {
      manifest = await json(manifestPath)
      if (manifest.product !== 'AL Sistemas' || manifest.version !== backendPkg.version) throw new Error('Manifesto al-sistemas.json inválido.')
    }
    if (compareVersions(backendPkg.version, current.version) <= 0) throw new Error(`A versão ${backendPkg.version} não é superior à instalada (${current.version}).`)

    const target = persist ? path.join(STAGING_DIR, id) : packageRoot
    if (persist) await fs.cp(packageRoot, target, { recursive: true, force: true })
    const changelog = await readChangelog(target, backendPkg.version, manifest)
    const deps = await dependencyPlan(target, { checkInstalled: persist })
    const currentViteConfig = await fileFingerprint(path.join(ROOT_DIR, 'frontend/vite.config.js'))
    const nextViteConfig = await fileFingerprint(path.join(target, 'frontend/vite.config.js'))
    const integrity=await buildStageManifest(target)
    const meta = {
      id, version: backendPkg.version, baseVersion:null, packageType:'full', filename: originalName, createdAt: new Date().toISOString(),
      changelog, dependencies: deps, ...(await detectMigrations(target)), removedFiles:[],
      frontendCacheResetRequired: Boolean(deps.frontend?.installRequired || currentViteConfig !== nextViteConfig),
      sha256: await hashFile(zipPath), integrity, status: 'ready', ephemeral: !persist,
    }
    if (persist) {
      await atomicJson(path.join(target, '.update-meta.json'), meta)
      await pruneStagedStorage(Math.max(2,Math.min(20,Number(process.env.AL_UPDATE_STAGE_KEEP||5))))
    }
    if (!persist) {
      const ephemeralDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alsistemas-publish-'))
      await fs.cp(packageRoot, ephemeralDir, { recursive: true, force: true })
      return { ...meta, _packageRoot: ephemeralDir }
    }
    return meta
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
}

async function readChangelog(root, version, manifest) {
  if (manifest?.changelog) return Array.isArray(manifest.changelog) ? manifest.changelog.join('\n') : String(manifest.changelog)
  try {
    const raw = await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8')
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = raw.match(new RegExp(`(?:^|\\n)#{1,3}\\s*(?:\\[)?v?${escaped}(?:\\])?[^\\n]*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s|$)`, 'i'))
    return (match?.[1] || raw.slice(0, 5000)).trim()
  } catch { return 'Esta versão não incluiu CHANGELOG.md.' }
}

async function dependencyFingerprint(areaDir) {
  const lockFile = path.join(areaDir, 'package-lock.json')
  if (await exists(lockFile)) {
    const lock = await json(lockFile)
    delete lock.version
    if (lock.packages?.['']) delete lock.packages[''].version
    return crypto.createHash('sha256').update(JSON.stringify(lock)).digest('hex')
  }
  const pkg = await json(path.join(areaDir, 'package.json'))
  const dependencyShape = {
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
    optionalDependencies: pkg.optionalDependencies || {},
    peerDependencies: pkg.peerDependencies || {},
    overrides: pkg.overrides || {},
    engines: pkg.engines || {},
  }
  return crypto.createHash('sha256').update(JSON.stringify(dependencyShape)).digest('hex')
}

async function installedDependencyHealth(area) {
  const areaDir = path.join(ROOT_DIR, area)
  const pkg = await json(path.join(areaDir, 'package.json'))
  const declared = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  }
  const missing = []
  for (const name of Object.keys(declared)) {
    if (!(await exists(path.join(areaDir, 'node_modules', name, 'package.json')))) missing.push(name)
  }

  // Alguns pacotes podem ter package.json presente e ainda assim estarem
  // fisicamente incompletos. Estes arquivos são essenciais ao boot/build.
  const critical = area === 'frontend'
    ? [
        ['tailwindcss', 'lib/css/preflight.css'],
        ['react', 'index.js'],
        ['react-dom', 'index.js'],
        ['vite', 'bin/vite.js'],
        ['postcss', 'lib/postcss.js'],
      ]
    : [
        ['express', 'index.js'],
        ['mongoose', 'index.js'],
      ]

  for (const [name, relative] of critical) {
    if (declared[name] && !(await exists(path.join(areaDir, 'node_modules', name, relative))) && !missing.includes(name)) {
      missing.push(name)
    }
  }
  return { ok: missing.length === 0, repairPackages: missing }
}

async function dependencyPlan(staged, { checkInstalled = true } = {}) {
  const result = {}
  for (const area of ['backend', 'frontend']) {
    const currentLock = await dependencyFingerprint(path.join(ROOT_DIR, area))
    const nextLock = await dependencyFingerprint(path.join(staged, area))
    const lockChanged = currentLock !== nextLock
    const health = checkInstalled ? await installedDependencyHealth(area) : { ok:true, repairPackages:[] }
    const installRequired = lockChanged || !health.ok
    result[area] = {
      installRequired,
      lockChanged,
      integrityOk: health.ok,
      repairPackages: health.repairPackages,
      reason: lockChanged
        ? 'Árvore de dependências alterada.'
        : health.ok
          ? 'Dependências inalteradas e instalação íntegra.'
          : `Instalação incompleta/corrompida: ${health.repairPackages.join(', ')}.`,
    }
  }
  return result
}

async function detectMigrations(staged) {
  const dir = path.join(staged, 'backend/migrations')
  try {
    const incoming = (await fs.readdir(dir)).filter(f => /\.(js|cjs|mjs)$/.test(f)).sort()
    const current = new Set((await fs.readdir(path.join(ROOT_DIR, 'backend/migrations')).catch(() => [])).filter(f => /\.(js|cjs|mjs)$/.test(f)))
    const migrations = incoming.filter(f => !current.has(f))
    let migrationRollbackSafe = true
    for (const name of migrations) {
      const source = await fs.readFile(path.join(dir, name), 'utf8')
      if (!/(?:export\s+(?:async\s+)?function\s+down|export\s+const\s+down|\bdown\s*[:=]\s*(?:async\s*)?(?:function|\())/.test(source)) migrationRollbackSafe = false
    }
    return { migrations, migrationRollbackSafe }
  } catch { return { migrations: [], migrationRollbackSafe: true } }
}


function replaceablePath(rel){
  rel=rel.replace(/\\/g,'/').replace(/^\.\//,'')
  if(!rel) return false
  if(PRESERVE_PATHS.some(p=>rel===p||rel.startsWith(`${p}/`))) return false
  if(rel==='.update-meta.json'||rel==='al-update.json'||rel==='.git'||rel.startsWith('.git/')||rel==='node_modules'||rel.includes('/node_modules/')) return false
  return true
}

async function scanTree(base){
  const map=new Map()
  async function walk(dir,rel=''){
    for(const ent of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
      const r=rel?`${rel}/${ent.name}`:ent.name
      if(!replaceablePath(r)) continue
      const full=path.join(dir,ent.name)
      if(ent.isDirectory()) await walk(full,r)
      else if(ent.isFile()){
        const st=await fs.stat(full)
        map.set(r,{size:st.size,mtimeMs:st.mtimeMs,full})
      }
    }
  }
  await walk(base)
  return map
}

async function sameFile(a,b){
  if(a.size!==b.size) return false
  // Arquivos pequenos são comparados por hash; grandes por amostras para não
  // transformar a simulação em uma segunda instalação.
  const limit=4*1024*1024
  if(a.size<=limit){
    const [aa,bb]=await Promise.all([fs.readFile(a.full),fs.readFile(b.full)])
    return crypto.createHash('sha256').update(aa).digest('hex')===crypto.createHash('sha256').update(bb).digest('hex')
  }
  const sample=64*1024
  const readSample=async info=>{
    const fh=await fs.open(info.full,'r')
    try{
      const head=Buffer.alloc(Math.min(sample,info.size))
      await fh.read(head,0,head.length,0)
      const tail=Buffer.alloc(Math.min(sample,info.size))
      await fh.read(tail,0,tail.length,Math.max(0,info.size-tail.length))
      return crypto.createHash('sha256').update(head).update(tail).digest('hex')
    }finally{await fh.close()}
  }
  const [ha,hb]=await Promise.all([readSample(a),readSample(b)])
  return ha===hb
}

async function dirBytes(map){
  let total=0
  for(const v of map.values()) total+=Number(v.size||0)
  return total
}

function nodeEngineCheck(spec){
  if(!spec)return {spec:null,ok:true}
  const major=Number(process.versions.node.split('.')[0])
  const min=String(spec).match(/>=\s*(\d+)/)
  if(min)return {spec,ok:major>=Number(min[1]),current:process.version}
  const exact=String(spec).match(/^\^?(\d+)/)
  if(exact)return {spec,ok:major===Number(exact[1]),current:process.version}
  return {spec,ok:true,current:process.version,unparsed:true}
}


async function actualWriteCheck(dir,label){
  const token=`.al-update-write-test-${process.pid}-${crypto.randomBytes(3).toString('hex')}`
  const file=path.join(dir,token)
  try{
    await fs.writeFile(file,`AL Sistemas updater write test: ${label}\n`,{flag:'wx'})
    await fs.rename(file,`${file}.renamed`)
    await fs.rm(`${file}.renamed`,{force:true})
    return {ok:true}
  }catch(e){
    await fs.rm(file,{force:true}).catch(()=>{})
    await fs.rm(`${file}.renamed`,{force:true}).catch(()=>{})
    return {ok:false,error:e.message,code:e.code||null}
  }
}

export async function getUpdaterDiagnostics(){
  await ensureUpdateDirs()
  if(IS_VERCEL) return {ok:true,environment:'vercel',checks:[],warnings:['Instalação local não é utilizada na Vercel.']}
  const checks=[]
  const rootWrite=await actualWriteCheck(ROOT_DIR,'root')
  checks.push({id:'root-write',label:'Gravação na instalação',...rootWrite,blocking:true})
  const stateWrite=await actualWriteCheck(STATE_DIR,'state')
  checks.push({id:'state-write',label:'Gravação no armazenamento externo',...stateWrite,blocking:true})

  let nodeOk=false
  try{await fs.access(process.execPath);nodeOk=true}catch{}
  checks.push({id:'node-runtime',label:'Runtime Node.js',ok:nodeOk,detail:process.execPath,blocking:true})

  const runtimeDir=path.join(STATE_DIR,'runtime')
  const recoveryFiles=['updateWatchdog.cjs','recoverPending.cjs']
  const recoveryMissing=[]
  for(const name of recoveryFiles) if(!await exists(path.join(runtimeDir,name))) recoveryMissing.push(name)
  checks.push({id:'recovery-runtime',label:'Recuperação externa',ok:recoveryMissing.length===0,detail:recoveryMissing.length?`Ausentes: ${recoveryMissing.join(', ')}`:'Pronta',blocking:true})

  let freeBytes=null
  try{const st=await fs.statfs(STATE_DIR);freeBytes=Number(st.bavail)*Number(st.bsize)}catch{}
  const minFreeBytes=96*1024*1024
  const diskOk=freeBytes===null||freeBytes>=minFreeBytes
  checks.push({id:'free-space',label:'Espaço livre mínimo',ok:diskOk,detail:freeBytes,minFreeBytes,blocking:true})

  const restartStrategy=process.env.AL_UPDATE_RESTART_STRATEGY||'none'
  const restartOk=['none','pm2','systemd'].includes(restartStrategy)
  checks.push({id:'restart-strategy',label:'Estratégia de reinício',ok:restartOk,detail:restartStrategy,blocking:true})

  let sourceWorker=true
  for(const rel of ['backend/src/update/updateWorker.js','backend/src/update/updateWatchdog.cjs']) if(!await exists(path.join(ROOT_DIR,rel))) sourceWorker=false
  checks.push({id:'worker-files',label:'Motor de atualização',ok:sourceWorker,blocking:true})

  const blocking=checks.filter(c=>c.blocking&&!c.ok)
  const warnings=[]
  if(restartStrategy==='none') warnings.push('Reinício automático não está configurado; a atualização poderá terminar como “reinício manual necessário”.')
  if(freeBytes!==null&&freeBytes<256*1024*1024) warnings.push('Há menos de 256 MB livres; pacotes maiores podem exigir mais espaço para snapshot e build.')
  return {
    ok:blocking.length===0,
    generatedAt:new Date().toISOString(),
    environment:Boolean(process.env.TERMUX_VERSION||String(process.env.PREFIX||'').includes('com.termux'))?'Termux':process.platform,
    stateDir:STATE_DIR,
    rootDir:ROOT_DIR,
    restartStrategy,
    checks,warnings,
  }
}

export async function getUpdatePreflight(stageId){
  await ensureUpdateDirs()
  const updaterDiagnostics=await getUpdaterDiagnostics()
  await verifyStageIntegrity(stageId)
  const meta=await getStage(stageId)
  const stageDir=path.join(STAGING_DIR,stageId)
  const [backendPkg,frontendPkg]=await Promise.all([json(path.join(stageDir,'backend/package.json')),json(path.join(stageDir,'frontend/package.json'))])
  const nodeEngine=nodeEngineCheck(backendPkg.engines?.node||frontendPkg.engines?.node)
  let rootWritable=true,stateWritable=true
  try{await fs.access(ROOT_DIR,2)}catch{rootWritable=false}
  try{await fs.access(STATE_DIR,2)}catch{stateWritable=false}
  const [currentFiles,nextFiles]=await Promise.all([scanTree(ROOT_DIR),scanTree(stageDir)])
  const added=[],changed=[],removed=[],unchanged=[]
  for(const [rel,next] of nextFiles){
    const cur=currentFiles.get(rel)
    if(!cur) added.push(rel)
    else if(await sameFile(cur,next)) unchanged.push(rel)
    else changed.push(rel)
  }
  if(meta.packageType==='incremental'){
    for(const rel of meta.removedFiles||[]) if(currentFiles.has(rel)) removed.push(rel)
  }else{
    for(const rel of currentFiles.keys()) if(!nextFiles.has(rel)) removed.push(rel)
  }

  const currentBytes=await dirBytes(currentFiles)
  const incomingBytes=await dirBytes(nextFiles)
  let freeBytes=null
  try{
    const stat=await fs.statfs(ROOT_DIR)
    freeBytes=Number(stat.bavail)*Number(stat.bsize)
  }catch{}
  // Snapshot contém a árvore substituível atual. Reserva adicional cobre cópia,
  // build temporário e variação de npm sem fingir precisão absoluta.
  const estimatedBackupBytes=currentBytes
  const estimatedWorkingBytes=Math.ceil(incomingBytes*0.35)
  const estimatedRequiredBytes=estimatedBackupBytes+estimatedWorkingBytes+32*1024*1024
  const diskOk=freeBytes===null?true:freeBytes>estimatedRequiredBytes
  const dependencyChanges=['backend','frontend'].filter(a=>meta.dependencies?.[a]?.installRequired)
  const warnings=[]
  if(!diskOk) warnings.push('Espaço livre possivelmente insuficiente para snapshot + atualização.')
  if(!rootWritable||!stateWritable) warnings.push('O processo não possui permissão de escrita suficiente para atualizar/armazenar o snapshot.')
  if(!nodeEngine.ok) warnings.push(`Node.js incompatível com o pacote: exige ${nodeEngine.spec}, atual ${nodeEngine.current}.`)
  if(meta.migrations?.length && mongoose.connection.readyState!==1) warnings.push('Há migrações, mas o MongoDB não está conectado neste momento.')
  if(meta.migrations?.length) warnings.push(`${meta.migrations.length} migração(ões) de banco serão executadas.`)
  if(meta.migrationRollbackSafe===false) warnings.push('Há migrações sem rollback seguro.')
  if(dependencyChanges.length) warnings.push(`Dependências serão processadas em: ${dependencyChanges.join(', ')}.`)
  if(removed.length>25) warnings.push(`${removed.length} arquivos serão removidos da instalação atual.`)

  let risk='baixo'
  if(meta.migrations?.length||dependencyChanges.length||removed.length>10) risk='médio'
  if(!diskOk||!rootWritable||!stateWritable||!nodeEngine.ok||meta.migrationRollbackSafe===false||(meta.migrations?.length&&mongoose.connection.readyState!==1)||!updaterDiagnostics.ok) risk='alto'
  if(!updaterDiagnostics.ok) warnings.push('O diagnóstico do motor de atualização encontrou um bloqueio estrutural.')

  return {
    ok:updaterDiagnostics.ok && diskOk && rootWritable && stateWritable && nodeEngine.ok && meta.migrationRollbackSafe!==false && (!(meta.migrations?.length)||mongoose.connection.readyState===1),
    stageId,fromVersion:(await installedVersion()).version,toVersion:meta.version,packageType:meta.packageType||'full',baseVersion:meta.baseVersion||null,
    createdAt:new Date().toISOString(),
    files:{
      added:added.length,changed:changed.length,removed:removed.length,unchanged:unchanged.length,
      totalIncoming:nextFiles.size,
      samples:{added:added.slice(0,12),changed:changed.slice(0,12),removed:removed.slice(0,12)},
    },
    dependencies:{
      backend:meta.dependencies?.backend||null,
      frontend:meta.dependencies?.frontend||null,
      areas:dependencyChanges,
    },
    migrations:{count:meta.migrations?.length||0,names:meta.migrations||[],rollbackSafe:meta.migrationRollbackSafe!==false,databaseReady:mongoose.connection.readyState===1},
    environment:{rootWritable,stateWritable,nodeEngine},
    updaterDiagnostics,
    disk:{freeBytes,estimatedBackupBytes,estimatedWorkingBytes,estimatedRequiredBytes,ok:diskOk},
    risk,warnings,
  }
}

export async function listStaged() {
  await ensureUpdateDirs(); const out = []
  for (const name of await fs.readdir(STAGING_DIR)) {
    try { out.push(await json(path.join(STAGING_DIR, name, '.update-meta.json'))) } catch {}
  }
  return out.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
}

export async function readHistory() { await ensureUpdateDirs(); try { return await json(HISTORY_FILE) } catch { return [] } }
export async function appendHistory(entry) {
  const list = await readHistory(); list.unshift(entry); await atomicJson(HISTORY_FILE, list.slice(0,100)); return entry
}
export async function getStage(id) {
  if (!/^stage_[0-9]+_[a-f0-9]+$/.test(id)) throw new Error('ID de preparação inválido.')
  return json(path.join(STAGING_DIR, id, '.update-meta.json'))
}

export async function readUpdateLock(){
  await ensureUpdateDirs()
  try{
    const lock=await json(LOCK_FILE)
    let jobTerminal=false
    if(lock.jobId){
      try{
        const job=await json(path.join(JOB_DIR,`${lock.jobId}.json`))
        jobTerminal=['completed','restart-required','rolled-back','failed','recovered'].includes(job.status)
      }catch{}
    }
    const terminal=['completed','restart-required','rolled-back','failed','recovered'].includes(lock.status)||jobTerminal
    const age=Date.now()-new Date(lock.heartbeatAt||lock.createdAt||0).getTime()
    if(terminal || age>30*60*1000){
      await fs.rm(LOCK_FILE,{force:true}).catch(()=>{})
      return null
    }
    return lock
  }catch{return null}
}

export async function reserveUpdateLock(job){
  await ensureUpdateDirs()
  const payload={jobId:job.id,type:job.type,status:'reserved',createdAt:new Date().toISOString(),heartbeatAt:new Date().toISOString()}
  try{
    const fh=await fs.open(LOCK_FILE,'wx')
    try{await fh.writeFile(JSON.stringify(payload,null,2))}finally{await fh.close()}
    return payload
  }catch(e){
    if(e.code==='EEXIST'){
      const active=await readUpdateLock()
      if(!active) return reserveUpdateLock(job)
      const err=new Error(`Já existe uma operação de atualização em andamento (${active.jobId}).`)
      err.code='UPDATE_BUSY';err.active=active;throw err
    }
    throw e
  }
}
export async function touchUpdateLock(jobId,status='running'){
  try{
    const current=await json(LOCK_FILE)
    if(current.jobId!==jobId)return false
    await atomicJson(LOCK_FILE,{...current,status,heartbeatAt:new Date().toISOString()})
    return true
  }catch{return false}
}
export async function releaseUpdateLock(jobId){
  try{
    const current=await json(LOCK_FILE)
    if(current.jobId===jobId)await fs.rm(LOCK_FILE,{force:true})
  }catch{}
}
export async function listInterruptedJobs(){
  await ensureUpdateDirs()
  const lock=await readUpdateLock()
  const out=[]
  for(const name of await fs.readdir(JOB_DIR).catch(()=>[])){
    if(!name.endsWith('.json'))continue
    try{
      const job=await json(path.join(JOB_DIR,name))
      if(['completed','restart-required','rolled-back','failed','recovered'].includes(job.status))continue
      const heartbeats=[
        lock?.jobId===job.id?lock.heartbeatAt:null,
        job.heartbeatAt,job.recoveryDetectedAt,job.startedAt,job.createdAt,
      ].filter(Boolean).map(v=>new Date(v).getTime()).filter(Number.isFinite)
      const heartbeatMs=heartbeats.length?Math.max(...heartbeats):0
      const staleMs=Date.now()-heartbeatMs
      out.push({...job,staleMs,lockOwned:lock?.jobId===job.id})
    }catch{}
  }
  return out
}

export async function createJob(stageId, options = {}) {
  await ensureUpdateDirs(); const integrity=await verifyStageIntegrity(stageId); const meta = await getStage(stageId)
  const current = await installedVersion()
  if(compareVersions(meta.version,current.version)<=0) throw new Error(`A versão preparada (${meta.version}) não é superior à instalada (${current.version}). Valide um pacote mais recente.`)
  if(meta.packageType==='incremental' && current.version!==meta.baseVersion) throw new Error(`Este incremental exige a versão ${meta.baseVersion}, mas a instalação está em ${current.version}. Use o pacote completo.`)
  if (meta.migrations?.length && meta.migrationRollbackSafe === false) throw new Error('A atualização contém migrações sem função down segura. A instalação via painel foi bloqueada para preservar o rollback automático.')
  const id = `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
  const job = {
    id, type: 'update', stageId, fromVersion: current.version, toVersion: meta.version, packageType:meta.packageType||'full', baseVersion:meta.baseVersion||null, stageIntegrity:integrity,
    createdAt: new Date().toISOString(), status: 'queued',
    restart: {
      strategy: options.restartStrategy || process.env.AL_UPDATE_RESTART_STRATEGY || 'none',
      pm2Name: options.pm2Name || process.env.AL_UPDATE_PM2_NAME || 'al-sistemas',
      systemdService: options.systemdService || process.env.AL_UPDATE_SYSTEMD_SERVICE || 'al-sistemas.service',
    },
    healthUrl: options.healthUrl || process.env.AL_UPDATE_HEALTH_URL || `http://127.0.0.1:${process.env.PORT || 3001}/api/health/live`,
    versionUrl: options.versionUrl || process.env.AL_UPDATE_VERSION_URL || `http://127.0.0.1:${process.env.PORT || 3001}/`,
    frontendUrl: options.frontendUrl || process.env.AL_UPDATE_FRONTEND_URL || 'http://127.0.0.1:5173',
    returnPath: options.returnPath || '/admin/atualizacoes',
    monitorPort: Number(options.monitorPort || process.env.AL_UPDATE_MONITOR_PORT || (32100 + crypto.randomInt(0, 800))),
    preflight: options.preflight || null,
    snapshotRetention: Math.max(1, Math.min(20, Number(options.snapshotRetention || process.env.AL_UPDATE_SNAPSHOT_KEEP || 3))),
    maintenanceMode: options.maintenanceMode !== false,
  }
  await atomicJson(path.join(JOB_DIR, `${id}.json`),job); return job
}

export async function listSnapshots() {
  await ensureUpdateDirs(); const result=[]
  for (const name of await fs.readdir(SNAPSHOT_DIR)) {
    try { result.push(await json(path.join(SNAPSHOT_DIR, name, 'snapshot.json'))) } catch {}
  }
  return result.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
}

export async function createRollbackJob(snapshotId, options={}) {
  if (!/^snapshot_[0-9]+_[0-9A-Za-z._-]+$/.test(snapshotId)) throw new Error('Snapshot inválido.')
  const meta = await json(path.join(SNAPSHOT_DIR, snapshotId, 'snapshot.json'))
  if (meta.safe === false) throw new Error('Este snapshot não permite rollback manual seguro porque a atualização associada possui migrações sem reversão garantida.')
  const id=`job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
  const job={id,type:'rollback',snapshotId,fromVersion:(await installedVersion()).version,toVersion:meta.version,createdAt:new Date().toISOString(),status:'queued',restart:{strategy:options.restartStrategy||process.env.AL_UPDATE_RESTART_STRATEGY||'none',pm2Name:options.pm2Name||process.env.AL_UPDATE_PM2_NAME||'al-sistemas',systemdService:options.systemdService||process.env.AL_UPDATE_SYSTEMD_SERVICE||'al-sistemas.service'},healthUrl:options.healthUrl||process.env.AL_UPDATE_HEALTH_URL||`http://127.0.0.1:${process.env.PORT||3001}/api/health/live`,versionUrl:options.versionUrl||process.env.AL_UPDATE_VERSION_URL||`http://127.0.0.1:${process.env.PORT||3001}/`,frontendUrl:options.frontendUrl||process.env.AL_UPDATE_FRONTEND_URL||'http://127.0.0.1:5173',returnPath:options.returnPath||'/admin/atualizacoes',monitorPort:Number(options.monitorPort||process.env.AL_UPDATE_MONITOR_PORT||(32100+crypto.randomInt(0,800)))}
  await atomicJson(path.join(JOB_DIR,`${id}.json`),job); return job
}
