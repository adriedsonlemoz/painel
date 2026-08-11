import { useEffect, useState } from 'react'
import { infraestruturaService } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { T as C, RADIUS, FONT } from '../../themes/tokens'
import { DSPageHeader, DSBtn, DSBadge, DSAlert } from '../../components/admin/ui/DS'

const FRONTEND_API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:3001/api' : '/api')
const FRONTEND_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : (import.meta.env.VITE_APP_VERSION || 'desconhecida')
const FRONTEND_COMMIT = typeof __APP_GIT_SHA__ !== 'undefined' ? __APP_GIT_SHA__ : ''

function Check({ item }) {
  return (
    <div style={{display:'grid',gridTemplateColumns:'auto minmax(0,1fr)',gap:10,alignItems:'start',padding:12,border:`1px solid ${item.ok?C.greenBorder:C.redBorder}`,borderRadius:RADIUS.md,background:item.ok?C.greenBg:C.redBg}}>
      <div style={{fontSize:18,lineHeight:1}}>{item.ok?'✓':'!'}</div>
      <div style={{minWidth:0}}><b style={{display:'block',fontSize:FONT.sm,color:C.text}}>{item.label}</b><span style={{display:'block',fontSize:FONT.xs,color:C.muted,marginTop:3,overflowWrap:'anywhere'}}>{item.detail}</span></div>
    </div>
  )
}

function InfoCard({ title, badge, children }) {
  return <section style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:RADIUS.lg,padding:14,minWidth:0}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:10}}><b style={{fontSize:FONT.base,color:C.text}}>{title}</b>{badge}</div>
    {children}
  </section>
}

export default function AdminAmbientes() {
  const { authTransport } = useAuth()
  const [data,setData]=useState(null)
  const [loading,setLoading]=useState(true)
  const [erro,setErro]=useState('')

  async function carregar(){
    setLoading(true);setErro('')
    try{setData(await infraestruturaService.plataformasCompatibilidade())}
    catch(e){setErro(e.message||'Não foi possível executar o diagnóstico de ambientes.')}
    finally{setLoading(false)}
  }
  useEffect(()=>{carregar()},[])

  const backendVersion=data?.backend?.version||''
  const versionsKnown=Boolean(backendVersion && backendVersion!=='desconhecida' && FRONTEND_VERSION && FRONTEND_VERSION!=='desconhecida')
  const versionsMatch=versionsKnown ? backendVersion===FRONTEND_VERSION : null
  const commitsKnown=Boolean(data?.backend?.commit && FRONTEND_COMMIT)
  const commitsMatch=commitsKnown ? data.backend.commit===FRONTEND_COMMIT : null

  return <div className="adm-page">
    <DSPageHeader title="Ambientes" sub="Compatibilidade do mesmo AL Sistemas em Termux/VPS e Vercel + Render" actions={<DSBtn onClick={carregar} loading={loading}>↻ Verificar</DSBtn>} />

    {erro&&<DSAlert variant="red">{erro}</DSAlert>}
    {data&&versionsMatch===false&&<DSAlert variant="amber" style={{marginBottom:14}}><b>Versões diferentes nas plataformas.</b> O frontend está em <b>{FRONTEND_VERSION}</b> e o backend Render em <b>{backendVersion}</b>. O painel pode misturar contratos de API de releases diferentes; publique a mesma versão nas duas plataformas.</DSAlert>}
    {data&&versionsMatch===true&&commitsMatch===false&&<DSAlert variant="amber" style={{marginBottom:14}}>Frontend e backend informam a versão <b>{FRONTEND_VERSION}</b>, mas os SHAs de deploy são diferentes. Isso pode indicar que apenas uma plataforma recebeu o commit mais recente.</DSAlert>}
    {data&&versionsMatch===true&&commitsMatch!==false&&<DSAlert variant="green" style={{marginBottom:14}}>Frontend e backend estão alinhados na versão <b>{FRONTEND_VERSION}</b>{commitsMatch===true?' e no mesmo commit.':''}</DSAlert>}
    {!data&&loading&&<div style={{padding:20,color:C.muted}}>Conferindo frontend, backend, sessão e integrações…</div>}
    {data&&<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:12,marginBottom:14}}>
        <InfoCard title="Execução" badge={<DSBadge variant={data.runtime?.managed?'blue':'gray'}>{data.runtime?.label||'—'}</DSBadge>}>
          <div style={{fontSize:FONT.sm,color:C.muted,lineHeight:1.6}}>Node <b style={{color:C.text}}>{data.runtime?.node}</b><br/>Sistema <b style={{color:C.text}}>{data.runtime?.platform}</b><br/>Modo <b style={{color:C.text}}>{data.runtime?.managed?'Cloud gerenciada':'Local/VPS'}</b><br/>Frontend <b style={{color:C.text}}>{FRONTEND_VERSION}</b> · Backend <b style={{color:C.text}}>{backendVersion||'—'}</b>{(FRONTEND_COMMIT||data.backend?.commit)&&<><br/>Commit F <b style={{color:C.text}}>{FRONTEND_COMMIT?FRONTEND_COMMIT.slice(0,8):'—'}</b> · B <b style={{color:C.text}}>{data.backend?.commit?data.backend.commit.slice(0,8):'—'}</b></>}</div>
        </InfoCard>
        <InfoCard title="Autenticação" badge={<DSBadge variant="green">{data.auth?.requestTransport||authTransport}</DSBadge>}>
          <div style={{fontSize:FONT.sm,color:C.muted,lineHeight:1.55}}>{data.auth?.note}<div style={{marginTop:7,color:C.text,fontWeight:700}}>Frontend ↔ Backend: {data.auth?.crossOrigin?'domínios diferentes':'mesma origem'}</div></div>
        </InfoCard>
        <InfoCard title="Frontend / API" badge={<DSBadge variant={data.cors?.allowed===false?'red':'green'}>{data.cors?.allowed===false?'CORS bloqueado':'CORS OK'}</DSBadge>}>
          <div style={{fontSize:FONT.xs,color:C.muted,overflowWrap:'anywhere'}}>Origem: <b style={{color:C.text}}>{data.frontend?.origin||data.frontend?.requestOrigin||'não informada'}</b></div>
          <div style={{fontSize:FONT.xs,color:C.muted,marginTop:7,overflowWrap:'anywhere'}}>API do build: <b style={{color:C.text}}>{FRONTEND_API}</b></div>
          <div style={{fontSize:FONT.xs,color:C.muted,marginTop:7}}>Modo: {data.frontend?.apiMode==='cross-origin'?'Vercel → Render':'same-origin/local'}</div>
        </InfoCard>
      </div>

      <section style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:RADIUS.lg,padding:14,marginBottom:14}}>
        <div style={{fontSize:FONT.base,fontWeight:800,color:C.text,marginBottom:10}}>Diagnóstico</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,210px),1fr))',gap:8}}>{(data.checks||[]).map(item=><Check key={item.id} item={item}/>)}</div>
      </section>

      {data.frontend?.apiMode==='cross-origin'&&<DSAlert variant="blue" style={{marginBottom:14}}>Na Vercel, <b>VITE_API_URL</b> deve apontar para a URL pública do backend Render terminando em <b>/api</b>. Se esse valor for alterado na Vercel, faça um novo deployment do frontend para o build receber a nova variável.</DSAlert>}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:12}}>
        <InfoCard title="Modo Termux / VPS" badge={<DSBadge variant="green">Preservado</DSBadge>}>
          <p style={{fontSize:FONT.sm,color:C.muted,lineHeight:1.55,margin:0}}>Continua usando cookie HttpOnly, filesystem persistente, instalação local e as rotas já existentes. O modo cloud não substitui esse fluxo.</p>
        </InfoCard>
        <InfoCard title="Modo Vercel + Render" badge={<DSBadge variant="blue">Compatível</DSBadge>}>
          <p style={{fontSize:FONT.sm,color:C.muted,lineHeight:1.55,margin:0}}>Quando frontend e backend estão em domínios diferentes, o cookie continua sendo tentado e o AL usa Bearer de sessão como fallback. Atualizações permanecem no fluxo R2 → GitHub → Vercel/Render.</p>
        </InfoCard>
      </div>
    </>}
  </div>
}
