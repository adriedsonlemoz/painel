import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { infraestruturaService } from '../../services/api'
import AdminIcon from '../../components/admin/ui/AdminIcon'
import ConfirmModal from '../../components/ConfirmModal'

const targets = ['production', 'preview', 'development']

export default function AdminVariaveisAmbiente() {
  const [central, setCentral] = useState(null)
  const [provider, setProvider] = useState('vercel')
  const [resourceId, setResourceId] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingEnv, setLoadingEnv] = useState(false)
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [envId, setEnvId] = useState('')
  const [target, setTarget] = useState(['production'])
  const [sensitive, setSensitive] = useState(false)
  const [revealed, setRevealed] = useState({})
  const [revealBusy, setRevealBusy] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const resources = useMemo(() => provider === 'vercel'
    ? (central?.provedores?.vercel?.projetos || [])
    : (central?.provedores?.render?.servicos || []), [central, provider])
  const primaryId = provider === 'vercel' ? central?.producao?.vercelProjectId : central?.producao?.renderServiceId
  const current = resources.find(x => x.id === resourceId)

  const loadCentral = useCallback(async () => {
    setLoading(true)
    try {
      const d = await infraestruturaService.plataformasProjetosCentral()
      setCentral(d)
      const defaultId = d.producao?.vercelProjectId || d.provedores?.vercel?.projetos?.[0]?.id || ''
      setProvider('vercel'); setResourceId(defaultId)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { loadCentral() }, [loadCentral])

  const loadEnv = useCallback(async () => {
    if (!resourceId) { setItems([]); return }
    setLoadingEnv(true)
    try {
      const r = provider === 'vercel'
        ? await infraestruturaService.vercelVariaveis(resourceId)
        : await infraestruturaService.renderVariaveis(resourceId)
      setItems(r.env || []); setRevealed({})
    } catch (e) { toast.error(e.message); setItems([]) }
    finally { setLoadingEnv(false) }
  }, [provider, resourceId])
  useEffect(() => { loadEnv() }, [loadEnv])

  function switchProvider(next) {
    setProvider(next); setItems([]); reset()
    const id = next === 'vercel'
      ? central?.producao?.vercelProjectId || central?.provedores?.vercel?.projetos?.[0]?.id || ''
      : central?.producao?.renderServiceId || central?.provedores?.render?.servicos?.[0]?.id || ''
    setResourceId(id)
  }
  function reset() { setKey(''); setValue(''); setEnvId(''); setTarget(['production']); setSensitive(false) }
  function edit(item) {
    setKey(item.key || ''); setValue(''); setEnvId(item.id || (provider === 'render' ? `render:${item.key}` : ''))
    setTarget(Array.isArray(item.target) && item.target.length ? item.target : ['production'])
    setSensitive(item.type === 'sensitive')
  }
  function toggleTarget(t) { setTarget(old => old.includes(t) ? (old.length > 1 ? old.filter(x => x !== t) : old) : [...old, t]) }

  async function save(deploy = false) {
    const k = key.trim()
    if (!resourceId || !k || !value) return toast.error('Selecione o projeto e informe nome e valor.')
    setBusy(true)
    try {
      const r = provider === 'vercel'
        ? await infraestruturaService.vercelSalvarVariavel(resourceId, k, value, { envId, target, sensitive, deploy })
        : await infraestruturaService.renderSalvarVariavel(resourceId, k, value, { deploy })
      toast.success(r.mensagem || 'Variável salva.')
      reset(); await loadEnv()
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }
  async function reveal(item) {
    const rk=item.id||item.key
    if(revealed[rk]) { setRevealed(x=>({...x,[rk]:''})); return }
    setRevealBusy(rk)
    try {
      const r=provider==='vercel' ? await infraestruturaService.vercelRevelarVariavel(resourceId,item.key,item.id||'') : await infraestruturaService.renderRevelarVariavel(resourceId,item.key)
      setRevealed(x=>({...x,[rk]:r.value||''}))
    } catch(e) { toast.error(e.message) } finally { setRevealBusy('') }
  }
  async function copyValue(item) {
    const rk=item.id||item.key; let v=revealed[rk]
    if(!v){ setRevealBusy(rk); try{const r=provider==='vercel'?await infraestruturaService.vercelRevelarVariavel(resourceId,item.key,item.id||''):await infraestruturaService.renderRevelarVariavel(resourceId,item.key);v=r.value||'';setRevealed(x=>({...x,[rk]:v}))}catch(e){toast.error(e.message);return}finally{setRevealBusy('')} }
    if(v){await navigator.clipboard.writeText(v);toast.success('Copiado')}
  }
  async function remove(item) {
    setBusy(true)
    try {
      const r = provider === 'vercel'
        ? await infraestruturaService.vercelRemoverVariavel(resourceId, item.key, item.id || '')
        : await infraestruturaService.renderRemoverVariavel(resourceId, item.key)
      toast.success(r.mensagem || 'Variável removida.'); setConfirmDelete(null); await loadEnv()
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  if (loading) return <div className="ev-loading"><AdminIcon name="spin" size={20}/> Carregando integrações…</div>
  return <div className="adm-page ev-page">
    <div className="ev-breadcrumb"><Link to="/admin/plataformas">← Projetos e Deploys</Link><span>/</span><b>Variáveis</b></div>
    <section className="ev-hero"><div><small>CONFIGURAÇÃO CENTRAL</small><h1>Variáveis de ambiente</h1><p>Gerencie Vercel e Render pela API sem abrir os painéis externos. Valores ficam mascarados por padrão e só são solicitados ao provedor quando você tocar em Visualizar ou Copiar.</p></div><button onClick={loadEnv}><AdminIcon name="refresh" size={13}/> Atualizar</button></section>

    <section className="ev-card">
      <div className="ev-provider-tabs"><button className={provider==='vercel'?'active':''} onClick={()=>switchProvider('vercel')}>▲ Vercel</button><button className={provider==='render'?'active render':''} onClick={()=>switchProvider('render')}>R Render</button></div>
      <label className="ev-resource">{provider==='vercel'?'Projeto Vercel':'Serviço Render'}<select value={resourceId} onChange={e=>{setResourceId(e.target.value);reset()}}><option value="">Selecione…</option>{resources.map(r=><option key={r.id} value={r.id}>{r.nome}{r.id===primaryId?' · PRODUÇÃO PRINCIPAL':''}</option>)}</select></label>
      {resourceId===primaryId&&<div className="ev-primary">✓ Este é o recurso principal do AL Sistemas.</div>}
    </section>

    <section className="ev-card">
      <header><div><small>VARIÁVEIS</small><h2>{current?.nome || 'Selecione um recurso'}</h2></div><span>{loadingEnv?'consultando…':`${items.length} encontrada(s)`}</span></header>
      <div className="ev-security">🔒 O navegador recebe somente valores mascarados. Tokens da Vercel e Render permanecem no cofre do backend.</div>
      {loadingEnv?<div className="ev-empty">Consultando variáveis…</div>:items.length?<div className="ev-list">{items.map((x,i)=>{const rk=x.id||x.key;const rv=revealed[rk];return <div className="ev-row" key={`${x.id||i}-${x.key}`}><div><b>{x.key}</b><small>{provider==='vercel'?`${(x.target||[]).join(', ')||'production'}${x.type?` · ${x.type}`:''}`:'Render · variável direta do serviço'} · Origem: {x.origin||provider} · {x.valueAvailable?'valor recuperável pela API':'valor protegido/não confirmado'}</small></div><code className={rv?'revealed':''}>{rv||x.valueMasked||'protegida'}</code><div><button onClick={()=>reveal(x)} disabled={busy||revealBusy===rk}>{revealBusy===rk?'…':rv?'Ocultar':'Visualizar'}</button><button onClick={()=>copyValue(x)} disabled={busy||revealBusy===rk}>Copiar</button><button onClick={()=>edit(x)} disabled={busy}>Editar</button><button className="danger" onClick={()=>setConfirmDelete(x)} disabled={busy}>Excluir</button></div></div>})}</div>:<div className="ev-empty">Nenhuma variável encontrada neste recurso.</div>}
    </section>

    <section className="ev-card ev-editor">
      <header><div><small>{envId?'EDIÇÃO':'NOVA VARIÁVEL'}</small><h2>{envId?key:'Adicionar variável'}</h2></div>{(envId||key)&&<button className="link" onClick={reset}>Limpar</button>}</header>
      <div className="ev-fields"><label>Nome<input value={key} disabled={Boolean(envId)} onChange={e=>setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,''))} placeholder="NOME_DA_VARIAVEL"/></label><label>Valor<input type="password" autoComplete="new-password" value={value} onChange={e=>setValue(e.target.value)} placeholder={envId?'Digite o novo valor':'Valor da variável'}/></label></div>
      {provider==='vercel'&&<div className="ev-options"><span>Ambientes</span>{targets.map(t=><label key={t}><input type="checkbox" checked={target.includes(t)} onChange={()=>toggleTarget(t)}/>{t}</label>)}<label><input type="checkbox" checked={sensitive} onChange={e=>setSensitive(e.target.checked)}/>Sensível</label></div>}
      <div className="ev-actions"><button disabled={busy||!resourceId||!key||!value} onClick={()=>save(false)}>Salvar sem deploy</button><button className="primary" disabled={busy||!resourceId||!key||!value} onClick={()=>save(true)}>Salvar + deploy</button></div>
      <p>Na Render, alterações só entram em execução após deploy. Na Vercel, um novo deployment também é necessário para incorporar a variável.</p>
    </section>
    <ConfirmModal aberto={Boolean(confirmDelete)} titulo="Excluir variável" mensagem={confirmDelete?`Excluir ${confirmDelete.key} de ${current?.nome||'este recurso'}? A alteração exigirá novo deploy para entrar em execução.`:''} labelConfirmar="Excluir" carregando={busy} onConfirmar={()=>confirmDelete&&remove(confirmDelete)} onCancelar={()=>!busy&&setConfirmDelete(null)}/>
    <style>{`
      .ev-page{display:grid;gap:12px}.ev-loading{min-height:220px;display:flex;align-items:center;justify-content:center;gap:7px;color:var(--adm-muted)}.ev-breadcrumb{display:flex;gap:6px;font-size:9px;color:var(--adm-muted)}.ev-breadcrumb a{color:var(--adm-accent);text-decoration:none}.ev-hero{display:flex;justify-content:space-between;align-items:flex-end;gap:15px;padding:17px;border:1px solid var(--adm-border);border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--adm-accent) 6%,var(--adm-surface)),var(--adm-surface))}.ev-hero small,.ev-card header small{font-size:8px;font-weight:900;letter-spacing:.13em;color:var(--adm-accent)}.ev-hero h1{margin:4px 0 5px;font-size:24px}.ev-hero p{margin:0;max-width:720px;font-size:10px;color:var(--adm-muted);line-height:1.5}.ev-hero button,.ev-card button{border:1px solid var(--adm-border);border-radius:8px;padding:8px 10px;background:var(--adm-surface2);color:var(--adm-text);font-size:9px;font-weight:800}.ev-card{padding:13px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface)}.ev-provider-tabs{display:flex;gap:6px;margin-bottom:10px}.ev-provider-tabs button.active{background:#111;color:#fff}.ev-provider-tabs button.render.active{background:#7c3aed;color:#fff}.ev-resource{display:grid;gap:5px;font-size:9px;font-weight:800}.ev-resource select,.ev-fields input{width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-bg);color:var(--adm-text)}.ev-primary,.ev-security{margin-top:8px;padding:8px 9px;border-radius:8px;font-size:8px}.ev-primary{background:color-mix(in srgb,var(--adm-success) 6%,transparent);color:var(--adm-success)}.ev-security{background:var(--adm-surface2);color:var(--adm-muted)}.ev-card>header{display:flex;justify-content:space-between;gap:8px;align-items:flex-end}.ev-card h2{font-size:15px;margin:3px 0 0}.ev-card header>span{font-size:8px;color:var(--adm-muted)}.ev-list{display:grid;margin-top:9px}.ev-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:9px;align-items:center;padding:9px 2px;border-top:1px solid var(--adm-border)}.ev-row>div:first-child{display:grid;gap:2px}.ev-row b{font-size:9px}.ev-row small,.ev-row code{font-size:8px;color:var(--adm-muted);min-width:0}.ev-row code{max-width:min(42vw,360px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ev-row code.revealed{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;color:var(--adm-text)}.ev-row>div:last-child{display:flex;gap:4px;flex-wrap:wrap}.ev-row .danger{color:var(--adm-red)}.ev-empty{padding:24px;text-align:center;color:var(--adm-muted);font-size:9px}.ev-editor{display:grid;gap:10px}.ev-editor .link{border:0;background:transparent;color:var(--adm-accent)}.ev-fields{display:grid;grid-template-columns:.85fr 1.15fr;gap:8px}.ev-fields label{display:grid;gap:5px;font-size:9px;font-weight:800}.ev-options{display:flex;gap:9px;align-items:center;flex-wrap:wrap;font-size:8px;color:var(--adm-muted)}.ev-options label{display:flex;gap:3px;align-items:center}.ev-actions{display:flex;justify-content:flex-end;gap:7px}.ev-actions .primary{background:var(--adm-accent);border-color:var(--adm-accent);color:#fff}.ev-actions button:disabled{opacity:.5}.ev-editor>p{margin:0;font-size:8px;color:var(--adm-muted)}
      @media(max-width:650px){.ev-hero{display:grid}.ev-fields{grid-template-columns:1fr}.ev-row{grid-template-columns:minmax(0,1fr)}.ev-row code{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all}.ev-row>div:last-child{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.ev-actions{display:grid;grid-template-columns:1fr 1fr}}
    `}</style>
  </div>
}
