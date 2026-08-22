/**
 * AdminGitHub.jsx — Painel Completo de Ciclo de Vida de Repositórios
 *
 * MIGRADO: DS Sprint (Fase 3)
 *   - Btn local (4 variantes)   → DSBtn
 *   - Secao local               → DSSectionTitle
 *   - Status badges inline      → DSBadge com cor dinâmica
 *   - STATUS_CFG cores          → T.red / T.blue / T.amber / T.muted
 *   - STATUS_RUN_COR            → T.*
 *   - MATURIDADE_COR / FREQ_COR → T.*
 *   - Toast local               → mantido (toast fixo de posição específica)
 *   - PainelDetalhes slide-over → mantido (drawer lateral, não é modal padrão)
 *   - Todos borderRadius        → RADIUS.*
 *   - Todos fontSize            → FONT.*
 *   - Todos gap/padding         → SPACE.*
 *   - Todas as cores hex        → T.*
 *
 * Funcionalidades preservadas integralmente.
 * Token GitHub NUNCA exposto — toda comunicação via proxy backend.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useGitHubRepos }   from '../../modules/github/useGitHubRepos.js'
import { githubService }    from '../../services/domains/github.js'
import { updatesService }   from '../../services/domains/updates.js'
import { infraestruturaService } from '../../services/domains/infraestrutura.js'
import { T as C, SPACE, RADIUS, FONT } from '../../themes/tokens'
import AdminIcon            from '../../components/admin/ui/AdminIcon'
import { DSBtn, DSBadge, DSSectionTitle, DSModal } from '../../components/admin/ui/DS'
import NovoProjetoGitHubWizard from '../../components/admin/github/NovoProjetoGitHubWizard.jsx'
import JSZip from 'jszip'
import { AdminWizardModal, WizardInfo } from '../../components/admin/wizard/AdminWizard.jsx'

/* ── Helpers ─────────────────────────────────────────────── */
function relTime(iso) {
  if (!iso) return '—'
  const m = Math.floor((Date.now() - new Date(iso)) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m}min atrás`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h atrás`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d atrás`
  const mo = Math.floor(d / 30)
  return mo < 12 ? `${mo}mo atrás` : `${Math.floor(mo / 12)}a atrás`
}

function fmtBytes(b) {
  if (!b) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function fmtRepoSize(kb) {
  const n = Number(kb || 0)
  if (n < 1024) return `${n} KB`
  return `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)} MB`
}

function ehArtefatoApk(a = {}) {
  if (a?.provavelApk === true) return true
  return /(?:^|[-_.])(apk|android|debug|release)(?:[-_.]|$)/i.test(String(a?.nome || ''))
}

function shortDate(iso) {
  if (!iso) return '—'
  try { return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'short', year:'numeric' }).format(new Date(iso)).replace('.', '') }
  catch { return '—' }
}

function fmtDuracao(ms) {
  if (!ms || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function plural(n, singular, pluralForm = `${singular}s`) {
  const value = Number(n || 0)
  return `${value} ${value === 1 ? singular : pluralForm}`
}

const STATUS_VISUAL = {
  skip:'Pulado', skipped:'Pulado', add:'Adicionado', added:'Adicionado', update:'Atualizado', updated:'Atualizado',
  delete:'Removido', deleted:'Removido', create:'Criado', created:'Criado', success:'Concluído', successful:'Concluído',
  failed:'Falhou', failure:'Falhou', error:'Erro', pending:'Pendente', queued:'Pendente', running:'Em andamento',
  in_progress:'Em andamento', upload:'Enviado', uploaded:'Enviado', cancelled:'Cancelado', paused:'Pausado', done:'Concluído', active:'Em andamento',
}
function statusVisual(value='') { return STATUS_VISUAL[String(value || '').toLowerCase()] || String(value || '').replaceAll('_',' ') }
function sanitizeLogText(value='') {
  return String(value || '')
    .replace(/(authorization:\s*bearer\s+)[^\s]+/ig, '$1[oculto]')
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*\s*[=:]\s*)[^\s,;]+/ig, '$1[oculto]')
}

/* ── Linguagens ──────────────────────────────────────────── */
const LANG_COR = {
  JavaScript:'#f7df1e', TypeScript:'#3178c6', Python:'#3572A5',
  Rust:'#dea584', Go:'#00ADD8', Java:'#b07219', PHP:'#4F5D95',
  Ruby:'#701516', CSS:'#563d7c', HTML:'#e34c26', Shell:'#89e051',
  Kotlin:'#7F52FF', Dart:'#0175C2', Swift:'#F05138',
}

function LangBadge({ lang, size = 10 }) {
  if (!lang) return null
  const cor = LANG_COR[lang] || C.muted
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: size, fontWeight: 600, color: C.text,
      background: `${cor}22`, border: `1px solid ${cor}44`,
      borderRadius: RADIUS.xs, padding: `2px ${SPACE.sm}px`,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: cor, flexShrink: 0 }} />
      {lang}
    </span>
  )
}

/* ── Configurações de status — tokens em vez de hex ─────── */
const STATUS_CFG = {
  ativo:     { cor: C.greenSolid, label: 'Ativo'     },
  arquivado: { cor: C.subtle,     label: 'Arquivado' },
  estudo:    { cor: C.blue,       label: 'Estudo'    },
  legado:    { cor: C.amber,      label: 'Legado'    },
}
const MATURIDADE_COR = {
  ativo:      C.greenSolid,
  moderado:   C.amber,
  inativo:    C.orange,
  abandonado: C.red,
}
const FREQ_COR = {
  alta:   C.greenSolid,
  média:  C.blue,
  baixa:  C.amber,
  inativa:C.subtle,
}
const STATUS_RUN_COR = {
  success:     C.greenSolid,
  failure:     C.red,
  cancelled:   C.subtle,
  skipped:     C.subtle,
  in_progress: C.blue,
  queued:      C.amber,
  waiting:     C.amber,
}
const STATUS_RUN_LABEL = {
  success:'Concluído', failure:'Falhou', cancelled:'Cancelado', skipped:'Pulado',
  in_progress:'Em andamento', queued:'Na fila', waiting:'Aguardando', requested:'Solicitado',
  active:'Ativo', disabled_manually:'Desativado', disabled_inactivity:'Desativado por inatividade',
}
function runStatusLabel(value){ return STATUS_RUN_LABEL[value] || String(value || '—').replaceAll('_',' ') }

/* ── Toast simples (posição fixa, mantido local) ────────── */
function useToast() {
  const [toast, setToast] = useState(null)
  const show = useCallback((msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3200)
  }, [])
  return { toast, show }
}

function Toast({ toast }) {
  if (!toast) return null
  const ok = toast.tipo !== 'erro'
  return (
    <div style={{
      position: 'fixed', bottom: SPACE.xl3, right: SPACE.xl3, zIndex: 9999,
      background: ok ? C.greenBg : C.redBg,
      border: `1px solid ${ok ? C.greenBorder : C.redBorder}`,
      borderRadius: RADIUS.lg, padding: `${SPACE.lg}px ${SPACE.xl2}px`,
      fontSize: FONT.md, fontWeight: 600,
      color: ok ? C.greenSolid : C.red,
      boxShadow: 'var(--adm-shadow-md)', maxWidth: 340,
    }}>
      {toast.msg}
    </div>
  )
}

/* ── Skeleton ─────────────────────────────────────────────── */
function Skeleton({ n = 6 }) {
  return (
    <div style={{ display: 'grid', gap: SPACE.md + 2 }}>
      {[...Array(n)].map((_, i) => (
        <div key={i} style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: RADIUS.lg, padding: `14px ${SPACE.xl}px`, height: 76,
          opacity: 1 - i * 0.12,
        }} />
      ))}
    </div>
  )
}

/* ── Input style reutilizável ─────────────────────────────── */
const inp = (extra = {}) => ({
  background: C.surface, border: `1px solid ${C.border}`,
  borderRadius: RADIUS.sm, padding: `${SPACE.md}px ${SPACE.lg}px`,
  fontSize: FONT.base, color: C.text, outline: 'none',
  width: '100%', boxSizing: 'border-box', ...extra,
})

/* ── Badge de status de run ──────────────────────────────── */
function RunBadge({ status, conclusao }) {
  const cor   = STATUS_RUN_COR[conclusao || status] || C.muted
  const label = runStatusLabel(conclusao || status || '?')
  return (
    <DSBadge style={{ background: `${cor}18`, color: cor, borderColor: `${cor}30` }}>
      {label}
    </DSBadge>
  )
}

/* ═══════════════════════════════════════════════════════════
   PAINEL DE DETALHES (slide-over lateral)
═══════════════════════════════════════════════════════════ */
function PainelDetalhes({ repo, onFechar, toastShow }) {
  const [aba, setAba] = useState('visao')
  const [secaoModal, setSecaoModal] = useState(null)
  const [publicarAberto, setPublicarAberto] = useState(false)
  const [maisAberto, setMaisAberto] = useState(false)
  const [meta, setMeta] = useState(null)
  const [readme, setReadme] = useState(null)
  const [commits, setCommits] = useState(null)
  const [releases, setReleases] = useState(null)
  const [artifacts, setArtifacts] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [secrets, setSecrets] = useState(null)
  const [workflows, setWorkflows] = useState(null)
  const [projetosLocais, setProjetosLocais] = useState([])
  const [loadingAba, setLoadingAba] = useState(false)
  const [erroAba, setErroAba] = useState(null)
  const [repoDetalhes, setRepoDetalhes] = useState(repo)
  const [projectInsight, setProjectInsight] = useState(repo.insight || null)
  const [repoAlterado, setRepoAlterado] = useState(false)
  const [baixandoProjeto, setBaixandoProjeto] = useState(false)
  const [downloadProjeto, setDownloadProjeto] = useState({ status:'idle', progress:0, id:'', filename:'', total:0, downloaded:0 })

  const [deleteStep, setDeleteStep] = useState(0)
  const [deleteInput, setDeleteInput] = useState('')
  const [deletandoRepo, setDeletandoRepo] = useState(false)

  const [showRelease, setShowRelease] = useState(false)
  const [novaRelease, setNovaRelease] = useState({ tag: '', nome: '', descricao: '', preRelease: false, rascunho: false })
  const [criandoRelease, setCriandoRelease] = useState(false)

  const [metaDraft, setMetaDraft] = useState(null)
  const [salvandoMeta, setSalvandoMeta] = useState(false)

  const [owner, repoNome] = (repo.nomeCompleto || `?/${repo.nome}`).split('/')

  const fecharPainel = () => onFechar(repoAlterado)
  const atualizarRepoLocal = (novoRepo) => { setRepoDetalhes(novoRepo); setRepoAlterado(true) }

  async function baixarProjeto() {
    setBaixandoProjeto(true)
    setDownloadProjeto({ status:'preparing', progress:0, id:'', filename:'', total:0, downloaded:0 })
    try {
      const result = await githubService.baixarZip(owner, repoNome, repoDetalhes?.branch || repoDetalhes?.default_branch || 'main', {
        onStatus:(status, info={}) => setDownloadProjeto(prev => ({ ...prev, ...info, status, id:info.id || prev.id, filename:info.filename || prev.filename })),
      })
      setDownloadProjeto(prev => ({ ...prev, status:result.mode?.startsWith('android') && result.progress === 100 ? 'completed' : (result.mode?.includes('background') ? 'background' : 'started'), progress:result.progress ?? prev.progress, id:result.id || prev.id, filename:result.filename || prev.filename }))
      toastShow(result.mode?.startsWith('android') && result.progress === 100 ? 'Download concluído no dispositivo.' : 'Download iniciado.')
    } catch (e) {
      const cancelled = e?.code === 'ANDROID_DOWNLOAD_CANCELLED'
      setDownloadProjeto(prev => ({ ...prev, status:cancelled ? 'cancelled' : 'failed', id:e.downloadId || prev.id }))
      toastShow(cancelled ? 'Download cancelado.' : (e.message || 'Não foi possível baixar o projeto.'), cancelled ? 'ok' : 'erro')
    } finally { setBaixandoProjeto(false) }
  }

  async function cancelarDownloadProjeto() {
    if (!downloadProjeto.id) return
    try { await githubService.cancelDownload(downloadProjeto.id); setDownloadProjeto(p=>({...p,status:'cancelled'})); toastShow('Download cancelado.') }
    catch(e){ toastShow(e.message || 'Não foi possível cancelar o download.','erro') }
  }

  async function abrirDownloadProjeto() {
    if (!downloadProjeto.id) return
    try { await githubService.openDownload(downloadProjeto.id) }
    catch(e){ toastShow(e.message || 'Não foi possível abrir o arquivo.','erro') }
  }

  useEffect(() => {
    githubService.getMeta(repo.id).then(m => {
      setMeta(m)
      setMetaDraft({ alias: m.alias || '', tags: (m.tags || []).join(', '), favorito: m.favorito, statusInterno: m.statusInterno || 'ativo', observacoes: m.observacoes || '', projetoLocal: m.projetoLocal || '' })
    }).catch(() => {})
    githubService.projetosLocais().then(d => setProjetosLocais(d.projetos || [])).catch(() => {})
    githubService.insight(owner, repoNome, repo.branch || 'main').then(setProjectInsight).catch(() => {})
  }, [repo.id])

  const carregarAba = useCallback(async (a) => {
    setLoadingAba(true); setErroAba(null)
    try {
      if (a === 'visao'     && !readme)    { const r  = await githubService.readme(owner, repoNome);            setReadme(r) }
      if (a === 'commits'   && !commits)   { const c  = await githubService.commits(owner, repoNome);           setCommits(c.commits || []) }
      if (a === 'releases'  && !releases)  { const r  = await githubService.releases(owner, repoNome);          setReleases(r.releases || []) }
      if (a === 'artifacts' && !artifacts) { const ar = await githubService.artifacts(owner, repoNome);         setArtifacts(ar.artifacts || []) }
      if (a === 'analysis'  && !analysis)  { const an = await githubService.analysis(owner, repoNome);          setAnalysis(an) }
      if (a === 'secrets')                 { const s  = await githubService.secrets(owner, repoNome);           setSecrets(s.secrets || []) }
      if (a === 'workflows')               { const w  = await githubService.workflows(owner, repoNome);         setWorkflows(w.workflows || []) }
    } catch (e) { setErroAba(e.message || 'Erro ao carregar') }
    finally     { setLoadingAba(false) }
  }, [owner, repoNome, readme, commits, releases, artifacts, analysis])

  const mudarAba = (a) => {
    setErroAba(null)
    if (a === 'push') { setPublicarAberto(true); return }
    setAba(a)
    setSecaoModal(a)
    carregarAba(a)
  }

  async function salvarMeta() {
    setSalvandoMeta(true)
    try {
      const tagsList = metaDraft.tags.split(',').map(t => t.trim()).filter(Boolean)
      const salvo = await githubService.salvarMeta(repo.id, { nomeCompleto: repo.nomeCompleto, alias: metaDraft.alias || null, tags: tagsList, favorito: metaDraft.favorito, statusInterno: metaDraft.statusInterno, observacoes: metaDraft.observacoes || null, projetoLocal: metaDraft.projetoLocal || null })
      setMeta(salvo); toastShow('Metadados salvos com sucesso!')
    } catch (e) { toastShow('Erro ao salvar: ' + e.message, 'erro') }
    finally     { setSalvandoMeta(false) }
  }

  async function criarRelease() {
    if (!novaRelease.tag) return toastShow('Tag é obrigatória', 'erro')
    setCriandoRelease(true)
    try {
      await githubService.criarRelease(owner, repoNome, { tag: novaRelease.tag, nome: novaRelease.nome, descricao: novaRelease.descricao, rascunho: novaRelease.rascunho, preRelease: novaRelease.preRelease })
      setShowRelease(false)
      setNovaRelease({ tag: '', nome: '', descricao: '', preRelease: false, rascunho: false })
      setReleases(null)
      toastShow('Release criada com sucesso!')
      setTimeout(() => carregarAba('releases'), 200)
    } catch (e) { toastShow('Erro: ' + e.message, 'erro') }
    finally     { setCriandoRelease(false) }
  }

  async function confirmarDelete() {
    if (deleteInput !== repoNome) return toastShow('Nome digitado incorreto', 'erro')
    setDeletandoRepo(true)
    try {
      await githubService.excluirRepo(owner, repoNome, repoNome)
      toastShow(`Repositório ${repoNome} excluído.`)
      setTimeout(() => onFechar(true), 1200)
    } catch (e) { toastShow('Erro: ' + e.message, 'erro') }
    finally     { setDeletandoRepo(false) }
  }

  const ABAS = [
    { id:'visao', icon:'◈', label:'Visão geral', desc:'Status e README', grupo:'Projeto' },
    { id:'meta', icon:'⌁', label:'Organização', desc:'Alias, tags e vínculo', grupo:'Projeto' },
    { id:'analysis', icon:'◎', label:'Análise', desc:'Saúde do código', grupo:'Projeto' },
    { id:'arquivos', icon:'▤', label:'Arquivos', desc:'Navegar e gerenciar', grupo:'Código' },
    { id:'commits', icon:'⌘', label:'Commits', desc:'Histórico Git', grupo:'Código' },
    { id:'releases', icon:'◇', label:'Releases', desc:'Versões publicadas', grupo:'Código' },
    { id:'artifacts', icon:'□', label:'Artefatos', desc:'Arquivos do Actions', grupo:'Código' },
    { id:'workflows', icon:'↯', label:'Workflows', desc:'Actions e execuções', grupo:'Automação' },
    { id:'secrets', icon:'◆', label:'Secrets', desc:'Variáveis do GitHub', grupo:'Automação' },
    { id:'push', icon:'↑', label:'Publicar', desc:'Enviar e implantar', grupo:'Produção', destaque:true },
  ]
  const MANUTENCAO = { id:'delete', icon:'×', label:'Excluir repositório', desc:'Ação permanente', grupo:'Manutenção', perigo:true }
  const abaAtual = [...ABAS, MANUTENCAO].find(a => a.id === aba) || ABAS[0]
  const gruposAbas = [
    { nome:'PROJETO', itens:ABAS.filter(a => a.grupo === 'Projeto') },
    { nome:'CÓDIGO', itens:ABAS.filter(a => a.grupo === 'Código') },
    { nome:'AUTOMAÇÃO E PRODUÇÃO', itens:ABAS.filter(a => ['Automação','Produção'].includes(a.grupo)) },
  ]

  return (
    <div className="gh-repo-workspace-backdrop" onClick={e => e.target === e.currentTarget && fecharPainel()}>
      <div className="gh-repo-workspace">
        {/* Header */}
        <div className="gh-repo-head" style={{
          padding: `${SPACE.xl}px ${SPACE.xl2}px`, borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.lg,
          position: 'sticky', top: 0, background: C.surface, zIndex: 10,
        }}>
          <div className="gh-repo-identity" style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' }}>
              <span className="gh-repo-title" style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text }}>{projectInsight?.produto || repoDetalhes.nome || repo.nome}</span>
              {projectInsight?.versao && <DSBadge variant="blue">v{projectInsight.versao}</DSBadge>}
              <DSBadge variant={repoDetalhes.privado ? 'gray' : 'green'}>{repoDetalhes.privado ? 'Privado' : 'Público'}</DSBadge>
              {meta?.favorito && <span style={{ fontSize: FONT.lg - 1 }}>⭐</span>}
              {meta?.statusInterno && meta.statusInterno !== 'ativo' && (
                <DSBadge style={{ color: STATUS_CFG[meta.statusInterno]?.cor, background: `${STATUS_CFG[meta.statusInterno]?.cor}18` }}>
                  {STATUS_CFG[meta.statusInterno]?.label}
                </DSBadge>
              )}
            </div>
            <div className="gh-repo-path" style={{ fontSize:FONT.sm, color:C.muted, marginTop:3 }}>{owner}/{repoNome} · Branch: {repoDetalhes.branch || repoDetalhes.default_branch || repo.branch || 'main'}</div>
            {meta?.alias && <div style={{ fontSize: FONT.xs, color: C.muted, marginTop: 2 }}>alias: {meta.alias}</div>}
          </div>
          <div className="gh-repo-header-actions" style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexShrink: 0 }}>
            <button
              type="button"
              className="gh-repo-head-action"
              onClick={baixarProjeto}
              disabled={baixandoProjeto}
              title={`Gerar e baixar o projeto ${owner}/${repoNome} como ZIP`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {baixandoProjeto ? 'Gerando…' : 'Baixar arquivo'}
            </button>
            <button type="button" className="gh-repo-head-action" onClick={fecharPainel} aria-label="Fechar repositório">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M18 6L6 18M6 6l12 12"/></svg>
              Fechar
            </button>
            <div className="gh-more-wrap">
              <DSBtn variant="ghost" size="icon" onClick={() => setMaisAberto(v => !v)} aria-label="Mais ações" title="Mais ações">⋮</DSBtn>
              {maisAberto && <div className="gh-more-menu">
                <button onClick={() => { setMaisAberto(false); mudarAba('delete') }}><span>×</span><span><b>Excluir repositório</b><small>Ação permanente</small></span></button>
              </div>}
            </div>
          </div>
        </div>

        {/* Central do repositório — cards no padrão da Central de Atualizações */}
        <div className="gh-command-deck" style={{padding:`${SPACE.lg}px ${SPACE.xl2}px`,borderBottom:`1px solid ${C.border}`,background:C.bg}}>
          <div className="gh-repo-status-card">
            <span className="gh-repo-status-icon">◉</span>
            <span className="gh-repo-status-copy">
              <b>GitHub conectado</b>
              <small>{owner}/{repoNome} · {repoDetalhes.branch || repoDetalhes.default_branch || repo.branch || 'main'}</small>
            </span>
            <span className="gh-repo-status-dot" title="Conectado ao GitHub" />
          </div>

          <div className="gh-command-title">
            <div>
              <span>CENTRAL DO REPOSITÓRIO</span>
              <b>Gerenciar {projectInsight?.produto || repoDetalhes.nome || repo.nome}</b>
            </div>
            <small>Escolha uma ação. Os detalhes abrem em uma janela própria.</small>
          </div>

          {gruposAbas.map(grupo => (
            <section className="gh-command-group" key={grupo.nome}>
              <div className="gh-command-group-label">{grupo.nome}</div>
              <div className="gh-command-grid">
                {grupo.itens.map(a => (
                  <button key={a.id} onClick={() => mudarAba(a.id)} className={`gh-command-card${a.destaque?' destaque':''}`}>
                    <span className="gh-command-card-icon">{a.icon}</span>
                    <span className="gh-command-card-copy">
                      <b>{a.label}</b>
                      <small>{a.desc}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="gh-repo-overview-strip">
          {projectInsight?.versao && <div><span>Versão</span><b>v{projectInsight.versao}</b></div>}
          <div><span>Tipo</span><b>{projectInsight?.tipo || 'Repositório'}</b></div>
          <div><span>Framework</span><b>{projectInsight?.framework || repoDetalhes.linguagem || repo.linguagem || '—'}</b></div>
          <div><span>Branch</span><b>{repoDetalhes.branch || repoDetalhes.default_branch || repo.branch || '—'}</b></div>
          <div><span>Último push</span><b>{relTime(repoDetalhes.ultimoPush || repoDetalhes.ultimaAtualizacao || repo.ultimoPush || repo.ultimaAtualizacao)}</b></div>
        </div>
        {downloadProjeto.status !== 'idle' && <div className={`gh-download-strip ${downloadProjeto.status}`}>
          <div><b>{downloadProjeto.status==='preparing'?'Preparando':downloadProjeto.status==='queued'?'Na fila':downloadProjeto.status==='progress'?'Baixando':downloadProjeto.status==='completed'?'Concluído':downloadProjeto.status==='failed'?'Falhou':downloadProjeto.status==='cancelled'?'Cancelado':downloadProjeto.status==='background'?'Baixando em segundo plano':'Download iniciado'}</b><span>{downloadProjeto.filename || `${repoNome}.zip`}{downloadProjeto.total>0 ? ` · ${fmtBytes(downloadProjeto.total)}` : ''}</span></div>
          <strong>{['progress','queued','background'].includes(downloadProjeto.status) ? `${downloadProjeto.progress || 0}%` : downloadProjeto.status==='completed' ? '100%' : ''}</strong>
          {['progress','queued','background'].includes(downloadProjeto.status) && downloadProjeto.id && <button onClick={cancelarDownloadProjeto}>Cancelar</button>}
          {downloadProjeto.status==='completed' && downloadProjeto.id && <button onClick={abrirDownloadProjeto}>Abrir</button>}
          {['failed','cancelled'].includes(downloadProjeto.status) && <button onClick={baixarProjeto}>Tentar novamente</button>}
        </div>}

        <DSModal open={Boolean(secaoModal)} onClose={() => setSecaoModal(null)} title={`${abaAtual.grupo} · ${abaAtual.label}`} size="xl">
          {loadingAba ? (
            <div style={{ textAlign: 'center', padding: `${SPACE.xl5}px 0`, color: C.muted, fontSize: FONT.base }}>Carregando...</div>
          ) : erroAba ? (
            <div style={{ textAlign: 'center', padding: `${SPACE.xl5}px 0`, color: C.amber, fontSize: FONT.base }}>{erroAba}</div>
          ) : (
            <>
              {aba === 'visao'     && <AbaVisao repo={repoDetalhes} readme={readme} toastShow={toastShow} onRepoAtualizado={atualizarRepoLocal} />}
              {aba === 'meta'      && metaDraft && <AbaMeta metaDraft={metaDraft} setMetaDraft={setMetaDraft} projetosLocais={projetosLocais} salvandoMeta={salvandoMeta} onSalvar={salvarMeta} />}
              {aba === 'commits'   && <AbaCommits commits={commits} owner={owner} repo={repoNome} toastShow={toastShow} />}
              {aba === 'releases'  && <AbaReleases releases={releases} showRelease={showRelease} setShowRelease={setShowRelease} novaRelease={novaRelease} setNovaRelease={setNovaRelease} onCriar={criarRelease} criandoRelease={criandoRelease} />}
              {aba === 'artifacts' && <AbaArtifacts artifacts={artifacts} owner={owner} repo={repoNome} toastShow={toastShow} />}
              {aba === 'arquivos'  && <AbaArquivos owner={owner} repo={repoNome} branch={repo.branch || repo.default_branch || 'main'} toastShow={toastShow} />}
              {aba === 'analysis'  && <AbaAnalysis analysis={analysis} />}
              {aba === 'secrets'   && <AbaSecrets secrets={secrets} owner={owner} repo={repoNome} onRefresh={() => { setSecrets(null); carregarAba('secrets') }} toastShow={toastShow} />}
              {aba === 'workflows' && <AbaWorkflows workflows={workflows} owner={owner} repo={repoNome} toastShow={toastShow} />}
              {aba === 'delete'    && <AbaDelete repo={repo} repoNome={repoNome} deleteStep={deleteStep} setDeleteStep={setDeleteStep} deleteInput={deleteInput} setDeleteInput={setDeleteInput} onConfirmar={confirmarDelete} deletandoRepo={deletandoRepo} />}
            </>
          )}
        </DSModal>

        <AbaPublicar open={publicarAberto} repo={{...repoDetalhes, insight:projectInsight, produto:projectInsight?.produto, versao:projectInsight?.versao}} owner={owner} repoNome={repoNome} meta={meta} toastShow={toastShow} onMetaAtualizado={setMeta} onAbrirArquivos={() => { setPublicarAberto(false); setAba('arquivos'); setSecaoModal('arquivos') }} onClose={() => setPublicarAberto(false)} />
      </div>
    </div>
  )
}

/* ── ABA: Visão Geral ────────────────────────────────────── */

function AbaArquivos({ owner, repo, branch, toastShow }) {
  const [pathAtual, setPathAtual] = useState('')
  const [itens, setItens] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [resumo, setResumo] = useState(null)
  const [repoInfo, setRepoInfo] = useState(null)
  const [selecionados, setSelecionados] = useState(() => new Set())
  const [detalhe, setDetalhe] = useState(null)
  const [detalheLoading, setDetalheLoading] = useState(false)
  const [alvo, setAlvo] = useState(null)
  const [confirmacao, setConfirmacao] = useState('')
  const [apagando, setApagando] = useState(false)
  const [batchMode, setBatchMode] = useState(null)
  const [batchConfirm, setBatchConfirm] = useState('')
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [showCleanup, setShowCleanup] = useState(false)
  const [cleanup, setCleanup] = useState(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupConfirm, setCleanupConfirm] = useState('')
  const [cleanupRunning, setCleanupRunning] = useState(false)

  const carregar = useCallback(async (novoPath = pathAtual) => {
    setLoading(true); setErro(null)
    try {
      const d = await githubService.contents(owner, repo, novoPath, branch)
      setItens(d.itens || []); setPathAtual(d.path || novoPath || '')
      setResumo(d.resumo || null); setRepoInfo(d.repositorio || null); setSelecionados(new Set())
    } catch (e) { setErro(e.message || 'Não foi possível listar os arquivos.') }
    finally { setLoading(false) }
  }, [owner, repo, branch, pathAtual])

  useEffect(() => { carregar('') }, [owner, repo, branch])

  const analisarLimpeza = async () => {
    setShowCleanup(true); setCleanupLoading(true); setCleanup(null); setCleanupConfirm('')
    try { setCleanup(await githubService.analisarResiduos(owner, repo, branch)) }
    catch(e){ toastShow('Não foi possível analisar o repositório: '+(e.message||'erro'), 'erro'); setShowCleanup(false) }
    finally{ setCleanupLoading(false) }
  }
  const executarLimpeza = async () => {
    if(cleanupConfirm!=='LIMPAR') return
    setCleanupRunning(true)
    try{
      const r=await githubService.limparResiduos(owner,repo,branch,cleanupConfirm)
      toastShow(r.mensagem || `${r.removidos||0} resíduo(s) removido(s).`)
      setShowCleanup(false); setCleanup(null); setCleanupConfirm(''); await carregar(pathAtual)
    }catch(e){toastShow('Falha na limpeza: '+(e.message||'erro no GitHub'),'erro')}
    finally{setCleanupRunning(false)}
  }

  const subir = () => { if (!pathAtual) return; const partes=pathAtual.split('/'); partes.pop(); carregar(partes.join('/')) }
  const abrirPasta = item => { if (item.tipo === 'pasta') carregar(item.path); else abrirDetalhes(item) }
  const abrirDetalhes = async item => {
    setDetalhe({ ...item }); setDetalheLoading(true)
    try { setDetalhe(await githubService.contentInfo(owner, repo, item.path, branch)) }
    catch(e){ toastShow('Não foi possível carregar os detalhes: '+(e.message||'erro'), 'erro') }
    finally { setDetalheLoading(false) }
  }
  const toggleSelecionado = path => setSelecionados(prev => {
    const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next
  })
  const selecionarTudo = () => setSelecionados(prev => prev.size === itens.length ? new Set() : new Set(itens.map(i => i.path)))
  const solicitarApagar = item => { setAlvo(item); setConfirmacao('') }
  const apagar = async () => {
    if (!alvo || confirmacao !== alvo.nome) return
    setApagando(true)
    try {
      const r = await githubService.excluirConteudo(owner, repo, alvo.path, branch)
      toastShow(`${alvo.tipo === 'pasta' ? 'Pasta' : 'Arquivo'} removido do GitHub (${r.removidos || 1} arquivo(s)).`)
      setAlvo(null); setConfirmacao(''); await carregar(pathAtual)
    } catch (e) { toastShow('Erro ao apagar: ' + (e.message || 'falha no GitHub'), 'erro') }
    finally { setApagando(false) }
  }
  const abrirExclusaoLote = mode => { setBatchMode(mode); setBatchConfirm('') }
  const apagarLote = async () => {
    if (!batchMode) return
    const esperado = batchMode === 'current' ? 'APAGAR TUDO' : 'APAGAR SELECIONADOS'
    if (batchConfirm !== esperado) return
    setBatchDeleting(true)
    try {
      const r = await githubService.excluirConteudoLote(owner, repo, {
        branch, mode:batchMode, currentPath:pathAtual, paths:Array.from(selecionados), confirmar:batchConfirm,
      })
      toastShow(`${r.removidos || 0} arquivo(s) removido(s) em um único commit.`)
      setBatchMode(null); setBatchConfirm(''); await carregar(pathAtual)
    } catch(e){ toastShow('Falha ao apagar em lote: '+(e.message||'erro no GitHub'),'erro') }
    finally { setBatchDeleting(false) }
  }

  const crumbParts = pathAtual ? pathAtual.split('/') : []
  const selecionadoBytes = itens.filter(i => selecionados.has(i.path)).reduce((n,i)=>n+Number(i.tamanho||0),0)
  const todosMarcados = itens.length > 0 && selecionados.size === itens.length
  const batchExpected = batchMode === 'current' ? 'APAGAR TUDO' : 'APAGAR SELECIONADOS'

  return <div className="gh-files-explorer">
    <div className="gh-files-hero">
      <div className="gh-files-hero-copy">
        <span>EXPLORADOR DO REPOSITÓRIO</span>
        <h3>{repo}</h3>
        <p>Branch <b>{branch}</b> · navegue, confira metadados e faça exclusões em um único commit.</p>
      </div>
      <div className="gh-files-hero-actions"><DSBtn size="sm" onClick={analisarLimpeza}>◎ Resíduos</DSBtn><DSBtn size="sm" variant="ghost" onClick={()=>carregar(pathAtual)}>↻ Atualizar</DSBtn></div>
      <div className="gh-files-stats">
        <div><small>Conteúdo</small><b>{resumo?.itens ?? itens.length}</b><em>{plural(resumo?.pastas || 0,'pasta')} · {plural(resumo?.arquivos || 0,'arquivo')}</em></div>
        <div><small>Tamanho visível</small><b>{fmtBytes(resumo?.bytesVisiveis || 0)}</b><em>arquivos do nível atual</em></div>
        <div><small>Último envio</small><b>{repoInfo?.ultimoPushEm ? relTime(repoInfo.ultimoPushEm) : '—'}</b><em>{repoInfo?.ultimoPushEm ? shortDate(repoInfo.ultimoPushEm) : 'GitHub'}</em></div>
      </div>
    </div>

    <div className="gh-files-toolbar">
      <div className="gh-files-breadcrumb"><button onClick={()=>carregar('')}>⌂ Raiz</button>{crumbParts.map((part,i)=>{const p=crumbParts.slice(0,i+1).join('/');return <button key={p} onClick={()=>carregar(p)}>› {part}</button>})}</div>
      <div className="gh-files-nav-actions">{pathAtual&&<DSBtn size="sm" variant="ghost" onClick={subir}>← Subir</DSBtn>}</div>
    </div>

    {!loading && !erro && itens.length > 0 && <div className="gh-files-selectionbar">
      <label><input type="checkbox" checked={todosMarcados} onChange={selecionarTudo}/><span>{selecionados.size ? `${plural(selecionados.size,'selecionado')} · ${fmtBytes(selecionadoBytes)}` : 'Selecionar tudo nesta pasta'}</span></label>
      <div>{selecionados.size>0&&<><DSBtn size="sm" variant="danger" onClick={()=>abrirExclusaoLote('selected')}>Apagar selecionados</DSBtn><DSBtn size="sm" variant="ghost" onClick={()=>setSelecionados(new Set())}>Limpar seleção</DSBtn></>}<DSBtn size="sm" variant="danger" onClick={()=>abrirExclusaoLote('current')}>{pathAtual ? 'Esvaziar pasta' : 'Apagar tudo'}</DSBtn></div>
    </div>}

    {loading ? <Skeleton n={4}/> : erro ? <div className="gh-files-empty error">{erro}</div> : itens.length===0 ? <div className="gh-files-empty"><b>Esta pasta está vazia.</b><span>Nenhum arquivo ou subpasta foi encontrado em <code>/{pathAtual}</code>.</span></div> :
      <div className="gh-files-list">{itens.map(item=><div key={item.path} className={`gh-file-card${selecionados.has(item.path)?' selected':''}`}>
        <label className="gh-file-check" title="Selecionar"><input type="checkbox" checked={selecionados.has(item.path)} onChange={()=>toggleSelecionado(item.path)}/></label>
        <button className="gh-file-main" onClick={()=>abrirPasta(item)}>
          <span className={`gh-file-icon ${item.tipo}`}>{item.tipo==='pasta'?'▰':'▤'}</span>
          <span className="gh-file-copy"><b>{item.nome}</b><small>{item.tipo==='pasta' ? 'Pasta' : `${item.tipoArquivo || 'Arquivo'} · ${fmtBytes(item.tamanho)}`}</small><em>{item.path}</em></span>
        </button>
        <div className="gh-file-meta"><span>{item.tipo==='arquivo' ? `${item.tipoArquivo || (item.extensao ? `.${item.extensao}` : 'Arquivo')} · ${fmtBytes(item.tamanho)}` : 'Pasta'}</span>{item.sha&&<code title={item.sha}>{item.sha.slice(0,7)}</code>}</div>
        <div className="gh-file-row-actions">
          <button type="button" className="gh-file-icon-action" onClick={()=>abrirDetalhes(item)} title="Detalhes" aria-label={`Ver detalhes de ${item.nome}`}>ⓘ</button>
          <button type="button" className="gh-file-icon-action danger" onClick={()=>solicitarApagar(item)} title="Apagar" aria-label={`Apagar ${item.nome}`}>⌫</button>
        </div>
      </div>)}</div>}

    <DSModal open={!!detalhe} onClose={()=>!detalheLoading&&setDetalhe(null)} title={detalhe?.nome || 'Detalhes'} size="md" footer={<><DSBtn onClick={()=>setDetalhe(null)}>Fechar</DSBtn>{detalhe?.url&&<a className="gh-modal-link" href={detalhe.url} target="_blank" rel="noopener noreferrer">Abrir no GitHub ↗</a>}</>}>
      {detalhe && <div className="gh-file-detail">
        {detalheLoading&&<div className="gh-muted-box">Carregando histórico do item…</div>}
        <div className="gh-file-detail-grid">
          <WizardInfo label="Tipo" value={detalhe.tipoArquivo || (detalhe.tipo==='pasta'?'Pasta':'Arquivo')} />
          {detalhe.tipo==='pasta' && detalhe.filhos ? <WizardInfo label="Conteúdo" value={`${plural(detalhe.filhos.pastas,'pasta')} · ${plural(detalhe.filhos.arquivos,'arquivo')}`} /> : <WizardInfo label="Tamanho" value={fmtBytes(detalhe.tamanho || 0)} help={detalhe.extensao ? `Extensão .${detalhe.extensao}` : ''} />}
          <WizardInfo label="Branch" value={detalhe.branch || branch} />
          {detalhe.sha && <WizardInfo label="SHA" value={detalhe.sha.slice(0,12)} help="Toque em Copiar SHA para obter o valor completo" />}
        </div>
        <div className="gh-file-pathbox"><span>Caminho</span><code>{detalhe.path}</code></div>
        <div className="gh-file-history"><small>ÚLTIMA ALTERAÇÃO NO GITHUB</small>{detalhe.ultimaAlteracao ? <><b>{detalhe.ultimaAlteracao.mensagem?.split('\n')[0] || 'Commit sem mensagem'}</b><span>{detalhe.ultimaAlteracao.autor || 'Autor não informado'} · {detalhe.ultimaAlteracao.data ? `${shortDate(detalhe.ultimaAlteracao.data)} · ${relTime(detalhe.ultimaAlteracao.data)}` : 'data indisponível'}</span>{detalhe.ultimaAlteracao.sha&&<code title={detalhe.ultimaAlteracao.sha}>{detalhe.ultimaAlteracao.sha.slice(0,10)}</code>}</> : <span>Nenhum commit específico encontrado para este caminho.</span>}</div>
        {detalhe.preview!==null&&detalhe.preview!==undefined&&<div className="gh-file-preview"><div><b>Prévia do arquivo</b>{detalhe.previewTruncated&&<span>primeiros 12 mil caracteres</span>}</div><pre>{detalhe.preview}</pre></div>}
        {detalhe.previewBloqueada&&<div className="gh-muted-box">A prévia foi ocultada porque o nome do arquivo indica conteúdo potencialmente sensível.</div>}
        <div className="gh-file-detail-actions">{detalhe.downloadUrl&&<a className="gh-modal-link" href={detalhe.downloadUrl} target="_blank" rel="noopener noreferrer">Baixar arquivo ↗</a>}{detalhe.sha&&<DSBtn size="sm" variant="ghost" onClick={()=>navigator.clipboard?.writeText(detalhe.sha).then(()=>toastShow('SHA copiado.')).catch(()=>{})}>Copiar SHA</DSBtn>}</div>
      </div>}
    </DSModal>

    <DSModal open={!!batchMode} onClose={()=>!batchDeleting&&setBatchMode(null)} title={batchMode==='current' ? (pathAtual?'Esvaziar pasta':'Apagar todo o conteúdo') : 'Apagar selecionados'} size="sm" footer={<><DSBtn variant="danger" onClick={apagarLote} disabled={batchConfirm!==batchExpected||batchDeleting} loading={batchDeleting}>Excluir em um commit</DSBtn><DSBtn onClick={()=>setBatchMode(null)} disabled={batchDeleting}>Cancelar</DSBtn></>}>
      {batchMode&&<div><div className="gh-danger-summary"><b>{batchMode==='current' ? (pathAtual?`Todo o conteúdo de /${pathAtual}`:'Todos os arquivos da branch') : `${plural(selecionados.size,'item')} selecionados`}</b><span>Pastas são removidas com todos os arquivos internos. A operação gera um único commit e não pode ser desfeita pelo painel.</span></div><label className="gh-field"><span>Digite <b>{batchExpected}</b> para confirmar</span><input value={batchConfirm} onChange={e=>setBatchConfirm(e.target.value.toUpperCase())} style={inp()} autoFocus/></label></div>}
    </DSModal>

    <DSModal open={showCleanup} onClose={()=>!cleanupRunning&&setShowCleanup(false)} title="Manutenção inteligente do repositório" size="md" footer={<>{cleanup?.totalArquivos>0&&<DSBtn variant="danger" onClick={executarLimpeza} disabled={cleanupConfirm!=='LIMPAR'||cleanupRunning} loading={cleanupRunning}>Limpar em um commit</DSBtn>}<DSBtn onClick={()=>setShowCleanup(false)} disabled={cleanupRunning}>Fechar</DSBtn></>}>
      {cleanupLoading ? <div style={{padding:SPACE.xl3,textAlign:'center',color:C.muted}}>Mapeando a árvore do repositório…</div> : cleanup && <div>
        <div style={{padding:SPACE.lg,borderRadius:RADIUS.lg,background:cleanup.totalArquivos?C.amberBg:C.greenBg,border:`1px solid ${cleanup.totalArquivos?C.amber:C.greenSolid}30`,lineHeight:1.55,color:C.text}}>
          <b>{cleanup.totalArquivos ? 'Resíduos detectados.' : 'Repositório limpo.'}</b><div style={{fontSize:FONT.sm,color:C.muted,marginTop:4}}>{cleanup.totalArquivos ? 'Somente padrões locais conhecidos serão removidos. Código-fonte, documentação, workflows e arquivos legítimos ficam intactos.' : 'Nenhum padrão local conhecido foi encontrado nesta branch.'}</div>
        </div>
        {cleanup.totalArquivos>0&&<>
          <div className="gh-clean-stats" style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8,marginTop:SPACE.lg}}>
            <div style={{padding:12,border:`1px solid ${C.border}`,borderRadius:RADIUS.md,background:C.surface}}><small style={{color:C.muted}}>Arquivos</small><div style={{fontWeight:900,fontSize:20,color:C.text}}>{cleanup.totalArquivos}</div></div>
            <div style={{padding:12,border:`1px solid ${C.border}`,borderRadius:RADIUS.md,background:C.surface}}><small style={{color:C.muted}}>Espaço</small><div style={{fontWeight:900,fontSize:20,color:C.text}}>{fmtBytes(cleanup.totalBytes)}</div></div>
            <div style={{padding:12,border:`1px solid ${C.border}`,borderRadius:RADIUS.md,background:C.surface}}><small style={{color:C.muted}}>Commit</small><div style={{fontWeight:900,fontSize:14,color:C.greenSolid}}>Único</div></div>
          </div>
          <div style={{marginTop:SPACE.lg}}>{(cleanup.categorias||[]).map(c=><div key={c.id} style={{display:'flex',justifyContent:'space-between',gap:10,padding:'9px 0',borderBottom:`1px solid ${C.border}`}}><span style={{color:C.text}}>{c.label}</span><span style={{color:C.muted,fontSize:FONT.sm}}>{c.arquivos} · {fmtBytes(c.bytes)}</span></div>)}</div>
          <div style={{marginTop:SPACE.lg}}><div style={{fontWeight:700,color:C.accent}}>Caminhos detectados ({cleanup.itens.length})</div><div style={{maxHeight:190,overflow:'auto',marginTop:8,padding:10,borderRadius:RADIUS.md,background:C.surface2,fontFamily:'monospace',fontSize:11,color:C.muted}}>{cleanup.itens.map(i=><div key={i.path} style={{padding:'3px 0',wordBreak:'break-all'}}>{i.path}</div>)}</div></div>
          <label style={{display:'block',marginTop:SPACE.xl,fontSize:FONT.sm,color:C.muted}}>Para autorizar a limpeza, digite <b style={{color:C.text}}>LIMPAR</b><input value={cleanupConfirm} onChange={e=>setCleanupConfirm(e.target.value.toUpperCase())} style={{...inp(),marginTop:SPACE.sm}} placeholder="LIMPAR" /></label>
        </>}
      </div>}
    </DSModal>

    <DSModal open={!!alvo} onClose={()=>!apagando&&setAlvo(null)} title="Apagar do GitHub" size="sm" footer={<><DSBtn variant="danger" onClick={apagar} disabled={!alvo||confirmacao!==alvo.nome||apagando} loading={apagando}>Apagar definitivamente</DSBtn><DSBtn onClick={()=>setAlvo(null)} disabled={apagando}>Cancelar</DSBtn></>}>
      {alvo&&<div><div style={{padding:SPACE.lg,borderRadius:RADIUS.md,background:C.redBg,border:`1px solid ${C.redBorder}`,color:C.red,lineHeight:1.5}}>Você vai remover <b>{alvo.path}</b>{alvo.tipo==='pasta'?' e todo o conteúdo dentro dela':''}. O GitHub registrará a remoção em um novo commit.</div><label style={{display:'block',marginTop:SPACE.lg,fontSize:FONT.sm,color:C.muted}}>Digite <b style={{color:C.text}}>{alvo.nome}</b> para confirmar<input value={confirmacao} onChange={e=>setConfirmacao(e.target.value)} style={{...inp(),marginTop:SPACE.sm}} autoFocus/></label></div>}
    </DSModal>
  </div>
}

function AbaVisao({ repo, readme, toastShow, onRepoAtualizado }) {
  const [showGitHubEdit, setShowGitHubEdit] = useState(false)
  const [salvandoGitHub, setSalvandoGitHub] = useState(false)
  const [sugerindoIA, setSugerindoIA] = useState(false)
  const [iaMeta, setIaMeta] = useState(null)
  const [draft, setDraft] = useState({ descricao: repo.descricao || '', homepage: repo.homepage || '' })
  const [owner, repoNome] = (repo.nomeCompleto || `?/${repo.nome}`).split('/')

  useEffect(() => {
    setDraft({ descricao: repo.descricao || '', homepage: repo.homepage || '' })
  }, [repo.descricao, repo.homepage])


  async function sugerirComIA() {
    setSugerindoIA(true)
    try {
      const sugestao = await githubService.sugerirDescricao(owner, repoNome)
      setDraft(p => ({ ...p, descricao: sugestao.descricao || p.descricao }))
      setIaMeta(sugestao._meta || null)
      toastShow('Sugestão inserida. Revise o texto antes de salvar no GitHub.')
    } catch (e) { toastShow(e.message || 'A IA não conseguiu sugerir a descrição.', 'erro') }
    finally { setSugerindoIA(false) }
  }

  async function salvarNoGitHub() {
    setSalvandoGitHub(true)
    try {
      const atualizado = await githubService.atualizarRepo(owner, repoNome, { descricao: draft.descricao, homepage: draft.homepage })
      onRepoAtualizado?.({ ...repo, descricao: atualizado.descricao || '', homepage: atualizado.homepage || '' })
      setShowGitHubEdit(false)
      toastShow('Descrição e site atualizados no GitHub.')
    } catch (e) { toastShow(e.message || 'Não foi possível atualizar o repositório.', 'erro') }
    finally { setSalvandoGitHub(false) }
  }

  const info = [
    ['Branch', repo.branch || '—'],
    ['Linguagem', repo.linguagem || '—'],
    ['Tamanho', fmtRepoSize(repo.tamanho)],
    ['Último push', relTime(repo.ultimoPush || repo.ultimaAtualizacao)],
    ['Stars', `★ ${repo.stars || 0}`],
    ['Forks', `⑂ ${repo.forks || 0}`],
    ['Issues', `● ${repo.issues || 0}`],
    ['Criado', repo.criadoEm ? new Date(repo.criadoEm).toLocaleDateString('pt-BR') : '—'],
  ]

  return (
    <div>
      <div className="gh-overview-pair">
        <section className="gh-overview-card">
          <div className="gh-overview-head">
            <div><span>GitHub</span><b>Dados públicos</b></div>
            <DSBtn variant="secondary" size="sm" onClick={() => setShowGitHubEdit(true)}>✎ Editar</DSBtn>
          </div>
          <div className="gh-overview-body">
            <div><span className="gh-mini-label">Descrição</span><p>{repo.descricao || 'Sem descrição pública.'}</p></div>
            <div><span className="gh-mini-label">Site / Homepage</span>{repo.homepage ? <a href={repo.homepage} target="_blank" rel="noopener noreferrer">{repo.homepage}</a> : <p className="gh-muted">Não informado.</p>}</div>
            <a className="gh-inline-link" href={repo.url} target="_blank" rel="noopener noreferrer">Abrir repositório ↗</a>
          </div>
        </section>

        <section className="gh-overview-card">
          <div className="gh-overview-head"><div><span>Repositório</span><b>Informações</b></div><DSBadge variant={repo.privado ? 'gray' : 'green'}>{repo.privado ? 'Privado' : 'Público'}</DSBadge></div>
          <div className="gh-compact-info">
            {info.map(([label,val]) => <div key={label}><span>{label}</span><b>{val}</b></div>)}
          </div>
          {repo.temas?.length > 0 && <div className="gh-topic-row">{repo.temas.map(t => <DSBadge key={t} variant="blue">{t}</DSBadge>)}</div>}
        </section>
      </div>

      <DSModal open={showGitHubEdit} onClose={() => !salvandoGitHub && setShowGitHubEdit(false)} title="Editar detalhes no GitHub" size="sm"
        footer={<><DSBtn variant="primary" onClick={salvarNoGitHub} loading={salvandoGitHub} disabled={salvandoGitHub}>Salvar no GitHub</DSBtn><DSBtn onClick={() => setShowGitHubEdit(false)} disabled={salvandoGitHub}>Cancelar</DSBtn></>}>
        <div style={{ display:'grid', gap:SPACE.lg }}>
          <div style={{ fontSize:FONT.sm, color:C.muted, lineHeight:1.5 }}>Usa o mesmo token configurado em <b style={{ color:C.text }}>Integrações e APIs</b>. Para token fine-grained, a edição requer <b style={{ color:C.text }}>Administration: write</b> neste repositório.</div>
          <label><div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:SPACE.xs }}><span style={{ fontSize:FONT.sm, color:C.muted, fontWeight:700 }}>Descrição</span><DSBtn type="button" size="sm" variant="secondary" onClick={sugerirComIA} loading={sugerindoIA} disabled={sugerindoIA || salvandoGitHub}>✨ Sugerir com IA</DSBtn></div><textarea value={draft.descricao} onChange={e => { setDraft(p => ({ ...p, descricao:e.target.value })); setIaMeta(null) }} maxLength={350} rows={4} style={{ ...inp(), resize:'vertical', minHeight:90 }} placeholder="Descreva o projeto" /><div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:FONT.xs, color:C.muted, marginTop:3 }}><span>{iaMeta ? `Sugestão: ${iaMeta.provedor}${iaMeta.modelo ? ` · ${iaMeta.modelo}` : ''}` : 'A IA usa Gemini/OpenRouter configurados em Integrações e APIs.'}</span><span>{draft.descricao.length}/350</span></div></label>
          <label><div style={{ fontSize:FONT.sm, color:C.muted, fontWeight:700, marginBottom:SPACE.xs }}>Homepage</div><input value={draft.homepage} onChange={e => setDraft(p => ({ ...p, homepage:e.target.value }))} style={inp()} placeholder="https://..." inputMode="url" /></label>
        </div>
      </DSModal>

      <section className="gh-readme-section">
        <div className="gh-readme-head"><div><span>Documentação</span><b>README.md</b></div>{readme?.nome && <DSBadge variant="gray">{readme.nome}</DSBadge>}</div>
        {readme?.html ? <article className="gh-readme" dangerouslySetInnerHTML={{ __html: readme.html }} />
          : readme?.conteudo ? <pre className="gh-readme-fallback">{readme.conteudo}</pre>
          : <div className="gh-muted-box">Este repositório não possui README.</div>}
      </section>
    </div>
  )
}


/* ── ABA: Metadados ──────────────────────────────────────── */
function AbaMeta({ metaDraft, setMetaDraft, projetosLocais, salvandoMeta, onSalvar }) {
  const upd = (k, v) => setMetaDraft(p => ({ ...p, [k]: v }))
  return (
    <div>
      <DSSectionTitle style={{ marginBottom: SPACE.lg }}>Metadados Internos (somente AL Sistemas)</DSSectionTitle>
      <p style={{ fontSize: FONT.sm, color: C.muted, marginBottom: SPACE.xl }}>
        Esses dados são <strong style={{ color: C.text }}>internos</strong> e não alteram o GitHub.
      </p>
      <div style={{ display: 'grid', gap: SPACE.lg }}>
        <label>
          <div style={{ fontSize: FONT.sm, color: C.muted, marginBottom: SPACE.xs, fontWeight: 600 }}>Alias interno</div>
          <input value={metaDraft.alias} onChange={e => upd('alias', e.target.value)} placeholder="Nome amigável (ex: Portal Principal)" style={inp()} />
        </label>
        <label>
          <div style={{ fontSize: FONT.sm, color: C.muted, marginBottom: SPACE.xs, fontWeight: 600 }}>Tags (separadas por vírgula)</div>
          <input value={metaDraft.tags} onChange={e => upd('tags', e.target.value)} placeholder="mobile, api, frontend" style={inp()} />
        </label>
        <label>
          <div style={{ fontSize: FONT.sm, color: C.muted, marginBottom: SPACE.xs, fontWeight: 600 }}>Status</div>
          <select value={metaDraft.statusInterno} onChange={e => upd('statusInterno', e.target.value)} style={inp()}>
            {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        {projetosLocais.length > 0 && (
          <label>
            <div style={{ fontSize: FONT.sm, color: C.muted, marginBottom: SPACE.xs, fontWeight: 600 }}>Vínculo local (opcional / legado VPS)</div>
            <select value={metaDraft.projetoLocal} onChange={e => upd('projetoLocal', e.target.value)} style={inp()}>
              <option value="">— Nenhum —</option>
              {projetosLocais.map(p => <option key={p.nome} value={p.nome}>{p.nome}</option>)}
            </select>
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, cursor: 'pointer' }}>
          <input type="checkbox" checked={metaDraft.favorito} onChange={e => upd('favorito', e.target.checked)} />
          <span style={{ fontSize: FONT.base, color: C.text }}>⭐ Marcar como favorito</span>
        </label>
        <label>
          <div style={{ fontSize: FONT.sm, color: C.muted, marginBottom: SPACE.xs, fontWeight: 600 }}>Observações</div>
          <textarea value={metaDraft.observacoes} onChange={e => upd('observacoes', e.target.value)}
            rows={3} placeholder="Notas internas sobre este repositório..."
            style={{ ...inp(), resize: 'vertical', fontFamily: 'inherit' }} />
        </label>
      </div>
      <div style={{ marginTop: SPACE.xl, display: 'flex', justifyContent: 'flex-end' }}>
        <DSBtn variant="primary" onClick={onSalvar} loading={salvandoMeta}>
          💾 Salvar Metadados
        </DSBtn>
      </div>
    </div>
  )
}

/* ── ABA: Commits ────────────────────────────────────────── */
function AbaCommits({ commits, owner, repo, toastShow }) {
  const [lista, setLista] = useState(commits || [])
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState((commits || []).length >= 20)
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(null)
  const [detalhes, setDetalhes] = useState({})
  const [loadingDetail, setLoadingDetail] = useState(null)
  const [download, setDownload] = useState({})

  useEffect(() => { setLista(commits || []); setPage(1); setHasMore((commits || []).length >= 20) }, [commits])
  if (!commits) return <div style={{ fontSize: FONT.base, color: C.muted }}>Carregando...</div>
  if (commits.length === 0) return <div style={{ fontSize: FONT.base, color: C.muted }}>Sem commits encontrados.</div>

  const termo = busca.trim().toLowerCase()
  const filtrados = termo ? lista.filter(c => [c.mensagem,c.descricao,c.autor,c.autorLogin,c.sha].some(v => String(v || '').toLowerCase().includes(termo))) : lista

  async function alternar(c) {
    if (aberto === c.shaFull) { setAberto(null); return }
    setAberto(c.shaFull)
    if (!detalhes[c.shaFull]) {
      setLoadingDetail(c.shaFull)
      try { const d = await githubService.commitDetail(owner, repo, c.shaFull); setDetalhes(prev => ({...prev,[c.shaFull]:d})) }
      catch(e){ toastShow?.(e.message || 'Não foi possível carregar os detalhes do commit.','erro') }
      finally { setLoadingDetail(null) }
    }
  }

  async function carregarMais() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const d = await githubService.commits(owner, repo, page + 1)
      const novos = d.commits || []
      setLista(prev => [...prev, ...novos]); setPage(p => p + 1); setHasMore(Boolean(d.hasMore ?? novos.length >= 20))
    } catch(e){ toastShow?.(e.message || 'Falha ao carregar mais commits.','erro') }
    finally { setLoadingMore(false) }
  }

  async function baixar(c, e) {
    e.stopPropagation()
    setDownload(prev => ({...prev,[c.shaFull]:{state:'connecting',progress:0}}))
    try {
      const result = await githubService.baixarZip(owner, repo, c.shaFull, { onStatus:(state,info={}) => {
        const mapped = state === 'completed' ? 'completed' : state === 'failed' ? 'error' : state
        setDownload(prev => ({...prev,[c.shaFull]:{state:mapped,progress:info.progress || 0,filename:info.filename || prev[c.shaFull]?.filename}}))
      }})
      setDownload(prev => ({...prev,[c.shaFull]:{state:result.mode==='android-download-manager'?'completed':result.mode==='android-download-manager-background'?'background':'started',progress:result.mode==='android-download-manager'?100:(result.progress||prev[c.shaFull]?.progress||0),filename:result.filename,id:result.id}}))
    } catch(e){ setDownload(prev=>({...prev,[c.shaFull]:{state:'error',progress:0}})); toastShow?.(e.message || 'Falha ao baixar este commit.','erro') }
  }

  return <div className="gh-commits-page">
    <div className="gh-commits-head">
      <div><small>HISTÓRICO GIT</small><h3>Commits</h3><p>{lista.length} carregados · abra um commit para ver arquivos e alterações.</p></div>
      <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar mensagem, autor ou SHA…" aria-label="Buscar commits" />
    </div>
    <div className="gh-commit-list">
      {filtrados.map(c => {
        const d=detalhes[c.shaFull]; const isOpen=aberto===c.shaFull; const dl=download[c.shaFull]||{}; const busy=['connecting','queued','progress','downloading','background','paused'].includes(dl.state)
        return <article key={c.shaFull || c.sha} className={`gh-commit-card ${isOpen?'open':''}`}>
          <button type="button" className="gh-commit-summary" onClick={()=>alternar(c)}>
            <span className="gh-commit-avatar">{c.avatar?<img src={c.avatar} alt=""/>:(c.autor||'?').slice(0,1).toUpperCase()}</span>
            <span className="gh-commit-main"><b>{c.mensagem}</b>{c.descricao&&<small>{c.descricao.split('\n')[0]}</small>}<span className="gh-commit-meta"><code>{c.sha}</code><em>{c.autor}</em><em>{relTime(c.data)}</em>{c.verificado&&<i>✓ verificado</i>}</span></span>
            <span className="gh-commit-chevron">{isOpen?'⌃':'⌄'}</span>
          </button>
          <div className="gh-commit-actions">
            <button type="button" onClick={e=>{e.stopPropagation();navigator.clipboard?.writeText(c.shaFull);toastShow?.('SHA copiado.')}}>Copiar SHA</button>
            <a href={c.url} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>GitHub ↗</a>
            <button type="button" disabled={busy} onClick={e=>baixar(c,e)}>{busy?(dl.state==='background'?`Segundo plano · ${dl.progress||0}%`:`${dl.progress||0}%`):dl.state==='completed'?'Concluído ✓':dl.state==='started'?'Download iniciado':dl.state==='error'?'Tentar novamente':'Baixar ZIP'}</button>
          </div>
          {busy&&<div className="gh-commit-download-progress"><span style={{width:`${dl.progress||3}%`}}/></div>}
          {isOpen&&<div className="gh-commit-detail">
            {loadingDetail===c.shaFull?<div className="gh-commit-loading">Carregando alterações…</div>:d?<>
              <div className="gh-commit-stats"><div><small>ARQUIVOS</small><b>{d.arquivos?.length||0}</b></div><div className="plus"><small>ADIÇÕES</small><b>+{d.stats?.additions||0}</b></div><div className="minus"><small>REMOÇÕES</small><b>-{d.stats?.deletions||0}</b></div><div><small>TOTAL</small><b>{d.stats?.total||0}</b></div></div>
              {d.mensagem?.includes('\n')&&<pre className="gh-commit-message">{d.mensagem}</pre>}
              <div className="gh-commit-files">{(d.arquivos||[]).slice(0,30).map(f=><a key={f.nome} href={f.url||undefined} target={f.url?'_blank':undefined} rel="noopener noreferrer"><span className={`status ${f.status}`}>{f.status==='added'?'A':f.status==='removed'?'D':f.status==='renamed'?'R':'M'}</span><b>{f.nome}</b><small><i>+{f.additions}</i><em>-{f.deletions}</em></small></a>)}</div>
              {(d.arquivos||[]).length>30&&<div className="gh-commit-loading">+ {(d.arquivos||[]).length-30} arquivo(s) adicionais · abra no GitHub para ver todos.</div>}
            </>:<div className="gh-commit-loading">Detalhes indisponíveis.</div>}
          </div>}
        </article>
      })}
      {!filtrados.length&&<div className="gh-commit-empty">Nenhum commit corresponde à busca.</div>}
    </div>
    {!termo&&hasMore&&<button type="button" className="gh-commit-more" disabled={loadingMore} onClick={carregarMais}>{loadingMore?'Carregando…':'Carregar mais commits'}</button>}
  </div>
}

/* ── ABA: Releases ───────────────────────────────────────── */
function AbaReleases({ releases, showRelease, setShowRelease, novaRelease, setNovaRelease, onCriar, criandoRelease }) {
  const upd = (k, v) => setNovaRelease(p => ({ ...p, [k]: v }))
  return (
    <div>
      <DSSectionTitle
        style={{ marginBottom: SPACE.lg }}
        actions={<DSBtn variant="primary" size="sm" onClick={() => setShowRelease(true)}>+ Nova Release</DSBtn>}
      >
        Releases ({releases?.length ?? '…'})
      </DSSectionTitle>

      {showRelease && (
        <div style={{ background: C.surf2, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SPACE.xl, marginBottom: SPACE.xl }}>
          <div style={{ fontSize: FONT.base, fontWeight: 800, color: C.text, marginBottom: SPACE.lg }}>Nova Release</div>
          <div style={{ display: 'grid', gap: SPACE.md + 2 }}>
            <input value={novaRelease.tag}      onChange={e => upd('tag', e.target.value)}      placeholder="Tag (ex: v1.0.0) *" style={inp()} />
            <input value={novaRelease.nome}     onChange={e => upd('nome', e.target.value)}     placeholder="Nome da release"    style={inp()} />
            <textarea value={novaRelease.descricao} onChange={e => upd('descricao', e.target.value)}
              rows={4} placeholder="Changelog / descrição..." style={{ ...inp(), resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: SPACE.xl }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: FONT.base, color: C.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={novaRelease.preRelease} onChange={e => upd('preRelease', e.target.checked)} /> Pre-release
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: FONT.base, color: C.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={novaRelease.rascunho} onChange={e => upd('rascunho', e.target.checked)} /> Rascunho
              </label>
            </div>
            <div style={{ display: 'flex', gap: SPACE.md, justifyContent: 'flex-end' }}>
              <DSBtn size="sm" onClick={() => setShowRelease(false)}>Cancelar</DSBtn>
              <DSBtn size="sm" variant="primary" onClick={onCriar} loading={criandoRelease}>🚀 Publicar</DSBtn>
            </div>
          </div>
        </div>
      )}

      {!releases ? (
        <div style={{ fontSize: FONT.base, color: C.muted }}>Carregando...</div>
      ) : releases.length === 0 ? (
        <div style={{ fontSize: FONT.base, color: C.muted }}>Nenhuma release encontrada.</div>
      ) : (
        <div style={{ display: 'grid', gap: SPACE.md + 2 }}>
          {releases.map(r => (
            <div key={r.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: `${SPACE.lg}px 14px` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
                  <span style={{ fontSize: FONT.md, fontWeight: 800, color: C.text, fontFamily: 'monospace' }}>{r.tag}</span>
                  {r.rascunho    && <DSBadge variant="gray">RASCUNHO</DSBadge>}
                  {r.preRelease  && <DSBadge variant="amber">PRE-RELEASE</DSBadge>}
                </div>
                <div style={{ display: 'flex', gap: SPACE.md, alignItems: 'center' }}>
                  <span style={{ fontSize: FONT.xs, color: C.muted }}>{relTime(r.publicadoEm || r.criadoEm)}</span>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: FONT.xs, color: C.blue, textDecoration: 'none' }}>ver →</a>
                </div>
              </div>
              {r.nome && r.nome !== r.tag && <div style={{ fontSize: FONT.sm, color: C.text, marginTop: SPACE.xs }}>{r.nome}</div>}
              {r.assets?.length > 0 && (
                <div style={{ marginTop: SPACE.md, display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
                  {r.assets.map(a => (
                    <a key={a.id} href={a.url} style={{
                      fontSize: FONT.xs, color: C.text, background: C.surf2,
                      border: `1px solid ${C.border}`, borderRadius: RADIUS.xs + 1,
                      padding: `3px ${SPACE.md}px`, textDecoration: 'none',
                      display: 'inline-flex', alignItems: 'center', gap: SPACE.xs,
                    }}>
                      📦 {a.nome} <span style={{ color: C.muted }}>({fmtBytes(a.tamanho)})</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── ABA: Artefatos ──────────────────────────────────────── */
function ArtifactDownloadCard({ artifact: a, owner, repo, toastShow }) {
  const [downloadState, setDownloadState] = useState('idle')
  const [downloadInfo, setDownloadInfo] = useState(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [logOpen, setLogOpen] = useState(false)
  const [diagnostic, setDiagnostic] = useState(null)
  const [diagnosticLoading, setDiagnosticLoading] = useState(false)
  const [diagnosticError, setDiagnosticError] = useState('')
  const isApk = ehArtefatoApk(a)
  const isZip = /zip/i.test(a.nome || '') && !isApk
  const type = isApk ? 'APK' : isZip ? 'ZIP' : 'ARQUIVO'
  const busy = ['connecting', 'preparing', 'queued', 'progress', 'downloading', 'background'].includes(downloadState)
  const completed = downloadState === 'completed'
  const failed = downloadState === 'error'

  const atualizar = (status, info={}) => {
    if (status === 'connecting' || status === 'preparing') setDownloadState(status)
    else if (status === 'queued') setDownloadState('queued')
    else if (status === 'progress' || status === 'downloading') setDownloadState(status === 'progress' ? 'progress' : 'downloading')
    else if (status === 'paused') setDownloadState('paused')
    else if (status === 'background') setDownloadState('background')
    else if (status === 'completed') setDownloadState('completed')
    else if (status === 'cancelled') setDownloadState('cancelled')
    else if (status === 'failed') setDownloadState('error')
    else if (status === 'started') setDownloadState('started')
    setDownloadInfo(prev => ({ ...(prev || {}), ...info }))
    if (Number.isFinite(Number(info?.progress))) setDownloadProgress(Number(info.progress))
  }

  async function iniciarDownload(event) {
    event?.stopPropagation?.()
    if (a.expirado || busy) return
    setDownloadInfo(null)
    setDiagnostic(null)
    setDiagnosticError('')
    setDownloadProgress(0)
    setDownloadState('connecting')
    const preparingTimer = setTimeout(() => setDownloadState(prev => prev === 'connecting' ? 'preparing' : prev), 450)
    try {
      const result = await githubService.baixarArtifact(a.id, owner, repo, a.nome, {
        preferApk:isApk,
        onStatus:(status,info)=>{ clearTimeout(preparingTimer); atualizar(status,info) },
      })
      clearTimeout(preparingTimer)
      setDownloadInfo(prev => ({ ...(prev || {}), ...result, nativeState:result?.nativeState || prev?.nativeState }))
      if (result.mode === 'android-download-manager' && Number(result.progress) === 100) {
        setDownloadProgress(100); setDownloadState('completed')
      } else if (result.mode === 'android-download-manager-background') setDownloadState('background')
      else setDownloadState('started')
    } catch (e) {
      clearTimeout(preparingTimer)
      const native = e?.downloadState || {}
      setDownloadInfo(prev => ({
        ...(prev || {}), ...native,
        id:e.downloadId || native?.id || prev?.id || '',
        filename:native?.filename || prev?.filename || '',
        errorCode:e?.code || native?.reasonCode || 'DOWNLOAD_FAILED',
        errorMessage:e?.message || native?.reasonMessage || 'Falha ao baixar o artefato.',
        failedAt:new Date().toISOString(),
      }))
      if (e?.code === 'ANDROID_DOWNLOAD_CANCELLED') setDownloadState('cancelled')
      else setDownloadState('error')
      // O detalhe técnico fica no botão Log. Evita o toast genérico "HTTP 422" sobre a tela.
    }
  }

  async function cancelar(e) {
    e.stopPropagation()
    if (!downloadInfo?.id) return
    try { await githubService.cancelDownload(downloadInfo.id); setDownloadState('cancelled') }
    catch(err){ setDownloadInfo(prev=>({...(prev||{}),errorMessage:err.message||'Não foi possível cancelar o download.'})) }
  }

  async function abrir(e) {
    e.stopPropagation()
    if (!downloadInfo?.id) return
    try {
      const result = await githubService.openDownload(downloadInfo.id)
      if (result?.needsInstallPermission) {
        setDownloadInfo(prev=>({...(prev||{}),openMessage:result.message||'Autorize a instalação e toque em Abrir novamente.',openError:''}))
        return
      }
      if (result?.ok === false) {
        setDownloadInfo(prev=>({...(prev||{}),openError:result.message||'O Android não conseguiu abrir o arquivo.'}))
        return
      }
      setDownloadInfo(prev=>({...(prev||{}),openMessage:'Instalador/visualizador aberto no Android.',openError:''}))
    } catch(err) {
      setDownloadInfo(prev=>({...(prev||{}),openError:err.message||'Não foi possível abrir o arquivo.'}))
    }
  }

  async function carregarDiagnostico() {
    if (diagnosticLoading || diagnostic) return
    setDiagnosticLoading(true)
    setDiagnosticError('')
    try {
      const result = await githubService.diagnosticarDownloadArtifact(a.id, owner, repo, { preferApk:isApk })
      setDiagnostic(result)
    } catch (err) {
      setDiagnosticError(err.message || 'Não foi possível consultar o diagnóstico no backend.')
    } finally {
      setDiagnosticLoading(false)
    }
  }

  function abrirLog(e) {
    e?.stopPropagation?.()
    setLogOpen(true)
    carregarDiagnostico()
  }

  const statusText = downloadState === 'connecting' ? 'Conectando…'
    : downloadState === 'preparing' ? `Preparando ${isApk ? 'APK' : 'arquivo'}…`
    : downloadState === 'queued' ? 'Preparando no Android…'
    : downloadState === 'progress' ? `Baixando… ${downloadProgress}%`
    : downloadState === 'downloading' ? 'Baixando…'
    : downloadState === 'paused' ? `Pausado · ${downloadProgress}%`
    : downloadState === 'background' ? `Baixando em segundo plano · ${downloadProgress}%`
    : downloadState === 'completed' ? 'Download concluído ✓'
    : downloadState === 'started' ? 'Download iniciado ✓'
    : downloadState === 'cancelled' ? 'Download cancelado'
    : downloadState === 'error' ? 'Falha no download'
    : `Baixar ${isApk ? 'APK' : isZip ? 'ZIP' : 'arquivo'}`

  const secondaryText = failed
    ? 'Abra o Log para ver a causa e o próximo passo.'
    : downloadInfo?.openError || downloadInfo?.openMessage || (downloadInfo?.filename ? `${downloadInfo.filename}${downloadInfo.total>0?` · ${fmtBytes(downloadInfo.total)}`:''}` : '')

  const logLines = [
    `AL Sistemas · diagnóstico de artefato`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    `Projeto: ${owner}/${repo}`,
    `Artefato: ${a.nome} (#${a.id})`,
    a.workflowRunId ? `Execução: #${a.workflowRunId}` : '',
    `Estado: ${downloadState}`,
    downloadInfo?.id ? `Download Android ID: ${downloadInfo.id}` : '',
    downloadInfo?.filename ? `Arquivo local: ${downloadInfo.filename}` : '',
    downloadInfo?.reasonCode ? `Motivo Android: ${downloadInfo.reasonCode}` : '',
    downloadInfo?.reasonMessage ? `Detalhe Android: ${downloadInfo.reasonMessage}` : '',
    downloadInfo?.httpStatus ? `HTTP: ${downloadInfo.httpStatus}` : '',
    downloadInfo?.downloaded != null ? `Bytes recebidos: ${downloadInfo.downloaded}/${downloadInfo.total || 0}` : '',
    downloadInfo?.openError ? `Abertura: ${downloadInfo.openError}` : '',
    diagnostic?.code ? `Diagnóstico backend: ${diagnostic.code}` : '',
    diagnostic?.message ? `Causa: ${diagnostic.message}` : '',
    diagnostic?.archive ? `Conteúdo: ${diagnostic.archive.files ?? '—'} arquivo(s), ${diagnostic.archive.apkCount ?? '—'} APK(s), ${fmtBytes(diagnostic.archive.bytes || 0)}` : '',
    diagnostic?.apkFiles?.length ? `APKs encontrados: ${diagnostic.apkFiles.join(', ')}` : '',
    diagnostic?.ok === false && diagnostic?.sampleFiles?.length ? `Amostra do artefato: ${diagnostic.sampleFiles.slice(0,12).join(', ')}` : '',
    diagnostic?.recommendedAction ? `Próximo passo: ${diagnostic.recommendedAction}` : '',
    diagnosticError ? `Falha ao consultar diagnóstico: ${diagnosticError}` : '',
  ].filter(Boolean)

  async function copiarLog() {
    try {
      await navigator.clipboard.writeText(logLines.join('\n'))
      toastShow?.('Log copiado.', 'ok')
    } catch { toastShow?.('Não foi possível copiar o log.', 'erro') }
  }

  const cardCanStart = !a.expirado && !busy && !completed && downloadState !== 'started'

  return <>
    <article className={`gh-artifact-card ${a.expirado ? 'expired' : 'downloadable'} ${busy ? 'busy' : ''} ${failed ? 'download-error' : ''}`}
        onClick={cardCanStart ? iniciarDownload : undefined}
        onKeyDown={e=>{ if(cardCanStart && (e.key==='Enter'||e.key===' ')){e.preventDefault();iniciarDownload(e)} }}
        role={cardCanStart ? 'button' : undefined} tabIndex={cardCanStart ? 0 : undefined} aria-busy={busy || undefined} aria-label={cardCanStart ? `${statusText}: ${a.nome}` : undefined}>
      <div className="gh-artifact-card-top"><div className={`gh-artifact-type-icon ${isApk ? 'apk' : ''}`}><span>{busy ? '↻' : isApk ? 'A' : '□'}</span></div><div className="gh-artifact-main"><div className="gh-artifact-kicker"><span>{type}</span>{a.expirado&&<em>EXPIRADO</em>}</div><h4>{a.nome}</h4><p>{a.workflowRunId ? `Gerado pela execução #${a.workflowRunId}` : 'Gerado pelo GitHub Actions'}</p></div></div>
      <div className="gh-artifact-facts"><div><small>TAMANHO</small><b>{fmtBytes(a.tamanho)}</b></div><div><small>CRIADO</small><b>{relTime(a.criadoEm)}</b></div><div><small>EXPIRAÇÃO</small><b>{a.expirado?'Expirado':a.expiradoEm?new Date(a.expiradoEm).toLocaleDateString('pt-BR'):'—'}</b></div></div>
      <div className="gh-artifact-footer">
        {a.expirado ? <span className="gh-artifact-unavailable">Download indisponível</span> : <span className={`gh-artifact-download-state ${busy?'busy':''} ${['started','completed'].includes(downloadState)?'success':''} ${failed?'error':''}`}><span className="gh-artifact-download-icon" aria-hidden="true">{busy?'↻':['started','completed'].includes(downloadState)?'✓':failed?'!':'↓'}</span><span><b>{statusText}</b>{secondaryText&&<small>{secondaryText}</small>}</span></span>}
        <div className="gh-download-actions">
          {busy&&downloadInfo?.id&&<button type="button" onClick={cancelar}>Cancelar</button>}
          {failed&&<button type="button" className="retry" onClick={iniciarDownload}>Tentar novamente</button>}
          {completed&&downloadInfo?.id&&<button type="button" className="open" onClick={abrir}>{isApk?'Instalar / abrir':'Abrir'}</button>}
          {(failed || completed || downloadInfo?.openError) && <button type="button" className="log" onClick={abrirLog}>Log</button>}
        </div>
        {busy && <div className="gh-artifact-progress" aria-label={`Progresso ${downloadProgress}%`}><span style={{width:`${Math.max(downloadProgress,3)}%`}}/></div>}
      </div>
    </article>

    <DSModal open={logOpen} onClose={()=>setLogOpen(false)} title={`Log · ${a.nome}`} size="lg"
      footer={<><DSBtn size="sm" onClick={copiarLog}>Copiar log</DSBtn><DSBtn size="sm" variant="primary" onClick={()=>setLogOpen(false)}>Fechar</DSBtn></>}>
      <div className="gh-download-log">
        <div className={`gh-download-log-summary ${failed || diagnostic?.ok === false ? 'error' : 'ok'}`}>
          <b>{diagnosticLoading ? 'Analisando artefato…' : diagnostic?.message || downloadInfo?.errorMessage || (completed ? 'Download concluído no Android.' : 'Diagnóstico do download')}</b>
          <small>O ticket temporário e as credenciais do GitHub não são exibidos neste log.</small>
        </div>
        <div className="gh-download-log-grid">
          <div><span>Estado</span><b>{downloadState}</b></div>
          <div><span>Artefato</span><b>#{a.id}</b></div>
          <div><span>Download Android</span><b>{downloadInfo?.id || '—'}</b></div>
          <div><span>HTTP</span><b>{downloadInfo?.httpStatus || diagnostic?.httpStatus || '—'}</b></div>
          <div><span>Motivo</span><b>{downloadInfo?.reasonCode || diagnostic?.code || '—'}</b></div>
          <div><span>Recebido</span><b>{downloadInfo?.downloaded != null ? `${fmtBytes(downloadInfo.downloaded)} / ${fmtBytes(downloadInfo.total || 0)}` : '—'}</b></div>
        </div>
        {(downloadInfo?.reasonMessage || downloadInfo?.errorMessage || downloadInfo?.openError) && <div className="gh-download-log-block"><span>Android</span><p>{downloadInfo?.openError || downloadInfo?.reasonMessage || downloadInfo?.errorMessage}</p></div>}
        {diagnosticLoading && <div className="gh-download-log-loading">Consultando o GitHub pelo backend e verificando o conteúdo do pacote…</div>}
        {diagnosticError && <div className="gh-download-log-block error"><span>Diagnóstico indisponível</span><p>{diagnosticError}</p></div>}
        {diagnostic && <>
          <div className="gh-download-log-block"><span>Diagnóstico do backend</span><p>{diagnostic.message}</p></div>
          {diagnostic.archive && <div className="gh-download-log-block"><span>Conteúdo do pacote</span><p>{diagnostic.archive.files ?? 0} arquivo(s) · {diagnostic.archive.apkCount ?? 0} APK(s) · {fmtBytes(diagnostic.archive.bytes || 0)}</p></div>}
          {diagnostic.apkFiles?.length>0 && <div className="gh-download-log-files"><span>APKs encontrados</span>{diagnostic.apkFiles.map(name=><code key={name}>{name}</code>)}</div>}
          {!diagnostic.ok && diagnostic.sampleFiles?.length>0 && <div className="gh-download-log-files"><span>Arquivos encontrados no artefato</span>{diagnostic.sampleFiles.slice(0,12).map((name,i)=><code key={`${name}-${i}`}>{name}</code>)}</div>}
          {diagnostic.recommendedAction && <div className="gh-download-log-next"><span>Próximo passo</span><p>{diagnostic.recommendedAction}</p></div>}
        </>}
      </div>
    </DSModal>
  </>
}

function AbaArtifacts({ artifacts, owner, repo, toastShow }) {
  if (!artifacts) return <div className="gh-artifacts-loading"><span>◌</span><div><b>Carregando artefatos</b><small>Consultando os arquivos gerados pelo GitHub Actions…</small></div></div>
  const ativos = artifacts.filter(a => !a.expirado)
  const expirados = artifacts.length - ativos.length
  const apks = ativos.filter(ehArtefatoApk).length
  return (
    <div className="gh-artifacts-page">
      <section className="gh-artifacts-hero">
        <div className="gh-artifacts-hero-icon">□</div>
        <div className="gh-artifacts-hero-copy">
          <small>GITHUB ACTIONS</small>
          <h3>Central de artefatos</h3>
          <p>Toque em qualquer card disponível para iniciar o download. APKs são extraídos do pacote do Actions e entregues diretamente como .apk.</p>
        </div>
        <div className="gh-artifacts-stats">
          <div><span>Disponíveis</span><b>{ativos.length}</b></div>
          <div><span>APKs</span><b>{apks}</b></div>
          <div><span>Expirados</span><b>{expirados}</b></div>
        </div>
      </section>

      {artifacts.length === 0 ? (
        <div className="gh-artifacts-empty">
          <span>□</span><h4>Nenhum artefato por enquanto</h4>
          <p>Quando um workflow do GitHub Actions gerar APKs, ZIPs ou outros arquivos, eles aparecerão aqui.</p>
        </div>
      ) : (
        <div className="gh-artifacts-grid">
          {artifacts.map(a => <ArtifactDownloadCard key={a.id} artifact={a} owner={owner} repo={repo} toastShow={toastShow} />)}
        </div>
      )}
    </div>
  )
}


/* ── ABA: Análise ────────────────────────────────────────── */
function AbaAnalysis({ analysis: an }) {
  if (!an) return <div style={{ fontSize: FONT.base, color: C.muted }}>Carregando análise...</div>
  const badge = (label, cor) => <DSBadge style={{ color: cor, background: `${cor}18`, borderColor: `${cor}30` }}>{label}</DSBadge>
  const tech = [...new Set([...(an.frameworks || []), ...(an.plataforma || []), an.packageManager].filter(Boolean))]
  const resumo = [
    ['Aplicação', an.produto || 'Não identificado'],
    ['Versão', an.versao ? `v${an.versao}` : 'Não detectada'],
    ['Tipo', an.tipo || 'Repositório de código'],
    ['Branch', an.branch || '—'],
    ['Frontend', an.frontend ? 'Detectado' : 'Não detectado'],
    ['Backend', an.backend ? 'Detectado' : 'Não detectado'],
    ['Plataforma', (an.plataforma || []).join(' · ') || 'Não detectada'],
    ['Package manager', an.packageManager || 'Não detectado'],
    ['Linguagem principal', an.linguagemPrincipal || '—'],
    ['Tamanho', an.tamanhoBytes ? fmtBytes(an.tamanhoBytes) : fmtRepoSize(an.tamanhoGitHubKb)],
    ['Arquivos', String(an.totalArquivos ?? '—')],
    ['Último push', an.ultimoPush ? relTime(an.ultimoPush) : '—'],
    ['Acesso', an.acesso || '—'],
  ]
  return <div className="gh-analysis-page">
    <div className="gh-analysis-hero">
      <div><small>PROJETO · ANÁLISE</small><h3>{an.produto || 'Estrutura do repositório'}{an.versao ? <span> v{an.versao}</span> : null}</h3><p>{an.tipo || 'Repositório'}{an.frameworks?.length ? ` · ${an.frameworks.join(' / ')}` : ''}</p></div>
      <div>{badge(an.maturidade || 'desconhecido', MATURIDADE_COR[an.maturidade] || C.muted)}</div>
    </div>

    <div className="gh-analysis-info-grid">{resumo.map(([label,value])=><div key={label}><span>{label}</span><b>{value}</b></div>)}</div>

    {tech.length > 0 && <><DSSectionTitle style={{ marginTop:SPACE.xl2, marginBottom:SPACE.md }}>Tecnologias detectadas</DSSectionTitle><div style={{display:'flex',gap:SPACE.sm,flexWrap:'wrap'}}>{tech.map(t=><DSBadge key={t} variant="blue">{t}</DSBadge>)}</div></>}

    <DSSectionTitle style={{ marginTop:SPACE.xl2, marginBottom:SPACE.md }}>Qualidade e automação</DSSectionTitle>
    <div className="gh-analysis-signal-grid">
      <div><span>Atividade</span><b>{an.diasSemAtividade == null ? '—' : an.diasSemAtividade === 0 ? 'hoje' : `${an.diasSemAtividade}d sem push`}</b><small>Critério de ativo: até 90 dias</small></div>
      <div><span>Commits recentes</span><b>{an.frequenciaCommits || '—'}</b><small>{an.commitsAmostra ?? 0} na amostra</small></div>
      <div><span>Workflows</span><b>{an.workflows?.length || 0}</b><small>{an.hasCI ? 'GitHub Actions detectado' : 'Nenhum workflow detectado'}</small></div>
      <div><span>Testes</span><b>{an.hasTestes ? 'Detectados' : 'Não detectados'}</b><small>{an.hasDocker ? 'Docker detectado' : 'Sem Docker detectado'}</small></div>
    </div>

    {an.workflows?.length > 0 && <div className="gh-muted-box"><b>Workflows encontrados</b><div style={{marginTop:5,display:'flex',gap:6,flexWrap:'wrap'}}>{an.workflows.map(w=><code key={w}>{w}</code>)}</div></div>}

    {an.linguagens && Object.keys(an.linguagens).length > 0 && <><DSSectionTitle style={{ marginTop:SPACE.xl2, marginBottom:SPACE.lg }}>Linguagens</DSSectionTitle>{(()=>{const total=Object.values(an.linguagens).reduce((a,b)=>a+b,0)||1;return Object.entries(an.linguagens).sort(([,a],[,b])=>b-a).map(([lang,bytes])=>{const pct=((bytes/total)*100).toFixed(1);const cor=LANG_COR[lang]||C.muted;return <div key={lang} style={{marginBottom:SPACE.md}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{fontSize:FONT.sm,color:C.text,fontWeight:600}}>{lang}</span><span style={{fontSize:FONT.xs,color:C.muted}}>{pct}%</span></div><div style={{height:5,background:C.surface,borderRadius:RADIUS.xs,overflow:'hidden'}}><div style={{width:`${pct}%`,height:'100%',background:cor,borderRadius:RADIUS.xs}}/></div></div>})})()}</>}
  </div>
}

/* ── ABA: Excluir ────────────────────────────────────────── */

/* ── ABA: Push (local → GitHub) ──────────────────────────── */
function AbaPublicar({ open, repo, owner, repoNome, meta, toastShow, onMetaAtualizado, onAbrirArquivos, onClose }) {
  const repoAtual = repo.nomeCompleto || `${owner}/${repoNome}`
  const [repos, setRepos] = useState([])
  const [repository, setRepository] = useState(meta?.publicacao?.repository || repoAtual)
  const [branch, setBranch] = useState(meta?.publicacao?.branch || repo.branch || 'main')
  const [targetPath, setTargetPath] = useState(meta?.publicacao?.path || '')
  const [snapshotR2, setSnapshotR2] = useState(meta?.publicacao?.snapshotR2 !== false)
  const [replacePath, setReplacePath] = useState(false)
  const [arquivo, setArquivo] = useState(null)
  const [packageMeta, setPackageMeta] = useState(null)
  const [repoInsight, setRepoInsight] = useState(null)
  const [inspectando, setInspectando] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [deployment, setDeployment] = useState(null)
  const [preflight, setPreflight] = useState(null)
  const [preflightRunning, setPreflightRunning] = useState(false)
  const [publishJob, setPublishJob] = useState(null)
  const [publicando, setPublicando] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [publishPhase, setPublishPhase] = useState('idle')
  const [publishError, setPublishError] = useState('')
  const [publishErrorAction, setPublishErrorAction] = useState('')
  const [trackingLost, setTrackingLost] = useState(false)
  const [pollRetry, setPollRetry] = useState(0)
  const [reviewDetailsOpen, setReviewDetailsOpen] = useState(false)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [resultDetailsOpen, setResultDetailsOpen] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [deployingRender, setDeployingRender] = useState({})
  const [passo, setPasso] = useState(1)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    githubService.repos({ per_page: 100, sort: 'updated' })
      .then(d => setRepos(d.repos || []))
      .catch(() => setRepos([]))
  }, [open])

  useEffect(() => {
    if (!open || !repository || !branch) return
    const [o, r] = repository.split('/')
    if (!o || !r) return
    let alive = true
    githubService.insight(o, r, branch).then(d => { if (alive) setRepoInsight(d) }).catch(() => { if (alive) setRepoInsight(null) })
    return () => { alive = false }
  }, [open, repository, branch])

  const limparPath = v => v.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.{2}/g, '').replace(/\/+/g, '/')
  const destinoVisual = `${repository || 'repositório'} → ${branch || 'main'} → /${targetPath || ''}`
  const totalPassos = 6
  const etapas = [
    { title:'Pacote', desc:'ZIP do projeto' },
    { title:'GitHub', desc:'Repositório' },
    { title:'Destino', desc:'Branch e pasta' },
    { title:'Opções', desc:'Modo e R2' },
    { title:'Produção', desc:'Vercel / Render' },
    { title:'Revisão', desc:'Confirmar publicação' },
  ]

  async function analisarPacote(file) {
    setArquivo(file || null); setResultado(null); setPublishError(''); setPublishErrorAction(''); setTrackingLost(false); setPollRetry(0); setEventsOpen(false); setResultDetailsOpen(false); setPackageMeta(null); setPreflight(null); setPublishJob(null)
    if (!file) return
    setInspectando(true)
    try {
      const zip = await JSZip.loadAsync(file)
      const entries = Object.values(zip.files).filter(x => !x.dir)
      const norm = e => String(e?.name || '').replace(/\\/g,'/').replace(/^\.\//,'')
      const exact = name => entries.find(x => norm(x).toLowerCase() === name.toLowerCase())
      const ending = name => entries.find(x => norm(x).toLowerCase().endsWith('/'+name.toLowerCase()))
      const manifestEntry = exact('al-sistemas.json') || ending('al-sistemas.json')
      const packageCandidates = entries
        .filter(x => /(^|\/)package\.json$/i.test(norm(x)) && !/(^|\/)node_modules\//i.test(norm(x)))
        .sort((a,b) => norm(a).split('/').length - norm(b).split('/').length)
      const rootPkg = exact('package.json') || packageCandidates.find(x => {
        const n = norm(x).toLowerCase()
        return !n.endsWith('/frontend/package.json') && !n.endsWith('/backend/package.json') && n.split('/').length <= 2
      }) || null
      const frontendPkg = exact('frontend/package.json') || ending('frontend/package.json')
      const backendPkg = exact('backend/package.json') || ending('backend/package.json')
      let metaInfo = { nome:file.name, tamanho:file.size, arquivos:entries.length, produto:'Projeto ZIP', versao:'', versoes:{} }
      if (manifestEntry) {
        const manifest = JSON.parse(await manifestEntry.async('string'))
        metaInfo = { ...metaInfo, produto:manifest.product || manifest.name || 'AL Sistemas', versao:String(manifest.version || ''), tipo:'Manifesto do projeto', manifesto:norm(manifestEntry) }
      } else if (rootPkg) {
        const pkg = JSON.parse(await rootPkg.async('string'))
        metaInfo = { ...metaInfo, produto:pkg.name || 'Projeto Node.js', versao:String(pkg.version || ''), tipo:'package.json', manifesto:norm(rootPkg) }
      }
      for (const [key, entry] of [['frontend',frontendPkg],['backend',backendPkg]]) {
        if (!entry) continue
        try { const pkg=JSON.parse(await entry.async('string')); metaInfo.versoes[key]=String(pkg.version||'') } catch {}
      }
      if (!metaInfo.versao) metaInfo.versao = metaInfo.versoes.frontend || metaInfo.versoes.backend || ''
      metaInfo.consistente = !metaInfo.versoes.frontend || !metaInfo.versoes.backend || metaInfo.versoes.frontend === metaInfo.versoes.backend
      setPackageMeta(metaInfo)
      if (!commitMessage.trim()) setCommitMessage(metaInfo.versao ? `Atualiza ${metaInfo.produto} para ${metaInfo.versao}` : `Publica ${file.name}`)
    } catch (e) {
      setPackageMeta({ nome:file.name, tamanho:file.size, arquivos:0, produto:'Projeto ZIP', versao:'', versoes:{}, aviso:'Não foi possível ler os metadados do ZIP no navegador.' })
    } finally { setInspectando(false) }
  }

  const publishConfig = () => ({
    repository, branch, targetPath, replacePath, snapshotR2,
    sentVersion:packageMeta?.versao || '', sentProduct:packageMeta?.produto || '',
    commitMessage: commitMessage.trim() || (arquivo ? `Publica ${arquivo.name} pelo AL Sistemas` : 'Publicação pelo AL Sistemas'),
  })

  async function verificarTudo() {
    if (!repository || !branch) return null
    setPreflightRunning(true); setPreflight(null)
    try {
      const [pf, dep] = await Promise.all([
        githubService.preflightPublicacao(owner, repoNome, publishConfig()),
        updatesService.deploymentCheck(repository, branch).catch(e => ({erro:e.message || 'Não foi possível conferir produção.'})),
      ])
      setPreflight(pf); setDeployment(dep)
      return pf
    } catch(e) {
      const pf = e?.data || {ok:false,checks:[],warnings:[],erro:e.message || 'A verificação obrigatória falhou.'}
      setPreflight(pf)
      toastShow(e.message || 'A verificação obrigatória encontrou um problema.', 'erro')
      return pf
    } finally { setPreflightRunning(false) }
  }

  async function avancar() {
    if (passo === 1 && !arquivo) return toastShow('Selecione o ZIP do projeto para continuar.', 'erro')
    if (passo === 2 && !repository) return toastShow('Selecione o repositório de destino.', 'erro')
    if (passo === 3 && !branch) return toastShow('Informe a branch de destino.', 'erro')
    if (passo === 5) {
      const pf = await verificarTudo()
      if (!pf?.ok) return
    }
    setPasso(p => Math.min(totalPassos, p + 1))
  }
  function voltar() { setPasso(p => Math.max(1, p - 1)) }
  const esperar = ms => new Promise(r => setTimeout(r, ms))

  async function acompanharPublicacao(initialJob) {
    let job = initialJob
    if (!job?.id) throw new Error('O backend não retornou o acompanhamento da publicação.')
    const deadline = Date.now() + 15 * 60 * 1000
    let failures = 0
    setPublishJob(job)

    while (Date.now() < deadline) {
      if (job.status === 'succeeded') return job
      if (job.status === 'failed') {
        const err = new Error(job.error?.message || 'A publicação falhou no backend.')
        err.code = job.error?.code || 'GITHUB_PUBLISH_FAILED'
        err.action = job.error?.action || ''
        throw err
      }

      await esperar(failures ? Math.min(8000, 900 * (2 ** Math.min(failures - 1, 3))) : 700)
      try {
        const d = await githubService.publicacaoJob(owner, repoNome, job.id)
        job = d.job || job
        failures = 0
        setPollRetry(0)
        setTrackingLost(false)
        setPublishJob(job)
        setPublishPhase(job.phase || 'backend')
      } catch (e) {
        failures += 1
        setPollRetry(failures)
        setPublishPhase('reconnecting')
        if (failures >= 8) {
          const err = new Error('O envio foi recebido, mas o celular perdeu o acompanhamento do backend. Isso não significa que a publicação falhou.')
          err.code = 'TRACKING_LOST'
          err.action = 'Toque em Reconectar. Não envie o ZIP novamente enquanto o job ainda puder estar em execução.'
          throw err
        }
      }
    }

    const err = new Error('A publicação ultrapassou o tempo de acompanhamento. Ela pode continuar no backend.')
    err.code = 'TRACKING_LOST'
    err.action = 'Use Reconectar antes de iniciar uma nova publicação.'
    throw err
  }

  async function concluirJob(job) {
    const r = job?.result
    if (!r) throw new Error('O backend concluiu o job, mas não retornou o resultado da publicação.')
    setResultado(r); setPublishPhase('done'); setPublishError(''); setPublishErrorAction(''); setTrackingLost(false); setPollRetry(0); setEventsOpen(false); setPasso(8)

    // As integrações são complementares. O GitHub já terminou, então Vercel,
    // Render e metadados não seguram a tela de sucesso nem transformam uma
    // publicação concluída em erro visual.
    githubService.getMeta(repo.id).then(atualizado=>{ if(atualizado) onMetaAtualizado?.(atualizado) }).catch(()=>{})
    updatesService.deploymentCheck(repository, branch).then(setDeployment).catch(e=>setDeployment({erro:e.message||'Produção não pôde ser conferida após o commit.'}))
    const [o,rn]=repository.split('/')
    if(o&&rn) githubService.insight(o,rn,branch).then(setRepoInsight).catch(()=>{})
  }

  async function publicar() {
    if (!arquivo || !repository || !branch) return
    setPublicando(true); setResultado(null); setPublishError(''); setPublishErrorAction(''); setTrackingLost(false); setPollRetry(0); setUploadProgress(0); setPublishPhase('upload'); setPublishJob(null); setEventsOpen(false)
    setPasso(7)
    try {
      // A revisão já fez a checagem informativa. A única checagem autoritativa
      // acontece no backend imediatamente antes de tocar no GitHub.
      const initial = await githubService.publicarPacote(owner, repoNome, arquivo, publishConfig(), prog => {
        const pct = prog.percent || 0
        setUploadProgress(pct)
        if (pct >= 100) setPublishPhase('backend')
      })
      const job = await acompanharPublicacao(initial?.job)
      await concluirJob(job)
    } catch (e) {
      setPublishError(e.message || 'Não foi possível publicar o projeto.')
      setPublishErrorAction(e.action || e.acao || e?.data?.acao || '')
      const recoverable = e.code === 'TRACKING_LOST' || (e.code === 'GITHUB_PUBLISH_ACTIVE' && e.jobId)
      if (e.code === 'GITHUB_PUBLISH_ACTIVE' && e.jobId) setPublishJob({ id:e.jobId, status:'running', phase:'reconnecting', progress:publishJob?.progress || 0, logs:publishJob?.logs || [] })
      setTrackingLost(Boolean(recoverable))
      setPublishPhase(recoverable ? 'reconnecting' : 'error')
      setEventsOpen(true)
      setPasso(7)
    } finally { setPublicando(false) }
  }

  async function reconectarPublicacao() {
    if (!publishJob?.id) return
    setPublicando(true); setPublishError(''); setPublishErrorAction(''); setTrackingLost(false); setPollRetry(0); setPublishPhase('reconnecting')
    try {
      const d = await githubService.publicacaoJob(owner, repoNome, publishJob.id)
      const job = await acompanharPublicacao(d.job || publishJob)
      await concluirJob(job)
    } catch (e) {
      setPublishError(e.message || 'Não foi possível recuperar o acompanhamento.')
      setPublishErrorAction(e.action || e.acao || e?.data?.acao || '')
      const lost = e.code === 'TRACKING_LOST' || !e?.status
      setTrackingLost(lost)
      setPublishPhase(lost ? 'reconnecting' : 'error')
      setEventsOpen(true)
    } finally { setPublicando(false) }
  }

  function copiarLogPublicacao() {
    const logs = [...(publishJob?.logs || [])].sort((a,b)=>new Date(b?.at||0)-new Date(a?.at||0))
    const linhas = [
      `${repoInsight?.produto || repo?.produto || repo.nome || 'Projeto'} · ${repository} · ${branch}`,
      arquivo ? `Pacote: ${arquivo.name}` : '',
      ...logs.map(l => {
        const acao = statusVisual(l?.details?.operation || l?.state || l?.label)
        const msg = sanitizeLogText(l?.message || l?.details?.file || '')
        return `${new Date(l.at).toLocaleTimeString('pt-BR')} [${acao}] ${msg}`
      }),
      publishError ? `ERRO: ${sanitizeLogText(publishError)}` : '',
    ].filter(Boolean).join('\n')
    navigator.clipboard?.writeText(linhas).then(()=>toastShow('Acontecimentos copiados.')).catch(()=>toastShow('Não foi possível copiar os acontecimentos.','erro'))
  }

  function copiarResumoPublicacao() {
    const enviados = Number(resultado?.commit?.enviados || 0)
    const removidos = Number(resultado?.commit?.removidos || 0)
    const pulados = Number(resultado?.commit?.inalterados || 0)
    const linhas = [
      resultUnchanged ? 'Publicação concluída · nenhuma alteração necessária' : 'Publicação concluída',
      `Projeto: ${repoInsight?.produto || repo?.produto || repo.nome || repoNome}`,
      `Versão: ${resultBeforeVersion || 'não detectada'} → ${resultAfterVersion || 'não detectada'}`,
      `Branch: ${resultado?.destino?.branch || branch}`,
      `Commit: ${resultado?.commit?.commitSha || 'sem novo commit'}`,
      `Enviados/alterados: ${enviados}`,
      `Removidos: ${removidos}`,
      `Pulados: ${pulados}`,
      `Destino: GitHub · ${resultado?.destino?.repository || repository}`,
      `Status: ${resultado?.verificacao?.ok === false ? 'Falhou na verificação' : 'Concluído'}`,
      resultado?.publicadoEm ? `Data: ${new Date(resultado.publicadoEm).toLocaleString('pt-BR')}` : '',
      publishError ? `Erro: ${sanitizeLogText(publishError)}` : '',
    ].filter(Boolean).join('\n')
    navigator.clipboard?.writeText(linhas).then(()=>toastShow('Resumo copiado.')).catch(()=>toastShow('Não foi possível copiar o resumo.','erro'))
  }

  async function implantarRender(service) {
    const sha = resultado?.commit?.commitSha
    if (!sha) return
    setDeployingRender(p => ({ ...p, [service.id]: true }))
    try {
      const r = await infraestruturaService.renderDeploy(service.id, { commitId: sha })
      toastShow(r.mensagem || `Deploy iniciado na Render: ${service.name || service.id}`)
    } catch (e) { toastShow(e.message || 'Falha ao iniciar deploy na Render.', 'erro') }
    finally { setDeployingRender(p => ({ ...p, [service.id]: false })) }
  }

  const currentVersion = preflight?.version?.current || repoInsight?.versao || repo?.versao || ''
  const sentVersion = packageMeta?.versao || ''
  const versionLabel = sentVersion ? (currentVersion ? `${currentVersion} → ${sentVersion}` : `Sem versão → ${sentVersion}`) : 'Não detectada'
  const versionState = preflight?.checks?.find(c=>c.id==='version')?.state || (sentVersion && currentVersion && sentVersion===currentVersion ? 'warn' : 'ok')
  const publishLogs = Array.isArray(publishJob?.logs) ? publishJob.logs : []
  const publishLogsNewest = [...publishLogs].sort((a,b)=>new Date(b?.at||0)-new Date(a?.at||0))
  const latestPublishLog = publishLogsNewest[0] || null
  const livePercent = publishPhase==='upload'
    ? Math.max(0,Math.min(100,Number(uploadProgress||0)))
    : Math.max(0,Math.min(100,Number(publishJob?.progress ?? latestPublishLog?.progress ?? 0)))
  const liveFile = publishPhase==='upload'
    ? arquivo?.name || 'Pacote ZIP'
    : latestPublishLog?.details?.file || latestPublishLog?.message || 'Preparando publicação…'
  const liveOperation = publishPhase==='upload'
    ? 'Enviando'
    : statusVisual(latestPublishLog?.details?.operation || latestPublishLog?.state || latestPublishLog?.label || 'running')
  const liveCounter = latestPublishLog?.details?.total
    ? `${latestPublishLog.details.index || 0}/${latestPublishLog.details.total}`
    : plural(publishLogs.length, 'evento', 'eventos')
  const resultUnchanged = resultado?.commit?.changed === false
  const resultBeforeVersion = resultado?.versao?.current || ''
  const resultAfterVersion = resultado?.versao?.after || resultado?.versao?.incoming || resultBeforeVersion || ''
  const resultCommitLabel = resultado?.commit?.commitSha?.slice(0,10) || 'Sem novo commit'
  const footer = passo <= 6 ? <>
    <DSBtn onClick={passo === 1 ? onClose : voltar} disabled={publicando}>{passo === 1 ? 'Cancelar' : '← Voltar'}</DSBtn>
    {passo < totalPassos
      ? <DSBtn variant="primary" onClick={avancar} loading={preflightRunning && passo===5} disabled={inspectando}>Continuar →</DSBtn>
      : <DSBtn variant="primary" onClick={publicar} loading={publicando}>↑ Publicar no GitHub</DSBtn>}
  </> : passo === 7 ? <>
    {publishError && !trackingLost ? <DSBtn onClick={() => setPasso(6)}>← Revisar</DSBtn> : <span />}
    {trackingLost
      ? <DSBtn variant="primary" onClick={reconectarPublicacao} loading={publicando}>Reconectar</DSBtn>
      : publishError
        ? <DSBtn variant="primary" onClick={publicar} loading={publicando}>Tentar novamente</DSBtn>
        : <DSBtn disabled>{pollRetry ? 'Reconectando…' : 'Publicando…'}</DSBtn>}
  </> : <>
    <span />
    <DSBtn variant="primary" onClick={onClose}>Concluir</DSBtn>
  </>

  return <AdminWizardModal
    open={open}
    title={passo === 7 ? 'Publicando projeto' : passo === 8 ? 'Publicação concluída' : 'Publicar projeto'}
    eyebrow="GITHUB · PUBLICAÇÃO"
    step={passo <= 6 ? passo : 6}
    steps={passo <= 6 ? etapas : []}
    onClose={onClose}
    canClose={!publicando}
    footer={footer}
    className="gh-publish-wizard"
  >
    {passo === 1 && <section className="gh-wizard-step gh-wizard-compact-step">
      <div className="gh-wizard-step-head"><span>1</span><div><h3>Escolha o pacote</h3><p>O projeto pode vir do celular ou computador e não precisa existir no módulo Projetos.</p></div></div>
      <button type="button" className={`gh-package-picker${arquivo ? ' selected' : ''}`} onClick={() => fileInputRef.current?.click()} disabled={inspectando}>
        <input ref={fileInputRef} type="file" accept=".zip,application/zip" hidden onChange={e => analisarPacote(e.target.files?.[0] || null)} />
        <span className="gh-package-picker-icon">{arquivo ? '📦' : '↑'}</span>
        <span className="gh-package-picker-copy"><b>{arquivo ? arquivo.name : 'Selecionar pacote ZIP'}</b><small>{arquivo ? `${fmtBytes(arquivo.size)} · ${packageMeta?.arquivos || '…'} arquivo(s)` : 'Toque para escolher o projeto que será preparado e publicado.'}</small></span>
        <span className="gh-package-picker-action">{inspectando ? 'Lendo…' : arquivo ? 'Trocar' : 'Escolher'}</span>
      </button>
      <div className={`gh-version-journey ${versionState}`}>
        <div><small>VERSÃO NO GITHUB</small><b>{currentVersion || 'Não detectada'}</b><span>{repoInsight?.produto || repo?.produto || repo.nome || repoNome}</span></div>
        <i>→</i>
        <div><small>VERSÃO DO PACOTE</small><b>{sentVersion || 'Não detectada'}</b><span>{packageMeta?.produto || 'Projeto ZIP'}</span></div>
      </div>
      <div className="al-wizard-info-grid gh-version-compare">
        <WizardInfo label="Aplicativo" value={packageMeta?.produto || repoInsight?.produto || repo?.produto || repo.nome || repoNome} />
        <WizardInfo label="Arquivo" value={arquivo?.name || '—'} help={arquivo ? `${fmtBytes(arquivo.size)} · ZIP` : ''} />
        <WizardInfo label="Destino" value={repository || '—'} help={`Branch: ${branch || 'main'}`} />
        <WizardInfo label="Versão" value={versionLabel} help={sentVersion && currentVersion ? (sentVersion===currentVersion ? 'Mesma versão' : 'Atualização de versão') : 'Comparação indisponível'} />
        <WizardInfo label="Arquivos no ZIP" value={`${packageMeta?.arquivos || 0}`} />
        <WizardInfo label="Manifesto" value={packageMeta?.tipo || 'Não detectado'} help={packageMeta?.manifesto || ''} />
      </div>
      {packageMeta?.consistente === false && <div className="gh-warning-box"><b>Versionamento independente detectado</b><span>Frontend {packageMeta?.versoes?.frontend || '—'} e backend {packageMeta?.versoes?.backend || '—'} têm versões diferentes. Isso é permitido em projetos com pacotes separados e não bloqueia a publicação.</span></div>}
      {packageMeta?.aviso && <div className="gh-muted-box">{packageMeta.aviso}</div>}
      <label className="gh-field"><span>Mensagem do commit</span><input value={commitMessage} onChange={e => setCommitMessage(e.target.value.slice(0,240))} placeholder={arquivo ? `Publica ${arquivo.name}` : 'Gerada automaticamente quando possível'} style={inp()} /></label>
    </section>}

    {passo === 2 && <section className="gh-wizard-step gh-wizard-compact-step">
      <div className="gh-wizard-step-head"><span>2</span><div><h3>Escolha o repositório</h3><p>A lista vem diretamente da conta GitHub configurada em Integrações e APIs.</p></div></div>
      <label className="gh-field"><span>Repositório de destino</span><select value={repository} onChange={e => { setRepository(e.target.value); setDeployment(null); setResultado(null); setRepoInsight(null); setPreflight(null) }} style={inp()}>
        {!repos.some(r => r.nomeCompleto === repository) && repository && <option value={repository}>{repository}</option>}
        {repos.map(r => <option key={r.id} value={r.nomeCompleto}>{r.nomeCompleto}{r.privado ? ' · privado' : ''}</option>)}
      </select></label>
      <div className="al-wizard-info-grid"><WizardInfo label="Repositório" value={repository || '—'} /><WizardInfo label="Branch sugerida" value={branch || 'main'} /><WizardInfo label="Versão atual" value={currentVersion || '—'} /><WizardInfo label="Pacote" value={arquivo?.name || '—'} /></div>
    </section>}

    {passo === 3 && <section className="gh-wizard-step gh-wizard-compact-step">
      <div className="gh-wizard-step-head"><span>3</span><div><h3>Defina o destino</h3><p>Branch e pasta são independentes; confira exatamente onde o conteúdo será aplicado.</p></div></div>
      <div className="gh-two-fields">
        <label className="gh-field"><span>Branch</span><input value={branch} onChange={e => { setBranch(e.target.value.replace(/\s/g,'')); setDeployment(null); setResultado(null); setRepoInsight(null); setPreflight(null) }} placeholder="main" style={inp()} /></label>
        <label className="gh-field"><span>Pasta no GitHub</span><input value={targetPath} onChange={e => { setTargetPath(limparPath(e.target.value)); setResultado(null); setPreflight(null) }} placeholder="/ (raiz), frontend, backend..." style={inp()} /></label>
      </div>
      <div className="gh-path-preview"><span>Destino exato</span><code>{destinoVisual}</code></div>
    </section>}

    {passo === 4 && <section className="gh-wizard-step gh-wizard-compact-step">
      <div className="gh-wizard-step-head"><span>4</span><div><h3>Modo e segurança</h3><p>Escolha como tratar o conteúdo atual e se o pacote deve permanecer preservado no R2.</p></div></div>
      <div className="gh-option-grid">
        <button type="button" className={`gh-option-card${!replacePath?' active':''}`} onClick={() => { setReplacePath(false); setPreflight(null) }}><b>Mesclar / atualizar</b><small>Mantém arquivos existentes que não estão no ZIP.</small></button>
        <button type="button" className={`gh-option-card${replacePath?' active danger':''}`} onClick={() => { setReplacePath(true); setPreflight(null) }}><b>Substituir destino</b><small>Remove arquivos ausentes apenas da pasta escolhida.</small></button>
        <button type="button" className={`gh-option-card${snapshotR2?' active':''}`} onClick={() => { setSnapshotR2(v => !v); setPreflight(null) }}><b>Snapshot R2 {snapshotR2 ? '✓' : '—'}</b><small>{snapshotR2 ? 'Cópia preservada antes do commit.' : 'Publicar sem guardar snapshot.'}</small></button>
      </div>
      <div className="al-wizard-info-grid"><WizardInfo label="Branch" value={branch || 'main'} /><WizardInfo label="Pasta" value={`/${targetPath || ''}`} /><WizardInfo label="Modo" value={replacePath ? 'Substituir' : 'Mesclar'} /><WizardInfo label="Snapshot" value={snapshotR2 ? 'R2 ✓' : 'Desativado'} /></div>
    </section>}

    {passo === 5 && <section className="gh-wizard-step gh-wizard-compact-step">
      <div className="gh-wizard-step-head"><span>5</span><div><h3>Produção detectada</h3><p>O GitHub é o destino principal. Integrações adicionais só aparecem como configuradas quando forem realmente encontradas.</p></div></div>
      <div className="gh-cloud-action-row"><DSBtn size="sm" variant="ghost" onClick={verificarTudo} loading={preflightRunning}>↻ Conferir produção e GitHub</DSBtn></div>
      <div className="al-wizard-info-grid gh-production-summary">
        <WizardInfo label="Destino principal" value={`GitHub · ${branch || 'main'}`} help={repository || ''} />
        <WizardInfo label="Build" value={repoInsight?.framework || packageMeta?.tipo || 'Não detectado'} />
        <WizardInfo label="Automação" value={repoInsight?.hasCI ? 'GitHub Actions detectado' : 'Não detectada'} help={repoInsight?.workflows?.length ? plural(repoInsight.workflows.length,'workflow','workflows') : ''} />
        <WizardInfo label="Plataforma" value={repoInsight?.plataforma || 'Não detectada'} />
      </div>
      {preflightRunning && !deployment ? <div className="gh-muted-box">Conferindo GitHub, R2, versão e produção…</div> : deployment?.erro ? <div className="gh-error-box">{deployment.erro}</div> : deployment ? <div className="gh-cloud-grid gh-wizard-cloud">
        <div className="gh-cloud-card"><div className="gh-cloud-title"><b>Vercel</b><DSBadge variant={deployment.vercel?.projects?.length ? 'green' : 'gray'}>{deployment.vercel?.projects?.length || 0}</DSBadge></div>{deployment.vercel?.projects?.length ? deployment.vercel.projects.map(p=><div className="gh-cloud-row" key={p.id}><span><b>{p.name}</b><small>{p.rootDirectory ? `/${p.rootDirectory}` : 'raiz'}{p.productionBranch ? ` · ${p.productionBranch}` : ''}</small></span><em>Configurado</em></div>) : <p>Não configurado para este repositório.</p>}</div>
        <div className="gh-cloud-card"><div className="gh-cloud-title"><b>Render</b><DSBadge variant={deployment.render?.services?.length ? 'green' : 'gray'}>{deployment.render?.services?.length || 0}</DSBadge></div>{deployment.render?.services?.length ? deployment.render.services.map(s=><div className="gh-cloud-row" key={s.id}><span><b>{s.name || s.id}</b><small>{s.branch || branch}</small></span><em>Configurado</em></div>) : <p>Não configurado para este repositório.</p>}</div>
      </div> : <div className="gh-muted-box">Ao continuar, o AL consulta automaticamente Vercel e Render.</div>}
    </section>}

    {passo === 6 && <section className="gh-wizard-step gh-review-compact">
      <div className={`gh-preflight-banner gh-preflight-summary ${preflight?.ok ? 'ok' : 'error'}`}>
        <span>{preflight?.ok ? '✓' : '!'}</span>
        <div>
          <b>{preflight?.ok ? 'Pronto para publicar' : 'Verificação necessária'}</b>
          <small>{preflight?.ok ? `${repository} · ${branch} · /${targetPath || ''}` : (preflight?.erro || 'Revise os itens que bloquearam a publicação.')}</small>
        </div>
      </div>

      <div className="gh-review-summary-line">
        <span><small>VERSÃO</small><b>{preflight?.version?.current || currentVersion || '—'} → {sentVersion || '—'}</b></span>
        <span><small>MODO</small><b>{replacePath ? 'Substituir' : 'Mesclar'}</b></span>
        <span><small>SNAPSHOT</small><b>{snapshotR2 ? 'R2 ✓' : 'Não'}</b></span>
      </div>

      {replacePath && <div className="gh-compact-warning">! Substituir removerá do destino os arquivos que não existirem no ZIP.</div>}

      <button type="button" className="gh-disclosure-button" onClick={()=>setReviewDetailsOpen(v=>!v)} aria-expanded={reviewDetailsOpen}>
        <span>{reviewDetailsOpen ? 'Ocultar detalhes da verificação' : 'Detalhes da verificação'}</span><b>{reviewDetailsOpen ? '⌃' : '⌄'}</b>
      </button>
      {reviewDetailsOpen && <div className="gh-disclosure-panel">
        <div className="gh-preflight-grid">{(preflight?.checks || []).map(c=><div key={c.id} className={`gh-preflight-check ${c.state}`}><span>{c.state==='ok'?'✓':c.state==='warn'?'!':'×'}</span><div><b>{c.label}</b><small>{c.detail}</small></div></div>)}</div>
        {preflight?.warnings?.length>0&&<div className="gh-preflight-warnings"><b>Atenção</b>{preflight.warnings.map((w,i)=><span key={i}>• {w}</span>)}</div>}
        <div className="gh-review-detail-actions"><DSBtn size="sm" variant="ghost" onClick={verificarTudo} loading={preflightRunning}>↻ Verificar novamente</DSBtn></div>
      </div>}
    </section>}

    {passo === 7 && <section className="gh-publish-live gh-publish-minimal">
      <div className={`gh-publish-monitor ${publishError ? 'error' : ''}`} aria-live="polite">
        <div className="gh-publish-monitor-top">
          <div><small>{trackingLost || publishPhase==='reconnecting' ? 'ACOMPANHAMENTO' : publishPhase==='upload' ? 'ENVIANDO PACOTE' : 'PUBLICANDO NO GITHUB'}</small><b>{publishError ? (trackingLost ? 'Conexão perdida' : 'Interrompido') : pollRetry ? `Reconectando · tentativa ${pollRetry}/8` : liveOperation}</b></div>
          <strong>{livePercent}%</strong>
        </div>
        <div className="gh-publish-monitor-track"><i style={{width:`${livePercent}%`}}/></div>
        <div className="gh-publish-monitor-current">
          <code title={liveFile}>{publishError || liveFile}</code>
          <em>{publishPhase==='upload' ? `${fmtBytes(Math.round((arquivo?.size||0)*(livePercent/100)))} / ${fmtBytes(arquivo?.size||0)}` : liveCounter}</em>
        </div>
      </div>

      {publishError && <div className="gh-publish-error-help"><b>{trackingLost ? 'A publicação pode continuar no backend.' : 'O que aconteceu'}</b><span>{publishError}</span>{publishErrorAction && <small>{publishErrorAction}</small>}</div>}

      <button type="button" className="gh-disclosure-button" onClick={()=>setEventsOpen(v=>!v)} aria-expanded={eventsOpen}>
        <span>Acontecimentos {publishLogs.length ? `(${publishLogs.length})` : ''}</span><b>{eventsOpen ? '⌃' : '⌄'}</b>
      </button>
      {eventsOpen && <div className="gh-disclosure-panel gh-events-panel">
        <div className="gh-events-actions"><DSBtn size="sm" variant="ghost" onClick={copiarLogPublicacao}>Copiar log</DSBtn></div>
        <div className="gh-live-log">
          {(publishLogsNewest.length ? publishLogsNewest : [{at:new Date().toISOString(),label:'Aguardando',message:'O backend ainda não enviou novos acontecimentos.',state:'active'}]).map((l,i)=>{ const visualState=statusVisual(l?.details?.operation || l?.state || l?.label); const detail=sanitizeLogText(l?.message || l?.details?.file || ''); return <div key={`${l.at}-${i}`} className={`gh-log-line ${l.state||''}`}><time>{new Date(l.at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><span>{l.state==='error'||l.state==='failed'?'×':l.state==='done'||l.state==='success'?'✓':'•'}</span><div><b>{visualState}</b><small>{detail}</small></div></div>})}
        </div>
      </div>}
    </section>}

    {passo === 8 && resultado && <section className="gh-publish-finish gh-publish-result gh-result-minimal">
      <div className="gh-result-hero"><div className="gh-wizard-success-icon">✓</div><div><h3>{resultUnchanged ? 'Projeto já estava atualizado' : 'Publicado com sucesso'}</h3><p>{resultUnchanged ? `${resultado.pacote?.arquivos || 0} arquivos conferidos · nenhum commit necessário.` : 'Commit confirmado na branch de destino.'}</p></div></div>

      <div className="gh-result-summary">
        <span><small>VERSÃO</small><b>{resultUnchanged ? (resultAfterVersion || '—') : `${resultBeforeVersion || '—'} → ${resultAfterVersion || '—'}`}</b></span>
        <span><small>COMMIT</small><b>{resultCommitLabel}</b></span>
        <span><small>ARQUIVOS</small><b>{resultado.pacote?.arquivos || 0}</b></span>
        <span><small>DESTINO</small><b>{resultado.destino?.branch || branch} · /{targetPath || ''}</b></span>
      </div>

      <button type="button" className="gh-disclosure-button" onClick={()=>setResultDetailsOpen(v=>!v)} aria-expanded={resultDetailsOpen}>
        <span>{resultDetailsOpen ? 'Ocultar detalhes da publicação' : 'Detalhes da publicação'}</span><b>{resultDetailsOpen ? '⌃' : '⌄'}</b>
      </button>
      {resultDetailsOpen && <div className="gh-disclosure-panel gh-result-details">
        <div className="al-wizard-info-grid gh-finish-grid">
          <WizardInfo label="Alterados" value={`${resultado.commit?.enviados || 0}`} help={`${resultado.commit?.inlineTree || 0} na árvore · ${resultado.commit?.blobsCriados || 0} blob(s)`} />
          <WizardInfo label="Inalterados" value={`${resultado.commit?.inalterados || 0}`} help="reutilizados sem novo upload" />
          <WizardInfo label="Removidos" value={`${resultado.commit?.removidos || 0}`} help={replacePath?'modo substituir':'nenhum pelo modo mesclar'} />
          <WizardInfo label="R2" value={resultado.snapshot ? 'Snapshot ✓' : 'Não usado'} />
          <WizardInfo label="Vercel" value={deployment?.vercel?.projects?.length ? `${deployment.vercel.projects.length} vínculo(s)` : 'Não vinculado'} />
          <WizardInfo label="Render" value={deployment?.render?.services?.length ? `${deployment.render.services.length} vínculo(s)` : 'Não vinculado'} />
        </div>
        <div className="gh-postcheck"><b>Checagem técnica</b>{(resultado.verificacao?.checks||[]).map(c=><span key={c.id} className={c.state}><i>{c.state==='ok'?'✓':c.state==='warn'?'!':'×'}</i><em>{c.label}</em><small>{c.detail}</small></span>)}<span className={resultado.verificacao?.ok?'ok':'error'}><i>{resultado.verificacao?.ok?'✓':'×'}</i><em>Commit publicado</em><small>{resultado.verificacao?.ok ? `Confirmado ${resultado.verificacao?.verificadoEm ? relTime(resultado.verificacao.verificadoEm) : ''}` : 'Não confirmado'}</small></span></div>
        <div className="gh-finish-actions"><DSBtn size="sm" variant="primary" onClick={onAbrirArquivos}>Ver arquivos no AL</DSBtn><DSBtn size="sm" variant="ghost" onClick={copiarResumoPublicacao}>Copiar resumo</DSBtn><DSBtn size="sm" variant="ghost" onClick={copiarLogPublicacao}>Copiar acontecimentos</DSBtn>{resultado.commit?.commitUrl && <a href={resultado.commit.commitUrl} target="_blank" rel="noopener noreferrer">Abrir commit ↗</a>}<a href={`https://github.com/${resultado.destino?.repository || repository}/tree/${encodeURIComponent(resultado.destino?.branch || branch)}`} target="_blank" rel="noopener noreferrer">GitHub ↗</a></div>
        <button type="button" className="gh-disclosure-button" onClick={()=>setEventsOpen(v=>!v)} aria-expanded={eventsOpen}><span>Acontecimentos · mais recentes primeiro</span><b>{eventsOpen ? '⌃' : '⌄'}</b></button>
        {eventsOpen && <div className="gh-live-log gh-result-events">{publishLogsNewest.map((l,i)=>{ const visualState=statusVisual(l?.details?.operation || l?.state || l?.label); return <div key={`final-${l.at}-${i}`} className={`gh-log-line ${l.state||''}`}><time>{new Date(l.at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time><span>{l.state==='error'||l.state==='failed'?'×':l.state==='done'||l.state==='success'?'✓':'•'}</span><div><b>{visualState}</b><small>{sanitizeLogText(l?.message || l?.details?.file || '')}</small></div></div>})}</div>}
        {resultado.snapshot?.objectKey && <div className="gh-cloud-note">Snapshot: <code>{resultado.snapshot.bucket}/{resultado.snapshot.objectKey}</code></div>}
        {deployment?.erro && <div className="gh-muted-box">GitHub concluído, mas a produção não pôde ser conferida: {deployment.erro}</div>}
        {deployment?.render?.services?.length > 0 && <div className="gh-wizard-deploys"><b>Render</b>{deployment.render.services.map(svc=><div className="gh-cloud-row" key={svc.id}><span><b>{svc.name || svc.id}</b><small>{svc.branch || branch}</small></span><DSBtn size="sm" onClick={()=>implantarRender(svc)} loading={!!deployingRender[svc.id]}>Implantar este commit</DSBtn></div>)}</div>}
      </div>}
    </section>}
  </AdminWizardModal>
}

function AbaDelete({ repo, repoNome, deleteStep, setDeleteStep, deleteInput, setDeleteInput, onConfirmar, deletandoRepo }) {
  return (
    <div style={{ background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: RADIUS.lg, padding: SPACE.xl2 }}>
      <div style={{ fontSize: FONT.lg - 1, fontWeight: 800, color: C.red, marginBottom: SPACE.md }}>⚠ Zona de Perigo — Excluir Repositório</div>
      <p style={{ fontSize: FONT.base, color: C.text, lineHeight: 1.6, marginBottom: SPACE.xl }}>
        Excluir <strong>{repo.nomeCompleto}</strong> é uma ação <strong>permanente e irreversível</strong>.
        O repositório será removido do GitHub e todos os dados serão perdidos.
      </p>

      {deleteStep === 0 && (
        <DSBtn variant="danger" onClick={() => setDeleteStep(1)}>🗑 Quero excluir este repositório</DSBtn>
      )}

      {deleteStep === 1 && (
        <div style={{ background: `${C.red}18`, borderRadius: RADIUS.md, padding: SPACE.xl }}>
          <p style={{ fontSize: FONT.base, color: C.red, fontWeight: 700, marginBottom: SPACE.lg }}>Confirmação 1 de 2 — Você tem certeza absoluta?</p>
          <p style={{ fontSize: FONT.sm, color: C.text, marginBottom: SPACE.lg }}>
            Esta ação vai excluir permanentemente{' '}
            <code style={{ background: C.surface, padding: `1px ${SPACE.xs}px`, borderRadius: RADIUS.xs }}>{repo.nomeCompleto}</code>{' '}
            incluindo todos os branches, commits, releases e wikis.
          </p>
          <div style={{ display: 'flex', gap: SPACE.md }}>
            <DSBtn onClick={() => setDeleteStep(0)}>Cancelar</DSBtn>
            <DSBtn variant="danger" onClick={() => setDeleteStep(2)}>Sim, quero excluir</DSBtn>
          </div>
        </div>
      )}

      {deleteStep === 2 && (
        <div style={{ background: `${C.red}18`, borderRadius: RADIUS.md, padding: SPACE.xl }}>
          <p style={{ fontSize: FONT.base, color: C.red, fontWeight: 700, marginBottom: SPACE.lg }}>Confirmação 2 de 2 — Digite o nome do repositório para confirmar</p>
          <p style={{ fontSize: FONT.sm, color: C.muted, marginBottom: SPACE.md }}>
            Digite{' '}
            <code style={{ background: C.surface, padding: `1px ${SPACE.xs}px`, borderRadius: RADIUS.xs, color: C.red }}>{repoNome}</code>{' '}
            para confirmar:
          </p>
          <input value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder={repoNome}
            style={{ ...inp({ border: `2px solid ${C.redBorder}` }), marginBottom: SPACE.lg }} />
          <div style={{ display: 'flex', gap: SPACE.md }}>
            <DSBtn onClick={() => { setDeleteStep(0); setDeleteInput('') }}>Cancelar</DSBtn>
            <DSBtn variant="danger" disabled={deleteInput !== repoNome || deletandoRepo} loading={deletandoRepo} onClick={onConfirmar}>
              🗑 Excluir definitivamente
            </DSBtn>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── ABA: Secrets ────────────────────────────────────────── */
function AbaSecrets({ secrets, owner, repo, onRefresh, toastShow }) {
  const [novoNome, setNovoNome]   = useState('')
  const [novoValor, setNovoValor] = useState('')
  const [salvando, setSalvando]   = useState(false)
  const [excluindo, setExcluindo] = useState(null)
  const [showForm, setShowForm]   = useState(false)

  async function salvarSecret() {
    if (!novoNome.trim()) return toastShow('Nome do secret obrigatório', 'erro')
    if (!novoValor.trim()) return toastShow('Valor obrigatório', 'erro')
    setSalvando(true)
    try {
      await githubService.criarSecret(owner, repo, novoNome.toUpperCase().trim(), novoValor)
      toastShow(`Secret "${novoNome.toUpperCase()}" salvo!`)
      setNovoNome(''); setNovoValor(''); setShowForm(false); onRefresh()
    } catch (e) { toastShow('Erro: ' + e.message, 'erro') }
    finally     { setSalvando(false) }
  }

  async function excluirSecret(nome) {
    setExcluindo(nome)
    try {
      await githubService.excluirSecret(owner, repo, nome)
      toastShow(`Secret "${nome}" removido.`); onRefresh()
    } catch (e) { toastShow('Erro: ' + e.message, 'erro') }
    finally     { setExcluindo(null) }
  }

  if (!secrets) return <div style={{ fontSize: FONT.base, color: C.muted }}>Carregando...</div>

  return (
    <div>
      <DSSectionTitle
        style={{ marginBottom: SPACE.lg }}
        actions={<DSBtn variant="primary" size="sm" onClick={() => setShowForm(v => !v)}>{showForm ? '✕ Cancelar' : '+ Novo Secret'}</DSBtn>}
      >
        Secrets do Actions ({secrets.length})
      </DSSectionTitle>

      <div className="gh-secrets-security">
        <span>🔒</span><div><b>Valores protegidos</b><small>O GitHub nunca expõe os valores. O painel lista apenas nomes e datas; novos valores são criptografados antes do envio.</small></div>
      </div>

      {showForm && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SPACE.xl, marginBottom: SPACE.xl }}>
          <div style={{ fontSize: FONT.base, fontWeight: 700, color: C.text, marginBottom: SPACE.lg }}>Novo Secret de Actions</div>
          <div style={{ display: 'grid', gap: SPACE.md + 2 }}>
            <div>
              <div style={{ fontSize: FONT.sm, color: C.muted, marginBottom: SPACE.xs }}>Nome (MAIÚSCULAS, ex: API_KEY)</div>
              <input value={novoNome} onChange={e => setNovoNome(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} placeholder="NOME_DO_SECRET" style={inp()} />
            </div>
            <div>
              <div style={{ fontSize: FONT.sm, color: C.muted, marginBottom: SPACE.xs }}>Valor (será criptografado)</div>
              <input type="password" value={novoValor} onChange={e => setNovoValor(e.target.value)} placeholder="valor-secreto" style={inp()} />
            </div>
            <DSBtn variant="primary" loading={salvando} onClick={salvarSecret}>🔐 Salvar Secret</DSBtn>
          </div>
        </div>
      )}

      {secrets.length === 0 ? (
        <div style={{ fontSize: FONT.base, color: C.muted }}>Nenhum secret configurado neste repositório.</div>
      ) : (
        <div className="gh-secrets-list">
          {secrets.map(s => (
            <div key={s.nome} className="gh-secret-row">
              <div>
                <div style={{ fontSize: FONT.base, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>🔑 {s.nome}</div>
                <div style={{ fontSize: FONT.xs, color: C.muted, marginTop: 2 }}>
                  atualizado {s.atualizadoEm ? relTime(s.atualizadoEm) : '—'}
                  {s.criadoEm && <span> · criado {relTime(s.criadoEm)}</span>}
                </div>
              </div>
              <DSBtn variant="danger" size="sm" loading={excluindo === s.nome} onClick={() => excluirSecret(s.nome)}>🗑</DSBtn>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Logs estruturados do GitHub Actions ─────────────────────────────── */
function parseWorkflowLog(text='') {
  const rawLines = String(text || '').split(/\r?\n/)
  const lines = rawLines.map((raw, index) => {
    const tm = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s?(.*)$/)
    const timestamp = tm?.[1] || ''
    const body = tm ? tm[2] : raw
    const compactTime = timestamp ? timestamp.slice(11,19) : ''
    let kind = 'info'
    if (/##\[error\]|npm ERR!|BUILD FAILED|(?:^|\s)(?:ERROR|Error|Exception|Failure|Failed)(?:\s|:|$)|Process completed with exit code\s*[1-9]|Gradle.*fail/i.test(body)) kind = 'error'
    else if (/##\[warning\]|(?:^|\s)(?:WARN|Warning)(?:\s|:|$)/i.test(body)) kind = 'warning'
    else if (/##\[group\]/i.test(body)) kind = 'group-start'
    else if (/##\[endgroup\]/i.test(body)) kind = 'group-end'
    else if (/success|succeeded|passed|completed successfully|✓/i.test(body)) kind = 'success'
    return { index, raw, body, timestamp, compactTime, kind }
  })

  const sections = []
  let current = { id:'root', title:'Execução', start:0, end:Math.max(0,lines.length-1), lines:[] }
  const pushCurrent = () => { if (current.lines.length) sections.push(current) }
  for (const line of lines) {
    const group = line.body.match(/##\[group\](.*)$/i)
    if (group) {
      pushCurrent()
      current = { id:`group-${line.index}`, title:(group[1] || 'Etapa').trim(), start:line.index, end:line.index, lines:[line] }
      continue
    }
    current.lines.push(line); current.end = line.index
    if (/##\[endgroup\]/i.test(line.body)) {
      pushCurrent()
      current = { id:`after-${line.index}`, title:'Continuação', start:line.index+1, end:line.index+1, lines:[] }
    }
  }
  pushCurrent()

  const errors = []
  const errorIndexes = lines.filter(l => l.kind === 'error').map(l => l.index)
  for (const idx of errorIndexes) {
    if (errors.some(e => Math.abs(e.index - idx) <= 2)) continue
    const before = Math.max(0, idx - 4), after = Math.min(lines.length - 1, idx + 5)
    const section = sections.find(s => idx >= s.start && idx <= s.end)
    errors.push({ index:idx, line:lines[idx], section:section?.title || 'Execução', context:lines.slice(before, after + 1), before, after })
  }
  return { lines, sections, errors }
}

function logKindMeta(kind) {
  if (kind === 'error') return { icon:'✕', label:'Erro', cls:'error' }
  if (kind === 'warning') return { icon:'!', label:'Aviso', cls:'warning' }
  if (kind === 'success') return { icon:'✓', label:'Sucesso', cls:'success' }
  if (kind === 'group-start') return { icon:'▶', label:'Início de etapa', cls:'group' }
  if (kind === 'group-end') return { icon:'■', label:'Fim de etapa', cls:'group' }
  return { icon:'•', label:'Informação', cls:'info' }
}

function buildErrorCopy(parsed, job) {
  const err = parsed?.errors?.[0]
  if (!err) return `Etapa: ${job?.nome || 'Workflow'}\nNenhum erro destacado automaticamente. Consulte o log completo.`
  const exit = parsed.lines.find(l => /Process completed with exit code/i.test(l.body))
  return sanitizeLogText([
    'Erro do GitHub Actions',
    `Job: ${job?.nome || '—'}`,
    `Etapa: ${err.section}`,
    exit ? exit.body : '',
    '',
    ...err.context.map(l => l.raw),
  ].filter(Boolean).join('\n'))
}

function WorkflowLogModal({ open, onClose, run, job, text, loading, toastShow }) {
  const [view, setView] = useState('erros')
  const [order, setOrder] = useState('desc')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(500)
  const [openSections, setOpenSections] = useState({})
  const parsed = parseWorkflowLog(text || '')

  useEffect(() => {
    if (!open) return
    setView(parsed.errors.length ? 'erros' : 'etapas')
    setOrder('desc'); setQuery(''); setVisible(500)
    const errorSection = parsed.sections.find(s => s.lines.some(l => l.kind === 'error'))
    setOpenSections(errorSection ? { [errorSection.id]:true } : {})
  }, [open, job?.id, text])

  const copy = async (value, message) => {
    try { await navigator.clipboard.writeText(sanitizeLogText(value || '')); toastShow?.(message || 'Copiado.', 'ok') }
    catch { toastShow?.('Não foi possível copiar.', 'erro') }
  }
  const q = query.trim().toLowerCase()
  const filtered = q ? parsed.lines.filter(l => l.raw.toLowerCase().includes(q)) : parsed.lines
  const ordered = order === 'desc' ? [...filtered].reverse() : filtered
  const shown = ordered.slice(0, visible)
  const matches = q ? filtered.length : 0
  const duration = job?.fimEm && job?.inicioEm ? fmtDuracao(new Date(job.fimEm)-new Date(job.inicioEm)) : (run?.duracaoMs ? fmtDuracao(run.duracaoMs) : '—')

  return <DSModal open={open} onClose={onClose} title="Log da execução" size="xl">
    <div className="gh-log-modal">
      <div className="gh-log-modal__head">
        <div><b>{job?.nome || run?.mensagem || run?.nome || 'Execução'}</b><small><RunBadge status={job?.status || run?.status} conclusao={job?.conclusao || run?.conclusao} /> · {duration}</small></div>
        <div className="gh-log-order">
          <button className={order==='desc'?'active':''} onClick={()=>setOrder('desc')}>Mais recentes primeiro</button>
          <button className={order==='asc'?'active':''} onClick={()=>setOrder('asc')}>Mais antigos primeiro</button>
        </div>
      </div>

      <div className="gh-log-tabs">
        <button className={view==='erros'?'active':''} onClick={()=>setView('erros')}>Erros {parsed.errors.length ? `(${parsed.errors.length})` : ''}</button>
        <button className={view==='etapas'?'active':''} onClick={()=>setView('etapas')}>Etapas ({parsed.sections.length})</button>
        <button className={view==='completo'?'active':''} onClick={()=>setView('completo')}>Log completo</button>
      </div>

      <div className="gh-log-search">
        <span>⌕</span><input value={query} onChange={e=>{setQuery(e.target.value);setVisible(500)}} placeholder="Buscar no log: error, gradle, npm, apk…" />
        {q && <small>{matches} {matches===1?'resultado':'resultados'}</small>}
      </div>

      {loading ? <div className="gh-log-empty">Carregando log…</div> : !text ? <div className="gh-log-empty">Log vazio.</div> : view === 'erros' ? (
        <div className="gh-log-errors">
          {parsed.errors.length === 0 ? <div className="gh-log-empty">Nenhuma linha de erro foi identificada automaticamente. Consulte Etapas ou Log completo.</div> : parsed.errors.map((err, i)=><div key={`${err.index}-${i}`} className="gh-error-card">
            <div className="gh-error-card__title"><span>✕</span><div><b>{i===0?'Erro principal':'Erro detectado'}</b><small>Etapa: {err.section}</small></div></div>
            <div className="gh-error-context">{err.context.map(l=>{const m=logKindMeta(l.kind);return <div key={l.index} className={`gh-log-line2 ${m.cls} ${l.index===err.index?'focus':''}`}><time>{l.compactTime||'--:--:--'}</time><span>{m.icon}</span><code>{l.body || ' '}</code></div>})}</div>
            <div className="gh-log-copy-actions"><DSBtn size="sm" variant="primary" onClick={()=>copy(buildErrorCopy({ ...parsed, errors:[err] },job),'Erro copiado.')}>Copiar erro</DSBtn><DSBtn size="sm" variant="ghost" onClick={()=>{setView('completo');setQuery(err.line.body.slice(0,80))}}>Ver no log completo</DSBtn></div>
          </div>)}
        </div>
      ) : view === 'etapas' ? (
        <div className="gh-log-sections">{parsed.sections.map(section=>{
          const hasError=section.lines.some(l=>l.kind==='error'), isOpen=!!openSections[section.id]
          return <div key={section.id} className={`gh-log-section ${hasError?'has-error':''}`}>
            <button className="gh-log-section__bar" onClick={()=>setOpenSections(v=>({...v,[section.id]:!v[section.id]}))}><span>{isOpen?'▼':'▶'} {section.title}</span><small>{section.lines.length} linhas{hasError?' · erro':''}</small></button>
            {isOpen && <div className="gh-log-section__body">{(order==='desc'?[...section.lines].reverse():section.lines).slice(0,500).map(l=>{const m=logKindMeta(l.kind);return <div key={l.index} className={`gh-log-line2 ${m.cls}`}><time>{l.compactTime||'--:--:--'}</time><span>{m.icon}</span><code>{l.body || ' '}</code></div>})}<div className="gh-log-copy-actions"><DSBtn size="sm" variant="ghost" onClick={()=>copy(section.lines.map(l=>l.raw).join('\n'),'Etapa copiada.')}>Copiar etapa</DSBtn></div></div>}
          </div>
        })}</div>
      ) : (
        <div className="gh-log-full">
          <div className="gh-log-window-note">Mostrando {shown.length} de {ordered.length} linhas {order==='desc'?'mais recentes':'mais antigas'}.</div>
          {shown.map(l=>{const m=logKindMeta(l.kind);return <div key={l.index} className={`gh-log-line2 ${m.cls}`} title={l.timestamp || undefined}><time>{l.compactTime||'--:--:--'}</time><span>{m.icon}</span><code>{l.body || ' '}</code></div>})}
          {visible < ordered.length && <button className="gh-log-load" onClick={()=>setVisible(v=>v+500)}>Carregar mais 500 linhas</button>}
        </div>
      )}

      <div className="gh-log-footer-actions">
        <DSBtn size="sm" variant="primary" onClick={()=>copy(buildErrorCopy(parsed,job),'Erro copiado.')} disabled={!parsed.errors.length}>Copiar erro</DSBtn>
        <DSBtn size="sm" variant="ghost" onClick={()=>copy(text,'Log completo copiado.')}>Copiar log completo</DSBtn>
      </div>
    </div>
  </DSModal>
}

/* ── ABA: Workflows ──────────────────────────────────────── */
function AbaWorkflows({ workflows, owner, repo, toastShow }) {
  const [wfSel, setWfSel]       = useState(null)
  const [runs, setRuns]         = useState(null)
  const [loadRuns, setLoadRuns] = useState(false)
  const [runAberto, setRunAberto] = useState(null)
  const [jobs, setJobs]         = useState(null)
  const [loadJobs, setLoadJobs] = useState(false)
  const [logModal, setLogModal] = useState(null)
  const [logTexto, setLogTexto] = useState('')
  const [loadLog, setLoadLog]   = useState(false)
  const [artifactsCache, setArtifactsCache] = useState(null)
  const [analiseModal, setAnaliseModal] = useState(null)
  const [analiseLoad, setAnaliseLoad] = useState(false)
  const [analiseDados, setAnaliseDados] = useState(null)
  const [analiseCancelando, setAnaliseCancelando] = useState(false)

  async function selecionarWorkflow(wf) {
    setWfSel(wf); setRuns(null); setRunAberto(null); setJobs(null); setArtifactsCache(null); setLogModal(null)
    setLoadRuns(true)
    try { const d = await githubService.runs(owner, repo, wf.id); setRuns(d.runs || []) }
    catch (e) { toastShow('Erro ao carregar execuções: ' + e.message, 'erro') }
    finally   { setLoadRuns(false) }
  }

  async function carregarLog(run, job) {
    if (!job?.id) return
    setLogModal({ run, job }); setLoadLog(true); setLogTexto('')
    try { setLogTexto(await githubService.jobLogs(job.id, owner, repo)) }
    catch (e) { setLogTexto(`##[error]Erro ao carregar log: ${e.message}`) }
    finally { setLoadLog(false) }
  }

  async function abrirRun(run, options = {}) {
    const { openFirstLog = false } = options
    setRunAberto(run); setJobs(null)
    if (!run?.id) return
    setLoadJobs(true)
    const [jobsP, artsP] = [githubService.jobs(run.id, owner, repo), artifactsCache === null ? githubService.artifacts(owner, repo) : Promise.resolve(null)]
    try {
      const d = await jobsP
      const list = d.jobs || []
      setJobs(list)
      if (openFirstLog && list.length > 0) {
        const preferido = list.find(j => ['failure','failed'].includes(j.conclusao) || ['failure','failed'].includes(j.status)) || list[0]
        await carregarLog(run, preferido)
      }
    } catch (e) { toastShow('Erro ao carregar jobs: ' + e.message, 'erro') }
    finally { setLoadJobs(false) }
    if (artifactsCache === null) artsP.then(d => setArtifactsCache(d?.artifacts || [])).catch(() => setArtifactsCache([]))
  }

  function fecharRun(){ setRunAberto(null);setJobs(null) }
  async function analisarRun(run) {
    setAnaliseModal({ run, modo:'resumo', titulo:'Resumo da execução' }); setAnaliseDados(null); setAnaliseLoad(true)
    try { setAnaliseDados(await githubService.analyzeRun(run.id, owner, repo, 'resumo', wfSel?.nome || '', job=>setAnaliseDados({job:true,id:job.id,progress:job.progress||0,message:job.message||'Processando',status:job.status}))) }
    catch(e){ setAnaliseDados({erro:e.code==='AI_JOB_CANCELLED'?'Resumo cancelado.':(e.message||'Falha ao gerar o resumo da execução.')}) }
    finally { setAnaliseLoad(false);setAnaliseCancelando(false) }
  }
  async function cancelarAnalise(){ const id=analiseDados?.id;if(!id||analiseCancelando)return;setAnaliseCancelando(true);try{await githubService.cancelAiJob(id);setAnaliseDados(d=>({...d,job:true,status:'cancelled',message:'Cancelando resumo…'}))}catch(e){toastShow('Não foi possível cancelar: '+e.message,'erro');setAnaliseCancelando(false)} }

  if (!workflows) return <div style={{fontSize:FONT.base,color:C.muted}}>Carregando...</div>
  if (!workflows.length) return <div style={{fontSize:FONT.base,color:C.muted}}>Nenhum workflow encontrado. Crie arquivos <code>.github/workflows/*.yml</code> no repositório.</div>

  return <div>
    <DSSectionTitle style={{marginBottom:SPACE.lg}}>Workflows ({workflows.length})</DSSectionTitle>
    <div style={{display:'grid',gap:SPACE.sm,marginBottom:SPACE.xl3}}>{workflows.map(wf=>{const ativo=wf.estado==='active';return <button key={wf.id} onClick={()=>selecionarWorkflow(wf)} style={{background:wfSel?.id===wf.id?`${C.accent}18`:C.surface,border:`1px solid ${wfSel?.id===wf.id?C.accent:C.border}`,borderRadius:RADIUS.md,padding:`${SPACE.md+2}px 14px`,cursor:'pointer',textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}><div><div style={{fontSize:FONT.base,fontWeight:700,color:C.text}}>⚙ {wf.nome}</div><div style={{fontSize:FONT.xs,color:C.muted,marginTop:2}}>{wf.arquivo}</div></div><DSBadge variant={ativo?'green':'amber'}>{runStatusLabel(wf.estado)}</DSBadge></button>})}</div>

    {wfSel && <><DSSectionTitle style={{marginBottom:SPACE.lg}}>Execuções — {wfSel.nome}</DSSectionTitle>
      {loadRuns?<div style={{fontSize:FONT.base,color:C.muted}}>Carregando execuções...</div>:runs?.length===0?<div style={{fontSize:FONT.base,color:C.muted}}>Nenhuma execução encontrada.</div>:runs?<div className="gh-run-list">{runs.map(run=>{const cor=STATUS_RUN_COR[run.conclusao||run.status]||C.muted,isAberto=runAberto?.id===run.id;return <div key={run.id}>
        <div className="gh-run-card gh-run-card--compact" style={{background:C.surface,border:`1px solid ${isAberto?cor:C.border}`}}>
          <div className="gh-run-main"><div className="gh-run-title"><RunBadge status={run.status} conclusao={run.conclusao}/><span>{run.mensagem||run.nome}</span></div><div className="gh-run-meta"><span>{run.branch}</span>{run.sha&&<span>#{run.sha}</span>}<span>{relTime(run.criadoEm)}</span>{run.duracaoMs>0&&<span>{fmtDuracao(run.duracaoMs)}</span>}</div></div>
          <div className="gh-run-actions gh-run-actions--tabs"><DSBtn size="sm" variant="primary" onClick={()=>analisarRun(run)}>Resumo</DSBtn><DSBtn size="sm" onClick={()=>isAberto?fecharRun():abrirRun(run)}>{isAberto?'Fechar Jobs':'Jobs'}</DSBtn><DSBtn size="sm" onClick={()=>abrirRun(run,{openFirstLog:true})}>Log</DSBtn></div>
        </div>
        {isAberto&&<div className="gh-jobs-list">{loadJobs?<div className="gh-log-empty">Carregando jobs...</div>:jobs?.map(job=>{const dur=job.fimEm&&job.inicioEm?fmtDuracao(new Date(job.fimEm)-new Date(job.inicioEm)):'—';const falha=(job.steps||[]).find(st=>['failure','failed'].includes(st.conclusao||st.status));return <div className="gh-job-row" key={job.id}><div className="gh-job-row__main"><RunBadge status={job.status} conclusao={job.conclusao}/><b>{job.nome}</b><span>· {dur}</span><small>{plural((job.steps||[]).length,'etapa')}{falha?` · falhou em ${falha.nome}`:''}</small></div><div className="gh-job-row__actions"><DSBtn size="sm" variant="ghost" onClick={()=>carregarLog(run,job)}>Log</DSBtn></div></div>})}
          {artifactsCache!==null&&(()=>{const arts=artifactsCache.filter(a=>a.workflowRunId===run.id&&!a.expirado);if(!arts.length)return null;return <div className="gh-run-artifacts"><div><b>Artefatos desta execução</b><DSBtn size="sm" variant="ghost" onClick={()=>githubService.baixarLogs(run.id,owner,repo).then(()=>toastShow?.('Download dos logs iniciado.','ok')).catch(e=>toastShow?.(e.message||'Falha ao baixar logs.','erro'))}>Baixar ZIP de logs</DSBtn></div><div>{arts.map(a=>{const isApk=ehArtefatoApk(a);return <button key={a.id} type="button" onClick={()=>githubService.baixarArtifact(a.id,owner,repo,a.nome,{preferApk:isApk}).then(r=>toastShow?.(`${isApk?'APK':'Download'} iniciado${r?.filename?`: ${r.filename}`:'.'}`,'ok')).catch(e=>toastShow?.(e.message||'Falha ao baixar artefato.','erro'))} title={`${fmtBytes(a.tamanho)} · criado ${relTime(a.criadoEm)}`}>{isApk?'📱':'📦'} {isApk?'Baixar APK':a.nome}</button>})}</div></div>})()}
        </div>}
      </div>})}</div>:null}</>}

    <WorkflowLogModal open={!!logModal} onClose={()=>setLogModal(null)} run={logModal?.run} job={logModal?.job} text={logTexto} loading={loadLog} toastShow={toastShow}/>

    <DSModal open={!!analiseModal} onClose={()=>setAnaliseModal(null)} title={analiseModal?.titulo||'Execução'} size="lg">
      {analiseLoad?<div style={{color:C.muted,fontSize:FONT.base,padding:`${SPACE.xl}px 0`,display:'grid',gap:10}}><span>{analiseDados?.job?analiseDados.message:'Montando resumo da execução...'}</span>{analiseDados?.job&&<div style={{height:8,borderRadius:999,background:C.surf2,overflow:'hidden'}}><div style={{height:'100%',width:`${analiseDados.progress||0}%`,background:C.accent,transition:'width .25s'}}/></div>}{analiseDados?.job&&<small>{analiseDados.progress||0}% · você pode fechar este popup; o resultado fica persistido no backend.</small>}{analiseDados?.job&&analiseDados?.id&&<div><DSBtn size="sm" variant="danger" onClick={cancelarAnalise} disabled={analiseCancelando}>{analiseCancelando?'Cancelando…':'Cancelar resumo'}</DSBtn></div>}</div>:analiseDados?.erro?<div style={{color:C.red,fontSize:FONT.base}}>{analiseDados.erro}</div>:analiseDados?<AnaliseWorkflowConteudo dados={analiseDados} modo={analiseModal?.modo} onCopy={async()=>{try{await navigator.clipboard.writeText(buildResumoTexto(analiseDados,analiseModal?.modo));toastShow('Resumo copiado.')}catch{toastShow('Não foi possível copiar o resumo.','erro')}}}/>:null}
    </DSModal>
  </div>
}


function buildResumoTexto(dados, modo = 'resumo') {
  const r = dados?.resumo || {}
  const a = dados?.analise || {}
  const lines = []
  lines.push('Resumo da execução')
  lines.push('')
  lines.push(`Jobs: ${r.totalJobs ?? 0}`)
  lines.push(`Etapas OK: ${r.etapasConcluidas ?? 0}`)
  lines.push(`Falhas: ${r.etapasFalhas ?? 0}`)
  lines.push(`Ignoradas: ${r.etapasIgnoradas ?? 0}`)
  if (Array.isArray(r.falhas) && r.falhas.length) {
    lines.push('')
    lines.push('Etapas que falharam:')
    r.falhas.forEach(f => lines.push(`- ${f.job}${f.etapa ? ` → ${f.etapa}` : ''}`))
  }
  if (modo !== 'resumo') {
    if (a.erro_principal) { lines.push(''); lines.push('Erro principal: ' + a.erro_principal) }
    if (a.causa_provavel) { lines.push('Causa provável: ' + a.causa_provavel) }
  }
  return lines.join('\n')
}

function AnaliseWorkflowConteudo({ dados, modo, onCopy }) {
  const r = dados?.resumo || {}
  const a = dados?.analise || {}
  const lista = (titulo, itens) => Array.isArray(itens) && itens.filter(Boolean).length ? (
    <div style={{ marginTop: SPACE.lg }}>
      <div style={{ fontSize: FONT.sm, fontWeight: 800, color: C.text, marginBottom: SPACE.xs }}>{titulo}</div>
      <div style={{ display: 'grid', gap: SPACE.xs }}>
        {itens.filter(Boolean).map((x,i) => <div key={i} style={{ fontSize: FONT.sm, color: C.muted, lineHeight: 1.5 }}>• {typeof x === 'string' ? x : x.descricao || x.titulo || JSON.stringify(x)}</div>)}
      </div>
    </div>
  ) : null
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:SPACE.sm, flexWrap:'wrap', marginBottom:SPACE.lg }}>
        <div style={{ fontSize:FONT.sm, color:C.muted }}>Resumo pronto para copiar e compartilhar.</div>
        <DSBtn size="sm" onClick={onCopy}>Copiar resumo</DSBtn>
      </div>
      <div className="gh-log-summary-grid" style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:SPACE.sm }}>
        {[['Jobs',r.totalJobs],['Etapas OK',r.etapasConcluidas],['Falhas',r.etapasFalhas],['Ignoradas',r.etapasIgnoradas]].map(([label,value]) => (
          <div key={label} style={{ background:C.surf2, border:`1px solid ${C.border}`, borderRadius:RADIUS.md, padding:SPACE.md, minWidth:0 }}>
            <div style={{ fontSize:FONT.xs, color:C.muted }}>{label}</div><div style={{ fontSize:FONT.xl, fontWeight:800, color:C.text }}>{value ?? 0}</div>
          </div>
        ))}
      </div>
      {r.falhas?.length > 0 && lista('Etapas que falharam', r.falhas.map(f => `${f.job}${f.etapa ? ` → ${f.etapa}` : ''}`))}
      {modo !== 'resumo' && (
        <>
          {a.erro_principal && <div style={{ marginTop:SPACE.xl, padding:SPACE.lg, border:`1px solid ${C.red}55`, borderRadius:RADIUS.md, background:`${C.red}0d` }}><div style={{fontSize:FONT.xs,fontWeight:800,color:C.muted,textTransform:'uppercase'}}>Erro principal</div><div style={{fontSize:FONT.base,fontWeight:800,color:C.text,marginTop:4}}>{a.erro_principal}</div>{a.etapa && <div style={{fontSize:FONT.sm,color:C.muted,marginTop:4}}>Etapa: {a.etapa}</div>}</div>}
          {a.causa_provavel && <div style={{ marginTop:SPACE.lg }}><div style={{fontSize:FONT.sm,fontWeight:800,color:C.text}}>Causa provável</div><div style={{fontSize:FONT.sm,color:C.muted,lineHeight:1.6,marginTop:4}}>{a.causa_provavel}</div></div>}
          {lista('Evidências encontradas', a.evidencias)}
          {lista('O que funcionou', a.o_que_funcionou)}
          {lista('Avisos adicionais', a.avisos)}
          {lista('Próximos passos', a.proximos_passos)}
          {Array.isArray(a.correcoes) && a.correcoes.length > 0 && <div style={{marginTop:SPACE.lg}}><div style={{fontSize:FONT.sm,fontWeight:800,color:C.text,marginBottom:SPACE.sm}}>Correções sugeridas</div><div style={{display:'grid',gap:SPACE.sm}}>{a.correcoes.map((c,i)=><div key={i} style={{border:`1px solid ${C.border}`,borderRadius:RADIUS.md,padding:SPACE.md,background:C.surf2}}><div style={{fontSize:FONT.sm,fontWeight:800,color:C.text}}>{c.titulo || `Correção ${i+1}`}</div><div style={{fontSize:FONT.sm,color:C.muted,lineHeight:1.5,marginTop:4}}>{c.descricao}</div>{c.arquivos_provaveis?.length>0&&<div style={{fontSize:FONT.xs,color:C.muted,marginTop:6}}>Arquivos prováveis: {c.arquivos_provaveis.join(', ')}</div>}{c.risco&&<div style={{fontSize:FONT.xs,color:C.muted,marginTop:3}}>Risco: {c.risco}</div>}</div>)}</div></div>}
          {lista('Como validar depois', a.validacao)}
          {a._meta && <div style={{fontSize:FONT.xs,color:C.muted,marginTop:SPACE.xl}}>IA: {a._meta.provedor} · {a._meta.modelo}{a._meta.fallback ? ' · fallback automático' : ''}</div>}
        </>
      )}
      <div style={{fontSize:FONT.xs,color:C.muted,marginTop:SPACE.xl,lineHeight:1.5}}>O ZIP de logs continua disponível. O resumo lê os logs no backend, destaca o que importa e não altera arquivos nem workflows automaticamente.</div>
    </div>
  )
}

/* ── Card de repo (lista principal) ─────────────────────── */
function RepoCard({ repo, meta, insight, onAbrir, toastShow }) {
  const detected = insight || repo.insight || null
  const statusCfg = STATUS_CFG[meta?.statusInterno]
  const acesso = repo.permissoes?.admin || repo.permissoes?.maintain || repo.permissoes?.push ? 'Leitura e escrita' : 'Somente leitura'
  const resumo = repo.descricao?.trim() || detected?.resumo || `${repo.linguagem ? `Projeto ${repo.linguagem}` : 'Repositório'} no GitHub · branch principal ${repo.branch || '—'}`
  const visibilidade = repo.privado ? 'Privado' : 'Público'
  const cardRef = useRef(null)
  const [latestApk, setLatestApk] = useState(undefined)
  const [apkDownloadState, setApkDownloadState] = useState('idle')
  const [apkProgress, setApkProgress] = useState(0)

  useEffect(() => {
    const [owner, nome] = String(repo.nomeCompleto || '').split('/')
    if (!owner || !nome) { setLatestApk(null); return undefined }
    let cancelled = false
    let started = false
    let observer = null
    const load = () => {
      if (started) return
      started = true
      githubService.latestApk(owner, nome)
        .then(data => { if (!cancelled) setLatestApk(data?.apk || null) })
        .catch(() => { if (!cancelled) setLatestApk(null) })
    }
    const node = cardRef.current
    if (node && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { load(); observer?.disconnect() }
      }, { rootMargin: '280px 0px' })
      observer.observe(node)
    } else load()
    return () => { cancelled = true; observer?.disconnect() }
  }, [repo.id, repo.nomeCompleto])

  async function baixarApkRapido(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!latestApk || ['connecting', 'downloading'].includes(apkDownloadState)) return
    const [owner, nome] = String(repo.nomeCompleto || '').split('/')
    try {
      setApkProgress(0)
      setApkDownloadState('connecting')
      const download = await (latestApk.source === 'release'
        ? githubService.baixarReleaseApk(latestApk.id, owner, nome, latestApk.nome, {
            onStatus: (status, info) => {
              if (status === 'connecting') setApkDownloadState('connecting')
              if (status === 'queued') setApkDownloadState('downloading')
              if (status === 'progress') { setApkProgress(info?.progress || 0); setApkDownloadState('downloading') }
              if (status === 'downloading') setApkDownloadState('downloading')
              if (status === 'completed') { setApkProgress(100); setApkDownloadState('completed') }
              if (status === 'started') setApkDownloadState('started')
            },
          })
        : githubService.baixarArtifact(latestApk.id, owner, nome, latestApk.nome, {
            preferApk: true,
            onStatus: (status, info) => {
              if (status === 'connecting') setApkDownloadState('connecting')
              if (status === 'queued') setApkDownloadState('downloading')
              if (status === 'progress') { setApkProgress(info?.progress || 0); setApkDownloadState('downloading') }
              if (status === 'downloading') setApkDownloadState('downloading')
              if (status === 'completed') { setApkProgress(100); setApkDownloadState('completed') }
              if (status === 'started') setApkDownloadState('started')
            },
          }))
      setApkDownloadState(download.mode?.startsWith('android') ? 'completed' : 'started')
      if (download.mode?.startsWith('android')) setApkProgress(100)
      setTimeout(() => setApkDownloadState(prev => ['started','completed'].includes(prev) ? 'idle' : prev), 6000)
    } catch (err) {
      setApkDownloadState('error')
      toastShow?.(err.message || 'Falha ao baixar APK.', 'erro')
    }
  }

  const apkLabel = apkDownloadState === 'connecting' ? 'Conectando…'
    : apkDownloadState === 'downloading' ? `Baixando ${apkProgress}%`
    : apkDownloadState === 'completed' ? 'Baixado ✓'
    : apkDownloadState === 'started' ? 'Iniciado ✓'
    : apkDownloadState === 'error' ? 'Tentar APK'
    : 'Baixar APK'

  return (
    <article ref={cardRef} className="gh-repo-card" onClick={() => onAbrir(repo)}>
      <div className="gh-card-topline" />
      <div style={{ display:'flex', justifyContent:'space-between', gap:SPACE.md, alignItems:'flex-start' }}>
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:SPACE.sm, flexWrap:'wrap' }}>
            {meta?.favorito && <span title="Favorito" style={{ fontSize:14 }}>★</span>}
            <h2 style={{ margin:0, fontSize:FONT.xl, lineHeight:1.15, color:C.text, letterSpacing:'-.02em' }}>{detected?.produto || repo.nome}</h2>
            <DSBadge variant={repo.privado ? 'amber' : 'green'}>{visibilidade}</DSBadge>
            {detected?.versao && <DSBadge variant="blue">v{detected.versao}</DSBadge>}
            {repo.fork && <DSBadge variant="blue">fork</DSBadge>}
            {repo.arquivado && <DSBadge variant="gray">arquivado</DSBadge>}
            {statusCfg && meta?.statusInterno !== 'ativo' && (
              <DSBadge style={{ color:statusCfg.cor, background:`${statusCfg.cor}18` }}>{statusCfg.label}</DSBadge>
            )}
          </div>
          <div style={{ marginTop:4, color:C.subtle, fontSize:FONT.xs, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{repo.nomeCompleto}</div>
        </div>
        <span aria-hidden="true" style={{ color:C.muted, fontSize:18, lineHeight:1 }}>›</span>
      </div>

      <p className="gh-repo-description" style={{ margin:0, color:C.muted, fontSize:FONT.md, lineHeight:1.5 }}>
        {resumo}
      </p>

      {detected && (detected.tipo || detected.framework || detected.packageManager) && (
        <div style={{ display:'flex', gap:SPACE.xs, flexWrap:'wrap' }}>
          {detected.tipo && <DSBadge variant="gray">{detected.tipo}</DSBadge>}
          {detected.framework && <DSBadge variant="purple">{detected.framework}</DSBadge>}
          {detected.packageManager && <DSBadge variant="blue">{detected.packageManager}</DSBadge>}
        </div>
      )}

      <div className="gh-repo-facts">
        <div><span>BRANCH</span><b>{repo.branch || '—'}</b></div>
        <div><span>TAMANHO</span><b>{fmtRepoSize(repo.tamanho)}</b></div>
        <div><span>ÚLTIMO PUSH</span><b>{relTime(repo.ultimoPush || repo.ultimaAtualizacao)}</b></div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:SPACE.sm, flexWrap:'wrap' }}>
        <LangBadge lang={repo.linguagem} size={FONT.xs} />
        {repo.licenca && <DSBadge variant="gray">{repo.licenca}</DSBadge>}
        <DSBadge variant={acesso === 'Leitura e escrita' ? 'green' : 'gray'}>{acesso}</DSBadge>
        {repo.temas?.slice(0,2).map(t => <DSBadge key={t} variant="blue">{t}</DSBadge>)}
      </div>

      <div className="gh-repo-footer">
        <div className="gh-repo-counters">
          <span title="Stars">★ <b>{repo.stars || 0}</b></span>
          <span title="Forks">⑂ <b>{repo.forks || 0}</b></span>
          <span title="Issues abertas">● <b>{repo.issues || 0}</b></span>
          {repo.watchers > 0 && <span title="Watchers">◉ <b>{repo.watchers}</b></span>}
        </div>
        {latestApk && (
          <button
            type="button"
            className={`gh-repo-apk-btn ${['connecting','downloading'].includes(apkDownloadState) ? 'busy' : ''} ${['started','completed'].includes(apkDownloadState) ? 'success' : ''} ${apkDownloadState === 'error' ? 'error' : ''}`}
            onClick={baixarApkRapido}
            aria-disabled={apkDownloadState === 'connecting' || apkDownloadState === 'downloading'}
            title={`${latestApk.source === 'release' ? 'Release' : 'GitHub Actions'} · ${latestApk.apkFileName || latestApk.nome || 'APK mais recente'}`}
          >
            <span aria-hidden="true">{['started','completed'].includes(apkDownloadState) ? '✓' : apkDownloadState === 'connecting' || apkDownloadState === 'downloading' ? '↻' : '↓'}</span>
            {apkLabel}
          </button>
        )}
      </div>

      {meta?.tags?.length > 0 && (
        <div style={{ display:'flex', gap:SPACE.xs, flexWrap:'wrap' }}>
          {meta.tags.map(t => <DSBadge key={t} variant="purple">{t}</DSBadge>)}
        </div>
      )}
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
═══════════════════════════════════════════════════════════ */
const SORTS = [
  { value: 'updated',   label: 'Atualização' },
  { value: 'created',   label: 'Criação'     },
  { value: 'full_name', label: 'Nome'        },
  { value: 'pushed',    label: 'Último push' },
]
const FILTRO_STATUS = [
  { value: 'todos',     label: 'Todos'       },
  { value: 'favoritos', label: '⭐ Favoritos' },
  { value: 'ativo',     label: 'Ativos'      },
  { value: 'arquivado', label: 'Arquivados'  },
]

function PerfilGitHubModal({ open, status, onClose, onSaved, toastShow }) {
  const [draft, setDraft] = useState({})
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!open || !status) return
    setDraft({
      name: status.nome || '', email: status.email || '', blog: status.blog || '',
      company: status.empresa || '', location: status.localizacao || '',
      hireable: !!status.contratavel, bio: status.bio || '', twitter_username: status.twitter || '',
    })
  }, [open, status])

  const upd = (k, v) => setDraft(prev => ({ ...prev, [k]: v }))
  async function salvar() {
    setSalvando(true)
    try {
      const atualizado = await githubService.atualizarPerfil(draft)
      toastShow(atualizado.mensagem || 'Perfil atualizado no GitHub.')
      onSaved?.(atualizado)
      onClose()
    } catch (e) {
      toastShow(e.message || 'Não foi possível atualizar o perfil.', 'erro')
    } finally { setSalvando(false) }
  }

  return (
    <DSModal open={open} onClose={() => !salvando && onClose()} title="Editar perfil do GitHub" size="md"
      footer={<><DSBtn variant="primary" onClick={salvar} loading={salvando} disabled={salvando}>Salvar no GitHub</DSBtn><DSBtn onClick={onClose} disabled={salvando}>Cancelar</DSBtn></>}>
      <div style={{ display:'grid', gap:SPACE.lg }}>
        <div className="gh-profile-edit-head">
          {status?.avatar && <img src={status.avatar} alt={status.login} className="gh-profile-edit-avatar" />}
          <div style={{ minWidth:0, flex:1 }}>
            <b style={{ display:'block', color:C.text, fontSize:FONT.md }}>{status?.nome || status?.login}</b>
            <span style={{ color:C.muted, fontSize:FONT.sm }}>@{status?.login}</span>
            <div style={{ fontSize:FONT.xs, color:C.muted, marginTop:5, lineHeight:1.4 }}>
              A API do GitHub não oferece upload de avatar neste endpoint. A foto pode ser alterada nas configurações do perfil.
            </div>
          </div>
          <a href="https://github.com/settings/profile" target="_blank" rel="noopener noreferrer" className="gh-external-btn">Alterar foto ↗</a>
        </div>
        <div style={{ fontSize:FONT.sm, color:C.muted, lineHeight:1.5 }}>
          Esta edição usa exclusivamente o token salvo em <b style={{ color:C.text }}>Integrações e APIs</b>. Token fine-grained precisa de <b style={{ color:C.text }}>Profile: write</b>; token classic precisa do escopo <b style={{ color:C.text }}>user</b>.
        </div>
        <div className="gh-profile-form-grid">
          <label><span>Nome</span><input value={draft.name || ''} onChange={e=>upd('name',e.target.value)} style={inp()} /></label>
          <label><span>E-mail público</span><input type="email" value={draft.email || ''} onChange={e=>upd('email',e.target.value)} style={inp()} /></label>
          <label><span>Empresa</span><input value={draft.company || ''} onChange={e=>upd('company',e.target.value)} style={inp()} /></label>
          <label><span>Localização</span><input value={draft.location || ''} onChange={e=>upd('location',e.target.value)} style={inp()} /></label>
          <label className="gh-profile-wide"><span>Site / blog</span><input value={draft.blog || ''} onChange={e=>upd('blog',e.target.value)} style={inp()} inputMode="url" placeholder="https://..." /></label>
          <label className="gh-profile-wide"><span>Twitter / X</span><input value={draft.twitter_username || ''} onChange={e=>upd('twitter_username',e.target.value)} style={inp()} placeholder="usuário sem @" /></label>
          <label className="gh-profile-wide"><span>Bio</span><textarea value={draft.bio || ''} onChange={e=>upd('bio',e.target.value)} style={{...inp(),minHeight:92,resize:'vertical'}} maxLength={160} /></label>
          <label className="gh-profile-wide gh-profile-check"><input type="checkbox" checked={!!draft.hireable} onChange={e=>upd('hireable',e.target.checked)} /> Disponível para contratação</label>
        </div>
      </div>
    </DSModal>
  )
}

export default function AdminGitHub() {
  const [sort,         setSort]         = useState('updated')
  const [busca,        setBusca]        = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroVis,    setFiltroVis]    = useState('todos')
  const [repoAberto,   setRepoAberto]   = useState(null)
  const [showPerfil,    setShowPerfil]    = useState(false)
  const [novoProjetoAberto, setNovoProjetoAberto] = useState(false)
  const [metas,        setMetas]        = useState({})
  const [insights,     setInsights]     = useState({})

  const { repos, status, total, loading, erro, recarregar } = useGitHubRepos({ sort })
  const { toast, show: toastShow } = useToast()

  useEffect(() => {
    if (repos.length === 0) return
    repos.forEach(r => {
      githubService.getMeta(r.id).then(m => setMetas(prev => ({ ...prev, [r.id]: m }))).catch(() => {})
    })
  }, [repos.length])

  useEffect(() => {
    if (!repos.length) return
    setInsights(prev => {
      const next = { ...prev }
      repos.forEach(r => { if (r.insight) next[r.id] = r.insight })
      return next
    })
    repos.forEach(r => {
      const [owner, nome] = (r.nomeCompleto || '').split('/')
      if (!owner || !nome || r.insight || insights[r.id]) return
      githubService.insight(owner, nome, r.branch || 'main')
        .then(info => setInsights(prev => ({ ...prev, [r.id]: info })))
        .catch(() => {})
    })
  }, [repos])

  const reposFiltrados = repos.filter(r => {
    const meta = metas[r.id]
    const matchBusca = !busca.trim() ||
      r.nome.toLowerCase().includes(busca.toLowerCase()) ||
      (r.descricao || '').toLowerCase().includes(busca.toLowerCase()) ||
      (meta?.alias || '').toLowerCase().includes(busca.toLowerCase()) ||
      (meta?.tags || []).some(t => t.toLowerCase().includes(busca.toLowerCase())) ||
      (insights[r.id]?.produto || '').toLowerCase().includes(busca.toLowerCase()) ||
      (insights[r.id]?.tipo || '').toLowerCase().includes(busca.toLowerCase())
    const matchStatus =
      filtroStatus === 'todos' ? true :
      filtroStatus === 'favoritos' ? !!meta?.favorito :
      filtroStatus === 'arquivado' ? !!r.arquivado :
      filtroStatus === 'ativo' ? !!r.ativo : true
    const matchVis = filtroVis === 'todos' ? true : filtroVis === 'privados' ? !!r.privado : !r.privado
    return matchBusca && matchStatus && matchVis
  })

  function fecharPainel(recarregarLista = false) {
    setRepoAberto(null)
    if (recarregarLista) recarregar()
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <Toast toast={toast} />
      <style>{`
        .gh-account-hero{background:linear-gradient(135deg,var(--adm-surface,#fff),var(--adm-surface2,#f7f5f2));border:1px solid var(--adm-border,#e8e3dc);border-radius:14px;padding:16px;margin-bottom:18px;position:relative;overflow:hidden}
        .gh-account-hero:after{content:'';position:absolute;right:-48px;top:-62px;width:180px;height:180px;border-radius:50%;border:1px solid color-mix(in srgb,var(--adm-accent) 14%,transparent);box-shadow:0 0 0 28px color-mix(in srgb,var(--adm-accent) 5%,transparent);pointer-events:none}
        .gh-profile-row{position:relative;z-index:1;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px}
        .gh-profile-avatar{width:46px;height:46px;border-radius:50%;object-fit:cover;border:1px solid var(--adm-border)}
        .gh-profile-meta{min-width:0}.gh-profile-meta h1{margin:0;font-size:17px;line-height:1.2}.gh-profile-meta p{margin:4px 0 0;color:var(--adm-muted);font-size:11px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .gh-profile-actions{display:flex;align-items:center;gap:7px}
        .gh-account-stats{position:relative;z-index:1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin-top:14px;border:1px solid var(--adm-border);border-radius:10px;overflow:hidden;background:var(--adm-bg)}
        .gh-account-stat{padding:9px 10px;min-width:0;border-right:1px solid var(--adm-border)}.gh-account-stat:last-child{border-right:0}
        .gh-account-stat span,.gh-repo-facts span{display:block;font-size:11px;line-height:1.25;letter-spacing:.07em;color:var(--adm-muted);font-weight:800}
        .gh-account-stat b{display:block;margin-top:3px;font-size:13px;line-height:1.2;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .gh-repo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
        .gh-repo-card{position:relative;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px;cursor:pointer;overflow:hidden;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease;min-width:0}
        .gh-repo-card:hover{border-color:var(--adm-accent);transform:translateY(-1px);box-shadow:0 10px 30px rgba(20,30,24,.06)}
        .gh-card-topline{position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,var(--adm-accent),transparent 72%);opacity:.75}
        .gh-repo-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
        .gh-repo-facts>div{background:var(--adm-surface2);border:1px solid var(--adm-border);border-radius:8px;padding:8px 7px;min-width:0}
        .gh-repo-facts b{display:block;margin-top:3px;font-size:12px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .gh-repo-footer{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:9px;border-top:1px solid var(--adm-border);color:var(--adm-muted);font-size:12px}.gh-repo-apk-btn{margin-left:auto;border:1px solid color-mix(in srgb,var(--adm-success) 30%,var(--adm-border));background:color-mix(in srgb,var(--adm-success) 8%,var(--adm-surface));color:var(--adm-success);border-radius:8px;padding:6px 9px;display:inline-flex;align-items:center;justify-content:center;gap:5px;font:inherit;font-weight:850;cursor:pointer;transition:.15s ease}.gh-repo-apk-btn:hover{border-color:color-mix(in srgb,var(--adm-success) 52%,var(--adm-border));background:color-mix(in srgb,var(--adm-success) 13%,var(--adm-surface))}.gh-repo-apk-btn.busy{opacity:.65;cursor:wait}.gh-repo-apk-btn.success{background:color-mix(in srgb,var(--adm-success) 14%,var(--adm-surface))}.gh-repo-apk-btn.error{color:var(--adm-red);border-color:color-mix(in srgb,var(--adm-red) 35%,var(--adm-border));background:color-mix(in srgb,var(--adm-red) 7%,var(--adm-surface))}
        .gh-repo-counters{display:flex;align-items:center;gap:12px}.gh-repo-counters b{color:var(--adm-text)}
        .gh-filter-row{display:grid;grid-template-columns:minmax(0,1fr) 150px 150px;gap:8px}
        .gh-command-select{display:none;width:100%;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:9px;padding:10px 11px;color:var(--adm-text);font-size:12px;font-weight:700;outline:none}
        .gh-more-wrap{position:relative;flex:0 0 auto}.gh-more-menu{position:absolute;right:0;top:calc(100% + 7px);z-index:30;min-width:190px;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:12px;padding:6px;box-shadow:0 16px 40px rgba(15,23,42,.16)}.gh-more-menu button{width:100%;border:0;background:transparent;color:var(--adm-text);border-radius:9px;padding:9px;display:grid;grid-template-columns:24px minmax(0,1fr);gap:7px;text-align:left;cursor:pointer}.gh-more-menu button:hover{background:var(--adm-surface2)}.gh-more-menu button>span:first-child{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:color-mix(in srgb,var(--adm-red) 9%,var(--adm-surface));color:var(--adm-red);font-size:15px;font-weight:900}.gh-more-menu b{display:block;font-size:12px;color:var(--adm-red)}.gh-more-menu small{display:block;margin-top:2px;font-size:11px;color:var(--adm-muted)}.gh-repo-head-action{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:126px;min-height:35px;padding:7px 11px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2);color:var(--adm-muted);font-size:11px;font-weight:750;cursor:pointer;transition:.15s ease}.gh-repo-head-action:hover{border-color:color-mix(in srgb,var(--adm-accent) 42%,var(--adm-border));color:var(--adm-text);background:var(--adm-surface)}.gh-repo-head-action:disabled{opacity:.6;cursor:wait}.gh-artifacts-page{display:grid;gap:14px}.gh-artifacts-hero{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center;padding:16px;border:1px solid var(--adm-border);border-radius:15px;background:linear-gradient(135deg,var(--adm-surface),var(--adm-surface2));overflow:hidden;position:relative}.gh-artifacts-hero:after{content:'';position:absolute;right:-45px;top:-65px;width:160px;height:160px;border-radius:50%;border:1px solid color-mix(in srgb,var(--adm-accent) 14%,transparent);box-shadow:0 0 0 28px color-mix(in srgb,var(--adm-accent) 5%,transparent);pointer-events:none}.gh-artifacts-hero-icon{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:color-mix(in srgb,var(--adm-accent) 10%,var(--adm-surface));border:1px solid color-mix(in srgb,var(--adm-accent) 20%,var(--adm-border));color:var(--adm-accent);font-size:20px;font-weight:900;position:relative;z-index:1}.gh-artifacts-hero-copy{min-width:0;position:relative;z-index:1}.gh-artifacts-hero-copy small{display:block;font-size:11px;font-weight:900;letter-spacing:.09em;color:var(--adm-accent)}.gh-artifacts-hero-copy h3{margin:3px 0 4px;font-size:16px;color:var(--adm-text)}.gh-artifacts-hero-copy p{margin:0;max-width:560px;font-size:12px;line-height:1.45;color:var(--adm-muted)}.gh-artifacts-stats{display:grid;grid-template-columns:repeat(3,minmax(78px,1fr));gap:6px;position:relative;z-index:1}.gh-artifacts-stats>div{padding:8px 9px;border:1px solid var(--adm-border);border-radius:9px;background:color-mix(in srgb,var(--adm-surface) 88%,transparent);text-align:center}.gh-artifacts-stats span{display:block;font-size:11px;font-weight:850;letter-spacing:.06em;color:var(--adm-muted);text-transform:uppercase}.gh-artifacts-stats b{display:block;margin-top:3px;font-size:14px;color:var(--adm-text)}.gh-artifacts-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.gh-artifact-card{display:grid;grid-template-rows:auto auto 1fr;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface);overflow:hidden;min-width:0;transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease,background .15s ease;outline:none}.gh-artifact-card.downloadable{cursor:pointer}.gh-artifact-card.downloadable:hover,.gh-artifact-card.downloadable:focus-visible{border-color:color-mix(in srgb,var(--adm-accent) 42%,var(--adm-border));transform:translateY(-1px);box-shadow:0 10px 26px rgba(15,23,42,.07)}.gh-artifact-card.busy{cursor:wait;border-color:color-mix(in srgb,var(--adm-accent) 36%,var(--adm-border));background:color-mix(in srgb,var(--adm-accent) 2.5%,var(--adm-surface))}.gh-artifact-card.download-error{border-color:color-mix(in srgb,var(--adm-red) 35%,var(--adm-border))}.gh-artifact-card.expired{opacity:.68}.gh-artifact-card-top{display:grid;grid-template-columns:40px minmax(0,1fr);gap:10px;padding:13px}.gh-artifact-type-icon{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:var(--adm-surface2);border:1px solid var(--adm-border);color:var(--adm-muted);font-weight:900}.gh-artifact-type-icon.apk{background:color-mix(in srgb,var(--adm-success) 8%,var(--adm-surface));border-color:color-mix(in srgb,var(--adm-success) 24%,var(--adm-border));color:var(--adm-success)}.gh-artifact-main{min-width:0}.gh-artifact-kicker{display:flex;align-items:center;gap:6px}.gh-artifact-kicker span,.gh-artifact-kicker em{font-style:normal;font-size:11px;font-weight:900;letter-spacing:.07em}.gh-artifact-kicker span{color:var(--adm-accent)}.gh-artifact-kicker em{padding:2px 5px;border-radius:999px;background:color-mix(in srgb,var(--adm-red) 8%,var(--adm-surface));color:var(--adm-red)}.gh-artifact-main h4{margin:4px 0 2px;font-size:12px;color:var(--adm-text);overflow-wrap:anywhere}.gh-artifact-main p{margin:0;font-size:12px;color:var(--adm-muted)}.gh-artifact-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border-top:1px solid var(--adm-border);border-bottom:1px solid var(--adm-border);background:var(--adm-surface2)}.gh-artifact-facts>div{padding:8px 9px;border-right:1px solid var(--adm-border);min-width:0}.gh-artifact-facts>div:last-child{border-right:0}.gh-artifact-facts small{display:block;font-size:11px;font-weight:850;letter-spacing:.05em;color:var(--adm-muted)}.gh-artifact-facts b{display:block;margin-top:3px;font-size:11px;color:var(--adm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gh-artifact-footer{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-height:54px;padding:9px 11px}.gh-download-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.gh-download-actions button{min-height:36px;padding:7px 10px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2);color:var(--adm-text);font:800 11px var(--adm-font);cursor:pointer}.gh-download-actions button.open{color:var(--adm-success);border-color:color-mix(in srgb,var(--adm-success) 32%,var(--adm-border));background:color-mix(in srgb,var(--adm-success) 7%,var(--adm-surface))}.gh-download-actions button.log{color:var(--adm-accent);border-color:color-mix(in srgb,var(--adm-accent) 30%,var(--adm-border))}.gh-download-actions button.retry{color:var(--adm-red);border-color:color-mix(in srgb,var(--adm-red) 30%,var(--adm-border))}.gh-download-actions button:active{transform:translateY(1px)}.gh-artifact-download-state{width:100%;display:flex;align-items:center;justify-content:flex-start;gap:8px;padding:8px 9px;border:1px solid color-mix(in srgb,var(--adm-accent) 20%,var(--adm-border));border-radius:9px;background:color-mix(in srgb,var(--adm-accent) 6%,var(--adm-surface2));color:var(--adm-accent)}.gh-artifact-download-state>span:last-child{display:grid;gap:1px;min-width:0}.gh-artifact-download-state b{font-size:12px;line-height:1.2}.gh-artifact-download-state small{font-size:11px;color:var(--adm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gh-artifact-download-state.success{color:var(--adm-success);border-color:color-mix(in srgb,var(--adm-success) 28%,var(--adm-border));background:color-mix(in srgb,var(--adm-success) 7%,var(--adm-surface2))}.gh-artifact-download-state.error{color:var(--adm-red);border-color:color-mix(in srgb,var(--adm-red) 30%,var(--adm-border));background:color-mix(in srgb,var(--adm-red) 6%,var(--adm-surface2))}.gh-artifact-download-icon{width:24px;height:24px;display:grid;place-items:center;border-radius:7px;background:var(--adm-surface);border:1px solid currentColor;font-size:13px;font-weight:900;flex:0 0 auto}.gh-artifact-download-state.busy .gh-artifact-download-icon,.gh-artifact-card.busy .gh-artifact-type-icon span,.gh-repo-apk-btn.busy>span{animation:gh-download-spin .8s linear infinite}@keyframes gh-download-spin{to{transform:rotate(360deg)}}.gh-artifact-unavailable{font-size:12px;color:var(--adm-muted)}.gh-artifacts-empty{padding:32px 18px;text-align:center;border:1px dashed var(--adm-border);border-radius:14px;background:var(--adm-surface2)}.gh-artifacts-empty>span{display:grid;place-items:center;width:42px;height:42px;margin:0 auto 9px;border-radius:12px;background:var(--adm-surface);border:1px solid var(--adm-border);color:var(--adm-muted)}.gh-artifacts-empty h4{margin:0;font-size:13px;color:var(--adm-text)}.gh-artifacts-empty p{margin:5px auto 0;max-width:430px;font-size:12px;line-height:1.45;color:var(--adm-muted)}.gh-artifacts-loading{display:flex;align-items:center;gap:10px;padding:18px;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-surface)}.gh-artifacts-loading>span{font-size:20px;color:var(--adm-accent)}.gh-artifacts-loading>div{display:grid;gap:2px}.gh-artifacts-loading b{font-size:11px;color:var(--adm-text)}.gh-artifacts-loading small{font-size:12px;color:var(--adm-muted)}
        .gh-repo-status-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:13px 14px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));border:1px solid color-mix(in srgb,var(--adm-accent) 28%,var(--adm-border));border-radius:14px;box-shadow:0 5px 18px rgba(15,23,42,.035)}.gh-repo-status-icon{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface);color:var(--adm-accent);font-size:16px}.gh-repo-status-copy{min-width:0;display:grid;gap:3px}.gh-repo-status-copy b{font-size:12px;color:var(--adm-text)}.gh-repo-status-copy small{font-size:12px;color:var(--adm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gh-repo-status-dot{width:9px;height:9px;border-radius:50%;background:var(--adm-success);box-shadow:0 0 0 5px color-mix(in srgb,var(--adm-success) 13%,transparent)}
        .gh-command-title{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:16px 2px 10px}.gh-command-title>div{min-width:0}.gh-command-title span,.gh-command-group-label{display:block;font-size:11px;font-weight:900;letter-spacing:.13em;color:var(--adm-accent)}.gh-command-title b{display:block;margin-top:3px;font-size:14px;color:var(--adm-text)}.gh-command-title>small{max-width:260px;font-size:11px;line-height:1.4;color:var(--adm-muted);text-align:right}
        .gh-command-group{margin-top:13px}.gh-command-group-label{margin:0 2px 6px;color:var(--adm-muted)}.gh-command-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.gh-command-card{min-width:0;min-height:72px;text-align:left;border:1px solid var(--adm-border);background:var(--adm-surface);border-radius:14px;padding:11px;display:grid;grid-template-columns:32px minmax(0,1fr);gap:9px;align-items:center;color:var(--adm-text);cursor:pointer;box-shadow:0 5px 18px rgba(15,23,42,.03);transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}.gh-command-card:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--adm-accent) 48%,var(--adm-border));box-shadow:0 9px 24px rgba(15,23,42,.055)}.gh-command-card.destaque{border-color:color-mix(in srgb,var(--adm-success) 36%,var(--adm-border));background:linear-gradient(145deg,var(--adm-surface),color-mix(in srgb,var(--adm-success) 4%,var(--adm-surface2)))}.gh-command-card-icon{display:grid;place-items:center;width:32px;height:32px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2);font-size:15px;font-weight:900;color:var(--adm-text)}.gh-command-card.destaque .gh-command-card-icon{color:var(--adm-success);border-color:color-mix(in srgb,var(--adm-success) 28%,var(--adm-border))}.gh-command-card-copy{min-width:0;display:grid;gap:3px}.gh-command-card-copy b{font-size:12.5px;line-height:1.2;overflow-wrap:anywhere}.gh-command-card-copy small{font-size:12px;line-height:1.32;color:var(--adm-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .gh-repo-overview-strip{margin:14px 20px 20px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--adm-border);border-radius:13px;overflow:hidden;background:var(--adm-surface)}.gh-repo-overview-strip>div{min-width:0;padding:10px 11px;border-right:1px solid var(--adm-border)}.gh-repo-overview-strip>div:last-child{border-right:0}.gh-repo-overview-strip span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:850;color:var(--adm-muted)}.gh-repo-overview-strip b{display:block;margin-top:4px;font-size:12px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .gh-repo-title{word-break:normal;overflow-wrap:anywhere;line-height:1.2}.gh-repo-path{overflow-wrap:anywhere}
        .gh-github-summary{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:10px;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:10px;padding:12px}
        .gh-overview-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-items:stretch}
        .gh-overview-card,.gh-publish-card,.gh-readme-section{min-width:0;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:12px;padding:12px}
        .gh-overview-head,.gh-card-section-head,.gh-readme-head,.gh-cloud-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;min-width:0}.gh-overview-head>div,.gh-readme-head>div{min-width:0}.gh-overview-head span,.gh-readme-head span,.gh-kicker{display:block;font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--adm-accent)}.gh-overview-head b,.gh-readme-head b{display:block;font-size:12px;margin-top:2px;color:var(--adm-text)}
        .gh-overview-body{display:grid;gap:10px}.gh-overview-body p{margin:3px 0 0;font-size:12px;line-height:1.45;color:var(--adm-text);overflow-wrap:anywhere}.gh-overview-body a{font-size:12px;color:var(--adm-blue,var(--adm-accent));overflow-wrap:anywhere}.gh-mini-label{font-size:11px;color:var(--adm-muted);font-weight:850;text-transform:uppercase;letter-spacing:.06em}.gh-muted{color:var(--adm-muted)!important}.gh-inline-link{display:inline-flex;margin-top:2px;text-decoration:none;font-weight:750}
        .gh-compact-info{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.gh-compact-info>div{min-width:0;background:var(--adm-bg);border:1px solid var(--adm-border);border-radius:8px;padding:7px}.gh-compact-info span{display:block;font-size:11px;color:var(--adm-muted);font-weight:800;text-transform:uppercase;letter-spacing:.04em}.gh-compact-info b{display:block;margin-top:3px;font-size:12px;color:var(--adm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gh-topic-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
        .gh-readme-section{margin-top:12px;padding:12px}.gh-readme-section .gh-readme{border:0;border-top:1px solid var(--adm-border);border-radius:0;padding:14px 0 0;margin-top:2px}
        .gh-publish-shell{min-width:0}.gh-publish-intro{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;margin-bottom:12px}.gh-publish-intro h3{margin:3px 0 4px;font-size:15px;color:var(--adm-text)}.gh-publish-intro p{margin:0;font-size:11px;line-height:1.5;color:var(--adm-muted)}.gh-destination-pill{max-width:260px;padding:8px 10px;border-radius:9px;background:color-mix(in srgb,var(--adm-accent) 9%,var(--adm-surface));border:1px solid color-mix(in srgb,var(--adm-accent) 30%,var(--adm-border));font:700 12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--adm-text);overflow-wrap:anywhere}
        .gh-publish-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.gh-card-section-head b{font-size:11px;color:var(--adm-text)}.gh-card-section-head>span{font-size:11px;color:var(--adm-muted);text-align:right}.gh-field{display:block;margin-top:9px}.gh-field>span{display:block;font-size:12px;font-weight:800;color:var(--adm-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}.gh-two-fields{display:grid;grid-template-columns:1fr 1fr;gap:7px}.gh-path-preview{margin-top:9px;border:1px solid var(--adm-border);background:var(--adm-bg);border-radius:8px;padding:8px}.gh-path-preview span{display:block;font-size:11px;color:var(--adm-muted);font-weight:800;text-transform:uppercase;margin-bottom:3px}.gh-path-preview code{display:block;font-size:11px;color:var(--adm-text);white-space:normal;overflow-wrap:anywhere}.gh-check-row{display:flex;gap:8px;align-items:flex-start;margin-top:10px;cursor:pointer}.gh-check-row input{margin-top:2px;accent-color:var(--adm-accent);flex:0 0 auto}.gh-check-row span{min-width:0}.gh-check-row b{display:block;font-size:12px;color:var(--adm-text)}.gh-check-row small{display:block;margin-top:2px;font-size:11px;line-height:1.35;color:var(--adm-muted)}.gh-upload-box{display:grid;place-items:center;text-align:center;min-height:104px;border:1px dashed color-mix(in srgb,var(--adm-accent) 45%,var(--adm-border));border-radius:10px;padding:12px;background:color-mix(in srgb,var(--adm-accent) 4%,var(--adm-bg));cursor:pointer;overflow:hidden}.gh-upload-box input{max-width:100%;font-size:12px}.gh-upload-box strong{font-size:12px;margin-top:8px;color:var(--adm-text);overflow-wrap:anywhere}.gh-upload-box span{font-size:11px;color:var(--adm-muted);line-height:1.35;margin-top:3px}
        .gh-cloud-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.gh-cloud-card{border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-bg);padding:9px;min-width:0}.gh-cloud-title{margin-bottom:6px}.gh-cloud-title>b{font-size:12px}.gh-cloud-card p,.gh-cloud-note{font-size:11px;line-height:1.4;color:var(--adm-muted);margin:0}.gh-cloud-row{display:flex;align-items:center;justify-content:space-between;gap:7px;border-top:1px solid var(--adm-border);padding:7px 0}.gh-cloud-row:first-of-type{border-top:0}.gh-cloud-row span{min-width:0}.gh-cloud-row b{display:block;font-size:12px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gh-cloud-row small{display:block;font-size:11px;color:var(--adm-muted);margin-top:2px}.gh-cloud-row em{font-style:normal;font-size:11px;color:var(--adm-accent);font-weight:800;white-space:nowrap}.gh-cloud-note{margin-top:8px}.gh-muted-box,.gh-error-box,.gh-warning-box{padding:10px;border-radius:8px;background:var(--adm-bg);border:1px solid var(--adm-border);font-size:12px;color:var(--adm-muted)}.gh-error-box{color:var(--adm-red);border-color:color-mix(in srgb,var(--adm-red) 35%,var(--adm-border))}.gh-warning-box{display:grid;gap:3px;border-color:color-mix(in srgb,var(--adm-amber) 38%,var(--adm-border));background:color-mix(in srgb,var(--adm-amber) 5%,var(--adm-bg))}.gh-warning-box b{font-size:12px;color:var(--adm-text)}.gh-warning-box span{font-size:11px;line-height:1.4;color:var(--adm-muted)}
        .gh-publish-confirm{display:grid;grid-template-columns:1fr 1fr;gap:8px}.gh-publish-confirm>div{min-width:0;padding:9px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-bg)}.gh-publish-confirm span{display:block;font-size:11px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;color:var(--adm-muted)}.gh-publish-confirm b{display:block;margin-top:3px;font-size:12px;color:var(--adm-text);overflow-wrap:anywhere}.gh-publish-confirm small{display:block;margin-top:3px;font-size:11px;line-height:1.35;color:var(--adm-muted)}
        .gh-publish-result{margin-top:12px;padding:12px;border-radius:11px;border:1px solid color-mix(in srgb,var(--adm-success) 35%,var(--adm-border));background:color-mix(in srgb,var(--adm-success) 7%,var(--adm-surface));display:grid;gap:9px}.gh-publish-result>div:first-child b{display:block;font-size:11px;color:var(--adm-text)}.gh-publish-result>div:first-child span{display:block;font-size:11px;color:var(--adm-muted);margin-top:2px}.gh-result-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.gh-result-stats span{font-size:11px;color:var(--adm-muted);padding:7px;background:var(--adm-bg);border-radius:7px;border:1px solid var(--adm-border);text-align:center}.gh-result-stats b{display:block;color:var(--adm-text);font-size:12px}.gh-publish-result>a{font-size:12px;font-weight:800;color:var(--adm-accent);text-decoration:none}
        .gh-wizard-shell{min-width:0}.gh-wizard-progress{padding:2px 0 14px;border-bottom:1px solid var(--adm-border);margin-bottom:16px}.gh-wizard-progress-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.gh-wizard-progress-top b{font-size:12px;color:var(--adm-text)}.gh-wizard-progress-top span{font-size:12px;color:var(--adm-muted)}.gh-wizard-track{height:4px;background:var(--adm-bg);border-radius:999px;overflow:hidden;margin-top:8px}.gh-wizard-track>span{display:block;height:100%;border-radius:inherit;background:var(--adm-accent);transition:width .2s ease}.gh-wizard-dots{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin-top:8px}.gh-wizard-dots button{height:24px;border-radius:7px;border:1px solid var(--adm-border);background:var(--adm-bg);color:var(--adm-muted);font-size:12px;font-weight:850}.gh-wizard-dots button.ativo{border-color:var(--adm-accent);background:color-mix(in srgb,var(--adm-accent) 10%,var(--adm-surface));color:var(--adm-accent)}.gh-wizard-dots button.feito{border-color:color-mix(in srgb,var(--adm-success) 40%,var(--adm-border));color:var(--adm-success);cursor:pointer}.gh-wizard-step{min-height:300px}.gh-wizard-step-head{display:flex;gap:11px;align-items:flex-start;margin-bottom:16px}.gh-wizard-step-head>span{display:grid;place-items:center;width:28px;height:28px;flex:0 0 auto;border-radius:9px;background:color-mix(in srgb,var(--adm-accent) 12%,var(--adm-surface));border:1px solid color-mix(in srgb,var(--adm-accent) 30%,var(--adm-border));font-size:11px;font-weight:900;color:var(--adm-accent)}.gh-wizard-step-head h3{margin:0;font-size:16px;color:var(--adm-text)}.gh-wizard-step-head p{margin:4px 0 0;font-size:11px;line-height:1.45;color:var(--adm-muted)}.gh-wizard-upload{min-height:150px}.gh-wizard-summary-line{margin-top:12px;padding:11px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-bg)}.gh-wizard-summary-line span{display:block;font-size:11px;font-weight:850;text-transform:uppercase;color:var(--adm-muted);margin-bottom:4px}.gh-wizard-summary-line code{display:block;font-size:12px;overflow-wrap:anywhere;color:var(--adm-text)}.gh-wizard-choice{padding:12px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-bg)}.gh-wizard-cloud{margin-top:12px}.gh-wizard-actions{display:flex;justify-content:space-between;gap:8px;padding-top:14px;margin-top:16px;border-top:1px solid var(--adm-border);position:sticky;bottom:-1px;background:var(--adm-surface);z-index:2}.gh-wizard-warning{margin-top:12px;padding:10px;border:1px solid color-mix(in srgb,var(--adm-amber) 35%,var(--adm-border));border-radius:9px;background:color-mix(in srgb,var(--adm-amber) 7%,var(--adm-surface));font-size:12px;color:var(--adm-text);overflow-wrap:anywhere}.gh-wizard-success{text-align:center;padding:10px 0}.gh-wizard-success-icon{display:grid;place-items:center;margin:0 auto 10px;width:48px;height:48px;border-radius:50%;background:color-mix(in srgb,var(--adm-success) 12%,var(--adm-surface));color:var(--adm-success);font-size:24px;font-weight:900}.gh-wizard-success h3{margin:0;font-size:16px;color:var(--adm-text)}.gh-wizard-success>p{font-size:12px;color:var(--adm-muted);overflow-wrap:anywhere}.gh-wizard-success>a{display:inline-flex;margin:12px 0;font-size:12px;font-weight:800;color:var(--adm-accent);text-decoration:none}.gh-wizard-deploys{text-align:left;margin-top:14px;border:1px solid var(--adm-border);border-radius:10px;padding:10px}.gh-command-empty{min-height:120px}.gh-publish-progress{margin-top:10px;padding:10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-bg)}.gh-publish-progress-head{display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:12px;color:var(--adm-text)}.gh-publish-progress-head span{font-weight:900;color:var(--adm-accent)}.gh-publish-progress-track{height:6px;margin-top:7px;border-radius:999px;background:var(--adm-surface);overflow:hidden}.gh-publish-progress-track>span{display:block;height:100%;background:var(--adm-accent);border-radius:inherit;transition:width .18s ease}.gh-publish-progress small{display:block;margin-top:6px;font-size:11px;line-height:1.45;color:var(--adm-muted)}
        .gh-readme{background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:10px;padding:16px;max-width:100%;overflow:auto;color:var(--adm-text);font-size:12px;line-height:1.65;word-wrap:break-word}
        .gh-readme>*:first-child{margin-top:0}.gh-readme>*:last-child{margin-bottom:0}.gh-readme h1{font-size:20px}.gh-readme h2{font-size:17px}.gh-readme h3{font-size:15px}.gh-readme h1,.gh-readme h2{padding-bottom:6px;border-bottom:1px solid var(--adm-border)}
        .gh-readme pre{max-width:100%;overflow:auto;background:var(--adm-bg);border:1px solid var(--adm-border);border-radius:8px;padding:11px}.gh-readme code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}.gh-readme :not(pre)>code{background:var(--adm-bg);padding:2px 5px;border-radius:5px}
        .gh-readme table{display:block;width:max-content;max-width:100%;overflow:auto;border-collapse:collapse}.gh-readme th,.gh-readme td{border:1px solid var(--adm-border);padding:6px 9px}.gh-readme img{max-width:100%;height:auto}.gh-readme a{color:var(--adm-blue,var(--adm-accent));overflow-wrap:anywhere}.gh-readme blockquote{margin-left:0;padding-left:12px;border-left:3px solid var(--adm-border);color:var(--adm-muted)}
        .gh-readme-fallback{background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:10px;padding:14px;font-size:11px;color:var(--adm-text);line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}
        .gh-profile-edit-head{display:flex;align-items:center;gap:12px;padding:10px;background:var(--adm-surface2);border:1px solid var(--adm-border);border-radius:10px}.gh-profile-edit-avatar{width:54px;height:54px;border-radius:50%;object-fit:cover}.gh-external-btn{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:6px 9px;border:1px solid var(--adm-border);border-radius:8px;color:var(--adm-text);font-size:12px;font-weight:700;text-decoration:none;background:var(--adm-surface)}
        .gh-profile-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gh-profile-form-grid label>span{display:block;font-size:12px;color:var(--adm-muted);font-weight:700;margin-bottom:5px}.gh-profile-wide{grid-column:1/-1}.gh-profile-check{display:flex!important;align-items:center;gap:8px;color:var(--adm-text);font-size:11px}.gh-profile-check input{accent-color:var(--adm-accent)}
        .gh-new-project-launch{width:100%;margin:0 0 14px;display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:11px;align-items:center;text-align:left;padding:12px 14px;border:1px solid color-mix(in srgb,var(--adm-accent) 28%,var(--adm-border));border-radius:14px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));color:var(--adm-text);cursor:pointer}.gh-new-project-launch-icon{width:36px;height:36px;display:grid;place-items:center;border-radius:10px;background:color-mix(in srgb,var(--adm-accent) 12%,var(--adm-surface));border:1px solid color-mix(in srgb,var(--adm-accent) 30%,var(--adm-border));color:var(--adm-accent);font-size:21px;font-weight:700}.gh-new-project-launch>span:nth-child(2){display:grid;gap:2px;min-width:0}.gh-new-project-launch b{font-size:12px}.gh-new-project-launch small{font-size:12px;color:var(--adm-muted);line-height:1.35}.gh-new-project-launch-arrow{font-size:24px;color:var(--adm-muted)}
        .gh-package-picker{width:100%;display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:10px;align-items:center;text-align:left;padding:12px;border:1.5px dashed color-mix(in srgb,var(--adm-accent) 38%,var(--adm-border));border-radius:12px;background:color-mix(in srgb,var(--adm-accent) 3%,var(--adm-surface2));color:var(--adm-text);cursor:pointer}.gh-package-picker.selected{border-style:solid;border-color:color-mix(in srgb,var(--adm-accent) 50%,var(--adm-border))}.gh-package-picker-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;background:var(--adm-surface);border:1px solid var(--adm-border);font-size:18px}.gh-package-picker-copy{min-width:0;display:grid;gap:2px}.gh-package-picker-copy b{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gh-package-picker-copy small{font-size:12px;color:var(--adm-muted);overflow-wrap:anywhere}.gh-package-picker-action{font-size:12px;font-weight:850;color:var(--adm-accent);padding:7px 8px;border:1px solid color-mix(in srgb,var(--adm-accent) 25%,var(--adm-border));border-radius:8px;background:var(--adm-surface)}.gh-version-compare{margin-top:10px}.gh-wizard-compact-step{display:grid;gap:11px;align-content:start}.gh-wizard-compact-step .gh-wizard-step-head{margin-bottom:1px}.gh-option-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.gh-option-card{min-width:0;text-align:left;padding:10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2);color:var(--adm-text);cursor:pointer}.gh-option-card.active{border-color:color-mix(in srgb,var(--adm-accent) 55%,var(--adm-border));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--adm-accent) 20%,transparent)}.gh-option-card.danger.active{border-color:color-mix(in srgb,var(--adm-red) 42%,var(--adm-border))}.gh-option-card b{display:block;font-size:12px}.gh-option-card small{display:block;margin-top:3px;font-size:11px;line-height:1.3;color:var(--adm-muted)}.gh-cloud-action-row{display:flex;justify-content:flex-end}.gh-final-review-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.gh-publish-dashboard,.gh-publish-finish{display:grid;gap:12px;align-content:start}.gh-publish-state-icon{width:48px;height:48px;display:grid;place-items:center;border-radius:15px;background:color-mix(in srgb,var(--adm-accent) 12%,var(--adm-surface2));color:var(--adm-accent);font-size:23px;font-weight:900}.gh-publish-state-icon.error{background:color-mix(in srgb,var(--adm-red) 10%,var(--adm-surface2));color:var(--adm-red)}.gh-publish-dashboard h3,.gh-publish-finish h3{margin:0;font-size:16px;color:var(--adm-text)}.gh-publish-dashboard>p,.gh-publish-finish>p{margin:-5px 0 0;font-size:12px;line-height:1.45;color:var(--adm-muted)}.gh-dashboard-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.gh-dashboard-stage{min-width:0;display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px;align-items:center;padding:10px;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-surface2)}.gh-dashboard-stage.done{border-color:color-mix(in srgb,var(--adm-success) 28%,var(--adm-border))}.gh-dashboard-stage.error{border-color:color-mix(in srgb,var(--adm-red) 38%,var(--adm-border))}.gh-dashboard-stage.active{border-color:color-mix(in srgb,var(--adm-accent) 42%,var(--adm-border))}.gh-dashboard-stage-icon{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:var(--adm-surface);border:1px solid var(--adm-border);font-size:11px;font-weight:900;color:var(--adm-muted)}.gh-dashboard-stage.done .gh-dashboard-stage-icon{color:var(--adm-success)}.gh-dashboard-stage.error .gh-dashboard-stage-icon{color:var(--adm-red)}.gh-dashboard-stage.active .gh-dashboard-stage-icon{color:var(--adm-accent)}.gh-dashboard-stage-copy{min-width:0;display:grid;gap:1px}.gh-dashboard-stage-copy small{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:var(--adm-muted)}.gh-dashboard-stage-copy b{font-size:12px;color:var(--adm-text);overflow-wrap:anywhere}.gh-dashboard-stage-copy em{font-style:normal;font-size:11px;color:var(--adm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gh-dashboard-progress{height:8px;border-radius:999px;background:var(--adm-surface2);overflow:hidden}.gh-dashboard-progress i{display:block;height:100%;border-radius:inherit;background:var(--adm-accent);transition:width .2s}.gh-dashboard-destination{display:grid;gap:3px;padding:10px;border-radius:10px;border:1px solid var(--adm-border);background:var(--adm-surface2)}.gh-dashboard-destination span{font-size:11px;font-weight:900;text-transform:uppercase;color:var(--adm-muted)}.gh-dashboard-destination b{font-size:12px;color:var(--adm-text);overflow-wrap:anywhere}.gh-finish-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.gh-finish-actions{display:flex;gap:8px;flex-wrap:wrap}.gh-finish-actions a{display:inline-flex;align-items:center;min-height:34px;padding:0 10px;border-radius:9px;border:1px solid var(--adm-border);background:var(--adm-surface2);font-size:12px;font-weight:850;color:var(--adm-accent);text-decoration:none}
        .gh-files-explorer{display:grid;gap:10px}.gh-files-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:14px;border:1px solid var(--adm-border);border-radius:14px;background:linear-gradient(145deg,var(--adm-surface2),var(--adm-surface));overflow:hidden}.gh-files-hero-copy>span{font-size:11px;font-weight:900;letter-spacing:.13em;color:var(--adm-accent)}.gh-files-hero-copy h3{margin:3px 0 0;font-size:15px;color:var(--adm-text)}.gh-files-hero-copy p{margin:4px 0 0;font-size:12px;color:var(--adm-muted);line-height:1.45}.gh-files-hero-actions{display:flex;gap:6px;align-items:flex-start}.gh-files-stats{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.gh-files-stats>div{min-width:0;padding:8px 9px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface)}.gh-files-stats small{display:block;font-size:11px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:var(--adm-muted)}.gh-files-stats b{display:block;margin-top:2px;font-size:11px;color:var(--adm-text)}.gh-files-stats em{display:block;margin-top:1px;font-style:normal;font-size:11px;color:var(--adm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gh-files-toolbar,.gh-files-selectionbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface)}.gh-files-breadcrumb{min-width:0;display:flex;gap:3px;align-items:center;overflow:auto;scrollbar-width:none}.gh-files-breadcrumb button{flex:0 0 auto;border:0;background:transparent;color:var(--adm-accent);font-size:12px;font-weight:750;padding:5px 4px;cursor:pointer}.gh-files-selectionbar label{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--adm-text);font-weight:750}.gh-files-selectionbar>div{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.gh-files-list{display:grid;gap:7px}.gh-file-card{display:grid;grid-template-columns:24px minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:9px 10px;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-surface);transition:border-color .15s,background .15s}.gh-file-card.selected{border-color:color-mix(in srgb,var(--adm-accent) 45%,var(--adm-border));background:color-mix(in srgb,var(--adm-accent) 3%,var(--adm-surface))}.gh-file-check{display:grid;place-items:center}.gh-file-main{min-width:0;border:0;background:transparent;padding:0;display:grid;grid-template-columns:34px minmax(0,1fr);gap:9px;align-items:center;text-align:left;color:var(--adm-text);cursor:pointer}.gh-file-icon{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;border:1px solid var(--adm-border);background:var(--adm-surface2);font-size:15px}.gh-file-icon.pasta{color:var(--adm-blue,var(--adm-accent))}.gh-file-copy{min-width:0;display:grid;gap:1px}.gh-file-copy b{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gh-file-copy small{font-size:11px;color:var(--adm-muted)}.gh-file-copy em{font-size:11px;color:var(--adm-muted);font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gh-file-meta{display:grid;justify-items:end;gap:2px}.gh-file-meta span{font-size:11px;color:var(--adm-muted)}.gh-file-meta code{font-size:11px;color:var(--adm-text);background:var(--adm-surface2);padding:2px 4px;border-radius:5px}.gh-file-row-actions{display:flex;gap:4px;align-items:center}.gh-file-icon-action{width:32px;height:32px;display:grid;place-items:center;padding:0;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);color:var(--adm-muted);font-size:14px;cursor:pointer}.gh-file-icon-action:hover{color:var(--adm-text);border-color:var(--adm-accent)}.gh-file-icon-action.danger{color:var(--adm-red)}.gh-files-empty{min-height:120px;display:grid;place-items:center;align-content:center;gap:4px;text-align:center;border:1px dashed var(--adm-border);border-radius:12px;color:var(--adm-muted);font-size:12px}.gh-files-empty b{font-size:11px;color:var(--adm-text)}.gh-files-empty.error{color:var(--adm-red)}.gh-file-detail{display:grid;gap:10px}.gh-file-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.gh-file-pathbox,.gh-file-history{display:grid;gap:4px;padding:10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2)}.gh-file-pathbox span,.gh-file-history>small{font-size:11px;font-weight:900;letter-spacing:.07em;color:var(--adm-muted)}.gh-file-pathbox code{font-size:12px;overflow-wrap:anywhere;color:var(--adm-text)}.gh-file-history b{font-size:12px;color:var(--adm-text)}.gh-file-history span{font-size:11px;color:var(--adm-muted)}.gh-file-history code{width:max-content;font-size:11px;color:var(--adm-accent)}.gh-file-detail-actions{display:flex;gap:7px;flex-wrap:wrap}.gh-file-preview{display:grid;border:1px solid var(--adm-border);border-radius:10px;overflow:hidden;background:var(--adm-surface)}.gh-file-preview>div{display:flex;justify-content:space-between;gap:8px;padding:7px 9px;border-bottom:1px solid var(--adm-border);background:var(--adm-surface2)}.gh-file-preview b{font-size:11px;color:var(--adm-text)}.gh-file-preview span{font-size:11px;color:var(--adm-muted)}.gh-file-preview pre{margin:0;max-height:260px;overflow:auto;padding:10px;font-size:11px;line-height:1.5;color:var(--adm-text);white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.gh-modal-link{display:inline-flex;align-items:center;min-height:32px;padding:0 9px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);color:var(--adm-accent);font-size:12px;font-weight:800;text-decoration:none}.gh-danger-summary{display:grid;gap:5px;padding:11px;border:1px solid color-mix(in srgb,var(--adm-red) 30%,var(--adm-border));border-radius:10px;background:color-mix(in srgb,var(--adm-red) 6%,var(--adm-surface))}.gh-danger-summary b{font-size:11px;color:var(--adm-red)}.gh-danger-summary span{font-size:11px;line-height:1.45;color:var(--adm-muted)}
        .gh-version-journey{display:grid;grid-template-columns:minmax(0,1fr) 28px minmax(0,1fr);gap:7px;align-items:center;padding:10px;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-surface2)}.gh-version-journey>div{min-width:0;display:grid;gap:2px}.gh-version-journey>div:last-child{text-align:right}.gh-version-journey small{font-size:11px;font-weight:900;letter-spacing:.07em;color:var(--adm-muted)}.gh-version-journey b{font-size:15px;color:var(--adm-text)}.gh-version-journey span{font-size:11px;color:var(--adm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gh-version-journey>i{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--adm-border);background:var(--adm-surface);font-style:normal;font-weight:900;color:var(--adm-accent)}.gh-version-journey.warn{border-color:color-mix(in srgb,var(--adm-amber) 35%,var(--adm-border))}.gh-version-journey.error{border-color:color-mix(in srgb,var(--adm-red) 35%,var(--adm-border))}.gh-preflight-banner{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:8px;align-items:center;padding:10px;border-radius:11px;border:1px solid var(--adm-border);background:var(--adm-surface2)}.gh-preflight-banner>span{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--adm-surface);font-weight:900}.gh-preflight-banner.ok{border-color:color-mix(in srgb,var(--adm-success) 35%,var(--adm-border))}.gh-preflight-banner.ok>span{color:var(--adm-success)}.gh-preflight-banner.error>span{color:var(--adm-red)}.gh-preflight-banner>div{display:grid;gap:2px}.gh-preflight-banner b{font-size:12px;color:var(--adm-text)}.gh-preflight-banner small{font-size:11px;line-height:1.35;color:var(--adm-muted)}.gh-preflight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.gh-preflight-check{display:grid;grid-template-columns:24px minmax(0,1fr);gap:7px;align-items:center;padding:8px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface)}.gh-preflight-check>span{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;background:var(--adm-surface2);font-weight:900}.gh-preflight-check.ok>span{color:var(--adm-success)}.gh-preflight-check.warn>span{color:var(--adm-amber)}.gh-preflight-check.error>span{color:var(--adm-red)}.gh-preflight-check div{min-width:0;display:grid;gap:1px}.gh-preflight-check b{font-size:11px;color:var(--adm-text)}.gh-preflight-check small{font-size:11px;color:var(--adm-muted);overflow-wrap:anywhere}.gh-preflight-warnings{display:grid;gap:3px;padding:9px;border-radius:9px;background:color-mix(in srgb,var(--adm-amber) 7%,var(--adm-surface));border:1px solid color-mix(in srgb,var(--adm-amber) 25%,var(--adm-border));font-size:11px;color:var(--adm-muted)}.gh-preflight-warnings b{color:var(--adm-amber);font-size:12px}.gh-live-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.gh-live-head h3{margin:0}.gh-live-head p{margin:3px 0 0;font-size:12px;color:var(--adm-muted)}.gh-live-progress{display:grid;gap:5px}.gh-live-progress>div{display:flex;justify-content:space-between;font-size:11px;color:var(--adm-muted)}.gh-live-progress b{color:var(--adm-text)}.gh-live-progress>i{height:7px;border-radius:999px;background:var(--adm-surface2);overflow:hidden}.gh-live-progress>i>em{display:block;height:100%;background:var(--adm-accent);border-radius:inherit;transition:width .25s}.gh-publish-monitor{display:grid;gap:10px;padding:14px;border:1px solid color-mix(in srgb,var(--adm-accent) 34%,var(--adm-border));border-radius:14px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));box-shadow:0 8px 24px rgba(15,23,42,.045)}.gh-publish-monitor.error{border-color:color-mix(in srgb,var(--adm-red) 42%,var(--adm-border))}.gh-publish-monitor-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.gh-publish-monitor-top>div{min-width:0;display:grid;gap:3px}.gh-publish-monitor-top small{font-size:11px;font-weight:900;letter-spacing:.1em;color:var(--adm-muted)}.gh-publish-monitor-top b{font-size:12px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gh-publish-monitor-top strong{font-size:28px;line-height:1;color:var(--adm-accent);font-variant-numeric:tabular-nums}.gh-publish-monitor.error .gh-publish-monitor-top strong{color:var(--adm-red)}.gh-publish-monitor-track{height:9px;border-radius:999px;overflow:hidden;background:var(--adm-bg);border:1px solid var(--adm-border)}.gh-publish-monitor-track i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--adm-accent),color-mix(in srgb,var(--adm-accent) 72%,white));transition:width .25s ease}.gh-publish-monitor.error .gh-publish-monitor-track i{background:var(--adm-red)}.gh-publish-monitor-current{min-width:0;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-bg)}.gh-publish-op{max-width:110px;padding:4px 6px;border-radius:7px;background:color-mix(in srgb,var(--adm-accent) 10%,var(--adm-surface));color:var(--adm-accent);font-size:11px;font-weight:900;font-style:normal;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gh-publish-monitor-current code{min-width:0;font-size:12px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gh-publish-monitor-current em{font-size:11px;font-style:normal;color:var(--adm-muted);white-space:nowrap}.gh-publish-monitor-stages{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}.gh-publish-monitor-stages span{min-width:0;padding:5px 4px;border-radius:7px;border:1px solid var(--adm-border);background:var(--adm-bg);text-align:center;font-size:11px;font-weight:850;color:var(--adm-muted)}.gh-publish-monitor-stages span.active{border-color:color-mix(in srgb,var(--adm-accent) 45%,var(--adm-border));color:var(--adm-accent)}.gh-publish-monitor-stages span.done{border-color:color-mix(in srgb,var(--adm-success) 35%,var(--adm-border));color:var(--adm-success);background:color-mix(in srgb,var(--adm-success) 5%,var(--adm-bg))}.gh-live-log{display:grid;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-surface);overflow:hidden;max-height:260px;overflow-y:auto}.gh-live-log-title{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;padding:8px 9px;border-bottom:1px solid var(--adm-border);background:var(--adm-surface2)}.gh-live-log-title b{font-size:12px;color:var(--adm-text)}.gh-live-log-title span{font-size:11px;color:var(--adm-muted)}.gh-log-line{display:grid;grid-template-columns:54px 18px minmax(0,1fr) auto;gap:6px;align-items:start;padding:7px 9px;border-bottom:1px solid var(--adm-border)}.gh-log-line:last-child{border-bottom:0}.gh-log-line time{font-size:11px;color:var(--adm-muted)}.gh-log-line>span{font-size:12px;font-weight:900;color:var(--adm-accent)}.gh-log-line.done>span{color:var(--adm-success)}.gh-log-line.error>span{color:var(--adm-red)}.gh-log-line.off>span{color:var(--adm-muted)}.gh-log-line>div{min-width:0;display:grid;gap:1px}.gh-log-line b{font-size:11px;color:var(--adm-text)}.gh-log-line small{font-size:11px;line-height:1.4;color:var(--adm-muted);overflow-wrap:anywhere}.gh-log-line>em{font-size:11px;font-style:normal;color:var(--adm-muted)}.gh-postcheck{display:grid;gap:5px}.gh-postcheck>b{font-size:12px;color:var(--adm-text)}.gh-postcheck>span{display:grid;grid-template-columns:20px 120px minmax(0,1fr);gap:6px;align-items:center;padding:7px 8px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface)}.gh-postcheck i{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;background:var(--adm-surface2);font-style:normal;font-weight:900}.gh-postcheck .ok i{color:var(--adm-success)}.gh-postcheck .warn i{color:var(--adm-amber)}.gh-postcheck .error i{color:var(--adm-red)}.gh-postcheck em{font-size:11px;font-style:normal;font-weight:800;color:var(--adm-text)}.gh-postcheck small{font-size:11px;color:var(--adm-muted);overflow-wrap:anywhere}
        .gh-review-compact,.gh-publish-minimal,.gh-result-minimal{min-height:0!important;display:grid;gap:10px;padding:2px 0}.gh-preflight-summary{grid-template-columns:30px minmax(0,1fr)!important;padding:10px 11px!important}.gh-preflight-summary small{font-size:12px!important}.gh-review-summary-line,.gh-result-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.gh-review-summary-line>span,.gh-result-summary>span{min-width:0;padding:8px 9px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2)}.gh-review-summary-line small,.gh-result-summary small{display:block;font-size:11px;letter-spacing:.08em;font-weight:900;color:var(--adm-muted)}.gh-review-summary-line b,.gh-result-summary b{display:block;margin-top:2px;font-size:12px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gh-compact-warning{padding:7px 9px;border-radius:8px;border:1px solid color-mix(in srgb,var(--adm-amber) 30%,var(--adm-border));background:color-mix(in srgb,var(--adm-amber) 7%,var(--adm-surface));font-size:11px;color:var(--adm-amber)}.gh-disclosure-button{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--adm-border);background:var(--adm-surface);color:var(--adm-text);border-radius:9px;padding:9px 10px;font-size:12px;font-weight:850;cursor:pointer}.gh-disclosure-button b{font-size:12px;color:var(--adm-muted)}.gh-disclosure-panel{display:grid;gap:8px;padding:9px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2)}.gh-review-detail-actions,.gh-events-actions{display:flex;justify-content:flex-end}.gh-publish-minimal .gh-publish-monitor{padding:12px;gap:9px}.gh-publish-minimal .gh-publish-monitor-current{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:8px 9px}.gh-publish-minimal .gh-publish-monitor-current code{font-size:12px}.gh-publish-minimal .gh-publish-monitor-current em{font-size:11px}.gh-publish-error-help{display:grid;gap:4px;padding:9px 10px;border:1px solid color-mix(in srgb,var(--adm-red) 34%,var(--adm-border));border-radius:9px;background:color-mix(in srgb,var(--adm-red) 5%,var(--adm-surface))}.gh-publish-error-help b{font-size:12px;color:var(--adm-red)}.gh-publish-error-help span{font-size:11px;color:var(--adm-text);line-height:1.4}.gh-publish-error-help small{font-size:11px;color:var(--adm-muted);line-height:1.4}.gh-events-panel{padding:7px}.gh-events-panel .gh-live-log{max-height:210px}.gh-events-panel .gh-log-line{grid-template-columns:48px 14px minmax(0,1fr);padding:6px 7px}.gh-events-panel .gh-log-line b{font-size:11px}.gh-events-panel .gh-log-line small{font-size:11px}.gh-result-hero{display:flex;align-items:center;gap:10px;padding:5px 1px}.gh-result-hero .gh-wizard-success-icon{margin:0!important;flex:0 0 auto;width:38px;height:38px}.gh-result-hero h3{margin:0;font-size:15px;color:var(--adm-text)}.gh-result-hero p{margin:3px 0 0;font-size:12px;color:var(--adm-muted)}.gh-result-summary{grid-template-columns:repeat(4,minmax(0,1fr))}.gh-result-details{padding:9px}.gh-result-details .gh-finish-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.gh-result-minimal .gh-postcheck{margin-top:2px}
        @media(max-width:980px){.gh-repo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.gh-download-strip{margin:0 12px 12px;display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2)}.gh-download-strip>div{min-width:0;display:grid;gap:2px}.gh-download-strip b{font-size:12px;color:var(--adm-text)}.gh-download-strip span{font-size:11px;color:var(--adm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gh-download-strip strong{font-size:12px;color:var(--adm-accent)}.gh-download-strip button{min-height:30px;padding:0 9px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface);color:var(--adm-text);font-size:11px;font-weight:850}.gh-download-strip.completed{border-color:color-mix(in srgb,var(--adm-success,#22c55e) 35%,var(--adm-border))}.gh-download-strip.failed{border-color:color-mix(in srgb,var(--adm-red) 35%,var(--adm-border))}.gh-result-events{max-height:220px;overflow:auto;border:1px solid var(--adm-border);border-radius:9px}
.gh-secrets-security{display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px;align-items:start;padding:9px 10px;margin-bottom:10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2)}.gh-secrets-security>span{width:28px;height:28px;display:grid;place-items:center;border-radius:8px;background:var(--adm-surface)}.gh-secrets-security div{display:grid;gap:2px}.gh-secrets-security b{font-size:12px;color:var(--adm-text)}.gh-secrets-security small{font-size:11px;line-height:1.4;color:var(--adm-muted)}.gh-secrets-list,.gh-run-list{display:grid;gap:6px}.gh-secret-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface)}
                @media(max-width:760px){.gh-repo-grid{grid-template-columns:1fr}.gh-filter-row{grid-template-columns:1fr 1fr}.gh-filter-row input{grid-column:1/-1}.gh-account-hero:after{right:-95px;top:-85px}.gh-repo-facts{grid-template-columns:repeat(3,minmax(0,1fr))}.gh-repo-drawer{width:100vw!important;border-left:0!important}.gh-repo-head{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:10px!important}.gh-repo-header-actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr)) auto!important;width:100%;gap:7px!important}.gh-repo-head-action{width:100%!important;min-width:0!important}.gh-artifacts-hero{grid-template-columns:auto minmax(0,1fr)}.gh-artifacts-stats{grid-column:1/-1;width:100%}.gh-artifacts-grid{grid-template-columns:1fr}.gh-github-summary{grid-template-columns:1fr}.gh-detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.gh-readme{padding:12px}.gh-readme h1{font-size:18px}.gh-readme h2{font-size:16px}.gh-command-title{align-items:flex-start}.gh-command-title>small{max-width:180px}.gh-command-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.gh-command-card{min-height:0;padding:10px 11px;grid-template-columns:36px minmax(0,1fr);align-items:center;gap:8px;border-radius:13px}.gh-command-card-icon{width:36px;height:36px;font-size:16px;border-radius:11px}.gh-command-card-copy b{font-size:12.5px}.gh-command-card-copy small{font-size:12px;line-height:1.3}.gh-repo-overview-strip{margin:12px 12px 18px}.gh-repo-overview-strip>div{padding:8px 6px;text-align:center}.gh-repo-overview-strip span{font-size:11px;letter-spacing:.04em}.gh-repo-overview-strip b{font-size:11px}.gh-more-menu{position:fixed;right:12px;top:132px}}

        .gh-repo-description{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:anywhere;min-height:0!important}
        .gh-commits-page{display:grid;gap:12px}.gh-commits-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,340px);align-items:end;gap:14px;padding:14px;border:1px solid var(--adm-border);border-radius:14px;background:linear-gradient(135deg,var(--adm-surface),var(--adm-surface2))}.gh-commits-head small{font-size:11px;font-weight:900;letter-spacing:.1em;color:var(--adm-accent)}.gh-commits-head h3{margin:3px 0 3px;font-size:17px}.gh-commits-head p{margin:0;color:var(--adm-muted);font-size:12px}.gh-commits-head input{width:100%;min-height:37px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface);color:var(--adm-text);padding:0 11px;font:500 12px var(--adm-font);outline:none}.gh-commit-list{display:grid;gap:8px}.gh-commit-card{border:1px solid var(--adm-border);border-radius:13px;background:var(--adm-surface);overflow:hidden}.gh-commit-card.open{border-color:color-mix(in srgb,var(--adm-accent) 28%,var(--adm-border))}.gh-commit-summary{width:100%;border:0;background:transparent;color:inherit;display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:start;padding:12px;text-align:left;cursor:pointer}.gh-commit-summary:hover{background:var(--adm-surface2)}.gh-commit-avatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:var(--adm-surface2);border:1px solid var(--adm-border);font-size:11px;font-weight:900}.gh-commit-avatar img{width:100%;height:100%;object-fit:cover}.gh-commit-main{min-width:0;display:grid;gap:3px}.gh-commit-main>b{font-size:11.5px;line-height:1.35;overflow-wrap:anywhere}.gh-commit-main>small{font-size:11px;color:var(--adm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gh-commit-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}.gh-commit-meta code{font:750 11px var(--adm-mono);color:var(--adm-accent);background:color-mix(in srgb,var(--adm-accent) 7%,var(--adm-surface2));padding:2px 5px;border-radius:5px}.gh-commit-meta em{font-style:normal;font-size:11px;color:var(--adm-muted)}.gh-commit-meta i{font-style:normal;font-size:11px;font-weight:800;color:var(--adm-success)}.gh-commit-chevron{color:var(--adm-muted);font-size:14px}.gh-commit-actions{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 10px 56px}.gh-commit-actions button,.gh-commit-actions a{border:1px solid var(--adm-border);background:var(--adm-surface2);color:var(--adm-muted);border-radius:7px;padding:5px 8px;text-decoration:none;font:750 11px var(--adm-font);cursor:pointer}.gh-commit-actions button:last-child{color:var(--adm-accent);border-color:color-mix(in srgb,var(--adm-accent) 24%,var(--adm-border))}.gh-commit-actions button:disabled{opacity:.65;cursor:wait}.gh-commit-download-progress{height:3px;background:var(--adm-surface2);overflow:hidden}.gh-commit-download-progress span{height:100%;display:block;background:var(--adm-accent);transition:width .3s ease}.gh-commit-detail{border-top:1px solid var(--adm-border);padding:11px 12px 12px;background:var(--adm-surface2);display:grid;gap:10px}.gh-commit-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.gh-commit-stats>div{padding:7px 8px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface)}.gh-commit-stats small{display:block;font-size:11px;color:var(--adm-muted);font-weight:850;letter-spacing:.05em}.gh-commit-stats b{display:block;margin-top:2px;font-size:12px}.gh-commit-stats .plus b,.gh-commit-files i{color:var(--adm-success)}.gh-commit-stats .minus b,.gh-commit-files em{color:var(--adm-red)}.gh-commit-message{margin:0;padding:9px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface);white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 var(--adm-mono);color:var(--adm-muted)}.gh-commit-files{display:grid;gap:4px}.gh-commit-files>a{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:7px;align-items:center;padding:6px 7px;border:1px solid var(--adm-border);border-radius:7px;background:var(--adm-surface);text-decoration:none;color:inherit}.gh-commit-files .status{width:20px;height:20px;display:grid;place-items:center;border-radius:5px;background:var(--adm-surface2);font:900 11px var(--adm-mono);color:var(--adm-muted)}.gh-commit-files .status.added{color:var(--adm-success)}.gh-commit-files .status.removed{color:var(--adm-red)}.gh-commit-files b{font:600 11px var(--adm-mono);overflow-wrap:anywhere}.gh-commit-files small{display:flex;gap:5px;font:750 11px var(--adm-mono)}.gh-commit-files i,.gh-commit-files em{font-style:normal}.gh-commit-loading,.gh-commit-empty{font-size:12px;color:var(--adm-muted);padding:8px}.gh-commit-more{justify-self:center;border:1px solid var(--adm-border);background:var(--adm-surface);color:var(--adm-text);border-radius:8px;padding:7px 12px;font:750 12px var(--adm-font);cursor:pointer}.gh-artifact-footer{position:relative}.gh-download-log{display:grid;gap:12px}.gh-download-log-summary{padding:11px 12px;border:1px solid color-mix(in srgb,var(--adm-success) 24%,var(--adm-border));border-radius:10px;background:color-mix(in srgb,var(--adm-success) 6%,var(--adm-surface2));display:grid;gap:4px}.gh-download-log-summary.error{border-color:color-mix(in srgb,var(--adm-red) 30%,var(--adm-border));background:color-mix(in srgb,var(--adm-red) 5%,var(--adm-surface2))}.gh-download-log-summary b{font-size:12px;color:var(--adm-text);line-height:1.45}.gh-download-log-summary small{font-size:11px;color:var(--adm-muted)}.gh-download-log-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.gh-download-log-grid>div{padding:8px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);min-width:0}.gh-download-log-grid span,.gh-download-log-block>span,.gh-download-log-files>span,.gh-download-log-next>span{display:block;font-size:11px;font-weight:900;letter-spacing:.05em;text-transform:uppercase;color:var(--adm-muted)}.gh-download-log-grid b{display:block;margin-top:3px;font:750 11px var(--adm-mono);color:var(--adm-text);overflow-wrap:anywhere}.gh-download-log-block,.gh-download-log-next{padding:10px 11px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2)}.gh-download-log-block.error{border-color:color-mix(in srgb,var(--adm-red) 28%,var(--adm-border))}.gh-download-log-block p,.gh-download-log-next p{margin:5px 0 0;font-size:12px;line-height:1.5;color:var(--adm-text);overflow-wrap:anywhere}.gh-download-log-next{border-color:color-mix(in srgb,var(--adm-accent) 28%,var(--adm-border));background:color-mix(in srgb,var(--adm-accent) 5%,var(--adm-surface2))}.gh-download-log-files{display:grid;gap:5px}.gh-download-log-files code{display:block;padding:6px 8px;border:1px solid var(--adm-border);border-radius:7px;background:var(--adm-surface2);font:11px/1.35 var(--adm-mono);color:var(--adm-text);overflow-wrap:anywhere}.gh-download-log-loading{padding:10px;border:1px dashed var(--adm-border);border-radius:9px;color:var(--adm-muted);font-size:12px}.gh-artifact-progress{grid-column:1/-1;height:3px;border-radius:99px;overflow:hidden;background:var(--adm-border)}.gh-artifact-progress span{display:block;height:100%;background:var(--adm-accent);transition:width .28s ease}
        @media(max-width:700px){.gh-commits-head{grid-template-columns:1fr}.gh-commit-actions{padding-left:12px}.gh-commit-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:520px){.gh-artifact-footer{grid-template-columns:1fr}.gh-download-actions{display:flex;width:100%}.gh-download-actions button{flex:1;width:auto;min-height:40px}.gh-download-log-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.gh-account-hero{padding:12px}.gh-profile-row{grid-template-columns:auto minmax(0,1fr)}.gh-profile-actions{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr}.gh-profile-actions>*{width:100%;justify-content:center}.gh-account-stats{margin-top:10px}.gh-account-stat{padding:8px 5px;text-align:center}.gh-account-stat span{font-size:11px;letter-spacing:.03em;min-height:18px;display:flex;align-items:center;justify-content:center}.gh-account-stat b{font-size:11px}.gh-profile-avatar{width:40px;height:40px}.gh-profile-meta h1{font-size:15px}.gh-profile-meta p{font-size:12px}.gh-repo-card{padding:13px}.gh-repo-footer{gap:7px}.gh-repo-apk-btn{margin-left:auto;padding:6px 8px;font-size:12px}.gh-repo-facts>div{padding:7px 5px}.gh-repo-facts span{font-size:11px;letter-spacing:.04em}.gh-repo-facts b{font-size:12px}.gh-profile-form-grid{grid-template-columns:1fr}.gh-profile-wide{grid-column:auto}.gh-profile-edit-head{align-items:flex-start;flex-wrap:wrap}.gh-external-btn{width:100%}.gh-overview-pair{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.gh-overview-card{padding:9px}.gh-overview-head{align-items:flex-start}.gh-overview-head b{font-size:12px}.gh-overview-body p{font-size:12px}.gh-compact-info{gap:4px}.gh-compact-info>div{padding:5px}.gh-compact-info b{font-size:11px}.gh-publish-intro{grid-template-columns:1fr}.gh-destination-pill{max-width:none}.gh-publish-grid,.gh-cloud-grid{grid-template-columns:1fr}.gh-two-fields{grid-template-columns:1fr 1fr}.gh-publish-card{padding:10px}.gh-publish-confirm{grid-template-columns:1fr}.gh-wizard-step{min-height:260px}.gh-wizard-progress-top{align-items:flex-start}.gh-wizard-progress-top span{text-align:right}.gh-wizard-dots{gap:3px}.gh-wizard-dots button{height:22px;padding:0}.gh-wizard-actions>*{flex:1;justify-content:center}.gh-command-title{display:grid;gap:5px}.gh-command-title>small{max-width:none;text-align:left}.gh-command-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px}.gh-command-card{min-width:0;min-height:80px;padding:6px 4px;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:5px;text-align:center}.gh-command-card-icon{width:30px;height:30px;flex:0 0 30px;font-size:14px;border-radius:50%}.gh-command-card-copy{width:100%;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px}.gh-command-card-copy b{width:100%;font-size:12px;line-height:1.12;overflow-wrap:anywhere}.gh-command-card-copy small{width:100%;font-size:11px;line-height:1.2;-webkit-line-clamp:2;overflow-wrap:anywhere}.gh-repo-status-card{padding:11px}.gh-repo-status-icon{width:31px;height:31px}.gh-repo-status-copy b{font-size:11px}.gh-repo-status-copy small{font-size:11px}.gh-run-card{flex-direction:column!important}.gh-run-actions{width:100%;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px!important}.gh-run-actions>*{width:100%;min-width:0;justify-content:center;white-space:nowrap;font-size:12px!important;padding-left:5px!important;padding-right:5px!important}.gh-log-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.gh-package-picker{grid-template-columns:34px minmax(0,1fr) auto;padding:9px;gap:7px}.gh-package-picker-icon{width:32px;height:32px;font-size:15px}.gh-package-picker-copy b{font-size:12px}.gh-package-picker-copy small{font-size:11px}.gh-package-picker-action{font-size:11px;padding:6px}.gh-option-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.gh-option-grid .gh-option-card:last-child{grid-column:1/-1}.gh-final-review-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.gh-dashboard-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.gh-dashboard-stage{grid-template-columns:24px minmax(0,1fr);padding:8px;gap:6px}.gh-dashboard-stage-icon{width:24px;height:24px}.gh-finish-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:620px){.gh-files-hero{grid-template-columns:1fr}.gh-files-hero-actions{display:grid;grid-template-columns:1fr 1fr}.gh-files-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.gh-files-toolbar{align-items:flex-start}.gh-files-selectionbar{align-items:flex-start;flex-direction:column}.gh-files-selectionbar>div{width:100%;justify-content:flex-start}.gh-file-card{grid-template-columns:22px minmax(0,1fr) auto}.gh-file-meta{grid-column:2/3;justify-items:start;display:flex;gap:5px}.gh-file-row-actions{grid-column:auto;display:flex;gap:4px}.gh-file-row-actions>*{width:32px;justify-content:center}.gh-file-card{grid-template-columns:22px minmax(0,1fr) auto auto}.gh-file-meta{grid-column:auto;justify-items:end;display:grid;gap:2px}.gh-preflight-banner{grid-template-columns:28px minmax(0,1fr)}.gh-preflight-banner>button{grid-column:1/-1;width:100%}.gh-preflight-grid{grid-template-columns:1fr}.gh-version-journey b{font-size:13px}.gh-log-line{grid-template-columns:44px 16px minmax(0,1fr)}.gh-log-line>em{display:none}.gh-postcheck>span{grid-template-columns:20px 90px minmax(0,1fr)}.gh-live-head{display:grid;grid-template-columns:1fr auto}.gh-publish-monitor{padding:12px}.gh-publish-monitor-top strong{font-size:24px}.gh-publish-monitor-current{grid-template-columns:auto minmax(0,1fr)}.gh-publish-monitor-current em{grid-column:1/-1;text-align:right}.gh-publish-op{max-width:86px}.gh-file-detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:620px){.gh-review-summary-line{grid-template-columns:repeat(3,minmax(0,1fr))}.gh-review-summary-line>span{padding:7px 6px}.gh-review-summary-line b{font-size:11px}.gh-result-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.gh-result-details .gh-finish-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.gh-publish-minimal .gh-publish-monitor-current{grid-template-columns:minmax(0,1fr) auto}.gh-publish-minimal .gh-publish-monitor-current em{grid-column:auto;text-align:right}.gh-postcheck>span{grid-template-columns:20px 78px minmax(0,1fr)}}
      `}</style>

      <PerfilGitHubModal
        open={showPerfil}
        status={status}
        onClose={() => setShowPerfil(false)}
        onSaved={() => recarregar()}
        toastShow={toastShow}
      />

      <section className="gh-account-hero">
        {status?.ok ? (
          <>
            <div className="gh-profile-row">
              {status.avatar ? <img src={status.avatar} alt={status.login} className="gh-profile-avatar" /> : <span style={{ color:C.accent }}><AdminIcon name="git" size={28} /></span>}
              <div className="gh-profile-meta">
                <div style={{ display:'flex', alignItems:'center', gap:7, minWidth:0, flexWrap:'wrap' }}>
                  <h1>{status.nome || status.login}</h1>
                  <DSBadge variant="green">conectado</DSBadge>
                </div>
                <p>@{status.login}{status.empresa ? ` · ${status.empresa}` : ''}{status.localizacao ? ` · ${status.localizacao}` : ''}</p>
                {status.bio && <p title={status.bio}>{status.bio}</p>}
              </div>
              <div className="gh-profile-actions">
                <DSBtn variant="secondary" size="sm" onClick={() => setShowPerfil(true)}>✎ Editar perfil</DSBtn>
                <DSBtn variant="secondary" size="sm" onClick={recarregar} loading={loading}><AdminIcon name="refresh" size={12} /> Atualizar</DSBtn>
              </div>
            </div>
            <div className="gh-account-stats">
              <div className="gh-account-stat"><span>REPOSITÓRIOS VISÍVEIS</span><b>{total}</b></div>
              <div className="gh-account-stat"><span>PÚBLICOS</span><b>{repos.filter(r => !r.privado).length}</b></div>
              <div className="gh-account-stat"><span>PRIVADOS</span><b>{repos.filter(r => r.privado).length}</b></div>
              <div className="gh-account-stat"><span>ATIVIDADE</span><b>{repos[0]?.ultimaAtualizacao ? relTime(repos[0].ultimaAtualizacao) : '—'}</b></div>
            </div>
          </>
        ) : (
          <div style={{ position:'relative', zIndex:1, display:'flex', justifyContent:'space-between', alignItems:'center', gap:SPACE.lg }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:SPACE.md }}><span style={{ color:C.accent }}><AdminIcon name="git" size={19} /></span><h1 className="adm-page-title" style={{ margin:0 }}>Central GitHub</h1></div>
              <span className="adm-page-sub">Código, publicação, automações e manutenção em uma única central.</span>
            </div>
            <DSBtn variant="secondary" size="sm" onClick={recarregar} loading={loading}><AdminIcon name="refresh" size={12} /> Atualizar</DSBtn>
          </div>
        )}
      </section>

      {!erro && !loading && status?.ok && (
        <button type="button" className="gh-new-project-launch" onClick={() => setNovoProjetoAberto(true)}>
          <span className="gh-new-project-launch-icon">＋</span>
          <span><b>Novo projeto GitHub</b><small>Crie o repositório, envie um ZIP e faça o primeiro commit em um assistente.</small></span>
          <span className="gh-new-project-launch-arrow">›</span>
        </button>
      )}

      {/* Filtros */}
      {!erro && !loading && (
        <div style={{ marginBottom:SPACE.lg, display:'flex', flexDirection:'column', gap:SPACE.md }}>
          <div className="gh-filter-row">
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar repositório, descrição, alias ou tag…"
              style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.md, padding:`${SPACE.md + 2}px ${SPACE.lg}px`, fontSize:FONT.base, color:C.text, outline:'none', minWidth:0 }} />
            <select value={filtroVis} onChange={e => setFiltroVis(e.target.value)}
              style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.md, padding:`${SPACE.md}px ${SPACE.md + 2}px`, fontSize:FONT.base, color:C.text }}>
              <option value="todos">Toda visibilidade</option>
              <option value="publicos">Públicos</option>
              <option value="privados">Privados</option>
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)}
              style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.md, padding:`${SPACE.md}px ${SPACE.md + 2}px`, fontSize:FONT.base, color:C.text }}>
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', gap:SPACE.sm, flexWrap:'wrap', alignItems:'center' }}>
            {FILTRO_STATUS.map(f => (
              <button key={f.value} title={f.value==='ativo'?'Push realizado nos últimos 90 dias e repositório não arquivado':undefined} onClick={() => setFiltroStatus(f.value)} style={{
                fontSize:FONT.sm, fontWeight:700, padding:`${SPACE.sm}px ${SPACE.md + 2}px`, borderRadius:RADIUS.pill,
                border:`1px solid ${filtroStatus === f.value ? C.accent : C.border}`,
                background:filtroStatus === f.value ? `${C.accent}14` : C.surface,
                color:filtroStatus === f.value ? C.text : C.muted, cursor:'pointer',
              }}>{f.label}</button>
            ))}
            <span style={{ fontSize:FONT.sm, color:C.muted, marginLeft:'auto' }}>{(busca.trim() || filtroStatus !== 'todos' || filtroVis !== 'todos') ? `${reposFiltrados.length} de ${total} ${total === 1 ? 'projeto' : 'projetos'}` : `${total} ${total === 1 ? 'projeto' : 'projetos'}`}</span>
          </div>
        </div>
      )}

      {/* Lista */}
      {erro ? (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: RADIUS.lg, padding: `${SPACE.xl2}px ${SPACE.xl3}px`, textAlign: 'center' }}>
          <div style={{ fontSize: FONT.md, fontWeight: 700, color: C.amber, marginBottom: SPACE.md }}>
            {erro.includes('GITHUB_TOKEN') ? 'Token GitHub não configurado' : 'Erro ao carregar repositórios'}
          </div>
          <div style={{ fontSize: FONT.base, color: C.muted, marginBottom: SPACE.lg }}>
            {erro.includes('GITHUB_TOKEN') ? 'Configure a credencial GitHub em Integrações e APIs.' : erro}
          </div>
          {!erro.includes('GITHUB_TOKEN') && (
            <DSBtn variant="secondary" size="sm" onClick={recarregar}>Tentar novamente</DSBtn>
          )}
        </div>
      ) : loading ? (
        <Skeleton />
      ) : reposFiltrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: `${SPACE.xl5}px ${SPACE.xl2}px`, color: C.muted, fontSize: FONT.md }}>
          {busca || filtroStatus !== 'todos' ? 'Nenhum repositório para esses filtros.' : 'Nenhum repositório disponível.'}
        </div>
      ) : (
        <div className="gh-repo-grid">
          {reposFiltrados.map(repo => <RepoCard key={repo.id} repo={repo} meta={metas[repo.id]} insight={insights[repo.id]} onAbrir={setRepoAberto} toastShow={toastShow} />)}
        </div>
      )}

      {repoAberto && <PainelDetalhes repo={repoAberto} onFechar={fecharPainel} toastShow={toastShow} />}
      {novoProjetoAberto && <NovoProjetoGitHubWizard status={status} onClose={() => setNovoProjetoAberto(false)} onCreated={() => recarregar()} />}
    </div>
  )
}
