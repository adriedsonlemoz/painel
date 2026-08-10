import { useRouteError } from 'react-router-dom'
import AppErrorScreen from './AppErrorScreen'

async function copiarTexto(texto) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(texto)
  const area = document.createElement('textarea')
  area.value = texto
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

export default function RouterErrorScreen() {
  const error = useRouteError()
  const status = error?.status
  const notFound = status === 404
  const rawDetails = error?.stack || error?.message || error?.statusText || 'Erro de roteamento sem detalhes.'
  const detail = import.meta.env.DEV ? <pre>{rawDetails}</pre> : null

  const copiarDiagnostico = () => copiarTexto([
    'AL Sistemas — relatório de erro de navegação',
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    `Código: ${status ? String(status) : 'ROUTE_ERROR'}`,
    `URL: ${window.location.href}`,
    `Viewport: ${window.innerWidth}x${window.innerHeight}`,
    '',
    'Detalhes:',
    rawDetails,
  ].join('\n')).catch(() => {})

  return (
    <AppErrorScreen
      variant={notFound ? 'route' : 'render'}
      code={status ? String(status) : 'ROUTE_ERROR'}
      message={notFound ? 'O endereço informado não corresponde a nenhuma página disponível no AL Sistemas.' : 'A navegação encontrou um erro antes de conseguir abrir esta tela.'}
      details={detail}
      onRetry={() => window.location.reload()}
      onReload={() => window.location.reload()}
      onCopy={copiarDiagnostico}
    />
  )
}
