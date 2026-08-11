/**
 * AdminGitHub.jsx — Painel Completo de Ciclo de Vida de Repositórios
 *
 * MIGRADO: DS Sprint (Fase 3)
 *   - Btn local (4 variantes)   → DSBtn
 *   - Secao local               → DSSectionTitle
 *   - showSalvar modal inline   → DSModal
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
import { projetosService }  from '../../services/domains/projetos.js'
import { T as C, SPACE, RADIUS, FONT } from '../../themes/tokens'
import AdminIcon            from '../../components/admin/ui/AdminIcon'
import { DSBtn, DSBadge, DSSectionTitle, DSModal } from '../../components/admin/ui/DS'

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
  skipped:     '#94a3b8',
  in_progress: C.blue,
  queued:      C.amber,
  waiting:     C.amber,
}

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
      boxShadow: '0 4px 20px #0008', maxWidth: 340,
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
  const label = conclusao || status || '?'
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

  const [deleteStep, setDeleteStep] = useState(0)
  const [deleteInput, setDeleteInput] = useState('')
  const [deletandoRepo, setDeletandoRepo] = useState(false)

  const [showRelease, setShowRelease] = useState(false)
  const [novaRelease, setNovaRelease] = useState({ tag: '', nome: '', descricao: '', preRelease: false, rascunho: false })
  const [criandoRelease, setCriandoRelease] = useState(false)

  const [metaDraft, setMetaDraft] = useState(null)
  const [salvandoMeta, setSalvandoMeta] = useState(false)

  const [showSalvar, setShowSalvar] = useState(false)
  const [nomeProjeto, setNomeProjeto] = useState('')
  const [substituir, setSubstituir] = useState(false)
  const [salvarEtapa, setSalvarEtapa] = useState(null)
  const [salvarErro, setSalvarErro] = useState(null)
  const [salvarNomeResultado, setSalvarNomeResultado] = useState(null)

  // ── Estado do painel Push (local → GitHub) ───────────────────
  const [pushMsg,    setPushMsg]    = useState('')
  const [pushBranch, setPushBranch] = useState('')
  const [pushStatus, setPushStatus] = useState('idle') // idle | running | success | error
  const [pushLinhas, setPushLinhas] = useState([])
  const [pushProg,   setPushProg]   = useState(0)
  const [pushEtapa,  setPushEtapa]  = useState(null)   // etapa atual do pipeline
  const [pushBlob,   setPushBlob]   = useState(null)   // { idx, total } durante criando_blobs
  const [pushResult, setPushResult] = useState(null)
  const pushLogRef                  = useRef(null)

  const [owner, repoNome] = (repo.nomeCompleto || `?/${repo.nome}`).split('/')

  useEffect(() => {
    githubService.getMeta(repo.id).then(m => {
      setMeta(m)
      setMetaDraft({ alias: m.alias || '', tags: (m.tags || []).join(', '), favorito: m.favorito, statusInterno: m.statusInterno || 'ativo', observacoes: m.observacoes || '', projetoLocal: m.projetoLocal || '' })
    }).catch(() => {})
    githubService.projetosLocais().then(d => setProjetosLocais(d.projetos || [])).catch(() => {})
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

  useEffect(() => { carregarAba(aba) }, [aba])

  const mudarAba = (a) => { setAba(a); setErroAba(null) }

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

  function abrirModalSalvar() {
    setNomeProjeto(repoNome); setSubstituir(false)
    setSalvarEtapa(null); setSalvarErro(null); setSalvarNomeResultado(null)
    setShowSalvar(true)
  }

  async function executarSalvarProjeto() {
    const nome = nomeProjeto.trim()
    if (!nome) return
    setSalvarEtapa('baixando'); setSalvarErro(null)
    try {
      const timer = setTimeout(() => setSalvarEtapa('extraindo'), 3500)
      const resultado = await githubService.salvarProjeto(owner, repoNome, nome, substituir)
      clearTimeout(timer)
      setSalvarEtapa('ok'); setSalvarNomeResultado(resultado.nomeProjeto)
    } catch (e) { setSalvarEtapa('erro'); setSalvarErro(e.message || 'Erro ao salvar projeto.') }
  }

  function iniciarPush() {
    if (!pushMsg.trim() || pushStatus === 'running') return
    setPushStatus('running'); setPushLinhas([]); setPushProg(0)
    setPushEtapa(null); setPushBlob(null); setPushResult(null)
    const q    = new URLSearchParams({ message: pushMsg.trim(), branch: pushBranch.trim() || '' })
    const base = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:3001/api' : '/api')
    // Usa o projetoLocal vinculado nos metadados (meta.projetoLocal) ou o nome do repo
    const projetoNome = meta?.projetoLocal || repoNome
    const url  = `${base}/projetos/${encodeURIComponent(projetoNome)}/commit-stream?${q}`
    const es   = new EventSource(url, { withCredentials: true })
    es.onmessage = e => {
      try {
        const ev = JSON.parse(e.data)
        if (ev.type === 'narration') {
          setPushLinhas(prev => { const next = [...prev, { msg: ev.msg, nivel: ev.nivel }]; setTimeout(() => pushLogRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' }), 30); return next })
        }
        if (ev.type === 'step') {
          setPushProg(ev.progresso || 0)
          setPushEtapa(ev.etapa || null)
          if (ev.etapa === 'criando_blobs' && ev.idx != null)
            setPushBlob({ idx: ev.idx, total: ev.total })
          else if (ev.etapa !== 'criando_blobs')
            setPushBlob(null)
        }
        if (ev.type === 'done')  { setPushStatus(ev.status); setPushResult(ev); es.close() }
      } catch {}
    }
    es.onerror = () => { setPushStatus('error'); es.close() }
  }

  const NOMES_ETAPA = { baixando: '⬇ Baixando código-fonte...', extraindo: '📦 Extraindo arquivos...', ok: '✅ Projeto salvo com sucesso!', erro: '❌ Erro ao salvar' }
  const ABAS = [
    { id:'visao', icon:'◈', label:'Visão geral', desc:'Status, README e informações', grupo:'Projeto' },
    { id:'meta', icon:'⌁', label:'Organização', desc:'Alias, tags e vínculo local', grupo:'Projeto' },
    { id:'analysis', icon:'◎', label:'Análise', desc:'Saúde e composição do código', grupo:'Projeto' },
    { id:'arquivos', icon:'▤', label:'Arquivos', desc:'Navegar, limpar e remover itens', grupo:'Código' },
    { id:'commits', icon:'⌘', label:'Commits', desc:'Histórico de alterações', grupo:'Código' },
    { id:'releases', icon:'◇', label:'Releases', desc:'Versões publicadas', grupo:'Código' },
    { id:'artifacts', icon:'□', label:'Artefatos', desc:'Arquivos gerados por Actions', grupo:'Código' },
    { id:'workflows', icon:'↯', label:'Workflows', desc:'Automações e execuções', grupo:'Automação' },
    { id:'secrets', icon:'◆', label:'Secrets', desc:'Segredos de Actions', grupo:'Automação' },
    { id:'push', icon:'↑', label:'Publicar', desc:'Enviar projeto local ao GitHub', grupo:'Automação', destaque:true },
    { id:'delete', icon:'×', label:'Excluir repositório', desc:'Zona de risco permanente', grupo:'Manutenção', perigo:true },
  ]
  const abaAtual = ABAS.find(a => a.id === aba) || ABAS[0]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: '#000a',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    }} onClick={e => e.target === e.currentTarget && onFechar()}>
      <div style={{
        width: 'min(640px, 100vw)', height: '100dvh',
        background: C.bg, borderLeft: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Header */}
        <div className="gh-repo-head" style={{
          padding: `${SPACE.xl}px ${SPACE.xl2}px`, borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.lg,
          position: 'sticky', top: 0, background: C.bg, zIndex: 10,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' }}>
              <span style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text, wordBreak: 'break-all' }}>{repo.nomeCompleto}</span>
              {meta?.favorito && <span style={{ fontSize: FONT.lg - 1 }}>⭐</span>}
              {meta?.statusInterno && meta.statusInterno !== 'ativo' && (
                <DSBadge style={{ color: STATUS_CFG[meta.statusInterno]?.cor, background: `${STATUS_CFG[meta.statusInterno]?.cor}18` }}>
                  {STATUS_CFG[meta.statusInterno]?.label}
                </DSBadge>
              )}
            </div>
            {meta?.alias && <div style={{ fontSize: FONT.sm, color: C.muted, marginTop: 2 }}>alias: {meta.alias}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexShrink: 0 }}>
            <a
              href={githubService.downloadZipUrl(owner, repoNome, repo?.default_branch)}
              download
              title={`Baixar código-fonte de ${owner}/${repoNome} como ZIP`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: SPACE.xs,
                fontSize: FONT.sm, fontWeight: 600, color: C.muted,
                background: C.surface2, border: `1px solid ${C.border}`,
                borderRadius: RADIUS.sm, padding: '5px 10px',
                textDecoration: 'none', transition: 'all .15s',
                flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.text }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                width="13" height="13">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              ZIP
            </a>
            <DSBtn variant="primary" size="sm" onClick={abrirModalSalvar}>📥 Salvar em Projetos</DSBtn>
            <DSBtn variant="ghost" size="icon" onClick={() => onFechar()}>✕</DSBtn>
          </div>
        </div>

        {/* Modal: Salvar em Projetos */}
        <DSModal
          open={showSalvar}
          onClose={() => { if (!salvarEtapa || salvarEtapa === 'ok' || salvarEtapa === 'erro') setShowSalvar(false) }}
          title="📥 Salvar em Projetos"
          size="sm"
          footer={
            salvarEtapa === 'ok' || salvarEtapa === 'erro'
              ? <>
                  {salvarEtapa === 'erro' && <DSBtn onClick={() => setSalvarEtapa(null)}>Tentar novamente</DSBtn>}
                  <DSBtn onClick={() => { setShowSalvar(false); setSalvarEtapa(null) }}>Fechar</DSBtn>
                </>
              : <>
                  <DSBtn variant="primary" onClick={executarSalvarProjeto}
                    disabled={!nomeProjeto.trim() || !!salvarEtapa} loading={!!salvarEtapa}>
                    📥 Salvar
                  </DSBtn>
                  <DSBtn onClick={() => setShowSalvar(false)} disabled={!!salvarEtapa}>Cancelar</DSBtn>
                </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
            <div style={{ fontSize: FONT.sm, color: C.muted }}>
              Baixa o código-fonte de{' '}
              <code style={{ fontSize: FONT.xs, background: C.surface, padding: `1px ${SPACE.xs}px`, borderRadius: RADIUS.xs }}>
                {repo.nomeCompleto}
              </code>
              {' '}e extrai na pasta Projetos do servidor.
            </div>

            {salvarEtapa && (
              <div style={{
                background: salvarEtapa === 'erro' ? C.redBg : `${C.accent}12`,
                border: `1px solid ${salvarEtapa === 'erro' ? C.redBorder : `${C.accent}40`}`,
                borderRadius: RADIUS.md, padding: `${SPACE.lg}px`,
                display: 'flex', alignItems: 'flex-start', gap: SPACE.md + 2,
              }}>
                {(salvarEtapa === 'baixando' || salvarEtapa === 'extraindo') && (
                  <svg style={{ flexShrink: 0, marginTop: 1, animation: 'adm-spin 1s linear infinite' }}
                    viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.5" width="16" height="16">
                    <path d="M21 12a9 9 0 11-18 0"/>
                  </svg>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: FONT.md, fontWeight: 700, color: salvarEtapa === 'erro' ? C.red : C.text }}>
                    {NOMES_ETAPA[salvarEtapa]}
                  </div>
                  {salvarEtapa === 'ok' && salvarNomeResultado && (
                    <div style={{ fontSize: FONT.sm, color: C.muted, marginTop: SPACE.xs, lineHeight: 1.5 }}>
                      Disponível em{' '}
                      <code style={{ background: C.surface, padding: `1px ${SPACE.xs}px`, borderRadius: RADIUS.xs, fontSize: FONT.xs }}>
                        projetos/{salvarNomeResultado}/
                      </code>
                      {' — '}
                      <a href="/admin/projetos" style={{ color: C.accent, fontWeight: 700, textDecoration: 'none' }}>Ver em Projetos →</a>
                    </div>
                  )}
                  {salvarEtapa === 'erro' && salvarErro && (
                    <div style={{ fontSize: FONT.sm, color: C.muted, marginTop: SPACE.xs, lineHeight: 1.5 }}>{salvarErro}</div>
                  )}
                </div>
              </div>
            )}

            {!salvarEtapa && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                  <label style={{ fontSize: FONT.sm, fontWeight: 700, color: C.muted, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                    Nome do projeto
                  </label>
                  <input
                    value={nomeProjeto}
                    onChange={e => setNomeProjeto(e.target.value.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 60))}
                    placeholder={repoNome} autoFocus
                    style={inp()}
                    onKeyDown={e => { if (e.key === 'Enter' && nomeProjeto.trim()) executarSalvarProjeto() }}
                  />
                  <div style={{ fontSize: FONT.xs, color: C.muted }}>
                    Será criado em{' '}
                    <code style={{ background: C.surface, padding: `1px ${SPACE.xs}px`, borderRadius: RADIUS.xs, fontSize: FONT.xs - 1 }}>
                      projetos/{nomeProjeto.trim() || repoNome}/
                    </code>
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: SPACE.md + 2, cursor: 'pointer' }}>
                  <input type="checkbox" checked={substituir} onChange={e => setSubstituir(e.target.checked)}
                    style={{ width: 14, height: 14, marginTop: 2, accentColor: C.accent, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: FONT.base, fontWeight: 600, color: C.text }}>Substituir se já existir</div>
                    <div style={{ fontSize: FONT.xs, color: C.muted, marginTop: 2 }}>Remove a pasta existente antes de extrair o novo conteúdo</div>
                  </div>
                </label>
              </>
            )}
          </div>
        </DSModal>

        {/* Ponte de comando — navegação por intenção */}
        <div className="gh-command-deck" style={{padding:`${SPACE.lg}px ${SPACE.xl2}px`,borderBottom:`1px solid ${C.border}`,position:'sticky',top:57,background:C.bg,zIndex:9}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:SPACE.md,marginBottom:SPACE.md}}>
            <div>
              <div style={{fontSize:10,fontWeight:900,letterSpacing:'.16em',textTransform:'uppercase',color:C.accent}}>Ponte de comando</div>
              <div style={{fontSize:FONT.sm,color:C.muted,marginTop:3}}>{abaAtual.grupo} · {abaAtual.label}</div>
            </div>
            <div style={{width:8,height:8,borderRadius:'50%',background:C.greenSolid,boxShadow:`0 0 0 5px ${C.greenSolid}18`}} title="Conectado ao GitHub" />
          </div>
          <div className="gh-command-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:8}}>
            {ABAS.map(a => (
              <button key={a.id} onClick={() => mudarAba(a.id)} className="gh-command-btn" style={{
                minWidth:0,textAlign:'left',padding:'10px 9px',borderRadius:RADIUS.md,cursor:'pointer',
                border:`1px solid ${aba===a.id?(a.perigo?C.red:a.destaque?C.greenSolid:C.accent):C.border}`,
                background:aba===a.id?(a.perigo?C.redBg:a.destaque?`${C.greenSolid}12`:`${C.accent}10`):C.surface,
                color:a.perigo?C.red:a.destaque?C.greenSolid:C.text,
              }}>
                <div style={{display:'flex',alignItems:'center',gap:7,minWidth:0}}><span style={{fontSize:16,fontWeight:900}}>{a.icon}</span><b style={{fontSize:11,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.label}</b></div>
                <small className="gh-command-desc" style={{display:'block',fontSize:9,color:C.muted,lineHeight:1.35,marginTop:5}}>{a.desc}</small>
              </button>
            ))}
          </div>
          <style>{`@media(max-width:720px){.gh-command-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.gh-command-desc{font-size:9px!important}.gh-command-deck{position:relative!important;top:auto!important}.gh-repo-head{position:relative!important;top:auto!important}.gh-file-row{grid-template-columns:minmax(0,1fr)!important}.gh-file-actions{justify-content:flex-end!important}.gh-clean-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}}`}</style>
        </div>

        {/* Conteúdo */}
        <div style={{ padding: SPACE.xl2, flex: 1 }}>
          {loadingAba ? (
            <div style={{ textAlign: 'center', padding: `${SPACE.xl5}px 0`, color: C.muted, fontSize: FONT.base }}>Carregando...</div>
          ) : erroAba ? (
            <div style={{ textAlign: 'center', padding: `${SPACE.xl5}px 0`, color: C.amber, fontSize: FONT.base }}>{erroAba}</div>
          ) : (
            <>
              {aba === 'visao'     && <AbaVisao repo={repo} readme={readme} />}
              {aba === 'meta'      && metaDraft && <AbaMeta metaDraft={metaDraft} setMetaDraft={setMetaDraft} projetosLocais={projetosLocais} salvandoMeta={salvandoMeta} onSalvar={salvarMeta} />}
              {aba === 'commits'   && <AbaCommits commits={commits} owner={owner} repo={repoNome} />}
              {aba === 'releases'  && <AbaReleases releases={releases} showRelease={showRelease} setShowRelease={setShowRelease} novaRelease={novaRelease} setNovaRelease={setNovaRelease} onCriar={criarRelease} criandoRelease={criandoRelease} />}
              {aba === 'artifacts' && <AbaArtifacts artifacts={artifacts} owner={owner} repo={repoNome} />}
              {aba === 'arquivos'  && <AbaArquivos owner={owner} repo={repoNome} branch={repo.branch || repo.default_branch || 'main'} toastShow={toastShow} />}
              {aba === 'analysis'  && <AbaAnalysis analysis={analysis} />}
              {aba === 'secrets'   && <AbaSecrets secrets={secrets} owner={owner} repo={repoNome} onRefresh={() => { setSecrets(null); carregarAba('secrets') }} toastShow={toastShow} />}
              {aba === 'workflows' && <AbaWorkflows workflows={workflows} owner={owner} repo={repoNome} toastShow={toastShow} />}
              {aba === 'delete'    && <AbaDelete repo={repo} repoNome={repoNome} deleteStep={deleteStep} setDeleteStep={setDeleteStep} deleteInput={deleteInput} setDeleteInput={setDeleteInput} onConfirmar={confirmarDelete} deletandoRepo={deletandoRepo} />}
              {aba === 'push'      && <AbaPush
                repo={repo} owner={owner} repoNome={repoNome}
                meta={meta}
                pushMsg={pushMsg} setPushMsg={setPushMsg}
                pushBranch={pushBranch} setPushBranch={setPushBranch}
                pushStatus={pushStatus} pushLinhas={pushLinhas}
                pushProg={pushProg} pushEtapa={pushEtapa} pushBlob={pushBlob}
                pushResult={pushResult}
                pushLogRef={pushLogRef}
                onIniciar={iniciarPush}
                onReset={() => { setPushStatus('idle'); setPushLinhas([]); setPushProg(0); setPushEtapa(null); setPushBlob(null); setPushResult(null) }}
              />}
            </>
          )}
        </div>
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
  const [alvo, setAlvo] = useState(null)
  const [confirmacao, setConfirmacao] = useState('')
  const [apagando, setApagando] = useState(false)
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
  const abrir = item => item.tipo === 'pasta' ? carregar(item.path) : window.open(item.url,'_blank','noopener,noreferrer')
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

  const crumbParts = pathAtual ? pathAtual.split('/') : []
  return <div>
    <div style={{padding:SPACE.xl,border:`1px solid ${C.border}`,borderRadius:RADIUS.lg,background:`linear-gradient(145deg,${C.surface2},${C.surface})`,marginBottom:SPACE.lg,position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',right:-28,top:-38,width:120,height:120,borderRadius:'50%',border:`1px solid ${C.accent}18`,boxShadow:`0 0 0 22px ${C.accent}08`}} />
      <div style={{position:'relative',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:SPACE.lg,flexWrap:'wrap'}}>
        <div style={{minWidth:0,flex:'1 1 260px'}}>
          <div style={{fontSize:10,fontWeight:900,letterSpacing:'.16em',textTransform:'uppercase',color:C.accent}}>Sistema de arquivos remoto</div>
          <div style={{fontWeight:850,color:C.text,fontSize:FONT.lg,marginTop:5}}>Código sob controle</div>
          <div style={{fontSize:FONT.sm,color:C.muted,marginTop:5,lineHeight:1.55}}>Navegue pela branch <b style={{color:C.text}}>{branch}</b>, remova itens manualmente ou deixe o AL Sistemas localizar resíduos de execução que nunca deveriam ter sido publicados.</div>
        </div>
        <DSBtn variant="primary" onClick={analisarLimpeza}>◎ Analisar resíduos</DSBtn>
      </div>
    </div>

    <div style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',marginBottom:SPACE.md,padding:'8px 10px',border:`1px solid ${C.border}`,borderRadius:RADIUS.md,background:C.surface}}>
      <DSBtn size="sm" onClick={()=>carregar('')}>⌂ Raiz</DSBtn>
      {crumbParts.map((part,i)=>{const p=crumbParts.slice(0,i+1).join('/');return <button key={p} onClick={()=>carregar(p)} style={{border:0,background:'none',color:C.accent,cursor:'pointer',fontSize:FONT.sm,padding:2}}>/ {part}</button>})}
      <span style={{flex:1}} />
      {pathAtual&&<DSBtn size="sm" variant="ghost" onClick={subir}>← Subir</DSBtn>}
      <DSBtn size="sm" variant="ghost" onClick={()=>carregar(pathAtual)}>↻</DSBtn>
    </div>

    {loading ? <Skeleton n={4}/> : erro ? <div style={{padding:SPACE.xl,color:C.red}}>{erro}</div> : itens.length===0 ? <div style={{padding:SPACE.xl3,color:C.muted,textAlign:'center',border:`1px dashed ${C.border}`,borderRadius:RADIUS.lg}}>Esta pasta está vazia.</div> :
      <div style={{display:'grid',gap:8}}>{itens.map(item=><div key={item.path} className="gh-file-row" style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:SPACE.md,alignItems:'center',padding:`${SPACE.md+2}px ${SPACE.lg}px`,border:`1px solid ${C.border}`,borderRadius:RADIUS.md,background:C.surface}}>
        <button onClick={()=>abrir(item)} style={{minWidth:0,border:0,background:'none',padding:0,textAlign:'left',cursor:'pointer',color:C.text,display:'flex',gap:SPACE.md,alignItems:'center'}}>
          <span style={{width:34,height:34,borderRadius:10,display:'grid',placeItems:'center',fontSize:17,flexShrink:0,background:item.tipo==='pasta'?`${C.blue}12`:`${C.accent}10`,border:`1px solid ${item.tipo==='pasta'?C.blue:C.accent}22`}}>{item.tipo==='pasta'?'▰':'▤'}</span>
          <span style={{minWidth:0}}><b style={{display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.nome}</b><small style={{color:C.muted}}>{item.tipo==='pasta'?'Pasta do repositório':fmtBytes(item.tamanho)}</small></span>
        </button>
        <div className="gh-file-actions" style={{display:'flex',gap:6}}><DSBtn size="sm" variant="danger" onClick={()=>solicitarApagar(item)}>Apagar</DSBtn></div>
      </div>)}</div>}

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

function AbaVisao({ repo, readme }) {
  return (
    <div>
      <DSSectionTitle style={{ marginBottom: SPACE.lg }}>Informações do Repositório</DSSectionTitle>
      <div className="gh-detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: SPACE.md + 2, marginBottom: SPACE.xl2 }}>
        {[
          { label: 'Linguagem',  val: repo.linguagem || '—' },
          { label: 'Branch',     val: repo.branch    || '—' },
          { label: 'Stars',      val: `★ ${repo.stars}` },
          { label: 'Forks',      val: `⑂ ${repo.forks}` },
          { label: 'Issues',     val: `● ${repo.issues}` },
          { label: 'Criado em',  val: repo.criadoEm ? new Date(repo.criadoEm).toLocaleDateString('pt-BR') : '—' },
          { label: 'Atualizado', val: relTime(repo.ultimaAtualizacao) },
          { label: 'Tamanho',    val: repo.tamanho ? `${repo.tamanho} KB` : '—' },
        ].map(item => (
          <div key={item.label} style={{
            background: C.surface, borderRadius: RADIUS.md, padding: `${SPACE.md + 2}px 14px`, border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: FONT.xs, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: SPACE.xs }}>{item.label}</div>
            <div style={{ fontSize: FONT.md, fontWeight: 700, color: C.text }}>{item.val}</div>
          </div>
        ))}
      </div>
      {repo.descricao && <div style={{ fontSize: FONT.base, color: C.muted, lineHeight: 1.6, marginBottom: SPACE.lg }}>{repo.descricao}</div>}
      {repo.temas?.length > 0 && (
        <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap', marginBottom: SPACE.lg }}>
          {repo.temas.map(t => <DSBadge key={t} variant="blue">{t}</DSBadge>)}
        </div>
      )}
      <a href={repo.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: FONT.sm, color: C.blue, textDecoration: 'none' }}>
        🔗 Abrir no GitHub →
      </a>

      <DSSectionTitle style={{ marginTop: SPACE.xl3, marginBottom: SPACE.lg }}>README</DSSectionTitle>
      {readme === null ? (
        <div style={{ fontSize: FONT.base, color: C.muted }}>Sem README.</div>
      ) : readme?.conteudo ? (
        <pre style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
          padding: `14px`, fontSize: FONT.sm, color: C.text,
          lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 320, overflowY: 'auto',
        }}>{readme.conteudo.slice(0, 4000)}{readme.conteudo.length > 4000 ? '\n\n[...truncado]' : ''}</pre>
      ) : (
        <div style={{ fontSize: FONT.base, color: C.muted }}>Carregando README...</div>
      )}
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
            <div style={{ fontSize: FONT.sm, color: C.muted, marginBottom: SPACE.xs, fontWeight: 600 }}>Vínculo com projeto local</div>
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
function AbaCommits({ commits, owner, repo }) {
  if (!commits) return <div style={{ fontSize: FONT.base, color: C.muted }}>Carregando...</div>
  if (commits.length === 0) return <div style={{ fontSize: FONT.base, color: C.muted }}>Sem commits encontrados.</div>
  return (
    <>
      <DSSectionTitle style={{ marginBottom: SPACE.lg }}>Commits recentes ({commits.length})</DSSectionTitle>
      <div style={{ display: 'grid', gap: SPACE.md }}>
        {commits.map((c, i) => (
          <div key={i} style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: RADIUS.md, padding: `${SPACE.md + 2}px 14px`,
            display: 'flex', gap: SPACE.md + 2, alignItems: 'flex-start',
          }}>
            {c.avatar && (
              <img src={c.avatar} alt={c.autor}
                style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, marginTop: 2 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: FONT.base, color: C.text,
                fontWeight: 600, wordBreak: 'break-word', lineHeight: 1.4,
              }}>
                {c.mensagem}
              </div>
              <div style={{
                fontSize: FONT.xs, color: C.muted, marginTop: 3,
                display: 'flex', gap: SPACE.md, flexWrap: 'wrap', alignItems: 'center',
              }}>
                <a
                  href={c.url} target="_blank" rel="noopener noreferrer"
                  title="Abrir commit no GitHub"
                  style={{ fontFamily: 'monospace', color: C.blue, textDecoration: 'none' }}
                >
                  {c.sha}
                </a>
                <span>{c.autor}</span>
                <span>{relTime(c.data)}</span>
              </div>
            </div>

            {/* Download do código neste commit */}
            {owner && repo && c.shaFull && (
              <a
                href={githubService.downloadZipUrl(owner, repo, c.shaFull)}
                download
                title={`Baixar código-fonte no commit ${c.sha}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  flexShrink: 0, alignSelf: 'center',
                  fontSize: FONT.xs, fontWeight: 700, color: C.muted,
                  background: C.surface2, border: `1px solid ${C.border}`,
                  borderRadius: RADIUS.sm, padding: '4px 8px',
                  textDecoration: 'none', transition: 'all .15s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = C.accent
                  e.currentTarget.style.color = C.text
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = C.border
                  e.currentTarget.style.color = C.muted
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  width="11" height="11">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                ZIP
              </a>
            )}
          </div>
        ))}
      </div>
    </>
  )
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
function AbaArtifacts({ artifacts, owner, repo }) {
  if (!artifacts) return <div style={{ fontSize: FONT.base, color: C.muted }}>Carregando...</div>
  return (
    <>
      <DSSectionTitle style={{ marginBottom: SPACE.lg }}>Artefatos de Build ({artifacts.length})</DSSectionTitle>
      {artifacts.length === 0 ? (
        <div style={{ fontSize: FONT.base, color: C.muted }}>Nenhum artefato encontrado. Artefatos são gerados pelo GitHub Actions (CI/CD).</div>
      ) : (
        <div style={{ display: 'grid', gap: SPACE.md }}>
          {artifacts.map(a => (
            <div key={a.id} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: `${SPACE.lg}px 14px`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.lg, flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: FONT.base, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                  📦 {a.nome}
                  {a.expirado     && <DSBadge variant="red">EXPIRADO</DSBadge>}
                  {/apk/i.test(a.nome) && <DSBadge variant="green">APK</DSBadge>}
                </div>
                <div style={{ fontSize: FONT.xs, color: C.muted, marginTop: 3, display: 'flex', gap: SPACE.md }}>
                  <span>{fmtBytes(a.tamanho)}</span>
                  <span>criado {relTime(a.criadoEm)}</span>
                  {a.expiradoEm && <span>expira {new Date(a.expiradoEm).toLocaleDateString('pt-BR')}</span>}
                  {a.workflowRunId && <span style={{ color: C.muted }}>Run #{a.workflowRunId}</span>}
                </div>
              </div>
              {!a.expirado && (
                <a href={githubService.downloadArtifactUrl(a.id, owner, repo, a.nome)}
                  style={{
                    fontSize: FONT.sm, fontWeight: 600, color: '#fff',
                    background: 'var(--adm-accent)', borderRadius: RADIUS.sm,
                    padding: `${SPACE.xs + 1}px ${SPACE.lg}px`, textDecoration: 'none', whiteSpace: 'nowrap',
                  }}>
                  ⬇ Baixar {/apk/i.test(a.nome) ? 'APK' : 'ZIP'}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/* ── ABA: Análise ────────────────────────────────────────── */
function AbaAnalysis({ analysis: an }) {
  if (!an) return <div style={{ fontSize: FONT.base, color: C.muted }}>Carregando análise...</div>
  const badge = (label, cor) => (
    <DSBadge style={{ color: cor, background: `${cor}18`, borderColor: `${cor}30` }}>{label}</DSBadge>
  )
  return (
    <div>
      <DSSectionTitle style={{ marginBottom: SPACE.lg }}>Stack Detectada</DSSectionTitle>
      {an.stack?.length > 0
        ? <div style={{ display: 'flex', gap: SPACE.md, flexWrap: 'wrap', marginBottom: SPACE.xl3 }}>{an.stack.map(s => <LangBadge key={s} lang={s} size={12} />)}</div>
        : <span style={{ fontSize: FONT.base, color: C.muted }}>Stack não identificada</span>}

      <DSSectionTitle style={{ marginBottom: SPACE.lg }}>Indicadores</DSSectionTitle>
      <div className="gh-detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: SPACE.md + 2, marginBottom: SPACE.xl3 }}>
        {[
          { label: 'Maturidade',       content: <>{badge(an.maturidade, MATURIDADE_COR[an.maturidade] || C.muted)}<div style={{ fontSize: FONT.xs, color: C.muted, marginTop: SPACE.xs }}>{an.diasSemAtividade}d sem atividade</div></> },
          { label: 'Commits recentes', content: badge(an.frequenciaCommits, FREQ_COR[an.frequenciaCommits] || C.muted) },
          { label: 'Complexidade',     content: badge(an.complexidade, C.text) },
          { label: 'Arquivos raiz',    content: <span style={{ fontSize: FONT.lg - 1, fontWeight: 700, color: C.text }}>{an.totalArquivos}</span> },
        ].map(({ label, content }) => (
          <div key={label} style={{ background: C.surface, borderRadius: RADIUS.md, padding: `${SPACE.lg}px 14px`, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: FONT.xs, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: SPACE.sm }}>{label}</div>
            {content}
          </div>
        ))}
      </div>

      <DSSectionTitle style={{ marginBottom: SPACE.lg }}>Features Detectadas</DSSectionTitle>
      <div style={{ display: 'flex', gap: SPACE.md, flexWrap: 'wrap', marginBottom: SPACE.xl3 }}>
        {[
          { ok: an.hasCI,      label: 'CI/CD',   icone: '⚙' },
          { ok: an.hasDocker,  label: 'Docker',  icone: '🐳' },
          { ok: an.hasTestes,  label: 'Testes',  icone: '✅' },
          { ok: an.temLicense, label: 'Licença', icone: '📄' },
        ].map(f => (
          <DSBadge key={f.label} variant={f.ok ? 'green' : 'gray'}>{f.icone} {f.label}</DSBadge>
        ))}
      </div>

      {an.linguagens && Object.keys(an.linguagens).length > 0 && (
        <>
          <DSSectionTitle style={{ marginBottom: SPACE.lg }}>Distribuição de Linguagens</DSSectionTitle>
          {(() => {
            const total = Object.values(an.linguagens).reduce((a, b) => a + b, 0)
            return Object.entries(an.linguagens).sort(([, a], [, b]) => b - a).map(([lang, bytes]) => {
              const pct = ((bytes / total) * 100).toFixed(1)
              const cor = LANG_COR[lang] || C.muted
              return (
                <div key={lang} style={{ marginBottom: SPACE.md }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: FONT.sm, color: C.text, fontWeight: 600 }}>{lang}</span>
                    <span style={{ fontSize: FONT.xs, color: C.muted }}>{pct}%</span>
                  </div>
                  <div style={{ height: 5, background: C.surface, borderRadius: RADIUS.xs, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: cor, borderRadius: RADIUS.xs }} />
                  </div>
                </div>
              )
            })
          })()}
        </>
      )}

      {an.dependencias?.length > 0 && (
        <>
          <DSSectionTitle style={{ marginTop: SPACE.xl2, marginBottom: SPACE.lg }}>Dependências Principais</DSSectionTitle>
          <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
            {an.dependencias.map(d => (
              <span key={d} style={{ fontSize: FONT.xs, background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS.xs, padding: `3px ${SPACE.md}px`, color: C.text, fontFamily: 'monospace' }}>{d}</span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ── ABA: Excluir ────────────────────────────────────────── */

/* ── ABA: Push (local → GitHub) ──────────────────────────── */
function AbaPush({
  repo, owner, repoNome, meta,
  pushMsg, setPushMsg, pushBranch, setPushBranch,
  pushStatus, pushLinhas, pushProg, pushEtapa, pushBlob, pushResult,
  pushLogRef, onIniciar, onReset,
}) {
  const projetoLocal = meta?.projetoLocal || repoNome
  const isRunning    = pushStatus === 'running'
  const isDone       = pushStatus === 'success' || pushStatus === 'error'

  const NIVEL_COR = { info: C.muted, warn: C.amber, error: C.red, success: C.greenSolid }

  const LABEL_ETAPA = {
    verificando_vinculo: 'Verificando vínculo…',
    consultando_github:  'Consultando GitHub…',
    listando_arquivos:   'Listando arquivos…',
    criando_blobs:       pushBlob
      ? `Enviando arquivos — ${pushBlob.idx} de ${pushBlob.total}`
      : 'Enviando arquivos (blobs)…',
    criando_tree:        'Criando tree…',
    criando_commit:      'Criando objeto de commit…',
    atualizando_ref:     'Fazendo push para o GitHub…',
    registrando:         'Registrando metadados…',
    concluido:           'Concluído!',
  }

  const labelEtapa = pushStatus === 'success' ? '✓ Commit realizado com sucesso!'
    : pushStatus === 'error'   ? '✗ Erro no push'
    : (LABEL_ETAPA[pushEtapa] || 'Iniciando pipeline…')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
      <DSSectionTitle>⬆ Push: local → GitHub</DSSectionTitle>

      {/* Info do repo destino */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md,
        background: C.surface2, border: `1px solid ${C.border}`,
        borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg}px` }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill={C.muted}>
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FONT.base, fontWeight: 700, color: C.text }}>{owner}/{repoNome}</div>
          <div style={{ fontSize: FONT.xs, color: C.muted }}>
            Projeto local: <code style={{ fontFamily: 'monospace' }}>{projetoLocal}</code>
            {' · '}branch: <code style={{ fontFamily: 'monospace' }}>{repo.default_branch || 'main'}</code>
          </div>
        </div>
        <a href={`https://github.com/${owner}/${repoNome}`} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: FONT.xs, color: C.blue, textDecoration: 'none', fontWeight: 600 }}>
          Ver ↗
        </a>
      </div>

      {/* Aviso */}
      {!meta?.projetoLocal && (
        <div style={{ background: `${C.amber}10`, border: `1px solid ${C.amber}30`,
          borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg}px`,
          fontSize: FONT.sm, color: C.amber, lineHeight: 1.5 }}>
          ⚠ Nenhum projeto local vinculado a este repositório.
          Vá em <strong>Metadados → Projeto Local</strong> para vincular.
          Usando <code style={{ fontFamily: 'monospace' }}>{repoNome}</code> como fallback.
        </div>
      )}

      {/* Formulário — só quando idle */}
      {pushStatus === 'idle' && (
        <>
          <div style={{ background: `${C.amber}0d`, border: `1px solid ${C.amber}28`,
            borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg}px`,
            fontSize: FONT.sm, color: C.amber, lineHeight: 1.6 }}>
            Envia <strong>todos os arquivos locais</strong> de{' '}
            <code style={{ fontFamily: 'monospace', fontSize: FONT.xs }}>{projetoLocal}/</code>{' '}
            para o repositório usando a Git Data API.
            Pastas <code style={{ fontFamily: 'monospace', fontSize: FONT.xs }}>node_modules</code>,{' '}
            <code style={{ fontFamily: 'monospace', fontSize: FONT.xs }}>dist</code> e{' '}
            <code style={{ fontFamily: 'monospace', fontSize: FONT.xs }}>.env</code> são ignoradas.
          </div>

          {/* Mensagem do commit */}
          <div>
            <label style={{ fontSize: FONT.xs, fontWeight: 700, color: C.muted, display: 'block',
              marginBottom: SPACE.sm, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Mensagem do commit *
            </label>
            <textarea
              value={pushMsg}
              onChange={e => setPushMsg(e.target.value.slice(0, 4096))}
              placeholder="feat: atualização do projeto"
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical',
                background: C.surface2, border: `1.5px solid ${pushMsg.trim() ? C.blue : C.border}`,
                borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`,
                fontSize: FONT.base, color: C.text, fontFamily: 'monospace', outline: 'none',
                transition: 'border-color .15s' }}
            />
            <div style={{ fontSize: FONT.xs, color: C.muted, textAlign: 'right', marginTop: 2 }}>
              {pushMsg.length}/4096
            </div>
          </div>

          {/* Branch destino */}
          <div>
            <label style={{ fontSize: FONT.xs, fontWeight: 700, color: C.muted, display: 'block',
              marginBottom: SPACE.sm, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Branch <span style={{ fontWeight: 400 }}>(opcional — padrão: {repo.default_branch || 'main'})</span>
            </label>
            <input type="text" value={pushBranch}
              onChange={e => setPushBranch(e.target.value.replace(/\s/g, ''))}
              placeholder={repo.default_branch || 'main'}
              style={{ width: '100%', boxSizing: 'border-box',
                background: C.surface2, border: `1px solid ${C.border}`,
                borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`,
                fontSize: FONT.base, color: C.text, fontFamily: 'monospace', outline: 'none' }}
            />
          </div>

          <DSBtn
            variant="primary"
            onClick={onIniciar}
            disabled={!pushMsg.trim()}
            style={{ alignSelf: 'flex-start', background: C.greenSolid,
              borderColor: C.greenSolid, minWidth: 180 }}>
            ⬆ Fazer Commit & Push
          </DSBtn>
        </>
      )}

      {/* Painel de progresso */}
      {pushStatus !== 'idle' && (
        <>
          {/* Barra + percentual + label */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            {/* Linha: label à esq, percentual à dir */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, minWidth: 0 }}>
                {isRunning && (
                  <svg style={{ animation: 'adm-spin 1s linear infinite', flexShrink: 0 }}
                    viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2.5" width="13" height="13">
                    <path d="M21 12a9 9 0 11-18 0"/>
                  </svg>
                )}
                <span style={{
                  fontSize: FONT.sm, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  color: pushStatus === 'error' ? C.red : pushStatus === 'success' ? C.greenSolid : C.blue,
                }}>
                  {labelEtapa}
                </span>
              </div>
              {/* Percentual numérico */}
              <span style={{
                fontSize: FONT.xs, fontWeight: 800, flexShrink: 0,
                color: pushStatus === 'error' ? C.red : pushStatus === 'success' ? C.greenSolid : C.blue,
                minWidth: 36, textAlign: 'right',
              }}>
                {pushProg}%
              </span>
            </div>

            {/* Barra de progresso */}
            <div style={{ height: 7, background: C.surface2, borderRadius: RADIUS.xs, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: RADIUS.xs, width: `${pushProg}%`,
                background: pushStatus === 'error'   ? C.red
                  : pushStatus === 'success' ? C.greenSolid
                  : `linear-gradient(90deg, ${C.blue}, ${C.accent})`,
                transition: 'width .4s ease, background .3s',
              }} />
            </div>

            {/* Mini-contador de arquivos (só durante criando_blobs) */}
            {isRunning && pushEtapa === 'criando_blobs' && pushBlob && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: SPACE.md,
                background: `${C.blue}0c`, border: `1px solid ${C.blue}22`,
                borderRadius: RADIUS.sm, padding: `${SPACE.xs}px ${SPACE.md}px`,
              }}>
                {/* Mini-barra de arquivo */}
                <div style={{ flex: 1, height: 3, background: C.surface2, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    width: `${Math.round((pushBlob.idx / pushBlob.total) * 100)}%`,
                    background: C.blue, transition: 'width .3s ease',
                  }} />
                </div>
                <span style={{ fontSize: FONT.xs, color: C.blue, fontWeight: 700, flexShrink: 0 }}>
                  {pushBlob.idx} / {pushBlob.total} arquivos
                </span>
              </div>
            )}
          </div>

          {/* Log */}
          <div ref={pushLogRef} style={{ background: C.surface2, border: `1px solid ${C.border}`,
            borderRadius: RADIUS.md, padding: SPACE.md, maxHeight: 240, overflowY: 'auto',
            fontFamily: 'monospace', fontSize: FONT.xs, display: 'flex',
            flexDirection: 'column', gap: 3 }}>
            {pushLinhas.length === 0 && <span style={{ color: C.muted }}>Iniciando pipeline…</span>}
            {pushLinhas.map((l, i) => (
              <span key={i} style={{ color: NIVEL_COR[l.nivel] || C.text, lineHeight: 1.5 }}>
                {l.msg}
              </span>
            ))}
          </div>

          {/* Resultado de sucesso */}
          {pushStatus === 'success' && pushResult?.relatorio && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: SPACE.sm }}>
              {[
                { l: 'Arquivos enviados', v: pushResult.relatorio.totalArquivos },
                { l: 'Tamanho total',     v: pushResult.relatorio.totalBytes != null
                    ? `${(pushResult.relatorio.totalBytes / 1024).toFixed(0)} KB` : null },
                { l: 'Ignorados',         v: pushResult.relatorio.ignorados },
              ].filter(x => x.v != null).map(({ l, v }) => (
                <div key={l} style={{ background: C.surface2, border: `1px solid ${C.border}`,
                  borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg}px`, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{v}</div>
                  <div style={{ fontSize: FONT.xs, color: C.muted }}>{l}</div>
                </div>
              ))}
            </div>
          )}

          {/* Link do commit */}
          {pushStatus === 'success' && pushResult?.relatorio?.commitUrl && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: `${C.greenSolid}0d`, border: `1px solid ${C.greenSolid}28`,
              borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg}px` }}>
              <div style={{ fontSize: FONT.sm, color: C.greenSolid, fontWeight: 700 }}>
                Commit {pushResult.relatorio.commitShaCurto} → {pushResult.relatorio.branch}
              </div>
              <a href={pushResult.relatorio.commitUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: FONT.xs, fontWeight: 600, color: C.greenSolid,
                  background: `${C.greenSolid}18`, border: `1px solid ${C.greenSolid}35`,
                  borderRadius: RADIUS.sm, padding: '4px 10px', textDecoration: 'none' }}>
                Ver no GitHub ↗
              </a>
            </div>
          )}

          {/* Erro */}
          {pushStatus === 'error' && (
            <div style={{ background: `${C.red}0d`, border: `1px solid ${C.red}28`,
              borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg}px`,
              fontSize: FONT.sm, color: C.red }}>
              {pushResult?.msg || 'Falha ao fazer push. Verifique se o projeto local existe no servidor.'}
            </div>
          )}

          {/* Botões pós-push */}
          {isDone && (
            <div style={{ display: 'flex', gap: SPACE.md }}>
              {pushStatus === 'error' && (
                <DSBtn variant="primary" onClick={onReset}
                  style={{ flex: 1, background: C.blue, borderColor: C.blue }}>
                  ↩ Tentar novamente
                </DSBtn>
              )}
              <DSBtn variant="secondary" onClick={onReset} style={{ flex: 1 }}>
                Novo push
              </DSBtn>
            </div>
          )}
        </>
      )}
    </div>
  )
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

      <div style={{ background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: RADIUS.md, padding: `${SPACE.md + 2}px 14px`, fontSize: FONT.sm, color: C.amber, marginBottom: SPACE.lg, lineHeight: 1.6 }}>
        🔒 O GitHub <strong>nunca expõe</strong> os valores dos secrets — apenas os nomes são listados.
        Os valores são criptografados com a chave pública do repositório antes de serem enviados.
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
        <div style={{ display: 'grid', gap: SPACE.sm }}>
          {secrets.map(s => (
            <div key={s.nome} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: `${SPACE.md + 2}px 14px`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.lg,
            }}>
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

/* ── ABA: Workflows ──────────────────────────────────────── */
function AbaWorkflows({ workflows, owner, repo, toastShow }) {
  const [wfSel, setWfSel]       = useState(null)
  const [runs, setRuns]         = useState(null)
  const [loadRuns, setLoadRuns] = useState(false)
  const [runAberto, setRunAberto] = useState(null)
  const [jobs, setJobs]         = useState(null)
  const [loadJobs, setLoadJobs] = useState(false)
  const [jobLogAberto, setJobLogAberto] = useState(null)
  const [logTexto, setLogTexto] = useState(null)
  const [loadLog, setLoadLog]   = useState(false)
  const [artifactsCache, setArtifactsCache] = useState(null)

  async function selecionarWorkflow(wf) {
    setWfSel(wf); setRuns(null); setRunAberto(null); setJobs(null); setArtifactsCache(null)
    setLoadRuns(true)
    try { const d = await githubService.runs(owner, repo, wf.id); setRuns(d.runs || []) }
    catch (e) { toastShow('Erro ao carregar runs: ' + e.message, 'erro') }
    finally   { setLoadRuns(false) }
  }

  async function abrirRun(run) {
    setRunAberto(run); setJobs(null); setJobLogAberto(null); setLogTexto(null)
    if (!run?.id) return
    setLoadJobs(true)
    const [jobsP, artsP] = [
      githubService.jobs(run.id, owner, repo),
      artifactsCache === null ? githubService.artifacts(owner, repo) : Promise.resolve(null),
    ]
    try { const d = await jobsP; setJobs(d.jobs || []) }
    catch (e) { toastShow('Erro ao carregar jobs: ' + e.message, 'erro') }
    finally   { setLoadJobs(false) }
    if (artifactsCache === null) artsP.then(d => setArtifactsCache(d?.artifacts || [])).catch(() => setArtifactsCache([]))
  }

  function fecharRun() { setRunAberto(null); setJobs(null); setJobLogAberto(null); setLogTexto(null) }

  async function verLog(job) {
    setJobLogAberto(job.id === jobLogAberto ? null : job.id)
    if (job.id === jobLogAberto) return
    setLoadLog(true); setLogTexto(null)
    try { const texto = await githubService.jobLogs(job.id, owner, repo); setLogTexto(texto) }
    catch (e) { setLogTexto(`Erro ao carregar log: ${e.message}`) }
    finally   { setLoadLog(false) }
  }

  if (!workflows) return <div style={{ fontSize: FONT.base, color: C.muted }}>Carregando...</div>
  if (workflows.length === 0) return (
    <div style={{ fontSize: FONT.base, color: C.muted }}>
      Nenhum workflow encontrado. Crie arquivos <code>.github/workflows/*.yml</code> no repositório.
    </div>
  )

  return (
    <div>
      <DSSectionTitle style={{ marginBottom: SPACE.lg }}>Workflows ({workflows.length})</DSSectionTitle>
      <div style={{ display: 'grid', gap: SPACE.sm, marginBottom: SPACE.xl3 }}>
        {workflows.map(wf => {
          const ativo = wf.estado === 'active'
          return (
            <button key={wf.id} onClick={() => selecionarWorkflow(wf)} style={{
              background: wfSel?.id === wf.id ? `${C.accent}18` : C.surface,
              border: `1px solid ${wfSel?.id === wf.id ? C.accent : C.border}`,
              borderRadius: RADIUS.md, padding: `${SPACE.md + 2}px 14px`, cursor: 'pointer', textAlign: 'left',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: FONT.base, fontWeight: 700, color: C.text }}>⚙ {wf.nome}</div>
                <div style={{ fontSize: FONT.xs, color: C.muted, marginTop: 2 }}>{wf.arquivo}</div>
              </div>
              <DSBadge variant={ativo ? 'green' : 'amber'}>{wf.estado}</DSBadge>
            </button>
          )
        })}
      </div>

      {wfSel && (
        <>
          <DSSectionTitle style={{ marginBottom: SPACE.lg }}>Execuções — {wfSel.nome}</DSSectionTitle>
          {loadRuns ? (
            <div style={{ fontSize: FONT.base, color: C.muted }}>Carregando execuções...</div>
          ) : runs && runs.length === 0 ? (
            <div style={{ fontSize: FONT.base, color: C.muted }}>Nenhuma execução encontrada.</div>
          ) : runs ? (
            <div style={{ display: 'grid', gap: SPACE.sm }}>
              {runs.map(run => {
                const cor      = STATUS_RUN_COR[run.conclusao || run.status] || C.muted
                const isAberto = runAberto?.id === run.id
                return (
                  <div key={run.id}>
                    <div style={{
                      background: C.surface, border: `1px solid ${isAberto ? cor : C.border}`,
                      borderRadius: RADIUS.md, padding: `${SPACE.md + 2}px 14px`,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: SPACE.md + 2,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: FONT.base, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
                          <RunBadge status={run.status} conclusao={run.conclusao} />
                          <span style={{ wordBreak: 'break-word' }}>{run.mensagem || run.nome}</span>
                        </div>
                        <div style={{ fontSize: FONT.xs, color: C.muted, marginTop: 3, display: 'flex', gap: SPACE.md, flexWrap: 'wrap' }}>
                          <span>🌿 {run.branch}</span>
                          {run.sha && <span>#{run.sha}</span>}
                          <span>{relTime(run.criadoEm)}</span>
                          {run.duracaoMs > 0 && <span>⏱ {fmtDuracao(run.duracaoMs)}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: SPACE.sm, flexShrink: 0 }}>
                        <DSBtn size="sm" onClick={() => isAberto ? fecharRun() : abrirRun(run)}>
                          {isAberto ? 'Fechar' : 'Ver Jobs'}
                        </DSBtn>
                        <a href={githubService.downloadLogsUrl(run.id, owner, repo)}
                          style={{ fontSize: FONT.sm, fontWeight: 600, color: C.text, background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: `${SPACE.xs}px ${SPACE.md + 2}px`, textDecoration: 'none', whiteSpace: 'nowrap' }}
                          title="Baixar todos os logs como ZIP">⬇ Logs</a>
                      </div>
                    </div>

                    {isAberto && (
                      <div style={{ marginLeft: SPACE.lg, marginTop: SPACE.xs, display: 'grid', gap: SPACE.xs }}>
                        {loadJobs ? (
                          <div style={{ fontSize: FONT.sm, color: C.muted, padding: `${SPACE.md}px 0` }}>Carregando jobs...</div>
                        ) : jobs?.map(job => {
                          const jcor     = STATUS_RUN_COR[job.conclusao || job.status] || C.muted
                          const logAberto = jobLogAberto === job.id
                          return (
                            <div key={job.id}>
                              <div style={{
                                background: C.bg, border: `1px solid ${logAberto ? jcor : C.border}`,
                                borderRadius: RADIUS.sm, padding: `${SPACE.md}px ${SPACE.lg}px`,
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.md,
                              }}>
                                <div>
                                  <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text, display: 'flex', gap: SPACE.sm, alignItems: 'center' }}>
                                    <RunBadge status={job.status} conclusao={job.conclusao} />
                                    {job.nome}
                                  </div>
                                  {job.fimEm && job.inicioEm && (
                                    <div style={{ fontSize: FONT.xs, color: C.muted }}>⏱ {fmtDuracao(new Date(job.fimEm) - new Date(job.inicioEm))}</div>
                                  )}
                                </div>
                                <DSBtn size="sm" onClick={() => verLog(job)}>{logAberto ? '✕ Fechar Log' : '📋 Ver Log'}</DSBtn>
                              </div>

                              {logAberto && (
                                <div style={{
                                  background: '#0a0a0a', border: `1px solid ${jcor}40`,
                                  borderRadius: `0 0 ${RADIUS.sm}px ${RADIUS.sm}px`, marginTop: -1,
                                  padding: SPACE.lg, maxHeight: 320, overflowY: 'auto',
                                  fontFamily: 'monospace', fontSize: FONT.xs, color: '#d4d4d4',
                                  lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                }}>
                                  {loadLog ? <span style={{ color: C.muted }}>Carregando log...</span>
                                    : logTexto ? logTexto.split('\n').map((linha, i) => {
                                        const lcor = /error|fail|✗/i.test(linha) ? '#f87171'
                                          : /success|passed|✓/i.test(linha) ? '#86efac'
                                          : /warning|warn/i.test(linha) ? '#fcd34d' : '#d4d4d4'
                                        return <div key={i} style={{ color: lcor }}>{linha || '\u00a0'}</div>
                                      })
                                    : <span style={{ color: C.muted }}>Log vazio.</span>}
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {(() => {
                          if (artifactsCache === null) return null
                          const arts = artifactsCache.filter(a => a.workflowRunId === run.id && !a.expirado)
                          if (arts.length === 0) return null
                          return (
                            <div style={{ marginTop: SPACE.sm, background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: `${SPACE.md + 2}px ${SPACE.lg}px` }}>
                              <div style={{ fontSize: FONT.xs, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: .5, marginBottom: SPACE.md }}>📦 Artefatos desta execução</div>
                              <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
                                {arts.map(a => {
                                  const isApk = /apk/i.test(a.nome)
                                  return (
                                    <a key={a.id} href={githubService.downloadArtifactUrl(a.id, owner, repo, a.nome)}
                                      style={{
                                        display: 'inline-flex', alignItems: 'center', gap: SPACE.sm,
                                        fontSize: FONT.sm, fontWeight: 700,
                                        color: isApk ? '#fff' : C.text,
                                        background: isApk ? C.greenSolid : C.surf2,
                                        border: `1px solid ${isApk ? C.greenSolid : C.border}`,
                                        borderRadius: RADIUS.sm, padding: `${SPACE.xs + 1}px ${SPACE.lg}px`,
                                        textDecoration: 'none', whiteSpace: 'nowrap',
                                      }}
                                      title={`${fmtBytes(a.tamanho)} · criado ${relTime(a.criadoEm)}`}>
                                      {isApk ? '📱' : '📦'} ⬇ {isApk ? 'Baixar APK' : a.nome}
                                    </a>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

/* ── Card de repo (lista principal) ─────────────────────── */
function RepoCard({ repo, meta, insight, onAbrir }) {
  const statusCfg = STATUS_CFG[meta?.statusInterno]
  const acesso = repo.permissoes?.admin || repo.permissoes?.maintain || repo.permissoes?.push ? 'Leitura e escrita' : 'Somente leitura'
  const resumo = repo.descricao?.trim() || insight?.resumo || `${repo.linguagem ? `Projeto ${repo.linguagem}` : 'Repositório'} no GitHub · branch principal ${repo.branch || '—'}`
  const visibilidade = repo.privado ? 'Privado' : 'Público'
  return (
    <article className="gh-repo-card" onClick={() => onAbrir(repo)}>
      <div className="gh-card-topline" />
      <div style={{ display:'flex', justifyContent:'space-between', gap:SPACE.md, alignItems:'flex-start' }}>
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:SPACE.sm, flexWrap:'wrap' }}>
            {meta?.favorito && <span title="Favorito" style={{ fontSize:14 }}>★</span>}
            <h2 style={{ margin:0, fontSize:FONT.xl, lineHeight:1.15, color:C.text, letterSpacing:'-.02em' }}>{repo.nome}</h2>
            <DSBadge variant={repo.privado ? 'amber' : 'green'}>{visibilidade}</DSBadge>
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

      <p style={{ margin:0, color:C.muted, fontSize:FONT.md, lineHeight:1.5, minHeight:38 }}>
        {resumo.length > 145 ? resumo.slice(0,145) + '…' : resumo}
      </p>

      {insight && (insight.produto || insight.tipo || insight.versao) && (
        <div style={{ display:'flex', gap:SPACE.xs, flexWrap:'wrap' }}>
          {insight.produto && <DSBadge variant="purple">{insight.produto}</DSBadge>}
          {insight.versao && <DSBadge variant="blue">v{insight.versao}</DSBadge>}
          {insight.tipo && <DSBadge variant="gray">{insight.tipo}</DSBadge>}
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
        <span title={`Criado em ${shortDate(repo.criadoEm)}`}>Atualizado {relTime(repo.ultimaAtualizacao)}</span>
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
  { value: 'estudo',    label: 'Estudo'      },
  { value: 'legado',    label: 'Legado'      },
  { value: 'arquivado', label: 'Arquivados'  },
]

export default function AdminGitHub() {
  const [sort,         setSort]         = useState('updated')
  const [busca,        setBusca]        = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroVis,    setFiltroVis]    = useState('todos')
  const [repoAberto,   setRepoAberto]   = useState(null)
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
    repos.slice(0, 12).forEach(r => {
      const [owner, nome] = (r.nomeCompleto || '').split('/')
      if (!owner || !nome || insights[r.id]) return
      githubService.insight(owner, nome, r.branch || 'main')
        .then(info => setInsights(prev => ({ ...prev, [r.id]: info })))
        .catch(() => {})
    })
  }, [repos.length])

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
      (meta?.statusInterno || 'ativo') === filtroStatus
    const matchVis = filtroVis === 'todos' ? true : filtroVis === 'privados' ? !!repo.privado : !repo.privado
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
        .gh-account-hero{background:linear-gradient(135deg,var(--adm-surface,#fff),var(--adm-surface2,#f7f5f2));border:1px solid var(--adm-border,#e8e3dc);border-radius:14px;padding:18px;margin-bottom:18px;position:relative;overflow:hidden}
        .gh-account-hero:after{content:'';position:absolute;right:-48px;top:-62px;width:180px;height:180px;border-radius:50%;border:1px solid color-mix(in srgb,var(--adm-accent) 14%,transparent);box-shadow:0 0 0 28px color-mix(in srgb,var(--adm-accent) 5%,transparent)}
        .gh-account-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:16px}
        .gh-account-stat{background:var(--adm-bg);border:1px solid var(--adm-border);border-radius:10px;padding:10px 12px;min-width:0}
        .gh-account-stat span,.gh-repo-facts span{display:block;font-size:9px;letter-spacing:.10em;color:var(--adm-muted);font-weight:800}
        .gh-account-stat b{display:block;margin-top:4px;font-size:15px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis}
        .gh-repo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
        .gh-repo-card{position:relative;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px;cursor:pointer;overflow:hidden;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
        .gh-repo-card:hover{border-color:var(--adm-accent);transform:translateY(-1px);box-shadow:0 10px 30px rgba(20,30,24,.06)}
        .gh-card-topline{position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,var(--adm-accent),transparent 72%);opacity:.75}
        .gh-repo-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
        .gh-repo-facts>div{background:var(--adm-surface2);border:1px solid var(--adm-border);border-radius:8px;padding:8px 9px;min-width:0}
        .gh-repo-facts b{display:block;margin-top:3px;font-size:11px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .gh-repo-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;padding-top:9px;border-top:1px solid var(--adm-border);color:var(--adm-muted);font-size:10px}
        .gh-repo-counters{display:flex;align-items:center;gap:12px}.gh-repo-counters b{color:var(--adm-text)}
        .gh-filter-row{display:grid;grid-template-columns:minmax(0,1fr) 150px 150px;gap:8px}
        @media(max-width:980px){.gh-repo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:760px){.gh-repo-grid{grid-template-columns:1fr}.gh-account-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.gh-filter-row{grid-template-columns:1fr 1fr}.gh-filter-row input{grid-column:1/-1}.gh-account-hero:after{right:-90px;top:-80px}.gh-repo-facts{grid-template-columns:repeat(3,minmax(0,1fr))}}
        @media(max-width:420px){.gh-repo-facts{grid-template-columns:1fr 1fr}.gh-repo-facts>div:last-child{grid-column:1/-1}.gh-repo-footer{align-items:flex-start;flex-direction:column}.gh-account-stat b{font-size:13px}}
      `}</style>

      <section className="gh-account-hero">
        <div style={{ position:'relative', zIndex:1, display:'flex', justifyContent:'space-between', gap:SPACE.lg, alignItems:'flex-start' }}>
          <div style={{ minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:SPACE.md, marginBottom:SPACE.xs }}>
              <span style={{ color:C.accent }}><AdminIcon name="git" size={19} /></span>
              <h1 className="adm-page-title" style={{ margin:0 }}>Central GitHub</h1>
              {status?.ok && <DSBadge variant="green">conectado</DSBadge>}
            </div>
            {status?.ok ? (
              <div style={{ display:'flex', alignItems:'center', gap:SPACE.sm, color:C.muted, fontSize:FONT.md, flexWrap:'wrap' }}>
                {status.avatar && <img src={status.avatar} alt={status.login} style={{ width:24, height:24, borderRadius:'50%', border:`1px solid ${C.border}` }} />}
                <b style={{ color:C.text }}>{status.nome || status.login}</b>
                <span>@{status.login}</span>
                {status.empresa && <span>· {status.empresa}</span>}
              </div>
            ) : <span className="adm-page-sub">Código, publicação, automações e manutenção em uma única central.</span>}
          </div>
          <DSBtn variant="secondary" size="sm" onClick={recarregar} loading={loading}>
            <AdminIcon name="refresh" size={12} /> Atualizar
          </DSBtn>
        </div>
        {status?.ok && (
          <div className="gh-account-stats" style={{ position:'relative', zIndex:1 }}>
            <div className="gh-account-stat"><span>REPOSITÓRIOS VISÍVEIS</span><b>{total}</b></div>
            <div className="gh-account-stat"><span>PÚBLICOS</span><b>{repos.filter(r => !r.privado).length}</b></div>
            <div className="gh-account-stat"><span>PRIVADOS</span><b>{repos.filter(r => r.privado).length}</b></div>
            <div className="gh-account-stat"><span>ATIVIDADE</span><b>{repos[0]?.ultimaAtualizacao ? relTime(repos[0].ultimaAtualizacao) : '—'}</b></div>
          </div>
        )}
      </section>

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
              <button key={f.value} onClick={() => setFiltroStatus(f.value)} style={{
                fontSize:FONT.sm, fontWeight:700, padding:`${SPACE.sm}px ${SPACE.md + 2}px`, borderRadius:RADIUS.pill,
                border:`1px solid ${filtroStatus === f.value ? C.accent : C.border}`,
                background:filtroStatus === f.value ? `${C.accent}14` : C.surface,
                color:filtroStatus === f.value ? C.text : C.muted, cursor:'pointer',
              }}>{f.label}</button>
            ))}
            <span style={{ fontSize:FONT.sm, color:C.muted, marginLeft:'auto' }}>{reposFiltrados.length} exibido(s) · {total} carregado(s)</span>
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
          {reposFiltrados.map(repo => <RepoCard key={repo.id} repo={repo} meta={metas[repo.id]} insight={insights[repo.id]} onAbrir={setRepoAberto} />)}
        </div>
      )}

      {repoAberto && <PainelDetalhes repo={repoAberto} onFechar={fecharPainel} toastShow={toastShow} />}
    </div>
  )
}
