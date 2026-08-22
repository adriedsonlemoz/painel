import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSystemHealth } from '../../hooks/useSystemHealth'
import { useSystemLogs } from '../../hooks/useSystemLogs'
import { useUsersStats } from '../../hooks/useUsersStats'
import { useGitHubRepos } from '../../modules/github/useGitHubRepos.js'
import { useNoticias } from '../../hooks/useNoticias'
import { useEventos } from '../../hooks/useEventos'
import { useBranding } from '../../context/BrandingContext'
import { DSStatGrid, DSStatCard } from '../../components/admin/ui/DS'

const CSS = `
.command-dashboard{--line:var(--adm-border);--panel:var(--adm-surface);--muted:var(--adm-muted);--text:var(--adm-text);--accent:var(--adm-accent);display:grid;gap:12px;padding-bottom:34px;max-width:1180px;margin:0 auto;color:var(--text)}
.cd-head{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:2px 1px 7px}.cd-eyebrow{font:800 12px/1.2 var(--adm-mono);letter-spacing:.14em;color:var(--accent);text-transform:uppercase}.cd-head h1{font-size:clamp(22px,4vw,30px);line-height:1.05;letter-spacing:-.035em;margin:3px 0 3px}.cd-head p{margin:0;color:var(--muted);font-size:12px}.cd-live{display:flex;align-items:center;gap:7px;white-space:nowrap;font-size:12px;font-weight:850;letter-spacing:.08em}.cd-dot{width:7px;height:7px;border-radius:50%;background:var(--adm-success,#22c55e);box-shadow:0 0 0 4px color-mix(in srgb,var(--adm-success,#22c55e) 12%,transparent)}.cd-dot.warn{background:var(--adm-red);box-shadow:0 0 0 4px color-mix(in srgb,var(--adm-red) 12%,transparent)}
.cd-panel{--rail:var(--adm-accent);background:var(--panel);border:1px solid var(--line);border-radius:var(--adm-radius);overflow:hidden;position:relative;box-shadow:var(--adm-shadow)}.cd-panel:before{content:"";position:absolute;inset:0 auto 0 0;width:2px;background:var(--rail);opacity:.7}.cd-pad{padding:18px}.cd-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}.cd-label{font:800 12px/1.2 var(--adm-mono);letter-spacing:.14em;color:var(--muted);text-transform:uppercase}.cd-title{font-size:18px;font-weight:800;letter-spacing:-.025em;margin-top:4px}.cd-link{color:var(--accent);font-size:12px;font-weight:800;text-decoration:none;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}.cd-hero{background:radial-gradient(circle at 90% 10%,color-mix(in srgb,var(--accent) 10%,transparent),transparent 32%),var(--panel)}.cd-status{display:inline-flex;align-items:center;gap:6px;border:1px solid color-mix(in srgb,var(--adm-success,#22c55e) 35%,var(--line));border-radius:999px;padding:5px 8px;font-size:12px;font-weight:850;color:var(--adm-success,#22c55e)}
.cd-feature{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end;padding-top:14px}.cd-feature h2{font-size:clamp(19px,4vw,29px);margin:0 0 5px;letter-spacing:-.035em}.cd-feature p{margin:0;color:var(--muted);font-size:12px;max-width:620px}.cd-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.cd-btn{border:1px solid var(--line);background:var(--adm-surface2);color:var(--text);text-decoration:none;border-radius:9px;padding:9px 11px;font-size:12px;font-weight:800;white-space:nowrap}.cd-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.cd-project-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr)) auto;gap:8px;align-items:stretch;margin-bottom:12px}.cd-project-metric{border:1px solid var(--line);border-radius:10px;background:var(--adm-surface2);padding:10px 11px}.cd-project-metric span{display:block;font:800 11px/1.2 var(--adm-mono);letter-spacing:.08em;color:var(--muted);text-transform:uppercase}.cd-project-metric b{display:block;margin-top:4px;font-size:18px;letter-spacing:-.03em}.cd-project-jump{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid color-mix(in srgb,var(--accent) 30%,var(--line));border-radius:10px;padding:9px 11px;text-decoration:none;color:var(--accent);font-size:12px;font-weight:850;background:color-mix(in srgb,var(--accent) 5%,var(--panel));white-space:nowrap}.cd-project-row,.cd-activity-row,.cd-alert-row,.cd-news-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 0;border-top:1px solid var(--line)}.cd-project-row:first-of-type,.cd-activity-row:first-of-type,.cd-alert-row:first-of-type,.cd-news-row:first-of-type{border-top:0}.cd-index{font:800 12px/1 var(--adm-mono);color:var(--muted);min-width:20px}.cd-row-main{min-width:0}.cd-row-main b{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cd-row-main span{display:block;font-size:12px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cd-state{font-size:12px;font-weight:850;color:var(--adm-success,#22c55e);white-space:nowrap}.cd-state.warn{color:var(--adm-amber)}.cd-state.bad{color:var(--adm-red)}.cd-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px}.cd-service-list{margin-top:13px;display:grid;gap:8px}.cd-service-item{display:flex;justify-content:space-between;gap:10px;font-size:11px}.cd-service-item span:last-child{color:var(--muted);font-size:12px}.cd-empty{padding:14px 0;color:var(--muted);font-size:12px}.cd-quick{display:flex;gap:7px;flex-wrap:wrap;margin-top:14px}.cd-quick a{text-decoration:none;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:6px 9px;font-size:12px;font-weight:800}.cd-alert-count{font-size:12px;font-weight:900;border:1px solid color-mix(in srgb,var(--adm-amber) 30%,var(--line));color:var(--adm-amber);border-radius:999px;padding:4px 7px}.cd-time{font:700 12px/1 var(--adm-mono);color:var(--muted);white-space:nowrap}
@media(max-width:700px){.cd-head{align-items:flex-start}.cd-head p{max-width:260px}.cd-grid{grid-template-columns:1fr}.cd-feature{grid-template-columns:1fr}.cd-actions{justify-content:flex-start}.cd-pad{padding:16px}.command-dashboard{gap:10px}.cd-project-summary{grid-template-columns:1fr 1fr}.cd-project-jump{grid-column:1/-1}.cd-project-row,.cd-activity-row,.cd-alert-row,.cd-news-row{gap:8px}}
@media(max-width:380px){.cd-head{display:grid}}
`

const num = v => Number.isFinite(Number(v)) ? Number(v) : 0
const when = iso => {
  if (!iso) return '—'
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 1) return 'agora'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

export default function AdminDashboard() {
  const { siteName } = useBranding()
  const health = useSystemHealth()
  const logs = useSystemLogs({ limitErros: 5, limitAudit: 6 })
  const users = useUsersStats()
  const githubProjects = useGitHubRepos({ sort: 'updated', per_page: 100 })
  const noticias = useNoticias({ limit: 5, status: 'publicada', ordem: '-data_publicacao' })
  const eventos = useEventos()

  const services = useMemo(() => [
    ['Núcleo', health.api?.ok], ['Banco', health.mongodb?.ok], ['Cache', health.redis?.ok],
    ['Mídia', health.cloudinary?.ok], ['Publicação', health.github?.ok], ['IA', health.ia?.ok], ['Rede', health.cloudflare?.ok],
  ], [health])
  const serviceOk = services.filter(([, ok]) => ok).length
  const serviceWarn = services.length - serviceOk
  const systemOk = Boolean(health.api?.ok && health.mongodb?.ok)
  const news = noticias.noticias || []
  const future = (eventos.futuros || []).slice(0, 3)
  const projects = githubProjects.repos || []
  const activeProjects = projects.filter(p => p?.ativo).length
  const unread = num(logs.contagemErros?.nao_lidos)
  const drafts = num(noticias.totalRasccunhos ?? noticias.rascunhos?.length)
  const alerts = [
    unread ? { title: `${unread} erro(s) aguardando revisão`, sub: 'Abra a central de erros para conferir os registros.', to: '/admin/erros', state: 'bad' } : null,
    serviceWarn ? { title: `${serviceWarn} serviço(s) precisam de atenção`, sub: 'A operação principal pode continuar, mas existem integrações incompletas.', to: '/admin/infraestrutura', state: 'warn' } : null,
    !health.mongodb?.ok ? { title: 'Banco de dados sem resposta', sub: 'Conteúdo e configurações podem ficar indisponíveis.', to: '/admin/infraestrutura', state: 'bad' } : null,
  ].filter(Boolean).slice(0, 4)
  const activities = (logs.auditLogs || []).slice(0, 5)

  return <><style>{CSS}</style><main className="command-dashboard">
    <header className="cd-head">
      <div><div className="cd-eyebrow">CENTRAL ADMINISTRATIVA</div><h1>{siteName}</h1><p>Projetos, conteúdo e operação em um só lugar.</p></div>
      <div className="cd-live"><i className={`cd-dot ${systemOk ? '' : 'warn'}`}/>{health.loading ? 'VERIFICANDO' : systemOk ? 'ONLINE' : 'ATENÇÃO'}</div>
    </header>

    <section className="cd-panel cd-hero"><div className="cd-pad">
      <div className="cd-section-head"><div><div className="cd-label">CONTEÚDO · VISÃO ATUAL</div><div className="cd-title">Operação editorial</div></div><span className="cd-status"><i className="cd-dot"/> PORTAL ATIVO</span></div>
      <DSStatGrid columns={4} mobileColumns={2} compact>
        <DSStatCard compact label="Publicadas" value={noticias.loading ? '—' : num(noticias.total || news.length)} />
        <DSStatCard compact label="Rascunhos" value={drafts} tone="neutral" />
        <DSStatCard compact label="Eventos" value={future.length} tone="info" />
        <DSStatCard compact label="Alertas" value={unread} tone={unread ? 'danger' : 'success'} />
      </DSStatGrid>
      <div className="cd-feature"><div>{news[0] ? <><h2>{news[0].titulo}</h2><p>Última publicação · {news[0].categoria?.nome || 'Sem categoria'} · {when(news[0].data_publicacao || news[0].createdAt)}</p></> : <><h2>O portal está pronto para receber conteúdo.</h2><p>Crie a primeira notícia ou importe conteúdo pelo fluxo editorial.</p></>}</div><div className="cd-actions"><Link className="cd-btn primary" to="/admin/noticias">+ Nova notícia</Link><Link className="cd-btn" to="/admin/noticias">Conteúdo →</Link></div></div>
    </div></section>

    <section className="cd-panel" style={{ '--rail': 'var(--adm-accent)' }}><div className="cd-pad">
      <div className="cd-section-head"><div><div className="cd-label">GITHUB · PROJETOS</div><div className="cd-title">Repositórios da conta</div></div><Link className="cd-link" to="/admin/github">Gerenciar →</Link></div>
      <div className="cd-project-summary">
        <div className="cd-project-metric"><span>Repositórios</span><b>{githubProjects.loading ? '—' : (githubProjects.total || projects.length)}</b></div>
        <div className="cd-project-metric"><span>Ativos</span><b>{githubProjects.loading ? '—' : activeProjects}</b></div>
        <Link className="cd-project-jump" to="/admin/github">GitHub e APKs →</Link>
      </div>
      {githubProjects.loading ? <div className="cd-empty">Consultando GitHub…</div> : githubProjects.erro ? <div className="cd-empty">GitHub indisponível: {githubProjects.erro}</div> : projects.length ? projects.slice(0, 5).map((p, i) => <Link to="/admin/github" className="cd-project-row" style={{textDecoration:'none',color:'inherit'}} key={p.id || i}><span className="cd-index">{String(i + 1).padStart(2, '0')}</span><div className="cd-row-main"><b>{p.insight?.produto || p.nome || 'Repositório'}{p.insight?.versao ? ` · v${p.insight.versao}` : ''}</b><span>{p.descricao || p.insight?.resumo || `${p.linguagem || 'Código'} · ${p.nomeCompleto}`}</span></div><span className={`cd-state ${p.arquivado ? 'warn' : !p.ativo ? 'warn' : ''}`}>{p.arquivado ? 'ARQUIVADO' : p.ativo ? 'ATIVO' : 'SEM ATIVIDADE RECENTE'}</span></Link>) : <div className="cd-empty">Nenhum repositório disponível na conta GitHub configurada.</div>}
    </div></section>

    <div className="cd-grid">
      <section className="cd-panel" style={{ '--rail': 'var(--adm-accent)' }}><div className="cd-pad">
        <div className="cd-section-head"><div><div className="cd-label">SERVIÇOS</div><div className="cd-title">Estado operacional</div></div><Link className="cd-link" to="/admin/infraestrutura">Diagnóstico →</Link></div>
        <DSStatGrid columns={2} mobileColumns={2} compact>
          <DSStatCard compact label="Operacionais" value={`${serviceOk}/${services.length}`} tone="success" />
          <DSStatCard compact label="Atenção" value={serviceWarn} tone={serviceWarn ? 'warning' : 'success'} />
        </DSStatGrid>
        <div className="cd-service-list">{services.slice(0, 4).map(([name, ok]) => <div className="cd-service-item" key={name}><span>{name}</span><span className={`cd-state ${ok ? '' : 'warn'}`}>{health.loading ? 'verificando' : ok ? 'operacional' : 'atenção'}</span></div>)}</div>
        <div className="cd-quick"><Link to="/admin/integracoes">Integrações</Link><Link to="/admin/github">Publicação</Link><Link to="/admin/ai-assistant">Assistente IA</Link></div>
      </div></section>
      <section className="cd-panel" style={{ '--rail': 'var(--adm-amber)' }}><div className="cd-pad">
        <div className="cd-section-head"><div><div className="cd-label">ATENÇÃO</div><div className="cd-title">O que precisa de você</div></div><span className="cd-alert-count">{alerts.length}</span></div>
        {alerts.length ? alerts.map((a, i) => <Link to={a.to} key={i} className="cd-alert-row" style={{ textDecoration: 'none', color: 'inherit' }}><span className="cd-index">!</span><div className="cd-row-main"><b>{a.title}</b><span>{a.sub}</span></div><span className={`cd-state ${a.state}`}>ABRIR</span></Link>) : <div className="cd-empty">Nenhuma ação urgente. O núcleo está estável.</div>}
      </div></section>
    </div>

    <div className="cd-grid">
      <section className="cd-panel" style={{ '--rail': 'var(--adm-blue)' }}><div className="cd-pad">
        <div className="cd-section-head"><div><div className="cd-label">CONTEÚDO RECENTE</div><div className="cd-title">Últimas notícias</div></div><Link className="cd-link" to="/admin/noticias">Ver todas →</Link></div>
        {news.length ? news.slice(0, 4).map((n, i) => <div className="cd-news-row" key={n._id || i}><span className="cd-index">{String(i + 1).padStart(2, '0')}</span><div className="cd-row-main"><b>{n.titulo}</b><span>{n.categoria?.nome || 'Sem categoria'}</span></div><span className="cd-time">{when(n.data_publicacao || n.createdAt)}</span></div>) : <div className="cd-empty">Nenhuma notícia publicada.</div>}
      </div></section>
      <section className="cd-panel"><div className="cd-pad">
        <div className="cd-section-head"><div><div className="cd-label">ATIVIDADE</div><div className="cd-title">Pulso administrativo</div></div><span className="cd-label">AUDIT</span></div>
        {activities.length ? activities.map((a, i) => <div className="cd-activity-row" key={a._id || i}><span className="cd-index">{String(i + 1).padStart(2, '0')}</span><div className="cd-row-main"><b>{a.acao || 'Atividade administrativa'}</b><span>{a.recurso || a.admin_email || siteName}</span></div><span className="cd-time">{when(a.criado_em || a.createdAt)}</span></div>) : <div className="cd-empty">Nenhuma atividade recente.</div>}
      </div></section>
    </div>

    <section className="cd-panel"><div className="cd-pad">
      <div className="cd-section-head"><div><div className="cd-label">EQUIPE E AGENDA</div><div className="cd-title">Contexto do portal</div></div><Link className="cd-link" to="/admin/usuarios">Usuários →</Link></div>
      <DSStatGrid columns={2} mobileColumns={2} compact>
        <DSStatCard compact label="Usuários ativos" value={users.loading ? '—' : num(users.ativos)} />
        <DSStatCard compact label="Perfis" value={users.loading ? '—' : num(users.totalPerfis)} tone="neutral" />
      </DSStatGrid>
      {future.length > 0 && <div className="cd-quick">{future.map((e, i) => <Link key={e._id || i} to="/admin/eventos">{e.titulo}</Link>)}</div>}
    </div></section>
  </main></>
}
