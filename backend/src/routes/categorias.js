import { Router } from 'express'
import Categoria from '../models/Categoria.js'
import Noticia from '../models/Noticia.js'
import RssFonte from '../models/RssFonte.js'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { regraCategoria, validar } from '../middleware/validacoes.js'
import { cacheGet, cacheSet, cacheDel } from '../utils/cache.js'
import { schedulePublicSnapshotRefresh } from '../services/publicSnapshotService.js'

const CACHE_KEY = 'categorias_lista_v2'
const CACHE_TTL = 120

const router = Router()

// GET /api/categorias
router.get('/', async (_req, res, next) => {
  try {
    await Categoria.updateOne({ slug:'geral' }, { $set:{ protegida:true, ativa:true } }).catch(()=>{})
    const cached = await cacheGet(CACHE_KEY)
    if (cached) return res.json(cached)
    const categorias = await Categoria.find().populate('categoria_pai_id','nome slug').sort({ ordem:1,nome:1 }).lean()
    const [news,feeds]=await Promise.all([Noticia.aggregate([{$group:{_id:'$categoria_id',total:{$sum:1}}}]),RssFonte.aggregate([{$group:{_id:'$categoria_id',total:{$sum:1}}}])])
    const nm=new Map(news.map(x=>[String(x._id),x.total])), fm=new Map(feeds.map(x=>[String(x._id),x.total]))
    const out=categorias.map(c=>({...c,id:String(c._id),total_noticias:nm.get(String(c._id))||0,total_feeds_rss:fm.get(String(c._id))||0}))
    await cacheSet(CACHE_KEY, out, CACHE_TTL)
    res.json(out)
  } catch (err) { next(err) }
})

// POST /api/categorias — autenticado
router.post('/', autenticar, verificarPermissao('categorias.gerenciar'), regraCategoria, validar, async (req, res, next) => {
  try {
    const { nome, slug, cor, descricao, icone='', ordem=0, destaque=false, ativa=true, categoria_pai_id=null, imagem_url=null, imagem_public_id=null, imagem_alt='', seo_titulo=null, seo_descricao=null } = req.body
    const categoria = await Categoria.create({ nome, slug, cor:cor||'#1B5E3B', descricao:descricao||'', icone, ordem, destaque, ativa, categoria_pai_id:categoria_pai_id||null, imagem_url, imagem_public_id, imagem_alt, seo_titulo, seo_descricao, protegida:slug==='geral' })
    await cacheDel(CACHE_KEY)
    schedulePublicSnapshotRefresh('category-created')
    res.status(201).json(categoria)
  } catch (err) { next(err) }
})

// PUT /api/categorias/:id — autenticado
router.put('/:id', autenticar, verificarPermissao('categorias.gerenciar'), regraCategoria, validar, async (req, res, next) => {
  try {
    const { nome, slug, cor, descricao, icone='', ordem=0, destaque=false, ativa=true, categoria_pai_id=null, imagem_url=null, imagem_public_id=null, imagem_alt='', seo_titulo=null, seo_descricao=null } = req.body
    const atual=await Categoria.findById(req.params.id)
    if(!atual)return res.status(404).json({erro:'Categoria não encontrada'})
    if((atual.slug==='geral'||atual.protegida)&&slug!=='geral')return res.status(409).json({erro:'A categoria Geral é protegida e não pode ter seu slug alterado.'})
    const categoria = await Categoria.findByIdAndUpdate(
      req.params.id,
      { nome, slug, cor:cor||'#1B5E3B', descricao:descricao??'', icone, ordem, destaque, ativa, categoria_pai_id:categoria_pai_id||null, imagem_url, imagem_public_id, imagem_alt, seo_titulo, seo_descricao, protegida:atual.protegida||slug==='geral' },
      { new: true, runValidators: true }
    )
    if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada' })
    await cacheDel(CACHE_KEY)
    schedulePublicSnapshotRefresh('category-updated')
    res.json(categoria)
  } catch (err) { next(err) }
})

// DELETE /api/categorias/:id — autenticado
router.delete('/:id', autenticar, verificarPermissao('categorias.gerenciar'), async (req, res, next) => {
  try {
    const atual=await Categoria.findById(req.params.id)
    if(!atual)return res.status(404).json({erro:'Categoria não encontrada'})
    if(atual.slug==='geral'||atual.protegida)return res.status(409).json({erro:'A categoria Geral é protegida. Use Mesclar/Mover em vez de excluir.'})
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
    schedulePublicSnapshotRefresh('category-deleted')
    res.json({ mensagem: 'Categoria excluída' })
  } catch (err) { next(err) }
})

export default router
