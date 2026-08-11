import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, ArrowLeft, CalendarDays, ChevronRight, Clock,
  DollarSign, Heart, MapPin, RefreshCw, Ticket, X,
} from 'lucide-react'
import { eventosService } from '../services/api'
import LoadingSpinner from '../components/LoadingSpinner'

const ENTRADA_CONFIG = {
  gratuito: { label: 'Gratuito', Icon: Ticket },
  pago: { label: 'Pago', Icon: DollarSign },
  doacoes: { label: 'Aceita doações', Icon: Heart },
}

function dataEvento(valor) {
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatarDataEvento(valor) {
  const d = dataEvento(valor)
  if (!d) return ''
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })
}

function formatarMesAno(valor) {
  const d = dataEvento(valor)
  if (!d) return ''
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function mesKey(valor) {
  const d = dataEvento(valor)
  if (!d) return 'sem-data'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function tempoRestante(valor) {
  const data = dataEvento(valor)
  if (!data) return null
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  data.setHours(0, 0, 0, 0)
  const diff = Math.round((data - hoje) / 86400000)
  if (diff < 0) return null
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Amanhã'
  if (diff < 7) return `Em ${diff} dias`
  if (diff < 14) return 'Em 1 semana'
  if (diff < 35) return `Em ${Math.round(diff / 7)} semanas`
  const meses = Math.round(diff / 30)
  return `Em ${meses} ${meses === 1 ? 'mês' : 'meses'}`
}

function corEvento(cor) {
  return /^#[0-9a-f]{6}$/i.test(cor || '') ? cor : '#1B5E3B'
}

function BadgeEntrada({ tipo }) {
  const cfg = ENTRADA_CONFIG[tipo] || ENTRADA_CONFIG.gratuito
  const { Icon } = cfg
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
      <Icon size={11} strokeWidth={2.4} /> {cfg.label}
    </span>
  )
}

function EventoModal({ evento, onClose }) {
  const cor = corEvento(evento.cor)
  const data = dataEvento(evento.data)
  const badge = tempoRestante(evento.data)

  useEffect(() => {
    const fecharEsc = e => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', fecharEsc)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', fecharEsc)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-xl sm:rounded-3xl">
        <div className="h-1.5 flex-shrink-0" style={{ backgroundColor: cor }} />
        {evento.imagem_url && <img src={evento.imagem_url} alt={evento.imagem_alt || evento.titulo} className="h-44 w-full flex-shrink-0 object-cover sm:h-52" />}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-2xl bg-gray-50">
              <strong className="text-2xl font-black leading-none text-gray-900">{data?.getDate()}</strong>
              <span className="mt-1 text-[10px] font-black uppercase tracking-wide text-gray-400">
                {data?.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
              </span>
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-bold capitalize text-brand-500">{formatarDataEvento(evento.data)}</p>
              <h2 className="font-display text-xl font-bold leading-tight text-gray-900">{evento.titulo}</h2>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Fechar detalhes">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          <div className="flex flex-wrap gap-2">
            {badge && <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-extrabold text-brand-600">{badge}</span>}
            <BadgeEntrada tipo={evento.tipoEntrada} />
          </div>

          {(evento.horario || evento.local) && (
            <div className="mt-5 grid gap-2 rounded-2xl border border-gray-100 bg-gray-50/70 p-4 sm:grid-cols-2">
              {evento.horario && <div className="flex items-center gap-2 text-sm font-semibold text-gray-700"><Clock size={15} className="text-brand-500" /> {evento.horario}</div>}
              {evento.local && <div className="flex items-start gap-2 text-sm font-semibold text-gray-700"><MapPin size={15} className="mt-0.5 flex-shrink-0 text-brand-500" /> {evento.local}</div>}
            </div>
          )}

          {evento.descricao && <p className="mt-5 whitespace-pre-line text-sm leading-7 text-gray-600">{evento.descricao}</p>}
          {(evento.endereco || evento.organizador || evento.preco != null || evento.site || evento.ingresso_url || evento.telefone) && <div className="mt-5 grid gap-2 rounded-2xl border border-gray-100 p-4 text-sm text-gray-600">
            {evento.endereco && <div><b>Endereço:</b> {evento.endereco}</div>}
            {evento.organizador && <div><b>Organizador:</b> {evento.organizador}</div>}
            {evento.telefone && <div><b>Contato:</b> {evento.telefone}</div>}
            {evento.preco != null && <div><b>Preço:</b> {Number(evento.preco)===0?'Gratuito':Number(evento.preco).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</div>}
            <div className="flex flex-wrap gap-2 pt-1">{evento.mapa_url&&<a href={evento.mapa_url} target="_blank" rel="noreferrer" className="btn-secondary text-xs">Ver mapa</a>}{evento.site&&<a href={evento.site} target="_blank" rel="noreferrer" className="btn-secondary text-xs">Site</a>}{evento.ingresso_url&&<a href={evento.ingresso_url} target="_blank" rel="noreferrer" className="btn-brand text-xs">Ingressos</a>}</div>
          </div>}

          <div className="mt-6 flex items-start gap-2 border-t border-gray-100 pt-4 text-xs text-gray-400">
            <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
            <span>Programação sujeita a alteração. Confirme os detalhes com os organizadores.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function EventoCard({ evento, onOpen, destaque = false }) {
  const data = dataEvento(evento.data)
  const cor = corEvento(evento.cor)
  const badge = tempoRestante(evento.data)

  return (
    <button
      onClick={() => onOpen(evento)}
      className={`group w-full overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-1 ring-gray-100 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-gray-200 ${destaque ? 'sm:rounded-3xl' : ''}`}
    >
      <div className="flex min-h-[112px] items-stretch">
        <div className="w-1.5 flex-shrink-0" style={{ backgroundColor: cor }} />
        <div className="flex w-[70px] flex-shrink-0 flex-col items-center justify-center border-r border-gray-100 px-3 text-center sm:w-[82px]">
          <strong className={`${destaque ? 'text-3xl' : 'text-2xl'} font-black leading-none text-gray-900`}>{data?.getDate()}</strong>
          <span className="mt-1 text-[11px] font-black uppercase tracking-wider text-gray-400">{data?.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</span>
        </div>
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {badge && <span className="mb-1.5 inline-block text-[11px] font-extrabold text-brand-500">{badge}</span>}
              <h3 className={`${destaque ? 'text-lg sm:text-xl' : 'text-base'} font-display font-bold leading-snug text-gray-900 transition-colors group-hover:text-brand-500`}>{evento.titulo}</h3>
            </div>
            <ChevronRight size={18} className="mt-1 flex-shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" />
          </div>
          {evento.descricao && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-500">{evento.descricao}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold text-gray-400">
            {evento.horario && <span className="flex items-center gap-1"><Clock size={12} /> {evento.horario}</span>}
            {evento.local && <span className="flex max-w-full items-center gap-1"><MapPin size={12} className="flex-shrink-0" /><span className="truncate">{evento.local}</span></span>}
            <BadgeEntrada tipo={evento.tipoEntrada} />
          </div>
        </div>
      </div>
    </button>
  )
}

export default function Eventos() {
  const [eventos, setEventos] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [modalEvento, setModalEvento] = useState(null)

  const carregar = useCallback(async () => {
    try {
      setLoading(true)
      setErro('')
      const dados = await eventosService.listar()
      setEventos(Array.isArray(dados) ? dados : (dados?.eventos || []))
    } catch (err) {
      setErro(err?.message || 'Não foi possível carregar a agenda agora.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    if (!eventos.length) return undefined
    const script=document.createElement('script');script.type='application/ld+json';script.id='eventos-jsonld'
    script.textContent=JSON.stringify({'@context':'https://schema.org','@graph':eventos.slice(0,50).map(e=>({'@type':'Event',name:e.titulo,description:e.descricao||undefined,startDate:`${String(e.data||'').slice(0,10)}${e.horario?`T${e.horario}:00`:''}`,endDate:e.horario_fim?`${String(e.data||'').slice(0,10)}T${e.horario_fim}:00`:undefined,eventStatus:'https://schema.org/EventScheduled',eventAttendanceMode:'https://schema.org/OfflineEventAttendanceMode',location:e.local||e.endereco?{'@type':'Place',name:e.local||e.endereco,address:e.endereco||e.local}:undefined,image:e.imagem_url?[e.imagem_url]:undefined,organizer:e.organizador?{'@type':'Organization',name:e.organizador,url:e.site||undefined}:undefined,offers:e.ingresso_url||e.preco!=null?{'@type':'Offer',url:e.ingresso_url||e.site||undefined,price:e.preco??0,priceCurrency:'BRL'}:undefined}))})
    document.head.appendChild(script);return()=>script.remove()
  }, [eventos])

  const grupos = useMemo(() => {
    return eventos.reduce((acc, evento) => {
      const chave = mesKey(evento.data)
      if (!acc[chave]) acc[chave] = { label: formatarMesAno(evento.data), items: [] }
      acc[chave].items.push(evento)
      return acc
    }, {})
  }, [eventos])

  return (
    <>
      {modalEvento && <EventoModal evento={modalEvento} onClose={() => setModalEvento(null)} />}

      <main className="wrap py-6 sm:py-8">
        <Link to="/" className="group mb-6 inline-flex items-center gap-2 text-sm font-bold text-gray-500 transition-colors hover:text-brand-500">
          <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-0.5" /> Voltar para início
        </Link>

        <section className="mb-8 overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
          <div className="p-5 sm:p-7">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
                <CalendarDays size={23} strokeWidth={1.8} />
              </div>
              <div>
                <p className="font-grotesk text-xs font-black uppercase tracking-widest text-brand-500">Agenda local</p>
                <h1 className="font-display text-xl font-bold text-gray-900 sm:text-2xl">Eventos em Iguatama e região</h1>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-gray-500">Confira festas, encontros, atividades e programações da cidade em uma agenda simples e atualizada.</p>
            {!loading && !erro && eventos.length > 0 && <p className="mt-4 text-xs font-bold text-gray-400">{eventos.length} {eventos.length === 1 ? 'evento programado' : 'eventos programados'}</p>}
          </div>
        </section>

        {loading && <LoadingSpinner texto="Carregando eventos..." />}

        {!loading && erro && (
          <div className="rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
            <AlertCircle size={34} className="mx-auto mb-3 text-red-400" />
            <p className="font-bold text-gray-800">Não foi possível carregar a agenda.</p>
            <p className="mt-1 text-sm text-gray-500">{erro}</p>
            <button onClick={carregar} className="btn-brand mx-auto mt-5"><RefreshCw size={15} /> Tentar novamente</button>
          </div>
        )}

        {!loading && !erro && eventos.length === 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
            <CalendarDays size={42} className="mx-auto mb-3 text-gray-200" />
            <p className="font-display font-bold text-gray-800">Nenhum evento programado</p>
            <p className="mt-1 text-sm text-gray-400">Quando houver novidades na agenda, elas aparecerão aqui.</p>
          </div>
        )}

        {!loading && !erro && eventos.length > 0 && (
          <div className="space-y-9">
            {Object.entries(grupos).map(([, grupo], grupoIndex) => (
              <section key={`${grupo.label}-${grupoIndex}`}>
                <div className="section-title mb-4">
                  <h2 className="section-title-text capitalize"><CalendarDays size={18} className="text-brand-500" /> {grupo.label}</h2>
                  <span className="text-xs font-bold text-gray-400">{grupo.items.length} {grupo.items.length === 1 ? 'evento' : 'eventos'}</span>
                </div>
                <div className="space-y-3">
                  {grupo.items.map((evento, index) => <EventoCard key={evento.id || evento._id} evento={evento} onOpen={setModalEvento} destaque={grupoIndex === 0 && index === 0} />)}
                </div>
              </section>
            ))}
            <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[11px] font-medium text-gray-400"><AlertCircle size={11} /> Programação sujeita a alteração.</p>
          </div>
        )}
      </main>
    </>
  )
}
