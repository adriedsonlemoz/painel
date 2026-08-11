import dns from 'node:dns/promises'
import net from 'node:net'

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308])

function isPrivateIpv4(ip) {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateIpv6(ip) {
  const v = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (v.startsWith('::ffff:')) {
    const tail = v.slice(7)
    if (net.isIP(tail) === 4) return isPrivateIpv4(tail)
    const parts = tail.split(':')
    if (parts.length === 2) {
      const hi = Number.parseInt(parts[0], 16), lo = Number.parseInt(parts[1], 16)
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const mapped = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
        return isPrivateIpv4(mapped)
      }
    }
  }
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') ||
    v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') ||
    v.startsWith('ff') || v.startsWith('2001:db8:')
}

export function isPrivateIp(ip) {
  const version = net.isIP(ip)
  if (version === 4) return isPrivateIpv4(ip)
  if (version === 6) return isPrivateIpv6(ip)
  return true
}

export async function assertSafeRemoteUrl(rawUrl) {
  let parsed
  try { parsed = new URL(String(rawUrl || '').trim()) } catch { throw new Error('URL inválida') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('A URL deve usar HTTP ou HTTPS')
  if (parsed.username || parsed.password) throw new Error('URLs com usuário ou senha não são permitidas')
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Endereço local não é permitido em feeds RSS')
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Endereço IP privado/local não é permitido em feeds RSS')
  } else {
    let addresses
    try { addresses = await dns.lookup(host, { all: true, verbatim: true }) } catch { throw new Error('Não foi possível resolver o domínio informado') }
    if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
      throw new Error('O domínio aponta para uma rede privada/local e foi bloqueado')
    }
  }
  return parsed
}

async function readLimitedBody(res, maxBytes) {
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared && declared > maxBytes) throw new Error(`Resposta remota excede o limite de ${Math.round(maxBytes / 1024 / 1024)} MB`)
  if (!res.body?.getReader) {
    const arr = new Uint8Array(await res.arrayBuffer())
    if (arr.byteLength > maxBytes) throw new Error(`Resposta remota excede o limite de ${Math.round(maxBytes / 1024 / 1024)} MB`)
    return Buffer.from(arr)
  }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      try { await reader.cancel() } catch {}
      throw new Error(`Resposta remota excede o limite de ${Math.round(maxBytes / 1024 / 1024)} MB`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

export async function fetchRemoteBuffer(rawUrl, {
  headers = {},
  timeoutMs = 15_000,
  maxBytes = DEFAULT_MAX_BYTES,
  maxRedirects = 5,
  acceptedContentTypes = null,
} = {}) {
  let current = await assertSafeRemoteUrl(rawUrl)
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const res = await fetch(current, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (REDIRECT_CODES.has(res.status)) {
      if (redirect >= maxRedirects) throw new Error('O feed excedeu o limite de redirecionamentos')
      const location = res.headers.get('location')
      if (!location) throw new Error(`Servidor retornou redirecionamento HTTP ${res.status} sem destino`)
      current = await assertSafeRemoteUrl(new URL(location, current).toString())
      continue
    }
    if (!res.ok) {
      const detail = res.status === 404
        ? 'Feed não encontrado (HTTP 404) — verifique se a URL ainda é válida'
        : res.status === 410
          ? 'Feed removido permanentemente (HTTP 410)'
          : res.status === 403
            ? 'Acesso negado pelo servidor do feed (HTTP 403)'
            : res.status === 401
              ? 'Feed requer autenticação (HTTP 401)'
              : `Servidor remoto retornou HTTP ${res.status}`
      throw new Error(detail)
    }
    const contentType = String(res.headers.get('content-type') || '').toLowerCase()
    if (acceptedContentTypes?.length && contentType) {
      const accepted = acceptedContentTypes.some(x => contentType.includes(x))
      if (!accepted) throw new Error(`Tipo de conteúdo remoto não permitido: ${contentType.split(';')[0]}`)
    }
    const buffer = await readLimitedBody(res, maxBytes)
    return {
      buffer,
      contentType,
      finalUrl: current.toString(),
      headers: res.headers,
      status: res.status,
    }
  }
  throw new Error('Não foi possível acessar o endereço remoto')
}

function charsetFrom(contentType = '', buffer = Buffer.alloc(0)) {
  const fromHeader = String(contentType).match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]
  if (fromHeader) return fromHeader.trim().toLowerCase()
  const headAscii = buffer.subarray(0, 512).toString('ascii')
  const fromXml = headAscii.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)?.[1]
  if (fromXml) return fromXml.trim().toLowerCase()
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8'
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le'
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be'
  return 'utf-8'
}

function normalizeCharset(label = '') {
  const c = label.toLowerCase().replace(/_/g, '-')
  if (['iso-8859-1', 'latin1', 'latin-1'].includes(c)) return 'windows-1252'
  if (['cp1252', 'windows1252'].includes(c)) return 'windows-1252'
  if (['utf8', 'utf-8'].includes(c)) return 'utf-8'
  return c || 'utf-8'
}

export function decodeRemoteText(buffer, contentType = '') {
  const charset = normalizeCharset(charsetFrom(contentType, buffer))
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer).replace(/^\uFEFF/, '')
  }
}

export async function fetchRemoteText(rawUrl, options = {}) {
  const out = await fetchRemoteBuffer(rawUrl, options)
  return { ...out, text: decodeRemoteText(out.buffer, out.contentType) }
}
