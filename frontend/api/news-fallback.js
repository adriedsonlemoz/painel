function fallbackUrl() {
  const publicBase = String(process.env.CF_R2_PUBLIC_URL || '').trim().replace(/\/+$/, '')
  const derived = publicBase ? `${publicBase}/alsistemas/fallback/public-snapshot-v1.json` : ''
  return String(process.env.NEWS_FALLBACK_URL || process.env.VITE_NEWS_FALLBACK_URL || derived || '').trim()
}

async function fetchWithTimeout(url, ms = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal, headers: { 'User-Agent': 'AL-Sistemas-Fallback/1.0' } })
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(_request, response) {
  const url = fallbackUrl()
  if (!/^https?:\/\//i.test(url)) {
    response.setHeader('Cache-Control', 'no-store')
    return response.status(503).json({ erro: 'NEWS_FALLBACK_URL não configurada na Vercel.', codigo: 'FALLBACK_NOT_CONFIGURED' })
  }

  try {
    const upstream = await fetchWithTimeout(url)
    if (!upstream.ok) {
      response.setHeader('Cache-Control', 'no-store')
      return response.status(502).json({ erro: `Snapshot R2 respondeu HTTP ${upstream.status}.`, codigo: 'FALLBACK_UPSTREAM_ERROR' })
    }
    const snapshot = await upstream.json()
    if (snapshot?.schema !== 'alsistemas-public-snapshot-v1' || !Array.isArray(snapshot?.noticias)) {
      response.setHeader('Cache-Control', 'no-store')
      return response.status(502).json({ erro: 'Snapshot público inválido.', codigo: 'FALLBACK_INVALID' })
    }

    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=600')
    return response.status(200).json(snapshot)
  } catch (error) {
    response.setHeader('Cache-Control', 'no-store')
    return response.status(502).json({
      erro: error?.name === 'AbortError' ? 'Timeout ao consultar o snapshot público.' : 'Não foi possível consultar o snapshot público.',
      codigo: error?.name === 'AbortError' ? 'FALLBACK_TIMEOUT' : 'FALLBACK_FETCH_ERROR',
    })
  }
}
