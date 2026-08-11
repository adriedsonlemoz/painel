import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useNoticias, useCategorias } from '../hooks/useNoticias'
import ErrorMessage   from '../components/ErrorMessage'
import { NoticiaCardItem, NoticiaCardV } from '../components/NoticiaCard'
import {
  Newspaper, Star, ArrowRight, Tag, X, Globe,
  BookOpen, Mountain, Users, Heart,
  Church, ExternalLink, Bus, CalendarDays,
  Search, ChevronLeft, ChevronRight, Mail,
} from 'lucide-react'
import {
  configuracoesService,
  modulosService,
  noticiasExternasService,
  topicosService,
  eventosService,
  onibusService,
  newsletterService,
  noticiasService,
  portalContentService,
} from '../services/api'

/* ─── Ícones de tópico ─────────────────────────────────────── */
const ICON_MAP = {
  church: Church, mountain: Mountain, users: Users, heart: Heart,
  book: BookOpen, globe: Globe, star: Star, newspaper: Newspaper,
  bus: Bus, calendarDays: CalendarDays, calendar: CalendarDays,
}

function labelOnibus(t) {
  return t.icone === 'bus' ? 'Ônibus' : t.label
}

function textoEventoDias(dataISO) {
  if (!dataISO) return null
  const evento = new Date(dataISO); evento.setHours(0, 0, 0, 0)
  const hoje   = new Date();        hoje.setHours(0, 0, 0, 0)
  const dias   = Math.round((evento - hoje) / 86_400_000)
  if (dias === 0) return '📅 Hoje!'
  if (dias === 1) return '📅 Amanhã'
  return `📅 Em ${dias} dias`
}

function HomeSkeleton(){
  return <div className="wrap py-8" aria-label="Carregando notícias">
    <div className="grid gap-5 lg:grid-cols-[1.4fr_.8fr]">
      <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden"><div className="h-56 sm:h-72 animate-pulse bg-gray-100"/><div className="p-5 space-y-3"><div className="h-7 w-4/5 bg-gray-100 rounded animate-pulse"/><div className="h-4 w-2/3 bg-gray-100 rounded animate-pulse"/><div className="h-4 w-1/3 bg-gray-100 rounded animate-pulse"/></div></div>
      <div className="grid gap-3">{[1,2,3].map(i=><div key={i} className="rounded-2xl border border-gray-100 bg-white p-4 space-y-3"><div className="h-4 w-1/3 bg-gray-100 rounded animate-pulse"/><div className="h-5 w-5/6 bg-gray-100 rounded animate-pulse"/><div className="h-4 w-2/3 bg-gray-100 rounded animate-pulse"/></div>)}</div>
    </div>
  </div>
}

/* ═══════════════════════════════════════════════════════════
   HERO
═══════════════════════════════════════════════════════════ */
function Hero({ cfg, destaqueImg }) {
  const titulo1   = cfg.hero_titulo_linha1 || 'Sua cidade,'
  const titulo2   = cfg.hero_titulo_linha2 || 'em destaque.'
  const subtitulo = cfg.hero_subtitulo     || 'Jornalismo local para quem ama Iguatama. Notícias, eventos, curiosidades e muito mais.'
  const btn1Label = cfg.hero_btn1_label    || 'Últimas Notícias'
  const btn1Link  = cfg.hero_btn1_link     || '/#noticias'
  const btn2Label = cfg.hero_btn2_label    || 'Curiosidades'
  const btn2Link  = cfg.hero_btn2_link     || '/?categoria=curiosidades'
  const imgUrl    = cfg.hero_imagem_url    || destaqueImg || ''

  return (
    <section className="relative overflow-hidden bg-white">
      {/* Eyebrow */}
      <div className="bg-brand-500 py-2 px-4">
        <p className="text-white text-xs font-grotesk font-bold tracking-widest uppercase text-center">
          🗺️ Iguatama, MG — Portal de Notícias Local
        </p>
      </div>

      <div className="wrap pt-10 pb-0">
        <div className="max-w-xl mb-8">
          <h1
            className="font-display font-bold text-gray-900 leading-[1.05] animate-slide-up"
            style={{ fontSize: 'clamp(1.75rem, 5vw, 2.35rem)', animationDelay: '80ms' }}>
            {titulo1}
          </h1>
          <h1
            className="font-display font-bold italic text-brand-500 leading-[1.05] mb-5 animate-slide-up"
            style={{ fontSize: 'clamp(1.75rem, 5vw, 2.35rem)', animationDelay: '160ms' }}>
            {titulo2}
          </h1>
          <p className="font-grotesk text-gray-500 text-sm sm:text-base leading-relaxed max-w-md mb-8
                        animate-slide-up" style={{ animationDelay: '240ms' }}>
            {subtitulo}
          </p>
          <div className="flex items-center gap-3 flex-wrap animate-slide-up" style={{ animationDelay: '320ms' }}>
            <Link to={btn1Link}
              className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600
                         text-white font-grotesk font-bold text-sm px-6 py-3 rounded-xl
                         transition-colors shadow-sm">
              <Newspaper size={16}/> {btn1Label}
            </Link>
            <Link to={btn2Link}
              className="inline-flex items-center gap-2 bg-gray-100 hover:bg-gray-200
                         text-gray-700 font-grotesk font-bold text-sm px-6 py-3 rounded-xl
                         transition-colors">
              <Heart size={16}/> {btn2Label}
            </Link>
          </div>
        </div>

        {imgUrl && (
          <div className="w-full rounded-t-2xl overflow-hidden" style={{ maxHeight: 280 }}>
            <img
              src={imgUrl}
              alt="Destaque"
              className="w-full h-full object-cover animate-fade-in"
              style={{ maxHeight: 280 }}
            />
          </div>
        )}
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════
   FAIXA DE TÓPICOS
═══════════════════════════════════════════════════════════ */
function FaixaTopicos({ topicos, proximoEvento, proximoOnibus, modulos }) {
  if (!topicos.length) return null

  const onibusMod  = modulos?.['horario-onibus']?.ativo !== false
  const eventosMod = modulos?.['eventos']?.ativo !== false

  return (
    <div className="wrap">
      <div
        className="portal-topic-grid bg-white border border-gray-100 rounded-2xl shadow-md overflow-hidden grid">
        {topicos.map(t => {
          const Icon      = ICON_MAP[t.icone] || Heart
          const isInterno = t.link?.startsWith('/')
          const isOnibus  = t.icone === 'bus'
          const isEventos = ['calendarDays', 'calendar'].includes(t.icone)

          let detalhe = null
          if (isOnibus && onibusMod) {
            detalhe = proximoOnibus
              ? <p className="text-brand-500 text-[10px] font-bold font-grotesk leading-snug">🚌 {proximoOnibus}</p>
              : t.descricao
                ? <p className="text-gray-400 text-[10px] font-grotesk">{t.descricao}</p>
                : null
          } else if (isEventos && eventosMod) {
            const txt = textoEventoDias(proximoEvento)
            detalhe = txt
              ? <p className="text-brand-500 text-[10px] font-bold font-grotesk leading-snug">{txt}</p>
              : t.descricao
                ? <p className="text-gray-400 text-[10px] font-grotesk">{t.descricao}</p>
                : null
          } else if (t.descricao) {
            detalhe = <p className="text-gray-400 text-[10px] font-grotesk">{t.descricao}</p>
          }

          const inner = (
            <div className="flex flex-col items-center text-center gap-2 py-4 px-2
                            group-hover:bg-brand-50 transition-colors">
              <div className="w-11 h-11 rounded-xl bg-gray-50 group-hover:bg-brand-100
                              flex items-center justify-center transition-colors">
                <Icon size={20} className="text-gray-400 group-hover:text-brand-500 transition-colors" strokeWidth={1.5}/>
              </div>
              <p className="font-grotesk font-bold text-[11px] text-gray-800 leading-tight">
                {labelOnibus(t)}
              </p>
              {detalhe}
            </div>
          )

          return isInterno ? (
            <Link key={t._id || t.id} to={t.link} className="group">{inner}</Link>
          ) : (
            <a key={t._id || t.id} href={t.link || '/'} className="group">{inner}</a>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   ABAS DE CATEGORIA
═══════════════════════════════════════════════════════════ */
function AbasCategorias({ catAtual, onMudar }) {
  const { categorias } = useCategorias()
  const [mais, setMais] = useState(false)
  const principais = categorias.slice(0, 4)
  const extras = categorias.slice(4)
  const escolher = slug => { onMudar(slug); setMais(false) }
  const renderButton = c => (
    <button
      key={c._id || c.id}
      onClick={() => escolher(c.slug)}
      className={`portal-cat-btn ${catAtual === c.slug ? 'active' : ''}`}
      style={catAtual === c.slug ? { '--cat-color': c.cor || '#ff5c00' } : {}}>
      {c.nome}
    </button>
  )
  return (
    <div className="portal-categories-compact">
      <div className="portal-category-primary">
        <button onClick={() => escolher(null)} className={`portal-cat-btn ${!catAtual ? 'active' : ''}`}>Tudo</button>
        {principais.map(renderButton)}
        {extras.length > 0 && <button className="portal-cat-btn more" onClick={() => setMais(true)}>Mais <span>+</span></button>}
      </div>
      {mais && <div className="portal-category-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setMais(false) }}>
        <div className="portal-category-sheet">
          <div className="portal-category-sheet-head"><strong>Mais editorias</strong><button onClick={() => setMais(false)} aria-label="Fechar categorias">×</button></div>
          <div className="portal-category-more">{extras.map(renderButton)}</div>
        </div>
      </div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   NOTÍCIAS EXTERNAS
═══════════════════════════════════════════════════════════ */
function formatAgo(date) {
  if (!date) return ''
  const min = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000))
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h}h`
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function NoticiasExternas({ items = [], fallback = [] }) {
  const rss = items.length ? items : fallback.map(x => ({ id:x._id||x.id, title:x.titulo, url:x.url_externa, source:x.fonte_nome, image:x.imagem_url, publishedAt:x.criado_em, internal:false }))
  if (!rss.length) return null
  const [lead, ...rest] = rss.slice(0, 7)
  return (
    <section className="world-news-section">
      <div className="section-title mb-4">
        <h2 className="section-title-text font-grotesk"><Globe size={20} className="text-brand-500"/> Brasil e Mundo</h2>
        <span className="portal-source-pill">Fontes nacionais</span>
      </div>
      <div className="world-news-layout">
        <a className="world-lead group" href={lead.url} {...(!lead.internal ? { target:'_blank', rel:'noopener noreferrer' } : {})}>
          {lead.image ? <img src={lead.image} alt=""/> : <div className="world-image-fallback"><Globe size={28}/></div>}
          <div className="world-lead-body">
            <div className="world-meta"><b>{lead.source || 'RSS'}</b><span>{formatAgo(lead.publishedAt)}</span></div>
            <h3>{lead.title}</h3>
            <span className="world-open">{lead.internal ? 'Ler notícia' : <>Abrir na fonte <ExternalLink size={13}/></>}</span>
          </div>
        </a>
        <div className="world-list">
          {rest.map(item => <a key={item.id || item.url} href={item.url} {...(!item.internal ? { target:'_blank', rel:'noopener noreferrer' } : {})} className="world-row group">
            {item.image && <img src={item.image} alt=""/>}
            <div className="min-w-0"><div className="world-meta"><b>{item.source || 'RSS'}</b><span>{formatAgo(item.publishedAt)}</span></div><h4>{item.title}</h4></div>
            <ChevronRight size={16} className="world-chevron"/>
          </a>)}
        </div>
      </div>
    </section>
  )
}

function weatherEmoji(code, isDay = true) {
  if (code === 0) return isDay ? '☀️' : '🌙'
  if ([1,2].includes(code)) return '🌤️'
  if (code === 3) return '☁️'
  if ([45,48].includes(code)) return '🌫️'
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return '🌧️'
  if ([95,96,99].includes(code)) return '⛈️'
  return '🌥️'
}
function WeatherBlock({ data }) {
  if (!data?.available || !data.current) return null
  const c = data.current
  const days = (data.daily || []).slice(0, 4)
  return <section className={`weather-card ${c.isDay ? 'day' : 'night'}`}>
    <div className="weather-main">
      <div><div className="weather-kicker">PREVISÃO DO TEMPO</div><h2>{data.location?.name || 'Iguatama'}{data.location?.admin1 ? ` · ${data.location.admin1}` : ''}</h2><p>{c.condition}</p></div>
      <div className="weather-now"><span className="weather-icon">{weatherEmoji(c.weatherCode,c.isDay)}</span><strong>{Math.round(c.temperature)}°</strong></div>
    </div>
    <div className="weather-facts"><span>Sensação <b>{Math.round(c.apparentTemperature)}°</b></span><span>Umidade <b>{Math.round(c.humidity)}%</b></span><span>Vento <b>{Math.round(c.windSpeed)} km/h</b></span><span>Chuva <b>{Math.round(c.precipitation || 0)} mm</b></span></div>
    <div className="weather-days">{days.map((d,i)=><div key={d.date}><span>{i===0?'Hoje':new Date(`${d.date}T12:00:00`).toLocaleDateString('pt-BR',{weekday:'short'}).replace('.','')}</span><b>{weatherEmoji(d.weatherCode,true)}</b><small>{Math.round(d.max)}° / {Math.round(d.min)}°</small><em>{Math.round(d.rainChance||0)}% chuva</em></div>)}</div>
    <a className="weather-source" href={data.attributionUrl || 'https://open-meteo.com/'} target="_blank" rel="noreferrer">Dados meteorológicos: {data.source || 'Open-Meteo'}</a>
  </section>
}

function FootballBlock({ data }) {
  if (!data?.available || !data.matches?.length) return null
  return <section className="football-section">
    <div className="section-title mb-4"><h2 className="section-title-text font-grotesk">⚽ {data.mode === 'live' ? 'Futebol ao vivo' : 'Jogos de hoje'}</h2><span className={data.mode==='live'?'live-pill':'portal-source-pill'}>{data.mode==='live'?'● AO VIVO':'HOJE'}</span></div>
    <div className="football-list">{data.matches.map(m=><div key={m.id} className="match-row">
      <div className="match-league"><span>{m.league?.name}</span><small>{m.league?.country}</small></div>
      <div className="match-teams"><span>{m.home?.logo&&<img src={m.home.logo} alt=""/>}{m.home?.name}</span><strong>{m.goals?.home ?? '–'} × {m.goals?.away ?? '–'}</strong><span>{m.away?.name}{m.away?.logo&&<img src={m.away.logo} alt=""/>}</span></div>
      <div className="match-status">{data.mode==='live' ? `${m.elapsed || ''}${m.elapsed ? "'" : ''} ${m.status || ''}` : new Date(m.date).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
    </div>)}</div>
    <div className="football-source">Dados: API-Football</div>
  </section>
}

const SIGNS = [['aries','Áries','♈'],['taurus','Touro','♉'],['gemini','Gêmeos','♊'],['cancer','Câncer','♋'],['leo','Leão','♌'],['virgo','Virgem','♍'],['libra','Libra','♎'],['scorpio','Escorpião','♏'],['sagittarius','Sagitário','♐'],['capricorn','Capricórnio','♑'],['aquarius','Aquário','♒'],['pisces','Peixes','♓']]
function HoroscopeBlock({ status }) {
  const [open,setOpen]=useState(null),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  if (!status?.available || !status?.configured) return null
  async function choose(sign){setOpen(sign);setResult(null);setError('');setBusy(true);try{setResult(await portalContentService.horoscope(sign))}catch(e){setError(e.message||'Não foi possível carregar o horóscopo.')}finally{setBusy(false)}}
  const selected=SIGNS.find(x=>x[0]===open)
  return <section className="horoscope-section"><div className="section-title mb-4"><h2 className="section-title-text font-grotesk">✨ Horóscopo de hoje</h2><span className="portal-source-pill">12 signos</span></div><div className="zodiac-grid">{SIGNS.map(([id,label,icon])=><button key={id} onClick={()=>choose(id)}><b>{icon}</b><span>{label}</span></button>)}</div>
  {open&&<div className="horoscope-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(null)}}><div className="horoscope-modal"><button className="horoscope-close" onClick={()=>setOpen(null)}>×</button><div className="zodiac-big">{selected?.[2]}</div><h3>{selected?.[1]}</h3>{busy?<p>Consultando previsão…</p>:error?<p className="text-red-600">{error}</p>:<p>{result?.text || 'Previsão indisponível.'}</p>}<small>Fonte: API Ninjas</small></div></div>}
  </section>
}

/* ═══════════════════════════════════════════════════════════
   PAGINAÇÃO
═══════════════════════════════════════════════════════════ */
function Paginacao({ pagina, paginas, onMudar }) {
  if (paginas <= 1) return null
  const pages = Array.from({ length: paginas }, (_, i) => i + 1)
  return (
    <div className="flex items-center justify-center gap-1.5 pt-6">
      <button onClick={() => onMudar(pagina - 1)} disabled={pagina === 1}
        className="p-2 rounded-xl border border-gray-200 text-gray-500
                   hover:border-brand-400 hover:text-brand-500 disabled:opacity-30
                   disabled:cursor-not-allowed transition-colors">
        <ChevronLeft size={16}/>
      </button>
      {pages.map(p => (
        <button key={p} onClick={() => onMudar(p)}
          className={`w-9 h-9 rounded-xl text-sm font-grotesk font-bold transition-colors ${
            p === pagina
              ? 'bg-brand-500 text-white shadow-sm'
              : 'border border-gray-200 text-gray-600 hover:border-brand-400 hover:text-brand-500'
          }`}>
          {p}
        </button>
      ))}
      <button onClick={() => onMudar(pagina + 1)} disabled={pagina === paginas}
        className="p-2 rounded-xl border border-gray-200 text-gray-500
                   hover:border-brand-400 hover:text-brand-500 disabled:opacity-30
                   disabled:cursor-not-allowed transition-colors">
        <ChevronRight size={16}/>
      </button>
    </div>
  )
}

/* ── Utilitários editoriais ──────────────────────────────── */
function noticiaId(noticia) {
  return String(noticia?._id || noticia?.id || '')
}

function noticiasSemRepeticao(lista = []) {
  const vistos = new Set()
  return lista.filter(n => {
    const id = noticiaId(n)
    if (!id || vistos.has(id)) return false
    vistos.add(id)
    return true
  })
}

function selecionarCapa(noticias = [], cfg = {}) {
  const unicas = noticiasSemRepeticao(noticias)
  const destaques = unicas.filter(n => n.destaque)
  const byId = id => unicas.find(n => noticiaId(n) === String(id))
  const principal = byId(cfg.home_manchete_id) || destaques[0] || unicas[0] || null
  if (!principal) return { principal: null, secundarios: [] }

  const idsSecundarios = String(cfg.home_secundarias_ids || '').split(',').map(s => s.trim()).filter(Boolean)
  const escolhidas = noticiasSemRepeticao(idsSecundarios.map(byId).filter(Boolean))
    .filter(n => noticiaId(n) !== noticiaId(principal))

  const escolhidasIds = new Set(escolhidas.map(noticiaId))
  const automaticas = noticiasSemRepeticao([...destaques, ...unicas])
    .filter(n => noticiaId(n) !== noticiaId(principal) && !escolhidasIds.has(noticiaId(n)))

  return { principal, secundarios: [...escolhidas, ...automaticas].slice(0, 2) }
}

/* ═══════════════════════════════════════════════════════════
   CAPA JORNALÍSTICA + PLANTÃO
═══════════════════════════════════════════════════════════ */
function Plantao({ noticia }) {
  if (!noticia) return null
  const id = noticia._id || noticia.id
  return (
    <div className="bg-red-600 text-white">
      <div className="wrap py-2.5 flex items-center gap-3 min-w-0">
        <span className="flex-shrink-0 text-[11px] font-grotesk font-black uppercase tracking-widest bg-white text-red-600 px-2.5 py-1 rounded-full">● Plantão</span>
        <Link to={`/noticia/${id}`} className="font-grotesk font-bold text-sm sm:text-base truncate hover:underline">{noticia.titulo}</Link>
        <ArrowRight size={15} className="flex-shrink-0 ml-auto"/>
      </div>
    </div>
  )
}

function CapaJornalistica({ noticias, cfg }) {
  const { principal, secundarios } = selecionarCapa(noticias, cfg)
  const slides = noticiasSemRepeticao([principal, ...secundarios].filter(Boolean)).slice(0, 3)
  const [active,setActive]=useState(0)
  const [touchStart,setTouchStart]=useState(null)
  useEffect(()=>{ if(slides.length<2)return; const t=setInterval(()=>setActive(v=>(v+1)%slides.length),6500); return()=>clearInterval(t) },[slides.length])
  if (!slides.length) return null
  const n=slides[Math.min(active,slides.length-1)]
  const id=noticiaId(n)
  return <section className="headline-carousel-wrap"><div className="wrap py-5 sm:py-7"><div className="headline-carousel" onTouchStart={e=>setTouchStart(e.touches[0].clientX)} onTouchEnd={e=>{if(touchStart==null)return;const dx=e.changedTouches[0].clientX-touchStart;if(Math.abs(dx)>45)setActive(v=>(v+(dx<0?1:-1)+slides.length)%slides.length);setTouchStart(null)}}>
    <Link to={`/noticia/${id}`} className="headline-slide group">
      <div className="headline-image">{n.imagem_url?<img src={n.imagem_url} alt={n.titulo}/>:<div>📰</div>}<div className="headline-gradient"/></div>
      <div className="headline-copy">{n.categoria_id?.nome&&<span>{n.categoria_id.nome}</span>}<h1>{n.titulo}</h1>{n.resumo&&<p>{n.resumo}</p>}</div>
    </Link>
    <div className="headline-controls"><div className="headline-dots">{slides.map((x,i)=><button key={noticiaId(x)} className={i===active?'active':''} onClick={()=>setActive(i)} aria-label={`Destaque ${i+1}`}/>)}</div><span>{active+1} / {slides.length}</span></div>
  </div></div></section>
}


function BlocoEditorialUltimas({ noticias }) {
  if (!noticias.length) return null
  const [principal, ...resto] = noticias
  return (
    <div className="grid lg:grid-cols-5 gap-5">
      <div className="lg:col-span-3">
        <NoticiaCardV noticia={principal} fullWidth/>
      </div>
      <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {resto.slice(0, 4).map(n => <NoticiaCardItem key={n._id || n.id} noticia={n}/>)}
      </div>
    </div>
  )
}

function MaisLidas({ noticias }) {
  const lista = [...noticias].filter(n => (n.views || 0) > 0).sort((a,b) => (b.views || 0) - (a.views || 0)).slice(0, 5)
  if (!lista.length) return null
  return (
    <section>
      <div className="section-title mb-4">
        <h2 className="section-title-text font-grotesk"><Star size={20} className="text-brand-500"/> Mais lidas</h2>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {lista.map((n, i) => (
          <Link key={n._id || n.id} to={`/noticia/${n._id || n.id}`} className="group flex gap-4 items-start p-4 hover:bg-gray-50 transition-colors">
            <span className="font-display text-3xl font-black text-gray-200 group-hover:text-brand-200 leading-none">{String(i+1).padStart(2,'0')}</span>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-gray-900 leading-snug group-hover:text-brand-600 line-clamp-2">{n.titulo}</h3>
              <p className="font-grotesk text-xs text-gray-400 mt-1">{(n.views || 0).toLocaleString('pt-BR')} visualizações</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function BlocosPorCategoria({ noticias }) {
  const grupos = new Map()
  for (const n of noticias) {
    const cat = n.categoria_id
    if (!cat?.slug) continue
    if (!grupos.has(cat.slug)) grupos.set(cat.slug, { cat, items: [] })
    grupos.get(cat.slug).items.push(n)
  }
  return [...grupos.values()].filter(g => g.items.length >= 2).slice(0, 3).map(({cat, items}) => (
    <section key={cat.slug}>
      <div className="section-title mb-4">
        <h2 className="section-title-text font-grotesk"><Tag size={20} style={{color: cat.cor || '#ff5c00'}}/> {cat.nome}</h2>
        <Link to={`/categoria/${cat.slug}`} className="text-sm font-grotesk font-bold text-brand-500 hover:text-brand-600 flex items-center gap-1">Ver categoria <ArrowRight size={14}/></Link>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <NoticiaCardV noticia={items[0]} fullWidth/>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
          {items.slice(1,4).map(n => <NoticiaCardItem key={n._id || n.id} noticia={n}/>)}
        </div>
      </div>
    </section>
  ))
}

/* ═══════════════════════════════════════════════════════════
   NEWSLETTER CTA
═══════════════════════════════════════════════════════════ */
function NewsletterCTA() {
  const [email,    setEmail]    = useState('')
  const [enviando, setEnviando] = useState(false)
  const [ok,       setOk]       = useState(false)
  const [erro,     setErro]     = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email) return
    try {
      setEnviando(true)
      setErro(null)
      await newsletterService.assinar({ email })
      setOk(true)
      setEmail('')
    } catch (err) {
      setErro(err.message || 'Erro ao assinar. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl p-6 sm:p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Mail size={20} className="text-white/80"/>
            <h3 className="font-display font-bold text-white text-xl">Fique por dentro</h3>
          </div>
          <p className="font-grotesk text-white/80 text-sm leading-relaxed">
            Receba as principais notícias de Iguatama direto no seu e-mail, sem spam.
          </p>
        </div>

        <div className="w-full sm:w-auto">
          {ok ? (
            <div className="flex items-center gap-2 bg-white/20 text-white font-grotesk font-bold
                            text-sm px-5 py-3 rounded-xl">
              ✅ Assinatura confirmada!
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="flex-1 min-w-0 bg-white/20 border border-white/30 text-white
                           placeholder-white/60 font-grotesk text-sm rounded-xl px-4 py-2.5
                           focus:outline-none focus:ring-2 focus:ring-white/50 w-48"
              />
              <button
                type="submit"
                disabled={enviando}
                className="bg-white text-brand-500 font-grotesk font-bold text-sm
                           px-5 py-2.5 rounded-xl hover:bg-gray-50 transition-colors
                           disabled:opacity-60 whitespace-nowrap">
                {enviando ? '...' : 'Assinar'}
              </button>
            </form>
          )}
          {erro && <p className="text-white/80 text-xs mt-1.5 font-grotesk">{erro}</p>}
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════
   HOME — componente principal
═══════════════════════════════════════════════════════════ */
export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams()
  const catSlug    = searchParams.get('categoria') || null
  const q          = searchParams.get('q')         || null
  const page       = parseInt(searchParams.get('page') || '1', 10)
  const dataInicio = searchParams.get('dataInicio') || null
  const dataFim    = searchParams.get('dataFim')    || null
  const ordem      = searchParams.get('ordem')      || 'recente'
  const modoTodas  = searchParams.get('view') === 'todas'

  const { noticias, total, paginas, loading, error, recarregar } =
    useNoticias({ categoriaSlug: catSlug, q, page, limit: (modoTodas || catSlug || q || dataInicio || dataFim || (ordem && ordem !== 'recente')) ? 12 : 30, dataInicio, dataFim, ordem })

  const [cfg,           setCfg]           = useState({})
  const [modulos,       setModulos]       = useState({})
  const [topicos,       setTopicos]       = useState([])
  const [externas,      setExternas]      = useState([])
  const [proximoEvento, setProximoEvento] = useState(null)
  const [proximoOnibus, setProximoOnibus] = useState(null)
  const [plantao,       setPlantao]       = useState(null)
  const [portalContent,  setPortalContent] = useState({ weather:null, football:null, rssWorld:{items:[]}, horoscope:null })

  useEffect(() => {
    configuracoesService.listar().then(setCfg).catch(() => {})
    modulosService.listar().then(list => {
      const map = {}
      list.forEach(m => { map[m.chave] = m })
      setModulos(map)
    }).catch(() => {})
    topicosService.listar().then(setTopicos).catch(() => {})
    noticiasExternasService.listar().then(setExternas).catch(() => {})
    noticiasService.listar({ urgente: true, limit: 1 }).then(r => setPlantao(r.noticias?.[0] || null)).catch(() => {})
    portalContentService.home().then(setPortalContent).catch(() => {})

    eventosService.listar().then(evs => {
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
      const proximo = evs
        .filter(e => new Date(e.data) >= hoje)
        .sort((a, b) => new Date(a.data) - new Date(b.data))[0]
      if (proximo) setProximoEvento(proximo.data)
    }).catch(() => {})

    onibusService.listar().then(linhas => {
      if (!linhas.length) return
      const diasMap  = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']
      const diaAtual = diasMap[new Date().getDay()]
      const minAgora = new Date().getHours() * 60 + new Date().getMinutes()
      for (const linha of linhas) {
        const candidatos = (linha.horarios || [])
          .filter(h => h.dias?.includes(diaAtual))
          .map(h => {
            const [hh, mm] = h.hora.split(':').map(Number)
            return { hora: h.hora, min: hh * 60 + mm }
          })
          .filter(h => h.min >= minAgora)
          .sort((a, b) => a.min - b.min)
        if (candidatos.length) {
          setProximoOnibus(candidatos[0].hora)
          break
        }
      }
    }).catch(() => {})
  }, [])

  const noticiasUnicas = noticiasSemRepeticao(noticias)
  const destaques       = noticiasUnicas.filter(n => n.destaque)
  const destaqueImg     = destaques[0]?.imagem_url || noticiasUnicas[0]?.imagem_url || ''
  const emFiltro        = !!(modoTodas || catSlug || q || dataInicio || dataFim || (ordem && ordem !== 'recente'))
  const isAtivo         = chave => modulos[chave]?.ativo !== false

  // Na Home normal, uma matéria ocupa apenas uma posição editorial.
  // Capa e Plantão deixam de reaparecer em Últimas Notícias/Destaques.
  const capa = selecionarCapa(noticiasUnicas, cfg)
  const idsJaExibidos = new Set([
    noticiaId(plantao),
    noticiaId(capa.principal),
    ...capa.secundarios.map(noticiaId),
  ].filter(Boolean))
  const disponiveis = noticiasUnicas.filter(n => !idsJaExibidos.has(noticiaId(n)))
  const ultimas = disponiveis.slice(0, 8)
  const idsUltimas = new Set(ultimas.map(noticiaId))
  const destaquesRestantes = destaques.filter(n => !idsJaExibidos.has(noticiaId(n)) && !idsUltimas.has(noticiaId(n)))
  const idsDestaquesRestantes = new Set(destaquesRestantes.slice(0,3).map(noticiaId))
  const poolDepoisDestaques = disponiveis.filter(n => !idsUltimas.has(noticiaId(n)) && !idsDestaquesRestantes.has(noticiaId(n)))
  const maisLidas = [...poolDepoisDestaques].filter(n => (n.views || 0) > 0).sort((a,b) => (b.views || 0) - (a.views || 0)).slice(0,5)
  const idsMaisLidas = new Set(maisLidas.map(noticiaId))
  const categoriasDisponiveis = poolDepoisDestaques.filter(n => !idsMaisLidas.has(noticiaId(n)))

  function mudarParam(key, value) {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  function mudarPagina(p) {
    const next = new URLSearchParams(searchParams)
    if (p === 1) next.delete('page')
    else next.set('page', String(p))
    setSearchParams(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function mudarCategoria(slug) {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    if (slug) next.set('categoria', slug)
    else next.delete('categoria')
    setSearchParams(next)
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Exatamente três destaques em carrossel editorial */}
      {!emFiltro && isAtivo('hero') && !loading && <CapaJornalistica noticias={noticiasUnicas} cfg={cfg} />}

      {/* Plantão ganha destaque logo após a manchete, sem espaço quando não existe */}
      {!emFiltro && <Plantao noticia={plantao} />}

      {/* Atalhos locais — quatro itens na mesma linha no mobile */}
      {!emFiltro && isAtivo('topicos') && topicos.length > 0 && (
        <div className="py-3"><FaixaTopicos topicos={topicos.slice(0,4)} proximoEvento={proximoEvento} proximoOnibus={proximoOnibus} modulos={modulos}/></div>
      )}

      {/* Conteúdo */}
      <div className="wrap py-7 space-y-8">

        {/* Filtros ativos */}
        {(q || catSlug || dataInicio || dataFim) && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {catSlug && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-50
                                 text-brand-600 rounded-full text-sm font-grotesk font-bold">
                  <Tag size={13}/> {catSlug}
                </span>
              )}
              {q && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100
                                 text-gray-700 rounded-full text-sm font-grotesk font-bold">
                  <Search size={13}/> &ldquo;{q}&rdquo;
                </span>
              )}
              {dataInicio && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50
                                 text-purple-700 rounded-full text-sm font-grotesk font-bold">
                  De: {dataInicio}
                </span>
              )}
              {dataFim && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50
                                 text-purple-700 rounded-full text-sm font-grotesk font-bold">
                  Até: {dataFim}
                </span>
              )}
              <Link to="/" className="inline-flex items-center gap-1 text-sm font-grotesk font-semibold
                                      text-gray-400 hover:text-gray-600 transition-colors ml-auto">
                <X size={14}/> Limpar tudo
              </Link>
            </div>

            <div className="flex items-end gap-3 flex-wrap border-t border-gray-50 pt-3">
              <div>
                <label htmlFor="filtro-data-inicio" className="label text-xs font-grotesk">De</label>
                <input id="filtro-data-inicio" type="date"
                  value={dataInicio || ''}
                  onChange={e => mudarParam('dataInicio', e.target.value)}
                  className="input text-sm py-1.5 w-36"/>
              </div>
              <div>
                <label htmlFor="filtro-data-fim" className="label text-xs font-grotesk">Até</label>
                <input id="filtro-data-fim" type="date"
                  value={dataFim || ''}
                  onChange={e => mudarParam('dataFim', e.target.value)}
                  className="input text-sm py-1.5 w-36"/>
              </div>
              <div className="ml-auto">
                <label htmlFor="filtro-ordem" className="label text-xs font-grotesk">Ordenar por</label>
                <select id="filtro-ordem" value={ordem}
                  onChange={e => mudarParam('ordem', e.target.value === 'recente' ? '' : e.target.value)}
                  className="input text-sm py-1.5 w-44">
                  <option value="recente">Mais recentes</option>
                  <option value="antigo">Mais antigos</option>
                  {q && <option value="relevancia">Relevância</option>}
                </select>
              </div>
            </div>

            {!loading && (
              <p className="text-xs text-gray-400 font-grotesk font-medium pt-1">
                {total} resultado{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {loading && <HomeSkeleton/>}
        {error   && <ErrorMessage mensagem={error} onRetry={recarregar}/>}

        {!loading && !error && noticiasUnicas.length === 0 && (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">{q ? '🔍' : '📰'}</p>
            <p className="font-grotesk font-bold text-gray-500 text-lg">
              {q
                ? `Nenhuma notícia encontrada para "${q}".`
                : catSlug
                  ? `Nenhuma notícia em "${catSlug}".`
                  : 'Nenhuma notícia publicada ainda.'}
            </p>
            {emFiltro && <Link to="/" className="btn-primary mt-5 inline-flex">Ver todas</Link>}
          </div>
        )}

        {/* ── MODO FILTRO / BUSCA ── */}
        {!loading && !error && emFiltro && noticiasUnicas.length > 0 && (
          <section id="noticias">
            <div className="section-title mb-4">
              <h2 className="section-title-text font-grotesk">
                <Newspaper size={20} className="text-brand-500"/>
                {q ? `Resultados para "${q}"` : 'Notícias'}
              </h2>
            </div>
            <div className="mb-5">
              <AbasCategorias catAtual={catSlug} onMudar={mudarCategoria}/>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
              {noticiasUnicas.map((n, i) => (
                <div key={n._id || n.id} className="animate-slide-up" style={{ animationDelay: `${i * 30}ms` }}>
                  <NoticiaCardItem noticia={n}/>
                </div>
              ))}
            </div>
            <Paginacao pagina={page} paginas={paginas} onMudar={mudarPagina}/>
          </section>
        )}

        {/* ── MODO NORMAL ── */}
        {!loading && !error && !emFiltro && noticiasUnicas.length > 0 && (
          <>
            {isAtivo('ultimas_noticias') && (
              <section id="noticias">
                <div className="section-title mb-4">
                  <h2 className="section-title-text font-grotesk">
                    <Newspaper size={20} className="text-brand-500"/> Últimas Notícias
                  </h2>
                  <Link to="/?view=todas"
                    className="text-sm font-grotesk font-bold text-brand-500 hover:text-brand-600
                               flex items-center gap-1 transition-colors">
                    Ver todas <ArrowRight size={14}/>
                  </Link>
                </div>

                <div className="mb-5">
                  <AbasCategorias catAtual={catSlug} onMudar={mudarCategoria}/>
                </div>

                {ultimas.length > 0 ? (
                  <BlocoEditorialUltimas noticias={ultimas.slice(0, 5)} />
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-8 text-center">
                    <p className="font-grotesk text-sm text-gray-500">As notícias mais recentes já estão na capa acima.</p>
                  </div>
                )}
              </section>
            )}

            <WeatherBlock data={portalContent.weather}/>

            {isAtivo('noticias_externas') && ((portalContent.rssWorld?.items?.length || 0) > 0 || externas.length > 0) && (
              <NoticiasExternas items={portalContent.rssWorld?.items || []} fallback={externas}/>
            )}

            <FootballBlock data={portalContent.football}/>
            <HoroscopeBlock status={portalContent.horoscope}/>

            <MaisLidas noticias={maisLidas} />

            <BlocosPorCategoria noticias={categoriasDisponiveis} />

            {isAtivo('newsletter') && <NewsletterCTA/>}
          </>
        )}
      </div>
    </div>
  )
}
