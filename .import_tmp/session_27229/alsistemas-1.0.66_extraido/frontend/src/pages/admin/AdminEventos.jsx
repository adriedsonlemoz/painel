import { useMemo, useState } from 'react'
import { T as C, SPACE, RADIUS, FONT } from '../../themes/tokens'
import { Calendar, CheckCircle2, Clock, Edit2, Eye, EyeOff, MapPin, Plus, Save, Tag, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import ConfirmModal from '../../components/ConfirmModal'
import { useEventos } from '../../hooks/useEventos'

const CORES = ['#1B5E3B','#1565C0','#C62828','#6A1B9A','#E65100','#F57F17','#00695C','#E91E63']
const TIPO_ENTRADA_LABELS = { gratuito: 'Gratuito', pago: 'Pago', doacoes: 'Aceita doações' }

function tipoEntradaCor(tipo) {
  return tipo === 'pago' ? C.red : tipo === 'doacoes' ? C.amber : C.greenDk
}

function toInputDate(dataStr) {
  if (!dataStr) return ''
  const d = new Date(dataStr)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatarDataBR(dataStr) {
  const d = new Date(dataStr)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '')
}

function EventoForm({ evento, onSave, onCancel }) {
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState(evento ? {
    titulo: evento.titulo || '', descricao: evento.descricao || '', data: toInputDate(evento.data),
    horario: evento.horario || '', local: evento.local || '', cor: evento.cor || '#1B5E3B',
    ativo: evento.ativo !== false, tipoEntrada: evento.tipoEntrada || 'gratuito',
  } : {
    titulo: '', descricao: '', data: '', horario: '', local: '', cor: '#1B5E3B', ativo: true, tipoEntrada: 'gratuito',
  })

  function atualizar(campo, valor) { setForm(f => ({ ...f, [campo]: valor })) }

  async function handleSave(e) {
    e.preventDefault()
    if (form.titulo.trim().length < 3) return toast.error('Informe um título com pelo menos 3 caracteres')
    if (!form.data) return toast.error('Informe a data do evento')
    try {
      setSalvando(true)
      await onSave({ ...form, titulo: form.titulo.trim(), data: new Date(`${form.data}T12:00:00`) })
    } finally { setSalvando(false) }
  }

  return (
    <form className="adm-card" style={{ padding: 24 }} onSubmit={handleSave}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', marginBottom:24 }}>
        <div><h3 style={{ margin:0, color:'var(--adm-text)', fontSize:FONT.xl, fontWeight:800 }}>{evento ? 'Editar evento' : 'Novo evento'}</h3><p style={{ margin:'5px 0 0', color:'var(--adm-muted)', fontSize:FONT.md }}>Preencha os dados que serão exibidos na agenda pública.</p></div>
        <button type="button" onClick={onCancel} className="adm-btn adm-btn-ghost adm-btn-icon" aria-label="Fechar"><X size={18}/></button>
      </div>

      <div style={{ display:'grid', gap:SPACE.xl3 }} className="adm-evento-grid">
        <div style={{ display:'flex', flexDirection:'column', gap:SPACE.xl }}>
          <div className="adm-field"><label className="adm-label">Título *</label><input className="adm-input" value={form.titulo} maxLength={140} placeholder="Ex.: Festival de Inverno" onChange={e => atualizar('titulo', e.target.value)} /></div>
          <div className="adm-field"><label className="adm-label">Descrição</label><textarea className="adm-input" rows={6} maxLength={3000} value={form.descricao} placeholder="Conte o que vai acontecer, atrações e informações importantes..." onChange={e => atualizar('descricao', e.target.value)} style={{ resize:'vertical' }}/><div style={{ marginTop:5, textAlign:'right', fontSize:FONT.sm, color:'var(--adm-muted)' }}>{form.descricao.length}/3000</div></div>
          <div className="adm-field"><label className="adm-label"><MapPin size={13}/> Local</label><input className="adm-input" value={form.local} maxLength={180} placeholder="Praça, endereço ou espaço do evento" onChange={e => atualizar('local', e.target.value)} /></div>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:SPACE.xl }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:SPACE.lg }}>
            <div className="adm-field"><label className="adm-label"><Calendar size={13}/> Data *</label><input type="date" className="adm-input" value={form.data} onChange={e => atualizar('data', e.target.value)} /></div>
            <div className="adm-field"><label className="adm-label"><Clock size={13}/> Horário</label><input type="time" className="adm-input" value={form.horario} onChange={e => atualizar('horario', e.target.value)} /></div>
          </div>

          <div className="adm-field"><label className="adm-label"><Tag size={13}/> Tipo de entrada</label><div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:8 }}>{Object.entries(TIPO_ENTRADA_LABELS).map(([key,label]) => { const ativo=form.tipoEntrada===key; const cor=tipoEntradaCor(key); return <button key={key} type="button" onClick={() => atualizar('tipoEntrada',key)} style={{ padding:'7px 12px', borderRadius:RADIUS.pill, border:`1px solid ${ativo?cor:'var(--adm-border)'}`, background:ativo?`${cor}18`:'var(--adm-surface2)', color:ativo?cor:'var(--adm-muted)', fontWeight:700, cursor:'pointer' }}>{label}</button> })}</div></div>

          <div className="adm-field"><label className="adm-label">Cor de identificação</label><div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:8 }}>{CORES.map(c => <button type="button" key={c} onClick={() => atualizar('cor',c)} aria-label={`Selecionar cor ${c}`} style={{ width:30,height:30,borderRadius:'50%',background:c,border:'3px solid var(--adm-surface)',boxShadow:form.cor===c?'0 0 0 2px var(--adm-accent)':'0 0 0 1px var(--adm-border)',cursor:'pointer' }}/>)}</div></div>

          <button type="button" onClick={() => atualizar('ativo', !form.ativo)} style={{ display:'flex', alignItems:'center', gap:12, width:'100%', padding:14, border:'1px solid var(--adm-border)', borderRadius:RADIUS.xl, background:'var(--adm-surface2)', color:'var(--adm-text)', cursor:'pointer', textAlign:'left' }}>
            <span style={{ width:38,height:22,borderRadius:20,padding:3,display:'flex',justifyContent:form.ativo?'flex-end':'flex-start',background:form.ativo?'var(--adm-accent)':'var(--adm-border2)' }}><span style={{ width:16,height:16,borderRadius:'50%',background:'#fff' }}/></span>
            <span><strong style={{ display:'block', fontSize:FONT.md }}>{form.ativo ? 'Publicado na agenda' : 'Oculto da agenda'}</strong><small style={{ color:'var(--adm-muted)' }}>{form.ativo ? 'Visitantes podem visualizar este evento.' : 'O evento permanece salvo apenas no painel.'}</small></span>
          </button>

          <div style={{ padding:16, border:'1px solid var(--adm-border)', borderRadius:RADIUS.xl, background:'var(--adm-surface2)' }}>
            <div style={{ fontSize:FONT.sm, color:'var(--adm-muted)', fontWeight:800, textTransform:'uppercase', letterSpacing:.8, marginBottom:10 }}>Prévia</div>
            <div style={{ display:'flex', gap:12, alignItems:'stretch' }}><div style={{ width:4,borderRadius:RADIUS.full,background:form.cor }}/><div style={{ minWidth:0 }}><strong style={{ display:'block', color:'var(--adm-text)', fontSize:FONT.lg }}>{form.titulo || 'Título do evento'}</strong><div style={{ display:'flex',gap:8,flexWrap:'wrap',marginTop:6,fontSize:FONT.base,color:'var(--adm-muted)' }}>{form.data && <span>{formatarDataBR(`${form.data}T12:00:00`)}</span>}{form.horario && <span>• {form.horario}</span>}<span>• {TIPO_ENTRADA_LABELS[form.tipoEntrada]}</span></div></div></div>
          </div>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:24, paddingTop:20, borderTop:'1px solid var(--adm-border)' }}><button className="adm-btn adm-btn-primary" type="submit" disabled={salvando}><Save size={15} style={{ marginRight:6 }}/>{salvando?'Salvando...':'Salvar evento'}</button><button className="adm-btn adm-btn-secondary" type="button" onClick={onCancel}>Cancelar</button></div>
      <style>{`@media (min-width: 860px){.adm-evento-grid{grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr)!important}.adm-label{display:flex;align-items:center;gap:6px}}`}</style>
    </form>
  )
}

function EventoItem({ evento, passado, onEdit, onDelete }) {
  const data = new Date(evento.data)
  const cor = evento.cor || '#1B5E3B'
  return (
    <div style={{ display:'flex', alignItems:'stretch', overflow:'hidden', marginBottom:10, border:'1px solid var(--adm-border)', borderRadius:RADIUS.xl, background:'var(--adm-surface2)', opacity:passado?.72:1 }}>
      <div style={{ width:66, flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', borderRight:`3px solid ${cor}`, background:`${cor}12` }}><strong style={{ fontSize:22,lineHeight:1,color:'var(--adm-text)' }}>{data.getDate()}</strong><span style={{ marginTop:3,fontSize:10,fontWeight:800,textTransform:'uppercase',color:'var(--adm-muted)' }}>{data.toLocaleDateString('pt-BR',{month:'short'}).replace('.','')}</span></div>
      <div style={{ minWidth:0, flex:1, padding:'11px 14px' }}><div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' }}><strong style={{ color:'var(--adm-text)',fontSize:FONT.lg }}>{evento.titulo}</strong><span style={{ display:'inline-flex',alignItems:'center',gap:4,padding:'2px 7px',borderRadius:RADIUS.pill,fontSize:FONT.sm,fontWeight:800,color:evento.ativo?C.greenDk:'var(--adm-muted)',background:evento.ativo?C.greenBg:'var(--adm-surface)' }}>{evento.ativo?<Eye size={11}/>:<EyeOff size={11}/>} {evento.ativo?'Publicado':'Oculto'}</span></div><div style={{ display:'flex',gap:10,flexWrap:'wrap',marginTop:5,fontSize:FONT.base,color:'var(--adm-muted)' }}>{evento.horario&&<span style={{display:'flex',gap:4,alignItems:'center'}}><Clock size={11}/>{evento.horario}</span>}{evento.local&&<span style={{display:'flex',gap:4,alignItems:'center'}}><MapPin size={11}/>{evento.local}</span>}<span style={{color:tipoEntradaCor(evento.tipoEntrada||'gratuito'),fontWeight:700}}>{TIPO_ENTRADA_LABELS[evento.tipoEntrada||'gratuito']}</span></div></div>
      <div style={{ display:'flex',gap:4,alignItems:'center',padding:'0 10px' }}><button onClick={onEdit} className="adm-btn adm-btn-ghost adm-btn-icon adm-btn-sm" aria-label="Editar"><Edit2 size={15}/></button><button onClick={onDelete} className="adm-btn adm-btn-danger adm-btn-icon adm-btn-sm" aria-label="Excluir"><Trash2 size={15}/></button></div>
    </div>
  )
}

export default function AdminEventos() {
  const { loading, futuros, passados, salvarEvento, excluirEvento } = useEventos()
  const [editando, setEditando] = useState(null)
  const [editEvento, setEditEvento] = useState(null)
  const [confirm, setConfirm] = useState({ aberto:false,id:null,carregando:false })

  const stats = useMemo(() => ({ proximos:futuros.length, passados:passados.length, publicados:[...futuros,...passados].filter(e=>e.ativo!==false).length }), [futuros,passados])

  async function salvar(form) { try { await salvarEvento(editando,form); setEditando(null);setEditEvento(null) } catch(err){ toast.error(err.message||'Erro ao salvar evento'); throw err } }
  async function confirmarExclusao(){ setConfirm(c=>({...c,carregando:true})); try{ await excluirEvento(confirm.id);setConfirm({aberto:false,id:null,carregando:false}) }catch{toast.error('Erro ao excluir evento');setConfirm(c=>({...c,carregando:false}))} }
  function editar(ev){setEditEvento(ev);setEditando(ev.id||ev._id)}

  return <>
    <ConfirmModal aberto={confirm.aberto} titulo="Excluir evento?" mensagem="Essa ação é permanente e não pode ser desfeita." labelConfirmar="Excluir" carregando={confirm.carregando} onConfirmar={confirmarExclusao} onCancelar={()=>setConfirm({aberto:false,id:null,carregando:false})}/>
    <div className="adm-page-header"><div><div className="adm-page-title">Agenda de Eventos</div><div className="adm-page-sub">Gerencie a programação exibida no portal</div></div>{!editando&&<div className="adm-page-actions"><button className="adm-btn adm-btn-primary" onClick={()=>{setEditando('novo');setEditEvento(null)}}><Plus size={16} style={{marginRight:6}}/>Novo evento</button></div>}</div>

    {editando ? <EventoForm evento={editEvento} onSave={salvar} onCancel={()=>{setEditando(null);setEditEvento(null)}}/> : <>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:16 }}>
        {[['Próximos',stats.proximos,Calendar],['Publicados',stats.publicados,CheckCircle2],['Passados',stats.passados,Clock]].map(([label,value,Icon])=><div key={label} className="adm-card" style={{padding:16,display:'flex',alignItems:'center',gap:12}}><div style={{width:36,height:36,borderRadius:RADIUS.lg,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--adm-surface2)',color:'var(--adm-accent)'}}><Icon size={18}/></div><div><strong style={{display:'block',fontSize:20,color:'var(--adm-text)'}}>{value}</strong><span style={{fontSize:FONT.base,color:'var(--adm-muted)'}}>{label}</span></div></div>)}
      </div>
      <div className="adm-card" style={{padding:0,overflow:'hidden'}}>{loading?<div className="adm-empty"><div className="adm-spin"/><p style={{marginTop:14,color:'var(--adm-muted)'}}>Carregando eventos...</p></div>:<div style={{padding:20}}>
        {futuros.length>0&&<section style={{marginBottom:24}}><h3 style={{fontSize:FONT.base,fontWeight:800,color:'var(--adm-muted)',textTransform:'uppercase',letterSpacing:1,margin:'0 0 12px'}}>Próximos eventos ({futuros.length})</h3>{futuros.map(ev=><EventoItem key={ev.id||ev._id} evento={ev} onEdit={()=>editar(ev)} onDelete={()=>setConfirm({aberto:true,id:ev.id||ev._id,carregando:false})}/>)}</section>}
        {passados.length>0&&<section><h3 style={{fontSize:FONT.base,fontWeight:800,color:'var(--adm-muted)',textTransform:'uppercase',letterSpacing:1,margin:'0 0 12px'}}>Eventos passados ({passados.length})</h3>{passados.map(ev=><EventoItem key={ev.id||ev._id} evento={ev} passado onEdit={()=>editar(ev)} onDelete={()=>setConfirm({aberto:true,id:ev.id||ev._id,carregando:false})}/>)}</section>}
        {!futuros.length&&!passados.length&&<div className="adm-empty"><Calendar size={34} style={{opacity:.2,marginBottom:14}}/><p style={{color:'var(--adm-muted)'}}>Nenhum evento cadastrado.</p><button className="adm-btn adm-btn-primary adm-btn-sm" style={{marginTop:14}} onClick={()=>{setEditando('novo');setEditEvento(null)}}><Plus size={14} style={{marginRight:5}}/>Criar primeiro evento</button></div>}
      </div>}</div>
    </>}
  </>
}
