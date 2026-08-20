import { api, setSessionToken, clearSessionToken, authMode, probeCookieSession, persistSessionToken, restorePersistentSession, clearPersistentSession } from './http.js'

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
        data.auth = { ...(data.auth || {}), transport:manterConectado ? 'bearer-persistent-native' : 'bearer-fallback', bearerFallback:true, persistent:manterConectado === true }
        if (manterConectado) await persistSessionToken(data.access_token)
        else await clearPersistentSession()
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
      const data = await api('/auth/me')
      return { data: { session: { user: data.usuario }, auth: data.auth || { transport: authMode() } }, error: null }
    } catch {
      clearSessionToken()
      await clearPersistentSession()
      return { data: { session: null, auth: { transport: 'none' } }, error: null }
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
