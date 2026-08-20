/**
 * http.js — Cliente HTTP base compartilhado por todos os módulos de serviço.
 * Gerencia cookie HttpOnly, fallback Bearer para frontend/backend em domínios
 * diferentes, redirecionamento 401, timeout e parse de erros.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

const NativeSecureSession = registerPlugin('ALSecureSession')

export const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:3001/api' : '/api')

// Base sem o sufixo /api — usado para montar URLs de download autenticado
export const apiBase = BASE_URL.replace(/\/api$/, '')

const SESSION_TOKEN_KEY = 'alsistemas_session_token'
const SESSION_MODE_KEY  = 'alsistemas_auth_mode'
const SESSION_DB_NAME   = 'alsistemas-auth'
const SESSION_DB_STORE  = 'session'
const SESSION_DB_KEY    = 'persistent-token'

function webSessionDb() {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null)
  return new Promise(resolve => {
    try {
      const request = window.indexedDB.open(SESSION_DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(SESSION_DB_STORE)) db.createObjectStore(SESSION_DB_STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
}

async function webPersistentSession(action, value = '') {
  const db = await webSessionDb()
  if (!db) return action === 'get' ? '' : false
  try {
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_DB_STORE, 'readwrite')
      const store = tx.objectStore(SESSION_DB_STORE)
      let request
      if (action === 'set') request = store.put(String(value || ''), SESSION_DB_KEY)
      else if (action === 'remove') request = store.delete(SESSION_DB_KEY)
      else request = store.get(SESSION_DB_KEY)
      request.onsuccess = () => resolve(action === 'get' ? String(request.result || '') : true)
      request.onerror = () => reject(request.error)
    })
    return result
  } catch { return action === 'get' ? '' : false }
  finally { try { db.close() } catch {} }
}

export function getSessionToken() {
  try { return sessionStorage.getItem(SESSION_TOKEN_KEY) || '' } catch { return '' }
}

export function setSessionToken(token = '', mode = '') {
  try {
    if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    else sessionStorage.removeItem(SESSION_TOKEN_KEY)
    if (mode) sessionStorage.setItem(SESSION_MODE_KEY, mode)
    else if (!token) sessionStorage.removeItem(SESSION_MODE_KEY)
  } catch { /* storage pode estar indisponível */ }
}

export function clearSessionToken() {
  setSessionToken('', '')
}

export async function persistSessionToken(token = '') {
  if (Capacitor.isNativePlatform()) {
    try {
      if (token) await NativeSecureSession.set({ value: token })
      else await NativeSecureSession.remove()
      return true
    } catch { return false }
  }
  // No navegador, "Manter conectado" usa IndexedDB apenas para o token de
  // sessão cross-origin. Senha e credenciais de integrações nunca são salvas.
  return token
    ? webPersistentSession('set', token)
    : webPersistentSession('remove')
}

export async function restorePersistentSession() {
  if (Capacitor.isNativePlatform()) {
    try {
      const data = await NativeSecureSession.get()
      const token = String(data?.value || '')
      if (token) setSessionToken(token, 'bearer-persistent-native')
      return token
    } catch { return '' }
  }
  const token = String(await webPersistentSession('get') || '')
  if (token) setSessionToken(token, 'bearer-persistent-web')
  return token
}

export async function clearPersistentSession() {
  if (Capacitor.isNativePlatform()) {
    try { await NativeSecureSession.remove(); return true } catch { return false }
  }
  return webPersistentSession('remove')
}

export function authMode() {
  try { return sessionStorage.getItem(SESSION_MODE_KEY) || (getSessionToken() ? 'bearer-fallback' : 'cookie') } catch { return 'cookie' }
}

export function withAuthHeaders(headers = {}) {
  const result = new Headers(headers || {})
  const token = getSessionToken()
  if (token && !result.has('Authorization')) result.set('Authorization', `Bearer ${token}`)
  return result
}

/** Fetch autenticado para uploads/downloads multipart e respostas não JSON. */
export async function authFetch(input, options = {}) {
  return fetch(input, {
    ...options,
    credentials: options.credentials || 'include',
    headers: withAuthHeaders(options.headers || {}),
  })
}

/** Teste deliberadamente sem Authorization para saber se o cookie cross-site foi aceito. */
export async function probeCookieSession(timeoutMs = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE_URL}/auth/cookie-probe`, { credentials:'include', cache:'no-store', signal:controller.signal })
    if (!res.ok) return false
    const data = await res.json().catch(() => ({}))
    return data?.ok === true
  } catch { return false }
  finally { clearTimeout(timer) }
}

export async function api(path, options = {}) {
  const controller = new AbortController()
  const timeoutMs = Number(options.timeoutMs || 10000)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const { timeoutMs: _timeoutMs, _dbRetry = 0, ...fetchOptions } = options
  const customHeaders = options.headers || {}
  const hasBody = fetchOptions.body !== undefined && fetchOptions.body !== null
  const isForm = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData
  const headers = withAuthHeaders({
    ...(hasBody && !isForm ? { 'Content-Type': 'application/json' } : {}),
    ...customHeaders,
  })

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...fetchOptions,
      headers,
      credentials: 'include',
      signal: options.signal || controller.signal,
    })

    if (res.status === 401 && !path.startsWith('/auth/')) {
      clearSessionToken()
      await clearPersistentSession()
      if (window.location.pathname !== '/login') window.location.href = '/login?motivo=sessao'
      throw new Error('Sessão expirada. Faça login novamente.')
    }

    const data = await res.json().catch(() => ({}))

    // Durante o primeiro boot/reconexão do Atlas, o backend responde 503
    // imediatamente em vez de deixar a consulta pendurada por 10 s. GETs
    // podem aguardar alguns instantes e tentar novamente de forma transparente.
    const method = String(options.method || 'GET').toUpperCase()
    if (res.status === 503 && ['DB_NOT_READY', 'AUTH_BOOTSTRAP_NOT_READY'].includes(data?.codigo) && method === 'GET' && _dbRetry < 6) {
      const espera = Math.min(1500, Number(data.retry_after_ms || 700))
      await new Promise(resolve => setTimeout(resolve, espera))
      return api(path, { ...options, _dbRetry: _dbRetry + 1 })
    }

    if (!res.ok) {
      const err = new Error(data.erro || `Erro ${res.status}`)
      err.status = res.status
      err.codigo = data?.codigo
      err.code = data?.codigo
      err.data = data
      err.acao = data?.acao || ''
      err.jobId = data?.jobId || null
      throw err
    }
    return data
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`O backend não respondeu em ${Math.round(timeoutMs / 1000)} segundos.`)
    }
    if (error instanceof TypeError) {
      throw new Error(`Não foi possível conectar ao backend em ${BASE_URL}.`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
