import { authFetch } from './domains/http.js'

/**
 * Consome uma resposta SSE usando fetch autenticado.
 * Diferente de EventSource, este transporte aceita o Bearer de sessão usado
 * quando Vercel e Render estão em domínios diferentes.
 */
export async function consumeSse(url, { method = 'GET', body = null, signal, onEvent } = {}) {
  const headers = new Headers()
  if (body !== null && body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await authFetch(url, {
    method,
    headers,
    body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    cache: 'no-store',
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw Object.assign(new Error(data.erro || `Erro ${response.status}`), { status: response.status })
  }
  if (!response.body?.getReader) throw new Error('Este navegador não oferece streaming para esta operação.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const dataLines = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
      if (!dataLines.length) continue
      const raw = dataLines.map(line => line.slice(5).trimStart()).join('\n')
      if (!raw) continue
      try { onEvent?.(JSON.parse(raw)) } catch { /* ignora frames não JSON */ }
    }
  }
}
