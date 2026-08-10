import { Component } from 'react'
import { errosService } from '../services/api'
import { isChunkLoadError, recoverFromChunkError } from '../utils/lazyWithRetry'
import AppErrorScreen from './AppErrorScreen'

function isModuleLoadError(error) {
  const msg = error?.message || ''
  return isChunkLoadError(error) || msg.includes('Cannot read properties of null') || msg.includes('useContext') || msg.includes('useState')
}

async function limparCacheCompleto() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch { /* best effort */ }
  Object.keys(sessionStorage).filter(key => key.startsWith('als:chunk-retry:')).forEach(key => sessionStorage.removeItem(key))
  const url = new URL(window.location.href)
  url.searchParams.set('__als_update', Date.now().toString())
  window.location.replace(url.toString())
}

function getEnvironmentInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    url: window.location.href,
    route: window.location.pathname,
  }
}

function extrairComponente(componentStack) {
  if (!componentStack) return null
  return componentStack.match(/^\s*at (\w+)/)?.[1] || null
}

function extrairLocal(stack) {
  if (!stack) return null
  return stack.match(/src\/[^\s)]+\.jsx?:\d+/)?.[0] || null
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { erro: null, info: null, copiado: false }
    this.copyTimer = null
    this.lastReported = null
  }

  static getDerivedStateFromError(erro) { return { erro } }

  componentDidCatch(erro, info) {
    this.setState({ info })
    if (isChunkLoadError(erro)) recoverFromChunkError(erro)
    const reportKey = `${erro?.message || erro}|${window.location.pathname}|${info?.componentStack || ''}`
    if (this.lastReported === reportKey) return
    this.lastReported = reportKey
    errosService.capturar({
      tipo: 'render',
      mensagem: erro.message || String(erro),
      stack: `${erro.stack || ''}\n\nComponent Stack:\n${info?.componentStack || ''}`,
      dados: { ambiente: getEnvironmentInfo(), moduleLoadError: isModuleLoadError(erro), timestamp: new Date().toISOString() },
    }).catch?.(() => {})
  }

  async copiarRelatorio() {
    const { erro, info } = this.state
    const ambiente = getEnvironmentInfo()
    const report = [
      `AL Sistemas — relatório de erro`,
      `Data: ${new Date().toLocaleString('pt-BR')}`,
      `Mensagem: ${erro?.message || 'Erro desconhecido'}`,
      `Componente: ${extrairComponente(info?.componentStack) || 'não identificado'}`,
      `Arquivo: ${extrairLocal(erro?.stack) || 'não identificado'}`,
      `URL: ${ambiente.url}`,
      `Viewport: ${ambiente.viewport}`,
      '',
      'Stack:',
      erro?.stack || '(sem stack)',
      '',
      'Component stack:',
      info?.componentStack || '(sem component stack)',
    ].join('\n')
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report)
      } else {
        const area = document.createElement('textarea')
        area.value = report
        area.style.position = 'fixed'; area.style.opacity = '0'
        document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove()
      }
      this.setState({ copiado: true })
      clearTimeout(this.copyTimer)
      this.copyTimer = setTimeout(() => this.setState({ copiado: false }), 2200)
    } catch { /* clipboard indisponível */ }
  }

  componentWillUnmount() { clearTimeout(this.copyTimer) }

  render() {
    const { erro, info, copiado } = this.state
    const { fallback, children } = this.props
    if (!erro) return children
    if (fallback) return fallback(erro, () => this.setState({ erro: null, info: null }))

    const moduleError = isModuleLoadError(erro)
    const details = (
      <pre>{`${erro?.stack || erro?.message || 'Sem detalhes'}${info?.componentStack ? `\n\nComponent stack:${info.componentStack}` : ''}`}</pre>
    )

    return (
      <AppErrorScreen
        variant={moduleError ? 'module' : 'render'}
        message={moduleError ? undefined : 'Ocorreu um erro ao montar esta tela. O diagnóstico foi registrado automaticamente.'}
        code={extrairLocal(erro?.stack) || extrairComponente(info?.componentStack)}
        details={details}
        copied={copiado}
        onRetry={() => this.setState({ erro: null, info: null })}
        onReload={() => window.location.reload()}
        onCopy={() => this.copiarRelatorio()}
        onClearCache={moduleError ? limparCacheCompleto : undefined}
      />
    )
  }
}
