import mongoose from 'mongoose'

const securitySessionSchema = new mongoose.Schema({
  jti: { type: String, required: true, unique: true, index: true },
  usuario_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  usuario_email: { type: String, default: null },
  transport: { type: String, enum: ['cookie', 'cloud-bearer'], default: 'cookie' },
  persistente: { type: Boolean, default: false },
  ip: { type: String, default: null, index: true },
  user_agent: { type: String, default: null },
  dispositivo: { type: String, default: 'Dispositivo desconhecido' },
  primeiro_acesso_em: { type: Date, default: Date.now },
  ultimo_acesso_em: { type: Date, default: Date.now, index: true },
  expira_em: { type: Date, required: true },
  revogada_em: { type: Date, default: null, index: true },
  revogada_por: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
  motivo_revogacao: { type: String, default: null },
}, { timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' } })

securitySessionSchema.index({ usuario_id: 1, revogada_em: 1, ultimo_acesso_em: -1 })
securitySessionSchema.index({ expira_em: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('SecuritySession', securitySessionSchema)
