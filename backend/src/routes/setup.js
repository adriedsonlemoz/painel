/**
 * Setup / Instalação — AL Sistemas
 *
 * Endpoints:
 *   GET  /api/setup/status            — verifica se o setup já foi feito + estado do banco
 *   GET  /api/setup/env-config        — lê configurações MongoDB/Cloudinary (mascaradas)
 *   POST /api/setup                   — instalação inicial (cria admin + perfis + seed seletivo)
 *   POST /api/setup/seed              — importa dados de exemplo (autenticado)
 *   POST /api/setup/env-config        — grava configurações MongoDB/Cloudinary no .env
 *   POST /api/setup/reset-db          — apaga TUDO e recria do zero (requer confirmação)
 *   POST /api/setup/desativar-arquivo — grava SETUP_DISABLED=true no .env (sem renomear o arquivo)
 */
import { Router }  from 'express'
import mongoose    from 'mongoose'
import jwt         from 'jsonwebtoken'
import Usuario     from '../models/Usuario.js'
import PerfilAcesso, {
  PERMISSOES, PERMISSOES_JORNALISTA,
} from '../models/PerfilAcesso.js'
import Categoria        from '../models/Categoria.js'
import Noticia          from '../models/Noticia.js'
import ConfiguracaoHome from '../models/ConfiguracaoHome.js'
import ModuloHome       from '../models/ModuloHome.js'
import { Topico, NoticiaExterna } from '../models/Extras.js'
import { Onibus }       from '../models/Onibus.js'
import { Evento }       from '../models/Evento.js'
import Fonte            from '../models/Fonte.js'
import { autenticar }   from '../middleware/auth.js'
import { readBootstrap, writeBootstrap, bootstrapValue, isBootstrapConfigured, resetBootstrapVault } from '../utils/localVault.js'
import { installationState, markInstallationCompleted } from '../utils/hostedBootstrap.js'
import { conectarMongo } from '../config/index.js'
import { buildMongoUri, mongoPublicConfig, mongoVaultPatch } from '../utils/mongoConnection.js'
import { getCredential, setCredential } from '../utils/credentialStore.js'

const router = Router()


const MIGRATION_MASKS = new Set(['****************','••••••••••••••••'])
function migrationMasked(value='') {
  const v=String(value||'').trim()
  return !v || MIGRATION_MASKS.has(v) || /^\*{6,}$/.test(v) || /^•{6,}$/.test(v)
}
async function importPortableVariables(vars={}) {
  if(!vars || typeof vars!=='object' || Array.isArray(vars)) return { imported:[], skipped:[], found:[] }
  const imported=[], skipped=[], found=[]
  const val=(name)=>typeof vars[name]==='string'?vars[name].trim():''
  const has=(name)=>{const v=val(name); if(v) found.push(name); return v}

  const github=has('GITHUB_TOKEN')
  if(github){ if(!migrationMasked(github)){const old=await getCredential('github','GITHUB_TOKEN');await setCredential('github',github,old.metadata||{});imported.push('GitHub')}else skipped.push('GitHub') }

  const gemini=has('GEMINI_API_KEY')
  if(gemini){ if(!migrationMasked(gemini)){const old=await getCredential('gemini','GEMINI_API_KEY');await setCredential('gemini',gemini,old.metadata||{});imported.push('Gemini')}else skipped.push('Gemini') }

  const openrouter=has('OPENROUTER_API_KEY')
  if(openrouter){ if(!migrationMasked(openrouter)){const old=await getCredential('openrouter','OPENROUTER_API_KEY');await setCredential('openrouter',openrouter,old.metadata||{});imported.push('OpenRouter')}else skipped.push('OpenRouter') }

  const cloudName=has('CLOUDINARY_CLOUD_NAME'), apiKey=has('CLOUDINARY_API_KEY'), apiSecret=has('CLOUDINARY_API_SECRET')
  if(cloudName||apiKey||apiSecret){
    if(cloudName&&apiKey&&!migrationMasked(apiSecret)){await setCredential('cloudinary',JSON.stringify({cloudName,apiKey,apiSecret}),{cloudName,apiKey});imported.push('Cloudinary')}else skipped.push('Cloudinary')
  }

  const cfToken=has('CF_API_TOKEN'), cfAccount=has('CF_ACCOUNT_ID'), cfAccess=has('CF_R2_ACCESS_KEY_ID'), cfSecret=has('CF_R2_SECRET_ACCESS_KEY'), cfBucket=has('CF_R2_BUCKET'), cfPublic=has('CF_R2_PUBLIC_URL'), cfEndpoint=has('CF_R2_ENDPOINT')
  if(cfToken||cfAccount||cfAccess||cfSecret||cfBucket||cfPublic||cfEndpoint){
    if(cfToken&&cfAccount&&!migrationMasked(cfToken)){
      const old=await getCredential('cloudflare','CF_API_TOKEN'); let parsed={}; try{parsed=JSON.parse(old.value||'{}')}catch{}
      await setCredential('cloudflare',JSON.stringify({apiToken:cfToken,r2AccessKeyId:!migrationMasked(cfAccess)?cfAccess:(parsed.r2AccessKeyId||''),r2SecretAccessKey:!migrationMasked(cfSecret)?cfSecret:(parsed.r2SecretAccessKey||'')}),{...(old.metadata||{}),accountId:cfAccount,r2Bucket:cfBucket||old.metadata?.r2Bucket||'',r2PublicUrl:cfPublic||old.metadata?.r2PublicUrl||'',r2Endpoint:cfEndpoint||old.metadata?.r2Endpoint||`https://${cfAccount}.r2.cloudflarestorage.com`})
      imported.push('Cloudflare')
    }else skipped.push('Cloudflare')
  }

  const render=has('RENDER_API_KEY')
  if(render){ if(!migrationMasked(render)){const old=await getCredential('render','RENDER_API_KEY');await setCredential('render',render,old.metadata||{});imported.push('Render')}else skipped.push('Render') }

  const vercel=has('VERCEL_TOKEN')
  if(vercel){ if(!migrationMasked(vercel)){const old=await getCredential('vercel','VERCEL_TOKEN');await setCredential('vercel',vercel,{...(old.metadata||{}),teamId:val('VERCEL_TEAM_ID')||old.metadata?.teamId||''});imported.push('Vercel')}else skipped.push('Vercel') }

  return { imported:[...new Set(imported)], skipped:[...new Set(skipped)], found:[...new Set(found)] }
}

async function permitirManutencaoSetup(req, res, next) {
  try {
    const estado = await installationState()
    if (!estado.installed) return next()
    return autenticar(req, res, next)
  } catch {
    const localInstalado = Boolean(readBootstrap().INSTALL_COMPLETED)
    if (!localInstalado) return next()
    return autenticar(req, res, next)
  }
}

// O status e a configuração inicial permanecem disponíveis até existir um administrador.

async function contarDados() {
  const [usuarios, noticias, categorias, eventos, onibus] = await Promise.all([
    Usuario.countDocuments(),
    Noticia.countDocuments(),
    Categoria.countDocuments(),
    Evento.countDocuments(),
    Onibus.countDocuments(),
  ])
  return { usuarios, noticias, categorias, eventos, onibus }
}

async function criarPerfis() {
  await PerfilAcesso.deleteMany({ sistema: true })

  // ── 3 perfis do sistema ──────────────────────────────────────────────────
  const [superadmin, jornalista, usuario] = await Promise.all([

    // 1. Superadmin — acesso irrestrito a tudo
    PerfilAcesso.create({
      nome:      'Superadmin',
      descricao: 'Acesso total ao sistema. Não pode ser excluído.',
      permissoes: [PERMISSOES.SUPERADMIN],
      cor: '#ef4444', sistema: true,
    }),

    // 2. Jornalista — trabalha com conteúdo editorial
    //    NÃO tem: SEO, backup, usuários, erros avançados
    PerfilAcesso.create({
      nome:      'Jornalista',
      descricao: 'Cria e edita notícias, categorias, fontes, eventos, newsletter e módulos. Sem acesso a SEO, backup ou usuários.',
      permissoes: PERMISSOES_JORNALISTA,
      cor: '#f97316', sistema: true,
    }),

    // 3. Usuário — sem acesso ao painel admin
    //    Reservado para uso futuro (área do leitor, comentários, favoritos…)
    PerfilAcesso.create({
      nome:      'Usuário',
      descricao: 'Usuário do site. Sem acesso ao painel administrativo.',
      permissoes: [],
      cor: '#94a3b8', sistema: true,
    }),
  ])

  return { superadmin, jornalista, usuario }
}

// Slug determinístico para seeds. Evita documentos com slug:null em índice único.
function slugSeed(texto = '') {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// ─── executarSeed: dados_escolhidos controla quais coleções popular ───────────
async function executarSeed(
  nomeSite = 'AL Sistemas',
  dados = ['categorias','noticias','fontes','topicos','eventos','onibus','modulos','noticias_externas']
) {
  const incluir = (chave) => dados.includes(chave)

  // Helper: upsert em lote para evitar E11000 em re-importações
  async function upsertMany(Model, docs, campoChave) {
    await Model.bulkWrite(
      docs.map(doc => ({
        updateOne: {
          filter: { [campoChave]: doc[campoChave] },
          update:  { $setOnInsert: doc },
          upsert:  true,
        },
      })),
      { ordered: false }
    )
  }

  // ── Categorias (upsert por slug — sem E11000 em re-importação) ───────────
  let cats = [], catMap = {}
  if (incluir('categorias')) {
    const catDefs = [
      { nome: 'Geral',           slug: 'geral',           cor: '#607D8B' },
      { nome: 'Política',        slug: 'politica',        cor: '#1565C0' },
      { nome: 'Saúde',           slug: 'saude',           cor: '#2E7D32' },
      { nome: 'Educação',        slug: 'educacao',        cor: '#6A1B9A' },
      { nome: 'Esportes',        slug: 'esportes',        cor: '#E53935' },
      { nome: 'Cultura',         slug: 'cultura',         cor: '#F57F17' },
      { nome: 'Economia',        slug: 'economia',        cor: '#00695C' },
      { nome: 'Segurança',       slug: 'seguranca',       cor: '#4E342E' },
      { nome: 'Meio Ambiente',   slug: 'meio-ambiente',   cor: '#558B2F' },
      { nome: 'Curiosidades',    slug: 'curiosidades',    cor: '#AD1457' },
      { nome: 'História',        slug: 'historia',        cor: '#4527A0' },
      { nome: 'Turismo',         slug: 'turismo',         cor: '#0277BD' },
      { nome: 'Obras e Serviços',slug: 'obras-servicos',  cor: '#E65100' },
      { nome: 'Agronegócio',     slug: 'agronegocio',     cor: '#33691E' },
      { nome: 'Trânsito',        slug: 'transito',        cor: '#37474F' },
      { nome: 'Entretenimento',  slug: 'entretenimento',  cor: '#880E4F' },
    ]
    await upsertMany(Categoria, catDefs, 'slug')
    cats  = await Categoria.find({ slug: { $in: catDefs.map(c => c.slug) } }).lean()
    catMap = Object.fromEntries(cats.map(c => [c.slug, c._id]))
  } else {
    // Mesmo sem importar categorias, monta o mapa para uso pelas notícias
    const existentes = await Categoria.find({}).lean()
    catMap = Object.fromEntries(existentes.map(c => [c.slug, c._id]))
  }

  // ── Configuração da home (upsert por chave) ───────────────────
  await upsertMany(ConfiguracaoHome, [
    { chave: 'nome_site',      valor: nomeSite,                            descricao: 'Nome do portal de notícias' },
    { chave: 'descricao',      valor: `Portal de notícias de ${nomeSite}`, descricao: 'Descrição exibida no SEO/meta' },
    { chave: 'cor_primaria',   valor: '#1B5E3B',                           descricao: 'Cor primária do tema' },
    { chave: 'cor_secundaria', valor: '#2E7D32',                           descricao: 'Cor secundária do tema' },
  ], 'chave')

  // ── Módulos da home (upsert por chave) ────────────────────────
  if (incluir('modulos')) {
    await upsertMany(ModuloHome, [
      { chave: 'historia-cidade',  titulo: 'História da cidade',  ativo: true, ordem: 1 },
      { chave: 'belezas-naturais', titulo: 'Belezas naturais',    ativo: true, ordem: 2 },
      { chave: 'eventos',          titulo: 'Eventos',             ativo: true, ordem: 3 },
      { chave: 'horario-onibus',   titulo: 'Horário de ônibus',   ativo: true, ordem: 4 },
    ], 'chave')
  }

  // ── Tópicos da Faixa ──────────────────────────────────────────
  let topicosCnt = 0
  if (incluir('topicos')) {
    await Topico.insertMany([
      { icone: 'church',       label: 'História e tradição', descricao: 'A história da cidade',  link: '/?categoria=historia', ativo: true, ordem: 1 },
      { icone: 'mountain',     label: 'Belezas naturais',    descricao: 'Natureza e turismo',    link: '/?categoria=natureza', ativo: true, ordem: 2 },
      { icone: 'bus',          label: 'Horário de Ônibus',   descricao: 'Linhas e horários',     link: '/onibus',              ativo: true, ordem: 3 },
      { icone: 'calendarDays', label: 'Eventos',             descricao: 'Agenda da cidade',      link: '/eventos',             ativo: true, ordem: 4 },
    ])
    topicosCnt = 4
  }

  // ── Fontes ────────────────────────────────────────────────────
  let fontesCnt = 0
  if (incluir('fontes')) {
    await Fonte.insertMany([
      { nome: 'Prefeitura Municipal',     url: null },
      { nome: 'Câmara Municipal',         url: null },
      { nome: 'Secretaria de Saúde',      url: null },
      { nome: 'Secretaria de Educação',   url: null },
      { nome: 'Polícia Militar',          url: null },
      { nome: 'Corpo de Bombeiros',       url: null },
      { nome: 'Assessoria de Imprensa',   url: null },
      { nome: 'Redação ' + nomeSite,      url: null },
    ])
    fontesCnt = 8
  }

  // ── Notícias de exemplo ───────────────────────────────────────
  let noticiasCnt = 0
  if (incluir('noticias')) {
    const noticiasDefs = [
      {
        titulo: `Prefeitura de ${nomeSite} anuncia novo programa de infraestrutura`,
        conteudo: `A Prefeitura Municipal anunciou investimentos em infraestrutura urbana para o próximo exercício fiscal. As obras incluem recapeamento de vias, melhoria da iluminação pública e reforma de praças. O prefeito destacou que os recursos foram garantidos por meio de convênios com o governo estadual.`,
        imagem_url: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&q=80',
        categoria_id: catMap['politica'], destaque: true, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: 'Unidade de Saúde amplia atendimento para toda a população',
        conteudo: 'A Unidade Básica de Saúde ampliou seus horários de atendimento, passando a funcionar também aos sábados. A medida visa reduzir filas e melhorar o acesso da população. Especialidades como clínica geral, pediatria e ginecologia estão disponíveis sem necessidade de agendamento.',
        imagem_url: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&q=80',
        categoria_id: catMap['saude'], destaque: true, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: 'Escola municipal recebe reforma e novos equipamentos',
        conteudo: 'A escola municipal passou por ampla reforma estrutural e recebeu novos computadores e equipamentos pedagógicos. A iniciativa beneficia mais de 300 alunos matriculados no ensino fundamental. A inauguração contou com a presença da secretária de educação e representantes da comunidade.',
        imagem_url: 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=800&q=80',
        categoria_id: catMap['educacao'], destaque: false, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: 'Time local se classifica para o campeonato regional',
        conteudo: 'O time de futebol local garantiu vaga na fase seguinte do campeonato regional após vitória expressiva. A torcida comemorou o resultado nas ruas da cidade. O treinador afirmou que o grupo está focado e preparado para os próximos desafios da temporada.',
        imagem_url: 'https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=800&q=80',
        categoria_id: catMap['esportes'], destaque: false, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: 'Festival cultural movimenta o centro da cidade',
        conteudo: 'O festival reuniu artistas locais e regionais em apresentações de música, dança e teatro. O evento gratuito atraiu milhares de visitantes ao longo do fim de semana. A programação incluiu exposições de artesanato, gastronomia típica e oficinas para crianças.',
        imagem_url: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80',
        categoria_id: catMap['cultura'], destaque: true, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: `Conheça a história e as origens de ${nomeSite}`,
        conteudo: `${nomeSite} foi fundada no início do século passado por colonizadores que buscavam novas terras e oportunidades no interior do estado. Com raízes profundas na agricultura e na fé, a cidade construiu sua identidade ao longo de décadas de trabalho e tradição. Hoje, o patrimônio histórico e cultural é motivo de orgulho para seus moradores.`,
        imagem_url: 'https://images.unsplash.com/photo-1564507592333-c60657eea523?w=800&q=80',
        categoria_id: catMap['historia'], destaque: true, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: 'Novo parque ecológico abre as portas para visitação pública',
        conteudo: 'A cidade ganhou um novo espaço de lazer e contato com a natureza. O parque ecológico conta com trilhas, área de piquenique, lago artificial e viveiro de aves nativas. A entrada é gratuita e o local funciona de terça a domingo, das 7h às 18h.',
        imagem_url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80',
        categoria_id: catMap['meio-ambiente'], destaque: false, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: 'Produtores rurais recebem capacitação em técnicas sustentáveis',
        conteudo: 'A Secretaria de Agricultura promoveu uma série de palestras e workshops voltados aos produtores rurais da região. Os temas abordados incluíram manejo de solo, irrigação eficiente e certificação orgânica. Cerca de 80 agricultores participaram dos treinamentos.',
        imagem_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80',
        categoria_id: catMap['agronegocio'], destaque: false, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: 'Obras de pavimentação iniciam em bairros residenciais',
        conteudo: 'A Prefeitura deu início às obras de pavimentação asfáltica em quatro bairros da cidade. Os serviços incluem terraplenagem, drenagem pluvial e sinalização viária. A previsão é que as obras sejam concluídas em noventa dias, beneficiando mais de dois mil moradores.',
        imagem_url: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80',
        categoria_id: catMap['obras-servicos'], destaque: false, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: 'Economia local registra crescimento no setor de serviços',
        conteudo: 'De acordo com levantamento da Associação Comercial, o setor de serviços da cidade cresceu significativamente no último trimestre. Novos estabelecimentos abriram as portas, gerando empregos e movimentando a economia local. Especialistas apontam a melhoria da infraestrutura como fator determinante.',
        imagem_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
        categoria_id: catMap['economia'], destaque: false, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: 'Semana do Turismo destaca atrações naturais da região',
        conteudo: 'A Semana do Turismo reuniu guias, empreendedores e visitantes para explorar o potencial turístico da cidade e da região. Cachoeiras, grutas e mirantes foram apresentados como destaques do roteiro ecológico local. O evento espera fomentar o turismo sustentável como alternativa econômica.',
        imagem_url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80',
        categoria_id: catMap['turismo'], destaque: true, status: 'publicado', publicado_em: new Date(),
      },
      {
        titulo: 'Operação policial resulta em apreensões no centro da cidade',
        conteudo: 'A Polícia Militar realizou operação de combate à criminalidade nas principais ruas do centro urbano. A ação resultou em abordagens, apreensão de entorpecentes e condução de suspeitos à delegacia. O comandante regional elogiou o trabalho integrado das forças de segurança.',
        imagem_url: 'https://images.unsplash.com/photo-1453873531674-2151bcd01707?w=800&q=80',
        categoria_id: catMap['seguranca'], destaque: false, status: 'publicado', publicado_em: new Date(),
      },
    ]
    const noticiasComSlug = noticiasDefs.map(n => ({ ...n, slug: slugSeed(n.titulo) }))
    await upsertMany(Noticia, noticiasComSlug, 'slug')
    noticiasCnt = await Noticia.countDocuments({ slug: { $in: noticiasComSlug.map(n => n.slug) } })
  }

  // ── Notícias externas ─────────────────────────────────────────
  if (incluir('noticias_externas')) {
    await NoticiaExterna.insertMany([
      { titulo: 'Câmara aprova projeto de interesse municipal', url_externa: 'https://g1.globo.com', fonte_nome: 'G1', imagem_url: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=400&q=80', categoria_label: 'POLÍTICA', categoria_cor: '#1565C0', ativo: true, ordem: 1 },
      { titulo: 'Investimentos em cidades do interior crescem', url_externa: 'https://www.uol.com.br', fonte_nome: 'UOL', imagem_url: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=400&q=80', categoria_label: 'ECONOMIA', categoria_cor: '#00695C', ativo: true, ordem: 2 },
      { titulo: 'Brasil avança em ranking de saúde pública', url_externa: 'https://www.bbc.com/portuguese', fonte_nome: 'BBC', imagem_url: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=400&q=80', categoria_label: 'SAÚDE', categoria_cor: '#2E7D32', ativo: true, ordem: 3 },
    ])
  }

  // ── Ônibus ────────────────────────────────────────────────────
  let onibusCnt = 0
  if (incluir('onibus')) {
    await Onibus.insertMany([
      {
        destino: 'Capital', origem: nomeSite, empresa: 'Viação Regional', cor: '#1B5E3B', ordem: 1,
        horarios: [
          { hora: '05:30', dias: ['seg','ter','qua','qui','sex'], observacao: 'Saída do Terminal' },
          { hora: '13:00', dias: ['seg','ter','qua','qui','sex'], observacao: '' },
          { hora: '08:00', dias: ['sab','dom'], observacao: 'Fins de semana e feriados' },
        ],
      },
      {
        destino: 'Cidade Vizinha', origem: nomeSite, empresa: 'Expresso Local', cor: '#1565C0', ordem: 2,
        horarios: [
          { hora: '06:00', dias: ['seg','ter','qua','qui','sex'], observacao: '' },
          { hora: '12:30', dias: ['seg','ter','qua','qui','sex'], observacao: '' },
          { hora: '07:00', dias: ['sab','dom'], observacao: '' },
        ],
      },
    ])
    onibusCnt = 2
  }

  // ── Eventos ───────────────────────────────────────────────────
  let eventosCnt = 0
  if (incluir('eventos')) {
    const hoje = new Date()
    const d = (dias) => new Date(hoje.getTime() + dias * 86400000)
    await Evento.insertMany([
      { titulo: 'Festa da Cidade', descricao: 'Celebração do aniversário municipal com shows, barracas e apresentações culturais.', data: d(10), horario: '18:00', local: 'Praça Central', cor: '#1B5E3B', ativo: true },
      { titulo: 'Feira do Produtor Rural', descricao: 'Produtos artesanais e da lavoura diretamente do produtor para sua mesa.', data: d(7), horario: '07:00', local: 'Pavilhão Municipal', cor: '#2E7D32', ativo: true },
      { titulo: 'Reunião do Conselho Municipal', descricao: 'Pauta aberta para debate com a comunidade. Todos são bem-vindos.', data: d(14), horario: '19:00', local: 'Câmara Municipal', cor: '#1565C0', ativo: true },
    ])
    eventosCnt = 3
  }

  return { categorias: cats.length, noticias: noticiasCnt, fontes: fontesCnt, topicos: topicosCnt, eventos: eventosCnt, onibus: onibusCnt }
}

// ─── GET /api/setup/status ────────────────────────────────────────────────────
router.get('/status', async (_req, res) => {
  const statusStartedAt = process.hrtime.bigint()
  const vault = readBootstrap()
  const mongoConfigurado = Boolean(vault.MONGO_URI || process.env.MONGO_URI)
  let mongoConectado = mongoose.connection.readyState === 1
  let install = { installed:Boolean(vault.INSTALL_COMPLETED), users:null, source:'local' }

  // Em Render/VPS o HTTP pode responder alguns milissegundos antes do Atlas.
  // Não mandamos o usuário para o wizard enquanto ainda não sabemos se o
  // banco conectado já possui administrador.
  if (mongoConfigurado && !mongoConectado && mongoose.connection.readyState === 2) {
    await Promise.race([
      mongoose.connection.asPromise().catch(()=>null),
      new Promise(resolve=>setTimeout(resolve,1800)),
    ])
    mongoConectado = mongoose.connection.readyState === 1
  }

  if (mongoConectado) {
    try { install = await installationState() } catch {}
  }

  const decisaoPendente = Boolean(mongoConfigurado && !mongoConectado && !install.installed)
  const instalado = Boolean(install.installed)
  return res.json({
    setup_needed: decisaoPendente ? false : !instalado,
    setup_pending: decisaoPendente,
    instalacao_concluida: instalado,
    mongo_configurado: mongoConfigurado,
    mongo_conectado: mongoConectado,
    banco_vazio: install.users === null ? null : install.users === 0,
    tem_dados: install.users === null ? null : install.users > 0,
    banco_nome: mongoose.connection.db?.databaseName || vault.MONGO_DB_NAME || process.env.MONGO_DB_NAME || 'alsistemas',
    contagens: install.users === null ? null : { usuarios:install.users },
    estado: decisaoPendente
      ? 'aguardando_banco'
      : instalado
        ? (mongoConectado ? 'instalado' : 'instalado_banco_indisponivel')
        : 'aguardando_setup',
    origem_instalacao: install.source || 'local',
    diagnostico_boot: {
      servidor_ms: Number(process.hrtime.bigint() - statusStartedAt) / 1e6,
      processo_uptime_s: Math.round(process.uptime()),
      pid: process.pid,
    },
  })
})

// ─── GET /api/setup/env-config — lê config MongoDB/Cloudinary ────────────────
// SEGURANÇA: segredos (MONGO_URI, CLOUDINARY_API_SECRET) NUNCA retornam em
// texto puro. Usamos uma sentinel fixa quando o valor já está configurado.
// O POST ignora o campo se vier com a sentinel (= usuário não alterou).
export const ENV_SECRET_PLACEHOLDER = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'

router.get('/env-config', async (_req, res) => {
  const cfg = readBootstrap()
  const mascarar = (val) => val ? ENV_SECRET_PLACEHOLDER : ''
  const mongo = mongoPublicConfig({ ...process.env, ...cfg })
  res.json({
    mongo_uri: mascarar(cfg.MONGO_URI || process.env.MONGO_URI || ''),
    mongo_db_name: mongo.databaseName,
    mongo_provider: mongo.provider,
    mongo_host: mongo.host,
    mongo_port: mongo.port,
    mongo_auth_source: mongo.authSource,
    mongo_tls: mongo.tls,
    mongo_username: cfg.MONGO_USERNAME ? mascarar(cfg.MONGO_USERNAME) : '',
    mongo_password: cfg.MONGO_PASSWORD ? mascarar(cfg.MONGO_PASSWORD) : '',
    cloudinary_cloud_name: cfg.CLOUDINARY_CLOUD_NAME || '',
    cloudinary_api_key: cfg.CLOUDINARY_API_KEY || '',
    cloudinary_api_secret: mascarar(cfg.CLOUDINARY_API_SECRET || ''),
    armazenamento: 'cofre_local_criptografado',
  })
})

// ─── POST /api/setup/env-config — grava config no cofre ─────────────────────
router.post('/env-config', async (req, res) => {
  try {
    const current = readBootstrap()
    const isSentinel = (v) => !v || v === ENV_SECRET_PLACEHOLDER
    const provider = req.body.mongo_provider || (req.body.mongo_uri ? 'custom' : current.MONGO_PROVIDER || 'custom')
    const databaseName = (req.body.mongo_db_name || current.MONGO_DB_NAME || 'alsistemas').trim() || 'alsistemas'
    let mongoPatch = { MONGO_DB_NAME: databaseName }

    const hasMongoChange = req.body.mongo_uri || req.body.mongo_host || req.body.mongo_username || req.body.mongo_password || req.body.mongo_provider
    if (hasMongoChange) {
      const cfg = {
        provider,
        databaseName,
        uri: !isSentinel(req.body.mongo_uri) ? req.body.mongo_uri : current.MONGO_URI,
        host: req.body.mongo_host || current.MONGO_HOST,
        port: req.body.mongo_port || current.MONGO_PORT,
        authSource: req.body.mongo_auth_source || current.MONGO_AUTH_SOURCE,
        tls: req.body.mongo_tls ?? current.MONGO_TLS,
        username: !isSentinel(req.body.mongo_username) ? req.body.mongo_username : current.MONGO_USERNAME,
        password: !isSentinel(req.body.mongo_password) ? req.body.mongo_password : current.MONGO_PASSWORD,
      }
      let built
      try { built = buildMongoUri(cfg) }
      catch (err) { return res.status(400).json({ erro: err.message, mongo_conectado:false, codigo:'MONGO_CONFIG_INVALIDA' }) }
      let testeConn = null
      try {
        testeConn = await mongoose.createConnection(built.uri, { dbName: built.databaseName, serverSelectionTimeoutMS:8000, connectTimeoutMS:8000 }).asPromise()
        await testeConn.db.admin().ping()
        await testeConn.close(); testeConn = null
        await conectarMongo(built.uri, built.databaseName)
      } catch (err) {
        if (testeConn) try { await testeConn.close() } catch {}
        return res.status(400).json({ erro:`Não foi possível conectar ao MongoDB: ${err.message}`, mongo_conectado:false, codigo:'MONGO_CONEXAO_FALHOU' })
      }
      mongoPatch = mongoVaultPatch(built, cfg)
    }

    const patch = { ...mongoPatch }
    const { cloudinary_cloud_name, cloudinary_api_key, cloudinary_api_secret } = req.body
    if (cloudinary_cloud_name?.trim()) patch.CLOUDINARY_CLOUD_NAME = cloudinary_cloud_name.trim()
    if (cloudinary_api_key?.trim()) patch.CLOUDINARY_API_KEY = cloudinary_api_key.trim()
    if (!isSentinel(cloudinary_api_secret)) patch.CLOUDINARY_API_SECRET = cloudinary_api_secret.trim()

    const saved = writeBootstrap(patch)
    if (saved.JWT_SECRET) process.env.JWT_SECRET = saved.JWT_SECRET
    res.json({ mensagem:'Configuração salva no cofre criptografado.', mongo_conectado:mongoose.connection.readyState===1, banco_nome:mongoose.connection.db?.databaseName || saved.MONGO_DB_NAME || '', mongo_provider:saved.MONGO_PROVIDER || provider })
  } catch { res.status(500).json({ erro:'Não foi possível salvar a configuração segura.' }) }
})

// ─── POST /api/setup — instalação inicial ────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      const uri = bootstrapValue('MONGO_URI')
      if (!uri) return res.status(400).json({ erro: 'Configure e teste o MongoDB antes de criar o administrador.' })
      try { await conectarMongo(uri) } catch (err) { return res.status(400).json({ erro: `Não foi possível conectar ao MongoDB: ${err.message}` }) }
    }
    const secret = bootstrapValue('JWT_SECRET')
    if (!secret) return res.status(500).json({ erro: 'Falha ao gerar o segredo interno de autenticação.' })
    process.env.JWT_SECRET = secret
    const total = await Usuario.countDocuments()
    if (total > 0) {
      return res.status(409).json({
        erro: 'Este banco já possui uma instalação do AL Sistemas. Use a opção de reutilizar a instalação existente ou escolha um banco vazio.',
        codigo: 'SETUP_EXISTENTE',
        instalacao_existente: true,
        usuarios: total,
      })
    }

    const {
      nome, email, senha,
      nome_site       = 'AL Sistemas',
      organizacao     = 'Minha organização',
      importar_seed   = false,
      dados_escolhidos = ['categorias','noticias','fontes','topicos','eventos','onibus','modulos','noticias_externas'],
    } = req.body

    if (!nome?.trim() || !email?.trim() || !senha?.trim()) {
      return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios.' })
    }
    if (senha.length < 8 || !/[A-Z]/.test(senha) || !/[0-9]/.test(senha) || !/[^A-Za-z0-9]/.test(senha)) {
      return res.status(400).json({ erro: 'A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, um número e um caractere especial.' })
    }

    await Promise.all([
      ConfiguracaoHome.findOneAndUpdate({ chave: 'nome_site' }, { $set: { valor: nome_site.trim(), descricao: 'Nome público do site' } }, { upsert: true }),
      ConfiguracaoHome.findOneAndUpdate({ chave: 'organizacao' }, { $set: { valor: organizacao.trim(), descricao: 'Organização responsável pelo sistema' } }, { upsert: true }),
    ])

    const perfis  = await criarPerfis()
    const usuario = await Usuario.create({
      nome:      nome.trim(),
      email:     email.trim().toLowerCase(),
      senha,
      role:      'superadmin',
      perfil_id: perfis.superadmin._id,
      ativo:     true,
    })

    // ── Seed: executado separadamente para não derrubar a instalação ─────────
    let seedInfo  = null
    let seedErro  = null
    if (importar_seed) {
      try {
        seedInfo = await executarSeed(nome_site, dados_escolhidos)
      } catch (seedErr) {
        seedErro = seedErr.message || 'Erro ao importar dados de exemplo'
      }
    }

    let migracao = null
    if (req.body?.migration_variables && typeof req.body.migration_variables === 'object') {
      migracao = await importPortableVariables(req.body.migration_variables)
    }

    // Marca a instalação como concluída independentemente do estado momentâneo
    // da conexão no próximo boot. Isso evita retornar ao wizard por uma corrida
    // entre a subida HTTP e a reconexão ao MongoDB.
    writeBootstrap({
      INSTALL_COMPLETED: true,
      INSTALL_COMPLETED_AT: new Date().toISOString(),
      INSTALL_VERSION: '1.0.117',
    })
    await markInstallationCompleted().catch(()=>null)

    // ── Auto-login: gera cookie para o admin recém-criado ────────────────────
    const requestOrigin = String(req.headers.origin || '')
    let setupCrossOrigin = false
    try {
      setupCrossOrigin = Boolean(requestOrigin && new URL(requestOrigin).host !== req.get('host'))
    } catch {}
    const COOKIE_OPTS = {
      httpOnly: true,
      secure:   setupCrossOrigin || String(req.headers['x-forwarded-proto']||'').includes('https'),
      sameSite: setupCrossOrigin ? 'none' : 'lax',
      maxAge:   7 * 24 * 60 * 60 * 1000,
      path:     '/',
    }
    const token = jwt.sign({ id: usuario._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    })
    res.cookie('alsistemas_token', token, COOKIE_OPTS)

    res.status(201).json({
      mensagem:       'Instalação concluída com sucesso!',
      usuario:        { nome: usuario.nome, email: usuario.email },
      perfis_criados: Object.values(perfis).map(p => p.nome),
      seed:           seedInfo,
      seed_erro:      seedErro,
      auto_login:     true,
      migracao,
    })
  } catch (err) { next(err) }
})

// ─── POST /api/setup/seed — importar dados de exemplo (autenticado) ──────────
router.post('/seed', autenticar, async (req, res, next) => {
  try {
    const {
      nome_site        = 'AL Sistemas',
      limpar_antes     = false,
      dados_escolhidos = ['categorias','noticias','fontes','topicos','eventos','onibus','modulos','noticias_externas'],
    } = req.body

    if (limpar_antes) {
      await Promise.all([
        Categoria.deleteMany({}),
        Noticia.deleteMany({}),
        ConfiguracaoHome.deleteMany({}),
        ModuloHome.deleteMany({}),
        Topico.deleteMany({}),
        NoticiaExterna.deleteMany({}),
        Onibus.deleteMany({}),
        Evento.deleteMany({}),
        Fonte.deleteMany({}),
      ])
    }

    const resultado = await executarSeed(nome_site, dados_escolhidos)
    res.json({ mensagem: 'Dados de exemplo importados com sucesso!', importados: resultado, limpou_antes: limpar_antes })
  } catch (err) { next(err) }
})

// ─── POST /api/setup/test-mongo — testa conexão com a URI fornecida ──────────
router.post('/test-mongo', async (req, res, next) => {
  try {
    const current = readBootstrap()
    const cfg = {
      provider: req.body.mongo_provider || (req.body.mongo_uri ? 'custom' : current.MONGO_PROVIDER || 'custom'),
      databaseName: req.body.mongo_db_name || current.MONGO_DB_NAME || 'alsistemas',
      uri: req.body.mongo_uri || current.MONGO_URI,
      host: req.body.mongo_host || current.MONGO_HOST,
      port: req.body.mongo_port || current.MONGO_PORT,
      authSource: req.body.mongo_auth_source || current.MONGO_AUTH_SOURCE,
      tls: req.body.mongo_tls ?? current.MONGO_TLS,
      username: req.body.mongo_username || current.MONGO_USERNAME,
      password: req.body.mongo_password || current.MONGO_PASSWORD,
    }
    let built
    try { built = buildMongoUri(cfg) }
    catch (err) { return res.status(200).json({ ok:false, erro:err.message, codigo:'MONGO_CONFIG_INVALIDA' }) }
    let conn = null
    try {
      conn = await mongoose.createConnection(built.uri, { dbName:built.databaseName, serverSelectionTimeoutMS:8000, connectTimeoutMS:8000 }).asPromise()
      await conn.db.admin().ping()
      const database = conn.db?.databaseName || built.databaseName
      let usuarios = 0
      let configuracoes = 0
      try { usuarios = await conn.db.collection('usuarios').countDocuments({}) } catch {}
      try { configuracoes = await conn.db.collection('configuracaohomes').countDocuments({}) } catch {}
      const instalacaoExistente = usuarios > 0
      await conn.close()
      return res.json({
        ok: true,
        mensagem: instalacaoExistente
          ? `Conectado ao banco "${database}", que já possui uma instalação do AL Sistemas.`
          : `Conectado com sucesso ao banco "${database}". Banco disponível para um novo setup.`,
        database,
        provider: built.provider,
        instalacao_existente: instalacaoExistente,
        usuarios,
        configuracoes,
      })
    } catch (err) {
      if (conn) try { await conn.close() } catch {}
      return res.status(200).json({ ok:false, erro:String(err.message || 'Falha na conexão').replace(/mongodb(\+srv)?:\/\/[^@]+@/,'mongodb$1://***@') })
    }
  } catch (err) { next(err) }
})

// ─── POST /api/setup/adotar-instalacao — reutiliza banco já instalado ───────
router.post('/adotar-instalacao', permitirManutencaoSetup, async (req, res) => {
  try {
    const current = readBootstrap()
    const cfg = {
      provider: req.body.mongo_provider || (req.body.mongo_uri ? 'custom' : current.MONGO_PROVIDER || 'custom'),
      databaseName: req.body.mongo_db_name || current.MONGO_DB_NAME || 'alsistemas',
      uri: req.body.mongo_uri || current.MONGO_URI,
      host: req.body.mongo_host || current.MONGO_HOST,
      port: req.body.mongo_port || current.MONGO_PORT,
      authSource: req.body.mongo_auth_source || current.MONGO_AUTH_SOURCE,
      tls: req.body.mongo_tls ?? current.MONGO_TLS,
      username: req.body.mongo_username || current.MONGO_USERNAME,
      password: req.body.mongo_password || current.MONGO_PASSWORD,
    }
    let built
    try { built = buildMongoUri(cfg) }
    catch (err) { return res.status(400).json({ erro: err.message, codigo: 'MONGO_CONFIG_INVALIDA' }) }

    let conn = null
    try {
      conn = await mongoose.createConnection(built.uri, { dbName: built.databaseName, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 }).asPromise()
      await conn.db.admin().ping()
      const usuarios = await conn.db.collection('usuarios').countDocuments({})
      if (usuarios < 1) {
        await conn.close(); conn = null
        return res.status(409).json({ erro: 'Este banco não possui uma instalação existente para reutilizar.', codigo: 'SETUP_NAO_ENCONTRADO' })
      }
      await conn.close(); conn = null
      const patch = mongoVaultPatch(built, cfg)
      const saved = writeBootstrap({
        ...patch,
        INSTALL_COMPLETED: true,
        INSTALL_COMPLETED_AT: current.INSTALL_COMPLETED_AT || new Date().toISOString(),
        INSTALL_ADOPTED_AT: new Date().toISOString(),
      })
      await conectarMongo(built.uri, built.databaseName)
      await markInstallationCompleted().catch(()=>null)
      const migracao = req.body?.migration_variables && typeof req.body.migration_variables === 'object'
        ? await importPortableVariables(req.body.migration_variables)
        : null
      return res.json({
        ok: true,
        mensagem: 'Configuração local substituída. A instalação existente foi vinculada a este servidor.',
        banco_nome: built.databaseName,
        mongo_provider: saved.MONGO_PROVIDER || built.provider,
        usuarios,
        migracao,
      })
    } catch (err) {
      if (conn) try { await conn.close() } catch {}
      return res.status(400).json({ erro: `Não foi possível reutilizar esta instalação: ${String(err.message || err)}` })
    }
  } catch {
    return res.status(500).json({ erro: 'Não foi possível substituir a configuração local.' })
  }
})

// ─── POST /api/setup/limpar-config-local — remove somente cofre local ───────
router.post('/limpar-config-local', permitirManutencaoSetup, async (req, res) => {
  if (req.body?.confirmar !== 'LIMPAR_CONFIG_LOCAL') {
    return res.status(400).json({ erro: 'Confirmação inválida.', codigo: 'CONFIRMACAO_INVALIDA' })
  }
  try {
    if (mongoose.connection.readyState !== 0) {
      try { await mongoose.disconnect() } catch {}
    }
    resetBootstrapVault()
    return res.json({
      ok: true,
      mensagem: 'Configuração local removida. Banco de dados, uploads, backups, logs e histórico de atualizações foram preservados.',
      preservado: ['MongoDB', 'uploads', 'backups', 'logs', 'histórico de atualizações'],
    })
  } catch {
    return res.status(500).json({ erro: 'Não foi possível limpar a configuração local.' })
  }
})

// ─── POST /api/setup/test-cloudinary — testa credenciais Cloudinary ──────────
router.post('/test-cloudinary', async (req, res, next) => {
  try {
    const { cloudinary_cloud_name, cloudinary_api_key } = req.body
    let { cloudinary_api_secret } = req.body

    // Se o secret vier como sentinel (usuário não alterou), usa o valor do ambiente
    if (!cloudinary_api_secret || cloudinary_api_secret === ENV_SECRET_PLACEHOLDER) {
      cloudinary_api_secret = process.env.CLOUDINARY_API_SECRET || ''
    }

    if (!cloudinary_cloud_name || !cloudinary_api_key || !cloudinary_api_secret) {
      return res.status(400).json({ ok: false, erro: 'Preencha todos os campos do Cloudinary' })
    }
    try {
      const { v2: cloudinary } = await import('cloudinary')
      cloudinary.config({
        cloud_name: cloudinary_cloud_name,
        api_key:    cloudinary_api_key,
        api_secret: cloudinary_api_secret,
      })
      await cloudinary.api.ping()
      return res.json({ ok: true, mensagem: `Cloudinary conectado (cloud: ${cloudinary_cloud_name})` })
    } catch (cloudErr) {
      return res.status(200).json({ ok: false, erro: cloudErr.message || 'Credenciais inválidas' })
    }
  } catch (err) { next(err) }
})

// ─── POST /api/setup/reset-db — apaga TUDO (confirmação por texto) ───────────
router.post('/reset-db', async (req, res, next) => {
  try {
    const { confirmar, manter_usuarios = true } = req.body
    if (confirmar !== 'CONFIRMAR_RESET') {
      return res.status(400).json({ erro: 'Envie confirmar: "CONFIRMAR_RESET" para prosseguir.' })
    }

    const ops = [
      Categoria.deleteMany({}),
      Noticia.deleteMany({}),
      ConfiguracaoHome.deleteMany({}),
      ModuloHome.deleteMany({}),
      Topico.deleteMany({}),
      NoticiaExterna.deleteMany({}),
      Onibus.deleteMany({}),
      Evento.deleteMany({}),
      PerfilAcesso.deleteMany({ sistema: false }),
    ]
    if (!manter_usuarios) {
      ops.push(Usuario.deleteMany({}))
      ops.push(PerfilAcesso.deleteMany({}))
    }
    await Promise.all(ops)

    res.json({
      mensagem: manter_usuarios
        ? 'Banco resetado. Usuários e perfis foram mantidos.'
        : 'Banco completamente resetado. Acesse /admin/setup para reinstalar.',
      manter_usuarios,
    })
  } catch (err) { next(err) }
})

// ─── POST /api/setup/desativar-arquivo — desativa o setup após instalação ────
// IMPORTANTE: apenas grava SETUP_DISABLED=true no .env.
// O rename do arquivo setup.js foi REMOVIDO — ele quebrava o servidor na
// reinicialização porque server.js faz import estático de './routes/setup.js'.
// A guarda no topo deste router (process.env.SETUP_DISABLED === 'true') já é
// suficiente para bloquear todas as rotas de setup após a instalação.
router.post('/desativar-arquivo', autenticar, async (_req, res) => {
  writeBootstrap({ SETUP_DISABLED: true })
  res.json({ mensagem: 'Instalação inicial concluída. O sistema continuará permitindo apenas manutenção autenticada.', cofre_atualizado: true })
})

export default router
