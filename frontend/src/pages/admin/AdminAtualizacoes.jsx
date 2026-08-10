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
const releaseNotes=raw=>String(raw||'')
  .split(/\r?\n/)
  .map(x=>x.trim())
  .filter(x=>x&&!/^#{1,6}\s/.test(x))
  .map(x=>x.replace(/^[-*•]\s*/,''))

export default function AdminAtualizacoes(){
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[uploading,setUploading]=useState(false),[file,setFile]=useState(null),[job,setJob]=useState(null),[confirmAction,setConfirmAction]=useState(null)
  const [githubPublish,setGithubPublish]=useState(null),[ephemeralStage,setEphemeralStage]=useState(null),[engineTest,setEngineTest]=useState(null),[diagnostics,setDiagnostics]=useState(null),[systemTest,setSystemTest]=useState(null),[uiPanel,setUiPanel]=useState(null)
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
    const prepared=r.update
    toast.success(`${prepared.packageType==='incremental'?'Atualização incremental':'Pacote completo'} ${prepared.version} validado.`)
    if(r.ephemeral){
      setEphemeralStage(prepared)
      setUiPanel(null)
      await openGithubPublish(prepared)
    }else{
      setFile(null)
      setEphemeralStage(null)
      await load({silent:true})
      setUiPanel(null)
      // Fluxo contínuo: terminou de validar, já mostra a simulação da instalação.
      await install(prepared)
    }
  }catch(e){toast.error(e.message)}finally{setUploading(false)} }
  function watch(id,typeHint=null){
    clearTimeout(poll.current)
    const seq=++watchSeq.current
    localStorage.setItem('als:last-update-job',id)
    if(mounted.current)setJob({id,status:'queued',...(typeHint?{type:typeHint}:{})})
    const pollOnce=async()=>{
      if(!mounted.current||seq!==watchSeq.current)return
      try{
        const r=await updatesService.job(id)
        if(!mounted.current||seq!==watchSeq.current)return
        setJob(r.job)
        if(['completed','restart-required','rolled-back','failed'].includes(r.job.status)){
          localStorage.removeItem('als:last-update-job')
          await load({silent:true})
          if(r.job.status==='completed'&&r.job.type!=='github-publish'){
            const reloadKey=`als:update-reloaded:${id}`
            if(!sessionStorage.getItem(reloadKey)){
              sessionStorage.setItem(reloadKey,'1')
              toast.success('Atualização concluída. Recarregando o painel com os arquivos novos…',{duration:3500})
              poll.current=setTimeout(()=>window.location.reload(),900)
            }
          }else if(r.job.status==='completed'&&r.job.type==='github-publish'){
            toast.success('Publicação concluída no GitHub.')
          }
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
        message:`Revise a simulação abaixo. ${s.packageType==='incremental'?`Este incremental exige a base ${s.baseVersion} e aplicará somente o delta.`:'Este é um pacote completo usado como referência; arquivos idênticos não serão regravados.'} A instalação criará snapshot, ativará modo manutenção e abrirá o monitor independente antes de aplicar somente as diferenças necessárias.`,
      })
    }catch(e){
      setConfirmAction(null)
      toast.error(`Pré-check falhou: ${e.message}`)
    }
  }
  function rollback(s){ setConfirmAction({type:'rollback',item:s,title:`Voltar para a versão ${s.version}?`,message:'O AL Sistemas restaurará o snapshot selecionado e verificará o funcionamento depois.'}) }
  function deletePrepared(s){ setConfirmAction({type:'delete-stage',item:s,title:`Excluir pacote ${s.version}?`,message:'Remove somente esta versão preparada do staging. A instalação atual não será alterada.'}) }
  function deleteSnapshotItem(s){ setConfirmAction({type:'delete-snapshot',item:s,title:`Excluir snapshot ${s.version}?`,message:'Este ponto de retorno será apagado definitivamente. Isso não altera a versão instalada agora.'}) }
  async function handoffToExternalMonitor(monitorUrl,jobId){
    if(!monitorUrl)return false
    let healthUrl
    try{ healthUrl=new URL('/health',monitorUrl).toString() }catch{return false}
    for(let i=0;i<18;i++){
      if(!mounted.current)return false
      try{
        const r=await fetch(healthUrl,{cache:'no-store',signal:AbortSignal.timeout(900)})
        const d=await r.json().catch(()=>({}))
        if(r.ok&&(!d.jobId||d.jobId===jobId)){
          window.location.assign(monitorUrl)
          return true
        }
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,450))
    }
    return false
  }

  async function confirmOperation(){
    const action=confirmAction
    if(!action)return
    setConfirmAction(null)
    try{
      if(action.type==='delete-stage'){
        const r=await updatesService.excluirPreparado(action.item.id)
        toast.success(r.message||'Pacote preparado excluído.')
        await load({silent:true})
        return
      }
      if(action.type==='delete-snapshot'){
        const r=await updatesService.excluirSnapshot(action.item.id)
        toast.success(r.message||'Snapshot excluído.')
        await load({silent:true})
        return
      }
      const config={frontendUrl:window.location.origin,returnPath:'/admin/atualizacoes',snapshotRetention:3,maintenanceMode:true}
      const r=action.type==='install'?await updatesService.instalar(action.item.id,config):await updatesService.rollback(action.item.id,config)
      localStorage.setItem('als:last-update-job',r.job.id)
      toast.success(action.type==='install'?'Atualização iniciada.':'Rollback iniciado.')
      if(r.monitorReady&&r.monitorUrl){
        window.location.assign(r.monitorUrl)
        return
      }
      watch(r.job.id)
      if(r.monitorUrl){
        toast('Canal independente iniciando. O progresso continua aqui e a transferência será automática quando ele responder.')
        void handoffToExternalMonitor(r.monitorUrl,r.job.id)
      }
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
  async function runSystemSelfTest(){
    setUiPanel('selftest')
    setSystemTest({loading:true})
    try{
      const r=await updatesService.postInstallSelfTest(window.location.origin)
      const test=r.selfTest
      setSystemTest({...test,loading:false})
      toast[test.ok?'success':'error'](test.ok?`Autoteste concluído: ${test.score}% saudável.`:`Autoteste encontrou ${test.summary?.failed||0} falha(s) obrigatória(s).`)
    }catch(e){
      const payload=e?.data?.selfTest||null
      if(payload)setSystemTest({...payload,loading:false})
      else setSystemTest({loading:false,ok:false,error:e.message})
      toast.error(e.message||'Falha ao executar autoteste pós-instalação.')
    }
  }
  async function copySystemTest(){
    if(!systemTest)return
    const lines=[
      `AL Sistemas ${systemTest.version||''} — autoteste pós-instalação`,
      `Ambiente: ${systemTest.environment||'—'}`,
      `Resultado: ${systemTest.ok?'APROVADO':'COM FALHAS'} · ${systemTest.score??'—'}%`,
      '',
      ...(systemTest.checks||[]).map(c=>`${c.status==='pass'?'✓':c.status==='skip'?'○':c.status==='warn'?'⚠':'✕'} ${c.label}: ${typeof c.detail==='string'?c.detail:JSON.stringify(c.detail)}`),
    ]
    try{await navigator.clipboard.writeText(lines.join('\n'));toast.success('Diagnóstico copiado.')}catch{toast.error('Não foi possível copiar o diagnóstico.')}
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
        watch(r.job.id,'github-publish')
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
  return <div className="adm-page updates-hub" style={{display:'grid',gap:14}}>
    <div className="updates-hero">
      <div>
        <div className="updates-kicker">CENTRAL DE ATUALIZAÇÕES</div>
        <h1 style={{margin:0,color:C.text,fontSize:27}}>AL Sistemas <span style={{color:C.greenSolid}}>v{data?.installed?.version||'—'}</span></h1>
        <p style={{color:C.muted,margin:'6px 0 0',fontSize:13,lineHeight:1.5}}>Atualização, publicação, diagnóstico e recuperação em uma única central. Os detalhes abrem em painéis próprios para manter esta tela curta.</p>
      </div>
      <div className={`updates-status-pill ${data?.installed?.synchronized?'ok':'warn'}`}>{data?.installed?.synchronized?'● Sistema sincronizado':'● Versões divergentes'}</div>
    </div>

    {activeOperation&&<div className="updates-alert updates-alert-warn">
      <div><b>🔒 Atualizador ocupado</b><span>Job {activeOperation.jobId}</span></div>
      {!serverless&&<button onClick={recoverActive}>Recuperar</button>}
    </div>}
    {serverless&&<div className="updates-alert updates-alert-info"><div><b>☁️ Vercel detectada</b><span>Instalação local desativada; publicação segue por GitHub/Vercel.</span></div></div>}

    <div className="updates-command-grid">
      <button className="updates-command updates-command-primary" onClick={()=>setUiPanel('upload')}>
        <span className="updates-command-icon">⬆</span><span><b>Nova versão</b><small>Enviar ZIP e validar</small></span>
      </button>
      {!serverless&&<button className="updates-command updates-command-install" disabled={Boolean(activeOperation)} onClick={()=>setUiPanel('packages')}>
        <span className="updates-command-icon">▶</span><span><b>Instalar</b><small>{stagedPackages.length?`${stagedPackages.length} versão(ões) pronta(s)`:'nenhuma versão preparada'}</small></span>
      </button>}
      <button className="updates-command" disabled={Boolean(activeOperation)} onClick={()=>openGithubPublish(null)}>
        <span className="updates-command-icon">⌁</span><span><b>Publicar</b><small>GitHub / Vercel</small></span>
      </button>
      <button className="updates-command" onClick={()=>setUiPanel('environment')}>
        <span className="updates-command-icon">◉</span><span><b>Ambiente</b><small>{data?.runtime?.environment||'Servidor'} · {diagnostics?.loading?'verificando':diagnostics?.ok?'pronto':'atenção'}</small></span>
      </button>
      {!serverless&&<button className="updates-command" onClick={()=>setUiPanel('selftest')}>
        <span className="updates-command-icon">✓</span><span><b>Autoteste</b><small>{systemTest?.loading?'executando':systemTest?`${systemTest.score??'—'}% de saúde`:'verificar instalação'}</small></span>
      </button>}
      {!serverless&&<button className="updates-command" onClick={()=>setUiPanel('snapshots')}>
        <span className="updates-command-icon">↶</span><span><b>Snapshots</b><small>{data?.snapshots?.length||0} ponto(s) de retorno</small></span>
      </button>}
      <button className="updates-command" onClick={()=>setUiPanel('history')}>
        <span className="updates-command-icon">≡</span><span><b>Histórico</b><small>{data?.history?.length||0} operação(ões)</small></span>
      </button>
      {!serverless&&<button className="updates-command" onClick={()=>setUiPanel('recovery')}>
        <span className="updates-command-icon">✦</span><span><b>Recuperação</b><small>{data?.restart?.strategy||'none'} · emergência</small></span>
      </button>}
    </div>

    <div className="updates-overview">
      <div><span>Backend</span><b>{data?.installed?.backend||'—'}</b></div>
      <div><span>Frontend</span><b>{data?.installed?.frontend||'—'}</b></div>
      <div><span>Node.js</span><b>{data?.runtime?.node||'—'}</b></div>
      <div><span>npm</span><b>{data?.runtime?.npm||'—'}</b></div>
      <div><span>React</span><b>{data?.runtime?.stack?.react?.version||'—'}</b></div>
      <div><span>Vite</span><b>{data?.runtime?.stack?.vite?.version||'—'}</b></div>
      <div><span>Express</span><b>{data?.runtime?.stack?.express?.version||'—'}</b></div>
      <div><span>Mongoose</span><b>{data?.runtime?.stack?.mongoose?.version||'—'}</b></div>
    </div>

    {job&&job.type!=='github-publish'&&<UpdateProgressModal job={job} onClose={()=>{if(['completed','failed','restart-required','rolled-back'].includes(job.status))setJob(null)}}/>}
    {job&&job.type==='github-publish'&&<PublishProgressModal job={job} onClose={()=>{if(['completed','failed','restart-required','rolled-back'].includes(job.status))setJob(null)}}/>}

    {uiPanel==='upload'&&<PanelModal kicker="NOVA VERSÃO" title="Validar e preparar pacote" onClose={()=>setUiPanel(null)}>
      <p className="updates-panel-copy">{serverless?'Na Vercel, o ZIP é validado e permanece apenas durante o processamento.':'O ZIP é validado e extraído em staging. Nenhum arquivo da instalação é substituído nesta etapa.'}</p>
      <div className="updates-upload-row"><input className="updates-file-input" type="file" accept=".zip" onChange={e=>setFile(e.target.files?.[0]||null)} style={{color:C.text}}/><button className="updates-primary-action" disabled={uploading} onClick={prepare} style={{...btn,background:C.blue,color:'#fff'}}>{uploading?'Validando…':'Validar e preparar'}</button></div>
      {file&&<div className="updates-file-selected">Selecionado: <b>{file.name}</b> · {bytes(file.size)}</div>}
    </PanelModal>}

    {uiPanel==='environment'&&<PanelModal kicker="AMBIENTE" title="Servidor e diagnóstico" onClose={()=>setUiPanel(null)} wide>
      <div className="updates-runtime-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:10}}>
        {[
          ['Ambiente',data?.runtime?.environment],
          ['Node.js',data?.runtime?.node],
          ['npm',data?.runtime?.npm],
          ['Arquitetura',data?.runtime?.arch],
          ['Processo',data?.runtime?.processManager],
          ['Termux',data?.runtime?.termuxVersion],
          ['React Router',data?.runtime?.stack?.reactRouter?.version],
          ['MongoDB',data?.runtime?.stack?.mongodb?.stateLabel],
        ].map(([label,value])=><MiniStat key={label} label={label} value={value||'—'}/>)}
      </div>
      {!serverless&&<>
        <div className="updates-panel-section">
          <div className="updates-panel-head"><div><b>Diagnóstico do atualizador</b><small>{diagnostics?.loading?'Verificando permissões, recuperação e armazenamento…':diagnostics?.ok?'Ambiente pronto para atualizações protegidas.':diagnostics?'Existem bloqueios que precisam de atenção.':'Ainda não verificado.'}</small></div><button onClick={()=>runDiagnostics(true)} disabled={diagnostics?.loading||Boolean(activeOperation)}>{diagnostics?.loading?'Verificando…':'Verificar novamente'}</button></div>
          {!!diagnostics?.checks?.length&&<div className="updates-check-grid">{diagnostics.checks.map(c=><div key={c.id} className={`updates-check ${c.ok?'ok':'bad'}`}><b>{c.ok?'✓':'✕'} {c.label}</b>{c.detail!==undefined&&c.detail!==null&&<span>{typeof c.detail==='number'?bytes(c.detail):String(c.detail)}</span>}</div>)}</div>}
          {!!diagnostics?.warnings?.length&&<div className="updates-warnings">{diagnostics.warnings.map((w,i)=><div key={i}>⚠ {w}</div>)}</div>}
        </div>
        <div className="updates-panel-actions"><button onClick={runEngineSelfTest} disabled={engineTest?.loading||Boolean(activeOperation)}>{engineTest?.loading?'Testando recuperação…':'Autoteste do motor'}</button>{engineTest&&!engineTest.loading&&<span className={engineTest.ok?'good':'bad-text'}>{engineTest.ok?`✓ ${engineTest.checks?.length||0} verificações aprovadas`:`✕ ${engineTest.error||'falha detectada'}`}</span>}</div>
      </>}
    </PanelModal>}

    {uiPanel==='selftest'&&!serverless&&<PanelModal kicker="AUTOTESTE" title="Saúde da instalação" onClose={()=>setUiPanel(null)} wide>
      <p className="updates-panel-copy">Confere backend, MongoDB, versões, arquivos essenciais, gravação, health check, RSS, portal e integrações conectadas sem alterar dados.</p>
      <div className="updates-panel-actions"><button className="primary-green" onClick={runSystemSelfTest} disabled={systemTest?.loading||Boolean(activeOperation)}>{systemTest?.loading?'Executando testes…':'Executar autoteste completo'}</button>{systemTest&&!systemTest.loading&&<button onClick={copySystemTest}>📋 Copiar diagnóstico</button>}</div>
      {systemTest?.loading&&<div className="updates-loading-panel">Executando verificações da instalação…</div>}
      {systemTest&&!systemTest.loading&&<div className={`updates-health ${systemTest.ok?'ok':'bad'}`}>
        <div className="updates-health-head"><div><b>{systemTest.ok?'✓ Instalação saudável':'✕ Instalação precisa de atenção'}</b><span>Pontuação {systemTest.score??'—'}% · {systemTest.summary?.passed||0} aprovados · {systemTest.summary?.warnings||0} avisos · {systemTest.summary?.failed||0} falhas</span></div></div>
        {!!systemTest.error&&<div className="bad-text">{systemTest.error}</div>}
        {!!systemTest.checks?.length&&<div className="updates-check-grid">{systemTest.checks.map(c=><div key={c.id} className={`updates-check ${c.status==='pass'?'ok':c.status==='warn'?'warn':c.status==='skip'?'':'bad'}`}><b>{c.status==='pass'?'✓':c.status==='skip'?'○':c.status==='warn'?'⚠':'✕'} {c.label}</b><span>{typeof c.detail==='string'?c.detail:JSON.stringify(c.detail)}</span>{c.durationMs>0&&<em>{c.durationMs} ms</em>}</div>)}</div>}
      </div>}
    </PanelModal>}

    {uiPanel==='packages'&&<PanelModal kicker="VERSÕES PRONTAS" title={`Preparadas para instalar · ${stagedPackages.length}`} onClose={()=>setUiPanel(null)} wide>
      <p className="updates-panel-copy">Cada versão fica isolada até você decidir instalar ou excluir. Publicação para GitHub/Vercel continua no módulo <b>Publicar</b>, sem duplicar ações aqui.</p>
      {!stagedPackages.length?<div className="updates-empty">Nenhuma versão preparada. Envie um ZIP em <b>Nova versão</b>; quando a validação terminar, a simulação da instalação abrirá automaticamente.</div>:stagedPackages.map((s,index)=>{
        const notes=releaseNotes(s.changelog)
        const dependencyState=[
          s.dependencies?.backend?.installRequired?'backend requer ação':'backend íntegro',
          s.dependencies?.frontend?.installRequired?'frontend requer ação':'frontend íntegro',
        ]
        return <article key={s.id} className={`updates-release-card ${index===0?'latest':''}`}>
          <div className="updates-release-top">
            <div className="updates-release-version"><span>AL</span><div><small>{index===0?'MAIS RECENTE':'VERSÃO PREPARADA'}</small><strong>v{s.version}</strong></div></div>
            <span className="updates-release-ready">● PRONTA</span>
          </div>
          <div className="updates-release-meta">
            <span>{s.packageType==='incremental'?`⚡ Incremental · base ${s.baseVersion}`:'▣ Completo · aplicação diferencial'}</span>
            <span>{s.integrity?.fileCount||'—'} arquivos</span>
            <span>{bytes(s.integrity?.totalBytes)}</span>
            <span>{s.migrations?.length||0} migração(ões)</span>
          </div>
          <div className="updates-release-file"><b>{s.filename}</b><span>{fmt(s.createdAt)}</span></div>
          <section className="updates-release-notes">
            <div className="updates-release-notes-head"><div><small>RELEASE BRIEF</small><b>O que mudou nesta versão</b></div><span>{notes.length} item(ns)</span></div>
            {notes.length?<div className="updates-release-note-list">{notes.slice(0,5).map((note,i)=><div key={i}><i>{String(i+1).padStart(2,'0')}</i><span>{note}</span></div>)}</div>:<div className="updates-empty">Esta versão não trouxe notas de alteração.</div>}
            {notes.length>5&&<details className="updates-release-more"><summary>Ver changelog completo</summary><pre>{s.changelog}</pre></details>}
          </section>
          <div className="updates-release-health">
            <span>✓ {dependencyState[0]}</span><span>✓ {dependencyState[1]}</span><span>✓ integridade validada</span>
          </div>
          <div className="updates-release-actions">
            {!serverless&&<button className="updates-install-action" disabled={Boolean(activeOperation)} onClick={()=>install(s)}>Simular e instalar</button>}
            <button className="updates-delete-action" disabled={Boolean(activeOperation)} onClick={()=>deletePrepared(s)}>Excluir versão</button>
          </div>
        </article>
      })}
    </PanelModal>}

    {uiPanel==='snapshots'&&!serverless&&<PanelModal kicker="ROLLBACK" title="Snapshots disponíveis" onClose={()=>setUiPanel(null)}>
      <p className="updates-panel-copy">Retenção automática: os {data?.updateCapabilities?.snapshotRetention||3} snapshots mais recentes são mantidos.</p>
      {!data?.snapshots?.length?<div className="updates-empty">Nenhum snapshot criado ainda.</div>:data.snapshots.map(s=><div key={s.id} className="updates-list-row"><div><b>v{s.version}</b><small>{fmt(s.createdAt)}{s.safe===false?' · rollback manual indisponível':''}</small></div><div className="updates-row-actions"><button disabled={s.safe===false||Boolean(activeOperation)} onClick={()=>rollback(s)}>Rollback</button><button className="updates-delete-action" disabled={Boolean(activeOperation)} onClick={()=>deleteSnapshotItem(s)}>Excluir</button></div></div>)}
    </PanelModal>}

    {uiPanel==='history'&&<PanelModal kicker="HISTÓRICO" title="Operações recentes" onClose={()=>setUiPanel(null)} wide>
      {!data?.history?.length?<div className="updates-empty">Sem atualizações registradas.</div>:data.history.map(h=><div key={h.id} className="updates-history-row"><div><b>{h.type==='rollback'?'Rollback':h.type==='github-publish'?'GitHub':h.type==='recovery'?'Recuperação':'Atualização'} {h.fromVersion} → {h.toVersion}</b>{h.repository&&<span>{h.repository}{h.branch?` @ ${h.branch}`:''}</span>}<small>{fmt(h.createdAt)}</small></div><span className={`updates-history-status ${h.status==='success'?'ok':h.status==='rolled-back'?'bad':''}`}>{h.status}</span></div>)}
    </PanelModal>}

    {uiPanel==='recovery'&&!serverless&&<PanelModal kicker="RECUPERAÇÃO" title="Reinício e emergência" onClose={()=>setUiPanel(null)}>
      <div className="updates-runtime-grid" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:10}}><MiniStat label="Estratégia" value={data?.restart?.strategy||'none'}/><MiniStat label="Gerenciador" value={data?.runtime?.processManager||'—'}/></div>
      <p className="updates-panel-copy">Use a recuperação de emergência somente se uma atualização for interrompida e o backend não voltar sozinho.</p>
      {data?.updateCapabilities?.emergencyRecoveryCommand?<><div className="updates-code-label">COMANDO DE EMERGÊNCIA</div><code className="updates-code-block">{data.updateCapabilities.emergencyRecoveryCommand}</code></>:<div className="updates-empty">Nenhum comando de recuperação foi informado para este ambiente.</div>}
    </PanelModal>}

    {githubPublish&&<div className="updates-modal-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setGithubPublish(null)}}>
      <div className="updates-modal updates-github-modal" role="dialog" aria-modal="true" aria-labelledby="github-publish-title">
        <div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:'.04em'}}>MÓDULO DE PUBLICAÇÃO · {githubPublish.sourceType==='installed'?'INSTALAÇÃO ATUAL':'PACOTE PREPARADO'}</div>
        <h2 id="github-publish-title" style={{margin:'7px 0 4px',color:C.text,fontSize:20}}>GitHub / Vercel</h2>
        <p style={{margin:'0 0 16px',color:C.muted,fontSize:13,lineHeight:1.55}}>O AL Sistemas publica {githubPublish.sourceType==='installed'?<><b>a instalação atual</b> diretamente como commit no GitHub, sem ZIP.</>:<>o pacote como <b>commit no GitHub</b>.</>} {serverless?'O arquivo será processado temporariamente nesta requisição e descartado ao final. ':''}A Vercel não recebe o ZIP diretamente: quando existir um projeto Vercel ligado ao repositório/branch, o push do GitHub dispara o deployment.</p>
        {githubPublish.loading?<div style={{padding:'16px 0',color:C.muted}}>Consultando repositórios autorizados…</div>:<>
          {githubPublish.error&&<div style={{padding:11,borderRadius:9,border:`1px solid ${C.red}`,color:C.red,background:'var(--adm-surface2)',fontSize:12,marginBottom:12}}>{githubPublish.error}</div>}
          {(githubPublish.repositories||[]).length>0&&<>
            <label className="updates-modal-field">Repositório<select value={githubPublish.repository} onChange={e=>{const repo=(githubPublish.repositories||[]).find(r=>r.fullName===e.target.value);setGithubPublish(g=>({...g,repository:e.target.value,branch:repo?.defaultBranch||'main',deploymentCheck:null}))}}>{(githubPublish.repositories||[]).map(r=><option key={r.id} value={r.fullName}>{r.fullName}{r.private?' • privado':''}</option>)}</select></label>
            <label className="updates-modal-field">Branch<input value={githubPublish.branch} onChange={e=>setGithubPublish(g=>({...g,branch:e.target.value,deploymentCheck:null}))} placeholder="main"/></label>
            <div className="updates-panel-actions"><button onClick={()=>checkDeployment(true)} disabled={githubPublish.checking}>{githubPublish.checking?'Verificando…':'Verificar GitHub / Vercel'}</button>{githubPublish.deploymentCheck&&<span className={githubPublish.deploymentCheck.ok?'good':'bad-text'}>{githubPublish.deploymentCheck.ok?'✓ GitHub pronto':'⚠ GitHub precisa de atenção'}</span>}</div>
            {githubPublish.deploymentCheck&&<div className="updates-deploy-check"><div><b>GitHub:</b> {githubPublish.deploymentCheck.github?.writable?'escrita autorizada':'sem permissão de escrita'} · branch {githubPublish.deploymentCheck.github?.branchExists?'encontrada':githubPublish.deploymentCheck.github?.branchWillBeCreated?'será criada':'indisponível'}.</div><div><b>Vercel:</b> {githubPublish.deploymentCheck.vercel?.configured?githubPublish.deploymentCheck.vercel.message:'não configurada; a publicação continuará somente no GitHub.'}</div>{githubPublish.deploymentCheck.vercel?.projects?.map(pr=><div key={pr.id}>▲ <b>{pr.name}</b>{pr.rootDirectory?` · raiz: ${pr.rootDirectory}`:''}{pr.productionBranch?` · produção: ${pr.productionBranch}`:''}</div>)}</div>}
            <label className="updates-modal-field">{githubPublish.sourceType==='installed'?'O que publicar':'Onde aplicar os arquivos do ZIP'}<select value={githubPublish.publishMode} onChange={e=>setGithubPublish(g=>({...g,publishMode:e.target.value}))}><option value="project">Projeto completo — /backend + /frontend</option><option value="frontend-folder">Somente frontend — pasta /frontend</option><option value="frontend-root">Somente frontend — raiz do repositório (Vercel)</option><option value="backend-folder">Somente backend — pasta /backend</option></select></label>
          </>}
        </>}
        <div className="updates-modal-footer"><button onClick={()=>setGithubPublish(null)}>Cancelar</button><button className="primary-blue" disabled={githubPublish.loading||githubPublish.submitting||!githubPublish.repository} onClick={publishGithub}>{githubPublish.submitting?'Publicando…':githubPublish.sourceType==='installed'?'Publicar versão atual':'Publicar atualização'}</button></div>
      </div>
    </div>}

    {confirmAction&&<div className="updates-modal-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setConfirmAction(null)}}>
      <div className="updates-modal" role="dialog" aria-modal="true" aria-labelledby="update-confirm-title">
        <div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:'.04em'}}>CONFIRMAÇÃO</div>
        <h2 id="update-confirm-title" style={{margin:'7px 0 8px',color:C.text,fontSize:20}}>{confirmAction.title}</h2>
        <p style={{margin:'0 0 14px',color:C.muted,fontSize:13,lineHeight:1.55}}>{confirmAction.message}</p>
        {confirmAction.loading&&<div className="updates-loading-panel">Verificando arquivos, dependências, migrações e espaço disponível…</div>}
        {confirmAction.preflight&&<PreflightSummary data={confirmAction.preflight}/>}
        <div className="updates-modal-footer"><button onClick={()=>setConfirmAction(null)}>Cancelar</button>{!confirmAction.loading&&<button className={['rollback','delete-stage','delete-snapshot'].includes(confirmAction.type)?'danger':'primary-green'} disabled={confirmAction.type==='install'&&confirmAction.preflight&&!confirmAction.preflight.ok} onClick={confirmOperation}>{confirmAction.type==='rollback'?'Confirmar rollback':confirmAction.type==='delete-stage'?'Excluir versão':confirmAction.type==='delete-snapshot'?'Excluir snapshot':'Instalar atualização'}</button>}</div>
      </div>
    </div>}

    <style>{`
      .updates-hub{min-width:0}.updates-hub>*{min-width:0;box-sizing:border-box}.updates-wrap{overflow-wrap:anywhere;word-break:break-word}
      .updates-hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:2px 2px 6px}.updates-kicker{font-size:10px;font-weight:900;letter-spacing:.16em;color:var(--adm-muted);margin-bottom:5px}
      .updates-status-pill{flex:0 0 auto;border:1px solid var(--adm-border);border-radius:999px;padding:7px 10px;font-size:11px;font-weight:800;background:var(--adm-surface)}.updates-status-pill.ok{color:#16a34a}.updates-status-pill.warn{color:#f59e0b}
      .updates-alert{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;border-radius:12px;border:1px solid var(--adm-border);background:var(--adm-surface);font-size:12px}.updates-alert>div{display:grid;gap:2px}.updates-alert span{color:var(--adm-muted)}.updates-alert button,.updates-panel-actions button,.updates-panel-head button,.updates-list-row button,.updates-modal-footer button{border:1px solid var(--adm-border);border-radius:9px;padding:9px 12px;font-weight:800;background:var(--adm-surface2);color:var(--adm-text);cursor:pointer}.updates-alert-warn{border-color:#f59e0b66}.updates-alert-info{border-color:#3b82f666}
      .updates-command-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.updates-command{min-width:0;text-align:left;border:1px solid var(--adm-border);background:var(--adm-surface);border-radius:14px;padding:14px;display:flex;gap:11px;align-items:center;color:var(--adm-text);cursor:pointer;box-shadow:0 5px 18px rgba(15,23,42,.035)}.updates-command:disabled{opacity:.45;cursor:not-allowed}.updates-command-primary{border-color:#3b82f655;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2))}.updates-command-install{border-color:#16a34a55;background:linear-gradient(145deg,var(--adm-surface),rgba(22,163,74,.035))}.updates-command-icon{width:34px;height:34px;border:1px solid var(--adm-border);border-radius:10px;display:grid;place-items:center;flex:0 0 auto;font-size:17px}.updates-command span:last-child{min-width:0;display:grid;gap:3px}.updates-command b{font-size:13px}.updates-command small{font-size:10px;color:var(--adm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .updates-overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--adm-border);border:1px solid var(--adm-border);border-radius:12px;overflow:hidden}.updates-overview>div{background:var(--adm-surface);padding:10px 12px;display:grid;gap:3px;min-width:0}.updates-overview span{font-size:9px;color:var(--adm-muted);font-weight:900;letter-spacing:.08em;text-transform:uppercase}.updates-overview b{font-size:12px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .updates-modal-overlay{position:fixed;inset:0;z-index:1200;background:rgba(15,23,42,.38);display:flex;align-items:center;justify-content:center;padding:14px;backdrop-filter:blur(2px)}.updates-modal{width:min(100%,620px);max-height:88vh;overflow:auto;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.24);padding:20px;box-sizing:border-box}.updates-panel-wide{width:min(100%,760px)}.updates-modal-titlebar{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}.updates-modal-kicker{font-size:10px;font-weight:900;color:var(--adm-muted);letter-spacing:.14em}.updates-modal-titlebar h2{margin:5px 0 0;color:var(--adm-text);font-size:21px}.updates-modal-x{width:34px;height:34px;border:1px solid var(--adm-border);background:var(--adm-surface2);color:var(--adm-text);border-radius:10px;font-size:21px;cursor:pointer}.updates-panel-copy{font-size:13px;line-height:1.55;color:var(--adm-muted);margin:0 0 14px}
      .updates-upload-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.updates-file-input{min-width:0;max-width:100%}.updates-file-selected{margin-top:10px;padding:10px;border:1px solid var(--adm-border);border-radius:9px;font-size:12px;color:var(--adm-muted);overflow-wrap:anywhere}
      .updates-panel-section{margin-top:14px;padding-top:14px;border-top:1px solid var(--adm-border)}.updates-panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.updates-panel-head>div{display:grid;gap:3px}.updates-panel-head small{color:var(--adm-muted);font-size:11px}.updates-check-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.updates-check{border:1px solid var(--adm-border);border-radius:10px;padding:10px;font-size:11px;display:grid;gap:4px;min-width:0}.updates-check b{color:var(--adm-text)}.updates-check span{color:var(--adm-muted);overflow-wrap:anywhere}.updates-check em{font-style:normal;font-size:10px;color:var(--adm-muted)}.updates-check.ok{border-color:#16a34a55}.updates-check.bad{border-color:#ef444455}.updates-check.warn{border-color:#f59e0b55}.updates-warnings{margin-top:10px;font-size:11px;color:#f59e0b;line-height:1.5}.updates-panel-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:14px}.updates-panel-actions span{font-size:11px}.good{color:#16a34a}.bad-text{color:#ef4444}.updates-loading-panel,.updates-empty{padding:14px;border-radius:10px;background:var(--adm-surface2);border:1px solid var(--adm-border);color:var(--adm-muted);font-size:12px;margin-top:12px}
      .updates-health{margin-top:14px;border:1px solid var(--adm-border);border-radius:12px;padding:12px}.updates-health.ok{border-color:#16a34a55}.updates-health.bad{border-color:#ef444455}.updates-health-head>div{display:grid;gap:4px}.updates-health-head b{color:var(--adm-text)}.updates-health-head span{font-size:11px;color:var(--adm-muted)}
      .updates-release-card{position:relative;border:1px solid var(--adm-border);border-radius:16px;padding:16px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));box-shadow:0 10px 30px rgba(15,23,42,.04);overflow:hidden}.updates-release-card+.updates-release-card{margin-top:12px}.updates-release-card.latest{border-color:#16a34a55}.updates-release-card.latest:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#16a34a}.updates-release-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.updates-release-version{display:flex;gap:10px;align-items:center;min-width:0}.updates-release-version>span{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:var(--adm-bg);border:1px solid var(--adm-border);font-size:11px;font-weight:900;color:#16a34a}.updates-release-version>div{display:grid;gap:2px}.updates-release-version small{font-size:8px;letter-spacing:.12em;font-weight:900;color:var(--adm-muted)}.updates-release-version strong{font-size:20px;color:var(--adm-text);letter-spacing:-.03em}.updates-release-ready{font-size:9px;font-weight:900;letter-spacing:.08em;color:#16a34a;border:1px solid #16a34a44;border-radius:999px;padding:5px 7px;background:#16a34a0a}.updates-release-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.updates-release-meta span{font-size:9px;font-weight:800;color:var(--adm-muted);border:1px solid var(--adm-border);background:var(--adm-bg);border-radius:999px;padding:5px 7px}.updates-release-file{display:flex;justify-content:space-between;gap:10px;margin-top:10px;font-size:10px;color:var(--adm-muted)}.updates-release-file b{color:var(--adm-text);overflow-wrap:anywhere}.updates-release-file span{flex:0 0 auto}.updates-release-notes{margin-top:14px;border-top:1px solid var(--adm-border);padding-top:13px}.updates-release-notes-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-end}.updates-release-notes-head>div{display:grid;gap:2px}.updates-release-notes-head small{font-size:8px;font-weight:900;letter-spacing:.13em;color:var(--adm-muted)}.updates-release-notes-head b{font-size:13px;color:var(--adm-text)}.updates-release-notes-head>span{font-size:9px;color:var(--adm-muted)}.updates-release-note-list{display:grid;gap:6px;margin-top:9px}.updates-release-note-list>div{display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px;align-items:start;font-size:11px;line-height:1.45}.updates-release-note-list i{font-style:normal;font-family:monospace;color:#16a34a;font-size:9px;padding-top:2px}.updates-release-note-list span{color:var(--adm-muted);overflow-wrap:anywhere}.updates-release-more{margin-top:9px}.updates-release-more summary{cursor:pointer;color:#3b82f6;font-size:10px;font-weight:800}.updates-release-more pre{white-space:pre-wrap;color:var(--adm-text);font-family:inherit;font-size:11px;line-height:1.5;max-width:100%;overflow:auto}.updates-release-health{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.updates-release-health span{font-size:9px;color:#16803d;background:#16a34a0a;border-radius:7px;padding:5px 7px}.updates-release-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px}.updates-release-actions button{border:1px solid var(--adm-border);border-radius:9px;padding:9px 12px;font-weight:850;cursor:pointer}.updates-install-action{background:#16a34a;color:#fff;border-color:#16a34a!important}
      .updates-list-row,.updates-history-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:11px 0;border-top:1px solid var(--adm-border)}.updates-row-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.updates-delete-action{border-color:#ef444455!important;color:#dc2626!important;background:#ef44440a!important}.updates-list-row:first-of-type,.updates-history-row:first-of-type{border-top:0}.updates-list-row>div,.updates-history-row>div{min-width:0;display:grid;gap:3px}.updates-list-row b,.updates-history-row b{color:var(--adm-text);font-size:13px}.updates-list-row small,.updates-history-row small,.updates-history-row span{color:var(--adm-muted);font-size:11px;overflow-wrap:anywhere}.updates-history-status{flex:0 0 auto;border:1px solid var(--adm-border);border-radius:999px;padding:5px 8px}.updates-history-status.ok{color:#16a34a}.updates-history-status.bad{color:#ef4444}
      .updates-code-label{font-size:9px;font-weight:900;letter-spacing:.12em;color:var(--adm-muted);margin:14px 0 6px}.updates-code-block{display:block;padding:11px;border-radius:10px;background:var(--adm-surface2);border:1px solid var(--adm-border);font-size:11px;overflow-wrap:anywhere;color:var(--adm-text)}
      .updates-modal-field{display:block;font-size:12px;font-weight:800;margin-bottom:12px;color:var(--adm-text)}.updates-modal-field input,.updates-modal-field select{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px 11px;border-radius:9px;border:1px solid var(--adm-border);background:var(--adm-bg);color:var(--adm-text)}.updates-github-modal{width:min(100%,590px)}.updates-deploy-check{padding:11px;border-radius:9px;background:var(--adm-surface2);font-size:11px;color:var(--adm-muted);line-height:1.5;margin:10px 0}.updates-deploy-check>div+div{margin-top:4px}.updates-modal-footer{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;margin-top:18px}.updates-modal-footer .primary-blue,.primary-blue{background:#2563eb;color:#fff;border-color:#2563eb}.updates-modal-footer .primary-green,.primary-green{background:#16a34a;color:#fff;border-color:#16a34a}.updates-modal-footer .danger{background:#dc2626;color:#fff;border-color:#dc2626}
      .updates-progress-modal{width:min(650px,calc(100vw - 24px));max-height:90vh;overflow:auto;padding:0!important}.updates-progress-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:20px 20px 14px}.updates-progress-embedded{margin:0 20px;padding-bottom:4px}.updates-progress-close{border:1px solid var(--adm-border);background:var(--adm-surface2);color:var(--adm-text);width:34px;height:34px;border-radius:10px;font-size:22px;line-height:1;cursor:pointer;flex:0 0 auto}.updates-progress-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px 20px;color:var(--adm-muted);font-size:12px}
      @media(max-width:760px){.updates-command-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.updates-overview{grid-template-columns:repeat(2,minmax(0,1fr))}.updates-status-pill{display:none}}
      @media(max-width:560px){.updates-hero h1{font-size:24px!important}.updates-command{padding:12px 10px;gap:8px}.updates-command-icon{width:31px;height:31px}.updates-check-grid{grid-template-columns:1fr}.updates-modal-overlay{padding:12px;align-items:center;justify-content:center}.updates-modal{width:100%;max-height:calc(100dvh - 24px);border-radius:18px;padding:16px}.updates-upload-row{grid-template-columns:1fr}.updates-primary-action{width:100%}.updates-release-file{display:grid;gap:3px}.updates-release-file span{flex:auto}.updates-release-actions{display:grid;grid-template-columns:1fr}.updates-release-actions button{width:100%}.updates-progress-modal{width:100%;max-height:calc(100dvh - 24px);border-radius:18px}.updates-progress-head{padding:16px 14px 12px}.updates-progress-embedded{margin:0 14px}.updates-progress-footer{padding:12px 14px 16px;flex-direction:column;align-items:stretch}.updates-progress-footer button{width:100%}.updates-row-actions{justify-content:flex-start}}
      @media(max-width:390px){.updates-command small{font-size:9px}.updates-command b{font-size:12px}.updates-overview>div{padding:9px}}
    `}</style>
  </div>

}


function PreflightSummary({data}){
 const risk=data.risk||'baixo'
 const riskColor=risk==='alto'?C.red:risk==='médio'?'#b7791f':C.greenSolid
 const files=data.files||{}
 const writes=files.writes ?? ((files.added||0)+(files.changed||0))
 const operations=files.operations ?? (writes+(files.removed||0))
 return <div style={{display:'grid',gap:10}}>
  <div style={{padding:11,borderRadius:10,border:'1px solid #3b82f644',background:'#3b82f60b',fontSize:12,lineHeight:1.5,color:C.text}}>
   <b>Aplicação diferencial</b><br/>
   O pacote completo é a referência da versão. O atualizador compara os arquivos e só grava o que realmente mudou; arquivos idênticos permanecem intactos.
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>
   <MiniStat label="Versão" value={`${data.fromVersion} → ${data.toVersion}`}/>
   <MiniStat label="Pacote" value={data.packageType==='incremental'?`INCREMENTAL · base ${data.baseVersion}`:'COMPLETO · DIFERENCIAL'} color={data.packageType==='incremental'?'#f59e0b':C.blue}/>
   <MiniStat label="Risco" value={risk.toUpperCase()} color={riskColor}/>
   <MiniStat label="Operações reais" value={`${operations} arquivo(s)`} color={operations?C.blue:C.greenSolid}/>
   <MiniStat label="Novos" value={`+${files.added||0}`}/>
   <MiniStat label="Alterados" value={`~${files.changed||0}`}/>
   <MiniStat label="Removidos" value={`-${files.removed||0}`} color={(files.removed||0)>0?'#b7791f':C.greenSolid}/>
   <MiniStat label="Já iguais" value={String(files.unchanged||0)} color={C.greenSolid}/>
   <MiniStat label="Locais preservados" value={String(files.ignoredLocal?.fileCount||0)} color={C.greenSolid}/>
   <MiniStat label="Migrações" value={String(data.migrations?.count||0)}/>
   <MiniStat label="Backup estimado" value={bytes(data.disk?.estimatedBackupBytes)}/>
   <MiniStat label="Espaço livre" value={bytes(data.disk?.freeBytes)} color={data.disk?.ok?C.greenSolid:C.red}/>
  </div>
  <div style={{padding:10,borderRadius:9,border:'1px solid var(--adm-border)',background:'var(--adm-bg)',fontSize:12,lineHeight:1.55}}>
   <b>Arquivos recebidos no pacote:</b> {files.totalIncoming||0}<br/>
   <b>Arquivos que serão gravados:</b> {writes}<br/>
   <b>Arquivos gerenciados atualmente:</b> {files.managedCurrent??'—'}<br/>
   <b>Dependências:</b> {data.dependencies?.areas?.length?data.dependencies.areas.join(', '):'sem alterações'}<br/>
   <b>Espaço necessário estimado:</b> {bytes(data.disk?.estimatedRequiredBytes)}<br/>
   <b>Node.js:</b> {data.environment?.nodeEngine?.current||'—'} {data.environment?.nodeEngine?.spec?`(pacote: ${data.environment.nodeEngine.spec})`:''}<br/>
   <b>Permissão de escrita:</b> {data.environment?.rootWritable&&data.environment?.stateWritable?'ok':'insuficiente'}<br/>
   {data.migrations?.count>0&&<><b>MongoDB para migrações:</b> {data.migrations?.databaseReady?'conectado':'indisponível'}<br/></>}
   <b>Rollback de migrações:</b> {data.migrations?.rollbackSafe?'seguro':'não garantido'}
  </div>
  {!!data.notes?.length&&<div style={{padding:10,borderRadius:9,border:'1px solid #16a34a44',background:'#16a34a0a',fontSize:12,lineHeight:1.5}}>
    {data.notes.map((n,i)=><div key={i} style={{margin:i?'5px 0 0':0}}>✓ {n}</div>)}
  </div>}
  {(files.samples?.added?.length||files.samples?.changed?.length||files.samples?.removed?.length)?<details style={{padding:10,borderRadius:9,border:'1px solid var(--adm-border)',background:'var(--adm-bg)',fontSize:12}}>
    <summary style={{cursor:'pointer',fontWeight:800,color:C.text}}>Ver exemplos dos arquivos afetados</summary>
    {!!files.samples?.added?.length&&<div style={{marginTop:8}}><b style={{color:C.greenSolid}}>Novos</b>{files.samples.added.map(x=><div className="updates-wrap" key={`a-${x}`}>+ {x}</div>)}</div>}
    {!!files.samples?.changed?.length&&<div style={{marginTop:8}}><b style={{color:C.blue}}>Alterados</b>{files.samples.changed.map(x=><div className="updates-wrap" key={`c-${x}`}>~ {x}</div>)}</div>}
    {!!files.samples?.removed?.length&&<div style={{marginTop:8}}><b style={{color:'#b7791f'}}>Removidos</b>{files.samples.removed.map(x=><div className="updates-wrap" key={`r-${x}`}>- {x}</div>)}</div>}
  </details>:null}
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


function PanelModal({kicker,title,onClose,wide=false,children}){
  return <div className="updates-modal-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose?.()}}>
    <div className={`updates-modal ${wide?'updates-panel-wide':''}`} role="dialog" aria-modal="true">
      <div className="updates-modal-titlebar"><div><div className="updates-modal-kicker">{kicker}</div><h2>{title}</h2></div><button className="updates-modal-x" onClick={onClose} aria-label="Fechar">×</button></div>
      {children}
    </div>
  </div>
}

function UpdateProgressModal({job,onClose}){
  const canClose=['completed','failed','restart-required','rolled-back'].includes(job.status)
  return <div className="updates-modal-overlay updates-progress-overlay" role="presentation" onMouseDown={e=>{if(canClose&&e.target===e.currentTarget)onClose?.()}}>
    <div className="updates-modal updates-progress-modal" role="dialog" aria-modal="true" aria-labelledby="update-progress-title">
      <div className="updates-progress-head"><div><div style={{fontSize:10,fontWeight:900,color:C.muted,letterSpacing:'.12em'}}>ATUALIZAÇÃO EM EXECUÇÃO</div><h2 id="update-progress-title" style={{margin:'5px 0 3px',fontSize:20,color:C.text}}>AL Sistemas</h2><div style={{fontSize:12,color:C.muted,lineHeight:1.45}}>O progresso fica isolado neste painel. A página principal não precisa mais rolar até a caixa de porcentagem.</div></div>{canClose&&<button onClick={onClose} className="updates-progress-close" aria-label="Fechar">×</button>}</div>
      <UpdateProgress job={job} embedded/>
      {job.finalReport&&<div style={{margin:'14px 20px 0'}}><UpdateFinalReport report={job.finalReport}/></div>}
      <div className="updates-progress-footer"><span>{canClose?(job.status==='completed'?'Atualização concluída.':job.status==='failed'?'A atualização terminou com erro.':'Operação finalizada.'):'Não feche esta aba durante a aplicação dos arquivos.'}</span>{canClose&&<button onClick={onClose} style={{...btn,background:C.blue,color:'#fff'}}>Fechar</button>}</div>
    </div>
  </div>
}

function PublishProgressModal({job,onClose}){
  const canClose=['completed','failed','restart-required','rolled-back'].includes(job.status)
  return <div className="updates-modal-overlay updates-progress-overlay" role="presentation" onMouseDown={e=>{if(canClose&&e.target===e.currentTarget)onClose?.()}}>
    <div className="updates-modal updates-progress-modal" role="dialog" aria-modal="true" aria-labelledby="publish-progress-title">
      <div className="updates-progress-head">
        <div>
          <div style={{fontSize:11,fontWeight:900,color:C.muted,letterSpacing:'.08em'}}>PUBLICAÇÃO</div>
          <h2 id="publish-progress-title" style={{margin:'5px 0 3px',fontSize:20,color:C.text}}>GitHub / Vercel</h2>
          <div style={{fontSize:12,color:C.muted,lineHeight:1.45}}>Acompanhe o envio sem sair da tela. Quando o commit terminar, a Vercel assume o deploy se o projeto estiver conectado.</div>
        </div>
        {canClose&&<button onClick={onClose} className="updates-progress-close" aria-label="Fechar">×</button>}
      </div>
      <UpdateProgress job={job} embedded/>
      <div className="updates-progress-footer">
        {!canClose?<span>Não feche esta aba enquanto os arquivos estiverem sendo enviados.</span>:<span>{job.status==='completed'?'Publicação concluída.':job.status==='failed'?'A publicação terminou com erro.':'Operação finalizada.'}</span>}
        {canClose&&<button onClick={onClose} style={{...btn,background:C.blue,color:'#fff'}}>Fechar</button>}
      </div>
    </div>
  </div>
}

function UpdateProgress({job,embedded=false}){
  const progress=Math.max(0,Math.min(100,Number(job.progress||0)))
  const failed=job.status==='failed'||job.status==='rolled-back'
  const done=['completed','restart-required'].includes(job.status)
  const currentLabel=job.phaseLabel||STEP_LABELS[job.phase]||job.status||'Preparando'
  const timeline=Array.isArray(job.timeline)?job.timeline:[]
  const recentTimeline=timeline.slice(-6)
  return <section className={embedded?'updates-progress-embedded':''} style={embedded?{borderTop:'1px solid var(--adm-border)',paddingTop:16}:{...card,borderColor:failed?C.red:done?C.greenSolid:C.blue}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
      <div>
        {!embedded&&<div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:'.04em'}}>{job.type==='github-publish'?'PUBLICAÇÃO GITHUB / VERCEL':'PROGRESSO DA ATUALIZAÇÃO'}</div>}
        <h2 style={{margin:'5px 0 2px',fontSize:19,color:C.text}}>{currentLabel}</h2>
        {!embedded&&<div style={{fontSize:12,color:C.muted}}>{job.type==='github-publish'?'O commit é criado no GitHub; a Vercel assume o deployment se o repositório estiver conectado.':'Acompanhe esta caixa até a operação terminar.'}</div>}
      </div>
      <strong style={{fontSize:22,color:failed?C.red:done?C.greenSolid:C.blue}}>{progress}%</strong>
    </div>
    <div style={{height:9,borderRadius:999,background:'var(--adm-surface2)',overflow:'hidden',margin:'14px 0'}}>
      <div style={{height:'100%',width:`${progress}%`,background:failed?C.red:done?C.greenSolid:C.blue,transition:'width .35s ease'}}/>
    </div>
    <div style={{display:'grid',gap:7}}>
      {recentTimeline.map((step,index)=>{
        const isLast=index===recentTimeline.length-1
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
    {Array.isArray(job.dependencyWarnings)&&job.dependencyWarnings.length>0&&<div style={{marginTop:14,padding:11,borderRadius:9,background:'var(--adm-surface2)',border:'1px solid #f59e0b',color:C.text,fontSize:12,lineHeight:1.5}}><b style={{color:'#f59e0b'}}>Dependências:</b>{job.dependencyWarnings.map((w,i)=><div key={i} style={{marginTop:4}}>• {w}</div>)}</div>}
    {job.monitorError&&<div style={{marginTop:14,padding:11,borderRadius:9,background:'var(--adm-surface2)',border:'1px solid #f59e0b66',color:C.text,fontSize:12,lineHeight:1.5}}><b style={{color:'#f59e0b'}}>Canal independente indisponível.</b> {job.monitorError} O job continua sendo acompanhado pelo painel enquanto o backend responder.</div>}
    {job.error&&<div style={{marginTop:14,padding:11,borderRadius:9,background:'var(--adm-surface2)',border:`1px solid ${C.red}`,color:C.red,fontSize:12}}><b>Erro:</b> {job.error}</div>}
    {job.status==='restart-required'&&<div style={{marginTop:14,padding:11,borderRadius:9,background:'var(--adm-surface2)',color:C.text,fontSize:12}}>Os arquivos foram aplicados. Este ambiente está configurado para reinício manual.</div>}
    {job.commitUrl&&<div style={{marginTop:14,padding:11,borderRadius:9,background:'var(--adm-surface2)',fontSize:12}}><b style={{color:C.text}}>Commit publicado.</b> <a href={job.commitUrl} target="_blank" rel="noreferrer" style={{color:C.blue}}>Abrir no GitHub ↗</a><div style={{color:C.muted,marginTop:4}}>Se este repositório estiver conectado à Vercel, acompanhe agora o deployment por lá.</div></div>}
    <div className="updates-wrap" style={{fontSize:11,color:C.muted,marginTop:12}}>Job {job.id}</div>
  </section>
}
