/**
 * noticiasController.js
 *
 * Handlers HTTP para o recurso Notícias.
 * Cada função recebe (req, res, next) e delega a lógica ao noticiaService.
 *
 * Rotas atendidas:
 *  GET    /api/noticias                       → listar
 *  GET    /api/noticias/contagem-status       → contagemStatus
 *  GET    /api/noticias/:id                   → buscarUm
 *  POST   /api/noticias                       → criar
 *  PUT    /api/noticias/:id                   → atualizar
 *  PATCH  /api/noticias/:id/status            → mudarStatus
 *  DELETE /api/noticias/:id                   → excluir
 *  POST   /api/noticias/:id/galeria           → adicionarGaleria
 *  DELETE /api/noticias/:id/galeria/:publicId → removerGaleria
 */

import Noticia           from '../models/Noticia.js'
import Categoria         from '../models/Categoria.js'
import Fonte             from '../models/Fonte.js'
import mongoose          from 'mongoose'
import { cloudinary }    from '../config/index.js'
import { gridfsMediaBucket } from '../middleware/upload.js'
import { deleteR2ByPublicId } from '../services/r2MediaStorage.js'
import { viewJaContabilizada } from '../utils/cache.js'
import {
  popular,
  popularUm,
  buildFiltro,
  buildSort,
  extrairCampos,
  validarTransicao,
} from '../services/noticiaService.js'

// ─── GET /api/noticias ────────────────────────────────────────────────────────
export async function listar(req, res, next) {
  try {
    // Publicações agendadas são promovidas em background pelo servidor.
    // A listagem pública não executa mais uma escrita no Mongo antes de responder.
    const { q, page, limit, cursor, ordem } = req.query
    const lim = Math.min(500, parseInt(limit) || 9)

    // #20 — Visibilidade depende de autenticação
    const autenticado = !!(req.usuario || req.user || req.session?.usuario)
    const filtro  = await buildFiltro(req.query, autenticado)
    const sortOpt = buildSort(ordem, q)

    // Paginação por cursor (infinite scroll)
    if (cursor) {
      const cf = { ...filtro }
      if (!cf.criado_em) cf.criado_em = {}
      cf.criado_em.$lt = new Date(cursor)
      const noticias = await popular(Noticia.find(cf).limit(lim), sortOpt)
      const nextCursor = noticias.length === lim
        ? noticias[noticias.length - 1].criado_em?.toISOString()
        : null
      return res.json({ noticias, nextCursor })
    }

    // Paginação por offset (painel admin)
    const pag   = Math.max(1, parseInt(page) || 1)
    const skip  = (pag - 1) * lim
    const total = await Noticia.countDocuments(filtro)
    const noticias = await popular(Noticia.find(filtro).skip(skip).limit(lim), sortOpt)
    res.json({ noticias, total, pagina: pag, paginas: Math.ceil(total / lim) })
  } catch (err) { next(err) }
}

// ─── GET /api/noticias/sugestoes ─────────────────────────────────────────────
export async function sugestoes(req, res, next) {
  try {
    const q = String(req.query.q || '').trim()
    if (q.length < 2) return res.json([])
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const docs = await Noticia.find({
      status: 'publicado',
      $or: [{ titulo: rx }, { resumo: rx }, { tags: rx }],
    })
      .select('titulo slug categoria_id publicado_em')
      .populate('categoria_id', 'nome slug cor')
      .sort({ publicado_em: -1, criado_em: -1 })
      .limit(6)
      .lean()
    res.json(docs)
  } catch (err) { next(err) }
}

// ─── GET /api/noticias/contagem-status ────────────────────────────────────────
// #20 — Retorna contagem por status para o painel (somente autenticado).
export async function contagemStatus(req, res, next) {
  try {
    const contagem = await Noticia.aggregate([
      { $group: { _id: '$status', total: { $sum: 1 } } },
    ])
    const resultado = { rascunho: 0, revisao: 0, agendado: 0, publicado: 0, arquivado: 0 }
    contagem.forEach(({ _id, total }) => { if (_id) resultado[_id] = total })
    res.json(resultado)
  } catch (err) { next(err) }
}

// ─── GET /api/noticias/:id ───────────────────────────────────────────────────
// #5  — Incrementa views com deduplicação por IP.
// #20 — Visitantes só enxergam notícias publicadas.
export async function buscarUm(req, res, next) {
  try {
    const autenticado = !!(req.usuario || req.user || req.session?.usuario)
    const ident = req.params.id
    const isObjectId = /^[a-f\d]{24}$/i.test(ident)
    const query = isObjectId ? Noticia.findById(ident) : Noticia.findOne({ slug: ident })
    if (!autenticado) query.where('status').equals('publicado')

    const noticia = await popularUm(query)
    if (!noticia) return res.status(404).json({ erro: 'Notícia não encontrada' })

    // Só contabiliza view para notícias publicadas (#5)
    if (noticia.status === 'publicado') {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'desconhecido'
      const jaCont = await viewJaContabilizada(String(noticia._id), ip)
      if (!jaCont) {
        await Noticia.findByIdAndUpdate(noticia._id, { $inc: { views: 1 } })
        noticia.views = (noticia.views || 0) + 1
      }
    }

    res.json(noticia)
  } catch (err) { next(err) }
}

async function validarReferenciasConteudo(campos) {
  if (!campos.categoria_id || !(await Categoria.exists({ _id: campos.categoria_id }))) {
    return 'A categoria selecionada não existe mais. Atualize a lista e escolha outra.'
  }
  if (campos.fonte_id && !(await Fonte.exists({ _id: campos.fonte_id }))) {
    return 'A fonte selecionada não existe mais. Atualize a lista e escolha outra.'
  }
  return null
}

// ─── POST /api/noticias ──────────────────────────────────────────────────────
export async function criar(req, res, next) {
  try {
    const campos = extrairCampos(req.body)
    const referenciaInvalida = await validarReferenciasConteudo(campos)
    if (referenciaInvalida) return res.status(422).json({ erro: referenciaInvalida })
    const statusFinal  = campos.status || 'rascunho'
    if (statusFinal === 'agendado' && (!campos.agendado_para || campos.agendado_para <= new Date())) {
      return res.status(422).json({ erro: 'Defina uma data futura para agendar a publicação.' })
    }
    const publicado_em = statusFinal === 'publicado' ? new Date() : null

    const noticia = await Noticia.create({
      ...campos,
      status: statusFinal,
      publicado_em,
      // galeria já vem normalizada por extrairCampos, mas garantimos array
      galeria: Array.isArray(campos.galeria) ? campos.galeria : [],
    })

    const populada = await popularUm(Noticia.findById(noticia._id))
    res.status(201).json(populada)
  } catch (err) { next(err) }
}

// ─── PUT /api/noticias/:id ───────────────────────────────────────────────────
// #20 — Registra publicado_em na primeira publicação.
export async function atualizar(req, res, next) {
  try {
    const noticiaAtual = await Noticia.findById(req.params.id).select('status publicado_em agendado_para imagem_public_id')
    if (!noticiaAtual) return res.status(404).json({ erro: 'Notícia não encontrada' })

    const campos = extrairCampos(req.body)
    const referenciaInvalida = await validarReferenciasConteudo(campos)
    if (referenciaInvalida) return res.status(422).json({ erro: referenciaInvalida })
    const atualizacao = { ...campos }
    delete atualizacao.status // status gerenciado abaixo

    if (campos.status) {
      if (campos.status === 'agendado' && (!campos.agendado_para || campos.agendado_para <= new Date())) {
        return res.status(422).json({ erro: 'Defina uma data futura para agendar a publicação.' })
      }
      atualizacao.status = campos.status
      if (campos.status === 'publicado' && !noticiaAtual.publicado_em) atualizacao.publicado_em = new Date()
      if (campos.status !== 'agendado') atualizacao.agendado_para = null
    }

    const noticia = await Noticia.findByIdAndUpdate(
      req.params.id,
      atualizacao,
      { new: true, runValidators: true }
    )
    if (!noticia) return res.status(404).json({ erro: 'Notícia não encontrada' })

    const publicIdAnterior = noticiaAtual.imagem_public_id ? String(noticiaAtual.imagem_public_id) : ''
    const publicIdNovo = noticia.imagem_public_id ? String(noticia.imagem_public_id) : ''
    if (publicIdAnterior && publicIdAnterior !== publicIdNovo) {
      await removerMidiaPersistida(publicIdAnterior)
    }

    const populada = await popularUm(Noticia.findById(noticia._id))
    res.json(populada)
  } catch (err) { next(err) }
}

// ─── PATCH /api/noticias/:id/status ─────────────────────────────────────────
// #20 — Transição rápida de status sem re-enviar todo o corpo.
export async function mudarStatus(req, res, next) {
  try {
    const { status: novoStatus } = req.body
    const noticia = await Noticia.findById(req.params.id).select('status publicado_em agendado_para')
    if (!noticia) return res.status(404).json({ erro: 'Notícia não encontrada' })

    const { valido, permitidos } = validarTransicao(noticia.status, novoStatus)
    if (!valido) {
      return res.status(422).json({
        erro: `Transição inválida: ${noticia.status} → ${novoStatus}`,
        transicoes_validas: permitidos,
      })
    }

    const update = { status: novoStatus }
    if (novoStatus === 'agendado') {
      return res.status(422).json({ erro: 'Para agendar, abra a notícia e informe a data/hora da publicação.' })
    }
    if (novoStatus === 'publicado' && !noticia.publicado_em) update.publicado_em = new Date()
    if (novoStatus !== 'agendado') update.agendado_para = null

    const atualizada = await Noticia.findByIdAndUpdate(req.params.id, update, { new: true })
    res.json({
      id:           atualizada._id,
      status:       atualizada.status,
      publicado_em: atualizada.publicado_em,
    })
  } catch (err) { next(err) }
}

async function removerMidiaPersistida(publicId) {
  if(!publicId)return
  if(String(publicId).startsWith('r2:')) {
    await deleteR2ByPublicId(publicId).catch(()=>{})
    return
  }
  if(String(publicId).startsWith('gridfs:')) {
    const id=String(publicId).slice(7)
    if(mongoose.isValidObjectId(id)) await gridfsMediaBucket().delete(new mongoose.Types.ObjectId(id)).catch(()=>{})
    return
  }
  await cloudinary.uploader.destroy(publicId).catch(()=>{})
}

// ─── DELETE /api/noticias/:id ────────────────────────────────────────────────
// Remove mídia persistente (Cloudinary ou GridFS) antes de deletar o documento.
export async function excluir(req, res, next) {
  try {
    const noticia = await Noticia.findByIdAndDelete(req.params.id)
    if (!noticia) return res.status(404).json({ erro: 'Notícia não encontrada' })

    if (noticia.imagem_public_id) {
      await removerMidiaPersistida(noticia.imagem_public_id)
    }
    if (noticia.galeria?.length) {
      await Promise.all(
        noticia.galeria
          .filter(img => img.public_id)
          .map(img => removerMidiaPersistida(img.public_id))
      )
    }

    res.json({ mensagem: 'Notícia excluída' })
  } catch (err) { next(err) }
}

// ─── POST /api/noticias/:id/galeria ─────────────────────────────────────────
// #18 — Adiciona imagens à galeria de uma notícia existente.
export async function adicionarGaleria(req, res, next) {
  try {
    const { imagens } = req.body
    if (!Array.isArray(imagens) || imagens.length === 0) {
      return res.status(400).json({ erro: 'Envie um array `imagens`' })
    }
    const noticia = await Noticia.findByIdAndUpdate(
      req.params.id,
      { $push: { galeria: { $each: imagens } } },
      { new: true }
    )
    if (!noticia) return res.status(404).json({ erro: 'Notícia não encontrada' })
    res.json(noticia.galeria)
  } catch (err) { next(err) }
}

// ─── DELETE /api/noticias/:id/galeria/:publicId ──────────────────────────────
// #18 — Remove uma imagem da galeria pelo identificador do storage.
export async function removerGaleria(req, res, next) {
  try {
    const publicId = decodeURIComponent(req.params.publicId)
    await removerMidiaPersistida(publicId)
    const noticia = await Noticia.findByIdAndUpdate(
      req.params.id,
      { $pull: { galeria: { public_id: publicId } } },
      { new: true }
    )
    if (!noticia) return res.status(404).json({ erro: 'Notícia não encontrada' })
    res.json(noticia.galeria)
  } catch (err) { next(err) }
}
