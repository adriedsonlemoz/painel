import { Router } from 'express'
import mongoose from 'mongoose'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import Noticia from '../models/Noticia.js'
import NoticiaRevisao from '../models/NoticiaRevisao.js'
import Categoria from '../models/Categoria.js'
import Fonte from '../models/Fonte.js'
import RssFonte from '../models/RssFonte.js'
import Assinante from '../models/Assinante.js'
import { Evento } from '../models/Evento.js'
import ModuloHome from '../models/ModuloHome.js'
import SeoRedirect from '../models/SeoRedirect.js'
import NewsletterCampanha from '../models/NewsletterCampanha.js'
import BuscaTermo from '../models/BuscaTermo.js'
import MidiaAsset from '../models/MidiaAsset.js'
import { listR2MediaObjects, deleteR2ByPublicId } from '../services/r2MediaStorage.js'
import ConfiguracaoHome from '../models/ConfiguracaoHome.js'

const router=Router()
router.use(autenticar)
const edit=verificarPermissao('noticias.editar')
const escapeRx=s=>String(s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
const snap=n=>({titulo:n.titulo,resumo:n.resumo,conteudo:n.conteudo,categoria_id:n.categoria_id,fonte_id:n.fonte_id,tags:n.tags,status:n.status,destaque:n.destaque,urgente:n.urgente,seo_titulo:n.seo_titulo,seo_descricao:n.seo_descricao,canonical_url:n.canonical_url,imagem_url:n.imagem_url,imagem_public_id:n.imagem_public_id,imagem_alt:n.imagem_alt,imagem_legenda:n.imagem_legenda,imagem_credito:n.imagem_credito,slug:n.slug})

router.get('/dashboard', async (_req,res,next)=>{try{
 const now=new Date(), start=new Date(now); start.setHours(0,0,0,0); const end=new Date(start);end.setDate(end.getDate()+1)
 const [status,pubHoje,rssPend,eventos,assinantes,qualidade]=await Promise.all([
  Noticia.aggregate([{$group:{_id:'$status',total:{$sum:1}}}]),
  Noticia.countDocuments({status:'publicado',publicado_em:{$gte:start,$lt:end}}),
  Noticia.countDocuments({importado:true,status:{$in:['rascunho','revisao']}}),
  Evento.countDocuments({ativo:true,data:{$gte:now}}), Assinante.countDocuments({ativo:true}),
  Promise.all([Noticia.countDocuments({imagem_url:{$in:[null,'']}}),Noticia.countDocuments({fonte_id:null}),Noticia.countDocuments({$or:[{imagem_alt:''},{imagem_alt:null}],imagem_url:{$nin:[null,'']}}),RssFonte.countDocuments({ultimo_erro:{$nin:[null,'']}})])
 ])
 const counts={rascunho:0,revisao:0,agendado:0,publicado:0,arquivado:0};status.forEach(x=>{if(x._id)counts[x._id]=x.total})
 res.json({status:counts,publicadas_hoje:pubHoje,rss_aguardando_revisao:rssPend,proximos_eventos:eventos,assinantes_ativos:assinantes,atencao:{sem_imagem:qualidade[0],sem_fonte:qualidade[1],sem_alt:qualidade[2],rss_com_erro:qualidade[3]}})
}catch(e){next(e)}})

router.get('/qualidade',async(_req,res,next)=>{try{
 const now=new Date()
 const mojibake=/[�]|(?:Ã.|Â.|â€|ðŸ)/
 const [semImagem,semFonte,semAlt,plantao,seo,rss,candidatasRss,candidatasTexto,duplicadas]=await Promise.all([
  Noticia.find({imagem_url:{$in:[null,'']},status:{$ne:'arquivado'}}).select('titulo slug status').limit(50).lean(),
  Noticia.find({fonte_id:null,status:{$ne:'arquivado'}}).select('titulo slug status').limit(50).lean(),
  Noticia.find({imagem_url:{$nin:[null,'']},$or:[{imagem_alt:''},{imagem_alt:null}]}).select('titulo slug status imagem_url').limit(50).lean(),
  Noticia.find({urgente:true,urgente_ate:{$lt:now}}).select('titulo slug urgente_ate').limit(50).lean(),
  Noticia.find({$or:[{seo_titulo:null},{seo_titulo:''},{seo_descricao:null},{seo_descricao:''}],status:'publicado'}).select('titulo slug').limit(50).lean(),
  RssFonte.find({ultimo_erro:{$nin:[null,'']}}).select('nome ultimo_erro falhas_consecutivas url').limit(50).lean(),
  Noticia.find({importado:true}).select('titulo slug url_original imagem_url').sort({criado_em:-1}).limit(250).lean(),
  Noticia.find({status:{$ne:'arquivado'}}).select('titulo slug resumo conteudo').sort({atualizado_em:-1}).limit(500).lean(),
  Noticia.aggregate([
    {$match:{status:{$ne:'arquivado'},titulo:{$type:'string'}}},
    {$group:{_id:{$toLower:'$titulo'},total:{$sum:1},itens:{$push:{_id:'$_id',titulo:'$titulo',slug:'$slug'}}}},
    {$match:{total:{$gt:1}}},{$limit:25}
  ]),
 ])
 const rssSemOrigem=candidatasRss.filter(n=>!String(n.url_original||'').trim()).slice(0,50)
 const rssUrlInvalida=candidatasRss.filter(n=>{try{const u=new URL(String(n.url_original||''));return !['http:','https:'].includes(u.protocol)}catch{return Boolean(n.url_original)}}).slice(0,50)
 const textoCorrompido=candidatasTexto.filter(n=>mojibake.test(`${n.titulo||''} ${n.resumo||''} ${n.conteudo||''}`)).map(n=>({_id:n._id,titulo:n.titulo,slug:n.slug})).slice(0,50)
 const imagemUrlInvalida=[...semAlt,...candidatasRss].filter(n=>n.imagem_url&&(()=>{try{const u=new URL(String(n.imagem_url));return !['http:','https:'].includes(u.protocol)&&!String(n.imagem_url).startsWith('/api/')}catch{return !String(n.imagem_url).startsWith('/api/')}})()).map(n=>({_id:n._id,titulo:n.titulo,slug:n.slug,imagem_url:n.imagem_url})).slice(0,50)
 const dupItems=duplicadas.flatMap(g=>g.itens.slice(0,5)).slice(0,50)
 res.json({grupos:[
  {id:'sem_imagem',titulo:'Sem imagem de capa',total:semImagem.length,itens:semImagem},
  {id:'sem_fonte',titulo:'Sem fonte editorial',total:semFonte.length,itens:semFonte},
  {id:'sem_alt',titulo:'Imagem sem texto alternativo',total:semAlt.length,itens:semAlt},
  {id:'imagem_url_invalida',titulo:'Imagem com URL inválida',total:imagemUrlInvalida.length,itens:imagemUrlInvalida},
  {id:'plantao_vencido',titulo:'Plantão vencido',total:plantao.length,itens:plantao},
  {id:'seo_incompleto',titulo:'SEO incompleto',total:seo.length,itens:seo},
  {id:'rss_erro',titulo:'Feeds RSS com erro',total:rss.length,itens:rss},
  {id:'rss_sem_origem',titulo:'RSS sem URL de origem',total:rssSemOrigem.length,itens:rssSemOrigem},
  {id:'rss_origem_invalida',titulo:'RSS com URL de origem inválida',total:rssUrlInvalida.length,itens:rssUrlInvalida},
  {id:'texto_corrompido',titulo:'Possível problema de codificação',total:textoCorrompido.length,itens:textoCorrompido},
  {id:'duplicatas',titulo:'Possíveis notícias duplicadas',total:dupItems.length,itens:dupItems},
 ]})
}catch(e){next(e)}})

router.get('/metricas',async(req,res,next)=>{try{
 const days=Math.min(365,Math.max(1,Number(req.query.dias)||30)); const since=new Date(Date.now()-days*86400000)
 const [maisLidas,categorias,fontes,feeds,origem,zeradas,newsletter,buscas]=await Promise.all([
  Noticia.find({status:'publicado',publicado_em:{$gte:since}}).select('titulo slug views categoria_id fonte_id rss_fonte_id importado publicado_em').sort({views:-1}).limit(15).populate('categoria_id','nome').populate('fonte_id','nome').lean(),
  Noticia.aggregate([{$match:{status:'publicado',publicado_em:{$gte:since}}},{$group:{_id:'$categoria_id',noticias:{$sum:1},views:{$sum:'$views'}}},{$sort:{views:-1}},{$limit:20}]),
  Noticia.aggregate([{$match:{status:'publicado',publicado_em:{$gte:since}}},{$group:{_id:'$fonte_id',noticias:{$sum:1},views:{$sum:'$views'}}},{$sort:{views:-1}},{$limit:20}]),
  Noticia.aggregate([{$match:{status:'publicado',publicado_em:{$gte:since},rss_fonte_id:{$ne:null}}},{$group:{_id:'$rss_fonte_id',noticias:{$sum:1},views:{$sum:'$views'}}},{$sort:{views:-1}},{$limit:20}]),
  Noticia.aggregate([{$match:{publicado_em:{$gte:since}}},{$group:{_id:'$importado',total:{$sum:1},views:{$sum:'$views'}}}]),
  Noticia.find({status:'publicado',views:0,publicado_em:{$gte:since}}).select('titulo slug publicado_em').sort({publicado_em:-1}).limit(25).lean(),
  NewsletterCampanha.aggregate([{$match:{criado_em:{$gte:since}}},{$group:{_id:null,campanhas:{$sum:1},destinatarios:{$sum:'$total_destinatarios'},enviados:{$sum:'$total_enviados'},falhas:{$sum:'$total_falhas'}}}]),
  BuscaTermo.find({ultima_busca_em:{$gte:since}}).sort({total:-1}).limit(20).lean(),
 ])
 const catIds=categorias.map(x=>x._id).filter(Boolean), fonteIds=fontes.map(x=>x._id).filter(Boolean), feedIds=feeds.map(x=>x._id).filter(Boolean)
 const [catDocs,fonteDocs,feedDocs]=await Promise.all([Categoria.find({_id:{$in:catIds}}).select('nome').lean(),Fonte.find({_id:{$in:fonteIds}}).select('nome').lean(),RssFonte.find({_id:{$in:feedIds}}).select('nome').lean()])
 const cm=new Map(catDocs.map(x=>[String(x._id),x.nome])), fm=new Map(fonteDocs.map(x=>[String(x._id),x.nome])), rm=new Map(feedDocs.map(x=>[String(x._id),x.nome]))
 res.json({dias,mais_lidas:maisLidas,categorias:categorias.map(x=>({...x,nome:cm.get(String(x._id))||'Sem categoria'})),fontes:fontes.map(x=>({...x,nome:fm.get(String(x._id))||'Sem fonte'})),feeds:feeds.map(x=>({...x,nome:rm.get(String(x._id))||'Feed removido'})),origem:{rss:origem.find(x=>x._id===true)||{total:0,views:0},manual:origem.find(x=>x._id===false)||{total:0,views:0}},sem_views:zeradas,newsletter:newsletter[0]||{campanhas:0,destinatarios:0,enviados:0,falhas:0},buscas:buscas.map(b=>({termo:b.termo,total:b.total,ultima_busca_em:b.ultima_busca_em}))})
}catch(e){next(e)}})

router.get('/midia',async(_req,res,next)=>{try{
 const [news,cats,sources,events,library]=await Promise.all([
  Noticia.find({imagem_url:{$nin:[null,'']}}).select('titulo slug imagem_url imagem_public_id imagem_alt imagem_credito imagem_tamanho imagem_largura imagem_altura imagem_mime imagem_storage atualizado_em').sort({atualizado_em:-1}).limit(500).lean(),
  Categoria.find({imagem_url:{$nin:[null,'']}}).select('nome imagem_url imagem_public_id imagem_alt atualizado_em').lean(),
  Fonte.find({logo_url:{$nin:[null,'']}}).select('nome logo_url logo_public_id logo_alt atualizado_em').lean(),
  Evento.find({imagem_url:{$nin:[null,'']}}).select('titulo imagem_url imagem_public_id imagem_alt atualizado_em').lean(),
  MidiaAsset.find().sort({atualizado_em:-1}).limit(500).lean(),
 ])
 const assets=[]
 const usage=new Map()
 function push(a){const key=a.public_id||a.url; if(key){const existing=usage.get(key); if(existing){existing.usos=(existing.usos||1)+1;existing.usado_em_lista=[...(existing.usado_em_lista||[existing.usado_em]),a.usado_em].filter(Boolean);return} usage.set(key,a)} assets.push(a)}
 library.forEach(n=>push({id:`midia:${n._id}`,tipo:'midia',titulo:n.titulo||n.original_name||'Mídia',url:n.url,public_id:n.public_id,alt:n.alt,credito:n.credito,size:n.size,width:n.width,height:n.height,mime:n.mime,storage:n.storage,usos:0,atualizado_em:n.atualizado_em,biblioteca:true}))
 news.forEach(n=>push({id:`noticia:${n._id}`,tipo:'noticia',titulo:n.titulo,url:n.imagem_url,public_id:n.imagem_public_id,alt:n.imagem_alt,credito:n.imagem_credito,size:n.imagem_tamanho,width:n.imagem_largura,height:n.imagem_altura,mime:n.imagem_mime,storage:n.imagem_storage,usado_em:`/admin/editar/${n._id}`,usos:1,atualizado_em:n.atualizado_em}))
 cats.forEach(n=>push({id:`categoria:${n._id}`,tipo:'categoria',titulo:n.nome,url:n.imagem_url,public_id:n.imagem_public_id,alt:n.imagem_alt,usado_em:'/admin/categorias',usos:1,atualizado_em:n.atualizado_em}))
 sources.forEach(n=>push({id:`fonte:${n._id}`,tipo:'fonte',titulo:n.nome,url:n.logo_url,public_id:n.logo_public_id,alt:n.logo_alt,usado_em:'/admin/fontes',usos:1,atualizado_em:n.atualizado_em}))
 events.forEach(n=>push({id:`evento:${n._id}`,tipo:'evento',titulo:n.titulo,url:n.imagem_url,public_id:n.imagem_public_id,alt:n.imagem_alt,usado_em:'/admin/eventos',usos:1,atualizado_em:n.atualizado_em}))
 res.json({assets:assets.sort((a,b)=>new Date(b.atualizado_em||0)-new Date(a.atualizado_em||0)),total:assets.length})
}catch(e){next(e)}})

router.post('/midia',verificarPermissao('noticias.editar'),async(req,res,next)=>{try{
 const b=req.body||{}; if(!b.url)return res.status(422).json({erro:'URL da mídia é obrigatória'})
 const doc=await MidiaAsset.findOneAndUpdate(
  b.public_id?{public_id:b.public_id}:{url:b.url},
  {$set:{titulo:String(b.titulo||b.original_name||'Mídia').trim(),tipo:'midia',url:b.url,public_id:b.public_id||null,alt:String(b.alt||''),credito:String(b.credito||''),mime:String(b.mime||''),size:Number(b.size)||null,width:Number(b.width)||null,height:Number(b.height)||null,storage:b.storage||'r2',original_name:String(b.original_name||'')}},
  {new:true,upsert:true,setDefaultsOnInsert:true}
 );res.status(201).json(doc)
}catch(e){next(e)}})

router.get('/midia/orfaos',verificarPermissao('noticias.editar'),async(_req,res,next)=>{try{
 const [objs,news,cats,sources,events,library,configs]=await Promise.all([
  listR2MediaObjects({limit:2000}),
  Noticia.distinct('imagem_public_id',{imagem_public_id:{$nin:[null,'']}}),Categoria.distinct('imagem_public_id',{imagem_public_id:{$nin:[null,'']}}),Fonte.distinct('logo_public_id',{logo_public_id:{$nin:[null,'']}}),Evento.distinct('imagem_public_id',{imagem_public_id:{$nin:[null,'']}}),MidiaAsset.distinct('public_id',{public_id:{$nin:[null,'']}}),ConfiguracaoHome.find({chave:/public_id$/i}).select('valor').lean(),
 ])
 const refs=new Set([...news,...cats,...sources,...events,...library,...configs.map(x=>x.valor)].filter(Boolean).map(String))
 const orfaos=objs.filter(o=>!refs.has(String(o.public_id)))
 res.json({orfaos,total:orfaos.length,total_bytes:orfaos.reduce((a,x)=>a+(x.size||0),0)})
}catch(e){next(e)}})

router.delete('/midia/orfaos',verificarPermissao('noticias.editar'),async(req,res,next)=>{try{
 const ids=Array.isArray(req.body?.public_ids)?req.body.public_ids.slice(0,100):[];let removidos=0
 for(const id of ids){try{await deleteR2ByPublicId(id);removidos++}catch{}}
 res.json({ok:true,removidos})
}catch(e){next(e)}})

router.patch('/noticias/:id/autosave',edit,async(req,res,next)=>{try{
 const n=await Noticia.findById(req.params.id);if(!n)return res.status(404).json({erro:'Notícia não encontrada'})
 const allowed=['titulo','resumo','conteudo','categoria_id','fonte_id','tags','seo_titulo','seo_descricao','canonical_url','og_imagem_url','seo_noindex','autor','responsavel_id','revisor_id','imagem_alt','imagem_legenda','imagem_credito']
 const update={autosave_em:new Date()};for(const k of allowed)if(Object.prototype.hasOwnProperty.call(req.body||{},k))update[k]=req.body[k]
 await NoticiaRevisao.create({noticia_id:n._id,usuario_id:req.usuario?._id||req.usuario?.id,usuario_nome:req.usuario?.nome||'',usuario_email:req.usuario?.email||'',motivo:'autosave',snapshot:snap(n)})
 const out=await Noticia.findByIdAndUpdate(n._id,{$set:update},{new:true,runValidators:true});res.json({ok:true,autosave_em:out.autosave_em})
}catch(e){next(e)}})
router.get('/noticias/:id/revisoes',edit,async(req,res,next)=>{try{res.json(await NoticiaRevisao.find({noticia_id:req.params.id}).sort({criado_em:-1}).limit(100).lean())}catch(e){next(e)}})
router.post('/noticias/:id/revisoes',edit,async(req,res,next)=>{try{
 const n=await Noticia.findById(req.params.id);if(!n)return res.status(404).json({erro:'Notícia não encontrada'})
 const doc=await NoticiaRevisao.create({noticia_id:n._id,usuario_id:req.usuario?._id||req.usuario?.id,usuario_nome:req.usuario?.nome||'',usuario_email:req.usuario?.email||'',motivo:req.body?.motivo||'autosave',snapshot:snap(n)})
 res.status(201).json(doc)
}catch(e){next(e)}})
router.post('/noticias/:id/restaurar/:revisaoId',edit,async(req,res,next)=>{try{
 const [n,r]=await Promise.all([Noticia.findById(req.params.id),NoticiaRevisao.findOne({_id:req.params.revisaoId,noticia_id:req.params.id})]);if(!n||!r)return res.status(404).json({erro:'Notícia ou revisão não encontrada'})
 await NoticiaRevisao.create({noticia_id:n._id,usuario_id:req.usuario?._id||req.usuario?.id,usuario_nome:req.usuario?.nome||'',usuario_email:req.usuario?.email||'',motivo:'restauracao',snapshot:snap(n)})
 const allowed=['titulo','resumo','conteudo','categoria_id','fonte_id','tags','status','destaque','urgente','seo_titulo','seo_descricao','canonical_url','imagem_url','imagem_public_id','imagem_alt','imagem_legenda','imagem_credito']
 const update={};allowed.forEach(k=>{if(Object.prototype.hasOwnProperty.call(r.snapshot||{},k))update[k]=r.snapshot[k]})
 const out=await Noticia.findByIdAndUpdate(n._id,{$set:update},{new:true,runValidators:true});res.json(out)
}catch(e){next(e)}})
router.post('/noticias/:id/comentarios',edit,async(req,res,next)=>{try{const texto=String(req.body?.texto||'').trim();if(!texto)return res.status(400).json({erro:'Comentário vazio'});const n=await Noticia.findByIdAndUpdate(req.params.id,{$push:{comentarios_internos:{usuario_id:req.usuario?._id||req.usuario?.id,nome:req.usuario?.nome||req.usuario?.email||'',texto}}},{new:true});if(!n)return res.status(404).json({erro:'Notícia não encontrada'});res.json(n.comentarios_internos)}catch(e){next(e)}})

router.get('/redirects',edit,async(_req,res,next)=>{try{res.json(await SeoRedirect.find().sort({criado_em:-1}).limit(500).lean())}catch(e){next(e)}})

router.post('/categorias/:id/mesclar',verificarPermissao('categorias.gerenciar'),async(req,res,next)=>{try{
 const destino=req.body?.destino_id;if(!mongoose.isValidObjectId(destino)||String(destino)===String(req.params.id))return res.status(400).json({erro:'Categoria de destino inválida'})
 const [src,dst]=await Promise.all([Categoria.findById(req.params.id),Categoria.findById(destino)]);if(!src||!dst)return res.status(404).json({erro:'Categoria não encontrada'});if(src.slug==='geral'||src.protegida)return res.status(409).json({erro:'A categoria Geral/protegida não pode ser mesclada'})
 const [noticias,feeds]=await Promise.all([Noticia.updateMany({categoria_id:src._id},{$set:{categoria_id:dst._id}}),RssFonte.updateMany({categoria_id:src._id},{$set:{categoria_id:dst._id}})]);await src.deleteOne();res.json({ok:true,noticias:noticias.modifiedCount,feeds:feeds.modifiedCount})
}catch(e){next(e)}})
router.post('/fontes/:id/mesclar',verificarPermissao('fontes.gerenciar'),async(req,res,next)=>{try{
 const destino=req.body?.destino_id;if(!mongoose.isValidObjectId(destino)||String(destino)===String(req.params.id))return res.status(400).json({erro:'Fonte de destino inválida'})
 const [src,dst]=await Promise.all([Fonte.findById(req.params.id),Fonte.findById(destino)]);if(!src||!dst)return res.status(404).json({erro:'Fonte não encontrada'})
 const [noticias,feeds]=await Promise.all([Noticia.updateMany({fonte_id:src._id},{$set:{fonte_id:dst._id}}),RssFonte.updateMany({fonte_id:src._id},{$set:{fonte_id:dst._id}})]);await src.deleteOne();res.json({ok:true,noticias:noticias.modifiedCount,feeds:feeds.modifiedCount})
}catch(e){next(e)}})

router.get('/home',verificarPermissao('modulos.gerenciar'),async(_req,res,next)=>{try{res.json(await ModuloHome.find().sort({ordem:1}).lean())}catch(e){next(e)}})
router.put('/home/ordem',verificarPermissao('modulos.gerenciar'),async(req,res,next)=>{try{const itens=Array.isArray(req.body?.itens)?req.body.itens:[];await Promise.all(itens.filter(x=>mongoose.isValidObjectId(x.id)).map((x,i)=>ModuloHome.findByIdAndUpdate(x.id,{$set:{ordem:Number.isFinite(Number(x.ordem))?Number(x.ordem):i,config:x.config||undefined}})));res.json({ok:true})}catch(e){next(e)}})

export default router
