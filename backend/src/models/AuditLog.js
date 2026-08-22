/**
 * #19 — Modelo de Audit Log.
 * Persiste toda ação administrativa (criar/editar/excluir).
 */
import mongoose from 'mongoose'

const auditLogSchema = new mongoose.Schema({
  admin_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  admin_email: { type: String, required: true },
  acao:        { type: String, required: true },
  recurso:     { type: String, required: true },   // 'noticias', 'eventos', etc.
  recurso_id:  { type: String, default: null },
  payload:     { type: mongoose.Schema.Types.Mixed, default: null },
  ip:          { type: String, default: null },
  request_id:  { type: String, default: null },
  expira_em:   { type: Date, default: () => new Date(Date.now() + 365*24*60*60*1000) },
}, {
  timestamps: { createdAt: 'criado_em', updatedAt: false },
})

// Índices para consultas administrativas
auditLogSchema.index({ admin_id: 1, criado_em: -1 })
auditLogSchema.index({ recurso: 1, criado_em: -1 })
auditLogSchema.index({ criado_em: -1 })
auditLogSchema.index({ expira_em: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('AuditLog', auditLogSchema)
