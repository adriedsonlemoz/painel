import { useEffect } from 'react'
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
  const runtimeGraphIssue = /Cannot read properties of null.*useContext|Invalid hook call|useInRouterContext|dispatcher.*null/i.test(rawDetails)
  const detail = import.meta.env.DEV ? <pre>{rawDetails}</pre> : null

  useEffect(() => {
    if (!runtimeGraphIssue) return
    const key = `als:runtime-graph-recovery:${window.location.pathname}`
    const last = Number(sessionStorage.getItem(key) || 0)
    if (Date.now() - last < 30000) return
    sessionStorage.setItem(key, String(Date.now()))
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href)
      url.searchParams.set('__als_recover', String(Date.now()))
      window.location.replace(url.toString())
    }, 450)
    return () => window.clearTimeout(timer)
  }, [runtimeGraphIssue])

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
      message={notFound ? 'O endereço informado não corresponde a nenhuma página disponível no AL Sistemas.' : runtimeGraphIssue ? 'A interface detectou um cache de execução inconsistente e está tentando se recuperar automaticamente.' : 'A navegação encontrou um erro antes de conseguir abrir esta tela.'}
      details={detail}
      onRetry={() => window.location.reload()}
      onReload={() => window.location.reload()}
      onCopy={copiarDiagnostico}
    />
  )
}
