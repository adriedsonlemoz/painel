import { useRef, useState } from 'react'
import {
  Bold, Italic, Heading2, Heading3, List, ListOrdered,
  Link2, Eye, Edit3, Quote, Minus,
} from 'lucide-react'
import { markdownParaHtml } from '../utils/markdown'

export default function MarkdownEditor({ value = '', onChange, error }) {
  const [aba, setAba] = useState('editar')
  const ref = useRef(null)

  function selecionarDepois(start, end) {
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(start, end)
    })
  }

  function wrap(antes, depois = antes, placeholder = 'texto') {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selecionado = value.slice(start, end) || placeholder
    const novo = value.slice(0, start) + antes + selecionado + depois + value.slice(end)
    onChange(novo)
    selecionarDepois(start + antes.length, start + antes.length + selecionado.length)
  }

  function prefixarLinha(prefix) {
    const el = ref.current
    if (!el) return
    const cursor = el.selectionStart
    const inicio = value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
    const novo = value.slice(0, inicio) + prefix + value.slice(inicio)
    onChange(novo)
    selecionarDepois(cursor + prefix.length, cursor + prefix.length)
  }

  function inserirBloco(texto) {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const before = value.slice(0, start)
    const separador = before && !before.endsWith('\n') ? '\n' : ''
    const novo = before + separador + texto + value.slice(el.selectionEnd)
    onChange(novo)
    const pos = start + separador.length + texto.length
    selecionarDepois(pos, pos)
  }

  function handleKeyDown(e) {
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**') }
      if (e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*') }
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const novo = value.slice(0, start) + '  ' + value.slice(el.selectionEnd)
      onChange(novo)
      selecionarDepois(start + 2, start + 2)
    }
  }

  const ferramentas = [
    { icon: Bold, title: 'Negrito', fn: () => wrap('**') },
    { icon: Italic, title: 'Itálico', fn: () => wrap('*') },
    { icon: Heading2, title: 'Título H2', fn: () => prefixarLinha('## ') },
    { icon: Heading3, title: 'Título H3', fn: () => prefixarLinha('### ') },
    { icon: List, title: 'Lista', fn: () => prefixarLinha('- ') },
    { icon: ListOrdered, title: 'Lista numerada', fn: () => prefixarLinha('1. ') },
    { icon: Quote, title: 'Citação', fn: () => prefixarLinha('> ') },
    { icon: Link2, title: 'Link', fn: () => wrap('[', '](https://)', 'texto do link') },
    { icon: Minus, title: 'Separador', fn: () => inserirBloco('\n---\n') },
  ]

  const palavras = value.trim() ? value.trim().split(/\s+/).length : 0

  return (
    <div className={`news-editor${error ? ' has-error' : ''}`}>
      <div className="news-editor-topbar">
        <div className="news-editor-tools" aria-label="Ferramentas de formatação">
          {ferramentas.map(({ icon: Icon, title, fn }) => (
            <button key={title} type="button" title={title} aria-label={title} onClick={fn}>
              <Icon size={15} strokeWidth={2.2}/>
            </button>
          ))}
        </div>
        <div className="news-editor-tabs">
          <button type="button" className={aba === 'editar' ? 'active' : ''} onClick={() => setAba('editar')}>
            <Edit3 size={13}/> Editar
          </button>
          <button type="button" className={aba === 'preview' ? 'active' : ''} onClick={() => setAba('preview')}>
            <Eye size={13}/> Prévia
          </button>
        </div>
      </div>

      {aba === 'editar' ? (
        <textarea
          ref={ref}
          className="news-editor-input"
          placeholder="Escreva a notícia aqui…"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div className="news-editor-preview">
          {value.trim() ? (
            <div className="prose-news" dangerouslySetInnerHTML={{ __html: markdownParaHtml(value) }} />
          ) : (
            <p>Nada para visualizar ainda.</p>
          )}
        </div>
      )}

      <div className="news-editor-footer">
        <span>Markdown</span>
        <span>{palavras} palavras · {value.length} caracteres</span>
      </div>

      <style>{`
        .news-editor{border:1px solid var(--adm-border);border-radius:10px;overflow:hidden;background:var(--adm-surface2);transition:border-color .15s,box-shadow .15s}
        .news-editor:focus-within{border-color:var(--adm-accent);box-shadow:0 0 0 2px rgba(var(--adm-accent-rgb,107,124,78),.08)}
        .news-editor.has-error{border-color:var(--adm-red)}
        .news-editor-topbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 8px;background:var(--adm-surface);border-bottom:1px solid var(--adm-border)}
        .news-editor-tools{display:flex;align-items:center;gap:2px;min-width:0;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
        .news-editor-tools::-webkit-scrollbar{display:none}
        .news-editor-tools button{width:30px;height:30px;display:grid;place-items:center;flex:0 0 auto;border:0;border-radius:7px;background:transparent;color:var(--adm-muted);cursor:pointer}
        .news-editor-tools button:hover{background:var(--adm-surface2);color:var(--adm-text)}
        .news-editor-tabs{display:flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--adm-border);border-radius:8px;background:var(--adm-surface2);flex:0 0 auto}
        .news-editor-tabs button{border:0;border-radius:6px;padding:5px 8px;background:transparent;color:var(--adm-muted);font:600 11px var(--adm-font);cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap}
        .news-editor-tabs button.active{background:var(--adm-accent);color:#fff}
        .news-editor-input{display:block;width:100%;min-height:340px;max-height:70vh;resize:vertical;border:0;outline:0;padding:16px;background:var(--adm-surface);color:var(--adm-text);font:400 15px/1.7 var(--adm-font);box-sizing:border-box}
        .news-editor-input::placeholder{color:var(--adm-muted)}
        .news-editor-preview{min-height:340px;max-height:70vh;overflow:auto;padding:18px;background:var(--adm-surface);color:var(--adm-text)}
        .news-editor-preview>p{margin:0;color:var(--adm-muted);font-size:13px}
        .news-editor-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 10px;border-top:1px solid var(--adm-border);background:var(--adm-surface2);color:var(--adm-muted);font:500 12px var(--adm-font)}
        @media(max-width:700px){
          .news-editor-topbar{align-items:stretch;flex-direction:column;padding:6px}
          .news-editor-tabs{align-self:flex-end}
          .news-editor-input,.news-editor-preview{min-height:285px;max-height:62vh;padding:13px;font-size:14px}
          .news-editor-footer{padding:6px 8px}
        }
      `}</style>
    </div>
  )
}
