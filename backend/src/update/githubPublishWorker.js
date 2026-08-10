import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { STAGING_DIR, HISTORY_FILE, touchUpdateLock, releaseUpdateLock } from '../services/systemUpdateService.js'
import { gravarErroSistemaSpool } from '../services/systemErrorSpool.js'

const readJson=async f=>JSON.parse(await fs.readFile(f,'utf8'))
const writeJson=async(f,v)=>fs.writeFile(f,JSON.stringify(v,null,2))

export async function runGithubPublish(initialJob,token,{jobFile=null,persistHistory=true}={}){
  if(!token) throw new Error('Token GitHub ausente.')
  let job={...initialJob}
  let heartbeat=null
  if(jobFile){
    heartbeat=setInterval(()=>{void touchUpdateLock(job.id,'github-publish')},5000)
    heartbeat.unref?.()
    void touchUpdateLock(job.id,'github-publish')
  }

  async function update(patch){
    job={...job,...patch}
    if(jobFile) await writeJson(jobFile,job)
    return job
  }
  async function history(entry){
    if(!persistHistory) return
    let h=[]
    try{h=await readJson(HISTORY_FILE)}catch{}
    h.unshift(entry)
    await writeJson(HISTORY_FILE,h.slice(0,100))
  }
  async function phase(key,label,progress,extra={}){
    const entry={key,label,progress,at:new Date().toISOString(),...extra}
    await update({phase:key,phaseLabel:label,progress,timeline:[...(job.timeline||[]),entry].slice(-40),...extra})
  }

  const headers={
    Authorization:`Bearer ${token}`,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'AL-Sistemas',
    'Content-Type':'application/json',
  }

  async function gh(method,url,body){
    const res=await fetch(`https://api.github.com${url}`,{
      method,headers,body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(30000),
    })
    const data=await res.json().catch(()=>({}))
    if(!res.ok){
      const e=new Error(data.message||`GitHub respondeu ${res.status}`)
      e.status=res.status
      throw e
    }
    return data
  }

  function skipped(rel){
    rel=rel.replace(/\\/g,'/')
    const base=path.basename(rel)
    return rel==='.update-meta.json'
      || rel==='.git' || rel.startsWith('.git/')
      || rel.includes('/node_modules/') || rel==='node_modules'
      || rel.includes('/.al-sistemas/') || rel.endsWith('/.al-sistemas')
      || /(^|\/)(uploads|backups|logs)(\/|$)/.test(rel)
      || (base.startsWith('.env') && base!=='.env.example')
      || /(^|\/)(bootstrap\.vault\.json|credentials\.vault\.json)$/i.test(rel)
  }

  async function walkFiles(dir,prefix=''){
    const out=[]
    async function walk(current,rel=''){
      for(const ent of await fs.readdir(current,{withFileTypes:true})){
        const childRel=rel?`${rel}/${ent.name}`:ent.name
        const full=path.join(current,ent.name)
        if(skipped(childRel)) continue
        if(ent.isDirectory()) await walk(full,childRel)
        else if(ent.isFile()) out.push({full,rel:childRel.replace(/\\/g,'/')})
      }
    }
    await walk(dir)
    return out.map(f=>({...f,target:prefix?`${prefix}/${f.rel}`:f.rel}))
  }

  function modeConfig(stage,mode){
    if(mode==='frontend-folder') return {source:path.join(stage,'frontend'),prefix:'frontend',deletePrefix:'frontend/'}
    if(mode==='backend-folder') return {source:path.join(stage,'backend'),prefix:'backend',deletePrefix:'backend/'}
    if(mode==='frontend-root') return {source:path.join(stage,'frontend'),prefix:'',deletePrefix:''}
    return {source:stage,prefix:'',deletePrefix:null}
  }

  function preserveRootPath(p){
    return p==='.gitignore'||p==='README.md'||p==='LICENSE'||p==='LICENSE.md'||p==='vercel.json'||p.startsWith('.github/')||p.startsWith('backend/')
  }

  try{
    await update({status:'running',startedAt:new Date().toISOString(),timeline:[],progress:2})
    await phase('github-validate','Validando destino no GitHub',5)
    const stage=job.stagePath||path.join(STAGING_DIR,job.stageId)
    let meta
    try{ meta=await readJson(path.join(stage,'.update-meta.json')) }
    catch{ meta={version:job.toVersion||'desconhecida'} }

    const [owner,repo]=String(job.repository||'').split('/')
    if(!owner||!repo) throw new Error('Repositório inválido.')
    const branch=job.branch||'main'

    let emptyRepository=false
    let wasEmptyRepository=false
    let repositoryDefaultBranch='main'
    let baseCommitSha=null
    let baseTreeSha=null
    try{
      const ref=await gh('GET',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`)
      baseCommitSha=ref.object?.sha||null
      if(baseCommitSha){
        const commit=await gh('GET',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${baseCommitSha}`)
        baseTreeSha=commit.tree?.sha||null
      }
    }catch(err){
      if(err.status===409 || err.status===404){
        let repoInfo=null
        try{ repoInfo=await gh('GET',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`) }catch{}
        emptyRepository=Number(repoInfo?.size||0)===0
        repositoryDefaultBranch=String(repoInfo?.default_branch||'main')
        if(emptyRepository) wasEmptyRepository=true
        if(!emptyRepository && err.status===404){
          const defaultBranch=repoInfo?.default_branch
          if(!defaultBranch) throw err
          const baseRef=await gh('GET',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(defaultBranch)}`)
          baseCommitSha=baseRef.object?.sha||null
          if(baseCommitSha){
            const commit=await gh('GET',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${baseCommitSha}`)
            baseTreeSha=commit.tree?.sha||null
          }
        }else if(!emptyRepository) throw err
      }else throw err
    }

    await phase(emptyRepository?'github-empty':'github-scan',emptyRepository?'Repositório vazio — preparando primeiro commit':job.sourceType==='installed'?'Preparando arquivos da instalação atual':'Preparando arquivos do pacote',12)
    const cfg=modeConfig(stage,job.publishMode)
    const files=await walkFiles(cfg.source,cfg.prefix)
    if(!files.length) throw new Error(job.sourceType==='installed'?'Nenhum arquivo publicável foi encontrado na instalação atual.':'Nenhum arquivo publicável foi encontrado no pacote.')

    // A Git Database API do GitHub (blobs/trees/refs) devolve 409 em repositórios
    // totalmente vazios. Inicializamos a branch usando a Contents API com um arquivo
    // real do projeto e, em seguida, retomamos a sincronização normal pela Git API.
    // Isso também evita criar refs manualmente em um repositório que ainda não possui branch.
    if(emptyRepository){
      const seed=files.find(f=>f.target==='README.md')||files.find(f=>f.target==='.gitignore')||files[0]
      const seedContent=await fs.readFile(seed.full)
      if(seedContent.length>100*1024*1024) throw new Error(`Arquivo inicial excede o limite do GitHub: ${seed.target}`)
      await phase('github-init',`Inicializando repositório com ${seed.target}`,16,{seedFile:seed.target})
      const initBody={
        message:`Inicializa ${meta.version||'AL Sistemas'} para publicação`,
        content:seedContent.toString('base64'),
      }
      // Em repositório vazio a Contents API inicializa a branch padrão. Caso o usuário
      // tenha escolhido outra branch, criamos essa ref depois que o primeiro commit existir.
      if(branch===repositoryDefaultBranch) initBody.branch=branch
      const initialized=await gh('PUT',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${seed.target.split('/').map(encodeURIComponent).join('/')}`,initBody)
      baseCommitSha=initialized.commit?.sha||null
      if(!baseCommitSha) throw new Error('O GitHub inicializou o repositório, mas não retornou o commit inicial.')
      if(branch!==repositoryDefaultBranch){
        await gh('POST',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,{ref:`refs/heads/${branch}`,sha:baseCommitSha})
      }
      const initialCommit=await gh('GET',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${baseCommitSha}`)
      baseTreeSha=initialCommit.tree?.sha||null
      if(!baseTreeSha) throw new Error('Não foi possível obter a árvore do primeiro commit no GitHub.')
      emptyRepository=false
      await phase('github-init-ready','Repositório inicializado — sincronizando projeto completo',20,{baseCommitSha})
    }

    let existing=[]
    if(baseTreeSha){
      const currentTree=await gh('GET',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${baseTreeSha}?recursive=1`)
      existing=(currentTree.tree||[]).filter(e=>e.type==='blob').map(e=>e.path)
    }
    const incoming=new Set(files.map(f=>f.target))
    const deletes=[]
    if(cfg.deletePrefix!==null){
      for(const p of existing){
        const managed=cfg.deletePrefix===''?!preserveRootPath(p):p.startsWith(cfg.deletePrefix)
        if(managed && !incoming.has(p)) deletes.push(p)
      }
    }else{
      for(const p of existing){
        if((p.startsWith('frontend/')||p.startsWith('backend/'))&&!incoming.has(p)) deletes.push(p)
      }
    }

    const entries=[]
    let n=0
    for(const file of files){
      const stat=await fs.stat(file.full)
      if(stat.size>95*1024*1024) throw new Error(`Arquivo excede o limite seguro para publicação: ${file.target}`)
      const content=await fs.readFile(file.full)
      const blob=await gh('POST',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,{
        content:content.toString('base64'),encoding:'base64',
      })
      entries.push({path:file.target,mode:'100644',type:'blob',sha:blob.sha})
      n++
      const progress=15+Math.floor((n/files.length)*55)
      if(n===1||n===files.length||n%10===0) await phase('github-upload',`Enviando arquivos ao GitHub (${n}/${files.length})`,progress,{filesDone:n,filesTotal:files.length})
    }
    for(const p of deletes) entries.push({path:p,mode:'100644',type:'blob',sha:null})

    await phase('github-tree','Montando nova versão no repositório',74)
    const treeBody={tree:entries}
    if(baseTreeSha) treeBody.base_tree=baseTreeSha
    const tree=await gh('POST',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,treeBody)

    await phase('github-commit',wasEmptyRepository?'Criando commit com o projeto completo':'Criando commit da atualização',82)
    const message=job.commitMessage||`Atualiza AL Sistemas para ${meta.version}`
    const commitBody={message,tree:tree.sha}
    if(baseCommitSha) commitBody.parents=[baseCommitSha]
    const newCommit=await gh('POST',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,commitBody)

    await phase('github-push',wasEmptyRepository?'Finalizando primeira publicação':'Publicando commit na branch',91)
    if(!baseCommitSha){
      await gh('POST',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,{ref:`refs/heads/${branch}`,sha:newCommit.sha})
    }else{
      try{
        await gh('PATCH',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,{sha:newCommit.sha,force:false})
      }catch(err){
        if(err.status!==404&&err.status!==422) throw err
        await gh('POST',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,{ref:`refs/heads/${branch}`,sha:newCommit.sha})
      }
    }

    const commitUrl=`https://github.com/${owner}/${repo}/commit/${newCommit.sha}`
    await phase('completed','Publicado no GitHub',100,{commitSha:newCommit.sha,commitUrl,version:meta.version})
    await update({status:'completed',completedAt:new Date().toISOString(),commitSha:newCommit.sha,commitUrl,version:meta.version})
    await history({id:job.id,type:'github-publish',status:'success',fromVersion:job.fromVersion,toVersion:meta.version,repository:job.repository,branch:job.branch,commitSha:newCommit.sha,commitUrl,createdAt:new Date().toISOString()})
    if(heartbeat)clearInterval(heartbeat)
    if(jobFile)await releaseUpdateLock(job.id)
    return job
  }catch(err){
    let message=err.message
    if(/Resource not accessible by personal access token/i.test(message)){
      message='O token consegue acessar o repositório, mas não tem permissão para publicar arquivos. Para esta integração, use preferencialmente um Personal Access Token (classic) com repo (ou public_repo para repositório público).'
    }
    await gravarErroSistemaSpool({
      tipo:'github', mensagem:message, stack:err.stack, rota:'/admin/atualizacoes',
      dados:{source:'github-publish-worker',jobId:job.id,phase:job.phase,phaseLabel:job.phaseLabel,repository:job.repository,branch:job.branch,fromVersion:job.fromVersion,toVersion:job.toVersion},
    }).catch(()=>{})
    await phase('failed','Falha ao publicar no GitHub',100,{error:message}).catch(()=>{})
    await update({status:'failed',error:message,completedAt:new Date().toISOString()}).catch(()=>{})
    await history({id:job.id,type:'github-publish',status:'failed',fromVersion:job.fromVersion,toVersion:job.toVersion,repository:job.repository,branch:job.branch,error:message,createdAt:new Date().toISOString()}).catch(()=>{})
    if(heartbeat)clearInterval(heartbeat)
    if(jobFile)await releaseUpdateLock(job.id).catch(()=>{})
    const error=new Error(message)
    error.job=job
    throw error
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)
if(isCli){
  const jobFile=process.argv[2]
  const token=process.env.AL_GITHUB_PUBLISH_TOKEN
  if(!jobFile||!token) process.exit(2)
  const job=await readJson(jobFile)
  runGithubPublish(job,token,{jobFile,persistHistory:true})
    .then(()=>process.exit(0))
    .catch(()=>process.exit(1))
}
