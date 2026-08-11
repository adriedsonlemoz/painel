import { api, BASE_URL, authFetch, getSessionToken } from './http.js'
export const updatesService = {
  status(){ return api('/admin/updates', { timeoutMs: 20000 }) },
  selfTest(){ return api('/admin/updates/self-test',{method:'POST',timeoutMs:30000}) },
  diagnostics(){ return api('/admin/updates/diagnostics',{timeoutMs:30000}) },
  postInstallSelfTest(frontendUrl=''){ return api('/admin/updates/post-install-self-test',{method:'POST',body:JSON.stringify({frontendUrl}),timeoutMs:45000}) },
  async preparar(file,onProgress=null){
    const form=new FormData(); form.append('package',file)
    // XMLHttpRequest é usado somente aqui para que o usuário veja o progresso
    // real do envio. Cookie HttpOnly e o fallback Bearer cloud continuam iguais.
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest()
      xhr.open('POST',`${BASE_URL}/admin/updates/prepare`,true)
      xhr.withCredentials=true
      const token=getSessionToken()
      if(token)xhr.setRequestHeader('Authorization',`Bearer ${token}`)
      xhr.upload.onprogress=e=>{if(e.lengthComputable&&typeof onProgress==='function')onProgress(Math.max(0,Math.min(100,Math.round((e.loaded/e.total)*100))))}
      xhr.onerror=()=>reject(new Error(`Não foi possível conectar ao backend em ${BASE_URL}.`))
      xhr.onabort=()=>reject(new Error('Envio cancelado.'))
      xhr.onload=()=>{
        let data={}; try{data=JSON.parse(xhr.responseText||'{}')}catch{}
        if(xhr.status===401){try{sessionStorage.removeItem('alsistemas_session_token')}catch{};return reject(new Error('Sessão expirada. Faça login novamente.'))}
        if(xhr.status<200||xhr.status>=300)return reject(new Error(data.erro||`Erro ${xhr.status}`))
        if(typeof onProgress==='function')onProgress(100)
        resolve(data)
      }
      xhr.send(form)
    })
  },
  excluirPreparado(id){ return api(`/admin/updates/staged/${id}`,{method:'DELETE',timeoutMs:20000}) },
  excluirSnapshot(id){ return api(`/admin/updates/snapshots/${id}`,{method:'DELETE',timeoutMs:20000}) },
  preflight(id){ return api(`/admin/updates/${id}/preflight`,{timeoutMs:60000}) },
  instalar(id,config={}){ return api(`/admin/updates/${id}/install`,{method:'POST',body:JSON.stringify(config),timeoutMs:60000}) },
  rollback(id,config={}){ return api(`/admin/updates/rollback/${id}`,{method:'POST',body:JSON.stringify(config),timeoutMs:20000}) },
  recoverActive(){ return api('/admin/updates/recover-active',{method:'POST',timeoutMs:20000}) },
  githubRepos(){ return api('/admin/integracoes/github/repositories',{timeoutMs:20000}) },
  deploymentCheck(repository,branch='main'){ return api(`/admin/updates/deployment-check?repository=${encodeURIComponent(repository)}&branch=${encodeURIComponent(branch)}`,{timeoutMs:30000}) },
  publicarGitHub(id,config={}){ return api(`/admin/updates/${id}/publish-github`,{method:'POST',body:JSON.stringify(config),timeoutMs:240000}) },
  cloudReleaseStatus(id){ return api(`/admin/updates/cloud-releases/${encodeURIComponent(id)}/status`,{timeoutMs:30000}) },
  publicarAtualGitHub(config={}){ return api('/admin/updates/publish-current-github',{method:'POST',body:JSON.stringify(config),timeoutMs:20000}) },
  async publicarGitHubDireto(file,config={}){
    const form=new FormData()
    form.append('package',file)
    for(const [k,v] of Object.entries(config)) form.append(k,String(v??''))
    const res=await authFetch(`${BASE_URL}/admin/updates/publish-github-direct`,{method:'POST',body:form,credentials:'include'})
    const data=await res.json().catch(()=>({}))
    if(!res.ok) throw new Error(data.erro||`Erro ${res.status}`)
    return data
  },
  job(id){ return api(`/admin/updates/jobs/${id}`,{timeoutMs:10000}) },
}
