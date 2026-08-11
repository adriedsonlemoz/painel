import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  task: { type: String, index: true },
  profile: { type: String, index: true },
  provider: { type: String, index: true },
  model: String,
  status: { type: String, enum: ['success','error','cancelled','cache'], index: true },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  costUsd: { type: Number, default: 0 },
  latencyMs: { type: Number, default: 0 },
  queueWaitMs: { type: Number, default: 0 },
  fallback: { type: Boolean, default: false },
  retries: { type: Number, default: 0 },
  cacheHit: { type: Boolean, default: false },
  errorStatus: Number,
  errorCode: String,
  errorMessage: String,
  meta: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * 90 },
}, { versionKey: false })

export default mongoose.model('AiUsage', schema)
