import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import os from 'os'
import { STAGING_DIR, HISTORY_FILE, touchUpdateLock, releaseUpdateLock } from '../services/systemUpdateService.js'
import { gravarErroSistemaSpool } from '../services/systemErrorSpool.js'

const readJson=async f=>JSON.parse(await fs.readFile(f,'utf8'))
const writeJson=async(f,v)=>fs.writeFile(f,JSON.stringify(v,null,2))

const execGit=(args,{cwd,env={},timeout=120000}={})=>new Promise((resolve,reject)=>{
  const child=spawn('git',args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']})
  let stdout='',stderr=''
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(`Git excedeu ${Math.round(timeout/1000)}s: git ${args.join(' ')}`))},timeout)
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d)
  child.once('error',e=>{clearTimeout(timer);reject(e)})
  child.once('close',code=>{clearTimeout(timer);code===0?resolve({stdout:stdout.trim(),stderr:stderr.trim()}):reject(new Error((stderr||stdout||`git terminou com código ${code}`).trim()))})
})
async function gitAvailable(){try{await execGit(['--version'],{timeout:5000});return true}catch{return false}}
async function copyTreeFiltered(source,dest,skipped){
  async function walk(current,rel=''){for(const ent of await fs.readdir(current,{withFileTypes:true})){const childRel=rel?`${rel}/${ent.name}`:ent.name;if(skipped(childRel))continue;const from=path.join(current,ent.name),to=path.join(dest,childRel);if(ent.isDirectory()){await fs.mkdir(to,{recursive:true});await walk(from,childRel)}else if(ent.isFile()){await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(from,to)}}}
  await walk(source)
}

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
    rel=rel.replace(/\\/g,'/').replace(/^\.\//,'')
    const base=path.basename(rel)
    return rel==='.update-meta.json'
      || rel==='.git' || rel.startsWith('.git/')
      || rel==='node_modules' || rel.includes('/node_modules/')
      || rel==='.import_tmp' || rel.startsWith('.import_tmp/') || rel.includes('/.import_tmp/')
      || rel==='.logs' || rel.startsWith('.logs/') || rel.includes('/.logs/')
      || rel==='.pids' || rel.startsWith('.pids/') || rel.includes('/.pids/')
      || rel==='.manager.lock' || rel==='.manager.conf'
      || rel==='.al-sistemas' || rel.startsWith('.al-sistemas/') || rel.includes('/.al-sistemas/')
      || /(^|\/)(uploads|backups|logs|tmp|temp|cache|coverage)(\/|$)/i.test(rel)
      || /(^|\/)\.(vite|cache|parcel-cache|turbo)(\/|$)/i.test(rel)
      || (base.startsWith('.env') && base!=='.env.example')
      || /(^|\/)(bootstrap\.vault\.json|credentials\.vault\.json)$/i.test(rel)
      || /\.(log|pid)$/i.test(base)
  }

  function remoteGarbage(rel){
    rel=String(rel||'').replace(/\\/g,'/').replace(/^\.\//,'')
    return rel==='.import_tmp' || rel.startsWith('.import_tmp/')
      || rel==='.logs' || rel.startsWith('.logs/')
      || rel==='.pids' || rel.startsWith('.pids/')
      || rel==='.manager.lock' || rel==='.manager.conf'
      || rel==='.al-sistemas' || rel.startsWith('.al-sistemas/')
      || rel==='node_modules' || rel.startsWith('node_modules/') || rel.includes('/node_modules/')
      || /(^|\/)(uploads|backups|logs|tmp|temp|cache|coverage)(\/|$)/i.test(rel)
      || /(^|\/)\.(vite|cache|parcel-cache|turbo)(\/|$)/i.test(rel)
      || /(^|\/)\.env($|\.)/i.test(rel)
      || /(^|\/)(bootstrap\.vault\.json|credentials\.vault\.json)$/i.test(rel)
      || /\.(log|pid)$/i.test(path.basename(rel))
  }

  async function walkFiles(dir,prefix=''){
    const out=[]; const ignored=[]
    async function walk(current,rel=''){
      for(const ent of await fs.readdir(current,{withFileTypes:true})){
        const childRel=rel?`${rel}/${ent.name}`:ent.name
        const full=path.join(current,ent.name)
        if(skipped(childRel)){ ignored.push(childRel); continue }
        if(ent.isDirectory()) await walk(full,childRel)
        else if(ent.isFile()) out.push({full,rel:childRel.replace(/\\/g,'/')})
      }
    }
    await walk(dir)
    return {files:out.map(f=>({...f,target:prefix?`${prefix}/${f.rel}`:f.rel})),ignored}
  }

  async function dependencyPreflight(files){
    const warnings=[]
    for(const file of files){
      if(/(^|\/)package\.json$/i.test(file.target)){
        let pkg
        try{ pkg=JSON.parse(await fs.readFile(file.full,'utf8')) }catch{ throw new Error(`package.json inválido: ${file.target}`) }
        const groups={...(pkg.dependencies||{}),...(pkg.devDependencies||{}),...(pkg.optionalDependencies||{})}
        for(const [name,range] of Object.entries(groups)){
          if(/(?:alpha|beta|rc|canary|nightly|experimental|next)/i.test(String(range||''))){
            throw new Error(`Dependência não estável em ${file.target}: ${name}@${range}. Use uma release estável antes de publicar.`)
          }
        }
      }
      if(!/(^|\/)package-lock\.json$/i.test(file.target)) continue
      let raw=''
      try{ raw=await fs.readFile(file.full,'utf8') }catch{ continue }
      if(/typed-array-byte-offset\/-\/typed-array-byte-offset-1\.0\.5\.tgz/i.test(raw)){
        throw new Error(`Dependências inválidas em ${file.target}: o lockfile referencia typed-array-byte-offset 1.0.5, cujo tarball não está disponível no npm. Regere ou remova esse package-lock antes de publicar.`)
      }
      if(/packages\.applied-caas-gateway|internal\.api\.openai\.org|localhost|127\.0\.0\.1/i.test(raw)){
        throw new Error(`Lockfile não portável em ${file.target}: foram encontrados endereços de registry local/interno. Regere o package-lock usando o registry público antes de publicar.`)
      }
      if(/\"resolved\"\s*:\s*\"(?:file:|link:)/i.test(raw)){
        warnings.push(`${file.target}: contém dependência local (file:/link:); confirme se ela existe no repositório.`)
      }
    }
    const frontendLock=files.some(f=>f.target==='frontend/package-lock.json'||f.target==='package-lock.json'&&job.publishMode==='frontend-root')
    const frontendPkg=files.some(f=>f.target==='frontend/package.json'||f.target==='package.json'&&job.publishMode==='frontend-root')
    const backendLock=files.some(f=>f.target==='backend/package-lock.json'||f.target==='package-lock.json'&&job.publishMode==='backend-root')
    const backendPkg=files.some(f=>f.target==='backend/package.json'||f.target==='package.json'&&job.publishMode==='backend-root')
    if(frontendPkg&&!frontendLock) warnings.push('Frontend: sem package-lock obsoleto; npm install resolverá a última release estável compatível com o package.json.')
    if(backendPkg&&!backendLock) warnings.push('Backend: sem package-lock obsoleto; npm install resolverá a última release estável compatível com o package.json.')
    return warnings
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

  async function publishWithNativeGit({stage,meta,owner,repo,branch,cfg,ignored,dependencyWarnings}){
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'alsistemas-git-')),askpass=path.join(temp,'askpass.sh'),repoDir=path.join(temp,'repo')
    try{
      await fs.writeFile(askpass,'#!/bin/sh\ncase "$1" in *Username*) echo "x-access-token";; *) echo "$AL_GITHUB_TOKEN";; esac\n',{mode:0o700})
      const gitEnv={GIT_ASKPASS:askpass,GIT_TERMINAL_PROMPT:'0',AL_GITHUB_TOKEN:token}
      await phase('git-native-init','Git nativo disponível · preparando cópia de trabalho',18,{publishEngine:'git-native',ignoredCount:ignored.length,dependencyWarnings})
      await fs.mkdir(repoDir,{recursive:true});await execGit(['init'],{cwd:repoDir,env:gitEnv});await execGit(['remote','add','origin',`https://github.com/${owner}/${repo}.git`],{cwd:repoDir,env:gitEnv})
      let hasRemote=false
      try{await execGit(['fetch','--depth=1','origin',branch],{cwd:repoDir,env:gitEnv});await execGit(['checkout','-B',branch,'FETCH_HEAD'],{cwd:repoDir,env:gitEnv});hasRemote=true}catch{await execGit(['checkout','--orphan',branch],{cwd:repoDir,env:gitEnv})}
      await phase('git-native-sync','Comparando a release com o repositório',28,{publishEngine:'git-native'})
      if(cfg.deletePrefix===''){for(const ent of await fs.readdir(repoDir,{withFileTypes:true})){if(ent.name==='.git'||preserveRootPath(ent.name))continue;await fs.rm(path.join(repoDir,ent.name),{recursive:true,force:true})}}
      else if(cfg.deletePrefix)await fs.rm(path.join(repoDir,cfg.deletePrefix.replace(/\/$/,'')),{recursive:true,force:true})
      else for(const name of ['frontend','backend'])await fs.rm(path.join(repoDir,name),{recursive:true,force:true})
      if(cfg.prefix){const target=path.join(repoDir,cfg.prefix);await fs.mkdir(target,{recursive:true});await copyTreeFiltered(cfg.source,target,skipped)}else await copyTreeFiltered(cfg.source,repoDir,skipped)
      await execGit(['add','-A'],{cwd:repoDir,env:gitEnv})
      const status=(await execGit(['status','--porcelain'],{cwd:repoDir,env:gitEnv})).stdout,changes=status?status.split(/\r?\n/).filter(Boolean):[]
      const added=changes.filter(x=>x.startsWith('A ')||x.startsWith('??')).length,removed=changes.filter(x=>x.startsWith('D ')||x.slice(1,2)==='D').length,changed=Math.max(0,changes.length-added-removed),diff={total:changes.length,added,changed,removed}
      await phase('git-native-diff',changes.length?`${changes.length} alteração(ões) reais encontradas`:'Repositório já está sincronizado',48,{publishEngine:'git-native',diff,diffPreview:changes.slice(0,30)})
      if(!changes.length){const head=hasRemote?(await execGit(['rev-parse','HEAD'],{cwd:repoDir,env:gitEnv})).stdout:null;return {commitSha:head,commitUrl:head?`https://github.com/${owner}/${repo}/commit/${head}`:`https://github.com/${owner}/${repo}`,noChanges:true,diff}}
      await execGit(['config','user.name','AL Sistemas'],{cwd:repoDir,env:gitEnv});await execGit(['config','user.email','al-sistemas@localhost'],{cwd:repoDir,env:gitEnv})
      await phase('git-native-commit','Criando commit local',68,{publishEngine:'git-native'});await execGit(['commit','-m',job.commitMessage||`Atualiza AL Sistemas para ${meta.version}`],{cwd:repoDir,env:gitEnv})
      const sha=(await execGit(['rev-parse','HEAD'],{cwd:repoDir,env:gitEnv})).stdout
      await phase('git-native-push','Enviando pacote Git compactado para o GitHub',84,{publishEngine:'git-native',commitSha:sha});await execGit(['push','origin',`HEAD:${branch}`],{cwd:repoDir,env:gitEnv,timeout:180000})
      return {commitSha:sha,commitUrl:`https://github.com/${owner}/${repo}/commit/${sha}`,noChanges:false,diff}
    }finally{await fs.rm(temp,{recursive:true,force:true}).catch(()=>{})}
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
    const scan=await walkFiles(cfg.source,cfg.prefix)
    const files=scan.files
    const ignored=scan.ignored
    await phase('github-filter',`${files.length} arquivo(s) serão publicados · ${ignored.length} item(ns) local(is) ignorado(s)`,14,{filesTotal:files.length,ignoredCount:ignored.length,ignoredPreview:ignored.slice(0,25)})
    if(!files.length) throw new Error(job.sourceType==='installed'?'Nenhum arquivo publicável foi encontrado na instalação atual.':'Nenhum arquivo publicável foi encontrado no pacote.')
    const dependencyWarnings=await dependencyPreflight(files)
    await phase('github-dependencies',dependencyWarnings.length?'Dependências verificadas com aviso':'Dependências prontas para hospedagem',15,{dependencyWarnings})

    if(job.preferNativeGit!==false && await gitAvailable()){
      try{
        const native=await publishWithNativeGit({stage,meta,owner,repo,branch,cfg,ignored,dependencyWarnings})
        await phase('completed',native.noChanges?'Nenhuma alteração para publicar':'Publicado com Git nativo',100,{publishEngine:'git-native',commitSha:native.commitSha,commitUrl:native.commitUrl,version:meta.version,diff:native.diff})
        await update({status:'completed',completedAt:new Date().toISOString(),commitSha:native.commitSha,commitUrl:native.commitUrl,version:meta.version,publishEngine:'git-native',diff:native.diff,noChanges:native.noChanges})
        await history({id:job.id,type:'github-publish',status:'success',engine:'git-native',fromVersion:job.fromVersion,toVersion:meta.version,repository:job.repository,branch:job.branch,commitSha:native.commitSha,commitUrl:native.commitUrl,diff:native.diff,createdAt:new Date().toISOString()})
        if(heartbeat)clearInterval(heartbeat);if(jobFile)await releaseUpdateLock(job.id);return job
      }catch(nativeError){await phase('github-api-fallback','Git nativo não concluiu · alternando automaticamente para API',17,{publishEngine:'github-api',nativeError:nativeError.message})}
    }else await phase('github-api-mode','Git nativo indisponível · usando API do GitHub',17,{publishEngine:'github-api'})

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
    // Higiene do repositório: remove resíduos locais que versões antigas do publicador
    // possam ter enviado por engano. Esses itens nunca fazem parte do código publicável.
    for(const p of existing){ if(remoteGarbage(p) && !deletes.includes(p)) deletes.push(p) }
    if(cfg.deletePrefix!==null){
      for(const p of existing){
        const managed=cfg.deletePrefix===''?!preserveRootPath(p):p.startsWith(cfg.deletePrefix)
        if(managed && !incoming.has(p) && !deletes.includes(p)) deletes.push(p)
      }
    }else{
      for(const p of existing){
        if((p.startsWith('frontend/')||p.startsWith('backend/'))&&!incoming.has(p)&&!deletes.includes(p)) deletes.push(p)
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
    if(deletes.length) await phase('github-clean',`Removendo ${deletes.length} arquivo(s) local(is)/obsoleto(s) do repositório`,72,{deletedCount:deletes.length,deletedPreview:deletes.slice(0,25)})

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
    await phase('completed','Publicado no GitHub',100,{publishEngine:'github-api',commitSha:newCommit.sha,commitUrl,version:meta.version})
    await update({status:'completed',completedAt:new Date().toISOString(),publishEngine:'github-api',commitSha:newCommit.sha,commitUrl,version:meta.version})
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
