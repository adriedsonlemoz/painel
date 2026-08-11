import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export function AdminWizardModal({
  open = true,
  title,
  eyebrow = 'ASSISTENTE',
  step = 1,
  steps = [],
  onClose,
  canClose = true,
  children,
  footer,
  className = '',
}) {
  useEffect(() => {
    if (!open) return undefined
    const old = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const key = e => { if (e.key === 'Escape' && canClose) onClose?.() }
    document.addEventListener('keydown', key)
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', key) }
  }, [open, canClose, onClose])

  if (!open || typeof document === 'undefined') return null
  const current = steps[Math.max(0, Math.min(steps.length - 1, step - 1))] || {}
  const percent = steps.length ? Math.round((Math.min(step, steps.length) / steps.length) * 100) : 0
  const portalTarget = document.querySelector('.admin-shell') || document.body

  return createPortal(<div className="al-wizard-overlay" role="presentation" onClick={e => e.target === e.currentTarget && canClose && onClose?.()}>
    <section className={`al-wizard ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="al-wizard-head">
        <div className="al-wizard-title"><small>{eyebrow}</small><h2>{title}</h2></div>
        {canClose && <button type="button" className="al-wizard-close" onClick={onClose} aria-label="Fechar">×</button>}
      </header>

      {steps.length > 0 && <div className="al-wizard-stepbar" aria-label={`Etapa ${step} de ${steps.length}`}>
        <div className="al-wizard-steptext"><b>{Math.min(step, steps.length)} de {steps.length} · {current.title || current.label || ''}</b><span>{current.desc || ''}</span></div>
        <div className="al-wizard-line"><i style={{width:`${percent}%`}} /></div>
        <div className="al-wizard-mini-dots">{steps.map((s,i)=><span key={`${s.title||s.label||i}-${i}`} className={i+1<step?'done':i+1===step?'active':''}>{i+1<step?'✓':i+1}</span>)}</div>
      </div>}

      <div className="al-wizard-body">{children}</div>
      {footer && <footer className="al-wizard-footer">{footer}</footer>}
    </section>
    <style>{`
      .al-wizard-overlay{position:fixed;inset:0;z-index:1900;background:rgba(15,23,42,.48);backdrop-filter:blur(3px);display:grid;place-items:center;padding:8px}.al-wizard{width:min(720px,calc(100vw - 16px));max-height:calc(100dvh - 16px);background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:18px;box-shadow:0 28px 80px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;min-width:0}.al-wizard-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:13px 16px 10px;border-bottom:1px solid var(--adm-border);flex:0 0 auto}.al-wizard-title small{display:block;font-size:8px;font-weight:900;letter-spacing:.13em;color:var(--adm-muted)}.al-wizard-title h2{margin:3px 0 0;font-size:18px;line-height:1.15;color:var(--adm-text)}.al-wizard-close{border:0;background:transparent;color:var(--adm-muted);font-size:24px;line-height:1;cursor:pointer;padding:1px 4px}.al-wizard-stepbar{padding:9px 16px 10px;border-bottom:1px solid var(--adm-border);flex:0 0 auto}.al-wizard-steptext{display:flex;align-items:center;justify-content:space-between;gap:12px}.al-wizard-steptext b{font-size:11px;color:var(--adm-text)}.al-wizard-steptext span{font-size:9px;color:var(--adm-muted);text-align:right}.al-wizard-line{height:4px;background:var(--adm-surface2);border-radius:999px;overflow:hidden;margin-top:7px}.al-wizard-line i{display:block;height:100%;border-radius:inherit;background:var(--adm-accent);transition:width .2s ease}.al-wizard-mini-dots{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;margin-top:6px}.al-wizard-mini-dots span{height:20px;display:grid;place-items:center;border-radius:6px;background:var(--adm-surface2);border:1px solid var(--adm-border);font-size:7.5px;font-weight:900;color:var(--adm-muted)}.al-wizard-mini-dots span.active{border-color:var(--adm-accent);color:var(--adm-accent)}.al-wizard-mini-dots span.done{border-color:color-mix(in srgb,var(--adm-green,#22c55e) 38%,var(--adm-border));color:var(--adm-green,#16a34a)}.al-wizard-body{flex:1;min-height:0;overflow:auto;padding:14px 16px}.al-wizard-footer{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 16px 12px;border-top:1px solid var(--adm-border);background:var(--adm-surface)}
      .al-wizard-info-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.al-wizard-info{min-width:0;padding:9px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2)}.al-wizard-info span{display:block;font-size:7px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:var(--adm-muted)}.al-wizard-info b{display:block;margin-top:3px;font-size:10px;line-height:1.25;color:var(--adm-text);overflow-wrap:anywhere}.al-wizard-info small{display:block;margin-top:2px;font-size:7.5px;line-height:1.3;color:var(--adm-muted);overflow-wrap:anywhere}
      @media(max-width:620px){.al-wizard-overlay{padding:4px}.al-wizard{width:calc(100vw - 8px);max-height:calc(100dvh - 8px);border-radius:15px}.al-wizard-head{padding:11px 12px 8px}.al-wizard-title h2{font-size:16px}.al-wizard-stepbar{padding:8px 12px}.al-wizard-steptext b{font-size:10px}.al-wizard-steptext span{font-size:8px;max-width:42%}.al-wizard-body{padding:11px 12px}.al-wizard-footer{padding:9px 12px 10px;position:relative}.al-wizard-footer>*{min-width:0}.al-wizard-info-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.al-wizard-info{padding:8px}.al-wizard-info b{font-size:9.5px}.al-wizard-mini-dots span{height:18px;font-size:7px}}
      @media(max-width:350px){.al-wizard-steptext span{display:none}.al-wizard-info-grid{grid-template-columns:1fr 1fr}.al-wizard-mini-dots{gap:2px}.al-wizard-mini-dots span{height:17px}}
      @media(max-height:620px){.al-wizard-head{padding-top:8px}.al-wizard-stepbar{padding-top:6px;padding-bottom:7px}.al-wizard-body{padding-top:9px;padding-bottom:9px}.al-wizard-footer{padding-top:7px;padding-bottom:8px}}
    `}</style>
  </div>, portalTarget)
}

export function WizardInfo({ label, value, help, className='' }) {
  return <div className={`al-wizard-info ${className}`}><span>{label}</span><b>{value || '—'}</b>{help && <small>{help}</small>}</div>
}
