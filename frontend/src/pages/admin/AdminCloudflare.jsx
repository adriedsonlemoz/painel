import { lazyWithRetry } from '../../utils/lazyWithRetry'
/**
 * AdminCloudflare.jsx — Página dedicada ao gerenciamento Cloudflare.
 *
 * Rota: /admin/cloudflare
 *
 * Estrutura:
 *   DSPageHeader  — título, sub, botão de docs externos
 *   AbaCloudflare — componente com as 5 abas internas:
 *                   Visão Geral · Zonas · DNS · Analytics · Workers
 *
 * Segue 100% os padrões do DS (adm-page, DSPageHeader, tokens).
 */
import { Suspense } from 'react'
import { Spin }           from '../../components/admin/infra/InfraBase'
import { DSPageHeader }   from '../../components/admin/ui/DS'
import { SPACE }          from '../../themes/tokens'

const AbaCloudflare = lazyWithRetry(() => import('../../components/admin/infra/AbaCloudflare'))

function IconoCF() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      aria-hidden="true" style={{ width: 22, height: 22, flexShrink: 0 }}>
      {/* Ícone de nuvem com relâmpago — representa CDN/proxy */}
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" />
      <path d="M13 11l-2 4h3l-2 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}


export default function AdminCloudflare() {
  return (
    <div className="adm-page">
      <DSPageHeader
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <IconoCF /> Cloudflare
          </span>
        }
        sub="Central de conta e R2: espaços, arquivos, uso, planos e ferramentas avançadas na engrenagem."
      />

      <Suspense fallback={
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spin size={26} />
        </div>
      }>
        <AbaCloudflare />
      </Suspense>
    </div>
  )
}
