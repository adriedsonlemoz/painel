import { useEffect, useMemo, useState } from 'react'
import { Bus, Plus, Trash2, Edit2, Save, X, PlusCircle, Clock, Copy, Search, Power, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { onibusService } from '../../services/api'
import ConfirmModal from '../../components/ConfirmModal'
import { SPACE, RADIUS, FONT } from '../../themes/tokens'
import { DSModal } from '../../components/admin/ui/DS'

const TODOS_DIAS = ['seg','ter','qua','qui','sex','sab','dom']
const DIAS_LABEL = { seg:'Seg',ter:'Ter',qua:'Qua',qui:'Qui',sex:'Sex',sab:'Sáb',dom:'Dom' }
const CORES = ['#1B5E3B','#1565C0','#C62828','#6A1B9A','#E65100','#F57F17','#00695C','#2E7D32']
const PRESETS = [
  { label:'Dias úteis', dias:['seg','ter','qua','qui','sex'] },
  { label:'Fim de semana', dias:['sab','dom'] },
  { label:'Todos', dias:TODOS_DIAS },
]
const vazio = { codigo:'', destino:'', origem:'Iguatama', empresa:'', descricao:'', embarque:'', telefone:'', site:'', tarifa:'', duracao_min:'', observacao:'', cor:'#1B5E3B', ativo:true, ordem:0, horarios:[] }

function HorarioForm({ horario, onChange, onRemove, onDuplicate }) {
  return <div style={{background:'var(--adm-surface2)',border:'1px solid var(--adm-border)',borderRadius:RADIUS.lg,padding:14}}>
    <div style={{display:'flex',alignItems:'end',gap:SPACE.md,flexWrap:'wrap'}}>
      <div><label className="adm-label">Horário *</label><input type="time" value={horario.hora} onChange={e=>onChange({...horario,hora:e.target.value})} className="adm-input" style={{width:140}}/></div>
      <div style={{display:'flex',gap:6,marginLeft:'auto'}}><button type="button" onClick={onDuplicate} className="adm-btn adm-btn-ghost adm-btn-icon adm-btn-sm" title="Duplicar horário"><Copy size={14}/></button><button type="button" onClick={onRemove} className="adm-btn adm-btn-ghost adm-btn-icon adm-btn-sm" style={{color:'var(--adm-red)'}} title="Remover"><Trash2 size={15}/></button></div>
    </div>
    <div style={{marginTop:12}}><label className="adm-label">Dias da semana</label><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{TODOS_DIAS.map(d=><button key={d} type="button" onClick={()=>onChange({...horario,dias:horario.dias?.includes(d)?horario.dias.filter(x=>x!==d):[...(horario.dias||[]),d]})} style={{padding:'5px 9px',borderRadius:RADIUS.sm,fontSize:FONT.sm,fontWeight:800,border:'1px solid',borderColor:horario.dias?.includes(d)?'var(--adm-accent)':'var(--adm-border)',background:horario.dias?.includes(d)?'var(--adm-accent)':'transparent',color:horario.dias?.includes(d)?'#000':'var(--adm-muted)',cursor:'pointer'}}>{DIAS_LABEL[d]}</button>)}</div></div>
    <div style={{marginTop:10}}><label className="adm-label">Observação deste horário</label><input value={horario.observacao||''} onChange={e=>onChange({...horario,observacao:e.target.value})} placeholder="Ex: Via Divinópolis" maxLength={180} className="adm-input"/></div>
  </div>
}

function LinhaForm({ linha, onSave, onCancel }) {
  const [form,setForm]=useState(()=>({...vazio,...(linha||{}),tarifa:linha?.tarifa??'',duracao_min:linha?.duracao_min??''}))
  const [salvando,setSalvando]=useState(false)
  const set = (campo,valor)=>setForm(f=>({...f,[campo]:valor}))
  const addHorario = ()=>setForm(f=>({...f,horarios:[...(f.horarios||[]),{hora:'07:00',dias:['seg','ter','qua','qui','sex'],observacao:''}]}))
  const updateHorario=(i,h)=>setForm(f=>({...f,horarios:f.horarios.map((x,idx)=>idx===i?h:x)}))
  const removeHorario=i=>setForm(f=>({...f,horarios:f.horarios.filter((_,idx)=>idx!==i)}))
  const duplicarHorario=i=>setForm(f=>{const arr=[...f.horarios];arr.splice(i+1,0,{...arr[i]});return {...f,horarios:arr}})
  const aplicarPreset=dias=>setForm(f=>({...f,horarios:(f.horarios||[]).map(h=>({...h,dias:[...dias]}))}))

  async function handleSave(){
    if(!form.destino.trim()) return toast.error('Informe o destino')
    if((form.horarios||[]).some(h=>!h.hora||!h.dias?.length)) return toast.error('Revise os horários e os dias da semana')
    const usados=new Set()
    for(const h of form.horarios||[]) for(const d of h.dias){ const k=`${d}:${h.hora}`; if(usados.has(k)) return toast.error(`Horário ${h.hora} duplicado em ${DIAS_LABEL[d]}`); usados.add(k) }
    const payload={...form,tarifa:form.tarifa===''?null:Number(form.tarifa),duracao_min:form.duracao_min===''?null:Number(form.duracao_min),ordem:Number(form.ordem)||0,horarios:[...(form.horarios||[])].sort((a,b)=>a.hora.localeCompare(b.hora))}
    setSalvando(true); try{await onSave(payload)} finally{setSalvando(false)}
  }

  return <div className="adm-card" style={{padding:SPACE.xl3,marginBottom:24}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:20}}><div><h3 style={{fontSize:18,fontWeight:800,color:'var(--adm-text)'}}>{linha?'Editar linha':'Nova linha'}</h3><p style={{fontSize:FONT.base,color:'var(--adm-muted)',marginTop:3}}>Cadastre a rota e as informações úteis para o passageiro.</p></div><label style={{display:'flex',alignItems:'center',gap:8,fontSize:FONT.base,fontWeight:700,color:form.ativo?'var(--adm-green)':'var(--adm-muted)'}}><input type="checkbox" checked={form.ativo} onChange={e=>set('ativo',e.target.checked)}/>{form.ativo?'Linha ativa':'Linha oculta'}</label></div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:SPACE.lg}}>
      <div><label className="adm-label">Código / Nº da linha</label><input value={form.codigo} onChange={e=>set('codigo',e.target.value)} placeholder="Ex: 301" maxLength={30} className="adm-input"/></div>
      <div><label className="adm-label">Origem *</label><input value={form.origem} onChange={e=>set('origem',e.target.value)} className="adm-input"/></div>
      <div><label className="adm-label">Destino *</label><input value={form.destino} onChange={e=>set('destino',e.target.value)} placeholder="Ex: Divinópolis" className="adm-input"/></div>
      <div><label className="adm-label">Empresa / Viação</label><input value={form.empresa} onChange={e=>set('empresa',e.target.value)} placeholder="Ex: Viação ..." className="adm-input"/></div>
      <div><label className="adm-label">Ordem de exibição</label><input type="number" min="0" value={form.ordem} onChange={e=>set('ordem',e.target.value)} className="adm-input"/></div>
    </div>
    <div style={{marginTop:SPACE.lg}}><label className="adm-label">Descrição curta da linha</label><input value={form.descricao} onChange={e=>set('descricao',e.target.value)} placeholder="Ex: Linha direta com saída da rodoviária" maxLength={260} className="adm-input"/></div>

    <div style={{marginTop:20,paddingTop:18,borderTop:'1px solid var(--adm-border)'}}><h4 style={{fontWeight:800,color:'var(--adm-text)',marginBottom:12}}>Informações da viagem</h4><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:SPACE.lg}}>
      <div><label className="adm-label">Local de embarque</label><input value={form.embarque} onChange={e=>set('embarque',e.target.value)} placeholder="Ex: Rodoviária Municipal" className="adm-input"/></div>
      <div><label className="adm-label">Telefone</label><input value={form.telefone} onChange={e=>set('telefone',e.target.value)} placeholder="(37) 0000-0000" className="adm-input"/></div>
      <div><label className="adm-label">Site da empresa</label><input type="url" value={form.site} onChange={e=>set('site',e.target.value)} placeholder="https://..." className="adm-input"/></div>
      <div><label className="adm-label">Tarifa (R$)</label><input type="number" min="0" step="0.01" value={form.tarifa} onChange={e=>set('tarifa',e.target.value)} placeholder="0,00" className="adm-input"/></div>
      <div><label className="adm-label">Duração estimada (min)</label><input type="number" min="0" max="1440" value={form.duracao_min} onChange={e=>set('duracao_min',e.target.value)} placeholder="Ex: 90" className="adm-input"/></div>
    </div><div style={{marginTop:SPACE.lg}}><label className="adm-label">Aviso / observação geral</label><input value={form.observacao} onChange={e=>set('observacao',e.target.value)} placeholder="Ex: Não opera em feriados" maxLength={300} className="adm-input"/></div></div>

    <div style={{marginTop:20,paddingTop:18,borderTop:'1px solid var(--adm-border)'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:12}}><div><h4 style={{fontWeight:800,color:'var(--adm-text)'}}>Horários de saída</h4><p style={{fontSize:FONT.sm,color:'var(--adm-muted)',marginTop:2}}>{form.horarios.length} horário(s) cadastrado(s)</p></div><button type="button" onClick={addHorario} className="adm-btn adm-btn-secondary adm-btn-sm"><PlusCircle size={14} style={{marginRight:6}}/>Adicionar horário</button></div>
      {form.horarios.length>0 && <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}><span style={{fontSize:FONT.sm,color:'var(--adm-muted)',alignSelf:'center'}}>Aplicar dias a todos:</span>{PRESETS.map(p=><button type="button" key={p.label} onClick={()=>aplicarPreset(p.dias)} className="adm-btn adm-btn-ghost adm-btn-sm">{p.label}</button>)}</div>}
      {form.horarios.length===0?<div style={{padding:24,textAlign:'center',border:'1px dashed var(--adm-border)',borderRadius:RADIUS.lg,color:'var(--adm-muted)'}}>Nenhum horário adicionado.</div>:<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:SPACE.md}}>{form.horarios.map((h,i)=><HorarioForm key={i} horario={h} onChange={u=>updateHorario(i,u)} onRemove={()=>removeHorario(i)} onDuplicate={()=>duplicarHorario(i)}/>)}</div>}
    </div>

    <div style={{marginTop:20,paddingTop:18,borderTop:'1px solid var(--adm-border)'}}><label className="adm-label">Cor da linha</label><div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:7}}>{CORES.map(c=><button key={c} type="button" onClick={()=>set('cor',c)} aria-label={`Cor ${c}`} style={{width:30,height:30,borderRadius:'50%',background:c,border:form.cor===c?'3px solid white':'2px solid transparent',boxShadow:form.cor===c?'0 0 0 2px var(--adm-accent)':'none',cursor:'pointer'}}/>)}</div></div>

    <div style={{display:'flex',gap:SPACE.md,marginTop:22}}><button onClick={handleSave} disabled={salvando} className="adm-btn adm-btn-primary"><Save size={15} style={{marginRight:6}}/>{salvando?'Salvando...':'Salvar linha'}</button><button onClick={onCancel} disabled={salvando} className="adm-btn adm-btn-secondary"><X size={15} style={{marginRight:6}}/>Cancelar</button></div>
  </div>
}

export default function AdminOnibus(){
  const [linhas,setLinhas]=useState([]),[loading,setLoading]=useState(true),[editando,setEditando]=useState(null),[editLinha,setEditLinha]=useState(null),[busca,setBusca]=useState('')
  const [confirm,setConfirm]=useState({aberto:false,id:null,carregando:false})
  async function carregar(){try{setLoading(true);const data=await onibusService.listarTodos();setLinhas(Array.isArray(data)?data:data?.linhas||[])}catch{toast.error('Erro ao carregar linhas')}finally{setLoading(false)}}
  useEffect(()=>{carregar()},[])
  async function salvar(form){try{if(editando==='novo'){await onibusService.criar(form);toast.success('Linha criada!')}else{await onibusService.editar(editando,form);toast.success('Linha atualizada!')}setEditando(null);setEditLinha(null);await carregar()}catch(err){toast.error(err.message||'Não foi possível salvar')}}
  async function excluir(){setConfirm(c=>({...c,carregando:true}));try{await onibusService.excluir(confirm.id);toast.success('Linha excluída');setConfirm({aberto:false,id:null,carregando:false});carregar()}catch{toast.error('Erro ao excluir');setConfirm(c=>({...c,carregando:false}))}}
  async function alternar(l){try{await onibusService.editar(l.id,{...l,ativo:!l.ativo});toast.success(!l.ativo?'Linha ativada':'Linha ocultada');carregar()}catch(err){toast.error(err.message)}}
  async function duplicar(l){try{const clone={...l,destino:`${l.destino} (cópia)`,codigo:'',ativo:false};delete clone.id;delete clone._id;delete clone.criado_em;delete clone.atualizado_em;await onibusService.criar(clone);toast.success('Cópia criada como inativa');carregar()}catch(err){toast.error(err.message)}}
  const filtradas=useMemo(()=>{const q=busca.trim().toLowerCase();return q?linhas.filter(l=>[l.codigo,l.destino,l.origem,l.empresa].some(v=>String(v||'').toLowerCase().includes(q))):linhas},[linhas,busca])
  const totalHorarios=linhas.reduce((n,l)=>n+(l.horarios?.length||0),0)

  return <><ConfirmModal aberto={confirm.aberto} titulo="Excluir linha?" mensagem="Todos os horários desta linha serão removidos permanentemente." labelConfirmar="Excluir" carregando={confirm.carregando} onConfirmar={excluir} onCancelar={()=>setConfirm({aberto:false,id:null,carregando:false})}/>
    <div className="adm-page-header"><div><div className="adm-page-title">Horários de Ônibus</div><div className="adm-page-sub">Gerencie linhas, dados da viagem e horários publicados no site.</div></div>{editando===null&&<div className="adm-page-actions"><button onClick={()=>{setEditando('novo');setEditLinha(null)}} className="adm-btn adm-btn-primary"><Plus size={16} style={{marginRight:6}}/>Nova linha</button></div>}</div>

    {editando!==null&&<DSModal open onClose={()=>{setEditando(null);setEditLinha(null)}} title={editLinha?'Editar linha':'Nova linha'} size="xl"><LinhaForm linha={editLinha} onSave={salvar} onCancel={()=>{setEditando(null);setEditLinha(null)}}/></DSModal>}

    <>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:16}}>{[
        ['Linhas',linhas.length],['Ativas',linhas.filter(l=>l.ativo).length],['Horários',totalHorarios]
      ].map(([label,val])=><div key={label} className="adm-card" style={{padding:'14px 16px'}}><p style={{fontSize:FONT.sm,color:'var(--adm-muted)',fontWeight:700}}>{label}</p><p style={{fontSize:21,fontWeight:900,color:'var(--adm-text)',marginTop:2}}>{val}</p></div>)}</div>
      <div className="adm-card" style={{padding:14,marginBottom:16}}><div style={{position:'relative',maxWidth:420}}><Search size={15} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'var(--adm-muted)'}}/><input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por destino, empresa ou código..." className="adm-input" style={{paddingLeft:36}}/></div></div>
    </>

    <div className="adm-card" style={{padding:0,overflow:'hidden'}}>{loading?<div className="adm-empty"><p>Carregando...</p></div>:filtradas.length===0?<div className="adm-empty"><Bus size={32} style={{opacity:.2,marginBottom:SPACE.md}}/><p>{busca?'Nenhuma linha encontrada.':'Nenhuma linha cadastrada ainda.'}</p></div>:<div style={{padding:'16px 20px'}}>{filtradas.map(l=><div key={l.id} style={{background:'var(--adm-surface2)',border:'1px solid var(--adm-border)',borderRadius:RADIUS.lg,padding:16,marginBottom:SPACE.lg,opacity:l.ativo?1:.65}}>
      <div style={{display:'flex',alignItems:'center',gap:SPACE.lg,flexWrap:'wrap'}}><div style={{width:44,height:44,borderRadius:RADIUS.lg,backgroundColor:`${l.cor||'#1B5E3B'}20`,display:'flex',alignItems:'center',justifyContent:'center'}}><Bus size={20} style={{color:l.cor||'#1B5E3B'}}/></div><div style={{flex:1,minWidth:180}}><div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}><p style={{fontWeight:800,color:'var(--adm-text)'}}>{l.origem||'Iguatama'} <ArrowRight size={11} style={{display:'inline'}}/> {l.destino}</p>{l.codigo&&<span style={{fontSize:10,fontWeight:800,padding:'2px 6px',border:'1px solid var(--adm-border)',borderRadius:6}}>{l.codigo}</span>}<span style={{fontSize:10,fontWeight:800,color:l.ativo?'var(--adm-green)':'var(--adm-muted)'}}>{l.ativo?'ATIVA':'OCULTA'}</span></div><p style={{fontSize:FONT.base,color:'var(--adm-muted)',marginTop:3}}>{l.empresa||'Empresa não informada'} · {l.horarios?.length||0} horários{l.embarque?` · ${l.embarque}`:''}</p></div><div style={{display:'flex',gap:4}}><button onClick={()=>alternar(l)} className="adm-btn adm-btn-ghost adm-btn-icon adm-btn-sm" title={l.ativo?'Ocultar linha':'Ativar linha'}><Power size={15}/></button><button onClick={()=>duplicar(l)} className="adm-btn adm-btn-ghost adm-btn-icon adm-btn-sm" title="Duplicar"><Copy size={15}/></button><button onClick={()=>{setEditLinha(l);setEditando(l.id)}} className="adm-btn adm-btn-ghost adm-btn-icon adm-btn-sm" title="Editar"><Edit2 size={15}/></button><button onClick={()=>setConfirm({aberto:true,id:l.id,carregando:false})} className="adm-btn adm-btn-ghost adm-btn-icon adm-btn-sm" style={{color:'var(--adm-red)'}} title="Excluir"><Trash2 size={15}/></button></div></div>
      {l.horarios?.length>0&&<div style={{marginTop:14,display:'flex',flexWrap:'wrap',gap:6}}>{[...l.horarios].sort((a,b)=>a.hora.localeCompare(b.hora)).slice(0,12).map((h,i)=><span key={i} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:FONT.sm,fontWeight:800,background:'var(--adm-surface)',border:'1px solid var(--adm-border)',padding:'4px 9px',borderRadius:RADIUS.pill}}><Clock size={10}/>{h.hora}</span>)}{l.horarios.length>12&&<span style={{fontSize:FONT.sm,color:'var(--adm-muted)',padding:'4px 7px'}}>+{l.horarios.length-12}</span>}</div>}
    </div>)}</div>}</div>
  </>
}
