import mongoose from 'mongoose'

const plataformaCredencialSchema = new mongoose.Schema({
  plataforma: { type: String, required: true, unique: true, trim: true, lowercase: true },
  segredo:    { type: String, required: true },
  metadata:   { type: mongoose.Schema.Types.Mixed, default: {} },
  origem:     { type: String, default: 'painel' },
}, { timestamps: true })

export default mongoose.model('PlataformaCredencial', plataformaCredencialSchema)
