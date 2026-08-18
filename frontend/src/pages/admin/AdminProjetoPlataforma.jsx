import { useCallback, useMemo, useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { infraestruturaService } from '../../services/api'
import AdminIcon from '../../components/admin/ui/AdminIcon'

const ago = value => {
  if (!value) return '—'
  const raw = typeof value === 'number' ? value : new Date(value).getTime()
  const delta = Math.max(0, Date.now() - raw)
  const min = Math.floor(delta / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

const fmtDuration = s => !s ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
const isBusy = s => /build|queue|progress|prepar|deploy|initializ|pending/i.test(String(s || ''))
const isFailure = s => /fail|error|cancel/i.test(String(s || ''))

const statusLabel = s => {
  const v = String(s || '').toLowerCase()
  if (/ready|live|success|succeed|online/.test(v)) return ['Online', 'ok']
  if (isBusy(v)) return ['Em deploy', 'info']
  if (isFailure(v)) return ['Erro', 'bad']
  return [s || 'Sem status', 'muted']
}

function logText(log) {
  return String(log?.texto || log?.message || '').trim()
}

function logTone(log) {
  const text = `${log?.nivel || ''} ${log?.tipo || ''} ${logText(log)}`.toLowerCase()
  if (/error|erro|failed|failure|falhou|fatal|exception/.test(text)) return 'bad'
  if (/warn|warning|aviso|deprecated/.test(text)) return 'warn'
  if (/success|ready|complete|conclu|live/.test(text)) return 'ok'
  return 'muted'
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function Provider({ kind, data, onEnv, onLogs, onDeploy, onRestart, onRedeploy, busy }) {
  if (!data) return null
  const dep = data.deploys?.[0]
  const [label, tone] = statusLabel(dep?.estado || dep?.status || data.estado)
  const failed = isFailure(dep?.estado || dep?.status)

  return (
    <article className={`pd-provider ${failed ? 'has-error' : ''}`}>
      <header>
        <div className={`pd-logo ${kind}`}>{kind === 'vercel' ? '▲' : 'R'}</div>
        <div>
          <small>{kind === 'vercel' ? 'FRONTEND · VERCEL' : 'BACKEND · RENDER'}</small>
          <h3>{data.nome}</h3>
        </div>
        <span className={`pd-pill ${tone}`}>{label}</span>
      </header>

      <dl>
        {data.url && <><dt>URL</dt><dd><a href={data.url} target="_blank" rel="noreferrer">{data.url.replace(/^https?:\/\//, '')} ↗</a></dd></>}
        {data.branch && <><dt>Branch</dt><dd>{data.branch}</dd></>}
        {data.framework && <><dt>Framework</dt><dd>{data.framework}</dd></>}
        {data.regiao && <><dt>Região</dt><dd>{data.regiao}</dd></>}
        {data.repo && <><dt>Repositório</dt><dd>{String(data.repo).replace(/^https?:\/\/github.com\//, '')}</dd></>}
      </dl>

      {dep && (
        <div className="pd-last">
          <small>ÚLTIMO DEPLOY</small>
          <b>{dep.commit?.mensagem || dep.commit || 'Deploy de produção'}</b>
          <span>{ago(dep.criado)}{dep.duracao ? ` · ${fmtDuration(dep.duracao)}` : ''}</span>
        </div>
      )}

      {failed && (
        <div className="pd-failure-hint">
          <AdminIcon name="alert" size={14} />
          <span>Falha detectada. Abra os logs para ver a causa sem sair do painel.</span>
        </div>
      )}

      <footer>
        <button onClick={onEnv}>Variáveis</button>
        <button onClick={onLogs}>Logs</button>
        {kind === 'vercel' && dep?.id && <button disabled={busy} onClick={onRedeploy}>Refazer deploy</button>}
        {kind === 'render' && <>
          <button disabled={busy} onClick={() => onDeploy(false)}>Novo deploy</button>
          <button disabled={busy} onClick={onRestart}>Reiniciar</button>
        </>}
      </footer>
    </article>
  )
}

export default function AdminProjetoPlataforma() {
  const { projectId } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('visao')
  const [env, setEnv] = useState(null)
  const [logs, setLogs] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await infraestruturaService.plataformaProjetoDetalhe(projectId)) }
    catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const p = data?.projeto
  const timeline = useMemo(() => data?.timeline || [], [data])
  const latestFailure = useMemo(() => timeline.find(d => isFailure(d.status)), [timeline])

  async function openEnv(kind) {
    const target = kind === 'render' ? data?.provedores?.render : data?.provedores?.vercel
    if (!target) return
    setEnv({ kind, loading: true, items: [], title: `Variáveis · ${target.nome}` })
    try {
      const r = kind === 'render'
        ? await infraestruturaService.renderVariaveis(target.id)
        : await infraestruturaService.vercelVariaveis(target.id)
      setEnv(e => ({ ...e, loading: false, items: r.env || [] }))
    } catch (error) {
      setEnv(e => ({ ...e, loading: false, error: error.message }))
    }
  }

  async function openLogs(kind, deploymentId = '', scope = 'all', hours = 24) {
    const target = kind === 'render' ? data?.provedores?.render : data?.provedores?.vercel
    if (!target) return
    const dep = deploymentId ? target.deploys?.find(d => d.id === deploymentId) : target.deploys?.[0]
    const selectedId = dep?.id || deploymentId
    setLogs({
      kind,
      deploymentId: selectedId,
      scope,
      hours,
      loading: true,
      items: [],
      title: `${kind === 'render' ? 'Render' : 'Vercel'} · ${target.nome}`,
    })
    try {
      let r
      if (kind === 'render') {
        r = await infraestruturaService.renderLogs(target.id, { scope, hours, limit: 100, deploymentId: selectedId })
      } else {
        if (!selectedId) throw new Error('Nenhum deployment Vercel disponível.')
        r = await infraestruturaService.vercelDeployLogs(selectedId)
      }
      setLogs(l => ({
        ...l,
        loading: false,
        items: r.logs || [],
        diagnostico: r.diagnostico || null,
        total: r.total || 0,
        janelaHoras: r.janelaHoras || null,
        fallback: Boolean(r.fallback),
        deploymentScoped: Boolean(r.deploymentScoped),
      }))
    } catch (error) {
      setLogs(l => ({ ...l, loading: false, error: error.message }))
    }
  }

  function selectTab(id) {
    setTab(id)
    if (id === 'logs' && !logs && latestFailure) {
      openLogs(latestFailure.provider, latestFailure.id, latestFailure.provider === 'render' ? 'build' : 'all', 24)
    }
  }

  async function renderAction(type, payload = '', clearCache = false) {
    const rd = data?.provedores?.render
    if (!rd) return
    if (type === 'rollback' && !window.confirm('Fazer rollback do serviço Render para este deploy?')) return
    if (type === 'cancel' && !window.confirm('Cancelar este deploy em andamento?')) return
    setBusy(true)
    try {
      const r = type === 'restart' ? await infraestruturaService.renderRestart(rd.id)
        : type === 'rollback' ? await infraestruturaService.renderRollback(rd.id, payload)
          : type === 'cancel' ? await infraestruturaService.renderCancelarDeploy(rd.id, payload)
            : await infraestruturaService.renderDeploy(rd.id, { clearCache })
      toast.success(r.mensagem || 'Ação enviada à Render.')
      await load()
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  async function vercelAction(type, deploymentId = '') {
    const vc = data?.provedores?.vercel
    if (!vc) return
    const depId = deploymentId || vc.deploys?.[0]?.id
    if (!depId) return toast.error('Nenhum deployment Vercel disponível.')
    if (type === 'cancel' && !window.confirm('Cancelar este deployment da Vercel?')) return
    setBusy(true)
    try {
      const r = type === 'cancel'
        ? await infraestruturaService.vercelCancelarDeploy(depId)
        : await infraestruturaService.vercelRedeploy(depId, vc.nome || '')
      toast.success(r.mensagem || 'Ação enviada à Vercel.')
      await load()
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  async function saveRenderEnv(key, value, deployAfter = false) {
    const rd = data?.provedores?.render
    if (!rd) return
    setBusy(true)
    try {
      const r = await infraestruturaService.renderSalvarVariavel(rd.id, key, value)
      toast.success(r.mensagem || 'Variável salva.')
      if (deployAfter) {
        const d = await infraestruturaService.renderDeploy(rd.id)
        toast.success(d.mensagem || 'Deploy iniciado.')
      }
      const vars = await infraestruturaService.renderVariaveis(rd.id)
      setEnv(e => ({ ...e, items: vars.env || [] }))
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  if (loading) return <div className="pd-loading"><AdminIcon name="spin" size={22} /> Carregando projeto…</div>
  if (!data || !p) return <div className="pd-empty"><b>Projeto não encontrado.</b><Link to="/admin/plataformas">Voltar à central</Link></div>

  const [state, stateTone] = statusLabel(p.estado)

  return (
    <div className="adm-page pd-page">
      <div className="pd-breadcrumb">
        <Link to="/admin/plataformas"><AdminIcon name="chevL" size={13} /> Projetos e Deploys</Link>
        <span>/</span><b>{p.nome}</b>
      </div>

      <section className="pd-hero">
        <div>
          <div className="pd-kicker">{p.especial === 'painel' ? 'PROJETO PRINCIPAL' : 'PROJETO MONITORADO'}</div>
          <h1>{p.nome}</h1>
          <div className="pd-meta">
            <span className={`pd-pill ${stateTone}`}>{state}</span>
            {p.vercel && <span>▲ Vercel</span>}
            {p.render && <span>R Render</span>}
            {p.git?.slug && <span>◈ {p.git.slug}</span>}
          </div>
        </div>
        <div className="pd-actions">
          {data.links?.site && <a href={data.links.site} target="_blank" rel="noreferrer">Abrir site ↗</a>}
          {data.links?.github && <a href={data.links.github} target="_blank" rel="noreferrer">GitHub ↗</a>}
          <button onClick={load}><AdminIcon name="refresh" size={13} /> Atualizar</button>
        </div>
      </section>

      <nav className="pd-tabs">
        {[
          ['visao', 'Visão geral'],
          ['deploys', 'Deploys'],
          ['logs', 'Logs e diagnóstico'],
          ['variaveis', 'Variáveis'],
          ['analise', 'Análise'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => selectTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === 'visao' && (
        <div className="pd-stack">
          {p.especial === 'painel' && data.painel && (
            <section className="pd-panel-health">
              <header><div><small>AL SISTEMAS</small><h2>Saúde da produção principal</h2></div><span className={data.painel.mongo?.conectado && data.painel.corsOk ? 'ok' : 'warn'}>{data.painel.mongo?.conectado && data.painel.corsOk ? 'Pronto' : 'Atenção'}</span></header>
              <div className="pd-health-grid">
                <div><b>{data.painel.backendVersion || '—'}</b><small>Backend</small></div>
                <div><b>{data.painel.mongo?.conectado ? 'Conectado' : 'Offline'}</b><small>MongoDB · {data.painel.mongo?.banco || '—'}</small></div>
                <div><b>{data.painel.corsOk ? 'Autorizado' : 'Revisar'}</b><small>CORS do frontend</small></div>
                <div><b>{data.painel.runtime || '—'}</b><small>Runtime atual</small></div>
              </div>
            </section>
          )}

          {latestFailure && (
            <section className="pd-incident">
              <div className={`pd-deploy-mark ${latestFailure.provider}`}>{latestFailure.provider === 'vercel' ? '▲' : 'R'}</div>
              <div>
                <small>ÚLTIMA FALHA DETECTADA</small>
                <b>{latestFailure.provider === 'vercel' ? 'Frontend / Vercel' : 'Backend / Render'}</b>
                <span>{latestFailure.mensagem || 'Deployment com erro'} · {ago(latestFailure.criado)}</span>
              </div>
              <button onClick={() => { setTab('logs'); openLogs(latestFailure.provider, latestFailure.id, latestFailure.provider === 'render' ? 'build' : 'all', 24) }}>
                <AdminIcon name="alert" size={13} /> Ver motivo
              </button>
            </section>
          )}

          <section className="pd-summary">
            <div><b>{p.stats?.amostra || 0}</b><small>Deploys analisados</small></div>
            <div><b>{p.stats?.sucessos || 0}</b><small>Sucessos</small></div>
            <div className={p.stats?.falhas ? 'bad' : ''}><b>{p.stats?.falhas || 0}</b><small>Falhas</small></div>
            <div><b>{fmtDuration(p.stats?.duracaoMedia)}</b><small>Duração média</small></div>
          </section>

          <div className="pd-provider-grid">
            <Provider
              kind="vercel"
              data={data.provedores?.vercel}
              onEnv={() => openEnv('vercel')}
              onLogs={() => openLogs('vercel')}
              onRedeploy={() => vercelAction('redeploy')}
              busy={busy}
            />
            <Provider
              kind="render"
              data={data.provedores?.render}
              onEnv={() => openEnv('render')}
              onLogs={() => openLogs('render', '', 'all', 24)}
              onDeploy={clear => renderAction('deploy', '', clear)}
              onRestart={() => renderAction('restart')}
              busy={busy}
            />
          </div>
        </div>
      )}

      {tab === 'deploys' && (
        <section className="pd-box">
          <header><div><small>HISTÓRICO</small><h2>Deploys recentes</h2></div><span>{timeline.length} encontrados</span></header>
          {timeline.length ? (
            <div className="pd-timeline">
              {timeline.map((d, i) => {
                const [label, tone] = statusLabel(d.status)
                const inProgress = isBusy(d.status)
                const failed = isFailure(d.status)
                return (
                  <article key={`${d.provider}-${d.id}-${i}`} className={failed ? 'failed' : ''}>
                    <div className={`pd-deploy-mark ${d.provider}`}>{d.provider === 'vercel' ? '▲' : 'R'}</div>
                    <div>
                      <b>{d.mensagem || 'Deploy'}</b>
                      <span>{d.hash ? `${d.hash} · ` : ''}{d.branch ? `${d.branch} · ` : ''}{ago(d.criado)} · {fmtDuration(d.duracao)}</span>
                    </div>
                    <span className={`pd-pill ${tone}`}>{label}</span>
                    <div className="pd-deploy-actions">
                      <button onClick={() => { setTab('logs'); openLogs(d.provider, d.id, d.provider === 'render' ? 'build' : 'all', 24) }}>Logs</button>
                      {d.url && <a href={d.url} target="_blank" rel="noreferrer">Abrir ↗</a>}
                      {d.provider === 'vercel' && inProgress && <button disabled={busy} onClick={() => vercelAction('cancel', d.id)}>Cancelar</button>}
                      {d.provider === 'vercel' && !inProgress && <button disabled={busy} onClick={() => vercelAction('redeploy', d.id)}>Refazer</button>}
                      {d.provider === 'render' && inProgress && <button disabled={busy} onClick={() => renderAction('cancel', d.id)}>Cancelar</button>}
                      {d.provider === 'render' && !inProgress && <button disabled={busy} onClick={() => renderAction('deploy')}>Refazer</button>}
                      {d.provider === 'render' && i > 0 && !inProgress && <button disabled={busy} onClick={() => renderAction('rollback', d.id)}>Rollback</button>}
                    </div>
                  </article>
                )
              })}
            </div>
          ) : <div className="pd-empty">Nenhum deploy encontrado.</div>}
        </section>
      )}

      {tab === 'logs' && (
        <section className="pd-box pd-logs-box">
          <header><div><small>DIAGNÓSTICO</small><h2>Logs sem sair do painel</h2></div><span>build e aplicação</span></header>
          <p className="pd-copy">Escolha o que quer investigar. Quando uma publicação falha, prefira o log de build; para erros do servidor em execução, use os logs da aplicação.</p>
          <div className="pd-log-shortcuts">
            {data.provedores?.vercel && <button onClick={() => openLogs('vercel')}>▲ Último build Vercel</button>}
            {data.provedores?.render && <button onClick={() => openLogs('render', '', 'build', 24)}>R Build Render</button>}
            {data.provedores?.render && <button onClick={() => openLogs('render', '', 'app', 24)}>R Aplicação Render</button>}
            {data.provedores?.render && <button onClick={() => openLogs('render', '', 'errors', 168)}>R Só erros · 7 dias</button>}
          </div>
          {logs ? (
            <LogsPanel
              logs={logs}
              busy={busy}
              onClose={() => setLogs(null)}
              onReload={() => openLogs(logs.kind, logs.deploymentId, logs.scope, logs.hours)}
              onRedeploy={() => logs.kind === 'vercel' ? vercelAction('redeploy', logs.deploymentId) : renderAction('deploy')}
              onRedeployClean={() => logs.kind === 'render' ? renderAction('deploy', '', true) : null}
            />
          ) : (
            <div className="pd-log-empty">
              <AdminIcon name="server" size={24} />
              <b>Escolha uma fonte de log</b>
              <span>Se houver uma falha recente, o painel também tenta abrir automaticamente o log correspondente.</span>
            </div>
          )}
        </section>
      )}

      {tab === 'variaveis' && (
        <section className="pd-box">
          <header><div><small>CONFIGURAÇÃO</small><h2>Variáveis de ambiente</h2></div><span>valores protegidos</span></header>
          <p className="pd-copy">O AL Sistemas mostra os nomes e valores mascarados. Segredos completos não são exibidos nesta central.</p>
          <div className="pd-load-actions">
            {data.provedores?.vercel && <button onClick={() => openEnv('vercel')}>▲ Carregar Vercel</button>}
            {data.provedores?.render && <button onClick={() => openEnv('render')}>R Carregar Render</button>}
          </div>
          {env && <EnvPanel env={env} onClose={() => setEnv(null)} onSave={env.kind === 'render' ? saveRenderEnv : null} busy={busy} />}
        </section>
      )}

      {tab === 'analise' && (
        <section className="pd-box">
          <header><div><small>ANÁLISE AUTOMÁTICA</small><h2>O que merece atenção</h2></div><span>sem IA</span></header>
          {data.analise?.alertas?.length ? (
            <div className="pd-alerts">{data.analise.alertas.map((a, i) => <article key={i} className={a.nivel}><span>{a.nivel === 'erro' ? '!' : a.nivel === 'aviso' ? '△' : 'i'}</span><div><b>{a.titulo}</b><small>{a.descricao}</small></div></article>)}</div>
          ) : (
            <div className="pd-clear"><AdminIcon name="check" size={16} /><div><b>Nenhum problema importante detectado</b><small>Os provedores e deploys recentes estão coerentes.</small></div></div>
          )}
          <div className="pd-analysis-meta">
            <div><small>Vínculo automático</small><b>{data.analise?.linkedBy === 'producao' ? 'Vínculo da produção' : data.analise?.linkedBy === 'repositorio' ? 'Mesmo repositório GitHub' : 'Nome do projeto'}</b></div>
            <div><small>Repositório</small><b>{data.analise?.repo?.slug || 'Não identificado'}</b></div>
            <div><small>Falhas na amostra</small><b>{data.analise?.stats?.falhas || 0} de {data.analise?.stats?.amostra || 0}</b></div>
          </div>
        </section>
      )}

      <style>{`
        .pd-page{display:grid;gap:13px}.pd-loading{min-height:220px;display:flex;justify-content:center;align-items:center;gap:8px;color:var(--adm-muted);font-size:11px}.pd-breadcrumb{display:flex;gap:6px;align-items:center;font-size:9px;color:var(--adm-muted)}.pd-breadcrumb a{display:flex;align-items:center;gap:2px;color:var(--adm-accent);text-decoration:none}.pd-hero{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;padding:17px;border:1px solid var(--adm-border);border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--adm-accent) 5%,var(--adm-surface)),var(--adm-surface))}.pd-kicker,.pd-box header small,.pd-panel-health header small,.pd-incident small{font-size:8px;font-weight:900;letter-spacing:.13em;color:var(--adm-accent)}.pd-hero h1{margin:4px 0 7px;font-size:24px;color:var(--adm-text)}.pd-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.pd-meta>span:not(.pd-pill){font-size:8px;color:var(--adm-muted);border:1px solid var(--adm-border);border-radius:999px;padding:4px 6px}.pd-actions{display:flex;gap:6px;flex-wrap:wrap}.pd-actions a,.pd-actions button,.pd-load-actions button,.pd-log-shortcuts button,.pd-provider footer button,.pd-incident button,.pd-log-tools button{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:7px 9px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);color:var(--adm-text);text-decoration:none;font-size:9px;font-weight:750;cursor:pointer}.pd-actions button:disabled,.pd-provider button:disabled,.pd-deploy-actions button:disabled,.pd-log-tools button:disabled{opacity:.55;cursor:not-allowed}.pd-tabs{display:flex;gap:5px;overflow:auto}.pd-tabs button{white-space:nowrap;padding:7px 10px;border:1px solid var(--adm-border);border-radius:999px;background:var(--adm-surface);color:var(--adm-muted);font-size:9px;font-weight:800}.pd-tabs button.active{color:#fff;background:var(--adm-accent);border-color:var(--adm-accent)}.pd-stack{display:grid;gap:11px}.pd-summary,.pd-health-grid,.pd-analysis-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.pd-summary>div,.pd-health-grid>div,.pd-analysis-meta>div{display:grid;gap:2px;padding:10px 11px;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-surface)}.pd-summary b,.pd-health-grid b{font-size:16px;color:var(--adm-text)}.pd-summary small,.pd-health-grid small,.pd-analysis-meta small{font-size:8px;color:var(--adm-muted)}.pd-summary .bad b{color:var(--adm-red)}.pd-provider-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.pd-provider{padding:13px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface);min-width:0}.pd-provider.has-error{border-color:color-mix(in srgb,var(--adm-red) 32%,var(--adm-border))}.pd-provider>header{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:8px;align-items:center}.pd-logo{width:34px;height:34px;border-radius:10px;border:1px solid var(--adm-border);display:grid;place-items:center;font-weight:900}.pd-logo.vercel,.pd-deploy-mark.vercel{background:#111;color:white}.pd-logo.render,.pd-deploy-mark.render{color:#7c3aed;background:#7c3aed10;border-color:#7c3aed33}.pd-provider header small{font-size:7px;font-weight:900;color:var(--adm-muted);letter-spacing:.09em}.pd-provider h3{margin:2px 0 0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pd-pill{display:inline-flex;align-items:center;padding:4px 6px;border-radius:999px;border:1px solid var(--adm-border);font-size:8px;font-weight:850;white-space:nowrap}.pd-pill.ok{color:var(--adm-success);border-color:color-mix(in srgb,var(--adm-success) 20%,transparent);background:color-mix(in srgb,var(--adm-success) 4%,transparent)}.pd-pill.info{color:var(--adm-blue);border-color:color-mix(in srgb,var(--adm-blue) 20%,transparent);background:color-mix(in srgb,var(--adm-blue) 4%,transparent)}.pd-pill.bad{color:var(--adm-red);border-color:color-mix(in srgb,var(--adm-red) 20%,transparent);background:color-mix(in srgb,var(--adm-red) 4%,transparent)}.pd-pill.muted{color:var(--adm-muted)}.pd-provider dl{display:grid;grid-template-columns:72px minmax(0,1fr);gap:5px 8px;margin:12px 0}.pd-provider dt{font-size:8px;color:var(--adm-muted)}.pd-provider dd{font-size:9px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pd-provider dd a{color:var(--adm-accent);text-decoration:none}.pd-last{display:grid;gap:2px;padding:9px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2)}.pd-last small{font-size:7px;font-weight:900;letter-spacing:.1em;color:var(--adm-muted)}.pd-last b{font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pd-last span{font-size:8px;color:var(--adm-muted)}.pd-failure-hint{display:flex;align-items:flex-start;gap:7px;margin-top:8px;padding:8px 9px;border:1px solid color-mix(in srgb,var(--adm-red) 25%,var(--adm-border));border-radius:9px;background:color-mix(in srgb,var(--adm-red) 4%,var(--adm-surface));color:var(--adm-red)}.pd-failure-hint span{font-size:8px;line-height:1.4;color:var(--adm-muted)}.pd-provider footer{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.pd-box,.pd-panel-health{padding:14px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface)}.pd-box>header,.pd-panel-health>header{display:flex;justify-content:space-between;gap:10px;align-items:flex-end;margin-bottom:10px}.pd-box h2,.pd-panel-health h2{margin:3px 0 0;font-size:16px}.pd-box header>span,.pd-panel-health header>span{font-size:8px;color:var(--adm-muted)}.pd-panel-health header>span.ok{color:var(--adm-success)}.pd-panel-health header>span.warn{color:var(--adm-amber)}.pd-incident{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:9px;align-items:center;padding:11px 12px;border:1px solid color-mix(in srgb,var(--adm-red) 28%,var(--adm-border));border-radius:12px;background:color-mix(in srgb,var(--adm-red) 4%,var(--adm-surface))}.pd-incident>div:nth-child(2){display:grid;gap:2px;min-width:0}.pd-incident b{font-size:10px;color:var(--adm-text)}.pd-incident span{font-size:8px;color:var(--adm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pd-timeline{display:grid;gap:6px}.pd-timeline article{display:grid;grid-template-columns:30px minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:8px 9px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2)}.pd-timeline article.failed{border-color:color-mix(in srgb,var(--adm-red) 28%,var(--adm-border))}.pd-deploy-mark{width:28px;height:28px;border-radius:8px;border:1px solid var(--adm-border);display:grid;place-items:center;font-size:9px;font-weight:900}.pd-timeline article>div:nth-child(2){min-width:0;display:grid;gap:2px}.pd-timeline b{font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pd-timeline article>div:nth-child(2)>span{font-size:8px;color:var(--adm-muted)}.pd-timeline a{font-size:8px;color:var(--adm-accent);text-decoration:none}.pd-deploy-actions{display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.pd-deploy-actions button{border:1px solid var(--adm-border);border-radius:7px;padding:5px 6px;background:var(--adm-surface);color:var(--adm-text);font-size:8px}.pd-copy{font-size:9px;color:var(--adm-muted);line-height:1.5}.pd-load-actions,.pd-log-shortcuts{display:flex;gap:7px;flex-wrap:wrap}.pd-log-shortcuts{margin:10px 0}.pd-alerts{display:grid;gap:6px}.pd-alerts article{display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;padding:9px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2)}.pd-alerts article>span{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-weight:900}.pd-alerts .erro>span{color:var(--adm-red);background:color-mix(in srgb,var(--adm-red) 6%,transparent)}.pd-alerts .aviso>span{color:var(--adm-amber);background:color-mix(in srgb,var(--adm-amber) 6%,transparent)}.pd-alerts .info>span{color:var(--adm-blue);background:color-mix(in srgb,var(--adm-blue) 6%,transparent)}.pd-alerts article>div{display:grid;gap:2px}.pd-alerts b{font-size:9px}.pd-alerts small{font-size:8px;color:var(--adm-muted);line-height:1.4}.pd-clear{display:flex;gap:8px;align-items:center;padding:10px;border:1px solid color-mix(in srgb,var(--adm-success) 20%,transparent);border-radius:10px;background:color-mix(in srgb,var(--adm-success) 4%,transparent);color:var(--adm-success)}.pd-clear>div{display:grid;gap:2px}.pd-clear b{font-size:9px;color:var(--adm-text)}.pd-clear small{font-size:8px;color:var(--adm-muted)}.pd-analysis-meta{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:9px}.pd-analysis-meta b{font-size:9px;overflow-wrap:anywhere}.pd-empty,.pd-log-empty{min-height:100px;display:grid;place-items:center;align-content:center;gap:7px;color:var(--adm-muted);font-size:10px;text-align:center}.pd-empty a{color:var(--adm-accent)}.pd-log-empty{margin-top:10px;border:1px dashed var(--adm-border);border-radius:12px;padding:18px}.pd-log-empty b{color:var(--adm-text)}.pd-log-empty span{font-size:8px;max-width:480px;line-height:1.45}.pd-drawer{margin-top:11px;border:1px solid var(--adm-border);border-radius:12px;overflow:hidden;background:var(--adm-surface)}.pd-drawer>header{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:10px 11px;background:var(--adm-surface2);border-bottom:1px solid var(--adm-border)}.pd-drawer header b{font-size:10px}.pd-drawer header button{border:0;background:transparent;color:var(--adm-muted);font-size:17px}.pd-env-list{display:grid}.pd-env-editor{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr) auto;gap:6px;padding:9px;border-top:1px solid var(--adm-border);background:var(--adm-surface2)}.pd-env-editor input{min-width:0;padding:7px 8px;border:1px solid var(--adm-border);border-radius:7px;background:var(--adm-bg);color:var(--adm-text);font-size:9px}.pd-env-editor button{border:1px solid var(--adm-border);border-radius:7px;padding:7px 8px;background:var(--adm-surface);color:var(--adm-text);font-size:8px}.pd-env-editor .primary{background:var(--adm-accent);border-color:var(--adm-accent);color:#fff}.pd-env-row{display:flex;justify-content:space-between;gap:9px;padding:8px 10px;border-top:1px solid var(--adm-border)}.pd-env-row:first-child{border-top:0}.pd-env-row>div{display:grid;gap:2px;min-width:0}.pd-env-row b{font-size:9px;overflow-wrap:anywhere}.pd-env-row small,.pd-env-row code{font-size:8px;color:var(--adm-muted)}.pd-log-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 11px;border-bottom:1px solid var(--adm-border);background:var(--adm-surface2)}.pd-log-head>div:first-child{display:grid;gap:2px}.pd-log-head small{font-size:7px;font-weight:900;color:var(--adm-accent);letter-spacing:.11em}.pd-log-head b{font-size:11px}.pd-log-head span{font-size:8px;color:var(--adm-muted)}.pd-log-tools{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.pd-log-diagnosis{display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;margin:10px;padding:10px;border:1px solid color-mix(in srgb,var(--adm-red) 26%,var(--adm-border));border-radius:10px;background:color-mix(in srgb,var(--adm-red) 4%,var(--adm-surface))}.pd-log-diagnosis>span{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:color-mix(in srgb,var(--adm-red) 8%,transparent);color:var(--adm-red);font-weight:900}.pd-log-diagnosis>div{display:grid;gap:3px;min-width:0}.pd-log-diagnosis b{font-size:9px;color:var(--adm-text)}.pd-log-diagnosis code{font:500 8px/1.45 monospace;color:var(--adm-red);white-space:pre-wrap;overflow-wrap:anywhere}.pd-log-list{display:grid;gap:5px;padding:9px;max-height:54vh;overflow:auto;background:var(--adm-bg)}.pd-log-row{display:grid;grid-template-columns:70px minmax(0,1fr);gap:8px;padding:8px 9px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface)}.pd-log-row.bad{border-color:color-mix(in srgb,var(--adm-red) 28%,var(--adm-border));background:color-mix(in srgb,var(--adm-red) 3%,var(--adm-surface))}.pd-log-row.warn{border-color:color-mix(in srgb,var(--adm-amber) 24%,var(--adm-border))}.pd-log-row.ok{border-color:color-mix(in srgb,var(--adm-success) 20%,var(--adm-border))}.pd-log-meta{display:grid;align-content:start;gap:3px}.pd-log-meta span{font-size:7px;color:var(--adm-muted)}.pd-log-meta b{font-size:7px;text-transform:uppercase;color:var(--adm-accent)}.pd-log-row code{white-space:pre-wrap;overflow-wrap:anywhere;font:500 8px/1.5 monospace;color:var(--adm-text)}.pd-drawer-msg{padding:14px;font-size:9px;color:var(--adm-muted)}
        @media(max-width:760px){.pd-env-editor{grid-template-columns:1fr 1fr}.pd-hero{display:grid}.pd-provider-grid{grid-template-columns:1fr}.pd-summary,.pd-health-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pd-analysis-meta{grid-template-columns:1fr}.pd-timeline article{grid-template-columns:28px minmax(0,1fr) auto}.pd-deploy-actions{grid-column:2/-1;justify-content:flex-start}.pd-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.pd-actions>*{justify-content:center}.pd-incident{grid-template-columns:30px minmax(0,1fr)}.pd-incident button{grid-column:2}.pd-log-head{display:grid}.pd-log-tools{justify-content:flex-start}.pd-log-row{grid-template-columns:56px minmax(0,1fr)}}
      `}</style>
    </div>
  )
}

function EnvPanel({ env, onClose, onSave, busy }) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  async function submit(deploy = false) {
    const k = key.trim(), v = value
    if (!k || !v) return toast.error('Informe nome e valor da variável.')
    await onSave?.(k, v, deploy)
    setKey(''); setValue('')
  }
  return (
    <div className="pd-drawer">
      <header><b>{env.title}</b><button onClick={onClose}>×</button></header>
      {env.loading ? <div className="pd-drawer-msg">Consultando variáveis…</div>
        : env.error ? <div className="pd-drawer-msg">{env.error}</div>
          : <>
            {env.items?.length ? <div className="pd-env-list">{env.items.map((x, i) => <div className="pd-env-row" key={`${x.id || i}-${x.key}`}><div><b>{x.key}</b><small>{Array.isArray(x.target) ? x.target.join(', ') : (x.target || '')}</small></div><code>{x.valueMasked || 'protegida'}</code></div>)}</div> : <div className="pd-drawer-msg">Nenhuma variável encontrada.</div>}
            {onSave && <div className="pd-env-editor"><input value={key} onChange={e => setKey(e.target.value.toUpperCase())} placeholder="NOME_DA_VARIAVEL" /><input type="password" value={value} onChange={e => setValue(e.target.value)} placeholder="Novo valor" /><button disabled={busy} onClick={() => submit(false)}>Salvar</button><button className="primary" disabled={busy} onClick={() => submit(true)}>Salvar + deploy</button></div>}
          </>}
    </div>
  )
}

function LogsPanel({ logs, onClose, onReload, onRedeploy, onRedeployClean, busy }) {
  const items = logs.items || []
  const diagnosis = logs.diagnostico
  const report = [
    `AL Sistemas — diagnóstico ${logs.kind === 'vercel' ? 'Vercel' : 'Render'}`,
    `Deployment: ${logs.deploymentId || 'último disponível'}`,
    logs.janelaHoras ? `Janela consultada: ${logs.janelaHoras} hora(s)` : '',
    diagnosis?.erroPrincipal ? `Erro principal: ${diagnosis.erroPrincipal}` : 'Erro principal: não identificado automaticamente',
    '',
    ...items.map(x => `[${x.criado ? new Date(x.criado).toISOString() : x.tipo || 'log'}] ${logText(x)}`),
  ].filter(Boolean).join('\n')

  async function copyReport() {
    try { await navigator.clipboard.writeText(report); toast.success('Log copiado.') }
    catch { toast.error('Não foi possível copiar o log.') }
  }

  return (
    <div className="pd-drawer">
      <div className="pd-log-head">
        <div>
          <small>{logs.kind === 'vercel' ? 'VERCEL · BUILD' : `RENDER · ${logs.scope === 'build' ? 'BUILD' : logs.scope === 'app' ? 'APLICAÇÃO' : logs.scope === 'errors' ? 'ERROS' : 'LOGS'}`}</small>
          <b>{logs.title}</b>
          <span>{logs.loading ? 'Consultando…' : `${items.length} linha(s)${logs.janelaHoras ? ` · ${logs.janelaHoras} h` : ''}${logs.deploymentScoped ? ' · deploy específico' : ''}${logs.fallback ? ' · busca ampliada automaticamente' : ''}`}</span>
        </div>
        <div className="pd-log-tools">
          <button disabled={logs.loading} onClick={onReload}><AdminIcon name="refresh" size={11} /> Atualizar</button>
          <button disabled={!items.length} onClick={copyReport}><AdminIcon name="copy" size={11} /> Copiar</button>
          <button disabled={!items.length} onClick={() => downloadText(`alsistemas-${logs.kind}-logs.txt`, report)}>Baixar .txt</button>
          <button disabled={busy || logs.loading} onClick={onRedeploy}>Refazer deploy</button>
          {logs.kind === 'render' && <button disabled={busy || logs.loading} onClick={onRedeployClean}>Refazer + limpar cache</button>}
          <button onClick={onClose}>Fechar</button>
        </div>
      </div>

      {logs.loading ? <div className="pd-drawer-msg"><AdminIcon name="spinSm" size={13} /> Buscando logs do provedor…</div>
        : logs.error ? <div className="pd-drawer-msg">{logs.error}</div>
          : <>
            {diagnosis?.erroPrincipal && (
              <div className="pd-log-diagnosis">
                <span>!</span>
                <div><b>Possível causa principal</b><code>{diagnosis.erroPrincipal}</code></div>
              </div>
            )}
            {items.length ? (
              <div className="pd-log-list">
                {items.map((x, i) => (
                  <div className={`pd-log-row ${logTone(x)}`} key={x.id || i}>
                    <div className="pd-log-meta"><b>{x.tipo || x.nivel || 'log'}</b><span>{x.criado ? ago(x.criado) : '—'}</span></div>
                    <code>{logText(x)}</code>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pd-log-empty">
                <AdminIcon name="info" size={22} />
                <b>Nenhuma linha retornada</b>
                <span>{logs.kind === 'render' ? 'O painel já ampliou a busca quando necessário. Tente outra categoria, como Build ou Aplicação.' : 'A Vercel não retornou eventos de build para este deployment.'}</span>
              </div>
            )}
          </>}
    </div>
  )
}
