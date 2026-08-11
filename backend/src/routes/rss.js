/** RSS público do portal — somente conteúdo editorial publicado. */
import { Router } from 'express'
import Noticia from '../models/Noticia.js'
import { cacheGet, cacheSet } from '../utils/cache.js'

const router = Router()
const CACHE_KEY = 'rss_feed:v2:published'
const CACHE_TTL = 300

router.get('/', async (_req, res, next) => {
  try {
    const cached = await cacheGet(CACHE_KEY)
    if (cached) {
      res.set('Content-Type', 'application/rss+xml; charset=utf-8')
      return res.send(cached)
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const backendBase = (process.env.AL_PUBLIC_BACKEND_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '')
    const selfUrl = `${backendBase || baseUrl.replace(/\/$/, '')}/rss`
    const noticias = await Noticia.find(
      { status: 'publicado' },
      'titulo resumo conteudo imagem_url imagem_mime imagem_tamanho criado_em atualizado_em publicado_em categoria_id slug'
    )
      .populate('categoria_id', 'nome')
      .sort({ publicado_em: -1, criado_em: -1 })
      .limit(50)
      .lean()

    const items = noticias.map(n => {
      const link = `${baseUrl.replace(/\/$/, '')}/noticia/${n._id}`
      const pubDate = new Date(n.publicado_em || n.criado_em).toUTCString()
      const desc = String(n.resumo || stripHtml(n.conteudo || '')).slice(0, 500)
      const cat = n.categoria_id?.nome || ''
      const mime = /^image\/(?:jpeg|jpg|png|webp|gif)$/i.test(String(n.imagem_mime || '')) ? n.imagem_mime : 'image/jpeg'
      const length = Number(n.imagem_tamanho || 0)
      return `
    <item>
      <title>${escapeXml(n.titulo || '')}</title>
      <link>${escapeXml(link)}</link>
      <description>${escapeXml(desc)}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      ${cat ? `<category>${escapeXml(cat)}</category>` : ''}
      ${n.imagem_url ? `<enclosure url="${escapeXml(n.imagem_url)}" type="${escapeXml(mime)}"${length > 0 ? ` length="${length}"` : ''}/>` : ''}
    </item>`
    }).join('')

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AL Sistemas</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>Últimas notícias publicadas no portal</description>
    <language>pt-BR</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>${items}
  </channel>
</rss>`

    await cacheSet(CACHE_KEY, xml, CACHE_TTL)
    res.set('Content-Type', 'application/rss+xml; charset=utf-8')
    res.send(xml)
  } catch (err) { next(err) }
})

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
function stripHtml(html) { return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() }

export default router
