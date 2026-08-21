import { BASE_URL } from './domains/http.js'

const DEFAULT_MAX_WAIT_MS = 90_000
const READY_TTL_MS = 2 * 60_000
const state = {
  status: 'idle',
  phase: 'idle',
  startedAt: 0,
  liveAt: 0,
  readyAt: 0,
  finishedAt: 0,
  lastError: '',
  attempt: 0,
  promise: null,
}

function browserReady() {
  return typeof window !== 'undefined' && typeof fetch === 'function'
}

function snapshotState() {
  const now = Date.now()
  return {
    status: state.status,
    phase: state.phase,
    startedAt: state.startedAt || null,
    liveAt: state.liveAt || null,
    readyAt: state.readyAt || null,
    finishedAt: state.finishedAt || null,
    elapsedMs: state.startedAt ? Math.max(0, (state.readyAt || state.finishedAt || now) - state.startedAt) : 0,
    lastError: state.lastError,
    attempt: state.attempt,
  }
}

function emit() {
  if (!browserReady()) return
  window.dispatchEvent(new CustomEvent('alsistemas:backend-wake', { detail: snapshotState() }))
}

function setStatus(status, patch = {}) {
  state.status = status
  Object.assign(state, patch)
  emit()
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function probe(path, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // O parâmetro único impede que um Service Worker devolva health antigo do
    // cache e faça o frontend acreditar que o Render já acordou/está pronto.
    const base = String(BASE_URL).replace(/\/+$/, '')
    const separator = base.includes('?') ? '&' : '?'
    const url = `${base}${path}${separator}wake=${Date.now()}`
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
    if (!response.ok) {
      const error = new Error(`Health respondeu HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return true
  } finally {
    clearTimeout(timer)
  }
}

export function getBackendWakeState() {
  return snapshotState()
}

export function isBackendLive() {
  return Boolean(state.liveAt || state.status === 'ready')
}

export function isBackendReady() {
  if (state.status !== 'ready') return false
  return !state.readyAt || Date.now() - state.readyAt < READY_TTL_MS
}

export function startBackendWake({ maxWaitMs = DEFAULT_MAX_WAIT_MS, force = false } = {}) {
  if (!browserReady()) return Promise.resolve(false)
  if (!force && isBackendReady()) return Promise.resolve(true)
  if (!force && state.promise) return state.promise

  const maxWait = Math.max(15_000, Math.min(180_000, Number(maxWaitMs) || DEFAULT_MAX_WAIT_MS))
  const startedAt = Date.now()
  state.startedAt = startedAt
  state.liveAt = 0
  state.readyAt = 0
  state.finishedAt = 0
  state.lastError = ''
  state.attempt = 0
  state.phase = 'http'
  setStatus('waking')

  state.promise = (async () => {
    // Fase 1: acorda o processo HTTP. A primeira chamada pode permanecer aberta
    // durante quase todo o cold start do Render, sem bombardear o serviço.
    while (Date.now() - startedAt < maxWait && !state.liveAt) {
      state.attempt += 1
      state.phase = 'http'
      emit()
      const elapsed = Date.now() - startedAt
      const remaining = Math.max(1000, maxWait - elapsed)
      const timeoutMs = state.attempt === 1
        ? Math.min(65_000, remaining)
        : Math.min(12_000, remaining)
      try {
        await probe('/health/live', timeoutMs)
        state.liveAt = Date.now()
        state.phase = 'data'
        state.lastError = ''
        emit()
        window.dispatchEvent(new CustomEvent('alsistemas:backend-live', {
          detail: { ...snapshotState(), source: 'health-live' },
        }))
      } catch (error) {
        state.lastError = error?.name === 'AbortError'
          ? 'O servidor ainda está inicializando.'
          : (error?.message || 'Falha de rede ao verificar o servidor.')
        emit()
        if (Date.now() - startedAt < maxWait) await wait(2500)
      }
    }

    // Fase 2: processo vivo não basta. Esperamos Mongo + bootstrap persistente
    // ficarem prontos antes de liberar as leituras ao vivo do portal/login.
    while (state.liveAt && Date.now() - startedAt < maxWait) {
      state.attempt += 1
      state.phase = 'data'
      emit()
      const remaining = Math.max(1000, maxWait - (Date.now() - startedAt))
      try {
        await probe('/health/ready', Math.min(8000, remaining))
        const readyAt = Date.now()
        setStatus('ready', { phase: 'ready', readyAt, finishedAt: readyAt, lastError: '' })
        window.dispatchEvent(new CustomEvent('alsistemas:backend-ready', {
          detail: { ...snapshotState(), source: 'health-ready' },
        }))
        return true
      } catch (error) {
        state.lastError = error?.name === 'AbortError'
          ? 'Servidor online; dados ainda estão sendo preparados.'
          : (Number(error?.status) === 503
              ? 'Servidor online; banco e sessão ainda estão sendo preparados.'
              : (error?.message || 'Falha ao verificar a prontidão do servidor.'))
        emit()
      }
      if (Date.now() - startedAt < maxWait) await wait(1200)
    }

    const finishedAt = Date.now()
    setStatus('unavailable', { phase: state.liveAt ? 'data' : 'http', finishedAt })
    return false
  })().finally(() => {
    state.promise = null
  })

  return state.promise
}

export function waitForBackendLive({ maxWaitMs = DEFAULT_MAX_WAIT_MS } = {}) {
  if (!browserReady()) return Promise.resolve(false)
  if (isBackendLive()) return Promise.resolve(true)
  const maxWait = Math.max(5000, Math.min(180_000, Number(maxWaitMs) || DEFAULT_MAX_WAIT_MS))
  void startBackendWake({ maxWaitMs: maxWait })

  return new Promise(resolve => {
    let done = false
    const finish = value => {
      if (done) return
      done = true
      window.removeEventListener('alsistemas:backend-live', onLive)
      window.clearTimeout(timer)
      resolve(value)
    }
    const onLive = () => finish(true)
    const timer = window.setTimeout(() => finish(isBackendLive()), maxWait + 250)
    window.addEventListener('alsistemas:backend-live', onLive)
    if (isBackendLive()) finish(true)
  })
}

export function resetBackendWake() {
  state.status = 'idle'
  state.phase = 'idle'
  state.startedAt = 0
  state.liveAt = 0
  state.readyAt = 0
  state.finishedAt = 0
  state.lastError = ''
  state.attempt = 0
  state.promise = null
  emit()
}
