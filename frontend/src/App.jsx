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
import { ThemeProvider } from './context/ThemeContext'
import { setupService } from './services/api'

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
const AdminAmbientes       = lazyWithRetry(() => import('./pages/admin/AdminAmbientes'))
const AdminArquivos       = lazyWithRetry(() => import('./pages/admin/AdminArquivos'))
const AdminTemas          = lazyWithRetry(() => import('./pages/admin/AdminTemas'))
const AdminIntegracoes     = lazyWithRetry(() => import('./pages/admin/AdminIntegracoes'))
const AdminAtualizacoes    = lazyWithRetry(() => import('./pages/admin/AdminAtualizacoes'))

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
    let alive=true, timer=null
    const check=async()=>{
      try{
        const base=import.meta.env.VITE_API_URL||'/api'
        const r=await fetch(`${base}/maintenance/status`,{cache:'no-store',signal:AbortSignal.timeout(1200)})
        const d=await r.json()
        if(alive)setMaintenance(d?.active?d:null)
      }catch{
        // Nunca bloquear o portal porque o endpoint de manutenção falhou.
      }
    }
    check()
    timer=setInterval(check,5000)
    return()=>{alive=false;clearInterval(timer)}
  },[])
  if(!maintenance)return children
  return <div style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:20,background:'#f8fafc',color:'#172033'}}>
    <div style={{width:'min(100%,560px)',background:'#fff',border:'1px solid #dfe6ef',borderRadius:18,padding:24,boxShadow:'0 18px 50px rgba(15,23,42,.08)'}}>
      <div style={{fontSize:11,fontWeight:800,letterSpacing:'.08em',color:'#64748b'}}>PORTAL EM MANUTENÇÃO</div>
      <h1 style={{fontSize:25,margin:'7px 0 8px'}}>Atualização em andamento</h1>
      <p style={{color:'#64748b',lineHeight:1.55,marginBottom:0}}>{maintenance.message||'Estamos aplicando uma atualização. O portal volta automaticamente em instantes.'}</p>
      {maintenance.toVersion&&<div style={{marginTop:14,fontSize:12,color:'#94a3b8'}}>Atualizando para AL Sistemas {maintenance.toVersion}</div>}
    </div>
  </div>
}


function SetupRouteFallback() {
  const [startedAt] = useState(() => { const now = performance.now(); window.__AL_SETUP_CHUNK_STARTED__ = now; return now })
  return (
    <div style={{ minHeight: '100vh', background: '#f8faf9', padding: '42px 16px' }}>
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
  const rotaProtegida = location.pathname === '/login' || location.pathname.startsWith('/admin')
  const [state, setState] = useState({ loading: rotaProtegida, checked: false, needed: false, error: null, retry: 0 })
  const [probeStartedAt, setProbeStartedAt] = useState(() => performance.now())
  const [probeElapsed, setProbeElapsed] = useState(null)
  const [showProbe, setShowProbe] = useState(false)

  useEffect(() => {
    let active = true
    const started = performance.now()
    setProbeStartedAt(started)
    setProbeElapsed(null)
    setShowProbe(false)
    const visualTimer = setTimeout(() => active && setShowProbe(true), 700)
    // /api/setup/status usa o Mongo como autoridade em produção para reconhecer instalações existentes.
    setState(prev => ({ ...prev, loading: rotaProtegida, error: null }))
    setupService.status()
      .then(data => {
        if (!active) return
        const elapsed = performance.now() - started
        clearTimeout(visualTimer)
        setProbeElapsed(elapsed)
        // Se demorou, mantenha o diagnóstico visível durante a transição para que
        // seja possível enxergar/registrar o tempo responsável pelo atraso.
        if (elapsed >= 700) setShowProbe(true)
        window.__AL_SETUP_BOOT__ = { status: data, elapsed, at: Date.now() }
        if (data.setup_pending) {
          setState(prev => ({ ...prev, loading: true, checked: false, needed: false, error: null }))
          window.setTimeout(() => active && setState(prev => ({ ...prev, retry: prev.retry + 1 })), 900)
          return
        }
        setState(prev => ({ ...prev, loading: false, checked: true, needed: Boolean(data.setup_needed), error: null }))
      })
      .catch(error => {
        if (!active) return
        clearTimeout(visualTimer)
        setProbeElapsed(performance.now() - started)
        setShowProbe(true)
        setState(prev => ({ ...prev, loading: false, checked: true, error, needed: false }))
      })
    return () => { active = false; clearTimeout(visualTimer) }
  }, [state.retry])

  const probeStages = [
    { label: 'Frontend carregado', status: 'done', elapsed: 0, detail: `${location.pathname} • ${navigator.userAgent.includes('Android') ? 'Android' : 'navegador'}` },
    state.error
      ? { label: 'Backend / estado do setup', status: 'error', elapsed: probeElapsed, detail: state.error?.message || 'Falha ao consultar /api/setup/status' }
      : state.checked
        ? { label: 'Backend / estado do setup', status: 'done', elapsed: probeElapsed, detail: state.needed ? 'Instalação nova detectada' : 'Instalação existente detectada' }
        : { label: 'Backend / estado do setup', status: 'running', startedAt: probeStartedAt, detail: 'Aguardando GET /api/setup/status' },
    state.checked && state.needed
      ? { label: 'Redirecionamento para o assistente', status: rotaSetup ? 'done' : 'running', startedAt: performance.now(), detail: rotaSetup ? '/admin/setup aberto' : 'Preparando /admin/setup' }
      : { label: 'Redirecionamento para o assistente', status: 'pending', detail: 'Aguardando resultado da verificação' },
  ]

  if (state.checked && state.needed && !rotaSetup) {
    return <Navigate to="/admin/setup" replace state={{ from: location.pathname }} />
  }

  if (state.checked && !state.needed && rotaSetup) return <Navigate to="/login" replace />

  if ((rotaProtegida && !rotaSetup && state.loading) || (showProbe && !state.checked)) {
    // Em instalação nova/diagnóstico lento, mostrar a etapa real em vez de um
    // spinner genérico. Quando já instalado, desaparece automaticamente após a resposta.
    if (!state.checked || state.needed || state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#f8faf9', padding: '42px 16px' }}>
          <SetupStartupDiagnostics startedAt={probeStartedAt} stages={probeStages} />
        </div>
      )
    }
  }

  if (rotaProtegida && !rotaSetup && state.loading) return <LoadingSpinner texto="Verificando configuração inicial..." />
  if (rotaProtegida && !rotaSetup && state.error) {
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
            <ThemeProvider>
              <S><AdminLayout /></S>
            </ThemeProvider>
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
        <Route path="ambientes"        element={<S><AdminAmbientes /></S>} />
        <Route path="arquivos"       element={<S><AdminArquivos /></S>} />
        <Route path="temas"          element={<S><AdminTemas /></S>} />
        <Route path="integracoes"    element={<S><AdminIntegracoes /></S>} />
        <Route path="atualizacoes"   element={<S><AdminAtualizacoes /></S>} />

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
