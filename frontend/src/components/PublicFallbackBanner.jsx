import { useEffect, useState } from 'react'
import { Clock3, ExternalLink } from 'lucide-react'
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
    <div
      role="status"
      className="mt-2 flex w-full max-w-xl flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center text-[10px] leading-relaxed text-white/55 sm:text-[11px]"
      aria-live="polite"
    >
      <Clock3 size={13} className="flex-shrink-0 text-white/45" aria-hidden="true" />
      <span>
        <strong className="font-semibold text-white/70">Última atualização disponível:</strong>{' '}
        {formatSnapshotDate(state.generatedAt)} · algumas informações podem levar alguns minutos para aparecer.
      </span>
      <a href="/status/" className="inline-flex items-center gap-1 font-semibold text-white/65 underline underline-offset-2 hover:text-white">
        Ver status <ExternalLink size={10} aria-hidden="true" />
      </a>
    </div>
  )
}
