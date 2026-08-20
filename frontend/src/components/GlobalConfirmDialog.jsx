import { useEffect, useState } from 'react'
import ConfirmModal from './ConfirmModal'
import { CONFIRM_EVENT } from '../utils/confirmAction'

export default function GlobalConfirmDialog() {
  const [request, setRequest] = useState(null)

  useEffect(() => {
    const handler = event => setRequest(event.detail || null)
    window.addEventListener(CONFIRM_EVENT, handler)
    return () => window.removeEventListener(CONFIRM_EVENT, handler)
  }, [])

  const finish = value => {
    const current = request
    setRequest(null)
    current?.resolve?.(value)
  }

  return <ConfirmModal
    aberto={Boolean(request)}
    titulo={request?.title || 'Confirmar ação'}
    mensagem={request?.message || ''}
    labelConfirmar={request?.confirmLabel || 'Confirmar'}
    variante={request?.variant || 'danger'}
    onConfirmar={() => finish(true)}
    onCancelar={() => finish(false)}
  />
}
