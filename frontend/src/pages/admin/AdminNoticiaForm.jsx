import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Sparkles, Check, X, ExternalLink, ChevronDown } from 'lucide-react'
import { noticiasService, categoriasService, fontesService } from '../../services/api'
import { useNoticia } from '../../hooks/useNoticias'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import ImageUpload from '../../components/ImageUpload'
import MarkdownEditor from '../../components/MarkdownEditor'
import toast from 'react-hot-toast'
import { authFetch } from '../../services/domains/http.js'

function slugify(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function idOf(item) { return String(item?._id || item?.id || '') }
function normalizar(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() }
function storageDaImagem(n) {
  if (n?.imagem_storage) return n.imagem_storage
  const id = String(n?.imagem_public_id || '')
  if (id.startsWith('r2:')) return 'r2'
  if (id.startsWith('gridfs:')) return 'gridfs'
  if (id) return 'cloudinary'
  return n?.imagem_url ? 'external' : ''
}

const STATUS_CFG = {
  rascunho:  { label: 'Rascunho',  hint: 'Somente editores veem.', cls: 'gray' },
  revisao:   { label: 'Em revisão', hint: 'Aguardando aprovação.', cls: 'amber' },
  agendado:  { label: 'Agendada',   hint: 'Publicação automática na data definida.', cls: 'blue' },
  publicado: { label: 'Publicado',  hint: 'Visível no portal.', cls: 'green' },
  arquivado: { label: 'Arquivado',  hint: 'Fora da listagem pública.', cls: 'red' },
}

const TRANSICOES = {
  rascunho:  ['revisao', 'agendado', 'publicado'],
  revisao:   ['rascunho', 'agendado', 'publicado', 'arquivado'],
  agendado:  ['rascunho', 'revisao', 'publicado', 'arquivado'],
  publicado: ['arquivado', 'rascunho', 'agendado'],
  arquivado: ['rascunho', 'agendado', 'publicado'],
}

const LABEL_BOTAO = {
  rascunho: 'Salvar rascunho', revisao: 'Enviar para revisão', agendado: 'Agendar', publicado: 'Publicar', arquivado: 'Arquivar',
}

const VAZIO = {
  titulo: '', resumo: '', conteudo: '', autor: '', tags: '', seo_titulo: '', seo_descricao: '',
  imagem_url: '', imagem_public_id: '', imagem_legenda: '', imagem_alt: '', imagem_credito: '', imagem_fonte_url: '',
  imagem_storage: '', imagem_key: '', imagem_mime: '', imagem_tamanho: null, imagem_largura: null, imagem_altura: null, imagem_nome_original: '',
  categoria_id: '', fonte_id: '', destaque: false, urgente: false, urgente_ate: '', agendado_para: '', status: 'rascunho',
}

function CharCount({ current, max }) {
  const ratio = max ? current / max : 0
  return <span className={`news-char${ratio >= 1 ? ' danger' : ratio >= .85 ? ' warn' : ''}`}>{current}/{max}</span>
}

function QuickAdd({ tipo, onCriado, onFechar }) {
  const [nome, setNome] = useState('')
  const [extra, setExtra] = useState('')
  const [auto, setAuto] = useState(true)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])

  function handleNome(v) {
    setNome(v)
    if (tipo === 'categoria' && auto) setExtra(slugify(v))
  }

  async function salvar(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!nome.trim()) return toast.error('Informe o nome.')
    try {
      setBusy(true)
      const novo = tipo === 'categoria'
        ? await categoriasService.criar({ nome: nome.trim(), slug: extra.trim() || slugify(nome) })
        : await fontesService.criar({ nome: nome.trim(), url: extra.trim() || null })
      onCriado(novo)
      toast.success(`${tipo === 'categoria' ? 'Categoria' : 'Fonte'} criada.`)
    } catch (err) { toast.error(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="news-quick-add">
      <div className="news-quick-head">
        <b>{tipo === 'categoria' ? 'Nova categoria' : 'Nova fonte'}</b>
        <button type="button" onClick={onFechar} aria-label="Fechar"><X size={14}/></button>
      </div>
      <input ref={ref} className="adm-input" value={nome} onChange={e => handleNome(e.target.value)} placeholder="Nome" />
      {tipo === 'categoria' ? (
        <input className="adm-input adm-input-mono" value={extra} onChange={e => { setAuto(false); setExtra(e.target.value) }} placeholder="slug-da-categoria" />
      ) : (
        <input className="adm-input" type="url" value={extra} onChange={e => setExtra(e.target.value)} placeholder="Site da fonte (opcional)" />
      )}
      <div className="news-inline-actions">
        <button type="button" className="adm-btn adm-btn-primary adm-btn-sm" disabled={busy} onClick={salvar}>{busy ? 'Criando…' : 'Criar e selecionar'}</button>
        <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onFechar}>Cancelar</button>
      </div>
    </div>
  )
}

function SelectIntegrado({ tipo, valor, opcoes, onChange, onNovaOpcao, erro }) {
  const [adicionando, setAdicionando] = useState(false)
  const categoria = tipo === 'categoria'
  const label = categoria ? 'Categoria *' : 'Fonte'
  const rota = categoria ? '/admin/categorias' : '/admin/fontes'

  return (
    <div className="adm-field">
      <div className="news-label-row">
        <label className="adm-label">{label}</label>
        <Link to={rota} className="news-manage-link">Gerenciar <ExternalLink size={10}/></Link>
      </div>
      <div className="news-select-add">
        <select className={`adm-input${erro ? ' adm-input-error' : ''}`} value={valor} onChange={e => onChange(e.target.value)}>
          <option value="">{categoria ? 'Selecione uma categoria' : 'Sem fonte definida'}</option>
          {opcoes.map(o => <option key={idOf(o)} value={idOf(o)}>{o.nome}</option>)}
        </select>
        <button type="button" className={`adm-btn adm-btn-secondary adm-btn-icon${adicionando ? ' active' : ''}`} onClick={() => setAdicionando(v => !v)} title={`Criar ${categoria ? 'categoria' : 'fonte'}`}>+</button>
      </div>
      {erro && <span className="news-error">{erro}</span>}
      {adicionando && <QuickAdd tipo={tipo} onFechar={() => setAdicionando(false)} onCriado={novo => {
        onNovaOpcao(novo)
        onChange(idOf(novo))
        setAdicionando(false)
      }}/>} 
    </div>
  )
}

function DetailsCard({ title, subtitle, children, open = false }) {
  return (
    <details className="adm-card news-details" open={open}>
      <summary>
        <span><b>{title}</b>{subtitle && <small>{subtitle}</small>}</span>
        <ChevronDown size={16}/>
      </summary>
      <div className="adm-card-section">{children}</div>
    </details>
  )
}

export default function AdminNoticiaForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdicao = !!id
  const { noticia, loading: carregando, error: erroCarregamento } = useNoticia(id)

  const [form, setForm] = useState(VAZIO)
  const [isDirty, setIsDirty] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [salvouOk, setSalvouOk] = useState(false)
  const [erros, setErros] = useState({})
  const [categorias, setCategorias] = useState([])
  const [fontes, setFontes] = useState([])
  const [aiBusy, setAiBusy] = useState('')
  const [aiResult, setAiResult] = useState(null)

  const { showPrompt, confirm: confirmarSaida, cancel: cancelarSaida } = useUnsavedChanges(isDirty)

  useEffect(() => {
    categoriasService.listar().then(setCategorias).catch(() => {})
    fontesService.listar().then(setFontes).catch(() => {})
  }, [])

  useEffect(() => {
    if (!noticia) return
    setForm({
      titulo: noticia.titulo || '', resumo: noticia.resumo || '', conteudo: noticia.conteudo || '', autor: noticia.autor || '',
      tags: Array.isArray(noticia.tags) ? noticia.tags.join(', ') : '', seo_titulo: noticia.seo_titulo || '', seo_descricao: noticia.seo_descricao || '',
      imagem_url: noticia.imagem_url || '', imagem_public_id: noticia.imagem_public_id || '', imagem_legenda: noticia.imagem_legenda || '',
      imagem_alt: noticia.imagem_alt || '', imagem_credito: noticia.imagem_credito || '', imagem_fonte_url: noticia.imagem_fonte_url || '',
      imagem_storage: storageDaImagem(noticia), imagem_key: noticia.imagem_key || '', imagem_mime: noticia.imagem_mime || '',
      imagem_tamanho: noticia.imagem_tamanho ?? null, imagem_largura: noticia.imagem_largura ?? null, imagem_altura: noticia.imagem_altura ?? null,
      imagem_nome_original: noticia.imagem_nome_original || '',
      categoria_id: idOf(noticia.categoria_id), fonte_id: idOf(noticia.fonte_id),
      destaque: Boolean(noticia.destaque), urgente: Boolean(noticia.urgente),
      urgente_ate: noticia.urgente_ate ? new Date(noticia.urgente_ate).toISOString().slice(0, 16) : '',
      agendado_para: noticia.agendado_para ? new Date(noticia.agendado_para).toISOString().slice(0, 16) : '',
      status: noticia.status || 'rascunho',
    })
    setIsDirty(false)
  }, [noticia])

  function set(campo, valor) {
    setForm(f => ({ ...f, [campo]: valor }))
    setIsDirty(true)
    if (erros[campo]) setErros(e => ({ ...e, [campo]: '' }))
  }

  const categoriaAtual = categorias.find(c => idOf(c) === String(form.categoria_id))
  const fonteAtual = fontes.find(f => idOf(f) === String(form.fonte_id))

  function categoriaIdPorNome(nome) {
    const alvo = normalizar(nome)
    return idOf(categorias.find(c => normalizar(c.nome) === alvo))
  }

  async function executarIA(acao) {
    if (!form.titulo.trim() && !form.conteudo.trim()) return toast.error('Escreva um título ou conteúdo antes de usar a IA.')
    try {
      setAiBusy(acao)
      setAiResult(null)
      const apiBase = import.meta.env.VITE_API_URL || '/api'
      const r = await authFetch(`${apiBase}/analysis/ai/editorial`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao, titulo: form.titulo, resumo: form.resumo, conteudo: form.conteudo,
          categoria_atual: categoriaAtual?.nome || '', fonte: fonteAtual?.nome || '',
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.erro || 'Falha ao consultar a IA')
      setAiResult(d.resultado)
    } catch (err) { toast.error(err.message) }
    finally { setAiBusy('') }
  }

  function aplicarCampos(campos) {
    setForm(f => ({ ...f, ...campos }))
    setIsDirty(true)
    toast.success('Sugestão aplicada. Revise antes de salvar.')
  }

  function aplicarCompletar(parte = 'tudo') {
    if (!aiResult) return
    const campos = {}
    if (parte === 'tudo' || parte === 'resumo') if (aiResult.resumo) campos.resumo = aiResult.resumo.slice(0, 300)
    if (parte === 'tudo' || parte === 'seo') {
      if (aiResult.seo_titulo) campos.seo_titulo = aiResult.seo_titulo.slice(0, 120)
      if (aiResult.seo_descricao) campos.seo_descricao = aiResult.seo_descricao.slice(0, 180)
    }
    if (parte === 'tudo' || parte === 'classificacao') {
      if (Array.isArray(aiResult.tags)) campos.tags = aiResult.tags.join(', ')
      const cat = categoriaIdPorNome(aiResult.categoria)
      if (cat) campos.categoria_id = cat
    }
    aplicarCampos(campos)
  }

  function validar() {
    const e = {}
    if (!form.titulo.trim()) e.titulo = 'Título é obrigatório.'
    if (!form.categoria_id) e.categoria_id = 'Toda notícia precisa de uma categoria.'
    if (!form.conteudo.trim()) e.conteudo = 'Conteúdo é obrigatório.'
    if (form.resumo.length > 300) e.resumo = 'Máximo de 300 caracteres.'
    if (form.seo_titulo.length > 120) e.seo_titulo = 'Máximo de 120 caracteres.'
    if (form.seo_descricao.length > 180) e.seo_descricao = 'Máximo de 180 caracteres.'
    if (form.imagem_url && !form.imagem_alt.trim()) e.imagem_alt = 'Informe um texto alternativo para a imagem.'
    if (form.status === 'agendado' && !form.agendado_para) e.agendado_para = 'Informe a data e hora da publicação.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(ev) {
    ev.preventDefault()
    if (!validar()) return toast.error('Corrija os campos destacados antes de salvar.')
    try {
      setSalvando(true)
      const dados = {
        titulo: form.titulo.trim(), resumo: form.resumo.trim(), conteudo: form.conteudo.trim(), autor: form.autor.trim() || null,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean), seo_titulo: form.seo_titulo.trim() || null, seo_descricao: form.seo_descricao.trim() || null,
        imagem_url: form.imagem_url || null, imagem_public_id: form.imagem_public_id || null, imagem_legenda: form.imagem_legenda.trim() || null,
        imagem_alt: form.imagem_alt.trim() || null, imagem_credito: form.imagem_credito.trim() || null, imagem_fonte_url: form.imagem_fonte_url.trim() || null,
        imagem_storage: form.imagem_storage || null, imagem_key: form.imagem_key || null, imagem_mime: form.imagem_mime || null,
        imagem_tamanho: form.imagem_tamanho || null, imagem_largura: form.imagem_largura || null, imagem_altura: form.imagem_altura || null,
        imagem_nome_original: form.imagem_nome_original || null,
        categoria_id: form.categoria_id, fonte_id: form.fonte_id || null, destaque: form.destaque, urgente: form.urgente,
        urgente_ate: form.urgente && form.urgente_ate ? new Date(form.urgente_ate).toISOString() : null,
        agendado_para: form.status === 'agendado' && form.agendado_para ? new Date(form.agendado_para).toISOString() : null,
        status: form.status,
      }
      if (isEdicao) await noticiasService.editar(id, dados)
      else await noticiasService.criar(dados)
      setIsDirty(false)
      setSalvouOk(true)
    } catch (err) { toast.error(err.message) }
    finally { setSalvando(false) }
  }

  if (isEdicao && carregando) return <div className="adm-empty" style={{ marginTop: 80 }}>Carregando…</div>
  if (isEdicao && !carregando && !noticia) return (
    <div className="adm-empty" style={{ marginTop: 80 }}>
      <p style={{ fontWeight: 700 }}>Não foi possível carregar a notícia.</p>
      {erroCarregamento && <p style={{ fontSize: 12, color: 'var(--adm-red)' }}>{erroCarregamento}</p>}
      <Link to="/admin/noticias" className="adm-btn adm-btn-secondary">Voltar</Link>
    </div>
  )

  const statusAtual = STATUS_CFG[form.status] || STATUS_CFG.rascunho
  const permitidos = isEdicao ? new Set([form.status, ...(TRANSICOES[form.status] || [])]) : new Set(['rascunho', 'revisao', 'agendado', 'publicado'])

  const BotaoSalvar = ({ compact = false }) => (
    <button type="submit" form="form-noticia" disabled={salvando} className={`adm-btn adm-btn-primary${compact ? ' adm-btn-sm' : ''}`}>
      {salvando ? 'Salvando…' : <><Check size={14}/> {LABEL_BOTAO[form.status] || 'Salvar'}</>}
    </button>
  )

  return (
    <>
      <style>{`
        .news-page .adm-page-header{margin-bottom:14px}.news-page .adm-page-title{font-size:20px}.news-page .adm-page-sub{display:flex;align-items:center;gap:8px}
        .news-status-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700}.news-status-badge.green{background:rgba(34,197,94,.12);color:#16a34a}.news-status-badge.gray{background:rgba(100,116,139,.12);color:var(--adm-muted)}.news-status-badge.amber{background:rgba(245,158,11,.12);color:#d97706}.news-status-badge.blue{background:rgba(59,130,246,.12);color:#2563eb}.news-status-badge.red{background:rgba(239,68,68,.1);color:var(--adm-red)}
        .news-form-grid{grid-template-columns:minmax(0,1fr) 290px}.news-form-main{gap:12px}.news-form-side{gap:12px;position:sticky;top:76px}
        .news-two-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}.news-label-row{display:flex;align-items:center;justify-content:space-between;gap:8px}.news-label-row .adm-label{margin-bottom:6px}.news-manage-link{font-size:10px;color:var(--adm-accent);text-decoration:none;display:flex;align-items:center;gap:3px;margin-bottom:6px}.news-select-add{display:flex;gap:6px}.news-select-add select{min-width:0}.news-select-add .adm-btn{width:34px;height:34px;justify-content:center;font-size:18px;padding:0}.news-select-add .adm-btn.active{border-color:var(--adm-accent);color:var(--adm-accent)}
        .news-quick-add{display:grid;gap:7px;padding:10px;margin-top:7px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2)}.news-quick-head{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--adm-muted)}.news-quick-head button{border:0;background:transparent;color:var(--adm-muted);cursor:pointer}.news-inline-actions{display:flex;gap:6px;flex-wrap:wrap}.news-error{font-size:10px;color:var(--adm-red);display:block;margin-top:4px}.news-char{font-size:10px;color:var(--adm-muted);display:block;text-align:right;margin-top:3px}.news-char.warn{color:#d97706}.news-char.danger{color:var(--adm-red)}
        .news-content-card .adm-card-section{padding-bottom:16px}.news-cover-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.news-cover-fields .wide{grid-column:1/-1}.news-r2-note{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;color:var(--adm-muted);font-size:10px;line-height:1.45}.news-r2-note b{color:var(--adm-accent)}
        .news-details>summary{list-style:none;cursor:pointer;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;color:var(--adm-text)}.news-details>summary::-webkit-details-marker{display:none}.news-details>summary span{display:flex;flex-direction:column;gap:2px}.news-details>summary b{font-size:12px}.news-details>summary small{font-size:10px;font-weight:400;color:var(--adm-muted)}.news-details[open]>summary{border-bottom:1px solid var(--adm-border)}.news-details[open]>summary svg{transform:rotate(180deg)}
        .news-ai-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.news-ai-actions .adm-btn{justify-content:center}.news-ai-result{margin-top:12px;border:1px solid var(--adm-border);border-radius:9px;padding:11px;background:var(--adm-surface2);font-size:11px;line-height:1.5}.news-ai-result-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px}.news-ai-result-head small{color:var(--adm-muted)}.news-ai-list{margin:6px 0 0;padding-left:18px}.news-ai-proposal{padding:8px 0;border-top:1px solid var(--adm-border)}.news-ai-proposal:first-of-type{border-top:0}.news-ai-proposal p{margin:4px 0;white-space:pre-wrap}.news-ai-text{max-height:230px;overflow:auto;padding:9px;border:1px solid var(--adm-border);border-radius:7px;background:var(--adm-surface);white-space:pre-wrap}.news-ai-mini-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
        .news-status-select{display:flex;align-items:center;gap:8px}.news-status-select select{flex:1}.news-status-hint{font-size:10px;color:var(--adm-muted);margin-top:5px;line-height:1.4}.news-toggle-compact .adm-toggle-row{padding:8px 0}.news-toggle-compact .adm-toggle-desc{font-size:10px}.news-side-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--adm-muted);margin-bottom:8px}
        .news-mobile-actions{display:none}.news-modal-card{width:min(420px,100%);padding:22px;border-radius:14px;background:var(--adm-surface);border:1px solid var(--adm-border);box-shadow:var(--adm-shadow-md)}
        @media(max-width:768px){
          .news-page{padding-bottom:72px}.news-form-grid{grid-template-columns:1fr}.news-form-grid .adm-form-col:last-child{order:-1!important}.news-form-side{position:static}.news-page .adm-page-actions{display:none}.news-mobile-actions{display:flex;position:fixed;left:12px;right:12px;bottom:12px;z-index:80;padding:7px;background:color-mix(in srgb,var(--adm-surface) 94%,transparent);border:1px solid var(--adm-border);border-radius:11px;box-shadow:var(--adm-shadow-md);backdrop-filter:blur(10px);gap:7px}.news-mobile-actions .adm-btn{flex:1;justify-content:center}.news-two-cols,.news-cover-fields{grid-template-columns:1fr}.news-cover-fields .wide{grid-column:auto}.news-ai-actions{grid-template-columns:1fr 1fr}.news-page .adm-card-section{padding:12px}.news-details>summary{padding:11px 12px}
        }
        @media(max-width:420px){.news-ai-actions{grid-template-columns:1fr}.news-page .adm-page-title{font-size:19px}.news-r2-note{flex-direction:column}}
      `}</style>

      <div className="news-page">
        {salvouOk && (
          <div className="adm-modal-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'center', padding: 18 }}>
            <div className="news-modal-card">
              <div style={{ width: 42, height: 42, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(34,197,94,.12)', color: '#16a34a', marginBottom: 12 }}><Check size={21}/></div>
              <b style={{ fontSize: 16 }}>{form.status === 'publicado' ? 'Notícia publicada' : 'Notícia salva'}</b>
              <p style={{ fontSize: 12, color: 'var(--adm-muted)', margin: '5px 0 16px' }}>As alterações foram registradas.</p>
              <div className="news-inline-actions">
                <button className="adm-btn adm-btn-secondary" onClick={() => setSalvouOk(false)}>Continuar editando</button>
                <button className="adm-btn adm-btn-primary" onClick={() => navigate('/admin/noticias')}>Voltar às notícias</button>
              </div>
            </div>
          </div>
        )}

        {showPrompt && (
          <div className="adm-modal-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'center', padding: 18 }} onClick={e => { if (e.target === e.currentTarget) cancelarSaida() }}>
            <div className="news-modal-card">
              <b style={{ fontSize: 16 }}>Sair sem salvar?</b>
              <p style={{ fontSize: 12, color: 'var(--adm-muted)', margin: '6px 0 16px' }}>As alterações desta notícia serão perdidas.</p>
              <div className="news-inline-actions">
                <button className="adm-btn adm-btn-secondary" onClick={cancelarSaida}>Continuar editando</button>
                <button className="adm-btn adm-btn-danger" onClick={confirmarSaida}>Sair sem salvar</button>
              </div>
            </div>
          </div>
        )}

        <div className="adm-page-header">
          <div>
            <div className="adm-page-title">{isEdicao ? 'Editar notícia' : 'Nova notícia'}</div>
            <div className="adm-page-sub">
              <span>{isEdicao ? 'Edite, revise e publique.' : 'Escreva, classifique e publique.'}</span>
              <span className={`news-status-badge ${statusAtual.cls}`}>{statusAtual.label}</span>
            </div>
          </div>
          <div className="adm-page-actions">
            <Link to="/admin/noticias" className="adm-btn adm-btn-secondary">Cancelar</Link>
            <BotaoSalvar />
          </div>
        </div>

        <form id="form-noticia" onSubmit={handleSubmit} noValidate>
          <div className="adm-form-grid news-form-grid">
            <div className="adm-form-col news-form-main">
              <div className="adm-card">
                <div className="adm-card-section">
                  <div className="adm-field">
                    <label className="adm-label" htmlFor="titulo">Título *</label>
                    <input id="titulo" className={`adm-input${erros.titulo ? ' adm-input-error' : ''}`} value={form.titulo} onChange={e => set('titulo', e.target.value)} maxLength={200} placeholder="Título da notícia" />
                    {erros.titulo ? <span className="news-error">{erros.titulo}</span> : <CharCount current={form.titulo.length} max={200}/>} 
                  </div>
                  <div className="adm-field">
                    <label className="adm-label" htmlFor="resumo">Resumo / lead</label>
                    <textarea id="resumo" className={`adm-input${erros.resumo ? ' adm-input-error' : ''}`} rows={2} maxLength={300} value={form.resumo} onChange={e => set('resumo', e.target.value)} placeholder="1–2 frases com o essencial da notícia" />
                    {erros.resumo ? <span className="news-error">{erros.resumo}</span> : <CharCount current={form.resumo.length} max={300}/>} 
                  </div>
                  <div className="news-two-cols">
                    <SelectIntegrado tipo="categoria" valor={form.categoria_id} opcoes={categorias} erro={erros.categoria_id} onChange={v => set('categoria_id', v)} onNovaOpcao={n => setCategorias(prev => [...prev, n].sort((a, b) => a.nome.localeCompare(b.nome)))}/>
                    <SelectIntegrado tipo="fonte" valor={form.fonte_id} opcoes={fontes} onChange={v => set('fonte_id', v)} onNovaOpcao={n => setFontes(prev => [...prev, n].sort((a, b) => a.nome.localeCompare(b.nome)))}/>
                  </div>
                </div>
              </div>

              <div className="adm-card news-content-card">
                <div className="adm-card-section">
                  <div className="adm-section-label">Conteúdo *</div>
                  <MarkdownEditor value={form.conteudo} onChange={v => set('conteudo', v)} error={Boolean(erros.conteudo)}/>
                  {erros.conteudo && <span className="news-error">{erros.conteudo}</span>}
                </div>
              </div>

              <div className="adm-card">
                <div className="adm-card-section">
                  <div className="adm-section-label">Imagem de capa</div>
                  <div className="news-r2-note">
                    <span><b>Cloudflare R2</b> · JPG, PNG ou WebP · até 5 MB. O AL Sistemas organiza automaticamente em <code>alsistemas/noticias/capas/ano/mês</code>.</span>
                    {form.imagem_storage === 'r2' && <span className="news-status-badge green">R2</span>}
                  </div>
                  <ImageUpload
                    value={form.imagem_url}
                    publicId={form.imagem_public_id}
                    metadata={{ largura: form.imagem_largura, altura: form.imagem_altura, mime: form.imagem_mime, size: form.imagem_tamanho }}
                    onChange={r => {
                      if (!r) {
                        setForm(f => ({ ...f, imagem_url: '', imagem_public_id: '', imagem_storage: '', imagem_key: '', imagem_mime: '', imagem_tamanho: null, imagem_largura: null, imagem_altura: null, imagem_nome_original: '' }))
                        setIsDirty(true)
                        return
                      }
                      setForm(f => ({
                        ...f,
                        imagem_url: r.url || '', imagem_public_id: r.public_id || '', imagem_storage: r.storage || 'r2', imagem_key: r.key || '',
                        imagem_mime: r.mime || '', imagem_tamanho: r.size ?? null, imagem_largura: r.largura ?? null, imagem_altura: r.altura ?? null,
                        imagem_nome_original: r.original_name || '', imagem_alt: f.imagem_alt || f.titulo || '',
                      }))
                      setIsDirty(true)
                    }}
                  />
                  {form.imagem_url && (
                    <div className="news-cover-fields">
                      <div className="adm-field wide">
                        <label className="adm-label" htmlFor="imagem_alt">Texto alternativo *</label>
                        <input id="imagem_alt" className={`adm-input${erros.imagem_alt ? ' adm-input-error' : ''}`} value={form.imagem_alt} onChange={e => set('imagem_alt', e.target.value)} maxLength={220} placeholder="Descreva objetivamente o que aparece na imagem" />
                        {erros.imagem_alt ? <span className="news-error">{erros.imagem_alt}</span> : <span className="adm-hint">Usado por leitores de tela e quando a imagem não carrega.</span>}
                      </div>
                      <div className="adm-field">
                        <label className="adm-label" htmlFor="imagem_legenda">Legenda</label>
                        <input id="imagem_legenda" className="adm-input" value={form.imagem_legenda} onChange={e => set('imagem_legenda', e.target.value)} maxLength={250} placeholder="Legenda exibida no portal" />
                      </div>
                      <div className="adm-field">
                        <label className="adm-label" htmlFor="imagem_credito">Crédito</label>
                        <input id="imagem_credito" className="adm-input" value={form.imagem_credito} onChange={e => set('imagem_credito', e.target.value)} maxLength={180} placeholder="Foto: Nome / Agência" />
                      </div>
                      <div className="adm-field wide" style={{ marginBottom: 0 }}>
                        <label className="adm-label" htmlFor="imagem_fonte_url">Link da fonte da imagem</label>
                        <input id="imagem_fonte_url" type="url" className="adm-input" value={form.imagem_fonte_url} onChange={e => set('imagem_fonte_url', e.target.value)} placeholder="https://…" />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <DetailsCard title="Assistente editorial de IA" subtitle="Sugestões separadas; nada é aplicado ou publicado automaticamente.">
                <div className="news-ai-actions">
                  <button type="button" className="adm-btn adm-btn-secondary" disabled={Boolean(aiBusy)} onClick={() => executarIA('analisar')}><Sparkles size={13}/> {aiBusy === 'analisar' ? 'Analisando…' : 'Revisar texto'}</button>
                  <button type="button" className="adm-btn adm-btn-secondary" disabled={Boolean(aiBusy)} onClick={() => executarIA('completar')}><Sparkles size={13}/> {aiBusy === 'completar' ? 'Gerando…' : 'Completar campos'}</button>
                  <button type="button" className="adm-btn adm-btn-secondary" disabled={Boolean(aiBusy)} onClick={() => executarIA('titulos')}><Sparkles size={13}/> {aiBusy === 'titulos' ? 'Gerando…' : 'Sugerir títulos'}</button>
                  <button type="button" className="adm-btn adm-btn-secondary" disabled={Boolean(aiBusy)} onClick={() => executarIA('melhorar')}><Sparkles size={13}/> {aiBusy === 'melhorar' ? 'Reescrevendo…' : 'Melhorar conteúdo'}</button>
                </div>
                <p className="adm-hint" style={{ marginTop: 8 }}>A IA recebe o texto, a categoria atual e o nome da fonte. A fonte nunca é trocada pela IA.</p>

                {aiResult && (
                  <div className="news-ai-result">
                    <div className="news-ai-result-head"><b>Resultado</b><small>{aiResult._meta?.provedor} · {aiResult._meta?.modelo}</small></div>
                    {aiResult.qualidade && (
                      <>
                        <b>Nota: {Math.round(Number(aiResult.qualidade.nota) || 0)}/100</b>
                        {aiResult.qualidade.alertas?.length > 0 && <><div style={{ marginTop: 7 }}><b>Alertas</b></div><ul className="news-ai-list">{aiResult.qualidade.alertas.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
                        {aiResult.qualidade.correcoes?.length > 0 && <><div style={{ marginTop: 7 }}><b>Correções sugeridas</b></div><ul className="news-ai-list">{aiResult.qualidade.correcoes.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
                      </>
                    )}
                    {aiResult.titulos_alternativos?.map((titulo, i) => (
                      <div className="news-ai-proposal" key={`${titulo}-${i}`}>
                        <p>{titulo}</p><button type="button" className="adm-btn adm-btn-primary adm-btn-sm" onClick={() => aplicarCampos({ titulo })}>Usar este título</button>
                      </div>
                    ))}
                    {aiResult.resumo && (
                      <div className="news-ai-proposal"><b>Resumo</b><p>{aiResult.resumo}</p><button type="button" className="adm-btn adm-btn-secondary adm-btn-sm" onClick={() => aplicarCompletar('resumo')}>Aplicar resumo</button></div>
                    )}
                    {(aiResult.seo_titulo || aiResult.seo_descricao) && (
                      <div className="news-ai-proposal"><b>SEO</b><p>{aiResult.seo_titulo}<br/>{aiResult.seo_descricao}</p><button type="button" className="adm-btn adm-btn-secondary adm-btn-sm" onClick={() => aplicarCompletar('seo')}>Aplicar SEO</button></div>
                    )}
                    {(aiResult.categoria || aiResult.tags?.length) && (
                      <div className="news-ai-proposal"><b>Classificação</b><p>{aiResult.categoria || '—'} · {(aiResult.tags || []).join(', ')}</p><button type="button" className="adm-btn adm-btn-secondary adm-btn-sm" disabled={Boolean(aiResult.categoria && !categoriaIdPorNome(aiResult.categoria))} onClick={() => aplicarCompletar('classificacao')}>Aplicar categoria e tags</button></div>
                    )}
                    {aiResult.conteudo_sugerido && (
                      <div className="news-ai-proposal"><b>Conteúdo revisado</b><div className="news-ai-text">{aiResult.conteudo_sugerido}</div>{aiResult.alteracoes?.length > 0 && <ul className="news-ai-list">{aiResult.alteracoes.map((x, i) => <li key={i}>{x}</li>)}</ul>}<button type="button" className="adm-btn adm-btn-primary adm-btn-sm" onClick={() => aplicarCampos({ conteudo: aiResult.conteudo_sugerido })}>Substituir conteúdo</button></div>
                    )}
                    {aiResult._meta?.acao === 'completar' && <div className="news-ai-mini-actions"><button type="button" className="adm-btn adm-btn-primary adm-btn-sm" onClick={() => aplicarCompletar('tudo')}>Aplicar todos os campos sugeridos</button></div>}
                  </div>
                )}
              </DetailsCard>

              <DetailsCard title="SEO e autoria" subtitle="Opcional; usa título e resumo como fallback.">
                <div className="news-two-cols">
                  <div className="adm-field"><label className="adm-label" htmlFor="autor">Autor</label><input id="autor" className="adm-input" value={form.autor} onChange={e => set('autor', e.target.value)} placeholder="Nome ou redação" /></div>
                  <div className="adm-field"><label className="adm-label" htmlFor="tags">Tags</label><input id="tags" className="adm-input" value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="cidade, política, cultura" /></div>
                </div>
                <div className="adm-field"><label className="adm-label" htmlFor="seo_titulo">Título SEO</label><input id="seo_titulo" className={`adm-input${erros.seo_titulo ? ' adm-input-error' : ''}`} maxLength={120} value={form.seo_titulo} onChange={e => set('seo_titulo', e.target.value)} placeholder="Vazio = título da notícia"/><CharCount current={form.seo_titulo.length} max={120}/></div>
                <div className="adm-field" style={{ marginBottom: 0 }}><label className="adm-label" htmlFor="seo_descricao">Descrição SEO</label><textarea id="seo_descricao" rows={2} className={`adm-input${erros.seo_descricao ? ' adm-input-error' : ''}`} maxLength={180} value={form.seo_descricao} onChange={e => set('seo_descricao', e.target.value)} placeholder="Vazio = resumo da notícia"/><CharCount current={form.seo_descricao.length} max={180}/></div>
              </DetailsCard>
            </div>

            <div className="adm-form-col news-form-side">
              <div className="adm-card">
                <div className="adm-card-section">
                  <div className="news-side-label">Publicação</div>
                  <div className="adm-field">
                    <label className="adm-label" htmlFor="status">Status</label>
                    <div className="news-status-select">
                      <select id="status" className="adm-input" value={form.status} onChange={e => set('status', e.target.value)}>
                        {Object.entries(STATUS_CFG).map(([valor, cfg]) => <option key={valor} value={valor} disabled={!permitidos.has(valor)}>{cfg.label}</option>)}
                      </select>
                      <span className={`news-status-badge ${statusAtual.cls}`}>{statusAtual.label}</span>
                    </div>
                    <div className="news-status-hint">{statusAtual.hint}</div>
                  </div>
                  {form.status === 'agendado' && (
                    <div className="adm-field"><label className="adm-label" htmlFor="agendado_para">Publicar em *</label><input id="agendado_para" type="datetime-local" className={`adm-input${erros.agendado_para ? ' adm-input-error' : ''}`} value={form.agendado_para} onChange={e => set('agendado_para', e.target.value)}/>{erros.agendado_para && <span className="news-error">{erros.agendado_para}</span>}</div>
                  )}
                  <div className="news-toggle-compact">
                    <div className="adm-toggle-row"><div><div className="adm-toggle-label">Destaque</div><div className="adm-toggle-desc">Exibir na área de destaques.</div></div><button type="button" role="switch" aria-checked={form.destaque} className={`adm-toggle${form.destaque ? ' on' : ''}`} onClick={() => set('destaque', !form.destaque)}/></div>
                    <div className="adm-toggle-row"><div><div className="adm-toggle-label">Plantão / urgente</div><div className="adm-toggle-desc">Faixa de urgência no portal.</div></div><button type="button" role="switch" aria-checked={form.urgente} className={`adm-toggle${form.urgente ? ' on' : ''}`} onClick={() => set('urgente', !form.urgente)}/></div>
                  </div>
                  {form.urgente && <div className="adm-field" style={{ marginTop: 8, marginBottom: 0 }}><label className="adm-label" htmlFor="urgente_ate">Encerrar plantão em</label><input id="urgente_ate" type="datetime-local" className="adm-input" value={form.urgente_ate} onChange={e => set('urgente_ate', e.target.value)}/></div>}
                </div>
              </div>
            </div>
          </div>

          <div className="news-mobile-actions">
            <Link to="/admin/noticias" className="adm-btn adm-btn-secondary">Cancelar</Link>
            <BotaoSalvar compact />
          </div>
        </form>
      </div>
    </>
  )
}
