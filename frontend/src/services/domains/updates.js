import { api, BASE_URL } from './http.js'
export const updatesService = {
  status(){ return api('/admin/updates', { timeoutMs: 20000 }) },
  selfTest(){ return api('/admin/updates/self-test',{method:'POST',timeoutMs:30000}) },
  diagnostics(){ return api('/admin/updates/diagnostics',{timeoutMs:30000}) },
  postInstallSelfTest(frontendUrl=''){ return api('/admin/updates/post-install-self-test',{method:'POST',body:JSON.stringify({frontendUrl}),timeoutMs:45000}) },
  async preparar(file){
    const form=new FormData(); form.append('package',file)
    const res=await fetch(`${BASE_URL}/admin/updates/prepare`,{method:'POST',body:form,credentials:'include'})
    const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.erro||`Erro ${res.status}`); return data
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
    const res=await fetch(`${BASE_URL}/admin/updates/publish-github-direct`,{method:'POST',body:form,credentials:'include'})
    const data=await res.json().catch(()=>({}))
    if(!res.ok) throw new Error(data.erro||`Erro ${res.status}`)
    return data
  },
  job(id){ return api(`/admin/updates/jobs/${id}`,{timeoutMs:10000}) },
}
