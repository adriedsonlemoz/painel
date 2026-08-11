import { useState, useRef } from 'react'
import { Upload, X, ImageIcon, Loader2, RefreshCw, Cloud } from 'lucide-react'
import { storageService } from '../services/api'
import toast from 'react-hot-toast'

function dimensoes(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { resolve({ largura: img.naturalWidth || null, altura: img.naturalHeight || null }); URL.revokeObjectURL(url) }
    img.onerror = () => { resolve({ largura: null, altura: null }); URL.revokeObjectURL(url) }
    img.src = url
  })
}

export default function ImageUpload({ value, publicId, metadata = {}, onChange, tipo = 'noticia' }) {
  const [progresso, setProgresso] = useState(0)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setUploading(true)
      setProgresso(0)
      const dims = await dimensoes(file)
      const resultado = tipo === 'noticia' ? await storageService.uploadNoticia(file, setProgresso) : await storageService.uploadConteudo(file, tipo, setProgresso)
      onChange({
        ...resultado,
        largura: dims.largura,
        altura: dims.altura,
      })
      toast.success('Imagem salva no Cloudflare R2')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUploading(false)
      setProgresso(0)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function remover() {
    onChange(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const info = [
    metadata.largura && metadata.altura ? `${metadata.largura}×${metadata.altura}px` : '',
    metadata.mime ? metadata.mime.replace('image/', '').toUpperCase() : '',
    metadata.size ? `${(metadata.size / 1024 / 1024).toFixed(2)} MB` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className="news-image-upload">
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp"
        onChange={handleFile} className="hidden" id="news-cover-upload" />

      {value ? (
        <div className="news-image-preview">
          <img src={value} alt="Prévia da capa" />
          <div className="news-image-preview-bar">
            <div className="news-image-meta">
              <span><Cloud size={13}/> Cloudflare R2</span>
              {info && <small>{info}</small>}
            </div>
            <div className="news-image-actions">
              <button type="button" onClick={() => inputRef.current?.click()} className="adm-btn adm-btn-secondary adm-btn-sm">
                <RefreshCw size={13}/> Trocar
              </button>
              <button type="button" onClick={remover} className="adm-btn adm-btn-danger adm-btn-sm" aria-label="Remover imagem">
                <X size={13}/>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <label htmlFor="news-cover-upload" className={`news-image-drop${uploading ? ' uploading' : ''}`}>
          {uploading ? (
            <>
              <Loader2 size={24} className="adm-spin" />
              <b>Enviando para o Cloudflare R2…</b>
              <div className="news-upload-progress"><span style={{ width: `${progresso}%` }}/></div>
              <small>{progresso}%</small>
            </>
          ) : (
            <>
              <span className="news-image-icon"><ImageIcon size={21}/></span>
              <b><Upload size={14}/> Adicionar imagem</b>
              <small>JPG, PNG ou WebP · até 5 MB</small>
            </>
          )}
        </label>
      )}
      <style>{`
        .news-image-drop{min-height:132px;border:1.5px dashed var(--adm-border);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;cursor:pointer;background:var(--adm-surface2);color:var(--adm-muted);transition:.15s;padding:18px;text-align:center}
        .news-image-drop:hover{border-color:var(--adm-accent);background:rgba(var(--adm-accent-rgb,107,124,78),.05)}
        .news-image-drop b{font-size:13px;color:var(--adm-text);display:flex;align-items:center;gap:6px}.news-image-drop small{font-size:11px}.news-image-icon{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:var(--adm-surface);border:1px solid var(--adm-border)}
        .news-upload-progress{width:min(220px,70%);height:5px;background:var(--adm-border);border-radius:9px;overflow:hidden}.news-upload-progress span{display:block;height:100%;background:var(--adm-accent)}
        .news-image-preview{border:1px solid var(--adm-border);border-radius:12px;overflow:hidden;background:var(--adm-surface2)}.news-image-preview>img{display:block;width:100%;max-height:300px;object-fit:cover;background:#eee}
        .news-image-preview-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px}.news-image-meta{min-width:0;display:flex;flex-direction:column;gap:2px;color:var(--adm-muted)}.news-image-meta span{font-size:11px;font-weight:700;color:var(--adm-accent);display:flex;gap:5px;align-items:center}.news-image-meta small{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.news-image-actions{display:flex;gap:6px;flex-shrink:0}
        @media(max-width:520px){.news-image-preview-bar{align-items:flex-start}.news-image-actions .adm-btn{padding:6px 8px}.news-image-preview>img{max-height:220px}}
      `}</style>
    </div>
  )
}
