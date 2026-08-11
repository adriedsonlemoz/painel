import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Newspaper } from 'lucide-react'
import { useCategorias, useNoticias } from '../hooks/useNoticias'
import { NoticiaCardItem, NoticiaCardV } from '../components/NoticiaCard'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'

function MetaCategoria({ categoria }) {
  useEffect(() => {
    if (!categoria) return
    const oldTitle = document.title
    document.title = `${categoria.nome} — Notícias`
    const desc = categoria.descricao || `Últimas notícias de ${categoria.nome}.`
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta) }
    const oldDesc = meta.content
    meta.content = desc
    let canonical = document.querySelector('link[rel="canonical"]')
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical) }
    canonical.href = `${window.location.origin}/categoria/${categoria.slug}`
    return () => { document.title = oldTitle; meta.content = oldDesc }
  }, [categoria])
  return null
}

export default function Categoria() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, parseInt(params.get('page') || '1', 10))
  const { categorias, loading: loadingCats } = useCategorias()
  const categoria = useMemo(() => categorias.find(c => c.slug === slug), [categorias, slug])
  const { noticias, total, paginas, loading, error, recarregar } = useNoticias({ categoriaSlug: slug, page, limit: 13 })
  const [principal, ...restantes] = noticias

  const irPagina = n => {
    const p = new URLSearchParams(params)
    if (n <= 1) p.delete('page'); else p.set('page', String(n))
    setParams(p); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loadingCats || loading) return <LoadingSpinner texto="Carregando editoria..." />
  if (error) return <ErrorMessage mensagem={error} onRetry={recarregar} />
  if (!categoria) return <div className="wrap py-16 text-center"><h1 className="text-2xl font-bold">Categoria não encontrada</h1><Link to="/" className="btn-primary mt-5 inline-flex">Voltar ao início</Link></div>

  return (
    <div className="bg-gray-50 min-h-screen">
      <MetaCategoria categoria={categoria} />
      <header className="bg-white border-b border-gray-100">
        <div className="wrap py-9">
          <Link to="/" className="inline-flex items-center gap-1 text-sm font-bold text-gray-500 hover:text-brand-500 mb-5"><ArrowLeft size={15}/> Início</Link>
          <div className="flex items-start gap-4">
            <span className="w-2 self-stretch rounded-full" style={{ backgroundColor: categoria.cor || '#ff5c00' }} />
            <div>
              <p className="uppercase tracking-[.18em] text-xs font-black text-brand-500 mb-1">Editoria</p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-gray-900">{categoria.nome}</h1>
              {categoria.descricao && <p className="mt-3 max-w-2xl text-gray-600 text-base leading-relaxed">{categoria.descricao}</p>}
              <p className="mt-3 text-xs font-bold text-gray-400">{total} matéria{total === 1 ? '' : 's'} publicada{total === 1 ? '' : 's'}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="wrap py-8 space-y-8">
        {principal ? (
          <>
            {page === 1 && <section className="grid lg:grid-cols-[1.35fr_.65fr] gap-5 items-stretch">
              <NoticiaCardV noticia={principal} fullWidth />
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs uppercase tracking-widest font-black text-brand-500 mb-3">Mais recentes</p>
                <div className="divide-y divide-gray-100">
                  {restantes.slice(0,4).map(n => <NoticiaCardItem key={n._id || n.id} noticia={n}/>) }
                </div>
              </div>
            </section>}
            <section>
              <div className="flex items-center justify-between mb-4"><h2 className="font-display text-2xl font-bold flex items-center gap-2"><Newspaper size={20} className="text-brand-500"/> Todas as notícias</h2></div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
                {(page === 1 ? restantes.slice(4) : noticias).map(n => <NoticiaCardItem key={n._id || n.id} noticia={n}/>) }
              </div>
            </section>
          </>
        ) : <div className="py-20 text-center text-gray-500">Ainda não há notícias publicadas nesta categoria.</div>}

        {paginas > 1 && <div className="flex justify-center gap-2">
          <button disabled={page<=1} onClick={()=>irPagina(page-1)} className="btn-secondary disabled:opacity-40">Anterior</button>
          <span className="px-4 py-2 text-sm font-bold text-gray-500">{page} / {paginas}</span>
          <button disabled={page>=paginas} onClick={()=>irPagina(page+1)} className="btn-secondary disabled:opacity-40">Próxima <ArrowRight size={14}/></button>
        </div>}
      </main>
    </div>
  )
}
