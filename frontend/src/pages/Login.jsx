/**
 * Login.jsx — SaaS Admin
 *
 * Diagnóstico expandido:
 *  - Pré-voo: browser, cookies, variáveis de ambiente
 *  - Latência por etapa em ms
 *  - Todos os serviços do health (MongoDB, Redis, Cloudinary, GitHub, Gemini/OpenRouter)
 *  - Header CORS real da resposta
 *  - Ambiente e latência interna do backend
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Navigate, Link } from 'react-router-dom'
import {
  LayoutDashboard, Eye, EyeOff, LogIn,
  ChevronDown, ChevronUp, Clipboard, ClipboardCheck, RefreshCw,
  Wifi, WifiOff,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useBranding } from '../context/BrandingContext'
import toast from 'react-hot-toast'

const API_BASE    = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:3001/api' : '/api')
const SERVER_ROOT = API_BASE.replace(/\/api\/?$/, '')

// ── Utilidades ────────────────────────────────────────────────
function ts() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false })
}

async function fetchTimed(url, opts = {}, timeoutMs = 8000) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const t0    = Date.now()
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, credentials: 'include' })
    clearTimeout(timer)
    return { res, ms: Date.now() - t0 }
  } catch (err) {
    clearTimeout(timer)
    const ms = Date.now() - t0
    if (err.name === 'AbortError')                         return { timedOut: true, ms }
    if (/failed to fetch|networkerror/i.test(err.message)) return { corsBlocked: true, ms, errMsg: err.message }
    return { networkError: true, ms, errMsg: err.message }
  }
}

async function readJson(res) {
  try { return await res.json() } catch { return {} }
}

function detectBrowser() {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua))     return 'Microsoft Edge'
  if (/OPR\//.test(ua))     return 'Opera'
  if (/Chrome\//.test(ua))  return 'Chrome'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Safari\//.test(ua))  return 'Safari'
  return 'Navegador desconhecido'
}

function browserVersion() {
  const ua = navigator.userAgent
  const m = ua.match(/(Chrome|Firefox|Safari|Edg|OPR)\/(\d+)/)
  return m ? m[2] : '?'
}

const VITE_VARS = [
  'VITE_API_URL', 'VITE_APP_NAME', 'VITE_APP_TAGLINE',
  'VITE_APP_VERSION', 'VITE_APP_ENV',
]

// ─────────────────────────────────────────────────────────────
export default function Login() {
  const { user, login, ensureSession } = useAuth()
  const { siteName, panelSubtitle, productName } = useBranding()
  const navigate = useNavigate()

  useEffect(() => { ensureSession() }, [ensureSession])

  useEffect(() => {
    document.title = `Entrar | ${siteName}`
    return () => { document.title = siteName }
  }, [siteName])

  const [email, setEmail]          = useState('')
  const [senha, setSenha]          = useState('')
  const [mostrarSenha, setMostrar] = useState(false)
  const [loading, setLoading]      = useState(false)

  const [logEntries, setLogEntries]   = useState([])
  const [diagRunning, setDiagRunning] = useState(false)
  const [diagDone, setDiagDone]       = useState(false)
  const [diagOpen, setDiagOpen]       = useState(false)
  const [copied, setCopied]           = useState(false)
  const [apiOnline, setApiOnline]     = useState(null)

  const logEndRef  = useRef(null)
  const ranRef     = useRef(false)
  const entriesRef = useRef([])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logEntries])

  const runDiagnostic = useCallback(async () => {
    entriesRef.current = []
    setLogEntries([])
    setDiagRunning(true)
    setDiagDone(false)
    setApiOnline(null)

    function add(icon, text, indent = false) {
      const entry = { ts: ts(), icon, text, indent }
      entriesRef.current = [...entriesRef.current, entry]
      setLogEntries([...entriesRef.current])
    }

    function sep(label) {
      add('─', label)
    }

    // ════════════════════════════════════════════════════════
    // A. Pré-voo — browser, cookies, variáveis de ambiente
    // ════════════════════════════════════════════════════════
    add('→', 'Iniciando diagnóstico de conexão…')
    add('→', `API base: ${API_BASE}`)
    add('→', `Origem:   ${window.location.origin}`)
    let cloudCrossOrigin = false
    try {
      const apiOrigin = new URL(API_BASE, window.location.origin).origin
      cloudCrossOrigin = apiOrigin !== window.location.origin
      if (cloudCrossOrigin) {
        add('→', 'Modo cloud detectado: frontend e API estão em origens diferentes.')
        add('→', 'Após o login, o AL mantém cookie e usa Bearer de sessão como fallback quando o navegador restringe cookie cross-site.', true)
      } else {
        add('✓', 'Modo same-origin/local: sessão por cookie HttpOnly.')
      }
    } catch { /* URL inválida será identificada pelos testes abaixo */ }

    sep('Ambiente do browser')

    const browser = `${detectBrowser()} ${browserVersion()}`
    add('→', `Browser: ${browser}`)

    if (navigator.onLine) {
      add('✓', 'Rede: online')
    } else {
      add('✕', 'Rede: OFFLINE — sem conexão à internet')
    }

    if (navigator.cookieEnabled) {
      add('✓', cloudCrossOrigin ? 'Cookies: habilitados; fallback cloud também disponível após login' : 'Cookies: habilitados (sessão HttpOnly local/VPS)')
    } else if (cloudCrossOrigin) {
      add('⚠', 'Cookies desabilitados. No modo Vercel → Render o AL ainda tentará o Bearer de sessão como fallback.')
    } else {
      add('✕', 'Cookies: DESABILITADOS — o modo local/VPS por cookie não conseguirá manter a sessão')
    }

    // Variáveis de ambiente
    const definidas = VITE_VARS.filter(k => !!import.meta.env[k])
    const faltando  = VITE_VARS.filter(k => !import.meta.env[k])
    if (definidas.length) add('✓', `Vars definidas: ${definidas.join(', ')}`, true)
    if (faltando.length)  add('⚠', `Vars ausentes: ${faltando.join(', ')} (serão usados defaults)`, true)

    const appVer = import.meta.env.VITE_APP_VERSION
    if (appVer) add('→', `Versão do frontend: ${appVer}`, true)

    // ════════════════════════════════════════════════════════
    // B. Servidor (raiz)
    // ════════════════════════════════════════════════════════
    sep('Servidor')
    add('→', `GET ${SERVER_ROOT}/`)

    let serverUp = false
    {
      const { res, ms, timedOut, corsBlocked, errMsg } = await fetchTimed(`${SERVER_ROOT}/`, {}, 8000)

      if (timedOut) {
        add('⚠', `Não respondeu em 8 s — servidor hibernando (Render free tier)`)
        add('→', 'Aguardando wake-up — nova tentativa em até 15 s…')
        const retry = await fetchTimed(`${SERVER_ROOT}/`, {}, 15000)
        if (retry.res) {
          serverUp = true
          setApiOnline(true)
          add('✓', `Servidor acordou (${retry.res.status}) após ${retry.ms}ms`)
        } else {
          setApiOnline(false)
          add('✕', `Servidor não respondeu após ~23 s — pode estar offline ou com erro`)
        }
      } else if (corsBlocked) {
        setApiOnline(false)
        add('✕', `CORS bloqueou GET ${SERVER_ROOT}/`)
        add('⚠', `A origem ${window.location.origin} não foi aceita pelo backend. Confira Ambientes/Plataformas e a configuração Vercel ↔ Render.`, true)
      } else if (res) {
        serverUp = true
        setApiOnline(true)
        let versao = ''
        try { const j = await res.clone().json(); versao = j.versao || j.version || '' } catch { /* ok */ }
        const corsHeader = res.headers.get('access-control-allow-origin') || '(não enviado)'
        add('✓', `Servidor respondeu (${res.status}) em ${ms}ms${versao ? ` — versão: ${versao}` : ''}`)
        add('→', `CORS allow-origin: ${corsHeader}`, true)
      }
    }

    // ════════════════════════════════════════════════════════
    // C. Rota raiz da API
    // ════════════════════════════════════════════════════════
    sep('Endpoint /api')
    add('→', `GET ${API_BASE}`)
    {
      const { res, ms, timedOut } = await fetchTimed(API_BASE, {}, 6000)
      if (timedOut)          add('⚠', `/api não respondeu em 6 s (skip)`)
      else if (!res)         add('⚠', 'Não foi possível testar /api')
      else if (res.status === 404) add('⚠', `/api retornou 404 em ${ms}ms — rota raiz não existe (normal).`)
      else if (res.ok)       add('✓', `/api respondeu ${res.status} em ${ms}ms`)
      else                   add('⚠', `/api retornou ${res.status} em ${ms}ms`)
    }

    // ════════════════════════════════════════════════════════
    // D. Serviços (health detalhado)
    // ════════════════════════════════════════════════════════
    sep('Serviços (health)')
    add('→', `GET ${API_BASE}/health`)
    {
      const { res, ms, timedOut, errMsg } = await fetchTimed(`${API_BASE}/health/detalhado`, {}, 6000)
      if (timedOut) {
        add('⚠', 'Health check não respondeu em 10 s')
      } else if (!res) {
        add('⚠', `Health inacessível: ${errMsg || 'erro desconhecido'}`)
      } else {
        const j = await readJson(res)
        const s = j?.servicos || {}

        // MongoDB
        if (s.mongodb)   add(s.mongodb.ok   ? '✓' : '✕', `MongoDB:    ${s.mongodb.status}`)
        // Redis
        if (s.redis)     add(s.redis.ok     ? '✓' : '⚠', `Redis:      ${s.redis.status}`)
        // Cloudinary
        if (s.cloudinary) add(s.cloudinary.ok ? '✓' : '✕', `Cloudinary: ${s.cloudinary.status}`)
        // GitHub
        if (s.github)    add(s.github.ok    ? '✓' : '⚠', `GitHub:     ${s.github.status}`)
        // IA · Gemini/OpenRouter
        if (s.ia)        add(s.ia.ok        ? '✓' : '⚠', `IA:         ${s.ia.status}`)

        // Metadados
        const partes = []
        if (j.env)         partes.push(`ambiente: ${j.env}`)
        if (j.latencia_ms) partes.push(`latência interna: ${j.latencia_ms}ms`)
        partes.push(`round-trip: ${ms}ms`)
        add('→', partes.join(' | '), true)

        if (res.status === 503) add('⚠', `Health retornou 503 — um ou mais serviços críticos offline`)
      }
    }

    // ════════════════════════════════════════════════════════
    // E. Autenticação
    // ════════════════════════════════════════════════════════
    sep('Autenticação')
    add('→', `POST ${API_BASE}/auth/login (credenciais vazias — apenas testa o endpoint)`)
    {
      const { res, ms, timedOut, corsBlocked, errMsg } = await fetchTimed(
        `${API_BASE}/auth/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: '', senha: '' }),
        },
        8000,
      )

      if (timedOut) {
        add('⚠', 'Auth não respondeu em 8 s')
      } else if (corsBlocked) {
        add('✕', `CORS bloqueou POST /api/auth/login`)
        add('⚠', `Adicione ${window.location.origin} em FRONTEND_URL no Render`, true)
      } else if (!res) {
        add('✕', `Erro ao testar auth: ${errMsg}`)
      } else {
        const j = await readJson(res)
        const msg        = j?.erro || j?.message || ''
        const corsHeader = res.headers.get('access-control-allow-origin') || '(não enviado)'
        const varyHeader = res.headers.get('vary') || ''

        if (res.status === 400 || res.status === 422) {
          add('✓', `Auth respondeu ${res.status} — validação OK (endpoint acessível) em ${ms}ms`)
        } else if (res.status === 401) {
          add('✓', `Auth respondeu 401 — endpoint acessível em ${ms}ms`)
        } else if (res.status === 404) {
          add('✕', `Auth retornou 404 — rota /api/auth/login não encontrada`)
        } else if (res.status === 500) {
          if (/cors/i.test(msg)) {
            add('✕', `Auth retornou 500: CORS bloqueado: ${window.location.origin}`)
          } else {
            add('✕', `Auth retornou 500${msg ? `: ${msg}` : ''} em ${ms}ms`)
            add('⚠', `Provável causa: utilizador não existe. Aceda a /admin/setup para criar.`, true)
          }
        } else {
          add('⚠', `Auth retornou ${res.status}${msg ? `: ${msg}` : ''} em ${ms}ms`)
        }

        // Headers de segurança/CORS
        add('→', `CORS allow-origin: ${corsHeader}`, true)
        if (varyHeader) add('→', `Vary: ${varyHeader}`, true)

        // Aviso se a origem atual não está no header CORS
        if (corsHeader !== window.location.origin &&
            corsHeader !== '*' &&
            corsHeader !== '(não enviado)') {
          add('⚠', `Origem atual (${window.location.origin}) ≠ CORS permitida (${corsHeader})`, true)
          add('⚠', `Login pode falhar em produção — revise FRONTEND_URL no Render`, true)
        }
      }
    }


    // ════════════════════════════════════════════════════════
    // F. Status das plataformas (Render + Vercel)
    //    Chamadas paralelas direto ao Statuspage.io (CORS público)
    // ════════════════════════════════════════════════════════
    sep('Plataformas')

    const STATUSPAGE = {
      render: 'https://status.render.com/api/v2',
      vercel:  'https://www.vercel-status.com/api/v2',
    }

    const COR_IND = { none: '✓', minor: '⚠', major: '✕', critical: '✕' }

    async function checkPlatform(nome, base) {
      add('→', `Verificando ${nome} → GET ${base}/status.json`)
      const { res, ms, timedOut, corsBlocked } = await fetchTimed(`${base}/status.json`, {}, 6000)
      if (timedOut)    { add('⚠', `${nome}: não respondeu em 6 s`); return }
      if (corsBlocked) { add('⚠', `${nome}: CORS bloqueou a requisição`); return }
      if (!res)        { add('⚠', `${nome}: inacessível`); return }
      let j = {}
      try { j = await res.json() } catch { add('⚠', `${nome}: resposta inválida`); return }

      const ind = j?.status?.indicator || 'none'
      const ico = COR_IND[ind] || '→'
      add(ico, `${nome}: ${j?.status?.description || ind} (${ms}ms)`)

      // Componentes com problema
      const { res: resC } = await fetchTimed(`${base}/components.json`, {}, 5000)
      if (resC) {
        let jc = {}
        try { jc = await resC.json() } catch { /* ok */ }
        const degradados = (jc.components || [])
          .filter(c => !c.group && c.status !== 'operational' && c.status !== 'under_maintenance')
        if (degradados.length) {
          degradados.forEach(c => add('⚠', `  ${c.name}: ${c.status}`, true))
        }
      }

      // Incidentes ativos
      const { res: resI } = await fetchTimed(`${base}/incidents/unresolved.json`, {}, 5000)
      if (resI) {
        let ji = {}
        try { ji = await resI.json() } catch { /* ok */ }
        const incs = ji.incidents || []
        if (incs.length) {
          incs.forEach(i => add('⚠', `  Incidente: ${i.name} [${i.impact}]`, true))
        } else if (ind === 'none') {
          add('✓', `  Sem incidentes ativos`, true)
        }
      }
    }

    // Roda as duas verificações em paralelo
    await Promise.all([
      checkPlatform('Render', STATUSPAGE.render),
      checkPlatform('Vercel',  STATUSPAGE.vercel),
    ])

    // ════════════════════════════════════════════════════════
    // Fim
    // ════════════════════════════════════════════════════════
    add('→', '─── Diagnóstico concluído. Usa 📋 Copiar para partilhar o log. ───')
    setDiagRunning(false)
    setDiagDone(true)
  }, [])

  // Diagnóstico completo é sob demanda. Um probe leve roda no login para
  // indicar rapidamente se a API está acessível sem competir com o carregamento.
  useEffect(() => {
    ranRef.current = false
    let alive = true
    const timer = window.setTimeout(async () => {
      const probe = await fetchTimed(`${API_BASE}/health/live`, {}, 3000)
      if (!alive) return
      if (probe.res) setApiOnline(probe.res.ok)
      else if (probe.timedOut || probe.corsBlocked || probe.networkError) setApiOnline(false)
    }, 350)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [])

  function handleRerun() {
    ranRef.current = false
    runDiagnostic().then(() => { ranRef.current = true })
  }

  function handleCopy() {
    const text = entriesRef.current
      .map(e => `[${e.ts}] ${e.icon} ${e.indent ? '  ' : ''}${e.text}`)
      .join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function entryColor(icon) {
    if (icon === '✓') return 'auth-diag__symbol--ok'
    if (icon === '✕') return 'auth-diag__symbol--error'
    if (icon === '⚠') return 'auth-diag__symbol--warn'
    if (icon === '─') return 'auth-diag__symbol--sep'
    return 'auth-diag__symbol--info'
  }

  if (user) return <Navigate to="/admin" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !senha) { toast.error('Preencha email e senha'); return }
    try {
      setLoading(true)
      await login(email, senha)
      toast.success('Bem-vindo!')
      navigate('/admin')
    } catch (err) {
      toast.error(err.message || 'Falha ao entrar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-wrap">
        <header className="auth-brand">
          <div className="auth-brand__mark" aria-hidden="true">
            <LayoutDashboard size={25} />
          </div>
          <h1>{siteName}</h1>
          <p>{panelSubtitle}</p>
        </header>

        <section className="auth-card" aria-labelledby="login-title">
          <h2 id="login-title">Entrar</h2>
          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                className="auth-input"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                readOnly={loading}
              />
            </div>

            <div className="auth-field">
              <label htmlFor="senha">Senha</label>
              <div className="auth-input-wrap">
                <input
                  id="senha"
                  type={mostrarSenha ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="auth-input auth-input--password"
                  placeholder="••••••••"
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  readOnly={loading}
                />
                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setMostrar(v => !v)}
                  aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {mostrarSenha ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="auth-submit">
              {loading ? <><span className="auth-spinner" /> Entrando...</> : <><LogIn size={16} /> Entrar</>}
            </button>

            <div className="auth-forgot">
              <Link to="/esqueci-senha">Esqueceu sua senha?</Link>
            </div>
          </form>
        </section>

        <section className="auth-diag" aria-label="Diagnóstico de conexão">
          <button type="button" className="auth-diag__bar" onClick={() => setDiagOpen(v => !v)} aria-expanded={diagOpen}>
            <span className="auth-diag__title">
              {diagRunning && <RefreshCw size={14} className="animate-spin" />}
              {!diagRunning && apiOnline === true && <Wifi size={14} className="auth-diag__symbol--ok" />}
              {!diagRunning && apiOnline === false && <WifiOff size={14} className="auth-diag__symbol--error" />}
              <span>Diagnóstico de conexão</span>
              {!diagRunning && apiOnline !== null && (
                <span className={`auth-diag__status ${apiOnline ? 'auth-diag__status--ok' : 'auth-diag__status--error'}`}>
                  {apiOnline ? 'Online' : 'Atenção'}
                </span>
              )}
            </span>
            <span className="auth-diag__tools">
              {diagDone && (
                <span
                  role="button" tabIndex={0} title="Copiar log" className="auth-diag__tool"
                  onClick={e => { e.stopPropagation(); handleCopy() }}
                  onKeyDown={e => e.key === 'Enter' && handleCopy()}
                >
                  {copied ? <ClipboardCheck size={15} className="auth-diag__symbol--ok" /> : <Clipboard size={15} />}
                </span>
              )}
              {diagDone && !diagRunning && (
                <span
                  role="button" tabIndex={0} title="Repetir diagnóstico" className="auth-diag__tool"
                  onClick={e => { e.stopPropagation(); handleRerun() }}
                  onKeyDown={e => e.key === 'Enter' && handleRerun()}
                >
                  <RefreshCw size={15} />
                </span>
              )}
              {diagOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </span>
          </button>

          {diagOpen && (
            <div className="auth-diag__body">
              {logEntries.length === 0 && diagRunning && <div className="auth-diag__empty">Iniciando diagnóstico…</div>}
              {logEntries.length === 0 && !diagRunning && (
                <div className="auth-diag__empty">
                  <span>Confere API, CORS, banco, integrações essenciais e estado das plataformas sem alterar configurações.</span>
                  <button type="button" className="auth-diag__run" onClick={handleRerun}>Executar diagnóstico</button>
                </div>
              )}
              {logEntries.map((entry, i) => entry.icon === '─' ? (
                <div key={i} className="auth-diag__separator"><span>{entry.text}</span></div>
              ) : (
                <div key={i} className={`auth-diag__line${entry.indent ? ' auth-diag__line--indent' : ''}`}>
                  <span className="auth-diag__time">[{entry.ts}]</span>
                  <span className={`auth-diag__symbol ${entryColor(entry.icon)}`}>{entry.icon}</span>
                  <span className="auth-diag__text">{entry.text}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </section>

        <p className="auth-version">
          Acesso restrito · {productName}{import.meta.env.VITE_APP_VERSION ? ` ${import.meta.env.VITE_APP_VERSION}` : ''}
        </p>
      </div>
    </div>
  )
}
