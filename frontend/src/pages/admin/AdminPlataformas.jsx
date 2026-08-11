import { lazyWithRetry } from '../../utils/lazyWithRetry'
import { Suspense } from 'react'
import { Spin } from '../../components/admin/infra/InfraBase'

const AbaPlataformas = lazyWithRetry(() => import('../../components/admin/infra/AbaPlataformas'))

export default function AdminPlataformas() {
  return (
    <div className="adm-page">
      <div className="adm-page-header">
        <h1 className="adm-page-title">Central de Plataformas</h1>
        <p className="adm-page-sub">Produção Vercel + Render — deploys, conexões, problemas e publicação</p>
      </div>
      <Suspense fallback={
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spin size={24} />
        </div>
      }>
        <AbaPlataformas />
      </Suspense>
    </div>
  )
}
