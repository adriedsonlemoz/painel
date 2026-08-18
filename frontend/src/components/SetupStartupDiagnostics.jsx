import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Check, Cloud, Server, Wifi } from 'lucide-react'

function fmt(ms) {
  if (ms == null) return ''
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function friendlyStatus(total, stages) {
  const hasError = stages.some((stage) => stage.status === 'error')
  const backend = stages.find((stage) => /backend|servidor|setup/i.test(stage.label || ''))

  if (hasError) {
    return {
      eyebrow: 'CONEXÃO INTERROMPIDA',
      title: 'Não foi possível falar com o servidor',
      text: 'A conexão demorou mais que o esperado ou foi interrompida. Você pode consultar os detalhes técnicos abaixo.',
      icon: Wifi,
    }
  }

  if (backend?.status === 'done') {
    return {
      eyebrow: 'SERVIDOR DISPONÍVEL',
      title: 'Tudo pronto',
      text: 'A conexão com o servidor foi concluída. Estamos abrindo o painel.',
      icon: Check,
    }
  }

  if (total >= 5500) {
    return {
      eyebrow: 'INICIALIZANDO SERVIDOR',
      title: 'O servidor está acordando',
      text: 'Após algum tempo sem uso, a hospedagem pode levar alguns segundos para iniciar. Não é necessário recarregar a página.',
      icon: Cloud,
    }
  }

  return {
    eyebrow: 'ABRINDO AL SISTEMAS',
    title: 'Conectando ao servidor',
    text: 'Estamos verificando o ambiente e preparando o painel para você.',
    icon: Server,
  }
}

export default function SetupStartupDiagnostics({
  title = 'Detalhes da inicialização',
  startedAt,
  stages = [],
  visible = true,
  compact = false,
}) {
  const [now, setNow] = useState(() => performance.now())
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    if (!visible) return undefined
    const id = setInterval(() => setNow(performance.now()), 150)
    return () => clearInterval(id)
  }, [visible])

  const total = Math.max(0, now - (startedAt || now))
  const normalized = useMemo(() => stages.map((stage) => ({
    ...stage,
    elapsed: stage.elapsed ?? (stage.status === 'running' && stage.startedAt ? now - stage.startedAt : null),
  })), [stages, now])
  const status = friendlyStatus(total, normalized)
  const StatusIcon = status.icon

  if (!visible) return null

  return (
    <div style={{
      width: 'min(92vw, 500px)',
      margin: compact ? '14px auto 0' : 'min(12vh, 84px) auto 28px',
      padding: compact ? '18px' : '24px',
      borderRadius: 22,
      border: '1px solid #e4ebe7',
      background: 'rgba(255,255,255,.96)',
      boxShadow: '0 22px 60px rgba(15, 23, 42, .10)',
      color: '#1f2937',
      fontFamily: "Geist, 'Segoe UI', system-ui, sans-serif",
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 15 }}>
        <div style={{
          width: 48,
          height: 48,
          flex: '0 0 48px',
          borderRadius: 15,
          display: 'grid',
          placeItems: 'center',
          background: '#eff6f2',
          border: '1px solid #dceae2',
          color: normalized.some((stage) => stage.status === 'error') ? '#b91c1c' : '#166534',
        }}>
          <StatusIcon size={23} strokeWidth={2.1} />
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', color: '#6b7d72', marginBottom: 5 }}>
            {status.eyebrow}
          </div>
          <h1 style={{ fontSize: compact ? 18 : 21, lineHeight: 1.2, margin: 0, color: '#17211b', letterSpacing: '-.02em' }}>
            {status.title}
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.55, margin: '8px 0 0', color: '#69776e' }}>
            {status.text}
          </p>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ height: 5, borderRadius: 999, background: '#edf2ef', overflow: 'hidden', position: 'relative' }}>
          <div className="al-startup-progress" style={{
            position: 'absolute',
            inset: 0,
            width: '42%',
            borderRadius: 999,
            background: '#2f7d4a',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 9 }}>
          <span style={{ fontSize: 11.5, color: '#7b8980' }}>
            {total >= 5500 ? 'Aguardando o servidor responder…' : 'Preparando acesso…'}
          </span>
          <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: total > 5500 ? '#9a6700' : '#89968e' }}>
            {fmt(total)}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen((value) => !value)}
        aria-expanded={detailsOpen}
        style={{
          width: '100%',
          marginTop: 18,
          padding: '11px 0 0',
          border: 0,
          borderTop: '1px solid #edf1ef',
          background: 'transparent',
          color: '#66766c',
          fontSize: 11.5,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
      >
        <span>{detailsOpen ? 'Ocultar detalhes técnicos' : 'Ver detalhes técnicos'}</span>
        {detailsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {detailsOpen && (
        <div style={{ marginTop: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', marginBottom: 11 }}>
            <strong style={{ fontSize: 11.5, color: '#47574d' }}>{title}</strong>
            <span style={{ fontSize: 10.5, color: '#8a978f' }}>{fmt(total)}</span>
          </div>
          <div style={{ display: 'grid', gap: 9 }}>
            {normalized.map((stage, index) => {
              const done = stage.status === 'done'
              const error = stage.status === 'error'
              const running = stage.status === 'running'
              const icon = done ? '✓' : error ? '!' : running ? '●' : '○'
              const color = done ? '#15803d' : error ? '#b91c1c' : running ? '#2563eb' : '#94a3b8'
              return (
                <div key={`${stage.label}-${index}`} style={{ display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 8, alignItems: 'center', minHeight: 23 }}>
                  <span style={{ color, fontWeight: 900, textAlign: 'center', fontSize: 11 }}>{icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: running ? 800 : 650, color: error ? '#991b1b' : '#475569' }}>{stage.label}</div>
                    {stage.detail && <div style={{ fontSize: 10, color: '#7b8792', marginTop: 2, overflowWrap: 'anywhere' }}>{stage.detail}</div>}
                  </div>
                  <span style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', color }}>{fmt(stage.elapsed)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes al-startup-slide {
          0% { transform: translateX(-120%); }
          55% { transform: translateX(115%); }
          100% { transform: translateX(245%); }
        }
        .al-startup-progress {
          animation: al-startup-slide 1.55s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .al-startup-progress { animation-duration: 3.5s; }
        }
      `}</style>
    </div>
  )
}
