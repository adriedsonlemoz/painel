import mongoose from 'mongoose'
const schema = new mongoose.Schema({
  key: { type: String, unique: true, index: true },
  task: { type: String, index: true },
  payload: mongoose.Schema.Types.Mixed,
  expiresAt: { type: Date, index: true, expires: 0 },
  updatedAt: { type: Date, default: Date.now },
}, { versionKey: false })
export default mongoose.model('AiCache', schema)
