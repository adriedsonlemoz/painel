import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSystemHealth } from '../../hooks/useSystemHealth'
import { useSystemLogs } from '../../hooks/useSystemLogs'
import { useUsersStats } from '../../hooks/useUsersStats'
import { useProjetos } from '../../modules/projetos/useProjetos'
import { useNoticias } from '../../hooks/useNoticias'
import { useEventos } from '../../hooks/useEventos'

const CSS=`
.command-dashboard{--line:var(--adm-border,#e6e2db);--panel:var(--adm-surface,#fff);--muted:var(--adm-muted,#77736c);--text:var(--adm-text,#191b18);--accent:var(--adm-accent,#5d7251);display:grid;gap:12px;padding-bottom:34px;max-width:1180px;margin:0 auto;color:var(--text)}
.cd-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-end;padding:4px 1px 10px}.cd-eyebrow{font:800 10px/1.2 ui-monospace,monospace;letter-spacing:.18em;color:var(--accent);text-transform:uppercase}.cd-head h1{font-size:clamp(25px,5vw,39px);line-height:1.03;letter-spacing:-.045em;margin:7px 0 5px}.cd-head p{margin:0;color:var(--muted);font-size:13px}.cd-live{display:flex;align-items:center;gap:7px;white-space:nowrap;font-size:10px;font-weight:850;letter-spacing:.08em}.cd-dot{width:7px;height:7px;border-radius:50%;background:#22a95b;box-shadow:0 0 0 4px color-mix(in srgb,#22a95b 12%,transparent)}.cd-dot.warn{background:#e04646;box-shadow:0 0 0 4px color-mix(in srgb,#e04646 12%,transparent)}
.cd-panel{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden;position:relative}.cd-panel:before{content:"";position:absolute;inset:0 auto 0 0;width:2px;background:var(--rail,var(--accent));opacity:.65}.cd-pad{padding:18px}.cd-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}.cd-label{font:850 9px/1.2 ui-monospace,monospace;letter-spacing:.16em;color:var(--muted);text-transform:uppercase}.cd-title{font-size:18px;font-weight:850;letter-spacing:-.025em;margin-top:4px}.cd-link{color:var(--accent);font-size:10px;font-weight:850;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}.cd-hero{background:radial-gradient(circle at 90% 10%,color-mix(in srgb,var(--accent) 10%,transparent),transparent 32%),var(--panel)}.cd-status{display:inline-flex;align-items:center;gap:6px;border:1px solid color-mix(in srgb,#22a95b 35%,var(--line));border-radius:999px;padding:5px 8px;font-size:9px;font-weight:900;color:#18844a}.cd-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:13px;overflow:hidden;margin:14px 0}.cd-metric{background:var(--panel);padding:13px}.cd-metric b{display:block;font-size:20px;line-height:1;margin-bottom:5px}.cd-metric span{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.cd-feature{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end;padding-top:3px}.cd-feature h2{font-size:clamp(19px,4vw,29px);margin:0 0 5px;letter-spacing:-.035em}.cd-feature p{margin:0;color:var(--muted);font-size:12px;max-width:620px}.cd-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.cd-btn{border:1px solid var(--line);background:var(--adm-surface2,#f7f5f1);color:var(--text);text-decoration:none;border-radius:9px;padding:9px 11px;font-size:10px;font-weight:850;white-space:nowrap}.cd-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.cd-project-row,.cd-activity-row,.cd-alert-row,.cd-news-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 0;border-top:1px solid var(--line)}.cd-project-row:first-of-type,.cd-activity-row:first-of-type,.cd-alert-row:first-of-type,.cd-news-row:first-of-type{border-top:0}.cd-index{font:800 9px/1 ui-monospace,monospace;color:var(--muted);min-width:20px}.cd-row-main{min-width:0}.cd-row-main b{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cd-row-main span{display:block;font-size:10px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cd-state{font-size:9px;font-weight:850;color:#18844a;white-space:nowrap}.cd-state.warn{color:#d07819}.cd-state.bad{color:#d63c3c}.cd-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px}.cd-service-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cd-service-block{padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--adm-surface2,#f7f5f1)}.cd-service-block b{display:block;font-size:21px;letter-spacing:-.04em}.cd-service-block span{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.cd-service-list{margin-top:13px;display:grid;gap:8px}.cd-service-item{display:flex;justify-content:space-between;gap:10px;font-size:11px}.cd-service-item span:last-child{color:var(--muted);font-size:10px}.cd-empty{padding:14px 0;color:var(--muted);font-size:12px}.cd-quick{display:flex;gap:7px;flex-wrap:wrap;margin-top:14px}.cd-quick a{text-decoration:none;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:6px 9px;font-size:9px;font-weight:800}.cd-alert-count{font-size:10px;font-weight:900;border:1px solid color-mix(in srgb,#d07819 30%,var(--line));color:#d07819;border-radius:999px;padding:4px 7px}.cd-time{font:700 9px/1 ui-monospace,monospace;color:var(--muted);white-space:nowrap}
@media(max-width:700px){.cd-head{align-items:flex-start}.cd-head p{max-width:260px}.cd-grid{grid-template-columns:1fr}.cd-metrics{grid-template-columns:1fr 1fr}.cd-feature{grid-template-columns:1fr}.cd-actions{justify-content:flex-start}.cd-service-summary{grid-template-columns:1fr 1fr}.cd-pad{padding:16px}.command-dashboard{gap:10px}.cd-project-row,.cd-activity-row,.cd-alert-row,.cd-news-row{gap:8px}}
@media(max-width:380px){.cd-head{display:grid}.cd-metrics{grid-template-columns:1fr 1fr}.cd-metric{padding:11px}.cd-metric b{font-size:19px}}
`
const num=v=>Number.isFinite(Number(v))?Number(v):0
const when=iso=>{if(!iso)return '—';const m=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/60000));if(m<1)return'agora';if(m<60)return`${m} min`;const h=Math.floor(m/60);if(h<24)return`${h} h`;return`${Math.floor(h/24)} d`}

export default function AdminDashboard(){
 const health=useSystemHealth()
 const logs=useSystemLogs({limitErros:5,limitAudit:6})
 const users=useUsersStats()
 const projetos=useProjetos()
 const noticias=useNoticias({limit:5,status:'publicada',ordem:'-data_publicacao'})
 const eventos=useEventos()
 const services=useMemo(()=>[
  ['Núcleo',health.api?.ok],['Banco',health.mongodb?.ok],['Cache',health.redis?.ok],['Mídia',health.cloudinary?.ok],['Publicação',health.github?.ok],['IA',health.ia?.ok],['Rede',health.cloudflare?.ok]
 ],[health])
 const serviceOk=services.filter(([,ok])=>ok).length
 const serviceWarn=services.length-serviceOk
 const systemOk=Boolean(health.api?.ok&&health.mongodb?.ok)
 const news=noticias.noticias||[]
 const future=(eventos.futuros||[]).slice(0,3)
 const projects=projetos.projetos||projetos.items||[]
 const unread=num(logs.contagemErros?.nao_lidos)
 const drafts=num(noticias.totalRasccunhos??noticias.rascunhos?.length)
 const alerts=[
  unread?{title:`${unread} erro(s) aguardando revisão`,sub:'Abra a central de diagnóstico para analisar os registros.',to:'/admin/erros',state:'bad'}:null,
  serviceWarn?{title:`${serviceWarn} serviço(s) precisam de atenção`,sub:'A operação principal pode continuar, mas existem integrações incompletas.',to:'/admin/infraestrutura',state:'warn'}:null,
  !health.mongodb?.ok?{title:'Banco de dados sem resposta',sub:'Conteúdo e configurações podem ficar indisponíveis.',to:'/admin/infraestrutura',state:'bad'}:null,
 ].filter(Boolean).slice(0,4)
 const activities=(logs.auditLogs||[]).slice(0,5)
 return <><style>{CSS}</style><main className="command-dashboard">
  <header className="cd-head">
   <div><div className="cd-eyebrow">AL SISTEMAS · CENTRAL EDITORIAL</div><h1>Portal de Notícias</h1><p>Conteúdo, projetos e operação em uma única leitura.</p></div>
   <div className="cd-live"><i className={`cd-dot ${systemOk?'':'warn'}`}/>{health.loading?'VERIFICANDO':systemOk?'ONLINE':'ATENÇÃO'}</div>
  </header>

  <section className="cd-panel cd-hero" style={{'--rail':'var(--adm-accent)'}}><div className="cd-pad">
   <div className="cd-section-head"><div><div className="cd-label">CONTEÚDO · VISÃO ATUAL</div><div className="cd-title">Operação editorial</div></div><span className="cd-status"><i className="cd-dot"/> PORTAL ATIVO</span></div>
   <div className="cd-metrics">
    <div className="cd-metric"><b>{noticias.loading?'—':num(noticias.total||news.length)}</b><span>Publicadas</span></div>
    <div className="cd-metric"><b>{drafts}</b><span>Rascunhos</span></div>
    <div className="cd-metric"><b>{future.length}</b><span>Eventos próximos</span></div>
    <div className="cd-metric"><b>{unread}</b><span>Alertas</span></div>
   </div>
   <div className="cd-feature"><div>{news[0]?<><h2>{news[0].titulo}</h2><p>Última publicação · {news[0].categoria?.nome||'Sem categoria'} · {when(news[0].data_publicacao||news[0].createdAt)}</p></>:<><h2>O portal está pronto para receber conteúdo.</h2><p>Crie a primeira notícia ou importe conteúdo pelo fluxo editorial.</p></>}</div><div className="cd-actions"><Link className="cd-btn primary" to="/admin/noticias">+ Nova notícia</Link><Link className="cd-btn" to="/admin/noticias">Conteúdo →</Link></div></div>
  </div></section>

  <section className="cd-panel" style={{'--rail':'#8b6fd6'}}><div className="cd-pad">
   <div className="cd-section-head"><div><div className="cd-label">PROJETOS · EXECUÇÃO</div><div className="cd-title">Ambiente de projetos</div></div><Link className="cd-link" to="/admin/projetos">Gerenciar →</Link></div>
   {projetos.loading?<div className="cd-empty">Lendo projetos…</div>:projects.length?projects.slice(0,4).map((p,i)=><div className="cd-project-row" key={p._id||p.id||i}><span className="cd-index">{String(i+1).padStart(2,'0')}</span><div className="cd-row-main"><b>{p.nome||p.name||'Projeto'}</b><span>{p.tipo||p.framework||p.caminho||p.path||'Projeto gerenciado pelo AL Sistemas'}</span></div><span className={`cd-state ${p.ativo===false?'warn':''}`}>{p.ativo===false?'PARADO':'ATIVO'}</span></div>):<div className="cd-empty">Nenhum projeto local detectado. Quando houver projetos no Termux ou VPS, eles aparecerão aqui.</div>}
  </div></section>

  <div className="cd-grid">
   <section className="cd-panel" style={{'--rail':'#2a9d6f'}}><div className="cd-pad">
    <div className="cd-section-head"><div><div className="cd-label">SERVIÇOS</div><div className="cd-title">Estado operacional</div></div><Link className="cd-link" to="/admin/infraestrutura">Diagnóstico →</Link></div>
    <div className="cd-service-summary"><div className="cd-service-block"><b>{serviceOk}/{services.length}</b><span>operacionais</span></div><div className="cd-service-block"><b>{serviceWarn}</b><span>atenção</span></div></div>
    <div className="cd-service-list">{services.slice(0,4).map(([name,ok])=><div className="cd-service-item" key={name}><span>{name}</span><span className={`cd-state ${ok?'':'warn'}`}>{health.loading?'verificando':ok?'operacional':'atenção'}</span></div>)}</div>
    <div className="cd-quick"><Link to="/admin/integracoes">Integrações</Link><Link to="/admin/github">Publicação</Link><Link to="/admin/ai-assistant">Assistente IA</Link></div>
   </div></section>
   <section className="cd-panel" style={{'--rail':'#d49a38'}}><div className="cd-pad">
    <div className="cd-section-head"><div><div className="cd-label">ATENÇÃO</div><div className="cd-title">O que precisa de você</div></div><span className="cd-alert-count">{alerts.length}</span></div>
    {alerts.length?alerts.map((a,i)=><Link to={a.to} key={i} className="cd-alert-row" style={{textDecoration:'none',color:'inherit'}}><span className="cd-index">!</span><div className="cd-row-main"><b>{a.title}</b><span>{a.sub}</span></div><span className={`cd-state ${a.state}`}>ABRIR</span></Link>):<div className="cd-empty">Nenhuma ação urgente. O núcleo está estável.</div>}
   </div></section>
  </div>

  <div className="cd-grid">
   <section className="cd-panel" style={{'--rail':'#3c9fb3'}}><div className="cd-pad">
    <div className="cd-section-head"><div><div className="cd-label">CONTEÚDO RECENTE</div><div className="cd-title">Últimas notícias</div></div><Link className="cd-link" to="/admin/noticias">Ver todas →</Link></div>
    {news.length?news.slice(0,4).map((n,i)=><div className="cd-news-row" key={n._id||i}><span className="cd-index">{String(i+1).padStart(2,'0')}</span><div className="cd-row-main"><b>{n.titulo}</b><span>{n.categoria?.nome||'Sem categoria'}</span></div><span className="cd-time">{when(n.data_publicacao||n.createdAt)}</span></div>):<div className="cd-empty">Nenhuma notícia publicada.</div>}
   </div></section>
   <section className="cd-panel" style={{'--rail':'#5276c8'}}><div className="cd-pad">
    <div className="cd-section-head"><div><div className="cd-label">ATIVIDADE</div><div className="cd-title">Pulso administrativo</div></div><span className="cd-label">AUDIT</span></div>
    {activities.length?activities.map((a,i)=><div className="cd-activity-row" key={a._id||i}><span className="cd-index">{String(i+1).padStart(2,'0')}</span><div className="cd-row-main"><b>{a.acao||'Atividade administrativa'}</b><span>{a.recurso||a.admin_email||'AL Sistemas'}</span></div><span className="cd-time">{when(a.criado_em||a.createdAt)}</span></div>):<div className="cd-empty">Nenhuma atividade recente.</div>}
   </div></section>
  </div>

  <section className="cd-panel" style={{'--rail':'#77736c'}}><div className="cd-pad">
   <div className="cd-section-head"><div><div className="cd-label">EQUIPE E AGENDA</div><div className="cd-title">Contexto do portal</div></div><Link className="cd-link" to="/admin/usuarios">Usuários →</Link></div>
   <div className="cd-service-summary"><div className="cd-service-block"><b>{users.loading?'—':num(users.ativos)}</b><span>usuário(s) ativo(s)</span></div><div className="cd-service-block"><b>{users.loading?'—':num(users.totalPerfis)}</b><span>perfil(is)</span></div></div>
   {future.length>0&&<div className="cd-quick">{future.map((e,i)=><Link key={e._id||i} to="/admin/eventos">{e.titulo}</Link>)}</div>}
  </div></section>
 </main></>
}
