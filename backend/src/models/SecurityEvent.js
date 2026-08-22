import mongoose from 'mongoose'

const securityEventSchema = new mongoose.Schema({
  tipo: { type: String, required: true, index: true },
  fingerprint: { type: String, default: null, index: true },
  severidade: { type: String, enum: ['baixa', 'media', 'alta', 'critica'], default: 'media', index: true },
  mensagem: { type: String, required: true, trim: true },
  ip: { type: String, default: null, index: true },
  rota: { type: String, default: null },
  metodo: { type: String, default: null },
  status_http: { type: Number, default: null },
  usuario_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null, index: true },
  usuario_email: { type: String, default: null },
  request_id: { type: String, default: null },
  request_ids: { type: [String], default: [] },
  rotas: { type: [String], default: [] },
  dados: { type: mongoose.Schema.Types.Mixed, default: null },
  ocorrencias: { type: Number, default: 1 },
  primeira_ocorrencia_em: { type: Date, default: Date.now },
  ultima_ocorrencia_em: { type: Date, default: Date.now, index: true },
  estado: { type: String, enum: ['novo', 'investigando', 'resolvido', 'ignorado'], default: 'novo', index: true },
  resolvido: { type: Boolean, default: false, index: true },
  responsavel_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
  responsavel_email: { type: String, default: null },
  resolvido_em: { type: Date, default: null },
  observacao: { type: String, default: null },
  acao_tomada: { type: String, default: null },
  resposta_automatica: { type: mongoose.Schema.Types.Mixed, default: null },
  expira_em: { type: Date, default: null },
}, { timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' } })

securityEventSchema.index({ criado_em: -1 })
securityEventSchema.index({ severidade: 1, estado: 1, criado_em: -1 })
securityEventSchema.index({ ip: 1, criado_em: -1 })
securityEventSchema.index({ fingerprint: 1, estado: 1, ultima_ocorrencia_em: -1 })
securityEventSchema.index({ expira_em: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('SecurityEvent', securityEventSchema)
