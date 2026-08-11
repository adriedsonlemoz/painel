import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Calendar, Clock, Tag, Globe, Star, Share2, Check, Eye, ArrowRight, UserRound } from 'lucide-react'
import { useNoticia } from '../hooks/useNoticias'
import { formatarData, formatarDataRelativa } from '../utils/formatters'
import { markdownParaHtml } from '../utils/markdown'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { configuracoesService, noticiasService } from '../services/api'
import { NoticiaCardV } from '../components/NoticiaCard'

// ─── SEO completo por notícia: canonical + OG/Twitter + NewsArticle ──────────
function useSEO({ noticia, cfg }) {
  useEffect(() => {
    if (!noticia) return undefined
    const siteName = cfg.nome_site || cfg.site_titulo || 'Portal de notícias'
    const tituloBase = noticia.seo_titulo || noticia.titulo
    const fullTitle = tituloBase.includes(siteName) ? tituloBase : `${tituloBase} | ${siteName}`
    const descricao = noticia.seo_descricao || noticia.resumo || noticia.conteudo?.replace(/[#*>\-\[\]]/g, '').slice(0, 160).trim()
    const imagem = noticia.imagem_url || cfg.site_imagem || ''
    const canonical = `${window.location.origin}/noticia/${noticia.slug || noticia._id || noticia.id}`

    document.title = fullTitle
    const setMeta = (name, content, isProp = false) => {
      if (!content) return
      const attr = isProp ? 'property' : 'name'
      let el = document.querySelector(`meta[${attr}="${name}"]`)
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.appendChild(el) }
      el.setAttribute('content', content)
    }
    const setLink = (rel, href) => {
      let el = document.querySelector(`link[rel="${rel}"]`)
      if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el) }
      el.href = href
    }
    setMeta('description', descricao)
    setMeta('robots', 'index, follow, max-image-preview:large')
    setMeta('og:title', fullTitle, true); setMeta('og:description', descricao, true)
    setMeta('og:image', imagem, true); setMeta('og:url', canonical, true); setMeta('og:type', 'article', true); setMeta('og:site_name', siteName, true)
    setMeta('article:published_time', noticia.publicado_em || noticia.criado_em, true)
    setMeta('article:modified_time', noticia.atualizado_em, true)
    if (noticia.categoria_id?.nome) setMeta('article:section', noticia.categoria_id.nome, true)
    setMeta('twitter:card', 'summary_large_image'); setMeta('twitter:title', fullTitle); setMeta('twitter:description', descricao); setMeta('twitter:image', imagem)
    setLink('canonical', canonical)

    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'NewsArticle',
      headline: noticia.titulo, description: descricao, image: imagem ? [imagem] : undefined,
      datePublished: noticia.publicado_em || noticia.criado_em, dateModified: noticia.atualizado_em || noticia.publicado_em || noticia.criado_em,
      author: { '@type': noticia.autor ? 'Person' : 'Organization', name: noticia.autor || siteName },
      publisher: { '@type': 'Organization', name: siteName, logo: cfg.site_favicon ? { '@type':'ImageObject', url: cfg.site_favicon } : undefined },
      mainEntityOfPage: { '@type':'WebPage', '@id': canonical },
      articleSection: noticia.categoria_id?.nome, keywords: Array.isArray(noticia.tags) ? noticia.tags.join(', ') : undefined,
    }
    let script = document.getElementById('newsarticle-jsonld')
    if (!script) { script = document.createElement('script'); script.id='newsarticle-jsonld'; script.type='application/ld+json'; document.head.appendChild(script) }
    script.textContent = JSON.stringify(jsonLd)
    return () => {
      script?.remove()
      const canonicalEl = document.querySelector('link[rel="canonical"]')
      if (canonicalEl) canonicalEl.href = window.location.origin
      document.title = cfg.site_titulo || cfg.nome_site || 'Portal de notícias'
      const ogType = document.querySelector('meta[property="og:type"]')
      const ogUrl = document.querySelector('meta[property="og:url"]')
      if (ogType) ogType.setAttribute('content', 'website')
      if (ogUrl) ogUrl.setAttribute('content', window.location.origin)
    }
  }, [noticia, cfg])
}

// ─── Calcula tempo de leitura (palavras ÷ 200 wpm) ────────────
function calcularTempoLeitura(texto) {
  if (!texto) return 1
  const semMarkdown = texto.replace(/[#*>`\-\[\]!()_~]/g, ' ')
  const palavras = semMarkdown.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(palavras / 200))
}

// ─── Botão de compartilhamento (Web Share API + fallback clipboard) ──
function BotaoCompartilhar({ titulo, url }) {
  const [copiado, setCopiado] = useState(false)
  const temWebShare = typeof navigator !== 'undefined' && !!navigator.share

  async function handleCompartilhar() {
    const shareData = {
      title: titulo,
      text:  `Leia: ${titulo}`,
      url:   url || window.location.href,
    }

    if (temWebShare) {
      try {
        await navigator.share(shareData)
      } catch (err) {
        if (err?.name !== 'AbortError') console.warn('share error', err)
      }
    } else {
      // Fallback: copia link para área de transferência
      try {
        await navigator.clipboard.writeText(shareData.url)
      } catch {
        // último recurso para contextos sem clipboard API
        const el = document.createElement('input')
        el.value = shareData.url
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    }
  }

  return (
    <button
      onClick={handleCompartilhar}
      title={temWebShare ? 'Compartilhar' : copiado ? 'Link copiado!' : 'Copiar link'}
      aria-label={temWebShare ? 'Compartilhar notícia' : copiado ? 'Link copiado!' : 'Copiar link da notícia'}
      className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-full
                 border border-gray-200 text-gray-600 bg-white hover:border-forest-400
                 hover:text-brand-500 hover:bg-brand-50 transition-all duration-200
                 focus:outline-none focus:ring-2 focus:ring-forest-400 focus:ring-offset-1"
    >
      {copiado
        ? <><Check size={15} className="text-brand-500" aria-hidden="true"/> Link copiado!</>
        : <><Share2 size={15} aria-hidden="true"/> Compartilhar</>
      }
    </button>
  )
}

// ─── Renderiza conteúdo (markdown ou texto puro) ───────────────
function renderConteudo(texto) {
  if (!texto) return null
  const temMarkdown = /(\*\*|^##|^- )/m.test(texto)

  if (temMarkdown) {
    return (
      <div
        className="prose-news"
        dangerouslySetInnerHTML={{ __html: markdownParaHtml(texto) }}
      />
    )
  }

  return (
    <div className="text-gray-700 leading-relaxed space-y-4 text-sm sm:text-base font-normal">
      {texto.split('\n').map((p, i) =>
        p.trim() ? <p key={i}>{p}</p> : <br key={i}/>
      )}
    </div>
  )
}

export default function NoticiaDetalhe() {
  const { id } = useParams()
  const { noticia, loading, error } = useNoticia(id)
  const [cfg, setCfg] = useState({})
  const [relacionadas, setRelacionadas] = useState([])
  const tempoLeitura = calcularTempoLeitura(noticia?.conteudo)

  useEffect(() => { configuracoesService.listar().then(setCfg).catch(() => {}) }, [])
  useEffect(() => {
    const slug = noticia?.categoria_id?.slug
    if (!slug) { setRelacionadas([]); return }
    noticiasService.listar({ categoria: slug, limit: 5 }).then(r => {
      setRelacionadas((r.noticias || []).filter(n => String(n._id || n.id) !== String(noticia._id || noticia.id)).slice(0,3))
    }).catch(() => setRelacionadas([]))
  }, [noticia])

  useSEO({ noticia, cfg })

  if (loading) return <div className="wrap py-10"><LoadingSpinner texto="Carregando notícia..."/></div>
  if (error)   return <div className="wrap py-10"><ErrorMessage mensagem={error}/></div>
  if (!noticia) return (
    <div className="wrap py-10 text-center">
      <p className="text-gray-500 font-semibold">Notícia não encontrada.</p>
      <Link to="/" className="btn-primary mt-4 inline-flex">Voltar</Link>
    </div>
  )

  const cat   = noticia.categoria_id || null
  const fonte = noticia.fonte_id     || null

  return (
    <article className="wrap py-8 animate-fade-in max-w-3xl">
      <Link to="/" className="inline-flex items-center gap-2 text-gray-500 hover:text-brand-600
                               text-sm font-bold mb-6 transition-colors group">
        <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform"/> Voltar para início
      </Link>

      {noticia.destaque && (
        <span className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1
                         bg-amber-100 text-amber-700 rounded-full mb-3 font-grotesk">
          <Star size={11} fill="currentColor"/> Destaque
        </span>
      )}

      {/* Categoria */}
      {cat && (
        <div className="mb-3">
          <Link to={`/categoria/${cat.slug}`}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1
                       text-white rounded-full hover:opacity-90 transition-opacity
                       uppercase tracking-wider font-grotesk"
            style={{ backgroundColor: cat.cor || '#ff5c00' }}>
            <Tag size={10}/> {cat.nome}
          </Link>
        </div>
      )}

      {/* Título — menor e mais denso */}
      <h1 className="font-display font-bold text-2xl sm:text-3xl text-gray-950 leading-[1.08] tracking-tight mb-4">
        {noticia.titulo}
      </h1>

      {noticia.resumo && (
        <p className="font-grotesk text-base sm:text-lg text-gray-500 leading-relaxed mb-5">{noticia.resumo}</p>
      )}

      {/* ── Barra de meta compacta — uma linha só ── */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {/* Data de publicação */}
        <span className="inline-flex items-center gap-1 text-[11px] font-grotesk font-semibold
                         text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full whitespace-nowrap">
          <Calendar size={11}/> {formatarData(noticia.publicado_em || noticia.criado_em)}
        </span>

        {/* Tempo relativo */}
        <span className="inline-flex items-center gap-1 text-[11px] font-grotesk font-semibold
                         text-gray-400 whitespace-nowrap">
          · {formatarDataRelativa(noticia.publicado_em || noticia.criado_em)}
        </span>

        {/* Separador */}
        <span className="text-gray-200 text-xs select-none">|</span>

        {/* Tempo de leitura */}
        <span className="inline-flex items-center gap-1 text-[11px] font-grotesk font-bold
                         text-brand-500 bg-brand-50 px-2.5 py-1 rounded-full whitespace-nowrap">
          <Clock size={11}/> {tempoLeitura} min
        </span>

        {/* Visualizações */}
        {noticia.views > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-grotesk font-semibold
                           text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full whitespace-nowrap">
            <Eye size={11}/> {noticia.views.toLocaleString('pt-BR')}
          </span>
        )}

        {noticia.autor && (
          <span className="inline-flex items-center gap-1 text-[11px] font-grotesk font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">
            <UserRound size={11}/> {noticia.autor}
          </span>
        )}

        {/* Fonte */}
        {fonte && (
          <>
            <span className="text-gray-200 text-xs select-none">|</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-grotesk font-semibold
                             text-gray-500 whitespace-nowrap">
              <Globe size={11}/>
              {fonte.url
                ? <a href={fonte.url} target="_blank" rel="noopener noreferrer"
                     className="hover:text-brand-500 transition-colors underline underline-offset-2">
                    {fonte.nome}
                  </a>
                : fonte.nome
              }
            </span>
          </>
        )}

        {/* Compartilhar — direita, desktop */}
        <span className="ml-auto hidden sm:block">
          <BotaoCompartilhar titulo={noticia.titulo} url={window.location.href} />
        </span>
      </div>

      {/* Imagem de capa + legenda */}
      {noticia.imagem_url && (
        <figure className="mb-8">
          <div className="w-full rounded-2xl overflow-hidden shadow-md"
               style={{ maxHeight: '480px' }}>
            <img
              src={noticia.imagem_url}
              alt={noticia.imagem_legenda || noticia.titulo}
              className="w-full h-full object-cover"
              style={{ maxHeight: '480px' }}
            />
          </div>
          {noticia.imagem_legenda && (
            <figcaption className="mt-2 text-center text-xs text-gray-400
                                   font-grotesk leading-relaxed px-2">
              {noticia.imagem_legenda}
            </figcaption>
          )}
        </figure>
      )}

      <div className="w-12 h-1 bg-brand-500 rounded-full mb-8"/>

      {renderConteudo(noticia.conteudo)}

      {/* ── Rodapé do artigo ─────────────────────────────────── */}
      <div className="mt-12 pt-6 border-t border-gray-100 flex items-center gap-4 flex-wrap">
        <Link to="/" className="btn-secondary">
          <ArrowLeft size={15}/> Mais notícias
        </Link>
        {cat && (
          <Link to={`/categoria/${cat.slug}`}
            className="text-sm font-bold text-brand-500 hover:text-brand-600 flex items-center gap-1">
            <Tag size={13}/> Mais em {cat.nome}
          </Link>
        )}

        {/* Compartilhar — mobile (no rodapé) */}
        <span className="ml-auto sm:hidden">
          <BotaoCompartilhar titulo={noticia.titulo} url={window.location.href} />
        </span>
      </div>

      {relacionadas.length > 0 && (
        <section className="mt-14 pt-8 border-t-2 border-gray-900">
          <div className="flex items-end justify-between gap-4 mb-5">
            <div>
              <p className="text-[11px] font-grotesk font-black text-brand-500 uppercase tracking-[.18em]">Continue lendo</p>
              <h2 className="font-display font-bold text-2xl text-gray-950">Notícias relacionadas</h2>
            </div>
            {cat && <Link to={`/categoria/${cat.slug}`} className="hidden sm:flex items-center gap-1 text-sm font-bold text-brand-500">Ver categoria <ArrowRight size={14}/></Link>}
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            {relacionadas.map(n => <NoticiaCardV key={n._id || n.id} noticia={n} fullWidth/>)}
          </div>
        </section>
      )}
    </article>
  )
}
