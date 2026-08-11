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
import { autenticar }   from '../middleware/auth.js'
import { auditLog }     from '../middleware/auditLog.js'
import AuditLog         from '../models/AuditLog.js'
import GitHubMeta       from '../models/GitHubMeta.js'
import fs               from 'fs'
import path             from 'path'
import sanitizeHtml     from 'sanitize-html'
import multer           from 'multer'
import JSZip            from 'jszip'
import crypto           from 'node:crypto'
import { githubFetch, githubFetchText, GITHUB_API }  from '../utils/githubClient.js'
import { getCredential } from '../utils/credentialStore.js'  // Sprint 6-B: utilitário centralizado
import { storeProjectSnapshot } from '../services/cloudUpdateStorage.js'
import { sugerirDescricaoRepositorio, analisarLogsWorkflow } from '../utils/aiClient.js'
import { redactAiText } from '../services/aiRedactor.js'
import { selectRelevantLogContext } from '../services/aiContext.js'
import { createAiJob } from '../services/aiJobs.js'

const router = Router()

const publishUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.AL_GITHUB_PACKAGE_MAX_BYTES || 80 * 1024 * 1024) },
})

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

async function obterBranchBase(owner,repo,branch) {
  const repoInfo=await githubFetch(`/repos/${owner}/${repo}`)
  const wanted=String(branch||repoInfo.default_branch||'main').trim()||'main'
  try{
    const ref=await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(wanted)}`)
    const commit=await githubFetch(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`)
    return {repoInfo,branch:wanted,exists:true,parentSha:ref.object.sha,baseTreeSha:commit.tree?.sha||''}
  }catch(err){
    if(err.status!==404) throw err
    try{
      const ref=await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(repoInfo.default_branch||'main')}`)
      const commit=await githubFetch(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`)
      return {repoInfo,branch:wanted,exists:false,parentSha:ref.object.sha,baseTreeSha:commit.tree?.sha||''}
    }catch(baseErr){
      if(baseErr.status!==404) throw baseErr
      return {repoInfo,branch:wanted,exists:false,parentSha:'',baseTreeSha:''}
    }
  }
}

async function publicarPacoteNoGitHub({owner,repo,branch,targetPath='',files,message,replacePath=false}) {
  let base=await obterBranchBase(owner,repo,branch)
  const prefix=normalizarTargetPath(targetPath)

  // Git Database API retorna conflito em repositórios totalmente vazios.
  // Inicializamos a branch padrão pela Contents API e, a partir daí, todo o
  // restante segue pelo mesmo commit/tree transacional usado em repos normais.
  if(!base.parentSha){
    const defaultBranch=base.repoInfo.default_branch||'main'
    if(base.branch!==defaultBranch){
      const e=new Error(`O repositório está vazio. Faça a primeira publicação na branch padrão (${defaultBranch}); depois outras branches poderão ser criadas.`);e.status=409;throw e
    }
    const first=[...files].sort((a,b)=>a.data.length-b.data.length)[0]
    const firstDest=prefix?`${prefix}/${first.path}`:first.path
    await githubFetch(`/repos/${owner}/${repo}/contents/${encodeGitPath(firstDest)}`,{method:'PUT',body:JSON.stringify({
      message:String(message||'Inicializa repositório pelo AL Sistemas').slice(0,240),
      content:first.data.toString('base64'),
    })})
    base=await obterBranchBase(owner,repo,base.branch)
  }
  const tree=[]
  const incomingPaths=new Set(files.map(file=>prefix?`${prefix}/${file.path}`:file.path))
  let removidos=0
  if(replacePath && base.baseTreeSha){
    const current=await githubFetch(`/repos/${owner}/${repo}/git/trees/${base.baseTreeSha}?recursive=1`)
    const pathPrefix=prefix?`${prefix}/`:''
    for(const item of current.tree||[]){
      if(item.type!=='blob') continue
      const within=prefix ? item.path.startsWith(pathPrefix) : true
      if(within && !incomingPaths.has(item.path)){tree.push({path:item.path,mode:'100644',type:'blob',sha:null});removidos++}
    }
  }
  let enviados=0
  for(const file of files){
    const blob=await githubFetch(`/repos/${owner}/${repo}/git/blobs`,{method:'POST',body:JSON.stringify({content:file.data.toString('base64'),encoding:'base64'})})
    const dest=prefix?`${prefix}/${file.path}`:file.path
    tree.push({path:dest,mode:'100644',type:'blob',sha:blob.sha})
    enviados++
  }
  const treeBody={tree}
  if(base.baseTreeSha) treeBody.base_tree=base.baseTreeSha
  const newTree=await githubFetch(`/repos/${owner}/${repo}/git/trees`,{method:'POST',body:JSON.stringify(treeBody)})
  if(base.baseTreeSha && newTree.sha===base.baseTreeSha) return {changed:false,branch:base.branch,commitSha:base.parentSha,commitUrl:`https://github.com/${owner}/${repo}/commit/${base.parentSha}`,enviados:0,removidos:0}
  const commitBody={message:String(message||'Publicação pelo AL Sistemas').slice(0,240),tree:newTree.sha,parents:base.parentSha?[base.parentSha]:[]}
  const commit=await githubFetch(`/repos/${owner}/${repo}/git/commits`,{method:'POST',body:JSON.stringify(commitBody)})
  if(base.exists){
    await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(base.branch)}`,{method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})})
  }else{
    await githubFetch(`/repos/${owner}/${repo}/git/refs`,{method:'POST',body:JSON.stringify({ref:`refs/heads/${base.branch}`,sha:commit.sha})})
  }
  return {changed:true,branch:base.branch,commitSha:commit.sha,commitUrl:commit.html_url||`https://github.com/${owner}/${repo}/commit/${commit.sha}`,enviados,removidos}
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
async function montarRepoInsight(owner, repo, branch='main') {
  const key = `${owner}/${repo}@${branch}`
  const cached = repoInsightCache.get(key)
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data

  const root = await githubFetch(`/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(branch)}`)
  const itens = Array.isArray(root) ? root : []
  const nomes = new Set(itens.map(i => i.name))
  const arquivos = itens.filter(i => i.type === 'file').map(i => i.name)
  const pastas = itens.filter(i => i.type === 'dir').map(i => i.name)
  let produto = null, versao = null

  const lerJson = async (nome) => {
    try {
      const f = await githubFetch(`/repos/${owner}/${repo}/contents/${encodeURIComponent(nome)}?ref=${encodeURIComponent(branch)}`)
      return JSON.parse(Buffer.from(f.content || '', 'base64').toString('utf8'))
    } catch { return null }
  }

  if (nomes.has('al-sistemas.json')) {
    const manifest = await lerJson('al-sistemas.json')
    produto = manifest?.product || 'AL Sistemas'
    versao = manifest?.version || null
  } else if (nomes.has('package.json')) {
    const pkg = await lerJson('package.json')
    produto = pkg?.name || null
    versao = pkg?.version || null
  }

  let tipo = 'Repositório de código'
  if (nomes.has('frontend') && nomes.has('backend')) tipo = 'Aplicação full-stack'
  else if (nomes.has('frontend')) tipo = 'Aplicação frontend'
  else if (nomes.has('backend')) tipo = 'Serviço backend'
  else if (nomes.has('package.json')) tipo = 'Projeto Node.js'
  else if (arquivos.some(n => /\.(sh|bash|fish)$/i.test(n))) tipo = 'Automação / CLI'
  else if (nomes.has('index.html')) tipo = 'Aplicação web'

  const deploy = [
    nomes.has('vercel.json') && 'Vercel',
    (nomes.has('render.yaml') || nomes.has('render.yml')) && 'Render',
    nomes.has('railway.toml') && 'Railway',
    nomes.has('Dockerfile') && 'Docker',
  ].filter(Boolean)
  const qualidade = [
    nomes.has('README.md') && 'README',
    nomes.has('.github') && 'GitHub Actions',
    (nomes.has('.env.example') || nomes.has('.env.sample')) && '.env exemplo',
  ].filter(Boolean)

  const data = {
    produto, versao, tipo, deploy, qualidade, pastas: pastas.slice(0, 8),
    resumo: `${produto ? `${produto}${versao ? ` ${versao}` : ''} · ` : ''}${tipo}${deploy.length ? ` · pronto para ${deploy.join(' / ')}` : ''}`,
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
        auto_init: false,
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
    const lista = repos.map(r => ({
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
    }))
    res.json({ repos: lista, total: lista.length })
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
    const itens = raw.map(i => ({
      nome: i.name, path: i.path, tipo: i.type === 'dir' ? 'pasta' : 'arquivo',
      tamanho: i.size || 0, sha: i.sha, url: i.html_url || null, downloadUrl: i.download_url || null,
    })).sort((a,b) => a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : (a.tipo === 'pasta' ? -1 : 1))
    res.json({ itens, path: rel, branch: ref, repo: `${owner}/${repo}` })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message, itens: [] })
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
  const { per_page = 20, page = 1 } = req.query
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  try {
    const commits = await githubFetch(`/repos/${owner}/${repo}/commits?per_page=${per_page}&page=${page}`)
    const lista = commits.map(c => ({
      sha: c.sha.slice(0, 7), mensagem: c.commit.message.split('\n')[0],
      autor: c.commit.author.name, data: c.commit.author.date,
      url: c.html_url, avatar: c.author?.avatar_url || null,
    }))
    res.json({ commits: lista })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message, commits: [] })
  }
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

/* GET /api/github/repos/:owner/:repo/artifacts */
router.get('/repos/:owner/:repo/artifacts', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  try {
    const data = await githubFetch(`/repos/${owner}/${repo}/actions/artifacts?per_page=20`)
    const lista = (data.artifacts || []).map(a => ({
      id: a.id, nome: a.name, tamanho: a.size_in_bytes,
      expiradoEm: a.expires_at, criadoEm: a.created_at,
      expirado: a.expired, url: a.archive_download_url,
      workflowRunId: a.workflow_run?.id || null,
    }))
    res.json({ artifacts: lista, total: data.total_count || lista.length })
  } catch (err) {
    if (err.status === 404) return res.json({ artifacts: [], total: 0 })
    res.status(err.status || 500).json({ erro: err.message, artifacts: [] })
  }
})

/* GET /api/github/repos/:owner/:repo/analysis */
router.get('/repos/:owner/:repo/analysis', autenticar, async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Nome inválido.' })
  try {
    const [repoR, langR, commitR, contentsR] = await Promise.allSettled([
      githubFetch(`/repos/${owner}/${repo}`),
      githubFetch(`/repos/${owner}/${repo}/languages`),
      githubFetch(`/repos/${owner}/${repo}/commits?per_page=30`),
      githubFetch(`/repos/${owner}/${repo}/contents`),
    ])
    const r     = repoR.status === 'fulfilled' ? repoR.value : {}
    const langs = langR.status === 'fulfilled' ? langR.value : {}
    const cms   = commitR.status === 'fulfilled' ? commitR.value : []
    const files = contentsR.status === 'fulfilled' ? (contentsR.value || []) : []
    const fileNames = files.map(f => f.name?.toLowerCase() || '')
    const langKeys  = Object.keys(langs)

    const stack = []
    if (langKeys.includes('JavaScript') || langKeys.includes('TypeScript')) {
      if (fileNames.includes('package.json')) {
        if (fileNames.some(f => f.includes('vite') || f === 'vite.config.js' || f === 'vite.config.ts')) stack.push('React/Vite')
        else if (fileNames.includes('next.config.js') || fileNames.includes('next.config.mjs')) stack.push('Next.js')
        else stack.push(langKeys.includes('TypeScript') ? 'TypeScript/Node' : 'Node.js')
      }
    }
    if (langKeys.includes('Python')) stack.push(fileNames.includes('manage.py') ? 'Django' : 'Python')
    if (langKeys.includes('Kotlin')) stack.push(fileNames.some(f => f.includes('androidmanifest')) ? 'Android/Kotlin' : 'Kotlin')
    if (langKeys.includes('Java'))   stack.push(fileNames.some(f => f.includes('androidmanifest')) ? 'Android/Java' : 'Java')
    if (langKeys.includes('Dart'))   stack.push('Flutter')
    if (langKeys.includes('Swift'))  stack.push('iOS/Swift')
    if (langKeys.includes('PHP'))    stack.push('PHP')
    if (langKeys.includes('Go'))     stack.push('Go')
    if (langKeys.includes('Rust'))   stack.push('Rust')
    if (stack.length === 0 && langKeys.length > 0) stack.push(langKeys[0])

    let deps = []
    try {
      const pkgFile = files.find(f => f.name === 'package.json')
      if (pkgFile?.download_url) {
        const pkgRes = await fetch(pkgFile.download_url)
        const pkg = await pkgRes.json()
        deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).slice(0, 12)
      }
    } catch { /* opcional */ }

    const diasSemAtividade = r.updated_at
      ? Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400000) : 9999
    const maturidade = diasSemAtividade < 30 ? 'ativo' : diasSemAtividade < 180 ? 'moderado' : diasSemAtividade < 365 ? 'inativo' : 'abandonado'
    const freqCommits = Array.isArray(cms) ? cms.length : 0
    const frequencia  = freqCommits >= 20 ? 'alta' : freqCommits >= 8 ? 'média' : freqCommits >= 2 ? 'baixa' : 'inativa'
    const totalLinhas = Object.values(langs).reduce((a, b) => a + b, 0)
    const complexidade = totalLinhas > 100000 ? 'alta' : totalLinhas > 20000 ? 'média' : totalLinhas > 3000 ? 'baixa' : 'mínima'

    res.json({
      stack, linguagens: langs, maturidade, frequenciaCommits: frequencia,
      diasSemAtividade, complexidade, dependencias: deps,
      totalArquivos: files.length,
      hasCI:     fileNames.includes('.github') || fileNames.some(f => f.includes('ci')),
      hasDocker: fileNames.includes('dockerfile') || fileNames.includes('docker-compose.yml'),
      hasTestes: fileNames.some(f => ['test','spec','jest','vitest','__tests__'].some(k => f.includes(k))),
      temLicense: fileNames.some(f => f.startsWith('license')),
    })
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message })
  }
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

/* POST /api/github/repos/:owner/:repo/publicar-pacote
   Publicação independente do módulo Projetos. O arquivo ZIP é enviado pelo
   navegador, descompactado apenas em memória e aplicado ao caminho GitHub
   escolhido. Vercel/Render permanecem uma etapa posterior e opcional. */
router.post('/repos/:owner/:repo/publicar-pacote', autenticar, publishUpload.single('package'), async (req, res) => {
  const { owner, repo } = req.params
  if (!validarNome(owner) || !validarNome(repo)) return res.status(400).json({ erro: 'Repositório de origem inválido.' })
  if (!req.file?.buffer) return res.status(400).json({ erro: 'Selecione um arquivo ZIP para publicar.' })
  const original = String(req.file.originalname || 'projeto.zip')
  if (!/\.zip$/i.test(original)) return res.status(400).json({ erro: 'O pacote precisa ser um arquivo .zip.' })

  const repository = String(req.body?.repository || `${owner}/${repo}`).trim()
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return res.status(400).json({ erro: 'Selecione um repositório GitHub válido.' })
  const [destOwner, destRepo] = repository.split('/')
  const branch = String(req.body?.branch || 'main').trim() || 'main'
  if (!/^[A-Za-z0-9._\/-]{1,200}$/.test(branch) || branch.includes('..')) return res.status(400).json({ erro: 'Branch de destino inválida.' })
  let targetPath = ''
  try { targetPath = normalizarTargetPath(req.body?.targetPath || '') } catch (e) { return res.status(e.status || 400).json({ erro: e.message }) }
  const replacePath = String(req.body?.replacePath || '').toLowerCase() === 'true'
  const snapshotR2 = String(req.body?.snapshotR2 || '').toLowerCase() === 'true'
  const commitMessage = String(req.body?.commitMessage || `Publica ${original} pelo AL Sistemas`).trim().slice(0, 240)

  try {
    const [sourceRepo, destination] = await Promise.all([
      githubFetch(`/repos/${owner}/${repo}`),
      githubFetch(`/repos/${destOwner}/${destRepo}`),
    ])
    const writable = Boolean(destination.permissions?.push || destination.permissions?.maintain || destination.permissions?.admin)
    if (!writable) return res.status(403).json({ erro: `O token salvo em Integrações e APIs não possui escrita em ${repository}.` })

    const unpacked = await extrairZipPublicavel(req.file.buffer)
    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex')
    let snapshot = null
    if (snapshotR2) {
      snapshot = await storeProjectSnapshot(req.file.buffer, {
        owner: destOwner, repo: destRepo, branch, filename: original, sha256,
      })
    }

    const result = await publicarPacoteNoGitHub({
      owner: destOwner, repo: destRepo, branch, targetPath,
      files: unpacked.files, message: commitMessage, replacePath,
    })

    await GitHubMeta.findOneAndUpdate(
      { repoId: Number(sourceRepo.id) },
      { $set: {
        nomeCompleto: sourceRepo.full_name,
        publicacao: { repository, branch: result.branch || branch, path: targetPath, snapshotR2 },
      } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => {})

    await AuditLog.create({
      admin_id: req.usuario._id, admin_email: req.usuario.email,
      acao: 'publicar', recurso: 'github_pacote', recurso_id: repository,
      payload: { source: `${owner}/${repo}`, repository, branch: result.branch || branch, targetPath, replacePath, snapshotR2, files: unpacked.files.length, bytes: unpacked.totalBytes, sha256 },
      ip: req.ip, request_id: req.requestId || null,
    }).catch(() => {})

    repoInsightCache.delete(`${destOwner}/${destRepo}@${result.branch || branch}`)
    res.status(201).json({
      ok: true,
      mensagem: result.changed ? `Pacote publicado em ${repository} com sucesso.` : 'O conteúdo enviado já corresponde ao conteúdo do GitHub.',
      destino: { repository, branch: result.branch || branch, path: targetPath || '/', replacePath },
      pacote: { nome: original, sha256, arquivos: unpacked.files.length, bytes: unpacked.totalBytes, raizRemovida: unpacked.commonRoot || null },
      snapshot,
      commit: result,
    })
  } catch (err) {
    const msg = err.status === 403
      ? `GitHub recusou a gravação em ${repository}. Confira Contents: Read and write para o token salvo em Integrações e APIs.`
      : err.message
    res.status(err.status || 500).json({ erro: msg })
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
    const texto = await resp.text()
    // Limita a 200KB para não estourar o response
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.send(texto.slice(0, 200 * 1024))
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
router.get('/repos/:owner/:repo/download-zip', autenticar, async (req, res) => {
  const { owner, repo }     = req.params
  const { branch: qBranch } = req.query

  if (!validarNome(owner) || !validarNome(repo))
    return res.status(400).json({ erro: 'Nome de repositório inválido.' })

  const { value: token } = await getCredential('github', 'GITHUB_TOKEN')
  if (!token) return res.status(503).json({ erro: 'GITHUB_TOKEN não configurado.' })

  try {
    let branch = qBranch
    if (!branch) {
      try {
        const repoData = await githubFetch(`/repos/${owner}/${repo}`)
        branch = repoData.default_branch || 'main'
      } catch { branch = 'main' }
    }

    const zipResp = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/zipball/${branch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(90_000),
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

    const fileName = `${repo}-${branch}.zip`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)

    const cl = zipResp.headers.get('content-length')
    if (cl) res.setHeader('Content-Length', cl)

    const { Readable } = await import('stream')
    Readable.fromWeb(zipResp.body).pipe(res)

  } catch (err) {
    if (!res.headersSent)
      res.status(500).json({ erro: err.message })
  }
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
