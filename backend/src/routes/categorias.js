import { Router } from 'express'
import Categoria from '../models/Categoria.js'
import Noticia from '../models/Noticia.js'
import RssFonte from '../models/RssFonte.js'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { regraCategoria, validar } from '../middleware/validacoes.js'
import { cacheGet, cacheSet, cacheDel } from '../utils/cache.js'

const CACHE_KEY = 'categorias_lista'
const CACHE_TTL = 120

const router = Router()

// GET /api/categorias
router.get('/', async (_req, res, next) => {
  try {
    const cached = await cacheGet(CACHE_KEY)
    if (cached) return res.json(cached)
    const categorias = await Categoria.find().sort({ nome: 1 }).lean()
    await cacheSet(CACHE_KEY, categorias, CACHE_TTL)
    res.json(categorias)
  } catch (err) { next(err) }
})

// POST /api/categorias — autenticado
router.post('/', autenticar, verificarPermissao('categorias.gerenciar'), regraCategoria, validar, async (req, res, next) => {
  try {
    const { nome, slug, cor, descricao } = req.body
    const categoria = await Categoria.create({ nome, slug, cor: cor || '#1B5E3B', descricao: descricao || '' })
    await cacheDel(CACHE_KEY)
    res.status(201).json(categoria)
  } catch (err) { next(err) }
})

// PUT /api/categorias/:id — autenticado
router.put('/:id', autenticar, verificarPermissao('categorias.gerenciar'), regraCategoria, validar, async (req, res, next) => {
  try {
    const { nome, slug, cor, descricao } = req.body
    const categoria = await Categoria.findByIdAndUpdate(
      req.params.id,
      { nome, slug, cor: cor || '#1B5E3B', descricao: descricao ?? '' },
      { new: true, runValidators: true }
    )
    if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada' })
    await cacheDel(CACHE_KEY)
    res.json(categoria)
  } catch (err) { next(err) }
})

// DELETE /api/categorias/:id — autenticado
router.delete('/:id', autenticar, verificarPermissao('categorias.gerenciar'), async (req, res, next) => {
  try {
    const [noticias, feeds] = await Promise.all([
      Noticia.countDocuments({ categoria_id: req.params.id }),
      RssFonte.countDocuments({ categoria_id: req.params.id }),
    ])
    if (noticias || feeds) {
      return res.status(409).json({
        erro: `Categoria em uso por ${noticias} notícia(s) e ${feeds} fonte(s) RSS. Reclassifique o conteúdo antes de excluir.`,
        uso: { noticias, feeds },
      })
    }
    const categoria = await Categoria.findByIdAndDelete(req.params.id)
    if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada' })
    await cacheDel(CACHE_KEY)
    res.json({ mensagem: 'Categoria excluída' })
  } catch (err) { next(err) }
})

export default router
