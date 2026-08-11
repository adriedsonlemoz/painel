import { body, validationResult } from 'express-validator'

// ─── Helper: dispara 422 se houver erros de validação ────────────────────────
export function validar(req, res, next) {
  const erros = validationResult(req)
  if (!erros.isEmpty()) {
    return res.status(422).json({
      erro: 'Dados inválidos',
      detalhes: erros.array().map(e => ({ campo: e.path, mensagem: e.msg })),
    })
  }
  next()
}

// ─── Auth ────────────────────────────────────────────────────────────────────
export const regraLogin = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email obrigatório')
    .isEmail().withMessage('Email inválido')
    .normalizeEmail(),
  body('senha')
    .notEmpty().withMessage('Senha obrigatória')
    .isLength({ min: 8 }).withMessage('Senha deve ter ao menos 8 caracteres'),
]

// ─── Notícias ────────────────────────────────────────────────────────────────
export const regraNoticia = [
  body('titulo')
    .trim()
    .notEmpty().withMessage('Título obrigatório')
    .isLength({ max: 300 }).withMessage('Título deve ter no máximo 300 caracteres'),
  body('conteudo')
    .notEmpty().withMessage('Conteúdo obrigatório'),
  body('categoria_id')
    .notEmpty().withMessage('Categoria obrigatória')
    .isMongoId().withMessage('Categoria inválida'),
  body('imagem_url')
    .optional({ nullable: true })
    .isURL().withMessage('URL da imagem inválida'),
  body('imagem_fonte_url')
    .optional({ nullable: true, checkFalsy: true })
    .isURL().withMessage('URL da fonte da imagem inválida'),
  body('destaque')
    .optional()
    .isBoolean().withMessage('Destaque deve ser booleano')
    .toBoolean(),
  // #20 — Validação do status editorial
  body('status')
    .optional()
    .isIn(['rascunho', 'revisao', 'agendado', 'publicado', 'arquivado'])
    .withMessage('Status inválido. Use: rascunho, revisao, agendado, publicado ou arquivado'),
  body('agendado_para').optional({ nullable: true }).isISO8601().withMessage('Data de agendamento inválida'),
  body('urgente').optional().isBoolean().withMessage('Urgente deve ser booleano').toBoolean(),
  body('urgente_ate').optional({ nullable: true }).isISO8601().withMessage('Validade do plantão inválida'),
]

// ─── Categorias ──────────────────────────────────────────────────────────────
export const regraCategoria = [
  body('nome')
    .trim()
    .notEmpty().withMessage('Nome obrigatório')
    .isLength({ max: 100 }).withMessage('Nome deve ter no máximo 100 caracteres'),
  body('slug')
    .trim()
    .notEmpty().withMessage('Slug obrigatório')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug deve conter apenas letras minúsculas, números e hífens'),
  body('descricao')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 200 }).withMessage('Descrição deve ter no máximo 200 caracteres'),
  body('cor')
    .optional({ nullable: true })
    .matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Cor deve ser um hex válido, ex: #1B5E3B'),
]

// ─── Fontes ──────────────────────────────────────────────────────────────────
export const regraFonte = [
  body('nome')
    .trim()
    .notEmpty().withMessage('Nome da fonte obrigatório')
    .isLength({ max: 150 }).withMessage('Nome deve ter no máximo 150 caracteres'),
  body('url')
    .optional({ nullable: true })
    .isURL().withMessage('URL da fonte inválida'),
]

// ─── Notícias Externas ───────────────────────────────────────────────────────
export const regraNoticiaExterna = [
  body('titulo')
    .trim()
    .notEmpty().withMessage('Título obrigatório')
    .isLength({ max: 300 }).withMessage('Título deve ter no máximo 300 caracteres'),
  body('url_externa')
    .notEmpty().withMessage('URL externa obrigatória')
    .isURL().withMessage('URL externa inválida'),
  body('imagem_url')
    .optional({ nullable: true })
    .isURL().withMessage('URL da imagem inválida'),
  body('ordem')
    .optional()
    .isInt({ min: 0 }).withMessage('Ordem deve ser inteiro não-negativo')
    .toInt(),
]

// ─── Tópicos ─────────────────────────────────────────────────────────────────
export const regraTopico = [
  body('label')
    .trim()
    .notEmpty().withMessage('Label obrigatório')
    .isLength({ max: 100 }).withMessage('Label deve ter no máximo 100 caracteres'),
  body('link')
    .optional({ nullable: true })
    .notEmpty().withMessage('Link não pode ser vazio'),
  body('ordem')
    .optional()
    .isInt({ min: 0 }).withMessage('Ordem deve ser inteiro não-negativo')
    .toInt(),
]



// ─── Ônibus ─────────────────────────────────────────────────────────────────
const DIAS_ONIBUS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']

export const regraOnibus = [
  body('destino')
    .trim()
    .notEmpty().withMessage('Destino obrigatório')
    .isLength({ max: 120 }).withMessage('Destino deve ter no máximo 120 caracteres'),
  body('origem')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 120 }).withMessage('Origem deve ter no máximo 120 caracteres'),
  body('codigo').optional({ nullable: true }).trim().isLength({ max: 30 }).withMessage('Código muito longo'),
  body('empresa').optional({ nullable: true }).trim().isLength({ max: 120 }).withMessage('Empresa muito longa'),
  body('descricao').optional({ nullable: true }).trim().isLength({ max: 260 }).withMessage('Descrição muito longa'),
  body('embarque').optional({ nullable: true }).trim().isLength({ max: 180 }).withMessage('Local de embarque muito longo'),
  body('telefone').optional({ nullable: true }).trim().isLength({ max: 40 }).withMessage('Telefone muito longo'),
  body('site')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('Site deve ser uma URL completa'),
  body('tarifa').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Tarifa inválida').toFloat(),
  body('duracao_min').optional({ nullable: true }).isInt({ min: 0, max: 1440 }).withMessage('Duração inválida').toInt(),
  body('observacao').optional({ nullable: true }).trim().isLength({ max: 300 }).withMessage('Observação muito longa'),
  body('cor').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Cor inválida'),
  body('ativo').optional().isBoolean().withMessage('Ativo deve ser booleano').toBoolean(),
  body('ordem').optional().isInt({ min: 0 }).withMessage('Ordem deve ser um inteiro não-negativo').toInt(),
  body('horarios')
    .optional()
    .isArray({ max: 250 }).withMessage('Horários deve ser uma lista')
    .custom(horarios => {
      const ocupados = new Set()
      for (const h of horarios || []) {
        if (!h || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(h.hora || ''))) {
          throw new Error('Existe um horário inválido')
        }
        if (!Array.isArray(h.dias) || h.dias.length === 0 || h.dias.some(d => !DIAS_ONIBUS.includes(d))) {
          throw new Error(`Selecione dias válidos para ${h.hora}`)
        }
        for (const dia of new Set(h.dias)) {
          const chave = `${dia}:${h.hora}`
          if (ocupados.has(chave)) throw new Error(`Horário duplicado: ${h.hora} em ${dia}`)
          ocupados.add(chave)
        }
        if (String(h.observacao || '').length > 180) throw new Error('Observação de horário muito longa')
      }
      return true
    }),
]

// ─── Configurações ───────────────────────────────────────────────────────────
export const regraConfiguracao = [
  body('valor')
    .exists().withMessage('Valor obrigatório')
    .isString().withMessage('Valor deve ser string'),
]

export const regraConfiguracaoLote = [
  body('pares')
    .isArray({ min: 1 }).withMessage('pares deve ser um array não-vazio'),
  body('pares.*.chave')
    .trim()
    .notEmpty().withMessage('Cada par deve ter uma chave'),
  body('pares.*.valor')
    .isString().withMessage('Cada par deve ter um valor string'),
]
