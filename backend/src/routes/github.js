/**
 * github.js — Proxy Seguro para GitHub API (EXPANSÃO Sprint 3)
 *
 * Sprint 3 EXTENSÃO — ADIÇÃO PURA. Nenhuma rota existente foi alterada.
 *
 * Token GitHub obtido pelo cofre central de Integrações e APIs, com variável de ambiente apenas como fallback de compatibilidade.
 * Frontend NUNCA recebe ou vê o token.
 *
 * Rotas originais (preservadas):
 *   GET  /api/github/status
 *   GET  /api/github/repos
 *   GET  /api/github/repos/:owner/:repo
 *
 * Novas rotas (Sprint 3 Extensão):
 *   DELETE /api/github/repos/:owner/:repo
 *   GET    /api/github/repos/:owner/:repo/readme
 *   GET    /api/github/repos/:owner/:repo/commits
 *   GET    /api/github/repos/:owner/:repo/releases
 *   POST   /api/github/repos/:owner/:repo/releases
 *   GET    /api/github/repos/:owner/:repo/artifacts
 *   GET    /api/github/repos/:owner/:repo/analysis
 *   GET    /api/github/meta/:repoId
 *   PUT    /api/github/meta/:repoId
 *   GET    /api/github/projetos-locais
 */
import { Router }       from 'express'
import jwt              from 'jsonwebtoken'
import { autenticar }   from '../middleware/auth.js'
import { auditLog }     from '../middleware/auditLog.js'
import AuditLog         from '../models/AuditLog.js'
import GitHubMeta       from '../models/GitHubMeta.js'
import GitHubPublishJob from '../models/GitHubPublishJob.js'
import fs               from 'fs'
import path             from 'path'
import sanitizeHtml     from 'sanitize-html'
import multer           from 'multer'
import JSZip            from 'jszip'
import crypto           from 'node:crypto'
import { Readable }      from 'node:stream'
import { githubFetch, githubFetchText, GITHUB_API }  from '../utils/githubClient.js'
import { getCredential } from '../utils/credentialStore.js'  // Sprint 6-B: utilitário centralizado
import { storeProjectSnapshot, testR2UpdateStorage } from '../services/cloudUpdateStorage.js'
import { sugerirDescricaoRepositorio, analisarLogsWorkflow } from '../utils/aiClient.js'
import { redactAiText } from '../services/aiRedactor.js'
import { selectRelevantLogContext } from '../services/aiContext.js'
import { createAiJob } from '../services/aiJobs.js'
import { bootstrapValue } from '../utils/localVault.js'

const router = Router()

const publishUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.AL_GITHUB_PACKAGE_MAX_BYTES || 80 * 1024 * 1024) },
})

// O estado dos jobs fica no MongoDB. O ZIP ainda existe somente durante a
// execução atual, mas uma reinicialização do backend não faz o job "sumir":
// o frontend continua encontrando o registro e recebe um diagnóstico explícito.
function publishLockKey(repository, branch) {
  return `${String(repository || '').trim().toLowerCase()}@${String(branch || 'main').trim().toLowerCase()}`
}
function queueGithubPublishPersist(job, update) {
  if (!job) return Promise.resolve()
  job._persist = (job._persist || Promise.resolve())
    .catch(() => {})
    .then(() => GitHubPublishJob.updateOne({ jobId: job.id }, update))
    .catch(err => { job._persistError = err })
  return job._persist
}
async function criarGithubPublishJob({ owner, repo, usuarioId, destination, branch }) {
  await GitHubPublishJob.init()
  const now = new Date()
  const lockKey = publishLockKey(destination, branch)

  // Libera locks abandonados por uma execução antiga. O job continua registrado
  // como falha em vez de desaparecer da tela.
  const staleBefore = new Date(Date.now() - 20 * 60 * 1000)
  await GitHubPublishJob.updateMany(
    { lockKey, status: { $in: ['queued', 'running'] }, updatedAt: { $lt: staleBefore } },
    {
      $set: {
        status: 'failed', phase: 'error', progress: 100, finishedAt: now, updatedAt: now,
        error: {
          message: 'A publicação anterior foi interrompida pelo backend. Confira a branch no GitHub antes de iniciar outra publicação.',
          code: 'GITHUB_PUBLISH_STALE',
          action: 'Confira o GitHub. Se o commit não estiver na branch, inicie uma nova publicação.',
        },
      },
      $unset: { lockKey: 1 },
    },
  ).catch(() => {})

  const active = await GitHubPublishJob.findOne({ lockKey, status: { $in: ['queued', 'running'] } }).lean()
  if (active) {
    const e = new Error(`Já existe uma publicação em andamento para ${destination} · ${branch}.`)
    e.status = 409; e.code = 'GITHUB_PUBLISH_ACTIVE'; e.jobId = active.jobId
    throw e
  }

  const job = {
    id: `ghpub_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    owner, repo, destination, branch, lockKey, usuarioId: String(usuarioId || ''),
    status: 'queued', phase: 'received', progress: 0, createdAt: now.toISOString(),
    updatedAt: now.toISOString(), logs: [], result: null, error: null,
  }
  try {
    await GitHubPublishJob.create({
      jobId: job.id, sourceOwner: owner, sourceRepo: repo, destination, branch,
      usuarioId: job.usuarioId, lockKey, status: job.status, phase: job.phase,
      progress: 0, logs: [], createdAt: now, updatedAt: now,
    })
  } catch (err) {
    if (Number(err?.code) === 11000) {
      const e = new Error(`Já existe uma publicação em andamento para ${destination} · ${branch}.`)
      e.status = 409; e.code = 'GITHUB_PUBLISH_ACTIVE'; throw e
    }
    throw err
  }
  return job
}
function registrarGithubPublishLog(job, phase, label, message, state = 'active', progress = null, details = null) {
  if (!job) return
  const at = new Date().toISOString()
  job.phase = phase || job.phase
  job.updatedAt = at
  if (Number.isFinite(progress)) job.progress = Math.max(0, Math.min(100, Number(progress)))
  const entry = { at, phase, label, message, state, progress: Number.isFinite(progress) ? job.progress : null }
  if (details && typeof details === 'object') entry.details = details
  job.logs.push(entry)
  const maxLogs = Number(process.env.AL_GITHUB_PUBLISH_MAX_LOGS || 3500)
  if (job.logs.length > maxLogs) job.logs.splice(0, job.logs.length - maxLogs)
  queueGithubPublishPersist(job, {
    $set: { phase: job.phase, progress: job.progress, updatedAt: new Date(at) },
    $push: { logs: { $each: [entry], $slice: -maxLogs } },
  })
}
function versaoPartes(value = '') {
  const match = String(value || '').trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/)
  return match ? [Number(match[1] || 0), Number(match[2] || 0), Number(match[3] || 0)] : null
}
function compararVersoes(a, b) {
  const av = versaoPartes(a), bv = versaoPartes(b)
  if (!av || !bv) return null
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1
  return 0
}
function fileKindInfo(name = '', size = 0) {
  const ext = path.extname(String(name || '')).toLowerCase().replace(/^\./, '')
  const map = {
    js:'JavaScript', jsx:'React JSX', ts:'TypeScript', tsx:'React TSX', json:'JSON', md:'Markdown', html:'HTML', css:'CSS',
    yml:'YAML', yaml:'YAML', sh:'Shell', cjs:'CommonJS', mjs:'JavaScript', png:'Imagem PNG', jpg:'Imagem JPEG', jpeg:'Imagem JPEG',
    webp:'Imagem WebP', svg:'SVG', zip:'Arquivo ZIP', txt:'Texto', csv:'CSV', pdf:'PDF', env:'Configuração', lock:'Lockfile',
  }
  return { extensao: ext || null, tipoArquivo: map[ext] || (size === 0 ? 'Arquivo vazio' : 'Arquivo') }
}

function normalizarTargetPath(value='') {
  const raw=String(value||'').trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'')
  if(!raw) return ''
  const parts=raw.split('/').filter(Boolean)
  if(parts.some(p=>p==='.'||p==='..'||p==='.git')) {
    const e=new Error('Pasta de destino inválida.'); e.status=400; throw e
  }
  if(parts.length>12){const e=new Error('Pasta de destino profunda demais.');e.status=400;throw e}
  return parts.join('/')
}

function encodeGitPath(rel='') {
  return String(rel||'').split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

function arquivoPermitido(rel='') {
  const parts=rel.split('/').filter(Boolean)
  if(parts.some(p=>p==='.git'||p==='node_modules'||p==='.DS_Store')) return false
  return !rel.includes('..') && !rel.startsWith('/')
}

async function extrairZipPublicavel(buffer) {
  const zip=await JSZip.loadAsync(buffer,{checkCRC32:true})
  const entries=Object.values(zip.files).filter(e=>!e.dir)
  if(!entries.length){const e=new Error('O ZIP não contém arquivos.');e.status=400;throw e}
  const normalized=entries.map(e=>({entry:e,path:String(e.name||'').replace(/\\/g,'/').replace(/^\/+/, '')})).filter(x=>x.path)
  const firstParts=normalized.map(x=>x.path.split('/').filter(Boolean))
  const commonRoot=firstParts.length>0 && firstParts.every(p=>p.length>1 && p[0]===firstParts[0][0]) ? firstParts[0][0] : ''
  const out=[]
  let totalBytes=0
  for(const item of normalized){
    let rel=item.path
    if(commonRoot && rel.startsWith(commonRoot+'/')) rel=rel.slice(commonRoot.length+1)
    rel=rel.replace(/^\/+|\/+$/g,'')
    if(!rel||!arquivoPermitido(rel)) continue
    const data=await item.entry.async('nodebuffer')
    if(data.length>Number(process.env.AL_GITHUB_MAX_SINGLE_FILE_BYTES||95*1024*1024)){const e=new Error(`Arquivo grande demais para publicação pelo GitHub: ${rel}`);e.status=413;throw e}
    totalBytes+=data.length
    if(totalBytes>Number(process.env.AL_GITHUB_UNPACKED_MAX_BYTES||160*1024*1024)){const e=new Error('Conteúdo descompactado excede o limite de segurança.');e.status=413;throw e}
    out.push({path:rel,data})
    if(out.length>Number(process.env.AL_GITHUB_MAX_FILES||2500)){const e=new Error('O pacote possui arquivos demais para uma única publicação.');e.status=413;throw e}
  }
  if(!out.length){const e=new Error('Nenhum arquivo publicável foi encontrado no ZIP.');e.status=400;throw e}
  return {files:out,totalBytes,commonRoot}
}

function repositorioGitVazio(err) {
  return Number(err?.status)===409 && /(?:git\s+)?repository\s+is\s+empty|reposit[oó]rio.+vazio/i.test(String(err?.message||''))
}

async function obterBranchBase(owner,repo,branch) {
  const repoInfo=await githubFetch(`/repos/${owner}/${repo}`)
  const wanted=String(branch||repoInfo.default_branch||'main').trim()||'main'
  try{
    const ref=await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(wanted)}`)
    const commit=await githubFetch(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`)
    return {repoInfo,branch:wanted,exists:true,parentSha:ref.object.sha,baseTreeSha:commit.tree?.sha||'',empty:false}
  }catch(err){
    // O GitHub responde 409 "Git Repository is empty." antes mesmo de existir
    // qualquer ref. Esse é o mesmo cenário já tratado pelo publicador do módulo
    // Atualizações e deve seguir para a inicialização do primeiro commit.
    if(repositorioGitVazio(err)) return {repoInfo,branch:wanted,exists:false,parentSha:'',baseTreeSha:'',empty:true}
    if(err.status!==404) throw err
    try{
      const defaultBranch=String(repoInfo.default_branch||'main')
      const ref=await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`)
      const commit=await githubFetch(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`)
      return {repoInfo,branch:wanted,exists:false,parentSha:ref.object.sha,baseTreeSha:commit.tree?.sha||'',empty:false}
    }catch(baseErr){
      if(repositorioGitVazio(baseErr)) return {repoInfo,branch:wanted,exists:false,parentSha:'',baseTreeSha:'',empty:true}
      if(baseErr.status!==404) throw baseErr
      return {repoInfo,branch:wanted,exists:false,parentSha:'',baseTreeSha:'',empty:true}
    }
  }
}

function computeGitBlobShaBuffer(data) {
  const buf=Buffer.isBuffer(data)?data:Buffer.from(data||'')
  const header=Buffer.from(`blob ${buf.length}\0`)
  return crypto.createHash('sha1').update(header).update(buf).digest('hex')
}

function bufferUtf8Seguro(data) {
  if(!Buffer.isBuffer(data)) return false
  if(data.includes(0)) return false
  const text=data.toString('utf8')
  return Buffer.from(text,'utf8').equals(data)
}

function githubRateLimitError(err) {
  const msg=String(err?.message||'')
  return Number(err?.status)===429 || (
    Number(err?.status)===403 && (
      /secondary rate limit|rate limit|abuse detection|too many requests|temporarily blocked/i.test(msg) ||
      Number.isFinite(err?.retryAfter) ||
      err?.rateLimitRemaining===0
    )
  ) || (Number(err?.status)===422 && /spam|abuse/i.test(msg))
}

function githubPublishErrorMessage(err) {
  const msg=String(err?.message||'Erro desconhecido do GitHub').trim()
  if(err?.code==='GITHUB_PUBLISH_ACTIVE') return msg
  if(githubRateLimitError(err)) return err?.githubRetriesExhausted
    ? `O GitHub aplicou um limite temporário de gravação. O AL Sistemas aguardou e tentou novamente ${err.githubRetriesExhausted} vezes, mas a API ainda recusou a operação. Aguarde alguns minutos e repita. Detalhe: ${msg}`
    : `O GitHub aplicou um limite temporário à API. Aguarde alguns minutos e repita a operação. Detalhe: ${msg}`
  if(Number(err?.status)===403 && /resource not accessible|personal access token|integration|permission|push access|contents/i.test(msg)) {
    return `O token do GitHub não possui permissão suficiente para esta etapa. Confira Contents: Read and write em Integrações e APIs. Detalhe: ${msg}`
  }
  if(Number(err?.status)===403 && /protected branch|repository rule|ruleset|review required|branch protection/i.test(msg)) {
    return `A branch recusou a atualização por uma regra de proteção do GitHub. Detalhe: ${msg}`
  }
  const endpoint=err?.githubPath ? ` (${err.githubMethod||'GET'} ${err.githubPath})` : ''
  return `GitHub recusou a operação${endpoint}: ${msg}`
}

function githubPublishErrorAction(err) {
  const msg=String(err?.message||'')
  if (err?.code === 'GITHUB_PUBLISH_ACTIVE') return 'Acompanhe a publicação já ativa; não envie o mesmo pacote novamente.'
  if (githubRateLimitError(err)) return 'Aguarde alguns minutos e use Tentar novamente. O snapshot existente pode ser reaproveitado com segurança.'
  if (Number(err?.status)===403 && /resource not accessible|personal access token|integration|permission|push access|contents/i.test(msg)) return 'Abra Integrações e APIs e confirme Contents: Read and write para o token do GitHub.'
  if (Number(err?.status)===403 && /protected branch|repository rule|ruleset|review required|branch protection/i.test(msg)) return 'Revise as regras de proteção da branch ou publique em uma branch permitida.'
  if (err?.preflight) return 'Volte à revisão, corrija o item indicado e execute a verificação novamente.'
  return 'Abra Acontecimentos para ver a etapa exata. Se um commit já existir no GitHub, não repita o envio antes de confirmar a branch.'
}

async function publicarPacoteNoGitHub({owner,repo,branch,targetPath='',files,message,replacePath=false,onProgress=null}) {
  onProgress?.({phase:'branch',label:'Destino GitHub',message:`Conferindo branch ${branch || 'main'}…`,progress:42})
  let base=await obterBranchBase(owner,repo,branch)
  const prefix=normalizarTargetPath(targetPath)
  let initializedRepository=false
  let lastMutationAt=0

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  const writeGithub=async(apiPath,options={},meta={})=>{
    const attempts=3
    for(let attempt=1;attempt<=attempts;attempt++){
      const elapsed=Date.now()-lastMutationAt
      if(lastMutationAt && elapsed<1100) await sleep(1100-elapsed)
      try{
        const result=await githubFetch(apiPath,options)
        lastMutationAt=Date.now()
        return result
      }catch(err){
        lastMutationAt=Date.now()
        if(!githubRateLimitError(err)) throw err
        if(attempt>=attempts){err.githubRetriesExhausted=attempts;throw err}
        let waitMs=0
        if(Number(err.retryAfter)>0) waitMs=Number(err.retryAfter)*1000
        else if(err.rateLimitRemaining===0 && Number(err.rateLimitReset)>0) waitMs=Math.max(1000,(Number(err.rateLimitReset)*1000)-Date.now()+1500)
        else waitMs=61000*(2**(attempt-1))
        waitMs=Math.min(Math.max(waitMs,1000),180000)
        const seconds=Math.ceil(waitMs/1000)
        onProgress?.({
          phase:'rate-limit',label:'Pausa solicitada pelo GitHub',
          message:`Limite temporário detectado em ${meta.label||'gravação'}. Aguardando ${seconds}s antes da tentativa ${attempt+1}/${attempts}…`,
          state:'warn',progress:Number.isFinite(meta.progress)?meta.progress:null,
          details:{retryAfterSeconds:seconds,attempt,nextAttempt:attempt+1,apiPath},
        })
        await sleep(waitMs)
      }
    }
  }

  // Repositórios totalmente vazios precisam de um primeiro commit pela Contents API.
  if(!base.parentSha){
    onProgress?.({phase:'initialize',label:'Primeiro commit',message:'Repositório vazio detectado. Criando a base inicial…',progress:48})
    const defaultBranch=String(base.repoInfo.default_branch||'main').trim()||'main'
    const seed=files.find(f=>f.path==='README.md')||files.find(f=>f.path==='.gitignore')||files[0]
    const seedDest=prefix?`${prefix}/${seed.path}`:seed.path
    const initBody={
      message:String(message||'Inicializa repositório pelo AL Sistemas').slice(0,240),
      content:seed.data.toString('base64'),
    }
    const initialized=await writeGithub(
      `/repos/${owner}/${repo}/contents/${encodeGitPath(seedDest)}`,
      {method:'PUT',body:JSON.stringify(initBody)},
      {label:'primeiro commit',progress:48},
    )
    const initialSha=initialized?.commit?.sha||''
    if(!initialSha){const e=new Error('O GitHub inicializou o repositório, mas não retornou o primeiro commit.');e.status=502;throw e}
    const initialCommit=await githubFetch(`/repos/${owner}/${repo}/git/commits/${initialSha}`)
    const initialTreeSha=initialCommit?.tree?.sha||''
    if(!initialTreeSha){const e=new Error('O primeiro commit foi criado, mas a árvore inicial não pôde ser obtida.');e.status=502;throw e}

    if(base.branch!==defaultBranch){
      await writeGithub(`/repos/${owner}/${repo}/git/refs`,{
        method:'POST',body:JSON.stringify({ref:`refs/heads/${base.branch}`,sha:initialSha}),
      },{label:'criação da branch',progress:52})
    }

    initializedRepository=true
    onProgress?.({phase:'initialize',label:'Primeiro commit',message:`Base inicial criada em ${defaultBranch}${base.branch!==defaultBranch ? ` e branch ${base.branch} preparada` : ''}.`,progress:54})
    base={...base,exists:true,parentSha:initialSha,baseTreeSha:initialTreeSha,empty:false,defaultBranch}
  }

  // Carrega a tree remota uma vez. Isso permite comparar SHA localmente e evita
  // dezenas/centenas de POSTs para arquivos que já estão idênticos.
  let currentTree=null
  const remoteMap=new Map()
  if(base.baseTreeSha){
    onProgress?.({phase:'diff',label:'Comparando conteúdo',message:'Indexando a árvore atual para calcular somente as diferenças…',progress:56})
    try{
      currentTree=await githubFetch(`/repos/${owner}/${repo}/git/trees/${base.baseTreeSha}?recursive=1`)
      for(const item of currentTree?.tree||[]) if(item.type==='blob') remoteMap.set(item.path,item.sha)
      if(currentTree?.truncated){
        onProgress?.({phase:'diff',label:'Comparação parcial',message:'A árvore remota foi truncada pelo GitHub; arquivos não indexados serão tratados como alterados.',state:'warn',progress:57})
      }
    }catch(err){
      onProgress?.({phase:'diff',label:'Comparação indisponível',message:`Não foi possível indexar a árvore remota; o pacote será preparado integralmente. ${err.message}`,state:'warn',progress:57})
    }
  }

  const tree=[]
  const incomingPaths=new Set(files.map(file=>prefix?`${prefix}/${file.path}`:file.path))
  let removidos=0
  if(replacePath && currentTree){
    const pathPrefix=prefix?`${prefix}/`:''
    for(const item of currentTree.tree||[]){
      if(item.type!=='blob') continue
      const within=prefix ? item.path.startsWith(pathPrefix) : true
      if(within && !incomingPaths.has(item.path)){
        tree.push({path:item.path,mode:'100644',type:'blob',sha:null});removidos++
        onProgress?.({phase:'files',label:'DEL',message:item.path,state:'done',progress:58,details:{file:item.path,operation:'DEL'}})
      }
    }
  }

  const inlinePerFileMax=Number(process.env.AL_GITHUB_TREE_INLINE_FILE_MAX_BYTES||1024*1024)
  const inlineTotalMax=Number(process.env.AL_GITHUB_TREE_INLINE_TOTAL_MAX_BYTES||6*1024*1024)
  let inlineBytes=0, enviados=0, inalterados=0, inlineTree=0, blobsCriados=0
  const total=Math.max(1,files.length)
  onProgress?.({phase:'blobs',label:'Preparando arquivos',message:`Comparando e preparando ${files.length} arquivo(s) sem sobrecarregar a API do GitHub…`,progress:60})

  for(let index=0;index<files.length;index++){
    const file=files[index]
    const dest=prefix?`${prefix}/${file.path}`:file.path
    const progress=60+Math.round(((index+1)/total)*20)
    const localSha=computeGitBlobShaBuffer(file.data)
    const remoteSha=remoteMap.get(dest)

    if(remoteSha && remoteSha===localSha){
      inalterados++
      onProgress?.({phase:'files',label:'SKIP',message:`${index+1}/${files.length} · ${dest} · sem alteração`,state:'done',progress,details:{file:dest,operation:'SKIP',index:index+1,total:files.length}})
      continue
    }

    const op=remoteSha?'MOD':'ADD'
    const safeText=bufferUtf8Seguro(file.data)
    const canInline=safeText && file.data.length<=inlinePerFileMax && (inlineBytes+file.data.length)<=inlineTotalMax
    if(canInline){
      tree.push({path:dest,mode:'100644',type:'blob',content:file.data.toString('utf8')})
      inlineBytes+=file.data.length;inlineTree++;enviados++
      onProgress?.({phase:'files',label:op,message:`${index+1}/${files.length} · ${dest} · preparado na árvore`,state:'done',progress,details:{file:dest,operation:op,mode:'inline',index:index+1,total:files.length}})
      continue
    }

    // Binários e textos grandes ainda usam blob explícito, porém com pacing e retry.
    const blob=await writeGithub(`/repos/${owner}/${repo}/git/blobs`,{
      method:'POST',body:JSON.stringify({content:file.data.toString('base64'),encoding:'base64'}),
    },{label:`arquivo ${dest}`,progress})
    tree.push({path:dest,mode:'100644',type:'blob',sha:blob.sha})
    blobsCriados++;enviados++
    onProgress?.({phase:'files',label:op,message:`${index+1}/${files.length} · ${dest} · blob enviado`,state:'done',progress,details:{file:dest,operation:op,mode:'blob',index:index+1,total:files.length}})
  }

  if(tree.length===0){
    onProgress?.({phase:'verify',label:'Sem alterações',message:`Os ${inalterados} arquivo(s) já correspondem ao conteúdo do GitHub.`,progress:99,state:'done'})
    return {
      changed:false,branch:base.branch,commitSha:base.parentSha,
      commitUrl:`https://github.com/${owner}/${repo}/commit/${base.parentSha}`,
      enviados:0,removidos:0,inalterados,inlineTree:0,blobsCriados:0,initializedRepository,
      verified:true,verifiedAt:new Date().toISOString(),
    }
  }

  onProgress?.({phase:'tree',label:'Árvore Git',message:`Enviando uma árvore única com ${enviados} alteração(ões)${removidos?` e ${removidos} remoção(ões)`:''}…`,progress:82})
  const treeBody={tree}
  if(base.baseTreeSha) treeBody.base_tree=base.baseTreeSha
  const newTree=await writeGithub(`/repos/${owner}/${repo}/git/trees`,{
    method:'POST',body:JSON.stringify(treeBody),
  },{label:'árvore Git',progress:82})

  if(base.baseTreeSha && newTree.sha===base.baseTreeSha){
    return {
      changed:false,branch:base.branch,commitSha:base.parentSha,
      commitUrl:`https://github.com/${owner}/${repo}/commit/${base.parentSha}`,
      enviados:0,removidos:0,inalterados,inlineTree,blobsCriados,initializedRepository,
      verified:true,verifiedAt:new Date().toISOString(),
    }
  }

  onProgress?.({phase:'commit',label:'Commit',message:'Criando o commit da publicação…',progress:88})
  const commitBody={message:String(message||'Publicação pelo AL Sistemas').slice(0,240),tree:newTree.sha,parents:base.parentSha?[base.parentSha]:[]}
  const commit=await writeGithub(`/repos/${owner}/${repo}/git/commits`,{
    method:'POST',body:JSON.stringify(commitBody),
  },{label:'commit',progress:88})

  onProgress?.({phase:'ref',label:'Branch',message:`Atualizando ${base.branch} para o novo commit…`,progress:93})
  let updatedRef=null
  if(base.exists){
    updatedRef=await writeGithub(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(base.branch)}`,{
      method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false}),
    },{label:`branch ${base.branch}`,progress:93})
  }else{
    updatedRef=await writeGithub(`/repos/${owner}/${repo}/git/refs`,{
      method:'POST',body:JSON.stringify({ref:`refs/heads/${base.branch}`,sha:commit.sha}),
    },{label:`branch ${base.branch}`,progress:93})
  }

  // A resposta da própria mutação já é a primeira confirmação de que o GitHub
  // aceitou o novo SHA. A leitura da ref pode ficar alguns instantes atrás da
  // escrita, então reconsultamos com pequenos intervalos em vez de acusar um
  // falso negativo imediatamente.
  const mutationConfirmed=updatedRef?.object?.sha===commit.sha
  onProgress?.({phase:'verify',label:'Verificação GitHub',message:'Confirmando o commit diretamente na branch publicada…',progress:96})

  let verifyRef=null
  let verifyCommit=null
  let verified=false
  let branchAdvanced=false
  const verifyDelays=[0,350,800,1500,2500]
  for(let attempt=0;attempt<verifyDelays.length;attempt++){
    if(verifyDelays[attempt]) await sleep(verifyDelays[attempt])
    try{
      verifyRef=await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base.branch)}`,{headers:{'Cache-Control':'no-cache'}})
      verifyCommit=await githubFetch(`/repos/${owner}/${repo}/git/commits/${commit.sha}`,{headers:{'Cache-Control':'no-cache'}})
      const refSha=verifyRef?.object?.sha||''
      const commitExists=Boolean(verifyCommit?.tree?.sha)
      if(refSha===commit.sha && commitExists){verified=true;break}

      // Se outra publicação avançou a branch logo depois desta, o commit ainda
      // pode estar corretamente no histórico. Confirmamos isso pela comparação.
      if(refSha && refSha!==commit.sha && commitExists){
        try{
          const compare=await githubFetch(`/repos/${owner}/${repo}/compare/${commit.sha}...${refSha}`,{headers:{'Cache-Control':'no-cache'}})
          if(['ahead','identical'].includes(String(compare?.status||'').toLowerCase())){
            verified=true
            branchAdvanced=true
            break
          }
        }catch{/* a próxima tentativa de leitura ainda pode confirmar normalmente */}
      }
    }catch(err){
      if(attempt===verifyDelays.length-1 && !mutationConfirmed) throw err
    }

    if(attempt===0 && !verified){
      onProgress?.({
        phase:'verify',label:'Sincronizando GitHub',
        message:'A atualização da branch foi aceita; aguardando a leitura da API refletir o novo commit…',
        progress:97,state:'active',details:{attempt:attempt+1,expectedSha:commit.sha},
      })
    }
  }

  // Se o PATCH/POST retornou explicitamente o SHA correto e o commit existe,
  // não transformamos uma leitura eventualmente atrasada em falha da publicação.
  if(!verified && mutationConfirmed){
    try{
      verifyCommit=verifyCommit||await githubFetch(`/repos/${owner}/${repo}/git/commits/${commit.sha}`,{headers:{'Cache-Control':'no-cache'}})
      const observedSha=verifyRef?.object?.sha||''
      // Aceita a confirmação da própria mutação quando a leitura ainda não veio
      // ou continua mostrando exatamente o head anterior (cenário de propagação
      // observado na API). Um SHA terceiro/divergente continua sendo erro real.
      verified=Boolean(verifyCommit?.tree?.sha) && (!observedSha || observedSha===base.parentSha)
    }catch{/* tratado abaixo com mensagem diagnóstica */}
  }

  if(!verified){
    const expected=commit.sha
    const observed=verifyRef?.object?.sha||'não retornado'
    const e=new Error(`O GitHub criou o commit ${expected.slice(0,7)}, mas a branch ${base.branch} não pôde ser confirmada após novas tentativas (SHA observado: ${String(observed).slice(0,12)}).`)
    e.status=502
    throw e
  }

  onProgress?.({
    phase:'verify',label:'Verificação GitHub',
    message:branchAdvanced
      ? `Commit ${commit.sha.slice(0,7)} confirmado no histórico de ${base.branch}; a branch já avançou para um commit mais novo.`
      : `Commit ${commit.sha.slice(0,7)} confirmado na branch ${base.branch}.`,
    progress:99,state:'done',
  })
  return {
    changed:true,branch:base.branch,commitSha:commit.sha,
    commitUrl:commit.html_url||`https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    treeSha:verifyCommit?.tree?.sha||newTree.sha,enviados,removidos,inalterados,inlineTree,blobsCriados,
    initializedRepository,verified:true,verifiedAt:new Date().toISOString(),branchAdvanced,
  }
}

const PROJETOS_DIR = process.env.PROJETOS_PATH
  ? path.resolve(process.cwd(), process.env.PROJETOS_PATH)
  : path.join(process.cwd(), '..', 'projetos')

function validarNome(str) {
  return /^[a-zA-Z0-9._-]+$/.test(str)
}

// Resumo técnico leve para enriquecer a listagem sem transformar cada card
// em uma auditoria completa. Cache curto reduz chamadas à API do GitHub.
const repoInsightCache = new Map()

async function repoReadText(owner, repo, filePath, branch='main') {
  try {
    const encoded = String(filePath || '').split('/').filter(Boolean).map(encodeURIComponent).join('/')
    const data = await githubFetch(`/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`)
    if (!data?.content || data.encoding !== 'base64') return null
    return Buffer.from(String(data.content).replace(/\n/g, ''), 'base64').toString('utf8')
  } catch (err) {
    if (Number(err?.status) === 404) return null
    throw err
  }
}

async function repoReadJson(owner, repo, filePath, branch='main') {
  const text = await repoReadText(owner, repo, filePath, branch)
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

function depSet(...packages) {
  const out = new Set()
  for (const pkg of packages.filter(Boolean)) {
    for (const key of Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) })) out.add(key)
  }
  return out
}

function firstNonEmpty(...values) {
  return values.map(v => String(v ?? '').trim()).find(Boolean) || null
}

function titleProjectName(value='') {
  const raw = String(value || '').trim().replace(/^@[^/]+\//, '')
  if (!raw) return null
  if (/^al[-_ ]?sistemas$/i.test(raw) || /^alsistemas$/i.test(raw)) return 'AL Sistemas'
  return raw.split(/[-_]+/).filter(Boolean).map(x => x.length <= 3 ? x.toUpperCase() : x[0].toUpperCase() + x.slice(1)).join(' ')
}

// Fonte canônica de metadados do repositório. Todas as telas devem reutilizar
// estes dados para nome, versão, tipo, frameworks, plataforma e package manager.
// Cache curto evita várias interpretações divergentes e reduz chamadas ao GitHub.
async function montarRepoInsight(owner, repo, branch='main', { fresh = false } = {}) {
  const key = `${owner}/${repo}@${branch}`
  const cached = repoInsightCache.get(key)
  if (!fresh && cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data

  const rootRaw = await githubFetch(`/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(branch)}`)
  const root = Array.isArray(rootRaw) ? rootRaw : []
  const rootNames = new Set(root.map(i => String(i.name || '').toLowerCase()))
  const dirs = root.filter(i => i.type === 'dir').map(i => String(i.name || ''))
  const files = root.filter(i => i.type === 'file').map(i => String(i.name || ''))

  const [manifest, rootPkg, frontendPkg, backendPkg, capacitorJson, capacitorTs, pyprojectText, composer, pomText] = await Promise.all([
    rootNames.has('al-sistemas.json') ? repoReadJson(owner, repo, 'al-sistemas.json', branch) : null,
    rootNames.has('package.json') ? repoReadJson(owner, repo, 'package.json', branch) : null,
    rootNames.has('frontend') ? repoReadJson(owner, repo, 'frontend/package.json', branch) : null,
    rootNames.has('backend') ? repoReadJson(owner, repo, 'backend/package.json', branch) : null,
    rootNames.has('capacitor.config.json') ? repoReadJson(owner, repo, 'capacitor.config.json', branch) : null,
    (rootNames.has('capacitor.config.ts') || rootNames.has('capacitor.config.js')) ? repoReadText(owner, repo, rootNames.has('capacitor.config.ts') ? 'capacitor.config.ts' : 'capacitor.config.js', branch) : null,
    rootNames.has('pyproject.toml') ? repoReadText(owner, repo, 'pyproject.toml', branch) : null,
    rootNames.has('composer.json') ? repoReadJson(owner, repo, 'composer.json', branch) : null,
    rootNames.has('pom.xml') ? repoReadText(owner, repo, 'pom.xml', branch) : null,
  ])

  const deps = depSet(rootPkg, frontendPkg, backendPkg)
  const frameworks = []
  const add = x => { if (x && !frameworks.includes(x)) frameworks.push(x) }
  if (deps.has('react') || deps.has('react-dom')) add('React')
  if (deps.has('vite')) add('Vite')
  if (deps.has('next')) add('Next.js')
  if (deps.has('vue')) add('Vue')
  if (deps.has('@angular/core')) add('Angular')
  if (deps.has('svelte')) add('Svelte')
  if (deps.has('express')) add('Express')
  if (deps.has('fastify')) add('Fastify')
  if (deps.has('@nestjs/core')) add('NestJS')
  if (deps.has('@capacitor/core') || capacitorJson || capacitorTs) add('Capacitor')
  if (deps.has('electron')) add('Electron')
  if (pyprojectText && /\bdjango\b/i.test(pyprojectText)) add('Django')
  if (pyprojectText && /\bfastapi\b/i.test(pyprojectText)) add('FastAPI')
  if (composer?.require?.['laravel/framework']) add('Laravel')
  if (pomText && /spring-boot/i.test(pomText)) add('Spring Boot')

  const frontendDetected = Boolean(frontendPkg || ['React','Vite','Next.js','Vue','Angular','Svelte'].some(x => frameworks.includes(x)) || rootNames.has('index.html'))
  const backendDetected = Boolean(backendPkg || ['Express','Fastify','NestJS','Django','FastAPI','Laravel','Spring Boot'].some(x => frameworks.includes(x)) || pyprojectText || composer || pomText)
  const androidDetected = Boolean(rootNames.has('android') || rootNames.has('build.gradle') || rootNames.has('build.gradle.kts') || frameworks.includes('Capacitor'))

  let tipo = 'Repositório de código'
  if (frontendDetected && backendDetected) tipo = 'Aplicação Full-stack'
  else if (frontendDetected) tipo = 'Aplicação Frontend'
  else if (backendDetected) tipo = 'Serviço Backend'
  else if (androidDetected) tipo = 'Aplicativo Android'
  else if (rootPkg) tipo = 'Projeto Node.js'
  else if (pyprojectText) tipo = 'Projeto Python'
  else if (composer) tipo = 'Projeto PHP'
  else if (pomText) tipo = 'Projeto Java'
  else if (files.some(n => /\.(sh|bash|fish)$/i.test(n))) tipo = 'Automação / CLI'
  else if (rootNames.has('index.html')) tipo = 'Aplicação Web'

  let packageManager = null
  const allRoot = new Set([...rootNames])
  if (allRoot.has('pnpm-lock.yaml') || allRoot.has('pnpm-workspace.yaml')) packageManager = 'pnpm'
  else if (allRoot.has('yarn.lock')) packageManager = 'Yarn'
  else if (allRoot.has('bun.lockb') || allRoot.has('bun.lock')) packageManager = 'Bun'
  else if (allRoot.has('package-lock.json')) packageManager = 'npm'
  else if (rootPkg || frontendPkg || backendPkg) packageManager = 'npm'
  else if (pyprojectText) packageManager = /poetry/i.test(pyprojectText) ? 'Poetry' : 'pip'
  else if (composer) packageManager = 'Composer'
  else if (pomText) packageManager = 'Maven'

  const produtoRaw = firstNonEmpty(manifest?.product, manifest?.name, rootPkg?.displayName, rootPkg?.productName, rootPkg?.name, frontendPkg?.displayName, frontendPkg?.name)
  const produto = produtoRaw ? titleProjectName(produtoRaw) : titleProjectName(repo)
  const versao = firstNonEmpty(manifest?.version, rootPkg?.version, frontendPkg?.version, backendPkg?.version)
  const versionSources = [
    manifest?.version && { path:'al-sistemas.json', value:String(manifest.version) },
    rootPkg?.version && { path:'package.json', value:String(rootPkg.version) },
    frontendPkg?.version && { path:'frontend/package.json', value:String(frontendPkg.version) },
    backendPkg?.version && { path:'backend/package.json', value:String(backendPkg.version) },
  ].filter(Boolean)

  const deploy = [
    (rootNames.has('vercel.json') || rootNames.has('.vercel')) && 'Vercel',
    (rootNames.has('render.yaml') || rootNames.has('render.yml')) && 'Render',
    rootNames.has('railway.toml') && 'Railway',
    rootNames.has('dockerfile') && 'Docker',
  ].filter(Boolean)
  let workflows = []
  if (rootNames.has('.github')) {
    try {
      const wf = await githubFetch(`/repos/${owner}/${repo}/contents/.github/workflows?ref=${encodeURIComponent(branch)}`)
      workflows = (Array.isArray(wf) ? wf : []).filter(i => i.type === 'file' && /\.ya?ml$/i.test(i.name || '')).map(i => i.name)
    } catch { workflows = [] }
  }

  const plataforma = [androidDetected && 'Android', frameworks.includes('Capacitor') && 'Capacitor', frontendDetected && 'Web', backendDetected && 'Servidor'].filter(Boolean)
  const stack = frameworks.length ? frameworks : [rootPkg ? 'Node.js' : pyprojectText ? 'Python' : composer ? 'PHP' : pomText ? 'Java' : null].filter(Boolean)
  const qualidade = [rootNames.has('readme.md') && 'README', workflows.length && 'GitHub Actions', (rootNames.has('.env.example') || rootNames.has('.env.sample')) && '.env exemplo'].filter(Boolean)

  const data = {
    produto, versao, versionSources, tipo, framework:frameworks[0] || null, frameworks, stack,
    frontend:frontendDetected, backend:backendDetected, android:androidDetected,
    plataforma, packageManager, deploy, workflows, hasCI:workflows.length > 0,
    qualidade, pastas:dirs.slice(0,12), arquivosRaiz:files.slice(0,30),
    resumo: `${produto ? `${produto}${versao ? ` · v${versao}` : ''} · ` : ''}${tipo}${frameworks.length ? ` · ${frameworks.join(' / ')}` : ''}`,
  }
  repoInsightCache.set(key, { at: Date.now(), data })
  return data
}

/* ═══════════════════════════════════════════════════════════
   CRIAR REPOSITÓRIO — Sprint 10
   Cria um novo repositório na conta autenticada (user ou org).

   POST /api/github/repos/criar
   Body: { nome, descricao?, privado?, org? }
═══════════════════════════════════════════════════════════ */
router.get('/orgs', autenticar, async (_req, res) => {
  try {
    const orgs = await githubFetch('/user/orgs?per_page=100')
    res.json({ orgs: Array.isArray(orgs) ? orgs.map(o => ({ login:o.login, avatar:o.avatar_url, descricao:o.description||'' })) : [] })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

router.post('/repos/criar', autenticar, async (req, res) => {
  const {
    nome, descricao = '', privado = true, org, homepage = '',
    issues = true, projects = true, wiki = false, discussions = false,
  } = req.body || {}
  if (!nome || !/^[a-zA-Z0-9._-]{1,100}$/.test(nome))
    return res.status(400).json({ erro: 'Nome de repositório inválido.' })
  if (org && !/^[a-zA-Z0-9._-]{1,100}$/.test(String(org)))
    return res.status(400).json({ erro: 'Organização GitHub inválida.' })

  try {
    const endpoint = org ? `/orgs/${org}/repos` : '/user/repos'
    const repo = await githubFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        name: nome,
        description: String(descricao || '').slice(0, 350),
        homepage: String(homepage || '').trim() || undefined,
        private: Boolean(privado),
        has_issues: Boolean(issues),
        has_projects: Boolean(projects),
        has_wiki: Boolean(wiki),
        has_discussions: Boolean(discussions),
        auto_init: true,
      }),
    })
    res.json({
      ok: true,
      nomeCompleto: repo.full_name,
      owner: repo.owner.login,
      repo: repo.name,
      url: repo.html_url,
      privado: repo.private,
      defaultBranch: repo.default_branch || 'main',
      descricao: repo.description || '',
      homepage: repo.homepage || '',
    })
  } catch (err) {
    const status = err.status || 500
    const msg = status === 422 ? `Não foi possível criar "${nome}". O nome pode já existir ou alguma opção não é permitida pela conta.` : err.message
    res.status(status).json({ erro: msg })
  }
})

/* ═══════════════════════════════════════════════════════════
   ROTAS ORIGINAIS (preservadas)
═══════════════════════════════════════════════════════════ */

router.get('/status', autenticar, async (req, res) => {
  try {
    const user = await githubFetch('/user')
    res.json({
      ok: true, login: user.login, nome: user.name,
      avatar: user.avatar_url, repos: user.public_repos,
      reposPublicos: user.public_repos || 0,
      reposPrivados: user.total_private_repos ?? null,
      seguidores: user.followers || 0,
      seguindo: user.following || 0,
      criadoEm: user.created_at || null,
      empresa: user.company, url: user.html_url,
      bio: user.bio || '', localizacao: user.location || '', blog: user.blog || '',
      email: user.email || '', contratavel: !!user.hireable, twitter: user.twitter_username || '',
    })
  } catch (err) {
    if (err.message.includes('GITHUB_TOKEN')) return res.status(503).json({ ok: false, erro: err.message })
    res.status(err.status || 500).json({ ok: false, erro: err.message })
  }
})

/* PATCH /api/github/profile — usa a credencial central de Integrações e APIs */
router.patch('/profile', autenticar, async (req, res) => {
  const permitido = ['name', 'email', 'blog', 'company', 'location', 'hireable', 'bio', 'twitter_username']
  const payload = {}
  for (const chave of permitido) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, chave)) payload[chave] = req.body[chave]
  }
  if (!Object.keys(payload).length) return res.status(400).json({ erro: 'Nenhum campo de perfil foi informado.' })
  try {
    const user = await githubFetch('/user', { method: 'PATCH', body: JSON.stringify(payload) })
    await AuditLog.create({
      admin_id: req.usuario._id, admin_email: req.usuario.email, acao: 'editar', recurso: 'github_perfil',
      recurso_id: user.login, payload: { campos: Object.keys(payload) }, ip: req.ip, request_id: req.requestId || null,
    }).catch(() => {})
    res.json({
      ok: true, login: user.login, nome: user.name, avatar: user.avatar_url, url: user.html_url,
      empresa: user.company, bio: user.bio || '', localizacao: user.location || '', blog: user.blog || '',
      email: user.email || '', contratavel: !!user.hireable, twitter: user.twitter_username || '',
      mensagem: 'Perfil atualizado no GitHub.'
    })
  } catch (err) {
    const msg = err.status === 403
      ? 'O token salvo em Integrações e APIs não tem permissão para editar o perfil. Em token fine-grained, habilite Profile: write; em token classic, use o escopo user.'
      : err.message
    res.status(err.status || 500).json({ erro: msg })
  }
})

router.get('/repos', autenticar, async (req, res) => {
  const { page = 1, per_page = 30, sort = 'updated', type = 'all' } = req.query
  try {
    // Fonte única: a credencial cadastrada em Integrações e APIs. A listagem
    // autenticada já respeita exatamente os repositórios liberados para o token.
    // GitHub não permite combinar `type` e `affiliation` neste endpoint.
    let repos = await githubFetch(`/user/repos?sort=${sort}&per_page=${per_page}&page=${page}&affiliation=owner,collaborator,organization_member`)
    if (type === 'public') repos = repos.filter(r => !r.private)
    else if (type === 'private') repos = repos.filter(r => r.private)
    let lista = repos.map(r => ({
      id: r.id, nome: r.name, nomeCompleto: r.full_name, descricao: r.description,
      privado: r.private, visibilidade: r.visibility || (r.private ? 'private' : 'public'),
      url: r.html_url, homepage: r.homepage || null, linguagem: r.language,
      stars: r.stargazers_count, forks: r.forks_count, watchers: r.watchers_count,
      issues: r.open_issues_count, branch: r.default_branch,
      tamanho: r.size || 0, ultimoPush: r.pushed_at || null,
      ultimaAtualizacao: r.updated_at, criadoEm: r.created_at,
      temas: r.topics || [], arquivado: r.archived, fork: r.fork,
      licenca: r.license?.spdx_id || r.license?.name || null,
      permissoes: r.permissions || null,
      ativo: !r.archived && Boolean(r.pushed_at) && (Date.now() - new Date(r.pushed_at).getTime()) <= 90 * 86400000,
    }))
    if (String(req.query.enrich || '') === '1') {
      const enriquecidos = await Promise.allSettled(lista.map(async item => ({
        ...item,
        insight: await montarRepoInsight(item.nomeCompleto.split('/')[0], item.nome, item.branch || 'main'),
      })))
      lista = enriquecidos.map((r, i) => r.status === 'fulfilled' ? r.value : lista[i])
    }
    res.json({ repos: lista, total: lista.length, activeRuleDays: 90 })
  } catch (err) {
    if (err.message.includes('GITHUB_TOKEN')) return res.status(503).json({ erro: err.message, repos: [] })
    res.status(err.status || 500).json({ erro: err.message, repos: [] })
  }
})

router.get('/repos/:owner/:repo/insight', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome de repositório inválido.' })
  try {
    const branch = String(req.query.branch || 'main')
    res.json(await montarRepoInsight(owner, repo, branch))
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

router.get('/repos/:owner/:repo', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome de repositório inválido.' })
  try {
    const [repoData, languages] = await Promise.all([
      githubFetch(`/repos/${owner}/${repo}`),
      githubFetch(`/repos/${owner}/${repo}/languages`).catch(() => ({})),
    ])
    res.json({
      id: repoData.id, nome: repoData.name, nomeCompleto: repoData.full_name,
      descricao: repoData.description, homepage: repoData.homepage || null, privado: repoData.private, url: repoData.html_url,
      linguagem: repoData.language, linguagens: Object.keys(languages),
      stars: repoData.stargazers_count, forks: repoData.forks_count,
      issues: repoData.open_issues_count, branch: repoData.default_branch,
      temas: repoData.topics || [], arquivado: repoData.archived,
      ultimaAtualizacao: repoData.updated_at, ultimoPush: repoData.pushed_at || null, criadoEm: repoData.created_at,
      license: repoData.license?.name || null, tamanho: repoData.size, permissoes: repoData.permissions || null,
    })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

/* ═══════════════════════════════════════════════════════════
   ROTAS NOVAS — Sprint 3 Extensão
═══════════════════════════════════════════════════════════ */

/* PATCH /api/github/repos/:owner/:repo — descrição/homepage oficiais do GitHub */
router.patch('/repos/:owner/:repo', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  const payload = {}
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'descricao')) payload.description = String(req.body.descricao ?? '').slice(0, 350)
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'homepage')) payload.homepage = String(req.body.homepage ?? '').trim().slice(0, 500)
  if (!Object.keys(payload).length) return res.status(400).json({ erro: 'Informe descrição e/ou homepage.' })
  try {
    const atualizado = await githubFetch(`/repos/${owner}/${repo}`, { method: 'PATCH', body: JSON.stringify(payload) })
    repoInsightCache.delete(`${owner}/${repo}@${atualizado.default_branch || 'main'}`)
    await AuditLog.create({
      admin_id: req.usuario._id, admin_email: req.usuario.email, acao: 'editar', recurso: 'github_repo_detalhes',
      recurso_id: `${owner}/${repo}`, payload: { campos: Object.keys(payload) }, ip: req.ip, request_id: req.requestId || null,
    }).catch(() => {})
    res.json({
      ok: true, id: atualizado.id, nome: atualizado.name, nomeCompleto: atualizado.full_name,
      descricao: atualizado.description || '', homepage: atualizado.homepage || '', url: atualizado.html_url,
      branch: atualizado.default_branch, permissoes: atualizado.permissions || null,
      mensagem: 'Detalhes do repositório atualizados no GitHub.'
    })
  } catch (err) {
    const msg = err.status === 403
      ? 'O token salvo em Integrações e APIs não tem permissão para editar este repositório. Em token fine-grained, habilite Administration: write para o repositório.'
      : err.message
    res.status(err.status || 500).json({ erro: msg })
  }
})



/* POST /api/github/repos/:owner/:repo/descricao-ia
   Sugere texto sem salvar automaticamente no GitHub. Usa Gemini/OpenRouter
   configurados em Integrações e APIs e somente dados reais do repositório. */
router.post('/repos/:owner/:repo/descricao-ia', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  try {
    const [repoInfo, readmeData] = await Promise.all([
      githubFetch(`/repos/${owner}/${repo}`),
      githubFetch(`/repos/${owner}/${repo}/readme`).catch(() => null),
    ])
    const readme = readmeData?.content ? Buffer.from(readmeData.content, 'base64').toString('utf8') : ''
    const suggestion = await sugerirDescricaoRepositorio({
      nome: repoInfo.full_name || `${owner}/${repo}`,
      descricaoAtual: repoInfo.description || '',
      linguagem: repoInfo.language || '',
      topicos: repoInfo.topics || [],
      readme,
      provedor: req.body?.provedor || undefined,
    })
    res.json({ ok:true, ...suggestion, aviso:'Sugestão gerada pela IA. Revise antes de salvar no GitHub.' })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message || 'Não foi possível gerar a sugestão.' })
  }
})

/* DELETE /api/github/repos/:owner/:repo */
router.delete('/repos/:owner/:repo', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  const { confirmar, confirmarNome } = req.body
  if (!confirmar || confirmarNome !== repo) {
    return res.status(400).json({ erro: `Confirmação inválida. Envie { confirmar: true, confirmarNome: "${repo}" }` })
  }
  try {
    await githubFetch(`/repos/${owner}/${repo}`, { method: 'DELETE' })
    await AuditLog.create({
      admin_id: req.usuario._id, admin_email: req.usuario.email,
      acao: 'excluir', recurso: 'github_repo',
      recurso_id: `${owner}/${repo}`, payload: { owner, repo },
      ip: req.ip, request_id: req.requestId || null,
    })
    await GitHubMeta.deleteMany({ nomeCompleto: `${owner}/${repo}` }).catch(() => {})
    res.json({ ok: true, mensagem: `Repositório ${owner}/${repo} excluído com sucesso.` })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})



/* GET /api/github/repos/:owner/:repo/contents?path=&branch=
   Navegador de arquivos do repositório. O token permanece somente no backend. */
router.get('/repos/:owner/:repo/contents', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  const branch = String(req.query.branch || '').trim()
  const rel = String(req.query.path || '').replace(/^\/+|\/+$/g, '')
  if (rel.includes('..')) return res.status(400).json({ erro: 'Caminho inválido.' })
  try {
    const repoInfo = await githubFetch(`/repos/${owner}/${repo}`)
    const ref = branch || repoInfo.default_branch || 'main'
    const endpoint = `/repos/${owner}/${repo}/contents${rel ? '/' + rel.split('/').map(encodeURIComponent).join('/') : ''}?ref=${encodeURIComponent(ref)}`
    const data = await githubFetch(endpoint)
    const raw = Array.isArray(data) ? data : [data]
    const itens = raw.map(i => {
      const tipo = i.type === 'dir' ? 'pasta' : 'arquivo'
      const extra = tipo === 'arquivo' ? fileKindInfo(i.name, i.size || 0) : { extensao:null, tipoArquivo:'Pasta' }
      return {
        nome: i.name, path: i.path, tipo,
        tamanho: i.size || 0, sha: i.sha, url: i.html_url || null, downloadUrl: i.download_url || null,
        ...extra,
      }
    }).sort((a,b) => a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : (a.tipo === 'pasta' ? -1 : 1))
    const resumo = {
      itens: itens.length,
      pastas: itens.filter(i => i.tipo === 'pasta').length,
      arquivos: itens.filter(i => i.tipo === 'arquivo').length,
      bytesVisiveis: itens.filter(i => i.tipo === 'arquivo').reduce((n, i) => n + Number(i.tamanho || 0), 0),
    }
    res.json({
      itens, path: rel, branch: ref, repo: `${owner}/${repo}`, resumo,
      repositorio: {
        defaultBranch: repoInfo.default_branch || 'main', privado: Boolean(repoInfo.private),
        criadoEm: repoInfo.created_at || null, atualizadoEm: repoInfo.updated_at || null,
        ultimoPushEm: repoInfo.pushed_at || null, tamanhoKb: Number(repoInfo.size || 0),
      },
    })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message, itens: [] })
  }
})

/* GET /api/github/repos/:owner/:repo/content-info?path=&branch=
   Metadados sob demanda: evita uma chamada de commits para cada item da listagem. */
router.get('/repos/:owner/:repo/content-info', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  const target = String(req.query.path || '').replace(/^\/+|\/+$/g, '')
  const branchInput = String(req.query.branch || '').trim()
  if (!target || target.includes('..')) return res.status(400).json({ erro: 'Caminho inválido.' })
  try {
    const repoInfo = await githubFetch(`/repos/${owner}/${repo}`)
    const branch = branchInput || repoInfo.default_branch || 'main'
    const encoded = target.split('/').map(encodeURIComponent).join('/')
    const [content, commits] = await Promise.all([
      githubFetch(`/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`),
      githubFetch(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(target)}&per_page=1`).catch(() => []),
    ])
    const latest = Array.isArray(commits) ? commits[0] : null
    const isDir = Array.isArray(content) || content?.type === 'dir'
    const tipo = isDir ? 'pasta' : 'arquivo'
    const folderItems = Array.isArray(content) ? content : []
    const tamanho = isDir ? folderItems.reduce((n,i)=>n+Number(i.size||0),0) : Number(content?.size || 0)
    const extra = tipo === 'arquivo' ? fileKindInfo(content?.name || target, tamanho) : { extensao:null, tipoArquivo:'Pasta' }
    let preview = null, previewTruncated = false
    const sensitivePreview = /(^|\/)(\.env(?:\.|$)|.*\.(?:pem|key|p12|pfx)|id_rsa|id_ed25519|credentials?\.json|secrets?\.(?:json|ya?ml))$/i.test(target)
    if (!isDir && !sensitivePreview && tamanho <= 200 * 1024 && content?.content && content?.encoding === 'base64') {
      try {
        const buf = Buffer.from(content.content, 'base64')
        const binary = buf.subarray(0, Math.min(buf.length, 4096)).includes(0)
        if (!binary) {
          const text = buf.toString('utf8')
          previewTruncated = text.length > 12000
          preview = text.slice(0, 12000)
        }
      } catch {}
    }
    res.json({
      nome: isDir ? path.basename(target) : (content?.name || path.basename(target)), path: isDir ? target : (content?.path || target), tipo,
      tamanho, sha: isDir ? null : (content?.sha || null), branch,
      filhos: isDir ? { itens:folderItems.length, pastas:folderItems.filter(i=>i.type==='dir').length, arquivos:folderItems.filter(i=>i.type==='file').length } : null,
      url: isDir ? `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branch)}/${target}` : (content?.html_url || null),
      downloadUrl: isDir ? null : (content?.download_url || null), preview, previewTruncated, previewBloqueada:sensitivePreview, ...extra,
      ultimaAlteracao: latest ? {
        sha: latest.sha || null, mensagem: latest.commit?.message || '',
        autor: latest.commit?.author?.name || latest.author?.login || '',
        email: latest.commit?.author?.email || '', data: latest.commit?.author?.date || latest.commit?.committer?.date || null,
        url: latest.html_url || null,
      } : null,
      repositorio: { criadoEm: repoInfo.created_at || null, ultimoPushEm: repoInfo.pushed_at || null },
    })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

/* DELETE /api/github/repos/:owner/:repo/contents/batch
   Remove vários arquivos/pastas ou todo o conteúdo da pasta atual em um único commit. */
router.delete('/repos/:owner/:repo/contents/batch', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  const branchInput = String(req.body?.branch || '').trim()
  const mode = String(req.body?.mode || 'selected')
  const currentPath = String(req.body?.currentPath || '').replace(/^\/+|\/+$/g, '')
  const requested = Array.isArray(req.body?.paths) ? req.body.paths.map(v => String(v || '').replace(/^\/+|\/+$/g, '')).filter(Boolean) : []
  if (currentPath.includes('..') || requested.some(v => v.includes('..'))) return res.status(400).json({ erro: 'Caminho inválido.' })
  if (!['selected', 'current'].includes(mode)) return res.status(400).json({ erro: 'Modo de exclusão inválido.' })
  if (mode === 'selected' && (!requested.length || requested.length > 250)) return res.status(400).json({ erro: 'Selecione entre 1 e 250 itens.' })
  const confirmation = String(req.body?.confirmar || '').trim().toUpperCase()
  const expected = mode === 'current' ? 'APAGAR TUDO' : 'APAGAR SELECIONADOS'
  if (confirmation !== expected) return res.status(400).json({ erro: `Digite ${expected} para confirmar.` })
  try {
    const repoInfo = await githubFetch(`/repos/${owner}/${repo}`)
    const branch = branchInput || repoInfo.default_branch || 'main'
    const ref = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)
    const parentSha = ref.object?.sha
    const parent = await githubFetch(`/repos/${owner}/${repo}/git/commits/${parentSha}`)
    const treeSha = parent.tree?.sha
    const tree = await githubFetch(`/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`)
    const blobs = (tree.tree || []).filter(e => e.type === 'blob')
    const selected = mode === 'current'
      ? blobs.filter(e => !currentPath || e.path === currentPath || e.path.startsWith(currentPath + '/'))
      : blobs.filter(e => requested.some(t => e.path === t || e.path.startsWith(t + '/')))
    const unique = Array.from(new Map(selected.map(e => [e.path, e])).values())
    if (!unique.length) return res.status(404).json({ erro: 'Nenhum arquivo correspondente foi encontrado nessa branch.' })
    const deletionTree = await githubFetch(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST', body: JSON.stringify({ base_tree: treeSha, tree: unique.map(e => ({ path: e.path, mode: '100644', type: 'blob', sha: null })) }),
    })
    const label = mode === 'current' ? (currentPath ? `conteúdo de ${currentPath}` : 'todo o conteúdo do repositório') : `${requested.length} item(ns) selecionado(s)`
    const commit = await githubFetch(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST', body: JSON.stringify({ message: `Remove ${label} via AL Sistemas`, tree: deletionTree.sha, parents: [parentSha] }),
    })
    await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }),
    })
    const bytes = unique.reduce((n, e) => n + Number(e.size || 0), 0)
    await AuditLog.create({
      admin_id: req.usuario._id, admin_email: req.usuario.email, acao: 'excluir', recurso: 'github_conteudo_lote',
      recurso_id: `${owner}/${repo}:${currentPath || '/'}`, payload: { owner, repo, branch, mode, currentPath, paths: requested, arquivos: unique.length, bytes },
      ip: req.ip, request_id: req.requestId || null,
    }).catch(() => {})
    repoInsightCache.delete(`${owner}/${repo}@${branch}`)
    res.json({ ok:true, removidos:unique.length, bytes, branch, mode, currentPath, commitSha:commit.sha,
      commitUrl:`https://github.com/${owner}/${repo}/commit/${commit.sha}` })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

/* DELETE /api/github/repos/:owner/:repo/contents
   Remove arquivo OU pasta inteira em um único commit Git, com confirmação explícita. */
router.delete('/repos/:owner/:repo/contents', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  const target = String(req.body?.path || '').replace(/^\/+|\/+$/g, '')
  const branchInput = String(req.body?.branch || '').trim()
  if (!target || target.includes('..')) return res.status(400).json({ erro: 'Caminho inválido.' })
  if (req.body?.confirmar !== true || String(req.body?.confirmarPath || '') !== target) {
    return res.status(400).json({ erro: 'Confirme exatamente o arquivo/pasta que será removido.' })
  }
  try {
    const repoInfo = await githubFetch(`/repos/${owner}/${repo}`)
    const branch = branchInput || repoInfo.default_branch || 'main'
    const ref = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)
    const parentSha = ref.object?.sha
    const parent = await githubFetch(`/repos/${owner}/${repo}/git/commits/${parentSha}`)
    const treeSha = parent.tree?.sha
    const tree = await githubFetch(`/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`)
    const prefix = target + '/'
    const matches = (tree.tree || []).filter(e => e.type === 'blob' && (e.path === target || e.path.startsWith(prefix)))
    if (!matches.length) return res.status(404).json({ erro: 'Arquivo ou pasta não encontrado nessa branch.' })
    const deletionTree = await githubFetch(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: treeSha, tree: matches.map(e => ({ path: e.path, mode: '100644', type: 'blob', sha: null })) }),
    })
    const commit = await githubFetch(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message: `Remove ${target} via AL Sistemas`, tree: deletionTree.sha, parents: [parentSha] }),
    })
    await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }),
    })
    await AuditLog.create({
      admin_id: req.usuario._id, admin_email: req.usuario.email, acao: 'excluir', recurso: 'github_conteudo',
      recurso_id: `${owner}/${repo}:${target}`, payload: { owner, repo, branch, path: target, arquivos: matches.length },
      ip: req.ip, request_id: req.requestId || null,
    }).catch(() => {})
    res.json({ ok: true, removidos: matches.length, path: target, branch, commitSha: commit.sha,
      commitUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}` })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})


/* Resíduos locais que nunca devem fazer parte de um repositório publicado.
   Mantemos a lista deliberadamente conservadora: ela NÃO inclui código-fonte,
   documentação, workflows, package.json nem package-lock.json legítimo. */
const REPO_RESIDUE_RULES = [
  { id:'import_tmp', label:'Importações temporárias', test:p => p === '.import_tmp' || p.startsWith('.import_tmp/') || p.includes('/.import_tmp/') },
  { id:'logs', label:'Logs locais', test:p => p === '.logs' || p.startsWith('.logs/') || p.includes('/.logs/') || /(^|\/)logs?\/.*\.log$/i.test(p) },
  { id:'pids', label:'Processos locais', test:p => p === '.pids' || p.startsWith('.pids/') || p.includes('/.pids/') || /(^|\/)pids?\//i.test(p) },
  { id:'manager', label:'Arquivos do Manager', test:p => /(^|\/)\.manager\.(lock|conf)$/i.test(p) },
  { id:'node_modules', label:'node_modules', test:p => /(^|\/)node_modules\//.test(p) },
  { id:'env', label:'Segredos .env', test:p => /(^|\/)\.env(\..+)?$/i.test(p) && !/(^|\/)\.env\.(example|sample|template)$/i.test(p) },
  { id:'cache', label:'Caches locais', test:p => /(^|\/)(\.cache|\.vite|\.turbo|\.parcel-cache|\.eslintcache)(\/|$)/i.test(p) },
  { id:'temp', label:'Arquivos temporários', test:p => /(^|\/)(tmp|temp)(\/|$)/i.test(p) || /\.(tmp|swp|swo)$/i.test(p) },
]
function classificarResiduo(path='') {
  const p=String(path).replace(/^\/+/, '')
  return REPO_RESIDUE_RULES.find(r => r.test(p)) || null
}
async function repoTreeInfo(owner, repo, branchInput='') {
  const repoInfo = await githubFetch(`/repos/${owner}/${repo}`)
  const branch = String(branchInput || '').trim() || repoInfo.default_branch || 'main'
  const ref = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)
  const parentSha = ref.object?.sha
  const parent = await githubFetch(`/repos/${owner}/${repo}/git/commits/${parentSha}`)
  const treeSha = parent.tree?.sha
  const tree = await githubFetch(`/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`)
  return { branch, parentSha, treeSha, tree: tree.tree || [] }
}
function detectarResiduos(tree=[]) {
  return tree.filter(e => e.type === 'blob').map(e => {
    const regra=classificarResiduo(e.path)
    return regra ? { path:e.path, size:e.size||0, sha:e.sha, categoria:regra.id, categoriaLabel:regra.label } : null
  }).filter(Boolean)
}
router.get('/repos/:owner/:repo/cleanup-preview', autenticar, async (req,res) => {
  const {owner,repo}=req.params
  if(!validarNome(owner)||!validarNome(repo)) return res.status(400).json({erro:'Nome inválido.'})
  try{
    const info=await repoTreeInfo(owner,repo,req.query.branch)
    const itens=detectarResiduos(info.tree)
    const categorias={}
    for(const i of itens){ if(!categorias[i.categoria]) categorias[i.categoria]={id:i.categoria,label:i.categoriaLabel,arquivos:0,bytes:0}; categorias[i.categoria].arquivos++; categorias[i.categoria].bytes+=i.size||0 }
    res.json({ok:true,branch:info.branch,itens,totalArquivos:itens.length,totalBytes:itens.reduce((a,b)=>a+(b.size||0),0),categorias:Object.values(categorias),seguro:true})
  }catch(err){res.status(err.status||500).json({erro:err.message})}
})
router.post('/repos/:owner/:repo/cleanup', autenticar, async (req,res) => {
  const {owner,repo}=req.params
  if(!validarNome(owner)||!validarNome(repo)) return res.status(400).json({erro:'Nome inválido.'})
  if(String(req.body?.confirmar||'')!=='LIMPAR') return res.status(400).json({erro:'Digite LIMPAR para confirmar a manutenção.'})
  try{
    const info=await repoTreeInfo(owner,repo,req.body?.branch)
    const itens=detectarResiduos(info.tree)
    if(!itens.length) return res.json({ok:true,removidos:0,branch:info.branch,mensagem:'Nenhum resíduo detectado.'})
    const deletionTree=await githubFetch(`/repos/${owner}/${repo}/git/trees`,{method:'POST',body:JSON.stringify({base_tree:info.treeSha,tree:itens.map(e=>({path:e.path,mode:'100644',type:'blob',sha:null}))})})
    const commit=await githubFetch(`/repos/${owner}/${repo}/git/commits`,{method:'POST',body:JSON.stringify({message:`Limpeza segura de resíduos via AL Sistemas (${itens.length} arquivos)`,tree:deletionTree.sha,parents:[info.parentSha]})})
    await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(info.branch)}`,{method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})})
    await AuditLog.create({admin_id:req.usuario._id,admin_email:req.usuario.email,acao:'limpar',recurso:'github_residuos',recurso_id:`${owner}/${repo}`,payload:{branch:info.branch,arquivos:itens.length,paths:itens.slice(0,100).map(i=>i.path)},ip:req.ip,request_id:req.requestId||null}).catch(()=>{})
    res.json({ok:true,removidos:itens.length,branch:info.branch,commitSha:commit.sha,commitUrl:`https://github.com/${owner}/${repo}/commit/${commit.sha}`,mensagem:`${itens.length} arquivo(s) local(is) removido(s) em um único commit.`})
  }catch(err){res.status(err.status||500).json({erro:err.message})}
})

/* GET /api/github/repos/:owner/:repo/readme
   Retorna Markdown bruto + HTML GFM renderizado oficialmente pelo GitHub.
   O token continua vindo exclusivamente do cofre de Integrações e APIs. */
router.get('/repos/:owner/:repo/readme', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  try {
    const [data, rendered, repoInfo] = await Promise.all([
      githubFetch(`/repos/${owner}/${repo}/readme`),
      githubFetchText(`/repos/${owner}/${repo}/readme`, { headers: { 'Accept': 'application/vnd.github.html+json' } }),
      githubFetch(`/repos/${owner}/${repo}`).catch(() => null),
    ])
    const conteudo = Buffer.from(data.content || '', 'base64').toString('utf8')
    let html = ''
    if (conteudo && rendered) {
      html = sanitizeHtml(rendered, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'details', 'summary', 'picture', 'source', 'kbd', 's', 'del']),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          a: ['href', 'title', 'target', 'rel'],
          img: ['src', 'alt', 'title', 'width', 'height'],
          source: ['src', 'srcset', 'type'],
          '*': ['class', 'id', 'align'],
        },
        allowedSchemes: ['http', 'https', 'mailto'],
        transformTags: {
          a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }),
        },
      })
    }
    res.json({
      nome: data.name, conteudo, html, sha: data.sha, tamanho: data.size,
      branch: repoInfo?.default_branch || 'main', url: data.html_url || `https://github.com/${owner}/${repo}`,
    })
  } catch (err) {
    if (err.status === 404) return res.json({ conteudo: null, html: null })
    res.status(err.status || 500).json({ erro: err.message })
  }
})

/* GET /api/github/repos/:owner/:repo/commits */
router.get('/repos/:owner/:repo/commits', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  const per_page = Math.min(50, Math.max(1, Number(req.query.per_page || 20)))
  const page = Math.max(1, Number(req.query.page || 1))
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  try {
    const commits = await githubFetch(`/repos/${owner}/${repo}/commits?per_page=${per_page}&page=${page}`)
    const lista = commits.map(c => {
      const fullMessage = String(c.commit?.message || '')
      const [titulo, ...rest] = fullMessage.split('\n')
      return {
        sha: c.sha.slice(0, 7), shaFull: c.sha,
        mensagem: titulo || '(commit sem mensagem)', descricao: rest.join('\n').trim(),
        autor: c.commit?.author?.name || c.author?.login || 'Autor desconhecido',
        autorLogin: c.author?.login || null, email: c.commit?.author?.email || null,
        data: c.commit?.author?.date || null, url: c.html_url,
        avatar: c.author?.avatar_url || null,
        verificado: Boolean(c.commit?.verification?.verified),
        motivoVerificacao: c.commit?.verification?.reason || null,
        committer: c.commit?.committer?.name || null,
        parents: Array.isArray(c.parents) ? c.parents.map(p => p.sha).filter(Boolean) : [],
      }
    })
    res.json({ commits: lista, page, perPage: per_page, hasMore: lista.length === per_page })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message, commits: [] })
  }
})

/* GET /api/github/repos/:owner/:repo/commits/:sha — detalhes sob demanda.
   Evita multiplicar chamadas à API na listagem e só busca diff quando o usuário abre o commit. */
router.get('/repos/:owner/:repo/commits/:sha', autenticar, async (req, res) => {
  const { owner, repo, sha } = req.params
  if (!validarNome(owner) || !validarNome(repo) || !/^[a-f0-9]{7,40}$/i.test(String(sha || ''))) return res.status(400).json({ erro: 'Commit inválido.' })
  try {
    const c = await githubFetch(`/repos/${owner}/${repo}/commits/${sha}`)
    res.json({
      sha: c.sha, url: c.html_url,
      mensagem: c.commit?.message || '',
      autor: c.commit?.author?.name || c.author?.login || 'Autor desconhecido',
      autorLogin: c.author?.login || null, avatar: c.author?.avatar_url || null,
      data: c.commit?.author?.date || null,
      verificado: Boolean(c.commit?.verification?.verified), motivoVerificacao: c.commit?.verification?.reason || null,
      stats: c.stats || { total:0, additions:0, deletions:0 },
      arquivos: (c.files || []).map(f => ({
        nome: f.filename, status: f.status, additions: f.additions || 0, deletions: f.deletions || 0,
        changes: f.changes || 0, previousFilename: f.previous_filename || null, url: f.blob_url || null,
      })),
      parents: (c.parents || []).map(p => ({ sha: p.sha, url: p.html_url || null })),
    })
  } catch (err) { res.status(err.status || 500).json({ erro: err.message }) }
})

/* GET /api/github/repos/:owner/:repo/releases */
router.get('/repos/:owner/:repo/releases', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  const { per_page = 10 } = req.query
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  try {
    const releases = await githubFetch(`/repos/${owner}/${repo}/releases?per_page=${per_page}`)
    const lista = releases.map(r => ({
      id: r.id, tag: r.tag_name, nome: r.name, descricao: r.body,
      rascunho: r.draft, preRelease: r.prerelease,
      criadoEm: r.created_at, publicadoEm: r.published_at,
      url: r.html_url, autor: r.author?.login || null,
      assets: r.assets.map(a => ({
        id: a.id, nome: a.name, tamanho: a.size_in_bytes,
        downloads: a.download_count, url: a.browser_download_url, tipo: a.content_type,
      })),
    }))
    res.json({ releases: lista })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message, releases: [] })
  }
})

/* POST /api/github/repos/:owner/:repo/releases */
router.post('/repos/:owner/:repo/releases', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  const { tag, nome, descricao, rascunho = false, preRelease = false } = req.body
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  if (!tag) return res.status(400).json({ erro: 'Campo obrigatório: tag' })
  try {
    const release = await githubFetch(`/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      body: JSON.stringify({ tag_name: tag, name: nome || tag, body: descricao || '', draft: rascunho, prerelease: preRelease }),
    })
    await AuditLog.create({
      admin_id: req.usuario._id, admin_email: req.usuario.email,
      acao: 'criar', recurso: 'github_release',
      recurso_id: `${owner}/${repo}@${tag}`, payload: { owner, repo, tag, nome },
      ip: req.ip, request_id: req.requestId || null,
    })
    res.status(201).json({ ok: true, id: release.id, tag: release.tag_name, url: release.html_url })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

const APK_ARTIFACT_RE = /(?:^|[-_.])(apk|android|debug|release)(?:[-_.]|$)/i
const APK_MAX_ARCHIVE_BYTES = Number(process.env.AL_GITHUB_APK_MAX_ARCHIVE_BYTES || 220 * 1024 * 1024)
const APK_MAX_EXTRACTED_BYTES = Number(process.env.AL_GITHUB_APK_MAX_EXTRACTED_BYTES || 300 * 1024 * 1024)

function isLikelyApkArtifact(artifact = {}) {
  return APK_ARTIFACT_RE.test(String(artifact?.name || artifact?.nome || ''))
}

function artifactBuildType(name = '') {
  const value = String(name || '').toLowerCase()
  if (/(?:^|[-_.])release(?:[-_.]|$)/.test(value)) return 'release'
  if (/(?:^|[-_.])debug(?:[-_.]|$)/.test(value)) return 'debug'
  return 'apk'
}

function extractSemver(value = '') {
  const m = String(value || '').match(/(?:^|[^0-9])(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:$|[^0-9])/)
  return m?.[1] || ''
}

function safeDownloadBase(value = 'app') {
  return String(value || 'app')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 100) || 'app'
}

function packageDisplayName(name = '', fallback = 'app') {
  const raw = String(name || fallback || 'app').trim()
  if (/^al[-_ ]?sistemas$/i.test(raw) || /^alsistemas$/i.test(raw)) return 'AL-Sistemas'
  return raw.split(/[\s_-]+/).filter(Boolean).map(part => part.length <= 2 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)).join('-') || 'App'
}

async function readRepoPackageInfo(owner, repo, ref = '') {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  for (const pkgPath of ['frontend/package.json', 'package.json']) {
    try {
      const data = await githubFetch(`/repos/${owner}/${repo}/contents/${pkgPath}${q}`)
      if (!data?.content || data.encoding !== 'base64') continue
      const parsed = JSON.parse(Buffer.from(String(data.content).replace(/\n/g, ''), 'base64').toString('utf8'))
      if (parsed?.version || parsed?.name) return { name: parsed?.name || '', version: parsed?.version || '', path: pkgPath }
    } catch (err) {
      if (err?.status !== 404) throw err
    }
  }
  return { name: '', version: '', path: '' }
}

function serializeArtifact(a = {}) {
  const nome = a.name || a.nome || ''
  return {
    id: a.id,
    nome,
    tamanho: a.size_in_bytes ?? a.tamanho ?? 0,
    expiradoEm: a.expires_at || a.expiradoEm || null,
    criadoEm: a.created_at || a.criadoEm || null,
    expirado: Boolean(a.expired ?? a.expirado),
    url: a.archive_download_url || a.url || '',
    workflowRunId: a.workflow_run?.id || a.workflowRunId || null,
    headSha: a.workflow_run?.head_sha || a.headSha || null,
    buildType: artifactBuildType(nome),
    provavelApk: isLikelyApkArtifact(a),
    versao: extractSemver(nome),
  }
}

async function buildArtifactDownloadMeta(owner, repo, artifact) {
  const item = serializeArtifact(artifact)
  let pkg = { name: '', version: '' }
  if (item.provavelApk) {
    try { pkg = await readRepoPackageInfo(owner, repo, item.headSha || '') } catch { /* nome amigável é opcional */ }
  }
  const version = item.versao || pkg.version || ''
  const projectName = packageDisplayName(pkg.name, repo)
  const buildType = item.buildType === 'apk' ? '' : item.buildType
  const pieces = [projectName, version, buildType].filter(Boolean)
  const apkFileName = `${safeDownloadBase(pieces.join('-'))}.apk`
  const zipFileName = `${safeDownloadBase(item.nome || `${repo}-artifact-${item.id}`)}.zip`
  return { ...item, version, projectName, apkFileName, zipFileName }
}

async function buildReleaseApkMeta(owner, repo, release, asset) {
  let pkg = { name: '', version: '' }
  try { pkg = await readRepoPackageInfo(owner, repo, release?.target_commitish || '') } catch { /* opcional */ }
  const version = extractSemver(release?.tag_name || '') || extractSemver(asset?.name || '') || pkg.version || ''
  const projectName = packageDisplayName(pkg.name, repo)
  const pieces = [projectName, version, 'release'].filter(Boolean)
  return {
    id: asset.id,
    nome: asset.name || `${repo}-release.apk`,
    tamanho: asset.size || 0,
    criadoEm: asset.created_at || release?.published_at || release?.created_at || null,
    atualizadoEm: asset.updated_at || null,
    expirado: false,
    expiradoEm: null,
    source: 'release',
    releaseId: release?.id || null,
    releaseTag: release?.tag_name || '',
    releaseUrl: release?.html_url || '',
    buildType: 'release',
    provavelApk: true,
    version,
    projectName,
    apkFileName: `${safeDownloadBase(pieces.join('-'))}.apk`,
  }
}

function pickReleaseApk(releases = []) {
  const ordered = [...releases]
    .filter(r => !r?.draft)
    .sort((a, b) => {
      if (Boolean(a.prerelease) !== Boolean(b.prerelease)) return a.prerelease ? 1 : -1
      return new Date(b.published_at || b.created_at || 0) - new Date(a.published_at || a.created_at || 0)
    })
  for (const release of ordered) {
    const apks = (release.assets || []).filter(a => /\.apk$/i.test(String(a?.name || '')))
    if (!apks.length) continue
    const asset = apks.find(a => /(?:^|[-_.])release(?:[-_.]|$)/i.test(a.name))
      || apks.find(a => !/(?:^|[-_.])debug(?:[-_.]|$)/i.test(a.name))
      || apks[0]
    return { release, asset }
  }
  return null
}

function signArtifactDownloadTicket(payload) {
  return jwt.sign(
    { typ: 'github-artifact-download', ...payload },
    bootstrapValue('JWT_SECRET'),
    { expiresIn: '5m', audience: 'github-artifact-download' },
  )
}

function verifyArtifactDownloadTicket(token) {
  const data = jwt.verify(token, bootstrapValue('JWT_SECRET'), { audience: 'github-artifact-download' })
  if (data?.typ !== 'github-artifact-download') throw new Error('Ticket de download inválido.')
  return data
}

function signReleaseAssetDownloadTicket(payload) {
  return jwt.sign(
    { typ: 'github-release-apk-download', ...payload },
    bootstrapValue('JWT_SECRET'),
    { expiresIn: '5m', audience: 'github-release-apk-download' },
  )
}

function verifyReleaseAssetDownloadTicket(token) {
  const data = jwt.verify(token, bootstrapValue('JWT_SECRET'), { audience: 'github-release-apk-download' })
  if (data?.typ !== 'github-release-apk-download') throw new Error('Ticket de download inválido.')
  return data
}

function signRepoZipDownloadTicket(payload) {
  return jwt.sign(
    { typ: 'github-repo-zip-download', ...payload },
    bootstrapValue('JWT_SECRET'),
    { expiresIn: '5m', audience: 'github-repo-zip-download' },
  )
}

function verifyRepoZipDownloadTicket(token) {
  const data = jwt.verify(token, bootstrapValue('JWT_SECRET'), { audience: 'github-repo-zip-download' })
  if (data?.typ !== 'github-repo-zip-download') throw new Error('Ticket de download inválido.')
  return data
}

/* GET /api/github/repos/:owner/:repo/artifacts */
router.get('/repos/:owner/:repo/artifacts', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  try {
    const data = await githubFetch(`/repos/${owner}/${repo}/actions/artifacts?per_page=20`)
    const lista = (data.artifacts || []).map(serializeArtifact)
    res.json({ artifacts: lista, total: data.total_count || lista.length })
  } catch (err) {
    if (err.status === 404) return res.json({ artifacts: [], total: 0 })
    res.status(err.status || 500).json({ erro: err.message, artifacts: [] })
  }
})

/* GET /api/github/repos/:owner/:repo/latest-apk — APK mais recente, se existir */
router.get('/repos/:owner/:repo/latest-apk', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  try {
    // Releases têm prioridade: quando o projeto publicou um APK de produção,
    // o card principal oferece esse arquivo antes de qualquer artefato debug.
    const releases = await githubFetch(`/repos/${owner}/${repo}/releases?per_page=10`).catch(err => {
      if (err?.status === 404) return []
      throw err
    })
    const releaseApk = pickReleaseApk(Array.isArray(releases) ? releases : [])
    if (releaseApk) return res.json({ apk: await buildReleaseApkMeta(owner, repo, releaseApk.release, releaseApk.asset) })

    const data = await githubFetch(`/repos/${owner}/${repo}/actions/artifacts?per_page=50`)
    const candidate = (data.artifacts || [])
      .filter(a => !a.expired && isLikelyApkArtifact(a))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0]
    if (!candidate) return res.json({ apk: null })
    res.json({ apk: { ...(await buildArtifactDownloadMeta(owner, repo, candidate)), source: 'artifact' } })
  } catch (err) {
    if (err.status === 404) return res.json({ apk: null })
    res.status(err.status || 500).json({ erro: err.message, apk: null })
  }
})

/* GET /api/github/repos/:owner/:repo/analysis */
router.get('/repos/:owner/:repo/analysis', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  try {
    const repoData = await githubFetch(`/repos/${owner}/${repo}`)
    const branch = repoData.default_branch || 'main'
    const [insight, langs, cms, tree] = await Promise.all([
      montarRepoInsight(owner, repo, branch),
      githubFetch(`/repos/${owner}/${repo}/languages`).catch(() => ({})),
      githubFetch(`/repos/${owner}/${repo}/commits?per_page=30`).catch(() => []),
      githubFetch(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`).catch(() => ({tree:[]})),
    ])
    const diasSemAtividade = repoData.pushed_at ? Math.max(0, Math.floor((Date.now() - new Date(repoData.pushed_at).getTime()) / 86400000)) : null
    const maturidade = diasSemAtividade === null ? 'desconhecido' : diasSemAtividade <= 90 ? 'ativo' : diasSemAtividade <= 180 ? 'moderado' : diasSemAtividade <= 365 ? 'inativo' : 'sem atividade recente'
    const commitCount = Array.isArray(cms) ? cms.length : 0
    const frequencia = commitCount >= 20 ? 'alta' : commitCount >= 8 ? 'média' : commitCount >= 2 ? 'baixa' : 'inativa'
    const treeItems = Array.isArray(tree?.tree) ? tree.tree : []
    const blobs = treeItems.filter(i => i.type === 'blob')
    const totalBytes = blobs.reduce((n,i)=>n+Number(i.size||0),0)
    res.json({
      ...insight,
      linguagens: langs,
      linguagemPrincipal: repoData.language || Object.keys(langs)[0] || null,
      maturidade, diasSemAtividade, frequenciaCommits:frequencia, commitsAmostra:commitCount,
      totalArquivos:blobs.length, tamanhoBytes:totalBytes, tamanhoGitHubKb:repoData.size || 0,
      branch, ultimoPush:repoData.pushed_at || null, ultimaAtualizacao:repoData.updated_at || null,
      privado:Boolean(repoData.private), arquivado:Boolean(repoData.archived),
      acesso: repoData.permissions?.admin || repoData.permissions?.maintain || repoData.permissions?.push ? 'Leitura e escrita' : 'Somente leitura',
      hasDocker: insight.arquivosRaiz?.some(f=>/^dockerfile$/i.test(f)||/^docker-compose\.ya?ml$/i.test(f)) || false,
      hasTestes: treeItems.some(i => /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/i.test(i.path || '')),
      temLicense: Boolean(repoData.license),
    })
  } catch (err) { res.status(err.status || 500).json({ erro: err.message }) }
})

/* GET /api/github/meta/:repoId */
router.get('/meta/:repoId', autenticar, async (req, res) => {
  try {
    const meta = await GitHubMeta.findOne({ repoId: Number(req.params.repoId) })
    res.json(meta || {
      repoId: Number(req.params.repoId), alias: null, tags: [],
      favorito: false, statusInterno: 'ativo', observacoes: null, projetoLocal: null,
    })
  } catch (err) {
    res.status(500).json({ erro: err.message })
  }
})

/* PUT /api/github/meta/:repoId */
router.put('/meta/:repoId', autenticar, auditLog('github_meta'), async (req, res) => {
  const { alias, tags, favorito, statusInterno, observacoes, projetoLocal, nomeCompleto, publicacao } = req.body
  try {
    const $set = { alias, tags, favorito, statusInterno, observacoes, projetoLocal, nomeCompleto }
    if (publicacao && typeof publicacao === 'object') {
      const repository = String(publicacao.repository || '').trim()
      const branch = String(publicacao.branch || 'main').trim() || 'main'
      const targetPath = normalizarTargetPath(publicacao.path || '')
      if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return res.status(400).json({ erro: 'Repositório de publicação inválido.' })
      $set.publicacao = { repository: repository || null, branch, path: targetPath, snapshotR2: Boolean(publicacao.snapshotR2) }
    }
    const meta = await GitHubMeta.findOneAndUpdate(
      { repoId: Number(req.params.repoId) },
      { $set },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
    res.json(meta)
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

/* GET /api/github/projetos-locais */
router.get('/projetos-locais', autenticar, async (req, res) => {
  try {
    if (!fs.existsSync(PROJETOS_DIR)) return res.json({ projetos: [] })
    const itens = fs.readdirSync(PROJETOS_DIR, { withFileTypes: true })
    res.json({ projetos: itens.filter(i => i.isDirectory()).map(i => ({ nome: i.name })) })
  } catch {
    res.json({ projetos: [] })
  }
})

function parseGithubPublishConfig(body = {}, owner, repo) {
  const repository = String(body?.repository || `${owner}/${repo}`).trim()
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    const e = new Error('Selecione um repositório GitHub válido.'); e.status = 400; throw e
  }
  const [destOwner, destRepo] = repository.split('/')
  const branch = String(body?.branch || 'main').trim() || 'main'
  if (!/^[A-Za-z0-9._\/-]{1,200}$/.test(branch) || branch.includes('..')) {
    const e = new Error('Branch de destino inválida.'); e.status = 400; throw e
  }
  const targetPath = normalizarTargetPath(body?.targetPath || '')
  const replacePath = String(body?.replacePath || '').toLowerCase() === 'true' || body?.replacePath === true
  const snapshotR2 = String(body?.snapshotR2 || '').toLowerCase() === 'true' || body?.snapshotR2 === true
  const sentVersion = String(body?.sentVersion || '').trim().slice(0, 80)
  const sentProduct = String(body?.sentProduct || '').trim().slice(0, 160)
  return { repository, destOwner, destRepo, branch, targetPath, replacePath, snapshotR2, sentVersion, sentProduct }
}

async function githubPublishPreflight({ sourceOwner, sourceRepoName, config }) {
  const checks = [], warnings = []
  const pushCheck = (id, label, state, detail) => checks.push({ id, label, state, detail })
  const [sourceRepo, destination] = await Promise.all([
    githubFetch(`/repos/${sourceOwner}/${sourceRepoName}`),
    githubFetch(`/repos/${config.destOwner}/${config.destRepo}`),
  ])
  pushCheck('source', 'Projeto de origem', 'ok', `${sourceRepo.full_name || `${sourceOwner}/${sourceRepoName}`} acessível`)
  const writable = Boolean(destination.permissions?.push || destination.permissions?.maintain || destination.permissions?.admin)
  if (!writable) {
    pushCheck('write', 'Permissão de escrita', 'error', `O token não possui escrita em ${config.repository}`)
  } else pushCheck('write', 'Permissão de escrita', 'ok', 'Contents: escrita disponível')

  let base = null
  try {
    base = await obterBranchBase(config.destOwner, config.destRepo, config.branch)
    pushCheck('branch', 'Branch', 'ok', base.parentSha
      ? (base.exists ? `${config.branch} pronta para receber commit` : `${config.branch} será criada a partir de ${base.repoInfo?.default_branch || 'main'}`)
      : `Repositório vazio; ${config.branch} será inicializada com o primeiro commit`)
  } catch (e) {
    pushCheck('branch', 'Branch', 'error', e.message || 'Não foi possível conferir a branch')
  }

  let insight = null
  if (base?.parentSha) {
    const insightBranch = base.exists ? config.branch : (base.repoInfo?.default_branch || config.branch)
    try { insight = await montarRepoInsight(config.destOwner, config.destRepo, insightBranch, { fresh: true }) }
    catch { insight = null }
  }
  pushCheck('path', 'Pasta de destino', 'ok', config.targetPath ? `/${config.targetPath}` : '/ (raiz)')

  if (config.snapshotR2) {
    try {
      const r2 = await testR2UpdateStorage()
      pushCheck('r2', 'Snapshot R2', 'ok', `${r2.bucket} acessível`)
    } catch (e) {
      pushCheck('r2', 'Snapshot R2', 'error', e.message || 'R2 indisponível')
    }
  } else {
    pushCheck('r2', 'Snapshot R2', 'warn', 'Desativado para esta publicação')
    warnings.push('A publicação será feita sem snapshot no R2.')
  }

  const currentVersion = String(insight?.versao || '')
  const currentProduct = String(insight?.produto || '')
  if (config.sentVersion && currentVersion) {
    const cmp = compararVersoes(config.sentVersion, currentVersion)
    if (cmp === 1) pushCheck('version', 'Versão', 'ok', `${currentVersion} → ${config.sentVersion}`)
    else if (cmp === 0) {
      pushCheck('version', 'Versão', 'warn', `${currentVersion} → ${config.sentVersion} (mesma versão)`)
      warnings.push(`O pacote informa a mesma versão já encontrada no GitHub (${currentVersion}).`)
    } else if (cmp === -1) {
      pushCheck('version', 'Versão', 'warn', `${currentVersion} → ${config.sentVersion} (versão anterior)`)
      warnings.push(`O pacote parece reduzir a versão de ${currentVersion} para ${config.sentVersion}.`)
    } else pushCheck('version', 'Versão', 'ok', `${currentVersion} → ${config.sentVersion}`)
  } else if (config.sentVersion) pushCheck('version', 'Versão', 'ok', `Destino sem versão detectada → ${config.sentVersion}`)
  else pushCheck('version', 'Versão', 'warn', 'O pacote não informou uma versão reconhecível')

  if (config.sentProduct && currentProduct && config.sentProduct.toLowerCase() !== currentProduct.toLowerCase()) {
    pushCheck('product', 'Identidade do projeto', 'warn', `${currentProduct} → ${config.sentProduct}`)
    warnings.push(`O pacote identifica o projeto como “${config.sentProduct}”, mas o destino parece ser “${currentProduct}”.`)
  } else pushCheck('product', 'Identidade do projeto', 'ok', config.sentProduct || currentProduct || 'Projeto genérico')

  if (config.replacePath && !config.targetPath) {
    pushCheck('replace', 'Modo substituir', 'warn', 'Arquivos ausentes no ZIP serão removidos da raiz inteira')
    warnings.push('“Substituir” na raiz pode remover qualquer arquivo que não exista no ZIP enviado.')
  } else if (config.replacePath) pushCheck('replace', 'Modo substituir', 'ok', `Limitado a /${config.targetPath}`)
  else pushCheck('replace', 'Modo mesclar', 'ok', 'Arquivos extras existentes serão preservados')

  const errors = checks.filter(c => c.state === 'error')
  return {
    ok: errors.length === 0, checks, warnings,
    destination: { repository: config.repository, branch: config.branch, path: config.targetPath || '/', repositoryEmpty: !base?.parentSha, branchExists: Boolean(base?.exists) },
    version: { current: currentVersion || null, incoming: config.sentVersion || null, productCurrent: currentProduct || null, productIncoming: config.sentProduct || null },
    sourceRepo,
  }
}

function publicGithubPublishJob(job) {
  if (!job) return null
  return {
    id:job.id || job.jobId,status:job.status,phase:job.phase,progress:job.progress,createdAt:job.createdAt,updatedAt:job.updatedAt,
    logs:Array.isArray(job.logs)?job.logs:[],result:job.result||null,error:job.error||null,
    destination:job.destination||null,branch:job.branch||null,
  }
}

async function executarGithubPublish({ sourceOwner, sourceRepoName, fileBuffer, original, body, usuario, ip, requestId, onLog }) {
  const config = parseGithubPublishConfig(body, sourceOwner, sourceRepoName)
  onLog?.({phase:'preflight',label:'Verificação final',message:'Revalidando permissões, branch, destino, versão e snapshot…',progress:20})
  const preflight = await githubPublishPreflight({ sourceOwner, sourceRepoName, config })
  if (!preflight.ok) {
    const first = preflight.checks.find(c => c.state === 'error')
    const e = new Error(first?.detail || 'A verificação obrigatória encontrou um problema.'); e.status = 409; e.preflight = preflight; throw e
  }
  onLog?.({phase:'preflight',label:'Verificação final',message:`${preflight.checks.filter(c=>c.state==='ok').length} verificação(ões) aprovada(s).`,progress:30})

  onLog?.({phase:'package',label:'Validando pacote',message:'Abrindo ZIP, validando CRC, caminhos, limites e arquivos publicáveis…',progress:33})
  const unpacked = await extrairZipPublicavel(fileBuffer)
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  onLog?.({phase:'package',label:'Pacote validado',message:`${unpacked.files.length} arquivo(s) · ${unpacked.totalBytes} bytes · SHA-256 ${sha256.slice(0,12)}…`,progress:38})

  let snapshot = null
  if (config.snapshotR2) {
    onLog?.({phase:'snapshot',label:'Snapshot R2',message:'Salvando uma cópia do ZIP antes do commit…',progress:40})
    snapshot = await storeProjectSnapshot(fileBuffer, {
      owner: config.destOwner, repo: config.destRepo, branch: config.branch, filename: original, sha256,
    })
    onLog?.({phase:'snapshot',label:'Snapshot R2',message:`Snapshot confirmado em ${snapshot.bucket}.`,progress:41})
  } else onLog?.({phase:'snapshot',label:'Snapshot R2',message:'Snapshot desativado para esta publicação.',progress:41,state:'off'})

  const commitMessage = String(body?.commitMessage || `Publica ${original} pelo AL Sistemas`).trim().slice(0, 240)
  const result = await publicarPacoteNoGitHub({
    owner: config.destOwner, repo: config.destRepo, branch: config.branch, targetPath: config.targetPath,
    files: unpacked.files, message: commitMessage, replacePath: config.replacePath,
    onProgress: onLog,
  })

  const sourceRepo = preflight.sourceRepo
  await GitHubMeta.findOneAndUpdate(
    { repoId: Number(sourceRepo.id) },
    { $set: { nomeCompleto: sourceRepo.full_name, publicacao: { repository:config.repository, branch:result.branch || config.branch, path:config.targetPath, snapshotR2:config.snapshotR2 } } },
    { upsert:true, setDefaultsOnInsert:true }
  ).catch(() => {})

  await AuditLog.create({
    admin_id: usuario?._id, admin_email: usuario?.email,
    acao:'publicar', recurso:'github_pacote', recurso_id:config.repository,
    payload:{ source:`${sourceOwner}/${sourceRepoName}`, repository:config.repository, branch:result.branch || config.branch, targetPath:config.targetPath,
      replacePath:config.replacePath, snapshotR2:config.snapshotR2, initializedRepository:Boolean(result.initializedRepository), files:unpacked.files.length,
      bytes:unpacked.totalBytes, sha256, verified:Boolean(result.verified), fromVersion:preflight.version.current, toVersion:preflight.version.incoming },
    ip, request_id:requestId || null,
  }).catch(() => {})

  const finalBranch = result.branch || config.branch
  repoInsightCache.delete(`${config.destOwner}/${config.destRepo}@${finalBranch}`)
  const finalInsight = await montarRepoInsight(config.destOwner, config.destRepo, finalBranch, { fresh: true }).catch(() => null)
  const finalVersion = String(finalInsight?.versao || '') || (result.changed ? config.sentVersion : preflight.version.current) || null
  const finalProduct = String(finalInsight?.produto || '') || preflight.version.productCurrent || config.sentProduct || null

  onLog?.({phase:'done',label:'Publicação verificada',message:result.changed
    ? `Commit ${result.commitSha?.slice(0,7)} confirmado no GitHub.`
    : 'O conteúdo já estava idêntico ao GitHub; nenhum novo commit foi necessário.',progress:100,state:'done'})
  return {
    ok:true,
    mensagem:result.changed ? `Pacote publicado em ${config.repository} com sucesso.` : 'O conteúdo enviado já corresponde ao conteúdo do GitHub.',
    destino:{ repository:config.repository, branch:finalBranch, path:config.targetPath || '/', replacePath:config.replacePath },
    pacote:{ nome:original, sha256, arquivos:unpacked.files.length, bytes:unpacked.totalBytes, raizRemovida:unpacked.commonRoot || null },
    snapshot, commit:result,
    verificacao:{ ok:Boolean(result.verified), verificadoEm:result.verifiedAt || new Date().toISOString(), checks:preflight.checks, warnings:preflight.warnings },
    versao:{ ...preflight.version, after:finalVersion, afterProduct:finalProduct },
  }
}

/* POST /api/github/repos/:owner/:repo/publicar-pacote/preflight
   Verificação obrigatória antes de transferir o ZIP. */
router.post('/repos/:owner/:repo/publicar-pacote/preflight', autenticar, async (req,res) => {
  const {owner,repo}=req.params
  if(!validarNome(owner)||!validarNome(repo)) return res.status(400).json({erro:'Repositório de origem inválido.'})
  try{
    const config=parseGithubPublishConfig(req.body||{},owner,repo)
    const result=await githubPublishPreflight({sourceOwner:owner,sourceRepoName:repo,config})
    const {sourceRepo:_sourceRepo,...safe}=result
    res.json(safe)
  }catch(err){res.status(err.status||500).json({erro:err.message})}
})

/* GET /api/github/repos/:owner/:repo/publicar-pacote/jobs/:jobId */
router.get('/repos/:owner/:repo/publicar-pacote/jobs/:jobId', autenticar, async(req,res)=>{
  const jobId=String(req.params.jobId||'')
  let job=await GitHubPublishJob.findOne({
    jobId, sourceOwner:req.params.owner, sourceRepo:req.params.repo, usuarioId:String(req.usuario?._id||''),
  }).lean()
  if(!job) return res.status(404).json({erro:'Publicação não encontrada ou expirada.'})

  // Após reinício do backend o registro persiste. Se não recebe nenhuma atualização
  // por tempo excessivo, converte o estado antigo em falha explicativa em vez de 404.
  if(['queued','running'].includes(job.status) && Date.now()-new Date(job.updatedAt||job.createdAt).getTime()>20*60*1000){
    const error={
      message:'O acompanhamento persistiu, mas o backend deixou de atualizar esta publicação. Confira a branch no GitHub antes de iniciar outra.',
      code:'GITHUB_PUBLISH_STALE',
      action:'Confira o GitHub. Se o commit não estiver na branch, inicie uma nova publicação.',
    }
    await GitHubPublishJob.updateOne({jobId},{$set:{status:'failed',phase:'error',progress:100,error,finishedAt:new Date(),updatedAt:new Date()},$unset:{lockKey:1}})
    job={...job,status:'failed',phase:'error',progress:100,error,updatedAt:new Date()}
  }
  res.json({job:publicGithubPublishJob(job)})
})

/* POST /api/github/repos/:owner/:repo/publicar-pacote
   Recebe o ZIP. Com async=true, devolve um job e o frontend acompanha o log real
   enquanto o backend valida, cria snapshot, publica e confirma o commit. */
router.post('/repos/:owner/:repo/publicar-pacote', autenticar, publishUpload.single('package'), async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Repositório de origem inválido.' })
  if (!req.file?.buffer) return res.status(400).json({ erro: 'Selecione um arquivo ZIP para publicar.' })
  const original = String(req.file.originalname || 'projeto.zip')
  if (!/\.zip$/i.test(original)) return res.status(400).json({ erro: 'O pacote precisa ser um arquivo .zip.' })

  const asyncMode=String(req.body?.async||'').toLowerCase()==='true'
  if(asyncMode){
    try{
      const parsedConfig=parseGithubPublishConfig(req.body||{},owner,repo)
      const job=await criarGithubPublishJob({
        owner,repo,usuarioId:req.usuario?._id,destination:parsedConfig.repository,branch:parsedConfig.branch,
      })
      registrarGithubPublishLog(job,'received','Pacote recebido',`${original} chegou ao backend (${req.file.size || req.file.buffer.length} bytes).`,'done',12)
      const buffer=req.file.buffer
      const body={...req.body}
      const usuario=req.usuario, ip=req.ip, requestId=req.requestId
      setImmediate(async()=>{
        job.status='running'; job.updatedAt=new Date().toISOString()
        queueGithubPublishPersist(job,{$set:{status:'running',updatedAt:new Date(job.updatedAt)}})
        try{
          const result=await executarGithubPublish({sourceOwner:owner,sourceRepoName:repo,fileBuffer:buffer,original,body,usuario,ip,requestId,
            onLog:e=>registrarGithubPublishLog(job,e.phase,e.label,e.message,e.state||'active',e.progress,e.details)})
          await job._persist?.catch(()=>{})
          job.result=result; job.status='succeeded'; job.progress=100; job.phase='done'; job.updatedAt=new Date().toISOString()
          await GitHubPublishJob.updateOne({jobId:job.id},{
            $set:{status:'succeeded',phase:'done',progress:100,result,updatedAt:new Date(job.updatedAt),finishedAt:new Date()},
            $unset:{lockKey:1},
          })
        }catch(err){
          job.status='failed'; job.phase='error'; job.error={
            message:githubPublishErrorMessage(err), status:err.status||500, code:err.code||null,
            action:githubPublishErrorAction(err),
            preflight:err.preflight ? {checks:err.preflight.checks,warnings:err.preflight.warnings}:undefined,
          }
          registrarGithubPublishLog(job,'error','Publicação interrompida',job.error.message,'error',job.progress)
          await job._persist?.catch(()=>{})
          await GitHubPublishJob.updateOne({jobId:job.id},{
            $set:{status:'failed',phase:'error',progress:job.progress,error:job.error,updatedAt:new Date(),finishedAt:new Date()},
            $unset:{lockKey:1},
          }).catch(()=>{})
        }
      })
      return res.status(202).json({ok:true,async:true,job:publicGithubPublishJob(job)})
    }catch(err){
      return res.status(err.status||500).json({erro:githubPublishErrorMessage(err),codigo:err.code||null,jobId:err.jobId||null,acao:githubPublishErrorAction(err)})
    }
  }

  try{
    const result=await executarGithubPublish({sourceOwner:owner,sourceRepoName:repo,fileBuffer:req.file.buffer,original,body:req.body||{},usuario:req.usuario,ip:req.ip,requestId:req.requestId})
    res.status(201).json(result)
  }catch(err){
    const msg=githubPublishErrorMessage(err)
    res.status(err.status||500).json({erro:msg,acao:githubPublishErrorAction(err),codigo:err.code||null,preflight:err.preflight ? {checks:err.preflight.checks,warnings:err.preflight.warnings}:undefined})
  }
})

/* ═══════════════════════════════════════════════════════════
   SECRETS — GitHub Actions Secrets (Sprint 4)
   GitHub NUNCA retorna o valor dos secrets — apenas os nomes.
   Para criar/atualizar: o valor é criptografado com a chave
   pública do repositório via NaCl Box (libsodium).
═══════════════════════════════════════════════════════════ */

/* Helper: criptografia NaCl Box para secrets do GitHub */
async function encryptarSecret(publicKeyB64, valor) {
  try {
    const _sodium = await import('libsodium-wrappers')
    await _sodium.default.ready
    const sodium = _sodium.default
    const binKey = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL)
    const binVal = sodium.from_string(valor)
    const encrypted = sodium.crypto_box_seal(binVal, binKey)
    return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL)
  } catch {
    return null
  }
}

/* GET /api/github/repos/:owner/:repo/secrets */
router.get('/repos/:owner/:repo/secrets', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Nome de repositório inválido.' })
  try {
    const data = await githubFetch(`/repos/${owner}/${repo}/actions/secrets?per_page=100`)
    const lista = (data.secrets || []).map(s => ({
      nome:        s.name,
      criadoEm:   s.created_at,
      atualizadoEm: s.updated_at,
    }))
    res.json({ secrets: lista, total: data.total_count || lista.length })
  } catch (err) {
    if (err.status === 404) return res.json({ secrets: [], total: 0 })
    res.status(err.status || 500).json({ erro: err.message, secrets: [] })
  }
})

/* GET /api/github/repos/:owner/:repo/secrets/public-key */
router.get('/repos/:owner/:repo/secrets/public-key', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Nome de repositório inválido.' })
  try {
    const data = await githubFetch(`/repos/${owner}/${repo}/actions/secrets/public-key`)
    // Retorna apenas key_id, NÃO a key pública (o backend faz a criptografia)
    res.json({ key_id: data.key_id, disponivel: !!data.key })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

/* PUT /api/github/repos/:owner/:repo/secrets/:secretName */
router.put('/repos/:owner/:repo/secrets/:secretName', autenticar, async (req, res) => {
  const { owner, repo, secretName } = req.params
  const { valor } = req.body
  if (!validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Nome de repositório inválido.' })
  if (!secretName || !/^[A-Z_][A-Z0-9_]*$/.test(secretName))
    return res.status(400).json({ erro: 'Nome do secret inválido. Use apenas MAIÚSCULAS, números e _.' })
  if (!valor || typeof valor !== 'string')
    return res.status(400).json({ erro: 'Campo obrigatório: valor' })

  try {
    const pkData = await githubFetch(`/repos/${owner}/${repo}/actions/secrets/public-key`)
    const encryptedValue = await encryptarSecret(pkData.key, valor)
    if (!encryptedValue) {
      return res.status(500).json({
        erro: 'Módulo de criptografia (libsodium-wrappers) não disponível. Execute: npm install',
      })
    }

    await githubFetch(`/repos/${owner}/${repo}/actions/secrets/${secretName}`, {
      method: 'PUT',
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: pkData.key_id }),
    })

    await AuditLog.create({
      admin_id: req.usuario._id, admin_email: req.usuario.email,
      acao: 'criar', recurso: 'github_secret',
      recurso_id: `${owner}/${repo}:${secretName}`, payload: { owner, repo, secretName },
      ip: req.ip, request_id: req.requestId || null,
    })

    res.json({ ok: true, mensagem: `Secret "${secretName}" salvo com sucesso.` })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

/* DELETE /api/github/repos/:owner/:repo/secrets/:secretName */
router.delete('/repos/:owner/:repo/secrets/:secretName', autenticar, async (req, res) => {
  const { owner, repo, secretName } = req.params
  if (!validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Nome de repositório inválido.' })
  if (!secretName) return res.status(400).json({ erro: 'Nome do secret obrigatório.' })
  try {
    await githubFetch(`/repos/${owner}/${repo}/actions/secrets/${secretName}`, { method: 'DELETE' })
    await AuditLog.create({
      admin_id: req.usuario._id, admin_email: req.usuario.email,
      acao: 'excluir', recurso: 'github_secret',
      recurso_id: `${owner}/${repo}:${secretName}`, payload: { owner, repo, secretName },
      ip: req.ip, request_id: req.requestId || null,
    })
    res.json({ ok: true, mensagem: `Secret "${secretName}" removido.` })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

/* ═══════════════════════════════════════════════════════════
   WORKFLOWS & RUNS — GitHub Actions (Sprint 4)
═══════════════════════════════════════════════════════════ */

/* GET /api/github/repos/:owner/:repo/workflows */
router.get('/repos/:owner/:repo/workflows', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Nome de repositório inválido.' })
  try {
    const data = await githubFetch(`/repos/${owner}/${repo}/actions/workflows?per_page=50`)
    const lista = (data.workflows || []).map(w => ({
      id:       w.id,
      nome:     w.name,
      arquivo:  w.path,
      estado:   w.state, // active | disabled_manually | disabled_inactivity
      criadoEm: w.created_at,
      url:      w.html_url,
    }))
    res.json({ workflows: lista, total: data.total_count || lista.length })
  } catch (err) {
    if (err.status === 404) return res.json({ workflows: [], total: 0 })
    res.status(err.status || 500).json({ erro: err.message, workflows: [] })
  }
})

/* GET /api/github/repos/:owner/:repo/workflows/:workflowId/runs */
router.get('/repos/:owner/:repo/workflows/:workflowId/runs', autenticar, async (req, res) => {
  const { owner, repo, workflowId } = req.params
  const { per_page = 15, page = 1 } = req.query
  if (!validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Nome de repositório inválido.' })
  try {
    const data = await githubFetch(
      `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?per_page=${per_page}&page=${page}`
    )
    const lista = (data.workflow_runs || []).map(r => ({
      id:          r.id,
      nome:        r.name,
      status:      r.status,       // queued | in_progress | completed
      conclusao:   r.conclusion,   // success | failure | cancelled | skipped | null
      branch:      r.head_branch,
      sha:         r.head_sha?.slice(0, 7),
      mensagem:    r.head_commit?.message?.split('\n')[0] || null,
      criadoEm:   r.created_at,
      atualizadoEm: r.updated_at,
      url:         r.html_url,
      duracaoMs:   r.run_started_at
        ? (new Date(r.updated_at) - new Date(r.run_started_at))
        : null,
    }))
    res.json({ runs: lista, total: data.total_count || lista.length })
  } catch (err) {
    if (err.status === 404) return res.json({ runs: [], total: 0 })
    res.status(err.status || 500).json({ erro: err.message, runs: [] })
  }
})

/* GET /api/github/runs/:runId/jobs — lista jobs de um run */
router.get('/runs/:runId/jobs', autenticar, async (req, res) => {
  const { runId } = req.params
  const { owner, repo } = req.query
  if (!owner || !repo || !validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Parâmetros owner e repo obrigatórios.' })
  try {
    const data = await githubFetch(
      `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=30`
    )
    const lista = (data.jobs || []).map(j => ({
      id:        j.id,
      nome:      j.name,
      status:    j.status,
      conclusao: j.conclusion,
      inicioEm:  j.started_at,
      fimEm:     j.completed_at,
      steps: (j.steps || []).map(s => ({
        numero:    s.number,
        nome:      s.name,
        status:    s.status,
        conclusao: s.conclusion,
        inicioEm:  s.started_at,
        fimEm:     s.completed_at,
      })),
    }))
    res.json({ jobs: lista, total: lista.length })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message, jobs: [] })
  }
})


function resumirJobsWorkflow(jobs=[]) {
  const steps=(jobs||[]).flatMap(j => (j.steps||[]).map(st => ({...st,job:j.name||j.nome||''})))
  const falhas=steps.filter(s => s.conclusion==='failure' || s.conclusao==='failure')
  const ignoradas=steps.filter(s => ['skipped','cancelled'].includes(s.conclusion||s.conclusao))
  const sucesso=steps.filter(s => (s.conclusion||s.conclusao)==='success')
  const jobsFalhos=(jobs||[]).filter(j => (j.conclusion||j.conclusao)==='failure')
  return {
    totalJobs:(jobs||[]).length,
    jobsFalhos:jobsFalhos.length,
    totalEtapas:steps.length,
    etapasConcluidas:sucesso.length,
    etapasFalhas:falhas.length,
    etapasIgnoradas:ignoradas.length,
    falhas:falhas.slice(0,12).map(s=>({job:s.job,etapa:s.name||s.nome||'',numero:s.number||s.numero||null})),
  }
}

function mascararSegredosLog(texto='') {
  return redactAiText(String(texto||'').replace(/\x1b\[[0-9;]*m/g,''))
}

function extrairTrechosRelevantes(texto='', maxLinhas=150) {
  return selectRelevantLogContext(mascararSegredosLog(texto), Math.max(4000, Math.min(16000, maxLinhas * 80)))
}

async function baixarJobLogTexto({owner,repo,jobId,token}) {
  const resp=await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`,{
    headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'follow'
  })
  if(!resp.ok) return ''
  return (await resp.text()).slice(0,220*1024)
}

async function executarAnaliseWorkflow({owner,repo,runId,modo,workflow,signal,update=async()=>{}}){
  await update(12,'Consultando execução e jobs no GitHub')
  const [runData,jobsData]=await Promise.all([
    githubFetch(`/repos/${owner}/${repo}/actions/runs/${runId}`),
    githubFetch(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=50`),
  ])
  const jobs=jobsData.jobs||[], resumo=resumirJobsWorkflow(jobs)
  const run={id:runData.id,status:runData.status,conclusao:runData.conclusion,branch:runData.head_branch,sha:runData.head_sha?.slice(0,12)||'',evento:runData.event,criadoEm:runData.created_at,atualizadoEm:runData.updated_at,url:runData.html_url}
  if(modo==='resumo') return {ok:true,modo,resumo,run}
  const {value:token}=await getCredential('github','GITHUB_TOKEN')
  if(!token){const e=new Error('GITHUB_TOKEN não configurado em Integrações e APIs.');e.status=503;throw e}
  await update(30,'Coletando apenas os logs mais relevantes')
  const prioritarios=jobs.filter(j=>j.conclusion==='failure').concat(jobs.filter(j=>j.conclusion!=='failure')).slice(0,5)
  const blocos=[]
  for(let i=0;i<prioritarios.length;i++){
    if(signal?.aborted){const e=new Error('Análise cancelada.');e.status=499;e.code='AI_ABORTED';throw e}
    const job=prioritarios[i]
    const texto=await baixarJobLogTexto({owner,repo,jobId:job.id,token}).catch(()=> '')
    if(texto) blocos.push(`=== JOB: ${job.name} (${job.conclusion||job.status}) ===\n${extrairTrechosRelevantes(texto)}`)
    await update(30+Math.round(((i+1)/Math.max(1,prioritarios.length))*30),`Coletando logs ${i+1}/${prioritarios.length}`)
  }
  const trechos=blocos.join('\n\n').slice(0,30000)
  if(!trechos){const e=new Error('O GitHub não retornou conteúdo de log utilizável para esta execução.');e.status=422;throw e}
  await update(68,'Analisando com o motor de IA')
  const analise=await analisarLogsWorkflow({repo:`${owner}/${repo}`,workflow,run,resumo,trechos,modo})
  await update(94,'Finalizando diagnóstico')
  return {ok:true,modo,resumo,run,analise}
}

/* POST /api/github/runs/:runId/analyze — resumo local ou análise por IA persistente */
router.post('/runs/:runId/analyze', autenticar, async (req,res) => {
  const {runId}=req.params
  const {owner,repo,modo='resumo',workflow='',async:asyncMode=false}=req.body||{}
  if(!owner||!repo||!validarNome(owner)||!validarNome(repo)) return res.status(400).json({erro:'owner e repo são obrigatórios.'})
  if(!['resumo','diagnostico','correcao'].includes(modo)) return res.status(400).json({erro:'Modo de análise inválido.'})
  try{
    if(modo!=='resumo'&&asyncMode){
      const job=await createAiJob({type:`github-workflow-${modo}`,payload:{owner,repo,runId,workflow,modo},createdBy:String(req.usuario?._id||''),runner:async({signal,update})=>{
        const result=await executarAnaliseWorkflow({owner,repo,runId,modo,workflow,signal,update})
        await AuditLog.create({admin_id:req.usuario._id,admin_email:req.usuario.email,acao:'analisar',recurso:'github_actions_logs',recurso_id:`${owner}/${repo}:run:${runId}`,payload:{modo,workflow,provedor:result?.analise?._meta?.provedor||null,job:true},ip:req.ip,request_id:req.requestId||null}).catch(()=>{})
        return result
      }})
      return res.status(202).json({ok:true,async:true,job})
    }
    const result=await executarAnaliseWorkflow({owner,repo,runId,modo,workflow})
    if(modo!=='resumo')await AuditLog.create({admin_id:req.usuario._id,admin_email:req.usuario.email,acao:'analisar',recurso:'github_actions_logs',recurso_id:`${owner}/${repo}:run:${runId}`,payload:{modo,workflow,provedor:result?.analise?._meta?.provedor||null},ip:req.ip,request_id:req.requestId||null}).catch(()=>{})
    res.json(result)
  }catch(err){res.status(err.status||500).json({erro:err.message||'Falha ao analisar execução.'})}
})


/* GET /api/github/jobs/:jobId/logs — logs inline de um job (text/plain) */
router.get('/jobs/:jobId/logs', autenticar, async (req, res) => {
  const { jobId } = req.params
  const { owner, repo } = req.query
  if (!owner || !repo || !validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Parâmetros owner e repo obrigatórios.' })
  const { value: token } = await getCredential('github', 'GITHUB_TOKEN')
  if (!token) return res.status(503).json({ erro: 'GITHUB_TOKEN não configurado.' })
  try {
    // GitHub retorna 302 → URL assinada com o log em text/plain
    const resp = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        redirect: 'follow',
      }
    )
    if (!resp.ok) {
      const body = await resp.text()
      return res.status(resp.status).json({ erro: body || `Erro ${resp.status}` })
    }
    // Faz streaming do log bruto completo. A interface controla quantas linhas
    // entram no DOM, portanto não precisamos cortar o conteúdo recebido.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    const len = resp.headers.get('content-length')
    if (len) res.setHeader('Content-Length', len)
    if (resp.body) Readable.fromWeb(resp.body).pipe(res)
    else res.end('')
  } catch (err) {
    res.status(500).json({ erro: err.message })
  }
})

/* GET /api/github/runs/:runId/logs/download — proxy de download do zip de logs */
router.get('/runs/:runId/logs/download', autenticar, async (req, res) => {
  const { runId } = req.params
  const { owner, repo } = req.query
  if (!owner || !repo || !validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Parâmetros owner e repo obrigatórios.' })
  const { value: token } = await getCredential('github', 'GITHUB_TOKEN')
  if (!token) return res.status(503).json({ erro: 'GITHUB_TOKEN não configurado.' })
  try {
    const resp = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/actions/runs/${runId}/logs`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        redirect: 'follow',
      }
    )
    if (!resp.ok) {
      const body = await resp.text()
      return res.status(resp.status).send(body || `Erro ${resp.status}`)
    }
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="logs-run-${runId}.zip"`)
    // Streamed
    const { Readable } = await import('stream')
    Readable.fromWeb(resp.body).pipe(res)
  } catch (err) {
    res.status(500).json({ erro: err.message })
  }
})

/* POST /api/github/artifacts/:artifactId/download-ticket
   Emite URL temporária para que navegador/Android possam usar o gerenciador
   nativo de downloads sem expor o token GitHub nem o token da sessão. */
router.post('/artifacts/:artifactId/download-ticket', autenticar, async (req, res) => {
  const { artifactId } = req.params
  const { owner, repo } = req.body || {}
  const preferApk = req.body?.preferApk === true
  if (!/^\d+$/.test(String(artifactId || ''))) return res.status(400).json({ erro: 'Artefato inválido.' })
  if (!owner || !repo || !validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Parâmetros owner e repo obrigatórios.' })
  try {
    const artifact = await githubFetch(`/repos/${owner}/${repo}/actions/artifacts/${artifactId}`)
    if (!artifact || artifact.expired) return res.status(410).json({ erro: 'Este artefato expirou e não está mais disponível.' })
    const meta = await buildArtifactDownloadMeta(owner, repo, artifact)
    const format = preferApk && meta.provavelApk ? 'apk' : 'zip'
    const filename = format === 'apk' ? meta.apkFileName : meta.zipFileName
    const ticket = signArtifactDownloadTicket({
      artifactId: String(artifactId), owner, repo, format, filename,
      buildType: meta.buildType, artifactName: meta.nome,
      uid: String(req.usuario?._id || ''),
    })
    res.json({
      ok: true, ticket, artifactId: String(artifactId), format, filename,
      buildType: meta.buildType, version: meta.version || '', expiresInSeconds: 300,
    })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

/* GET /api/github/artifacts/:artifactId/download-public?ticket=...
   Endpoint temporário sem cookie/Bearer para downloads externos no Android. */
router.get('/artifacts/:artifactId/download-public', async (req, res) => {
  const { artifactId } = req.params
  try {
    const ticket = verifyArtifactDownloadTicket(String(req.query.ticket || ''))
    if (String(ticket.artifactId) !== String(artifactId)) return res.status(403).json({ erro: 'Ticket não corresponde ao artefato solicitado.' })
    const { owner, repo, format = 'zip' } = ticket
    if (!owner || !repo || !validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Ticket incompleto.' })

    const { value: token } = await getCredential('github', 'GITHUB_TOKEN')
    if (!token) return res.status(503).json({ erro: 'GITHUB_TOKEN não configurado.' })
    const resp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AL-Sistemas' },
      redirect: 'follow',
    })
    if (!resp.ok) {
      const body = await resp.text()
      return res.status(resp.status).send(body || `Erro ${resp.status}`)
    }

    const requestedName = safeDownloadBase(String(ticket.filename || 'download').replace(/\.(apk|zip)$/i, ''))
    if (format === 'apk') {
      const archiveLength = Number(resp.headers.get('content-length') || 0)
      if (archiveLength && archiveLength > APK_MAX_ARCHIVE_BYTES) return res.status(413).json({ erro: 'Artefato grande demais para extração segura no servidor.' })
      const bytes = Buffer.from(await resp.arrayBuffer())
      if (bytes.length > APK_MAX_ARCHIVE_BYTES) return res.status(413).json({ erro: 'Artefato grande demais para extração segura no servidor.' })
      const zip = await JSZip.loadAsync(bytes)
      const entries = Object.values(zip.files).filter(entry => !entry.dir && /\.apk$/i.test(entry.name))
      if (!entries.length) return res.status(422).json({ erro: 'O artefato foi baixado, mas nenhum arquivo APK foi encontrado dentro dele.' })
      const buildType = String(ticket.buildType || '')
      const preferred = entries.find(entry => buildType && new RegExp(buildType, 'i').test(entry.name)) || entries[0]
      const apk = await preferred.async('nodebuffer')
      if (apk.length > APK_MAX_EXTRACTED_BYTES) return res.status(413).json({ erro: 'APK extraído excede o limite de segurança do servidor.' })
      const filename = `${requestedName || 'app'}.apk`
      res.setHeader('Content-Type', 'application/vnd.android.package-archive')
      res.setHeader('Content-Length', String(apk.length))
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.setHeader('Cache-Control', 'private, no-store')
      return res.end(apk)
    }

    const filename = `${requestedName || `artifact-${artifactId}`}.zip`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    const length = resp.headers.get('content-length')
    if (length) res.setHeader('Content-Length', length)
    const { Readable } = await import('stream')
    Readable.fromWeb(resp.body).pipe(res)
  } catch (err) {
    const jwtError = ['JsonWebTokenError', 'NotBeforeError', 'TokenExpiredError'].includes(err?.name)
    if (jwtError) {
      const expired = err?.name === 'TokenExpiredError' || /expired/i.test(String(err?.message || ''))
      return res.status(expired ? 410 : 403).json({
        erro: expired ? 'Este link de download expirou. Toque em baixar novamente.' : 'Link de download inválido.',
      })
    }
    res.status(err?.status || 500).json({ erro: err?.message || 'Falha ao preparar o download do artefato.' })
  }
})

/* POST /api/github/release-assets/:assetId/download-ticket
   Release APK tem prioridade no card do projeto e usa ticket temporário para
   funcionar também em repositórios privados sem expor a credencial GitHub. */
router.post('/release-assets/:assetId/download-ticket', autenticar, async (req, res) => {
  const { assetId } = req.params
  const { owner, repo } = req.body || {}
  if (!/^\d+$/.test(String(assetId || ''))) return res.status(400).json({ erro: 'Asset inválido.' })
  if (!owner || !repo || !validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Parâmetros owner e repo obrigatórios.' })
  try {
    const asset = await githubFetch(`/repos/${owner}/${repo}/releases/assets/${assetId}`)
    if (!asset || !/\.apk$/i.test(String(asset.name || ''))) return res.status(422).json({ erro: 'O asset selecionado não é um APK.' })
    const releases = await githubFetch(`/repos/${owner}/${repo}/releases?per_page=20`).catch(() => [])
    const release = (Array.isArray(releases) ? releases : []).find(r => (r.assets || []).some(a => String(a.id) === String(assetId))) || null
    const meta = await buildReleaseApkMeta(owner, repo, release, asset)
    const ticket = signReleaseAssetDownloadTicket({
      assetId: String(assetId), owner, repo, filename: meta.apkFileName,
      assetName: asset.name || '', uid: String(req.usuario?._id || ''),
    })
    res.json({ ok: true, ticket, assetId: String(assetId), format: 'apk', filename: meta.apkFileName, buildType: 'release', version: meta.version || '', expiresInSeconds: 300 })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
})

/* GET /api/github/release-assets/:assetId/download-public?ticket=... */
router.get('/release-assets/:assetId/download-public', async (req, res) => {
  const { assetId } = req.params
  try {
    const ticket = verifyReleaseAssetDownloadTicket(String(req.query.ticket || ''))
    if (String(ticket.assetId) !== String(assetId)) return res.status(403).json({ erro: 'Ticket não corresponde ao APK solicitado.' })
    const { owner, repo } = ticket
    if (!owner || !repo || !validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Ticket incompleto.' })
    const { value: token } = await getCredential('github', 'GITHUB_TOKEN')
    if (!token) return res.status(503).json({ erro: 'GITHUB_TOKEN não configurado.' })
    const resp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases/assets/${assetId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/octet-stream',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'AL-Sistemas',
      },
      redirect: 'follow',
    })
    if (!resp.ok) {
      const body = await resp.text()
      return res.status(resp.status).send(body || `Erro ${resp.status}`)
    }
    const filename = `${safeDownloadBase(String(ticket.filename || ticket.assetName || `release-${assetId}`).replace(/\.apk$/i, ''))}.apk`
    res.setHeader('Content-Type', 'application/vnd.android.package-archive')
    const length = resp.headers.get('content-length')
    if (length) res.setHeader('Content-Length', length)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    const { Readable } = await import('stream')
    Readable.fromWeb(resp.body).pipe(res)
  } catch (err) {
    const jwtError = ['JsonWebTokenError', 'NotBeforeError', 'TokenExpiredError'].includes(err?.name)
    if (jwtError) {
      const expired = err?.name === 'TokenExpiredError' || /expired/i.test(String(err?.message || ''))
      return res.status(expired ? 410 : 403).json({ erro: expired ? 'Este link de download expirou. Toque em baixar novamente.' : 'Link de download inválido.' })
    }
    res.status(err?.status || 500).json({ erro: err?.message || 'Falha ao preparar o APK da release.' })
  }
})

/* GET /api/github/artifacts/:artifactId/download — proxy APK / artefato */
router.get('/artifacts/:artifactId/download', autenticar, async (req, res) => {
  const { artifactId } = req.params
  const { owner, repo, nome } = req.query
  if (!owner || !repo || !validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Parâmetros owner e repo obrigatórios.' })
  const { value: token } = await getCredential('github', 'GITHUB_TOKEN')
  if (!token) return res.status(503).json({ erro: 'GITHUB_TOKEN não configurado.' })
  try {
    const resp = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        redirect: 'follow',
      }
    )
    if (!resp.ok) {
      const body = await resp.text()
      return res.status(resp.status).send(body || `Erro ${resp.status}`)
    }
    const fileName = nome ? `${nome}.zip` : `artifact-${artifactId}.zip`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    const { Readable } = await import('stream')
    Readable.fromWeb(resp.body).pipe(res)
  } catch (err) {
    res.status(500).json({ erro: err.message })
  }
})

/* ═══════════════════════════════════════════════════════════
   DOWNLOAD ZIP — Proxy autenticado, stream direto ao browser
   Evita expor o GITHUB_TOKEN no frontend.

   GET /api/github/repos/:owner/:repo/download-zip
   Query: branch (opcional — usa default_branch se omitido)
═══════════════════════════════════════════════════════════ */
async function resolveRepoZipMeta(owner, repo, requestedRef = '') {
  let ref = String(requestedRef || '').trim()
  let repoData = null
  if (!ref) {
    repoData = await githubFetch(`/repos/${owner}/${repo}`)
    ref = repoData.default_branch || 'main'
  }
  let pkg = { name:'', version:'' }
  try { pkg = await readRepoPackageInfo(owner, repo, ref) } catch { /* versão é opcional */ }
  let version = String(pkg.version || '').trim()
  let projectName = String(pkg.name || '').trim()
  try {
    const insight = await montarRepoInsight(owner, repo, repoData?.default_branch || ref)
    if (!version) version = String(insight?.versao || '').trim()
    projectName = String(insight?.produto || projectName || repo).trim()
  } catch { /* nome/versão detectados são opcionais */ }
  const project = safeDownloadBase(projectName || repo).toLowerCase()
  const filename = `${project}${version ? `-${safeDownloadBase(version)}` : '-source'}.zip`
  return { ref, version, projectName: projectName || repo, filename }
}

/* POST /api/github/repos/:owner/:repo/download-ticket
   Gera URL temporária que pode ser entregue ao DownloadManager nativo sem cookies. */
router.post('/repos/:owner/:repo/download-ticket', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro:'Nome de repositório inválido.' })
  try {
    const meta = await resolveRepoZipMeta(owner, repo, req.body?.ref || req.body?.branch || '')
    const ticket = signRepoZipDownloadTicket({ owner, repo, ref:meta.ref, filename:meta.filename, uid:String(req.usuario?._id || '') })
    res.json({ ok:true, ticket, filename:meta.filename, version:meta.version || '', ref:meta.ref, expiresInSeconds:300 })
  } catch (err) { res.status(err.status || 500).json({ erro:err.message }) }
})

/* GET /api/github/repos/:owner/:repo/download-public?ticket=... */
router.get('/repos/:owner/:repo/download-public', async (req, res) => {
  const { owner, repo } = req.params
  try {
    const ticket = verifyRepoZipDownloadTicket(String(req.query.ticket || ''))
    if (ticket.owner !== owner || ticket.repo !== repo) return res.status(403).json({ erro:'Ticket não corresponde ao repositório solicitado.' })
    const { value: token } = await getCredential('github', 'GITHUB_TOKEN')
    if (!token) return res.status(503).json({ erro:'GITHUB_TOKEN não configurado.' })
    const zipResp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/zipball/${encodeURIComponent(ticket.ref || 'main')}`, {
      headers:{ Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'AL-Sistemas' },
      redirect:'follow', signal:AbortSignal.timeout(90_000),
    })
    if (!zipResp.ok) return res.status(zipResp.status).json({ erro:`GitHub retornou ${zipResp.status} ao preparar o ZIP.` })
    const filename = `${safeDownloadBase(String(ticket.filename || `${repo}-source`).replace(/\.zip$/i,''))}.zip`
    res.setHeader('Content-Type','application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Cache-Control','private, no-store')
    const cl=zipResp.headers.get('content-length'); if(cl) res.setHeader('Content-Length',cl)
    const { Readable } = await import('stream'); Readable.fromWeb(zipResp.body).pipe(res)
  } catch (err) {
    const jwtError=['JsonWebTokenError','NotBeforeError','TokenExpiredError'].includes(err?.name)
    if(jwtError) return res.status(err?.name==='TokenExpiredError'?410:403).json({erro:err?.name==='TokenExpiredError'?'Este link de download expirou. Tente novamente.':'Link de download inválido.'})
    if(!res.headersSent) res.status(err.status||500).json({erro:err.message})
  }
})

/* Rota autenticada legada preservada para clientes antigos. Agora também usa nome projeto-versão.zip. */
router.get('/repos/:owner/:repo/download-zip', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro:'Nome de repositório inválido.' })
  const { value: token } = await getCredential('github','GITHUB_TOKEN')
  if (!token) return res.status(503).json({ erro:'GITHUB_TOKEN não configurado.' })
  try {
    const meta = await resolveRepoZipMeta(owner, repo, req.query.branch || '')
    const zipResp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/zipball/${encodeURIComponent(meta.ref)}`, {
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}, redirect:'follow', signal:AbortSignal.timeout(90_000),
    })
    if(!zipResp.ok) return res.status(zipResp.status).json({erro:`GitHub retornou ${zipResp.status}.`})
    res.setHeader('Content-Type','application/zip'); res.setHeader('Content-Disposition',`attachment; filename="${meta.filename}"`)
    const cl=zipResp.headers.get('content-length'); if(cl) res.setHeader('Content-Length',cl)
    const {Readable}=await import('stream'); Readable.fromWeb(zipResp.body).pipe(res)
  } catch(err){ if(!res.headersSent) res.status(err.status||500).json({erro:err.message}) }
})

/* ═══════════════════════════════════════════════════════════
   SALVAR PROJETO — Sprint 5
   Baixa o zipball do branch padrão do repositório e extrai
   em PROJETOS_DIR/{nomeProjeto}/, com proteção contra Zip Slip.

   POST /api/github/repos/:owner/:repo/salvar-projeto
   Body: { nomeProjeto?: string, substituir?: boolean }
═══════════════════════════════════════════════════════════ */
router.post('/repos/:owner/:repo/salvar-projeto', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Nome de repositório inválido.' })

  // ── Validar e sanitizar nomeProjeto ───────────────────────
  let nomeProjeto = (req.body.nomeProjeto || repo).toString().trim()
  // Apenas letras, números, ponto, hífen e underscore — sem path traversal
  if (!/^[a-zA-Z0-9._-]{1,60}$/.test(nomeProjeto)) {
    return res.status(400).json({
      erro: 'Nome de projeto inválido. Use apenas letras, números, ., - ou _ (máx. 60 caracteres).',
    })
  }

  const substituir = !!req.body.substituir
  const destDir    = path.join(PROJETOS_DIR, nomeProjeto)

  // ── Verificar se pasta destino já existe ─────────────────
  if (fs.existsSync(destDir) && !substituir) {
    return res.status(409).json({
      erro: `Já existe um projeto chamado "${nomeProjeto}". Marque "Substituir" para sobrescrever.`,
    })
  }

  const { value: token } = await getCredential('github', 'GITHUB_TOKEN')
  if (!token) return res.status(503).json({ erro: 'GITHUB_TOKEN não configurado.' })

  try {
    // ── 1. Descobrir branch padrão ───────────────────────────
    let defaultBranch = 'main'
    try {
      const repoData = await githubFetch(`/repos/${owner}/${repo}`)
      defaultBranch = repoData.default_branch || 'main'
    } catch { /* usa 'main' como fallback */ }

    // ── 2. Baixar zipball (segue redirect automático) ────────
    const zipResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/zipball/${defaultBranch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(90_000),   // 90s timeout
      }
    )

    if (!zipResp.ok) {
      const body = await zipResp.text().catch(() => '')
      const msg  = zipResp.status === 404
        ? `Repositório "${owner}/${repo}" não encontrado ou sem acesso.`
        : zipResp.status === 403
          ? 'Acesso negado. Verifique os escopos do GITHUB_TOKEN.'
          : `GitHub retornou ${zipResp.status}: ${body.slice(0, 200)}`
      return res.status(zipResp.status).json({ erro: msg })
    }

    // ── 3. Carregar ZIP inteiro na memória ───────────────────
    // Não usamos arquivo temporário em /tmp — ambientes de container (Railway,
    // Render, Fly.io) frequentemente negam escrita em /tmp. O buffer já está
    // na memória após arrayBuffer(); gravá-lo em disco e lê-lo de volta só
    // adiciona risco de ENOENT sem nenhum benefício.
    const zipBuffer = Buffer.from(await zipResp.arrayBuffer())
    if (zipBuffer.length === 0) {
      throw new Error('O arquivo ZIP recebido do GitHub está vazio. Tente novamente.')
    }

    // ── 4. Garantir que PROJETOS_DIR existe ──────────────────
    if (!fs.existsSync(PROJETOS_DIR)) {
      fs.mkdirSync(PROJETOS_DIR, { recursive: true })
    }

    // ── 5. Se substituir, remover destino existente ──────────
    if (fs.existsSync(destDir) && substituir) {
      fs.rmSync(destDir, { recursive: true, force: true })
    }
    fs.mkdirSync(destDir, { recursive: true })

    // ── 6. Extrair ZIP direto da memória (sem arquivo temporário) ─
    // O zipball do GitHub gera: owner-repo-sha/...
    // Precisamos strip do primeiro nível de diretório.
    const { default: unzipper } = await import('unzipper')
    const { Readable }          = await import('stream')
    let   prefixo               = null   // detectado na primeira entry
    const arquivosExtraidos     = []     // relatório de sincronização
    const errosExtracao         = []

    await new Promise((resolve, reject) => {
      Readable.from(zipBuffer)           // ← buffer direto, sem disco
        .pipe(unzipper.Parse())
        .on('entry', entry => {
          const entryPath = entry.path

          // Detecta prefixo na primeira entry (ex: "owner-repo-abc123/")
          if (prefixo === null) {
            const firstSlash = entryPath.indexOf('/')
            prefixo = firstSlash !== -1 ? entryPath.slice(0, firstSlash + 1) : ''
          }

          // Remove o prefixo do nível raiz
          const relPath = prefixo && entryPath.startsWith(prefixo)
            ? entryPath.slice(prefixo.length)
            : entryPath

          // ── Proteção Zip Slip ────────────────────────────
          // Resolve o caminho absoluto e garante que está dentro de destDir
          const absTarget = path.resolve(destDir, relPath)
          if (!absTarget.startsWith(destDir + path.sep) && absTarget !== destDir) {
            entry.autodrain()   // descarta a entry maliciosa
            errosExtracao.push({ arquivo: relPath, motivo: 'path traversal bloqueado' })
            return
          }

          if (entry.type === 'Directory') {
            fs.mkdirSync(absTarget, { recursive: true })
            entry.autodrain()
          } else {
            // Garante que o diretório pai existe (ZIPs às vezes omitem entries de diretório)
            fs.mkdirSync(path.dirname(absTarget), { recursive: true })
            if (relPath) arquivosExtraidos.push(relPath)
            entry.pipe(fs.createWriteStream(absTarget))
              .on('error', reject)
          }
        })
        .on('close', resolve)
        .on('error', reject)
    })

    // ── 7. Nada a limpar — não há arquivo temporário ─────────

    // ── 8. AuditLog ──────────────────────────────────────────
    await AuditLog.create({
      admin_id:    req.usuario._id,
      admin_email: req.usuario.email,
      acao:        'criar',
      recurso:     'projeto_local',
      recurso_id:  nomeProjeto,
      payload:     { owner, repo, nomeProjeto, substituir, defaultBranch },
      ip:          req.ip,
      request_id:  req.requestId || null,
    })

    // ── 9. Resposta com relatório de sincronização ───────────
    res.json({
      ok:            true,
      nomeProjeto,
      branch:        defaultBranch,
      caminho:       path.join('projetos', nomeProjeto),
      mensagem:      `Repositório "${owner}/${repo}" salvo em projetos/${nomeProjeto}/`,
      relatorio: {
        totalArquivos:   arquivosExtraidos.length,
        arquivos:        arquivosExtraidos,
        erros:           errosExtracao,
        tamanhoZipBytes: zipBuffer.length,
        sincronizadoEm:  new Date().toISOString(),
        operacao:        substituir ? 'substituicao_completa' : 'criacao',
      },
    })

  } catch (err) {
    // Limpa resíduos em caso de erro (não há tmpFile para remover)
    try { if (fs.existsSync(destDir) && !req.body.substituir) fs.rmSync(destDir, { recursive: true, force: true }) } catch { /* ok */ }

    const msg = err.name === 'TimeoutError'
      ? 'Download excedeu o tempo limite (90s). O repositório pode ser muito grande.'
      : err.message || 'Erro interno ao salvar projeto.'

    res.status(500).json({ erro: msg })
  }
})

export default router
