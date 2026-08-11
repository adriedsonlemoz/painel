import { Router } from 'express'
import Fonte from '../models/Fonte.js'
import Noticia from '../models/Noticia.js'
import RssFonte from '../models/RssFonte.js'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { regraFonte, validar } from '../middleware/validacoes.js'

const router = Router()

// GET /api/fontes
router.get('/', async (_req, res, next) => {
  try {
    const fontes=await Fonte.find().sort({ativo:-1,nome:1}).lean()
    const [news,feeds]=await Promise.all([Noticia.aggregate([{$group:{_id:'$fonte_id',total:{$sum:1}}}]),RssFonte.aggregate([{$group:{_id:'$fonte_id',total:{$sum:1}}}])])
    const nm=new Map(news.map(x=>[String(x._id),x.total])),fm=new Map(feeds.map(x=>[String(x._id),x.total]))
    res.json(fontes.map(f=>({...f,id:String(f._id),total_noticias:nm.get(String(f._id))||0,total_feeds_rss:fm.get(String(f._id))||0})))
  } catch (err) { next(err) }
})

// POST /api/fontes — autenticado
router.post('/', autenticar, verificarPermissao('fontes.gerenciar'), regraFonte, validar, async (req, res, next) => {
  try {
    const { nome,url,dominio=null,nome_curto='',descricao='',credito_padrao='',ativo=true,logo_url=null,logo_public_id=null,logo_alt='' }=req.body
    let host=dominio;try{if(!host&&url)host=new URL(url).hostname.replace(/^www\./,'')}catch{}
    const fonte=await Fonte.create({nome,url:url||null,dominio:host||null,nome_curto,descricao,credito_padrao,ativo,logo_url,logo_public_id,logo_alt})
    res.status(201).json(fonte)
  } catch (err) { next(err) }
})

// PUT /api/fontes/:id — autenticado
router.put('/:id', autenticar, verificarPermissao('fontes.gerenciar'), regraFonte, validar, async (req, res, next) => {
  try {
    const {nome,url,dominio=null,nome_curto='',descricao='',credito_padrao='',ativo=true,logo_url=null,logo_public_id=null,logo_alt=''}=req.body
    let host=dominio;try{if(!host&&url)host=new URL(url).hostname.replace(/^www\./,'')}catch{}
    const fonte=await Fonte.findByIdAndUpdate(
      req.params.id,
      {nome,url:url||null,dominio:host||null,nome_curto,descricao,credito_padrao,ativo,logo_url,logo_public_id,logo_alt},
      { new: true, runValidators: true }
    )
    if (!fonte) return res.status(404).json({ erro: 'Fonte não encontrada' })
    res.json(fonte)
  } catch (err) { next(err) }
})

// DELETE /api/fontes/:id — autenticado
router.delete('/:id', autenticar, verificarPermissao('fontes.gerenciar'), async (req, res, next) => {
  try {
    const [noticias, feeds] = await Promise.all([
      Noticia.countDocuments({ fonte_id: req.params.id }),
      RssFonte.countDocuments({ fonte_id: req.params.id }),
    ])
    if (noticias || feeds) {
      return res.status(409).json({
        erro: `Fonte em uso por ${noticias} notícia(s) e ${feeds} feed(s) RSS. Reassocie o conteúdo antes de excluir.`,
        uso: { noticias, feeds },
      })
    }
    const fonte = await Fonte.findByIdAndDelete(req.params.id)
    if (!fonte) return res.status(404).json({ erro: 'Fonte não encontrada' })
    res.json({ mensagem: 'Fonte excluída' })
  } catch (err) { next(err) }
})

export default router
