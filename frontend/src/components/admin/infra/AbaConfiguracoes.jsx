/**
 * AbaConfiguracoes.jsx — visão de credenciais MongoDB e Cloudinary.
 *
 * Segurança: campos de edição nunca recebem o segredo real. O valor cadastrado
 * é recuperado individualmente, sob demanda, pelos endpoints administrativos
 * da Central de Integrações.
 */
import { useState, useEffect } from 'react'
import { setupService, infraestruturaService } from '../../../services/api'
import { api } from '../../../services/domains/http.js'
import toast from 'react-hot-toast'
import {
  C, Ico, Spin, PageCard, SectionTitle, Btn, Input, StatusDot,
} from './InfraBase'

const MASK = '••••••••••••••••'

function CredentialRow({ label, state, endpoint, field }) {
  const [revealed, setRevealed] = useState('')
  const [busy, setBusy] = useState(false)
  const configured = Boolean(state?.configured)
  const revealable = configured && state?.revealable !== false

  async function fetchValue() {
    const payload = field ? { field } : {}
    return api(endpoint, { method:'POST', body:JSON.stringify(payload) })
  }
  async function toggleReveal() {
    if (revealed) { setRevealed(''); return }
    if (!configured) return toast.error(`${label} não configurada.`)
    if (!revealable) return toast.error('Este valor não pode ser recuperado nesta instalação.')
    setBusy(true)
    try {
      const d = await fetchValue()
      setRevealed(d.value || '')
    } catch (e) { toast.error(e.message || 'Não foi possível recuperar a credencial') }
    finally { setBusy(false) }
  }
  async function copyValue() {
    if (!configured) return toast.error(`${label} não configurada.`)
    if (!revealable) return toast.error('Este valor não pode ser recuperado nesta instalação.')
    setBusy(true)
    try {
      const value = revealed || (await fetchValue()).value || ''
      if (!value) throw new Error('Valor indisponível.')
      await navigator.clipboard.writeText(value)
      toast.success('Copiado')
    } catch (e) { toast.error(e.message || 'Não foi possível copiar') }
    finally { setBusy(false) }
  }

  return <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:10,alignItems:'center',padding:'11px 12px',border:`1px solid ${C.border}`,borderRadius:10,background:C.bg,marginBottom:10,minWidth:0}}>
    <div style={{minWidth:0,display:'grid',gap:4}}>
      <b style={{fontSize:12,color:C.text}}>{label}</b>
      <small style={{color:C.muted,overflowWrap:'anywhere'}}>Origem: {state?.source || 'não identificada'} · {configured ? 'Configurada' : 'Não configurada'}</small>
      <code style={{display:'block',maxWidth:'100%',overflowX:'auto',whiteSpace:revealed?'pre-wrap':'nowrap',overflowWrap:'anywhere',wordBreak:revealed?'break-all':'normal',fontSize:11,color:C.subtle}}>{revealed || state?.masked || (configured ? MASK : '—')}</code>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:6}}>
      {revealable && <>
        <button type="button" aria-label={`${revealed?'Ocultar':'Visualizar'} ${label}`} title={`${revealed?'Ocultar':'Visualizar'} ${label}`} onClick={toggleReveal} disabled={busy} style={{padding:'7px 9px',borderRadius:8,border:`1px solid ${C.border}`,background:C.surf2,color:C.text,cursor:'pointer'}}>{busy?'…':revealed?'Ocultar':'Visualizar'}</button>
        <button type="button" aria-label={`Copiar ${label}`} title={`Copiar ${label}`} onClick={copyValue} disabled={busy} style={{padding:'7px 9px',borderRadius:8,border:`1px solid ${C.border}`,background:C.surf2,color:C.text,cursor:'pointer'}}>Copiar</button>
      </>}
      {configured && !revealable && <small style={{gridColumn:'1/-1',color:C.muted}}>Valor protegido nesta origem.</small>}
    </div>
  </div>
}

export default function AbaConfiguracoes() {
  const [form, setForm] = useState({
    mongo_uri: '', cloudinary_cloud_name: '', cloudinary_api_key: '', cloudinary_api_secret: '',
  })
  const [credentialStatus, setCredentialStatus] = useState(null)
  const [carregando,  setCarregando]  = useState(true)
  const [salvando,    setSalvando]    = useState(false)
  const [testando,    setTestando]    = useState(false)
  const [resultTeste, setResultTeste] = useState(null)

  async function carregar() {
    setCarregando(true)
    try {
      const [d, central] = await Promise.all([
        setupService.lerEnvConfig(),
        api('/admin/integracoes/status').catch(() => null),
      ])
      setForm({
        mongo_uri:              d.mongo_uri              || '',
        cloudinary_cloud_name:  d.cloudinary_cloud_name  || '',
        cloudinary_api_key:     d.cloudinary_api_key     || '',
        cloudinary_api_secret:  d.cloudinary_api_secret  || '',
      })
      setCredentialStatus(central)
    } catch { toast.error('Erro ao carregar configurações') }
    finally { setCarregando(false) }
  }

  useEffect(() => { carregar() }, [])

  async function handleSalvar() {
    setSalvando(true)
    try {
      await setupService.salvarEnvConfig(form)
      toast.success('Configurações salvas com segurança.')
      await carregar()
    } catch (e) { toast.error(e.message || 'Erro ao salvar') }
    finally { setSalvando(false) }
  }

  async function handleTestar() {
    setTestando(true); setResultTeste(null)
    try { setResultTeste(await infraestruturaService.testarConexoes()) }
    catch (e) { toast.error(e.message || 'Erro ao testar conexões') }
    finally { setTestando(false) }
  }

  if (carregando) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin size={24} /></div>
  )

  const mongoState = credentialStatus?.mongodb ? {
    configured:credentialStatus.mongodb.configured,
    revealable:credentialStatus.mongodb.configured,
    masked:credentialStatus.mongodb.configured?MASK:'',
    source:credentialStatus.mongodb.source,
  } : { configured:Boolean(form.mongo_uri), revealable:Boolean(form.mongo_uri), masked:form.mongo_uri?MASK:'', source:'cofre local' }
  const cloud = credentialStatus?.integrations?.cloudinary

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ background: C.blue + '18', border: `1px solid ${C.blue}40`, borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10 }}>
        <span style={{ color: C.blue, flexShrink: 0, marginTop: 1 }}>{Ico.info}</span>
        <div style={{ fontSize: 13, color: C.subtle, lineHeight: 1.6, minWidth:0 }}>
          <b style={{ color: C.text }}>Credenciais protegidas</b><br/>
          Os campos abaixo servem para substituir valores. O segredo cadastrado permanece mascarado e só é solicitado ao backend quando você toca em <b>Visualizar</b> ou <b>Copiar</b>.
        </div>
      </div>

      <PageCard>
        <SectionTitle icon={Ico.db}>MongoDB</SectionTitle>
        <CredentialRow label="MONGO_URI" state={mongoState} endpoint="/admin/integracoes/mongodb/reveal" />
        <Input
          label={mongoState.configured?'Nova Connection String (deixe mascarado para manter)':'Connection String (URI)'}
          value={form.mongo_uri}
          onChange={v => setForm(p => ({ ...p, mongo_uri: v }))}
          type="password"
          placeholder="mongodb+srv://usuario:senha@cluster.mongodb.net/alsistemas"
          helper="Visualize a URI cadastrada acima. Este campo é somente para substituir a configuração."
        />
      </PageCard>

      <PageCard>
        <SectionTitle icon={Ico.cloud}>Cloudinary</SectionTitle>
        <CredentialRow label="CLOUDINARY_API_KEY" state={cloud?.fields?.apiKey} endpoint="/admin/integracoes/cloudinary/reveal" field="apiKey" />
        <CredentialRow label="CLOUDINARY_API_SECRET" state={cloud?.fields?.secret} endpoint="/admin/integracoes/cloudinary/reveal" field="secret" />
        <Input
          label="Cloud Name"
          value={form.cloudinary_cloud_name}
          onChange={v => setForm(p => ({ ...p, cloudinary_cloud_name: v }))}
          placeholder="meu-cloud"
        />
        <Input
          label={cloud?.fields?.apiKey?.configured?'Nova API Key (deixe mascarado para manter)':'API Key'}
          value={form.cloudinary_api_key}
          onChange={v => setForm(p => ({ ...p, cloudinary_api_key: v }))}
          type="password"
          placeholder="API Key do Console"
        />
        <Input
          label={cloud?.fields?.secret?.configured?'Novo API Secret (deixe mascarado para manter)':'API Secret'}
          value={form.cloudinary_api_secret}
          onChange={v => setForm(p => ({ ...p, cloudinary_api_secret: v }))}
          type="password"
          placeholder="API Secret"
          helper="Use Visualizar/Copiar acima para conferir o valor efetivamente cadastrado."
        />
      </PageCard>

      {resultTeste && (
        <PageCard>
          <SectionTitle icon={Ico.check}>Resultado do Teste</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 }}>
            {[
              { key: 'mongodb',    label: 'MongoDB',    info: `Estado: ${resultTeste.mongodb?.estado} · Banco: ${resultTeste.mongodb?.db}` },
              { key: 'cloudinary', label: 'Cloudinary', info: resultTeste.cloudinary?.ok ? 'Conectado ✓' : `Erro: ${resultTeste.cloudinary?.erro}` },
            ].map(({ key, label, info }) => (
              <div key={key} style={{ background: C.surf2, borderRadius: 10, padding: '12px 14px',minWidth:0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <StatusDot ok={resultTeste[key]?.ok} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{label}</span>
                </div>
                <p style={{ fontSize: 12, color: C.muted, margin: 0, overflowWrap:'anywhere' }}>{info}</p>
              </div>
            ))}
          </div>
        </PageCard>
      )}

      <div style={{ display: 'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <Btn onClick={handleSalvar} loading={salvando} variant="success">{Ico.save} Salvar Configurações</Btn>
        <Btn onClick={handleTestar} loading={testando} variant="ghost">{Ico.refresh} Testar Conexões</Btn>
      </div>
    </div>
  )
}
