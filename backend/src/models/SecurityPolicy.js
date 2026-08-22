import mongoose from 'mongoose'

const securityPolicySchema = new mongoose.Schema({
  chave: { type: String, default: 'default', unique: true },
  mfa_admin_obrigatorio: { type: Boolean, default: false },
  mfa_todos_obrigatorio: { type: Boolean, default: false },
  step_up_critico: { type: Boolean, default: true },
  swagger_protegido: { type: Boolean, default: true },
  retencao_eventos_dias: { type: Number, default: 180, min: 30, max: 3650 },
  retencao_auditoria_dias: { type: Number, default: 365, min: 30, max: 3650 },
  resposta_automatica: { type: String, enum: ['observar', 'alertar', 'proteger'], default: 'observar' },
  bloqueio_ip_minutos: { type: Number, default: 30, min: 5, max: 1440 },
  alertas: {
    webhook_ativo: { type: Boolean, default: false },
    telegram_ativo: { type: Boolean, default: false },
    email_ativo: { type: Boolean, default: false },
    email_destino: { type: String, default: '' },
    severidade_minima: { type: String, enum: ['baixa', 'media', 'alta', 'critica'], default: 'alta' },
    cooldown_minutos: { type: Number, default: 15, min: 1, max: 1440 },
  },
  ultimo_scan: { type: mongoose.Schema.Types.Mixed, default: null },
  ultimo_audit_dependencias: { type: mongoose.Schema.Types.Mixed, default: null },
  atualizado_por: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
}, { timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' } })

export default mongoose.model('SecurityPolicy', securityPolicySchema)
