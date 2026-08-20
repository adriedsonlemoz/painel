import { useEffect, useState } from 'react'
import { CloudOff, ExternalLink } from 'lucide-react'
import { getPublicFallbackState, primePublicSnapshot } from '../services/publicFallback.js'

function formatSnapshotDate(value) {
  if (!value) return 'horário não informado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'horário não informado'
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function PublicFallbackBanner() {
  const [state, setState] = useState(() => getPublicFallbackState())

  useEffect(() => {
    primePublicSnapshot()
    const onFallback = event => setState(event?.detail?.active ? event.detail : null)
    window.addEventListener('alsistemas:public-fallback', onFallback)
    setState(getPublicFallbackState())
    return () => window.removeEventListener('alsistemas:public-fallback', onFallback)
  }, [])

  if (!state) return null

  return (
    <div role="status" style={{ background:'#fff7ed', borderBottom:'1px solid #fed7aa', color:'#9a3412' }}>
      <div className="wrap" style={{ paddingTop:9, paddingBottom:9, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', fontSize:12, lineHeight:1.4 }}>
        <CloudOff size={16} aria-hidden="true" />
        <strong>Modo contingência:</strong>
        <span>backend indisponível; exibindo a última cópia pública salva em {formatSnapshotDate(state.generatedAt)}.</span>
        <a href="/status/" style={{ marginLeft:'auto', display:'inline-flex', gap:5, alignItems:'center', fontWeight:800, color:'inherit', textDecoration:'underline' }}>
          Ver status <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}
