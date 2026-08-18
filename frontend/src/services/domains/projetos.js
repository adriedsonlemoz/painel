/**
 * projetos.js — Serviço de domínio: Projetos Locais
 *
 * Sprint 3 — ADIÇÃO PURA.
 * Sprint 7 — GitHub Sync: vincular, desvincular, syncStatus, registrarSincronizacao.
 */
import { api, BASE_URL, withAuthHeaders } from './http.js'

async function uploadProjetoPersistente(destino, file, nomeProjeto, { substituir = false, onProgress } = {}) {
  if (!['gridfs','r2'].includes(destino)) throw new Error('Destino persistente inválido.')
  const endpoint = destino === 'r2' ? '/projetos/upload-r2' : '/projetos/upload-gridfs'
  const form = new FormData()
  form.append('zip', file)
  form.append('nomeProjeto', nomeProjeto)
  form.append('substituir', String(Boolean(substituir)))
  const initial = await new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest()
    xhr.open('POST', `${BASE_URL}${endpoint}`)
    xhr.withCredentials=true
    withAuthHeaders().forEach((value,key)=>xhr.setRequestHeader(key,value))
    xhr.upload.onprogress=e=>{
      if(e.lengthComputable)onProgress?.({phase:'upload',percent:Math.min(82,Math.round((e.loaded/e.total)*82)),loaded:e.loaded,total:e.total})
    }
    xhr.onerror=()=>reject(new Error(`Não foi possível conectar ao backend em ${BASE_URL}.`))
    xhr.onload=()=>{
      let data={};try{data=JSON.parse(xhr.responseText||'{}')}catch{}
      if(xhr.status<200||xhr.status>=300)return reject(new Error(data.erro||`Erro ${xhr.status}`))
      resolve(data)
    }
    xhr.send(form)
  })
  if(!initial?.jobId){onProgress?.({phase:'done',percent:100});return initial}
  const statusPath=destino==='r2'?`/projetos/upload-r2/status/${encodeURIComponent(initial.jobId)}`:`/projetos/upload-gridfs/status/${encodeURIComponent(initial.jobId)}`
  const deadline=Date.now()+15*60_000
  while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,850))
    const job=await api(statusPath,{timeoutMs:15000})
    const total=Number(job.total||initial.total||0), enviados=Number(job.enviados||0)
    const pct=total?Math.round((enviados/total)*100):0
    onProgress?.({phase:job.fase||'processando',percent:Math.max(83,Math.min(99,83+Math.round(pct*.16))),enviados,total})
    if(['done','success'].includes(job.status)){onProgress?.({phase:'done',percent:100,enviados,total});return {...initial,...job}}
    if(job.status==='error')throw new Error(job.msg||job.erro||'Falha ao processar o ZIP.')
  }
  throw new Error('O processamento do pacote excedeu 15 minutos.')
}

export const projetosService = {
  /* ── Originais (Sprint 3 — inalterados) ──────────────────── */

  /** Lista todos os projetos do diretório /projetos */
  listar: () => api('/projetos'),

  /** Detalhes de um projeto específico por nome */
  detalhe: (nome) => api(`/projetos/${encodeURIComponent(nome)}`),

  /* ── GitHub Sync (Sprint 7) ───────────────────────────────── */

  /** Envia um ZIP do browser e extrai na pasta Projetos do servidor */
  upload: (formData) =>
    api('/projetos/upload', { method: 'POST', body: formData, headers: {} }),

  /**
   * Vincula um projeto local a um repositório GitHub.
   * O backend verifica se o repo existe antes de salvar.
   */
  vincular: (nome, owner, repo) =>
    api(`/projetos/${encodeURIComponent(nome)}/vincular`, {
      method: 'POST',
      body:   JSON.stringify({ owner, repo }),
    }),

  /**
   * Remove o vínculo entre o projeto local e o repositório GitHub.
   */
  desvincular: (nome) =>
    api(`/projetos/${encodeURIComponent(nome)}/vincular`, {
      method: 'POST',
      body:   JSON.stringify({ owner: null, repo: null }),
    }),

  /**
   * Retorna o status de sincronização do projeto com o GitHub:
   * { vinculado, owner, repo, statusSync, dataPushGitHub, dataLocalModificacao, ... }
   */
  syncStatus: (nome) =>
    api(`/projetos/${encodeURIComponent(nome)}/sync-status`),

  /**
   * Salva timestamp de última sincronização no MongoDB.
   * Deve ser chamado após um pull (salvar-projeto) bem-sucedido.
   */
  registrarSincronizacao: (nome) =>
    api(`/projetos/${encodeURIComponent(nome)}/registrar-sincronizacao`, {
      method: 'POST',
    }),

  /* ── Cloudflare R2 (Sprint 12) ───────────────────────────── */

  /** Lista projetos (prefixes) no bucket R2 configurado */
  listarR2: () => api('/projetos/r2'),

  /** Lista arquivos de um projeto específico no R2 */
  arquivosR2: (nome) => api(`/projetos/r2/${encodeURIComponent(nome)}`),

  /** Remove todos os arquivos de um projeto do bucket R2 */
  deletarR2: (nome) => api(`/projetos/r2/${encodeURIComponent(nome)}`, { method: 'DELETE' }),

  /** Verifica credenciais, bucket e permissões do Cloudflare R2 */
  r2Health: () => api('/projetos/r2/health'),

  /** Compara data do último commit GitHub com data do deploy (R2 ou GridFS) */
  githubStatus: (nome, uploadedAt) =>
    api(`/projetos/github-status?nome=${encodeURIComponent(nome)}&uploadedAt=${encodeURIComponent(uploadedAt || '')}`),

  /* ── GridFS (Sprint 11) ───────────────────────────────────── */

  /** Upload de um .zip → extração em memória → GridFS (retorna { jobId, total, nomeProjeto }) */
  uploadGridFS: (formData) =>
    api('/projetos/upload-gridfs', { method: 'POST', body: formData, headers: {} }),

  /** Upload persistente com progresso real para o novo fluxo GitHub. */
  uploadPersistente: (destino, file, nomeProjeto, options = {}) => uploadProjetoPersistente(destino, file, nomeProjeto, options),

  /** Polling do progresso de um job de upload GridFS */
  uploadGridFSStatus: (jobId) =>
    api(`/projetos/upload-gridfs/status/${encodeURIComponent(jobId)}`),

  /** Diagnóstico do MongoDB/GridFS antes de preparar um pacote. */
  gridfsHealth: () => api('/projetos/gridfs/health'),

  /** Lista todos os projetos armazenados no GridFS */
  listarGridFS: () => api('/projetos/gridfs'),

  /** Árvore de arquivos de um projeto no GridFS */
  detalheGridFS: (nome) =>
    api(`/projetos/gridfs/${encodeURIComponent(nome)}`),

  /** Conteúdo de um arquivo específico no GridFS */
  arquivoGridFS: (nome, filePath) =>
    api(`/projetos/gridfs/${encodeURIComponent(nome)}/arquivo?path=${encodeURIComponent(filePath)}`),

  /** Remove um projeto inteiro do GridFS */
  deletarGridFS: (nome) =>
    api(`/projetos/gridfs/${encodeURIComponent(nome)}`, { method: 'DELETE' }),
}
