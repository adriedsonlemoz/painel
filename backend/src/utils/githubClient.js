import { getCredential } from './credentialStore.js'
/**
 * githubClient.js — Cliente centralizado para GitHub API
 *
 * Utilitário compartilhado entre github.js e analysis.js.
 * Token lido exclusivamente do ambiente backend (GITHUB_TOKEN).
 * Frontend NUNCA recebe ou vê o token.
 *
 * Adicionado no Sprint 6-B para eliminar duplicação entre rotas.
 */

export const GITHUB_API = 'https://api.github.com'
export const GITHUB_API_VERSION = '2026-03-10'

/**
 * Faz uma requisição autenticada à GitHub API.
 *
 * @param {string} apiPath   - Caminho relativo, ex: "/repos/owner/repo"
 * @param {RequestInit} options - Opções do fetch (method, body, headers extras)
 * @returns {Promise<object|null>} JSON da resposta, ou null se status 204
 * @throws {Error} com .status = código HTTP em caso de erro da API
 */
export async function githubFetch(apiPath, options = {}) {
  const { value: token } = await getCredential('github', 'GITHUB_TOKEN')

  if (!token) {
    const err = new Error('Token do GitHub não configurado no cofre nem no ambiente.')
    err.status = 503
    throw err
  }

  const res = await fetch(`${GITHUB_API}${apiPath}`, {
    ...options,
    headers: {
      'Authorization':        `Bearer ${token}`,
      'Accept':               'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent':            'AL-Sistemas',
      'Content-Type':         'application/json',
      ...options.headers,
    },
  })

  if (res.status === 204) return null

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const err = new Error(data.message || `GitHub API error ${res.status}`)
    err.status = res.status
    throw err
  }

  return data
}
/**
 * Variante textual do cliente central. Usa exatamente a mesma credencial
 * cadastrada em Integrações e APIs, mas preserva respostas HTML/texto (ex.:
 * renderização oficial de Markdown do GitHub).
 */
export async function githubFetchText(apiPath, options = {}) {
  const { value: token } = await getCredential('github', 'GITHUB_TOKEN')

  if (!token) {
    const err = new Error('Token do GitHub não configurado no cofre nem no ambiente.')
    err.status = 503
    throw err
  }

  const res = await fetch(`${GITHUB_API}${apiPath}`, {
    ...options,
    headers: {
      'Authorization':        `Bearer ${token}`,
      'Accept':               'text/html',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent':           'AL-Sistemas',
      ...options.headers,
    },
  })

  const text = await res.text()
  if (!res.ok) {
    let message = text || `GitHub API error ${res.status}`
    try { message = JSON.parse(text)?.message || message } catch {}
    const err = new Error(message)
    err.status = res.status
    throw err
  }

  // Alguns media types `+json` devolvem uma string JSON contendo o HTML;
  // outros devolvem o HTML diretamente. Normalizamos ambos aqui.
  const contentType = res.headers.get('content-type') || ''
  const first = text.trimStart()[0]
  if (contentType.includes('json') || first === '"' || first === '{' || first === '[') {
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'string') return parsed
      if (typeof parsed?.content === 'string') return parsed.content
    } catch {}
  }
  return text
}

