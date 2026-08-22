import { lazyWithRetry } from '../../utils/lazyWithRetry'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { infraestruturaService } from '../../services/api'
import { confirmAction } from '../../utils/confirmAction.js'
import { Spin } from '../../components/admin/infra/InfraBase'
import { DSPageHeader, DSBtn, DSBadge, DSAlert } from '../../components/admin/ui/DS'

const AbaSistema = lazyWithRetry(() => import('../../components/admin/infra/AbaSistema'))
const FRONTEND_API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:3001/api' : '/api')
const FRONTEND_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : (import.meta.env.VITE_APP_VERSION || 'desconhecida')
const FRONTEND_COMMIT = typeof __APP_GIT_SHA__ !== 'undefined' ? __APP_GIT_SHA__ : ''

const TABS = [
  ['visao', 'Visão geral'],
  ['servidor', 'Servidor'],
  ['ambiente', 'Ambiente'],
  ['manutencao', 'Manutenção'],
]


function HealthCard({ label, value, detail, ok, href }) {
  const Tag = href ? Link : 'div'
  const props = href ? { to: href } : {}
  return <Tag {...props} className={`infra-health ${ok === false ? 'bad' : ok === true ? 'ok' : ''}`}>
    <div className="infra-health-head"><span className="infra-health-dot"/><small>{label}</small></div>
    <b>{value || '—'}</b>
    <span>{detail || 'Sem detalhes'}</span>
    {href && <em>Abrir →</em>}
  </Tag>
}

function EnvironmentCheck({ item }) {
  return <div className={`infra-check ${item.ok ? 'ok' : 'bad'}`}>
    <span>{item.ok ? '✓' : '!'}</span>
    <div><b>{item.label}</b><small>{item.detail}</small></div>
  </div>
}

export default function AdminSistema() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab = TABS.some(([id]) => id === requested) ? requested : 'visao'
  const [metricas, setMetricas] = useState(null)
  const [compat, setCompat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [limpando, setLimpando] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro('')
    const [m, c] = await Promise.allSettled([
      infraestruturaService.sistemaMetricas(),
      infraestruturaService.plataformasCompatibilidade(),
    ])
    if (m.status === 'fulfilled') setMetricas(m.value)
    if (c.status === 'fulfilled') setCompat(c.value)
    const falhas = [m, c].filter(x => x.status === 'rejected').map(x => x.reason?.message).filter(Boolean)
    if (falhas.length === 2) setErro(falhas[0] || 'Não foi possível consultar a infraestrutura.')
    else if (falhas.length) setErro(`Parte do diagnóstico não respondeu: ${falhas[0]}`)
    setUpdatedAt(new Date())
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const checkMap = useMemo(() => Object.fromEntries((compat?.checks || []).map(x => [x.id, x])), [compat])
  const backendVersion = compat?.backend?.version || metricas?.processo?.versaoApp || ''
  const versionsKnown = Boolean(backendVersion && backendVersion !== 'desconhecida' && FRONTEND_VERSION && FRONTEND_VERSION !== 'desconhecida')
  const versionsMatch = versionsKnown ? backendVersion === FRONTEND_VERSION : null
  const commitsKnown = Boolean(compat?.backend?.commit && FRONTEND_COMMIT)
  const commitsMatch = commitsKnown ? compat.backend.commit === FRONTEND_COMMIT : null

  function mudarTab(id) {
    const next = new URLSearchParams(params)
    if (id === 'visao') next.delete('tab'); else next.set('tab', id)
    setParams(next, { replace: true })
  }

  async function limparCache() {
    const ok = await confirmAction('Limpar todo o cache do backend? Use esta ação apenas quando dados ou configurações estiverem desatualizados.', {
      title: 'Limpar cache do sistema', confirmLabel: 'Limpar cache', danger: true,
    })
    if (!ok) return
    setLimpando(true)
    try {
      const res = await infraestruturaService.limparCache()
      toast.success(res.mensagem || 'Cache limpo com sucesso')
      await carregar()
    } catch (e) { toast.error(e.message || 'Não foi possível limpar o cache') }
    finally { setLimpando(false) }
  }

  const runtimeLabel = compat?.runtime?.label || (metricas ? `${metricas?.sistema?.so || 'Servidor'} · ${metricas?.sistema?.arquitetura || ''}` : '—')
  const apiOk = Boolean(metricas)
  const aiOk = metricas?.ambiente?.aiConfigured

  return <div className="adm-page infra-center">
    <DSPageHeader
      title="Infraestrutura"
      sub="Saúde do AL Sistemas, servidor, ambiente de produção e manutenção em um só lugar."
      actions={<DSBtn onClick={carregar} loading={loading}>↻ Atualizar diagnóstico</DSBtn>}
    />

    <nav className="infra-tabs" aria-label="Seções de infraestrutura">
      {TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => mudarTab(id)}>{label}</button>)}
    </nav>

    {erro && <DSAlert variant={compat || metricas ? 'amber' : 'red'} style={{ marginBottom: 14 }}>{erro}</DSAlert>}

    {tab === 'visao' && <>
      {loading && !metricas && !compat ? <div className="infra-loading"><Spin size={24}/> Conferindo servidor, banco e produção…</div> : <>
        {versionsMatch === false && <DSAlert variant="amber" style={{ marginBottom: 12 }}><b>Frontend e backend estão em versões diferentes.</b> Frontend <b>{FRONTEND_VERSION}</b> · backend <b>{backendVersion}</b>.</DSAlert>}
        {versionsMatch === true && commitsMatch === false && <DSAlert variant="amber" style={{ marginBottom: 12 }}>A versão <b>{FRONTEND_VERSION}</b> coincide, mas os commits de frontend e backend são diferentes.</DSAlert>}

        <section className="infra-overview-head">
          <div><small>SAÚDE GERAL</small><h2>{compat?.ok !== false && apiOk ? 'Infraestrutura operacional' : 'Infraestrutura precisa de atenção'}</h2><p>O resumo usa respostas reais da API e das integrações. Nenhum serviço é marcado como configurado por uma variável que o endpoint não fornece.</p></div>
          <DSBadge variant={compat?.ok !== false && apiOk ? 'green' : 'amber'}>{compat?.ok !== false && apiOk ? 'Operacional' : 'Revisar'}</DSBadge>
        </section>

        <section className="infra-health-grid">
          <HealthCard label="Backend / API" value={apiOk ? 'Online' : 'Sem resposta'} detail={backendVersion ? `Versão ${backendVersion}` : runtimeLabel} ok={apiOk}/>
          <HealthCard label="MongoDB" value={checkMap.database?.ok ? 'Conectado' : 'Atenção'} detail={checkMap.database?.detail || 'Estado não consultado'} ok={checkMap.database?.ok} href="/admin/mongo"/>
          <HealthCard label="Frontend / CORS" value={checkMap.cors?.ok === false ? 'Bloqueado' : 'OK'} detail={compat?.frontend?.origin || FRONTEND_API} ok={checkMap.cors?.ok}/>
          <HealthCard label="GitHub" value={compat?.integrations?.github?.locked ? 'Protegido' : compat?.integrations?.github?.configured ? 'Configurado' : 'Não configurado'} detail={checkMap.github?.detail || 'Integração'} ok={compat?.integrations?.github?.locked ? false : compat?.integrations?.github?.configured} href="/admin/integracoes"/>
          <HealthCard label="Vercel" value={compat?.integrations?.vercel?.locked ? 'Protegida' : compat?.integrations?.vercel?.configured ? 'Configurada' : 'Não configurada'} detail={checkMap.vercel?.detail || 'Frontend cloud'} ok={compat?.integrations?.vercel?.locked ? false : compat?.integrations?.vercel?.configured} href="/admin/plataformas"/>
          <HealthCard label="Render" value={compat?.integrations?.render?.locked ? 'Protegido' : compat?.integrations?.render?.configured ? 'Configurado' : 'Não configurado'} detail={checkMap.render?.detail || 'Backend cloud'} ok={compat?.integrations?.render?.locked ? false : compat?.integrations?.render?.configured} href="/admin/plataformas"/>
          <HealthCard label="R2 Storage" value={compat?.integrations?.r2?.configured ? 'Configurado' : 'Não configurado'} detail={checkMap.r2?.detail || 'Armazenamento cloud'} ok={compat?.integrations?.r2?.configured} href="/admin/cloudflare"/>
          <HealthCard label="IA" value={aiOk ? 'Configurada' : 'Não configurada'} detail={aiOk ? `${metricas?.ambiente?.aiProvider || 'Provedor'} · ${metricas?.ambiente?.aiModel || 'modelo ativo'}` : 'Gemini / OpenRouter'} ok={aiOk} href="/admin/integracoes"/>
        </section>

        <section className="infra-runtime-card">
          <div><small>AMBIENTE ATUAL</small><b>{runtimeLabel}</b><span>{compat?.runtime?.managed ? 'Cloud gerenciada' : 'Local / VPS'} · Node {compat?.runtime?.node || metricas?.processo?.versaoNode || '—'}</span></div>
          <button onClick={() => mudarTab('ambiente')}>Ver ambiente →</button>
        </section>
      </>}
    </>}

    {tab === 'servidor' && <Suspense fallback={<div className="infra-loading"><Spin size={24}/> Carregando métricas…</div>}><AbaSistema /></Suspense>}

    {tab === 'ambiente' && <>
      {loading && !compat ? <div className="infra-loading"><Spin size={24}/> Conferindo ambiente…</div> : !compat ? <DSAlert variant="red">O diagnóstico de ambiente não respondeu.</DSAlert> : <>
        <section className="infra-env-grid">
          <div><small>EXECUÇÃO</small><b>{compat.runtime?.label || '—'}</b><span>{compat.runtime?.managed ? 'Cloud gerenciada' : 'Local / VPS'} · {compat.runtime?.platform} · Node {compat.runtime?.node}</span></div>
          <div><small>VERSÕES</small><b>Frontend {FRONTEND_VERSION}</b><span>Backend {backendVersion || '—'}{FRONTEND_COMMIT || compat.backend?.commit ? ` · F ${FRONTEND_COMMIT ? FRONTEND_COMMIT.slice(0, 8) : '—'} / B ${compat.backend?.commit ? compat.backend.commit.slice(0, 8) : '—'}` : ''}</span></div>
          <div><small>AUTENTICAÇÃO</small><b>{compat.auth?.requestTransport === 'bearer' ? 'Bearer de compatibilidade' : 'Cookie HttpOnly'}</b><span>{compat.auth?.crossOrigin ? 'Frontend e backend em domínios diferentes' : 'Mesma origem / ambiente local'}</span></div>
          <div><small>FRONTEND / API</small><b>{compat.cors?.allowed === false ? 'CORS bloqueado' : 'CORS autorizado'}</b><span className="break">{compat.frontend?.origin || 'Origem não informada'} · API {FRONTEND_API}</span></div>
        </section>

        <section className="infra-diagnostic-card"><header><div><small>DIAGNÓSTICO</small><h3>Serviços e compatibilidade</h3></div><DSBadge variant={compat.ok ? 'green' : 'amber'}>{compat.ok ? 'Base pronta' : 'Atenção'}</DSBadge></header><div className="infra-check-grid">{(compat.checks || []).map(item => <EnvironmentCheck key={item.id} item={item}/>)}</div></section>

        <section className="infra-mode-grid">
          <div><DSBadge variant="green">Preservado</DSBadge><h3>Termux / VPS</h3><p>Cookie HttpOnly e filesystem persistente continuam compatíveis quando o AL Sistemas roda localmente.</p></div>
          <div><DSBadge variant="blue">Compatível</DSBadge><h3>Vercel + Render</h3><p>Quando os domínios são diferentes, o painel usa cookie quando aceito e Bearer de sessão como fallback. A publicação continua em R2 → GitHub → Vercel/Render.</p></div>
        </section>
      </>}
    </>}

    {tab === 'manutencao' && <section className="infra-maintenance">
      <div className="infra-maintenance-intro"><small>MANUTENÇÃO</small><h2>Ações administrativas</h2><p>Operações que alteram estado ficam separadas das métricas para reduzir cliques acidentais.</p></div>
      <div className="infra-maintenance-grid">
        <div><b>Cache do backend</b><p>Use quando configurações ou dados atualizados ainda aparecem desatualizados. A ação exige confirmação.</p><DSBtn variant="danger" loading={limpando} onClick={limparCache}>Limpar todo o cache</DSBtn></div>
        <div><b>Integrações e credenciais</b><p>GitHub, Vercel, Render, R2 e IA são configurados na central de integrações, sem duplicar segredos aqui.</p><Link to="/admin/integracoes">Abrir Integrações e APIs →</Link></div>
        <div><b>Erros e logs</b><p>Para diagnóstico profundo de falhas de deploy ou backend, use o módulo dedicado de erros.</p><Link to="/admin/erros">Abrir Erros e logs →</Link></div>
      </div>
    </section>}

    {updatedAt && <div className="infra-updated">Último diagnóstico: {updatedAt.toLocaleString('pt-BR')}</div>}

    <style>{`
      .infra-center{min-width:0}.infra-tabs{display:flex;gap:7px;overflow:auto;margin:-2px 0 16px;padding-bottom:2px}.infra-tabs button{min-height:40px;white-space:nowrap;border:1px solid var(--adm-border);border-radius:999px;background:var(--adm-surface);color:var(--adm-muted);padding:8px 14px;font-size:12px;font-weight:800;cursor:pointer}.infra-tabs button.active{background:var(--adm-accent);border-color:var(--adm-accent);color:#fff}.infra-loading{min-height:180px;display:flex;align-items:center;justify-content:center;gap:9px;color:var(--adm-muted);font-size:13px}.infra-overview-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:16px;margin-bottom:12px;border:1px solid var(--adm-border);border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--adm-accent) 5%,var(--adm-surface)),var(--adm-surface))}.infra-overview-head small,.infra-runtime-card small,.infra-env-grid small,.infra-diagnostic-card header small,.infra-maintenance-intro small{display:block;font-size:11px;font-weight:900;letter-spacing:.11em;color:var(--adm-accent)}.infra-overview-head h2,.infra-maintenance-intro h2{margin:4px 0 5px;font-size:19px}.infra-overview-head p,.infra-maintenance-intro p{margin:0;color:var(--adm-muted);font-size:13px;line-height:1.5;max-width:720px}.infra-health-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.infra-health{position:relative;min-width:0;display:grid;gap:5px;padding:13px;border:1px solid var(--adm-border);border-radius:13px;background:var(--adm-surface);text-decoration:none;color:var(--adm-text)}.infra-health:hover[href],a.infra-health:hover{border-color:color-mix(in srgb,var(--adm-accent) 35%,var(--adm-border))}.infra-health-head{display:flex;align-items:center;gap:6px}.infra-health-head small{font-size:11px;font-weight:850;color:var(--adm-muted);text-transform:uppercase;letter-spacing:.05em}.infra-health-dot{width:7px;height:7px;border-radius:50%;background:var(--adm-subtle)}.infra-health.ok .infra-health-dot{background:var(--adm-success)}.infra-health.bad .infra-health-dot{background:var(--adm-red)}.infra-health>b{font-size:15px;overflow-wrap:anywhere}.infra-health>span{font-size:12px;line-height:1.4;color:var(--adm-muted);overflow-wrap:anywhere}.infra-health>em{font-size:12px;font-style:normal;font-weight:800;color:var(--adm-accent);margin-top:2px}.infra-runtime-card{margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface)}.infra-runtime-card>div{display:grid;gap:3px;min-width:0}.infra-runtime-card b{font-size:14px}.infra-runtime-card span{font-size:12px;color:var(--adm-muted)}.infra-runtime-card button{border:0;background:transparent;color:var(--adm-accent);font-size:12px;font-weight:850;cursor:pointer;white-space:nowrap}.infra-env-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.infra-env-grid>div{display:grid;gap:4px;padding:14px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface)}.infra-env-grid b{font-size:14px}.infra-env-grid span{font-size:12px;line-height:1.45;color:var(--adm-muted)}.infra-env-grid .break{overflow-wrap:anywhere}.infra-diagnostic-card{margin-top:12px;padding:14px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface)}.infra-diagnostic-card>header{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:10px}.infra-diagnostic-card h3{margin:3px 0 0;font-size:16px}.infra-check-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.infra-check{display:grid;grid-template-columns:28px minmax(0,1fr);gap:9px;align-items:start;padding:11px;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-surface2)}.infra-check>span{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-weight:900;background:color-mix(in srgb,var(--adm-success) 10%,transparent);color:var(--adm-success)}.infra-check.bad>span{background:color-mix(in srgb,var(--adm-red) 9%,transparent);color:var(--adm-red)}.infra-check>div{display:grid;gap:2px;min-width:0}.infra-check b{font-size:13px}.infra-check small{font-size:12px;color:var(--adm-muted);line-height:1.4;overflow-wrap:anywhere}.infra-mode-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.infra-mode-grid>div{padding:14px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface)}.infra-mode-grid h3{font-size:15px;margin:9px 0 5px}.infra-mode-grid p{font-size:12px;line-height:1.5;color:var(--adm-muted);margin:0}.infra-maintenance{display:grid;gap:12px}.infra-maintenance-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.infra-maintenance-grid>div{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:15px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface)}.infra-maintenance-grid b{font-size:14px}.infra-maintenance-grid p{font-size:12px;line-height:1.5;color:var(--adm-muted);margin:0 0 auto}.infra-maintenance-grid a{font-size:12px;font-weight:850;color:var(--adm-accent);text-decoration:none}.infra-updated{margin-top:12px;text-align:right;font-size:11px;color:var(--adm-muted)}
      @media(max-width:900px){.infra-health-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.infra-maintenance-grid{grid-template-columns:1fr}.infra-check-grid{grid-template-columns:1fr}}
      @media(max-width:620px){.infra-tabs{margin-top:0}.infra-tabs button{min-height:42px;padding:9px 13px}.infra-overview-head{padding:14px;display:grid}.infra-health-grid,.infra-env-grid,.infra-mode-grid{grid-template-columns:1fr 1fr}.infra-health{padding:12px}.infra-runtime-card{align-items:flex-start;flex-direction:column}.infra-runtime-card button{min-height:38px}.infra-env-grid>div{padding:12px}}
      @media(max-width:430px){.infra-health-grid,.infra-env-grid,.infra-mode-grid{grid-template-columns:1fr}.infra-overview-head h2,.infra-maintenance-intro h2{font-size:18px}}
    `}</style>
  </div>
}
