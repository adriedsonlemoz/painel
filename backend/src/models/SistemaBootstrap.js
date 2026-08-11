import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  chave: { type: String, default: 'principal', unique: true, index: true },
  installCompleted: { type: Boolean, default: false },
  installCompletedAt: { type: Date, default: null },
  jwtSecret: { type: String, default: '' },
  credentialMasterKey: { type: String, default: '' },
  origem: { type: String, default: 'runtime' },
  ultimaMigracao: { type: Date, default: null },
}, { timestamps: true, collection: 'sistema_bootstrap' })

export default mongoose.model('SistemaBootstrap', schema)
