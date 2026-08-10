import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { updatesService } from '../../services/api'
import { T as C, RADIUS, SPACE } from '../../themes/tokens'

const card={background:'var(--adm-surface)',border:'1px solid var(--adm-border)',borderRadius:RADIUS.lg,padding:20}
const btn={border:0,borderRadius:RADIUS.md,padding:'10px 14px',fontWeight:700,cursor:'pointer'}
const fmt=d=>d?new Date(d).toLocaleString('pt-BR'):'—'
const bytes=n=>{
  if(n===null||n===undefined)return 'não medido'
  const v=Number(n); if(!Number.isFinite(v))return '—'
  const units=['B','KB','MB','GB']; let i=0,x=v
  while(x>=1024&&i<units.length-1){x/=1024;i++}
  return `${x.toFixed(i?1:0)} ${units[i]}`
}
const ms=n=>{const s=Math.max(0,Math.round(Number(n||0)/1000));return s<60?`${s}s`:`${Math.floor(s/60)}m ${s%60}s`}
export default function AdminAtualizacoes(){
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[uploading,setUploading]=useState(false),[file,setFile]=useState(null),[job,setJob]=useState(null),[confirmAction,setConfirmAction]=useState(null)
  const [githubPublish,setGithubPublish]=useState(null),[ephemeralStage,setEphemeralStage]=useState(null),[engineTest,setEngineTest]=useState(null),[diagnostics,setDiagnostics]=useState(null)
  const poll=useRef(null)
  const mounted=useRef(true)
  const watchSeq=useRef(0)
  async function load({silent=false}={}){ try{const r=await updatesService.status(); if(mounted.current)setData(r)}catch(e){if(mounted.current&&!silent)toast.error(e.message)}finally{if(mounted.current)setLoading(false)} }
  useEffect(()=>{
    load()
    runDiagnostics()
    const params=new URLSearchParams(window.location.search)
    const resumed=params.get('updateJob')||localStorage.getItem('als:last-update-job')
    if(resumed&&/^job_[0-9]+_[a-f0-9]+$/.test(resumed)){
      watch(resumed)
      if(params.has('updateJob')){
        params.delete('updateJob')
        const qs=params.toString()
        window.history.replaceState({},document.title,`${window.location.pathname}${qs?`?${qs}`:''}${window.location.hash||''}`)
      }
    }
    return()=>{ mounted.current=false; watchSeq.current+=1; clearTimeout(poll.current) }
  },[])
  useEffect(()=>{
    const active=data?.activeOperation?.jobId
    if(active&&!job&&/^job_[0-9]+_[a-f0-9]+$/.test(active))watch(active)
  },[data?.activeOperation?.jobId])
  async function prepare(){ if(!file)return toast.error('Selecione um pacote .zip.'); setUploading(true); try{
    const r=await updatesService.preparar(file)
    toast.success(`${r.update.packageType==='incremental'?'Atualização incremental':'Pacote completo'} ${r.update.version} validado.`)
    if(r.ephemeral){ setEphemeralStage(r.update) }
    else { setFile(null); setEphemeralStage(null); await load() }
  }catch(e){toast.error(e.message)}finally{setUploading(false)} }
  function watch(id){
    clearTimeout(poll.current)
    const seq=++watchSeq.current
    localStorage.setItem('als:last-update-job',id)
    if(mounted.current)setJob({id,status:'queued'})
    const pollOnce=async()=>{
      if(!mounted.current||seq!==watchSeq.current)return
      try{
        const r=await updatesService.job(id)
        if(!mounted.current||seq!==watchSeq.current)return
        setJob(r.job)
        if(['completed','restart-required','rolled-back','failed'].includes(r.job.status)){
          localStorage.removeItem('als:last-update-job')
          await load({silent:true})
          return
        }
      }catch{ /* o próximo ciclo tenta novamente sem gerar toast em cascata */ }
      if(mounted.current&&seq===watchSeq.current) poll.current=setTimeout(pollOnce,2000)
    }
    pollOnce()
  }
  async function install(s){
    setConfirmAction({type:'install',item:s,title:`Analisando AL Sistemas ${s.version}…`,loading:true,message:'Executando pré-check antes de permitir a instalação.'})
    try{
      const r=await updatesService.preflight(s.id)
      setConfirmAction({
        type:'install',item:s,preflight:r.preflight,loading:false,
        title:`Instalar AL Sistemas ${s.version}?`,
        message:`Revise a simulação abaixo. ${s.packageType==='incremental'?`Este incremental exige a base ${s.baseVersion} e aplicará somente o delta.`:'Este é um pacote completo.'} A instalação criará snapshot, ativará modo manutenção e abrirá o monitor independente antes de substituir arquivos.`,
      })
    }catch(e){
      setConfirmAction(null)
      toast.error(`Pré-check falhou: ${e.message}`)
    }
  }
  function rollback(s){ setConfirmAction({type:'rollback',item:s,title:`Voltar para a versão ${s.version}?`,message:'O AL Sistemas restaurará o snapshot selecionado e verificará o funcionamento depois.'}) }
  async function confirmOperation(){
    const action=confirmAction
    if(!action)return
    setConfirmAction(null)
    try{
      const config={frontendUrl:window.location.origin,returnPath:'/admin/atualizacoes',snapshotRetention:3,maintenanceMode:true}
      const r=action.type==='install'?await updatesService.instalar(action.item.id,config):await updatesService.rollback(action.item.id,config)
      localStorage.setItem('als:last-update-job',r.job.id)
      toast.success(action.type==='install'?'Atualização iniciada.':'Rollback iniciado.')
      if(r.monitorReady&&r.monitorUrl){
        window.location.assign(r.monitorUrl)
        return
      }
      // Fallback: se o monitor externo não conseguiu abrir, continua tentando
      // acompanhar pelo painel atual.
      watch(r.job.id)
      if(r.monitorUrl) toast('Monitor externo ainda não respondeu; permanecendo nesta tela por enquanto.')
    }catch(e){toast.error(e.message)}
  }
  async function recoverActive(){
    if(!data?.activeOperation?.jobId)return
    const ok=window.confirm('Interromper a operação ativa e iniciar a recuperação automática pelo snapshot? Use somente quando a atualização estiver travada.')
    if(!ok)return
    try{
      const r=await updatesService.recoverActive()
      toast.success(r.message||'Recuperação solicitada.')
      watch(r.jobId||data.activeOperation.jobId)
    }catch(e){toast.error(e.message)}
  }
  async function runEngineSelfTest(){
    setEngineTest({loading:true})
    try{
      const r=await updatesService.selfTest()
      setEngineTest({loading:false,...r.selfTest})
      if(r.selfTest?.ok)toast.success('Motor de recuperação passou no autoteste.')
      else toast.error('O autoteste encontrou uma falha.')
    }catch(e){
      setEngineTest({loading:false,ok:false,error:e.message})
      toast.error(e.message)
    }
  }
  async function runDiagnostics(showToast=false){
    setDiagnostics(d=>({...d,loading:true}))
    try{
      const r=await updatesService.diagnostics()
      setDiagnostics({...r.diagnostics,loading:false})
      if(showToast) toast[r.diagnostics?.ok?'success':'error'](r.diagnostics?.ok?'Ambiente pronto para atualizar.':'Há bloqueios no ambiente de atualização.')
    }catch(e){
      setDiagnostics({loading:false,ok:false,error:e.message,checks:[]})
      if(showToast)toast.error(e.message)
    }
  }
  async function openGithubPublish(s=null){
    const sourceType=s?'package':'installed'
    setGithubPublish({stage:s,sourceType,loading:true,repositories:[],repository:'',branch:'main',publishMode:'project',error:null,deploymentCheck:null,checking:false})
    try{
      const d=await updatesService.githubRepos()
      const repos=d.repositories||[]
      const preferred=d.preferences?.repository||''
      const selected=repos.find(r=>r.fullName===preferred)||repos[0]||null
      setGithubPublish({
        stage:s,sourceType,loading:false,repositories:repos,
        repository:selected?.fullName||'',branch:selected?.defaultBranch||d.preferences?.branch||'main',
        publishMode:'project',error:repos.length?'':'Nenhum repositório acessível por este token.',deploymentCheck:null,checking:false,
      })
    }catch(e){
      setGithubPublish({stage:s,sourceType,loading:false,repositories:[],repository:'',branch:'main',publishMode:'project',error:e.message,deploymentCheck:null,checking:false})
    }
  }
  async function checkDeployment(showToast=true){
    if(!githubPublish?.repository)return null
    setGithubPublish(g=>({...g,checking:true,deploymentCheck:null,error:null}))
    try{
      const r=await updatesService.deploymentCheck(githubPublish.repository,githubPublish.branch)
      setGithubPublish(g=>({...g,checking:false,deploymentCheck:r}))
      if(showToast)toast[r.ok?'success':'error'](r.ok?'Destino GitHub pronto para publicação.':'Revise o destino antes de publicar.')
      return r
    }catch(e){setGithubPublish(g=>({...g,checking:false,error:e.message}));if(showToast)toast.error(e.message);return null}
  }
  async function publishGithub(){
    if(!githubPublish?.repository)return toast.error('Selecione um repositório.')
    const checked=githubPublish.deploymentCheck||await checkDeployment(false)
    if(!checked?.github?.writable)return toast.error('O token do GitHub não tem permissão de escrita neste repositório.')
    if(!checked?.github?.branchExists){
      if(!checked?.github?.branchWillBeCreated)return toast.error('O GitHub não autorizou a criação desta branch. Revise o repositório e o token.')
      toast.success(`A branch ${githubPublish.branch} não existe e será criada automaticamente durante a publicação.`)
    }
    const cfg={repository:githubPublish.repository,branch:githubPublish.branch,publishMode:githubPublish.publishMode}
    const stage=githubPublish.stage
    const sourceType=githubPublish.sourceType||'package'
    setGithubPublish(g=>({...g,submitting:true}))
    try{
      const serverless=data?.updateCapabilities?.environment==='vercel'
      if(serverless){
        if(!file) throw new Error('O ZIP selecionado não está mais disponível no navegador. Selecione o pacote novamente.')
        setGithubPublish(null)
        setJob({
          id:'vercel-request',type:'github-publish',status:'running',
          phase:'upload-temp',phaseLabel:'Enviando pacote para processamento temporário',progress:8,
          timeline:[{key:'upload-temp',label:'Enviando pacote para processamento temporário',progress:8,at:new Date().toISOString()}],
        })
        const r=await updatesService.publicarGitHubDireto(file,cfg)
        setJob(r.job)
        setEphemeralStage(null)
        setFile(null)
        toast.success('Publicação no GitHub concluída.')
      }else{
        const r=sourceType==='installed'
          ? await updatesService.publicarAtualGitHub(cfg)
          : await updatesService.publicarGitHub(stage.id,cfg)
        setGithubPublish(null)
        toast.success(sourceType==='installed'?'Publicação da versão instalada iniciada.':'Publicação no GitHub iniciada.')
        watch(r.job.id)
      }
    }catch(e){
      if(data?.updateCapabilities?.environment==='vercel'){
        setJob(j=>({...j,status:'failed',phase:'failed',phaseLabel:'Falha na publicação',progress:100,error:e.message,timeline:[...(j?.timeline||[]),{key:'failed',label:'Falha na publicação',progress:100,at:new Date().toISOString()}]}))
      }else{
        setGithubPublish(g=>({...g,submitting:false,error:e.message}))
      }
    }
  }
  const serverless=data?.updateCapabilities?.environment==='vercel'
  const activeOperation=data?.activeOperation||null
  const stagedPackages=ephemeralStage?[ephemeralStage,...(data?.staged||[])]:data?.staged||[]
  if(loading)return <div className="adm-page" style={{color:C.muted}}>Carregando atualizações…</div>
  return <div className="adm-page" style={{display:'grid',gap:16}}>
    <div><h1 style={{margin:0,color:C.text,fontSize:26}}>Atualizações</h1><p style={{color:C.muted,margin:'6px 0 0'}}>Atualize o AL Sistemas por pacote completo ou incremental, com preparação, snapshot e rollback.</p></div>
    <div className="updates-summary" style={{...card,display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:16}}>
      <div className="updates-summary-block"><div style={{fontSize:12,color:C.muted}}>VERSÃO INSTALADA</div><strong style={{fontSize:28,color:C.text}}>{data?.installed?.version}</strong><div className="updates-wrap" style={{fontSize:12,color:data?.installed?.synchronized?C.greenSolid:C.red}}>Backend {data?.installed?.backend} · Frontend {data?.installed?.frontend}</div></div>
      <div className="updates-summary-block"><div style={{fontSize:12,color:C.muted}}>REINÍCIO CONFIGURADO</div><strong style={{color:C.text}}>{data?.restart?.strategy||'none'}</strong><div className="updates-wrap" style={{fontSize:12,color:C.muted}}>PM2: {data?.restart?.pm2Name||'—'} · systemd: {data?.restart?.systemdService||'—'}</div></div>
    </div>
    {activeOperation&&<div style={{...card,borderColor:'#f59e0b'}}>
      <strong style={{color:C.text}}>🔒 Atualizador ocupado</strong>
      <div style={{color:C.muted,fontSize:13,lineHeight:1.5,marginTop:5}}>Há uma operação protegida por lock: <b>{activeOperation.jobId}</b>. Uma segunda instalação/rollback é bloqueada até o worker concluir ou a recuperação automática resolver uma interrupção.</div>
      {!serverless&&<div style={{marginTop:10}}><button onClick={recoverActive} style={{...btn,background:'#b45309',color:'#fff'}}>Interromper e recuperar</button><span style={{marginLeft:9,fontSize:12,color:C.muted}}>Use apenas se o progresso estiver realmente travado; o snapshot será usado automaticamente.</span></div>}
    </div>}
    {serverless&&<div style={{...card,borderColor:C.blue}}>
      <strong style={{color:C.text}}>☁️ Ambiente Vercel detectado</strong>
      <div style={{color:C.muted,fontSize:13,lineHeight:1.55,marginTop:6}}>O AL Sistemas não tentará instalar arquivos nesta Function. O ZIP permanece apenas no navegador até você publicar; então é enviado para processamento temporário e descartado ao final. O destino disponível é GitHub/Vercel.</div>
    </div>}
    <div style={card}><h2 style={{marginTop:0,color:C.text,fontSize:18}}>Ambiente do servidor</h2><p style={{color:C.muted,fontSize:13,marginTop:-4}}>Informações rápidas para conferir onde o AL Sistemas está executando antes de aplicar uma atualização.</p><div className="updates-runtime-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12}}>{[['Ambiente',data?.runtime?.environment],['Node.js',data?.runtime?.node],['Arquitetura',data?.runtime?.arch],['Processo',data?.runtime?.processManager]].map(([label,value])=><div key={label} style={{padding:12,borderRadius:RADIUS.md,background:'var(--adm-surface2)',border:'1px solid var(--adm-border)'}}><div style={{fontSize:11,color:C.muted}}>{label.toUpperCase()}</div><strong style={{color:C.text,fontSize:14}}>{value||'—'}</strong></div>)}</div>{data?.runtime?.environment==='Termux'&&<div style={{marginTop:12,fontSize:13,color:C.greenSolid}}>✓ Termux detectado. O upload e a preparação do pacote funcionam sem internet; dependências só precisarão de rede se realmente mudarem.</div>}
      {!serverless&&<div style={{marginTop:14,padding:12,borderRadius:RADIUS.md,background:'var(--adm-surface2)',border:`1px solid ${diagnostics?.ok?C.greenSolid:diagnostics&&!diagnostics.loading?C.red:'var(--adm-border)'}`}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><div><strong style={{color:C.text}}>Diagnóstico do atualizador</strong><div style={{fontSize:12,color:C.muted,marginTop:3}}>{diagnostics?.loading?'Verificando permissões, recuperação e armazenamento…':diagnostics?.ok?'Ambiente pronto para iniciar atualizações protegidas.':diagnostics?'Há um ou mais bloqueios que precisam ser resolvidos.':'Ainda não verificado.'}</div></div><button onClick={()=>runDiagnostics(true)} disabled={diagnostics?.loading||Boolean(activeOperation)} style={{...btn,background:'var(--adm-surface)',color:C.text,border:'1px solid var(--adm-border)'}}>{diagnostics?.loading?'Verificando…':'Verificar novamente'}</button></div>
        {!!diagnostics?.checks?.length&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:8,marginTop:10}}>{diagnostics.checks.map(c=><div key={c.id} style={{padding:9,borderRadius:8,border:'1px solid var(--adm-border)',fontSize:12,color:c.ok?C.greenSolid:C.red}}>{c.ok?'✓':'✕'} <b>{c.label}</b>{c.detail!==undefined&&c.detail!==null&&<div className="updates-wrap" style={{marginTop:3,color:C.muted}}>{typeof c.detail==='number'?bytes(c.detail):String(c.detail)}</div>}</div>)}</div>}
        {!!diagnostics?.warnings?.length&&<div style={{marginTop:9,fontSize:12,color:'#f59e0b',lineHeight:1.5}}>{diagnostics.warnings.map((w,i)=><div key={i}>⚠ {w}</div>)}</div>}
      </div>}
      {!serverless&&<div style={{marginTop:14,display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><button onClick={runEngineSelfTest} disabled={engineTest?.loading||Boolean(activeOperation)} style={{...btn,background:'var(--adm-surface2)',color:C.text,border:'1px solid var(--adm-border)'}}>{engineTest?.loading?'Testando recuperação…':'Executar autoteste do atualizador'}</button>{engineTest&&!engineTest.loading&&<span style={{fontSize:12,color:engineTest.ok?C.greenSolid:C.red}}>{engineTest.ok?`✓ ${engineTest.checks?.length||0} verificações aprovadas`:`✕ ${engineTest.error||'falha detectada'}`}</span>}</div>}
      {!serverless&&data?.updateCapabilities?.emergencyRecoveryCommand&&<details style={{marginTop:12}}><summary style={{cursor:'pointer',fontSize:12,color:C.blue}}>Recuperação de emergência</summary><div style={{marginTop:7,fontSize:12,color:C.muted,lineHeight:1.5}}>Se o aparelho/VPS desligar durante uma atualização e o AL Sistemas não conseguir subir, execute no terminal:</div><code className="updates-wrap" style={{display:'block',marginTop:6,padding:9,borderRadius:8,background:'var(--adm-surface2)',fontSize:11}}>{data.updateCapabilities.emergencyRecoveryCommand}</code></details>}
    </div>
    {!serverless&&<div style={card}><div style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap'}}><div><h2 style={{margin:'0 0 5px',color:C.text,fontSize:18}}>Publicar instalação atual</h2><p style={{color:C.muted,fontSize:13,margin:0,lineHeight:1.55}}>Envie ao GitHub exatamente a versão que está instalada agora, sem precisar carregar um pacote de atualização. Arquivos locais e sensíveis como <code>.env</code>, <code>node_modules</code>, uploads, logs e cofres não são publicados.</p></div><button disabled={Boolean(activeOperation)} onClick={()=>openGithubPublish(null)} style={{...btn,background:C.blue,color:'#fff',opacity:activeOperation ? .55 : 1,cursor:activeOperation?'not-allowed':'pointer'}}>Publicar versão atual no GitHub</button></div></div>}
    <div style={card}><h2 style={{marginTop:0,color:C.text,fontSize:18}}>Enviar nova versão</h2><p style={{color:C.muted,fontSize:13}}>{serverless?'Na Vercel, o ZIP é apenas validado e continua no navegador; nenhum staging persistente é criado.':'O ZIP é validado e extraído em staging. Aceita pacote completo ou incremental compatível; nada é substituído nesta etapa.'}</p><div className="updates-upload-row"><input className="updates-file-input" type="file" accept=".zip" onChange={e=>setFile(e.target.files?.[0]||null)} style={{color:C.text}}/><button className="updates-primary-action" disabled={uploading} onClick={prepare} style={{...btn,background:C.blue,color:'#fff'}}>{uploading?'Validando…':'Validar e preparar'}</button></div></div>
    {job&&<UpdateProgress job={job}/>}
    {job?.finalReport&&<UpdateFinalReport report={job.finalReport}/>}
    <div style={card}><h2 style={{marginTop:0,color:C.text,fontSize:18}}>Pacotes preparados</h2>{!stagedPackages.length?<p style={{color:C.muted}}>Nenhum pacote preparado.</p>:stagedPackages.map(s=><div key={s.id} style={{padding:'14px 0',borderTop:'1px solid var(--adm-border)'}}><div className="updates-item-row"><div className="updates-item-main"><strong style={{color:C.text,fontSize:17}}>v{s.version}</strong><div className="updates-wrap" style={{fontSize:12,color:s.packageType==='incremental'?'#f59e0b':C.blue,fontWeight:700,marginTop:3}}>{s.packageType==='incremental'?`⚡ Incremental ${s.baseVersion} → ${s.version}`:'📦 Pacote completo'}</div><div className="updates-wrap" style={{fontSize:12,color:C.muted}}>{s.filename} · {fmt(s.createdAt)}</div><div className="updates-wrap" style={{fontSize:12,color:C.greenSolid,marginTop:4}}>✓ Manifesto: {s.integrity?.fileCount||'—'} arquivos · {bytes(s.integrity?.totalBytes)}</div><div className="updates-wrap" style={{fontSize:12,color:C.muted,marginTop:4}}>Dependências: backend {s.dependencies?.backend?.installRequired?(s.dependencies?.backend?.lockChanged?'reinstalar':'reparar'):'íntegras'} · frontend {s.dependencies?.frontend?.installRequired?(s.dependencies?.frontend?.lockChanged?'reinstalar':'reparar'):'íntegras'} · Migrações: {s.migrations?.length||0}</div></div><div className="updates-package-actions">{!serverless&&<button className="updates-item-action" disabled={Boolean(activeOperation)} onClick={()=>install(s)} title={activeOperation?'Aguarde a operação atual terminar.':'Executar simulação e instalar'} style={{...btn,background:C.greenSolid,color:'#fff',opacity:activeOperation ? .55 : 1,cursor:activeOperation?'not-allowed':'pointer'}}>Simular / Instalar</button>}<button className="updates-item-action" disabled={s.packageType==='incremental'||(!serverless&&Boolean(activeOperation))} onClick={()=>openGithubPublish(s)} title={s.packageType==='incremental'?'Para GitHub/Vercel use o pacote completo da versão.':(!serverless&&activeOperation?'Aguarde a operação atual terminar.':'')} style={{...btn,background:C.blue,color:'#fff',opacity:(s.packageType==='incremental'||(!serverless&&activeOperation)) ? .55 : 1,cursor:(s.packageType==='incremental'||(!serverless&&activeOperation))?'not-allowed':'pointer'}}>GitHub / Vercel</button></div></div><details style={{marginTop:10}}><summary style={{cursor:'pointer',color:C.blue}}>Ver changelog</summary><pre style={{whiteSpace:'pre-wrap',color:C.text,fontFamily:'inherit',fontSize:13,lineHeight:1.55}}>{s.changelog}</pre></details></div>)}</div>
    {!serverless&&<><div style={card}><h2 style={{marginTop:0,color:C.text,fontSize:18}}>Snapshots para rollback</h2><p style={{color:C.muted,fontSize:12,marginTop:-6}}>Retenção automática: os {data?.updateCapabilities?.snapshotRetention||3} snapshots mais recentes são mantidos para evitar crescimento ilimitado do armazenamento.</p>{!data?.snapshots?.length?<p style={{color:C.muted}}>Nenhum snapshot criado ainda.</p>:data.snapshots.map(s=><div key={s.id} className="updates-item-row updates-snapshot-row" style={{padding:'10px 0',borderTop:'1px solid var(--adm-border)'}}><div className="updates-item-main"><strong style={{color:C.text}}>v{s.version}</strong><div style={{fontSize:12,color:C.muted}}>{fmt(s.createdAt)}</div></div><button className="updates-item-action" disabled={s.safe===false||Boolean(activeOperation)} title={activeOperation?'Outra operação está em andamento.':s.safe===false?'Rollback bloqueado: migrações sem reversão garantida.':''} onClick={()=>rollback(s)} style={{...btn,background:'var(--adm-surface2)',color:(s.safe===false||activeOperation)?C.muted:C.text,border:'1px solid var(--adm-border)',cursor:(s.safe===false||activeOperation)?'not-allowed':'pointer'}}>Rollback</button></div>)}</div>
    <div style={card}><h2 style={{marginTop:0,color:C.text,fontSize:18}}>Histórico</h2>{!data?.history?.length?<p style={{color:C.muted}}>Sem atualizações registradas.</p>:data.history.map(h=><div key={h.id} className="updates-wrap" style={{padding:'9px 0',borderTop:'1px solid var(--adm-border)',color:C.text}}><strong>{h.type==='rollback'?'Rollback':h.type==='github-publish'?'GitHub':h.type==='recovery'?'Recuperação':'Atualização'} {h.fromVersion} → {h.toVersion}</strong>{h.repository&&<span className="updates-wrap" style={{color:C.muted}}> · {h.repository}{h.branch?` @ ${h.branch}`:''}</span>} <span style={{color:h.status==='success'?C.greenSolid:h.status==='rolled-back'?C.red:C.muted}}>· {h.status}</span><div style={{fontSize:12,color:C.muted}}>{fmt(h.createdAt)}</div></div>)}</div></>}
    {serverless&&<div style={card}><h2 style={{marginTop:0,color:C.text,fontSize:18}}>Histórico e rollback na Vercel</h2><p style={{color:C.muted,fontSize:13,lineHeight:1.55,marginBottom:0}}>Snapshots locais não são usados em ambiente serverless. O histórico durável fica no GitHub/Vercel: cada publicação gera um commit, e rollback deve ser feito revertendo/publicando um commit anterior ou usando os mecanismos de deployment da Vercel.</p></div>}
    {githubPublish&&<div className="updates-modal-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setGithubPublish(null)}}>
      <div className="updates-modal updates-github-modal" role="dialog" aria-modal="true" aria-labelledby="github-publish-title">
        <div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:'.04em'}}>{githubPublish.sourceType==='installed'?'PUBLICAR INSTALAÇÃO ATUAL':'PUBLICAR ATUALIZAÇÃO'}</div>
        <h2 id="github-publish-title" style={{margin:'7px 0 4px',color:C.text,fontSize:20}}>GitHub / Vercel</h2>
        <p style={{margin:'0 0 16px',color:C.muted,fontSize:13,lineHeight:1.55}}>O AL Sistemas publica {githubPublish.sourceType==='installed'?<><b>a instalação atual</b> diretamente como commit no GitHub, sem ZIP.</>:<>o pacote como <b>commit no GitHub</b>.</>}  {serverless?'O arquivo será processado temporariamente nesta requisição e descartado ao final. ':''}A Vercel não recebe o ZIP diretamente: quando existir um projeto Vercel ligado ao repositório/branch, o push do GitHub é quem dispara o deployment. Use a verificação abaixo antes de publicar.</p>

        {githubPublish.loading?<div style={{padding:'16px 0',color:C.muted}}>Consultando repositórios autorizados…</div>:<>
          {githubPublish.error&&<div style={{padding:11,borderRadius:9,border:`1px solid ${C.red}`,color:C.red,background:'var(--adm-surface2)',fontSize:12,marginBottom:12}}>{githubPublish.error}</div>}
          {githubPublish.repositories.length>0&&<>
            <label className="updates-modal-field">Repositório
              <select value={githubPublish.repository} onChange={e=>{
                const repo=githubPublish.repositories.find(r=>r.fullName===e.target.value)
                setGithubPublish(g=>({...g,repository:e.target.value,branch:repo?.defaultBranch||'main',deploymentCheck:null}))
              }}>
                {githubPublish.repositories.map(r=><option key={r.id} value={r.fullName}>{r.fullName}{r.private?' • privado':''}</option>)}
              </select>
            </label>
            <label className="updates-modal-field">Branch
              <input value={githubPublish.branch} onChange={e=>setGithubPublish(g=>({...g,branch:e.target.value,deploymentCheck:null}))} placeholder="main"/>
            </label>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',margin:'2px 0 12px'}}><button onClick={()=>checkDeployment(true)} disabled={githubPublish.checking} style={{...btn,background:'var(--adm-surface2)',color:C.text,border:'1px solid var(--adm-border)'}}>{githubPublish.checking?'Verificando…':'Verificar GitHub / Vercel'}</button>{githubPublish.deploymentCheck&&<span style={{fontSize:12,color:githubPublish.deploymentCheck.ok?C.greenSolid:C.red}}>{githubPublish.deploymentCheck.ok?'✓ GitHub pronto':'⚠ GitHub precisa de atenção'}</span>}</div>
            {githubPublish.deploymentCheck&&<div style={{padding:11,borderRadius:9,background:'var(--adm-surface2)',fontSize:12,color:C.muted,lineHeight:1.55,marginBottom:12}}><div><b style={{color:C.text}}>GitHub:</b> {githubPublish.deploymentCheck.github?.writable?'escrita autorizada':'sem permissão de escrita'} · branch {githubPublish.deploymentCheck.github?.branchExists?'encontrada':githubPublish.deploymentCheck.github?.branchWillBeCreated?'não existe — será criada automaticamente':'indisponível'}.</div><div style={{marginTop:5}}><b style={{color:C.text}}>Vercel:</b> {githubPublish.deploymentCheck.vercel?.configured?githubPublish.deploymentCheck.vercel.message:'não configurada; a publicação continuará somente no GitHub.'}</div>{githubPublish.deploymentCheck.vercel?.projects?.map(p=><div key={p.id} style={{marginTop:5}}>▲ <b>{p.name}</b>{p.rootDirectory?` · raiz: ${p.rootDirectory}`:''}{p.productionBranch?` · produção: ${p.productionBranch}`:''}</div>)}</div>}
            <label className="updates-modal-field">{githubPublish.sourceType==='installed'?'O que publicar':'Onde aplicar os arquivos do ZIP'}
              <select value={githubPublish.publishMode} onChange={e=>setGithubPublish(g=>({...g,publishMode:e.target.value}))}>
                <option value="project">Projeto completo — /backend + /frontend</option>
                <option value="frontend-folder">Somente frontend — pasta /frontend</option>
                <option value="frontend-root">Somente frontend — raiz do repositório (Vercel)</option>
                <option value="backend-folder">Somente backend — pasta /backend</option>
              </select>
            </label>
            <div style={{padding:11,borderRadius:9,background:'var(--adm-surface2)',fontSize:12,color:C.muted,lineHeight:1.5}}>
              {githubPublish.publishMode==='frontend-root'
                ? 'Ideal quando o projeto da Vercel aponta diretamente para a raiz de um repositório dedicado ao frontend. Arquivos de infraestrutura como .github e vercel.json são preservados quando não vierem no pacote.'
                : githubPublish.publishMode==='frontend-folder'
                  ? 'Use quando a Vercel foi configurada com Root Directory = frontend.'
                  : githubPublish.publishMode==='backend-folder'
                    ? 'Atualiza apenas o código do backend dentro de /backend.'
                    : 'Sincroniza backend e frontend do AL Sistemas e preserva arquivos extras do repositório, como workflows do GitHub.'}
            </div>
          </>}
        </>}
        <div style={{display:'flex',justifyContent:'flex-end',gap:10,flexWrap:'wrap',marginTop:18}}>
          <button onClick={()=>setGithubPublish(null)} style={{...btn,background:'var(--adm-surface2)',color:C.text,border:'1px solid var(--adm-border)'}}>Cancelar</button>
          <button disabled={githubPublish.loading||githubPublish.submitting||!githubPublish.repository} onClick={publishGithub} style={{...btn,background:C.blue,color:'#fff'}}>{githubPublish.submitting?'Publicando…':githubPublish.sourceType==='installed'?'Publicar versão atual':'Publicar atualização'}</button>
        </div>
      </div>
    </div>}
    {confirmAction&&<div className="updates-modal-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setConfirmAction(null)}}>
      <div className="updates-modal" role="dialog" aria-modal="true" aria-labelledby="update-confirm-title">
        <div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:'.04em'}}>CONFIRMAÇÃO</div>
        <h2 id="update-confirm-title" style={{margin:'7px 0 8px',color:C.text,fontSize:20}}>{confirmAction.title}</h2>
        <p style={{margin:'0 0 14px',color:C.muted,fontSize:13,lineHeight:1.55}}>{confirmAction.message}</p>
        {confirmAction.loading&&<div style={{padding:14,borderRadius:10,background:'var(--adm-surface2)',color:C.muted,fontSize:13}}>Verificando arquivos, dependências, migrações e espaço disponível…</div>}
        {confirmAction.preflight&&<PreflightSummary data={confirmAction.preflight}/>}
        <div style={{display:'flex',justifyContent:'flex-end',gap:10,flexWrap:'wrap',marginTop:18}}>
          <button onClick={()=>setConfirmAction(null)} style={{...btn,background:'var(--adm-surface2)',color:C.text,border:'1px solid var(--adm-border)'}}>Cancelar</button>
          {!confirmAction.loading&&<button disabled={confirmAction.type==='install'&&confirmAction.preflight&&!confirmAction.preflight.ok} onClick={confirmOperation} style={{...btn,background:confirmAction.type==='rollback'?C.red:C.greenSolid,color:'#fff',opacity:(confirmAction.type==='install'&&confirmAction.preflight&&!confirmAction.preflight.ok) ? .55 : 1}}>{confirmAction.type==='rollback'?'Confirmar rollback':'Instalar atualização'}</button>}
        </div>
      </div>
    </div>}
    <style>{`
      .adm-page{min-width:0}
      .adm-page > *{min-width:0;max-width:100%;box-sizing:border-box}
      .updates-summary-block,.updates-item-main{min-width:0}
      .updates-wrap{overflow-wrap:anywhere;word-break:break-word}
      .updates-upload-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;min-width:0}
      .updates-file-input{min-width:0;max-width:100%;flex:1 1 260px}
      .updates-primary-action{flex:0 0 auto}
      .updates-item-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;min-width:0}
      .updates-item-main{flex:1 1 auto}
      .updates-item-action{flex:0 0 auto}
      .updates-package-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .updates-modal-field{display:block;font-size:13px;font-weight:700;margin-bottom:12px;color:var(--adm-text)}
      .updates-modal-field input,.updates-modal-field select{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px 11px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-bg);color:var(--adm-text)}
      .updates-github-modal{width:min(100%,560px)}
      pre{max-width:100%;overflow-x:auto;box-sizing:border-box}
      .updates-modal-overlay{position:fixed;inset:0;z-index:1200;background:rgba(15,23,42,.34);display:flex;align-items:center;justify-content:center;padding:16px}
      .updates-modal{width:min(100%,620px);background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:16px;box-shadow:0 22px 60px rgba(15,23,42,.20);padding:20px;box-sizing:border-box}
      @media(max-width:640px){
        .updates-summary,.updates-report-grid{grid-template-columns:1fr!important}
        .updates-modal .updates-report-grid,.updates-modal [style*="repeat(2,minmax(0,1fr))"]{grid-template-columns:1fr!important}
        .updates-runtime-grid{grid-template-columns:1fr 1fr!important}
        .updates-upload-row{display:grid;grid-template-columns:1fr}
        .updates-file-input,.updates-primary-action{width:100%;max-width:100%}
        .updates-item-row{display:grid;grid-template-columns:minmax(0,1fr);align-items:stretch}
        .updates-package-actions{display:grid;grid-template-columns:1fr}
        .updates-item-action{width:100%}
      }
      @media(max-width:380px){
        .updates-runtime-grid{grid-template-columns:1fr!important}
      }
    `}</style>
  </div>
}


function PreflightSummary({data}){
 const risk=data.risk||'baixo'
 const riskColor=risk==='alto'?C.red:risk==='médio'?'#b7791f':C.greenSolid
 return <div style={{display:'grid',gap:10}}>
  <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>
   <MiniStat label="Versão" value={`${data.fromVersion} → ${data.toVersion}`}/>
   <MiniStat label="Pacote" value={data.packageType==='incremental'?`INCREMENTAL · base ${data.baseVersion}`:'COMPLETO'} color={data.packageType==='incremental'?'#f59e0b':C.blue}/>
   <MiniStat label="Risco" value={risk.toUpperCase()} color={riskColor}/>
   <MiniStat label="Arquivos" value={`+${data.files?.added||0}  ~${data.files?.changed||0}  -${data.files?.removed||0}`}/>
   <MiniStat label="Migrações" value={String(data.migrations?.count||0)}/>
   <MiniStat label="Backup estimado" value={bytes(data.disk?.estimatedBackupBytes)}/>
   <MiniStat label="Espaço livre" value={bytes(data.disk?.freeBytes)} color={data.disk?.ok?C.greenSolid:C.red}/>
  </div>
  <div style={{padding:10,borderRadius:9,border:'1px solid var(--adm-border)',background:'var(--adm-bg)',fontSize:12,lineHeight:1.5}}>
   <b>Dependências:</b> {data.dependencies?.areas?.length?data.dependencies.areas.join(', '):'sem alterações'}<br/>
   <b>Espaço necessário estimado:</b> {bytes(data.disk?.estimatedRequiredBytes)}<br/>
   <b>Node.js:</b> {data.environment?.nodeEngine?.current||'—'} {data.environment?.nodeEngine?.spec?`(pacote: ${data.environment.nodeEngine.spec})`:''}<br/>
   <b>Permissão de escrita:</b> {data.environment?.rootWritable&&data.environment?.stateWritable?'ok':'insuficiente'}<br/>
   {data.migrations?.count>0&&<><b>MongoDB para migrações:</b> {data.migrations?.databaseReady?'conectado':'indisponível'}<br/></>}
   <b>Rollback de migrações:</b> {data.migrations?.rollbackSafe?'seguro':'não garantido'}
  </div>
  {!!data.warnings?.length&&<div style={{padding:10,borderRadius:9,border:'1px solid #f59e0b55',background:'#f59e0b12',fontSize:12}}>
    {data.warnings.map((w,i)=><div key={i} style={{margin:i?'5px 0 0':0}}>⚠️ {w}</div>)}
  </div>}
  {!data.ok&&<div style={{padding:10,borderRadius:9,border:`1px solid ${C.red}`,background:'var(--adm-surface2)',color:C.red,fontSize:12,fontWeight:700}}>A instalação foi bloqueada pelo pré-check.</div>}
 </div>
}

function MiniStat({label,value,color}){
 return <div style={{padding:9,borderRadius:9,border:'1px solid var(--adm-border)',background:'var(--adm-bg)',minWidth:0}}>
  <div style={{fontSize:10,color:C.muted,fontWeight:800}}>{label.toUpperCase()}</div>
  <div style={{marginTop:3,fontSize:13,fontWeight:800,color:color||C.text,overflowWrap:'anywhere'}}>{value}</div>
 </div>
}

function UpdateFinalReport({report}){
 const ok=report.status==='success'||report.status==='restart-required'
 return <section style={{...card,borderColor:ok?C.greenSolid:C.red}}>
  <div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:'.04em'}}>RELATÓRIO FINAL</div>
  <h2 style={{margin:'5px 0 12px',fontSize:19,color:C.text}}>{ok?'Atualização finalizada':'Operação finalizada com ocorrência'}</h2>
  <div className="updates-report-grid" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>
   <MiniStat label="Versão" value={`${report.fromVersion} → ${report.toVersion}`}/>
   <MiniStat label="Tempo total" value={ms(report.durationMs)}/>
   <MiniStat label="Resultado" value={String(report.status).toUpperCase()} color={ok?C.greenSolid:C.red}/>
   <MiniStat label="Health check" value={report.healthCheck||'—'} color={report.healthCheck==='approved'?C.greenSolid:C.muted}/>
   <MiniStat label="Dependências" value={report.dependenciesProcessed?.length?report.dependenciesProcessed.join(', '):'sem mudanças'}/>
   <MiniStat label="Migrações" value={String(report.migrationsPlanned||0)}/>
   <MiniStat label="Versão confirmada" value={report.versionConfirmed===true?'sim':report.versionConfirmed===false?'não':'—'} color={report.versionConfirmed===true?C.greenSolid:C.muted}/>
   <MiniStat label="Recuperação automática" value={report.recovered?'executada':'não necessária'} color={report.recovered?C.blue:C.muted}/>
  </div>
  {report.preflight?.files&&<div style={{marginTop:10,fontSize:12,color:C.muted}}>Arquivos previstos: +{report.preflight.files.added} novos · ~{report.preflight.files.changed} alterados · -{report.preflight.files.removed} removidos.</div>}
  {report.error&&<div style={{marginTop:10,padding:10,borderRadius:9,border:`1px solid ${C.red}`,color:C.red,fontSize:12}}>{report.error}</div>}
  {report.dependencyRollbackError&&<div style={{marginTop:8,padding:10,borderRadius:9,border:`1px solid ${C.red}`,color:C.red,fontSize:12}}><b>Dependências no rollback:</b> {report.dependencyRollbackError}</div>}
 </section>
}


const STEP_LABELS={
  'upload-temp':'Enviando pacote temporário',
  starting:'Iniciando',
  integrity:'Verificando staging',
  recovery:'Recuperação automática',
  'recovery-files':'Restaurando snapshot',
  'recovery-restart':'Reiniciando após recuperação',
  'recovery-health':'Validando recuperação',
  backup:'Criando backup',
  'backup-done':'Backup concluído',
  'snapshot-cleanup':'Limpando snapshots antigos',
  maintenance:'Modo manutenção',
  files:'Aplicando arquivos',
  cache:'Limpando cache',
  dependencies:'Dependências',
  'dependencies-ok':'Dependências',
  build:'Preparando frontend',
  migrations:'Migrações',
  'migrations-none':'Migrações',
  restart:'Reiniciando',
  health:'Health check',
  completed:'Concluído',
  'restart-required':'Aguardando reinício manual',
  'rollback-auto':'Rollback automático',
  'rollback-auto-migrations':'Revertendo migrações',
  'rollback-auto-files':'Restaurando arquivos',
  'rollback-auto-dependencies':'Restaurando dependências',
  'rollback-auto-health':'Validando rollback',
  'rolled-back':'Rollback concluído',
  failed:'Falhou',
  'rollback-prepare':'Preparando rollback',
  'rollback-migrations':'Revertendo migrações',
  'rollback-files':'Restaurando arquivos',
  'rollback-dependencies':'Restaurando dependências',
  'rollback-restart':'Reiniciando',
  'watchdog-recovery':'Watchdog restaurando snapshot',
  'rollback-health':'Health check',
  'github-validate':'Validando GitHub',
  'github-scan':'Preparando arquivos',
  'github-empty':'Preparando primeiro commit',
  'github-upload':'Enviando arquivos',
  'github-tree':'Montando versão',
  'github-commit':'Criando commit',
  'github-push':'Publicando branch',
}

function UpdateProgress({job}){
  const progress=Math.max(0,Math.min(100,Number(job.progress||0)))
  const failed=job.status==='failed'||job.status==='rolled-back'
  const done=['completed','restart-required'].includes(job.status)
  const currentLabel=job.phaseLabel||STEP_LABELS[job.phase]||job.status||'Preparando'
  const timeline=Array.isArray(job.timeline)?job.timeline:[]
  return <section style={{...card,borderColor:failed?C.red:done?C.greenSolid:C.blue}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
      <div>
        <div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:'.04em'}}>{job.type==='github-publish'?'PUBLICAÇÃO GITHUB / VERCEL':'PROGRESSO DA ATUALIZAÇÃO'}</div>
        <h2 style={{margin:'5px 0 2px',fontSize:19,color:C.text}}>{currentLabel}</h2>
        <div style={{fontSize:12,color:C.muted}}>{job.type==='github-publish'?'O commit é criado no GitHub; a Vercel assume o deployment se o repositório estiver conectado.':'Acompanhe esta caixa até a operação terminar.'}</div>
      </div>
      <strong style={{fontSize:22,color:failed?C.red:done?C.greenSolid:C.blue}}>{progress}%</strong>
    </div>
    <div style={{height:9,borderRadius:999,background:'var(--adm-surface2)',overflow:'hidden',margin:'14px 0'}}>
      <div style={{height:'100%',width:`${progress}%`,background:failed?C.red:done?C.greenSolid:C.blue,transition:'width .35s ease'}}/>
    </div>
    <div style={{display:'grid',gap:7}}>
      {timeline.slice(-8).map((step,index)=>{
        const isLast=index===timeline.slice(-8).length-1
        return <div key={`${step.at||index}-${step.key}`} style={{display:'grid',gridTemplateColumns:'18px minmax(0,1fr) auto',gap:8,alignItems:'center',fontSize:12}}>
          <span style={{color:isLast&&!done&&!failed?C.blue:C.greenSolid}}>{isLast&&!done&&!failed?'●':'✓'}</span>
          <span className="updates-wrap" style={{color:isLast?C.text:C.muted,fontWeight:isLast?700:400}}>{step.label||STEP_LABELS[step.key]||step.key}</span>
          <span style={{color:C.muted}}>{Number.isFinite(Number(step.progress))?`${step.progress}%`:''}</span>
        </div>
      })}
    </div>
    {job.externalProcess&&<div style={{marginTop:14,padding:11,borderRadius:9,background:'var(--adm-surface2)',border:'1px solid var(--adm-border)',fontSize:12}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><b style={{color:C.text}}>Processo em execução</b><span style={{color:C.muted}}>{Math.round(Number(job.externalProcess.elapsedMs||0)/1000)}s</span></div>
      <div className="updates-wrap" style={{color:C.muted,marginTop:5,fontFamily:'monospace'}}>{job.externalProcess.command||[job.externalProcess.cmd,...(job.externalProcess.args||[])].join(' ')}</div>
      {job.externalProcess.silentMs>90000&&<div style={{color:'#f59e0b',marginTop:6}}>⚠ Sem nova saída há {Math.round(job.externalProcess.silentMs/1000)}s. O diagnóstico será registrado em Erros e logs.</div>}
      {(job.externalProcess.stderrTail||job.externalProcess.stdoutTail)&&<pre style={{margin:'8px 0 0',maxHeight:120,overflow:'auto',whiteSpace:'pre-wrap',fontSize:10,color:C.muted}}>{(job.externalProcess.stderrTail||job.externalProcess.stdoutTail).slice(-2500)}</pre>}
    </div>}
    {job.error&&<div style={{marginTop:14,padding:11,borderRadius:9,background:'var(--adm-surface2)',border:`1px solid ${C.red}`,color:C.red,fontSize:12}}><b>Erro:</b> {job.error}</div>}
    {job.status==='restart-required'&&<div style={{marginTop:14,padding:11,borderRadius:9,background:'var(--adm-surface2)',color:C.text,fontSize:12}}>Os arquivos foram aplicados. Este ambiente está configurado para reinício manual.</div>}
    {job.commitUrl&&<div style={{marginTop:14,padding:11,borderRadius:9,background:'var(--adm-surface2)',fontSize:12}}><b style={{color:C.text}}>Commit publicado.</b> <a href={job.commitUrl} target="_blank" rel="noreferrer" style={{color:C.blue}}>Abrir no GitHub ↗</a><div style={{color:C.muted,marginTop:4}}>Se este repositório estiver conectado à Vercel, acompanhe agora o deployment por lá.</div></div>}
    <div className="updates-wrap" style={{fontSize:11,color:C.muted,marginTop:12}}>Job {job.id}</div>
  </section>
}
