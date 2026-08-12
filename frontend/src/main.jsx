import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Toaster, ToastBar, toast } from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { BrandingProvider } from './context/BrandingContext'
import ErrorBoundary from './components/ErrorBoundary'
import RouterErrorScreen from './components/RouterErrorScreen'
import { isChunkLoadError, recoverFromChunkError } from './utils/lazyWithRetry'
import { errosService } from './services/api'
import App from './App.jsx'
import GlobalUpdateBanner, { notifyUpdateAvailable } from './components/admin/ui/GlobalUpdateBanner.jsx'
import './index.css'

// ─── Deduplicação de erros ───────────────────────────────────
let ultimoErro = ''
let ultimoTs   = 0

function deveEnviar(msg) {
  const agora = Date.now()
  const chave = msg?.slice(0, 100)
  if (chave === ultimoErro && agora - ultimoTs < 5000) return false
  ultimoErro = chave
  ultimoTs   = agora
  return true
}

// ─── ChunkLoadError: recuperação automática após deploy ──────
window.addEventListener('unhandledrejection', async (event) => {
  const razao = event.reason

  if (isChunkLoadError(razao)) {
    event.preventDefault()
    await recoverFromChunkError(razao)
    return
  }

  const mensagem = razao?.message || String(razao) || 'Promise rejeitada sem motivo'
  if (!deveEnviar(mensagem)) return
  errosService.capturar({
    tipo: 'unhandled_rejection',
    mensagem,
    stack: razao?.stack || null,
    dados: { type: typeof razao },
  })
})

// ─── Erros JS síncronos ──────────────────────────────────────
window.onerror = function (mensagem, fonte, linha, coluna, erroObj) {
  const msg = erroObj?.message || String(mensagem)
  if (!deveEnviar(msg)) return false
  errosService.capturar({
    tipo: 'js_error',
    mensagem: msg,
    stack: erroObj?.stack || `${fonte}:${linha}:${coluna}`,
    dados: { fonte, linha, coluna },
  })
  return false
}

// Remove apenas o parâmetro técnico após a recuperação, sem nova navegação.
const currentUrl = new URL(window.location.href)
if (currentUrl.searchParams.has('__als_update') || currentUrl.searchParams.has('__als_recover')) {
  currentUrl.searchParams.delete('__als_update')
  currentUrl.searchParams.delete('__als_recover')
  window.history.replaceState({}, document.title, currentUrl.toString())
}

// ═══════════════════════════════════════════════════════════════
// Service Worker + Banner de nova versão
// ═══════════════════════════════════════════════════════════════

if ('serviceWorker' in navigator) {
  // ── Captura o estado ANTES de qualquer operação async ──────
  // Se já havia um controller quando a página carregou, é uma
  // atualização real. Se não havia, é primeira instalação —
  // e o banner NÃO deve aparecer.
  const hadControllerOnLoad = !!navigator.serviceWorker.controller

  // O aviso visual agora é React e usa os tokens do tema global.

  // ── Listener registrado CEDO — antes de qualquer await ─────
  // Caso 1: SW ativo manda SW_UPDATED após claim().
  // Registrar aqui (e não dentro do .then()) evita a race condition
  // onde o SW ativa rápido e envia a mensagem antes do listener existir.
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type !== 'SW_UPDATED') return

    // Primeira instalação: hadControllerOnLoad é false.
    // Não exibimos o banner — o SW ainda não controlava a página.
    if (!hadControllerOnLoad) return

    // Atraso curto para não exibir imediatamente após o claim()
    setTimeout(() => notifyUpdateAvailable(() => window.location.reload()), 1000)
  })

  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          // Caso 2: novo SW instalado enquanto a aba está aberta.
          // Detectamos via updatefound + statechange.
          // Só mostramos o banner se já havia um controller (atualização real).
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing
            if (!sw) return
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                notifyUpdateAvailable(() => {
                  if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
                  window.location.reload()
                })
              }
            })
          })
        })
        .catch(err => console.warn('SW registration failed:', err))
    })
  } else {
    // Em desenvolvimento: remove qualquer SW residual para evitar cache stale
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => reg.unregister())
    })
  }
}

// ─── Router ──────────────────────────────────────────────────
const router = createBrowserRouter([{ path: '*', element: <App />, errorElement: <RouterErrorScreen /> }])

// ─── Render ──────────────────────────────────────────────────
function BootReady() {
  useEffect(() => { window.__AL_NATIVE_GUARD_HIDE__?.() }, [])
  return null
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Elemento #root não encontrado no documento.')

ReactDOM.createRoot(rootElement).render(
    <>
      <BootReady />
    <ErrorBoundary>
      <ThemeProvider>
        <BrandingProvider>
          <AuthProvider>
            <RouterProvider router={router} />
            <GlobalUpdateBanner />
            <Toaster
          position="top-right"
          containerStyle={{ top: 92, right: 12, left: 12 }}
          gutter={10}
          toastOptions={{
            duration: 9000,
            success: {
              duration: 7500,
              iconTheme: { primary: '#22c55e', secondary: '#fff' },
            },
            error: {
              duration: 16000,
              iconTheme: { primary: '#ef4444', secondary: '#fff' },
            },
            loading: { duration: Infinity },
          }}
        >
          {(t) => (
            <ToastBar
              toast={t}
              style={{
                width: 'min(440px, calc(100vw - 24px))',
                maxWidth: 440,
                padding: '14px 14px',
                borderRadius: 14,
                border: `1px solid ${t.type === 'error' ? 'rgba(220,38,38,.45)' : t.type === 'success' ? 'rgba(34,197,94,.38)' : 'rgba(var(--adm-accent-rgb),.28)'}`,
                boxShadow: 'var(--adm-shadow-md)',
                background: 'var(--adm-surface, #17191f)',
                color: 'var(--adm-text, #f8fafc)',
              }}
            >
              {({ icon, message }) => {
                const text = typeof t.message === 'string' ? t.message : ''
                return (
                  <div style={{ display:'grid', gridTemplateColumns:'auto minmax(0,1fr) auto', gap:10, alignItems:'start', width:'100%' }}>
                    <div style={{ paddingTop:2 }}>{icon}</div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.05em', textTransform:'uppercase', opacity:.7, marginBottom:3 }}>
                        {t.type === 'error' ? 'Atenção' : t.type === 'success' ? 'Concluído' : t.type === 'loading' ? 'Processando' : 'Informação'}
                      </div>
                      <div style={{ fontSize:14, lineHeight:1.45, fontWeight:600, overflowWrap:'anywhere' }}>{message}</div>
                      {t.type === 'error' && text && (
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(text)}
                          style={{ marginTop:9, border:'1px solid var(--adm-border2)', background:'transparent', color:'inherit', borderRadius:8, padding:'6px 9px', fontSize:12, fontWeight:700, cursor:'pointer' }}
                        >
                          📋 Copiar erro
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="Fechar notificação"
                      onClick={() => toast.dismiss(t.id)}
                      style={{ border:0, background:'transparent', color:'inherit', opacity:.65, fontSize:20, lineHeight:1, cursor:'pointer', padding:'0 2px' }}
                    >
                      ×
                    </button>
                  </div>
                )
              }}
            </ToastBar>
          )}
            </Toaster>
          </AuthProvider>
        </BrandingProvider>
      </ThemeProvider>
    </ErrorBoundary>
    </>
)
