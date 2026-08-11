import mongoose from 'mongoose'
import { getCredential } from '../utils/credentialStore.js'

const JSON_HEADERS={Accept:'application/json'}
const timeout=(ms=10000)=>AbortSignal.timeout(ms)

function iso(v){ try{return v?new Date(v).toISOString():null}catch{return null} }
function repoSlug(url=''){
  const m=String(url).match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i)
  return m?`${m[1]}/${m[2]}`:null
}
async function readJson(url,headers={},ms=10000){
  const r=await fetch(url,{headers:{...JSON_HEADERS,...headers},signal:timeout(ms)})
  const data=await r.json().catch(()=>null)
  if(!r.ok) throw new Error(data?.message||data?.error?.message||`HTTP ${r.status}`)
  return data
}

export async function mongoSnapshot(){
  const connected=mongoose.connection.readyState===1
  if(!connected) return {source:'mongo',configured:true,ok:false,label:'MongoDB',summary:'Banco desconectado',events:[{id:'mongo-disconnected',source:'mongo',severity:'critical',title:'MongoDB desconectado',message:`Estado da conexão: ${mongoose.connection.readyState}`,createdAt:new Date().toISOString()}],details:{state:mongoose.connection.readyState}}
  try{
    const started=Date.now(); await mongoose.connection.db.admin().ping(); const latency=Date.now()-started
    const stats=await mongoose.connection.db.stats().catch(()=>({}))
    return {source:'mongo',configured:true,ok:true,label:'MongoDB',summary:`Conectado · ${latency} ms`,events:[],details:{database:mongoose.connection.name||null,host:mongoose.connection.host||null,latencyMs:latency,collections:stats.collections??null,objects:stats.objects??null,dataSize:stats.dataSize??null,storageSize:stats.storageSize??null,indexSize:stats.indexSize??null}}
  }catch(err){
    return {source:'mongo',configured:true,ok:false,label:'MongoDB',summary:'Ping falhou',events:[{id:'mongo-ping',source:'mongo',severity:'critical',title:'Falha no MongoDB',message:err.message,createdAt:new Date().toISOString()}],details:{database:mongoose.connection.name||null,error:err.message}}
  }
}

export async function githubSnapshot(){
  const cred=await getCredential('github','GITHUB_TOKEN')
  if(!cred.value) return {source:'github',configured:false,ok:null,label:'GitHub',summary:'Não configurado',events:[]}
  const h={Authorization:`Bearer ${cred.value}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
  try{
    const repos=await readJson('https://api.github.com/user/repos?per_page=8&sort=pushed&direction=desc',h,12000)
    const results=await Promise.allSettled((repos||[]).slice(0,6).map(async repo=>{
      const runs=await readJson(`https://api.github.com/repos/${repo.full_name}/actions/runs?per_page=5`,h,9000)
      const failed=(runs.workflow_runs||[]).find(r=>['failure','cancelled','timed_out','action_required','startup_failure'].includes(r.conclusion))
      return failed?{id:`github:${failed.id}`,source:'github',severity:failed.conclusion==='failure'?'critical':'warning',title:failed.name||'Workflow com falha',message:`${repo.full_name} · ${failed.conclusion}`,createdAt:iso(failed.updated_at||failed.created_at),url:failed.html_url,meta:{owner:repo.owner?.login,repo:repo.name,runId:failed.id,workflow:failed.name,branch:failed.head_branch,sha:failed.head_sha}}:null
    }))
    const events=results.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
    return {source:'github',configured:true,ok:events.length===0,label:'GitHub',summary:events.length?`${events.length} execução(ões) com falha`:'Sem falhas recentes',events:events.slice(0,8)}
  }catch(err){return {source:'github',configured:true,ok:false,label:'GitHub',summary:'Consulta falhou',events:[{id:'github-api',source:'github',severity:'warning',title:'Falha ao consultar GitHub',message:err.message,createdAt:new Date().toISOString()}]}}
}

export async function vercelSnapshot(){
  const cred=await getCredential('vercel','VERCEL_TOKEN')
  if(!cred.value) return {source:'vercel',configured:false,ok:null,label:'Vercel',summary:'Não configurada',events:[]}
  const team=cred.metadata?.teamId||process.env.VERCEL_TEAM_ID||''
  const q=team?`&teamId=${encodeURIComponent(team)}`:''
  const h={Authorization:`Bearer ${cred.value}`}
  try{
    const projects=await readJson(`https://api.vercel.com/v9/projects?limit=12${q}`,h,12000)
    const results=await Promise.allSettled((projects.projects||[]).slice(0,8).map(async p=>{
      const d=await readJson(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(p.id)}&limit=4${q}`,h,9000)
      const bad=(d.deployments||[]).find(x=>['ERROR','CANCELED'].includes(x.state))
      return bad?{id:`vercel:${bad.uid}`,source:'vercel',severity:bad.state==='ERROR'?'critical':'warning',title:`${p.name} · ${bad.state}`,message:bad.meta?.githubCommitMessage||bad.errorMessage||'Deployment não concluído.',createdAt:iso(bad.ready||bad.createdAt),url:bad.url?`https://${bad.url}`:null,meta:{deploymentId:bad.uid,projectId:p.id,project:p.name,teamId:team,branch:bad.meta?.githubCommitRef||null,sha:bad.meta?.githubCommitSha||null}}:null
    }))
    const events=results.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
    return {source:'vercel',configured:true,ok:events.length===0,label:'Vercel',summary:events.length?`${events.length} deploy(s) com problema`:'Deploys recentes saudáveis',events:events.slice(0,8)}
  }catch(err){return {source:'vercel',configured:true,ok:false,label:'Vercel',summary:'Consulta falhou',events:[{id:'vercel-api',source:'vercel',severity:'warning',title:'Falha ao consultar Vercel',message:err.message,createdAt:new Date().toISOString()}]}}
}

export async function renderSnapshot(){
  const cred=await getCredential('render','RENDER_API_KEY')
  if(!cred.value) return {source:'render',configured:false,ok:null,label:'Render',summary:'Não configurado',events:[]}
  const h={Authorization:`Bearer ${cred.value}`}
  try{
    const rows=await readJson('https://api.render.com/v1/services?limit=20',h,12000)
    const services=(Array.isArray(rows)?rows:[]).map(r=>r.service||r).filter(s=>s?.id)
    const results=await Promise.allSettled(services.slice(0,10).map(async s=>{
      const data=await readJson(`https://api.render.com/v1/services/${encodeURIComponent(s.id)}/deploys?limit=5`,h,9000)
      const ds=(Array.isArray(data)?data:[]).map(r=>r.deploy||r)
      const bad=ds.find(d=>['build_failed','update_failed','canceled','deactivated','error'].includes(d.status))
      return bad?{id:`render:${bad.id}`,source:'render',severity:['build_failed','update_failed','error'].includes(bad.status)?'critical':'warning',title:`${s.name} · ${bad.status}`,message:bad.commit?.message||'Deployment com problema.',createdAt:iso(bad.finishedAt||bad.createdAt),url:s.serviceDetails?.url||s.url||null,meta:{serviceId:s.id,ownerId:s.ownerId||s.owner_id||s.owner?.id||null,deployId:bad.id,service:s.name,repo:repoSlug(s.repo)||s.repo||null,sha:bad.commit?.id||null}}:null
    }))
    const events=results.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
    return {source:'render',configured:true,ok:events.length===0,label:'Render',summary:events.length?`${events.length} deploy(s) com problema`:'Deploys recentes saudáveis',events:events.slice(0,8)}
  }catch(err){return {source:'render',configured:true,ok:false,label:'Render',summary:'Consulta falhou',events:[{id:'render-api',source:'render',severity:'warning',title:'Falha ao consultar Render',message:err.message,createdAt:new Date().toISOString()}]}}
}

export async function diagnosticsSnapshot(){
  const [mongo,github,vercel,render]=await Promise.all([mongoSnapshot(),githubSnapshot(),vercelSnapshot(),renderSnapshot()])
  const sources=[mongo,github,vercel,render]
  const events=sources.flatMap(s=>s.events||[]).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))
  return {generatedAt:new Date().toISOString(),sources,events,vps:{prepared:true,enabled:process.env.AL_ENABLE_VPS_DIAGNOSTICS==='true',label:'VPS',summary:process.env.AL_ENABLE_VPS_DIAGNOSTICS==='true'?'Preparado para diagnóstico remoto':'Preparado para uso futuro'}}
}

export async function diagnosticsEventDetails(event={}){
  const source=String(event.source||'')
  const meta=event.meta||{}
  if(source==='mongo') return (await mongoSnapshot()).details
  if(source==='github'){
    const c=await getCredential('github','GITHUB_TOKEN'); if(!c.value) throw new Error('GitHub não configurado.')
    const h={Authorization:`Bearer ${c.value}`,Accept:'application/vnd.github+json'}
    const jobs=await readJson(`https://api.github.com/repos/${meta.owner}/${meta.repo}/actions/runs/${meta.runId}/jobs?per_page=30`,h,12000)
    const failed=(jobs.jobs||[]).filter(j=>j.conclusion==='failure').slice(0,3)
    const logs=[]
    for(const j of failed){
      const r=await fetch(`https://api.github.com/repos/${meta.owner}/${meta.repo}/actions/jobs/${j.id}/logs`,{headers:h,redirect:'follow',signal:timeout(12000)})
      if(r.ok) logs.push({job:j.name,text:(await r.text()).slice(-24000)})
    }
    return {jobs:(jobs.jobs||[]).map(j=>({name:j.name,status:j.status,conclusion:j.conclusion,steps:(j.steps||[]).map(s=>({name:s.name,conclusion:s.conclusion}))})),logs}
  }
  if(source==='vercel'){
    const c=await getCredential('vercel','VERCEL_TOKEN'); if(!c.value) throw new Error('Vercel não configurada.')
    const team=meta.teamId||c.metadata?.teamId||''; const q=team?`&teamId=${encodeURIComponent(team)}`:''
    const data=await readJson(`https://api.vercel.com/v3/deployments/${encodeURIComponent(meta.deploymentId)}/events?direction=backward&limit=100${q}`,{Authorization:`Bearer ${c.value}`},12000)
    return {events:(Array.isArray(data)?data:[]).map(e=>({type:e.type,created:e.created||e.payload?.created||null,text:e.payload?.text||e.payload?.info?.name||e.payload?.info?.step||''})).filter(e=>e.text).slice(0,100)}
  }
  if(source==='render'){
    const c=await getCredential('render','RENDER_API_KEY'); if(!c.value) throw new Error('Render não configurado.')
    if(!meta.ownerId) return {note:'A API não retornou ownerId suficiente para buscar logs deste serviço.',meta}
    const p=new URLSearchParams({ownerId:String(meta.ownerId),direction:'backward',limit:'100'}); p.append('resource',String(meta.serviceId))
    const data=await readJson(`https://api.render.com/v1/logs?${p}`,{Authorization:`Bearer ${c.value}`},12000)
    const rows=data?.logs||data?.items||[]
    return {logs:rows.map(r=>({timestamp:r.timestamp||r.createdAt||r.time||null,level:r.level||r.severity||'',message:r.message||r.text||r.body||''})).filter(x=>x.message).slice(0,100)}
  }
  return {message:event.message||'',meta}
}
