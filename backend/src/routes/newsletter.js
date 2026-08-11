import { Router } from 'express'
import Assinante from '../models/Assinante.js'
import NewsletterCampanha from '../models/NewsletterCampanha.js'
import Noticia from '../models/Noticia.js'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { getCredential } from '../utils/credentialStore.js'
import { logger } from '../utils/logger.js'

const router=Router()
const perm=[autenticar,verificarPermissao('newsletter.gerenciar')]
const clean=s=>String(s??'').trim()

async function resendConfig(){
 const c=await getCredential('resend','RESEND_API_KEY')
 return {key:c.value||'',from:clean(c.metadata?.from||process.env.NEWSLETTER_FROM),replyTo:clean(c.metadata?.replyTo||'')}
}
async function sendEmail({to,subject,html,text}){
 const c=await resendConfig();if(!c.key||!c.from){const e=new Error('Configure Resend e o remetente em Integrações e APIs.');e.status=503;throw e}
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},body:JSON.stringify({from:c.from,to:Array.isArray(to)?to:[to],subject,html,text,reply_to:c.replyTo||undefined})})
 const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.message||body.error||`Resend respondeu ${r.status}`);return body
}
function campaignHtml(c,noticias=[],assinante=null){
 const base=clean(process.env.FRONTEND_URL||process.env.PUBLIC_SITE_URL||'').replace(/\/$/,'')
 const cards=noticias.map(n=>`<article style="margin:0 0 22px"><h2 style="font-size:20px;margin:0 0 7px">${escapeHtml(n.titulo)}</h2><p style="line-height:1.55;color:#475569">${escapeHtml(n.resumo||'')}</p>${base?`<a href="${base}/noticia/${encodeURIComponent(n.slug||n._id)}">Ler notícia</a>`:''}</article>`).join('')
 const unsubscribe=assinante&&base?`<p style="font-size:12px;color:#94a3b8"><a href="${base}/api/newsletter/cancelar/${assinante.token_cancelamento}">Cancelar inscrição</a></p>`:''
 return c.html||`<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto"><h1>${escapeHtml(c.titulo)}</h1>${c.preheader?`<p>${escapeHtml(c.preheader)}</p>`:''}${cards}${unsubscribe}</div>`
}
function escapeHtml(v){return clean(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

async function processCampaign(campaignOrId){
 const c=typeof campaignOrId==='string'||campaignOrId?._bsontype?await NewsletterCampanha.findById(campaignOrId):campaignOrId
 if(!c||!['rascunho','agendada'].includes(c.status))return false
 c.status='enviando';c.ultimo_erro=null;await c.save()
 try{
  const [subs,news]=await Promise.all([Assinante.find({ativo:true,confirmado:{$ne:false}}),Noticia.find({_id:{$in:c.noticia_ids},status:'publicado'}).lean()])
  c.total_destinatarios=subs.length;let ok=0,fail=0
  for(const a of subs){try{await sendEmail({to:a.email,subject:c.assunto,html:campaignHtml(c,news,a),text:c.texto||c.preheader});ok++}catch(e){fail++;logger.warn({campanha:c._id,email:a.email,err:e.message},'Newsletter: falha ao enviar')}}
  c.total_enviados=ok;c.total_falhas=fail;c.status=fail&&!ok?'falhou':'enviada';c.enviada_em=new Date();c.agendada_para=null;await c.save();return true
 }catch(e){c.status='falhou';c.ultimo_erro=e.message;await c.save().catch(()=>{});throw e}
}

let schedulerBusy=false
async function processScheduledCampaigns(){
 if(schedulerBusy)return
 schedulerBusy=true
 try{
  const due=await NewsletterCampanha.find({status:'agendada',agendada_para:{$lte:new Date()}}).sort({agendada_para:1}).limit(5)
  for(const c of due){try{await processCampaign(c)}catch(e){logger.warn({campanha:c._id,err:e.message},'Newsletter: campanha agendada falhou')}}
 }catch(e){if(e?.name!=='MongooseError')logger.warn({err:e.message},'Newsletter: falha ao verificar campanhas agendadas')}
 finally{schedulerBusy=false}
}
const campaignTimer=setInterval(()=>void processScheduledCampaigns(),60_000);campaignTimer.unref?.()

router.post('/assinar',async(req,res,next)=>{try{
 const email=clean(req.body?.email).toLowerCase(),nome=clean(req.body?.nome);if(!email)return res.status(400).json({erro:'Email é obrigatório'})
 const provider=await resendConfig();const doubleOptIn=Boolean(provider.key&&provider.from)
 let a=await Assinante.findOne({email});if(a&&a.ativo&&a.confirmado)return res.status(409).json({erro:'Este email já está inscrito.'})
 if(!a)a=new Assinante({email,nome});else{a.nome=nome||a.nome;a.ativo=true}
 if(doubleOptIn){a.confirmado=false;a.confirmado_em=null;a.token_confirmacao=Math.random().toString(36).slice(2)+Date.now().toString(36)}else{a.confirmado=true;a.confirmado_em=new Date()}
 await a.save()
 if(doubleOptIn){const base=clean(process.env.FRONTEND_URL||process.env.PUBLIC_SITE_URL||'').replace(/\/$/,'');if(base)await sendEmail({to:a.email,subject:'Confirme sua inscrição',html:`<p>Confirme sua inscrição na newsletter:</p><p><a href="${base}/api/newsletter/confirmar/${a.token_confirmacao}">Confirmar inscrição</a></p>`})}
 res.status(a.isNew?201:200).json({mensagem:doubleOptIn?'Enviamos um link de confirmação para seu email.':'Inscrição realizada com sucesso!',confirmacao_pendente:doubleOptIn})
}catch(e){if(e.code===11000)return res.status(409).json({erro:'Este email já está inscrito.'});next(e)}})
router.get('/confirmar/:token',async(req,res,next)=>{try{const a=await Assinante.findOne({token_confirmacao:req.params.token});if(!a)return res.status(404).json({erro:'Link inválido ou expirado.'});a.confirmado=true;a.confirmado_em=new Date();a.ativo=true;await a.save();res.json({mensagem:'Inscrição confirmada com sucesso.'})}catch(e){next(e)}})
router.get('/cancelar/:token',async(req,res,next)=>{try{const a=await Assinante.findOne({token_cancelamento:req.params.token});if(!a)return res.status(404).json({erro:'Link inválido ou expirado.'});a.ativo=false;await a.save();res.json({mensagem:'Inscrição cancelada com sucesso.'})}catch(e){next(e)}})

router.get('/assinantes',...perm,async(req,res,next)=>{try{
 const {ativo,page=1,limit=50,q=''}=req.query,f={};if(ativo==='true')f.ativo=true;if(ativo==='false')f.ativo=false;if(clean(q)){const rx=new RegExp(clean(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');f.$or=[{email:rx},{nome:rx}]}
 const lim=Math.min(200,Math.max(1,parseInt(limit)||50)),pag=Math.max(1,parseInt(page)||1),skip=(pag-1)*lim
 const [total,lista,ativos,inativos,pendentes]=await Promise.all([Assinante.countDocuments(f),Assinante.find(f).sort({inscrito_em:-1}).skip(skip).limit(lim).select('-token_cancelamento -token_confirmacao'),Assinante.countDocuments({ativo:true,confirmado:{$ne:false}}),Assinante.countDocuments({ativo:false}),Assinante.countDocuments({confirmado:false})])
 res.json({assinantes:lista,total,pagina:pag,paginas:Math.ceil(total/lim),estatisticas:{total:ativos+inativos,ativos,inativos,pendentes}})
}catch(e){next(e)}})
router.get('/assinantes/exportar.csv',...perm,async(_req,res,next)=>{try{const lista=await Assinante.find({ativo:true,confirmado:{$ne:false}}).sort({inscrito_em:-1}).select('nome email inscrito_em').lean();const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;const csv=['Nome,Email,Data',...lista.map(a=>[esc(a.nome),esc(a.email),esc(a.inscrito_em?.toISOString()||'')].join(','))].join('\n');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="newsletter-${new Date().toISOString().slice(0,10)}.csv"`);res.send('\ufeff'+csv)}catch(e){next(e)}})
router.delete('/assinantes/:id',...perm,async(req,res,next)=>{try{await Assinante.findByIdAndDelete(req.params.id);res.json({mensagem:'Assinante removido.'})}catch(e){next(e)}})
router.patch('/assinantes/:id/status',...perm,async(req,res,next)=>{try{const a=await Assinante.findByIdAndUpdate(req.params.id,{ativo:Boolean(req.body?.ativo)},{new:true});if(!a)return res.status(404).json({erro:'Assinante não encontrado'});res.json(a)}catch(e){next(e)}})

router.get('/campanhas',...perm,async(_req,res,next)=>{try{res.json(await NewsletterCampanha.find().populate('noticia_ids','titulo slug resumo status').sort({criado_em:-1}).limit(200))}catch(e){next(e)}})
router.post('/campanhas',...perm,async(req,res,next)=>{try{const titulo=clean(req.body?.titulo),assunto=clean(req.body?.assunto);if(!titulo||!assunto)return res.status(400).json({erro:'Título e assunto são obrigatórios'});const c=await NewsletterCampanha.create({titulo,assunto,preheader:clean(req.body?.preheader),noticia_ids:Array.isArray(req.body?.noticia_ids)?req.body.noticia_ids:[],html:req.body?.html||'',texto:req.body?.texto||''});res.status(201).json(c)}catch(e){next(e)}})
router.put('/campanhas/:id',...perm,async(req,res,next)=>{try{const c=await NewsletterCampanha.findOneAndUpdate({_id:req.params.id,status:{$in:['rascunho','agendada']}},{$set:req.body},{new:true,runValidators:true});if(!c)return res.status(409).json({erro:'Campanha não encontrada ou já enviada'});res.json(c)}catch(e){next(e)}})
router.post('/campanhas/:id/teste',...perm,async(req,res,next)=>{try{const c=await NewsletterCampanha.findById(req.params.id);if(!c)return res.status(404).json({erro:'Campanha não encontrada'});const noticias=await Noticia.find({_id:{$in:c.noticia_ids},status:'publicado'}).lean();await sendEmail({to:clean(req.body?.email||req.usuario?.email),subject:`[TESTE] ${c.assunto}`,html:campaignHtml(c,noticias),text:c.texto||c.preheader});res.json({ok:true,mensagem:'Email de teste enviado.'})}catch(e){next(e)}})
router.post('/campanhas/:id/enviar',...perm,async(req,res,next)=>{try{
 const c=await NewsletterCampanha.findById(req.params.id);if(!c)return res.status(404).json({erro:'Campanha não encontrada'});if(c.status==='enviada'||c.status==='enviando')return res.status(409).json({erro:'Campanha já foi enviada ou está em envio.'})
 const quando=req.body?.agendada_para?new Date(req.body.agendada_para):null
 if(quando&&!Number.isNaN(quando.getTime())&&quando>Date.now()){c.status='agendada';c.agendada_para=quando;await c.save();return res.json({ok:true,mensagem:'Campanha agendada.',campanha:c})}
 setImmediate(()=>processCampaign(c._id).catch(e=>logger.warn({campanha:c._id,err:e.message},'Newsletter: envio em segundo plano falhou')))
 res.json({ok:true,mensagem:'Envio iniciado em segundo plano.'})
}catch(e){next(e)}})
router.post('/campanhas/:id/cancelar-agendamento',...perm,async(req,res,next)=>{try{const c=await NewsletterCampanha.findOneAndUpdate({_id:req.params.id,status:'agendada'},{$set:{status:'rascunho',agendada_para:null}},{new:true});if(!c)return res.status(409).json({erro:'Campanha não está agendada.'});res.json(c)}catch(e){next(e)}})


export default router
