import { Router } from 'express'
import fs from 'node:fs'
import SecurityEvent from '../models/SecurityEvent.js'
import SecuritySession from '../models/SecuritySession.js'
import SecurityPolicy from '../models/SecurityPolicy.js'
import AuditLog from '../models/AuditLog.js'
import Usuario from '../models/Usuario.js'
import { autenticar, exigirStepUp } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { readBootstrap, vaultPaths } from '../utils/localVault.js'
import { getCredential, setCredential, deleteCredential } from '../utils/credentialStore.js'
import { getSecurityPolicy, recordSecurityEvent, unblockIp, dispatchSecurityAlert } from '../services/securityService.js'
import { scanSecrets, auditDependencies } from '../services/securityScanner.js'
import { ROOT_DIR } from '../services/systemUpdateService.js'
import { auditLog } from '../middleware/auditLog.js'

const router = Router()
router.use(autenticar, verificarPermissao('seguranca.gerenciar'))

function isSuperAdmin(user) {
  return user?.role === 'superadmin' || user?.perfil_id?.permissoes?.includes('*')
}

function validateWebhookUrl(value) {
  let url
  try { url = new URL(String(value || '')) } catch { return { ok:false, error:'Webhook inválido.' } }
  if (url.protocol !== 'https:') return { ok:false, error:'O webhook deve usar HTTPS.' }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return { ok:false, error:'O webhook não pode apontar para endereço local ou privado.' }
  }
  return { ok:true, value:url.toString() }
}

function scoreLabel(score) {
  if (score >= 90) return 'Excelente'
  if (score >= 75) return 'Boa'
  if (score >= 55) return 'Atenção'
  return 'Crítica'
}
function safeEvent(e) {
  if (!e) return e
  const out = typeof e.toObject === 'function' ? e.toObject() : { ...e }
  if (out.dados?.userAgent) out.dados.userAgent = String(out.dados.userAgent).slice(0, 220)
  return out
}

router.get('/resumo', async (req, res, next) => {
  try {
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const policy = await getSecurityPolicy()
    const [abertos, criticos, ultimas24h, eventos, mutacoes24h, users, sessoesAtivas, blockedAccounts] = await Promise.all([
      SecurityEvent.countDocuments({ estado: { $in: ['novo', 'investigando'] } }),
      SecurityEvent.countDocuments({ estado: { $in: ['novo', 'investigando'] }, severidade: { $in: ['alta', 'critica'] } }),
      SecurityEvent.countDocuments({ ultima_ocorrencia_em: { $gte: desde } }),
      SecurityEvent.find().sort({ ultima_ocorrencia_em: -1 }).limit(12).lean(),
      AuditLog.countDocuments({ criado_em: { $gte: desde } }),
      Usuario.find({ ativo: true }).select('role perfil_id two_factor_enabled').populate('perfil_id', 'permissoes').lean(),
      SecuritySession.countDocuments({ revogada_em: null, expira_em: { $gt: new Date() } }),
      Usuario.countDocuments({ bloqueado_ate: { $gt: new Date() } }),
    ])
    const admins = users.filter(isSuperAdmin)
    const mfaAdmins = admins.filter(u => u.two_factor_enabled).length
    const mfaAll = users.filter(u => u.two_factor_enabled).length
    const bootstrap = readBootstrap()
    const [webhook, telegram, email] = await Promise.all([
      getCredential('security-alert-webhook'), getCredential('security-alert-telegram'), getCredential('security-alert-email'),
    ])
    const checks = {
      masterKeyDedicada: Boolean(process.env.CREDENTIALS_MASTER_KEY || fs.existsSync(vaultPaths().keyFile)),
      setupDesativado: String(bootstrap.SETUP_DISABLED ?? process.env.SETUP_DISABLED ?? '') === 'true',
      ambienteProducao: process.env.NODE_ENV === 'production',
      metricsProtegidas: Boolean(bootstrap.METRICS_TOKEN || process.env.METRICS_TOKEN),
      csrfAtivo: true,
      swaggerProtegido: process.env.NODE_ENV !== 'production' || policy.swagger_protegido !== false,
      sessoesIndividuais: true,
      auditoriaAtiva: true,
      alertasConfigurados: Boolean(webhook.value || telegram.value || email.value),
      scannerSegredos: Boolean(policy.ultimo_scan),
    }
    const recommendations = []
    const identity = Math.max(0, 25 - (admins.length && mfaAdmins < admins.length ? 8 : 0) - (blockedAccounts ? 3 : 0))
    if (admins.length && mfaAdmins < admins.length) recommendations.push({ area:'Identidade', pontos:8, texto:`${admins.length-mfaAdmins} administrador(es) ainda sem 2FA.` })
    const credentials = Math.max(0, 20 - (!checks.masterKeyDedicada ? 10 : 0) - (policy.ultimo_scan?.critical ? 10 : 0))
    if (!checks.masterKeyDedicada) recommendations.push({ area:'Credenciais', pontos:10, texto:'Configure uma chave mestra dedicada para o cofre.' })
    if (policy.ultimo_scan?.critical) recommendations.push({ area:'Credenciais', pontos:10, texto:`O último scan encontrou ${policy.ultimo_scan.critical} possível(is) segredo(s) crítico(s).` })
    const dependencyCounts = policy.ultimo_audit_dependencias?.counts || {}
    const depPenalty = Number(dependencyCounts.critical||0) > 0 ? 8 : Number(dependencyCounts.high||0) > 0 ? 4 : 0
    const application = Math.max(0, 20 - (!checks.ambienteProducao ? 4 : 0) - (!checks.metricsProtegidas ? 5 : 0) - depPenalty)
    if (!checks.metricsProtegidas) recommendations.push({ area:'Aplicação', pontos:5, texto:'Proteja o endpoint de métricas com token.' })
    if (depPenalty) recommendations.push({ area:'Aplicação', pontos:depPenalty, texto:`O último audit encontrou ${Number(dependencyCounts.critical||0)} crítica(s) e ${Number(dependencyCounts.high||0)} alta(s) em dependências.` })
    const monitoring = Math.max(0, 20 - (!checks.alertasConfigurados ? 5 : 0) - (policy.resposta_automatica === 'observar' ? 2 : 0) - Math.min(8, criticos * 2))
    if (!checks.alertasConfigurados) recommendations.push({ area:'Monitoramento', pontos:5, texto:'Configure ao menos um canal de alerta externo.' })
    const dataScore = Math.max(0, 15 - (policy.ultimo_scan?.critical ? 8 : 0) - (!checks.setupDesativado ? 3 : 0))
    if (!checks.setupDesativado) recommendations.push({ area:'Dados', pontos:3, texto:'Desative o Setup após concluir a instalação.' })
    const categories = { identidade: identity, credenciais: credentials, aplicacao: application, monitoramento: monitoring, dados: dataScore }
    const score = Object.values(categories).reduce((a,b)=>a+b,0)
    res.json({
      score, scoreLabel: scoreLabel(score), categories, recommendations, checks,
      abertos, criticos, ultimas24h, mutacoes24h, sessoesAtivas, blockedAccounts,
      users: { ativos: users.length, admins: admins.length, mfaAtivos: mfaAll, mfaAdmins, mfaAdminTotal: admins.length },
      policy: { resposta_automatica: policy.resposta_automatica, mfa_admin_obrigatorio: policy.mfa_admin_obrigatorio, step_up_critico: policy.step_up_critico },
      eventos: eventos.map(safeEvent),
    })
  } catch (err) { next(err) }
})

router.get('/eventos', async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const filtro = {}
    if (req.query.severidade) filtro.severidade = req.query.severidade
    if (req.query.estado) filtro.estado = req.query.estado
    if (req.query.tipo) filtro.tipo = req.query.tipo
    if (req.query.resolvido !== undefined) filtro.resolvido = req.query.resolvido === 'true'
    if (req.query.q) {
      const q = String(req.query.q).slice(0,120).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
      filtro.$or = [{ mensagem: new RegExp(q,'i') }, { usuario_email: new RegExp(q,'i') }, { ip: new RegExp(q,'i') }, { rota: new RegExp(q,'i') }]
    }
    const eventos = await SecurityEvent.find(filtro).sort({ ultima_ocorrencia_em: -1 }).limit(limit).lean()
    res.json({ eventos: eventos.map(safeEvent) })
  } catch (err) { next(err) }
})

router.patch('/eventos/:id', auditLog('security_incidents'), async (req, res, next) => {
  try {
    const estado = ['novo','investigando','resolvido','ignorado'].includes(req.body.estado) ? req.body.estado : (req.body.resolvido ? 'resolvido' : 'novo')
    const patch = {
      estado, resolvido: ['resolvido','ignorado'].includes(estado),
      responsavel_id: req.usuario._id, responsavel_email: req.usuario.email,
      observacao: req.body.observacao ? String(req.body.observacao).slice(0,2000) : undefined,
      acao_tomada: req.body.acao_tomada ? String(req.body.acao_tomada).slice(0,1000) : undefined,
      resolvido_em: ['resolvido','ignorado'].includes(estado) ? new Date() : null,
    }
    Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k])
    const evento = await SecurityEvent.findByIdAndUpdate(req.params.id, patch, { new: true })
    if (!evento) return res.status(404).json({ erro: 'Evento não encontrado.' })
    res.json({ evento: safeEvent(evento) })
  } catch (err) { next(err) }
})

router.get('/eventos/:id/forense', async (req, res, next) => {
  try {
    const evento = await SecurityEvent.findById(req.params.id).lean()
    if (!evento) return res.status(404).json({ erro:'Evento não encontrado.' })
    const center = new Date(evento.ultima_ocorrencia_em || evento.criado_em).getTime()
    const inicio = new Date(center - 60*60*1000), fim = new Date(center + 60*60*1000)
    const audit = await AuditLog.find({ criado_em:{ $gte:inicio,$lte:fim }, ...(evento.usuario_id ? { admin_id:evento.usuario_id } : {}) }).sort({criado_em:1}).limit(200).lean()
    const sessions = evento.usuario_id ? await SecuritySession.find({usuario_id:evento.usuario_id,ultimo_acesso_em:{$gte:inicio,$lte:fim}}).sort({ultimo_acesso_em:1}).limit(50).lean() : []
    res.json({ product:'AL Sistemas', generatedAt:new Date().toISOString(), evento:safeEvent(evento), timeline:{inicio,fim}, audit, sessions: sessions.map(s=>({...s,user_agent:s.user_agent?String(s.user_agent).slice(0,220):null})) })
  } catch(err){ next(err) }
})

router.get('/sessoes', async (req, res, next) => {
  try {
    const sessions = await SecuritySession.find({ expira_em:{ $gt:new Date() } }).sort({ultimo_acesso_em:-1}).limit(300).lean()
    res.json({ sessions: sessions.map(s=>({ ...s, current:Boolean(req.authPayload?.jti && s.jti===req.authPayload.jti), user_agent:s.user_agent?String(s.user_agent).slice(0,220):null })) })
  } catch(err){ next(err) }
})

router.delete('/sessoes/:jti', exigirStepUp, auditLog('security_sessions'), async (req,res,next)=>{
  try{
    if(req.params.jti===req.authPayload?.jti) return res.status(400).json({erro:'Use Sair para encerrar a sessão atual.'})
    const session=await SecuritySession.findOneAndUpdate({jti:req.params.jti,revogada_em:null},{revogada_em:new Date(),revogada_por:req.usuario._id,motivo_revogacao:'revogada_pelo_centro_de_seguranca'},{new:true})
    if(!session) return res.status(404).json({erro:'Sessão ativa não encontrada.'})
    await recordSecurityEvent({tipo:'sessao_revogada',severidade:'media',mensagem:'Uma sessão foi revogada manualmente pelo Centro de Segurança.',usuario_id:session.usuario_id,usuario_email:session.usuario_email,ip:session.ip,request_id:req.requestId,allow_auto_block:false})
    res.json({mensagem:'Sessão encerrada.'})
  }catch(err){next(err)}
})

router.post('/sessoes/revogar-usuario/:id', exigirStepUp, auditLog('security_sessions'), async(req,res,next)=>{
  try{
    const user=await Usuario.findById(req.params.id)
    if(!user)return res.status(404).json({erro:'Usuário não encontrado.'})
    if(String(user._id)===String(req.usuario._id)) return res.status(400).json({erro:'Para sua própria conta, encerre sessões individualmente ou use Sair.'})
    user.sessao_versao=(user.sessao_versao||0)+1; await user.save()
    const result=await SecuritySession.updateMany({usuario_id:user._id,revogada_em:null},{revogada_em:new Date(),revogada_por:req.usuario._id,motivo_revogacao:'revogacao_global'})
    await recordSecurityEvent({tipo:'sessoes_globais_revogadas',severidade:'alta',mensagem:'Todas as sessões de uma conta foram revogadas.',usuario_id:user._id,usuario_email:user.email,request_id:req.requestId,allow_auto_block:false})
    res.json({mensagem:'Sessões revogadas.',modificadas:result.modifiedCount||0})
  }catch(err){next(err)}
})

router.get('/politica', async (_req,res,next)=>{
  try{
    const p=await getSecurityPolicy()
    const [webhook,telegram,email]=await Promise.all([getCredential('security-alert-webhook'),getCredential('security-alert-telegram'),getCredential('security-alert-email')])
    res.json({policy:p,channels:{webhook:Boolean(webhook.value),telegram:Boolean(telegram.value),email:Boolean(email.value)}})
  }catch(err){next(err)}
})

router.put('/politica', exigirStepUp, auditLog('security_policy'), async(req,res,next)=>{
  try{
    const allowed=['mfa_admin_obrigatorio','mfa_todos_obrigatorio','step_up_critico','swagger_protegido','retencao_eventos_dias','retencao_auditoria_dias','resposta_automatica','bloqueio_ip_minutos']
    const patch={atualizado_por:req.usuario._id}
    for(const key of allowed) if(req.body[key]!==undefined) patch[key]=req.body[key]
    if(req.body.alertas && typeof req.body.alertas==='object'){
      for(const k of ['webhook_ativo','telegram_ativo','email_ativo','email_destino','severidade_minima','cooldown_minutos']) if(req.body.alertas[k]!==undefined) patch[`alertas.${k}`]=req.body.alertas[k]
    }
    const policy=await SecurityPolicy.findOneAndUpdate({chave:'default'},{$set:patch},{upsert:true,new:true,runValidators:true,setDefaultsOnInsert:true})
    const eventCutoff=new Date(Date.now()-Number(policy.retencao_eventos_dias||180)*86400000)
    const auditCutoff=new Date(Date.now()-Number(policy.retencao_auditoria_dias||365)*86400000)
    await Promise.all([SecurityEvent.deleteMany({criado_em:{$lt:eventCutoff}}),AuditLog.deleteMany({criado_em:{$lt:auditCutoff}})])
    res.json({policy})
  }catch(err){next(err)}
})

router.put('/alertas/configuracao', exigirStepUp, auditLog('security_alerts'), async(req,res,next)=>{
  try{
    const policyPatch={}
    if(req.body.webhookUrl!==undefined){
      const v=String(req.body.webhookUrl||'').trim()
      if(v){ const checked=validateWebhookUrl(v); if(!checked.ok)return res.status(400).json({erro:checked.error}); await setCredential('security-alert-webhook',checked.value,{type:'webhook'}); policyPatch['alertas.webhook_ativo']=true }
      else { await deleteCredential('security-alert-webhook'); policyPatch['alertas.webhook_ativo']=false }
    }
    if(req.body.telegram!==undefined){
      const t=req.body.telegram||{}
      if(t.botToken&&t.chatId){ await setCredential('security-alert-telegram',JSON.stringify({botToken:String(t.botToken),chatId:String(t.chatId)}),{type:'telegram'}); policyPatch['alertas.telegram_ativo']=true }
      else if(t.remove){ await deleteCredential('security-alert-telegram'); policyPatch['alertas.telegram_ativo']=false }
    }
    if(req.body.email!==undefined){
      const e=req.body.email||{}
      if(e.host&&(e.user||e.from)){
        await setCredential('security-alert-email',JSON.stringify({host:String(e.host),port:Number(e.port||587),secure:Boolean(e.secure),user:String(e.user||''),password:String(e.password||''),from:String(e.from||e.user||'')}),{type:'smtp'})
        policyPatch['alertas.email_ativo']=true
        if(e.destination) policyPatch['alertas.email_destino']=String(e.destination).trim().slice(0,320)
      }else if(e.remove){ await deleteCredential('security-alert-email'); policyPatch['alertas.email_ativo']=false }
    }
    if(Object.keys(policyPatch).length) await SecurityPolicy.findOneAndUpdate({chave:'default'},{$set:policyPatch},{upsert:true,setDefaultsOnInsert:true})
    res.json({ok:true,mensagem:'Canais salvos no cofre criptografado.'})
  }catch(err){next(err)}
})

router.post('/alertas/testar', exigirStepUp, async(req,res,next)=>{
  try{
    const policy=await getSecurityPolicy()
    const event=await recordSecurityEvent({tipo:'teste_alerta_seguranca',severidade:req.body.severidade||'alta',mensagem:'Teste manual dos canais de alerta do AL Sistemas.',ip:req.ip,usuario_id:req.usuario._id,usuario_email:req.usuario.email,request_id:req.requestId,allow_auto_block:false,skip_alert:true,fingerprint:`manual-test-${Date.now()}`})
    const forced={...policy.toObject(),resposta_automatica:'alertar'}
    const alertas=await dispatchSecurityAlert(event,forced)
    res.json({ok:true,evento:safeEvent(event),alertas})
  }catch(err){next(err)}
})

router.post('/ip/desbloquear', exigirStepUp, auditLog('security_ip'), async(req,res,next)=>{
  try{ const ip=String(req.body.ip||'').trim(); if(!ip)return res.status(400).json({erro:'Informe o IP.'}); await unblockIp(ip); res.json({ok:true}) }catch(err){next(err)}
})

router.post('/scan-segredos', async(req,res,next)=>{
  try{
    const result=await scanSecrets(ROOT_DIR)
    await SecurityPolicy.findOneAndUpdate({chave:'default'},{$set:{ultimo_scan:{...result,findings:result.findings.slice(0,30),checkedAt:new Date().toISOString()}}},{upsert:true})
    if(result.critical) await recordSecurityEvent({tipo:'segredos_detectados',severidade:'critica',mensagem:`A varredura encontrou ${result.critical} possível(is) segredo(s) crítico(s) no projeto.`,usuario_id:req.usuario._id,usuario_email:req.usuario.email,request_id:req.requestId,allow_auto_block:false,fingerprint:`secret-scan-${new Date().toISOString().slice(0,10)}`})
    res.json(result)
  }catch(err){next(err)}
})

router.get('/dependencias', async(req,res,next)=>{
  try{
    const result=await auditDependencies(ROOT_DIR)
    await SecurityPolicy.findOneAndUpdate({chave:'default'},{$set:{ultimo_audit_dependencias:{counts:result.counts,checkedAt:result.checkedAt,backend:{available:result.backend.available,reason:result.backend.reason},frontend:{available:result.frontend.available,reason:result.frontend.reason}}}},{upsert:true})
    res.json(result)
  }catch(err){next(err)}
})

router.get('/auditoria', async(req,res,next)=>{
  try{
    const limit=Math.min(200,Math.max(1,Number(req.query.limit)||50))
    const logs=await AuditLog.find().sort({criado_em:-1}).limit(limit).lean()
    res.json({logs})
  }catch(err){next(err)}
})

export default router
