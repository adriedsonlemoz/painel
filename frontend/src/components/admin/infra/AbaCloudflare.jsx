import { confirmAction } from '../../../utils/confirmAction.js'
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

function CredentialSecretRow({ label, field, info }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => () => setValue(''), [])

  const fetchValue = async () => {
    if (!info?.configured) throw new Error(`${label} não configurada.`)
    if (info?.revealable === false) throw new Error('Esta credencial não pode ser recuperada nesta instalação.')
    const r = await cloudflareService.revelarCredencial(field)
    return String(r?.value || '')
  }
  const reveal = async () => {
    if (value) { setValue(''); return }
    setBusy(true)
    try { setValue(await fetchValue()) }
    catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }
  const copy = async () => {
    setBusy(true)
    try {
      const v = value || await fetchValue()
      await navigator.clipboard.writeText(v)
      toast.success('Copiado')
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ padding: `${SPACE.sm}px 0`, borderBottom: `1px solid ${C.border}`, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
            Origem: {info?.source || 'não identificada'} · {info?.configured ? 'Configurada' : 'Não configurada'}
          </div>
        </div>
        {info?.configured && info?.revealable !== false && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flexShrink: 0 }}>
            <button type="button" onClick={reveal} disabled={busy} aria-label={`${value ? 'Ocultar' : 'Visualizar'} ${label}`} title={`${value ? 'Ocultar' : 'Visualizar'} ${label}`}
              style={{ border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '5px 8px', background: C.surface2, color: C.text, fontSize: 10, cursor: 'pointer' }}>
              {busy ? '…' : value ? 'Ocultar' : 'Visualizar'}
            </button>
            <button type="button" onClick={copy} disabled={busy} aria-label={`Copiar ${label}`} title={`Copiar ${label}`}
              style={{ border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '5px 8px', background: C.surface2, color: C.text, fontSize: 10, cursor: 'pointer' }}>
              Copiar
            </button>
          </div>
        )}
        {info?.configured && info?.revealable === false && <small style={{color:C.muted}}>Valor protegido nesta origem</small>}
      </div>
      <code style={{ display: 'block', marginTop: 7, maxWidth: '100%', minWidth: 0, padding: '7px 8px', borderRadius: RADIUS.sm, background: C.surface2, color: value ? C.text : C.muted, fontSize: 10, whiteSpace: value ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', overflowWrap: 'anywhere', wordBreak: value ? 'break-all' : 'normal' }}>
        {value || info?.masked || '—'}
      </code>
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

  const { token, conta } = status || {}
  const cloudflareApiOk = Boolean(status?.ok)
  const statusCor = token?.status === 'active' ? CF.active : CF.warn

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!cloudflareApiOk && (
        <PageCard>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 4 }}>
            <div aria-hidden="true" style={{ fontSize: 24, lineHeight: 1 }}>☁️</div>
            <div style={{ minWidth: 0 }}>
              <p style={{ color: CF.err, fontWeight: 700, margin: '0 0 6px' }}>API principal Cloudflare não validada</p>
              <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, margin: '0 0 6px', overflowWrap: 'anywhere' }}>{status?.erro || 'O token principal ainda não foi configurado ou testado.'}</p>
              <p style={{ color: C.muted, fontSize: 11, lineHeight: 1.5, margin: 0 }}>
                As credenciais abaixo são verificadas separadamente. Você ainda pode visualizar, copiar ou revisar as chaves R2 que o AL Sistemas realmente possui.
              </p>
            </div>
          </div>
        </PageCard>
      )}
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
        <CredentialSecretRow label="API Token" field="secret" info={status?.credentialStatus?.apiToken} />
        <Row label="Nome"         value={token?.name} />
        <Row label="Account ID"   value={status?.account_id} mono />
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
            <CredentialSecretRow label="Access Key ID" field="r2AccessKeyId" info={status?.credentialStatus?.r2AccessKeyId || {configured:Boolean(status.s3Credentials.accessKeyMasked),masked:status.s3Credentials.accessKeyMasked}} />
            <CredentialSecretRow label="Secret Access Key" field="r2SecretAccessKey" info={status?.credentialStatus?.r2SecretAccessKey || {configured:Boolean(status.s3Credentials.secretMasked),masked:status.s3Credentials.secretMasked}} />
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
    if(!await confirmAction(`Excluir "${label}" da Cloudflare? Esta ação pode remover dados/configuração.`))return
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
    if (!await confirmAction(`Purgar TODO o cache de "${zona.name}"? Isso pode aumentar o tráfego temporariamente.`)) return
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
  const [selected,setSelected]=useState(new Set()),[uploading,setUploading]=useState(false),[uploadProgress,setUploadProgress]=useState(0)
  const [showCreateBucket,setShowCreateBucket]=useState(false),[nomeBucket,setNomeBucket]=useState(''),[busy,setBusy]=useState(false)
  const [showFolder,setShowFolder]=useState(false),[folderName,setFolderName]=useState('')
  const [preview,setPreview]=useState(null),[previewInfo,setPreviewInfo]=useState(null),[previewBusy,setPreviewBusy]=useState(false)
  const [moveItem,setMoveItem]=useState(null),[moveTo,setMoveTo]=useState('')
  const [display,setDisplay]=useState('list')
  const [publicAccess,setPublicAccess]=useState(null),[loadingPublic,setLoadingPublic]=useState(false)
  const fileInputRef=React.useRef(null)
  const dropRef=React.useRef(null)
  const bn=b=>b?.nome||b?.name||''
  const fmtBytes=n=>bytes(Number(n||0))
  const isImage=key=>/\.(avif|gif|jpe?g|png|svg|webp)$/i.test(key||'')
  const isVideo=key=>/\.(mp4|webm|mov|m4v)$/i.test(key||'')
  const isAudio=key=>/\.(mp3|wav|ogg|m4a)$/i.test(key||'')
  const nameOf=key=>String(key||'').replace(prefix,'').split('/').filter(Boolean).pop()||key
  const defaultBucket=String(status?.s3Credentials?.bucket||'').trim()
  const effectivePublicUrl=String(publicAccess?.publicUrl||status?.s3Credentials?.publicUrl||'').trim()

  const carregarPublicAccess=useCallback(async(bucket,{quiet=false}={})=>{
    const name=String(bucket||'').trim()
    if(!name){setPublicAccess(null);return null}
    setLoadingPublic(true)
    try{
      const data=await cloudflareService.publicUrlR2(name)
      setPublicAccess(data)
      return data
    }catch(err){
      setPublicAccess({bucket:name,publicUrl:null,error:err.message})
      if(!quiet)toast.error(err.message)
      return null
    }finally{setLoadingPublic(false)}
  },[])

  useEffect(()=>{
    if(defaultBucket)carregarPublicAccess(defaultBucket,{quiet:true})
    else setPublicAccess(null)
  },[defaultBucket,carregarPublicAccess])

  async function copiarUrlPublica(){
    const url=effectivePublicUrl
    if(!url)return
    try{await navigator.clipboard.writeText(url);toast.success('URL pública do R2 copiada.')}
    catch{toast.error('Não foi possível copiar a URL.')}
  }

  async function aplicarR2NaProducao(provider){
    const url=effectivePublicUrl
    if(!url)return toast.error('Nenhuma URL pública do R2 disponível.')
    const nome=provider==='vercel'?'Vercel':'Render'
    const withDeploy=provider==='vercel'
    const pergunta=withDeploy
      ? `Definir CF_R2_PUBLIC_URL no frontend principal da ${nome} e iniciar um novo deploy?`
      : `Definir CF_R2_PUBLIC_URL no backend principal da ${nome}? A alteração será usada no próximo deploy.`
    if(!await confirmAction(pergunta))return
    setBusy(true)
    try{
      const r=await infraestruturaService.aplicarVariavelProducao(provider,'CF_R2_PUBLIC_URL',url,{deploy:withDeploy})
      toast.success(r.mensagem||`CF_R2_PUBLIC_URL enviada à ${nome}.`)
    }catch(err){toast.error(err.message)}finally{setBusy(false)}
  }

  const carregarOverview=useCallback(async()=>{
    setLoading(true)
    try{
      const [b,u]=await Promise.all([cloudflareService.listarBuckets(),cloudflareService.usageR2().catch(()=>null)])
      setBuckets((b.buckets||[]).map(x=>({...x,nome:x.nome||x.name})))
      setUsage(u)
    }catch(err){toast.error(err.message)}finally{setLoading(false)}
  },[])
  useEffect(()=>{carregarOverview()},[carregarOverview])

  const carregarObjetos=useCallback(async(b,pref='',cur='')=>{
    if(!b)return
    setLoadingObj(true)
    try{
      const d=await cloudflareService.listarObjetos(bn(b),{prefix:pref,cursor:cur,limit:250,delim:'/'})
      const clean=(d.objetos||[]).filter(o=>!String(o.key||'').endsWith('/.keep'))
      if(cur)setObjetos(old=>[...old,...clean]);else setObjetos(clean)
      if(cur)setPrefixos(old=>Array.from(new Set([...old,...(d.prefixos||[])])));else setPrefixos(d.prefixos||[])
      setTruncated(Boolean(d.truncated));setCursor(d.cursor||'');setSelected(new Set())
    }catch(err){toast.error(err.message)}finally{setLoadingObj(false)}
  },[])

  function abrirBucket(b){setBucketSel(b);setPrefix('');setView('browser');setSelected(new Set());carregarObjetos(b,'','')}
  function navPrefix(p){setPrefix(p);setSelected(new Set());carregarObjetos(bucketSel,p,'')}
  function Breadcrumb(){const parts=prefix.split('/').filter(Boolean);return <div className="cf-explorer-crumb"><button onClick={()=>navPrefix('')}>{bn(bucketSel)}</button>{parts.map((part,i)=>{const target=parts.slice(0,i+1).join('/')+'/';return <React.Fragment key={target}><span>/</span><button onClick={()=>navPrefix(target)}>{part}</button></React.Fragment>})}</div>}

  async function definirPadrao(bucket,e){e?.stopPropagation?.();try{const r=await cloudflareService.definirBucketPadrao(bucket);if(r.publicAccess)setPublicAccess(r.publicAccess);toast.success(r.mensagem||'Bucket padrão atualizado');await onRefreshStatus?.();if(!r.publicAccess)await carregarPublicAccess(bucket,{quiet:true})}catch(err){toast.error(err.message)}}
  async function criarBucket(){const name=nomeBucket.trim();if(!name)return;setBusy(true);try{await cloudflareService.criarBucket(name);toast.success(`Bucket ${name} criado`);setNomeBucket('');setShowCreateBucket(false);await carregarOverview()}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  async function excluirBucket(bucket,e){e?.stopPropagation?.();if(!await confirmAction(`Excluir o bucket “${bucket}”? Ele precisa estar vazio.`))return;setBusy(true);try{await cloudflareService.deletarBucket(bucket);toast.success('Bucket removido');await carregarOverview()}catch(err){toast.error(err.message)}finally{setBusy(false)}}

  async function uploadFiles(filesLike){const files=Array.from(filesLike||[]);if(!files.length||!bucketSel)return;setUploading(true);setUploadProgress(0);let ok=0
    try{for(let i=0;i<files.length;i++){const file=files[i];await cloudflareService.uploadObjeto(bn(bucketSel),prefix,file,p=>setUploadProgress(Math.round(((i+p/100)/files.length)*100)));ok++}toast.success(`${ok} arquivo(s) enviado(s)`);await carregarObjetos(bucketSel,prefix,'');await carregarOverview()}
    catch(err){toast.error(`${ok} enviado(s); falha: ${err.message}`)}finally{setUploading(false);setUploadProgress(0)}
  }
  async function criarPasta(){const n=folderName.trim().replace(/^\/+|\/+$/g,'');if(!n)return;setBusy(true);try{await cloudflareService.criarPasta(bn(bucketSel),prefix,n);toast.success('Pasta criada');setFolderName('');setShowFolder(false);await carregarObjetos(bucketSel,prefix,'')}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  async function deletarUm(key){if(!await confirmAction(`Excluir “${nameOf(key)}”?`))return;try{await cloudflareService.deletarObjeto(bn(bucketSel),key);toast.success('Arquivo removido');await carregarObjetos(bucketSel,prefix,'')}catch(err){toast.error(err.message)}}
  async function deletarSelecionados(){const keys=[...selected];if(!keys.length||!await confirmAction(`Excluir ${keys.length} arquivo(s)?`))return;setBusy(true);try{const d=await cloudflareService.deletarObjetos(bn(bucketSel),keys);if(d.erros?.length)toast.error(`${d.deletados||0} removido(s), ${d.erros.length} falha(s)`);else toast.success(`${keys.length} arquivo(s) removido(s)`);await carregarObjetos(bucketSel,prefix,'')}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  function toggleSelect(key){setSelected(old=>{const n=new Set(old);n.has(key)?n.delete(key):n.add(key);return n})}
  function toggleAll(){setSelected(selected.size===objetos.length?new Set():new Set(objetos.map(o=>o.key)))}

  async function abrirPreview(o){setPreview(o);setPreviewInfo(null);setPreviewBusy(true);try{setPreviewInfo(await cloudflareService.infoObjeto(bn(bucketSel),o.key))}catch(err){toast.error(err.message)}finally{setPreviewBusy(false)}}
  function abrirMover(o){setMoveItem(o);setMoveTo(o.key)}
  async function mover(){const to=String(moveTo||'').trim().replace(/^\//,'');if(!moveItem||!to)return;setBusy(true);try{await cloudflareService.moverObjeto(bn(bucketSel),moveItem.key,to);toast.success('Arquivo movido/renomeado');setMoveItem(null);await carregarObjetos(bucketSel,prefix,'')}catch(err){toast.error(err.message)}finally{setBusy(false)}}
  function baixar(o){window.open(cloudflareService.objectUrl(bn(bucketSel),o.key,{download:true}),'_blank','noopener')}

  const Modal=({title,onClose,children})=><DSModal open onClose={onClose} title={title} size="lg">{children}</DSModal>

  if(view==='overview')return <div className="cf-r2-shell">
    {showCreateBucket&&<Modal title="Novo bucket R2" onClose={()=>setShowCreateBucket(false)}><div className="cf-explorer-form"><label>Nome do bucket</label><input autoFocus value={nomeBucket} onChange={e=>setNomeBucket(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-'))} placeholder="meu-bucket" onKeyDown={e=>e.key==='Enter'&&criarBucket()}/><small>Use letras minúsculas, números e hífens.</small><div><button onClick={()=>setShowCreateBucket(false)}>Cancelar</button><button className="primary" onClick={criarBucket} disabled={busy||!nomeBucket}>Criar</button></div></div></Modal>}
    <div className="cf-r2-stats"><div><span>ARMAZENAMENTO</span><b>{fmtBytes(usage?.totalBytes)}</b></div><div><span>OBJETOS</span><b>{Number(usage?.totalObjetos||0).toLocaleString('pt-BR')}</b></div><div><span>BUCKETS</span><b>{buckets.length}</b></div><button onClick={carregarOverview} title="Atualizar">↻</button></div>
    {defaultBucket&&<div className="cf-r2-public-card">
      <div className="cf-r2-public-main">
        <small>URL PÚBLICA · BUCKET PADRÃO</small>
        <b>{defaultBucket}</b>
        {loadingPublic?<span>Consultando domínios na Cloudflare…</span>:effectivePublicUrl?<>
          <code>{effectivePublicUrl}</code>
          <span>{publicAccess?.publicUrl?(publicAccess.source==='custom'?'Domínio personalizado detectado automaticamente.':'URL r2.dev detectada automaticamente.'):'URL salva manualmente na integração.'} Use esta URL como <b>CF_R2_PUBLIC_URL</b> na Vercel.</span>
        </>:<span>{publicAccess?.error||'Nenhum domínio público habilitado foi detectado para este bucket. Ative um domínio personalizado ou o acesso r2.dev na Cloudflare.'}</span>}
      </div>
      <div className="cf-r2-public-actions">
        <button onClick={()=>carregarPublicAccess(defaultBucket)} disabled={loadingPublic}>{loadingPublic?'…':'Verificar'}</button>
        <button onClick={copiarUrlPublica} disabled={!effectivePublicUrl}>Copiar</button>
        <button onClick={()=>aplicarR2NaProducao('vercel')} disabled={!effectivePublicUrl||busy}>Aplicar na Vercel</button>
        <button onClick={()=>aplicarR2NaProducao('render')} disabled={!effectivePublicUrl||busy}>Salvar na Render</button>
        {effectivePublicUrl&&<a href={effectivePublicUrl} target="_blank" rel="noreferrer">Abrir ↗</a>}
      </div>
    </div>}
    <div className="cf-explorer-card">
      <div className="cf-explorer-card-head"><div><small>R2 STORAGE</small><h3>Seus espaços</h3><p>Abra um bucket para administrar arquivos como em um Explorer.</p></div><button className="primary" onClick={()=>setShowCreateBucket(true)}>+ Novo bucket</button></div>
      {loading?<div className="cf-explorer-loading"><Spin size={20}/></div>:!buckets.length?<div className="cf-explorer-empty"><b>Nenhum bucket encontrado</b><span>Crie o primeiro espaço de armazenamento R2.</span></div>:<div className="cf-bucket-grid">{buckets.map(b=>{const name=bn(b),u=usage?.buckets?.find(x=>(x.nome||x.name)===name);const isDefault=name===status?.s3Credentials?.bucket;return <button key={name} className={`cf-bucket-card ${isDefault?'default':''}`} onClick={()=>abrirBucket(b)}><div className="cf-bucket-top"><span className="cf-bucket-icon">R2</span>{isDefault&&<em>PADRÃO AL</em>}</div><h4>{name}</h4><div className="cf-bucket-meta"><span>{fmtBytes(u?.bytes)}</span><span>{Number(u?.objetos||0).toLocaleString('pt-BR')} objetos</span></div><div className="cf-bucket-actions"><span onClick={e=>definirPadrao(name,e)}>{isDefault?'Em uso':'Usar no AL'}</span><span className="danger" onClick={e=>excluirBucket(name,e)}>Excluir</span><b>→</b></div></button>})}</div>}
    </div>
    <style>{CF_EXPLORER_CSS}</style>
  </div>

  const bucketUsage=usage?.buckets?.find(x=>(x.nome||x.name)===bn(bucketSel))
  return <div className="cf-r2-shell">
    {showFolder&&<Modal title="Nova pasta" onClose={()=>setShowFolder(false)}><div className="cf-explorer-form"><label>Nome</label><input autoFocus value={folderName} onChange={e=>setFolderName(e.target.value)} placeholder="imagens" onKeyDown={e=>e.key==='Enter'&&criarPasta()}/><small>Será criada dentro de {prefix||'/'}</small><div><button onClick={()=>setShowFolder(false)}>Cancelar</button><button className="primary" onClick={criarPasta} disabled={busy||!folderName.trim()}>Criar pasta</button></div></div></Modal>}
    {moveItem&&<Modal title="Mover ou renomear" onClose={()=>setMoveItem(null)}><div className="cf-explorer-form"><label>Novo caminho</label><input autoFocus value={moveTo} onChange={e=>setMoveTo(e.target.value)} onKeyDown={e=>e.key==='Enter'&&mover()}/><small>Você pode alterar só o nome ou mover para outra pasta informando o caminho completo.</small><div><button onClick={()=>setMoveItem(null)}>Cancelar</button><button className="primary" onClick={mover} disabled={busy||!moveTo.trim()}>Aplicar</button></div></div></Modal>}
    {preview&&<Modal title={nameOf(preview.key)} onClose={()=>{setPreview(null);setPreviewInfo(null)}}><div className="cf-preview-body">{previewBusy?<div className="cf-explorer-loading"><Spin size={20}/></div>:<>{isImage(preview.key)&&<img src={cloudflareService.objectUrl(bn(bucketSel),preview.key)} alt={nameOf(preview.key)}/>} {isVideo(preview.key)&&<video controls src={cloudflareService.objectUrl(bn(bucketSel),preview.key)}/>} {isAudio(preview.key)&&<audio controls src={cloudflareService.objectUrl(bn(bucketSel),preview.key)}/>} {!isImage(preview.key)&&!isVideo(preview.key)&&!isAudio(preview.key)&&<div className="cf-file-generic">📄<b>{nameOf(preview.key)}</b><span>Prévia visual não disponível para este formato.</span></div>}<div className="cf-preview-info"><span><b>Tamanho</b>{fmtBytes(previewInfo?.size??preview.size)}</span><span><b>Tipo</b>{previewInfo?.contentType||'—'}</span><span><b>Modificado</b>{previewInfo?.lastModified?new Date(previewInfo.lastModified).toLocaleString('pt-BR'):'—'}</span><span><b>ETag</b>{previewInfo?.etag||preview.etag||'—'}</span></div><div className="cf-preview-actions"><button onClick={()=>baixar(preview)}>⇩ Baixar</button><button onClick={()=>{setPreview(null);abrirMover(preview)}}>Renomear / mover</button></div></>}</div></Modal>}

    <div className="cf-explorer-toolbar">
      <button className="back" onClick={()=>{setView('overview');setBucketSel(null)}}>← Espaços</button><Breadcrumb/>
      <div className="cf-explorer-toolbar-actions"><button onClick={()=>setShowFolder(true)}>+ Pasta</button><input ref={fileInputRef} type="file" multiple hidden onChange={e=>{uploadFiles(e.target.files);e.target.value=''}}/><button className="primary" onClick={()=>fileInputRef.current?.click()} disabled={uploading}>{uploading?`Enviando ${uploadProgress}%`:'↑ Enviar arquivos'}</button><button onClick={()=>setDisplay(display==='list'?'grid':'list')} title="Alternar visualização">{display==='list'?'▦':'☷'}</button><button onClick={()=>carregarObjetos(bucketSel,prefix,'')} title="Atualizar">↻</button></div>
    </div>
    <div className="cf-explorer-context"><div><span>BUCKET</span><b>{bn(bucketSel)}</b></div><div><span>USO</span><b>{fmtBytes(bucketUsage?.bytes)}</b></div><div><span>OBJETOS</span><b>{Number(bucketUsage?.objetos||0).toLocaleString('pt-BR')}</b></div>{selected.size>0&&<button className="danger" onClick={deletarSelecionados} disabled={busy}>Excluir {selected.size}</button>}</div>
    <div ref={dropRef} className={`cf-explorer-drop ${uploading?'uploading':''}`} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add('dragging')}} onDragLeave={e=>e.currentTarget.classList.remove('dragging')} onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove('dragging');uploadFiles(e.dataTransfer.files)}}>
      <div className="cf-explorer-list-head"><span>{loadingObj?'Carregando…':`${prefixos.length} pasta(s) · ${objetos.length} arquivo(s)`}</span><label><input type="checkbox" checked={objetos.length>0&&selected.size===objetos.length} onChange={toggleAll}/> Selecionar arquivos</label></div>
      {loadingObj?<div className="cf-explorer-loading"><Spin size={20}/></div>:(!prefixos.length&&!objetos.length)?<div className="cf-explorer-empty"><b>Pasta vazia</b><span>Arraste arquivos para cá ou use “Enviar arquivos”.</span></div>:<div className={`cf-object-area ${display}`}>
        {prefixos.map(p=><button key={p} className="cf-folder-row" onClick={()=>navPrefix(p)}><span>📁</span><div><b>{p.replace(prefix,'').replace(/\/$/,'')}</b><small>Pasta</small></div><em>→</em></button>)}
        {objetos.map(o=>{const sel=selected.has(o.key),image=isImage(o.key);return <div key={o.key} className={`cf-object-row ${sel?'selected':''}`}><label className="cf-object-check"><input type="checkbox" checked={sel} onChange={()=>toggleSelect(o.key)}/></label><button className="cf-object-open" onClick={()=>abrirPreview(o)}>{display==='grid'&&image?<img src={cloudflareService.objectUrl(bn(bucketSel),o.key)} alt="" loading="lazy"/>:<span className="cf-object-icon">{image?'🖼':isVideo(o.key)?'🎬':isAudio(o.key)?'🎵':'📄'}</span>}<div><b>{nameOf(o.key)}</b><small>{fmtBytes(o.size)}{o.uploaded?` · ${new Date(o.uploaded).toLocaleDateString('pt-BR')}`:''}</small></div></button><div className="cf-object-actions"><button onClick={()=>baixar(o)} title="Baixar">⇩</button><button onClick={()=>abrirMover(o)} title="Renomear ou mover">✎</button><button className="danger" onClick={()=>deletarUm(o.key)} title="Excluir">×</button></div></div>})}
      </div>}
      {truncated&&cursor&&<div className="cf-explorer-more"><button onClick={()=>carregarObjetos(bucketSel,prefix,cursor)}>Carregar mais</button></div>}
      {uploading&&<div className="cf-upload-progress"><span style={{width:`${uploadProgress}%`}}/></div>}
    </div>
    <style>{CF_EXPLORER_CSS}</style>
  </div>
}

const CF_EXPLORER_CSS=`
.cf-r2-shell{display:grid;gap:12px}.cf-r2-public-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid color-mix(in srgb,var(--cf-brand,#f6821f) 30%,var(--adm-border));border-radius:14px;background:color-mix(in srgb,var(--cf-brand,#f6821f) 5%,var(--adm-surface));padding:11px 12px}.cf-r2-public-main{min-width:0;display:grid;gap:4px}.cf-r2-public-main small{font-size:8px;font-weight:900;letter-spacing:.1em;color:var(--cf-brand,#f6821f)}.cf-r2-public-main>b{font-size:11px}.cf-r2-public-main code{display:block;padding:7px 8px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-bg);font-size:9px;overflow-wrap:anywhere;color:var(--adm-text)}.cf-r2-public-main span{font-size:9px;line-height:1.45;color:var(--adm-muted)}.cf-r2-public-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.cf-r2-public-actions button,.cf-r2-public-actions a{border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface);color:var(--adm-text);padding:7px 9px;font:inherit;font-size:9px;font-weight:850;text-decoration:none;cursor:pointer}.cf-r2-public-actions button:disabled{opacity:.45;cursor:not-allowed}.cf-r2-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:8px;align-items:stretch}.cf-r2-stats>div,.cf-explorer-context>div{border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-surface);padding:10px 12px;min-width:0}.cf-r2-stats span,.cf-explorer-context span{display:block;font-size:8px;font-weight:900;letter-spacing:.1em;color:var(--adm-muted)}.cf-r2-stats b,.cf-explorer-context b{display:block;font-size:13px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-r2-stats>button{width:40px;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-surface);color:var(--adm-text);font-size:18px}.cf-explorer-card,.cf-explorer-drop{border:1px solid var(--adm-border);border-radius:16px;background:var(--adm-surface);overflow:hidden}.cf-explorer-card-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:start;padding:12px 14px;border-bottom:1px solid var(--adm-border)}.cf-explorer-card-head small{font-size:8px;font-weight:950;letter-spacing:.12em;color:var(--cf-brand)}.cf-explorer-card-head h3{font-size:16px;margin:2px 0}.cf-explorer-card-head p{font-size:9px;color:var(--adm-muted);margin:0;line-height:1.35}.cf-explorer-card-head>button{align-self:start;white-space:nowrap;padding:7px 10px;font-size:9px}.cf-explorer-card button,.cf-r2-shell button{cursor:pointer}.cf-r2-shell button.primary,.cf-explorer-form button.primary,.cf-explorer-toolbar button.primary{background:#f6821f;color:#fff;border-color:var(--cf-brand)}.cf-bucket-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;padding:12px}.cf-bucket-card{position:relative;overflow:hidden;min-height:145px;padding:12px;text-align:left;border:1px solid var(--adm-border);border-radius:14px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));color:var(--adm-text)}.cf-bucket-card.default:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#f6821f}.cf-bucket-top{display:flex;justify-content:space-between;align-items:center}.cf-bucket-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;border:1px solid var(--adm-border);background:var(--adm-bg);color:var(--cf-brand);font-size:10px;font-weight:950}.cf-bucket-top em{font-style:normal;font-size:7px;font-weight:950;letter-spacing:.08em;color:#16a34a}.cf-bucket-card h4{margin:12px 0 6px;font-size:12px;overflow:hidden;text-overflow:ellipsis}.cf-bucket-meta{display:flex;flex-wrap:wrap;gap:5px}.cf-bucket-meta span{font-size:8px;color:var(--adm-muted);border:1px solid var(--adm-border);border-radius:999px;padding:4px 6px}.cf-bucket-actions{margin-top:12px;padding-top:9px;border-top:1px solid var(--adm-border);display:flex;align-items:center;gap:8px;font-size:8px;font-weight:850;color:var(--adm-muted)}.cf-bucket-actions span:hover{color:var(--cf-brand)}.cf-bucket-actions .danger:hover{color:#ef4444}.cf-bucket-actions b{margin-left:auto;color:var(--cf-brand);font-size:12px}.cf-explorer-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cf-explorer-toolbar>button,.cf-explorer-toolbar-actions button,.cf-preview-actions button,.cf-explorer-more button{border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface);color:var(--adm-text);padding:8px 10px;font-size:10px;font-weight:800}.cf-explorer-toolbar-actions{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}.cf-explorer-crumb{display:flex;align-items:center;gap:4px;min-width:0;overflow:auto}.cf-explorer-crumb button{border:0;background:transparent;color:var(--cf-brand);padding:4px;font-size:10px;font-weight:800;white-space:nowrap}.cf-explorer-crumb span{color:var(--adm-muted)}.cf-explorer-context{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:7px;align-items:stretch}.cf-explorer-context>button{border:1px solid #ef444455;background:#ef44440b;color:#ef4444;border-radius:12px;padding:0 12px;font-size:9px;font-weight:900}.cf-explorer-list-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--adm-border);background:var(--adm-surface2);font-size:9px;color:var(--adm-muted)}.cf-explorer-list-head label{display:flex;align-items:center;gap:5px}.cf-object-area.list{display:block}.cf-object-area.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:10px}.cf-folder-row,.cf-object-row{width:100%;display:flex;align-items:center;gap:9px;border:0;border-bottom:1px solid var(--adm-border);border-radius:0;background:transparent;color:var(--adm-text);padding:9px 12px;text-align:left}.cf-folder-row:hover,.cf-object-row:hover{background:#f6821f0a}.cf-folder-row>span{font-size:15px}.cf-folder-row>div{display:grid;gap:2px;min-width:0}.cf-folder-row b,.cf-object-open b{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-folder-row small,.cf-object-open small{font-size:8px;color:var(--adm-muted)}.cf-folder-row em{margin-left:auto;font-style:normal;color:var(--cf-brand)}.cf-object-row.selected{background:#f6821f0d}.cf-object-check{display:grid;place-items:center}.cf-object-open{min-width:0;flex:1;display:flex;align-items:center;gap:8px;border:0;background:transparent;color:var(--adm-text);text-align:left;padding:0}.cf-object-open>div{display:grid;gap:2px;min-width:0}.cf-object-icon{font-size:15px}.cf-object-actions{display:flex;gap:3px;margin-left:auto}.cf-object-actions button{width:28px;height:28px;padding:0;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);color:var(--adm-muted)}.cf-object-actions .danger{color:#ef4444}.cf-object-area.grid .cf-object-row{position:relative;display:block;border:1px solid var(--adm-border);border-radius:12px;padding:8px;min-width:0}.cf-object-area.grid .cf-folder-row{border:1px solid var(--adm-border);border-radius:12px;min-height:92px}.cf-object-area.grid .cf-object-check{position:absolute;top:7px;left:7px;z-index:2;background:var(--adm-surface);border-radius:5px;padding:2px}.cf-object-area.grid .cf-object-open{display:grid;gap:7px}.cf-object-area.grid .cf-object-open img{width:100%;aspect-ratio:1.5;object-fit:cover;border-radius:8px;background:var(--adm-bg)}.cf-object-area.grid .cf-object-icon{display:grid;place-items:center;width:100%;aspect-ratio:1.5;border-radius:8px;background:var(--adm-bg);font-size:26px}.cf-object-area.grid .cf-object-actions{margin:7px 0 0;justify-content:flex-end}.cf-explorer-drop.dragging{outline:2px dashed #f6821f;outline-offset:-5px;background:#f6821f08}.cf-upload-progress{height:3px;background:var(--adm-border)}.cf-upload-progress span{display:block;height:100%;background:#f6821f;transition:width .15s}.cf-explorer-loading,.cf-explorer-empty{min-height:120px;display:grid;place-items:center;align-content:center;gap:5px;color:var(--adm-muted);font-size:10px;text-align:center;padding:18px}.cf-explorer-empty b{font-size:11px;color:var(--adm-text)}.cf-explorer-more{display:flex;justify-content:center;padding:10px}.cf-explorer-modal-bg{position:fixed;inset:0;z-index:1400;background:#0008;display:grid;place-items:center;padding:14px}.cf-explorer-modal{width:min(620px,100%);max-height:88dvh;overflow:auto;border:1px solid var(--adm-border);border-radius:18px;background:var(--adm-surface);box-shadow:0 24px 80px #0007}.cf-explorer-modal-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:13px 15px;border-bottom:1px solid var(--adm-border);background:var(--adm-surface)}.cf-explorer-modal-head b{font-size:13px}.cf-explorer-modal-head button{border:0;background:transparent;color:var(--adm-muted);font-size:20px}.cf-explorer-form{padding:15px;display:grid;gap:8px}.cf-explorer-form label{font-size:9px;font-weight:900;color:var(--adm-muted)}.cf-explorer-form input{width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-bg);color:var(--adm-text)}.cf-explorer-form small{font-size:9px;color:var(--adm-muted)}.cf-explorer-form>div{display:flex;justify-content:flex-end;gap:7px;margin-top:6px}.cf-explorer-form button{border:1px solid var(--adm-border);border-radius:9px;padding:8px 11px;background:var(--adm-surface2);color:var(--adm-text);font-size:10px;font-weight:800}.cf-preview-body{padding:14px;display:grid;gap:12px}.cf-preview-body>img,.cf-preview-body>video{width:100%;max-height:55vh;object-fit:contain;border-radius:12px;background:var(--adm-bg)}.cf-preview-body>audio{width:100%}.cf-file-generic{min-height:160px;border:1px dashed var(--adm-border);border-radius:12px;background:var(--adm-bg);display:grid;place-items:center;align-content:center;gap:6px;font-size:34px}.cf-file-generic b{font-size:11px}.cf-file-generic span{font-size:9px;color:var(--adm-muted)}.cf-preview-info{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.cf-preview-info span{display:grid;gap:2px;padding:8px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2);font-size:9px;overflow-wrap:anywhere}.cf-preview-info b{font-size:8px;color:var(--adm-muted)}.cf-preview-actions{display:flex;justify-content:flex-end;gap:6px}
@media(max-width:760px){.cf-r2-public-card{grid-template-columns:1fr}.cf-r2-public-actions{justify-content:flex-start}.cf-bucket-grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:8px}.cf-object-area.grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:7px}.cf-explorer-toolbar-actions{width:100%;margin-left:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}.cf-explorer-toolbar-actions button{padding:8px 5px}.cf-explorer-context{grid-template-columns:repeat(3,minmax(0,1fr))}.cf-explorer-context>div:first-child{grid-column:1/-1}.cf-explorer-context>button{grid-column:1/-1;min-height:38px}.cf-explorer-list-head{align-items:flex-start}.cf-r2-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.cf-r2-stats>button{grid-column:1/-1;width:100%;height:34px}.cf-explorer-card-head{grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:7px}.cf-explorer-card-head>button{width:auto;min-width:0;padding:7px 8px}.cf-explorer-card-head p{grid-column:1/-1}.cf-preview-info{grid-template-columns:1fr}.cf-explorer-modal-bg{padding:10px}.cf-explorer-modal{max-height:calc(100dvh - 20px)}}
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
      .cf-central{display:grid;gap:13px}.cf-central-hero{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px;border:1px solid var(--adm-border);border-radius:18px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));box-shadow:0 12px 34px rgba(15,23,42,.05)}.cf-central-brand{display:flex;align-items:center;gap:11px;min-width:0}.cf-central-logo{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:color-mix(in srgb,var(--cf-brand) 8%,var(--adm-surface2));border:1px solid color-mix(in srgb,var(--cf-brand) 30%,var(--adm-border));color:var(--cf-brand);font-size:12px;font-weight:950}.cf-central-brand>div{min-width:0}.cf-central-brand small,.cf-explorer-title small{font-size:8px;font-weight:950;letter-spacing:.12em;color:var(--cf-brand)}.cf-central-brand h2{font-size:17px;margin:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-central-brand p,.cf-explorer-title p{font-size:10px;color:var(--adm-muted);margin:0}.cf-central-actions{display:flex;align-items:center;gap:6px}.cf-central-actions button{width:36px;height:36px;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-bg);color:var(--adm-text);font-size:16px}.cf-central-actions .gear{color:var(--cf-brand)}.cf-live{font-size:8px;font-weight:950;letter-spacing:.08em;border:1px solid var(--adm-border);border-radius:999px;padding:6px 8px;color:var(--adm-muted)}.cf-live.on{color:var(--adm-success);border-color:color-mix(in srgb,var(--adm-success) 28%,var(--adm-border));background:color-mix(in srgb,var(--adm-success) 7%,var(--adm-surface))}.cf-central-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.cf-central-stats>button,.cf-central-stats>div{min-width:0;padding:11px 12px;text-align:left;border:1px solid var(--adm-border);border-radius:13px;background:var(--adm-surface);color:var(--adm-text)}.cf-central-stats>button{cursor:pointer}.cf-central-stats small{display:block;font-size:7.5px;font-weight:950;letter-spacing:.1em;color:var(--adm-muted)}.cf-central-stats b{display:block;margin-top:3px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-central-stats span{display:block;margin-top:3px;font-size:8px;color:var(--adm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cf-explorer-title{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:4px 2px}.cf-explorer-title h3{font-size:15px;margin:2px 0}.cf-explorer-title>span{font-size:8px;font-weight:850;color:var(--adm-muted);border:1px solid var(--adm-border);border-radius:999px;padding:5px 7px}.cf-tools-modal-bg{position:fixed;inset:0;z-index:1350;background:#0009;display:grid;place-items:center;padding:14px}.cf-tools-modal{width:min(900px,100%);max-height:calc(100dvh - 28px);overflow:hidden;border:1px solid var(--adm-border);border-radius:20px;background:var(--adm-surface);box-shadow:0 24px 90px #0008;display:grid;grid-template-rows:auto minmax(0,1fr)}.cf-tools-modal>header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid var(--adm-border)}.cf-tools-modal>header>div{display:grid;gap:2px}.cf-tools-modal header small{font-size:7.5px;font-weight:950;letter-spacing:.12em;color:var(--cf-brand)}.cf-tools-modal header b{font-size:13px}.cf-tools-modal header button{width:32px;height:32px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2);color:var(--adm-text)}.cf-tools-modal>main{overflow:auto;padding:13px}.cf-tools-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.cf-tools-grid button{min-height:92px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;padding:11px;text-align:left;border:1px solid var(--adm-border);border-radius:14px;background:linear-gradient(145deg,var(--adm-surface),var(--adm-surface2));color:var(--adm-text)}.cf-tools-grid button>span{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--adm-bg);border:1px solid var(--adm-border)}.cf-tools-grid button>div{display:grid;gap:3px;min-width:0}.cf-tools-grid b{font-size:10px}.cf-tools-grid small{font-size:8px;color:var(--adm-muted);line-height:1.35}.cf-tools-grid em{font-style:normal;color:var(--cf-brand)}.cf-account-panel{display:grid;gap:10px}.cf-account-panel>section,.cf-account-list{border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface2);padding:12px}.cf-account-panel>section small{font-size:8px;font-weight:950;letter-spacing:.1em;color:var(--cf-brand)}.cf-account-panel h3{margin:4px 0;font-size:16px}.cf-account-panel p{margin:0;font-family:monospace;font-size:9px;color:var(--adm-muted);overflow-wrap:anywhere}.cf-account-list{display:grid;gap:7px}.cf-account-list>div{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:7px;border-bottom:1px solid var(--adm-border)}.cf-account-list>div:last-child{border-bottom:0;padding-bottom:0}.cf-account-list b{font-size:10px}.cf-account-list span,.cf-account-list code{font-size:8.5px;color:var(--adm-muted);overflow-wrap:anywhere;text-align:right}
      .cf-tools-ds-head{display:flex;align-items:center;gap:9px;margin:-2px 0 12px}.cf-tools-ds-head small{font-size:7.5px;font-weight:950;letter-spacing:.12em;color:var(--cf-brand)}.cf-tools-ds-head .cf-tools-back{border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2);color:var(--adm-text);padding:7px 9px;font-size:9px;font-weight:800}
      @media(max-width:760px){.cf-central-hero{align-items:flex-start}.cf-central-actions{flex-wrap:wrap;justify-content:flex-end}.cf-live{display:none}.cf-central-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.cf-explorer-title{align-items:flex-start;flex-direction:column}.cf-tools-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cf-tools-modal-bg{padding:10px}.cf-tools-modal{max-height:calc(100dvh - 20px)}}
    `}</style>
  </div>
}

