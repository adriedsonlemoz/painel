import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useRss } from '../../hooks/useRss'
import { DSModal, DSBtn, DSBadge, DSAlert, DSToggle } from '../../components/admin/ui/DS'
import { rssService } from '../../services/api'

function formatarData(iso) {
  if (!iso) return 'Nunca importado'
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }).format(new Date(iso))
}
function formatarIntervalo(min) {
  if (!min) return 'manual'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60); const m = min % 60
  return m ? `${h}h ${m}min` : `${h}h`
}
function slugifyLocal(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100)
}
function idOf(v){ return String(v?._id || v?.id || v || '') }

function MiniCreate({ tipo, onCreate, onDone }) {
  const [nome, setNome] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!nome.trim()) return toast.error(`Nome da ${tipo === 'fonte' ? 'fonte' : 'categoria'} é obrigatório`)
    setSaving(true)
    try {
      const out = tipo === 'fonte'
        ? await onCreate({ nome:nome.trim(), url:url.trim() || null })
        : await onCreate({ nome:nome.trim(), slug:slugifyLocal(nome), descricao:'' })
      onDone(out)
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }
  return <div className="rss-quick-create">
    <input className="adm-input" value={nome} onChange={e=>setNome(e.target.value)} placeholder={tipo==='fonte'?'Nome da fonte editorial':'Nome da categoria'} autoFocus/>
    {tipo==='fonte' && <input className="adm-input" value={url} onChange={e=>setUrl(e.target.value)} placeholder="Site da fonte (opcional)"/>}
    <div className="rss-inline-actions"><DSBtn size="sm" variant="primary" loading={saving} onClick={save}>Criar</DSBtn><DSBtn size="sm" variant="ghost" onClick={()=>onDone(null)}>Cancelar</DSBtn></div>
  </div>
}

function ModalFeed({ feed, sugerido, categorias, fontesEditoriais, onSalvar, onCriarFonte, onCriarCategoria, onFechar }) {
  const editando = Boolean(idOf(feed))
  const initial = feed || sugerido || {}
  const suggestedFonte = fontesEditoriais.find(f => String(f.nome||'').toLowerCase() === String(sugerido?.fonte_nome||'').toLowerCase())
  const suggestedCat = categorias.find(c => String(c.nome||'').toLowerCase() === String(sugerido?.categoria_sugerida||'').toLowerCase())
  const [form, setForm] = useState({
    nome: initial.nome || '', url: initial.url || '',
    fonte_id: idOf(feed?.fonte_id) || idOf(suggestedFonte) || '',
    categoria_id: idOf(feed?.categoria_id) || idOf(suggestedCat) || '',
    ativa: initial.ativa ?? true, auto_update: initial.auto_update ?? false,
    intervalo_min: initial.intervalo_min || 60, max_items: initial.max_items || 10,
    copiar_imagem_r2: initial.copiar_imagem_r2 ?? true,
    ia_ativa: initial.ia_ativa ?? false, ia_resumo: initial.ia_resumo ?? true,
    ia_tags: initial.ia_tags ?? true, ia_categoria: initial.ia_categoria ?? true,
    ia_titulo: initial.ia_titulo ?? false, ia_max_itens: initial.ia_max_itens || 3,
    padrao: Boolean(!editando && sugerido),
    fonte_nome: sugerido?.fonte_nome || '', categoria_nome: sugerido?.categoria_sugerida || '',
  })
  const [testando,setTestando]=useState(false), [teste,setTeste]=useState(null), [salvando,setSalvando]=useState(false)
  const [quick,setQuick]=useState(null)
  const set=(k,v)=>{setForm(f=>({...f,[k]:v})); if(k==='url')setTeste(null)}

  async function testar(){
    if(!form.url.trim()) return toast.error('Informe a URL do feed')
    setTestando(true)
    try { const r=await rssService.testarUrl(form.url.trim()); setTeste(r); toast.success(`Feed válido · ${r.total_itens} item(ns)`) }
    catch(e){setTeste(null);toast.error(e.message)} finally{setTestando(false)}
  }
  async function salvar(){
    if(!form.url.trim()||!form.nome.trim()) return toast.error('Informe nome e URL do feed')
    if(!form.fonte_id && !form.fonte_nome) return toast.error('Selecione ou informe a Fonte editorial')
    if(!form.categoria_id && !form.categoria_nome) return toast.error('Selecione ou informe a Categoria padrão')
    setSalvando(true)
    try { await onSalvar({...form,max_items:Number(form.max_items),intervalo_min:Number(form.intervalo_min),ia_max_itens:Number(form.ia_max_itens)}); onFechar() }
    finally{setSalvando(false)}
  }
  return <DSModal open onClose={onFechar} title={editando?'Editar feed RSS':'Novo feed RSS'} size="md" footer={<><DSBtn variant="primary" loading={salvando} onClick={salvar}>{editando?'Salvar':'Adicionar feed'}</DSBtn><DSBtn onClick={onFechar}>Cancelar</DSBtn></>}>
    <div className="rss-form">
      <div className="rss-field rss-url-field"><label>URL do feed *</label><div className="rss-input-action"><input className="adm-input" value={form.url} onChange={e=>set('url',e.target.value)} placeholder="https://site.com/feed.xml"/><DSBtn size="sm" variant="secondary" loading={testando} onClick={testar}>Testar</DSBtn></div>{teste&&<small className="rss-ok">✓ Feed válido · {teste.total_itens} itens · {teste.preview?.[0]?.titulo}</small>}</div>
      <div className="rss-field"><label>Nome do feed *</label><input className="adm-input" value={form.nome} onChange={e=>set('nome',e.target.value)} placeholder="Ex.: CNN Brasil — Política"/></div>

      <div className="rss-two">
        <div className="rss-field"><div className="rss-label-row"><label>Fonte editorial *</label><button type="button" onClick={()=>setQuick(quick==='fonte'?null:'fonte')}>+ criar</button></div><select className="adm-input" value={form.fonte_id} onChange={e=>set('fonte_id',e.target.value)}><option value="">{form.fonte_nome ? `${form.fonte_nome} (será criada/vinculada)` : 'Selecione…'}</option>{fontesEditoriais.map(f=><option key={idOf(f)} value={idOf(f)}>{f.nome}</option>)}</select>{quick==='fonte'&&<MiniCreate tipo="fonte" onCreate={onCriarFonte} onDone={out=>{if(idOf(out))set('fonte_id',idOf(out));setQuick(null)}}/>}</div>
        <div className="rss-field"><div className="rss-label-row"><label>Categoria padrão *</label><button type="button" onClick={()=>setQuick(quick==='categoria'?null:'categoria')}>+ criar</button></div><select className="adm-input" value={form.categoria_id} onChange={e=>set('categoria_id',e.target.value)}><option value="">{form.categoria_nome ? `${form.categoria_nome} (será criada/vinculada)` : 'Selecione…'}</option>{categorias.map(c=><option key={idOf(c)} value={idOf(c)}>{c.nome}</option>)}</select>{quick==='categoria'&&<MiniCreate tipo="categoria" onCreate={onCriarCategoria} onDone={out=>{if(idOf(out))set('categoria_id',idOf(out));setQuick(null)}}/>}</div>
      </div>

      <div className="rss-automation"><DSToggle checked={form.auto_update} onChange={v=>set('auto_update',v)} label="Importação automática" desc={form.auto_update?`Executar a cada ${formatarIntervalo(form.intervalo_min)}`:'Somente quando você mandar importar'}/>{form.auto_update&&<select className="adm-input rss-interval" value={form.intervalo_min} onChange={e=>set('intervalo_min',Number(e.target.value))}>{[[15,'15 min'],[30,'30 min'],[60,'1 hora'],[120,'2 horas'],[360,'6 horas'],[720,'12 horas'],[1440,'24 horas']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}</div>

      <details className="rss-advanced"><summary>Configurações avançadas</summary><div className="rss-advanced-body">
        <div className="rss-two"><div className="rss-field"><label>Máx. por importação</label><input className="adm-input" type="number" min="1" max="100" value={form.max_items} onChange={e=>set('max_items',e.target.value)}/></div><div className="rss-field"><label>Estado</label><select className="adm-input" value={form.ativa?'1':'0'} onChange={e=>set('ativa',e.target.value==='1')}><option value="1">Ativo</option><option value="0">Inativo</option></select></div></div>
        <DSToggle checked={form.copiar_imagem_r2} onChange={v=>set('copiar_imagem_r2',v)} label="Guardar capas no Cloudflare R2" desc="Copia a imagem externa para alsistemas/noticias/rss/...; se falhar, mantém a URL original."/>
        <div className="rss-ai-box"><DSToggle checked={form.ia_ativa} onChange={v=>set('ia_ativa',v)} label="IA editorial após importar" desc="Roda em background; a importação não fica esperando a IA."/>{form.ia_ativa&&<div className="rss-ai-options">
          <label><input type="checkbox" checked={form.ia_resumo} onChange={e=>set('ia_resumo',e.target.checked)}/> resumo</label>
          <label><input type="checkbox" checked={form.ia_tags} onChange={e=>set('ia_tags',e.target.checked)}/> tags</label>
          <label><input type="checkbox" checked={form.ia_categoria} onChange={e=>set('ia_categoria',e.target.checked)}/> reclassificar categoria</label>
          <label title="Desligado por padrão para preservar o título da fonte"><input type="checkbox" checked={form.ia_titulo} onChange={e=>set('ia_titulo',e.target.checked)}/> sugerir/aplicar título</label>
          <select className="adm-input" value={form.ia_max_itens} onChange={e=>set('ia_max_itens',Number(e.target.value))}>{[1,2,3,5,10].map(v=><option key={v} value={v}>IA em até {v} matéria(s)</option>)}</select>
        </div>}</div>
      </div></details>
    </div>
  </DSModal>
}

function FeedCard({feed,onImportar,onEditar,onExcluir,importando}){
  const [open,setOpen]=useState(false), [confirm,setConfirm]=useState(false)
  const fonte=feed.fonte_id?.nome||'Fonte não vinculada', cat=feed.categoria_id?.nome||'Sem categoria'
  return <article className={`rss-card ${!feed.ativa?'rss-card-off':''}`}>
    <button className="rss-card-main" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
      <span className={`rss-health ${feed.ultimo_erro?'bad':feed.ativa?'good':'idle'}`}/><span className="rss-card-copy"><strong>{feed.nome}</strong><small>{fonte} · {cat}</small><span className="rss-card-meta">{formatarData(feed.ultima_importacao)} · {feed.total_importadas||0} importadas</span></span><span className="rss-chevron">{open?'⌃':'⌄'}</span>
    </button>
    <div className="rss-card-badges">{feed.auto_update&&<DSBadge variant="green">AUTO · {formatarIntervalo(feed.intervalo_min)}</DSBadge>}{feed.ia_ativa&&<DSBadge variant="blue">IA</DSBadge>}{!feed.ativa&&<DSBadge variant="red">INATIVO</DSBadge>}{feed.ultimo_erro&&<DSBadge variant="red">ERRO</DSBadge>}{feed.padrao&&<DSBadge variant="blue">PADRÃO</DSBadge>}</div>
    {open&&<div className="rss-card-details"><div className="rss-detail-grid"><div><span>Feed</span><a href={feed.url} target="_blank" rel="noreferrer">{feed.url}</a></div><div><span>Último ciclo</span><b>{feed.ultima_importadas||0} novas · {feed.ultima_duplicadas||0} duplicadas</b></div><div><span>Capas</span><b>{feed.copiar_imagem_r2!==false?'Cloudflare R2':'URL externa'}</b></div><div><span>Limite</span><b>{feed.max_items||10} itens</b></div></div>{feed.ultimo_erro&&<DSAlert variant="red"><strong>Última falha:</strong> {feed.ultimo_erro}</DSAlert>}
      {confirm?<div className="rss-confirm"><span>Excluir este feed? As notícias já importadas serão preservadas.</span><DSBtn size="sm" variant="danger" onClick={()=>onExcluir(feed)}>Excluir</DSBtn><DSBtn size="sm" variant="ghost" onClick={()=>setConfirm(false)}>Cancelar</DSBtn></div>:<div className="rss-card-actions"><DSBtn size="sm" variant="primary" loading={importando===idOf(feed)} onClick={()=>onImportar(feed)}>Importar agora</DSBtn><DSBtn size="sm" onClick={()=>onEditar(feed)}>Editar</DSBtn>{!feed.padrao&&<DSBtn size="sm" variant="ghost" onClick={()=>setConfirm(true)}>Excluir</DSBtn>}</div>}
    </div>}
  </article>
}

function Results({value,onClose}){
  if(!value)return null
  const total=value.totalImportadas??value.importadas??0, dup=value.totalDuplicadas??value.duplicadas??0
  return <div className="rss-result"><span>✓ <b>{total}</b> nova(s) · {dup} duplicada(s){value.ia_em_background?' · IA em background':''}</span><button onClick={onClose}>×</button></div>
}

export default function AdminRssImport(){
  const rss=useRss(); const [modal,setModal]=useState(null)
  const existingUrls=useMemo(()=>new Set(rss.fontes.map(f=>f.url)),[rss.fontes])
  const suggestions=rss.padrao.filter(p=>!existingUrls.has(p.url))
  async function salvar(dados){return rss.salvarFonte(dados,idOf(modal?.feed))}
  return <div className="rss-page">
    <style>{`
      .rss-page{max-width:900px;margin:0 auto}.rss-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}.rss-head h1{margin:0;font-size:24px}.rss-head p{margin:5px 0 0;color:var(--adm-muted);font-size:14px}.rss-head-actions{display:flex;gap:8px;flex-wrap:wrap}.rss-result{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 14px;margin-bottom:14px;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-surface);font-size:13px}.rss-result button{border:0;background:none;font-size:22px;color:var(--adm-muted);cursor:pointer}.rss-list{display:grid;gap:10px}.rss-card{background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:14px;overflow:hidden}.rss-card-off{opacity:.72}.rss-card-main{width:100%;border:0;background:transparent;display:flex;align-items:center;gap:12px;text-align:left;padding:14px;cursor:pointer;color:var(--adm-text)}.rss-health{width:9px;height:9px;border-radius:50%;flex:0 0 auto;background:#94a3b8}.rss-health.good{background:#22c55e}.rss-health.bad{background:#ef4444}.rss-card-copy{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}.rss-card-copy strong{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rss-card-copy small,.rss-card-meta{font-size:12px;color:var(--adm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rss-chevron{color:var(--adm-muted)}.rss-card-badges{display:flex;gap:6px;flex-wrap:wrap;padding:0 14px 12px 35px}.rss-card-details{border-top:1px solid var(--adm-border);padding:13px 14px 14px}.rss-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-bottom:12px}.rss-detail-grid>div{min-width:0}.rss-detail-grid span{display:block;color:var(--adm-muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}.rss-detail-grid b,.rss-detail-grid a{font-size:13px;color:var(--adm-text);font-weight:600;word-break:break-word}.rss-card-actions,.rss-confirm{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}.rss-confirm span{font-size:13px;flex:1}.rss-suggestions{margin:14px 0}.rss-suggestions summary,.rss-maint summary{cursor:pointer;color:var(--adm-muted);font-size:13px;padding:8px 2px}.rss-suggestion-list{display:grid;gap:8px;margin-top:8px}.rss-suggestion{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 12px;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:12px}.rss-suggestion strong{display:block;font-size:13px}.rss-suggestion small{color:var(--adm-muted);font-size:11px}.rss-maint{margin-top:18px}.rss-maint-body{padding:10px 0}.rss-form{display:grid;gap:15px}.rss-field label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--adm-muted);margin-bottom:6px}.rss-input-action{display:flex;gap:8px}.rss-input-action .adm-input{min-width:0;flex:1}.rss-ok{display:block;margin-top:6px;color:#16a34a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rss-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.rss-label-row{display:flex;justify-content:space-between;align-items:center}.rss-label-row button{border:0;background:none;color:var(--adm-accent);font-size:11px;cursor:pointer}.rss-quick-create{display:grid;gap:7px;margin-top:7px;padding:9px;background:var(--adm-surface2);border-radius:10px}.rss-inline-actions{display:flex;gap:6px}.rss-automation{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--adm-border)}.rss-interval{width:150px}.rss-advanced{border-top:1px solid var(--adm-border);padding-top:8px}.rss-advanced summary{cursor:pointer;font-weight:650;font-size:13px;color:var(--adm-text);padding:7px 0}.rss-advanced-body{display:grid;gap:12px;padding-top:8px}.rss-ai-box{padding:10px;background:var(--adm-surface2);border-radius:10px}.rss-ai-options{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;font-size:13px}.rss-ai-options label{display:flex;gap:6px;align-items:center}.rss-ai-options select{grid-column:1/-1}.rss-empty{text-align:center;padding:36px 10px;color:var(--adm-muted)}
      @media(max-width:640px){.rss-head{align-items:stretch}.rss-head h1{font-size:22px}.rss-head p{font-size:13px}.rss-head-actions{flex-direction:column;min-width:124px}.rss-head-actions .adm-btn{width:100%;justify-content:center}.rss-two{grid-template-columns:1fr}.rss-detail-grid{grid-template-columns:1fr}.rss-card-main{padding:12px}.rss-card-badges{padding-left:33px}.rss-input-action{align-items:stretch}.rss-input-action .adm-btn{padding-left:10px;padding-right:10px}.rss-automation{align-items:flex-start;flex-direction:column}.rss-interval{width:100%}.rss-ai-options{grid-template-columns:1fr}.rss-ai-options select{grid-column:auto}.rss-suggestion{align-items:flex-start}.rss-suggestion .adm-btn{flex-shrink:0}}
    `}</style>
    {modal&&<ModalFeed feed={modal.feed} sugerido={modal.sugerido} categorias={rss.categorias} fontesEditoriais={rss.fontesEditoriais} onSalvar={salvar} onCriarFonte={rss.criarFonteEditorial} onCriarCategoria={rss.criarCategoria} onFechar={()=>setModal(null)}/>} 
    <header className="rss-head"><div><h1>RSS</h1><p>Feeds entram como rascunho no fluxo editorial de Notícias.</p></div><div className="rss-head-actions"><DSBtn size="sm" variant="secondary" loading={rss.importandoTodas} disabled={!rss.temFontesAtivas||rss.importandoTodas} onClick={rss.importarTodas}>Importar todas</DSBtn><DSBtn size="sm" variant="primary" onClick={()=>setModal({})}>+ Nova fonte</DSBtn></div></header>
    <Results value={rss.resultados} onClose={()=>rss.setResultados(null)}/>
    {suggestions.length>0&&<details className="rss-suggestions"><summary>Feeds sugeridos ({suggestions.length})</summary><div className="rss-suggestion-list">{suggestions.map(p=><div className="rss-suggestion" key={p.url}><div><strong>{p.nome}</strong><small>✓ validado agora · {p.total_itens || 0} itens · {p.fonte_nome} · {p.categoria_sugerida}</small></div><DSBtn size="sm" onClick={()=>setModal({sugerido:p})}>Configurar</DSBtn></div>)}</div></details>}
    {rss.carregando?<div className="rss-empty">Carregando feeds…</div>:rss.fontes.length===0?<div className="rss-empty">Nenhum feed cadastrado. Adicione uma fonte para começar.</div>:<div className="rss-list">{rss.fontes.map(f=><FeedCard key={idOf(f)} feed={f} onImportar={rss.importarFonte} onEditar={feed=>setModal({feed})} onExcluir={rss.excluirFonte} importando={rss.importando}/>)}</div>}
    <details className="rss-maint"><summary>Manutenção</summary><div className="rss-maint-body"><DSBtn size="sm" variant="ghost" loading={rss.reprocessando} onClick={rss.reprocessarImportadas}>Reprocessar textos importados</DSBtn><p style={{fontSize:12,color:'var(--adm-muted)',marginTop:8}}>Corrige sanitização e caracteres quebrados em notícias RSS antigas sem alterar a fonte original.</p></div></details>
  </div>
}
