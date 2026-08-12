import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

const EVENT_NAME = 'alsistemas:update-available'

export function notifyUpdateAvailable(onConfirm) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { onConfirm } }))
}

export default function GlobalUpdateBanner() {
  const [visible, setVisible] = useState(false)
  const [confirm, setConfirm] = useState(null)

  useEffect(() => {
    const handler = (event) => {
      setConfirm(() => typeof event.detail?.onConfirm === 'function' ? event.detail.onConfirm : () => window.location.reload())
      setVisible(true)
    }
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [])

  if (!visible) return null

  return (
    <aside className="global-update-banner" role="status" aria-live="polite">
      <span className="global-update-banner__icon"><RefreshCw size={17} /></span>
      <span className="global-update-banner__copy">
        <strong>Nova versão disponível</strong>
        <small>Atualize a interface para carregar os arquivos mais recentes.</small>
      </span>
      <button
        type="button"
        className="global-update-banner__action"
        onClick={() => { setVisible(false); confirm?.() }}
      >
        Atualizar
      </button>
      <button
        type="button"
        className="global-update-banner__close"
        aria-label="Fechar aviso de atualização"
        onClick={() => setVisible(false)}
      >
        <X size={17} />
      </button>
    </aside>
  )
}
