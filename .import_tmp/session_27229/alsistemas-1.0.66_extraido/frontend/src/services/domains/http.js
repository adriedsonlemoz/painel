/**
 * http.js — Cliente HTTP base compartilhado por todos os módulos de serviço.
 * Gerencia cookies HttpOnly, redirecionamento 401, timeout e parse de erros.
 */
export const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:3001/api' : '/api')

// Base sem o sufixo /api — usado para montar URLs de download autenticado
export const apiBase = BASE_URL.replace(/\/api$/, '')

export async function api(path, options = {}) {
  const controller = new AbortController()
  const timeoutMs = Number(options.timeoutMs || 10000)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  // Se headers: {} for passado explicitamente, não injeta Content-Type
  // (necessário para multipart/form-data — o browser define o boundary automaticamente)
  const hasCustomHeaders = Object.keys(options.headers || {}).length > 0 || options.headers === undefined
  const headers = hasCustomHeaders
    ? { 'Content-Type': 'application/json', ...options.headers }
    : {}

  const { timeoutMs: _timeoutMs, _dbRetry = 0, ...fetchOptions } = options

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...fetchOptions,
      headers,
      credentials: 'include',
      signal: options.signal || controller.signal,
    })

    if (res.status === 401 && !path.startsWith('/auth/')) {
      if (window.location.pathname !== '/login') window.location.href = '/login'
      throw new Error('Sessão expirada. Faça login novamente.')
    }

    const data = await res.json().catch(() => ({}))

    // Durante o primeiro boot/reconexão do Atlas, o backend responde 503
    // imediatamente em vez de deixar a consulta pendurada por 10 s. GETs
    // podem aguardar alguns instantes e tentar novamente de forma transparente.
    const method = String(options.method || 'GET').toUpperCase()
    if (res.status === 503 && data?.codigo === 'DB_NOT_READY' && method === 'GET' && _dbRetry < 4) {
      const espera = Math.min(1500, Number(data.retry_after_ms || 700))
      await new Promise(resolve => setTimeout(resolve, espera))
      return api(path, { ...options, _dbRetry: _dbRetry + 1 })
    }

    if (!res.ok) {
      const err = new Error(data.erro || `Erro ${res.status}`)
      err.status = res.status
      err.codigo = data?.codigo
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
