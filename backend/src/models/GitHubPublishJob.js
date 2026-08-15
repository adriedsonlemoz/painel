import mongoose from 'mongoose'

const githubPublishLogSchema = new mongoose.Schema({
  at: Date,
  phase: String,
  label: String,
  message: String,
  state: String,
  progress: Number,
  details: mongoose.Schema.Types.Mixed,
}, { _id: false })

const githubPublishJobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true, index: true },
  sourceOwner: { type: String, required: true, index: true },
  sourceRepo: { type: String, required: true, index: true },
  destination: { type: String, required: true, index: true },
  branch: { type: String, required: true, index: true },
  usuarioId: { type: String, default: '', index: true },

  // Existe somente enquanto a publicação está ativa. O índice único evita duas
  // operações concorrentes tentando mover a mesma branch ao mesmo tempo.
  lockKey: { type: String, unique: true, sparse: true },

  status: {
    type: String,
    enum: ['queued', 'running', 'succeeded', 'failed'],
    default: 'queued',
    index: true,
  },
  phase: { type: String, default: 'received' },
  progress: { type: Number, default: 0 },
  logs: { type: [githubPublishLogSchema], default: [] },
  result: mongoose.Schema.Types.Mixed,
  error: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now, index: true },
  finishedAt: Date,
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    index: true,
    expires: 0,
  },
}, { versionKey: false })

githubPublishJobSchema.index({ destination: 1, branch: 1, status: 1 })

export default mongoose.model('GitHubPublishJob', githubPublishJobSchema)
