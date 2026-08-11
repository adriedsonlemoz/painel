import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { infraestruturaService } from '../../../services/api'

const tone={
  green:'#16a34a', blue:'#2563eb', amber:'#d97706', red:'#dc2626',
  purple:'#7c3aed', muted:'var(--adm-muted)', text:'var(--adm-text)',
  surface:'var(--adm-surface)', surface2:'var(--adm-surface2)',
  border:'var(--adm-border)', bg:'var(--adm-bg)',
}

const ago=value=>{
  if(!value)return '—'
  const raw=typeof value==='number'?value:new Date(value).getTime()
  const diff=Math.max(0,Date.now()-raw)
  const m=Math.floor(diff/60000)
  if(m<1)return 'agora'
  if(m<60)return `${m} min`
  const h=Math.floor(m/60)
  if(h<24)return `${h} h`
  return `${Math.floor(h/24)} d`
}
const duration=seconds=>{
  if(!seconds)return ''
  if(seconds<60)return `${seconds}s`
  return `${Math.floor(seconds/60)}m ${seconds%60}s`
}
function stateInfo(value=''){
  const v=String(value||'').toUpperCase()
  if(['READY','LIVE','OPERATIONAL','DEPLOYED'].includes(v)||v.endsWith('_LIVE'))return {label:'Online',color:tone.green}
  if(['BUILDING','QUEUED','BUILD_IN_PROGRESS','UPDATE_IN_PROGRESS','PREPARING'].includes(v)||v.includes('BUILD'))return {label:'Em deploy',color:tone.blue}
  if(['ERROR','FAILED','MAJOR_OUTAGE','PARTIAL_OUTAGE'].includes(v)||v.includes('FAIL')||v.includes('ERROR'))return {label:'Erro',color:tone.red}
  if(['CANCELED','CANCELLED','DEACTIVATED','SUSPENDED'].includes(v)||v.includes('CANCEL'))return {label:'Parado',color:'#6b7280'}
  return {label:value||'Desconhecido',color:'#6b7280'}
}

function StatusPill({value}) {
  const info=stateInfo(value)
  return <span className="plat-pill" style={{color:info.color,borderColor:`${info.color}44`,background:`${info.color}0c`}}>● {info.label}</span>
}

function Modal({title,kicker,onClose,children,wide=false}) {
  return <div className="plat-overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose?.()}>
    <section className={`plat-modal ${wide?'wide':''}`} role="dialog" aria-modal="true">
      <header className="plat-modal-head"><div><small>{kicker}</small><h2>{title}</h2></div><button onClick={onClose}>×</button></header>
      {children}
    </section>
  </div>
}

function PlatformNode({kind,title,subtitle,status,url,deploy,onDeploys,onConfigure,onVariables,onLogs,onPrimaryAction,primaryActionLabel}) {
  const isVercel=kind==='vercel'
  return <article className={`plat-node ${kind}`}>
    <div className="plat-node-top">
      <div className="plat-brand">
        <span className="plat-logo">{isVercel?'▲':'R'}</span>
        <div><small>{isVercel?'FRONTEND':'BACKEND / API'}</small><h3>{title|| (isVercel?'Vercel não selecionada':'Render não selecionado')}</h3></div>
      </div>
      {status&&<StatusPill value={status}/>}
    </div>
    <p>{subtitle}</p>
    {url&&<a className="plat-url" href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//,'')} ↗</a>}
    {deploy&&<div className="plat-deploy">
      <div><small>ÚLTIMO DEPLOY</small><b>{deploy.commit?.mensagem||deploy.commit||'Deploy de produção'}</b></div>
      <div className="plat-deploy-meta">
        <StatusPill value={deploy.status||deploy.estado}/>
        <span>{ago(deploy.criado)}{deploy.duracao?` · ${duration(deploy.duracao)}`:''}</span>
      </div>
    </div>}
    <div className="plat-node-actions">
      {onPrimaryAction&&<button className="node-primary" onClick={onPrimaryAction}>{primaryActionLabel}</button>}
      {url&&<a href={url} target="_blank" rel="noreferrer">{isVercel?'Abrir portal':'Abrir API'}</a>}
      <button onClick={onDeploys}>Deploys</button>
      {onLogs&&<button onClick={onLogs}>Logs</button>}
      {onVariables&&<button onClick={onVariables}>Variáveis</button>}
      <button onClick={onConfigure}>Configurar</button>
    </div>
  </article>
}

function Problems({items,onAction}) {
  if(!items?.length)return <div className="plat-clear"><span>✓</span><div><b>Nenhum problema importante detectado</b><p>As conexões principais estão coerentes com a produção selecionada.</p></div></div>
  return <div className="plat-problems">{items.map(item=>{
    const color=item.nivel==='critical'||item.nivel==='error'?tone.red:item.nivel==='warning'?tone.amber:tone.blue
    return <article key={item.id} style={{borderColor:`${color}55`}}>
      <span className="plat-problem-mark" style={{color}}>!</span>
      <div><b>{item.titulo}</b><p>{item.descricao}</p></div>
      <button onClick={()=>onAction(item)}>Resolver / ver</button>
    </article>
  })}</div>
}

export default function AbaPlataformas(){
  const [data,setData]=useState(null)
  const [publicStatus,setPublicStatus]=useState(null)
  const [loading,setLoading]=useState(true)
  const [configOpen,setConfigOpen]=useState(false)
  const [keysOpen,setKeysOpen]=useState(false)
  const [deployPanel,setDeployPanel]=useState(null)
  const [envPanel,setEnvPanel]=useState(null)
  const [logsPanel,setLogsPanel]=useState(null)
  const [actionConfirm,setActionConfirm]=useState(null)
  const [actionBusy,setActionBusy]=useState(false)
  const [saving,setSaving]=useState(false)
  const [renderId,setRenderId]=useState('')
  const [vercelId,setVercelId]=useState('')
  const [origin,setOrigin]=useState('')

  const load=useCallback(async(silent=false)=>{
    if(!silent)setLoading(true)
    try{
      const [central,status]=await Promise.all([
        infraestruturaService.plataformasCentral(),
        infraestruturaService.plataformasStatus().catch(()=>null),
      ])
      setData(central);setPublicStatus(status)
      setRenderId(central.producao?.renderServiceId||central.render?.selecionado?.id||'')
      setVercelId(central.producao?.vercelProjectId||central.vercel?.selecionado?.id||'')
      setOrigin(central.producao?.frontendOrigin||'')
    }catch(e){toast.error(e.message)}
    finally{if(!silent)setLoading(false)}
  },[])

  useEffect(()=>{load()},[load])

  const selectedVercel=useMemo(()=>data?.vercel?.projetos?.find(x=>x.id===vercelId)||null,[data,vercelId])
  useEffect(()=>{
    if(!origin&&selectedVercel?.dominio)setOrigin(`https://${selectedVercel.dominio}`)
  },[selectedVercel,origin])

  async function saveProduction(){
    if(!renderId||!vercelId)return toast.error('Selecione Render e Vercel.')
    setSaving(true)
    try{
      const r=await infraestruturaService.salvarProducaoPlataformas(renderId,vercelId,origin)
      toast.success(r.mensagem||'Produção conectada.')
      setConfigOpen(false)
      await load(true)
    }catch(e){toast.error(e.message)}
    finally{setSaving(false)}
  }

  async function refreshOrigins(){
    try{
      await infraestruturaService.recarregarOrigensPlataformas()
      toast.success('Origens da Vercel sincronizadas com o backend.')
      await load(true)
    }catch(e){toast.error(e.message)}
  }

  async function openVariables(kind){
    const target=kind==='render'?data?.render?.selecionado:data?.vercel?.selecionado
    if(!target)return toast.error(`Selecione ${kind==='render'?'um serviço Render':'um projeto Vercel'} primeiro.`)
    setEnvPanel({kind,title:`Variáveis · ${target.nome}`,loading:true,items:[],key:'',value:''})
    try{
      const r=kind==='render'
        ? await infraestruturaService.renderVariaveis(target.id)
        : await infraestruturaService.vercelVariaveis(target.id)
      setEnvPanel(p=>({...p,loading:false,items:r.env||[]}))
    }catch(e){
      setEnvPanel(p=>({...p,loading:false,error:e.message}))
    }
  }

  async function saveRenderVariable({deployAfter=false}={}){
    const key=String(envPanel?.key||'').trim()
    const value=String(envPanel?.value||'')
    const service=data?.render?.selecionado
    if(!service)return
    if(!key||!value)return toast.error('Informe nome e valor da variável.')
    setActionBusy(true)
    try{
      const r=await infraestruturaService.renderSalvarVariavel(service.id,key,value)
      toast.success(r.mensagem||'Variável salva.')
      const vars=await infraestruturaService.renderVariaveis(service.id)
      setEnvPanel(p=>({...p,items:vars.env||[],key:'',value:''}))
      if(deployAfter){
        const d=await infraestruturaService.renderDeploy(service.id)
        toast.success(d.mensagem||'Deploy iniciado.')
        setEnvPanel(null)
        await load(true)
      }
    }catch(e){toast.error(e.message)}
    finally{setActionBusy(false)}
  }

  async function openPlatformLogs(kind,deploymentId=''){
    const target=kind==='render'?data?.render?.selecionado:data?.vercel?.selecionado
    if(!target)return
    setLogsPanel({kind,title:`Logs · ${target.nome}`,loading:true,items:[]})
    try{
      const r=kind==='render'
        ? await infraestruturaService.renderLogs(target.id)
        : await infraestruturaService.vercelDeployLogs(deploymentId)
      setLogsPanel(p=>({...p,loading:false,items:r.logs||[]}))
    }catch(e){setLogsPanel(p=>({...p,loading:false,error:e.message}))}
  }

  async function executePlatformAction(){
    const action=actionConfirm
    if(!action)return
    const service=data?.render?.selecionado
    if(!service)return
    setActionBusy(true)
    try{
      let r
      if(action.type==='deploy')r=await infraestruturaService.renderDeploy(service.id,{clearCache:Boolean(action.clearCache)})
      if(action.type==='restart')r=await infraestruturaService.renderRestart(service.id)
      if(action.type==='rollback')r=await infraestruturaService.renderRollback(service.id,action.deployId)
      if(action.type==='cancel')r=await infraestruturaService.renderCancelarDeploy(service.id,action.deployId)
      toast.success(r?.mensagem||'Ação enviada à Render.')
      setActionConfirm(null)
      setDeployPanel(null)
      await new Promise(resolve=>setTimeout(resolve,650))
      await load(true)
    }catch(e){toast.error(e.message)}
    finally{setActionBusy(false)}
  }

  function confirmRenderDeploy(clearCache=false){
    setActionConfirm({
      type:'deploy',clearCache,
      title:clearCache?'Novo deploy limpando cache?':'Iniciar novo deploy?',
      message:clearCache
        ? 'A Render descartará o cache de build e reconstruirá o backend a partir do repositório conectado.'
        : 'A Render criará um novo deploy usando o commit mais recente da branch conectada.',
      button:clearCache?'Deploy sem cache':'Iniciar deploy',
    })
  }

  function problemAction(item){
    if(item.acao==='conectar-producao')return setConfigOpen(true)
    if(item.acao==='integracoes')return window.location.assign('/admin/integracoes')
    if(item.acao==='erros')return window.location.assign('/admin/erros')
    if(item.acao==='docs-render')return window.open(data?.acoes?.docsRender,'_blank','noopener')
    if(item.acao==='docs-vercel')return window.open(data?.acoes?.docsVercel,'_blank','noopener')
    if(item.acao==='render')return setDeployPanel({title:'Deploys Render',kind:'render',items:data?.render?.deploys||[]})
    if(item.acao==='vercel')return setDeployPanel({title:'Deploys Vercel',kind:'vercel',items:data?.vercel?.deploys||[]})
  }

  if(loading)return <div className="plat-loading">Sincronizando Render, Vercel e produção…</div>
  if(!data)return <div className="plat-loading">Não foi possível carregar a Central de Plataformas.</div>

  const rd=data.render?.selecionado
  const vc=data.vercel?.selecionado
  const rdDeploy=data.render?.deploys?.[0]
  const vcDeploy=data.vercel?.deploys?.[0]
  const renderPublic=publicStatus?.render
  const vercelPublic=publicStatus?.vercel

  return <div className="platform-center">
    <section className="plat-hero">
      <div>
        <small>AL SISTEMAS · PRODUÇÃO</small>
        <h2>{data.producao?.ligada?'Produção conectada':'Conecte sua produção'}</h2>
        <p>O painel trata Vercel como frontend, Render como API e MongoDB como fonte persistente dos dados.</p>
      </div>
      <div className={`plat-production-state ${data.producao?.ligada&&data.producao?.corsOk?'ok':'warn'}`}>
        <span>{data.producao?.ligada&&data.producao?.corsOk?'●':'○'}</span>
        <div><b>{data.producao?.ligada&&data.producao?.corsOk?'PORTAL ONLINE':'CONFIGURAÇÃO PENDENTE'}</b><small>{data.sincronizadoEm?`sincronizado ${ago(data.sincronizadoEm)}`:'—'}</small></div>
      </div>
    </section>

    <section className="plat-topology">
      <div className="plat-flow-node"><span>▲</span><div><small>FRONTEND</small><b>Vercel</b></div></div>
      <div className="plat-flow-line"><i></i><small>HTTPS</small></div>
      <div className="plat-flow-node"><span>R</span><div><small>API</small><b>Render</b></div></div>
      <div className="plat-flow-line"><i></i><small>Mongo</small></div>
      <div className="plat-flow-node"><span>DB</span><div><small>DADOS + GRIDFS</small><b>MongoDB</b></div></div>
    </section>

    <section className="plat-command">
      <button className="primary" onClick={()=>window.location.assign('/admin/atualizacoes?acao=nova')}>⬆ Atualizar portal</button>
      <button onClick={()=>setConfigOpen(true)}>Conectar produção</button>
      <button onClick={()=>setKeysOpen(true)}>Ver acessos</button>
      <button onClick={refreshOrigins}>Sincronizar URLs</button>
      <button onClick={()=>load()} className="ghost">↻ Atualizar</button>
    </section>

    <section className="plat-grid">
      <PlatformNode
        kind="vercel" title={vc?.nome}
        subtitle={vc?`${vc.framework||'Projeto web'}${vc.git?.repositorio?` · ${vc.git.repositorio}`:''}`:'Escolha qual projeto Vercel representa o portal público.'}
        status={vcDeploy?.estado} url={data.producao?.frontendOrigin||vcDeploy?.url} deploy={vcDeploy}
        onDeploys={()=>setDeployPanel({title:'Deploys Vercel',kind:'vercel',items:data.vercel?.deploys||[]})}
        onVariables={()=>openVariables('vercel')} onConfigure={()=>setConfigOpen(true)}
        onPrimaryAction={()=>window.location.assign('/admin/atualizacoes?acao=nova')} primaryActionLabel="Atualizar portal"
      />
      <PlatformNode
        kind="render" title={rd?.nome}
        subtitle={rd?`${rd.tipo||'Web Service'}${rd.regiao?` · ${rd.regiao}`:''}${rd.branch?` · ${rd.branch}`:''}`:'Escolha qual serviço Render executa a API do AL Sistemas.'}
        status={rdDeploy?.status||rd?.estado} url={data.producao?.backendUrl||rd?.url} deploy={rdDeploy}
        onDeploys={()=>setDeployPanel({title:'Deploys Render',kind:'render',items:data.render?.deploys||[]})}
        onVariables={()=>openVariables('render')} onLogs={()=>openPlatformLogs('render')} onConfigure={()=>setConfigOpen(true)}
        onPrimaryAction={()=>confirmRenderDeploy(false)} primaryActionLabel="Deploy agora"
      />
    </section>

    <section className="plat-insight-grid">
      <article className="plat-insight">
        <small>CONEXÃO DO PORTAL</small>
        <b>{data.producao?.corsOk?'Vercel autorizada pela API':'Origem ainda não validada'}</b>
        <p>{data.producao?.frontendOrigin||'Defina o frontend de produção para o backend reconhecer a origem automaticamente.'}</p>
        <span className={data.producao?.corsOk?'good':'warn'}>{data.producao?.corsOk?'✓ CORS sincronizado':'! precisa de atenção'}</span>
      </article>
      <article className="plat-insight">
        <small>STATUS DAS PLATAFORMAS</small>
        <b>{renderPublic?.descricao||'Render'} · {vercelPublic?.descricao||'Vercel'}</b>
        <p>{(renderPublic?.incidentes?.length||0)+(vercelPublic?.incidentes?.length||0)} incidente(s) público(s) ativo(s).</p>
        <span className="good">Monitor oficial</span>
      </article>
      <article className="plat-insight">
        <small>ARMAZENAMENTO</small>
        <b>MongoDB + GridFS</b>
        <p>Arquivos persistentes do portal não precisam depender do disco temporário do Render.</p>
        <span className="good">Persistente</span>
      </article>
    </section>

    <section className="plat-section">
      <div className="plat-section-head"><div><small>DIAGNÓSTICO</small><h3>O que precisa da sua atenção</h3></div><a href="/admin/erros">Abrir Monitor de Erros →</a></div>
      <Problems items={data.problemas} onAction={problemAction}/>
    </section>

    <section className="plat-section plat-credentials-strip">
      <div><small>RENDER API</small><b>{data.credenciais?.render?.configurado?'Conectada':'Não configurada'}</b><span>{data.credenciais?.render?.mascarada||'—'} · {data.credenciais?.render?.origem||'sem origem'}</span></div>
      <div><small>VERCEL API</small><b>{data.credenciais?.vercel?.configurado?'Conectada':'Não configurada'}</b><span>{data.credenciais?.vercel?.mascarada||'—'} · {data.credenciais?.vercel?.origem||'sem origem'}</span></div>
      <a href="/admin/integracoes">Gerenciar em Integrações e APIs →</a>
    </section>

    {configOpen&&<Modal kicker="PRODUÇÃO" title="Conectar Vercel → Render" onClose={()=>setConfigOpen(false)}>
      <p className="plat-modal-copy">Escolha quais recursos representam o portal. Essa ligação passa a orientar CORS, diagnóstico, links e publicação.</p>
      <label className="plat-field">Frontend na Vercel
        <select value={vercelId} onChange={e=>{setVercelId(e.target.value);setOrigin('')}}>
          <option value="">Selecione…</option>
          {(data.vercel?.projetos||[]).map(x=><option key={x.id} value={x.id}>{x.nome}{x.dominio?` · ${x.dominio}`:''}</option>)}
        </select>
      </label>
      <label className="plat-field">Backend na Render
        <select value={renderId} onChange={e=>setRenderId(e.target.value)}>
          <option value="">Selecione…</option>
          {(data.render?.servicos||[]).map(x=><option key={x.id} value={x.id}>{x.nome}{x.regiao?` · ${x.regiao}`:''}</option>)}
        </select>
      </label>
      <label className="plat-field">URL pública do portal
        <input value={origin} onChange={e=>setOrigin(e.target.value)} placeholder="https://meuportal.vercel.app"/>
        <small>Normalmente detectada automaticamente pelo projeto Vercel.</small>
      </label>
      <div className="plat-create-links"><a href={data.acoes?.criarVercel} target="_blank" rel="noreferrer">+ Criar projeto na Vercel ↗</a><a href={data.acoes?.criarRender} target="_blank" rel="noreferrer">+ Criar serviço na Render ↗</a></div>
      <div className="plat-modal-actions"><button onClick={()=>setConfigOpen(false)}>Cancelar</button><button className="primary" disabled={saving} onClick={saveProduction}>{saving?'Salvando…':'Conectar produção'}</button></div>
    </Modal>}

    {keysOpen&&<Modal kicker="ACESSOS" title="Credenciais das plataformas" onClose={()=>setKeysOpen(false)}>
      <p className="plat-modal-copy">Por segurança o painel confirma a existência e a origem das chaves, mas não revela o segredo completo.</p>
      {[['Render',data.credenciais?.render],['Vercel',data.credenciais?.vercel]].map(([name,c])=><div className="plat-key-row" key={name}><div><b>{name}</b><small>{c?.configurado?'Credencial disponível':'Não configurada'}</small></div><code>{c?.mascarada||'—'}</code><span>{c?.origem||'—'}</span></div>)}
      <div className="plat-modal-actions"><a href="/admin/integracoes">Abrir Integrações e APIs</a><button onClick={()=>setKeysOpen(false)}>Fechar</button></div>
    </Modal>}

    {deployPanel&&<Modal kicker="DEPLOYS" title={deployPanel.title} wide onClose={()=>setDeployPanel(null)}>
      {!deployPanel.items.length?<div className="plat-empty">Nenhum deploy encontrado.</div>:<div className="plat-deploy-list">{deployPanel.items.map((d,index)=>{
        const st=d.status||d.estado
        const running=['BUILDING','QUEUED','BUILD_IN_PROGRESS','UPDATE_IN_PROGRESS'].includes(String(st||'').toUpperCase())
        return <article key={d.id}>
          <div><StatusPill value={st}/><b>{d.commit?.mensagem||d.commit||'Deploy'}</b><small>{d.branch?`${d.branch} · `:''}{ago(d.criado)}{d.duracao?` · ${duration(d.duracao)}`:''}{d.hash?` · ${d.hash}`:''}</small></div>
          <div className="plat-deploy-actions">
            {d.url&&<a href={d.url} target="_blank" rel="noreferrer">Abrir ↗</a>}
            {deployPanel.kind==='vercel'&&<button onClick={()=>openPlatformLogs('vercel',d.id)}>Logs</button>}
            {deployPanel.kind==='render'&&running&&<button onClick={()=>setActionConfirm({type:'cancel',deployId:d.id,title:'Cancelar este deploy?',message:'A Render tentará interromper o deploy que ainda está em andamento.',button:'Cancelar deploy'})}>Cancelar</button>}
            {deployPanel.kind==='render'&&index>0&&!running&&<button onClick={()=>setActionConfirm({type:'rollback',deployId:d.id,title:'Voltar para este deploy?',message:'A Render criará um rollback para esta versão anterior. O autodeploy continuará habilitado.',button:'Fazer rollback'})}>Rollback</button>}
          </div>
        </article>
      })}</div>}
      <div className="plat-modal-actions">
        <button onClick={()=>setDeployPanel(null)}>Fechar</button>
        {deployPanel.kind==='render'&&<button onClick={()=>setActionConfirm({type:'restart',title:'Reiniciar o backend?',message:'A Render reiniciará o serviço atual sem criar um novo commit. Use quando o código está correto, mas o processo precisa ser reiniciado.',button:'Reiniciar serviço'})}>Reiniciar serviço</button>}
        {deployPanel.kind==='render'&&<button onClick={()=>confirmRenderDeploy(true)}>Deploy limpando cache</button>}
        <button className="primary" onClick={()=>window.location.assign('/admin/atualizacoes?acao=nova')}>Atualizar portal</button>
      </div>
    </Modal>}

    {envPanel&&<Modal kicker="CONFIGURAÇÃO" title={envPanel.title} wide onClose={()=>setEnvPanel(null)}>
      <p className="plat-modal-copy">
        Os valores sensíveis ficam mascarados. {envPanel.kind==='render'
          ? 'Na Render, você pode criar ou substituir uma variável aqui; a mudança só entra na aplicação após um novo deploy.'
          : 'Na Vercel, esta tela inspeciona nomes, ambientes e estado das variáveis. Alterações continuam protegidas pela configuração do projeto.'}
      </p>
      {envPanel.loading?<div className="plat-empty">Consultando variáveis…</div>:envPanel.error?<div className="plat-error">{envPanel.error}</div>:
        <div className="plat-env-list">{envPanel.items.length?envPanel.items.map(item=><div className="plat-env-row" key={`${item.id||''}-${item.key}`}>
          <div><b>{item.key}</b><small>{item.target?.length?item.target.join(' · '):envPanel.kind==='render'?'serviço':'projeto'}{item.gitBranch?` · ${item.gitBranch}`:''}</small></div>
          <code>{item.valueMasked||'protegida'}</code>
        </div>):<div className="plat-empty">Nenhuma variável encontrada.</div>}</div>
      }
      {envPanel.kind==='render'&&<section className="plat-env-editor">
        <div><small>CRIAR OU SUBSTITUIR</small><b>Variável do serviço</b></div>
        <div className="plat-env-inputs"><input value={envPanel.key||''} onChange={e=>setEnvPanel(p=>({...p,key:e.target.value.toUpperCase()}))} placeholder="NOME_DA_VARIAVEL"/><input type="password" value={envPanel.value||''} onChange={e=>setEnvPanel(p=>({...p,value:e.target.value}))} placeholder="Novo valor"/></div>
        <div className="plat-modal-actions"><button disabled={actionBusy} onClick={()=>saveRenderVariable()}>{actionBusy?'Salvando…':'Salvar'}</button><button className="primary" disabled={actionBusy} onClick={()=>saveRenderVariable({deployAfter:true})}>Salvar e fazer deploy</button></div>
      </section>}
      <div className="plat-modal-actions"><button onClick={()=>setEnvPanel(null)}>Fechar</button></div>
    </Modal>}

    {logsPanel&&<Modal kicker="OBSERVABILIDADE" title={logsPanel.title} wide onClose={()=>setLogsPanel(null)}>
      <p className="plat-modal-copy">Linhas mais recentes retornadas pela API da plataforma. Use esta visão para localizar falhas sem sair do AL Sistemas.</p>
      {logsPanel.loading?<div className="plat-empty">Buscando logs…</div>:logsPanel.error?<div className="plat-error">{logsPanel.error}</div>:
        <div className="plat-log-view">{logsPanel.items.length?logsPanel.items.map(log=><div key={log.id} className={`plat-log-line ${String(log.tipo||log.nivel||'').toLowerCase()}`}>
          <span>{log.criado?ago(log.criado):'•'}</span><code>{log.texto||'evento sem mensagem'}</code>{log.statusCode&&<b>{log.statusCode}</b>}
        </div>):<div className="plat-empty">Nenhuma linha de log disponível para esta consulta.</div>}</div>
      }
      <div className="plat-modal-actions"><button onClick={()=>setLogsPanel(null)}>Fechar</button></div>
    </Modal>}

    {actionConfirm&&<Modal kicker="CONFIRMAÇÃO" title={actionConfirm.title} onClose={()=>!actionBusy&&setActionConfirm(null)}>
      <p className="plat-modal-copy">{actionConfirm.message}</p>
      <div className="plat-modal-actions"><button disabled={actionBusy} onClick={()=>setActionConfirm(null)}>Voltar</button><button className="primary" disabled={actionBusy} onClick={executePlatformAction}>{actionBusy?'Enviando…':actionConfirm.button||'Confirmar'}</button></div>
    </Modal>}

    <style>{`
      .platform-center{display:grid;gap:14px;min-width:0}.plat-loading{padding:45px 12px;text-align:center;color:var(--adm-muted)}
      .plat-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:4px 2px}.plat-hero small,.plat-section-head small,.plat-insight small,.plat-credentials-strip small{font-size:9px;font-weight:900;letter-spacing:.14em;color:var(--adm-muted)}.plat-hero h2{margin:4px 0 5px;font-size:28px;letter-spacing:-.04em;color:var(--adm-text)}.plat-hero p{margin:0;max-width:680px;color:var(--adm-muted);font-size:13px;line-height:1.5}
      .plat-production-state{display:flex;gap:9px;align-items:center;border:1px solid var(--adm-border);border-radius:14px;padding:10px 12px;background:var(--adm-surface);flex:0 0 auto}.plat-production-state>span{font-size:18px}.plat-production-state>div{display:grid;gap:2px}.plat-production-state b{font-size:10px;letter-spacing:.08em}.plat-production-state small{font-size:9px;color:var(--adm-muted)}.plat-production-state.ok>span,.plat-production-state.ok b{color:#16a34a}.plat-production-state.warn>span,.plat-production-state.warn b{color:#d97706}
      .plat-topology{display:grid;grid-template-columns:minmax(0,1fr) 70px minmax(0,1fr) 70px minmax(0,1fr);align-items:center;border:1px solid var(--adm-border);border-radius:16px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));padding:14px;overflow:hidden}.plat-flow-node{display:flex;align-items:center;gap:10px;min-width:0}.plat-flow-node>span{width:38px;height:38px;border:1px solid var(--adm-border);border-radius:11px;display:grid;place-items:center;font-weight:900;color:#2563eb;background:var(--adm-bg)}.plat-flow-node>div{display:grid;gap:2px;min-width:0}.plat-flow-node small{font-size:8px;color:var(--adm-muted);font-weight:900;letter-spacing:.11em}.plat-flow-node b{font-size:13px;color:var(--adm-text)}.plat-flow-line{display:grid;justify-items:center;gap:3px}.plat-flow-line i{width:100%;height:1px;background:linear-gradient(90deg,var(--adm-border),#2563eb66,var(--adm-border))}.plat-flow-line small{font-size:7px;color:var(--adm-muted);letter-spacing:.08em}
      .plat-command{display:flex;gap:8px;flex-wrap:wrap}.plat-command button,.plat-command a,.plat-node-actions button,.plat-node-actions a,.plat-problems button,.plat-modal-actions button,.plat-modal-actions a{border:1px solid var(--adm-border);border-radius:9px;padding:9px 12px;background:var(--adm-surface);color:var(--adm-text);font-size:11px;font-weight:800;text-decoration:none;cursor:pointer}.plat-command .primary,.plat-modal-actions .primary{background:#2563eb;color:#fff;border-color:#2563eb}.plat-command .ghost{margin-left:auto}
      .plat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.plat-node{border:1px solid var(--adm-border);border-radius:16px;padding:16px;background:var(--adm-surface);min-width:0}.plat-node.vercel{border-top:3px solid #111827}.plat-node.render{border-top:3px solid #7c3aed}.plat-node-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.plat-brand{display:flex;gap:10px;align-items:center;min-width:0}.plat-logo{width:38px;height:38px;border-radius:11px;border:1px solid var(--adm-border);display:grid;place-items:center;background:var(--adm-bg);font-weight:900;color:var(--adm-text)}.plat-brand>div{min-width:0}.plat-brand small{font-size:8px;font-weight:900;letter-spacing:.12em;color:var(--adm-muted)}.plat-brand h3{margin:2px 0 0;font-size:17px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plat-node>p{font-size:11px;color:var(--adm-muted);line-height:1.45;margin:10px 0 5px}.plat-url{font-size:10px;color:#2563eb;text-decoration:none;overflow-wrap:anywhere}.plat-pill{display:inline-flex;align-items:center;border:1px solid;border-radius:999px;padding:4px 7px;font-size:9px;font-weight:850;white-space:nowrap}.plat-deploy{margin-top:13px;padding:10px;border-radius:11px;background:var(--adm-surface2);border:1px solid var(--adm-border);display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.plat-deploy>div:first-child{display:grid;gap:3px;min-width:0}.plat-deploy small{font-size:8px;color:var(--adm-muted);font-weight:900;letter-spacing:.08em}.plat-deploy b{font-size:11px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plat-deploy-meta{display:grid;justify-items:end;gap:4px}.plat-deploy-meta>span:last-child{font-size:9px;color:var(--adm-muted)}.plat-node-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.plat-node-actions button,.plat-node-actions a{padding:7px 9px;font-size:10px}.plat-node-actions .node-primary{background:#2563eb;color:#fff;border-color:#2563eb}
      .plat-insight-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.plat-insight{border:1px solid var(--adm-border);border-radius:13px;padding:13px;background:var(--adm-surface);display:grid;gap:5px}.plat-insight b{font-size:13px;color:var(--adm-text)}.plat-insight p{font-size:10px;color:var(--adm-muted);line-height:1.45;margin:0;overflow-wrap:anywhere}.plat-insight>span{font-size:9px;font-weight:850;width:max-content}.plat-insight .good{color:#16a34a}.plat-insight .warn{color:#d97706}
      .plat-section{border:1px solid var(--adm-border);border-radius:15px;background:var(--adm-surface);padding:15px}.plat-section-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;margin-bottom:11px}.plat-section-head h3{margin:3px 0 0;font-size:16px;color:var(--adm-text)}.plat-section-head a{font-size:10px;color:#2563eb;text-decoration:none}.plat-clear{display:flex;gap:10px;align-items:flex-start;padding:12px;border-radius:11px;background:#16a34a0a;border:1px solid #16a34a44}.plat-clear>span{color:#16a34a;font-weight:900}.plat-clear b{font-size:12px;color:var(--adm-text)}.plat-clear p{font-size:10px;color:var(--adm-muted);margin:3px 0 0}.plat-problems{display:grid;gap:8px}.plat-problems article{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:9px;align-items:center;border:1px solid;border-radius:11px;padding:10px;background:var(--adm-surface2)}.plat-problem-mark{font-size:17px;font-weight:900}.plat-problems b{font-size:11px;color:var(--adm-text)}.plat-problems p{font-size:10px;color:var(--adm-muted);margin:2px 0 0;line-height:1.4}.plat-problems button{padding:6px 8px;font-size:9px}
      .plat-credentials-strip{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:center}.plat-credentials-strip>div{display:grid;gap:2px}.plat-credentials-strip b{font-size:11px;color:var(--adm-text)}.plat-credentials-strip span{font-size:9px;color:var(--adm-muted)}.plat-credentials-strip>a{font-size:10px;color:#2563eb;text-decoration:none}
      .plat-overlay{position:fixed;inset:0;z-index:1400;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(15,23,42,.42);backdrop-filter:blur(3px)}.plat-modal{width:min(100%,560px);max-height:calc(100dvh - 24px);overflow:auto;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:18px;padding:18px;box-shadow:0 25px 80px rgba(15,23,42,.28)}.plat-modal.wide{width:min(100%,760px)}.plat-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.plat-modal-head small{font-size:9px;color:var(--adm-muted);letter-spacing:.13em;font-weight:900}.plat-modal-head h2{margin:4px 0 0;color:var(--adm-text);font-size:20px}.plat-modal-head button{width:32px;height:32px;border-radius:9px;border:1px solid var(--adm-border);background:var(--adm-surface2);color:var(--adm-text);font-size:20px}.plat-modal-copy{font-size:11px;color:var(--adm-muted);line-height:1.5}.plat-field{display:block;font-size:11px;font-weight:800;color:var(--adm-text);margin-top:11px}.plat-field select,.plat-field input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-bg);color:var(--adm-text)}.plat-field small{display:block;margin-top:4px;color:var(--adm-muted);font-weight:400}.plat-create-links{display:flex;gap:10px;flex-wrap:wrap;margin-top:13px}.plat-create-links a{font-size:10px;color:#2563eb;text-decoration:none}.plat-modal-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:16px}.plat-key-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:9px;align-items:center;padding:10px 0;border-top:1px solid var(--adm-border)}.plat-key-row:first-of-type{border-top:0}.plat-key-row>div{display:grid}.plat-key-row b{font-size:12px;color:var(--adm-text)}.plat-key-row small,.plat-key-row span{font-size:9px;color:var(--adm-muted)}.plat-key-row code{font-size:10px;color:var(--adm-text);background:var(--adm-surface2);padding:5px 7px;border-radius:7px}.plat-deploy-list{display:grid;gap:7px}.plat-deploy-list article{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px;border-radius:10px;border:1px solid var(--adm-border);background:var(--adm-surface2)}.plat-deploy-list article>div{display:grid;gap:4px;min-width:0}.plat-deploy-list b{font-size:11px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plat-deploy-list small{font-size:9px;color:var(--adm-muted)}.plat-deploy-list a{font-size:10px;color:#2563eb;text-decoration:none}.plat-deploy-actions{display:flex!important;grid-auto-flow:column;gap:6px!important;align-items:center}.plat-deploy-actions button,.plat-deploy-actions a{border:1px solid var(--adm-border);border-radius:7px;padding:5px 7px;background:var(--adm-surface);font-size:9px;color:var(--adm-text);cursor:pointer;text-decoration:none}.plat-empty{padding:14px;border:1px solid var(--adm-border);border-radius:10px;color:var(--adm-muted);font-size:11px}.plat-error{padding:11px;border:1px solid #dc262655;border-radius:10px;background:#dc26260a;color:#dc2626;font-size:11px}.plat-env-list{display:grid;border:1px solid var(--adm-border);border-radius:11px;overflow:hidden}.plat-env-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:9px 11px;background:var(--adm-surface2);border-top:1px solid var(--adm-border)}.plat-env-row:first-child{border-top:0}.plat-env-row>div{display:grid;gap:2px;min-width:0}.plat-env-row b{font-size:11px;color:var(--adm-text);overflow-wrap:anywhere}.plat-env-row small{font-size:8px;color:var(--adm-muted)}.plat-env-row code{font-size:9px;color:var(--adm-muted);white-space:nowrap}.plat-env-editor{margin-top:13px;padding:12px;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-surface2)}.plat-env-editor>div:first-child{display:grid;gap:2px}.plat-env-editor small{font-size:8px;letter-spacing:.12em;font-weight:900;color:var(--adm-muted)}.plat-env-editor b{font-size:12px;color:var(--adm-text)}.plat-env-inputs{display:grid;grid-template-columns:minmax(0,.75fr) minmax(0,1.25fr);gap:8px;margin-top:9px}.plat-env-inputs input{min-width:0;padding:9px 10px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-bg);color:var(--adm-text)}.plat-log-view{max-height:58vh;overflow:auto;border:1px solid var(--adm-border);border-radius:11px;background:#0b1220;padding:8px}.plat-log-line{display:grid;grid-template-columns:46px minmax(0,1fr) auto;gap:8px;padding:6px;border-top:1px solid rgba(255,255,255,.06);align-items:start}.plat-log-line:first-child{border-top:0}.plat-log-line>span{font:500 8px/1.4 monospace;color:#7f8da3}.plat-log-line code{white-space:pre-wrap;overflow-wrap:anywhere;font:500 9px/1.45 monospace;color:#d5deea}.plat-log-line>b{font-size:8px;color:#f59e0b}
      @media(max-width:760px){.plat-hero{display:grid}.plat-production-state{width:max-content}.plat-topology{grid-template-columns:1fr 30px 1fr 30px 1fr;padding:10px}.plat-flow-node{display:grid;justify-items:center;text-align:center;gap:5px}.plat-flow-node>span{width:34px;height:34px}.plat-flow-node b{font-size:10px}.plat-flow-node small{font-size:7px}.plat-flow-line small{display:none}.plat-grid{grid-template-columns:1fr}.plat-insight-grid{grid-template-columns:1fr}.plat-credentials-strip{grid-template-columns:1fr 1fr}.plat-credentials-strip>a{grid-column:1/-1}.plat-command .ghost{margin-left:0}}
      @media(max-width:500px){.plat-env-inputs{grid-template-columns:1fr}.plat-deploy-actions{flex-wrap:wrap;justify-content:flex-start}.plat-log-line{grid-template-columns:36px minmax(0,1fr)}.plat-log-line>b{grid-column:2}.plat-hero h2{font-size:24px}.plat-command{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.plat-command button{width:100%}.plat-topology{gap:3px}.plat-flow-node>span{width:30px;height:30px;font-size:9px}.plat-problems article{grid-template-columns:22px minmax(0,1fr)}.plat-problems button{grid-column:2}.plat-credentials-strip{grid-template-columns:1fr}.plat-key-row{grid-template-columns:1fr auto}.plat-key-row>span{grid-column:1/-1}.plat-modal{padding:15px}}
    `}</style>
  </div>
}
