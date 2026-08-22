import { api, setSessionToken, clearSessionToken, authMode, probeCookieSession, persistSessionToken, restorePersistentSession, clearPersistentSession, setCsrfToken } from './http.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function definitiveAuthFailure(error) {
  return Number(error?.status || 0) === 401 || Number(error?.status || 0) === 403
}

async function fetchSessionResilient() {
  // Render free pode precisar de alguns segundos para acordar. Uma falha de
  // rede/503 durante esse período não significa que o JWT/cookie expirou.
  const attempts = [12000, 22000, 22000]
  let lastError = null
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      return await api('/auth/me', { timeoutMs: attempts[i] })
    } catch (error) {
      if (definitiveAuthFailure(error)) throw error
      lastError = error
      if (i < attempts.length - 1) await sleep(900 + (i * 700))
    }
  }
  throw lastError || new Error('Não foi possível confirmar a sessão agora.')
}

export const authService = {
  async login(email, senha, manterConectado = false) {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, senha, manter_conectado: manterConectado === true }) })
    if (data?.requires_2fa) {
      clearSessionToken()
      return { data: { requires2fa: true, challengeId: data.challenge_id, message: data.mensagem }, error: null }
    }
    return this._finalizeLogin(data, manterConectado)
  },
  async login2fa(challengeId, codigo, manterConectado = false) {
    const data = await api('/auth/login/2fa', { method:'POST', body: JSON.stringify({ challenge_id: challengeId, codigo }) })
    return this._finalizeLogin(data, manterConectado)
  },
  async _finalizeLogin(data, manterConectado = false) {
    if (data.csrf_token) setCsrfToken(data.csrf_token)
    if (data.access_token) {
      setSessionToken(data.access_token, 'bearer-fallback')
      const cookieOk = await probeCookieSession().catch(() => false)
      if (cookieOk) {
        clearSessionToken()
        // clearSessionToken também limpa CSRF; restaura o token da sessão cookie.
        if (data.csrf_token) setCsrfToken(data.csrf_token)
        await clearPersistentSession()
        data.auth = { ...(data.auth || {}), transport:'cookie-cross-origin', bearerFallback:false }
      } else {
        let persistent = false
        if (manterConectado) {
          persistent = await persistSessionToken(data.access_token)
          setSessionToken(data.access_token, persistent ? 'bearer-persistent' : 'bearer-fallback')
          if (data.csrf_token) setCsrfToken(data.csrf_token)
        } else {
          await clearPersistentSession()
        }
        data.auth = { ...(data.auth || {}), transport:persistent ? 'bearer-persistent' : 'bearer-fallback', bearerFallback:true, persistent }
      }
    } else {
      clearSessionToken()
      if (data.csrf_token) setCsrfToken(data.csrf_token)
      await clearPersistentSession()
    }
    return { data: { user: data.usuario, auth: data.auth || { transport: authMode() }, csrfToken:data.csrf_token || '' }, error: null }
  },
  async logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    clearSessionToken()
    await clearPersistentSession()
    return { error: null }
  },
  async getSession({ restore = false } = {}) {
    if (restore) await restorePersistentSession()
    try {
      const data = await fetchSessionResilient()
      if (data.csrf_token) setCsrfToken(data.csrf_token)
      return { data: { session: { user: data.usuario }, auth: data.auth || { transport: authMode() } }, error: null }
    } catch (error) {
      // Só apaga uma sessão persistente quando o backend confirmou que ela é
      // inválida/revogada. Timeout, cold start, Atlas reconectando ou CORS
      // temporário preservam o token para a próxima tentativa.
      if (definitiveAuthFailure(error)) {
        clearSessionToken()
        await clearPersistentSession()
        return { data: { session: null, auth: { transport: 'none' } }, error: null }
      }
      return { data: { session: null, auth: { transport: authMode(), unavailable: true }, error }, error }
    }
  },
  onAuthChange(callback) {
    this.getSession().then(({ data }) => { callback('INITIAL_SESSION', data.session) })
    return { data: { subscription: { unsubscribe: () => {} } } }
  },
  async editarMe(dados) {
    const data = await api('/auth/me', { method: 'PUT', body: JSON.stringify(dados) })
    return { data: { user: data.usuario }, error: null }
  },
  async esqueciSenha(email) {
    return api('/auth/esqueci-senha', { method: 'POST', body: JSON.stringify({ email }) })
  },
  async redefinirSenha(token, senha) {
    return api('/auth/redefinir-senha', { method: 'POST', body: JSON.stringify({ token, senha }) })
  },
  twoFactorStatus: () => api('/auth/2fa/status'),
  twoFactorSetup: (stepToken='') => api('/auth/2fa/setup', { method:'POST', headers:stepToken?{'X-Step-Up-Token':stepToken}:{}}),
  twoFactorConfirm: (codigo,stepToken='') => api('/auth/2fa/confirm', { method:'POST', headers:stepToken?{'X-Step-Up-Token':stepToken}:{}, body:JSON.stringify({codigo}) }),
  twoFactorDisable: (senha,codigo) => api('/auth/2fa/disable', { method:'POST', body:JSON.stringify({senha,codigo}) }),
  stepUp: (senha,codigo='') => api('/auth/step-up', { method:'POST', body:JSON.stringify({senha,codigo}) }),
}
