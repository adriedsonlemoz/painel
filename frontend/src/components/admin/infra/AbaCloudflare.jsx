/**
 * AbaCloudflare.jsx — Gerenciamento completo da conta Cloudflare.
 *
 * Abas internas:
 *   Visão Geral  — status do token, info da conta
 *   Zonas        — lista de domínios com status/plano
 *   DNS          — registros DNS com CRUD (por zona)
 *   Analytics    — tráfego: requisições, banda, ameaças (gráfico sparkline)
 *   Workers      — scripts da conta
 *
 * Padrões: InfraBase (PageCard, SectionTitle, Btn, C, Ico, Spin)
 *          Tokens do DS (SPACE, RADIUS, FONT)
 */
import { useState, useEffect, useCallback } from 'react'
import React from 'react'
import toast from 'react-hot-toast'
import { cloudflareService } from '../../../services/domains/cloudflare'
import { infraestruturaService } from '../../../services/api'
import { C, Ico, Spin, PageCard, SectionTitle, Btn } from './InfraBase'
import { SPACE, RADIUS, FONT } from '../../../themes/tokens'
import { DSModal } from '../ui/DS'
import AdminIcon from '../ui/AdminIcon'

// ─── Paleta Cloudflare ─────────────────────────────────────────
const CF = {
  orange:  '#f6821f',
  orangeL: '#f6821f22',
  active:  C.greenSolid,
  activeL: C.greenBg,
  warn:    C.amber,
  warnL:   C.amberBg,
  err:     C.red,
  errL:    C.redBg,
}

// ─── Micro utilitários ─────────────────────────────────────────

function Badge({ color, bg, children }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px',
      borderRadius: 20, background: bg || color + '22', color: color || '#fff',
      display: 'inline-block',
    }}>
      {children}
    </span>
  )
}

function Row({ label, value, mono = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: `${SPACE.xs}px 0`, borderBottom: `1px solid ${C.border}`, gap: 8 }}>
      <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: C.text, fontFamily: mono ? 'monospace' : undefined,
        textAlign: 'right', wordBreak: 'break-all' }}>{value ?? '—'}</span>
    </div>
  )
}

// Sparkline SVG puro
function Sparkline({ data = [], color = CF.orange, height = 36, width = 160 }) {
  if (data.length < 2) return <span style={{ color: C.muted, fontSize: 11 }}>sem dados</span>
  const max   = Math.max(...data, 1)
  const min   = Math.min(...data, 0)
  const range = max - min || 1
  const pts   = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const last  = data[data.length - 1]
  const lastX = width
  const lastY = height - ((last - min) / range) * (height - 4) - 2
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color}
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      <circle cx={lastX} cy={lastY} r="3" fill={color} />
    </svg>
  )
}

function numK(n) {
  if (n == null) return '—'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}

function bytes(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${u[i]}`
}

// ─── ABA: Visão Geral ──────────────────────────────────────────
function AbaGeral({ status, carregando, recarregar }) {
  if (carregando) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size={24} /></div>

  if (!status?.ok) return (
    <PageCard>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>☁️</div>
        <p style={{ color: CF.err, fontWeight: 600, marginBottom: 8 }}>Token não configurado</p>
        <p style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>{status?.erro}</p>
        <p style={{ color: C.muted, fontSize: 12, lineHeight:1.5 }}>
          Configure a Cloudflare em <b>Admin → Integrações e APIs</b>. O módulo usa o cofre central; variáveis CF_* são apenas fallback de migração.
        </p>
      </div>
    </PageCard>
  )

  const { token, conta } = status
  const statusCor = token?.status === 'active' ? CF.active : CF.warn

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Token info */}
      <PageCard>
        <SectionTitle icon={<span style={{ fontSize: 16 }}>🔑</span>}>
          Token de API
        </SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: statusCor, flexShrink: 0,
            boxShadow: `0 0 6px ${statusCor}`,
          }} />
          <span style={{ color: statusCor, fontWeight: 700, fontSize: 13 }}>
            {token?.status === 'active' ? 'Ativo e válido' : token?.status ?? 'Desconhecido'}
          </span>
        </div>
        <Row label="Nome"         value={token?.name} />
        <Row label="Account ID"   value={status.account_id} mono />
        <Row label="Token ID" value={token?.id || '—'} mono />
        <Row label="Válido desde" value={token?.not_before ? new Date(token.not_before).toLocaleString('pt-BR') : 'imediatamente'} />
        <Row label="Expiração" value={token?.expires_on ? new Date(token.expires_on).toLocaleString('pt-BR') : 'Sem expiração'} />
      </PageCard>

      {/* Account info */}
      {conta && (
        <PageCard>
          <SectionTitle icon={<span style={{ fontSize: 16 }}>🏢</span>}>
            Conta Cloudflare
          </SectionTitle>
          <Row label="Nome"    value={conta.name} />
          <Row label="ID"      value={conta.id}   mono />
          <Row label="Tipo"    value={conta.type} />
          <Row label="2FA"     value={conta.settings?.enforce_twofactor ? '✅ Obrigatório' : '⚠ Não obrigatório'} />
        </PageCard>
      )}

      {/* S3 Credentials */}
      <PageCard>
        <SectionTitle icon={<span style={{ fontSize: 16 }}>🗝</span>}>
          Credenciais R2 (S3)
        </SectionTitle>
        {status?.s3Credentials ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: status.s3Credentials.configurado ? CF.active : CF.err,
                boxShadow: `0 0 6px ${status.s3Credentials.configurado ? CF.active : CF.err}`,
              }} />
              <span style={{ color: status.s3Credentials.configurado ? CF.active : CF.err, fontWeight: 700, fontSize: 13 }}>
                {status.s3Credentials.configurado ? 'Configuradas' : 'Não configuradas'}
              </span>
            </div>
            <Row label="Bucket padrão" value={status.s3Credentials.bucket || 'nenhum selecionado'} mono />
            <Row label="Endpoint S3" value={status.s3Credentials.endpoint || status.endpoint_s3 || '—'} mono />
            <Row label="Access Key ID" value={status.s3Credentials.accessKeyMasked || (status.s3Credentials.configurado ? '••••••••' : '⚠ ausente')} mono />
            <Row label="Secret Access Key" value={status.s3Credentials.secretMasked || (status.s3Credentials.configurado ? '••••••••' : '⚠ ausente')} mono />
            <Row label="Teste S3" value={status.s3Credentials.configurado ? (status.s3Credentials.valido ? `✅ válido · ${(status.s3Credentials.buckets||[]).length} bucket(s)` : '⚠ credenciais não validadas') : '—'} />
            {!status.s3Credentials.configurado && (
              <p style={{ fontSize: 12, color: CF.err, marginTop: 10 }}>
                Sem as credenciais S3, o navegador de objetos e uploads R2 ficam limitados. Cadastre Access Key ID e Secret Access Key em <b>Integrações e APIs → Cloudflare</b>.
              </p>
            )}
          </>
        ) : (
          <p style={{ color: C.muted, fontSize: 13 }}>Carregando informações S3…</p>
        )}
      </PageCard>

      {Array.isArray(status?.capabilities) && (
        <PageCard>
          <SectionTitle icon={<span style={{fontSize:16}}>🧭</span>}>Capacidades detectadas</SectionTitle>
          <p style={{fontSize:12,color:C.muted,lineHeight:1.5,margin:'0 0 12px'}}>O AL Sistemas testa cada superfície com uma chamada real. “Acessível” confirma leitura; operações de escrita são confirmadas somente quando você executa a ação.</p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8}}>
            {status.capabilities.map(c=><div key={c.id} style={{padding:10,borderRadius:RADIUS.md,border:`1px solid ${C.border}`,background:C.surface2}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}>
                <b style={{fontSize:11,color:C.text}}>{c.label}</b>
                <Badge color={c.ok?CF.active:c.state==='sem-permissao'?CF.warn:CF.err}>{c.ok?'acessível':c.state}</Badge>
              </div>
              <div style={{fontSize:10,color:C.muted,marginTop:5,lineHeight:1.4}}>{c.ok?`${c.count||0} recurso(s) detectado(s)`:c.error||c.description}</div>
            </div>)}
          </div>
        </PageCard>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn onClick={recarregar} variant="secondary" style={{ width: 'auto', padding: '6px 16px', fontSize: 12 }}>
          {Ico.refresh} Verificar novamente
        </Btn>
      </div>
    </div>
  )
}

// ─── ABA: Recursos / produtos da conta ────────────────────────
function AbaRecursos() {
  const [data,setData]=useState(null)
  const [loading,setLoading]=useState(true)
  const [modal,setModal]=useState(null)
  const [form,setForm]=useState({name:'',branch:'main',dimensions:768,metric:'cosine'})
  const [busy,setBusy]=useState(false)
  const [deploys,setDeploys]=useState(null)

  const load=useCallback(async()=>{
    setLoading(true)
    try{setData(await cloudflareService.resources())}
    catch(e){toast.error(e.message)}
    finally{setLoading(false)}
  },[])
  useEffect(()=>{load()},[load])

  const defs={
    pages:{label:'Pages',icon:'▣',desc:'Projetos web e deployments',name:x=>x.name||x.id||'projeto'},
    kv:{label:'Workers KV',icon:'KV',desc:'Namespaces chave/valor',name:x=>x.title||x.id||'namespace'},
    d1:{label:'D1',icon:'D1',desc:'Bancos SQL serverless',name:x=>x.name||x.uuid||'database'},
    queues:{label:'Queues',icon:'Q',desc:'Filas de mensagens',name:x=>x.queue_name||x.queue_id||'queue'},
    vectorize:{label:'Vectorize',icon:'V',desc:'Índices vetoriais',name:x=>x.name||'index'},
    'ai-gateway':{label:'AI Gateway',icon:'AI',desc:'Gateways de IA',name:x=>x.id||'gateway'},
  }

  async function createResource(){
    if(!modal?.type||!form.name.trim())return
    setBusy(true)
    try{
      if(modal.type==='pages')await cloudflareService.criarPagesProject(form.name.trim(),form.branch||'main')
      if(modal.type==='kv')await cloudflareService.criarKvNamespace(form.name.trim())
      if(modal.type==='d1')await cloudflareService.criarD1(form.name.trim())
      if(modal.type==='queues')await cloudflareService.criarQueue(form.name.trim())
      if(modal.type==='vectorize')await cloudflareService.criarVectorize(form.name.trim(),Number(form.dimensions)||768,form.metric||'cosine')
      if(modal.type==='ai-gateway')await cloudflareService.criarAiGateway(form.name.trim(),true)
      toast.success(`${defs[modal.type]?.label||'Recurso'} criado.`)
      setModal(null);setForm({name:'',branch:'main',dimensions:768,metric:'cosine'});await load()
    }catch(e){toast.error(e.message)}
    finally{setBusy(false)}
  }

  async function removeResource(type,item){
    const label=defs[type]?.name(item)||'recurso'
    if(!confirm(`Excluir "${label}" da Cloudflare? Esta ação pode remover dados/configuração.`))return
    setBusy(true)
    try{
      if(type==='pages')await cloudflareService.deletarPagesProject(item.name)
      if(type==='kv')await cloudflareService.deletarKvNamespace(item.id)
      if(type==='d1')await cloudflareService.deletarD1(item.uuid)
      if(type==='queues')await cloudflareService.deletarQueue(item.queue_id)
      if(type==='vectorize')await cloudflareService.deletarVectorize(item.name)
      if(type==='ai-gateway')await cloudflareService.deletarAiGateway(item.id)
      toast.success(`${label} removido.`);await load()
    }catch(e){toast.error(e.message)}
    finally{setBusy(false)}
  }

  async function openDeploys(project){
    setDeploys({project,loading:true,items:[]})
    try{
      const r=await cloudflareService.pagesDeployments(project.name)
      setDeploys({project,loading:false,items:r.deployments||[]})
    }catch(e){setDeploys({project,loading:false,items:[],error:e.message})}
  }

  if(loading)return <PageCard><div style={{display:'flex',justifyContent:'center',padding:50}}><Spin size={22}/></div></PageCard>
  const resources=data?.resources||{}

  return <div style={{display:'flex',flexDirection:'column',gap:14}}>
    <PageCard>
      <SectionTitle icon={<span>🧭</span>}>Recursos da conta</SectionTitle>
      <p style={{margin:'0 0 14px',fontSize:12,color:C.muted,lineHeight:1.55}}>Esta central só habilita o que a API realmente consegue consultar. Se o token tiver apenas leitura, você continua vendo o recurso; uma tentativa de criação/remoção retornará a restrição real da Cloudflare.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10}}>
        {Object.entries(defs).map(([id,def])=>{
          const r=resources[id]||{ok:false,items:[],state:'indisponivel'}
          return <article key={id} style={{border:`1px solid ${C.border}`,borderRadius:RADIUS.lg,padding:13,background:C.surface2,minWidth:0}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
              <div style={{display:'flex',gap:9,alignItems:'center',minWidth:0}}><span style={{width:31,height:31,borderRadius:9,display:'grid',placeItems:'center',background:CF.orangeL,color:CF.orange,fontWeight:900,fontSize:11}}>{def.icon}</span><div><b style={{fontSize:13,color:C.text}}>{def.label}</b><div style={{fontSize:10,color:C.muted,marginTop:2}}>{def.desc}</div></div></div>
              <Badge color={r.ok?CF.active:r.state==='sem-permissao'?CF.warn:CF.err}>{r.ok?`${r.count||r.items?.length||0}`:r.state}</Badge>
            </div>
            {r.ok?<div style={{marginTop:11}}>
              {(r.items||[]).slice(0,4).map((item,i)=><div key={item.id||item.uuid||item.name||item.title||item.queue_id||i} style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',padding:'7px 0',borderTop:`1px solid ${C.border}`}}>
                <div style={{minWidth:0}}><b style={{display:'block',fontSize:11,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{def.name(item)}</b><small style={{fontSize:9,color:C.muted}}>{id==='pages'?(item.production_branch||'main'):id==='d1'?`${bytes(item.file_size||0)}${item.num_tables!=null?` · ${item.num_tables} tabela(s)`:''}`:id==='vectorize'?`${item.config?.dimensions||'—'} dim · ${item.config?.metric||'—'}`:id==='queues'?`${item.producers_total_count||0} produtor(es) · ${item.consumers_total_count||0} consumidor(es)`:id==='ai-gateway'?(item.collect_logs?'logs ativos':'logs desativados'):(item.id||item.uuid||'')}</small></div>
                <div style={{display:'flex',gap:4,flexShrink:0}}>
                  {id==='pages'&&<button onClick={()=>openDeploys(item)} style={{fontSize:9,padding:'4px 6px'}}>Deploys</button>}
                  <button disabled={busy} onClick={()=>removeResource(id,item)} style={{fontSize:9,padding:'4px 6px',color:CF.err}}>Excluir</button>
                </div>
              </div>)}
              {(r.items||[]).length>4&&<div style={{fontSize:9,color:C.muted,marginTop:7}}>+ {(r.items||[]).length-4} outro(s)</div>}
              <button onClick={()=>{setForm({name:'',branch:'main',dimensions:768,metric:'cosine'});setModal({type:id})}} style={{marginTop:10,width:'100%',fontSize:10,padding:7}}>+ Criar {def.label}</button>
            </div>:<div style={{marginTop:11,fontSize:10,color:C.muted,lineHeight:1.45}}>{r.error||'O token não expõe este produto para a conta atual.'}</div>}
          </article>
        })}
      </div>
    </PageCard>

    {modal&&<div style={{position:'fixed',inset:0,zIndex:1200,background:'#0008',display:'flex',alignItems:'center',justifyContent:'center',padding:14}} onClick={e=>e.target===e.currentTarget&&!busy&&setModal(null)}>
      <div style={{width:'min(100%,440px)',background:C.surface,border:`1px solid ${C.border}`,borderRadius:RADIUS.lg,padding:20,boxShadow:'0 24px 70px #0005'}}>
        <h3 style={{margin:'0 0 5px',color:C.text}}>Criar {defs[modal.type]?.label}</h3>
        <p style={{margin:'0 0 15px',fontSize:11,color:C.muted}}>O AL envia a criação diretamente à API Cloudflare. Se o token não tiver escrita, nada é alterado.</p>
        <label style={{display:'block',fontSize:11,fontWeight:700,color:C.muted}}>Nome / ID<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={{width:'100%',boxSizing:'border-box',marginTop:5,padding:9,borderRadius:8,border:`1px solid ${C.border}`,background:C.surface2,color:C.text}}/></label>
        {modal.type==='pages'&&<label style={{display:'block',fontSize:11,fontWeight:700,color:C.muted,marginTop:10}}>Branch de produção<input value={form.branch} onChange={e=>setForm({...form,branch:e.target.value})} style={{width:'100%',boxSizing:'border-box',marginTop:5,padding:9,borderRadius:8,border:`1px solid ${C.border}`,background:C.surface2,color:C.text}}/></label>}
        {modal.type==='vectorize'&&<div className="cloudflare-two-col" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:10}}>
          <label style={{fontSize:11,fontWeight:700,color:C.muted}}>Dimensões<input type="number" min="1" max="1536" value={form.dimensions} onChange={e=>setForm({...form,dimensions:e.target.value})} style={{width:'100%',boxSizing:'border-box',marginTop:5,padding:9,borderRadius:8,border:`1px solid ${C.border}`,background:C.surface2,color:C.text}}/></label>
          <label style={{fontSize:11,fontWeight:700,color:C.muted}}>Métrica<select value={form.metric} onChange={e=>setForm({...form,metric:e.target.value})} style={{width:'100%',boxSizing:'border-box',marginTop:5,padding:9,borderRadius:8,border:`1px solid ${C.border}`,background:C.surface2,color:C.text}}><option value="cosine">cosine</option><option value="euclidean">euclidean</option><option value="dot-product">dot-product</option></select></label>
        </div>}
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:17}}><button disabled={busy} onClick={()=>setModal(null)}>Cancelar</button><button disabled={busy||!form.name.trim()} onClick={createResource} style={{background:CF.orange,color:'#fff',borderColor:CF.orange}}>{busy?'Criando…':'Criar'}</button></div>
      </div>
    </div>}

    {deploys&&<div style={{position:'fixed',inset:0,zIndex:1200,background:'#0008',display:'flex',alignItems:'center',justifyContent:'center',padding:14}} onClick={e=>e.target===e.currentTarget&&setDeploys(null)}>
      <div style={{width:'min(100%,680px)',maxHeight:'calc(100dvh - 28px)',overflow:'auto',background:C.surface,border:`1px solid ${C.border}`,borderRadius:RADIUS.lg,padding:20}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:10}}><div><small style={{color:C.muted}}>CLOUDFLARE PAGES</small><h3 style={{margin:'4px 0 13px',color:C.text}}>{deploys.project?.name} · Deployments</h3></div><button onClick={()=>setDeploys(null)}>×</button></div>
        {deploys.loading?<div style={{padding:35,textAlign:'center'}}><Spin size={20}/></div>:deploys.error?<p style={{color:CF.err}}>{deploys.error}</p>:(deploys.items||[]).map(d=><div key={d.id} style={{padding:'10px 0',borderTop:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',gap:12}}>
          <div><b style={{fontSize:11,color:C.text}}>{d.environment||'deployment'} · {d.latest_stage?.status||d.stages?.at?.(-1)?.status||'—'}</b><div style={{fontSize:9,color:C.muted,marginTop:3}}>{d.deployment_trigger?.metadata?.commit_message||d.id}</div></div>
          {d.url&&<a href={d.url.startsWith('http')?d.url:`https://${d.url}`} target="_blank" rel="noreferrer" style={{fontSize:10,color:CF.orange}}>Abrir ↗</a>}
        </div>)}
      </div>
    </div>}
  </div>
}

// ─── ABA: Zonas ────────────────────────────────────────────────
function AbaZonas({ onSelecionarZona, zonaSelecionada }) {
  const [zonas,     setZonas]     = useState([])
  const [total,     setTotal]     = useState(0)
  const [pagina,    setPagina]    = useState(1)
  const [busca,     setBusca]     = useState('')
  const [loading,   setLoading]   = useState(true)

  const carregar = useCallback(async (pg = 1, q = '') => {
    setLoading(true)
    try {
      const d = await cloudflareService.listarZonas(pg, 20, q)
      setZonas(d.zonas || [])
      setTotal(d.total || 0)
      setPagina(pg)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const PLAN_COR = {
    free:       C.muted,
    pro:        '#3b82f6',
    business:   CF.orange,
    enterprise: '#a855f7',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Barra de busca */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && carregar(1, busca)}
          placeholder="Buscar domínio..."
          style={{
            flex: 1, padding: '7px 12px', borderRadius: RADIUS.md,
            border: `1px solid ${C.border}`, background: C.surface2,
            color: C.text, fontSize: 13,
          }}
        />
        <Btn onClick={() => carregar(1, busca)} variant="secondary"
          style={{ width: 'auto', padding: '7px 16px', fontSize: 12 }}>
          Buscar
        </Btn>
        <Btn onClick={() => { setBusca(''); carregar(1, '') }} variant="secondary"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 12 }}>
          {Ico.clear}
        </Btn>
      </div>

      <PageCard style={{ padding: 0 }}>
        <div style={{ padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.md}px` }}>
          <SectionTitle icon={<span style={{ fontSize: 16 }}>🌐</span>}>
            Zonas ({total})
          </SectionTitle>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin size={20} /></div>
        ) : zonas.length === 0 ? (
          <p style={{ color: C.muted, textAlign: 'center', padding: 40, fontSize: 13 }}>Nenhuma zona encontrada.</p>
        ) : (
          <div>
            {zonas.map(z => {
              const sel = zonaSelecionada?.id === z.id
              return (
                <div
                  key={z.id}
                  onClick={() => onSelecionarZona(z)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: `${SPACE.md}px ${SPACE.lg}px`,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    background: sel ? CF.orangeL : 'transparent',
                    borderLeft: sel ? `3px solid ${CF.orange}` : '3px solid transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: z.status === 'active' ? CF.active : CF.warn,
                    }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{z.name}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>
                        {z.id}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Badge color={PLAN_COR[z.plan?.legacy_id] || C.muted}>
                      {z.plan?.name || 'Free'}
                    </Badge>
                    <Badge color={z.status === 'active' ? CF.active : CF.warn}>
                      {z.status}
                    </Badge>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Paginação */}
        {total > 20 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: SPACE.md }}>
            <Btn onClick={() => carregar(pagina - 1, busca)} variant="secondary"
              style={{ width: 'auto', padding: '4px 14px', fontSize: 12 }}
              disabled={pagina <= 1}>
              ← Anterior
            </Btn>
            <span style={{ fontSize: 12, color: C.muted, alignSelf: 'center' }}>
              Pág. {pagina}
            </span>
            <Btn onClick={() => carregar(pagina + 1, busca)} variant="secondary"
              style={{ width: 'auto', padding: '4px 14px', fontSize: 12 }}
              disabled={zonas.length < 20}>
              Próxima →
            </Btn>
          </div>
        )}
      </PageCard>
    </div>
  )
}

// ─── ABA: DNS ──────────────────────────────────────────────────
const TIPOS_DNS = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR']

function AbaDns({ zona }) {
  const [registros, setRegistros] = useState([])
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [filTipo,   setFilTipo]   = useState('')
  const [busca,     setBusca]     = useState('')
  const [pagina,    setPagina]    = useState(1)
  const [modal,     setModal]     = useState(null) // null | 'criar' | registro
  const [form,      setForm]      = useState({ type: 'A', name: '', content: '', ttl: 1, proxied: false, priority: '' })
  const [salvando,  setSalvando]  = useState(false)
  const [excluindo, setExcluindo] = useState(null)

  const [purgando,  setPurgando]  = useState(false)

  async function purgeCache() {
    if (!confirm(`Purgar TODO o cache de "${zona.name}"? Isso pode aumentar o tráfego temporariamente.`)) return
    setPurgando(true)
    try {
      await cloudflareService.purgeCache(zona.id, { tudo: true })
      toast.success(`Cache de "${zona.name}" purgado com sucesso!`)
    } catch (err) { toast.error(err.message) }
    finally { setPurgando(false) }
  }

  const carregar = useCallback(async (pg = 1) => {
    if (!zona) return
    setLoading(true)
    try {
      const d = await cloudflareService.listarDns(zona.id, { page: pg, tipo: filTipo, q: busca })
      setRegistros(d.registros || [])
      setTotal(d.total || 0)
      setPagina(pg)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }, [zona, filTipo, busca])

  useEffect(() => { carregar(1) }, [carregar])

  async function salvar() {
    setSalvando(true)
    try {
      const payload = { ...form, ttl: Number(form.ttl) || 1 }
      if (modal === 'criar') {
        await cloudflareService.criarDns(zona.id, payload)
        toast.success('Registro DNS criado!')
      } else {
        await cloudflareService.atualizarDns(zona.id, modal.id, payload)
        toast.success('Registro DNS atualizado!')
      }
      setModal(null)
      carregar(pagina)
    } catch (err) { toast.error(err.message) }
    finally { setSalvando(false) }
  }

  async function excluir(rec) {
    setExcluindo(rec.id)
    try {
      await cloudflareService.removerDns(zona.id, rec.id)
      toast.success(`DNS ${rec.name} removido.`)
      carregar(pagina)
    } catch (err) { toast.error(err.message) }
    finally { setExcluindo(null) }
  }

  function abrirEditar(rec) {
    setForm({
      type:     rec.type,
      name:     rec.name,
      content:  rec.content,
      ttl:      rec.ttl,
      proxied:  rec.proxied ?? false,
      priority: rec.priority ?? '',
    })
    setModal(rec)
  }

  function abrirCriar() {
    setForm({ type: 'A', name: '', content: '', ttl: 1, proxied: false, priority: '' })
    setModal('criar')
  }

  if (!zona) return (
    <PageCard>
      <p style={{ color: C.muted, textAlign: 'center', padding: 40, fontSize: 13 }}>
        Selecione uma zona na aba <strong>Zonas</strong> para gerenciar os DNS.
      </p>
    </PageCard>
  )

  const COR_TIPO = {
    A: '#3b82f6', AAAA: '#8b5cf6', CNAME: '#06b6d4', MX: CF.orange,
    TXT: '#10b981', NS: '#f59e0b', SRV: '#ec4899', CAA: '#14b8a6', PTR: C.muted,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Modal criar/editar */}
      {modal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div style={{
            background: C.surface, borderRadius: RADIUS.lg, padding: SPACE.xl2,
            width: '100%', maxWidth: 460, boxShadow: '0 20px 60px #0005',
            border: `1px solid ${C.border}`,
          }}>
            <h3 style={{ margin: '0 0 16px', color: C.text, fontSize: FONT.lg }}>
              {modal === 'criar' ? '➕ Novo Registro DNS' : `✏️ Editar: ${modal.name}`}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Tipo */}
              <div>
                <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Tipo *</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: RADIUS.md,
                    border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: 13 }}>
                  {TIPOS_DNS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              {/* Nome */}
              <div>
                <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Nome *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={`ex: @ ou subdominio`}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: RADIUS.md, boxSizing: 'border-box',
                    border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: 13 }} />
              </div>

              {/* Conteúdo */}
              <div>
                <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Conteúdo *</label>
                <input value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder={form.type === 'A' ? 'ex: 192.168.1.1' : form.type === 'CNAME' ? 'ex: target.example.com' : ''}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: RADIUS.md, boxSizing: 'border-box',
                    border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: 13 }} />
              </div>

              {/* TTL + Proxied */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>TTL</label>
                  <select value={form.ttl} onChange={e => setForm(f => ({ ...f, ttl: Number(e.target.value) }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: RADIUS.md,
                      border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: 13 }}>
                    <option value={1}>Auto</option>
                    <option value={60}>1 min</option>
                    <option value={300}>5 min</option>
                    <option value={1800}>30 min</option>
                    <option value={3600}>1 hora</option>
                    <option value={86400}>1 dia</option>
                  </select>
                </div>
                {['A', 'AAAA', 'CNAME'].includes(form.type) && (
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Proxy CF</label>
                    <button onClick={() => setForm(f => ({ ...f, proxied: !f.proxied }))}
                      style={{
                        width: '100%', padding: '7px 10px', borderRadius: RADIUS.md,
                        border: `1px solid ${form.proxied ? CF.orange : C.border}`,
                        background: form.proxied ? CF.orangeL : C.surface2,
                        color: form.proxied ? CF.orange : C.muted,
                        cursor: 'pointer', fontSize: 13, fontWeight: 600,
                      }}>
                      {form.proxied ? '🟠 Ativo' : '⚪ Desligado'}
                    </button>
                  </div>
                )}
              </div>

              {/* Priority (MX, SRV) */}
              {['MX', 'SRV', 'URI'].includes(form.type) && (
                <div>
                  <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Prioridade</label>
                  <input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    placeholder="10"
                    style={{ width: '100%', padding: '7px 10px', borderRadius: RADIUS.md, boxSizing: 'border-box',
                      border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: 13 }} />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <Btn onClick={() => setModal(null)} variant="secondary"
                style={{ width: 'auto', padding: '7px 18px', fontSize: 13 }}>
                Cancelar
              </Btn>
              <Btn onClick={salvar} disabled={salvando}
                style={{ width: 'auto', padding: '7px 18px', fontSize: 13,
                  background: CF.orange, borderColor: CF.orange }}>
                {salvando ? <Spin size={14} /> : (modal === 'criar' ? '✓ Criar' : '✓ Salvar')}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* Barra de filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
          🌐 {zona.name}
        </span>
        <div style={{ flex: 1, display: 'flex', gap: 6 }}>
          <input value={busca} onChange={e => setBusca(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && carregar(1)}
            placeholder="Filtrar por nome..."
            style={{ flex: 1, padding: '6px 10px', borderRadius: RADIUS.md,
              border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: 12 }} />
          <select value={filTipo} onChange={e => { setFilTipo(e.target.value); carregar(1) }}
            style={{ padding: '6px 10px', borderRadius: RADIUS.md,
              border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: 12 }}>
            <option value="">Todos os tipos</option>
            {TIPOS_DNS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <Btn onClick={abrirCriar}
          style={{ width: 'auto', padding: '6px 14px', fontSize: 12,
            background: CF.orange, borderColor: CF.orange }}>
          ＋ Novo registro
        </Btn>
        <Btn onClick={purgeCache} disabled={purgando} variant="secondary"
          style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
          title="Purgar cache da zona">
          {purgando ? <Spin size={12} /> : '🧹 Purge'}
        </Btn>
      </div>

      <PageCard style={{ padding: 0 }}>
        <div style={{ padding: `${SPACE.md}px ${SPACE.lg}px` }}>
          <span style={{ fontSize: 12, color: C.muted }}>
            {total} registro{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin size={20} /></div>
        ) : registros.length === 0 ? (
          <p style={{ color: C.muted, textAlign: 'center', padding: 40, fontSize: 13 }}>Nenhum registro encontrado.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.surface2 }}>
                  {['Tipo', 'Nome', 'Conteúdo', 'TTL', 'Proxy', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left',
                      color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {registros.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '8px 12px' }}>
                      <Badge color={COR_TIPO[r.type] || C.muted}>{r.type}</Badge>
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: C.text, maxWidth: 180 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.name}
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: C.muted, maxWidth: 220 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.content}
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px', color: C.muted }}>
                      {r.ttl === 1 ? 'Auto' : `${r.ttl}s`}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {r.proxied
                        ? <span style={{ color: CF.orange, fontWeight: 700 }}>🟠</span>
                        : <span style={{ color: C.muted }}>⚪</span>
                      }
                    </td>
                    <td style={{ padding: '8px 12px', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button onClick={() => abrirEditar(r)} title="Editar"
                        style={{ cursor: 'pointer', background: 'none', border: 'none',
                          color: C.muted, padding: '2px 4px', borderRadius: RADIUS.sm }}>
                        {Ico.save}
                      </button>
                      <button onClick={() => excluir(r)} title="Excluir"
                        disabled={excluindo === r.id}
                        style={{ cursor: 'pointer', background: 'none', border: 'none',
                          color: excluindo === r.id ? C.muted : CF.err,
                          padding: '2px 4px', borderRadius: RADIUS.sm }}>
                        {excluindo === r.id ? <Spin size={12} /> : Ico.trash}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 50 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: SPACE.md }}>
            <Btn onClick={() => carregar(pagina - 1)} variant="secondary"
              style={{ width: 'auto', padding: '4px 14px', fontSize: 12 }}
              disabled={pagina <= 1}>← Anterior</Btn>
            <span style={{ fontSize: 12, color: C.muted, alignSelf: 'center' }}>Pág. {pagina}</span>
            <Btn onClick={() => carregar(pagina + 1)} variant="secondary"
              style={{ width: 'auto', padding: '4px 14px', fontSize: 12 }}
              disabled={registros.length < 50}>Próxima →</Btn>
          </div>
        )}
      </PageCard>
    </div>
  )
}

// ─── ABA: Analytics ────────────────────────────────────────────
function AbaAnalytics({ zona }) {
  const [dados,   setDados]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [horas,   setHoras]   = useState(24)

  const carregar = useCallback(async () => {
    if (!zona) return
    setLoading(true)
    try {
      const d = await cloudflareService.analytics(zona.id, horas)
      setDados(d.analytics)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }, [zona, horas])

  useEffect(() => { carregar() }, [carregar])

  if (!zona) return (
    <PageCard>
      <p style={{ color: C.muted, textAlign: 'center', padding: 40, fontSize: 13 }}>
        Selecione uma zona na aba <strong>Zonas</strong>.
      </p>
    </PageCard>
  )

  const tot = dados?.totals
  const series = dados?.timeseries || []

  const req    = series.map(t => t?.requests?.all   || 0)
  const banda  = series.map(t => t?.bandwidth?.all  || 0)
  const ameaças = series.map(t => t?.threats?.all   || 0)
  const cache  = series.map(t => t?.requests?.cached || 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Controles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>🌐 {zona.name} — Período:</span>
        {[6, 12, 24, 48, 168].map(h => (
          <button key={h} onClick={() => setHoras(h)} style={{
            padding: '4px 12px', borderRadius: 20, cursor: 'pointer', border: 'none', fontSize: 11,
            background: horas === h ? CF.orange : C.border,
            color: horas === h ? '#fff' : C.text, fontWeight: horas === h ? 700 : 400,
          }}>
            {h < 24 ? `${h}h` : h === 24 ? '24h' : h === 48 ? '2d' : '7d'}
          </button>
        ))}
        <Btn onClick={carregar} variant="secondary" style={{ width: 'auto', padding: '4px 12px', fontSize: 11 }}>
          {Ico.refresh}
        </Btn>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size={24} /></div>
      ) : (
        <>
          {/* Cards de totais */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {[
              { label: 'Requisições',  val: numK(tot?.requests?.all),     spark: req,    color: '#3b82f6' },
              { label: 'Cached',       val: numK(tot?.requests?.cached),  spark: cache,  color: CF.active },
              { label: 'Banda total',  val: bytes(tot?.bandwidth?.all),   spark: banda,  color: CF.orange },
              { label: 'Ameaças',      val: numK(tot?.threats?.all),      spark: ameaças, color: CF.err  },
            ].map(({ label, val, spark, color }) => (
              <PageCard key={label} style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color, marginBottom: 8 }}>{val ?? '—'}</div>
                <Sparkline data={spark} color={color} width={140} height={32} />
              </PageCard>
            ))}
          </div>

          {/* Detalhes */}
          {tot && (
            <PageCard>
              <SectionTitle icon={<span style={{ fontSize: 16 }}>📊</span>}>Detalhes do período</SectionTitle>
              <Row label="Requisições não-cached" value={numK(tot.requests?.uncached)} />
              <Row label="Status 2xx"             value={numK(tot.requests?.http_status?.['200'])} />
              <Row label="Status 4xx"             value={numK(tot.pageviews?.all)} />
              <Row label="Page Views"             value={numK(tot.pageviews?.all)} />
              <Row label="Visitantes únicos"      value={numK(tot.uniques?.all)} />
              <Row label="Banda servida"          value={bytes(tot.bandwidth?.all)} />
              <Row label="Banda cached"           value={bytes(tot.bandwidth?.cached)} />
              <Row label="Banda não-cached"       value={bytes(tot.bandwidth?.uncached)} />
            </PageCard>
          )}
        </>
      )}
    </div>
  )
}

// ─── ABA: Workers ──────────────────────────────────────────────
function AbaWorkers() {
  const [workers, setWorkers] = useState([])
  const [aviso,   setAviso]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    cloudflareService.workers()
      .then(d => { setWorkers(d.workers || []); setAviso(d.aviso || null) })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <PageCard>
      <SectionTitle icon={<span style={{ fontSize: 16 }}>⚙️</span>}>Workers da conta</SectionTitle>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin size={20} /></div>
      ) : aviso ? (
        <p style={{ color: CF.warn, fontSize: 13 }}>⚠ {aviso}</p>
      ) : workers.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13 }}>Nenhum Worker encontrado nesta conta.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {workers.map(w => (
            <div key={w.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: `${SPACE.sm}px ${SPACE.md}px`,
              borderRadius: RADIUS.md, background: C.surface2, border: `1px solid ${C.border}`,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{w.id}</div>
                {w.modified_on && (
                  <div style={{ fontSize: 11, color: C.muted }}>
                    Modificado: {new Date(w.modified_on).toLocaleString('pt-BR')}
                  </div>
                )}
              </div>
              {w.usage_model && (
                <Badge color={CF.orange}>{w.usage_model}</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </PageCard>
  )
}

// ═══════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════

// ─── ABA: R2 Storage ──────────────────────────────────────────
function AbaR2({ status, onRefreshStatus }) {
  const [view,setView]=useState('overview')
  const [buckets,setBuckets]=useState([]),[usage,setUsage]=useState(null),[loading,setLoading]=useState(true)
  const [bucketSel,setBucketSel]=useState(null),[objetos,setObjetos]=useState([]),[prefixos,setPrefixos]=useState([]),[prefix,setPrefix]=useState(''),[cursor,setCursor]=useState(''),[truncated,setTruncated]=useState(false),[loadingObj,setLoadingObj]=useState(false)
  const [selected,setSelected]=useState(new Set()),[busy,setBusy]=useState(false),[display,setDisplay]=useState('list')
  const [showCreateBucket,setShowCreateBucket]=useState(false),[bucketForm,setBucketForm]=useState({name:'',locationHint:'',storageClass:'Standard'})
  const [showFolder,setShowFolder]=useState(false),[folderName,setFolderName]=useState('')
  const [preview,setPreview]=useState(null),[previewInfo,setPreviewInfo]=useState(null),[previewBusy,setPreviewBusy]=useState(false),[editingMeta,setEditingMeta]=useState(false),[metaForm,setMetaForm]=useState({contentType:'',cacheControl:''})
  const [moveItem,setMoveItem]=useState(null),[moveTo,setMoveTo]=useState(''),[copyItem,setCopyItem]=useState(null),[copyTo,setCopyTo]=useState('')
  const [folderOp,setFolderOp]=useState(null),[folderOpTo,setFolderOpTo]=useState('')
  const [folderDelete,setFolderDelete]=useState(null),[folderConfirm,setFolderConfirm]=useState('')
  const [batch,setBatch]=useState(null),[batchTo,setBatchTo]=useState('')
  const [query,setQuery]=useState(''),[sort,setSort]=useState('dateDesc'),[typeFilter,setTypeFilter]=useState('all')
  const [settingsOpen,setSettingsOpen]=useState(false),[settingsData,setSettingsData]=useState(null),[settingsBusy,setSettingsBusy]=useState(false)
  const [corsForm,setCorsForm]=useState({origins:'',methods:'GET, HEAD',headers:'',expose:'ETag, Content-Length',maxAge:'3600'})
  const [domainForm,setDomainForm]=useState('')
  const [publicAccess,setPublicAccess]=useState(null),[loadingPublic,setLoadingPublic]=useState(false)
  const [shareItem,setShareItem]=useState(null),[shareMode,setShareMode]=useState('managed'),[shareExpiry,setShareExpiry]=useState(86400),[shareResult,setShareResult]=useState(null),[shareList,setShareList]=useState([]),[shareBusy,setShareBusy]=useState(false)
  const [uploads,setUploads]=useState([])
  const fileInputRef=React.useRef(null),uploadControllers=React.useRef(new Map())
  const bn=b=>b?.nome||b?.name||''
  const fmtBytes=n=>bytes(Number(n||0))
  const defaultBucket=String(status?.s3Credentials?.bucket||'').trim()
  const activePublicBucket=view==='browser'&&bucketSel?bn(bucketSel):defaultBucket
  const detectedPublicUrl=publicAccess?.bucket===activePublicBucket?publicAccess?.publicUrl:''
  const effectivePublicUrl=String(detectedPublicUrl||(activePublicBucket===defaultBucket?status?.s3Credentials?.publicUrl:'')||'').trim()
  const keyName=key=>String(key||'').split('/').filter(Boolean).pop()||key
  const relativeName=key=>String(key||'').replace(prefix,'').split('/').filter(Boolean).pop()||key
  const extOf=key=>{const n=keyName(key);const i=n.lastIndexOf('.');return i>0?n.slice(i+1).toLowerCase():'—'}
  const isImage=key=>/\.(avif|gif|jpe?g|png|svg|webp)$/i.test(key||'')
  const isVideo=key=>/\.(mp4|webm|mov|m4v)$/i.test(key||'')
  const isAudio=key=>/\.(mp3|wav|ogg|m4a)$/i.test(key||'')
  const iconFor=key=>isImage(key)?'image':isVideo(key)?'video':'archive'
  const publicFor=key=>effectivePublicUrl?`${effectivePublicUrl.replace(/\/+$/,'')}/${String(key).split('/').map(encodeURIComponent).join('/')}`:''
  const copyText=async(text,label='Informação')=>{try{await navigator.clipboard.writeText(String(text||''));toast.success(`${label} copiada.`)}catch{toast.error('Não foi possível copiar.')}}

  const carregarPublicAccess=useCallback(async(bucket,{quiet=false}={})=>{
    const name=String(bucket||'').trim();if(!name){setPublicAccess(null);return null}
    setLoadingPublic(true)
    try{const data=await cloudflareService.publicUrlR2(name);setPublicAccess(data);return data}
    catch(err){setPublicAccess({bucket:name,publicUrl:null,error:err.message});if(!quiet)toast.error(err.message);return null}
    finally{setLoadingPublic(false)}
  },[])

  useEffect(()=>{if(defaultBucket)carregarPublicAccess(defaultBucket,{quiet:true});else setPublicAccess(null)},[defaultBucket,carregarPublicAccess])

  const carregarOverview=useCallback(async()=>{
    setLoading(true)
    try{const [b,u]=await Promise.all([cloudflareService.listarBuckets(),cloudflareService.usageR2().catch(()=>null)]);setBuckets((b.buckets||[]).map(x=>({...x,nome:x.nome||x.name})));setUsage(u)}
    catch(err){toast.error(err.message)}finally{setLoading(false)}
  },[])
  useEffect(()=>{carregarOverview()},[carregarOverview])

  const carregarSettings=useCallback(async(bucket,{open=false}={})=>{
    if(!bucket)return
    if(open)setSettingsOpen(true)
    setSettingsBusy(true)
    try{
      const d=await cloudflareService.configuracoesBucket(bucket);setSettingsData(d);if(d.publicAccess)setPublicAccess(d.publicAccess)
      const r=(d.cors?.rules||[]).find(rule=>rule.id==='al-sistemas')||null
      if(r)setCorsForm({origins:(r.allowed?.origins||[]).join(', '),methods:(r.allowed?.methods||[]).join(', '),headers:(r.allowed?.headers||[]).join(', '),expose:(r.exposeHeaders||[]).join(', '),maxAge:String(r.maxAgeSeconds||3600)})
      else setCorsForm({origins:'',methods:'GET, HEAD',headers:'',expose:'ETag, Content-Length',maxAge:'3600'})
    }catch(err){toast.error(err.message)}finally{setSettingsBusy(false)}
  },[])

  const carregarObjetos=useCallback(async(b,pref='',cur='')=>{
    if(!b)return;setLoadingObj(true)
    try{
      const d=await cloudflareService.listarObjetos(bn(b),{prefix:pref,cursor:cur,limit:250,delim:'/'})
      const clean=(d.objetos||[]).filter(o=>!String(o.key||'').endsWith('/.keep'))
      if(cur)setObjetos(old=>[...old,...clean]);else setObjetos(clean)
      if(cur)setPrefixos(old=>Array.from(new Set([...old,...(d.prefixos||[])])));else setPrefixos(d.prefixos||[])
      setTruncated(Boolean(d.truncated));setCursor(d.cursor||'');setSelected(new Set())
    }catch(err){toast.error(err.message)}finally{setLoadingObj(false)}
  },[])

  function abrirBucket(b){setBucketSel(b);setPrefix('');setView('browser');setSelected(new Set());setQuery('');carregarObjetos(b,'','');carregarSettings(bn(b)).catch(()=>{})}
  function navPrefix(p){setPrefix(p);setSelected(new Set());setQuery('');carregarObjetos(bucketSel,p,'')}
  function Breadcrumb(){const parts=prefix.split('/').filter(Boolean);return <div className="cf-explorer-crumb"><button onClick={()=>navPrefix('')}>{bn(bucketSel)}</button>{parts.map((part,i)=>{const target=parts.slice(0,i+1).join('/')+'/';return <React.Fragment key={target}><span>/</span><button onClick={()=>navPrefix(target)}>{part}</button></React.Fragment>})}</div>}

  async function definirPadrao(bucket,e){e?.stopPropagation?.();try{const r=await cloudflareService.definirBucketPadrao(bucket);if(r.publicAccess)setPublicAccess(r.publicAccess);toast.success(r.mensagem||'Bucket padrão atualizado');await onRefreshStatus?.();await carregarOverview()}catch(err){toast.error(err.message)}}
  async function criarBucket(){const name=bucketForm.name.trim();if(!name)return;setBusy(true);try{await cloudflareService.criarBucket(name,bucketForm.locationHint,bucketForm.storageClass);toast.success(`Bucket ${name} criado`);setBucketForm({name:'',locationHint:'',storageClass:'Standard'});setShowCreateBucket(false);await carregarOverview()}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  async function excluirBucket(bucket,e){e?.stopPropagation?.();const u=usage?.buckets?.find(x=>(x.nome||x.name)===bucket);const count=Number(u?.objetos||0);const msg=count?`O bucket “${bucket}” possui ${count.toLocaleString('pt-BR')} objeto(s) e não pode ser excluído enquanto não estiver vazio.`:`Excluir definitivamente o bucket vazio “${bucket}”?`;if(count)return toast.error(msg);if(!window.confirm(msg))return;setBusy(true);try{await cloudflareService.deletarBucket(bucket);toast.success('Bucket removido');await carregarOverview()}catch(err){toast.error(err.message)}finally{setBusy(false)}}

  async function criarPasta(){const n=folderName.trim().replace(/^\/+|\/+$/g,'');if(!n)return;setBusy(true);try{await cloudflareService.criarPasta(bn(bucketSel),prefix,n);toast.success('Pasta criada');setFolderName('');setShowFolder(false);await carregarObjetos(bucketSel,prefix,'')}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  async function prepararExcluirPasta(folderPrefix){setBusy(true);try{const info=await cloudflareService.infoPasta(bn(bucketSel),folderPrefix);setFolderDelete({prefix:folderPrefix,info});setFolderConfirm('')}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  async function confirmarExcluirPasta(){if(!folderDelete)return;const expected=keyName(folderDelete.prefix.replace(/\/$/,''));if(folderConfirm!==expected)return;setBusy(true);try{const r=await cloudflareService.excluirPasta(bn(bucketSel),folderDelete.prefix);if(r.erros?.length)toast.error(`${r.deletados} removidos, ${r.erros.length} falhas`);else toast.success(`Pasta “${expected}” removida`);setFolderDelete(null);setFolderConfirm('');await carregarObjetos(bucketSel,prefix,'');await carregarOverview()}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  async function executarPasta(){if(!folderOp||!folderOpTo.trim())return;setBusy(true);try{await cloudflareService.acaoPasta(bn(bucketSel),folderOp.action,folderOp.prefix,folderOpTo);toast.success(folderOp.action==='move'?'Pasta movida':'Pasta copiada');setFolderOp(null);await carregarObjetos(bucketSel,prefix,'');await carregarOverview()}catch(err){toast.error(err.message)}finally{setBusy(false)}}

  async function deletarUm(key){if(!window.confirm(`Excluir “${relativeName(key)}”?`))return;try{await cloudflareService.deletarObjeto(bn(bucketSel),key);toast.success('Arquivo removido');await carregarObjetos(bucketSel,prefix,'');await carregarOverview()}catch(err){toast.error(err.message)}}
  async function deletarSelecionados(){const keys=[...selected];if(!keys.length||!window.confirm(`Excluir definitivamente ${keys.length} arquivo(s) selecionado(s)?`))return;setBusy(true);try{const d=await cloudflareService.deletarObjetos(bn(bucketSel),keys);d.erros?.length?toast.error(`${d.deletados||0} removido(s), ${d.erros.length} falha(s)`):toast.success(`${keys.length} arquivo(s) removido(s)`);await carregarObjetos(bucketSel,prefix,'');await carregarOverview()}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  function toggleSelect(key){setSelected(old=>{const n=new Set(old);n.has(key)?n.delete(key):n.add(key);return n})}
  function toggleAll(list){setSelected(selected.size===list.length?new Set():new Set(list.map(o=>o.key)))}
  async function executarLote(){if(!batch||!batchTo.trim())return;setBusy(true);try{await cloudflareService.acaoLote(bn(bucketSel),batch,[...selected],batchTo);toast.success(batch==='move'?'Arquivos movidos':'Arquivos copiados');setBatch(null);setSelected(new Set());await carregarObjetos(bucketSel,prefix,'');await carregarOverview()}catch(err){toast.error(err.message)}finally{setBusy(false)}}

  async function abrirPreview(o){setPreview(o);setPreviewInfo(null);setPreviewBusy(true);setEditingMeta(false);try{const info=await cloudflareService.infoObjeto(bn(bucketSel),o.key);setPreviewInfo(info);setMetaForm({contentType:info.contentType||'',cacheControl:info.cacheControl||''})}catch(err){toast.error(err.message)}finally{setPreviewBusy(false)}}
  function abrirMover(o){setMoveItem(o);setMoveTo(o.key)}
  async function mover(){const to=String(moveTo||'').trim().replace(/^\//,'');if(!moveItem||!to)return;setBusy(true);try{await cloudflareService.moverObjeto(bn(bucketSel),moveItem.key,to);toast.success('Arquivo movido/renomeado');setMoveItem(null);await carregarObjetos(bucketSel,prefix,'')}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  function abrirCopiar(o){setCopyItem(o);setCopyTo(o.key)}
  async function copiarObjeto(){const to=String(copyTo||'').trim().replace(/^\//,'');if(!copyItem||!to)return;setBusy(true);try{await cloudflareService.copiarObjeto(bn(bucketSel),copyItem.key,to);toast.success('Arquivo copiado');setCopyItem(null);await carregarObjetos(bucketSel,prefix,'')}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  async function salvarMeta(){if(!preview)return;setBusy(true);try{await cloudflareService.atualizarMetadadosObjeto(bn(bucketSel),preview.key,metaForm);toast.success('Metadados atualizados');setEditingMeta(false);await abrirPreview(preview)}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  function baixar(o){window.open(cloudflareService.objectUrl(bn(bucketSel),o.key,{download:true}),'_blank','noopener')}
  async function copiarLinkRapido(o){
    if(effectivePublicUrl)return copyText(publicFor(o.key),'Link público')
    setBusy(true)
    try{
      const r=await cloudflareService.criarCompartilhamento(bn(bucketSel),o.key,{mode:'managed',expiresIn:3600})
      await navigator.clipboard.writeText(r.url)
      toast.success('Link temporário revogável de 1 hora copiado.')
    }catch(err){toast.error(err.message)}finally{setBusy(false)}
  }

  function updateUpload(id,patch){setUploads(old=>old.map(u=>u.id===id?{...u,...patch}:u))}
  async function runUpload(item){
    const id=item.id,controller=new AbortController();uploadControllers.current.set(id,controller);updateUpload(id,{status:'preparando',progress:0,speed:0,error:null})
    try{
      const prep=await cloudflareService.prepararUploadDireto(bn(bucketSel),prefix,item.file)
      updateUpload(id,{status:'enviando',key:prep.key})
      await cloudflareService.uploadDireto(prep,item.file,{signal:controller.signal,onProgress:p=>updateUpload(id,{progress:p}),onSpeed:s=>updateUpload(id,{speed:s})})
      updateUpload(id,{status:'concluido',progress:100,speed:0});return true
    }catch(err){
      if(err.code==='ABORTED'){updateUpload(id,{status:'cancelado',speed:0,error:null});return false}
      if(item.file.size<=50*1024*1024){
        try{updateUpload(id,{status:'fallback',error:'Upload direto indisponível; usando backend seguro.'});await cloudflareService.uploadObjeto(bn(bucketSel),prefix,item.file,p=>updateUpload(id,{progress:p}));updateUpload(id,{status:'concluido',progress:100,speed:0,error:null});return true}catch(fallbackErr){updateUpload(id,{status:'erro',speed:0,error:fallbackErr.message});return false}
      }
      updateUpload(id,{status:'erro',speed:0,error:`${err.message} Para arquivos acima de 50 MB, configure CORS para o domínio do painel e tente novamente.`});return false
    }finally{uploadControllers.current.delete(id)}
  }
  async function uploadFiles(filesLike){const files=Array.from(filesLike||[]);if(!files.length||!bucketSel)return;const items=files.map(file=>({id:`${Date.now()}-${Math.random()}`,file,name:file.name,size:file.size,status:'fila',progress:0,speed:0,error:null}));setUploads(old=>[...items,...old].slice(0,30));let changed=false;for(const item of items){changed=(await runUpload(item))||changed}if(changed){toast.success('Uploads concluídos');await carregarObjetos(bucketSel,prefix,'');await carregarOverview()}}
  function cancelarUpload(id){uploadControllers.current.get(id)?.abort()}
  async function retryUpload(id){const item=uploads.find(u=>u.id===id);if(item)await runUpload(item)}

  async function abrirCompartilhar(o){setShareItem(o);setShareResult(null);setShareMode('managed');setShareExpiry(86400);setShareBusy(true);try{const d=await cloudflareService.listarCompartilhamentos(bn(bucketSel),o.key);setShareList(d.shares||[])}catch{setShareList([])}finally{setShareBusy(false)}}
  async function gerarCompartilhamento(){if(!shareItem)return;setShareBusy(true);try{const r=await cloudflareService.criarCompartilhamento(bn(bucketSel),shareItem.key,{mode:shareMode,expiresIn:Number(shareExpiry)});setShareResult(r);toast.success('Link criado');if(r.mode==='managed'){const d=await cloudflareService.listarCompartilhamentos(bn(bucketSel),shareItem.key);setShareList(d.shares||[])}}catch(err){toast.error(err.message)}finally{setShareBusy(false)}}
  async function revogarShare(id){if(!window.confirm('Revogar este link imediatamente?'))return;setShareBusy(true);try{await cloudflareService.revogarCompartilhamento(bn(bucketSel),id);const d=await cloudflareService.listarCompartilhamentos(bn(bucketSel),shareItem.key);setShareList(d.shares||[]);toast.success('Link revogado')}catch(err){toast.error(err.message)}finally{setShareBusy(false)}}

  async function togglePublic(enabled){if(!bucketSel)return;const verb=enabled?'ativar o acesso público r2.dev':'desativar o acesso público r2.dev';if(!window.confirm(`Deseja ${verb} para “${bn(bucketSel)}”? ${enabled?'Qualquer pessoa que conheça a URL poderá ler objetos do bucket.':''}`))return;setSettingsBusy(true);try{const d=await cloudflareService.definirAcessoPublicoR2(bn(bucketSel),enabled);setPublicAccess(d);toast.success(enabled?'r2.dev ativado':'r2.dev desativado');await carregarSettings(bn(bucketSel))}catch(err){toast.error(err.message)}finally{setSettingsBusy(false)}}
  async function saveCors(){const split=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean);const origins=split(corsForm.origins),methods=split(corsForm.methods).map(x=>x.toUpperCase());if(!origins.length)return toast.error('Informe pelo menos uma origem.');setSettingsBusy(true);try{const existing=(settingsData?.cors?.rules||[]).filter(rule=>rule.id!=='al-sistemas');const rule={id:'al-sistemas',allowed:{origins,methods,headers:split(corsForm.headers)},exposeHeaders:split(corsForm.expose),maxAgeSeconds:Number(corsForm.maxAge||3600)};await cloudflareService.salvarCorsBucket(bn(bucketSel),[...existing,rule]);toast.success('Regra CORS do AL atualizada sem remover as demais.');await carregarSettings(bn(bucketSel))}catch(err){toast.error(err.message)}finally{setSettingsBusy(false)}}
  async function removeCors(){if(!window.confirm('Remover somente a regra CORS criada pelo AL Sistemas? As demais regras serão preservadas.'))return;setSettingsBusy(true);try{const remaining=(settingsData?.cors?.rules||[]).filter(rule=>rule.id!=='al-sistemas');if(remaining.length)await cloudflareService.salvarCorsBucket(bn(bucketSel),remaining);else await cloudflareService.removerCorsBucket(bn(bucketSel));toast.success('Regra CORS do AL removida.');await carregarSettings(bn(bucketSel))}catch(err){toast.error(err.message)}finally{setSettingsBusy(false)}}
  async function addCurrentOriginCors(){const origin=window.location.origin;const set=new Set(String(corsForm.origins||'').split(',').map(x=>x.trim()).filter(Boolean));set.add(origin);setCorsForm(f=>({...f,origins:[...set].join(', '),methods:Array.from(new Set([...String(f.methods||'').split(',').map(x=>x.trim()).filter(Boolean),'GET','PUT','HEAD'])).join(', ')}));toast.success('Origem atual adicionada ao formulário. Salve o CORS para aplicar.')}
  async function addDomain(){const domain=domainForm.trim();if(!domain)return;setSettingsBusy(true);try{await cloudflareService.adicionarDominioR2(bn(bucketSel),domain);setDomainForm('');toast.success('Domínio solicitado');await carregarSettings(bn(bucketSel))}catch(err){toast.error(err.message)}finally{setSettingsBusy(false)}}
  async function removeDomain(domain){if(!window.confirm(`Remover o domínio “${domain}” deste bucket?`))return;setSettingsBusy(true);try{await cloudflareService.removerDominioR2(bn(bucketSel),domain);toast.success('Domínio removido');await carregarSettings(bn(bucketSel))}catch(err){toast.error(err.message)}finally{setSettingsBusy(false)}}
  async function toggleDomain(domain,enabled){setSettingsBusy(true);try{await cloudflareService.atualizarDominioR2(bn(bucketSel),domain,{enabled});toast.success(enabled?'Domínio habilitado':'Domínio desabilitado');await carregarSettings(bn(bucketSel))}catch(err){toast.error(err.message)}finally{setSettingsBusy(false)}}
  async function saveStorageClass(value){setSettingsBusy(true);try{await cloudflareService.atualizarConfiguracoesBucket(bn(bucketSel),{storageClass:value});toast.success('Classe padrão atualizada');await carregarSettings(bn(bucketSel));await carregarOverview()}catch(err){toast.error(err.message)}finally{setSettingsBusy(false)}}
  async function aplicarR2NaProducao(provider){const url=effectivePublicUrl;if(!url)return toast.error('Nenhuma URL pública do R2 disponível.');const nome=provider==='vercel'?'Vercel':'Render',withDeploy=provider==='vercel';if(!window.confirm(withDeploy?`Definir CF_R2_PUBLIC_URL na ${nome} e iniciar deploy?`:`Salvar CF_R2_PUBLIC_URL na ${nome}?`))return;setBusy(true);try{const r=await infraestruturaService.aplicarVariavelProducao(provider,'CF_R2_PUBLIC_URL',url,{deploy:withDeploy});toast.success(r.mensagem||`Variável enviada à ${nome}.`)}catch(err){toast.error(err.message)}finally{setBusy(false)}}

  const filteredObjects=React.useMemo(()=>{
    const q=query.trim().toLowerCase()
    const category=o=>{const e=extOf(o.key);if(/^(png|jpe?g|gif|webp|avif|svg)$/.test(e))return'image';if(/^(mp4|webm|mov|m4v)$/.test(e))return'video';if(/^(mp3|wav|ogg|m4a)$/.test(e))return'audio';if(e==='apk')return'apk';if(/^(zip|rar|7z|tar|gz)$/.test(e))return'archive';if(/^(pdf|txt|md|json|csv|docx?|xlsx?)$/.test(e))return'document';return'other'}
    let list=objetos.filter(o=>(!q||relativeName(o.key).toLowerCase().includes(q))&&(typeFilter==='all'||category(o)===typeFilter))
    const type=o=>extOf(o.key)
    list=[...list].sort((a,b)=>{
      if(sort==='nameAsc'||sort==='nameDesc'){const c=relativeName(a.key).localeCompare(relativeName(b.key),'pt-BR',{numeric:true});return sort==='nameDesc'?-c:c}
      if(sort==='sizeAsc'||sort==='sizeDesc'){const c=Number(a.size||0)-Number(b.size||0);return sort==='sizeDesc'?-c:c}
      if(sort==='dateAsc'||sort==='dateDesc'){const c=new Date(a.uploaded||0)-new Date(b.uploaded||0);return sort==='dateDesc'?-c:c}
      if(sort==='typeAsc')return type(a).localeCompare(type(b),'pt-BR')||relativeName(a.key).localeCompare(relativeName(b.key),'pt-BR')
      return 0
    });return list
  },[objetos,query,sort,prefix,typeFilter])
  const filteredPrefixes=React.useMemo(()=>{const q=query.trim().toLowerCase();return [...prefixos].filter(p=>!q||relativeName(p.replace(/\/$/,'')).toLowerCase().includes(q)).sort((a,b)=>relativeName(a).localeCompare(relativeName(b),'pt-BR',{numeric:true}))},[prefixos,query,prefix])
  const bucketUsage=usage?.buckets?.find(x=>(x.nome||x.name)===bn(bucketSel))
  const Modal=({title,onClose,children,size='lg'})=><DSModal open onClose={onClose} title={title} size={size}>{children}</DSModal>

  const createBucketModal=showCreateBucket&&<Modal title="Novo bucket R2" onClose={()=>setShowCreateBucket(false)}><div className="cf-explorer-form"><label>Nome do bucket</label><input autoFocus value={bucketForm.name} onChange={e=>setBucketForm(f=>({...f,name:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')}))} placeholder="meu-bucket"/><label>Localização preferencial</label><select value={bucketForm.locationHint} onChange={e=>setBucketForm(f=>({...f,locationHint:e.target.value}))}><option value="">Automática (recomendado)</option><option value="wnam">Oeste da América do Norte</option><option value="enam">Leste da América do Norte</option><option value="weur">Europa Ocidental</option><option value="eeur">Europa Oriental</option><option value="apac">Ásia-Pacífico</option><option value="oc">Oceania</option></select><label>Classe padrão</label><select value={bucketForm.storageClass} onChange={e=>setBucketForm(f=>({...f,storageClass:e.target.value}))}><option value="Standard">Standard</option><option value="InfrequentAccess">Infrequent Access</option></select><small>A localização é uma preferência de criação. A classe padrão pode ser alterada depois.</small><div><button onClick={()=>setShowCreateBucket(false)}>Cancelar</button><button className="primary" onClick={criarBucket} disabled={busy||!bucketForm.name}>Criar</button></div></div></Modal>

  if(view==='overview')return <div className="cf-r2-shell">
    {createBucketModal}
    <div className="cf-r2-stats"><div><span>ARMAZENAMENTO</span><b>{fmtBytes(usage?.totalBytes)}</b></div><div><span>OBJETOS</span><b>{Number(usage?.totalObjetos||0).toLocaleString('pt-BR')}</b></div><div><span>BUCKETS</span><b>{buckets.length}</b></div><button onClick={carregarOverview} title="Atualizar" aria-label="Atualizar R2"><AdminIcon name="refresh" size={15}/></button></div>
    {defaultBucket&&<div className="cf-r2-public-card"><div className="cf-r2-public-main"><small>URL PÚBLICA · BUCKET PADRÃO</small><b>{defaultBucket}</b>{loadingPublic?<span>Consultando domínios…</span>:effectivePublicUrl?<><code>{effectivePublicUrl}</code><span>{publicAccess?.source==='custom'?'Domínio personalizado ativo.':'r2.dev ativo (desenvolvimento).'} Use esta URL como <b>CF_R2_PUBLIC_URL</b>.</span></>:<span>{publicAccess?.error||'Nenhum domínio público ativo. O bucket continua privado.'}</span>}</div><div className="cf-r2-public-actions"><button onClick={()=>carregarPublicAccess(defaultBucket)} title="Verificar"><AdminIcon name="refresh" size={13}/> Verificar</button><button onClick={()=>{const b=buckets.find(x=>bn(x)===defaultBucket)||{name:defaultBucket,nome:defaultBucket};abrirBucket(b);setTimeout(()=>carregarSettings(defaultBucket,{open:true}),0)}} title="Configurar acesso público e bucket"><AdminIcon name="gear" size={13}/> Configurar</button><button onClick={()=>copyText(effectivePublicUrl,'URL')} disabled={!effectivePublicUrl}><AdminIcon name="copy" size={13}/> Copiar</button><button onClick={()=>aplicarR2NaProducao('vercel')} disabled={!effectivePublicUrl||busy}>Vercel</button><button onClick={()=>aplicarR2NaProducao('render')} disabled={!effectivePublicUrl||busy}>Render</button>{effectivePublicUrl&&<a href={effectivePublicUrl} target="_blank" rel="noreferrer"><AdminIcon name="extLink" size={12}/> Abrir</a>}</div></div>}
    <div className="cf-explorer-card"><div className="cf-explorer-card-head"><div><small>R2 STORAGE</small><h3>Seus espaços</h3><p>Abra um bucket para navegar, compartilhar, organizar e configurar objetos.</p></div><button className="primary" onClick={()=>setShowCreateBucket(true)}><AdminIcon name="plus" size={13}/> Novo bucket</button></div>{loading?<div className="cf-explorer-loading"><Spin size={20}/></div>:!buckets.length?<div className="cf-explorer-empty"><b>Nenhum bucket encontrado</b><span>Crie o primeiro espaço R2.</span></div>:<div className="cf-bucket-grid">{buckets.map(b=>{const name=bn(b),u=usage?.buckets?.find(x=>(x.nome||x.name)===name),isDefault=name===defaultBucket;return <div key={name} className={`cf-bucket-card ${isDefault?'default':''}`}><button className="cf-bucket-open" onClick={()=>abrirBucket(b)}><div className="cf-bucket-top"><span className="cf-bucket-icon">R2</span>{isDefault&&<em>PADRÃO AL</em>}</div><h4 title={name}>{name}</h4><div className="cf-bucket-meta"><span>{fmtBytes(u?.bytes)}</span><span>{Number(u?.objetos||0).toLocaleString('pt-BR')} objetos</span><span>{b.storage_class||b.storageClass||'Standard'}</span></div></button><div className="cf-bucket-actions"><button onClick={e=>definirPadrao(name,e)}>{isDefault?'Em uso':'Usar no AL'}</button><button onClick={()=>{abrirBucket(b);setTimeout(()=>carregarSettings(name,{open:true}),0)}}><AdminIcon name="gear" size={12}/> Config.</button><button className="danger" onClick={e=>excluirBucket(name,e)}><AdminIcon name="trash" size={12}/></button></div></div>})}</div>}</div>
    <style>{CF_EXPLORER_CSS}</style>
  </div>

  const settingsModal=settingsOpen&&<Modal title={`Configurações · ${bn(bucketSel)}`} onClose={()=>setSettingsOpen(false)} size="xl"><div className="cf-settings">{settingsBusy&&!settingsData?<div className="cf-explorer-loading"><Spin size={20}/></div>:<>
    <section><header><div><small>GERAL</small><h4>Bucket</h4></div><AdminIcon name="db" size={18}/></header><div className="cf-setting-grid"><InfoCell label="Nome" value={settingsData?.bucket?.name||bn(bucketSel)} copy={copyText}/><InfoCell label="Localização" value={settingsData?.bucket?.location||'Automática / não informada'} copy={copyText}/><InfoCell label="Jurisdição" value={settingsData?.bucket?.jurisdiction||'default'} copy={copyText}/><InfoCell label="Criado em" value={settingsData?.bucket?.creation_date?new Date(settingsData.bucket.creation_date).toLocaleString('pt-BR'):'—'} copy={copyText}/></div><label className="cf-setting-field"><span>Classe padrão de novos objetos</span><select value={settingsData?.bucket?.storage_class||'Standard'} onChange={e=>saveStorageClass(e.target.value)} disabled={settingsBusy}><option value="Standard">Standard</option><option value="InfrequentAccess">Infrequent Access</option></select></label></section>
    <section><header><div><small>ACESSO</small><h4>Público e compartilhamento</h4></div><AdminIcon name="shield" size={18}/></header><div className="cf-access-row"><div><b>r2.dev</b><span>{settingsData?.publicAccess?.managed?.enabled?'Ativo — público para quem souber a URL':'Desativado — bucket privado por este endpoint'}</span>{settingsData?.publicAccess?.managed?.domain&&<code>{settingsData.publicAccess.managed.domain}</code>}</div><button className={settingsData?.publicAccess?.managed?.enabled?'danger':''} onClick={()=>togglePublic(!settingsData?.publicAccess?.managed?.enabled)} disabled={settingsBusy}>{settingsData?.publicAccess?.managed?.enabled?'Desativar':'Ativar r2.dev'}</button></div><div className="cf-domain-list"><b>Domínios personalizados</b>{(settingsData?.publicAccess?.customDomains||[]).length?(settingsData.publicAccess.customDomains.map(d=><div key={d.domain}><div><strong>{d.domain}</strong><span>{d.enabled?'habilitado':'desabilitado'} · ownership {d.ownership||'—'} · SSL {d.ssl||'—'}</span></div><div className="cf-domain-actions"><button onClick={()=>toggleDomain(d.domain,!d.enabled)} disabled={settingsBusy}>{d.enabled?'Desativar':'Ativar'}</button><button className="danger" onClick={()=>removeDomain(d.domain)}><AdminIcon name="trash" size={12}/></button></div></div>)):<p>Nenhum domínio personalizado conectado.</p>}<div className="cf-inline-form"><input value={domainForm} onChange={e=>setDomainForm(e.target.value)} placeholder="arquivos.seudominio.com"/><button onClick={addDomain} disabled={!domainForm.trim()||settingsBusy}>Conectar</button></div></div><p className="cf-setting-note">Links temporários podem usar URL S3 assinada sem tornar o bucket público. Links gerenciados pelo AL podem ser revogados imediatamente.</p></section>
    <section><header><div><small>WEB</small><h4>CORS</h4></div><AdminIcon name="globe" size={18}/></header><div className="cf-cors-grid"><label><span>Origens permitidas</span><textarea value={corsForm.origins} onChange={e=>setCorsForm(f=>({...f,origins:e.target.value}))} placeholder="https://seu-painel.vercel.app"/></label><label><span>Métodos</span><input value={corsForm.methods} onChange={e=>setCorsForm(f=>({...f,methods:e.target.value}))}/></label><label><span>Headers permitidos</span><input value={corsForm.headers} onChange={e=>setCorsForm(f=>({...f,headers:e.target.value}))} placeholder="Content-Type"/></label><label><span>Headers expostos</span><input value={corsForm.expose} onChange={e=>setCorsForm(f=>({...f,expose:e.target.value}))}/></label><label><span>Max age (segundos)</span><input type="number" min="0" max="86400" value={corsForm.maxAge} onChange={e=>setCorsForm(f=>({...f,maxAge:e.target.value}))}/></label></div><div className="cf-setting-actions"><button onClick={addCurrentOriginCors}>+ Origem deste painel</button><button className="primary" onClick={saveCors} disabled={settingsBusy}>Salvar CORS</button><button className="danger" onClick={removeCors} disabled={settingsBusy}>Remover regra do AL</button></div><p className="cf-setting-note">CORS é necessário para upload/download direto no navegador usando URLs assinadas. Não altera a privacidade do bucket por si só.</p></section>
    <section><header><div><small>ARMAZENAMENTO</small><h4>Uso e recursos</h4></div><AdminIcon name="archive" size={18}/></header><div className="cf-setting-grid"><InfoCell label="Objetos" value={Number(settingsData?.usage?.objects||0).toLocaleString('pt-BR')}/><InfoCell label="Tamanho" value={fmtBytes(settingsData?.usage?.bytes)}/><InfoCell label="Varredura parcial" value={settingsData?.usage?.truncated?'Sim — bucket muito grande':'Não'}/><InfoCell label="Lifecycle" value={Array.isArray(settingsData?.lifecycle?.rules)?`${settingsData.lifecycle.rules.length} regra(s)`:'Não disponível'}/></div><div className="cf-cap-list">{Object.entries(settingsData?.availability||{}).map(([k,v])=><span key={k} className={v?'ok':'off'}>{v?'✓':'×'} {k}</span>)}</div><p className="cf-setting-note">Content-Type e Cache-Control são metadados por objeto e são editáveis em Detalhes. “Pastas” são prefixos, não diretórios reais.</p></section>
  </>}</div></Modal>

  const folderDeleteModal=folderDelete&&<Modal title="Excluir pasta" onClose={()=>setFolderDelete(null)}><div className="cf-danger-confirm"><AdminIcon name="alert" size={24}/><h4>{keyName(folderDelete.prefix.replace(/\/$/,''))}</h4><p>Esta pasta é um prefixo do R2. A exclusão removerá todos os objetos cuja chave comece por <code>{folderDelete.prefix}</code>.</p><div className="cf-setting-grid"><InfoCell label="Arquivos" value={Number(folderDelete.info?.objects||0).toLocaleString('pt-BR')}/><InfoCell label="Tamanho" value={fmtBytes(folderDelete.info?.bytes)}/></div>{folderDelete.info?.truncated&&<p className="danger-text">A varredura foi truncada. O backend bloqueará exclusões acima do limite de segurança.</p>}<label>Para confirmar, digite <b>{keyName(folderDelete.prefix.replace(/\/$/,''))}</b><input autoFocus value={folderConfirm} onChange={e=>setFolderConfirm(e.target.value)}/></label><div className="cf-setting-actions"><button onClick={()=>setFolderDelete(null)}>Cancelar</button><button className="danger" onClick={confirmarExcluirPasta} disabled={folderConfirm!==keyName(folderDelete.prefix.replace(/\/$/,''))||busy}>Excluir pasta e conteúdo</button></div></div></Modal>

  const shareModal=shareItem&&<Modal title={`Compartilhar · ${relativeName(shareItem.key)}`} onClose={()=>{setShareItem(null);setShareResult(null)}}><div className="cf-share"><div className="cf-share-modes"><button className={shareMode==='managed'?'active':''} onClick={()=>{setShareMode('managed');setShareResult(null)}}><AdminIcon name="shield" size={16}/><b>Temporário</b><span>Revogável pelo AL</span></button><button className={shareMode==='public'?'active':''} onClick={()=>{setShareMode('public');setShareResult(null)}} disabled={!effectivePublicUrl}><AdminIcon name="globe" size={16}/><b>Público</b><span>Permanente no domínio</span></button></div>{shareMode!=='public'&&<label className="cf-setting-field"><span>Validade</span><select value={shareExpiry} onChange={e=>setShareExpiry(Number(e.target.value))}><option value={3600}>1 hora</option><option value={21600}>6 horas</option><option value={86400}>24 horas</option><option value={259200}>3 dias</option><option value={604800}>7 dias</option><option value={2592000}>30 dias</option></select></label>}<p className="cf-setting-note">{shareMode==='public'?'O arquivo ficará acessível enquanto o domínio público e o objeto existirem.':'O link usa um token aleatório opaco, salvo somente como hash no banco. Não expõe API Token, Access Key ou Secret Access Key; pode expirar e ser revogado imediatamente.'}</p><button className="primary cf-share-generate" onClick={gerarCompartilhamento} disabled={shareBusy}>{shareBusy?'Gerando…':'Gerar link'}</button>{shareResult?.url&&<div className="cf-share-result"><small>{shareResult.permanent?'LINK PÚBLICO PERMANENTE':'LINK TEMPORÁRIO REVOGÁVEL'}</small><code>{shareResult.url}</code>{shareResult.expiresAt&&<span>Expira: {new Date(shareResult.expiresAt).toLocaleString('pt-BR')}</span>}<div><button onClick={()=>copyText(shareResult.url,'Link')}><AdminIcon name="copy" size={12}/> Copiar</button><a href={shareResult.url} target="_blank" rel="noreferrer"><AdminIcon name="extLink" size={12}/> Abrir</a></div></div>}{shareList.length>0&&<div className="cf-share-history"><b>Links temporários deste arquivo</b>{shareList.map(s=><div key={s.id}><span><strong>{s.status}</strong> · expira {new Date(s.expiresAt).toLocaleString('pt-BR')} · {s.accessCount||0} acesso(s)</span>{s.status==='ativo'&&<button className="danger" onClick={()=>revogarShare(s.id)}>Revogar</button>}</div>)}</div>}</div></Modal>

  const detailsModal=preview&&<Modal title={relativeName(preview.key)} onClose={()=>{setPreview(null);setPreviewInfo(null)}}><div className="cf-preview-body">{previewBusy?<div className="cf-explorer-loading"><Spin size={20}/></div>:<>{isImage(preview.key)&&<img src={cloudflareService.objectUrl(bn(bucketSel),preview.key)} alt={relativeName(preview.key)}/>} {isVideo(preview.key)&&<video controls src={cloudflareService.objectUrl(bn(bucketSel),preview.key)}/>} {isAudio(preview.key)&&<audio controls src={cloudflareService.objectUrl(bn(bucketSel),preview.key)}/>} {!isImage(preview.key)&&!isVideo(preview.key)&&!isAudio(preview.key)&&<div className="cf-file-generic"><AdminIcon name={iconFor(preview.key)} size={38}/><b>{relativeName(preview.key)}</b><span>Prévia visual não disponível para este formato.</span></div>}<div className="cf-detail-grid"><DetailRow label="Nome" value={relativeName(preview.key)} onCopy={copyText}/><DetailRow label="Tipo" value={previewInfo?.contentType||'—'} onCopy={copyText}/><DetailRow label="Tamanho" value={fmtBytes(previewInfo?.size??preview.size)}/><DetailRow label="Caminho" value={preview.key} onCopy={copyText}/><DetailRow label="Bucket" value={bn(bucketSel)} onCopy={copyText}/><DetailRow label="Última modificação" value={previewInfo?.lastModified?new Date(previewInfo.lastModified).toLocaleString('pt-BR'):'—'}/><DetailRow label="ETag" value={previewInfo?.etag||preview.etag||'—'} onCopy={copyText}/><DetailRow label="Cache-Control" value={previewInfo?.cacheControl||'—'} onCopy={copyText}/><DetailRow label="Classe" value={previewInfo?.storageClass||'—'}/><DetailRow label="Acesso" value={effectivePublicUrl?'Bucket com endpoint público ativo; compartilhamento temporário também disponível.':'Privado; download autenticado e links temporários/gerenciados disponíveis.'}/>{effectivePublicUrl&&<DetailRow label="Link público" value={publicFor(preview.key)} onCopy={copyText}/>}</div>{editingMeta?<div className="cf-meta-edit"><label>Content-Type<input value={metaForm.contentType} onChange={e=>setMetaForm(f=>({...f,contentType:e.target.value}))}/></label><label>Cache-Control<input value={metaForm.cacheControl} onChange={e=>setMetaForm(f=>({...f,cacheControl:e.target.value}))} placeholder="public, max-age=3600"/></label><div><button onClick={()=>setEditingMeta(false)}>Cancelar</button><button className="primary" onClick={salvarMeta} disabled={busy}>Salvar metadados</button></div></div>:<div className="cf-preview-actions"><button onClick={()=>setEditingMeta(true)}><AdminIcon name="edit" size={12}/> Metadados</button><button onClick={()=>baixar(preview)}><AdminIcon name="cloud" size={12}/> Baixar</button><button onClick={()=>{setPreview(null);abrirCompartilhar(preview)}}><AdminIcon name="share" size={12}/> Compartilhar</button><button onClick={()=>{setPreview(null);abrirMover(preview)}}>Mover</button></div>}</>}</div></Modal>

  return <div className="cf-r2-shell">
    {createBucketModal}{settingsModal}{folderDeleteModal}{shareModal}{detailsModal}
    {showFolder&&<Modal title="Nova pasta" onClose={()=>setShowFolder(false)}><div className="cf-explorer-form"><label>Nome</label><input autoFocus value={folderName} onChange={e=>setFolderName(e.target.value)} placeholder="imagens"/><small>R2 usa prefixos; um objeto .keep mantém a pasta vazia visível.</small><div><button onClick={()=>setShowFolder(false)}>Cancelar</button><button className="primary" onClick={criarPasta} disabled={busy||!folderName.trim()}>Criar pasta</button></div></div></Modal>}
    {moveItem&&<Modal title="Mover ou renomear" onClose={()=>setMoveItem(null)}><div className="cf-explorer-form"><label>Novo caminho</label><input autoFocus value={moveTo} onChange={e=>setMoveTo(e.target.value)}/><small>A operação usa CopyObject + DeleteObject; o arquivo não passa pelo navegador.</small><div><button onClick={()=>setMoveItem(null)}>Cancelar</button><button className="primary" onClick={mover} disabled={busy||!moveTo.trim()}>Aplicar</button></div></div></Modal>}
    {copyItem&&<Modal title="Copiar arquivo" onClose={()=>setCopyItem(null)}><div className="cf-explorer-form"><label>Destino</label><input autoFocus value={copyTo} onChange={e=>setCopyTo(e.target.value)}/><small>A cópia ocorre dentro do R2.</small><div><button onClick={()=>setCopyItem(null)}>Cancelar</button><button className="primary" onClick={copiarObjeto} disabled={busy||!copyTo.trim()}>Copiar</button></div></div></Modal>}
    {folderOp&&<Modal title={`${folderOp.action==='move'?'Mover':'Copiar'} pasta`} onClose={()=>setFolderOp(null)}><div className="cf-explorer-form"><label>Destino do prefixo</label><input autoFocus value={folderOpTo} onChange={e=>setFolderOpTo(e.target.value)} placeholder="destino/pasta/"/><small>Todos os objetos do prefixo serão {folderOp.action==='move'?'copiados para o destino e removidos da origem':'copiados'}.</small><div><button onClick={()=>setFolderOp(null)}>Cancelar</button><button className="primary" onClick={executarPasta} disabled={busy||!folderOpTo.trim()}>Aplicar</button></div></div></Modal>}
    {batch&&<Modal title={`${batch==='move'?'Mover':'Copiar'} ${selected.size} arquivo(s)`} onClose={()=>setBatch(null)}><div className="cf-explorer-form"><label>Pasta de destino</label><input autoFocus value={batchTo} onChange={e=>setBatchTo(e.target.value)} placeholder="outra-pasta/"/><small>O nome de cada arquivo será preservado.</small><div><button onClick={()=>setBatch(null)}>Cancelar</button><button className="primary" onClick={executarLote} disabled={busy}>Aplicar</button></div></div></Modal>}

    <div className="cf-explorer-toolbar"><button className="back" onClick={()=>{setView('overview');setBucketSel(null);setSettingsOpen(false)}}><AdminIcon name="chevL" size={13}/> Espaços</button><Breadcrumb/><div className="cf-explorer-toolbar-actions"><button onClick={()=>setShowFolder(true)} title="Nova pasta" aria-label="Nova pasta"><AdminIcon name="plus" size={13}/> Pasta</button><input ref={fileInputRef} type="file" multiple hidden onChange={e=>{uploadFiles(e.target.files);e.target.value=''}}/><button className="primary" onClick={()=>fileInputRef.current?.click()} title="Upload" aria-label="Enviar arquivos"><AdminIcon name="cloudUp" size={13}/> Upload</button><button onClick={()=>carregarSettings(bn(bucketSel),{open:true})} title="Configurações do bucket" aria-label="Configurações"><AdminIcon name="gear" size={13}/></button><button onClick={()=>setDisplay(display==='list'?'grid':'list')} title="Alternar visualização" aria-label="Alternar visualização"><AdminIcon name="layers" size={13}/></button><button onClick={()=>carregarObjetos(bucketSel,prefix,'')} title="Atualizar" aria-label="Atualizar"><AdminIcon name="refresh" size={13}/></button></div></div>
    <div className="cf-explorer-context"><div><span>BUCKET</span><b title={bn(bucketSel)}>{bn(bucketSel)}</b></div><div><span>USO</span><b>{fmtBytes(bucketUsage?.bytes)}</b></div><div><span>OBJETOS</span><b>{Number(bucketUsage?.objetos||0).toLocaleString('pt-BR')}</b></div>{prefix&&<button className="danger" onClick={()=>prepararExcluirPasta(prefix)}><AdminIcon name="trash" size={12}/> Excluir pasta atual</button>}</div>
    <div className="cf-explorer-controls"><div className="cf-search"><AdminIcon name="seo" size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pesquisar nesta pasta…"/></div><select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} aria-label="Filtrar tipo"><option value="all">Todos os tipos</option><option value="apk">APK</option><option value="image">Imagens</option><option value="video">Vídeos</option><option value="audio">Áudio</option><option value="archive">Compactados</option><option value="document">Documentos</option><option value="other">Outros</option></select><select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Ordenar"><option value="dateDesc">Mais recentes primeiro</option><option value="dateAsc">Mais antigos primeiro</option><option value="nameAsc">A–Z</option><option value="nameDesc">Z–A</option><option value="sizeDesc">Maior tamanho</option><option value="sizeAsc">Menor tamanho</option><option value="typeAsc">Tipo</option></select></div>
    {selected.size>0&&<div className="cf-selection-bar"><b>{selected.size} selecionado(s)</b><button onClick={()=>setBatch('move')}>Mover</button><button onClick={()=>setBatch('copy')}><AdminIcon name="copy" size={12}/> Copiar</button><button className="danger" onClick={deletarSelecionados}><AdminIcon name="trash" size={12}/> Excluir</button><button onClick={()=>setSelected(new Set())}>Limpar</button></div>}

    {uploads.length>0&&<div className="cf-upload-queue"><div className="cf-upload-head"><b>Uploads</b><button onClick={()=>setUploads(old=>old.filter(u=>!['concluido','cancelado'].includes(u.status)))}>Limpar concluídos</button></div>{uploads.map(u=><div key={u.id} className={`cf-upload-item ${u.status}`}><div><b title={u.name}>{u.name}</b><span>{fmtBytes(u.size)} · {u.status}{u.speed>0?` · ${fmtBytes(u.speed)}/s`:''}</span>{u.error&&<small>{u.error}</small>}</div><div className="cf-upload-meter"><span style={{width:`${u.progress||0}%`}}/></div><div className="cf-upload-actions">{['preparando','enviando','fallback'].includes(u.status)&&<button onClick={()=>cancelarUpload(u.id)} title="Cancelar" aria-label="Cancelar"><AdminIcon name="x" size={12}/></button>}{['erro','cancelado'].includes(u.status)&&<button onClick={()=>retryUpload(u.id)} title="Tentar novamente"><AdminIcon name="refresh" size={12}/></button>}</div></div>)}</div>}

    <div className="cf-explorer-drop" onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add('dragging')}} onDragLeave={e=>e.currentTarget.classList.remove('dragging')} onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove('dragging');uploadFiles(e.dataTransfer.files)}}>
      <div className="cf-explorer-list-head"><span>{loadingObj?'Carregando…':`${filteredPrefixes.length} pasta(s) · ${filteredObjects.length} arquivo(s)`}{truncated?' · há mais resultados':''}</span><label><input type="checkbox" checked={filteredObjects.length>0&&selected.size===filteredObjects.length} onChange={()=>toggleAll(filteredObjects)}/> Selecionar arquivos</label></div>
      {loadingObj?<div className="cf-explorer-loading"><Spin size={20}/></div>:(!filteredPrefixes.length&&!filteredObjects.length)?<div className="cf-explorer-empty"><b>{query?'Nenhum resultado':'Pasta vazia'}</b><span>{query?'Tente outro termo.':'Arraste arquivos para cá ou use Upload.'}</span></div>:<div className={`cf-object-area ${display}`}>
        {filteredPrefixes.map(p=><div key={p} className="cf-folder-row"><button className="cf-folder-open" onClick={()=>navPrefix(p)}><AdminIcon name="archive" size={17}/><div><b>{relativeName(p.replace(/\/$/,''))}</b><small>Pasta · prefixo R2</small></div><AdminIcon name="chevR" size={13}/></button><div className="cf-object-actions"><button title="Copiar pasta" aria-label="Copiar pasta" onClick={()=>{setFolderOp({action:'copy',prefix:p});setFolderOpTo(p)}}><AdminIcon name="copy" size={12}/></button><button title="Mover pasta" aria-label="Mover pasta" onClick={()=>{setFolderOp({action:'move',prefix:p});setFolderOpTo(p)}}><AdminIcon name="arrow" size={12}/></button><button className="danger" title="Excluir pasta" aria-label="Excluir pasta" onClick={()=>prepararExcluirPasta(p)}><AdminIcon name="trash" size={12}/></button></div></div>)}
        {filteredObjects.map(o=>{const sel=selected.has(o.key);return <div key={o.key} className={`cf-object-row ${sel?'selected':''}`}><label className="cf-object-check"><input type="checkbox" checked={sel} onChange={()=>toggleSelect(o.key)}/></label><button className="cf-object-open" onClick={()=>abrirPreview(o)}>{isImage(o.key)?<img src={cloudflareService.objectUrl(bn(bucketSel),o.key)} alt="" loading="lazy"/>:<span className="cf-object-icon"><AdminIcon name={iconFor(o.key)} size={display==='grid'?28:17}/></span>}<div><b title={relativeName(o.key)}>{relativeName(o.key)}</b><small>{fmtBytes(o.size)} · {o.uploaded?new Date(o.uploaded).toLocaleString('pt-BR'):'—'} · {extOf(o.key)}</small></div></button><div className="cf-object-actions"><button title="Compartilhar" aria-label="Compartilhar" onClick={()=>abrirCompartilhar(o)}><AdminIcon name="share" size={12}/></button><button title={effectivePublicUrl?"Copiar link público":"Copiar link temporário (1 hora)"} aria-label="Copiar link" onClick={()=>copiarLinkRapido(o)}><AdminIcon name="copy" size={12}/></button><button title="Baixar" aria-label="Baixar" onClick={()=>baixar(o)}><AdminIcon name="cloud" size={12}/></button><button title="Copiar" aria-label="Copiar" onClick={()=>abrirCopiar(o)}><AdminIcon name="copy" size={12}/></button><button title="Mover/Renomear" aria-label="Mover ou renomear" onClick={()=>abrirMover(o)}><AdminIcon name="edit" size={12}/></button><button className="danger" title="Excluir" aria-label="Excluir" onClick={()=>deletarUm(o.key)}><AdminIcon name="trash" size={12}/></button></div></div>})}
      </div>}
      {truncated&&cursor&&<div className="cf-explorer-more"><button onClick={()=>carregarObjetos(bucketSel,prefix,cursor)}>Carregar mais</button></div>}
    </div>
    <style>{CF_EXPLORER_CSS}</style>
  </div>
}

function InfoCell({label,value,copy}){return <div className="cf-info-cell"><small>{label}</small><b title={String(value??'—')}>{value??'—'}</b>{copy&&value&&<button onClick={()=>copy(value,label)} title={`Copiar ${label}`} aria-label={`Copiar ${label}`}><AdminIcon name="copy" size={11}/></button>}</div>}
function DetailRow({label,value,onCopy}){return <div className="cf-detail-row"><small>{label}</small><span title={String(value??'—')}>{value??'—'}</span>{onCopy&&value&&<button onClick={()=>onCopy(value,label)} title={`Copiar ${label}`}><AdminIcon name="copy" size={11}/></button>}</div>}

const CF_EXPLORER_CSS=`
.cf-r2-shell{display:grid;gap:12px;min-width:0;max-width:100%}.cf-r2-shell *{box-sizing:border-box}.cf-r2-public-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid color-mix(in srgb,var(--cf-brand,#f6821f) 30%,var(--adm-border));border-radius:14px;background:color-mix(in srgb,var(--cf-brand,#f6821f) 5%,var(--adm-surface));padding:12px;min-width:0;overflow:hidden}.cf-r2-public-main{display:grid;gap:4px;min-width:0}.cf-r2-public-main small,.cf-explorer-card-head small,.cf-settings header small{font-size:8px;font-weight:950;letter-spacing:.12em;color:var(--cf-brand)}.cf-r2-public-main>b{font-size:12px}.cf-r2-public-main code{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;color:var(--adm-text)}.cf-r2-public-main span{font-size:9px;color:var(--adm-muted);line-height:1.4;overflow-wrap:anywhere}.cf-r2-public-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.cf-r2-public-actions button,.cf-r2-public-actions a,.cf-setting-actions button,.cf-inline-form button,.cf-share-result button,.cf-share-result a{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);color:var(--adm-text);padding:7px 8px;font-size:8.5px;font-weight:850;text-decoration:none}.cf-r2-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:7px;min-width:0}.cf-r2-stats>div,.cf-r2-stats>button{min-width:0;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-surface);padding:10px}.cf-r2-stats span{display:block;font-size:7.5px;font-weight:950;letter-spacing:.09em;color:var(--adm-muted)}.cf-r2-stats b{display:block;margin-top:3px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-r2-stats>button{width:42px;display:grid;place-items:center;color:var(--adm-text)}
.cf-explorer-card,.cf-explorer-drop,.cf-upload-queue{border:1px solid var(--adm-border);border-radius:16px;background:var(--adm-surface);overflow:hidden;min-width:0}.cf-explorer-card-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:start;padding:12px 14px;border-bottom:1px solid var(--adm-border);min-width:0}.cf-explorer-card-head>div{min-width:0}.cf-explorer-card-head h3{font-size:16px;margin:2px 0}.cf-explorer-card-head p{font-size:9px;color:var(--adm-muted);margin:0;line-height:1.35;overflow-wrap:anywhere}.cf-explorer-card-head>button,.cf-explorer-toolbar button,.cf-selection-bar button,.cf-preview-actions button,.cf-upload-head button{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface);color:var(--adm-text);padding:8px 10px;font-size:9px;font-weight:850}.cf-r2-shell button{cursor:pointer}.cf-r2-shell button.primary,.cf-setting-actions .primary,.cf-share-generate{background:#f6821f;color:#fff;border-color:#f6821f}.cf-r2-shell button.danger,.cf-setting-actions .danger,.cf-share-history .danger{color:#ef4444;border-color:#ef444455;background:#ef44440a}
.cf-bucket-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;padding:12px;min-width:0}.cf-bucket-card{position:relative;overflow:hidden;min-width:0;border:1px solid var(--adm-border);border-radius:14px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));color:var(--adm-text)}.cf-bucket-card.default:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#f6821f}.cf-bucket-open{display:block;width:100%;padding:12px;text-align:left;border:0;background:transparent;color:inherit;min-width:0}.cf-bucket-top{display:flex;justify-content:space-between;align-items:center;gap:6px}.cf-bucket-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;border:1px solid var(--adm-border);background:var(--adm-bg);color:var(--cf-brand);font-size:10px;font-weight:950;flex:0 0 auto}.cf-bucket-top em{font-style:normal;font-size:7px;font-weight:950;letter-spacing:.08em;color:#16a34a}.cf-bucket-card h4{margin:12px 0 6px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-bucket-meta{display:flex;flex-wrap:wrap;gap:5px}.cf-bucket-meta span{min-width:0;font-size:8px;color:var(--adm-muted);border:1px solid var(--adm-border);border-radius:999px;padding:4px 6px;overflow:hidden;text-overflow:ellipsis}.cf-bucket-actions{padding:8px 10px;border-top:1px solid var(--adm-border);display:flex;align-items:center;gap:5px}.cf-bucket-actions button{min-width:0;border:0;background:transparent;color:var(--adm-muted);font-size:8px;font-weight:850;display:inline-flex;align-items:center;gap:3px;padding:4px}.cf-bucket-actions .danger{margin-left:auto}
.cf-explorer-toolbar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}.cf-explorer-toolbar .back{white-space:nowrap}.cf-explorer-toolbar-actions{margin-left:auto;display:flex;gap:5px;flex-wrap:wrap}.cf-explorer-crumb{display:flex;align-items:center;gap:4px;min-width:0;max-width:45%;overflow:auto}.cf-explorer-crumb button{border:0;background:transparent;color:var(--cf-brand);padding:4px;font-size:9px;font-weight:800;white-space:nowrap}.cf-explorer-crumb span{color:var(--adm-muted)}.cf-explorer-context{display:grid;grid-template-columns:minmax(0,2fr) 1fr 1fr auto;gap:7px;min-width:0}.cf-explorer-context>div{min-width:0;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-surface);padding:8px 9px}.cf-explorer-context span{display:block;font-size:7px;color:var(--adm-muted);font-weight:900}.cf-explorer-context b{display:block;margin-top:2px;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-explorer-context>button{display:flex;align-items:center;gap:4px;border:1px solid #ef444455;background:#ef44440b;color:#ef4444;border-radius:11px;padding:0 10px;font-size:8px;font-weight:900}.cf-explorer-controls{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px}.cf-search{display:flex;align-items:center;gap:7px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface);padding:0 10px;min-width:0}.cf-search input{min-width:0;width:100%;border:0;background:transparent;color:var(--adm-text);padding:9px 0;outline:none;font-size:10px}.cf-explorer-controls select,.cf-setting-field select,.cf-explorer-form select{border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface);color:var(--adm-text);padding:8px;font-size:9px;max-width:100%}.cf-selection-bar{display:flex;align-items:center;gap:5px;flex-wrap:wrap;border:1px solid color-mix(in srgb,var(--cf-brand) 25%,var(--adm-border));border-radius:11px;padding:7px 9px;background:color-mix(in srgb,var(--cf-brand) 5%,var(--adm-surface))}.cf-selection-bar b{font-size:9px;margin-right:auto}
.cf-explorer-list-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--adm-border);background:var(--adm-surface2);font-size:9px;color:var(--adm-muted)}.cf-explorer-list-head label{display:flex;align-items:center;gap:5px;white-space:nowrap}.cf-object-area.list{display:block}.cf-object-area.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:10px}.cf-folder-row,.cf-object-row{width:100%;display:flex;align-items:center;gap:7px;border-bottom:1px solid var(--adm-border);background:transparent;color:var(--adm-text);padding:8px 10px;min-width:0}.cf-folder-row:hover,.cf-object-row:hover{background:#f6821f08}.cf-folder-open,.cf-object-open{min-width:0;flex:1;display:flex;align-items:center;gap:8px;border:0;background:transparent;color:var(--adm-text);text-align:left;padding:0}.cf-folder-open>div,.cf-object-open>div{display:grid;gap:2px;min-width:0}.cf-folder-open b,.cf-object-open b{font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-folder-open small,.cf-object-open small{font-size:7.8px;color:var(--adm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-object-check{display:grid;place-items:center;flex:0 0 auto}.cf-object-actions{display:flex;gap:3px;margin-left:auto;flex:0 0 auto}.cf-object-actions button{width:28px;height:28px;padding:0;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);color:var(--adm-muted);display:grid;place-items:center}.cf-object-actions .danger{color:#ef4444}.cf-object-open>img{width:34px;height:34px;object-fit:cover;border-radius:7px;background:var(--adm-bg);flex:0 0 auto}.cf-object-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:7px;background:var(--adm-bg);flex:0 0 auto}.cf-object-area.grid .cf-object-row,.cf-object-area.grid .cf-folder-row{position:relative;display:block;border:1px solid var(--adm-border);border-radius:12px;padding:8px;min-width:0}.cf-object-area.grid .cf-object-check{position:absolute;top:7px;left:7px;z-index:2;background:var(--adm-surface);border-radius:5px;padding:2px}.cf-object-area.grid .cf-object-open,.cf-object-area.grid .cf-folder-open{display:grid;gap:7px}.cf-object-area.grid .cf-object-open>img,.cf-object-area.grid .cf-object-icon{width:100%;height:auto;aspect-ratio:1.6;object-fit:cover;border-radius:8px}.cf-object-area.grid .cf-object-actions{margin-top:7px;justify-content:flex-end}.cf-object-area.grid .cf-folder-open>svg{margin:12px auto}.cf-object-area.grid .cf-folder-row .cf-object-actions{margin-top:8px;justify-content:flex-end}.cf-explorer-drop.dragging{outline:2px dashed #f6821f;outline-offset:-5px;background:#f6821f08}.cf-explorer-loading,.cf-explorer-empty{min-height:120px;display:grid;place-items:center;align-content:center;gap:5px;color:var(--adm-muted);font-size:10px;text-align:center;padding:18px}.cf-explorer-empty b{font-size:11px;color:var(--adm-text)}.cf-explorer-more{display:flex;justify-content:center;padding:10px}.cf-explorer-more button{border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);color:var(--adm-text);padding:7px 10px}
.cf-upload-queue{padding:0}.cf-upload-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--adm-border)}.cf-upload-head b{font-size:9px}.cf-upload-head button{padding:5px 7px}.cf-upload-item{display:grid;grid-template-columns:minmax(0,1fr) 120px auto;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--adm-border);min-width:0}.cf-upload-item:last-child{border-bottom:0}.cf-upload-item>div:first-child{display:grid;gap:2px;min-width:0}.cf-upload-item b{font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-upload-item span,.cf-upload-item small{font-size:7.5px;color:var(--adm-muted);overflow-wrap:anywhere}.cf-upload-item small{color:#ef4444}.cf-upload-meter{height:5px;background:var(--adm-border);border-radius:99px;overflow:hidden}.cf-upload-meter span{display:block;height:100%;background:#f6821f}.cf-upload-actions button{width:28px;height:28px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);color:var(--adm-text)}
.cf-explorer-form{padding:4px 0;display:grid;gap:8px}.cf-explorer-form label,.cf-setting-field>span,.cf-cors-grid label>span{font-size:8px;font-weight:900;color:var(--adm-muted)}.cf-explorer-form input,.cf-explorer-form textarea,.cf-setting-field input,.cf-cors-grid input,.cf-cors-grid textarea,.cf-inline-form input,.cf-danger-confirm input,.cf-meta-edit input{width:100%;min-width:0;padding:9px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-bg);color:var(--adm-text);font-size:9px}.cf-explorer-form small,.cf-setting-note{font-size:8px;color:var(--adm-muted);line-height:1.45}.cf-explorer-form>div,.cf-setting-actions{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap;margin-top:5px}.cf-explorer-form button{border:1px solid var(--adm-border);border-radius:9px;padding:8px 10px;background:var(--adm-surface2);color:var(--adm-text);font-size:9px;font-weight:800}
.cf-preview-body{display:grid;gap:10px}.cf-preview-body>img,.cf-preview-body>video{width:100%;max-height:46vh;object-fit:contain;border-radius:12px;background:var(--adm-bg)}.cf-preview-body>audio{width:100%}.cf-file-generic{min-height:120px;border:1px dashed var(--adm-border);border-radius:12px;background:var(--adm-bg);display:grid;place-items:center;align-content:center;gap:6px}.cf-file-generic b{font-size:10px}.cf-file-generic span{font-size:8px;color:var(--adm-muted)}.cf-detail-grid{display:grid;gap:5px}.cf-detail-row{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:7px;align-items:center;border:1px solid var(--adm-border);border-radius:8px;padding:7px 8px;min-width:0}.cf-detail-row small{font-size:7.5px;color:var(--adm-muted);font-weight:850}.cf-detail-row span{font-size:8.5px;overflow-wrap:anywhere;min-width:0}.cf-detail-row button,.cf-info-cell button{width:25px;height:25px;border:0;background:transparent;color:var(--adm-muted);display:grid;place-items:center}.cf-preview-actions{display:flex;justify-content:flex-end;gap:5px;flex-wrap:wrap}.cf-meta-edit{display:grid;gap:7px;border:1px solid var(--adm-border);border-radius:10px;padding:9px}.cf-meta-edit label{display:grid;gap:4px;font-size:8px;color:var(--adm-muted)}.cf-meta-edit>div{display:flex;justify-content:flex-end;gap:5px}.cf-meta-edit button{border:1px solid var(--adm-border);border-radius:8px;padding:7px;background:var(--adm-surface2);color:var(--adm-text)}
.cf-settings{display:grid;gap:10px}.cf-settings section{border:1px solid var(--adm-border);border-radius:13px;background:var(--adm-surface2);padding:11px;min-width:0}.cf-settings header{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px}.cf-settings header h4{font-size:12px;margin:2px 0 0}.cf-setting-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.cf-info-cell{position:relative;display:grid;gap:2px;min-width:0;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface);padding:8px 34px 8px 8px}.cf-info-cell small{font-size:7px;color:var(--adm-muted);font-weight:850}.cf-info-cell b{font-size:8.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-info-cell button{position:absolute;right:4px;top:50%;transform:translateY(-50%)}.cf-setting-field{display:grid;gap:4px;margin-top:8px}.cf-access-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface);padding:9px}.cf-access-row>div{display:grid;gap:2px;min-width:0}.cf-access-row b{font-size:9px}.cf-access-row span,.cf-access-row code{font-size:8px;color:var(--adm-muted);overflow-wrap:anywhere}.cf-access-row button{border:1px solid var(--adm-border);border-radius:8px;padding:7px;background:var(--adm-surface2);color:var(--adm-text);font-size:8px}.cf-domain-list{display:grid;gap:5px;margin-top:8px}.cf-domain-list>b{font-size:8px}.cf-domain-list>p{font-size:8px;color:var(--adm-muted)}.cf-domain-list>div:not(.cf-inline-form){display:flex;align-items:center;justify-content:space-between;gap:7px;padding:7px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface)}.cf-domain-list>div>div{display:grid;gap:2px;min-width:0}.cf-domain-list strong{font-size:8.5px;overflow-wrap:anywhere}.cf-domain-list span{font-size:7.5px;color:var(--adm-muted)}.cf-domain-list button{border:1px solid var(--adm-border);border-radius:7px;background:var(--adm-surface2);color:var(--adm-text);padding:6px}.cf-inline-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px}.cf-cors-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.cf-cors-grid label{display:grid;gap:4px;min-width:0}.cf-cors-grid textarea{min-height:60px;resize:vertical}.cf-cap-list{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.cf-cap-list span{font-size:7.5px;border:1px solid var(--adm-border);border-radius:99px;padding:4px 6px;color:var(--adm-muted)}.cf-cap-list span.ok{color:#16a34a}.cf-cap-list span.off{color:#ef4444}
.cf-danger-confirm{display:grid;gap:8px;text-align:center}.cf-danger-confirm>svg{margin:auto;color:#ef4444}.cf-danger-confirm h4{margin:0;font-size:13px}.cf-danger-confirm p{margin:0;font-size:8.5px;color:var(--adm-muted);line-height:1.45;overflow-wrap:anywhere}.cf-danger-confirm code{font-size:8px}.cf-danger-confirm label{display:grid;gap:5px;text-align:left;font-size:8.5px}.danger-text{color:#ef4444!important}.cf-share{display:grid;gap:9px}.cf-share-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.cf-share-modes button{display:grid;place-items:center;gap:3px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2);color:var(--adm-text);padding:9px;min-width:0}.cf-share-modes button.active{border-color:#f6821f;background:#f6821f0c}.cf-share-modes b{font-size:8.5px}.cf-share-modes span{font-size:7px;color:var(--adm-muted);text-align:center}.cf-share-generate{border:1px solid #f6821f;border-radius:9px;padding:9px;font-size:9px;font-weight:900}.cf-share-result{display:grid;gap:5px;border:1px solid color-mix(in srgb,var(--cf-brand) 35%,var(--adm-border));border-radius:10px;background:color-mix(in srgb,var(--cf-brand) 5%,var(--adm-surface));padding:9px;min-width:0}.cf-share-result small{font-size:7px;font-weight:950;color:var(--cf-brand)}.cf-share-result code{font-size:8px;overflow-wrap:anywhere}.cf-share-result span{font-size:8px;color:var(--adm-muted)}.cf-share-result>div{display:flex;gap:5px;flex-wrap:wrap}.cf-share-history{display:grid;gap:5px}.cf-share-history>b{font-size:8.5px}.cf-share-history>div{display:flex;justify-content:space-between;gap:6px;align-items:center;border:1px solid var(--adm-border);border-radius:8px;padding:7px}.cf-share-history span{font-size:7.5px;color:var(--adm-muted)}.cf-share-history button{border:1px solid #ef444455;border-radius:7px;background:#ef44440a;color:#ef4444;padding:5px;font-size:7.5px}
@media(max-width:760px){.cf-r2-public-card{grid-template-columns:1fr}.cf-r2-public-actions{justify-content:flex-start}.cf-bucket-grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:8px}.cf-explorer-toolbar{align-items:flex-start}.cf-explorer-toolbar-actions{width:100%;margin-left:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}.cf-explorer-toolbar-actions button{padding:8px 4px;font-size:0}.cf-explorer-toolbar-actions button svg{width:15px;height:15px}.cf-explorer-crumb{max-width:100%;order:3;width:100%}.cf-explorer-context{grid-template-columns:repeat(3,minmax(0,1fr))}.cf-explorer-context>div:first-child{grid-column:1/-1}.cf-explorer-context>button{grid-column:1/-1;min-height:36px;justify-content:center}.cf-explorer-controls{grid-template-columns:1fr}.cf-explorer-controls select{width:100%}.cf-object-area.grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:7px}.cf-object-actions{gap:2px}.cf-object-actions button{width:26px;height:26px}.cf-r2-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.cf-r2-stats>button{grid-column:1/-1;width:100%;height:34px}.cf-explorer-card-head{grid-template-columns:minmax(0,1fr) auto;gap:6px}.cf-explorer-card-head>button{font-size:0;padding:8px}.cf-explorer-card-head>button svg{width:15px;height:15px}.cf-explorer-list-head{align-items:flex-start;flex-direction:column}.cf-upload-item{grid-template-columns:minmax(0,1fr) auto}.cf-upload-meter{grid-column:1/-1;grid-row:2}.cf-upload-actions{grid-column:2;grid-row:1}.cf-detail-row{grid-template-columns:78px minmax(0,1fr) auto}.cf-setting-grid,.cf-cors-grid{grid-template-columns:1fr}.cf-share-modes{grid-template-columns:1fr 1fr}.cf-share-modes button{padding:7px 3px}.cf-access-row{grid-template-columns:1fr}.cf-inline-form{grid-template-columns:1fr}.cf-selection-bar b{width:100%;margin:0}.cf-r2-shell{overflow:hidden}}
@media(max-width:420px){.cf-bucket-grid{grid-template-columns:1fr}.cf-object-area.grid{grid-template-columns:1fr 1fr}.cf-share-modes{grid-template-columns:1fr}.cf-central-brand h2{white-space:normal!important;overflow-wrap:anywhere!important}.cf-central-hero{overflow:hidden!important}.cf-central-brand{flex:1 1 auto!important;max-width:100%!important}.cf-central-actions{flex:0 0 auto}.cf-central-stats{min-width:0}.cf-central-stats>*{min-width:0;overflow:hidden}}
`

// ─── ABA: SSL ─────────────────────────────────────────────────
function AbaSsl({ zona }) {
  const [dados,   setDados]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!zona) return
    setLoading(true)
    cloudflareService.ssl(zona.id)
      .then(d => setDados(d))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [zona])

  if (!zona) return (
    <PageCard>
      <p style={{ color: C.muted, textAlign: 'center', padding: 40, fontSize: 13 }}>
        Selecione uma zona na aba <strong>Zonas</strong>.
      </p>
    </PageCard>
  )

  const SSL_MODOS = {
    off:       { cor: CF.err,    label: 'Desligado',    desc: 'Sem criptografia' },
    flexible:  { cor: CF.warn,   label: 'Flexível',     desc: 'CF↔visitante cifrado, CF↔servidor não' },
    full:      { cor: '#3b82f6', label: 'Full',         desc: 'CF↔visitante e CF↔servidor cifrados (sem verificar cert)' },
    strict:    { cor: CF.active, label: 'Full (Strict)', desc: 'Cadeia completa com certificado válido' },
  }
  const modo = SSL_MODOS[dados?.modo?.value] || { cor: C.muted, label: dados?.modo?.value || '—', desc: '' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageCard>
        <SectionTitle icon={<span style={{ fontSize: 16 }}>🔒</span>}>
          Modo SSL/TLS — <span style={{ fontSize: 13, fontWeight: 600, color: modo.cor }}>{zona.name}</span>
        </SectionTitle>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin size={20} /></div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0 10px' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: modo.cor,
                boxShadow: `0 0 6px ${modo.cor}`, flexShrink: 0 }} />
              <span style={{ fontSize: 15, fontWeight: 800, color: modo.cor }}>{modo.label}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{modo.desc}</span>
            </div>
            <Row label="Valor interno" value={dados?.modo?.value} mono />
            <Row label="Editável"      value={dados?.modo?.editable ? 'Sim' : 'Não'} />
          </>
        )}
      </PageCard>

      {dados?.certs?.length > 0 && (
        <PageCard>
          <SectionTitle icon={<span style={{ fontSize: 16 }}>📜</span>}>
            Certificados ({dados.certs.length})
          </SectionTitle>
          {dados.certs.map(cert => {
            const exp = cert.certificates?.[0]?.expires_on
            const sts = cert.status
            const cor = sts === 'active' ? CF.active : sts === 'pending_validation' ? CF.warn : CF.err
            return (
              <div key={cert.id} style={{ padding: `${SPACE.sm}px 0`,
                borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{cert.type}</span>
                  <Badge color={cor}>{sts}</Badge>
                </div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>
                  {cert.hosts?.join(', ')}
                </div>
                {exp && (
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    Expira: {new Date(exp).toLocaleDateString('pt-BR')}
                  </div>
                )}
              </div>
            )
          })}
        </PageCard>
      )}
    </div>
  )
}

// ─── ABA: Firewall / Segurança ─────────────────────────────────
function AbaFirewall({ zona }) {
  const [eventos, setEventos] = useState([])
  const [aviso,   setAviso]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [limit,   setLimit]   = useState(50)

  const carregar = useCallback(async (lim = limit) => {
    if (!zona) return
    setLoading(true)
    try {
      const d = await cloudflareService.firewall(zona.id, lim)
      setEventos(d.eventos || [])
      setAviso(d.aviso    || null)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }, [zona, limit])

  useEffect(() => { carregar() }, [carregar])

  if (!zona) return (
    <PageCard>
      <p style={{ color: C.muted, textAlign: 'center', padding: 40, fontSize: 13 }}>
        Selecione uma zona na aba <strong>Zonas</strong>.
      </p>
    </PageCard>
  )

  const ACAO_COR = {
    block: CF.err, challenge: CF.warn, jschallenge: CF.warn,
    managedChallenge: CF.warn, allow: CF.active, log: '#3b82f6',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>🌐 {zona.name} — últimos:</span>
        {[25, 50, 100].map(n => (
          <button key={n} onClick={() => { setLimit(n); carregar(n) }}
            style={{ padding: '4px 12px', borderRadius: 20, cursor: 'pointer', border: 'none',
              fontSize: 11, background: limit === n ? CF.orange : C.border,
              color: limit === n ? '#fff' : C.text, fontWeight: limit === n ? 700 : 400 }}>
            {n}
          </button>
        ))}
        <Btn onClick={() => carregar()} variant="secondary"
          style={{ width: 'auto', padding: '4px 10px', fontSize: 11 }}>{Ico.refresh}</Btn>
      </div>

      <PageCard style={{ padding: 0 }}>
        {aviso && (
          <div style={{ padding: `${SPACE.md}px ${SPACE.lg}px`, background: CF.warnL,
            borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 12, color: CF.warn }}>⚠ {aviso}</span>
          </div>
        )}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin size={20} /></div>
        ) : eventos.length === 0 ? (
          <p style={{ color: C.muted, textAlign: 'center', padding: 40, fontSize: 13 }}>
            {aviso ? 'Requer plano Pro ou superior.' : 'Nenhum evento de segurança encontrado.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: C.surface2 }}>
                  {['Data/Hora', 'Ação', 'IP', 'País', 'Host', 'URI', 'Regra'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left',
                      color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}`,
                      whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {eventos.map((e, i) => {
                  const acao = e.action || e.type || '—'
                  const cor  = ACAO_COR[acao] || C.muted
                  return (
                    <tr key={e.id || i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '7px 10px', color: C.muted, whiteSpace: 'nowrap' }}>
                        {e.occurred_at ? new Date(e.occurred_at).toLocaleString('pt-BR') : '—'}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <Badge color={cor}>{acao}</Badge>
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: C.text }}>
                        {e.client_ip || e.clientIP || '—'}
                      </td>
                      <td style={{ padding: '7px 10px', color: C.muted }}>
                        {e.country || e.clientCountryName || '—'}
                      </td>
                      <td style={{ padding: '7px 10px', color: C.muted, maxWidth: 140, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.host || '—'}
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: C.muted,
                        maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.uri || '—'}
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: C.muted, fontSize: 10 }}>
                        {e.rule_id || e.ruleId || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageCard>
    </div>
  )
}

// ─── ABA: Page Rules ───────────────────────────────────────────
function AbaPageRules({ zona }) {
  const [regras,  setRegras]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!zona) return
    setLoading(true)
    cloudflareService.pagerules(zona.id)
      .then(d => setRegras(d.pagerules || []))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [zona])

  if (!zona) return (
    <PageCard>
      <p style={{ color: C.muted, textAlign: 'center', padding: 40, fontSize: 13 }}>
        Selecione uma zona na aba <strong>Zonas</strong>.
      </p>
    </PageCard>
  )

  function formatarAcao(action) {
    const label = action.id?.replace(/_/g, ' ') || action.id || '—'
    const valor = typeof action.value === 'object'
      ? JSON.stringify(action.value)
      : String(action.value ?? '')
    return { label, valor }
  }

  return (
    <PageCard>
      <SectionTitle icon={<span style={{ fontSize: 16 }}>📐</span>}>
        Page Rules de {zona.name} ({regras.length})
      </SectionTitle>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin size={20} /></div>
      ) : regras.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13, padding: '20px 0' }}>
          Nenhuma page rule ativa. Gerencie em{' '}
          <a href="https://dash.cloudflare.com" target="_blank" rel="noopener"
            style={{ color: CF.orange }}>dash.cloudflare.com</a>.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: SPACE.md }}>
          {regras.map((r, i) => (
            <div key={r.id || i} style={{
              borderRadius: RADIUS.md, border: `1px solid ${C.border}`,
              background: C.surface2, overflow: 'hidden',
            }}>
              {/* Target URL */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 14px', borderBottom: `1px solid ${C.border}`,
                background: r.status === 'active' ? CF.orangeL : C.border + '44' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.text, flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.targets?.[0]?.constraint?.value || '—'}
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 10 }}>
                  <Badge color={r.status === 'active' ? CF.active : CF.warn}>{r.status}</Badge>
                  <span style={{ fontSize: 11, color: C.muted }}>#{r.priority}</span>
                </div>
              </div>
              {/* Ações */}
              <div style={{ padding: '8px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(r.actions || []).map((a, j) => {
                  const { label, valor } = formatarAcao(a)
                  return (
                    <span key={j} style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 20,
                      background: C.border, color: C.text,
                    }}>
                      <strong style={{ color: CF.orange }}>{label}</strong>
                      {valor && <span style={{ color: C.muted }}> → {valor.slice(0, 40)}</span>}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageCard>
  )
}

export default function AbaCloudflare() {
  const [statusCF,setStatusCF]=useState(null),[dashboard,setDashboard]=useState(null),[loadingStatus,setLoadingStatus]=useState(true)
  const [settingsOpen,setSettingsOpen]=useState(false),[tool,setTool]=useState('menu'),[zonaSelecionada,setZonaSelecionada]=useState(null)

  const carregarStatus=useCallback(async()=>{
    setLoadingStatus(true)
    try{
      const [s,d]=await Promise.all([cloudflareService.status(),cloudflareService.dashboard().catch(()=>null)])
      setStatusCF(s);setDashboard(d)
    }catch(err){setStatusCF({ok:false,erro:err.message})}finally{setLoadingStatus(false)}
  },[])
  useEffect(()=>{carregarStatus()},[carregarStatus])
  const tokenAtivo=statusCF?.ok&&statusCF?.token?.status==='active'
  const subscriptions=dashboard?.subscriptions||[]
  const planNames=Object.entries(dashboard?.zones?.plans||{}).map(([name,count])=>`${name} · ${count}`).join(', ')
  const planMain=subscriptions[0]?.rate_plan?.public_name||subscriptions[0]?.rate_plan?.full_name||subscriptions[0]?.rate_plan?.id||subscriptions[0]?.name||planNames||'Não informado pela API'
  const tools=[
    ['geral','🔑','Conta e token','Identidade, token e credenciais R2'],['recursos','🧭','Produtos','Pages, KV, D1, Queues, Vectorize e AI Gateway'],['zonas','🌐','Zonas e DNS','Domínios e registros DNS'],['ssl','🔒','SSL/TLS','Configuração da zona selecionada'],['firewall','🛡','Segurança','Eventos de firewall'],['pagerules','📐','Page Rules','Regras de página'],['analytics','📊','Analytics','Tráfego e ameaças'],['workers','⚙','Workers','Scripts da conta'],['account','◉','Conta e plano','Contas acessíveis, assinaturas e planos'],['credentials','🔐','Credenciais','Abrir Integrações e APIs'],
  ]
  function selectZone(z){setZonaSelecionada(z);setTool('dns')}
  function openTool(id){if(id==='credentials'){window.location.href='/admin/integracoes?open=cloudflare';return}setTool(id)}
  function closeSettings(){setSettingsOpen(false);setTool('menu')}

  const ToolContent=()=>{
    if(tool==='menu')return <div className="cf-tools-grid">{tools.map(([id,ico,title,desc])=><button key={id} onClick={()=>openTool(id)}><span>{ico}</span><div><b>{title}</b><small>{desc}</small></div><em>→</em></button>)}</div>
    if(tool==='geral')return <AbaGeral status={statusCF} carregando={loadingStatus} recarregar={carregarStatus}/>
    if(tool==='recursos')return <AbaRecursos/>
    if(tool==='zonas')return <AbaZonas onSelecionarZona={selectZone} zonaSelecionada={zonaSelecionada}/>
    if(tool==='dns')return <AbaDns zona={zonaSelecionada}/>
    if(tool==='ssl')return <AbaSsl zona={zonaSelecionada}/>
    if(tool==='firewall')return <AbaFirewall zona={zonaSelecionada}/>
    if(tool==='pagerules')return <AbaPageRules zona={zonaSelecionada}/>
    if(tool==='analytics')return <AbaAnalytics zona={zonaSelecionada}/>
    if(tool==='workers')return <AbaWorkers/>
    if(tool==='account')return <div className="cf-account-panel">
      <section><small>CONTA ATIVA</small><h3>{dashboard?.account?.name||statusCF?.conta?.name||'Cloudflare'}</h3><p>{dashboard?.account?.id||statusCF?.account_id||'—'}</p></section>
      <div className="cf-account-list"><div><b>Contas acessíveis</b><span>{dashboard?.accountsAvailable===false?'O token não permite listar contas.':`${dashboard?.accounts?.length||1} conta(s)`}</span></div>{(dashboard?.accounts||[]).map(a=><div key={a.id}><b>{a.name||'Conta'}</b><code>{a.id}</code></div>)}</div>
      <div className="cf-account-list"><div><b>Assinaturas / plano</b><span>{dashboard?.subscriptionsAvailable===false?'Permissão de billing não disponível para este token.':`${subscriptions.length} assinatura(s)`}</span></div>{subscriptions.length?subscriptions.map((sub,i)=><div key={sub.id||i}><b>{sub.rate_plan?.public_name||sub.rate_plan?.full_name||sub.rate_plan?.id||sub.name||sub.id||'Assinatura'}</b><span>{sub.state||sub.status||sub.frequency||'ativa'}</span>{sub.price!=null&&<code>{sub.currency||'USD'} {sub.price}</code>}</div>):<div><b>Planos das zonas</b><span>{planNames||'Nenhum plano retornado'}</span></div>}</div>
      <div className="cf-account-list"><div><b>R2</b><span>{dashboard?.r2?.available?'Métricas S3 acessíveis':'Métricas detalhadas indisponíveis'}</span></div><div><b>{bytes(dashboard?.r2?.totalBytes||0)}</b><span>{Number(dashboard?.r2?.totalObjetos||0).toLocaleString('pt-BR')} objetos · {(dashboard?.r2?.buckets||[]).length} bucket(s)</span></div></div>
    </div>
    return null
  }

  return <div className="cf-central">
    <section className="cf-central-hero">
      <div className="cf-central-brand"><span className="cf-central-logo">CF</span><div><small>CLOUDFLARE CENTRAL</small><h2>{loadingStatus?'Carregando…':statusCF?.conta?.name||dashboard?.account?.name||'Sua conta Cloudflare'}</h2><p>{tokenAtivo?'API conectada e pronta para administrar recursos':'Conecte a Cloudflare em Integrações e APIs'}</p></div></div>
      <div className="cf-central-actions"><span className={`cf-live ${tokenAtivo?'on':''}`}>{tokenAtivo?'CONECTADO':'OFFLINE'}</span><button onClick={carregarStatus} title="Atualizar">↻</button><button className="gear" onClick={()=>setSettingsOpen(true)} title="Abrir ferramentas Cloudflare">⚙</button></div>
    </section>

    <section className="cf-central-stats">
      <button onClick={()=>{setSettingsOpen(true);setTool('account')}}><small>CONTA</small><b>{dashboard?.account?.name||statusCF?.conta?.name||'—'}</b><span>{dashboard?.accounts?.length>1?`${dashboard.accounts.length} contas acessíveis`:'Conta ativa'}</span></button>
      <button onClick={()=>{setSettingsOpen(true);setTool('account')}}><small>PLANO</small><b>{planMain}</b><span>{subscriptions.length?`${subscriptions.length} assinatura(s)`:(planNames||'Conforme permissão da API')}</span></button>
      <button onClick={()=>{setSettingsOpen(true);setTool('zonas')}}><small>ZONAS</small><b>{dashboard?.zones?.count??'—'}</b><span>{planNames||'Domínios da conta'}</span></button>
      <div><small>R2 STORAGE</small><b>{bytes(dashboard?.r2?.totalBytes||0)}</b><span>{Number(dashboard?.r2?.totalObjetos||0).toLocaleString('pt-BR')} objetos · {(dashboard?.r2?.buckets||statusCF?.s3Credentials?.buckets||[]).length} espaços</span></div>
    </section>

    <section className="cf-explorer-title"><div><small>EXPLORER</small><h3>Arquivos e espaços R2</h3><p>Envie, visualize, baixe, renomeie, mova e apague arquivos sem sair do AL Sistemas.</p></div><span>{statusCF?.s3Credentials?.configurado?(statusCF?.s3Credentials?.valido?'S3 pronto':'S3 precisa de revisão'):'Configure as chaves S3'}</span></section>
    <AbaR2 status={statusCF} onRefreshStatus={carregarStatus}/>

    {settingsOpen&&<DSModal open onClose={closeSettings} title={tool==='menu'?'Ferramentas Cloudflare':tools.find(x=>x[0]===tool)?.[2]||zonaSelecionada?.name||'Detalhes'} size="xl"><div className="cf-tools-ds-head">{tool!=='menu'&&<button className="cf-tools-back" onClick={()=>setTool('menu')}>← Voltar</button>}<small>ADMINISTRAÇÃO CLOUDFLARE</small></div><ToolContent/></DSModal>}
    <style>{`
      .cf-central{display:grid;gap:13px}.cf-central-hero{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px;border:1px solid var(--adm-border);border-radius:18px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));box-shadow:0 12px 34px rgba(15,23,42,.05)}.cf-central-brand{display:flex;align-items:center;gap:11px;min-width:0;max-width:100%;flex:1 1 auto;overflow:hidden}.cf-central-logo{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:color-mix(in srgb,var(--cf-brand) 8%,var(--adm-surface2));border:1px solid color-mix(in srgb,var(--cf-brand) 30%,var(--adm-border));color:var(--cf-brand);font-size:12px;font-weight:950}.cf-central-brand>div{min-width:0}.cf-central-brand small,.cf-explorer-title small{font-size:8px;font-weight:950;letter-spacing:.12em;color:var(--cf-brand)}.cf-central-brand h2{font-size:17px;margin:3px 0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-central-brand p,.cf-explorer-title p{font-size:10px;color:var(--adm-muted);margin:0}.cf-central-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto;max-width:100%}.cf-central-actions button{width:36px;height:36px;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-bg);color:var(--adm-text);font-size:16px}.cf-central-actions .gear{color:var(--cf-brand)}.cf-live{font-size:8px;font-weight:950;letter-spacing:.08em;border:1px solid var(--adm-border);border-radius:999px;padding:6px 8px;color:var(--adm-muted)}.cf-live.on{color:var(--adm-success);border-color:color-mix(in srgb,var(--adm-success) 28%,var(--adm-border));background:color-mix(in srgb,var(--adm-success) 7%,var(--adm-surface))}.cf-central-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.cf-central-stats>button,.cf-central-stats>div{min-width:0;padding:11px 12px;text-align:left;border:1px solid var(--adm-border);border-radius:13px;background:var(--adm-surface);color:var(--adm-text)}.cf-central-stats>button{cursor:pointer}.cf-central-stats small{display:block;font-size:7.5px;font-weight:950;letter-spacing:.1em;color:var(--adm-muted)}.cf-central-stats b{display:block;margin-top:3px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-central-stats span{display:block;margin-top:3px;font-size:8px;color:var(--adm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-explorer-title{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:4px 2px}.cf-explorer-title h3{font-size:15px;margin:2px 0}.cf-explorer-title>span{font-size:8px;font-weight:850;color:var(--adm-muted);border:1px solid var(--adm-border);border-radius:999px;padding:5px 7px}.cf-tools-modal-bg{position:fixed;inset:0;z-index:1350;background:#0009;display:grid;place-items:center;padding:14px}.cf-tools-modal{width:min(900px,100%);max-height:calc(100dvh - 28px);overflow:hidden;border:1px solid var(--adm-border);border-radius:20px;background:var(--adm-surface);box-shadow:0 24px 90px #0008;display:grid;grid-template-rows:auto minmax(0,1fr)}.cf-tools-modal>header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid var(--adm-border)}.cf-tools-modal>header>div{display:grid;gap:2px}.cf-tools-modal header small{font-size:7.5px;font-weight:950;letter-spacing:.12em;color:var(--cf-brand)}.cf-tools-modal header b{font-size:13px}.cf-tools-modal header button{width:32px;height:32px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2);color:var(--adm-text)}.cf-tools-modal>main{overflow:auto;padding:13px}.cf-tools-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.cf-tools-grid button{min-height:92px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;padding:11px;text-align:left;border:1px solid var(--adm-border);border-radius:14px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));color:var(--adm-text)}.cf-tools-grid button>span{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--adm-bg);border:1px solid var(--adm-border)}.cf-tools-grid button>div{display:grid;gap:3px;min-width:0}.cf-tools-grid b{font-size:10px}.cf-tools-grid small{font-size:8px;color:var(--adm-muted);line-height:1.35}.cf-tools-grid em{font-style:normal;color:var(--cf-brand)}.cf-account-panel{display:grid;gap:10px}.cf-account-panel>section,.cf-account-list{border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface2);padding:12px}.cf-account-panel>section small{font-size:8px;font-weight:950;letter-spacing:.1em;color:var(--cf-brand)}.cf-account-panel h3{margin:4px 0;font-size:16px}.cf-account-panel p{margin:0;font-family:monospace;font-size:9px;color:var(--adm-muted);overflow-wrap:anywhere}.cf-account-list{display:grid;gap:7px}.cf-account-list>div{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:7px;border-bottom:1px solid var(--adm-border)}.cf-account-list>div:last-child{border-bottom:0;padding-bottom:0}.cf-account-list b{font-size:10px}.cf-account-list span,.cf-account-list code{font-size:8.5px;color:var(--adm-muted);overflow-wrap:anywhere;text-align:right}
      .cf-tools-ds-head{display:flex;align-items:center;gap:9px;margin:-2px 0 12px}.cf-tools-ds-head small{font-size:7.5px;font-weight:950;letter-spacing:.12em;color:var(--cf-brand)}.cf-tools-ds-head .cf-tools-back{border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2);color:var(--adm-text);padding:7px 9px;font-size:9px;font-weight:800}
      @media(max-width:760px){.cf-central-hero{align-items:flex-start}.cf-central-actions{flex-wrap:wrap;justify-content:flex-end}.cf-live{display:none}.cf-central-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.cf-explorer-title{align-items:flex-start;flex-direction:column}.cf-tools-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cf-tools-modal-bg{padding:10px}.cf-tools-modal{max-height:calc(100dvh - 20px)}}
    `}</style>
  </div>
}

