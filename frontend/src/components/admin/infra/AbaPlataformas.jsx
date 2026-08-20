import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { infraestruturaService } from '../../../services/api'
import AdminIcon from '../ui/AdminIcon'

const ago=value=>{
  if(!value)return '—'
  const raw=typeof value==='number'?value:new Date(value).getTime()
  const diff=Math.max(0,Date.now()-raw),m=Math.floor(diff/60000)
  if(m<1)return 'agora'; if(m<60)return `${m} min`; const h=Math.floor(m/60)
  if(h<24)return `${h} h`; return `${Math.floor(h/24)} d`
}
const duration=s=>!s?'':s<60?`${s}s`:`${Math.floor(s/60)}m ${s%60}s`
const stateMeta=value=>({
  online:{label:'Online',tone:'ok'},deploy:{label:'Em deploy',tone:'info'},erro:{label:'Erro',tone:'bad'},
  atencao:{label:'Atenção',tone:'warn'},desconhecido:{label:'Sem status',tone:'muted'},
}[value]||{label:value||'Sem status',tone:'muted'})

function ProviderTag({type}){
  return <span className={`pc-provider ${type}`}>{type==='vercel'?'▲ Vercel':'R Render'}</span>
}
function Status({value}){
  const m=stateMeta(value);return <span className={`pc-status ${m.tone}`}><i/> {m.label}</span>
}
function Modal({onClose,children,title}){
  return <div className="pc-overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section className="pc-modal"><header><div><small>PRODUÇÃO PRINCIPAL</small><h2>{title}</h2></div><button onClick={onClose}>×</button></header>{children}</section></div>
}

function ProjectCard({project}){
  return <Link to={`/admin/plataformas/${encodeURIComponent(project.id)}`} className={`pc-card ${project.especial==='painel'?'featured':''}`}>
    <div className="pc-card-top">
      <div className="pc-project-icon"><AdminIcon name={project.especial==='painel'?'server':'cloud'} size={18}/></div>
      <div className="pc-title"><div>{project.especial==='painel'&&<span className="pc-special">PRINCIPAL</span>}<h3>{project.nome}</h3></div><Status value={project.estado}/></div>
    </div>
    <div className="pc-tags">{project.vercel&&<ProviderTag type="vercel"/>}{project.render&&<ProviderTag type="render"/>}{project.git?.slug&&<span className="pc-repo">◈ {project.git.slug}</span>}</div>
    <div className="pc-deploy">
      <small>ÚLTIMO DEPLOY</small>
      {project.ultimoDeploy?<><b>{project.ultimoDeploy.mensagem||'Deploy'}</b><span>{project.ultimoDeploy.provider==='vercel'?'Vercel':'Render'} · {ago(project.ultimoDeploy.criado)}{project.ultimoDeploy.duracao?` · ${duration(project.ultimoDeploy.duracao)}`:''}</span></>:<><b>Nenhum deploy encontrado</b><span>Abra para consultar o projeto</span></>}
    </div>
    <footer><span>{project.alertas?.length?`${project.alertas.length} aviso(s)`:'Sem alertas importantes'}</span><strong>Abrir projeto <AdminIcon name="chevR" size={13}/></strong></footer>
  </Link>
}

export default function AbaPlataformas(){
  const [data,setData]=useState(null),[status,setStatus]=useState(null),[loading,setLoading]=useState(true)
  const [filter,setFilter]=useState('todos'),[config,setConfig]=useState(false),[saving,setSaving]=useState(false)
  const [renderId,setRenderId]=useState(''),[vercelId,setVercelId]=useState(''),[origin,setOrigin]=useState('')
  const load=useCallback(async(silent=false)=>{
    if(!silent)setLoading(true)
    try{
      const [central,publicStatus]=await Promise.all([infraestruturaService.plataformasProjetosCentral(),infraestruturaService.plataformasStatus().catch(()=>null)])
      setData(central);setStatus(publicStatus)
      setRenderId(central.producao?.renderServiceId||'');setVercelId(central.producao?.vercelProjectId||'');setOrigin(central.producao?.frontendOrigin||'')
    }catch(e){toast.error(e.message)}finally{if(!silent)setLoading(false)}
  },[])
  useEffect(()=>{load()},[load])

  const projects=useMemo(()=>{
    const all=data?.projetos||[]
    if(filter==='painel')return all.filter(p=>p.especial==='painel')
    if(filter==='vercel')return all.filter(p=>p.vercel)
    if(filter==='render')return all.filter(p=>p.render)
    if(filter==='problemas')return all.filter(p=>p.estado==='erro'||p.alertas?.some(a=>a.nivel==='erro'||a.nivel==='aviso'))
    return all
  },[data,filter])
  const painel=projects.find(p=>p.especial==='painel')
  const others=projects.filter(p=>p.especial!=='painel')
  const selectedVercel=data?.provedores?.vercel?.projetos?.find(p=>p.id===vercelId)
  useEffect(()=>{if(!origin&&selectedVercel?.dominio)setOrigin(`https://${selectedVercel.dominio}`)},[selectedVercel,origin])

  async function saveProduction(){
    if(!renderId||!vercelId)return toast.error('Selecione o frontend Vercel e o backend Render do Painel.')
    setSaving(true)
    try{const r=await infraestruturaService.salvarProducaoPlataformas(renderId,vercelId,origin);toast.success(r.mensagem||'Painel vinculado.');setConfig(false);await load(true)}catch(e){toast.error(e.message)}finally{setSaving(false)}
  }

  if(loading)return <div className="pc-loading"><AdminIcon name="spin" size={22}/> Descobrindo projetos na Vercel e Render…</div>
  if(!data)return <div className="pc-loading">Não foi possível abrir a central de projetos.</div>
  const providerWarnings=[data.provedores?.vercel?.erro,data.provedores?.render?.erro].filter(Boolean)
  return <div className="projects-center">
    <section className="pc-hero">
      <div><span>PROJETOS E DEPLOYS</span><h2>Uma central para tudo que está em produção</h2><p>Projetos da Vercel e serviços da Render são agrupados automaticamente pelo repositório. O Painel continua especial; os outros projetos ganham acompanhamento próprio.</p></div>
      <div className="pc-hero-actions"><Link className="pc-action-link" to="/admin/plataformas/variaveis"><AdminIcon name="gear" size={14}/> Variáveis</Link><button onClick={()=>load()}><AdminIcon name="refresh" size={14}/> Sincronizar</button><button className="primary" onClick={()=>setConfig(true)}><AdminIcon name="gear" size={14}/> Definir Painel</button></div>
    </section>

    {providerWarnings.length>0&&<div className="pc-provider-warning"><AdminIcon name="warn" size={16}/><div><b>Uma integração não respondeu</b><span>{providerWarnings.join(' · ')}</span></div><Link to="/admin/integracoes">Corrigir</Link></div>}

    <section className="pc-kpis">
      <div><b>{data.resumo?.total||0}</b><small>Projetos encontrados</small></div>
      <div><b>{data.resumo?.online||0}</b><small>Online</small></div>
      <div><b>{data.resumo?.deploy||0}</b><small>Em deploy</small></div>
      <div className={data.resumo?.problemas?'attention':''}><b>{data.resumo?.problemas||0}</b><small>Precisam de atenção</small></div>
    </section>

    <section className="pc-provider-strip">
      <div><ProviderTag type="vercel"/><span>{data.provedores?.vercel?.utilizavel?`${data.provedores.vercel.projetos?.length||0} projeto(s)`:'não conectada'}</span><em className={status?.vercel?.indicador==='operational'?'ok':''}>{status?.vercel?.descricao||'status não consultado'}</em></div>
      <div><ProviderTag type="render"/><span>{data.provedores?.render?.utilizavel?`${data.provedores.render.servicos?.length||0} serviço(s)`:'não conectada'}</span><em className={status?.render?.indicador==='operational'?'ok':''}>{status?.render?.descricao||'status não consultado'}</em></div>
      <Link to="/admin/integracoes">Integrações e APIs →</Link>
    </section>

    <nav className="pc-filters">
      {[['todos','Todos'],['painel','Painel'],['vercel','Vercel'],['render','Render'],['problemas','Problemas']].map(([id,label])=><button key={id} className={filter===id?'active':''} onClick={()=>setFilter(id)}>{label}</button>)}
    </nav>

    {painel&&<section className="pc-section"><header><div><small>PROJETO PRINCIPAL</small><h3>Painel</h3></div><span>Frontend + backend + produção</span></header><ProjectCard project={painel}/></section>}

    <section className="pc-section"><header><div><small>OUTROS PROJETOS</small><h3>{filter==='todos'?'Projetos monitorados':'Resultado'}</h3></div><span>{others.length} projeto(s)</span></header>
      {others.length?<div className="pc-grid">{others.map(p=><ProjectCard key={p.id} project={p}/>)}</div>:<div className="pc-empty"><AdminIcon name="cloud" size={22}/><b>Nenhum outro projeto neste filtro</b><span>Quando a Vercel ou Render tiverem outros recursos, eles aparecem aqui automaticamente.</span></div>}
    </section>

    <section className="pc-section"><header><div><small>ATENÇÃO</small><h3>Problemas detectados</h3></div><Link to="/admin/erros">Monitor de erros →</Link></header>
      {data.problemas?.length?<div className="pc-problems">{data.problemas.slice(0,8).map(p=><Link key={p.id} to={`/admin/plataformas/${encodeURIComponent(p.projetoId)}`}><span>!</span><div><b>{p.projeto}</b><small>{p.titulo} · {p.descricao}</small></div><strong>Ver</strong></Link>)}</div>:<div className="pc-clear"><AdminIcon name="check" size={16}/><div><b>Nenhum problema importante</b><span>Os deploys recentes não apresentam divergências relevantes.</span></div></div>}
    </section>

    {config&&<Modal title="Qual projeto é o Painel?" onClose={()=>setConfig(false)}>
      <p className="pc-modal-copy">Escolha o frontend e o backend que formam a produção principal. Os demais recursos continuarão disponíveis como projetos independentes.</p>
      <label>Frontend Vercel<select value={vercelId} onChange={e=>{setVercelId(e.target.value);setOrigin('')}}><option value="">Selecione…</option>{(data.provedores?.vercel?.projetos||[]).map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
      <label>Backend Render<select value={renderId} onChange={e=>setRenderId(e.target.value)}><option value="">Selecione…</option>{(data.provedores?.render?.servicos||[]).map(s=><option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
      <label>URL pública do Painel<input value={origin} onChange={e=>setOrigin(e.target.value)} placeholder="https://meusite.com"/><small>Se ficar vazio, o AL Sistemas tenta usar o domínio canônico associado à Vercel.</small></label>
      <div className="pc-modal-actions"><button onClick={()=>setConfig(false)}>Cancelar</button><button className="primary" disabled={saving} onClick={saveProduction}>{saving?'Salvando…':'Salvar vínculo'}</button></div>
    </Modal>}

    <style>{`
      .projects-center{display:grid;gap:14px;min-width:0}.pc-loading{min-height:180px;display:flex;align-items:center;justify-content:center;gap:9px;color:var(--adm-muted);font-size:12px}.pc-hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-end;padding:20px;border:1px solid var(--adm-border);border-radius:18px;background:linear-gradient(135deg,color-mix(in srgb,var(--adm-accent) 7%,var(--adm-surface)),var(--adm-surface))}.pc-hero>div:first-child{max-width:700px}.pc-hero span,.pc-section header small{font-size:9px;font-weight:900;letter-spacing:.14em;color:var(--adm-accent)}.pc-hero h2{margin:5px 0 5px;font-size:25px;color:var(--adm-text)}.pc-hero p{margin:0;font-size:11px;line-height:1.55;color:var(--adm-muted)}.pc-hero-actions{display:flex;gap:8px;flex-wrap:wrap}.pc-hero-actions button,.pc-hero-actions .pc-action-link,.pc-modal-actions button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 11px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2);color:var(--adm-text);font-size:10px;font-weight:800;cursor:pointer;text-decoration:none}.pc-hero-actions .primary,.pc-modal-actions .primary{background:var(--adm-accent);border-color:var(--adm-accent);color:#fff}.pc-provider-warning{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid #d9770644;border-radius:12px;background:#d9770609;color:#d97706}.pc-provider-warning>div{display:grid;gap:2px}.pc-provider-warning b{font-size:11px}.pc-provider-warning span{font-size:9px;color:var(--adm-muted);overflow-wrap:anywhere}.pc-provider-warning a{font-size:10px;color:var(--adm-accent);text-decoration:none}.pc-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.pc-kpis>div{display:grid;gap:1px;padding:12px 13px;border:1px solid var(--adm-border);border-radius:13px;background:var(--adm-surface)}.pc-kpis b{font-size:21px;color:var(--adm-text)}.pc-kpis small{font-size:9px;color:var(--adm-muted)}.pc-kpis .attention b{color:#d97706}.pc-provider-strip{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center}.pc-provider-strip>div{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-surface)}.pc-provider-strip span{font-size:9px;color:var(--adm-text)}.pc-provider-strip em{margin-left:auto;font-size:8px;color:var(--adm-muted);font-style:normal;white-space:nowrap}.pc-provider-strip em.ok{color:#16a34a}.pc-provider-strip>a{font-size:9px;color:var(--adm-accent);text-decoration:none}.pc-provider{display:inline-flex;align-items:center;padding:4px 6px;border-radius:7px;font-size:8px;font-weight:900;border:1px solid var(--adm-border);white-space:nowrap}.pc-provider.vercel{background:#111;color:#fff}.pc-provider.render{background:#7c3aed10;color:#7c3aed;border-color:#7c3aed33}.pc-filters{display:flex;gap:6px;overflow:auto;padding-bottom:1px}.pc-filters button{white-space:nowrap;border:1px solid var(--adm-border);background:var(--adm-surface);color:var(--adm-muted);border-radius:999px;padding:6px 10px;font-size:9px;font-weight:800}.pc-filters button.active{background:var(--adm-accent);border-color:var(--adm-accent);color:#fff}.pc-section{display:grid;gap:10px}.pc-section>header{display:flex;justify-content:space-between;gap:10px;align-items:flex-end}.pc-section header h3{margin:3px 0 0;font-size:16px;color:var(--adm-text)}.pc-section header>span,.pc-section header>a{font-size:9px;color:var(--adm-muted);text-decoration:none}.pc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.pc-card{min-width:0;display:grid;gap:11px;padding:13px;border:1px solid var(--adm-border);border-radius:15px;background:var(--adm-surface);color:var(--adm-text);text-decoration:none;box-shadow:var(--adm-shadow-sm);transition:.14s}.pc-card:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--adm-accent) 35%,var(--adm-border))}.pc-card.featured{padding:15px;border-color:color-mix(in srgb,var(--adm-accent) 30%,var(--adm-border));background:linear-gradient(135deg,color-mix(in srgb,var(--adm-accent) 4%,var(--adm-surface)),var(--adm-surface))}.pc-card-top{display:flex;gap:9px;align-items:flex-start}.pc-project-icon{width:35px;height:35px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2);display:grid;place-items:center;color:var(--adm-accent);flex:0 0 auto}.pc-title{min-width:0;display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex:1}.pc-title>div{min-width:0}.pc-title h3{font-size:13px;margin:1px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pc-special{display:block;font-size:7px!important;color:var(--adm-accent)!important;letter-spacing:.12em}.pc-status{display:inline-flex;align-items:center;gap:4px;padding:4px 6px;border-radius:999px;border:1px solid var(--adm-border);font-size:8px;font-weight:850;white-space:nowrap}.pc-status i{width:5px;height:5px;border-radius:50%;background:currentColor}.pc-status.ok{color:#16a34a;border-color:#16a34a33;background:#16a34a08}.pc-status.info{color:#2563eb;border-color:#2563eb33;background:#2563eb08}.pc-status.warn{color:#d97706;border-color:#d9770633;background:#d9770608}.pc-status.bad{color:#dc2626;border-color:#dc262633;background:#dc262608}.pc-status.muted{color:var(--adm-muted)}.pc-tags{display:flex;gap:5px;flex-wrap:wrap;align-items:center}.pc-repo{min-width:0;max-width:100%;font-size:8px;color:var(--adm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pc-deploy{display:grid;gap:3px;padding:9px 10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2)}.pc-deploy small{font-size:7px;font-weight:900;letter-spacing:.1em;color:var(--adm-muted)}.pc-deploy b{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pc-deploy span{font-size:8px;color:var(--adm-muted)}.pc-card footer{display:flex;justify-content:space-between;gap:8px;align-items:center}.pc-card footer>span{font-size:8px;color:var(--adm-muted)}.pc-card footer strong{display:flex;align-items:center;gap:3px;font-size:9px;color:var(--adm-accent)}.pc-empty{min-height:120px;border:1px dashed var(--adm-border);border-radius:14px;display:grid;place-items:center;align-content:center;gap:5px;text-align:center;color:var(--adm-muted);padding:16px}.pc-empty b{font-size:11px;color:var(--adm-text)}.pc-empty span{font-size:9px;max-width:440px;line-height:1.45}.pc-problems{display:grid;gap:6px}.pc-problems>a{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface);text-decoration:none;color:var(--adm-text)}.pc-problems>a>span{width:22px;height:22px;border-radius:7px;background:#dc262610;color:#dc2626;display:grid;place-items:center;font-weight:900}.pc-problems>a>div{min-width:0;display:grid;gap:2px}.pc-problems b{font-size:10px}.pc-problems small{font-size:8px;color:var(--adm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pc-problems strong{font-size:8px;color:var(--adm-accent)}.pc-clear{display:flex;align-items:center;gap:9px;padding:11px;border:1px solid #16a34a33;border-radius:11px;background:#16a34a08;color:#16a34a}.pc-clear>div{display:grid;gap:2px}.pc-clear b{font-size:10px;color:var(--adm-text)}.pc-clear span{font-size:8px;color:var(--adm-muted)}.pc-overlay{position:fixed;inset:0;z-index:1500;background:rgba(15,23,42,.46);backdrop-filter:blur(3px);display:grid;place-items:center;padding:12px}.pc-modal{width:min(100%,520px);max-height:calc(100dvh - 24px);overflow:auto;padding:17px;border:1px solid var(--adm-border);border-radius:17px;background:var(--adm-surface);box-shadow:0 22px 70px rgba(0,0,0,.26)}.pc-modal header{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.pc-modal header small{font-size:8px;font-weight:900;letter-spacing:.13em;color:var(--adm-accent)}.pc-modal h2{font-size:19px;margin:3px 0}.pc-modal header button{width:30px;height:30px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);color:var(--adm-text);font-size:18px}.pc-modal-copy{font-size:10px;line-height:1.5;color:var(--adm-muted)}.pc-modal label{display:block;margin-top:10px;font-size:10px;font-weight:800}.pc-modal select,.pc-modal input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:9px 10px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-bg);color:var(--adm-text)}.pc-modal label small{display:block;margin-top:4px;color:var(--adm-muted);font-weight:400;font-size:8px}.pc-modal-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:14px}
      @media(max-width:960px){.pc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pc-provider-strip{grid-template-columns:1fr 1fr}.pc-provider-strip>a{grid-column:1/-1}}
      @media(max-width:650px){.pc-hero{display:grid;padding:15px}.pc-hero h2{font-size:20px}.pc-hero-actions{display:grid;grid-template-columns:1fr 1fr}.pc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.pc-grid{grid-template-columns:1fr}.pc-provider-strip{grid-template-columns:1fr}.pc-provider-strip>a{grid-column:auto}.pc-section>header{align-items:flex-start}.pc-provider-warning{grid-template-columns:auto minmax(0,1fr)}.pc-provider-warning>a{grid-column:2}.pc-card.featured{padding:13px}}
    `}</style>
  </div>
}
