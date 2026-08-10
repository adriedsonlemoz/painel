/**
 * Modelo de Evento.
 * Mantém a agenda pública e administrativa com validações consistentes.
 */
import mongoose from 'mongoose'

const toJSONConfig = {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString()
    delete ret._id
    return ret
  },
}

const eventoSchema = new mongoose.Schema(
  {
    titulo: {
      type: String,
      required: [true, 'O título do evento é obrigatório.'],
      trim: true,
      minlength: 3,
      maxlength: 140,
    },
    descricao: {
      type: String,
      trim: true,
      default: '',
      maxlength: 3000,
    },
    data: {
      type: Date,
      required: [true, 'A data do evento é obrigatória.'],
    },
    horario: {
      type: String,
      trim: true,
      default: '',
      maxlength: 5,
      validate: {
        validator: value => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
        message: 'Horário inválido. Use o formato HH:mm.',
      },
    },
    local: {
      type: String,
      trim: true,
      default: '',
      maxlength: 180,
    },
    cor: {
      type: String,
      default: '#1B5E3B',
      uppercase: true,
      validate: {
        validator: value => /^#[0-9A-F]{6}$/.test(value),
        message: 'Cor inválida. Use hexadecimal no formato #RRGGBB.',
      },
    },
    tipoEntrada: {
      type: String,
      enum: ['gratuito', 'pago', 'doacoes'],
      default: 'gratuito',
    },
    ativo: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' },
    toJSON: toJSONConfig,
  }
)

// Consulta pública: eventos publicados em ordem cronológica.
eventoSchema.index({ ativo: 1, data: 1, _id: 1 })
// Administração: ajuda a separar rapidamente recentes e antigos.
eventoSchema.index({ data: -1, ativo: 1 })

export const Evento = mongoose.model('Evento', eventoSchema)
