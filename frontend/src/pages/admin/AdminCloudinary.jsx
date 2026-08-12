import { lazyWithRetry } from '../../utils/lazyWithRetry'
import { Suspense } from 'react'
import { Spin } from '../../components/admin/infra/InfraBase'
import { DSPageHeader, DSBtn } from '../../components/admin/ui/DS'
import { SPACE } from '../../themes/tokens'

const AbaCloudinary = lazyWithRetry(() => import('../../components/admin/infra/AbaCloudinary'))

function IcoCloud() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{width:22,height:22,flexShrink:0}}><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>
}
function IcoGear(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:15,height:15}}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>}

export default function AdminCloudinary(){
  const abrirCredenciais=()=>{ window.location.href='/admin/integracoes?open=cloudinary' }
  return <div className="adm-page">
    <DSPageHeader
      title={<span style={{display:'flex',alignItems:'center',gap:SPACE.sm}}><IcoCloud/> Cloudinary</span>}
      sub="Galeria de mídia, armazenamento e limpeza. As credenciais usam o cofre central de Integrações e APIs."
      actions={<DSBtn variant="secondary" onClick={abrirCredenciais} title="Configurar credenciais no cofre central"><IcoGear/> Credenciais</DSBtn>}
    />
    <Suspense fallback={<div style={{display:'flex',justifyContent:'center',padding:60}}><Spin size={26}/></div>}><AbaCloudinary/></Suspense>
  </div>
}
