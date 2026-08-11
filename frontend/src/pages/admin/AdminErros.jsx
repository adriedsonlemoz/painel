import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import ConfirmModal from '../../components/ConfirmModal'
import { errosService } from '../../services/api'
import { DSBadge, DSModal } from '../../components/admin/ui/DS'
import { T, SPACE, RADIUS, FONT } from '../../themes/tokens'
import { formatarDataRelativa } from '../../utils/formatters'

const SOURCES=[
  {key:'',label:'Todos'}, {key:'al',label:'AL'}, {key:'github',label:'GitHub'},
  {key:'vercel',label:'Vercel'}, {key:'render',label:'Render'}, {key:'mongo',label:'MongoDB'},
]
const STATUS={novo:'Novo',acompanhando:'Acompanhando',revisado:'Revisado',silenciado:'Silenciado'}
const sourceLabel={al:'AL Sistemas',github:'GitHub Actions',vercel:'Vercel',render:'Render',mongo:'MongoDB'}
const sourceIcon={al:'◆',github:'◈',vercel:'▲',render:'R',mongo:'DB'}
const severityColor={critical:T.red,warning:T.amberSolid||'#d97706',info:T.blue,ok:T.greenSolid}

function SourceSummary({item}){
  const state=item.configured===false?'Não configurado':item.ok===true?'Saudável':item.ok===false?'Atenção':'—'
  const variant=item.configured===false?'gray':item.ok===true?'green':item.ok===false?'red':'gray'
  return <div className="adm-card" style={{padding:SPACE.md,minWidth:0}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:SPACE.sm,alignItems:'center'}}>
      <strong style={{fontSize:FONT.base,minWidth:0}}>{item.label}</strong><DSBadge variant={variant}>{state}</DSBadge>
    </div>
    <div style={{fontSize:FONT.sm,color:'var(--adm-muted)',marginTop:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.summary}</div>
  </div>
}

function EventCard({event,selected,onSelect,onOpen}){
  const color=severityColor[event.severity]||T.blue
  return <article className="adm-card" style={{padding:SPACE.lg,display:'grid',gridTemplateColumns:'auto 1fr auto',gap:SPACE.md,alignItems:'start',minWidth:0}}>
    <input type="checkbox" checked={selected} onChange={()=>onSelect(event)} style={{marginTop:4,width:16,height:16}} />
    <button onClick={()=>onOpen(event)} style={{border:0,background:'transparent',padding:0,textAlign:'left',cursor:'pointer',minWidth:0,color:'inherit'}}>
      <div style={{display:'flex',alignItems:'center',gap:SPACE.sm,flexWrap:'wrap'}}>
        <span style={{width:28,height:28,borderRadius:9,display:'inline-grid',placeItems:'center',background:`${color}18`,color,fontWeight:900,fontSize:FONT.sm}}>{sourceIcon[event.source]||'!'}</span>
        <strong style={{fontSize:FONT.md,color:'var(--adm-text)',minWidth:0,overflowWrap:'anywhere'}}>{event.title}</strong>
        <DSBadge variant={event.severity==='critical'?'red':event.severity==='warning'?'amber':'blue'}>{sourceLabel[event.source]||event.source}</DSBadge>
      </div>
      <div style={{marginTop:7,color:'var(--adm-muted)',fontSize:FONT.base,lineHeight:1.45,overflowWrap:'anywhere'}}>{event.message}</div>
      <div style={{marginTop:7,display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',color:'var(--adm-muted)',fontSize:FONT.sm}}><span>{event.createdAt?formatarDataRelativa(event.createdAt):'agora'}</span>{event.triage?.status&&event.triage.status!=='novo'&&<DSBadge variant={event.triage.status==='silenciado'?'gray':event.triage.status==='revisado'?'green':'amber'}>{STATUS[event.triage.status]||event.triage.status}</DSBadge>}</div>
    </button>
    <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={()=>onOpen(event)}>Detalhes</button>
  </article>
}

export default function AdminErros(){
  const [local,setLocal]=useState({erros:[],total:0})
  const [central,setCentral]=useState({sources:[],events:[],vps:null})
  const [loading,setLoading]=useState(true)
  const [source,setSource]=useState('')
  const [query,setQuery]=useState('')
  const [filtersOpen,setFiltersOpen]=useState(false)
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [status,setStatus]=useState('')
  const [period,setPeriod]=useState('7d')
  const [selected,setSelected]=useState(new Map())
  const [detail,setDetail]=useState(null)
  const [details,setDetails]=useState(null)
  const [detailsLoading,setDetailsLoading]=useState(false)
  const [analysis,setAnalysis]=useState('')
  const [aiLoading,setAiLoading]=useState(false)
  const [diagOpen,setDiagOpen]=useState(false)
  const [diagMode,setDiagMode]=useState('cloud')
  const [diagnostic,setDiagnostic]=useState(null)
  const [confirm,setConfirm]=useState({aberto:false,titulo:'',msg:'',fn:null,carregando:false})
  const [triageNote,setTriageNote]=useState('')

  const load=useCallback(async()=>{
    setLoading(true)
    try{
      const [l,c]=await Promise.all([errosService.listar({limit:50,status:status||undefined}),errosService.central()])
      setLocal({erros:l.erros||[],total:l.total||0}); setCentral(c||{sources:[],events:[]})
    }catch(e){toast.error(e.message)} finally{setLoading(false)}
  },[status])
  useEffect(()=>{load()},[load])

  const events=useMemo(()=>{
    const since=period?Date.now()-({'24h':86400000,'7d':604800000,'30d':2592000000}[period]||0):0
    return (central.events||[]).filter(e=>(!source||e.source===source)&&(!since||!e.createdAt||new Date(e.createdAt).getTime()>=since)&&(!query||`${e.title} ${e.message} ${sourceLabel[e.source]||''}`.toLowerCase().includes(query.toLowerCase())))
  },[central.events,source,query,period])
  const counts=useMemo(()=>{
    const rows=local.erros||[]; return {novo:rows.filter(e=>(e.status||'novo')==='novo').length,investigando:rows.filter(e=>e.status==='investigando').length,resolvido:rows.filter(e=>e.status==='resolvido').length}
  },[local.erros])

  async function openEvent(event){
    setDetail(event); setDetails(null); setAnalysis(''); setTriageNote(event.triage?.nota||''); setDetailsLoading(true)
    try{const r=await errosService.detalhesCentral(event);setDetails(r.details)}catch(e){setDetails({erro:e.message})}finally{setDetailsLoading(false)}
  }
  async function analyze(){
    if(!detail)return; setAiLoading(true); setAnalysis('')
    try{const r=await errosService.analisarCentral(detail);setAnalysis(r.analysis||'Sem análise retornada.')}catch(e){toast.error(e.message)}finally{setAiLoading(false)}
  }
  function selectEvent(event){setSelected(m=>{const n=new Map(m);n.has(event.id)?n.delete(event.id):n.set(event.id,event);return n})}
  function ask(titulo,msg,fn){setConfirm({aberto:true,titulo,msg,fn,carregando:false})}
  async function runConfirm(){setConfirm(c=>({...c,carregando:true}));try{await confirm.fn();setConfirm({aberto:false,titulo:'',msg:'',fn:null,carregando:false});setSelected(new Map());load()}catch(e){toast.error(e.message);setConfirm(c=>({...c,carregando:false}))}}
  async function bulkStatus(next){
    const items=[...selected.values()]
    if(!items.length)return
    ask(`Marcar ${items.length} como ${STATUS[next]}?`, items.some(e=>e.source!=='al')?'Em fontes externas isso altera apenas a triagem dentro do AL; o erro continuará existindo na plataforma de origem.':'', async()=>errosService.triagemCentral(items,next,''))
  }
  async function setDetailTriage(next){
    if(!detail)return
    try{
      await errosService.triagemCentral([detail],next,triageNote)
      toast.success(`Marcado como ${STATUS[next]}.`)
      setDetail(d=>({...d,triage:{...(d.triage||{}),status:next,nota:triageNote}}))
      load()
    }catch(e){toast.error(e.message)}
  }
  async function runDiagnostic(){
    if(diagMode==='cloud'){setDiagnostic(central);return}
    if(diagMode==='vps'){setDiagnostic({vps:central.vps,note:'Suporte preparado. Ative AL_ENABLE_VPS_DIAGNOSTICS quando houver um servidor VPS para monitorar.'});return}
    try{setDiagnostic(await errosService.diagnostico(true))}catch(e){toast.error(e.message)}
  }

  const critical=events.filter(e=>e.severity==='critical').length
  const healthy=(central.sources||[]).filter(s=>s.ok===true).length
  return <>
    <ConfirmModal aberto={confirm.aberto} titulo={confirm.titulo} mensagem={confirm.msg} carregando={confirm.carregando} labelConfirmar="Confirmar" onConfirmar={runConfirm} onCancelar={()=>setConfirm({aberto:false,titulo:'',msg:'',fn:null,carregando:false})}/>

    <div className="adm-page-header" style={{marginBottom:SPACE.lg}}>
      <div><div className="adm-page-title">Erros e logs</div><div className="adm-page-sub">Central online de diagnóstico e produção</div></div>
      <div className="adm-page-actions"><button className="adm-btn adm-btn-secondary" onClick={()=>setDiagOpen(true)}>Diagnóstico</button><button className="adm-btn adm-btn-ghost adm-btn-icon" onClick={()=>setSettingsOpen(true)} title="Configurações">⚙</button></div>
    </div>

    <div style={{display:'flex',gap:SPACE.sm,flexWrap:'wrap',alignItems:'center',marginBottom:SPACE.lg}}>
      <DSBadge variant={counts.novo?'red':'gray'}>{counts.novo} novo</DSBadge><DSBadge variant="amber">{counts.investigando} investigando</DSBadge><DSBadge variant="green">{counts.resolvido} resolvido</DSBadge>
      <span style={{color:'var(--adm-muted)',fontSize:FONT.sm}}>·</span><DSBadge variant={critical?'red':'green'}>{critical?`${critical} crítico(s)`:'Produção sem falhas críticas'}</DSBadge><span style={{color:'var(--adm-muted)',fontSize:FONT.sm}}>{healthy}/{(central.sources||[]).length} fontes saudáveis</span>
    </div>

    <div className="diag-source-grid" style={{display:'grid',gridTemplateColumns:'repeat(5,minmax(0,1fr))',gap:SPACE.sm,marginBottom:SPACE.lg}}>{(central.sources||[]).map(s=><SourceSummary key={s.source} item={s}/>)}</div>

    <div className="adm-card" style={{padding:SPACE.md,marginBottom:SPACE.lg,display:'grid',gridTemplateColumns:'1fr auto',gap:SPACE.sm,alignItems:'center'}}>
      <input className="adm-input" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar erros, deploys e logs…" />
      <button className="adm-btn adm-btn-secondary" onClick={()=>setFiltersOpen(true)}>Filtros</button>
      <div style={{gridColumn:'1 / -1',display:'flex',gap:SPACE.xs,overflowX:'auto',paddingBottom:2}}>{SOURCES.map(s=><button key={s.key} className={`adm-btn adm-btn-sm ${source===s.key?'adm-btn-primary':'adm-btn-ghost'}`} onClick={()=>setSource(s.key)} style={{flexShrink:0}}>{s.label}</button>)}</div>
    </div>

    {loading?<div className="adm-empty">Atualizando diagnósticos…</div>:events.length===0?<div className="adm-card adm-empty"><p>Nenhum problema encontrado nos filtros atuais.</p></div>:<div style={{display:'grid',gap:SPACE.sm}}>{events.map(e=><EventCard key={e.id} event={e} selected={selected.has(e.id)} onSelect={selectEvent} onOpen={openEvent}/>)}</div>}

    {selected.size>0&&<div style={{position:'fixed',left:'50%',bottom:18,transform:'translateX(-50%)',zIndex:1100,background:'var(--adm-surface)',border:'1px solid var(--adm-border)',boxShadow:'0 12px 35px rgba(0,0,0,.2)',borderRadius:16,padding:SPACE.sm,display:'flex',gap:SPACE.sm,alignItems:'center',maxWidth:'calc(100vw - 24px)'}}><strong style={{whiteSpace:'nowrap'}}>{selected.size} selecionado(s)</strong><select className="adm-filter-select" defaultValue="" onChange={e=>{if(e.target.value)bulkStatus(e.target.value);e.target.value=''}}><option value="">Status…</option>{Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={()=>setSelected(new Map())}>Limpar</button></div>}

    <DSModal open={filtersOpen} onClose={()=>setFiltersOpen(false)} title="Filtros" size="sm"><div style={{display:'grid',gap:SPACE.lg}}><label>Período<select className="adm-filter-select" style={{width:'100%',marginTop:6}} value={period} onChange={e=>setPeriod(e.target.value)}><option value="24h">Últimas 24h</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="">Todo período</option></select></label><label>Status salvo pelo AL<select className="adm-filter-select" style={{width:'100%',marginTop:6}} value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos</option><option value="novo">Novo</option><option value="investigando">Investigando</option><option value="resolvido">Resolvido</option><option value="ignorado">Ignorado</option></select></label><button className="adm-btn adm-btn-primary" onClick={()=>{setFiltersOpen(false);load()}}>Aplicar</button></div></DSModal>

    <DSModal open={settingsOpen} onClose={()=>setSettingsOpen(false)} title="Gerenciar registros" size="sm"><p style={{color:'var(--adm-muted)',marginTop:0}}>Ações de limpeza atingem apenas registros armazenados pelo AL. Logs externos permanecem nas plataformas de origem.</p><div style={{display:'grid',gap:SPACE.sm}}><button className="adm-btn adm-btn-secondary" onClick={()=>ask('Limpar resolvidos?','Essa ação não pode ser desfeita.',()=>errosService.limpar({status:'resolvido'}))}>Limpar resolvidos</button><button className="adm-btn adm-btn-secondary" onClick={()=>ask('Limpar ignorados?','Essa ação não pode ser desfeita.',()=>errosService.limpar({status:'ignorado'}))}>Limpar ignorados</button><button className="adm-btn" style={{background:T.redBg,color:T.red}} onClick={()=>ask('Limpar todos os registros do AL?','GitHub, Vercel, Render e MongoDB não serão apagados.',()=>errosService.limpar({}))}>Limpar tudo do AL</button></div></DSModal>

    <DSModal open={diagOpen} onClose={()=>setDiagOpen(false)} title="Assistente de diagnóstico" size="md"><div style={{display:'grid',gap:SPACE.lg}}><div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:SPACE.sm}}>{[['cloud','Produção cloud'],['vps','VPS futuro'],['legacy','Termux legado']].map(([k,l])=><button key={k} className={`adm-btn ${diagMode===k?'adm-btn-primary':'adm-btn-secondary'}`} onClick={()=>{setDiagMode(k);setDiagnostic(null)}}>{l}</button>)}</div><div style={{color:'var(--adm-muted)',lineHeight:1.55}}>{diagMode==='cloud'?'Verifica AL, GitHub, Vercel, Render e MongoDB usando as integrações atuais.':diagMode==='vps'?'Estrutura preparada para um servidor VPS futuro, sem poluir a produção atual.':'Mantém o diagnóstico local antigo para compatibilidade.'}</div><button className="adm-btn adm-btn-primary" onClick={runDiagnostic}>Executar diagnóstico</button>{diagnostic&&<pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',fontSize:FONT.sm,background:'var(--adm-surface2)',padding:SPACE.md,borderRadius:RADIUS.md,maxHeight:300,overflow:'auto'}}>{JSON.stringify(diagnostic,null,2)}</pre>}</div></DSModal>

    <DSModal open={!!detail} onClose={()=>{setDetail(null);setDetails(null);setAnalysis('')}} title={detail?.title||'Detalhes'} size="lg"><div style={{display:'grid',gap:SPACE.lg}}>
      <div style={{display:'flex',gap:SPACE.sm,flexWrap:'wrap',alignItems:'center'}}><DSBadge variant={detail?.severity==='critical'?'red':'amber'}>{sourceLabel[detail?.source]||detail?.source}</DSBadge>{detail?.createdAt&&<span style={{color:'var(--adm-muted)',fontSize:FONT.sm}}>{formatarDataRelativa(detail.createdAt)}</span>}{detail?.triage?.status&&<DSBadge variant={detail.triage.status==='revisado'?'green':detail.triage.status==='silenciado'?'gray':'amber'}>{STATUS[detail.triage.status]||detail.triage.status}</DSBadge>}</div>
      <p style={{margin:0,lineHeight:1.6}}>{detail?.message}</p>
      <div className="adm-card" style={{padding:SPACE.md}}><strong>Triagem no AL</strong><div style={{fontSize:FONT.sm,color:'var(--adm-muted)',margin:'5px 0 10px'}}>Essas ações não apagam nem modificam o erro no GitHub, Vercel, Render ou MongoDB. Elas organizam seu acompanhamento aqui.</div><div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:6}}>{Object.entries(STATUS).map(([k,v])=><button key={k} className={`adm-btn adm-btn-sm ${detail?.triage?.status===k?'adm-btn-primary':'adm-btn-secondary'}`} onClick={()=>setDetailTriage(k)}>{v}</button>)}</div><textarea className="adm-input" rows={3} value={triageNote} onChange={e=>setTriageNote(e.target.value)} placeholder="Nota local: o que foi verificado, decisão, próximo passo…" style={{marginTop:10}}/><button className="adm-btn adm-btn-secondary adm-btn-sm" style={{marginTop:8}} onClick={()=>setDetailTriage(detail?.triage?.status||'acompanhando')}>Salvar nota</button></div>
      <div style={{display:'flex',gap:SPACE.sm,flexWrap:'wrap'}}>{detail?.url&&<a className="adm-btn adm-btn-secondary" href={detail.url} target="_blank" rel="noreferrer">Abrir na plataforma ↗</a>}<button className="adm-btn adm-btn-secondary" onClick={()=>{openEvent(detail);load()}}>↻ Reconsultar origem</button><button className="adm-btn adm-btn-primary" onClick={analyze} disabled={aiLoading}>{aiLoading?'Analisando…':'✨ Analisar com IA'}</button></div>
      {analysis&&<div className="adm-card" style={{padding:SPACE.lg,whiteSpace:'pre-wrap',lineHeight:1.6}}>{analysis}</div>}
      <div><strong>Dados e logs</strong>{detailsLoading?<div style={{color:'var(--adm-muted)',marginTop:8}}>Buscando na plataforma…</div>:<pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',fontSize:FONT.sm,background:'var(--adm-surface2)',padding:SPACE.md,borderRadius:RADIUS.md,maxHeight:380,overflow:'auto'}}>{JSON.stringify(details,null,2)}</pre>}</div>
    </div></DSModal>

    <style>{`@media(max-width:900px){.diag-source-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}} @media(max-width:560px){.diag-source-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.adm-page-actions{gap:6px!important}}`}</style>
  </>
}
