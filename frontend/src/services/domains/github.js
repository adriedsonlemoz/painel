/**
 * github.js — Serviço de domínio: GitHub Module (Sprint 4)
 *
 * Sprint 3 EXTENSÃO — ADIÇÃO PURA (originais preservados).
 * Sprint 4 — Secrets + Workflows + Runs + Logs + Download APK
 *
 * Todas as chamadas passam pelo proxy backend. Token NUNCA exposto no frontend.
 */
import { api, BASE_URL, authFetch, withAuthHeaders } from './http.js'
import { Capacitor, registerPlugin } from '@capacitor/core'




const NativeDownloadManager = registerPlugin('ALDownloadManager')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Download no Android sem sair do aplicativo. O plugin nativo usa o DownloadManager
 * do sistema, grava em Downloads/AL-Sistemas e continua mesmo se a WebView pausar.
 * Na web, o servidor continua responsável pelo Content-Disposition e o navegador baixa direto.
 */
function normalizarDownloadId(value) {
  if (value === null || value === undefined || value === '') return ''
  return String(value).trim()
}

async function baixarComGerenciador(url, filename = 'download', mime = 'application/octet-stream', onStatus) {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ALDownloadManager')) {
    onStatus?.('preparing', { filename, progress: 0 })
    const queued = await NativeDownloadManager.download({ url, filename, mime })
    const id = normalizarDownloadId(queued?.id)
    if (!id) throw new Error('O Android não confirmou o início do download.')
    onStatus?.('queued', { id, filename, progress:0, total:0, downloaded:0 })
    const deadline = Date.now() + 45 * 60_000
    let lastProgress = -1
    let lastStatus = ''
    while (Date.now() < deadline) {
      const state = await NativeDownloadManager.getStatus({ id })
      const status = String(state?.status || 'pending')
      const progress = Number.isFinite(Number(state?.progress)) ? Math.max(0, Math.min(100, Number(state.progress))) : 0
      if (progress !== lastProgress || status !== lastStatus) {
        lastProgress = progress; lastStatus = status
        const visual = status === 'successful' ? 'completed'
          : status === 'failed' ? 'failed'
          : status === 'cancelled' ? 'cancelled'
          : status === 'paused' ? 'paused'
          : status === 'pending' ? 'queued' : 'progress'
        onStatus?.(visual, { ...state, id, filename, progress })
      }
      if (status === 'successful') return { ok:true, mode:'android-download-manager', id, filename, progress:100, uri:state?.uri || '', total:state?.total || 0 }
      if (status === 'failed') throw Object.assign(new Error(state?.message || 'O Android não conseguiu concluir o download.'), { downloadId:id, code:'ANDROID_DOWNLOAD_FAILED' })
      if (status === 'cancelled') throw Object.assign(new Error('Download cancelado.'), { downloadId:id, code:'ANDROID_DOWNLOAD_CANCELLED' })
      await sleep(650)
    }
    // O Android continua dono da transferência. Não marcar como falha só porque
    // a tela deixou de acompanhar após o limite de observação.
    onStatus?.('background', { id, filename, progress:lastProgress < 0 ? 0 : lastProgress })
    return { ok:true, mode:'android-download-manager-background', id, filename, progress:lastProgress < 0 ? 0 : lastProgress }
  }

  onStatus?.('downloading', { filename })
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url, windowName:'_blank' })
    onStatus?.('started', { filename })
    return { ok:true, mode:'android-browser-fallback', filename }
  }
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.rel = 'noopener noreferrer'; a.target = '_self'
  document.body.appendChild(a); a.click(); a.remove()
  onStatus?.('started', { filename })
  return { ok:true, mode:'browser', filename }
}

function artifactPublicUrl(artifactId, ticket) {
  return `${BASE_URL}/github/artifacts/${artifactId}/download-public?ticket=${encodeURIComponent(ticket)}`
}

function releaseAssetPublicUrl(assetId, ticket) {
  return `${BASE_URL}/github/release-assets/${assetId}/download-public?ticket=${encodeURIComponent(ticket)}`
}

async function baixarAutenticado(url, fallbackName = 'download') {
  const resp = await authFetch(url, { method:'GET' })
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}))
    throw new Error(data.erro || `Erro ${resp.status}`)
  }
  const blob = await resp.blob()
  const cd = resp.headers.get('content-disposition') || ''
  const m = cd.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i)
  const filename = decodeURIComponent((m?.[1] || fallbackName).replace(/^\"|\"$/g,''))
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  // Revogar imediatamente pode cancelar downloads em WebView/Android.
  setTimeout(() => URL.revokeObjectURL(href), 30_000)
  return { ok:true, filename }
}

export const githubService = {
  /* ── Originais (preservados) ─────────────────────────── */
  status: () => api('/github/status'),
  orgs: () => api('/github/orgs'),
  atualizarPerfil: (dados) => api('/github/profile', { method: 'PATCH', body: JSON.stringify(dados) }),
  repos: ({ page = 1, per_page = 30, sort = 'updated', type = 'all', enrich = false } = {}) =>
    api(`/github/repos?page=${page}&per_page=${per_page}&sort=${sort}&type=${type}&enrich=${enrich ? '1' : '0'}`),
  repo: (owner, repo) => api(`/github/repos/${owner}/${repo}`),
  atualizarRepo: (owner, repo, dados) => api(`/github/repos/${owner}/${repo}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  sugerirDescricao: (owner, repo, provedor = '') => api(`/github/repos/${owner}/${repo}/descricao-ia`, { method: 'POST', body: JSON.stringify({ provedor }) }),
  insight: (owner, repo, branch = 'main') => api(`/github/repos/${owner}/${repo}/insight?branch=${encodeURIComponent(branch)}`),
  contents: (owner, repo, path = '', branch = '') => api(`/github/repos/${owner}/${repo}/contents?path=${encodeURIComponent(path)}&branch=${encodeURIComponent(branch)}`),
  contentInfo: (owner, repo, path = '', branch = '') => api(`/github/repos/${owner}/${repo}/content-info?path=${encodeURIComponent(path)}&branch=${encodeURIComponent(branch)}`),
  excluirConteudo: (owner, repo, path, branch = '') => api(`/github/repos/${owner}/${repo}/contents`, { method: 'DELETE', body: JSON.stringify({ path, branch, confirmar: true, confirmarPath: path }) }),
  excluirConteudoLote: (owner, repo, payload = {}) => api(`/github/repos/${owner}/${repo}/contents/batch`, { method: 'DELETE', body: JSON.stringify(payload) }),
  analisarResiduos: (owner, repo, branch = '') => api(`/github/repos/${owner}/${repo}/cleanup-preview?branch=${encodeURIComponent(branch)}`),
  limparResiduos: (owner, repo, branch = '', confirmar = '') => api(`/github/repos/${owner}/${repo}/cleanup`, { method:'POST', body:JSON.stringify({ branch, confirmar }) }),

  /* ── Sprint 3 ─────────────────────────────────────────── */
  readme:    (owner, repo) => api(`/github/repos/${owner}/${repo}/readme`),
  commits:   (owner, repo, page = 1) => api(`/github/repos/${owner}/${repo}/commits?per_page=20&page=${page}`),
  commitDetail: (owner, repo, sha) => api(`/github/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`),
  releases:  (owner, repo) => api(`/github/repos/${owner}/${repo}/releases`),
  artifacts: (owner, repo) => api(`/github/repos/${owner}/${repo}/artifacts`),
  latestApk: (owner, repo) => api(`/github/repos/${owner}/${repo}/latest-apk`, { timeoutMs: 15000 }),
  analysis:  (owner, repo) => api(`/github/repos/${owner}/${repo}/analysis`),

  criarRelease: (owner, repo, dados) =>
    api(`/github/repos/${owner}/${repo}/releases`, { method: 'POST', body: JSON.stringify(dados) }),

  excluirRepo: (owner, repo, confirmarNome) =>
    api(`/github/repos/${owner}/${repo}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmar: true, confirmarNome }),
    }),

  getMeta:    (repoId) => api(`/github/meta/${repoId}`),
  salvarMeta: (repoId, dados) =>
    api(`/github/meta/${repoId}`, { method: 'PUT', body: JSON.stringify(dados) }),

  projetosLocais: () => api('/github/projetos-locais'),

  /* ── Sprint 4: Secrets ───────────────────────────────── */
  secrets:     (owner, repo) => api(`/github/repos/${owner}/${repo}/secrets`),
  criarSecret: (owner, repo, nome, valor) =>
    api(`/github/repos/${owner}/${repo}/secrets/${nome}`, {
      method: 'PUT',
      body: JSON.stringify({ valor }),
    }),
  excluirSecret: (owner, repo, nome) =>
    api(`/github/repos/${owner}/${repo}/secrets/${nome}`, { method: 'DELETE' }),

  /* ── Sprint 4: Workflows & Runs ──────────────────────── */
  workflows: (owner, repo) => api(`/github/repos/${owner}/${repo}/workflows`),
  runs: (owner, repo, workflowId, page = 1) =>
    api(`/github/repos/${owner}/${repo}/workflows/${workflowId}/runs?per_page=15&page=${page}`),
  jobs: (runId, owner, repo) =>
    api(`/github/runs/${runId}/jobs?owner=${owner}&repo=${repo}`),
  analyzeRun: async (runId, owner, repo, modo = 'resumo', workflow = '', onProgress) => {
    const initial = await api(`/github/runs/${runId}/analyze`, { method:'POST', body:JSON.stringify({owner,repo,modo,workflow,async:modo!=='resumo'}), timeoutMs:30000 })
    if(!initial?.async) return initial
    const jobId=initial.job?.id
    if(!jobId) throw new Error('O backend não retornou o job da análise.')
    const deadline=Date.now()+5*60_000
    while(Date.now()<deadline){
      await new Promise(r=>setTimeout(r,900))
      const d=await api(`/analysis/ai/jobs/${jobId}`,{timeoutMs:12000})
      const job=d.job||{}
      onProgress?.(job)
      if(job.status==='succeeded')return job.result
      if(job.status==='failed')throw new Error(job.error?.message||'A análise por IA falhou.')
      if(job.status==='cancelled')throw Object.assign(new Error('Análise cancelada.'),{code:'AI_JOB_CANCELLED'})
    }
    throw new Error('A análise demorou mais de 5 minutos e continuará registrada como job.')
  },
  cancelAiJob: (jobId) => api(`/analysis/ai/jobs/${jobId}/cancel`, { method:'POST', timeoutMs:12000 }),

  /* ── Sprint 4: Logs inline de um job ────────────────── */
  jobLogs: async (jobId, owner, repo) => {
    const resp = await authFetch(`${BASE_URL}/github/jobs/${jobId}/logs?owner=${owner}&repo=${repo}`, {
      credentials: 'include',
    })
    if (!resp.ok) throw new Error(`Erro ${resp.status}`)
    return resp.text()
  },

  /* ── Sprint 4: Download via proxy (URLs autenticadas via backend) */
  downloadLogsUrl: (runId, owner, repo) =>
    `${BASE_URL}/github/runs/${runId}/logs/download?owner=${owner}&repo=${repo}`,

  downloadArtifactUrl: (artifactId, owner, repo, nome = '') =>
    `${BASE_URL}/github/artifacts/${artifactId}/download?owner=${owner}&repo=${repo}&nome=${encodeURIComponent(nome)}`,

  baixarLogs: (runId, owner, repo) => baixarAutenticado(
    `${BASE_URL}/github/runs/${runId}/logs/download?owner=${owner}&repo=${repo}`,
    `${repo || 'github'}-logs.zip`,
  ),
  prepararDownloadArtifact: (artifactId, owner, repo, { preferApk = false } = {}) =>
    api(`/github/artifacts/${artifactId}/download-ticket`, {
      method: 'POST',
      body: JSON.stringify({ owner, repo, preferApk }),
      timeoutMs: 20000,
    }),
  prepararDownloadReleaseAsset: (assetId, owner, repo) =>
    api(`/github/release-assets/${assetId}/download-ticket`, {
      method: 'POST',
      body: JSON.stringify({ owner, repo }),
      timeoutMs: 20000,
    }),

  async baixarReleaseApk(assetId, owner, repo, nome = '', options = {}) {
    const { onStatus } = options || {}
    onStatus?.('connecting')
    const prepared = await githubService.prepararDownloadReleaseAsset(assetId, owner, repo)
    const url = releaseAssetPublicUrl(assetId, prepared.ticket)
    const result = await baixarComGerenciador(url, prepared.filename || nome || `${repo}.apk`, 'application/vnd.android.package-archive', onStatus)
    return { ...result, ...prepared, url, nomeOriginal:nome, source:'release' }
  },

  async baixarArtifact(artifactId, owner, repo, nome = '', options = {}) {
    const { preferApk = false, onStatus } = options || {}
    onStatus?.('connecting')
    const prepared = await githubService.prepararDownloadArtifact(artifactId, owner, repo, { preferApk })
    const url = artifactPublicUrl(artifactId, prepared.ticket)
    const mime = prepared.format === 'apk' ? 'application/vnd.android.package-archive' : 'application/zip'
    const result = await baixarComGerenciador(url, prepared.filename || nome || `artifact-${artifactId}.${prepared.format || 'zip'}`, mime, onStatus)
    return { ...result, ...prepared, url, nomeOriginal:nome }
  },

  /** Download de código-fonte com ticket temporário e nome projeto-versão.zip. */
  prepararDownloadZip: (owner, repo, ref = '') => api(`/github/repos/${owner}/${repo}/download-ticket`, {
    method:'POST', body:JSON.stringify({ ref }), timeoutMs:20000,
  }),
  downloadZipUrl: (owner, repo, ticket) => `${BASE_URL}/github/repos/${owner}/${repo}/download-public?ticket=${encodeURIComponent(ticket)}`,

  downloadStatus: async (id) => {
    const downloadId = normalizarDownloadId(id)
    if (!downloadId || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('ALDownloadManager')) return null
    return NativeDownloadManager.getStatus({ id:downloadId })
  },
  cancelDownload: async (id) => {
    const downloadId = normalizarDownloadId(id)
    if (!downloadId || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('ALDownloadManager')) return { ok:false }
    return NativeDownloadManager.cancel({ id:downloadId })
  },
  openDownload: async (id) => {
    const downloadId = normalizarDownloadId(id)
    if (!downloadId || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('ALDownloadManager')) return { ok:false }
    return NativeDownloadManager.open({ id:downloadId })
  },
  async baixarZip(owner, repo, ref = '', options = {}) {
    const { onStatus } = options || {}
    onStatus?.('connecting')
    const prepared = await githubService.prepararDownloadZip(owner, repo, ref)
    const url = githubService.downloadZipUrl(owner, repo, prepared.ticket)
    const result = await baixarComGerenciador(url, prepared.filename || `${repo}-source.zip`, 'application/zip', onStatus)
    return { ...result, ...prepared, url }
  },

  preflightPublicacao: (owner, repo, config = {}) => api(`/github/repos/${owner}/${repo}/publicar-pacote/preflight`, { method:'POST', body:JSON.stringify(config), timeoutMs:30000 }),
  publicacaoJob: (owner, repo, jobId) => api(`/github/repos/${owner}/${repo}/publicar-pacote/jobs/${encodeURIComponent(jobId)}`),

  /** Publica um ZIP diretamente em repository/branch/path, sem depender do módulo Projetos. */
  async publicarPacote(owner, repo, file, config = {}, onProgress = null) {
    const form = new FormData()
    form.append('package', file)
    form.append('async', 'true')
    for (const [k, v] of Object.entries(config)) form.append(k, String(v ?? ''))

    // XMLHttpRequest é usado aqui de propósito: fetch não expõe progresso de upload.
    // Isso evita que, especialmente no celular, um ZIP grande pareça não ter iniciado.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE_URL}/github/repos/${owner}/${repo}/publicar-pacote`)
      xhr.withCredentials = true
      const headers = withAuthHeaders()
      headers.forEach((value, key) => xhr.setRequestHeader(key, value))
      xhr.upload.onprogress = ev => {
        if (!ev.lengthComputable || typeof onProgress !== 'function') return
        onProgress({ loaded: ev.loaded, total: ev.total, percent: Math.min(100, Math.round((ev.loaded / ev.total) * 100)) })
      }
      xhr.onerror = () => reject(new Error(`Não foi possível conectar ao backend em ${BASE_URL}.`))
      xhr.onabort = () => reject(new Error('Envio cancelado.'))
      xhr.onload = () => {
        let data = {}
        try { data = JSON.parse(xhr.responseText || '{}') } catch { /* resposta inesperada */ }
        if (xhr.status < 200 || xhr.status >= 300) {
          const err = new Error(data.erro || `Erro ${xhr.status}`)
          err.status = xhr.status; err.code = data.codigo || null; err.acao = data.acao || ''; err.jobId = data.jobId || null; err.data = data
          return reject(err)
        }
        if (typeof onProgress === 'function') onProgress({ loaded: file.size, total: file.size, percent: 100, uploaded: true })
        resolve(data)
      }
      xhr.send(form)
    })
  },

  /** Cria um novo repositório na conta autenticada */
  criarRepo: (nome, descricao = '', privado = true, org = null, extras = {}) =>
    api('/github/repos/criar', {
      method: 'POST',
      body: JSON.stringify({ nome, descricao, privado, org, ...extras }),
    }),

  /* ── Sprint 5: Salvar repositório na pasta Projetos ────── */
  salvarProjeto: (owner, repo, nomeProjeto, substituir = false) =>
    api(`/github/repos/${owner}/${repo}/salvar-projeto`, {
      method: 'POST',
      body: JSON.stringify({ nomeProjeto, substituir }),
    }),
}

