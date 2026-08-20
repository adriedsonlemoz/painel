import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import ConfirmModal from '../../components/ConfirmModal'
import { errosService } from '../../services/api'
import { formatarDataRelativa } from '../../utils/formatters'

function montarErroParaCopia(erro) {
  const linhas = [
    `Erro: ${erro.mensagem || 'Sem mensagem registrada.'}`,
    `Tipo: ${erro.tipo || 'sistema'}`,
    erro.status ? `Status: ${erro.status}` : null,
    erro.ocorrencias != null ? `Ocorrências: ${erro.ocorrencias}` : null,
    (erro.ultima_ocorrencia || erro.criado_em) ? `Data: ${new Date(erro.ultima_ocorrencia || erro.criado_em).toLocaleString('pt-BR')}` : null,
    erro.rota ? `Rota: ${erro.rota}` : null,
    erro.url && erro.url !== erro.rota ? `URL: ${erro.url}` : null,
    erro.fingerprint ? `Fingerprint: ${erro.fingerprint}` : null,
    erro.dados ? `Dados adicionais:
${typeof erro.dados === 'string' ? erro.dados : JSON.stringify(erro.dados, null, 2)}` : null,
    erro.stack ? `Stack:
${erro.stack}` : null,
  ]
  return linhas.filter(Boolean).join('\n\n')
}

function ErrorRow({ erro, aberto, onToggle, onDelete, onCopy }) {
  const id = erro._id || erro.id
  const titulo = erro.mensagem || 'Erro sem descrição'
  const data = erro.ultima_ocorrencia || erro.criado_em
  const tipo = erro.tipo || 'sistema'

  return <article className={`error-item ${aberto ? 'is-open' : ''}`}>
    <div className="error-item-head">
      <button className="error-item-toggle" type="button" onClick={() => onToggle(erro)} aria-expanded={aberto}>
        <span className={`error-dot ${erro.lido ? 'read' : ''}`} aria-hidden="true" />
        <span className="error-item-main">
          <strong>{titulo}</strong>
          <span className="error-item-meta">
            <span>{tipo}</span>
            <span>•</span>
            <span>{data ? formatarDataRelativa(data) : 'agora'}</span>
          </span>
        </span>
        <span className="error-chevron" aria-hidden="true">⌄</span>
      </button>
      <button className="error-copy" type="button" onClick={() => onCopy(erro)} title="Copiar erro completo" aria-label="Copiar erro completo">Copiar</button>
      <button className="error-delete" type="button" onClick={() => onDelete(erro)} title="Apagar erro" aria-label="Apagar erro">⌫</button>
    </div>

    {aberto && <div className="error-details">
      <div className="error-detail-block">
        <span className="error-detail-label">Erro</span>
        <div className="error-message">{erro.mensagem || 'Sem mensagem registrada.'}</div>
      </div>

      {(erro.rota || erro.url) && <div className="error-detail-block">
        <span className="error-detail-label">Local</span>
        {erro.rota && <div className="error-mono">{erro.rota}</div>}
        {erro.url && erro.url !== erro.rota && <div className="error-mono">{erro.url}</div>}
      </div>}

      {erro.stack && <div className="error-detail-block">
        <span className="error-detail-label">Detalhes técnicos</span>
        <pre>{erro.stack}</pre>
      </div>}

      {erro.dados && <div className="error-detail-block">
        <span className="error-detail-label">Dados adicionais</span>
        <pre>{typeof erro.dados === 'string' ? erro.dados : JSON.stringify(erro.dados, null, 2)}</pre>
      </div>}

      <button className="error-delete-expanded" type="button" onClick={() => onDelete(erro)}>Apagar este erro</button>
    </div>}
  </article>
}

export default function AdminErros() {
  const [erros, setErros] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [abertoId, setAbertoId] = useState(null)
  const [confirm, setConfirm] = useState({ aberto: false, titulo: '', msg: '', fn: null, carregando: false })
  const [exportando, setExportando] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await errosService.listar({ limit: 100 })
      setErros(r.erros || [])
      setTotal(r.total || 0)
    } catch (e) {
      toast.error(e.message || 'Não foi possível carregar os erros.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function alternar(erro) {
    const id = erro._id || erro.id
    const abrindo = abertoId !== id
    setAbertoId(abrindo ? id : null)
    if (abrindo && !erro.lido) {
      try {
        await errosService.marcarLido(id, true)
        setErros(rows => rows.map(item => (item._id || item.id) === id ? { ...item, lido: true } : item))
      } catch { /* leitura não deve impedir a abertura */ }
    }
  }

  function pedirConfirmacao(titulo, msg, fn) {
    setConfirm({ aberto: true, titulo, msg, fn, carregando: false })
  }

  async function executarConfirmacao() {
    setConfirm(c => ({ ...c, carregando: true }))
    try {
      await confirm.fn()
      setConfirm({ aberto: false, titulo: '', msg: '', fn: null, carregando: false })
      setAbertoId(null)
      await carregar()
    } catch (e) {
      toast.error(e.message || 'Não foi possível apagar o erro.')
      setConfirm(c => ({ ...c, carregando: false }))
    }
  }

  function apagarErro(erro) {
    const id = erro._id || erro.id
    pedirConfirmacao('Apagar este erro?', 'Ele será removido definitivamente da lista.', async () => {
      await errosService.excluir(id)
      toast.success('Erro apagado.')
    })
  }

  async function copiarErro(erro) {
    const texto = montarErroParaCopia(erro)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto)
      } else {
        const area = document.createElement('textarea')
        area.value = texto
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        if (!ok) throw new Error('Clipboard indisponível')
      }
      toast.success('Erro copiado completo.')
    } catch {
      toast.error('Não foi possível copiar o erro.')
    }
  }

  async function exportarTodos() {
    setExportando(true)
    try {
      const r = await errosService.exportarTodos()
      toast.success(`${r.total ?? total} ${r.total === 1 ? 'erro exportado' : 'erros exportados'}.`)
    } catch (e) {
      toast.error(e.message || 'Não foi possível exportar os erros.')
    } finally {
      setExportando(false)
    }
  }

  function apagarTodos() {
    pedirConfirmacao('Apagar todos os erros?', 'Todos os registros desta central serão removidos. Essa ação não pode ser desfeita.', async () => {
      await errosService.limpar({})
      toast.success('Lista de erros limpa.')
    })
  }

  return <>
    <ConfirmModal
      aberto={confirm.aberto}
      titulo={confirm.titulo}
      mensagem={confirm.msg}
      carregando={confirm.carregando}
      labelConfirmar="Apagar"
      onConfirmar={executarConfirmacao}
      onCancelar={() => setConfirm({ aberto: false, titulo: '', msg: '', fn: null, carregando: false })}
    />

    <div className="errors-page-head">
      <div>
        <div className="adm-page-title">Erros</div>
        <div className="adm-page-sub">Registros do sistema</div>
      </div>
      {total > 0 && <div className="errors-head-actions">
        <button className="errors-export-all" type="button" onClick={exportarTodos} disabled={exportando}>{exportando ? 'Exportando…' : 'Exportar todos'}</button>
        <button className="errors-clear-all" type="button" onClick={apagarTodos}>Apagar todos</button>
      </div>}
    </div>

    <div className="errors-counter">{loading ? 'Carregando…' : `${total} ${total === 1 ? 'erro registrado' : 'erros registrados'}`}</div>

    {loading ? <div className="errors-empty">Carregando erros…</div> : erros.length === 0 ? <div className="errors-empty">
      <span className="errors-empty-icon">✓</span>
      <strong>Nenhum erro registrado</strong>
      <small>Quando houver um problema, ele aparecerá aqui.</small>
    </div> : <div className="errors-list">
      {erros.map(erro => {
        const id = erro._id || erro.id
        return <ErrorRow key={id} erro={erro} aberto={abertoId === id} onToggle={alternar} onCopy={copiarErro} onDelete={apagarErro} />
      })}
    </div>}

    <style>{`
      .errors-page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:8px}
      .errors-head-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .errors-export-all{border:1px solid var(--adm-border);background:var(--adm-surface);color:var(--adm-text);font:inherit;font-size:13px;font-weight:750;border-radius:10px;padding:9px 12px;cursor:pointer;white-space:nowrap}
      .errors-export-all:hover{background:color-mix(in srgb,var(--adm-surface) 90%,var(--adm-text))}
      .errors-export-all:disabled{opacity:.55;cursor:wait}
      .errors-clear-all{border:1px solid color-mix(in srgb,var(--adm-danger,#dc2626) 28%,var(--adm-border));background:transparent;color:var(--adm-danger,#c62828);font:inherit;font-size:13px;font-weight:750;border-radius:10px;padding:9px 12px;cursor:pointer;white-space:nowrap}
      .errors-counter{font-size:12px;color:var(--adm-muted);margin:0 0 14px}
      .errors-list{display:grid;gap:8px}
      .error-item{background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:14px;overflow:hidden;transition:border-color .15s ease,box-shadow .15s ease}
      .error-item.is-open{border-color:color-mix(in srgb,var(--adm-text) 18%,var(--adm-border));box-shadow:0 8px 24px rgba(0,0,0,.05)}
      .error-item-head{display:grid;grid-template-columns:minmax(0,1fr) 68px 46px;align-items:stretch}
      .error-item-toggle{min-width:0;border:0;background:transparent;color:inherit;padding:14px 6px 14px 14px;display:grid;grid-template-columns:10px minmax(0,1fr) 20px;gap:10px;align-items:center;text-align:left;cursor:pointer}
      .error-dot{width:8px;height:8px;border-radius:50%;background:#d73535;box-shadow:0 0 0 4px rgba(215,53,53,.09)}
      .error-dot.read{background:var(--adm-muted);box-shadow:none;opacity:.42}
      .error-item-main{min-width:0;display:grid;gap:5px}
      .error-item-main strong{font-size:14px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--adm-text)}
      .error-item-meta{display:flex;align-items:center;gap:6px;min-width:0;font-size:11.5px;color:var(--adm-muted)}
      .error-item-meta span:first-child{max-width:48%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .error-chevron{color:var(--adm-muted);font-size:18px;line-height:1;transform:rotate(0);transition:transform .15s ease;text-align:center}
      .is-open .error-chevron{transform:rotate(180deg)}
      .error-copy{border:0;border-left:1px solid var(--adm-border);background:transparent;color:var(--adm-text);font:inherit;font-size:11.5px;font-weight:800;cursor:pointer;padding:0 8px}
      .error-copy:hover{color:var(--adm-accent);background:color-mix(in srgb,var(--adm-accent) 7%,transparent)}
      .error-delete{border:0;border-left:1px solid var(--adm-border);background:transparent;color:var(--adm-muted);font-size:18px;cursor:pointer}
      .error-delete:hover{color:var(--adm-danger,#c62828);background:rgba(220,38,38,.05)}
      .error-details{border-top:1px solid var(--adm-border);padding:14px;display:grid;gap:14px;background:color-mix(in srgb,var(--adm-surface) 93%,var(--adm-bg))}
      .error-detail-block{display:grid;gap:6px;min-width:0}
      .error-detail-label{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:850;color:var(--adm-muted)}
      .error-message{font-size:13.5px;line-height:1.55;color:var(--adm-text);overflow-wrap:anywhere}
      .error-mono,.error-details pre{margin:0;border-radius:9px;background:var(--adm-bg);border:1px solid var(--adm-border);padding:10px;font-size:11.5px;line-height:1.5;color:var(--adm-text);white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;max-height:260px;overflow:auto}
      .error-delete-expanded{justify-self:start;border:0;background:rgba(220,38,38,.09);color:var(--adm-danger,#c62828);border-radius:9px;padding:9px 11px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}
      .errors-empty{min-height:230px;border:1px dashed var(--adm-border);border-radius:14px;display:grid;place-items:center;align-content:center;gap:5px;color:var(--adm-muted);text-align:center;padding:24px}
      .errors-empty strong{font-size:14px;color:var(--adm-text)}
      .errors-empty small{font-size:12px}
      .errors-empty-icon{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:rgba(34,197,94,.1);color:#24a35a;font-size:19px;font-weight:900;margin-bottom:4px}
      @media(max-width:560px){
        .errors-page-head{align-items:center}.errors-head-actions{gap:6px}.errors-export-all,.errors-clear-all{padding:8px 9px;font-size:11.5px}.error-item-toggle{padding:13px 5px 13px 12px;gap:9px}.error-item-head{grid-template-columns:minmax(0,1fr) 58px 40px}.error-copy{font-size:10.5px;padding:0 5px}.error-item-main strong{font-size:13.5px}.error-details{padding:12px}
      }
    `}</style>
  </>
}
