import { isBackendReady, startBackendWake } from './backendWake.js'
import {
  getPublicSnapshot,
  isPublicPortalRoute,
  markPrimaryApiAvailable,
  markPublicFallbackActive,
  revalidatePublicSnapshot,
} from './publicFallback.js'

let started = false
let interval = null
let visibilityHandler = null
let readyHandler = null
let fallbackTimer = null
let postReadyTimer = null

function refreshSnapshot(force = false) {
  return revalidatePublicSnapshot({ force }).catch(() => null)
}

export function startPublicPortalSync() {
  if (typeof window === 'undefined' || !isPublicPortalRoute()) return () => {}
  if (started) return stopPublicPortalSync
  started = true

  // 1) O navegador entrega a última cópia imediatamente.
  void getPublicSnapshot({ allowLocal: true }).catch(() => {})
  // 2) R2/Vercel é revalidado sem esperar o Render.
  void refreshSnapshot(true)

  const handleReady = () => {
    if (fallbackTimer) window.clearTimeout(fallbackTimer)
    fallbackTimer = null
    markPrimaryApiAvailable()
    // O scheduler do backend atualiza o R2 logo após o boot. Damos alguns
    // segundos para Mongo + snapshot sincronizarem antes de buscar outra cópia.
    if (!postReadyTimer) {
      postReadyTimer = window.setTimeout(() => {
        postReadyTimer = null
        void refreshSnapshot(true)
      }, 3500)
    }
  }

  readyHandler = handleReady
  window.addEventListener('alsistemas:backend-ready', readyHandler)

  // 3) Uma única rotina acorda o backend por baixo dos panos por até 90 s.
  // Se ele já estiver pronto (por exemplo ao navegar entre páginas públicas),
  // não ativamos o aviso de contingência por engano.
  if (isBackendReady()) {
    handleReady()
  } else {
    fallbackTimer = window.setTimeout(async () => {
      try {
        const snapshot = await getPublicSnapshot({ allowLocal: true })
        if (snapshot && !isBackendReady()) markPublicFallbackActive(snapshot, 'backend-waking')
      } catch { /* sem snapshot: as telas públicas mantêm os estados próprios */ }
    }, 12_000)

    void startBackendWake({ maxWaitMs: 90_000 }).then(ready => {
      if (ready && started) handleReady()
    })
  }

  interval = window.setInterval(() => {
    if (!document.hidden) void refreshSnapshot(false)
  }, 60_000)

  visibilityHandler = () => {
    if (document.hidden) return
    void refreshSnapshot(false)
    void startBackendWake({ maxWaitMs: 90_000 }).then(ready => {
      if (ready && started) handleReady()
    })
  }
  document.addEventListener('visibilitychange', visibilityHandler)

  return stopPublicPortalSync
}

export function stopPublicPortalSync() {
  if (typeof window === 'undefined') return
  if (interval) window.clearInterval(interval)
  if (fallbackTimer) window.clearTimeout(fallbackTimer)
  if (postReadyTimer) window.clearTimeout(postReadyTimer)
  if (readyHandler) window.removeEventListener('alsistemas:backend-ready', readyHandler)
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
  interval = null
  fallbackTimer = null
  postReadyTimer = null
  readyHandler = null
  visibilityHandler = null
  started = false
}
