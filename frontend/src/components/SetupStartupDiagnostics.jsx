import { useEffect, useMemo, useState } from 'react'

function fmt(ms) {
  if (ms == null) return ''
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export default function SetupStartupDiagnostics({
  title = 'Diagnóstico de inicialização',
  startedAt,
  stages = [],
  visible = true,
  compact = false,
}) {
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (!visible) return undefined
    const id = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(id)
  }, [visible])

  const total = Math.max(0, now - (startedAt || now))
  const normalized = useMemo(() => stages.map((stage) => ({
    ...stage,
    elapsed: stage.elapsed ?? (stage.status === 'running' && stage.startedAt ? now - stage.startedAt : null),
  })), [stages, now])

  if (!visible) return null

  return (
    <div style={{
      width: 'min(92vw, 560px)',
      margin: compact ? '14px auto 0' : '28px auto',
      padding: compact ? '14px 16px' : '18px 20px',
      borderRadius: 14,
      border: '1px solid #dbe5df',
      background: '#ffffff',
      boxShadow: '0 12px 34px rgba(15, 23, 42, .08)',
      color: '#1f2937',
      fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', marginBottom: 12 }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: total > 5000 ? '#b45309' : '#64748b' }}>{fmt(total)}</span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {normalized.map((stage, index) => {
          const done = stage.status === 'done'
          const error = stage.status === 'error'
          const running = stage.status === 'running'
          const icon = done ? '✓' : error ? '!' : running ? '●' : '○'
          const color = done ? '#15803d' : error ? '#b91c1c' : running ? '#2563eb' : '#94a3b8'
          return (
            <div key={`${stage.label}-${index}`} style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 8, alignItems: 'center', minHeight: 24 }}>
              <span style={{ color, fontWeight: 900, textAlign: 'center' }}>{icon}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: running ? 800 : 650, color: error ? '#991b1b' : '#334155' }}>{stage.label}</div>
                {stage.detail && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflowWrap: 'anywhere' }}>{stage.detail}</div>}
              </div>
              <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color }}>{fmt(stage.elapsed)}</span>
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #eef2f7', fontSize: 10.5, lineHeight: 1.45, color: '#64748b' }}>
        Se uma etapa permanecer azul por vários segundos, ela indica onde o carregamento está aguardando.
      </div>
    </div>
  )
}
