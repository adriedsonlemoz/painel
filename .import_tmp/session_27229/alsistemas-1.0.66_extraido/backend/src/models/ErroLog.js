import mongoose from 'mongoose'

// Tipos de erro capturados:
//   render             → React Error Boundary (erro de renderização)
//   js_error           → window.onerror (JS síncrono)
//   unhandled_rejection → Promise não tratada
//   api                → Falha em chamada fetch/api do frontend
//   backend            → Exceção HTTP 5xx capturada no servidor
//   update             → Atualização/rollback/processo externo
//   worker             → Jobs internos e subprocessos
//   rss                → Falha crítica do scheduler RSS
//   github             → Falha de publicação/sincronização GitHub
const erroLogSchema = new mongoose.Schema({
  tipo: {
    type: String,
    enum: ['render', 'js_error', 'unhandled_rejection', 'api', 'backend', 'update', 'worker', 'rss', 'github'],
    required: true,
    index: true,
  },
  mensagem:       { type: String, required: true, trim: true },
  stack:          { type: String, default: null },
  url:            { type: String, default: null },   // window.location.href no momento do erro
  rota:           { type: String, default: null },   // pathname
  user_agent:     { type: String, default: null },
  usuario_email:  { type: String, default: null },   // se logado
  dados:          { type: mongoose.Schema.Types.Mixed, default: null }, // contexto extra
  fingerprint:    { type: String, default: null, index: true },
  ocorrencias:    { type: Number, default: 1, min: 1 },
  ultima_ocorrencia: { type: Date, default: Date.now },
  lido:           { type: Boolean, default: false, index: true },
  // Status de triagem (mais rico que o boolean lido)
  status: {
    type: String,
    enum: ['novo', 'investigando', 'resolvido', 'ignorado'],
    default: 'novo',
    index: true,
  },
}, {
  timestamps: { createdAt: 'criado_em', updatedAt: false },
})

erroLogSchema.index({ criado_em: -1 })
erroLogSchema.index({ lido: 1, criado_em: -1 })
erroLogSchema.index({ status: 1, criado_em: -1 })
erroLogSchema.index({ fingerprint: 1, ultima_ocorrencia: -1 })

export default mongoose.model('ErroLog', erroLogSchema)
