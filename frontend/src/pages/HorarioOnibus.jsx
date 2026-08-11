import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bus, ArrowLeft, AlertCircle, Clock, MapPin, ArrowRight,
  WifiOff, Search, Phone, Globe2, Banknote, Timer, RefreshCw,
  Navigation, CalendarDays,
} from 'lucide-react'
import { onibusService } from '../services/api'
import LoadingSpinner from '../components/LoadingSpinner'

const DIAS_LABEL = { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', dom: 'Dom' }
const DIAS_LONGO = { seg: 'segunda', ter: 'terça', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sábado', dom: 'domingo' }
const TODOS_DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']
const DIA_IDX_MAP = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

function diaDaData(data) { return DIA_IDX_MAP[data.getDay()] }
function horaParaMinutos(hora = '') {
  const [h, m] = hora.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : -1
}
function formatarTempo(diffMin) {
  if (diffMin <= 0) return 'Partindo agora'
  if (diffMin < 60) return `Em ${diffMin} min`
  const h = Math.floor(diffMin / 60), m = diffMin % 60
  return m ? `Em ${h}h ${m}min` : `Em ${h}h`
}
function getPeriodo(hora) {
  const h = Number(hora?.split(':')[0] || 0)
  if (h < 12) return { label: 'Manhã', bg: '#FFFBEB', text: '#92400E', dot: '#FBBF24' }
  if (h < 18) return { label: 'Tarde', bg: '#EFF6FF', text: '#1E40AF', dot: '#60A5FA' }
  return { label: 'Noite', bg: '#EEF2FF', text: '#3730A3', dot: '#818CF8' }
}
function moeda(valor) {
  if (valor === null || valor === undefined || valor === '') return null
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function duracao(min) {
  if (!min) return null
  const h = Math.floor(min / 60), m = min % 60
  return [h ? `${h}h` : '', m ? `${m}min` : ''].filter(Boolean).join(' ')
}

function proximasPartidas(linha, agora, limite = 1) {
  const resultados = []
  const base = new Date(agora)
  base.setSeconds(0, 0)
  for (let offset = 0; offset < 7 && resultados.length < limite; offset++) {
    const data = new Date(base)
    data.setDate(base.getDate() + offset)
    const dia = diaDaData(data)
    const agoraMin = offset === 0 ? base.getHours() * 60 + base.getMinutes() : -1
    const horarios = (linha.horarios || [])
      .filter(h => h.dias?.includes(dia))
      .map(h => ({ ...h, minutos: horaParaMinutos(h.hora) }))
      .filter(h => h.minutos >= agoraMin)
      .sort((a, b) => a.minutos - b.minutos)

    for (const h of horarios) {
      const partida = new Date(data)
      partida.setHours(Math.floor(h.minutos / 60), h.minutos % 60, 0, 0)
      const diffMin = Math.max(0, Math.round((partida - base) / 60000))
      resultados.push({ ...h, data: partida, diffMin, offset })
      if (resultados.length >= limite) break
    }
  }
  return resultados
}

function horariosDeHoje(linha, agora) {
  const dia = diaDaData(agora)
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()
  return (linha.horarios || [])
    .filter(h => h.dias?.includes(dia))
    .map(h => ({ ...h, minutos: horaParaMinutos(h.hora) }))
    .sort((a, b) => a.minutos - b.minutos)
    .map(h => ({ ...h, passado: h.minutos < agoraMin }))
}

function ProximoOnibusCard({ linha, agora }) {
  const proximo = proximasPartidas(linha, agora, 1)[0]
  const cor = linha.cor || '#1B5E3B'
  if (!proximo) return (
    <div className="rounded-2xl p-4 flex items-center gap-3 text-sm font-semibold text-gray-400 bg-gray-50 border border-gray-100">
      <WifiOff size={17} /><span>Nenhuma partida programada nos próximos 7 dias.</span>
    </div>
  )
  const hoje = proximo.offset === 0
  const quando = hoje ? formatarTempo(proximo.diffMin) : proximo.offset === 1 ? 'Amanhã' : DIAS_LONGO[diaDaData(proximo.data)]
  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: `${cor}0D`, border: `1.5px solid ${cor}35` }}>
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${cor}18` }}>
          <Navigation size={20} style={{ color: cor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Próxima partida</p>
          <div className="flex items-baseline gap-2 mt-1 flex-wrap">
            <span className="font-black text-2xl leading-none" style={{ color: cor }}>{proximo.hora}</span>
            <span className="text-xs font-extrabold px-2.5 py-1 rounded-full text-white" style={{ background: cor }}>{quando}</span>
          </div>
          {proximo.observacao && <p className="text-xs text-gray-500 mt-2 flex gap-1.5"><AlertCircle size={13}/>{proximo.observacao}</p>}
        </div>
      </div>
    </div>
  )
}

function HorariosDia({ linha, agora }) {
  const hoje = horariosDeHoje(linha, agora)
  if (!hoje.length) return <p className="text-sm text-gray-400 text-center py-5">Nenhuma partida hoje nesta linha.</p>
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Horários de hoje</p>
        <span className="text-[11px] font-semibold text-gray-400">{hoje.filter(h => !h.passado).length} restantes</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {hoje.map((h, i) => {
          const per = getPeriodo(h.hora)
          return (
            <div key={`${h.hora}-${i}`} className="px-3 py-2 rounded-xl text-sm font-extrabold"
              title={h.observacao || undefined}
              style={{ background: h.passado ? '#F9FAFB' : per.bg, color: h.passado ? '#9CA3AF' : per.text, border: `1px solid ${h.passado ? '#F3F4F6' : `${per.dot}40`}`, opacity: h.passado ? .62 : 1 }}>
              <span className={h.passado ? 'line-through' : ''}>{h.hora}</span>
              {h.observacao && <AlertCircle size={11} className="inline ml-1.5" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TodosHorarios({ linha }) {
  const horarios = [...(linha.horarios || [])].sort((a,b) => horaParaMinutos(a.hora) - horaParaMinutos(b.hora))
  if (!horarios.length) return <p className="text-sm text-gray-400 text-center py-6">Nenhum horário cadastrado.</p>
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {horarios.map((h, idx) => {
        const per = getPeriodo(h.hora)
        const todos = TODOS_DIAS.every(d => h.dias?.includes(d))
        return (
          <div key={`${h.hora}-${idx}`} className="rounded-xl p-3.5 flex gap-3" style={{ background: per.bg, border: `1px solid ${per.dot}30` }}>
            <div className="w-14 flex-shrink-0"><p className="font-black text-xl leading-none" style={{ color: per.text }}>{h.hora}</p><p className="text-[10px] mt-1 font-bold" style={{ color: per.text }}>{per.label}</p></div>
            <div className="w-px self-stretch" style={{ background: `${per.dot}40` }} />
            <div className="flex-1 min-w-0">
              {todos ? <span className="text-[10px] font-extrabold px-2 py-1 rounded-full bg-green-100 text-green-700">Todos os dias</span> : (
                <div className="flex flex-wrap gap-1">{TODOS_DIAS.map(d => <span key={d} className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md ${h.dias?.includes(d) ? 'bg-gray-800 text-white' : 'bg-white/60 text-gray-300'}`}>{DIAS_LABEL[d]}</span>)}</div>
              )}
              {h.observacao && <p className="text-[11px] text-gray-500 mt-1.5 flex gap-1"><AlertCircle size={10}/>{h.observacao}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MetaLinha({ linha }) {
  const itens = [
    linha.embarque && { icon: MapPin, label: linha.embarque },
    linha.duracao_min && { icon: Timer, label: duracao(linha.duracao_min) },
    linha.tarifa !== null && linha.tarifa !== undefined && { icon: Banknote, label: moeda(linha.tarifa) },
  ].filter(Boolean)
  if (!itens.length && !linha.telefone && !linha.site && !linha.observacao) return null
  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      {itens.length > 0 && <div className="flex flex-wrap gap-2">{itens.map(({icon: Icon,label},i) => <span key={i} className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5"><Icon size={13}/>{label}</span>)}</div>}
      {(linha.telefone || linha.site) && <div className="flex flex-wrap gap-3 mt-3">
        {linha.telefone && <a href={`tel:${linha.telefone}`} className="text-xs font-bold text-brand-600 inline-flex gap-1.5 items-center"><Phone size={13}/> {linha.telefone}</a>}
        {linha.site && <a href={linha.site} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand-600 inline-flex gap-1.5 items-center"><Globe2 size={13}/> Site da empresa</a>}
      </div>}
      {linha.observacao && <p className="text-xs text-gray-500 mt-3 bg-amber-50 border border-amber-100 rounded-xl p-3"><strong className="text-amber-800">Atenção:</strong> {linha.observacao}</p>}
    </div>
  )
}

export default function HorarioOnibus() {
  const [linhas, setLinhas] = useState([])
  const [ativoId, setAtivoId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(false)
  const [agora, setAgora] = useState(new Date())
  const [abaView, setAbaView] = useState('hoje')
  const [busca, setBusca] = useState('')

  useEffect(() => { const id = setInterval(() => setAgora(new Date()), 30_000); return () => clearInterval(id) }, [])

  const carregar = useCallback(async () => {
    setLoading(true); setErro(false)
    try {
      const data = await onibusService.listar()
      const lista = Array.isArray(data) ? data : data?.linhas || []
      setLinhas(lista)
      setAtivoId(id => lista.some(l => (l.id || l._id) === id) ? id : (lista[0]?.id || lista[0]?._id || null))
    } catch { setErro(true) } finally { setLoading(false) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase('pt-BR')
    if (!q) return linhas
    return linhas.filter(l => [l.codigo,l.origem,l.destino,l.empresa].some(v => String(v || '').toLocaleLowerCase('pt-BR').includes(q)))
  }, [linhas, busca])

  const linha = linhas.find(l => (l.id || l._id) === ativoId) || linhas[0]
  const selecionarLinha = id => { setAtivoId(id); setAbaView('hoje') }

  return (
    <div className="wrap py-6 sm:py-8 max-w-4xl">
      <Link to="/" className="inline-flex items-center gap-2 text-gray-500 hover:text-brand-600 text-sm font-bold mb-6 transition-colors group"><ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform"/>Voltar para início</Link>

      <div className="flex items-start justify-between gap-4 mb-6 sm:mb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-brand-50 flex items-center justify-center"><Bus size={21} className="text-brand-500"/></div>
          <div><h1 className="font-display font-bold text-xl sm:text-2xl text-gray-900">Horários de Ônibus</h1><p className="text-sm text-gray-500 font-medium">Linhas, próximas partidas e informações da viagem</p></div>
        </div>
        {!loading && <button onClick={carregar} className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-brand-600 hover:border-brand-200" aria-label="Atualizar horários"><RefreshCw size={17}/></button>}
      </div>

      {loading && <LoadingSpinner texto="Carregando horários..." />}
      {!loading && erro && <div className="bg-white rounded-2xl border border-red-100 p-8 text-center"><AlertCircle size={36} className="text-red-300 mx-auto mb-3"/><p className="font-bold text-gray-700">Não foi possível carregar os horários.</p><button onClick={carregar} className="mt-4 px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-bold">Tentar novamente</button></div>}
      {!loading && !erro && linhas.length === 0 && <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center"><Bus size={44} className="text-gray-200 mx-auto mb-3"/><p className="text-gray-400 font-semibold">Nenhuma linha cadastrada ainda.</p></div>}

      {!loading && !erro && linhas.length > 0 && <div className="grid lg:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
        <aside className="bg-white border border-gray-100 rounded-2xl p-3 lg:sticky lg:top-24">
          {linhas.length > 5 && <div className="relative mb-2"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar linha..." className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-300"/></div>}
          <p className="px-2 pt-1 pb-2 text-[10px] font-black tracking-widest uppercase text-gray-400">Linhas</p>
          <div className="space-y-1 max-h-[58vh] overflow-y-auto">
            {filtradas.map(l => { const id=l.id||l._id, sel=id===(linha?.id||linha?._id), prox=proximasPartidas(l,agora,1)[0]; return <button key={id} onClick={()=>selecionarLinha(id)} className={`w-full text-left rounded-xl px-3 py-3 transition ${sel?'bg-brand-50':'hover:bg-gray-50'}`}>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{background:l.cor||'#1B5E3B'}}/><span className={`font-extrabold text-sm truncate ${sel?'text-brand-700':'text-gray-700'}`}>{l.destino}</span></div>
              <p className="text-[11px] text-gray-400 mt-1 pl-4 truncate">{l.codigo ? `${l.codigo} · ` : ''}{prox ? `Próx. ${prox.hora}` : 'Sem partida próxima'}</p>
            </button> })}
            {filtradas.length===0 && <p className="text-xs text-gray-400 p-3 text-center">Nenhuma linha encontrada.</p>}
          </div>
        </aside>

        {linha && <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 sm:p-5 bg-gray-50 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:`${linha.cor||'#1B5E3B'}18`}}><Bus size={20} style={{color:linha.cor||'#1B5E3B'}}/></div>
              <div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><h2 className="font-black text-gray-900">{linha.origem||'Iguatama'} <ArrowRight size={13} className="inline"/> {linha.destino}</h2>{linha.codigo && <span className="text-[10px] font-black bg-white border border-gray-200 px-2 py-1 rounded-lg text-gray-500">{linha.codigo}</span>}</div>{linha.empresa && <p className="text-xs text-gray-500 mt-1">{linha.empresa}</p>}{linha.descricao && <p className="text-xs text-gray-500 mt-2 leading-relaxed">{linha.descricao}</p>}</div>
            </div>
          </div>

          <div className="p-4 sm:p-5"><ProximoOnibusCard linha={linha} agora={agora}/>
            <div className="mt-4 flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">{[{key:'hoje',label:'Hoje',icon:Clock},{key:'todos',label:'Semana',icon:CalendarDays}].map(({key,label,icon:Icon})=><button key={key} onClick={()=>setAbaView(key)} className={`px-3.5 py-2 rounded-lg text-sm font-bold transition flex items-center gap-1.5 ${abaView===key?'bg-white shadow-sm text-gray-900':'text-gray-500'}`}><Icon size={14}/>{label}</button>)}</div>
            <div className="mt-4">{abaView==='hoje'?<HorariosDia linha={linha} agora={agora}/>:<TodosHorarios linha={linha}/>}</div>
            <MetaLinha linha={linha}/>
            <p className="text-[11px] text-gray-400 mt-5 text-center font-medium flex items-center justify-center gap-1"><AlertCircle size={10}/>Horários podem sofrer alterações. Confirme com a empresa quando necessário.</p>
          </div>
        </section>}
      </div>}
    </div>
  )
}
