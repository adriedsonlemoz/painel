import mongoose from 'mongoose'

const diagnosticTriageSchema = new mongoose.Schema({
  event_id: { type: String, required: true, unique: true, index: true },
  source: { type: String, required: true, index: true },
  status: { type: String, enum: ['novo','acompanhando','revisado','silenciado'], default: 'novo', index: true },
  nota: { type: String, default: '', maxlength: 3000 },
  titulo: { type: String, default: '', maxlength: 500 },
  atualizado_por: { type: String, default: '' },
}, { timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' } })

export default mongoose.model('DiagnosticTriage', diagnosticTriageSchema)
