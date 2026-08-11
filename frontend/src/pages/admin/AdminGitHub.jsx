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
import { useState, useEffect, useCallback } from 'react'
import { useGitHubRepos }   from '../../modules/github/useGitHubRepos.js'
import { githubService }    from '../../services/domains/github.js'
import { updatesService }   from '../../services/domains/updates.js'
import { infraestruturaService } from '../../services/domains/infraestrutura.js'
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
  const [secaoModal, setSecaoModal] = useState(null)
  const [publicarAberto, setPublicarAberto] = useState(false)
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
  const [repoAlterado, setRepoAlterado] = useState(false)
  const [baixandoProjeto, setBaixandoProjeto] = useState(false)

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
    try {
      await githubService.baixarZip(owner, repoNome, repoDetalhes?.branch || repoDetalhes?.default_branch || 'main')
      toastShow('ZIP do projeto gerado e enviado para download.')
    } catch (e) { toastShow(e.message || 'Não foi possível baixar o projeto.', 'erro') }
    finally { setBaixandoProjeto(false) }
  }

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

  const mudarAba = (a) => {
    setErroAba(null)
    if (a === 'push') { setPublicarAberto(true); return }
    setAba(a)
    setSecaoModal(a)
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
    { id:'visao', icon:'◈', label:'Visão geral', desc:'Status, README e informações', grupo:'Projeto' },
    { id:'meta', icon:'⌁', label:'Organização', desc:'Alias, tags e preferências internas', grupo:'Projeto' },
    { id:'analysis', icon:'◎', label:'Análise', desc:'Saúde e composição do código', grupo:'Projeto' },
    { id:'arquivos', icon:'▤', label:'Arquivos', desc:'Navegar, limpar e remover itens', grupo:'Código' },
    { id:'commits', icon:'⌘', label:'Commits', desc:'Histórico de alterações', grupo:'Código' },
    { id:'releases', icon:'◇', label:'Releases', desc:'Versões publicadas', grupo:'Código' },
    { id:'artifacts', icon:'□', label:'Artefatos', desc:'Arquivos gerados por Actions', grupo:'Código' },
    { id:'workflows', icon:'↯', label:'Workflows', desc:'Automações e execuções', grupo:'Automação' },
    { id:'secrets', icon:'◆', label:'Secrets', desc:'Segredos de Actions', grupo:'Automação' },
    { id:'push', icon:'↑', label:'Publicar', desc:'ZIP → GitHub → cloud opcional', grupo:'Publicação', destaque:true },
    { id:'delete', icon:'×', label:'Excluir repositório', desc:'Zona de risco permanente', grupo:'Manutenção', perigo:true },
  ]
  const abaAtual = ABAS.find(a => a.id === aba) || ABAS[0]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: '#000a',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    }} onClick={e => e.target === e.currentTarget && fecharPainel()}>
      <div className="gh-repo-drawer" style={{
        width: 'min(720px, 100vw)', height: '100dvh',
        background: C.bg, borderLeft: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Header */}
        <div className="gh-repo-head" style={{
          padding: `${SPACE.xl}px ${SPACE.xl2}px`, borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.lg,
          position: 'sticky', top: 0, background: C.bg, zIndex: 10,
        }}>
          <div className="gh-repo-identity" style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' }}>
              <span className="gh-repo-title" style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text }}>{repoDetalhes.nome || repo.nome}</span>
              <DSBadge variant={repoDetalhes.privado ? 'gray' : 'green'}>{repoDetalhes.privado ? 'Privado' : 'Público'}</DSBadge>
              {meta?.favorito && <span style={{ fontSize: FONT.lg - 1 }}>⭐</span>}
              {meta?.statusInterno && meta.statusInterno !== 'ativo' && (
                <DSBadge style={{ color: STATUS_CFG[meta.statusInterno]?.cor, background: `${STATUS_CFG[meta.statusInterno]?.cor}18` }}>
                  {STATUS_CFG[meta.statusInterno]?.label}
                </DSBadge>
              )}
            </div>
            <div className="gh-repo-path" style={{ fontSize:FONT.sm, color:C.muted, marginTop:3 }}>{owner}/{repoNome}</div>
            {meta?.alias && <div style={{ fontSize: FONT.xs, color: C.muted, marginTop: 2 }}>alias: {meta.alias}</div>}
          </div>
          <div className="gh-repo-header-actions" style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexShrink: 0 }}>
            <button
              type="button"
              onClick={baixarProjeto}
              disabled={baixandoProjeto}
              title={`Gerar e baixar o projeto ${owner}/${repoNome} como ZIP`}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent:'center', gap: SPACE.xs,
                fontSize: FONT.sm, fontWeight: 600, color: C.muted,
                background: C.surface2, border: `1px solid ${C.border}`,
                borderRadius: RADIUS.sm, padding: '6px 10px', minHeight:34,
                transition: 'all .15s', flexShrink: 0, cursor:baixandoProjeto?'wait':'pointer',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {baixandoProjeto ? 'Gerando…' : 'Baixar projeto'}
            </button>
            <DSBtn variant="primary" size="sm" onClick={() => setPublicarAberto(true)}>↑ Publicar</DSBtn>
            <DSBtn variant="ghost" size="icon" onClick={fecharPainel} aria-label="Fechar repositório">✕</DSBtn>
          </div>
        </div>

        {/* Ponte de comando — navegação por intenção */}
        <div className="gh-command-deck" style={{padding:`${SPACE.lg}px ${SPACE.xl2}px`,borderBottom:`1px solid ${C.border}`,position:'sticky',top:57,background:C.bg,zIndex:9}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:SPACE.md,marginBottom:SPACE.md}}>
            <div>
              <div style={{fontSize:10,fontWeight:900,letterSpacing:'.16em',textTransform:'uppercase',color:C.accent}}>Ponte de comando</div>
              <div style={{fontSize:FONT.sm,color:C.muted,marginTop:3}}>{abaAtual.grupo} · {abaAtual.label}</div>
            </div>
            <div style={{width:8,height:8,borderRadius:'50%',background:C.greenSolid,boxShadow:`0 0 0 5px ${C.greenSolid}18`}} title="Conectado ao GitHub" />
          </div>
          <div className="gh-command-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:7}}>
            {ABAS.map(a => (
              <button key={a.id} onClick={() => mudarAba(a.id)} className="gh-command-btn" style={{
                minWidth:0,textAlign:'center',padding:'9px 6px',borderRadius:RADIUS.md,cursor:'pointer',
                border:`1px solid ${aba===a.id?(a.perigo?C.red:a.destaque?C.greenSolid:C.accent):C.border}`,
                background:aba===a.id?(a.perigo?C.redBg:a.destaque?`${C.greenSolid}12`:`${C.accent}10`):C.surface,
                color:a.perigo?C.red:a.destaque?C.greenSolid:C.text,
              }}>
                <span style={{display:'block',fontSize:15,fontWeight:900,lineHeight:1,marginBottom:5}}>{a.icon}</span>
                <b style={{display:'block',fontSize:9.5,lineHeight:1.15,whiteSpace:'normal',overflowWrap:'anywhere'}}>{a.label}</b>
              </button>
            ))}
          </div>
          <style>{`@media(max-width:720px){.gh-command-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}.gh-command-deck{position:relative!important;top:auto!important}.gh-repo-head{position:relative!important;top:auto!important}.gh-file-row{grid-template-columns:minmax(0,1fr)!important}.gh-file-actions{justify-content:flex-end!important}.gh-clean-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}}`}</style>
        </div>

        <div className="gh-command-empty" style={{ padding: SPACE.xl2, flex: 1 }}>
          <div style={{border:`1px dashed ${C.border}`,borderRadius:RADIUS.lg,padding:SPACE.xl2,textAlign:'center',color:C.muted}}>
            <b style={{display:'block',fontSize:FONT.base,color:C.text,marginBottom:4}}>Escolha uma seção</b>
            <span style={{fontSize:FONT.sm}}>Cada card abre suas informações em uma janela própria, sem aumentar esta página.</span>
          </div>
        </div>

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

        <DSModal open={publicarAberto} onClose={() => setPublicarAberto(false)} title="Publicar projeto" size="xl">
          <AbaPublicar repo={repoDetalhes} owner={owner} repoNome={repoNome} meta={meta} toastShow={toastShow} onMetaAtualizado={setMeta} onClose={() => setPublicarAberto(false)} />
        </DSModal>
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
        {readme === null ? <div className="gh-muted-box">Sem README.</div>
          : readme?.html ? <article className="gh-readme" dangerouslySetInnerHTML={{ __html: readme.html }} />
          : readme?.conteudo ? <pre className="gh-readme-fallback">{readme.conteudo}</pre>
          : <div className="gh-muted-box">Carregando README…</div>}
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
              <button
                type="button"
                title={`Baixar código-fonte no commit ${c.sha}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  flexShrink: 0, alignSelf: 'center', cursor: 'pointer',
                  fontSize: FONT.xs, fontWeight: 700, color: C.muted,
                  background: C.surface2, border: `1px solid ${C.border}`,
                  borderRadius: RADIUS.sm, padding: '4px 8px',
                  transition: 'all .15s', whiteSpace: 'nowrap',
                }}
                onClick={() => githubService.baixarZip(owner, repo, c.shaFull)
                  .catch(e => toastShow?.(e.message || 'Falha ao baixar este commit.', 'erro'))}
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
                Baixar
              </button>
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
function AbaArtifacts({ artifacts, owner, repo, toastShow }) {
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
                <button type="button"
                  onClick={() => githubService.baixarArtifact(a.id, owner, repo, a.nome)
                    .catch(e => toastShow?.(e.message || 'Falha ao baixar artefato.', 'erro'))}
                  style={{
                    fontSize: FONT.sm, fontWeight: 600, color: '#fff', cursor: 'pointer',
                    background: 'var(--adm-accent)', border: 0, borderRadius: RADIUS.sm,
                    padding: `${SPACE.xs + 1}px ${SPACE.lg}px`, whiteSpace: 'nowrap',
                  }}>
                  ⬇ Baixar {/apk/i.test(a.nome) ? 'APK' : 'ZIP'}
                </button>
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
function AbaPublicar({ repo, owner, repoNome, meta, toastShow, onMetaAtualizado, onClose }) {
  const repoAtual = repo.nomeCompleto || `${owner}/${repoNome}`
  const [repos, setRepos] = useState([])
  const [repository, setRepository] = useState(meta?.publicacao?.repository || repoAtual)
  const [branch, setBranch] = useState(meta?.publicacao?.branch || repo.branch || 'main')
  const [targetPath, setTargetPath] = useState(meta?.publicacao?.path || '')
  const [snapshotR2, setSnapshotR2] = useState(meta?.publicacao?.snapshotR2 !== false)
  const [replacePath, setReplacePath] = useState(false)
  const [arquivo, setArquivo] = useState(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [checking, setChecking] = useState(false)
  const [deployment, setDeployment] = useState(null)
  const [publicando, setPublicando] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [publishPhase, setPublishPhase] = useState('')
  const [resultado, setResultado] = useState(null)
  const [deployingRender, setDeployingRender] = useState({})
  const [passo, setPasso] = useState(1)

  useEffect(() => {
    githubService.repos({ per_page: 100, sort: 'updated' })
      .then(d => setRepos(d.repos || []))
      .catch(() => setRepos([]))
  }, [])

  const conferir = useCallback(async () => {
    if (!repository || !branch) return null
    setChecking(true)
    try {
      const d = await updatesService.deploymentCheck(repository, branch)
      setDeployment(d)
      return d
    } catch (e) {
      const d = { erro: e.message || 'Não foi possível conferir os vínculos.' }
      setDeployment(d)
      return d
    } finally { setChecking(false) }
  }, [repository, branch])

  const limparPath = v => v.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.{2}/g, '').replace(/\/+/g, '/')
  const destinoVisual = `${repository || 'repositório'} → ${branch || 'main'} → /${targetPath || ''}`
  const totalPassos = 6

  async function avancar() {
    if (passo === 1 && !arquivo) return toastShow('Selecione o ZIP do projeto para continuar.', 'erro')
    if (passo === 2 && !repository) return toastShow('Selecione o repositório de destino.', 'erro')
    if (passo === 3 && !branch) return toastShow('Informe a branch de destino.', 'erro')
    if (passo === 5) await conferir()
    setPasso(p => Math.min(totalPassos, p + 1))
  }

  function voltar() { setPasso(p => Math.max(1, p - 1)) }

  async function publicar() {
    if (!arquivo || !repository || !branch) return
    setPublicando(true); setResultado(null); setUploadProgress(0); setPublishPhase('Enviando ZIP para o AL…')
    try {
      const r = await githubService.publicarPacote(owner, repoNome, arquivo, {
        repository, branch, targetPath, replacePath, snapshotR2,
        commitMessage: commitMessage.trim() || `Publica ${arquivo.name} pelo AL Sistemas`,
      }, prog => {
        setUploadProgress(prog.percent || 0)
        if ((prog.percent || 0) >= 100) setPublishPhase('ZIP recebido. Validando, salvando snapshot e criando commit…')
      })
      setResultado(r)
      toastShow(r.mensagem || 'Projeto publicado no GitHub.')
      const atualizado = await githubService.getMeta(repo.id).catch(() => null)
      if (atualizado) onMetaAtualizado?.(atualizado)
      await conferir()
      setPasso(7)
    } catch (e) {
      toastShow(e.message || 'Não foi possível publicar o projeto.', 'erro')
    } finally { setPublicando(false); setPublishPhase('') }
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

  const etapas = [
    ['Origem', 'ZIP do projeto'],
    ['GitHub', 'Repositório'],
    ['Destino', 'Branch e pasta'],
    ['Opções', 'R2 e substituição'],
    ['Cloud', 'Vercel e Render'],
    ['Revisão', 'Confirmar publicação'],
  ]

  return (
    <div className="gh-wizard-shell">
      {passo <= totalPassos && <>
        <div className="gh-wizard-progress" aria-label={`Etapa ${passo} de ${totalPassos}`}>
          <div className="gh-wizard-progress-top"><b>Etapa {passo} de {totalPassos}</b><span>{etapas[passo-1][0]} · {etapas[passo-1][1]}</span></div>
          <div className="gh-wizard-track"><span style={{width:`${(passo/totalPassos)*100}%`}} /></div>
          <div className="gh-wizard-dots">{etapas.map((e,i)=><button type="button" key={e[0]} className={i+1===passo?'ativo':i+1<passo?'feito':''} onClick={()=>i+1<passo&&setPasso(i+1)} title={`${i+1}. ${e[0]}`}>{i+1}</button>)}</div>
        </div>

        {passo === 1 && <section className="gh-wizard-step">
          <div className="gh-wizard-step-head"><span>1</span><div><h3>Escolha o projeto</h3><p>O arquivo pode vir do celular, computador ou qualquer outro lugar. Ele não precisa existir no módulo Projetos.</p></div></div>
          <label className="gh-upload-box gh-wizard-upload">
            <input type="file" accept=".zip,application/zip" onChange={e => { setArquivo(e.target.files?.[0] || null); setResultado(null) }} />
            <strong>{arquivo ? arquivo.name : 'Selecionar ZIP do projeto'}</strong>
            <span>{arquivo ? `${fmtBytes(arquivo.size)} · pronto para continuar` : 'Toque aqui e selecione o pacote que será enviado ao GitHub.'}</span>
          </label>
          <label className="gh-field"><span>Mensagem do commit</span><input value={commitMessage} onChange={e => setCommitMessage(e.target.value.slice(0,240))} placeholder={arquivo ? `Publica ${arquivo.name}` : 'Pode deixar em branco para gerar automaticamente'} style={inp()} /></label>
        </section>}

        {passo === 2 && <section className="gh-wizard-step">
          <div className="gh-wizard-step-head"><span>2</span><div><h3>Escolha o repositório</h3><p>A lista vem diretamente da conta GitHub configurada em Integrações e APIs.</p></div></div>
          <label className="gh-field"><span>Repositório de destino</span><select value={repository} onChange={e => { setRepository(e.target.value); setDeployment(null); setResultado(null) }} style={inp()}>
            {!repos.some(r => r.nomeCompleto === repository) && repository && <option value={repository}>{repository}</option>}
            {repos.map(r => <option key={r.id} value={r.nomeCompleto}>{r.nomeCompleto}{r.privado ? ' · privado' : ''}</option>)}
          </select></label>
          <div className="gh-wizard-summary-line"><span>Conta / repositório</span><code>{repository || '—'}</code></div>
        </section>}

        {passo === 3 && <section className="gh-wizard-step">
          <div className="gh-wizard-step-head"><span>3</span><div><h3>Defina branch e pasta</h3><p>Confira exatamente em qual lugar do GitHub os arquivos serão gravados.</p></div></div>
          <div className="gh-two-fields">
            <label className="gh-field"><span>Branch</span><input value={branch} onChange={e => { setBranch(e.target.value.replace(/\s/g,'')); setDeployment(null); setResultado(null) }} placeholder="main" style={inp()} /></label>
            <label className="gh-field"><span>Pasta no GitHub</span><input value={targetPath} onChange={e => { setTargetPath(limparPath(e.target.value)); setResultado(null) }} placeholder="/ (raiz), frontend, backend..." style={inp()} /></label>
          </div>
          <div className="gh-path-preview"><span>Destino exato</span><code>{destinoVisual}</code></div>
        </section>}

        {passo === 4 && <section className="gh-wizard-step">
          <div className="gh-wizard-step-head"><span>4</span><div><h3>Opções de segurança</h3><p>Escolha como o AL tratará o conteúdo existente e se deve guardar uma cópia no R2.</p></div></div>
          <label className="gh-check-row gh-wizard-choice"><input type="checkbox" checked={replacePath} onChange={e => setReplacePath(e.target.checked)} /><span><b>Substituir somente a pasta escolhida</b><small>{targetPath ? `Somente /${targetPath} poderá ter arquivos antigos removidos.` : 'A raiz do repositório é o destino; use esta opção com atenção.'} Desmarcado = mesclar/atualizar sem apagar arquivos ausentes do ZIP.</small></span></label>
          <label className="gh-check-row gh-wizard-choice"><input type="checkbox" checked={snapshotR2} onChange={e => setSnapshotR2(e.target.checked)} /><span><b>Guardar snapshot no R2 antes do commit</b><small>Recomendado e ativado por padrão. Usa a configuração R2 existente em Integrações e APIs e cria uma cópia em projects/&lt;conta&gt;/&lt;repositório&gt;/snapshots/.</small></span></label>
        </section>}

        {passo === 5 && <section className="gh-wizard-step">
          <div className="gh-wizard-step-head"><span>5</span><div><h3>Conferir plataformas</h3><p>Vercel e Render são opcionais. O GitHub continua sendo o destino principal.</p></div></div>
          <DSBtn size="sm" variant="ghost" onClick={conferir} loading={checking}>↻ Conferir novamente</DSBtn>
          {checking && !deployment ? <div className="gh-muted-box">Conferindo vínculos do repositório…</div> : deployment?.erro ? <div className="gh-error-box">{deployment.erro}</div> : deployment ? <div className="gh-cloud-grid gh-wizard-cloud">
            <div className="gh-cloud-card"><div className="gh-cloud-title"><b>Vercel</b><DSBadge variant={deployment.vercel?.projects?.length ? 'green' : 'gray'}>{deployment.vercel?.projects?.length || 0}</DSBadge></div>{deployment.vercel?.projects?.length ? deployment.vercel.projects.map(p=><div className="gh-cloud-row" key={p.id}><span><b>{p.name}</b><small>{p.rootDirectory ? `/${p.rootDirectory}` : 'raiz'}{p.productionBranch ? ` · ${p.productionBranch}` : ''}</small></span><em>Git deploy</em></div>) : <p>Nenhum projeto Vercel vinculado.</p>}</div>
            <div className="gh-cloud-card"><div className="gh-cloud-title"><b>Render</b><DSBadge variant={deployment.render?.services?.length ? 'green' : 'gray'}>{deployment.render?.services?.length || 0}</DSBadge></div>{deployment.render?.services?.length ? deployment.render.services.map(s=><div className="gh-cloud-row" key={s.id}><span><b>{s.name || s.id}</b><small>{s.branch || branch}</small></span><em>vinculado</em></div>) : <p>Nenhum serviço Render vinculado.</p>}</div>
          </div> : <div className="gh-muted-box">Toque em continuar para conferir automaticamente Vercel e Render.</div>}
        </section>}

        {passo === 6 && <section className="gh-wizard-step">
          <div className="gh-wizard-step-head"><span>6</span><div><h3>Revise antes de publicar</h3><p>Nada será enviado antes da sua confirmação nesta tela.</p></div></div>
          <div className="gh-publish-confirm gh-wizard-review">
            <div><span>Arquivo</span><b>{arquivo?.name || '—'}</b><small>{arquivo ? fmtBytes(arquivo.size) : ''}</small></div>
            <div><span>Repositório</span><b>{repository || '—'}</b></div>
            <div><span>Branch</span><b>{branch || 'main'}</b></div>
            <div><span>Pasta</span><b>/{targetPath || ''}</b><small>{targetPath ? 'Publicação limitada a esta pasta.' : 'Destino na raiz.'}</small></div>
            <div><span>Modo</span><b>{replacePath ? 'Substituir destino' : 'Mesclar / atualizar'}</b></div>
            <div><span>Snapshot R2</span><b>{snapshotR2 ? 'Sim' : 'Não'}</b></div>
            <div><span>Vercel</span><b>{deployment?.vercel?.projects?.length || 0} vínculo(s)</b></div>
            <div><span>Render</span><b>{deployment?.render?.services?.length || 0} vínculo(s)</b></div>
          </div>
          <div className="gh-wizard-warning">O commit será criado em <b>{repository}</b>, branch <b>{branch}</b>, pasta <b>/{targetPath || ''}</b>.</div>
          {publicando && <div className="gh-publish-progress" role="status" aria-live="polite">
            <div className="gh-publish-progress-head"><b>{publishPhase || 'Publicando…'}</b><span>{uploadProgress}%</span></div>
            <div className="gh-publish-progress-track"><span style={{width:`${uploadProgress}%`}} /></div>
            <small>{uploadProgress < 100 ? 'Mantenha esta janela aberta enquanto o arquivo é enviado.' : 'O upload terminou; o backend pode levar alguns instantes para processar o ZIP e concluir o GitHub.'}</small>
          </div>}
        </section>}

        <div className="gh-wizard-actions">
          <DSBtn onClick={passo === 1 ? onClose : voltar} disabled={publicando}>{passo === 1 ? 'Cancelar' : '← Voltar'}</DSBtn>
          {passo < totalPassos ? <DSBtn variant="primary" onClick={avancar} loading={checking && passo===5}>Continuar →</DSBtn> : <DSBtn variant="primary" onClick={publicar} loading={publicando}>↑ Publicar no GitHub</DSBtn>}
        </div>
      </>}

      {passo === 7 && resultado && <section className="gh-wizard-success">
        <div className="gh-wizard-success-icon">✓</div>
        <h3>Publicação concluída</h3>
        <p>{resultado.destino?.repository} → {resultado.destino?.branch} → {resultado.destino?.path || '/'}</p>
        <div className="gh-result-stats"><span><b>{resultado.pacote?.arquivos || 0}</b> arquivos</span><span><b>{resultado.commit?.commitSha?.slice(0,7) || '—'}</b> commit</span><span><b>{resultado.snapshot ? 'R2 ✓' : 'R2 —'}</b> snapshot</span></div>
        {resultado.snapshot?.objectKey && <div className="gh-cloud-note">Snapshot R2: <code>{resultado.snapshot.bucket}/{resultado.snapshot.objectKey}</code></div>}
        {resultado.commit?.commitUrl && <a href={resultado.commit.commitUrl} target="_blank" rel="noopener noreferrer">Ver commit no GitHub ↗</a>}
        {deployment?.render?.services?.length > 0 && <div className="gh-wizard-deploys"><b>Render</b>{deployment.render.services.map(svc=><div className="gh-cloud-row" key={svc.id}><span><b>{svc.name || svc.id}</b><small>{svc.branch || branch}</small></span><DSBtn size="sm" onClick={()=>implantarRender(svc)} loading={!!deployingRender[svc.id]}>Implantar este commit</DSBtn></div>)}</div>}
        {deployment?.vercel?.projects?.length > 0 && <div className="gh-cloud-note">Vercel: o commit foi enviado ao GitHub; projetos vinculados por Git podem iniciar o deploy automaticamente.</div>}
        <div className="gh-wizard-actions"><DSBtn variant="primary" onClick={onClose}>Concluir</DSBtn></div>
      </section>}
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
  const [analiseModal, setAnaliseModal] = useState(null)
  const [analiseLoad, setAnaliseLoad] = useState(false)
  const [analiseDados, setAnaliseDados] = useState(null)

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

  async function analisarRun(run, modo) {
    const titulo = modo === 'resumo' ? 'Resumo da execução' : modo === 'correcao' ? 'Sugestão de correção por IA' : 'Análise de erro por IA'
    setAnaliseModal({ run, modo, titulo })
    setAnaliseDados(null); setAnaliseLoad(true)
    try {
      const d = await githubService.analyzeRun(run.id, owner, repo, modo, wfSel?.nome || '')
      setAnaliseDados(d)
    } catch (e) {
      setAnaliseDados({ erro: e.message || 'Falha ao analisar a execução.' })
    } finally { setAnaliseLoad(false) }
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
                    <div className="gh-run-card" style={{
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
                      <div className="gh-run-actions" style={{ display: 'flex', gap: SPACE.sm, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <DSBtn size="sm" onClick={() => analisarRun(run, 'resumo')}>Resumo</DSBtn>
                        <DSBtn size="sm" variant="primary" onClick={() => analisarRun(run, 'diagnostico')}>✨ Analisar IA</DSBtn>
                        {run.conclusao === 'failure' && <DSBtn size="sm" onClick={() => analisarRun(run, 'correcao')}>🛠 Sugestão</DSBtn>}
                        <DSBtn size="sm" onClick={() => isAberto ? fecharRun() : abrirRun(run)}>
                          {isAberto ? 'Fechar' : 'Jobs'}
                        </DSBtn>
                        <button type="button"
                          onClick={() => githubService.baixarLogs(run.id, owner, repo)
                            .catch(e => toastShow?.(e.message || 'Falha ao baixar logs.', 'erro'))}
                          style={{ fontSize: FONT.sm, fontWeight: 600, color: C.text, cursor: 'pointer', background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: `${SPACE.xs}px ${SPACE.md + 2}px`, whiteSpace: 'nowrap' }}
                          title="Baixar todos os logs como ZIP">⬇ ZIP</button>
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
                                    <button key={a.id} type="button"
                                      onClick={() => githubService.baixarArtifact(a.id, owner, repo, a.nome)
                                        .catch(e => toastShow?.(e.message || 'Falha ao baixar artefato.', 'erro'))}
                                      style={{
                                        display: 'inline-flex', alignItems: 'center', gap: SPACE.sm,
                                        fontSize: FONT.sm, fontWeight: 700, cursor: 'pointer',
                                        color: isApk ? '#fff' : C.text,
                                        background: isApk ? C.greenSolid : C.surf2,
                                        border: `1px solid ${isApk ? C.greenSolid : C.border}`,
                                        borderRadius: RADIUS.sm, padding: `${SPACE.xs + 1}px ${SPACE.lg}px`,
                                        whiteSpace: 'nowrap',
                                      }}
                                      title={`${fmtBytes(a.tamanho)} · criado ${relTime(a.criadoEm)}`}>
                                      {isApk ? '📱' : '📦'} ⬇ {isApk ? 'Baixar APK' : a.nome}
                                    </button>
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

      <DSModal open={!!analiseModal} onClose={() => !analiseLoad && setAnaliseModal(null)} title={analiseModal?.titulo || 'Execução'} size="lg">
        {analiseLoad ? (
          <div style={{ color: C.muted, fontSize: FONT.base, padding: `${SPACE.xl}px 0` }}>
            {analiseModal?.modo === 'resumo' ? 'Montando resumo da execução...' : 'Lendo apenas os trechos relevantes dos logs e consultando a IA configurada em Integrações e APIs...'}
          </div>
        ) : analiseDados?.erro ? (
          <div style={{ color: C.redSolid || '#ef4444', fontSize: FONT.base }}>{analiseDados.erro}</div>
        ) : analiseDados ? (
          <AnaliseWorkflowConteudo dados={analiseDados} modo={analiseModal?.modo} />
        ) : null}
      </DSModal>
    </div>
  )
}

function AnaliseWorkflowConteudo({ dados, modo }) {
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
          {a.erro_principal && <div style={{ marginTop:SPACE.xl, padding:SPACE.lg, border:`1px solid ${C.redSolid || '#ef4444'}55`, borderRadius:RADIUS.md, background:`${C.redSolid || '#ef4444'}0d` }}><div style={{fontSize:FONT.xs,fontWeight:800,color:C.muted,textTransform:'uppercase'}}>Erro principal</div><div style={{fontSize:FONT.base,fontWeight:800,color:C.text,marginTop:4}}>{a.erro_principal}</div>{a.etapa && <div style={{fontSize:FONT.sm,color:C.muted,marginTop:4}}>Etapa: {a.etapa}</div>}</div>}
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
      <div style={{fontSize:FONT.xs,color:C.muted,marginTop:SPACE.xl,lineHeight:1.5}}>O ZIP de logs continua disponível. A análise por IA lê os logs no backend, seleciona trechos relevantes e não altera arquivos nem workflows automaticamente.</div>
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
        .gh-account-stat span,.gh-repo-facts span{display:block;font-size:8px;line-height:1.25;letter-spacing:.07em;color:var(--adm-muted);font-weight:800}
        .gh-account-stat b{display:block;margin-top:3px;font-size:13px;line-height:1.2;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .gh-repo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
        .gh-repo-card{position:relative;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px;cursor:pointer;overflow:hidden;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease;min-width:0}
        .gh-repo-card:hover{border-color:var(--adm-accent);transform:translateY(-1px);box-shadow:0 10px 30px rgba(20,30,24,.06)}
        .gh-card-topline{position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,var(--adm-accent),transparent 72%);opacity:.75}
        .gh-repo-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
        .gh-repo-facts>div{background:var(--adm-surface2);border:1px solid var(--adm-border);border-radius:8px;padding:8px 7px;min-width:0}
        .gh-repo-facts b{display:block;margin-top:3px;font-size:10px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .gh-repo-footer{display:flex;align-items:center;gap:10px;padding-top:9px;border-top:1px solid var(--adm-border);color:var(--adm-muted);font-size:10px}
        .gh-repo-counters{display:flex;align-items:center;gap:12px}.gh-repo-counters b{color:var(--adm-text)}
        .gh-filter-row{display:grid;grid-template-columns:minmax(0,1fr) 150px 150px;gap:8px}
        .gh-command-select{display:none;width:100%;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:9px;padding:10px 11px;color:var(--adm-text);font-size:12px;font-weight:700;outline:none}
        .gh-repo-title{word-break:normal;overflow-wrap:anywhere;line-height:1.2}.gh-repo-path{overflow-wrap:anywhere}
        .gh-github-summary{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:10px;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:10px;padding:12px}
        .gh-overview-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-items:stretch}
        .gh-overview-card,.gh-publish-card,.gh-readme-section{min-width:0;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:12px;padding:12px}
        .gh-overview-head,.gh-card-section-head,.gh-readme-head,.gh-cloud-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;min-width:0}.gh-overview-head>div,.gh-readme-head>div{min-width:0}.gh-overview-head span,.gh-readme-head span,.gh-kicker{display:block;font-size:7px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--adm-accent)}.gh-overview-head b,.gh-readme-head b{display:block;font-size:12px;margin-top:2px;color:var(--adm-text)}
        .gh-overview-body{display:grid;gap:10px}.gh-overview-body p{margin:3px 0 0;font-size:10.5px;line-height:1.45;color:var(--adm-text);overflow-wrap:anywhere}.gh-overview-body a{font-size:10px;color:var(--adm-blue,var(--adm-accent));overflow-wrap:anywhere}.gh-mini-label{font-size:7px;color:var(--adm-muted);font-weight:850;text-transform:uppercase;letter-spacing:.06em}.gh-muted{color:var(--adm-muted)!important}.gh-inline-link{display:inline-flex;margin-top:2px;text-decoration:none;font-weight:750}
        .gh-compact-info{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.gh-compact-info>div{min-width:0;background:var(--adm-bg);border:1px solid var(--adm-border);border-radius:8px;padding:7px}.gh-compact-info span{display:block;font-size:6.8px;color:var(--adm-muted);font-weight:800;text-transform:uppercase;letter-spacing:.04em}.gh-compact-info b{display:block;margin-top:3px;font-size:9.5px;color:var(--adm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gh-topic-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
        .gh-readme-section{margin-top:12px;padding:12px}.gh-readme-section .gh-readme{border:0;border-top:1px solid var(--adm-border);border-radius:0;padding:14px 0 0;margin-top:2px}
        .gh-publish-shell{min-width:0}.gh-publish-intro{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;margin-bottom:12px}.gh-publish-intro h3{margin:3px 0 4px;font-size:15px;color:var(--adm-text)}.gh-publish-intro p{margin:0;font-size:10.5px;line-height:1.5;color:var(--adm-muted)}.gh-destination-pill{max-width:260px;padding:8px 10px;border-radius:9px;background:color-mix(in srgb,var(--adm-accent) 9%,var(--adm-surface));border:1px solid color-mix(in srgb,var(--adm-accent) 30%,var(--adm-border));font:700 9px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--adm-text);overflow-wrap:anywhere}
        .gh-publish-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.gh-card-section-head b{font-size:11px;color:var(--adm-text)}.gh-card-section-head>span{font-size:8px;color:var(--adm-muted);text-align:right}.gh-field{display:block;margin-top:9px}.gh-field>span{display:block;font-size:8px;font-weight:800;color:var(--adm-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}.gh-two-fields{display:grid;grid-template-columns:1fr 1fr;gap:7px}.gh-path-preview{margin-top:9px;border:1px solid var(--adm-border);background:var(--adm-bg);border-radius:8px;padding:8px}.gh-path-preview span{display:block;font-size:7px;color:var(--adm-muted);font-weight:800;text-transform:uppercase;margin-bottom:3px}.gh-path-preview code{display:block;font-size:8.5px;color:var(--adm-text);white-space:normal;overflow-wrap:anywhere}.gh-check-row{display:flex;gap:8px;align-items:flex-start;margin-top:10px;cursor:pointer}.gh-check-row input{margin-top:2px;accent-color:var(--adm-accent);flex:0 0 auto}.gh-check-row span{min-width:0}.gh-check-row b{display:block;font-size:9.5px;color:var(--adm-text)}.gh-check-row small{display:block;margin-top:2px;font-size:8.5px;line-height:1.35;color:var(--adm-muted)}.gh-upload-box{display:grid;place-items:center;text-align:center;min-height:104px;border:1px dashed color-mix(in srgb,var(--adm-accent) 45%,var(--adm-border));border-radius:10px;padding:12px;background:color-mix(in srgb,var(--adm-accent) 4%,var(--adm-bg));cursor:pointer;overflow:hidden}.gh-upload-box input{max-width:100%;font-size:9px}.gh-upload-box strong{font-size:10.5px;margin-top:8px;color:var(--adm-text);overflow-wrap:anywhere}.gh-upload-box span{font-size:8.5px;color:var(--adm-muted);line-height:1.35;margin-top:3px}
        .gh-cloud-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.gh-cloud-card{border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-bg);padding:9px;min-width:0}.gh-cloud-title{margin-bottom:6px}.gh-cloud-title>b{font-size:10.5px}.gh-cloud-card p,.gh-cloud-note{font-size:8.5px;line-height:1.4;color:var(--adm-muted);margin:0}.gh-cloud-row{display:flex;align-items:center;justify-content:space-between;gap:7px;border-top:1px solid var(--adm-border);padding:7px 0}.gh-cloud-row:first-of-type{border-top:0}.gh-cloud-row span{min-width:0}.gh-cloud-row b{display:block;font-size:9.5px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gh-cloud-row small{display:block;font-size:7.5px;color:var(--adm-muted);margin-top:2px}.gh-cloud-row em{font-style:normal;font-size:7.5px;color:var(--adm-accent);font-weight:800;white-space:nowrap}.gh-cloud-note{margin-top:8px}.gh-muted-box,.gh-error-box{padding:10px;border-radius:8px;background:var(--adm-bg);border:1px solid var(--adm-border);font-size:9px;color:var(--adm-muted)}.gh-error-box{color:var(--adm-red,#c33);border-color:color-mix(in srgb,var(--adm-red,#c33) 35%,var(--adm-border))}
        .gh-publish-confirm{display:grid;grid-template-columns:1fr 1fr;gap:8px}.gh-publish-confirm>div{min-width:0;padding:9px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-bg)}.gh-publish-confirm span{display:block;font-size:7px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;color:var(--adm-muted)}.gh-publish-confirm b{display:block;margin-top:3px;font-size:10px;color:var(--adm-text);overflow-wrap:anywhere}.gh-publish-confirm small{display:block;margin-top:3px;font-size:8px;line-height:1.35;color:var(--adm-muted)}
        .gh-publish-result{margin-top:12px;padding:12px;border-radius:11px;border:1px solid color-mix(in srgb,var(--adm-green,#1d9f55) 35%,var(--adm-border));background:color-mix(in srgb,var(--adm-green,#1d9f55) 7%,var(--adm-surface));display:grid;gap:9px}.gh-publish-result>div:first-child b{display:block;font-size:11px;color:var(--adm-text)}.gh-publish-result>div:first-child span{display:block;font-size:8.5px;color:var(--adm-muted);margin-top:2px}.gh-result-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.gh-result-stats span{font-size:7.5px;color:var(--adm-muted);padding:7px;background:var(--adm-bg);border-radius:7px;border:1px solid var(--adm-border);text-align:center}.gh-result-stats b{display:block;color:var(--adm-text);font-size:9px}.gh-publish-result>a{font-size:9px;font-weight:800;color:var(--adm-accent);text-decoration:none}
        .gh-wizard-shell{min-width:0}.gh-wizard-progress{padding:2px 0 14px;border-bottom:1px solid var(--adm-border);margin-bottom:16px}.gh-wizard-progress-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.gh-wizard-progress-top b{font-size:10px;color:var(--adm-text)}.gh-wizard-progress-top span{font-size:9px;color:var(--adm-muted)}.gh-wizard-track{height:4px;background:var(--adm-bg);border-radius:999px;overflow:hidden;margin-top:8px}.gh-wizard-track>span{display:block;height:100%;border-radius:inherit;background:var(--adm-accent);transition:width .2s ease}.gh-wizard-dots{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin-top:8px}.gh-wizard-dots button{height:24px;border-radius:7px;border:1px solid var(--adm-border);background:var(--adm-bg);color:var(--adm-muted);font-size:9px;font-weight:850}.gh-wizard-dots button.ativo{border-color:var(--adm-accent);background:color-mix(in srgb,var(--adm-accent) 10%,var(--adm-surface));color:var(--adm-accent)}.gh-wizard-dots button.feito{border-color:color-mix(in srgb,var(--adm-green,#1d9f55) 40%,var(--adm-border));color:var(--adm-green,#1d9f55);cursor:pointer}.gh-wizard-step{min-height:300px}.gh-wizard-step-head{display:flex;gap:11px;align-items:flex-start;margin-bottom:16px}.gh-wizard-step-head>span{display:grid;place-items:center;width:28px;height:28px;flex:0 0 auto;border-radius:9px;background:color-mix(in srgb,var(--adm-accent) 12%,var(--adm-surface));border:1px solid color-mix(in srgb,var(--adm-accent) 30%,var(--adm-border));font-size:11px;font-weight:900;color:var(--adm-accent)}.gh-wizard-step-head h3{margin:0;font-size:15px;color:var(--adm-text)}.gh-wizard-step-head p{margin:4px 0 0;font-size:10px;line-height:1.45;color:var(--adm-muted)}.gh-wizard-upload{min-height:150px}.gh-wizard-summary-line{margin-top:12px;padding:11px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-bg)}.gh-wizard-summary-line span{display:block;font-size:7.5px;font-weight:850;text-transform:uppercase;color:var(--adm-muted);margin-bottom:4px}.gh-wizard-summary-line code{display:block;font-size:10px;overflow-wrap:anywhere;color:var(--adm-text)}.gh-wizard-choice{padding:12px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-bg)}.gh-wizard-cloud{margin-top:12px}.gh-wizard-actions{display:flex;justify-content:space-between;gap:8px;padding-top:14px;margin-top:16px;border-top:1px solid var(--adm-border);position:sticky;bottom:-1px;background:var(--adm-surface);z-index:2}.gh-wizard-warning{margin-top:12px;padding:10px;border:1px solid color-mix(in srgb,var(--adm-amber,#b7791f) 35%,var(--adm-border));border-radius:9px;background:color-mix(in srgb,var(--adm-amber,#b7791f) 7%,var(--adm-surface));font-size:9px;color:var(--adm-text);overflow-wrap:anywhere}.gh-wizard-success{text-align:center;padding:10px 0}.gh-wizard-success-icon{display:grid;place-items:center;margin:0 auto 10px;width:48px;height:48px;border-radius:50%;background:color-mix(in srgb,var(--adm-green,#1d9f55) 12%,var(--adm-surface));color:var(--adm-green,#1d9f55);font-size:24px;font-weight:900}.gh-wizard-success h3{margin:0;font-size:16px;color:var(--adm-text)}.gh-wizard-success>p{font-size:10px;color:var(--adm-muted);overflow-wrap:anywhere}.gh-wizard-success>a{display:inline-flex;margin:12px 0;font-size:10px;font-weight:800;color:var(--adm-accent);text-decoration:none}.gh-wizard-deploys{text-align:left;margin-top:14px;border:1px solid var(--adm-border);border-radius:10px;padding:10px}.gh-command-empty{min-height:120px}.gh-publish-progress{margin-top:10px;padding:10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-bg)}.gh-publish-progress-head{display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:9px;color:var(--adm-text)}.gh-publish-progress-head span{font-weight:900;color:var(--adm-accent)}.gh-publish-progress-track{height:6px;margin-top:7px;border-radius:999px;background:var(--adm-surface);overflow:hidden}.gh-publish-progress-track>span{display:block;height:100%;background:var(--adm-accent);border-radius:inherit;transition:width .18s ease}.gh-publish-progress small{display:block;margin-top:6px;font-size:8px;line-height:1.45;color:var(--adm-muted)}
        .gh-readme{background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:10px;padding:16px;max-width:100%;overflow:auto;color:var(--adm-text);font-size:12px;line-height:1.65;word-wrap:break-word}
        .gh-readme>*:first-child{margin-top:0}.gh-readme>*:last-child{margin-bottom:0}.gh-readme h1{font-size:20px}.gh-readme h2{font-size:17px}.gh-readme h3{font-size:15px}.gh-readme h1,.gh-readme h2{padding-bottom:6px;border-bottom:1px solid var(--adm-border)}
        .gh-readme pre{max-width:100%;overflow:auto;background:var(--adm-bg);border:1px solid var(--adm-border);border-radius:8px;padding:11px}.gh-readme code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}.gh-readme :not(pre)>code{background:var(--adm-bg);padding:2px 5px;border-radius:5px}
        .gh-readme table{display:block;width:max-content;max-width:100%;overflow:auto;border-collapse:collapse}.gh-readme th,.gh-readme td{border:1px solid var(--adm-border);padding:6px 9px}.gh-readme img{max-width:100%;height:auto}.gh-readme a{color:var(--adm-blue,var(--adm-accent));overflow-wrap:anywhere}.gh-readme blockquote{margin-left:0;padding-left:12px;border-left:3px solid var(--adm-border);color:var(--adm-muted)}
        .gh-readme-fallback{background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:10px;padding:14px;font-size:11px;color:var(--adm-text);line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}
        .gh-profile-edit-head{display:flex;align-items:center;gap:12px;padding:10px;background:var(--adm-surface2);border:1px solid var(--adm-border);border-radius:10px}.gh-profile-edit-avatar{width:54px;height:54px;border-radius:50%;object-fit:cover}.gh-external-btn{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:6px 9px;border:1px solid var(--adm-border);border-radius:8px;color:var(--adm-text);font-size:10px;font-weight:700;text-decoration:none;background:var(--adm-surface)}
        .gh-profile-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gh-profile-form-grid label>span{display:block;font-size:10px;color:var(--adm-muted);font-weight:700;margin-bottom:5px}.gh-profile-wide{grid-column:1/-1}.gh-profile-check{display:flex!important;align-items:center;gap:8px;color:var(--adm-text);font-size:11px}.gh-profile-check input{accent-color:var(--adm-accent)}
        @media(max-width:980px){.gh-repo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:760px){.gh-repo-grid{grid-template-columns:1fr}.gh-filter-row{grid-template-columns:1fr 1fr}.gh-filter-row input{grid-column:1/-1}.gh-account-hero:after{right:-95px;top:-85px}.gh-repo-facts{grid-template-columns:repeat(3,minmax(0,1fr))}.gh-repo-drawer{width:100vw!important;border-left:0!important}.gh-repo-head{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:10px!important}.gh-repo-header-actions{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto!important;width:100%;gap:7px!important}.gh-repo-header-actions>a,.gh-repo-header-actions>button:not(:last-child){width:100%!important;min-width:0!important}.gh-repo-header-actions>a{font-size:10px!important;padding:6px 7px!important}.gh-github-summary{grid-template-columns:1fr}.gh-detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.gh-readme{padding:12px}.gh-readme h1{font-size:18px}.gh-readme h2{font-size:16px}}
        @media(max-width:520px){.gh-account-hero{padding:12px}.gh-profile-row{grid-template-columns:auto minmax(0,1fr)}.gh-profile-actions{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr}.gh-profile-actions>*{width:100%;justify-content:center}.gh-account-stats{margin-top:10px}.gh-account-stat{padding:8px 5px;text-align:center}.gh-account-stat span{font-size:6.8px;letter-spacing:.03em;min-height:18px;display:flex;align-items:center;justify-content:center}.gh-account-stat b{font-size:11px}.gh-profile-avatar{width:40px;height:40px}.gh-profile-meta h1{font-size:15px}.gh-profile-meta p{font-size:10px}.gh-repo-card{padding:13px}.gh-repo-facts>div{padding:7px 5px}.gh-repo-facts span{font-size:7px;letter-spacing:.04em}.gh-repo-facts b{font-size:9px}.gh-profile-form-grid{grid-template-columns:1fr}.gh-profile-wide{grid-column:auto}.gh-profile-edit-head{align-items:flex-start;flex-wrap:wrap}.gh-external-btn{width:100%}.gh-overview-pair{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.gh-overview-card{padding:9px}.gh-overview-head{align-items:flex-start}.gh-overview-head b{font-size:10.5px}.gh-overview-body p{font-size:9px}.gh-compact-info{gap:4px}.gh-compact-info>div{padding:5px}.gh-compact-info b{font-size:8.5px}.gh-publish-intro{grid-template-columns:1fr}.gh-destination-pill{max-width:none}.gh-publish-grid,.gh-cloud-grid{grid-template-columns:1fr}.gh-two-fields{grid-template-columns:1fr 1fr}.gh-publish-card{padding:10px}.gh-publish-confirm{grid-template-columns:1fr}.gh-wizard-step{min-height:260px}.gh-wizard-progress-top{align-items:flex-start}.gh-wizard-progress-top span{text-align:right}.gh-wizard-dots{gap:3px}.gh-wizard-dots button{height:22px;padding:0}.gh-wizard-actions>*{flex:1;justify-content:center}.gh-command-empty{padding:12px!important}.gh-run-card{flex-direction:column!important}.gh-run-actions{width:100%;justify-content:flex-start!important}.gh-run-actions>*{flex:1;justify-content:center}.gh-log-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
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
