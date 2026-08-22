import { lazyWithRetry } from './utils/lazyWithRetry'
/**
 * App.jsx — Portal público + administração do AL Sistemas.
 *
 * O portal público (/ e conteúdo editorial) não depende de autenticação nem
 * da verificação do setup para renderizar. As verificações administrativas
 * ficam restritas a /login e /admin/*.
 */
import { Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import PrivateRoute, { AdminRoute } from './components/PrivateRoute'
import LoadingSpinner from './components/LoadingSpinner'
import AppErrorScreen from './components/AppErrorScreen'
import SetupStartupDiagnostics from './components/SetupStartupDiagnostics'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import GlobalMeta from './components/GlobalMeta'
import { setupService } from './services/api'
import { getBackendWakeState, isBackendReady, startBackendWake, waitForBackendLive } from './services/backendWake'
import { startPublicPortalSync } from './services/publicSync'

// ── Autenticação (carregadas no bundle principal — pequenas, sempre necessárias)
import Login          from './pages/Login'
import Home           from './pages/Home'
import EsqueciSenha   from './pages/EsqueciSenha'
import RedefinirSenha from './pages/RedefinirSenha'

// ── Portal público — lazy chunks
const NoticiaDetalhe  = lazyWithRetry(() => import('./pages/NoticiaDetalhe'))
const Categoria       = lazyWithRetry(() => import('./pages/Categoria'))
const Eventos         = lazyWithRetry(() => import('./pages/Eventos'))
const HorarioOnibus   = lazyWithRetry(() => import('./pages/HorarioOnibus'))

// ── Core SaaS — lazy chunks
const AdminLayout         = lazyWithRetry(() => import('./pages/admin/AdminLayout'))
const AdminDashboard      = lazyWithRetry(() => import('./pages/admin/AdminDashboard'))
const AdminErros          = lazyWithRetry(() => import('./pages/admin/AdminErros'))
const AdminUsuarios       = lazyWithRetry(() => import('./pages/admin/AdminUsuarios'))
const AdminBackup         = lazyWithRetry(() => import('./pages/admin/AdminBackup'))
const AdminSetup          = lazyWithRetry(() => import('./pages/admin/AdminSetup'))
const AdminCloudinary      = lazyWithRetry(() => import('./pages/admin/AdminCloudinary'))
const AdminSistema         = lazyWithRetry(() => import('./pages/admin/AdminSistema'))
const AdminPlataformas     = lazyWithRetry(() => import('./pages/admin/AdminPlataformas'))
const AdminProjetoPlataforma = lazyWithRetry(() => import('./pages/admin/AdminProjetoPlataforma'))
const AdminVariaveisAmbiente = lazyWithRetry(() => import('./pages/admin/AdminVariaveisAmbiente'))
const AdminArquivos       = lazyWithRetry(() => import('./pages/admin/AdminArquivos'))
const AdminTemas          = lazyWithRetry(() => import('./pages/admin/AdminTemas'))
const AdminIntegracoes     = lazyWithRetry(() => import('./pages/admin/AdminIntegracoes'))
const AdminAtualizacoes    = lazyWithRetry(() => import('./pages/admin/AdminAtualizacoes'))
const AdminCentral         = lazyWithRetry(() => import('./pages/admin/AdminCentral'))

// ── Módulo Portal (notícias/CMS) — mantido, apenas reagrupado na nav
// Estas páginas continuam funcionando em /admin/noticias, /admin/categorias etc.
// Em Sprint 3 serão movidas para src/modules/portal/
const AdminNoticias    = lazyWithRetry(() => import('./pages/admin/AdminNoticias'))
const AdminNoticiaForm = lazyWithRetry(() => import('./pages/admin/AdminNoticiaForm'))
const AdminCategorias  = lazyWithRetry(() => import('./pages/admin/AdminCategorias'))
const AdminModulos     = lazyWithRetry(() => import('./pages/admin/AdminModulos'))
const AdminOnibus      = lazyWithRetry(() => import('./pages/admin/AdminOnibus'))
const AdminEventos     = lazyWithRetry(() => import('./pages/admin/AdminEventos'))
const AdminNewsletter  = lazyWithRetry(() => import('./pages/admin/AdminNewsletter'))
const AdminSEO         = lazyWithRetry(() => import('./pages/admin/AdminSEO'))
const AdminRssImport   = lazyWithRetry(() => import('./pages/admin/AdminRssImport'))
const AdminFontes      = lazyWithRetry(() => import('./pages/admin/AdminFontes'))
const AdminMidia       = lazyWithRetry(() => import('./pages/admin/AdminMidia'))
const AdminConteudoQualidade = lazyWithRetry(() => import('./pages/admin/AdminConteudoQualidade'))
const AdminConteudoMetricas = lazyWithRetry(() => import('./pages/admin/AdminConteudoMetricas'))

// ── Sprint 3: Integrações ──────────────────────────────────────
const AdminGitHub      = lazyWithRetry(() => import('./pages/admin/AdminGitHub'))
const AdminProjetos    = lazyWithRetry(() => import('./pages/admin/AdminProjetos'))
// ── Sprint 4: Inteligência ─────────────────────────────────────
const AdminAIAssistant = lazyWithRetry(() => import('./pages/admin/AdminAIAssistant'))
// ── Sprint 5: Dados ────────────────────────────────────────────
const AdminMongo       = lazyWithRetry(() => import('./pages/admin/AdminMongo'))
// ── Monitor em Tempo Real ──────────────────────────────────────
const AdminMonitor     = lazyWithRetry(() => import('./pages/admin/AdminMonitor'))
const AdminSeguranca   = lazyWithRetry(() => import('./pages/admin/AdminSeguranca'))
const AdminCloudflare  = lazyWithRetry(() => import('./pages/admin/AdminCloudflare'))  // ☁️

// Wrapper de Suspense reutilizável
function S({ children }) {
  return (
    <Suspense fallback={<LoadingSpinner texto="Carregando painel..." />}>
      {children}
    </Suspense>
  )
}


function PublicMaintenanceGuard({children}){
  const [maintenance,setMaintenance]=useState(null)
  useEffect(()=>{
    let alive=true, timer=null, started=false
    const check=async()=>{
      try{
        const base=import.meta.env.VITE_API_URL||'/api'
        const r=await fetch(`${base}/maintenance/status`,{cache:'no-store',signal:AbortSignal.timeout(1800)})
        const d=await r.json()
        if(alive)setMaintenance(d?.active?d:null)
      }catch{
        // O portal nunca depende deste endpoint para abrir.
      }
    }
    const startPolling=()=>{
      if(started||!alive)return
      started=true
      check()
      timer=setInterval(check,15000)
    }
    if(isBackendReady())startPolling()
    const onReady=()=>startPolling()
    window.addEventListener('alsistemas:backend-ready',onReady)
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('alsistemas:backend-ready',onReady)}
  },[])
  if(!maintenance)return children
  return <div style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:20,background:'#f8fafc',color:'#172033'}}>
    <div style={{width:'min(100%,560px)',background:'#fff',border:'1px solid #dfe6ef',borderRadius:18,padding:24,boxShadow:'0 18px 50px rgba(15,23,42,.08)'}}>
      <div style={{fontSize:11,fontWeight:800,letterSpacing:'.08em',color:'#64748b'}}>PORTAL EM MANUTENÇÃO</div>
      <h1 style={{fontSize:25,margin:'7px 0 8px'}}>Atualização em andamento</h1>
      <p style={{color:'#64748b',lineHeight:1.55,marginBottom:0}}>{maintenance.message||'Estamos aplicando uma atualização. O portal volta automaticamente em instantes.'}</p>
      {maintenance.toVersion&&<div style={{marginTop:14,fontSize:12,color:'#94a3b8'}}>Atualização {maintenance.toVersion}</div>}
    </div>
  </div>
}

function SetupRouteFallback() {
  const [startedAt] = useState(() => { const now = performance.now(); window.__AL_SETUP_CHUNK_STARTED__ = now; return now })
  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at top, #f1f8f4 0%, #f8faf9 42%, #f6f8f7 100%)', padding: '24px 16px' }}>
      <SetupStartupDiagnostics
        startedAt={startedAt}
        stages={[
          { label: 'Backend / estado do setup', status: 'done', elapsed: window.__AL_SETUP_BOOT__?.elapsed, detail: 'Verificação local concluída' },
          { label: 'Carregando interface do assistente', status: 'running', startedAt, detail: 'Baixando/processando o módulo AdminSetup no Vite' },
          { label: 'Formulário de instalação', status: 'pending', detail: 'Aguardando o módulo acima' },
        ]}
      />
    </div>
  )
}


function PublicLayout({ children }) {
  useEffect(() => {
    const stop = startPublicPortalSync()
    return () => { if (typeof stop === 'function') stop() }
  }, [])
  return (
    <>
      <GlobalMeta />
      <Navbar />
      <main>{children}</main>
      <Footer />
    </>
  )
}


function FirstRunGuard({ children }) {
  const location = useLocation()
  const rotaSetup = location.pathname === '/admin/setup'
  const rotaLogin = location.pathname === '/login'
  const rotaProtegida = rotaLogin || location.pathname.startsWith('/admin')
  const rotaBloqueante = location.pathname.startsWith('/admin')
  const [state, setState] = useState({ loading: rotaBloqueante, checked: false, needed: false, error: null, retry: 0 })
  const [probeStartedAt, setProbeStartedAt] = useState(() => performance.now())
  const [probeElapsed, setProbeElapsed] = useState(null)
  const [showProbe, setShowProbe] = useState(false)
  const [wakeState, setWakeState] = useState(() => getBackendWakeState())

  useEffect(() => {
    const syncWake = (event) => setWakeState(event?.detail || getBackendWakeState())
    window.addEventListener('alsistemas:backend-wake', syncWake)
    setWakeState(getBackendWakeState())
    return () => window.removeEventListener('alsistemas:backend-wake', syncWake)
  }, [])

  useEffect(() => {
    if (!rotaProtegida) {
      setState(prev => ({ ...prev, loading: false, checked: true, needed: false, error: null }))
      setShowProbe(false)
      return undefined
    }

    let active = true
    let retryTimer = null
    const started = performance.now()
    setProbeStartedAt(started)
    setProbeElapsed(null)
    setShowProbe(false)
    const visualTimer = rotaBloqueante
      ? setTimeout(() => active && setShowProbe(true), 700)
      : null
    setState(prev => ({ ...prev, loading: rotaBloqueante, error: null }))

    const run = async () => {
      try {
        // Em rotas administrativas o wake roda em paralelo para informar ao
        // usuário se a Render está acordando, viva ou preparando banco/sessão.
        if (rotaBloqueante && !isBackendReady()) {
          void startBackendWake({ maxWaitMs: 90_000 })
        }

        // No login a interface aparece imediatamente. O Render é acordado em
        // segundo plano e só depois consultamos o estado de instalação.
        if (rotaLogin) {
          const ready = await waitForBackendLive({ maxWaitMs: 90_000 })
          if (!active) return
          if (!ready) {
            setState(prev => ({ ...prev, loading: false, checked: false, error: null }))
            return
          }
        }

        const data = await setupService.status(rotaLogin ? 15_000 : 90_000)
        if (!active) return
        const elapsed = performance.now() - started
        if (visualTimer) clearTimeout(visualTimer)
        setProbeElapsed(elapsed)
        if (rotaBloqueante && elapsed >= 700) setShowProbe(true)
        window.__AL_SETUP_BOOT__ = { status: data, elapsed, at: Date.now() }
        if (data.setup_pending) {
          setState(prev => ({ ...prev, loading: rotaBloqueante, checked: false, needed: false, error: null }))
          retryTimer = window.setTimeout(() => active && setState(prev => ({ ...prev, retry: prev.retry + 1 })), 1200)
          return
        }
        setState(prev => ({ ...prev, loading: false, checked: true, needed: Boolean(data.setup_needed), error: null }))
      } catch (error) {
        if (!active) return
        if (visualTimer) clearTimeout(visualTimer)
        setProbeElapsed(performance.now() - started)
        if (rotaBloqueante) setShowProbe(true)
        setState(prev => ({ ...prev, loading: false, checked: true, error, needed: false }))
      }
    }

    void run()
    return () => {
      active = false
      if (visualTimer) clearTimeout(visualTimer)
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [state.retry, rotaProtegida, rotaBloqueante, rotaLogin])

  const wakePhase = String(wakeState?.phase || 'idle')
  const wakeStatus = String(wakeState?.status || 'idle')
  const backendDone = wakeStatus === 'ready' || Boolean(wakeState?.readyAt)
  const backendLive = backendDone || Boolean(wakeState?.liveAt)
  const backendDetail = backendDone
    ? 'API, banco e bootstrap prontos'
    : backendLive || wakePhase === 'data'
      ? 'Servidor respondeu; preparando banco, sessão e dados administrativos'
      : wakeStatus === 'waking'
        ? 'A hospedagem pode estar saindo do modo de repouso da Render'
        : 'Iniciando conexão com a API'

  const probeStages = [
    { label: 'Aplicativo carregado', status: 'done', elapsed: 0, detail: `${location.pathname} • ${navigator.userAgent.includes('Android') ? 'Android' : 'navegador'}` },
    state.error
      ? { label: 'Hospedagem / API', status: 'error', elapsed: probeElapsed, detail: state.error?.message || wakeState?.lastError || 'Falha ao consultar o servidor' }
      : { label: 'Hospedagem / API', status: backendDone ? 'done' : 'running', startedAt: probeStartedAt, detail: backendDetail },
    state.checked
      ? { label: 'Configuração e sessão', status: 'done', elapsed: probeElapsed, detail: state.needed ? 'Instalação nova detectada' : 'Instalação existente e sessão verificadas' }
      : { label: 'Configuração e sessão', status: state.error ? 'error' : 'running', startedAt: probeStartedAt, detail: backendLive ? 'Validando instalação, permissões e sessão administrativa' : 'Aguardando o servidor para validar a instalação' },
    state.checked && !state.needed
      ? { label: 'Abrindo Administração', status: 'running', startedAt: performance.now(), detail: 'Carregando módulos e permissões do painel' }
      : state.checked && state.needed
        ? { label: 'Preparando próxima tela', status: rotaSetup ? 'done' : 'running', startedAt: performance.now(), detail: rotaSetup ? 'Assistente aberto' : 'Preparando assistente de configuração' }
        : { label: 'Abrindo Administração', status: 'pending', detail: 'Será liberada assim que as verificações terminarem' },
  ]

  if (state.checked && state.needed && !rotaSetup) {
    return <Navigate to="/admin/setup" replace state={{ from: location.pathname }} />
  }

  if (state.checked && !state.needed && rotaSetup) return <Navigate to="/login" replace />

  if ((rotaBloqueante && !rotaSetup && state.loading) || (rotaBloqueante && showProbe && !state.checked)) {
    return (
      <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at top, #f1f8f4 0%, #f8faf9 42%, #f6f8f7 100%)', padding: '24px 16px' }}>
        <SetupStartupDiagnostics
          title="Etapas para abrir a Administração"
          startedAt={probeStartedAt}
          stages={probeStages}
          onRetry={() => { void startBackendWake({ maxWaitMs: 90_000 }); setState(prev => ({ ...prev, retry: prev.retry + 1 })) }}
          statusHref="/status/"
        />
      </div>
    )
  }

  if (rotaBloqueante && !rotaSetup && state.error) {
    return (
      <AppErrorScreen
        variant="network"
        message="Não foi possível verificar o estado da instalação. Isso não significa que suas configurações foram perdidas."
        code="SETUP_STATUS_UNAVAILABLE"
        onRetry={() => setState(prev => ({ ...prev, retry: prev.retry + 1 }))}
        onReload={() => window.location.reload()}
        showBack={false}
      />
    )
  }

  return children
}

export default function App() {
  return (
    <FirstRunGuard>
    <Routes>
      {/* ── Portal público ─────────────────────────────────────── */}
      <Route path="/" element={<PublicMaintenanceGuard><PublicLayout><S><Home /></S></PublicLayout></PublicMaintenanceGuard>} />
      <Route path="/categoria/:slug" element={<PublicMaintenanceGuard><PublicLayout><S><Categoria /></S></PublicLayout></PublicMaintenanceGuard>} />
      <Route path="/noticia/:id" element={<PublicMaintenanceGuard><PublicLayout><S><NoticiaDetalhe /></S></PublicLayout></PublicMaintenanceGuard>} />
      <Route path="/eventos" element={<PublicMaintenanceGuard><PublicLayout><S><Eventos /></S></PublicLayout></PublicMaintenanceGuard>} />
      <Route path="/horario-onibus" element={<PublicMaintenanceGuard><PublicLayout><S><HorarioOnibus /></S></PublicLayout></PublicMaintenanceGuard>} />
      <Route path="/onibus" element={<Navigate to="/horario-onibus" replace />} />

      {/* ── Autenticação ──────────────────────────────────────── */}
      <Route path="/login"           element={<Login />} />
      <Route path="/esqueci-senha"   element={<EsqueciSenha />} />
      <Route path="/redefinir-senha" element={<RedefinirSenha />} />

      {/* Setup inicial — sem auth, redireciona se já instalado */}
      <Route path="/admin/setup" element={<Suspense fallback={<SetupRouteFallback />}><AdminSetup /></Suspense>} />

      {/* ── Admin SaaS ────────────────────────────────────────── */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <S><AdminLayout /></S>
          </AdminRoute>
        }
      >
        {/* Core SaaS */}
        <Route index                 element={<S><AdminDashboard /></S>} />
        <Route path="erros"          element={<S><AdminErros /></S>} />
        <Route path="usuarios"       element={<S><AdminUsuarios /></S>} />
        <Route path="backup"         element={<S><AdminBackup /></S>} />
        <Route path="cloudinary"    element={<S><AdminCloudinary /></S>} />
        <Route path="sistema"        element={<S><AdminSistema /></S>} />
        <Route path="infraestrutura"  element={<Navigate to="/admin/sistema" replace />} />
        <Route path="plataformas"      element={<S><AdminPlataformas /></S>} />
        <Route path="plataformas/variaveis" element={<S><AdminVariaveisAmbiente /></S>} />
        <Route path="plataformas/:projectId" element={<S><AdminProjetoPlataforma /></S>} />
        <Route path="ambientes"        element={<Navigate to="/admin/sistema?tab=ambiente" replace />} />
        <Route path="arquivos"       element={<S><AdminArquivos /></S>} />
        <Route path="temas"          element={<S><AdminTemas /></S>} />
        <Route path="integracoes"    element={<S><AdminIntegracoes /></S>} />
        <Route path="atualizacoes"   element={<S><AdminAtualizacoes /></S>} />
        <Route path="conteudo"       element={<S><AdminCentral area="conteudo" /></S>} />
        <Route path="portal"         element={<S><AdminCentral area="portal" /></S>} />
        <Route path="publicacao"     element={<S><AdminCentral area="publicacao" /></S>} />
        <Route path="central-sistema" element={<S><AdminCentral area="sistema" /></S>} />

        {/* Módulo Portal — rotas preservadas para não quebrar bookmarks/links */}
        <Route path="noticias"       element={<S><AdminNoticias /></S>} />
        <Route path="nova-noticia"   element={<S><AdminNoticiaForm /></S>} />
        <Route path="editar/:id"     element={<S><AdminNoticiaForm /></S>} />
        <Route path="categorias"     element={<S><AdminCategorias /></S>} />
        <Route path="modulos"        element={<S><AdminModulos /></S>} />
        <Route path="onibus"         element={<S><AdminOnibus /></S>} />
        <Route path="eventos"        element={<S><AdminEventos /></S>} />
        <Route path="newsletter"     element={<S><AdminNewsletter /></S>} />
        <Route path="seo"            element={<S><AdminSEO /></S>} />
        <Route path="rss-import"     element={<S><AdminRssImport /></S>} />
        <Route path="fontes"         element={<S><AdminFontes /></S>} />
        <Route path="midia"          element={<S><AdminMidia /></S>} />
        <Route path="conteudo-qualidade" element={<S><AdminConteudoQualidade /></S>} />
        <Route path="conteudo-metricas" element={<S><AdminConteudoMetricas /></S>} />

        {/* Sprint 3: Integrações */}
        <Route path="github"    element={<S><AdminGitHub /></S>} />
        <Route path="projetos"  element={<S><AdminProjetos /></S>} />
        {/* Sprint 4: Inteligência */}
        <Route path="ai-assistant" element={<S><AdminAIAssistant /></S>} />
        {/* Sprint 5: Dados */}
        <Route path="mongo"        element={<S><AdminMongo /></S>} />
        {/* Monitor em Tempo Real */}
        <Route path="monitor"      element={<S><AdminMonitor /></S>} />
        <Route path="seguranca"    element={<S><AdminSeguranca /></S>} />
        <Route path="cloudflare"   element={<S><AdminCloudflare /></S>} />  {/* ☁️ */}
      </Route>

      {/* 404 */}
      <Route
        path="*"
        element={
          <AppErrorScreen
            variant="route"
            code="404"
            message="O endereço informado não corresponde a nenhuma página disponível no AL Sistemas."
            showBack
            showHome
          />
        }
      />
    </Routes>
    </FirstRunGuard>
  )
}
