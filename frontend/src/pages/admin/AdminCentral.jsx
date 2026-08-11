import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { T as C, SPACE, RADIUS, FONT } from '../../themes/tokens'

const HUBS = {
  conteudo: {
    eyebrow:'CONTEÚDO',
    title:'Conteúdo editorial',
    desc:'Crie, importe e organize tudo que é publicado no portal.',
    items:[
      ['/admin/noticias','Notícias','Publicar, editar e destacar matérias','📰','noticias.ver'],
      ['/admin/categorias','Categorias','Editorias e organização do conteúdo','🏷','categorias.gerenciar'],
      ['/admin/rss-import','RSS e importação','Importar, automatizar e reprocessar feeds','◔','rss.gerenciar'],
      ['/admin/fontes','Fontes','Origens jornalísticas e regras de coleta','◎','fontes.gerenciar'],
      ['/admin/eventos','Eventos','Agenda pública e destaques','▣','eventos.gerenciar'],
      ['/admin/onibus','Ônibus','Linhas, horários e serviços locais','▤','extras.gerenciar'],
      ['/admin/newsletter','Newsletter','Assinantes e comunicação','✉','newsletter.gerenciar'],
    ],
  },
  portal: {
    eyebrow:'PORTAL',
    title:'Portal público',
    desc:'Aparência, módulos, SEO e experiência que o visitante vê.',
    items:[
      ['/','Ver site','Abrir o portal público em uma nova aba','↗',null,true],
      ['/admin/modulos','Home e módulos','Blocos, clima, futebol, horóscopo e recursos','▦','modulos.gerenciar'],
      ['/admin/seo','SEO & Metadados','Busca, redes sociais, sitemap e indexação','⌕','seo.gerenciar'],
      ['/admin/temas','Aparência e temas','Cores, tipografia e identidade do painel','◐','temas.gerenciar'],
      ['/admin/cloudinary','Mídia / Cloudinary','Imagens e recursos de mídia','☁','cloudinary.gerenciar'],
    ],
  },
  publicacao: {
    eyebrow:'PUBLICAÇÃO',
    title:'Código e produção',
    desc:'GitHub primeiro; Vercel, Render e R2 entram conforme cada projeto.',
    items:[
      ['/admin/github','GitHub','Repositórios, commits, Actions e publicação','◈','github.gerenciar'],
      ['/admin/plataformas','Plataformas','Vercel e Render em produção','⌁','plataformas.gerenciar'],
      ['/admin/cloudflare','Cloudflare / R2','Buckets, snapshots e armazenamento cloud','☁','cloudflare.gerenciar'],
      ['/admin/projetos','Projetos','Projetos cloud e modo local legado','▣','projetos.ver'],
    ],
  },
  sistema: {
    eyebrow:'SISTEMA',
    title:'Administração do AL',
    desc:'Integrações, usuários, banco, backup, infraestrutura e ferramentas internas.',
    items:[
      ['/admin/integracoes','Integrações e APIs','Credenciais, IA, GitHub, Vercel, Render e serviços','⌘','configuracoes.gerenciar'],
      ['/admin/usuarios','Usuários e acessos','Contas, perfis e permissões','♙','usuarios.gerenciar'],
      ['/admin/seguranca','Segurança','Eventos, políticas e auditoria','◇','seguranca.gerenciar'],
      ['/admin/mongo','MongoDB','Banco de dados, coleções e diagnóstico','●','mongodb.gerenciar'],
      ['/admin/backup','Backup','Exportação, restauração e proteção dos dados','⇧','backup.gerenciar'],
      ['/admin/sistema','Infraestrutura','Saúde, ambiente e runtime do backend','▥','sistema.gerenciar'],
      ['/admin/monitor','Monitor','Recursos e atividade em tempo real','⌁','sistema.gerenciar'],
      ['/admin/ambientes','Ambientes','Versões e alinhamento Vercel / Render','◎','configuracoes.gerenciar'],
      ['/admin/arquivos','Arquivos','Ferramentas de arquivos para VPS / legado','▤','arquivos.gerenciar'],
      ['/admin/ai-assistant','Assistente de IA','Assistente geral usando o núcleo Gemini/OpenRouter','✦','ia.usar'],
      ['/admin/setup','Configuração inicial','Assistente de instalação e recuperação','⚙','configuracoes.gerenciar'],
    ],
  },
}

export default function AdminCentral({ area }) {
  const { temPermissao } = useAuth()
  const hub = HUBS[area] || HUBS.sistema
  const items = hub.items.filter(i => !i[4] || temPermissao(i[4]))

  return <div className="adm-hub-page">
    <div className="adm-hub-head">
      <span>{hub.eyebrow}</span>
      <h1>{hub.title}</h1>
      <p>{hub.desc}</p>
    </div>
    <div className="adm-hub-grid">
      {items.map(([to,title,desc,icon,,external]) => {
        const Tag = external ? 'a' : Link
        const props = external ? { href:to, target:'_blank', rel:'noopener noreferrer' } : { to }
        return <Tag key={`${area}-${to}-${title}`} {...props} className="adm-hub-card">
          <span className="adm-hub-icon">{icon}</span>
          <span className="adm-hub-copy"><b>{title}</b><small>{desc}</small></span>
          <span className="adm-hub-arrow">›</span>
        </Tag>
      })}
    </div>
    <style>{`
      .adm-hub-page{padding:4px 0 24px;min-width:0}.adm-hub-head{margin-bottom:18px}.adm-hub-head>span{display:block;font-size:9px;font-weight:900;letter-spacing:.14em;color:var(--adm-accent);margin-bottom:5px}.adm-hub-head h1{margin:0;font-size:22px;line-height:1.15;color:var(--adm-text)}.adm-hub-head p{margin:7px 0 0;max-width:680px;font-size:12px;line-height:1.55;color:var(--adm-muted)}.adm-hub-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.adm-hub-card{min-width:0;display:grid;grid-template-columns:36px minmax(0,1fr) 14px;gap:10px;align-items:center;padding:14px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface);text-decoration:none;color:var(--adm-text);box-shadow:var(--adm-shadow-sm);transition:transform .14s,border-color .14s,background .14s}.adm-hub-card:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--adm-accent) 35%,var(--adm-border));background:color-mix(in srgb,var(--adm-accent) 3%,var(--adm-surface))}.adm-hub-icon{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;background:var(--adm-surface2);border:1px solid var(--adm-border);font-size:16px;font-weight:800}.adm-hub-copy{min-width:0;display:grid;gap:3px}.adm-hub-copy b{font-size:12px;line-height:1.2;overflow-wrap:anywhere}.adm-hub-copy small{font-size:9px;line-height:1.35;color:var(--adm-muted);overflow-wrap:anywhere}.adm-hub-arrow{font-size:20px;color:var(--adm-muted);text-align:right}
      @media(max-width:900px){.adm-hub-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:560px){.adm-hub-head{margin-bottom:16px}.adm-hub-head h1{font-size:20px}.adm-hub-head p{font-size:12px}.adm-hub-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.adm-hub-card{grid-template-columns:40px minmax(0,1fr);align-items:center;padding:13px 12px;gap:10px;border-radius:14px}.adm-hub-icon{width:40px;height:40px;border-radius:12px;font-size:18px}.adm-hub-copy{gap:3px}.adm-hub-copy b{font-size:13.5px;line-height:1.2}.adm-hub-copy small{font-size:10.5px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.adm-hub-arrow{display:none}}
      @media(max-width:350px){.adm-hub-grid{grid-template-columns:1fr}}
    `}</style>
  </div>
}
