/**
 * noticiaService.js
 *
 * Lógica de negócio pura relacionada a notícias.
 * Não tem conhecimento de req/res — pode ser testado isoladamente.
 *
 * Responsabilidades:
 *  - Construção de filtros e opções de ordenação (buildFiltro, buildSort)
 *  - Helpers de populate reutilizáveis (popular, popularUm)
 *  - Regras de transição de status editorial (TRANSICOES_VALIDAS, validarTransicao)
 */

import Noticia    from '../models/Noticia.js'
import Categoria  from '../models/Categoria.js'

// ─── Fluxo editorial ────────────────────────────────────────────────────────
// #20 — Transições de status permitidas.
// arquivado → publicado mantido para permitir reativação direta via toggle rápido.
export const TRANSICOES_VALIDAS = {
  rascunho:  ['revisao', 'agendado', 'publicado'],
  revisao:   ['rascunho', 'agendado', 'publicado', 'arquivado'],
  agendado:  ['rascunho', 'revisao', 'publicado', 'arquivado'],
  publicado: ['arquivado', 'rascunho', 'agendado'],
  arquivado: ['rascunho', 'agendado', 'publicado'],
}

/**
 * Valida se uma transição de status é permitida.
 * @param {string} statusAtual
 * @param {string} novoStatus
 * @returns {{ valido: boolean, permitidos: string[] }}
 */
export function validarTransicao(statusAtual, novoStatus) {
  const permitidos = TRANSICOES_VALIDAS[statusAtual] || []
  return {
    valido: permitidos.includes(novoStatus),
    permitidos,
  }
}

// ─── Helpers de populate ─────────────────────────────────────────────────────
/**
 * Aplica populate padrão em uma query de lista e define a ordenação.
 * @param {mongoose.Query} q
 * @param {object} sort
 */
export function popular(q, sort) {
  return q
    .populate('categoria_id', 'id nome slug cor')
    .populate('fonte_id',     'id nome url')
    .sort(sort || { criado_em: -1 })
}

/**
 * Aplica populate padrão em uma query de documento único.
 * @param {mongoose.Query} q
 */
export function popularUm(q) {
  return q
    .populate('categoria_id', 'id nome slug cor')
    .populate('fonte_id',     'id nome url')
}

// ─── Construção de filtros ───────────────────────────────────────────────────
/**
 * Monta o objeto de filtro MongoDB a partir dos query params da requisição.
 *
 * Regras de visibilidade (#20):
 *  - Não autenticado: força status = 'publicado'
 *  - Autenticado + status='todos': sem filtro de status
 *  - Autenticado + status=<valor>: filtra pelo valor passado
 *  - Autenticado sem status: retorna todos
 *
 * @param {object} query           — req.query
 * @param {boolean} autenticado
 * @returns {Promise<object>}      — filtro pronto para Noticia.find()
 */
export async function buildFiltro(query, autenticado) {
  const { categoria, q, dataInicio, dataFim, status, urgente } = query
  const filtro = {}

  // Visibilidade por status
  if (!autenticado) {
    filtro.status = 'publicado'
  } else if (status && status !== 'todos') {
    filtro.status = status
  }

  if (urgente === 'true' || urgente === true) {
    filtro.urgente = true
    filtro.$and = [...(filtro.$and || []), {
      $or: [
        { urgente_ate: null },
        { urgente_ate: { $exists: false } },
        { urgente_ate: { $gt: new Date() } },
      ],
    }]
  }

  // Filtro por categoria (aceita slug único ou lista separada por vírgula)
  if (categoria) {
    const slugs = categoria.split(',').map(s => s.trim()).filter(Boolean)
    if (slugs.length === 1) {
      const cat = await Categoria.findOne({ slug: slugs[0] })
      if (cat) filtro.categoria_id = cat._id
    } else if (slugs.length > 1) {
      const cats = await Categoria.find({ slug: { $in: slugs } }).select('_id')
      filtro.categoria_id = { $in: cats.map(c => c._id) }
    }
  }

  // Busca pública ampliada: título, resumo, conteúdo e tags.
  // Regex escapada mantém resultados parciais (útil em nomes locais) e evita injeção de padrão.
  if (q?.trim()) {
    const termo = q.trim().slice(0, 120)
    const escaped = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rx = new RegExp(escaped, 'i')
    filtro.$and = [...(filtro.$and || []), {
      $or: [
        { titulo: rx },
        { resumo: rx },
        { conteudo: rx },
        { tags: rx },
        { autor: rx },
      ],
    }]
  }

  // Intervalo de datas
  if (dataInicio || dataFim) {
    filtro.criado_em = {}
    if (dataInicio) filtro.criado_em.$gte = new Date(dataInicio)
    if (dataFim) {
      const fim = new Date(dataFim)
      fim.setHours(23, 59, 59, 999)
      filtro.criado_em.$lte = fim
    }
  }

  return filtro
}

/**
 * Retorna as opções de ordenação MongoDB a partir do parâmetro `ordem`.
 * @param {string} ordem  — 'recente' | 'antigo' | 'relevancia'
 * @param {string} q      — termo de busca (necessário para relevância)
 * @returns {object}
 */
export function buildSort(ordem, q) {
  if (ordem === 'antigo')                    return { criado_em: 1 }
  if (ordem === 'relevancia' && q?.trim())   return { publicado_em: -1, criado_em: -1 }
  return { criado_em: -1 }   // padrão: mais recente primeiro
}

// ─── Montagem de payload de criação/atualização ──────────────────────────────
/**
 * Extrai e normaliza os campos de uma notícia a partir do body da requisição.
 * @param {object} body — req.body
 * @returns {object}
 */
export function extrairCampos(body) {
  const {
    titulo, resumo, conteudo, autor, tags, seo_titulo, seo_descricao,
    imagem_url, imagem_public_id, imagem_legenda,
    categoria_id, fonte_id, destaque, urgente, urgente_ate,
    galeria, status, agendado_para,
  } = body

  return {
    titulo,
    conteudo,
    resumo:           resumo           || '',
    autor:            autor?.trim() || null,
    tags:             Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20) : [],
    seo_titulo:       seo_titulo?.trim() || null,
    seo_descricao:    seo_descricao?.trim() || null,
    imagem_url:       imagem_url       || null,
    imagem_public_id: imagem_public_id || null,
    imagem_legenda:   imagem_legenda   || '',
    destaque:         Boolean(destaque),
    urgente:          Boolean(urgente),
    urgente_ate:      urgente_ate ? new Date(urgente_ate) : null,
    agendado_para:    agendado_para ? new Date(agendado_para) : null,
    categoria_id:     categoria_id     || null,
    fonte_id:         fonte_id         || null,
    ...(Array.isArray(galeria) ? { galeria } : {}),
    status,
  }
}
