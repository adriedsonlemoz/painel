const EVENT_NAME = 'al-sistemas:confirm'

export function confirmAction(message, options = {}) {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, {
      detail: {
        message: String(message || 'Tem certeza que deseja continuar?'),
        title: options.title || 'Confirmar ação',
        confirmLabel: options.confirmLabel || 'Confirmar',
        variant: options.variant || 'danger',
        resolve,
      },
    }))
  })
}

export const CONFIRM_EVENT = EVENT_NAME
