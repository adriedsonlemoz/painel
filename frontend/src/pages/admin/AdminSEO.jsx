import { useState, useEffect, useRef } from 'react'
import { configuracoesService, storageService } from '../../services/api'
import toast from 'react-hot-toast'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import ConfirmModal from '../../components/ConfirmModal'

// ─── Paleta (padrão do admin) ─────────────────────────────────
import { T as C, SPACE, RADIUS, FONT } from '../../themes/tokens'
import AdminIcon from '../../components/admin/ui/AdminIcon'
import { DSModal } from '../../components/admin/ui/DS'

// Alias para compatibilidade com JSX já escrito abaixo
const Ico = {
  id:    <AdminIcon name="id"    size={15} />,
  image: <AdminIcon name="image" size={15} />,
  share: <AdminIcon name="share" size={15} />,
  chart: <AdminIcon name="chart" size={15} />,
  robot: <AdminIcon name="robot" size={15} />,
  map:   <AdminIcon name="map"   size={15} />,
}

// ─── Chaves salvas no banco ───────────────────────────────────
const ALL_KEYS = [
  'nome_site', 'site_titulo', 'site_descricao', 'site_author', 'site_keywords', 'site_url',
  'site_favicon',
  'site_imagem', 'site_twitter_card', 'site_twitter_site',
  'site_ga_id', 'site_gsc_verification',
  'site_robots',
  'sitemap_changefreq', 'sitemap_priority', 'sitemap_limite', 'sitemap_cache_min',
]

// ─── Abas (padrão: ABAS + abaAtiva) ──────────────────────────
const ABAS = [
  { id: 'identidade', label: 'Identidade',   icon: Ico.id    },
  { id: 'favicon',    label: 'Favicon',       icon: Ico.image },
  { id: 'social',     label: 'Redes Sociais', icon: Ico.share },
  { id: 'analytics',  label: 'Analytics',     icon: Ico.chart },
  { id: 'indexacao',  label: 'Indexação',     icon: Ico.robot },
  { id: 'sitemap',    label: 'Sitemap',        icon: Ico.map   },
]

// ─── Campo genérico ───────────────────────────────────────────
function Campo({ campo, value, onChange }) {
  const id       = `seo-${campo.key}`
  const charCount = campo.key === 'site_descricao' ? (value || '').length : null
  const charOk    = charCount === null || (charCount >= 120 && charCount <= 160)

  return (
    <div style={{ marginBottom: SPACE.xl2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <label className="adm-label" htmlFor={id} style={{ fontWeight: 600, marginBottom: 0 }}>
          {campo.label}
        </label>
        {charCount !== null && (
          <span style={{ fontSize: FONT.sm, color: charOk ? C.accent : C.yellow, fontWeight: 500 }}>
            {charCount} / 160
          </span>
        )}
      </div>

      {campo.type === 'textarea' ? (
        <textarea
          id={id} className="adm-input" rows={3}
          value={value || ''} placeholder={campo.placeholder}
          onChange={e => onChange(campo.key, e.target.value)}
        />
      ) : campo.type === 'select' ? (
        <select
          id={id} className="adm-input"
          value={value || ''} onChange={e => onChange(campo.key, e.target.value)}
        >
          {campo.options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : campo.type === 'number' ? (
        <input
          id={id} type="number" className="adm-input"
          value={value || ''} placeholder={campo.placeholder}
          min={campo.min} max={campo.max}
          onChange={e => onChange(campo.key, e.target.value)}
        />
      ) : (
        <input
          id={id} type="text" className="adm-input"
          value={value || ''} placeholder={campo.placeholder}
          onChange={e => onChange(campo.key, e.target.value)}
        />
      )}

      {campo.hint && (
        <span style={{ fontSize: FONT.sm, color: C.muted, display: 'block', marginTop: 6, lineHeight: 1.5 }}>
          {campo.hint}
        </span>
      )}
    </div>
  )
}

// ─── Aba: Favicon ─────────────────────────────────────────────
function AbaFavicon({ value, onChange }) {
  const fileRef    = useRef(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Apenas imagens são permitidas'); return }
    setUploading(true)
    try {
      const { url } = await storageService.upload(file)
      onChange('site_favicon', url)
      toast.success('Favicon enviado!')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{
        width: 64, height: 64, borderRadius: RADIUS.xl, flexShrink: 0,
        border: `2px solid ${C.border}`, background: C.surf2,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
      }}>
        {value
          ? <img src={value} alt="favicon" style={{ width: 32, height: 32, objectFit: 'contain' }} />
          : <span style={{ fontSize: 24, opacity: 0.3 }}>🖼️</span>
        }
      </div>

      <div style={{ flex: 1, minWidth: 240 }}>
        <div className="adm-label" style={{ marginBottom: SPACE.md, fontWeight: 600 }}>URL do favicon</div>
        <div style={{ display: 'flex', gap: SPACE.md }}>
          <input type="text" className="adm-input" placeholder="https://seusite.com/favicon.ico"
            value={value || ''} onChange={e => onChange('site_favicon', e.target.value)}
            style={{ flex: 1 }} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
          <button type="button" onClick={() => fileRef.current?.click()}
            disabled={uploading} className="adm-btn adm-btn-secondary"
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
            {uploading ? 'Enviando...' : 'Fazer Upload'}
          </button>
        </div>
        <span style={{ fontSize: FONT.sm, color: C.muted, marginTop: 8, display: 'block', lineHeight: 1.5 }}>
          Recomendado: .ico, .png ou .svg de 32×32 px.
        </span>
      </div>
    </div>
  )
}

// ─── Aba: Sitemap ─────────────────────────────────────────────
function AbaSitemap({ cfg, onChange }) {
  // Deriva a URL base do backend a partir da variável de ambiente
  const apiBase   = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:3001/api' : '/api')
  const backendUrl = apiBase.replace(/\/api\/?$/, '')
  const sitemapUrl = `${backendUrl}/sitemap.xml`

  const campos = [
    {
      key: 'sitemap_changefreq', label: 'Frequência de atualização', type: 'select',
      hint: 'Indica aos crawlers com qual frequência o conteúdo das notícias muda',
      options: [
        { value: 'always',  label: 'Always  — muda a cada acesso' },
        { value: 'hourly',  label: 'Hourly  — atualiza toda hora' },
        { value: 'daily',   label: 'Daily   — atualiza diariamente' },
        { value: 'weekly',  label: 'Weekly  — atualiza semanalmente (recomendado)' },
        { value: 'monthly', label: 'Monthly — atualiza mensalmente' },
        { value: 'yearly',  label: 'Yearly  — raramente muda' },
        { value: 'never',   label: 'Never   — conteúdo arquivado' },
      ],
    },
    {
      key: 'sitemap_priority', label: 'Prioridade das notícias', type: 'select',
      hint: 'Valor de 0.1 a 1.0 — relativo entre as URLs do mesmo site (homepage é sempre 1.0)',
      options: [
        { value: '0.9', label: '0.9 — Alta' },
        { value: '0.8', label: '0.8 — Acima da média' },
        { value: '0.7', label: '0.7 — Média (recomendado)' },
        { value: '0.6', label: '0.6 — Abaixo da média' },
        { value: '0.5', label: '0.5 — Baixa' },
      ],
    },
    {
      key: 'sitemap_limite', label: 'Máximo de notícias no sitemap', type: 'number',
      placeholder: '1000', min: 10, max: 50000,
      hint: 'Limite por especificação do protocolo: 50 000 URLs por arquivo',
    },
    {
      key: 'sitemap_cache_min', label: 'Cache do sitemap (minutos)', type: 'number',
      placeholder: '10', min: 1, max: 1440,
      hint: 'Após salvar, o XML fica em cache por este tempo antes de ser regerado. Padrão: 10 min',
    },
  ]

  return (
    <div>
      {/* URL do sitemap */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderRadius: RADIUS.md, marginBottom: 24,
        background: 'rgba(59,130,246,0.08)', border: `1px solid rgba(59,130,246,0.25)`,
      }}>
        <span style={{ fontSize: FONT.lg, color: C.blue, flexShrink: 0 }}>{Ico.map}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FONT.sm, color: C.muted, marginBottom: 2 }}>URL pública do sitemap</div>
          <code style={{ fontSize: FONT.base, color: C.blue, wordBreak: 'break-all' }}>{sitemapUrl}</code>
        </div>
        <a href={sitemapUrl} target="_blank" rel="noopener noreferrer"
          className="adm-btn adm-btn-secondary"
          style={{ flexShrink: 0, fontSize: FONT.base, padding: '5px 10px' }}>
          Abrir ↗
        </a>
      </div>

      {campos.map(campo => (
        <Campo key={campo.key} campo={campo} value={cfg[campo.key]} onChange={onChange} />
      ))}

      {/* Resumo */}
      <div style={{
        marginTop: 8, padding: 14, borderRadius: RADIUS.md,
        background: C.surf2, border: `1px solid ${C.border}`,
        fontSize: FONT.base, color: C.muted, lineHeight: 1.8,
      }}>
        <div style={{ fontWeight: 600, color: C.text, marginBottom: 6 }}>📋 Configuração atual</div>
        <div>• Frequência: <strong style={{ color: C.text }}>{cfg.sitemap_changefreq || 'weekly'}</strong></div>
        <div>• Prioridade: <strong style={{ color: C.text }}>{cfg.sitemap_priority || '0.7'}</strong> (homepage sempre 1.0)</div>
        <div>• Limite: <strong style={{ color: C.text }}>{cfg.sitemap_limite || '1000'}</strong> notícias</div>
        <div>• Cache: <strong style={{ color: C.text }}>{cfg.sitemap_cache_min || '10'} min</strong></div>
      </div>

      <div style={{
        marginTop: 14, padding: 12,
        background: 'rgba(34,197,94,0.08)', borderRadius: RADIUS.md,
        fontSize: FONT.base, color: C.green, border: `1px solid rgba(34,197,94,0.2)`,
      }}>
        💡 Após salvar, submeta a URL no <strong>Google Search Console</strong> → Sitemaps para acelerar a indexação.
      </div>
    </div>
  )
}

// ─── Preview lateral (Google + Open Graph) ───────────────────
function PreviewPanel({ cfg }) {
  const titulo    = cfg.site_titulo    || 'Título do Site'
  const descricao = cfg.site_descricao || 'Descrição padrão do site...'
  const imagem    = cfg.site_imagem

  return (
    <div style={{ position: 'sticky', top: 80 }}>
      <div style={{ fontSize: FONT.md, fontWeight: 700, color: C.text, marginBottom: SPACE.xl, display: 'flex', alignItems: 'center', gap: SPACE.md }}>
        <span>🔍 Pré-visualização</span>
        <span style={{ fontSize: FONT.xs, color: C.muted, fontWeight: 400, marginLeft: 'auto' }}>Ao vivo</span>
      </div>

      {/* Card Google */}
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: RADIUS.xl, padding: SPACE.xl, marginBottom: SPACE.xl2,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)', wordBreak: 'break-word',
      }}>
        <div style={{ fontSize: FONT.sm, fontWeight: 600, color: C.muted, marginBottom: SPACE.lg, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <span>🌐 Google</span> <span style={{ opacity: 0.5 }}>— Busca</span>
        </div>
        <div style={{ fontSize: FONT.base, color: C.greenAcc, marginBottom: 4, wordBreak: 'break-all' }}>{window.location.origin}</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#8ab4f8', marginBottom: 6, lineHeight: 1.3 }}>{titulo}</div>
        <div style={{ fontSize: FONT.md, color: C.muted, lineHeight: 1.5 }}>{descricao}</div>
      </div>

      {/* Card Redes Sociais */}
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: RADIUS.xl, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: FONT.sm, fontWeight: 600, color: C.muted, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <span>📱 Redes Sociais</span> <span style={{ opacity: 0.5 }}>— Open Graph</span>
          </div>
        </div>
        {imagem ? (
          <div style={{ height: 160, background: '#1e1e1e', overflow: 'hidden' }}>
            <img src={imagem} alt="og" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => { e.target.style.display = 'none' }} />
          </div>
        ) : (
          <div style={{ height: 120, background: C.surf2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: FONT.base }}>
            Nenhuma imagem definida
          </div>
        )}
        <div style={{ padding: '12px 16px', wordBreak: 'break-word' }}>
          <div style={{ fontSize: FONT.sm, color: C.muted, marginBottom: 4 }}>{window.location.hostname.toUpperCase()}</div>
          <div style={{ fontSize: FONT.lg - 1, fontWeight: 600, color: C.text, marginBottom: 4 }}>{titulo}</div>
          <div style={{ fontSize: FONT.base, color: C.muted, lineHeight: 1.4 }}>{descricao}</div>
        </div>
      </div>
    </div>
  )
}

function calcularAuditoriaSEO(cfg={}) {
  const checks=[
    ['Nome público',Boolean(String(cfg.nome_site||'').trim()),'Defina o nome público do portal.'],
    ['URL pública',/^https?:\/\//.test(String(cfg.site_url||'')),'Informe a URL pública para canonical e sitemap.'],
    ['Título',String(cfg.site_titulo||'').trim().length>=20,'Use um título descritivo com pelo menos 20 caracteres.'],
    ['Descrição',String(cfg.site_descricao||'').length>=120&&String(cfg.site_descricao||'').length<=160,'Descrição ideal entre 120 e 160 caracteres.'],
    ['Imagem social',Boolean(cfg.site_imagem),'Defina imagem Open Graph 1200×630.'],
    ['Favicon',Boolean(cfg.site_favicon),'Envie um favicon do portal.'],
    ['Robots',String(cfg.site_robots||'').toLowerCase()!=='noindex','Evite noindex em produção.'],
  ]
  const ok=checks.filter(x=>x[1]).length
  return {nota:Math.round(ok/checks.length*100),checks,pendencias:checks.filter(x=>!x[1])}
}

// ─── Componente principal ─────────────────────────────────────
export default function AdminSEO() {
  const [cfg, setCfg] = useState({})
  const [cfgEdit, setCfgEdit] = useState({})
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [secao, setSecao] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [salvoEm, setSalvoEm] = useState(null)

  const semAlteracoes = ALL_KEYS.every(k => (cfgEdit[k] ?? '') === (cfg[k] ?? ''))
  const { showPrompt, confirm: confirmarNavegacao, cancel: cancelarNavegacao } = useUnsavedChanges(!semAlteracoes)

  async function carregar() {
    setLoading(true)
    try {
      const c = await configuracoesService.listarSEO()
      setCfg(c || {})
      setCfgEdit(c || {})
      configuracoesService.sincronizarPublicConfig({ ...(await configuracoesService.listar(true).catch(()=>({}))), ...(c || {}) })
    } catch (e) { toast.error(e.message || 'Erro ao carregar configurações SEO') }
    finally { setLoading(false) }
  }
  useEffect(() => { carregar() }, [])

  function onChange(chave, valor) { setCfgEdit(e => ({ ...e, [chave]: valor })) }

  async function salvar() {
    setSalvando(true)
    try {
      const pares = ALL_KEYS.map(k => ({ chave: k, valor: cfgEdit[k] ?? '' }))
      const out = await configuracoesService.atualizarSEO(pares)
      const persisted = out?.configuracoes || await configuracoesService.listarSEO()
      const mismatch = ALL_KEYS.filter(k => String(persisted?.[k] ?? '') !== String(cfgEdit[k] ?? ''))
      if (mismatch.length) throw new Error(`O servidor não confirmou ${mismatch.length} campo(s): ${mismatch.join(', ')}`)
      setCfg(persisted)
      setCfgEdit(persisted)
      setSalvoEm(new Date())
      toast.success('SEO salvo e confirmado no MongoDB!')
    } catch (e) { toast.error(e.message) }
    finally { setSalvando(false) }
  }

  async function analisarIA() {
    setAiOpen(true); setAiLoading(true); setAiResult(null)
    try { setAiResult(await configuracoesService.analisarSEO(cfgEdit, 'auditar')) }
    catch (e) { toast.error(e.message) }
    finally { setAiLoading(false) }
  }
  function aplicarSugestao(chave) {
    const v=aiResult?.sugestoes?.[chave]
    if(v) onChange(chave,v)
  }

  const camposIdentidade = [
    { key: 'nome_site', label: 'Nome público do portal', type: 'text', placeholder: 'Ex.: Notícias de Iguatama', hint: 'Nome principal exibido aos visitantes.' },
    { key: 'site_url', label: 'URL pública do portal', type: 'text', placeholder: 'https://seuportal.vercel.app', hint: 'Usada em canonical e sitemap.' },
    { key: 'site_titulo', label: 'Título do site', type: 'text', placeholder: 'Portal de Notícias', hint: 'Título padrão para busca e compartilhamento.' },
    { key: 'site_descricao', label: 'Descrição padrão', type: 'textarea', placeholder: 'Portal de notícias...', hint: 'Meta description — ideal entre 120 e 160 caracteres.' },
    { key: 'site_author', label: 'Autor padrão', type: 'text', placeholder: 'Redação' },
    { key: 'site_keywords', label: 'Palavras-chave', type: 'text', placeholder: 'notícias, cidade, região', hint: 'Separadas por vírgula.' },
  ]
  const camposSocial = [
    { key: 'site_imagem', label: 'Imagem Open Graph', type: 'text', placeholder: 'https://...', hint: '1200×630 px recomendado' },
    { key: 'site_twitter_card', label: 'Twitter Card', type: 'select', options: [
      { value: '', label: 'Padrão' }, { value: 'summary', label: 'Summary' }, { value: 'summary_large_image', label: 'Summary Large Image' },
    ]},
    { key: 'site_twitter_site', label: '@ do Twitter/X', type: 'text', placeholder: '@portal' },
  ]
  const camposAnalytics = [
    { key: 'site_ga_id', label: 'Google Analytics (GA4)', type: 'text', placeholder: 'G-XXXXXXXXXX' },
    { key: 'site_gsc_verification', label: 'Google Search Console', type: 'text', placeholder: 'Código de verificação' },
  ]
  const camposIndexacao = [{ key: 'site_robots', label: 'Robots', type: 'select', options: [
    { value: '', label: 'index, follow (Padrão)' }, { value: 'noindex, follow', label: 'noindex, follow' }, { value: 'noindex, nofollow', label: 'noindex, nofollow' },
  ]}]

  const sections=[
    {id:'identidade',label:'Identidade',sub:'Título, descrição e palavras-chave',icon:'◈'},
    {id:'favicon',label:'Favicon',sub:'Ícone do portal',icon:'▣'},
    {id:'social',label:'Redes sociais',sub:'Open Graph e X',icon:'↗'},
    {id:'analytics',label:'Google',sub:'Analytics e Search Console',icon:'⌁'},
    {id:'indexacao',label:'Indexação',sub:'Robots e rastreamento',icon:'◎'},
    {id:'sitemap',label:'Sitemap',sub:'Frequência, prioridade e cache',icon:'⌘'},
  ]

  function sectionContent(id){
    if(id==='identidade') return camposIdentidade.map(f=><Campo key={f.key} campo={f} value={cfgEdit[f.key]} onChange={onChange}/>)
    if(id==='favicon') return <AbaFavicon value={cfgEdit.site_favicon} onChange={onChange}/>
    if(id==='social') return camposSocial.map(f=><Campo key={f.key} campo={f} value={cfgEdit[f.key]} onChange={onChange}/>)
    if(id==='analytics') return camposAnalytics.map(f=><Campo key={f.key} campo={f} value={cfgEdit[f.key]} onChange={onChange}/>)
    if(id==='sitemap') return <AbaSitemap cfg={cfgEdit} onChange={onChange}/>
    if(id==='indexacao') return <>{camposIndexacao.map(f=><Campo key={f.key} campo={f} value={cfgEdit[f.key]} onChange={onChange}/>)}<div style={{padding:12,background:'rgba(239,68,68,.08)',borderRadius:RADIUS.md,color:C.red}}>⚠ “noindex” remove o portal dos resultados de busca.</div></>
    return null
  }

  if(loading) return <div className="adm-empty" style={{marginTop:80}}>Carregando SEO…</div>
  const audit=calcularAuditoriaSEO(cfgEdit)

  return <>
    <style>{`
      .seo-section-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .seo-section-card{min-width:0;text-align:left;padding:14px;border:1px solid var(--adm-border);background:var(--adm-surface);border-radius:14px;cursor:pointer;color:var(--adm-text)}
      .seo-section-card:hover{border-color:var(--adm-accent)}
      @media(max-width:620px){.seo-section-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.seo-section-card{padding:10px 8px}.seo-section-sub{display:none}}
    `}</style>
    <ConfirmModal aberto={showPrompt} titulo="Sair sem salvar?" mensagem="Você tem alterações não salvas." labelConfirmar="Descartar" variante="warning" onConfirmar={confirmarNavegacao} onCancelar={cancelarNavegacao}/>

    <div className="adm-page-header" style={{marginBottom:18}}>
      <div><div className="adm-page-title">SEO &amp; Metadados</div><div className="adm-page-sub">Busca, compartilhamento e indexação do portal</div></div>
      <div className="adm-page-actions"><button className="adm-btn adm-btn-secondary" onClick={()=>setPreviewOpen(true)}>Visualizar</button><button className="adm-btn adm-btn-secondary" onClick={analisarIA}>✨ IA</button><button className="adm-btn adm-btn-primary" disabled={salvando||semAlteracoes} onClick={salvar}>{salvando?'Salvando…':'Salvar'}</button></div>
    </div>

    <div className="adm-card" style={{padding:14,marginBottom:14,display:'grid',gridTemplateColumns:'auto 1fr',gap:14,alignItems:'center'}}>
      <div style={{width:58,height:58,borderRadius:'50%',display:'grid',placeItems:'center',border:`6px solid ${audit.nota>=80?C.green:audit.nota>=55?C.yellow:C.red}`,fontWeight:800}}>{audit.nota}</div>
      <div style={{minWidth:0}}><strong>Saúde do SEO</strong><div style={{fontSize:FONT.sm,color:C.muted,marginTop:4}}>{audit.pendencias.length?`${audit.pendencias.length} melhoria(s): ${audit.pendencias.map(x=>x[0]).join(' · ')}`:'Configuração essencial completa.'}</div><div style={{fontSize:FONT.sm,color:semAlteracoes?C.green:C.yellow,marginTop:5}}>{salvando?'Salvando no MongoDB…':!semAlteracoes?'● Alterações não salvas':salvoEm?`✓ Salvo e confirmado às ${salvoEm.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`:'✓ Sincronizado com o MongoDB'}</div></div>
    </div>

    <div className="seo-section-grid">{sections.map(x=><button key={x.id} className="seo-section-card" onClick={()=>setSecao(x.id)}><div style={{fontSize:18,marginBottom:7}}>{x.icon}</div><div style={{fontWeight:750,fontSize:FONT.base}}>{x.label}</div><div className="seo-section-sub" style={{fontSize:FONT.sm,color:C.muted,marginTop:4,lineHeight:1.3}}>{x.sub}</div></button>)}</div>

    <DSModal open={!!secao} onClose={()=>setSecao(null)} title={sections.find(x=>x.id===secao)?.label||'SEO'} size="lg"><div>{sectionContent(secao)}</div></DSModal>
    <DSModal open={previewOpen} onClose={()=>setPreviewOpen(false)} title="Prévia do portal" size="md"><PreviewPanel cfg={cfgEdit}/></DSModal>
    <DSModal open={aiOpen} onClose={()=>!aiLoading&&setAiOpen(false)} title="Assistente SEO" size="md">
      {aiLoading?<div className="adm-empty">Analisando configurações com IA…</div>:aiResult?<div style={{display:'grid',gap:14}}><div className="adm-card" style={{padding:14}}><strong>{aiResult.pontuacao??audit.nota}/100</strong><div style={{color:C.muted,marginTop:6}}>{aiResult.resumo}</div></div>{(aiResult.alertas||[]).length>0&&<div><strong>Alertas</strong><ul>{aiResult.alertas.map((a,i)=><li key={i}>{a}</li>)}</ul></div>}<div style={{display:'grid',gap:10}}>{[['site_titulo','Título'],['site_descricao','Descrição'],['site_keywords','Palavras-chave']].map(([k,l])=>aiResult.sugestoes?.[k]?<div key={k} className="adm-card" style={{padding:12}}><strong>{l}</strong><div style={{margin:'7px 0',lineHeight:1.5}}>{aiResult.sugestoes[k]}</div><button className="adm-btn adm-btn-secondary adm-btn-sm" onClick={()=>aplicarSugestao(k)}>Usar sugestão</button></div>:null)}</div><div style={{fontSize:FONT.sm,color:C.muted}}>A IA apenas sugere. Nada é salvo sem você confirmar em Salvar.</div></div>:<div className="adm-empty">Não foi possível gerar análise.</div>}
    </DSModal>
  </>
}
