import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import JSZip from 'jszip'
import { updatesService } from '../../services/api'
import { T as C, RADIUS, SPACE } from '../../themes/tokens'

import { confirmAction } from '../../utils/confirmAction'
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

const versionParts=v=>String(v||'').split('-')[0].split('.').map(n=>Number(n)||0)
const compareVersions=(a,b)=>{const A=versionParts(a),B=versionParts(b);for(let i=0;i<3;i++){if((A[i]||0)!==(B[i]||0))return (A[i]||0)>(B[i]||0)?1:-1}return 0}
async function inspectUpdatePackage(file){
  const zip=await JSZip.loadAsync(file)
  const entries=Object.values(zip.files||{}).filter(x=>!x.dir)
  const byDepth=(pattern)=>entries.filter(x=>pattern.test(x.name)).sort((a,b)=>a.name.split('/').length-b.name.split('/').length)[0]
  const fullManifestEntry=byDepth(/(^|\/)al-sistemas\.json$/i)
  const incrementalManifestEntry=byDepth(/(^|\/)al-update\.json$/i)
  const manifestEntry=incrementalManifestEntry||fullManifestEntry
  if(!manifestEntry)throw new Error('Não foi possível identificar este pacote como uma atualização do AL Sistemas.')
  const manifest=JSON.parse(await manifestEntry.async('string'))
  const incremental=Boolean(incrementalManifestEntry)
  if(String(manifest.product||'')!=='AL Sistemas')throw new Error('O pacote não foi identificado como AL Sistemas.')
  if(incremental&&manifest.packageType!=='incremental')throw new Error('O manifesto incremental é inválido.')
  let changelog=Array.isArray(manifest.changelog)?manifest.changelog.map(String).filter(Boolean):releaseNotes(manifest.changelog||'')
  if(!changelog.length){
    const changeEntry=byDepth(/(^|\/)CHANGELOG\.md$/i)
    if(changeEntry)changelog=releaseNotes(await changeEntry.async('string')).slice(0,12)
  }
  const names=entries.map(x=>x.name.replace(/^\.\//,''))
  const modules=[]
  if(names.some(x=>/(^|\/)frontend\//.test(x)))modules.push('Frontend')
  if(names.some(x=>/(^|\/)backend\//.test(x)))modules.push('Backend')
  if(names.some(x=>/(^|\/)backend\/migrations\//.test(x)))modules.push('Migrações')
  if(names.some(x=>/(^|\/)(scripts?|setup)\//i.test(x)))modules.push('Setup / Scripts')
  return {
    version:String(manifest.version||''),
    baseVersion:incremental?String(manifest.baseVersion||''):null,
    product:String(manifest.product||'AL Sistemas'),
    packageType:incremental?'incremental':'full',
    packageFormat:manifest.packageFormat,
    changelog,manifestPath:manifestEntry.name,fileCount:entries.length,modules,
  }
}

export default function AdminAtualizacoes(){
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[uploading,setUploading]=useState(false),[uploadProgress,setUploadProgress]=useState(0),[file,setFile]=useState(null),[packagePreview,setPackagePreview]=useState(null),[job,setJob]=useState(null),[confirmAction,setConfirmAction]=useState(null)
  const [githubPublish,setGithubPublish]=useState(null),[ephemeralStage,setEphemeralStage]=useState(null),[engineTest,setEngineTest]=useState(null),[diagnostics,setDiagnostics]=useState(null),[systemTest,setSystemTest]=useState(null),[uiPanel,setUiPanel]=useState(null)
  const [wizardStep,setWizardStep]=useState(0),[wizardStage,setWizardStage]=useState(null),[wizardPreflight,setWizardPreflight]=useState(null),[wizardBusy,setWizardBusy]=useState(false)
  const poll=useRef(null)
  const packageInput=useRef(null)
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
  useEffect(()=>{
    const managed=['vercel','render'].includes(data?.updateCapabilities?.environment)
    const pending=(data?.staged||[]).find(x=>x.status==='deploying'&&x.commitSha)
    if(managed&&pending&&!job)watchCloudRelease(pending.id)
  },[data?.updateCapabilities?.environment,data?.staged?.[0]?.id,data?.staged?.[0]?.status])
  useEffect(()=>{
    if(!data)return
    const params=new URLSearchParams(window.location.search)
    const acao=params.get('acao')
    if(!['publicar','nova'].includes(acao))return
    params.delete('acao')
    const qs=params.toString()
    window.history.replaceState({},document.title,`${window.location.pathname}${qs?`?${qs}`:''}${window.location.hash||''}`)
    if(acao==='nova'){setWizardStep(0);setWizardStage(null);setWizardPreflight(null);setUiPanel('upload')}
    else openGithubPublish(null)
  },[data])
  async function selectPackage(nextFile){
    setFile(nextFile||null);setUploadProgress(0);setPackagePreview(null)
    if(!nextFile)return
    setPackagePreview({loading:true})
    try{
      const info=await inspectUpdatePackage(nextFile)
      setPackagePreview({...info,loading:false,error:'',relation:compareVersions(info.version,data?.installed?.version||'0.0.0')})
    }catch(e){
      setPackagePreview({loading:false,error:e.message,version:'',changelog:[],relation:null})
    }
  }
  async function prepare(){
    if(!file)return toast.error('Selecione um pacote .zip.')
    setUploading(true);setWizardBusy(true);setUploadProgress(0)
    try{
      const r=await updatesService.preparar(file,p=>setUploadProgress(p))
      const prepared=r.update
      const managed=['vercel','render'].includes(data?.updateCapabilities?.environment)
      setWizardStage(prepared)
      if(r.ephemeral)setEphemeralStage(prepared);else setEphemeralStage(null)
      if(managed){
        setWizardPreflight(null)
        await load({silent:true})
        setWizardStep(1)
      }else{
        const pre=await updatesService.preflight(prepared.id)
        setWizardPreflight(pre.preflight)
        await load({silent:true})
        setWizardStep(1)
      }
    }catch(e){toast.error(e.message)}finally{setUploading(false);setWizardBusy(false)}
  }
  function resetUpdateWizard(){
    if(wizardBusy||uploading)return
    setUiPanel(null);setWizardStep(0);setWizardStage(null);setWizardPreflight(null);setFile(null);setPackagePreview(null);setUploadProgress(0)
  }
  async function startWizardInstall(){
    if(!wizardStage?.id)return toast.error('Pacote preparado não encontrado.')
    if(!wizardPreflight?.ok)return toast.error(wizardPreflight?.repair?.noChanges?'Esta versão já está íntegra; não há nada para reaplicar.':'O pré-check ainda possui bloqueios.')
    setWizardBusy(true)
    try{
      const config={frontendUrl:window.location.origin,returnPath:'/admin/atualizacoes',snapshotRetention:3,maintenanceMode:true}
      const r=await updatesService.instalar(wizardStage.id,config)
      localStorage.setItem('als:last-update-job',r.job.id)
      setUiPanel(null);setWizardStep(0);setWizardStage(null);setWizardPreflight(null);setFile(null);setPackagePreview(null)
      setJob(r.job);watch(r.job.id)
      toast.success(wizardPreflight?.repair?.sameVersion?'Reparo da mesma versão iniciado.':'Atualização iniciada.')
    }catch(e){toast.error(e.message)}finally{setWizardBusy(false)}
  }
  async function advanceWizard(){
    const managed=['vercel','render'].includes(data?.updateCapabilities?.environment)
    if(wizardStep===1){setWizardStep(2);return}
    if(wizardStep!==2)return
    if(managed){
      const stage=wizardStage
      setUiPanel(null)
      await openGithubPublish(stage)
      return
    }
    await startWizardInstall()
  }
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
            toast.success('Atualização concluída. Confira o resumo e toque em Fechar.',{duration:3000})
          }else if(r.job.status==='completed'&&r.job.type==='github-publish'){
          }
          return
        }
      }catch{ /* o próximo ciclo tenta novamente sem gerar toast em cascata */ }
      if(mounted.current&&seq===watchSeq.current) poll.current=setTimeout(pollOnce,2000)
    }
    pollOnce()
  }
  function watchCloudRelease(releaseId){
    clearTimeout(poll.current)
    const seq=++watchSeq.current
    const pollOnce=async()=>{
      if(!mounted.current||seq!==watchSeq.current)return
      try{
        const r=await updatesService.cloudReleaseStatus(releaseId)
        const rel=r.release
        if(!mounted.current||seq!==watchSeq.current)return
        const vc=String(rel.vercel?.status||'waiting')
        const rd=String(rel.render?.status||'waiting')
        const failed=['deploy-failed','deploy-blocked','failed'].includes(rel.status)
        const attention=['publish-stalled','deploy-stalled','deploy-target-mismatch','interrupted'].includes(rel.status)
        const vcReady=vc==='READY'
        const rdReady=['live','succeeded','deployed'].includes(rd.toLowerCase())
        const vcWorking=['BUILDING','QUEUED','INITIALIZING','PENDING'].includes(vc)
        const rdWorking=/build|progress|queued|pending|update|create/i.test(rd)
        const publishing=rel.status==='publishing'&&!rel.commitSha
        const publishProgress=Math.max(0,Math.min(100,Number(rel.publishJob?.progress||0)))
        const cloudProgress=rel.productionReady?100:(failed||attention)?100:publishing?Math.min(49,25+Math.round(publishProgress*.24)):Math.min(96,50+(vcReady?25:vcWorking?12:0)+(rdReady?25:rdWorking?12:0))
        setJob(j=>({
          ...(j||{}),id:`cloud_${releaseId}`,type:'cloud-release',releaseId,version:rel.version||j?.version,
          status:rel.productionReady?'completed':failed?'failed':attention?'attention':'running',
          phase:rel.productionReady?'completed':failed?'failed':attention?'attention':publishing?'github-publish':'platform-deploy',
          phaseLabel:rel.productionReady?'Produção atualizada':rel.status==='deploy-target-mismatch'?'Destino de produção incorreto':rel.status==='deploy-stalled'?'Acompanhamento pausado':rel.status==='publish-stalled'?'Publicação interrompida':rel.status==='interrupted'?'Acompanhamento encerrado':rel.status==='deploy-blocked'?'Produção precisa ser vinculada':failed?'Falha em um deploy':publishing?(rel.publishJob?.phaseLabel||'Publicando no GitHub'):'Aguardando Vercel e Render',
          progress:cloudProgress,
          commitSha:rel.commitSha,commitUrl:rel.commitUrl,error:rel.error||'',
          cloudRelease:rel,
        }))
        if(rel.productionReady){await load({silent:true});return}
        if(failed||attention){await load({silent:true});return}
      }catch{/* tenta novamente enquanto as plataformas convergem */}
      if(mounted.current&&seq===watchSeq.current)poll.current=setTimeout(pollOnce,5000)
    }
    pollOnce()
  }

  async function reconcileCloudRelease(releaseId){
    try{
      const r=await updatesService.reconcileCloudRelease(releaseId)
      setJob(j=>({...j,cloudRelease:r.release,error:r.release?.error||'',status:r.release?.productionReady?'completed':['deploying','publishing'].includes(r.release?.status)?'running':'attention'}))
      await load({silent:true})
      if(['deploying','publishing'].includes(r.release?.status))watchCloudRelease(releaseId)
    }catch(e){toast.error(e.message)}
  }
  async function retryCloudRelease(releaseId){
    try{
      const r=await updatesService.retryCloudDeploy(releaseId)
      setJob(j=>({...j,cloudRelease:r.release,error:'',status:'running',phase:'platform-deploy',phaseLabel:'Reconsultando Vercel e Render'}))
      await load({silent:true});watchCloudRelease(releaseId)
    }catch(e){toast.error(e.message)}
  }
  async function interruptCloudRelease(releaseId){
    if(!await confirmAction('Encerrar somente o acompanhamento desta publicação? O ZIP continuará guardado no R2 e poderá ser publicado novamente.',{title:'Encerrar acompanhamento',confirmLabel:'Encerrar',variant:'warning'}))return
    try{
      const r=await updatesService.interruptCloudRelease(releaseId,'Acompanhamento encerrado pelo usuário. O pacote permanece no R2.')
      setJob(j=>({...j,cloudRelease:r.release,status:'attention',phase:'attention',phaseLabel:'Acompanhamento encerrado',error:r.release?.error||''}))
      await load({silent:true})
    }catch(e){toast.error(e.message)}
  }
  async function republishCloudRelease(releaseId){
    const rel=(data?.staged||[]).find(x=>x.id===releaseId)||(job?.cloudRelease?.id===releaseId?job.cloudRelease:null)
    if(!rel)return toast.error('Release não encontrada. Atualize a Central e tente novamente.')
    setJob(null)
    await openGithubPublish(rel)
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
  function deletePrepared(s){ setConfirmAction({type:'delete-stage',item:s,title:`Excluir pacote ${s.version}?`,message:s.cloudStored?'Remove o ZIP desta versão do R2 e o registro de preparação. A produção atual não será alterada.':'Remove somente esta versão preparada do staging. A instalação atual não será alterada.'}) }
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
      setJob(r.job)
      watch(r.job.id)
      if(r.monitorUrl){
        toast('Monitor independente de recuperação está ativo em paralelo. O progresso principal permanece centralizado nesta tela.',{duration:3500})
      }
    }catch(e){toast.error(e.message)}
  }
  async function recoverActive(){
    if(!data?.activeOperation?.jobId)return
    const ok=await confirmAction('Interromper a operação ativa e iniciar a recuperação automática pelo snapshot? Use somente quando a atualização estiver travada.',{title:'Recuperação automática',confirmLabel:'Iniciar recuperação',variant:'warning'})
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
    setGithubPublish({stage:s,sourceType,loading:true,repositories:[],repository:'',branch:'main',publishMode:'project',error:null,deploymentCheck:null,checking:false,productionTarget:null,targetLocked:false})
    try{
      const d=await updatesService.githubRepos()
      const repos=d.repositories||[]
      const managed=['vercel','render'].includes(data?.updateCapabilities?.environment)
      let target=null,targetError=''
      if(managed){
        try{target=await updatesService.productionTarget()}catch(e){targetError=e.message||'Não foi possível determinar o destino de produção.'}
      }
      let selected=null,branch='main',targetLocked=false,error=''
      if(managed){
        if(target?.repository){
          selected=repos.find(r=>String(r.fullName).toLowerCase()===String(target.repository).toLowerCase())||null
          branch=target.branch||selected?.defaultBranch||'main'
          targetLocked=Boolean(selected)
          if(!selected)error=`O repositório de produção ${target.repository} não está acessível pelo token GitHub atual.`
        }else error=targetError||target?.message||'Vincule Vercel/Render a um repositório antes de publicar uma atualização.'
      }else{
        const preferred=d.preferences?.repository||''
        selected=repos.find(r=>r.fullName===preferred)||repos[0]||null
        branch=selected?.defaultBranch||d.preferences?.branch||'main'
      }
      if(!repos.length)error='Nenhum repositório acessível por este token.'
      setGithubPublish({
        stage:s,sourceType,loading:false,repositories:repos,
        repository:selected?.fullName||'',branch,publishMode:'project',error,
        deploymentCheck:null,checking:false,productionTarget:target,targetLocked,
      })
    }catch(e){
      setGithubPublish({stage:s,sourceType,loading:false,repositories:[],repository:'',branch:'main',publishMode:'project',error:e.message,deploymentCheck:null,checking:false,productionTarget:null,targetLocked:false})
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
    if(checked?.github?.targetMismatch)return toast.error(checked.github.message||'O destino não corresponde ao repositório de produção.')
    if(!checked?.github?.writable)return toast.error('O token do GitHub não tem permissão de escrita neste repositório.')
    if(!checked?.github?.branchExists){
      if(!checked?.github?.branchWillBeCreated)return toast.error('O GitHub não autorizou a criação desta branch. Revise o repositório e o token.')
    }
    const cfg={repository:githubPublish.repository,branch:githubPublish.branch,publishMode:githubPublish.publishMode}
    const stage=githubPublish.stage
    const sourceType=githubPublish.sourceType||'package'
    setGithubPublish(g=>({...g,submitting:true}))
    try{
      const directManaged=['vercel','render'].includes(data?.updateCapabilities?.environment)
      if(directManaged){
        if(!stage?.id)throw new Error('Envie o pacote em Nova versão primeiro.')
        // Compatibilidade de rolling deploy: se o frontend 1.0.88 entrar no ar
        // alguns instantes antes do backend 1.0.88, o backend antigo ainda
        // devolve estágio efêmero. Assim a migração para R2 não fica travada.
        if(!stage.cloudStored&&file){
          const r=await updatesService.publicarGitHubDireto(file,cfg)
          setGithubPublish(null)
          setJob(r.job)
          setEphemeralStage(null)
          setFile(null)
          await load({silent:true})
          return
        }
        if(!stage.cloudStored)throw new Error('Este pacote não está persistido no R2. Reenvie o ZIP depois que o backend 1.0.88 ou superior estiver ativo.')
        setGithubPublish(null)
        setJob({
          id:`cloud_${stage.id}`,type:'cloud-release',releaseId:stage.id,status:'running',
          phase:'github-publish',phaseLabel:'Preparando commit no GitHub',progress:32,
          version:stage.version,filename:stage.filename,bucket:stage.bucket,objectKey:stage.objectKey,
          timeline:[
            {key:'r2-stored',label:'Pacote validado e salvo no R2',progress:20,at:new Date().toISOString()},
            {key:'github-publish',label:'Preparando commit no GitHub',progress:32,at:new Date().toISOString()},
          ],
        })
        const r=await updatesService.publicarGitHub(stage.id,cfg)
        setJob(r.job)
        setEphemeralStage(null)
        setFile(null)
        if(r.release?.productionReady)await load({silent:true})
        else watchCloudRelease(stage.id)
      }else{
        const r=sourceType==='installed'
          ? await updatesService.publicarAtualGitHub(cfg)
          : await updatesService.publicarGitHub(stage.id,cfg)
        setGithubPublish(null)
        watch(r.job.id,'github-publish')
      }
    }catch(e){
      if(['vercel','render'].includes(data?.updateCapabilities?.environment)){
        setJob(j=>({...j,status:'failed',phase:'failed',phaseLabel:'Falha na publicação',progress:100,error:e.message,timeline:[...(j?.timeline||[]),{key:'failed',label:'Falha na publicação',progress:100,at:new Date().toISOString()}]}))
      }else{
        setGithubPublish(g=>({...g,submitting:false,error:e.message}))
      }
    }
  }
  const serverless=data?.updateCapabilities?.environment==='vercel'
  const managedHost=['vercel','render'].includes(data?.updateCapabilities?.environment)
  const activeOperation=data?.activeOperation||null
  const stagedPackages=ephemeralStage?[ephemeralStage,...(data?.staged||[])]:data?.staged||[]
  const publishablePackage=stagedPackages.find(s=>['ready','failed','publish-stalled','deploy-stalled','deploy-target-mismatch','deploy-failed','deploy-blocked','interrupted'].includes(s.status||'ready'))||null
  if(loading)return <div className="adm-page" style={{color:C.muted}}>Carregando atualizações…</div>
  return <div className="adm-page updates-hub" style={{display:'grid',gap:14}}>
    <div className="updates-hero">
      <div>
        <div className="updates-kicker">CENTRAL DE ATUALIZAÇÕES</div>
        <h1 style={{margin:0,color:C.text,fontSize:22}}>AL Sistemas <span style={{color:C.greenSolid}}>v{data?.installed?.version||'—'}</span></h1>
        <p style={{color:C.muted,margin:'6px 0 0',fontSize:13,lineHeight:1.5}}>Atualização, publicação, diagnóstico e recuperação em uma única central. Os detalhes abrem em painéis próprios para manter esta tela curta.</p>
      </div>
      <div className={`updates-status-pill ${data?.installed?.synchronized?'ok':'warn'}`}>{data?.installed?.synchronized?'● Sistema sincronizado':'● Versões divergentes'}</div>
    </div>

    {activeOperation&&<div className="updates-alert updates-alert-warn">
      <div><b>🔒 Atualizador ocupado</b><span>Job {activeOperation.jobId}</span></div>
      {!managedHost&&<button onClick={recoverActive}>Recuperar</button>}
    </div>}
    {managedHost&&<div className={`updates-alert ${data?.cloudStorage?.ok?'updates-alert-info':'updates-alert-warn'}`}><div><b>☁️ {data?.runtime?.environment} · {data?.cloudStorage?.ok?'R2 conectado':'R2 precisa de configuração'}</b><span>{data?.cloudStorage?.ok?`Produção cloud: ZIP → R2 (${data.cloudStorage.bucket}) → GitHub → Vercel + Render.`:(data?.cloudStorage?.error||'Configure o R2 em Integrações e APIs antes de enviar uma nova versão.')}</span></div></div>}

    <div className="updates-command-grid">
      <button className="updates-command updates-command-primary" onClick={()=>{setWizardStep(0);setWizardStage(null);setWizardPreflight(null);setFile(null);setPackagePreview(null);setUploadProgress(0);setUiPanel('upload')}}>
        <span className="updates-command-icon">⬆</span><span><b>Nova versão</b><small>Enviar ZIP e validar</small></span>
      </button>
      {!managedHost&&<button className="updates-command updates-command-install" disabled={Boolean(activeOperation)} onClick={()=>setUiPanel('packages')}>
        <span className="updates-command-icon">▶</span><span><b>Instalar</b><small>{stagedPackages.length?`${stagedPackages.length} versão(ões) pronta(s)`:'nenhuma versão preparada'}</small></span>
      </button>}
      <button className="updates-command" disabled={Boolean(activeOperation)} onClick={()=>managedHost&&!stagedPackages.length?setUiPanel('upload'):managedHost&&!publishablePackage?setUiPanel('packages'):openGithubPublish(managedHost?publishablePackage:null)}>
        <span className="updates-command-icon">⌁</span><span><b>Publicar</b><small>{managedHost&&publishablePackage?'R2 → GitHub → produção':managedHost&&stagedPackages.length?'deploy em acompanhamento':'GitHub / deploy'}</small></span>
      </button>
      <button className="updates-command" onClick={()=>setUiPanel('environment')}>
        <span className="updates-command-icon">◉</span><span><b>Ambiente</b><small>{data?.runtime?.environment||'Servidor'} · {diagnostics?.loading?'verificando':diagnostics?.ok?'pronto':'atenção'}</small></span>
      </button>
      {!managedHost&&<button className="updates-command" onClick={()=>setUiPanel('selftest')}>
        <span className="updates-command-icon">✓</span><span><b>Autoteste</b><small>{systemTest?.loading?'executando':systemTest?`${systemTest.score??'—'}% de saúde`:'verificar instalação'}</small></span>
      </button>}
      {!managedHost&&<button className="updates-command" onClick={()=>setUiPanel('snapshots')}>
        <span className="updates-command-icon">↶</span><span><b>Snapshots</b><small>{data?.snapshots?.length||0} ponto(s) de retorno</small></span>
      </button>}
      <button className="updates-command" onClick={()=>setUiPanel('history')}>
        <span className="updates-command-icon">≡</span><span><b>Histórico</b><small>{data?.history?.length||0} operação(ões)</small></span>
      </button>
      {!managedHost&&<button className="updates-command" onClick={()=>setUiPanel('recovery')}>
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

    {job&&!['github-publish','cloud-release'].includes(job.type)&&<UpdateProgressModal job={job} onClose={()=>{if(['completed','failed','restart-required','rolled-back'].includes(job.status)){const reload=job.status==='completed';setJob(null);if(reload)window.location.reload()}}}/>}
    {job&&['github-publish','cloud-release'].includes(job.type)&&<PublishProgressModal job={job} onClose={()=>{if(['completed','failed','attention','restart-required','rolled-back'].includes(job.status))setJob(null)}} onReconcile={reconcileCloudRelease} onRetry={retryCloudRelease} onRepublish={republishCloudRelease} onInterrupt={interruptCloudRelease}/>}

    {uiPanel==='upload'&&<PanelModal kicker="ATUALIZAÇÃO GUIADA" title={wizardStep===0?'Selecionar pacote':wizardStep===1?'Revisar atualização':'Proteção e instalação'} onClose={resetUpdateWizard} wide>
      <UpdateWizardSteps step={wizardStep} managed={managedHost}/>
      {wizardStep===0&&<>
        <p className="updates-panel-copy">Escolha o ZIP. Primeiro fazemos upload e validação; nenhum arquivo é alterado antes da revisão e da etapa de proteção.</p>
        <input ref={packageInput} className="updates-file-input-hidden" type="file" accept=".zip" onChange={e=>{void selectPackage(e.target.files?.[0]||null);e.target.value=''}}/>
        <button type="button" className="updates-wizard-drop" disabled={uploading} onClick={()=>packageInput.current?.click()}>
          <span className="updates-wizard-drop-icon">📦</span>
          <span><b>{file?file.name:'Selecionar pacote .zip'}</b><small>{file?`${bytes(file.size)} · toque para trocar`:'O nome do arquivo é livre; o conteúdo identifica a atualização'}</small></span>
        </button>
        {file&&<div className={`updates-wizard-package ${packagePreview?.relation<0?'bad':packagePreview?.relation===0?'repair':''}`}>
          <div className="updates-wizard-version"><small>VERSÃO</small><strong>{data?.installed?.version||'—'} <span>→</span> {packagePreview?.loading?'…':packagePreview?.version||'?'}</strong></div>
          <div className="updates-wizard-mini-grid">
            <MiniStat label="Arquivos" value={packagePreview?.fileCount??'—'}/>
            <MiniStat label="Módulos" value={packagePreview?.modules?.length?packagePreview.modules.join(' · '):'analisando'}/>
          </div>
          {packagePreview?.relation===0&&<div className="updates-repair-note"><b>↻ Reaplicação permitida</b><span>A versão do pacote é a mesma registrada. O backend fará comparação SHA-256 arquivo por arquivo e só continuará se encontrar diferenças reais ou dependências para reparar.</span></div>}
          {packagePreview?.relation<0&&<div className="updates-wizard-error">Versões anteriores continuam bloqueadas para evitar downgrade acidental.</div>}
          {packagePreview?.error&&<div className="updates-wizard-warning">Manifesto local: {packagePreview.error} A validação oficial será feita no servidor.</div>}
        </div>}
        {uploading&&<div className="updates-upload-progress"><div className="updates-upload-progress-head"><b>{uploadProgress<100?'Enviando pacote':'Validando pacote'}</b><span>{uploadProgress}%</span></div><div className="updates-upload-track"><i style={{width:`${uploadProgress}%`}}/></div><small>{uploadProgress<100?`${bytes(Math.round((file?.size||0)*(uploadProgress/100)))} de ${bytes(file?.size||0)}`:(managedHost?'Validando estrutura e preservando no R2…':'Validando estrutura e criando staging isolado…')}</small></div>}
        <div className="updates-wizard-footer"><span>1 de 5 · pacote</span><button className="updates-primary-action" disabled={uploading||!file||packagePreview?.loading||packagePreview?.relation<0} onClick={prepare}>{uploading?'Processando…':'Enviar e analisar'}</button></div>
      </>}
      {wizardStep===1&&<>
        <div className="updates-wizard-review-head">
          <div><small>PACOTE VALIDADO</small><h3>{data?.installed?.version||'—'} <span>→</span> {wizardStage?.version||packagePreview?.version||'—'}</h3></div>
          <span className={`updates-review-badge ${wizardPreflight?.repair?.sameVersion?'repair':'ok'}`}>{wizardPreflight?.repair?.sameVersion?'MODO REPARO':'VALIDADO'}</span>
        </div>
        <div className="updates-wizard-mini-grid updates-wizard-mini-grid-4">
          <MiniStat label="Arquivos no pacote" value={wizardStage?.integrity?.fileCount||packagePreview?.fileCount||'—'}/>
          <MiniStat label="Tamanho" value={bytes(wizardStage?.integrity?.totalBytes||wizardStage?.packageBytes||file?.size)}/>
          <MiniStat label="Migrações" value={wizardPreflight?.migrations?.count??wizardStage?.migrations?.length??0}/>
          <MiniStat label="Tipo" value={wizardStage?.packageType==='incremental'?'Incremental':'Completo'}/>
        </div>
        {!managedHost&&wizardPreflight&&<PreflightSummary data={wizardPreflight} compact/>}
        {managedHost&&<div className="updates-managed-review">
          <b>Revisão de produção</b><span>O pacote foi validado sem substituir a instância atual. A próxima etapa confirma a cópia persistente no R2 antes de abrir o envio ao GitHub.</span>
          {!!packagePreview?.modules?.length&&<div className="updates-module-pills">{packagePreview.modules.map(x=><span key={x}>{x}</span>)}</div>}
        </div>}
        {!!packagePreview?.changelog?.length&&<details className="updates-wizard-notes"><summary>O que mudou · {packagePreview.changelog.length} item(ns)</summary><ul>{packagePreview.changelog.slice(0,10).map((x,i)=><li key={i}>{x}</li>)}</ul></details>}
        <div className="updates-wizard-footer"><button onClick={()=>setWizardStep(0)} disabled={wizardBusy}>Voltar</button><span>2 de 5 · revisão</span><button className="updates-primary-action" disabled={wizardBusy||(!managedHost&&(!wizardPreflight?.ok||wizardPreflight?.repair?.noChanges))} onClick={advanceWizard}>Avançar</button></div>
      </>}
      {wizardStep===2&&<>
        <div className="updates-protection-card">
          <div className="updates-protection-icon">{managedHost?'R2':'↶'}</div>
          <div><small>{managedHost?'SNAPSHOT R2':'SNAPSHOT DE SEGURANÇA'}</small><h3>{managedHost?'Pacote preservado antes da publicação':'Backup automático antes de alterar arquivos'}</h3><p>{managedHost?'O ZIP validado fica no R2 e pode ser republicado mesmo que navegador, Render ou Vercel reiniciem.':'O worker cria e verifica um snapshot da instalação atual. Se uma etapa crítica falhar, o rollback automático usa este ponto de retorno.'}</p></div>
        </div>
        <div className="updates-wizard-mini-grid">
          {managedHost?<><MiniStat label="Bucket" value={wizardStage?.bucket||data?.cloudStorage?.bucket||'—'}/><MiniStat label="Objeto" value={wizardStage?.objectKey||'armazenado no R2'}/></>:<><MiniStat label="Backup estimado" value={bytes(wizardPreflight?.disk?.estimatedBackupBytes)}/><MiniStat label="Espaço livre" value={bytes(wizardPreflight?.disk?.freeBytes)}/></>}
        </div>
        {!managedHost&&wizardPreflight?.repair?.sameVersion&&<div className="updates-repair-note"><b>↻ Reparo da mesma versão</b><span>{wizardPreflight.files.operations} operação(ões) de arquivo foram identificadas. A versão só será reaplicada nesses pontos; arquivos iguais não serão regravados.</span></div>}
        <div className="updates-wizard-footer"><button onClick={()=>setWizardStep(1)} disabled={wizardBusy}>Voltar</button><span>3 de 5 · proteção</span><button className="updates-primary-action" disabled={wizardBusy} onClick={advanceWizard}>{managedHost?'Avançar para GitHub':'Criar snapshot e instalar'}</button></div>
      </>}
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
      {!managedHost&&<>
        <div className="updates-panel-section">
          <div className="updates-panel-head"><div><b>Diagnóstico do atualizador</b><small>{diagnostics?.loading?'Verificando permissões, recuperação e armazenamento…':diagnostics?.ok?'Ambiente pronto para atualizações protegidas.':diagnostics?'Existem bloqueios que precisam de atenção.':'Ainda não verificado.'}</small></div><button onClick={()=>runDiagnostics(true)} disabled={diagnostics?.loading||Boolean(activeOperation)}>{diagnostics?.loading?'Verificando…':'Verificar novamente'}</button></div>
          {!!diagnostics?.checks?.length&&<div className="updates-check-grid">{diagnostics.checks.map(c=><div key={c.id} className={`updates-check ${c.ok?'ok':'bad'}`}><b>{c.ok?'✓':'✕'} {c.label}</b>{c.detail!==undefined&&c.detail!==null&&<span>{typeof c.detail==='number'?bytes(c.detail):String(c.detail)}</span>}</div>)}</div>}
          {!!diagnostics?.warnings?.length&&<div className="updates-warnings">{diagnostics.warnings.map((w,i)=><div key={i}>⚠ {w}</div>)}</div>}
        </div>
        <div className="updates-panel-actions"><button onClick={runEngineSelfTest} disabled={engineTest?.loading||Boolean(activeOperation)}>{engineTest?.loading?'Testando recuperação…':'Autoteste do motor'}</button>{engineTest&&!engineTest.loading&&<span className={engineTest.ok?'good':'bad-text'}>{engineTest.ok?`✓ ${engineTest.checks?.length||0} verificações aprovadas`:`✕ ${engineTest.error||'falha detectada'}`}</span>}</div>
      </>}
    </PanelModal>}

    {uiPanel==='selftest'&&!managedHost&&<PanelModal kicker="AUTOTESTE" title="Saúde da instalação" onClose={()=>setUiPanel(null)} wide>
      <p className="updates-panel-copy">Confere backend, MongoDB, versões, arquivos essenciais, gravação, health check, RSS, portal e integrações conectadas sem alterar dados.</p>
      <div className="updates-panel-actions"><button className="primary-green" onClick={runSystemSelfTest} disabled={systemTest?.loading||Boolean(activeOperation)}>{systemTest?.loading?'Executando testes…':'Executar autoteste completo'}</button>{systemTest&&!systemTest.loading&&<button onClick={copySystemTest}>📋 Copiar diagnóstico</button>}</div>
      {systemTest?.loading&&<div className="updates-loading-panel">Executando verificações da instalação…</div>}
      {systemTest&&!systemTest.loading&&<div className={`updates-health ${systemTest.ok?'ok':'bad'}`}>
        <div className="updates-health-head"><div><b>{systemTest.ok?'✓ Instalação saudável':'✕ Instalação precisa de atenção'}</b><span>Pontuação {systemTest.score??'—'}% · {systemTest.summary?.passed||0} aprovados · {systemTest.summary?.warnings||0} avisos · {systemTest.summary?.failed||0} falhas</span></div></div>
        {!!systemTest.error&&<div className="bad-text">{systemTest.error}</div>}
        {!!systemTest.checks?.length&&<div className="updates-check-grid">{systemTest.checks.map(c=><div key={c.id} className={`updates-check ${c.status==='pass'?'ok':c.status==='warn'?'warn':c.status==='skip'?'':'bad'}`}><b>{c.status==='pass'?'✓':c.status==='skip'?'○':c.status==='warn'?'⚠':'✕'} {c.label}</b><span>{typeof c.detail==='string'?c.detail:JSON.stringify(c.detail)}</span>{c.durationMs>0&&<em>{c.durationMs} ms</em>}</div>)}</div>}
      </div>}
    </PanelModal>}

    {uiPanel==='packages'&&<PanelModal kicker="VERSÕES PRONTAS" title={`${managedHost?'Pacotes no R2':'Preparadas para instalar'} · ${stagedPackages.length}`} onClose={()=>setUiPanel(null)} wide>
      <p className="updates-panel-copy">{managedHost?'Cada ZIP validado fica persistido no R2. Você pode publicar qualquer versão preparada no GitHub e acompanhar Vercel + Render sem manter o navegador aberto.':'Cada versão fica isolada até você decidir instalar ou excluir.'}</p>
      {!stagedPackages.length?<div className="updates-empty">Nenhuma versão preparada. Envie um ZIP em <b>Nova versão</b>; quando a validação terminar, a simulação da instalação abrirá automaticamente.</div>:stagedPackages.map((s,index)=>{
        const notes=releaseNotes(s.changelog)
        const dependencyState=[
          s.dependencies?.backend?.installRequired?'backend requer ação':'backend íntegro',
          s.dependencies?.frontend?.installRequired?'frontend requer ação':'frontend íntegro',
        ]
        return <article key={s.id} className={`updates-release-card ${index===0?'latest':''}`}>
          <div className="updates-release-top">
            <div className="updates-release-version"><span>AL</span><div><small>{index===0?'MAIS RECENTE':'VERSÃO PREPARADA'}</small><strong>v{s.version}</strong></div></div>
            <span className="updates-release-ready">● {s.status==='deploying'?'EM DEPLOY':s.status==='publishing'?'PUBLICANDO':s.status==='deploy-blocked'?'AGUARDANDO VÍNCULO':s.status==='deploy-failed'||s.status==='failed'?'REQUER ATENÇÃO':managedHost?'NO R2':'PRONTA'}</span>
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
            {notes.length>5&&<div className="updates-release-more updates-release-more-static"><div className="updates-release-more-title">Changelog completo</div><pre>{s.changelog}</pre></div>}
          </section>
          <div className="updates-release-health">
            <span>✓ {dependencyState[0]}</span><span>✓ {dependencyState[1]}</span><span>✓ integridade validada</span>
          </div>
          <div className="updates-release-actions">
            {!managedHost&&<button className="updates-install-action" disabled={Boolean(activeOperation)} onClick={()=>install(s)}>Simular e instalar</button>}
            {managedHost&&((s.status==='deploying'||s.status==='publishing')?<button className="updates-install-action" onClick={()=>watchCloudRelease(s.id)}>Acompanhar produção</button>:['publish-stalled','deploy-stalled','deploy-target-mismatch','deploy-blocked','deploy-failed','interrupted'].includes(s.status)?<><button className="updates-install-action" onClick={()=>reconcileCloudRelease(s.id)}>Reconsultar</button><button onClick={()=>openGithubPublish(s)}>Publicar novamente</button></>:<button className="updates-install-action" onClick={()=>openGithubPublish(s)}>Publicar no GitHub</button>)}
            <button className="updates-delete-action" disabled={Boolean(activeOperation)} onClick={()=>deletePrepared(s)}>Excluir versão</button>
          </div>
        </article>
      })}
    </PanelModal>}

    {uiPanel==='snapshots'&&!managedHost&&<PanelModal kicker="ROLLBACK" title="Snapshots disponíveis" onClose={()=>setUiPanel(null)}>
      <p className="updates-panel-copy">Retenção automática: os {data?.updateCapabilities?.snapshotRetention||3} snapshots mais recentes são mantidos.</p>
      {!data?.snapshots?.length?<div className="updates-empty">Nenhum snapshot criado ainda.</div>:data.snapshots.map(s=><div key={s.id} className="updates-list-row"><div><b>v{s.version}</b><small>{fmt(s.createdAt)}{s.safe===false?' · rollback manual indisponível':''}</small></div><div className="updates-row-actions"><button disabled={s.safe===false||Boolean(activeOperation)} onClick={()=>rollback(s)}>Rollback</button><button className="updates-delete-action" disabled={Boolean(activeOperation)} onClick={()=>deleteSnapshotItem(s)}>Excluir</button></div></div>)}
    </PanelModal>}

    {uiPanel==='history'&&<PanelModal kicker="HISTÓRICO" title="Operações recentes" onClose={()=>setUiPanel(null)} wide>
      {!data?.history?.length?<div className="updates-empty">Sem atualizações registradas.</div>:data.history.map(h=><div key={h.id} className="updates-history-row"><div><b>{h.type==='rollback'?'Rollback':h.type==='github-publish'?'GitHub':h.type==='cloud-release'?'Cloud':h.type==='recovery'?'Recuperação':'Atualização'} {h.fromVersion} → {h.toVersion}</b>{h.repository&&<span>{h.repository}{h.branch?` @ ${h.branch}`:''}</span>}<small>{fmt(h.createdAt)}</small></div><span className={`updates-history-status ${['success','completed'].includes(h.status)?'ok':['rolled-back','deploy-failed','failed'].includes(h.status)?'bad':''}`}>{h.status}</span></div>)}
    </PanelModal>}

    {uiPanel==='recovery'&&!managedHost&&<PanelModal kicker="RECUPERAÇÃO" title="Reinício e emergência" onClose={()=>setUiPanel(null)}>
      <div className="updates-runtime-grid" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:10}}><MiniStat label="Estratégia" value={data?.restart?.strategy||'none'}/><MiniStat label="Gerenciador" value={data?.runtime?.processManager||'—'}/></div>
      <p className="updates-panel-copy">Use a recuperação de emergência somente se uma atualização for interrompida e o backend não voltar sozinho.</p>
      {data?.updateCapabilities?.emergencyRecoveryCommand?<><div className="updates-code-label">COMANDO DE EMERGÊNCIA</div><code className="updates-code-block">{data.updateCapabilities.emergencyRecoveryCommand}</code></>:<div className="updates-empty">Nenhum comando de recuperação foi informado para este ambiente.</div>}
    </PanelModal>}

    {githubPublish&&<div className="updates-modal-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setGithubPublish(null)}}>
      <div className="updates-modal updates-github-modal" role="dialog" aria-modal="true" aria-labelledby="github-publish-title">
        <div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:'.04em'}}>MÓDULO DE PUBLICAÇÃO · {githubPublish.sourceType==='installed'?'INSTALAÇÃO ATUAL':'PACOTE PREPARADO'}</div>
        <h2 id="github-publish-title" style={{margin:'7px 0 4px',color:C.text,fontSize:20}}>{managedHost?'R2 → GitHub → Produção':'GitHub / Deploy'}</h2>
        <p style={{margin:'0 0 16px',color:C.muted,fontSize:13,lineHeight:1.55}}>O AL Sistemas publica {githubPublish.sourceType==='installed'?<><b>a instalação atual</b> diretamente como commit no GitHub, sem ZIP.</>:<>o pacote como <b>commit no GitHub</b>.</>} {managedHost?'O ZIP validado fica persistido no R2 e não depende mais do navegador. Em produção, o GitHub vira a origem do código e a Central acompanha Vercel + Render. ':''}A publicação reutiliza as credenciais de Integrações e APIs.</p>
        {githubPublish.loading?<div style={{padding:'16px 0',color:C.muted}}>Consultando repositórios autorizados…</div>:<>
          {githubPublish.error&&<div style={{padding:11,borderRadius:9,border:`1px solid ${C.red}`,color:C.red,background:'var(--adm-surface2)',fontSize:12,marginBottom:12}}>{githubPublish.error}</div>}
          {(githubPublish.repositories||[]).length>0&&<>
            {managedHost&&githubPublish.productionTarget?.repository&&<div className="updates-target-lock"><b>Destino de produção detectado</b><span>{githubPublish.productionTarget.repository} @ {githubPublish.productionTarget.branch||'main'}</span><small>O atualizador não usa mais o repositório padrão global do GitHub. Ele publica somente no repositório realmente ligado à Vercel/Render.</small></div>}
            <label className="updates-modal-field">Repositório<select disabled={Boolean(githubPublish.targetLocked)} value={githubPublish.repository} onChange={e=>{const repo=(githubPublish.repositories||[]).find(r=>r.fullName===e.target.value);setGithubPublish(g=>({...g,repository:e.target.value,branch:repo?.defaultBranch||'main',deploymentCheck:null}))}}>{(githubPublish.repositories||[]).map(r=><option key={r.id} value={r.fullName}>{r.fullName}{r.private?' • privado':''}</option>)}</select></label>
            <label className="updates-modal-field">Branch<input disabled={Boolean(githubPublish.targetLocked)} value={githubPublish.branch} onChange={e=>setGithubPublish(g=>({...g,branch:e.target.value,deploymentCheck:null}))} placeholder="main"/></label>
            <div className="updates-panel-actions"><button onClick={()=>checkDeployment(true)} disabled={githubPublish.checking}>{githubPublish.checking?'Verificando…':'Verificar GitHub / Vercel'}</button>{githubPublish.deploymentCheck&&<span className={githubPublish.deploymentCheck.ok?'good':'bad-text'}>{githubPublish.deploymentCheck.ok?'✓ GitHub pronto':'⚠ GitHub precisa de atenção'}</span>}</div>
            {githubPublish.deploymentCheck&&<div className="updates-deploy-check"><div><b>GitHub:</b> {githubPublish.deploymentCheck.github?.writable?'escrita autorizada':'sem permissão de escrita'} · branch {githubPublish.deploymentCheck.github?.branchExists?'encontrada':githubPublish.deploymentCheck.github?.branchWillBeCreated?'será criada':'indisponível'}.</div><div><b>Vercel:</b> {githubPublish.deploymentCheck.vercel?.configured?githubPublish.deploymentCheck.vercel.message:'não configurada; a publicação continuará somente no GitHub.'}</div>{githubPublish.deploymentCheck.vercel?.projects?.map(pr=><div key={pr.id}>▲ <b>{pr.name}</b>{pr.rootDirectory?` · raiz: ${pr.rootDirectory}`:''}{pr.productionBranch?` · produção: ${pr.productionBranch}`:''}</div>)}{managedHost&&<div><b>Render:</b> {githubPublish.deploymentCheck.render?.message||'serviços vinculados ainda não verificados.'}</div>}</div>}
            <label className="updates-modal-field">{managedHost?'Publicação da versão':'Onde aplicar os arquivos do ZIP'}<select disabled={managedHost} value={managedHost?'project':githubPublish.publishMode} onChange={e=>setGithubPublish(g=>({...g,publishMode:e.target.value}))}><option value="project">Projeto completo — /backend + /frontend</option>{!managedHost&&<><option value="frontend-folder">Somente frontend — pasta /frontend</option><option value="frontend-root">Somente frontend — raiz do repositório (Vercel)</option><option value="backend-folder">Somente backend — pasta /backend</option></>}</select>{managedHost&&<small>Na produção cloud o AL mantém frontend e backend no mesmo commit para acompanhar Vercel e Render juntos.</small>}</label>
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
      .updates-file-input-hidden{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important}.updates-package-picker{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:stretch}.updates-pick-file{min-width:0;border:1px dashed var(--adm-border);background:var(--adm-surface2);color:var(--adm-text);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;text-align:left;cursor:pointer}.updates-pick-file>span:first-child{font-size:20px}.updates-pick-file>span:last-child{display:grid;gap:2px;min-width:0}.updates-pick-file b{font-size:12px}.updates-pick-file small{font-size:10px;color:var(--adm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.updates-send-package{border:1px solid #1d4ed8;border-radius:12px;padding:0 18px;background:linear-gradient(145deg,#2563eb,#1d4ed8);color:white;font-weight:900;cursor:pointer;min-height:48px;box-shadow:0 7px 18px rgba(37,99,235,.16)}.updates-send-package:disabled,.updates-pick-file:disabled{opacity:.55;cursor:not-allowed}.updates-file-selected{margin-top:10px;padding:10px 12px;border:1px solid var(--adm-border);border-radius:10px;font-size:12px;color:var(--adm-muted);overflow-wrap:anywhere;display:flex;justify-content:space-between;gap:10px;align-items:center}.updates-file-selected>span:first-child{min-width:0;display:grid;gap:2px}.updates-file-selected small{font-size:10px}.updates-file-ready{flex:0 0 auto;color:#16a34a;font-size:10px;font-weight:900}.updates-next-release{margin-top:10px;padding:13px;border:1px solid #16a34a44;border-radius:12px;background:#16a34a08}.updates-next-release.warn{border-color:#f59e0b66;background:#f59e0b08}.updates-next-release-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.updates-next-release-head>div{display:grid;gap:3px;min-width:0}.updates-next-release-head span,.updates-next-release-label{font-size:9px;font-weight:900;letter-spacing:.11em;color:var(--adm-muted)}.updates-next-release-head b{font-size:13px;color:var(--adm-text);overflow-wrap:anywhere}.updates-next-release-head strong{font-size:14px;color:#16a34a;white-space:nowrap}.updates-next-release ul{margin:9px 0 0;padding-left:18px;display:grid;gap:5px}.updates-next-release li{font-size:11px;line-height:1.45;color:var(--adm-text)}.updates-next-release small{display:block;margin-top:7px;color:var(--adm-muted);font-size:10px}.updates-next-release-label{margin-top:11px}.updates-next-release-warning{margin-top:9px;padding:8px 9px;border-radius:9px;background:#f59e0b0d;color:#b7791f;font-size:10px;line-height:1.45}.updates-upload-progress{margin-top:12px;padding:12px;border:1px solid #3b82f644;border-radius:11px;background:#3b82f608}.updates-upload-progress-head{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--adm-text)}.updates-upload-track{height:8px;border-radius:999px;background:var(--adm-surface2);overflow:hidden;margin:9px 0 7px}.updates-upload-track i{display:block;height:100%;border-radius:inherit;background:#2563eb;transition:width .2s ease}.updates-upload-progress small{font-size:10px;color:var(--adm-muted)}
      .updates-panel-section{margin-top:14px;padding-top:14px;border-top:1px solid var(--adm-border)}.updates-panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.updates-panel-head>div{display:grid;gap:3px}.updates-panel-head small{color:var(--adm-muted);font-size:11px}.updates-check-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.updates-check{border:1px solid var(--adm-border);border-radius:10px;padding:10px;font-size:11px;display:grid;gap:4px;min-width:0}.updates-check b{color:var(--adm-text)}.updates-check span{color:var(--adm-muted);overflow-wrap:anywhere}.updates-check em{font-style:normal;font-size:10px;color:var(--adm-muted)}.updates-check.ok{border-color:#16a34a55}.updates-check.bad{border-color:#ef444455}.updates-check.warn{border-color:#f59e0b55}.updates-warnings{margin-top:10px;font-size:11px;color:#f59e0b;line-height:1.5}.updates-panel-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:14px}.updates-panel-actions span{font-size:11px}.good{color:#16a34a}.bad-text{color:#ef4444}.updates-loading-panel,.updates-empty{padding:14px;border-radius:10px;background:var(--adm-surface2);border:1px solid var(--adm-border);color:var(--adm-muted);font-size:12px;margin-top:12px}
      .updates-health{margin-top:14px;border:1px solid var(--adm-border);border-radius:12px;padding:12px}.updates-health.ok{border-color:#16a34a55}.updates-health.bad{border-color:#ef444455}.updates-health-head>div{display:grid;gap:4px}.updates-health-head b{color:var(--adm-text)}.updates-health-head span{font-size:11px;color:var(--adm-muted)}
      .updates-release-card{position:relative;border:1px solid var(--adm-border);border-radius:16px;padding:16px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));box-shadow:0 10px 30px rgba(15,23,42,.04);overflow:hidden}.updates-release-card+.updates-release-card{margin-top:12px}.updates-release-card.latest{border-color:#16a34a55}.updates-release-card.latest:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#16a34a}.updates-release-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.updates-release-version{display:flex;gap:10px;align-items:center;min-width:0}.updates-release-version>span{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:var(--adm-bg);border:1px solid var(--adm-border);font-size:11px;font-weight:900;color:#16a34a}.updates-release-version>div{display:grid;gap:2px}.updates-release-version small{font-size:8px;letter-spacing:.12em;font-weight:900;color:var(--adm-muted)}.updates-release-version strong{font-size:20px;color:var(--adm-text);letter-spacing:-.03em}.updates-release-ready{font-size:9px;font-weight:900;letter-spacing:.08em;color:#16a34a;border:1px solid #16a34a44;border-radius:999px;padding:5px 7px;background:#16a34a0a}.updates-release-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.updates-release-meta span{font-size:9px;font-weight:800;color:var(--adm-muted);border:1px solid var(--adm-border);background:var(--adm-bg);border-radius:999px;padding:5px 7px}.updates-release-file{display:flex;justify-content:space-between;gap:10px;margin-top:10px;font-size:10px;color:var(--adm-muted)}.updates-release-file b{color:var(--adm-text);overflow-wrap:anywhere}.updates-release-file span{flex:0 0 auto}.updates-release-notes{margin-top:14px;border-top:1px solid var(--adm-border);padding-top:13px}.updates-release-notes-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-end}.updates-release-notes-head>div{display:grid;gap:2px}.updates-release-notes-head small{font-size:8px;font-weight:900;letter-spacing:.13em;color:var(--adm-muted)}.updates-release-notes-head b{font-size:13px;color:var(--adm-text)}.updates-release-notes-head>span{font-size:9px;color:var(--adm-muted)}.updates-release-note-list{display:grid;gap:6px;margin-top:9px}.updates-release-note-list>div{display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px;align-items:start;font-size:11px;line-height:1.45}.updates-release-note-list i{font-style:normal;font-family:monospace;color:#16a34a;font-size:9px;padding-top:2px}.updates-release-note-list span{color:var(--adm-muted);overflow-wrap:anywhere}.updates-release-more{margin-top:9px}.updates-release-more summary{cursor:pointer;color:#3b82f6;font-size:10px;font-weight:800}.updates-release-more pre{white-space:pre-wrap;color:var(--adm-text);font-family:inherit;font-size:11px;line-height:1.5;max-width:100%;overflow:auto}.updates-release-health{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.updates-release-health span{font-size:9px;color:#16803d;background:#16a34a0a;border-radius:7px;padding:5px 7px}.updates-release-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px}.updates-release-actions button{border:1px solid var(--adm-border);border-radius:9px;padding:9px 12px;font-weight:850;cursor:pointer}.updates-install-action{background:#16a34a;color:#fff;border-color:#16a34a!important}
      .updates-list-row,.updates-history-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:11px 0;border-top:1px solid var(--adm-border)}.updates-row-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.updates-delete-action{border-color:#ef444455!important;color:#dc2626!important;background:#ef44440a!important}.updates-list-row:first-of-type,.updates-history-row:first-of-type{border-top:0}.updates-list-row>div,.updates-history-row>div{min-width:0;display:grid;gap:3px}.updates-list-row b,.updates-history-row b{color:var(--adm-text);font-size:13px}.updates-list-row small,.updates-history-row small,.updates-history-row span{color:var(--adm-muted);font-size:11px;overflow-wrap:anywhere}.updates-history-status{flex:0 0 auto;border:1px solid var(--adm-border);border-radius:999px;padding:5px 8px}.updates-history-status.ok{color:#16a34a}.updates-history-status.bad{color:#ef4444}
      .updates-code-label{font-size:9px;font-weight:900;letter-spacing:.12em;color:var(--adm-muted);margin:14px 0 6px}.updates-code-block{display:block;padding:11px;border-radius:10px;background:var(--adm-surface2);border:1px solid var(--adm-border);font-size:11px;overflow-wrap:anywhere;color:var(--adm-text)}
      .updates-modal-field{display:block;font-size:12px;font-weight:800;margin-bottom:12px;color:var(--adm-text)}.updates-modal-field input,.updates-modal-field select{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px 11px;border-radius:9px;border:1px solid var(--adm-border);background:var(--adm-bg);color:var(--adm-text)}.updates-github-modal{width:min(100%,590px)}.updates-deploy-check{padding:11px;border-radius:9px;background:var(--adm-surface2);font-size:11px;color:var(--adm-muted);line-height:1.5;margin:10px 0}.updates-deploy-check>div+div{margin-top:4px}.updates-modal-footer{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;margin-top:18px}.updates-modal-footer .primary-blue,.primary-blue{background:#2563eb;color:#fff;border-color:#2563eb}.updates-modal-footer .primary-green,.primary-green{background:#16a34a;color:#fff;border-color:#16a34a}.updates-modal-footer .danger{background:#dc2626;color:#fff;border-color:#dc2626}
      .updates-progress-modal{width:min(650px,calc(100vw - 24px));max-height:90vh;overflow:auto;padding:0!important}.updates-finished-modal{width:min(460px,calc(100vw - 28px));max-height:none!important;overflow:visible!important;padding:24px!important;text-align:center}.updates-finished-icon{width:48px;height:48px;margin:0 auto 12px;display:grid;place-items:center;border-radius:15px;background:#16a34a12;color:#16a34a;font-size:25px;font-weight:900}.updates-finished-modal h2{margin:0 0 18px;color:var(--adm-text);font-size:21px}.updates-finished-version,.updates-finished-changes{text-align:left;border:1px solid var(--adm-border);background:var(--adm-surface2);border-radius:13px;padding:12px 14px}.updates-finished-version small,.updates-finished-changes>small{display:block;font-size:9px;font-weight:900;letter-spacing:.11em;color:var(--adm-muted);margin-bottom:5px}.updates-finished-version strong{font-size:17px;color:var(--adm-text)}.updates-finished-version strong span{color:#16a34a;padding:0 4px}.updates-finished-changes{margin-top:9px}.updates-finished-changes ul{margin:7px 0 0;padding-left:18px;display:grid;gap:5px}.updates-finished-changes li,.updates-finished-changes p{font-size:11px;line-height:1.42;color:var(--adm-muted);margin:0}.updates-finished-close{width:100%;min-height:44px;margin-top:14px;border:0;border-radius:12px;background:#16a34a;color:#fff;font-weight:900;font-size:13px;cursor:pointer}.updates-progress-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:20px 20px 14px}.updates-progress-embedded{margin:0 20px;padding-bottom:4px}.updates-progress-close{border:1px solid var(--adm-border);background:var(--adm-surface2);color:var(--adm-text);width:34px;height:34px;border-radius:10px;font-size:22px;line-height:1;cursor:pointer;flex:0 0 auto}.updates-progress-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px 20px;color:var(--adm-muted);font-size:12px}
      .updates-target-lock{display:grid;gap:4px;margin:10px 0 12px;padding:11px 12px;border:1px solid #3b82f655;border-radius:11px;background:#3b82f608}.updates-target-lock b{font-size:11px;color:var(--adm-text)}.updates-target-lock span{font-size:12px;font-weight:900;color:#2563eb;overflow-wrap:anywhere}.updates-target-lock small{font-size:9px;line-height:1.45;color:var(--adm-muted)}
      .updates-recovery-actions{width:min(100%,560px);box-sizing:border-box;margin:4px auto 0;padding:0 20px 8px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.updates-recovery-actions button{min-height:40px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2);color:var(--adm-text);font-size:10px;font-weight:850;padding:8px 9px;cursor:pointer;white-space:normal;line-height:1.25}
      .updates-cloud-progress-modal{width:min(780px,calc(100vw - 24px))}.updates-cloud-pipeline{margin:0 20px;display:grid;gap:12px}.updates-cloud-summary{display:flex;justify-content:space-between;gap:12px;align-items:flex-end}.updates-cloud-summary>div{display:grid;gap:3px}.updates-cloud-summary span{font-size:9px;font-weight:900;letter-spacing:.12em;color:var(--adm-muted)}.updates-cloud-summary b{font-size:14px;color:var(--adm-text)}.updates-cloud-summary strong{font-size:23px;color:#2563eb}.updates-cloud-track{height:9px;border-radius:999px;background:var(--adm-surface2);overflow:hidden}.updates-cloud-track i{display:block;height:100%;border-radius:inherit;background:#2563eb;transition:width .35s ease}.updates-cloud-chain{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10px;font-weight:900}.updates-cloud-chain>span{padding:5px 8px;border:1px solid var(--adm-border);border-radius:999px;color:var(--adm-muted);background:var(--adm-surface2)}.updates-cloud-chain>span.ok{color:#16803d;border-color:#16a34a55;background:#16a34a0a}.updates-cloud-chain>span.run{color:#2563eb;border-color:#3b82f655;background:#3b82f60a}.updates-cloud-chain>span.bad{color:#dc2626;border-color:#ef444455;background:#ef44440a}.updates-cloud-chain>span.warn{color:#b7791f;border-color:#f59e0b55;background:#f59e0b0a}.updates-cloud-chain i{font-style:normal;color:var(--adm-muted)}.updates-cloud-grid{display:grid;grid-template-columns:1fr;gap:9px}.updates-cloud-stage{min-width:0;padding:13px;border:1px solid var(--adm-border);border-radius:13px;background:var(--adm-surface2)}.updates-cloud-stage.ok{border-color:#16a34a55}.updates-cloud-stage.run{border-color:#3b82f666}.updates-cloud-stage.bad{border-color:#ef444466}.updates-cloud-stage.warn{border-color:#f59e0b66}.updates-cloud-stage-top{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:9px;align-items:center}.updates-cloud-stage-number{width:30px;height:30px;display:grid;place-items:center;border:1px solid var(--adm-border);border-radius:9px;font-weight:900;color:var(--adm-muted);background:var(--adm-surface)}.updates-cloud-stage.ok .updates-cloud-stage-number{color:#16a34a;border-color:#16a34a55}.updates-cloud-stage.run .updates-cloud-stage-number{color:#2563eb;border-color:#3b82f655}.updates-cloud-stage.bad .updates-cloud-stage-number{color:#dc2626;border-color:#ef444455}.updates-cloud-stage.warn .updates-cloud-stage-number{color:#b7791f;border-color:#f59e0b55}.updates-cloud-stage-top>div{min-width:0;display:grid;gap:1px}.updates-cloud-stage-top b{font-size:12px;color:var(--adm-text)}.updates-cloud-stage-top small{font-size:9px;color:var(--adm-muted)}.updates-cloud-stage-status{font-size:9px;font-weight:900;padding:5px 7px;border-radius:999px;background:var(--adm-surface);color:var(--adm-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.updates-stage-progress{height:7px;border-radius:999px;background:var(--adm-surface);overflow:hidden;margin-top:11px}.updates-stage-progress i{display:block;height:100%;border-radius:inherit;background:#94a3b8;transition:width .35s ease}.updates-cloud-stage.ok .updates-stage-progress i{background:#16a34a}.updates-cloud-stage.run .updates-stage-progress i{background:#2563eb}.updates-cloud-stage.bad .updates-stage-progress i{background:#dc2626}.updates-cloud-stage.warn .updates-stage-progress i{background:#f59e0b}.updates-stage-progress-label{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-top:7px}.updates-stage-progress-label span{font-size:10px;line-height:1.4;color:var(--adm-muted)}.updates-stage-progress-label b{font-size:10px;color:var(--adm-text);white-space:nowrap}.updates-cloud-stage-meta{margin-top:8px;padding-top:8px;border-top:1px solid var(--adm-border);display:flex;gap:7px;flex-wrap:wrap;align-items:center;font-size:9px;color:var(--adm-muted)}.updates-cloud-stage-meta code{font-size:9px;overflow-wrap:anywhere}.updates-cloud-stage-meta a{color:#2563eb;font-weight:800;text-decoration:none}.updates-cloud-mini-steps{display:grid;gap:4px;margin-top:8px;font-size:9px;color:var(--adm-muted)}.updates-cloud-error{padding:10px;border-radius:10px;border:1px solid #ef444466;background:#ef44440a;color:#dc2626;font-size:11px}.updates-cloud-footnote{font-size:10px;line-height:1.45;color:var(--adm-muted);padding-bottom:2px}.updates-progress-footer-clean{justify-content:flex-start;border-top:1px solid var(--adm-border);margin-top:12px;padding-top:12px}
      .updates-wizard-steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin:2px 0 18px}.updates-wizard-step{min-width:0;display:grid;justify-items:center;gap:5px;position:relative;color:var(--adm-muted)}.updates-wizard-step:not(:last-child):after{content:"";position:absolute;top:14px;left:calc(50% + 18px);right:calc(-50% + 18px);height:1px;background:var(--adm-border)}.updates-wizard-step i{width:28px;height:28px;border-radius:9px;border:1px solid var(--adm-border);background:var(--adm-surface2);display:grid;place-items:center;font-style:normal;font-size:10px;font-weight:900;position:relative;z-index:1}.updates-wizard-step span{font-size:8px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.updates-wizard-step.active{color:var(--adm-accent)}.updates-wizard-step.active i{border-color:var(--adm-accent);color:var(--adm-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--adm-accent) 12%,transparent)}.updates-wizard-step.done{color:var(--adm-success)}.updates-wizard-step.done i{border-color:color-mix(in srgb,var(--adm-success) 45%,var(--adm-border));color:var(--adm-success);background:color-mix(in srgb,var(--adm-success) 8%,var(--adm-surface2))}
      .updates-wizard-drop{width:100%;min-height:110px;border:1px dashed var(--adm-border);border-radius:16px;background:var(--adm-surface2);color:var(--adm-text);display:flex;align-items:center;justify-content:center;gap:13px;padding:18px;cursor:pointer;text-align:left}.updates-wizard-drop:hover{border-color:var(--adm-accent)}.updates-wizard-drop-icon{width:44px;height:44px;border-radius:13px;background:var(--adm-surface);border:1px solid var(--adm-border);display:grid;place-items:center;font-size:22px;flex:0 0 auto}.updates-wizard-drop>span:last-child{display:grid;gap:4px;min-width:0}.updates-wizard-drop b{font-size:13px;overflow-wrap:anywhere}.updates-wizard-drop small{font-size:10px;color:var(--adm-muted)}
      .updates-wizard-package{margin-top:12px;padding:13px;border:1px solid color-mix(in srgb,var(--adm-success) 35%,var(--adm-border));border-radius:13px;background:color-mix(in srgb,var(--adm-success) 4%,var(--adm-surface));display:grid;gap:10px}.updates-wizard-package.repair{border-color:color-mix(in srgb,var(--adm-warning) 48%,var(--adm-border));background:color-mix(in srgb,var(--adm-warning) 5%,var(--adm-surface))}.updates-wizard-package.bad{border-color:color-mix(in srgb,var(--adm-danger) 50%,var(--adm-border))}.updates-wizard-version{display:grid;gap:3px}.updates-wizard-version small,.updates-wizard-review-head small,.updates-protection-card small,.updates-live-log-head small{font-size:9px;font-weight:900;letter-spacing:.11em;color:var(--adm-muted)}.updates-wizard-version strong{font-size:16px;color:var(--adm-text)}.updates-wizard-version strong span,.updates-wizard-review-head h3 span{color:var(--adm-muted);padding:0 4px}.updates-wizard-mini-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.updates-wizard-mini-grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}.updates-repair-note,.updates-managed-review{padding:10px 11px;border-radius:11px;border:1px solid color-mix(in srgb,var(--adm-warning) 42%,var(--adm-border));background:color-mix(in srgb,var(--adm-warning) 6%,var(--adm-surface2));display:grid;gap:3px}.updates-repair-note b,.updates-managed-review b{font-size:11px;color:var(--adm-text)}.updates-repair-note span,.updates-managed-review span{font-size:10px;line-height:1.5;color:var(--adm-muted)}.updates-wizard-error,.updates-wizard-warning{padding:9px 10px;border-radius:9px;font-size:10px;line-height:1.45}.updates-wizard-error{border:1px solid color-mix(in srgb,var(--adm-danger) 50%,var(--adm-border));color:var(--adm-danger)}.updates-wizard-warning{border:1px solid color-mix(in srgb,var(--adm-warning) 45%,var(--adm-border));color:var(--adm-warning)}
      .updates-wizard-review-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:11px}.updates-wizard-review-head>div{display:grid;gap:3px}.updates-wizard-review-head h3{margin:0;font-size:18px;color:var(--adm-text)}.updates-review-badge{font-size:9px;font-weight:900;border-radius:999px;padding:6px 8px;border:1px solid var(--adm-border);color:var(--adm-success)}.updates-review-badge.repair{color:var(--adm-warning)}.updates-module-pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.updates-module-pills span{font-size:9px;padding:5px 7px;border-radius:999px;border:1px solid var(--adm-border);background:var(--adm-surface)}.updates-wizard-notes{margin-top:10px;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-surface2);padding:10px 12px}.updates-wizard-notes summary{font-size:11px;font-weight:800;color:var(--adm-text);cursor:pointer}.updates-wizard-notes ul{margin:9px 0 0;padding-left:18px;display:grid;gap:5px}.updates-wizard-notes li{font-size:10px;line-height:1.45;color:var(--adm-muted)}
      .updates-protection-card{display:grid;grid-template-columns:auto minmax(0,1fr);gap:13px;align-items:start;padding:14px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface2)}.updates-protection-icon{width:48px;height:48px;border-radius:14px;border:1px solid var(--adm-border);background:var(--adm-surface);display:grid;place-items:center;font-size:15px;font-weight:900;color:var(--adm-accent)}.updates-protection-card h3{margin:3px 0 5px;font-size:15px;color:var(--adm-text)}.updates-protection-card p{margin:0;font-size:10.5px;line-height:1.55;color:var(--adm-muted)}
      .updates-wizard-footer{position:sticky;bottom:-20px;z-index:4;margin:16px -20px -20px;padding:12px 20px;background:color-mix(in srgb,var(--adm-surface) 96%,transparent);backdrop-filter:blur(8px);border-top:1px solid var(--adm-border);display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center}.updates-wizard-footer>span{text-align:center;font-size:9px;font-weight:800;color:var(--adm-muted)}.updates-wizard-footer button{border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2);color:var(--adm-text);padding:10px 13px;font-weight:850;cursor:pointer}.updates-primary-action{background:var(--adm-accent)!important;border-color:var(--adm-accent)!important;color:var(--adm-accent-contrast,#fff)!important}.updates-wizard-footer button:disabled{opacity:.5;cursor:not-allowed}
      .updates-progress-stepper{padding:0 20px 4px}.updates-progress-stepper .updates-wizard-steps{margin-bottom:8px}.updates-live-log{margin:12px 0 2px;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-surface2);overflow:hidden}.updates-live-log-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 11px}.updates-live-log-head>div{min-width:0;display:grid;gap:2px}.updates-live-log-head b{font-size:10.5px;color:var(--adm-text);overflow-wrap:anywhere}.updates-live-log-head>span{font-size:9px;font-weight:850;color:var(--adm-muted);white-space:nowrap}.updates-live-log-track{height:5px;background:var(--adm-surface);overflow:hidden}.updates-live-log-track i{display:block;height:100%;background:var(--adm-accent);transition:width .2s ease}.updates-live-log-current{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:7px;align-items:center;padding:8px 10px;border-top:1px solid color-mix(in srgb,var(--adm-border) 65%,transparent)}.updates-live-log-current em{font-style:normal;font-size:8px;font-weight:900;color:var(--adm-accent)}.updates-live-log-current code{min-width:0;font-size:9px;color:var(--adm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.updates-live-log-current strong{font-size:9px;color:var(--adm-text);font-variant-numeric:tabular-nums}.updates-live-log-list{max-height:180px;overflow:auto;padding:4px 0}.updates-live-log-list>div{display:grid;grid-template-columns:42px minmax(0,1fr) 16px;gap:7px;align-items:center;padding:5px 10px;border-top:1px solid color-mix(in srgb,var(--adm-border) 65%,transparent);font-size:9px}.updates-live-log-list em{font-style:normal;font-size:8px;font-weight:900;color:var(--adm-accent)}.updates-live-log-list .act-add{color:var(--adm-success)}.updates-live-log-list .act-del{color:var(--adm-danger)}.updates-live-log-list .act-mod{color:var(--adm-warning)}.updates-live-log-list code{font-size:9px;color:var(--adm-muted);overflow-wrap:anywhere;white-space:normal}.updates-live-log-list>div>span{color:var(--adm-success)}.updates-live-log-list .current>span{color:var(--adm-accent)}.updates-cloud-filelog-wrap{margin:0 20px}.updates-failure-report{margin:14px 0 0;border:1px solid color-mix(in srgb,var(--adm-danger) 32%,var(--adm-border));border-radius:14px;background:color-mix(in srgb,var(--adm-danger) 3%,var(--adm-surface));overflow:hidden}.updates-failure-report-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:13px 14px;border-bottom:1px solid var(--adm-border)}.updates-failure-report-head>div:first-child{display:grid;gap:3px;min-width:0}.updates-failure-report-head small{font-size:8px;font-weight:900;letter-spacing:.09em;color:var(--adm-danger)}.updates-failure-report-head b{font-size:13px;color:var(--adm-text)}.updates-failure-report-head span{font-size:10px;line-height:1.4;color:var(--adm-muted)}.updates-failure-report-head>div:last-child{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.updates-failure-report-head button{border:1px solid var(--adm-border);background:var(--adm-surface);color:var(--adm-text);border-radius:8px;padding:7px 9px;font-size:9px;font-weight:800;cursor:pointer}.updates-failure-primary{display:grid;gap:4px;padding:10px 14px;background:color-mix(in srgb,var(--adm-danger) 7%,transparent);border-bottom:1px solid var(--adm-border)}.updates-failure-primary b{font-size:9px;color:var(--adm-danger);text-transform:uppercase;letter-spacing:.06em}.updates-failure-primary span{font-size:10px;line-height:1.45;color:var(--adm-text);overflow-wrap:anywhere}.updates-failure-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:12px}.updates-failure-grid section{min-width:0;border:1px solid var(--adm-border);background:var(--adm-surface);border-radius:11px;padding:10px}.updates-failure-grid section.bad{border-color:color-mix(in srgb,var(--adm-danger) 35%,var(--adm-border))}.updates-failure-grid header{display:flex;align-items:center;gap:7px}.updates-failure-grid header>span{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:var(--adm-surface2);font-size:10px;color:var(--adm-muted)}.updates-failure-grid section.bad header>span{color:var(--adm-danger);background:color-mix(in srgb,var(--adm-danger) 8%,var(--adm-surface))}.updates-failure-grid header>div{display:grid;gap:1px}.updates-failure-grid header b{font-size:10px;color:var(--adm-text)}.updates-failure-grid header small{font-size:8px;color:var(--adm-muted)}.updates-failure-grid p{margin:8px 0 0;font-size:10px;line-height:1.45;color:var(--adm-text);overflow-wrap:anywhere}.updates-failure-grid pre{margin:8px 0 0;max-height:190px;overflow:auto;background:var(--adm-bg);border:1px solid var(--adm-border);border-radius:8px;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:8.5px;line-height:1.45;color:var(--adm-muted)}.updates-failure-empty{margin-top:8px;font-size:9px;line-height:1.45;color:var(--adm-muted)}@media(max-width:700px){.updates-failure-report-head{display:grid}.updates-failure-report-head>div:last-child{justify-content:flex-start}.updates-failure-grid{grid-template-columns:1fr}}.updates-modal-overlay{background:var(--adm-overlay,rgba(15,23,42,.46))}
      @media(max-width:760px){.updates-command-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.updates-overview{grid-template-columns:repeat(2,minmax(0,1fr))}.updates-status-pill{display:none}}
      .updates-cloud-wizard{max-width:560px;margin:0 auto;padding:0 20px 10px}.updates-cloud-wizard-dots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.updates-cloud-wizard-dots>span{min-width:0;display:grid;justify-items:center;gap:4px;color:var(--adm-muted)}.updates-cloud-wizard-dots i{width:25px;height:25px;display:grid;place-items:center;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface2);font-style:normal;font-size:9px;font-weight:900}.updates-cloud-wizard-dots small{font-size:7px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}.updates-cloud-wizard-dots .active i{border-color:var(--adm-accent);color:var(--adm-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--adm-accent) 12%,transparent)}.updates-cloud-wizard-dots .ok i{border-color:color-mix(in srgb,var(--adm-success) 38%,var(--adm-border));color:var(--adm-success);background:color-mix(in srgb,var(--adm-success) 7%,var(--adm-surface2))}.updates-cloud-wizard-dots .bad i{border-color:color-mix(in srgb,var(--adm-danger) 45%,var(--adm-border));color:var(--adm-danger)}.updates-cloud-current{display:grid;gap:10px;align-content:start}.updates-cloud-current .updates-cloud-stage{padding:18px;min-height:210px;display:flex;flex-direction:column;justify-content:center}.updates-cloud-current-caption{text-align:center;font-size:9px;line-height:1.4;color:var(--adm-muted)}.updates-cloud-finish{min-height:250px;display:grid;justify-items:center;align-content:center;gap:8px;text-align:center;padding:20px}.updates-cloud-finish-icon{width:58px;height:58px;display:grid;place-items:center;border-radius:18px;background:color-mix(in srgb,var(--adm-success) 9%,var(--adm-surface2));color:var(--adm-success);font-size:28px;font-weight:900}.updates-cloud-finish h3{margin:0;color:var(--adm-text);font-size:18px}.updates-cloud-finish p{margin:0;max-width:390px;font-size:11px;line-height:1.5;color:var(--adm-muted)}.updates-cloud-finish-list{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:5px}.updates-cloud-finish-list span{font-size:8px;font-weight:850;padding:5px 7px;border-radius:999px;border:1px solid color-mix(in srgb,var(--adm-success) 30%,var(--adm-border));color:var(--adm-success);background:color-mix(in srgb,var(--adm-success) 6%,var(--adm-surface2))}.updates-progress-overlay{align-items:center!important;justify-content:center!important;padding:14px!important}.updates-cloud-progress-modal{max-height:88dvh!important}
      @media(max-width:560px){.updates-hero h1{font-size:18px!important}.updates-command{padding:13px 12px;gap:10px}.updates-command-icon{width:38px;height:38px;font-size:18px}.updates-check-grid{grid-template-columns:1fr}.updates-modal-overlay{padding:12px;align-items:center;justify-content:center}.updates-modal{width:100%;max-height:92dvh;border-radius:18px;border-bottom:1px solid var(--adm-border);padding:16px}.updates-package-picker{grid-template-columns:1fr}.updates-send-package{width:100%;min-height:44px}.updates-file-selected{align-items:flex-start;flex-direction:column}.updates-primary-action{width:100%}.updates-release-file{display:grid;gap:3px}.updates-release-file span{flex:auto}.updates-release-actions{display:grid;grid-template-columns:1fr}.updates-release-actions button{width:100%}.updates-progress-modal{width:min(100%,620px);max-height:92dvh;border-radius:18px}.updates-finished-modal{width:calc(100% - 28px)!important;border-radius:18px!important;padding:20px 16px!important;margin-bottom:14px}.updates-finished-modal h2{font-size:19px;margin-bottom:14px}.updates-finished-version strong{font-size:15px}.updates-finished-changes li,.updates-finished-changes p{font-size:10.5px}.updates-cloud-pipeline{margin:0 auto;padding:0 10px 8px}.updates-cloud-grid{grid-template-columns:1fr}.updates-cloud-stage{padding:10px}.updates-cloud-stage-status{max-width:105px}.updates-next-release-head{align-items:center}.updates-next-release-head strong{font-size:12px}.updates-progress-head{padding:16px 14px 12px}.updates-progress-embedded{margin:0 14px}.updates-progress-footer{padding:12px 14px 16px;flex-direction:column;align-items:stretch}.updates-progress-footer button{width:100%}.updates-row-actions{justify-content:flex-start}.updates-recovery-actions{padding:0 10px 8px;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.updates-recovery-actions button{min-height:38px;padding:7px 6px;font-size:9px}.updates-wizard-mini-grid-4{grid-template-columns:repeat(2,minmax(0,1fr))}.updates-wizard-footer{bottom:-16px;margin:14px -16px -16px;padding:11px 16px}.updates-wizard-footer{grid-template-columns:auto minmax(0,1fr) auto}.updates-wizard-step span{font-size:7px}.updates-live-log-list{max-height:150px}}
      @media(max-width:390px){.updates-overview>div{padding:9px}.updates-recovery-actions{grid-template-columns:1fr}}
    `}</style>
  </div>

}


function PreflightSummary({data,compact=false}){
 const risk=data.risk||'baixo'
 const riskColor=risk==='alto'?C.red:risk==='médio'?'#b7791f':C.greenSolid
 const files=data.files||{}
 const writes=files.writes ?? ((files.added||0)+(files.changed||0))
 const operations=files.operations ?? (writes+(files.removed||0))
 return <div style={{display:'grid',gap:10}}>
  <div style={{padding:11,borderRadius:10,border:`1px solid ${data.repair?.sameVersion?'color-mix(in srgb,var(--adm-warning) 42%,var(--adm-border))':'color-mix(in srgb,var(--adm-accent) 32%,var(--adm-border))'}`,background:data.repair?.sameVersion?'color-mix(in srgb,var(--adm-warning) 6%,var(--adm-surface2))':'color-mix(in srgb,var(--adm-accent) 5%,var(--adm-surface2))',fontSize:12,lineHeight:1.5,color:C.text}}>
   <b>{data.repair?.sameVersion?'Reparo verificado por SHA-256':'Aplicação diferencial'}</b><br/>
   {data.repair?.sameVersion
    ? (data.repair?.noChanges?'A versão registrada e os arquivos reais já correspondem ao pacote. Nenhuma reinstalação é necessária.':'A versão é igual à instalada, mas o atualizador encontrou diferenças reais. A comparação integral SHA-256 decide arquivo por arquivo o que precisa ser reparado.')
    : 'O pacote completo é a referência da versão. O atualizador compara os arquivos e só grava o que realmente mudou; arquivos idênticos permanecem intactos.'}
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
  {(files.samples?.added?.length||files.samples?.changed?.length||files.samples?.removed?.length)?<div style={{padding:10,borderRadius:9,border:'1px solid var(--adm-border)',background:'var(--adm-bg)',fontSize:12,maxHeight:220,overflow:'auto'}}>
    <div style={{fontWeight:800,color:C.text}}>Exemplos dos arquivos afetados</div>
    {!!files.samples?.added?.length&&<div style={{marginTop:8}}><b style={{color:C.greenSolid}}>Novos</b>{files.samples.added.map(x=><div className="updates-wrap" key={`a-${x}`}>+ {x}</div>)}</div>}
    {!!files.samples?.changed?.length&&<div style={{marginTop:8}}><b style={{color:C.blue}}>Alterados</b>{files.samples.changed.map(x=><div className="updates-wrap" key={`c-${x}`}>~ {x}</div>)}</div>}
    {!!files.samples?.removed?.length&&<div style={{marginTop:8}}><b style={{color:'#b7791f'}}>Removidos</b>{files.samples.removed.map(x=><div className="updates-wrap" key={`r-${x}`}>- {x}</div>)}</div>}
  </div>:null}
  {!!data.warnings?.length&&<div style={{padding:10,borderRadius:9,border:'1px solid #f59e0b55',background:'#f59e0b12',fontSize:12}}>
    {data.warnings.map((w,i)=><div key={i} style={{margin:i?'5px 0 0':0}}>⚠️ {w}</div>)}
  </div>}
  {!data.ok&&(data.repair?.noChanges
    ? <div style={{padding:10,borderRadius:9,border:'1px solid color-mix(in srgb,var(--adm-success) 35%,var(--adm-border))',background:'color-mix(in srgb,var(--adm-success) 6%,var(--adm-surface2))',color:'var(--adm-success)',fontSize:12,fontWeight:700}}>✓ Nenhum reparo necessário. Esta mesma versão já está íntegra.</div>
    : <div style={{padding:10,borderRadius:9,border:`1px solid ${C.red}`,background:'var(--adm-surface2)',color:C.red,fontSize:12,fontWeight:700}}>A instalação foi bloqueada pelo pré-check.</div>)}
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
  'r2-download':'Baixando pacote do R2',
  'platform-deploy':'Aguardando Vercel e Render',
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


const UPDATE_WIZARD_LABELS=['Pacote','Revisão','Proteção','Aplicação','Concluído']
function UpdateWizardSteps({step=0,managed=false}){
 const labels=managed?['Pacote','Revisão','R2','GitHub','Produção']:UPDATE_WIZARD_LABELS
 return <div className="updates-wizard-steps" aria-label="Etapas da atualização">{labels.map((label,i)=><div key={label} className={`updates-wizard-step ${i<step?'done':i===step?'active':''}`}><i>{i<step?'✓':i+1}</i><span>{label}</span></div>)}</div>
}
function jobWizardStep(job){if(['completed','restart-required'].includes(job?.status))return 4;if(['integrity','backup','backup-done','snapshot-cleanup'].includes(job?.phase))return 2;return 3}
function FileLiveLog({job,cloud=false}){
 const source=cloud?(job?.cloudRelease?.publishJob||{}):(job||{}),log=Array.isArray(source.fileLog)?source.fileLog:[],current=source.currentFile||null
 const done=Number(source.filesDone??source.filesProgress?.done??0),total=Number(source.filesTotal??source.filesProgress?.total??0)
 const latest=current||log[log.length-1]||null
 if(!latest&&!total)return null
 const percent=total>0?Math.max(0,Math.min(100,Math.round((done/Math.max(1,total))*100))):0
 return <div className="updates-live-log updates-live-log-compact" aria-live="polite">
   <div className="updates-live-log-head"><div><small>ARQUIVO ATUAL</small><b>{latest?.path||'Sincronizando arquivos'}</b></div><span>{total?`${done}/${total}`:'aguardando'}</span></div>
   {total>0&&<div className="updates-live-log-track"><i style={{width:`${percent}%`}}/></div>}
   <div className="updates-live-log-current"><em>{latest?.action||'SYNC'}</em><code>{latest?.path||'Preparando arquivos…'}</code><strong>{total?`${percent}%`:'●'}</strong></div>
 </div>
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
  const success=['completed','restart-required'].includes(job.status)
  const notes=releaseNotes(job.changelog).slice(0,6)
  if(success)return <div className="updates-modal-overlay updates-progress-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose?.()}}>
    <div className="updates-modal updates-progress-modal updates-finished-modal" role="dialog" aria-modal="true" aria-labelledby="update-progress-title">
      <div className="updates-finished-icon">✓</div>
      <h2 id="update-progress-title">Atualização concluída</h2><UpdateWizardSteps step={4}/>
      <div className="updates-finished-version"><small>VERSÃO</small><strong>{job.fromVersion||'—'} <span>→</span> {job.toVersion||'—'}</strong></div>
      <div className="updates-finished-changes">
        <small>O QUE MUDOU</small>
        {notes.length?<ul>{notes.map((note,i)=><li key={i}>{note}</li>)}</ul>:<p>Atualização aplicada com sucesso.</p>}
      </div>
      <button className="updates-finished-close" onClick={onClose}>Fechar</button>
    </div>
  </div>
  return <div className="updates-modal-overlay updates-progress-overlay" role="presentation" onMouseDown={e=>{if(canClose&&e.target===e.currentTarget)onClose?.()}}>
    <div className="updates-modal updates-progress-modal" role="dialog" aria-modal="true" aria-labelledby="update-progress-title">
      <div className="updates-progress-head"><div><div style={{fontSize:10,fontWeight:900,color:C.muted,letterSpacing:'.12em'}}>ATUALIZAÇÃO EM EXECUÇÃO</div><h2 id="update-progress-title" style={{margin:'5px 0 3px',fontSize:20,color:C.text}}>AL Sistemas</h2><div style={{fontSize:12,color:C.muted,lineHeight:1.45}}>O progresso fica isolado neste painel. A página principal não precisa mais rolar até a caixa de porcentagem.</div></div>{canClose&&<button onClick={onClose} className="updates-progress-close" aria-label="Fechar">×</button>}</div>
      <div className="updates-progress-stepper"><UpdateWizardSteps step={jobWizardStep(job)}/></div>
      <UpdateProgress job={job} embedded/>
      {job.finalReport&&<div style={{margin:'14px 20px 0'}}><UpdateFinalReport report={job.finalReport}/></div>}
      <div className="updates-progress-footer updates-progress-footer-clean"><span>{canClose?(job.status==='failed'?'A atualização terminou com erro. Use × no topo para fechar.':'Operação finalizada. Use × no topo para fechar.'):'Não feche esta aba durante a aplicação dos arquivos.'}</span></div>
    </div>
  </div>
}

function platformVisual(kind,status=''){
  const raw=String(status||'').trim()
  const upper=raw.toUpperCase()
  const lower=raw.toLowerCase()
  if(kind==='vercel'){
    if(upper==='READY')return {tone:'ok',icon:'✓',label:'Disponível',detail:'Frontend publicado e disponível em produção.',progress:100}
    if(upper==='ERROR'||/fail|cancel/.test(lower))return {tone:'bad',icon:'✕',label:'Falhou',detail:'O deployment da Vercel terminou com erro.',progress:100}
    if(upper==='BUILDING')return {tone:'run',icon:'●',label:'Construindo',detail:'A Vercel está compilando o frontend deste commit.',progress:68}
    if(upper==='INITIALIZING')return {tone:'run',icon:'●',label:'Iniciando',detail:'A Vercel reconheceu o commit e está preparando o ambiente.',progress:42}
    if(upper==='QUEUED')return {tone:'run',icon:'●',label:'Na fila',detail:'O deployment está na fila da Vercel.',progress:24}
    if(upper==='PENDING')return {tone:'run',icon:'●',label:'Aguardando',detail:'A Vercel está aguardando recursos para iniciar.',progress:15}
    if(['NOT-LINKED','NOT-CONFIGURED'].includes(upper))return {tone:'warn',icon:'!',label:'Não vinculado',detail:'Selecione o projeto Vercel principal na Central de Plataformas.',progress:0}
    return {tone:'wait',icon:'○',label:'Aguardando commit',detail:'Aguardando a Vercel reconhecer o novo commit.',progress:0}
  }
  if(['live','succeeded','deployed'].includes(lower))return {tone:'ok',icon:'✓',label:'No ar',detail:'Backend atualizado e ativo na Render.',progress:100}
  if(/fail|error|cancel/.test(lower))return {tone:'bad',icon:'✕',label:'Falhou',detail:'O deployment da Render terminou com erro.',progress:100}
  if(lower==='build_in_progress'||/build/.test(lower))return {tone:'run',icon:'●',label:'Compilando',detail:'A Render está construindo o backend deste commit.',progress:58}
  if(lower==='update_in_progress'||/update/.test(lower))return {tone:'run',icon:'●',label:'Implantando',detail:'A compilação terminou e a Render está colocando o backend no ar.',progress:82}
  if(/queued|pending/.test(lower))return {tone:'run',icon:'●',label:'Na fila',detail:'O deployment está aguardando para iniciar na Render.',progress:24}
  if(/create|created/.test(lower))return {tone:'run',icon:'●',label:'Preparando',detail:'A Render reconheceu o novo commit.',progress:12}
  if(['not-linked','not-configured'].includes(lower))return {tone:'warn',icon:'!',label:'Não vinculado',detail:'Selecione o serviço Render principal na Central de Plataformas.',progress:0}
  return {tone:'wait',icon:'○',label:'Aguardando commit',detail:'Aguardando a Render reconhecer o novo commit.',progress:0}
}

function CloudStage({number,name,subtitle,state,meta,children}){
  const cls=`updates-cloud-stage ${state?.tone||'wait'}`
  const progress=Math.max(0,Math.min(100,Number(state?.progress||0)))
  return <div className={cls}>
    <div className="updates-cloud-stage-top">
      <span className="updates-cloud-stage-number">{state?.tone==='ok'?'✓':number}</span>
      <div><b>{name}</b><small>{subtitle}</small></div>
      <span className="updates-cloud-stage-status">{state?.label||'Aguardando'}</span>
    </div>
    <div className="updates-stage-progress"><i style={{width:`${progress}%`}}/></div>
    <div className="updates-stage-progress-label"><span>{state?.detail||'Aguardando esta etapa.'}</span><b>{progress}%</b></div>
    {meta&&<div className="updates-cloud-stage-meta">{meta}</div>}
    {children}
  </div>
}

function CloudFailureReport({job}){
  const rel=job?.cloudRelease||{}
  const publish=rel.publishJob||{}
  const githubLines=[...(Array.isArray(publish.timeline)?publish.timeline.map(x=>x?.label||x?.key||'').filter(Boolean):[]),...(Array.isArray(publish.fileLog)?publish.fileLog.slice(-20).map(x=>`${x?.action||'SYNC'} ${x?.path||''}`.trim()):[])]
  const rows=[
    {name:'GitHub',status:rel.githubStatus||publish.status||'',message:publish.error||'',diagnostics:{summary:publish.error||'',lines:githubLines}},
    {name:'Vercel',status:rel.vercel?.status||'',message:rel.vercel?.message||'',diagnostics:rel.vercel?.diagnostics||{}},
    {name:'Render',status:rel.render?.status||'',message:rel.render?.message||'',diagnostics:rel.render?.diagnostics||{}},
  ]
  const failedRows=rows.filter(row=>/error|fail|cancel/i.test(String(row.status||''))||row.diagnostics?.summary||row.diagnostics?.error)
  const show=job?.status==='failed'||rel?.error||failedRows.length>0
  if(!show)return null
  const lines=[]
  lines.push(`RELATÓRIO DE ATUALIZAÇÃO — AL Sistemas ${job?.version||rel?.version||''}`)
  lines.push(`Gerado em: ${new Date().toLocaleString('pt-BR')}`)
  lines.push(`Status: ${rel?.status||job?.status||'falha'}`)
  if(rel?.repository)lines.push(`GitHub: ${rel.repository} @ ${rel.branch||'main'}`)
  if(rel?.commitSha)lines.push(`Commit: ${rel.commitSha}`)
  if(job?.error||rel?.error)lines.push(`Erro geral: ${job?.error||rel?.error}`)
  for(const row of rows){
    lines.push('',`[${row.name}] status=${row.status||'não informado'}`)
    if(row.message)lines.push(`Resumo: ${row.message}`)
    if(row.diagnostics?.error)lines.push(`Falha ao consultar logs: ${row.diagnostics.error}`)
    const buildLines=Array.isArray(row.diagnostics?.lines)?row.diagnostics.lines:[]
    if(buildLines.length){
      lines.push('Logs relevantes:')
      for(const line of buildLines.slice(-40))lines.push(`  ${line}`)
    }
  }
  const report=lines.join('\n')
  const copy=async()=>{
    try{await navigator.clipboard.writeText(report);toast.success('Relatório copiado.')}catch{toast.error('Não foi possível copiar o relatório.')}
  }
  const download=()=>{
    const blob=new Blob([report],{type:'text/plain;charset=utf-8'})
    const url=URL.createObjectURL(blob),a=document.createElement('a')
    a.href=url;a.download=`alsistemas-update-${job?.version||rel?.version||'falha'}-relatorio.txt`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <div className="updates-failure-report">
    <div className="updates-failure-report-head">
      <div><small>RELATÓRIO DA FALHA</small><b>O que impediu a atualização</b><span>Os logs são buscados automaticamente nas plataformas quando um deploy termina com erro.</span></div>
      <div><button onClick={copy}>Copiar</button><button onClick={download}>Baixar .txt</button></div>
    </div>
    {(job?.error||rel?.error)&&<div className="updates-failure-primary"><b>Erro principal</b><span>{job?.error||rel?.error}</span></div>}
    <div className="updates-failure-grid">
      {rows.map(row=>{
        const buildLines=Array.isArray(row.diagnostics?.lines)?row.diagnostics.lines:[]
        const summary=row.diagnostics?.summary||row.message||row.diagnostics?.error||''
        const bad=/error|fail|cancel/i.test(String(row.status||''))
        return <section key={row.name} className={bad?'bad':''}>
          <header><span>{bad?'✕':'•'}</span><div><b>{row.name}</b><small>{row.status||'sem status'}</small></div></header>
          {summary&&<p>{summary}</p>}
          {buildLines.length>0?<pre>{buildLines.slice(-14).join('\n')}</pre>:bad?<div className="updates-failure-empty">A plataforma marcou falha, mas ainda não devolveu linhas detalhadas de build.</div>:null}
        </section>
      })}
    </div>
  </div>
}

function CloudPublishProgress({job}){
  const rel=job.cloudRelease||{}
  const hasR2=Boolean(job.releaseId||job.bucket||rel.bucket||rel.objectKey)
  const hasCommit=Boolean(job.commitSha||rel.commitSha)
  const failed=job.status==='failed'
  const attention=job.status==='attention'||['publish-stalled','deploy-stalled','deploy-target-mismatch','deploy-blocked','interrupted'].includes(String(rel.status||''))
  const done=job.status==='completed'||rel.productionReady
  let vercel=platformVisual('vercel',rel.vercel?.status)
  let render=platformVisual('render',rel.render?.status)
  if(rel.status==='deploy-stalled'){
    if(vercel.tone!=='ok')vercel={tone:'warn',icon:'!',label:'Sem confirmação',detail:'A Vercel não confirmou este commit dentro do prazo. Reconsulte ou reinicie o deploy.',progress:vercel.progress||0}
    if(render.tone!=='ok')render={tone:'warn',icon:'!',label:'Sem confirmação',detail:'A Render não confirmou este commit dentro do prazo. Reconsulte ou reinicie o deploy.',progress:render.progress||0}
  }
  if(rel.status==='deploy-blocked'){
    if(vercel.tone!=='ok')vercel={tone:'warn',icon:'!',label:'Vínculo pendente',detail:'Revise o projeto de produção associado antes de continuar.',progress:0}
    if(render.tone!=='ok')render={tone:'warn',icon:'!',label:'Vínculo pendente',detail:'Revise o serviço de produção associado antes de continuar.',progress:0}
  }
  const r2State=hasR2
    ?{tone:'ok',icon:'✓',label:'Pacote preparado',detail:`AL Sistemas ${job.version||rel.version||''} validado e preservado no R2.`,progress:100}
    :{tone:'run',icon:'●',label:'Preparando pacote',detail:'Validando a atualização e salvando o ZIP no armazenamento persistente.',progress:Math.min(95,Number(job.progress||0))}
  const persistentPublish=rel.publishJob||{}
  const githubProgress=hasCommit?100:failed?100:Math.max(5,Math.min(98,Number(persistentPublish.progress||Math.round(((Number(job.progress||28)-20)/72)*100))))
  let ghState=hasCommit
    ?{tone:'ok',icon:'✓',label:'Commit publicado',detail:'Código enviado ao GitHub. As plataformas já podem implantar este SHA.',progress:100}
    :failed?{tone:'bad',icon:'✕',label:'Falhou',detail:'A publicação no GitHub não foi concluída.',progress:100}
    :{tone:'run',icon:'●',label:persistentPublish.status==='retry-wait'?'Retomando':'Publicando',detail:persistentPublish.phaseLabel||'Comparando a release, criando o commit e enviando a branch.',progress:githubProgress}
  if(rel.status==='publish-stalled')ghState={tone:'warn',icon:'!',label:'Publicação interrompida',detail:'Nenhum commit foi confirmado. O ZIP continua salvo no R2 e pode ser publicado novamente.',progress:100}
  if(rel.status==='deploy-target-mismatch')ghState={tone:'warn',icon:'!',label:'Destino incorreto',detail:'O commit existe, mas foi publicado em um repositório diferente do usado pela produção.',progress:100}
  if(rel.status==='interrupted')ghState={tone:'warn',icon:'!',label:'Acompanhamento encerrado',detail:'O histórico foi preservado e não ficará mais preso em atualização.',progress:hasCommit?100:0}

  const stages=[
    {number:'1',name:'Atualização principal',subtitle:'Pacote e R2',state:r2State,meta:(job.objectKey||rel.objectKey)?<><span>{job.bucket||rel.bucket||'bucket'}</span><code>{job.objectKey||rel.objectKey}</code></>:null},
    {number:'2',name:'GitHub',subtitle:'Repositório e commit',state:ghState,meta:hasCommit?<><code>{String(job.commitSha||rel.commitSha).slice(0,12)}</code>{(job.commitUrl||rel.commitUrl)&&<a href={job.commitUrl||rel.commitUrl} target="_blank" rel="noreferrer">Abrir commit ↗</a>}</>:rel.repository?<><span>{rel.repository}</span><code>{rel.branch||'main'}</code></>:null,children:!hasCommit&&Array.isArray(persistentPublish.timeline)&&persistentPublish.timeline.length>0?<div className="updates-cloud-mini-steps">{persistentPublish.timeline.slice(-3).map((x,i)=><span key={`${x.key}-${i}`}>{i===persistentPublish.timeline.slice(-3).length-1?'●':'✓'} {x.label||STEP_LABELS[x.key]||x.key}</span>)}</div>:null},
    {number:'3',name:'Vercel',subtitle:'Frontend',state:vercel,meta:<><span>{rel.vercel?.checkedAt?`Consultado às ${new Date(rel.vercel.checkedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:'Aguardando primeira consulta'}</span>{rel.vercel?.url&&<a href={rel.vercel.url} target="_blank" rel="noreferrer">Abrir produção ↗</a>}</>},
    {number:'4',name:'Render',subtitle:'Backend',state:render,meta:<><span>{rel.render?.checkedAt?`Consultado às ${new Date(rel.render.checkedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:'Aguardando primeira consulta'}</span>{rel.render?.url&&<a href={rel.render.url} target="_blank" rel="noreferrer">Abrir backend ↗</a>}</>},
  ]
  const completedCount=stages.filter(s=>s.state.tone==='ok').length
  const overall=done?100:Math.round(stages.reduce((sum,s)=>sum+Number(s.state.progress||0),0)/4)
  let activeIndex=stages.findIndex(s=>s.state.tone!=='ok')
  if(activeIndex<0)activeIndex=3
  if(failed){const bad=stages.findIndex(s=>s.state.tone==='bad');if(bad>=0)activeIndex=bad}
  if(attention){const warn=stages.findIndex(s=>s.state.tone==='warn');if(warn>=0)activeIndex=warn}
  const current=stages[activeIndex]

  return <div className="updates-cloud-pipeline updates-cloud-wizard">
    <div className="updates-cloud-summary">
      <div><span>{job.version||rel.version?`AL SISTEMAS ${job.version||rel.version}`:'ATUALIZAÇÃO EM PRODUÇÃO'}</span><b>{done?'Produção atualizada':failed?'Atualização com falha':attention?'Ação necessária':`Etapa ${activeIndex+1} de 4`}</b></div><strong>{overall}%</strong>
    </div>
    <div className="updates-cloud-track"><i style={{width:`${overall}%`}}/></div>
    <div className="updates-cloud-wizard-dots">
      {stages.map((stage,i)=><span key={stage.name} className={`${stage.state.tone==='ok'?'ok':''} ${i===activeIndex&&!done?'active':''} ${stage.state.tone==='bad'?'bad':''}`} title={`${stage.name}: ${stage.state.label}`}><i>{stage.state.tone==='ok'?'✓':i+1}</i><small>{stage.name}</small></span>)}
    </div>
    {done ? <div className="updates-cloud-finish">
      <div className="updates-cloud-finish-icon">✓</div>
      <h3>Atualização concluída</h3>
      <p>R2, GitHub, Vercel e Render confirmaram o fluxo desta versão.</p>
      <div className="updates-cloud-finish-list">{stages.map(s=><span key={s.name}>✓ {s.name}</span>)}</div>
    </div> : <div className="updates-cloud-current">
      <CloudStage number={current.number} name={current.name} subtitle={current.subtitle} state={current.state} meta={current.meta}>{current.children}</CloudStage>
      <div className="updates-cloud-current-caption">{completedCount} de 4 etapa(s) concluída(s). A próxima tela aparece automaticamente quando esta etapa terminar.</div>
    </div>}
    {job.error&&<div className="updates-cloud-error"><b>Falha da etapa:</b> {job.error}</div>}
    <CloudFailureReport job={job}/>
  </div>
}

function PublishProgressModal({job,onClose,onReconcile,onRetry,onRepublish,onInterrupt}){
  const canClose=['completed','failed','attention','restart-required','rolled-back'].includes(job.status)
  const cloud=job.type==='cloud-release'
  return <div className="updates-modal-overlay updates-progress-overlay" role="presentation" onMouseDown={e=>{if(canClose&&e.target===e.currentTarget)onClose?.()}}>
    <div className="updates-modal updates-progress-modal updates-cloud-progress-modal" role="dialog" aria-modal="true" aria-labelledby="publish-progress-title">
      <div className="updates-progress-head">
        <div>
          <div style={{fontSize:11,fontWeight:900,color:C.muted,letterSpacing:'.08em'}}>PUBLICAÇÃO CLOUD</div>
          <h2 id="publish-progress-title" style={{margin:'5px 0 3px',fontSize:20,color:C.text}}>{cloud?`Atualizando AL Sistemas${job.version?` ${job.version}`:''}`:'Publicação no GitHub'}</h2>
          <div style={{fontSize:12,color:C.muted,lineHeight:1.45}}>{cloud?'Acompanhe cada etapa separadamente: pacote, GitHub, frontend e backend.':'Acompanhe a criação e envio do commit.'}</div>
        </div>
        {canClose&&<button onClick={onClose} className="updates-progress-close" aria-label="Fechar">×</button>}
      </div>
      <div className="updates-progress-stepper"><UpdateWizardSteps managed step={job.status==='completed'?4:(job.commitSha||job.cloudRelease?.commitSha)?4:job.releaseId?3:2}/></div>
      {cloud?<><CloudPublishProgress job={job}/><div className="updates-cloud-filelog-wrap"><FileLiveLog job={job} cloud/></div></>:<UpdateProgress job={job} embedded/>}
      {cloud&&['attention','failed'].includes(job.status)&&job.releaseId&&<div className="updates-recovery-actions"><button onClick={()=>onReconcile?.(job.releaseId)}>Reconsultar</button><button onClick={()=>onRetry?.(job.releaseId)}>Tentar deploy novamente</button><button className="primary-blue" onClick={()=>onRepublish?.(job.releaseId)}>Publicar novamente do R2</button><button className="updates-delete-action" onClick={()=>onInterrupt?.(job.releaseId)}>Encerrar acompanhamento</button></div>}
      <div className="updates-progress-footer updates-progress-footer-clean">
        <span>{!canClose?(cloud?'Você pode acompanhar Vercel e Render nesta mesma tela; os estados são atualizados pelas APIs das plataformas.':'Mantenha esta tela aberta enquanto o commit é preparado.'):job.status==='completed'?'Atualização concluída. Use × no topo para fechar.':job.status==='failed'?'A atualização terminou com erro. Confira o relatório e use as ações de recuperação acima para tentar novamente.':job.status==='attention'?'O acompanhamento foi interrompido com segurança. Escolha uma ação de recuperação acima ou feche esta janela.':'Operação finalizada.'}</span>
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
  return <section className={embedded?'updates-progress-embedded':''} style={embedded?{borderTop:'1px solid var(--adm-border)',paddingTop:16}:{...card,borderColor:failed?C.red:done?C.greenSolid:C.accent}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
      <div>
        {!embedded&&<div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:'.04em'}}>{['github-publish','cloud-release'].includes(job.type)?'PUBLICAÇÃO CLOUD':'PROGRESSO DA ATUALIZAÇÃO'}</div>}
        <h2 style={{margin:'5px 0 2px',fontSize:19,color:C.text}}>{currentLabel}</h2>
        {!embedded&&<div style={{fontSize:12,color:C.muted}}>{['github-publish','cloud-release'].includes(job.type)?'R2 preserva o pacote; GitHub distribui o código; Vercel e Render concluem a produção.':'Acompanhe esta caixa até a operação terminar.'}</div>}
      </div>
      <strong style={{fontSize:22,color:failed?C.red:done?C.greenSolid:C.accent}}>{progress}%</strong>
    </div>
    <div style={{height:9,borderRadius:999,background:'var(--adm-surface2)',overflow:'hidden',margin:'14px 0'}}>
      <div style={{height:'100%',width:`${progress}%`,background:failed?C.red:done?C.greenSolid:C.accent,transition:'width .35s ease'}}/>
    </div>
    <FileLiveLog job={job}/>
    <div style={{display:'grid',gap:7}}>
      {recentTimeline.map((step,index)=>{
        const isLast=index===recentTimeline.length-1
        return <div key={`${step.at||index}-${step.key}`} style={{display:'grid',gridTemplateColumns:'18px minmax(0,1fr) auto',gap:8,alignItems:'center',fontSize:12}}>
          <span style={{color:isLast&&!done&&!failed?C.accent:C.greenSolid}}>{isLast&&!done&&!failed?'●':'✓'}</span>
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
    {job.commitUrl&&<div style={{marginTop:14,padding:11,borderRadius:9,background:'var(--adm-surface2)',fontSize:12}}><b style={{color:C.text}}>Commit publicado.</b> <a href={job.commitUrl} target="_blank" rel="noreferrer" style={{color:C.blue}}>Abrir no GitHub ↗</a><div style={{color:C.muted,marginTop:4}}>A Central acompanha automaticamente os deploys vinculados da Vercel e Render.</div></div>}
    <div className="updates-wrap" style={{fontSize:11,color:C.muted,marginTop:12}}>Job {job.id}</div>
  </section>
}
