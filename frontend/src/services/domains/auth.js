import { api, setSessionToken, clearSessionToken, authMode, probeCookieSession, persistSessionToken, restorePersistentSession, clearPersistentSession } from './http.js'

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
    // Em Vercel → Render, navegadores podem bloquear o cookie de terceiro.
    // O backend fornece um token apenas para esse cenário; em Termux/VPS o
    // cookie HttpOnly continua sendo o transporte principal e nada muda.
    if (data.access_token) {
      // Mantém o Bearer apenas se o navegador realmente não aceitar o cookie
      // cross-site. Assim browsers permissivos continuam no HttpOnly e evitam
      // preflights extras; browsers restritivos ficam no fallback cloud.
      setSessionToken(data.access_token, 'bearer-fallback')
      const cookieOk = await probeCookieSession().catch(() => false)
      if (cookieOk) {
        clearSessionToken()
        await clearPersistentSession()
        data.auth = { ...(data.auth || {}), transport:'cookie-cross-origin', bearerFallback:false }
      } else {
        let persistent = false
        if (manterConectado) {
          persistent = await persistSessionToken(data.access_token)
          setSessionToken(data.access_token, persistent ? 'bearer-persistent' : 'bearer-fallback')
        } else {
          await clearPersistentSession()
        }
        data.auth = { ...(data.auth || {}), transport:persistent ? 'bearer-persistent' : 'bearer-fallback', bearerFallback:true, persistent }
      }
    } else { clearSessionToken(); await clearPersistentSession() }
    return { data: { user: data.usuario, auth: data.auth || { transport: authMode() } }, error: null }
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
}
