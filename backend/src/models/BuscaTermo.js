import mongoose from 'mongoose'

const buscaTermoSchema = new mongoose.Schema({
  termo: { type: String, required: true, trim: true, lowercase: true },
  total: { type: Number, default: 0 },
  ultima_busca_em: { type: Date, default: Date.now, index: true },
}, { timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' } })

buscaTermoSchema.index({ termo: 1 }, { unique: true })
export default mongoose.model('BuscaTermo', buscaTermoSchema)
