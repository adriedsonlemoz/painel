import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  bucket: { type: String, required: true, index: true },
  key: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  revokedAt: { type: Date, default: null, index: true },
  createdBy: { type: String, default: null },
  lastAccessAt: { type: Date, default: null },
  accessCount: { type: Number, default: 0 },
}, { timestamps: true, collection: 'r2_shares' })

schema.index({ bucket: 1, key: 1, createdAt: -1 })

export default mongoose.model('R2Share', schema)
