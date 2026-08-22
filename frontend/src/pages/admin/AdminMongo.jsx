import { lazyWithRetry } from '../../utils/lazyWithRetry'
/**
 * AdminMongo.jsx — Central MongoDB simplificada
 * Fluxo: Visão geral | Explorar dados | Documentos | Ferramentas avançadas.
 * Credenciais e URI ficam centralizadas em Integrações e APIs.
 *
 * DS Sprint (conformidade total):
 *   - DSModal       → substitui todos os overlays position:fixed inline
 *   - DSTabs/DSTab  → substitui tabs locais com style condicional
 *   - DSBtn         → substitui factory s.btn()
 *   - DSBadge       → substitui helper s.badge()
 *   - DSAlert       → substitui s.aviso, s.erro, s.ok hardcoded
 *   - DSPageHeader  → substitui header inline
 */
import { useState, useEffect, useCallback, Suspense } from 'react'
import { T as C, SPACE, RADIUS, FONT }  from '../../themes/tokens'
import { mongoService }                 from '../../services/domains/mongo'
import { infraestruturaService }        from '../../services/api'
import ConfirmModal                     from '../../components/ConfirmModal'
import { Spin }                         from '../../components/admin/infra/InfraBase'
import {
  DSPageHeader,
  DSTabs, DSTab,
  DSBtn, DSBadge, DSAlert, DSModal,
} from '../../components/admin/ui/DS'

const AbaMongoDB = lazyWithRetry(() => import('../../components/admin/infra/AbaMongoDB'))

// ── Estilos sem equivalente no DS (layout, tabela, card clickável) ──

const s = {
  card: {
    background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: RADIUS.lg, padding: SPACE.md,
    cursor: 'pointer', transition: 'border-color .15s',
  },
  colGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: SPACE.md },
  colNome: { fontSize: FONT.md, fontWeight: 700, color: C.text, marginBottom: SPACE.xs, wordBreak: 'break-all' },
  colMeta: { fontSize: FONT.sm, color: C.muted },

  table: { width: '100%', borderCollapse: 'collapse', fontSize: FONT.sm },
  th: { textAlign: 'left', padding: `${SPACE.sm}px ${SPACE.md}px`, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' },
  td: { padding: `${SPACE.sm}px ${SPACE.md}px`, color: C.text, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  input: { padding: `${SPACE.sm}px ${SPACE.md}px`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: FONT.base, width: '100%', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: FONT.xs, fontWeight: 700, color: C.muted, marginBottom: SPACE.xs, letterSpacing: '.04em', textTransform: 'uppercase' },
  row:   { display: 'flex', gap: SPACE.md, alignItems: 'flex-end', flexWrap: 'wrap' },

  paginacao: { display: 'flex', alignItems: 'center', gap: SPACE.md, justifyContent: 'center', marginTop: SPACE.lg },
  pagInfo:   { fontSize: FONT.sm, color: C.muted },

  campoRow: { marginBottom: SPACE.md },
  idField:  { background: C.border, color: C.muted, userSelect: 'all', borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, fontSize: FONT.sm, fontFamily: 'monospace' },
}

// ── Helpers ────────────────────────────────────────────────────

const CAMPOS_RO = ['_id', '__v', 'criado_em', 'createdAt', 'updatedAt']

function truncar(val, max = 60) {
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')
  return str.length > max ? str.slice(0, max) + '…' : str
}
function primeirasChaves(doc, n = 4) {
  return Object.keys(doc).filter(k => k !== '_id').slice(0, n)
}

// ── Ícones inline ──────────────────────────────────────────────

function IcoDb() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      style={{ width: 22, height: 22, flexShrink: 0 }}>
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  )
}
// ── Tab Coleções ───────────────────────────────────────────────

function TabColecoes({ aoSelecionarColecao }) {
  const [colecoes,   setColecoes]   = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro,       setErro]       = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try   { setColecoes((await mongoService.colecoes()).colecoes || []) }
    catch (e) { setErro(e.message) }
    finally   { setCarregando(false) }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg, gap: SPACE.sm, flexWrap: 'wrap' }}>
        <span style={{ color: C.muted, fontSize: FONT.sm }}>{colecoes.length} coleção(ões)</span>
        {/* ✅ DSBtn substitui <button style={s.btn('primario')}> */}
        <DSBtn variant="primary" onClick={carregar} disabled={carregando}>
          {carregando ? 'Atualizando…' : '↺ Atualizar'}
        </DSBtn>
      </div>

      {/* ✅ DSAlert substitui s.erro hardcoded */}
      {erro && <DSAlert variant="red" style={{ marginBottom: SPACE.md }}>{erro}</DSAlert>}

      {carregando && !colecoes.length
        ? <p style={{ color: C.muted, fontSize: FONT.sm }}>Carregando…</p>
        : (
          <div style={s.colGrid}>
            {colecoes.map(col => (
              <div key={col.nome} style={s.card}
                onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
                onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                onClick={() => aoSelecionarColecao(col.nome)}
                title={`Abrir documentos de ${col.nome}`}
              >
                <div style={s.colNome}>{col.nome}</div>
                <div style={s.colMeta}>
                  <span style={{ color: C.blue, fontWeight: 700 }}>{col.total.toLocaleString()}</span>
                  {' '}docs
                  <span style={{ marginLeft: SPACE.sm }}>{col.tamanhoFormatado}</span>
                </div>
              </div>
            ))}
            {!carregando && !colecoes.length && (
              <p style={{ color: C.muted, fontSize: FONT.sm, gridColumn: '1/-1' }}>Nenhuma coleção encontrada.</p>
            )}
          </div>
        )
      }
    </div>
  )
}

// ── Modal Edição de Documento ──────────────────────────────────
// ✅ DSModal substitui overlay position:fixed inline

function ModalEdicao({ doc, colecao, aoSalvar, aoFechar }) {
  const [campos,   setCampos]   = useState({})
  const [salvando, setSalvando] = useState(false)
  const [erro,     setErro]     = useState('')

  useEffect(() => {
    if (!doc) return
    const init = {}
    for (const [k, v] of Object.entries(doc)) {
      if (CAMPOS_RO.includes(k)) continue
      init[k] = typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? '')
    }
    setCampos(init)
  }, [doc])

  const salvar = async () => {
    setSalvando(true); setErro('')
    try {
      const parsed = {}
      for (const [k, v] of Object.entries(campos)) {
        if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
          try { parsed[k] = JSON.parse(v) } catch { parsed[k] = v }
        } else if (v === 'true')  parsed[k] = true
        else if   (v === 'false') parsed[k] = false
        else if (v !== '' && !isNaN(Number(v))) parsed[k] = Number(v)
        else parsed[k] = v
      }
      await mongoService.atualizar(colecao, String(doc._id), parsed)
      aoSalvar()
    } catch (e) { setErro(e.message) }
    finally     { setSalvando(false) }
  }

  if (!doc) return null
  const editaveis = Object.keys(doc).filter(k => !CAMPOS_RO.includes(k))

  return (
    <DSModal
      open
      onClose={aoFechar}
      title={`Editar documento — ${colecao}`}
      footer={
        <>
          <DSBtn variant="ghost" onClick={aoFechar}>Cancelar</DSBtn>
          <DSBtn variant="primary" onClick={salvar} loading={salvando}>Salvar alterações</DSBtn>
        </>
      }
    >
      <div style={{ marginBottom: SPACE.lg }}>
        <div style={s.label}>_id (somente leitura)</div>
        <div style={{ ...s.input, ...s.idField }}>{String(doc._id)}</div>
      </div>

      {/* ✅ DSAlert substitui s.erro hardcoded */}
      {erro && <DSAlert variant="red" style={{ marginBottom: SPACE.md }}>{erro}</DSAlert>}

      {editaveis.map(k => {
        const isLong = typeof campos[k] === 'string' && (campos[k].startsWith('{') || campos[k].startsWith('['))
        return (
          <div key={k} style={s.campoRow}>
            <label style={s.label}>{k}</label>
            {isLong
              ? <textarea value={campos[k] || ''} onChange={e => setCampos(p => ({ ...p, [k]: e.target.value }))} rows={4}
                  style={{ ...s.input, resize: 'vertical', fontFamily: 'monospace', fontSize: FONT.xs }} />
              : <input value={campos[k] || ''} onChange={e => setCampos(p => ({ ...p, [k]: e.target.value }))}
                  style={s.input} />
            }
          </div>
        )
      })}

      {!editaveis.length && <p style={{ color: C.muted, fontSize: FONT.base }}>Nenhum campo editável.</p>}
    </DSModal>
  )
}

// ── Tab Documentos ─────────────────────────────────────────────

function TabDocumentos({ colecaoInicial }) {
  const [colecoes,   setColecoes]   = useState([])
  const [colecao,    setColecao]    = useState(colecaoInicial || '')
  const [filtroJson, setFiltroJson] = useState('')
  const [docs,       setDocs]       = useState([])
  const [total,      setTotal]      = useState(0)
  const [page,       setPage]       = useState(1)
  const [pages,      setPages]      = useState(1)
  const [carregando, setCarregando] = useState(false)
  const [erro,       setErro]       = useState('')
  const [docEditar,  setDocEditar]  = useState(null)
  const [docExcluir, setDocExcluir] = useState(null)
  const [mensagem,   setMensagem]   = useState('')

  useEffect(() => {
    mongoService.colecoes().then(d => setColecoes(d.colecoes || [])).catch(() => {})
  }, [])

  const buscar = useCallback(async (pg = 1) => {
    if (!colecao) return
    setCarregando(true); setErro(''); setMensagem('')
    try {
      if (filtroJson.trim()) {
        try { JSON.parse(filtroJson) }
        catch { setErro('Filtro JSON inválido.'); setCarregando(false); return }
      }
      const params = { page: pg, limit: 20 }
      if (filtroJson.trim()) params.filtro = filtroJson.trim()
      const data = await mongoService.documentos(colecao, params)
      setDocs(data.docs || []); setTotal(data.total || 0)
      setPage(data.page || 1);  setPages(data.pages || 1)
    } catch (e) { setErro(e.message) }
    finally     { setCarregando(false) }
  }, [colecao, filtroJson])

  useEffect(() => { if (colecaoInicial) setColecao(colecaoInicial) }, [colecaoInicial])
  // eslint-disable-next-line
  useEffect(() => { if (colecao) buscar(1) }, [colecao])

  const excluir = async () => {
    if (!docExcluir) return
    try {
      await mongoService.deletar(colecao, String(docExcluir._id))
      setMensagem('Documento excluído.'); setDocExcluir(null); buscar(page)
    } catch (e) { setErro(e.message); setDocExcluir(null) }
  }

  const colunas = docs.length > 0 ? ['_id', ...primeirasChaves(docs[0])] : ['_id']

  return (
    <div>
      <div style={{ ...s.row, marginBottom: SPACE.lg }}>
        <div style={{ flex: 1, minWidth: '180px' }}>
          <label style={s.label}>Coleção</label>
          <select value={colecao} onChange={e => { setColecao(e.target.value); setPage(1) }}
            style={{ ...s.input, cursor: 'pointer' }}>
            <option value="">— Selecione —</option>
            {colecoes.map(c => <option key={c.nome} value={c.nome}>{c.nome} ({c.total})</option>)}
          </select>
        </div>
        <div style={{ flex: 2, minWidth: '220px' }}>
          <label style={s.label}>Filtro JSON (opcional)</label>
          <input value={filtroJson} onChange={e => setFiltroJson(e.target.value)}
            placeholder='{ "ativo": true }' style={s.input} />
        </div>
        <div>
          <label style={s.label}>&nbsp;</label>
          {/* ✅ DSBtn substitui <button style={s.btn('primario')}> */}
          <DSBtn variant="primary" onClick={() => buscar(1)} disabled={!colecao || carregando}>
            {carregando ? 'Buscando…' : 'Buscar'}
          </DSBtn>
        </div>
      </div>

      {/* ✅ DSAlert substitui s.erro e s.ok hardcoded */}
      {erro     && <DSAlert variant="red"   style={{ marginBottom: SPACE.md }}>{erro}</DSAlert>}
      {mensagem && <DSAlert variant="green" style={{ marginBottom: SPACE.md }}>{mensagem}</DSAlert>}

      {!colecao && <p style={{ color: C.muted, fontSize: FONT.sm }}>Selecione uma coleção para ver os documentos.</p>}
      {colecao && !carregando && !docs.length && <p style={{ color: C.muted, fontSize: FONT.sm }}>Nenhum documento encontrado.</p>}

      {docs.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  {colunas.map(c => <th key={c} style={s.th}>{c}</th>)}
                  <th style={s.th}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {docs.map(doc => (
                  <tr key={String(doc._id)}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface2}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {colunas.map(c => (
                      <td key={c} style={s.td}
                        title={typeof doc[c] === 'object' ? JSON.stringify(doc[c]) : String(doc[c] ?? '')}>
                        {truncar(doc[c])}
                      </td>
                    ))}
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                      {/* ✅ DSBtn substitui <button style={s.btn(...)}> */}
                      <DSBtn variant="primary" size="sm" style={{ marginRight: SPACE.xs }}
                        onClick={() => setDocEditar(doc)}>Editar</DSBtn>
                      <DSBtn variant="danger" size="sm"
                        onClick={() => setDocExcluir(doc)}>Excluir</DSBtn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={s.paginacao}>
            <DSBtn variant="ghost" onClick={() => buscar(page - 1)} disabled={page <= 1}>← Anterior</DSBtn>
            <span style={s.pagInfo}>Página {page} de {pages} · {total} docs</span>
            <DSBtn variant="ghost" onClick={() => buscar(page + 1)} disabled={page >= pages}>Próxima →</DSBtn>
          </div>
        </>
      )}

      {docEditar  && (
        <ModalEdicao doc={docEditar} colecao={colecao}
          aoSalvar={() => { setDocEditar(null); setMensagem('Documento atualizado.'); buscar(page) }}
          aoFechar={() => setDocEditar(null)} />
      )}
      {docExcluir && (
        <ConfirmModal
          aberto={!!docExcluir}
          titulo="Excluir documento?"
          mensagem={`Documento ${docExcluir ? String(docExcluir._id) : ''} de "${colecao}" será removido permanentemente.`}
          labelConfirmar="Excluir"
          onConfirmar={excluir}
          onCancelar={() => setDocExcluir(null)} />
      )}
    </div>
  )
}

// ── Tab Aggregate ──────────────────────────────────────────────

function TabAggregate() {
  const [colecoes,   setColecoes]   = useState([])
  const [colecao,    setColecao]    = useState('')
  const [pipeline,   setPipeline]   = useState('')
  const [resultado,  setResultado]  = useState(null)
  const [executando, setExecutando] = useState(false)
  const [erro,       setErro]       = useState('')

  useEffect(() => {
    mongoService.colecoes().then(d => setColecoes(d.colecoes || [])).catch(() => {})
  }, [])

  const executar = async () => {
    if (!colecao || !pipeline.trim()) return
    setExecutando(true); setErro(''); setResultado(null)
    let parsed
    try   { parsed = JSON.parse(pipeline) }
    catch { setErro('Pipeline JSON inválido.'); setExecutando(false); return }
    try   { setResultado(await mongoService.aggregate(colecao, parsed)) }
    catch (e) { setErro(e.message) }
    finally   { setExecutando(false) }
  }

  return (
    <div>
      {/* ✅ DSAlert substitui s.aviso hardcoded (#f59e0b*) */}
      <DSAlert variant="amber" style={{ marginBottom: SPACE.lg }}>
        ⚠️ <strong>$out</strong> e <strong>$merge</strong> não são permitidos · máx. 5 estágios · timeout 5 s
      </DSAlert>

      <div style={{ ...s.row, marginBottom: SPACE.lg }}>
        <div style={{ minWidth: '200px' }}>
          <label style={s.label}>Coleção</label>
          <select value={colecao} onChange={e => setColecao(e.target.value)}
            style={{ ...s.input, cursor: 'pointer' }}>
            <option value="">— Selecione —</option>
            {colecoes.map(c => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: SPACE.lg }}>
        <label style={s.label}>Pipeline (array JSON)</label>
        <textarea value={pipeline} onChange={e => setPipeline(e.target.value)} rows={8}
          placeholder={"[\n  { \"$match\": { \"ativo\": true } },\n  { \"$group\": { \"_id\": \"$status\", \"total\": { \"$sum\": 1 } } }\n]"}
          style={{ ...s.input, fontFamily: 'monospace', fontSize: FONT.sm, resize: 'vertical' }} />
      </div>

      {/* ✅ DSAlert substitui s.erro hardcoded */}
      {erro && <DSAlert variant="red" style={{ marginBottom: SPACE.md }}>{erro}</DSAlert>}

      {/* ✅ DSBtn substitui <button style={s.btn('primario')}> */}
      <DSBtn variant="primary" style={{ marginBottom: SPACE.xl }}
        onClick={executar} disabled={!colecao || !pipeline.trim() || executando}>
        {executando ? 'Executando…' : '▶ Executar Aggregate'}
      </DSBtn>

      {resultado && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, marginBottom: SPACE.sm }}>
            <span style={{ fontWeight: 700, color: C.text, fontSize: FONT.base }}>Resultado</span>
            {/* ✅ DSBadge substitui s.badge(C.greenSolid) */}
            <DSBadge variant="green">{resultado.total} item(s)</DSBadge>
          </div>
          <pre style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: SPACE.lg, fontSize: FONT.xs, color: C.text, overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
            {JSON.stringify(resultado.resultado, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Página Principal ───────────────────────────────────────────

const TABS = [
  { id: 'visao',      label: 'Visão geral'      },
  { id: 'colecoes',   label: 'Explorar dados'   },
  { id: 'documentos', label: 'Documentos'       },
  { id: 'ferramentas',label: 'Ferramentas'      },
]

export default function AdminMongo() {
  const [tabAtiva,           setTabAtiva]           = useState('visao')
  const [colecaoSelecionada, setColecaoSelecionada] = useState('')
  const [status,              setStatus]              = useState(null)
  const [statusErro,          setStatusErro]          = useState('')
  const [statusLoading,       setStatusLoading]       = useState(true)
  const [ferramenta,          setFerramenta]          = useState('indices')

  const carregarStatus = useCallback(async () => {
    setStatusLoading(true); setStatusErro('')
    try { setStatus(await infraestruturaService.mongoStatus()) }
    catch (e) { setStatusErro(e.message || 'Não foi possível consultar o MongoDB.') }
    finally { setStatusLoading(false) }
  }, [])

  useEffect(() => { carregarStatus() }, [carregarStatus])

  const aoSelecionarColecao = (nome) => {
    setColecaoSelecionada(nome)
    setTabAtiva('documentos')
  }

  const abrirIntegracoes = () => {
    window.location.assign('/admin/integracoes?open=mongodb')
  }

  return (
    <div className="adm-page mongo-center-page">
      <DSPageHeader
        title={<span style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}><IcoDb /> MongoDB</span>}
        sub="Dados do sistema, documentos e manutenção do banco em um fluxo mais simples"
        actions={
          <DSBtn variant="secondary" onClick={abrirIntegracoes} title="Gerenciar URI e integrações em um só lugar">
            Integrações e APIs
          </DSBtn>
        }
      />

      <div className="mongo-config-note">
        <div className="mongo-config-icon"><IcoDb /></div>
        <div>
          <b>A conexão não é configurada aqui</b>
          <span>URI, credenciais e testes de integração ficam centralizados em <strong>Integrações e APIs</strong>. Aqui você trabalha apenas com os dados.</span>
        </div>
        <DSBtn variant="ghost" size="sm" onClick={abrirIntegracoes}>Abrir integrações →</DSBtn>
      </div>

      <DSTabs style={{ marginBottom: SPACE.xl }}>
        {TABS.map(t => (
          <DSTab key={t.id} id={t.id} ativo={tabAtiva} onClick={setTabAtiva}>
            {t.label}
          </DSTab>
        ))}
      </DSTabs>

      {tabAtiva === 'visao' && (
        <div className="mongo-overview">
          <section className="mongo-status-card">
            <div className="mongo-section-head">
              <div>
                <small>CONEXÃO ATUAL</small>
                <h2>Estado do banco</h2>
              </div>
              <DSBtn variant="ghost" size="sm" onClick={carregarStatus} disabled={statusLoading}>
                {statusLoading ? 'Consultando…' : '↺ Atualizar'}
              </DSBtn>
            </div>

            {statusErro && <DSAlert variant="red">{statusErro}</DSAlert>}
            {statusLoading && !status ? (
              <div className="mongo-status-loading"><Spin size={22} /> Consultando MongoDB…</div>
            ) : status && (
              <div className="mongo-status-grid">
                <div className={status.conectado ? 'ok' : 'bad'}><b>{status.conectado ? 'Conectado' : (status.estado || 'Offline')}</b><small>Estado</small></div>
                <div><b>{status.banco || '—'}</b><small>Banco</small></div>
                <div><b>{status.colecoes ?? '—'}</b><small>Coleções</small></div>
                <div><b>{status.objetos ?? '—'}</b><small>Documentos</small></div>
                <div><b>{status.tamanho_dados || '—'}</b><small>Dados</small></div>
                <div><b>{status.tamanho_armazenamento || '—'}</b><small>Storage</small></div>
              </div>
            )}
          </section>

          <section className="mongo-start-card">
            <div className="mongo-section-head">
              <div><small>POR ONDE COMEÇAR</small><h2>Escolha o que você quer fazer</h2></div>
            </div>
            <div className="mongo-action-grid">
              <button onClick={() => setTabAtiva('colecoes')}>
                <span className="mongo-action-icon">1</span>
                <div><b>Explorar os dados</b><small>Veja as coleções, quantidade de registros e tamanho. É o melhor ponto de partida.</small></div>
                <strong>→</strong>
              </button>
              <button onClick={() => setTabAtiva('documentos')}>
                <span className="mongo-action-icon">2</span>
                <div><b>Buscar e editar documentos</b><small>Escolha uma coleção, filtre registros e faça alterações pontuais.</small></div>
                <strong>→</strong>
              </button>
              <button onClick={() => setTabAtiva('ferramentas')}>
                <span className="mongo-action-icon">3</span>
                <div><b>Ferramentas avançadas</b><small>Aggregate, estatísticas e índices ficam separados para não poluir o uso comum.</small></div>
                <strong>→</strong>
              </button>
            </div>
          </section>

          <section className="mongo-help-strip">
            <span>💡</span>
            <div><b>Dica</b><small>Se você só quer descobrir onde um dado está salvo, comece em <strong>Explorar dados</strong>. O painel leva você para os documentos ao escolher uma coleção.</small></div>
          </section>
        </div>
      )}

      {tabAtiva === 'colecoes' && <TabColecoes aoSelecionarColecao={aoSelecionarColecao} />}
      {tabAtiva === 'documentos' && <TabDocumentos colecaoInicial={colecaoSelecionada} />}
      {tabAtiva === 'ferramentas' && (
        <div className="mongo-tools">
          <div className="mongo-tools-head">
            <div><small>USO AVANÇADO</small><h2>Ferramentas do banco</h2><p>Essas opções ficam separadas porque normalmente não são necessárias para consultar ou editar dados.</p></div>
            <div className="mongo-tool-switch">
              <button className={ferramenta === 'indices' ? 'active' : ''} onClick={() => setFerramenta('indices')}>Banco e índices</button>
              <button className={ferramenta === 'aggregate' ? 'active' : ''} onClick={() => setFerramenta('aggregate')}>Aggregate</button>
            </div>
          </div>

          {ferramenta === 'aggregate' ? <TabAggregate /> : (
            <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: SPACE.xl2 }}><Spin size={28} /></div>}>
              <AbaMongoDB />
            </Suspense>
          )}
        </div>
      )}

      <style>{`
        .mongo-center-page{display:grid;gap:0}.mongo-config-note{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 12px;margin-bottom:14px;border:1px solid color-mix(in srgb,var(--adm-accent) 22%,var(--adm-border));border-radius:12px;background:color-mix(in srgb,var(--adm-accent) 4%,var(--adm-surface));color:var(--adm-text)}.mongo-config-icon{width:32px;height:32px;border-radius:9px;background:color-mix(in srgb,var(--adm-accent) 8%,var(--adm-surface2));color:var(--adm-accent);display:grid;place-items:center}.mongo-config-icon svg{width:16px!important;height:16px!important}.mongo-config-note>div:nth-child(2){display:grid;gap:2px}.mongo-config-note b{font-size:12px}.mongo-config-note span{font-size:11px;line-height:1.45;color:var(--adm-muted)}.mongo-overview{display:grid;gap:11px}.mongo-status-card,.mongo-start-card,.mongo-tools{padding:14px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface)}.mongo-section-head,.mongo-tools-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;margin-bottom:11px}.mongo-section-head small,.mongo-tools-head small{font-size:11px;font-weight:900;letter-spacing:.12em;color:var(--adm-accent)}.mongo-section-head h2,.mongo-tools-head h2{margin:3px 0 0;font-size:16px;color:var(--adm-text)}.mongo-tools-head p{margin:4px 0 0;font-size:12px;color:var(--adm-muted);line-height:1.45}.mongo-status-loading{min-height:90px;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--adm-muted);font-size:12px}.mongo-status-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px}.mongo-status-grid>div{display:grid;gap:2px;padding:10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2);min-width:0}.mongo-status-grid b{font-size:12px;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mongo-status-grid small{font-size:11px;color:var(--adm-muted)}.mongo-status-grid .ok b{color:var(--adm-success)}.mongo-status-grid .bad b{color:var(--adm-red)}.mongo-action-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.mongo-action-grid>button{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:start;text-align:left;padding:12px;border:1px solid var(--adm-border);border-radius:11px;background:var(--adm-surface2);color:var(--adm-text);cursor:pointer;transition:.15s}.mongo-action-grid>button:hover{border-color:color-mix(in srgb,var(--adm-accent) 35%,var(--adm-border));transform:translateY(-1px)}.mongo-action-icon{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:color-mix(in srgb,var(--adm-accent) 9%,var(--adm-surface));color:var(--adm-accent);font-size:12px;font-weight:900}.mongo-action-grid button>div{display:grid;gap:4px}.mongo-action-grid b{font-size:12px}.mongo-action-grid small{font-size:11px;line-height:1.45;color:var(--adm-muted)}.mongo-action-grid strong{color:var(--adm-accent);font-size:15px}.mongo-help-strip{display:flex;gap:8px;align-items:flex-start;padding:10px 11px;border:1px dashed var(--adm-border);border-radius:11px;background:var(--adm-surface2)}.mongo-help-strip>div{display:grid;gap:2px}.mongo-help-strip b{font-size:12px}.mongo-help-strip small{font-size:11px;line-height:1.45;color:var(--adm-muted)}.mongo-tool-switch{display:flex;gap:5px;flex-wrap:wrap}.mongo-tool-switch button{padding:7px 9px;border:1px solid var(--adm-border);border-radius:999px;background:var(--adm-surface2);color:var(--adm-muted);font-size:11px;font-weight:800;cursor:pointer}.mongo-tool-switch button.active{background:var(--adm-accent);border-color:var(--adm-accent);color:#fff}
        @media(max-width:900px){.mongo-status-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.mongo-action-grid{grid-template-columns:1fr}.mongo-config-note{grid-template-columns:32px minmax(0,1fr)}.mongo-config-note>button{grid-column:2;justify-self:start}}
        @media(max-width:520px){.mongo-status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mongo-tools-head{display:grid}.mongo-tool-switch{justify-content:flex-start}}
      `}</style>
    </div>
  )
}
