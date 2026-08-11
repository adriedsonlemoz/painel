import { Router } from 'express'
import Fonte from '../models/Fonte.js'
import Noticia from '../models/Noticia.js'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { regraFonte, validar } from '../middleware/validacoes.js'

const router = Router()

// GET /api/fontes
router.get('/', async (_req, res, next) => {
  try {
    const fontes = await Fonte.find().sort({ nome: 1 })
    res.json(fontes)
  } catch (err) { next(err) }
})

// POST /api/fontes — autenticado
router.post('/', autenticar, verificarPermissao('fontes.gerenciar'), regraFonte, validar, async (req, res, next) => {
  try {
    const { nome, url } = req.body
    const fonte = await Fonte.create({ nome, url: url || null })
    res.status(201).json(fonte)
  } catch (err) { next(err) }
})

// PUT /api/fontes/:id — autenticado
router.put('/:id', autenticar, verificarPermissao('fontes.gerenciar'), regraFonte, validar, async (req, res, next) => {
  try {
    const { nome, url } = req.body
    const fonte = await Fonte.findByIdAndUpdate(
      req.params.id,
      { nome, url: url || null },
      { new: true, runValidators: true }
    )
    if (!fonte) return res.status(404).json({ erro: 'Fonte não encontrada' })
    res.json(fonte)
  } catch (err) { next(err) }
})

// DELETE /api/fontes/:id — autenticado
router.delete('/:id', autenticar, verificarPermissao('fontes.gerenciar'), async (req, res, next) => {
  try {
    const noticias = await Noticia.countDocuments({ fonte_id: req.params.id })
    if (noticias) {
      return res.status(409).json({
        erro: `Fonte em uso por ${noticias} notícia(s). Troque a fonte dessas notícias antes de excluir.`,
        uso: { noticias },
      })
    }
    const fonte = await Fonte.findByIdAndDelete(req.params.id)
    if (!fonte) return res.status(404).json({ erro: 'Fonte não encontrada' })
    res.json({ mensagem: 'Fonte excluída' })
  } catch (err) { next(err) }
})

export default router
