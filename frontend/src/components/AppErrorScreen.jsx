import { useState } from 'react'
import { AlertTriangle, ArrowLeft, Bug, Copy, Home, RefreshCw, ServerCrash, WifiOff } from 'lucide-react'

const VARIANTS = {
  render: {
    eyebrow: 'Erro inesperado',
    title: 'Esta tela encontrou um problema',
    description: 'O restante do sistema continua protegido. Você pode tentar novamente ou recarregar a página.',
    Icon: Bug,
  },
  network: {
    eyebrow: 'Serviço indisponível',
    title: 'Não conseguimos falar com o servidor',
    description: 'A API pode estar iniciando, reiniciando ou temporariamente fora do ar. Sua configuração não foi apagada.',
    Icon: WifiOff,
  },
  module: {
    eyebrow: 'Falha de carregamento',
    title: 'Um módulo não carregou corretamente',
    description: 'Isso costuma acontecer depois de uma atualização quando o navegador ainda mantém arquivos antigos em cache.',
    Icon: ServerCrash,
  },
  route: {
    eyebrow: 'Página não encontrada',
    title: 'Esse endereço não existe',
    description: 'O link pode ter mudado ou a página pode ter sido removida.',
    Icon: AlertTriangle,
  },
}

export default function AppErrorScreen({
  variant = 'render',
  message,
  code,
  details,
  copied = false,
  onRetry,
  onReload,
  onCopy,
  onClearCache,
  showHome = true,
  showBack = true,
  children,
}) {
  const data = VARIANTS[variant] || VARIANTS.render
  const Icon = data.Icon
  const [detailsOpen, setDetailsOpen] = useState(false)

  return (
    <main className="app-error-page">
      <section className="app-error-card" role="alert" aria-live="assertive">
        <div className={`app-error-icon app-error-icon--${variant}`}>
          <Icon size={28} strokeWidth={1.9} />
        </div>

        <div className="app-error-copy">
          <span className="app-error-eyebrow">{data.eyebrow}</span>
          <h1>{data.title}</h1>
          <p>{message || data.description}</p>
          {code && <span className="app-error-code">Código: {code}</span>}
        </div>

        {children}

        <div className="app-error-actions">
          {onRetry && (
            <button className="app-error-btn app-error-btn--primary" onClick={onRetry}>
              <RefreshCw size={16} /> Tentar novamente
            </button>
          )}
          {onReload && (
            <button className="app-error-btn" onClick={onReload}>
              <RefreshCw size={16} /> Recarregar
            </button>
          )}
          {showBack && (
            <button className="app-error-btn" onClick={() => window.history.back()}>
              <ArrowLeft size={16} /> Voltar
            </button>
          )}
          {showHome && (
            <button className="app-error-btn" onClick={() => { window.location.href = '/login' }}>
              <Home size={16} /> Ir ao início
            </button>
          )}
          {onCopy && (
            <button className="app-error-btn" onClick={onCopy}>
              <Copy size={16} /> {copied ? 'Relatório copiado' : 'Copiar diagnóstico'}
            </button>
          )}
          {onClearCache && (
            <button className="app-error-btn app-error-btn--warning" onClick={onClearCache}>
              Limpar cache e recarregar
            </button>
          )}
        </div>

        {details && (
          <>
            <button className="app-error-details-trigger" onClick={() => setDetailsOpen(true)}>Detalhes técnicos</button>
            {detailsOpen && (
              <div className="app-error-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setDetailsOpen(false) }}>
                <section className="app-error-modal" role="dialog" aria-modal="true" aria-label="Detalhes técnicos">
                  <header><strong>Detalhes técnicos</strong><button onClick={() => setDetailsOpen(false)} aria-label="Fechar">×</button></header>
                  <div className="app-error-details__content">{details}</div>
                </section>
              </div>
            )}
          </>
        )}

        <p className="app-error-footnote">Se o problema continuar, copie o diagnóstico e consulte a área de erros do painel.</p>
      </section>
    </main>
  )
}
