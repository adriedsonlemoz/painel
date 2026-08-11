/**
 * Noticia.js
 * ──────────
 * Schema Mongoose para notícias — suporta tanto criação manual
 * quanto importação automática via RSS.
 *
 * Campos de identificação RSS:
 *   guid         → hash MD5 do link/guid do feed (índice único sparse)
 *   importado    → diferencia notícias manuais das importadas
 *   rss_fonte_id → referência ao RssFonte que gerou a notícia
 *   url_original → link original do artigo na fonte
 *   publicado_em → data de publicação no feed (diferente de criado_em)
 */
import mongoose from 'mongoose'

const noticiaSchema = new mongoose.Schema(
  {
    // ── Identificação ────────────────────────────────────────────────────────

    /**
     * GUID único derivado do item RSS (hash MD5 do link/guid do feed).
     * Índice único + sparse: aceita null (notícias manuais não têm guid),
     * mas impede duplicatas em notícias importadas.
     *
     * Alternativa avaliada: índice em `url_original`
     *   → Descartada: alguns feeds repetem o mesmo link com títulos diferentes
     *     (liveblogs, atualizações). GUID do feed é mais confiável.
     */
    guid: {
      type:  String,
      // SEM default: null — campo ausente (undefined) é ignorado pelo sparse index.
      // Com default: null o Mongo armazena null explicitamente, que *entra* no índice
      // único e causa E11000 quando há mais de uma notícia sem guid.
      index: {
        unique: true,
        sparse: true,  // documentos sem o campo são excluídos do índice
      },
    },

    titulo: {
      type:     String,
      required: [true, 'Título é obrigatório'],
      trim:     true,
      maxlength: [500, 'Título excede 500 caracteres'],
    },

    /**
     * Slug SEO-friendly gerado automaticamente no serviço.
     * Único para evitar conflitos em URLs canônicas.
     */
    slug: {
      type:   String,
      unique: true,
      trim:   true,
      lowercase: true,
    },

    // ── Conteúdo ─────────────────────────────────────────────────────────────

    /** HTML sanitizado do corpo completo do artigo */
    conteudo: {
      type:     String,
      required: [true, 'Conteúdo é obrigatório'],
    },

    /** Texto puro truncado em ~300 caracteres para cards, SEO e previews */
    resumo: {
      type:    String,
      default: '',
      maxlength: [1000, 'Resumo excede 1000 caracteres'],
    },

    imagem_url: {
      type:    String,
      default: null,
    },

    imagem_public_id: {
      type: String,
      default: null,
    },

    galeria: {
      type: [{
        url: { type:String, required:true },
        public_id: { type:String, default:null },
        legenda: { type:String, default:'' },
      }],
      default: [],
    },

    imagem_legenda: { type: String, default: '' },
    imagem_alt: { type: String, default: '', maxlength: 220 },
    imagem_credito: { type: String, default: '', maxlength: 220 },
    imagem_fonte_url: { type: String, default: null },
    imagem_storage: { type: String, enum: ['r2', 'cloudinary', 'gridfs', 'external', null], default: null },
    imagem_key: { type: String, default: null },
    imagem_mime: { type: String, default: null },
    imagem_tamanho: { type: Number, default: null },
    imagem_largura: { type: Number, default: null },
    imagem_altura: { type: Number, default: null },
    imagem_nome_original: { type: String, default: null },

    /** Contador de visualizações únicas por IP (#5) */
    views: {
      type:    Number,
      default: 0,
      index:   true,
    },

    // ── Autoria e origem ──────────────────────────────────────────────────────

    autor: { type:String, default:null },
    responsavel_id:{ type:mongoose.Schema.Types.ObjectId, ref:'Usuario', default:null, index:true },
    revisor_id:{ type:mongoose.Schema.Types.ObjectId, ref:'Usuario', default:null, index:true },
    comentarios_internos:{ type:[{ usuario_id:{type:mongoose.Schema.Types.ObjectId,ref:'Usuario'}, nome:{type:String,default:''}, texto:{type:String,required:true,maxlength:2000}, criado_em:{type:Date,default:Date.now} }], default:[] },

    /** Referência ao document Fonte (tabela de origens: "Agência Brasil" etc.) */
    fonte_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Fonte',
      default: null,
    },

    // ── Categorização ─────────────────────────────────────────────────────────

    categoria_id: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Categoria',
      default: null,
    },

    tags: {
      type:    [String],
      default: [],
    },

    // ── Status editorial ──────────────────────────────────────────────────────

    /**
     * Status de publicação.
     * Notícias importadas chegam como 'rascunho' → revisão editorial obrigatória
     * antes de ir a 'publicado'.
     */
    status: {
      type:    String,
      enum:    ['rascunho', 'revisao', 'agendado', 'publicado', 'arquivado'],
      default: 'rascunho',
      index:   true,
    },

    /** Data/hora em que uma notícia agendada deve entrar no ar. */
    agendado_para: {
      type: Date,
      default: null,
      index: true,
    },

    destaque: {
      type:    Boolean,
      default: false,
    },

    /** Plantão: exibe uma faixa urgente no topo do portal enquanto estiver válido. */
    urgente: {
      type: Boolean,
      default: false,
      index: true,
    },
    urgente_ate: {
      type: Date,
      default: null,
      index: true,
    },

    // ── Campos exclusivos de importação RSS ───────────────────────────────────

    /**
     * Flag que diferencia notícias manuais das importadas via RSS.
     * Use para filtros no admin ("ver apenas importadas", métricas etc.)
     */
    importado: {
      type:    Boolean,
      default: false,
      index:   true,
    },

    /** Fonte RSS que originou esta notícia (null em notícias manuais) */
    rss_fonte_id: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'RssFonte',
      default: null,
    },

    /** URL original do artigo no site da fonte */
    url_original: {
      type:    String,
      default: null,
    },

    /**
     * Data de publicação original do artigo na fonte RSS.
     * Diferente de `criado_em` (quando foi salvo no banco).
     * Usado para ordenação cronológica correta.
     */
    publicado_em: {
      type:    Date,
      default: null,
      index:   true,
    },

    // ── SEO ───────────────────────────────────────────────────────────────────

    seo_titulo:    { type:String, default:null, maxlength:120 },
    seo_descricao: { type:String, default:null, maxlength:180 },
    canonical_url:{ type:String, default:null },
    og_imagem_url:{ type:String, default:null },
    seo_noindex:{ type:Boolean, default:false },
    autosave_em:{ type:Date, default:null },
  },
  {
    timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' },

    // Índice composto: busca por status + data de publicação (queries mais comuns)
    indexes: [
      { status: 1, publicado_em: -1 },
      { categoria_id: 1, status: 1 },
      { importado: 1, status: 1 },
      { status: 1, agendado_para: 1 },
      { status: 1, urgente: 1, urgente_ate: 1 },
    ],
  }
)

// ─── Índices adicionais ──────────────────────────────────────────────────────

// Busca full-text no título (essencial para search no admin)
noticiaSchema.index({ titulo: 'text', resumo: 'text' })

// ─── Virtual: data de exibição ────────────────────────────────────────────────
// Retorna publicado_em se disponível (artigos importados), senão criado_em.
// Usado nos templates para exibir a data correta ao leitor.
noticiaSchema.virtual('data_exibicao').get(function () {
  return this.publicado_em ?? this.criado_em
})

export default mongoose.model('Noticia', noticiaSchema)
