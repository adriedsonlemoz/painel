/**
 * Modelo de Fonte RSS.
 * Armazena as fontes de feed RSS cadastradas para importação automática ou manual.
 */
import mongoose from 'mongoose'

const rssFonteSchema = new mongoose.Schema({
  nome:          { type: String, required: true, trim: true },
  url:           { type: String, required: true, trim: true },
  ativa:         { type: Boolean, default: true },
  fonte_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Fonte', required: true, index: true },
  categoria_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Categoria', required: true, index: true },
  max_items:     { type: Number, default: 10, min: 1, max: 100 },
  // Configuração de atualização automática
  auto_update:   { type: Boolean, default: false },
  intervalo_min: { type: Number, default: 60, min: 5 }, // minutos entre atualizações
  // Enriquecimento editorial opcional por IA (limitado para proteger cotas gratuitas)
  ia_ativa: { type: Boolean, default: false },
  ia_resumo: { type: Boolean, default: true },
  ia_tags: { type: Boolean, default: true },
  ia_categoria: { type: Boolean, default: true },
  ia_titulo: { type: Boolean, default: false },
  ia_max_itens: { type: Number, default: 3, min: 1, max: 10 },
  copiar_imagem_r2: { type: Boolean, default: true },
  // Histórico
  ultima_importacao: { type: Date, default: null },
  ultima_tentativa:  { type: Date, default: null },
  total_importadas:  { type: Number, default: 0 },
  ultima_importadas: { type: Number, default: 0 },
  ultima_duplicadas: { type: Number, default: 0 },
  ultimo_total_feed: { type: Number, default: 0 },
  ultima_duracao_ms: { type: Number, default: 0 },
  ultimo_erro:       { type: String, default: null },
  falhas_consecutivas: { type: Number, default: 0 },
  desativada_automaticamente: { type: Boolean, default: false },
  motivo_desativacao: { type: String, default: null },
  // Indica se é fonte padrão pré-cadastrada (não pode ser excluída pelo usuário)
  padrao: { type: Boolean, default: false },
}, { timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' } })

// O plugin global de toJSON em server.js não alcança este model porque
// rssScheduler.js (importado como utilitário) já compila o schema antes
// do plugin ser registrado no corpo do server.js. Por isso, o transform
// é definido diretamente aqui — igual ao padrão dos demais models.
rssFonteSchema.set('toJSON', {
  virtuals:   true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString()
    delete ret._id
    return ret
  },
})

export default mongoose.model('RssFonte', rssFonteSchema)
