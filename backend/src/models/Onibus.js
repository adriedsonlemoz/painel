/**
 * Modelo de linhas e horários de ônibus.
 * Mantém compatibilidade com os registros antigos e adiciona metadados úteis
 * para o painel e para a página pública.
 */
import mongoose from 'mongoose'

const DIAS_VALIDOS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']

const toJSONConfig = {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString()
    delete ret._id
    return ret
  },
}

const horarioSchema = new mongoose.Schema(
  {
    hora: {
      type: String,
      required: true,
      match: [/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido'],
    },
    dias: {
      type: [String],
      default: ['seg', 'ter', 'qua', 'qui', 'sex'],
      validate: {
        validator: dias => Array.isArray(dias) && dias.length > 0 && dias.every(d => DIAS_VALIDOS.includes(d)),
        message: 'Informe ao menos um dia válido da semana',
      },
    },
    observacao: { type: String, trim: true, maxlength: 180, default: '' },
  },
  { _id: false }
)

const onibusSchema = new mongoose.Schema(
  {
    codigo:      { type: String, trim: true, maxlength: 30, default: '' },
    destino:     { type: String, required: true, trim: true, maxlength: 120 },
    origem:      { type: String, trim: true, maxlength: 120, default: 'Iguatama' },
    empresa:     { type: String, trim: true, maxlength: 120, default: '' },
    descricao:   { type: String, trim: true, maxlength: 260, default: '' },
    embarque:    { type: String, trim: true, maxlength: 180, default: '' },
    telefone:    { type: String, trim: true, maxlength: 40, default: '' },
    site:        { type: String, trim: true, maxlength: 300, default: '' },
    tarifa:      { type: Number, min: 0, default: null },
    duracao_min: { type: Number, min: 0, max: 1440, default: null },
    observacao:  { type: String, trim: true, maxlength: 300, default: '' },
    cor:         { type: String, match: /^#[0-9A-Fa-f]{6}$/, default: '#1B5E3B' },
    horarios:    { type: [horarioSchema], default: [] },
    ativo:       { type: Boolean, default: true },
    ordem:       { type: Number, min: 0, default: 0 },
  },
  {
    timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' },
    toJSON: toJSONConfig,
  }
)

onibusSchema.index({ ativo: 1, ordem: 1, destino: 1 })
onibusSchema.index({ origem: 1, destino: 1 })

export const Onibus = mongoose.model('Onibus', onibusSchema)
