import mongoose from 'mongoose'

const midiaAssetSchema = new mongoose.Schema({
  titulo: { type: String, default: '', trim: true },
  tipo: { type: String, default: 'midia', trim: true },
  url: { type: String, required: true, trim: true },
  public_id: { type: String, default: null },
  alt: { type: String, default: '' },
  credito: { type: String, default: '' },
  mime: { type: String, default: '' },
  size: { type: Number, default: null },
  width: { type: Number, default: null },
  height: { type: Number, default: null },
  storage: { type: String, default: 'r2' },
  original_name: { type: String, default: '' },
}, { timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' } })

midiaAssetSchema.index({ public_id: 1 }, { unique: true, sparse: true })
export default mongoose.model('MidiaAsset', midiaAssetSchema)
