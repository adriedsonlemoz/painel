import { getCredential } from './credentialStore.js'
import { registrarErro } from '../services/errorLogService.js'
import { aiAdapter } from '../services/aiProviders.js'
import { runAiQueued, getAiQueueStats } from '../services/aiQueue.js'
import { circuitCanRun, circuitSuccess, circuitFailure, getCircuitStates, resetCircuit } from '../services/aiCircuitBreaker.js'
import { resolveAiProfile, AI_PROFILES } from '../services/aiProfiles.js'
import { validateJsonSchema } from '../services/aiSchemaValidator.js'
import { redactAiText, redactAiData, wrapUntrusted } from '../services/aiRedactor.js'
import { recordAiUsage } from '../services/aiTelemetry.js'
import { aiCacheKey, getAiCache, setAiCache } from '../services/aiCache.js'
import { truncateForTokens, selectRelevantLogContext } from '../services/aiContext.js'

export const HISTORICO_MAX_MSGS = 10
export const CONTEXTO_MAX_CHARS = 6000
export const MAX_TOKENS_DEFAULT = parseInt(process.env.AI_MAX_TOKENS || '1200', 10)
export const AI_TIMEOUT_MS = Math.max(6000, Math.min(45000, parseInt(process.env.AI_TIMEOUT_MS || '20000', 10)))
export const AI_OPERATION_TIMEOUT_MS = Math.max(15000, Math.min(120000, parseInt(process.env.AI_OPERATION_TIMEOUT_MS || '45000', 10)))

const DEFAULTS = { gemini: 'gemini-2.5-flash', openrouter: 'openrouter/free' }
const PROVIDERS = ['gemini','openrouter']
const healthMemory = new Map()

export function truncarHistorico(mensagens) {
  return Array.isArray(mensagens) ? mensagens.slice(-HISTORICO_MAX_MSGS).map(m => ({ ...m, content: redactAiText(m.content || '') })) : []
}
export function truncarContexto(contexto) {
  return truncateForTokens(JSON.stringify(redactAiData(contexto || {})), Math.max(1000, Math.floor(CONTEXTO_MAX_CHARS / 4)))
}

async function providerConfig(id, override = null) {
  const envMap = { gemini:'GEMINI_API_KEY', openrouter:'OPENROUTER_API_KEY' }
  if (override?.value) {
    return { id, value: override.value, locked: false, source: 'temporary-test', metadata: override.metadata || {}, model: override.metadata?.model || DEFAULTS[id], enabled: override.metadata?.enabled !== false }
  }
  const c = await getCredential(id, envMap[id])
  return { id, ...c, metadata:c.metadata || {}, model:c.metadata?.model || DEFAULTS[id], enabled:c.metadata?.enabled !== false }
}

async function providerCandidates(preferred) {
  const all = []
  for (const id of PROVIDERS) {
    const c = await providerConfig(id)
    if (c.value && c.enabled) all.push(c)
  }
  all.sort((a,b) => {
    if (preferred) { if (a.id === preferred) return -1; if (b.id === preferred) return 1 }
    return Number(Boolean(b.metadata?.primary)) - Number(Boolean(a.metadata?.primary))
  })
  return all
}

async function chooseProvider(preferred) {
  const list = await providerCandidates(preferred)
  if (list[0]) return list[0]
  return providerConfig(preferred && PROVIDERS.includes(preferred) ? preferred : 'gemini')
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, ms))
    if (signal) {
      const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('Operação de IA cancelada.'), { status:499, code:'AI_ABORTED' })) }
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once:true })
    }
  })
}

function retryable(err) {
  return [408,425,429,500,502,503,504].includes(Number(err?.status || 0)) || ['AI_TIMEOUT','ECONNRESET','ETIMEDOUT'].includes(err?.code)
}

function failureShape(cfg, err) {
  return { provedor:cfg.id, mensagem:redactAiText(err?.message || 'Falha desconhecida').slice(0,1200), status:err?.status || null, code:err?.code || null, retryAfterMs:Number(err?.retryAfterMs || 0) }
}

function recordHealth(id, ok, details = {}) {
  healthMemory.set(id, { ok, checkedAt:new Date().toISOString(), ...details })
}

function profileParams(cfg, profileName, overrides = {}) {
  const profile = resolveAiProfile(profileName, cfg.metadata)
  return {
    profile,
    params: {
      maxTokens: Math.max(32, Math.min(32768, Number(overrides.maxTokens || profile.maxTokens || cfg.metadata?.maxTokens || MAX_TOKENS_DEFAULT))),
      temperature: Math.max(0, Math.min(2, Number(overrides.temperature ?? profile.temperature ?? cfg.metadata?.temperature ?? 0.25))),
    },
  }
}

function promptComInstrucoes(cfg, systemPrompt, profile) {
  const custom = profile.customInstructions ? String(cfg.metadata?.systemInstructions || '').trim() : ''
  return [redactAiText(systemPrompt), custom && `INSTRUÇÕES PERSONALIZADAS DA INSTALAÇÃO (aplicáveis somente ao perfil ${profile.name}):\n${redactAiText(custom)}`].filter(Boolean).join('\n\n')
}

function privacyAllowed(cfg, dataClass = 'general') {
  const privacy = cfg.metadata?.privacy || {}
  if (dataClass === 'mongo_documents') return privacy.mongoDocuments === true
  const map = { github_logs:'githubLogs', vercel_logs:'vercelLogs', render_logs:'renderLogs', rss_content:'rssContent', readme:'readme', editorial:'editorial' }
  const key = map[dataClass]
  return !key || privacy[key] !== false
}

function enforcePrivacy(candidates, dataClass) {
  if (!dataClass) return candidates
  const allowed = candidates.filter(c => privacyAllowed(c, dataClass))
  if (!allowed.length && candidates.length) {
    const e = new Error(`Envio de dados da classe "${dataClass}" para IA está desativado nas configurações de privacidade.`)
    e.status = 403; e.code = 'AI_PRIVACY_BLOCKED'
    throw e
  }
  return allowed
}

function parseJson(text = '') {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim()
  try { return JSON.parse(cleaned) } catch {}
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) try { return JSON.parse(cleaned.slice(start, end + 1)) } catch {}
  const e = new Error('A IA respondeu, mas não retornou JSON válido.')
  e.code = 'AI_JSON_INVALID'; e.status = 502
  throw e
}

function validateStructured(data, schema) {
  const validation = validateJsonSchema(data, schema)
  if (validation.ok) return data
  const e = new Error(`A IA retornou JSON válido, porém fora do formato esperado: ${validation.errors.slice(0,6).join('; ')}`)
  e.code = 'AI_SCHEMA_INVALID'; e.status = 502; e.validationErrors = validation.errors
  throw e
}

async function tryProvider({ cfg, systemPrompt, question, history, structured, profileName, task, signal, deadlineAt, queueWaitMs, dataClass, fallback=false }) {
  const adapter = aiAdapter(cfg.id)
  const circuit = circuitCanRun(cfg.id)
  if (!circuit.ok) {
    const e = new Error(`${cfg.id === 'gemini' ? 'Gemini' : 'OpenRouter'} em pausa temporária após falhas. Nova tentativa em ${Math.max(1, Math.ceil(circuit.retryAfterMs/1000))} s.`)
    e.status = 503; e.code = 'AI_CIRCUIT_OPEN'; e.retryAfterMs = circuit.retryAfterMs
    throw e
  }
  if (!privacyAllowed(cfg, dataClass)) {
    const e = new Error(`Política de privacidade bloqueia ${dataClass} para ${cfg.id}.`); e.status=403; e.code='AI_PRIVACY_BLOCKED'; throw e
  }

  const { profile, params } = profileParams(cfg, profileName)
  const prompt = promptComInstrucoes(cfg, systemPrompt, profile)
  const safeQuestion = truncateForTokens(redactAiText(question), profile.maxInputTokens)
  const safeHistory = truncarHistorico(history).map(m => ({ ...m, content: truncateForTokens(m.content, Math.max(500, Math.floor(profile.maxInputTokens / 4))) }))
  const modes = structured?.schema ? ['schema','json'] : [null]
  let lastError = null
  let retries = 0

  for (const mode of modes) {
    const maxRetries = mode === 'schema' ? 1 : 2
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const remaining = deadlineAt - Date.now()
      if (remaining <= 800) {
        const e = new Error('Tempo máximo da operação de IA excedido.'); e.status=504; e.code='AI_OPERATION_TIMEOUT'; throw e
      }
      const timeoutMs = Math.min(AI_TIMEOUT_MS, Math.max(1000, remaining))
      const started = Date.now()
      try {
        const result = await adapter.generate({ cfg, systemPrompt:prompt, question:safeQuestion, history:safeHistory, structuredMode:mode, schema:structured?.schema, schemaName:structured?.name, params, timeoutMs, signal })
        if (!String(result.resposta || '').trim()) {
          const e = new Error(`${cfg.id} retornou resposta vazia.`); e.status=502; e.code='AI_EMPTY_RESPONSE'; throw e
        }
        if (structured?.schema) {
          const parsed = validateStructured(parseJson(result.resposta), structured.schema)
          result.data = parsed
        }
        circuitSuccess(cfg.id)
        recordHealth(cfg.id, true, { status:'geração funcionando', model:result.modelo, latencyMs:Date.now()-started })
        await recordAiUsage({ task, profile:profile.name, provider:cfg.id, model:result.modelo, status:'success', inputTokens:result.tokens?.input_tokens, outputTokens:result.tokens?.output_tokens, costUsd:result.tokens?.cost_usd, latencyMs:Date.now()-started, queueWaitMs, retries, fallback })
        return { ...result, retries, profile:profile.name }
      } catch (err) {
        lastError = err
        retries += 1
        const status = Number(err?.status || 0)
        const schemaFallback = structured?.schema && mode === 'schema' && [400,404,422,502].includes(status)
        const canRetry = attempt < maxRetries && retryable(err) && !signal?.aborted
        if (canRetry) {
          const waitMs = Math.min(Math.max(Number(err?.retryAfterMs || 0), 400 * (2 ** attempt) + Math.floor(Math.random()*250)), Math.max(0, deadlineAt - Date.now() - 1200), 5000)
          if (waitMs > 0) await sleep(waitMs, signal)
          continue
        }
        if (schemaFallback) break
        circuitFailure(cfg.id, err)
        recordHealth(cfg.id, false, { status:redactAiText(err.message), model:cfg.model, errorStatus:err.status || null, errorCode:err.code || null })
        await recordAiUsage({ task, profile:profile.name, provider:cfg.id, model:cfg.model, status:signal?.aborted?'cancelled':'error', latencyMs:Date.now()-started, queueWaitMs, retries, errorStatus:err.status, errorCode:err.code, errorMessage:redactAiText(err.message) })
        throw err
      }
    }
  }
  circuitFailure(cfg.id, lastError)
  throw lastError || new Error(`${cfg.id} não retornou resposta utilizável.`)
}

async function runOperation({ systemPrompt, question, history = [], provider, structured = null, profile = 'assistant', task = 'ai', priority, signal, dataClass = 'general', cacheKey = null, cacheTtlMs = null }) {
  let candidates = await providerCandidates(provider)
  if (!candidates.length) {
    const e = new Error('Nenhum provedor de IA ativo e configurado. Configure Gemini ou OpenRouter em Integrações e APIs.')
    e.status = 503; e.code='AI_NOT_CONFIGURED'; throw e
  }
  candidates = enforcePrivacy(candidates, dataClass)
  const profileCfg = resolveAiProfile(profile, candidates[0]?.metadata || {})
  const ttl = cacheTtlMs == null ? profileCfg.cacheTtlMs : cacheTtlMs
  const providerSig=candidates.map(c=>({id:c.id,model:c.model,primary:Boolean(c.metadata?.primary),instructions:profileCfg.customInstructions?String(c.metadata?.systemInstructions||'').slice(0,500):''}))
  const finalCacheKey = ttl > 0 ? aiCacheKey(task, cacheKey ? {userKey:cacheKey,providerSig,profile} : {systemPrompt:redactAiText(systemPrompt),question:redactAiText(question),structured:structured?.name||null,profile,providerSig}) : null
  if (finalCacheKey && ttl > 0) {
    const cached = await getAiCache(finalCacheKey)
    if (cached) {
      await recordAiUsage({ task, profile, provider:cached.provedor || 'cache', model:cached.modelo, status:'cache', cacheHit:true, inputTokens:0, outputTokens:0 })
      return { ...cached, cacheHit:true }
    }
  }

  const errors = []
  const startedOperation = Date.now()
  return runAiQueued(async ({ queueWaitMs }) => {
    const deadlineAt = Date.now() + AI_OPERATION_TIMEOUT_MS
    for (const cfg of candidates) {
      try {
        const result = await tryProvider({ cfg, systemPrompt, question, history, structured, profileName:profile, task, signal, deadlineAt, queueWaitMs, dataClass, fallback:errors.length>0 })
        const out = { ...result, fallback:errors.length > 0, falhasAnteriores:errors.map(x=>x.provedor), providerErrors:errors, queueWaitMs, operationMs:Date.now()-startedOperation }
        if (finalCacheKey && ttl > 0) await setAiCache(finalCacheKey, task, out, ttl)
        return out
      } catch (err) {
        errors.push(failureShape(cfg, err))
        if (err?.code === 'AI_ABORTED' || err?.code === 'AI_PRIVACY_BLOCKED') break
      }
    }
    registrarFalhaIa(errors, task)
    const e = new Error(`Nenhum provedor de IA respondeu com sucesso. ${errors.map(x=>`${x.provedor}: ${x.mensagem}`).join(' | ')}`)
    e.status = errors.find(x=>x.status)?.status || 502; e.providerErrors = errors; e.code='AI_ALL_PROVIDERS_FAILED'
    throw e
  }, { priority: priority || profileCfg.priority, signal })
}

function registrarFalhaIa(errors, contexto='geracao') {
  registrarErro({
    tipo:'backend', mensagem:`IA indisponível: ${errors.map(x=>`${x.provedor}: ${redactAiText(x.mensagem)}`).join(' | ')}`,
    rota:'/api/ia', dados:{source:'ai',contexto,providers:errors.map(x=>({provedor:x.provedor,status:x.status||null,code:x.code||null,mensagem:redactAiText(x.mensagem)}))},
  }).catch(()=>{})
}

export async function enviarMensagem({ systemPrompt, pergunta, historico=[], provedor, profile='assistant', task='texto', priority, signal, dataClass='general', cacheKey, cacheTtlMs }) {
  return runOperation({ systemPrompt, question:pergunta, history:historico, provider:provedor, profile, task, priority, signal, dataClass, cacheKey, cacheTtlMs })
}

export async function enviarJson({ systemPrompt, pergunta, schema, schemaName='al_response', historico=[], provedor, profile='assistant', task='json', priority, signal, dataClass='general', cacheKey, cacheTtlMs }) {
  if (!schema || typeof schema !== 'object') throw new Error('Schema JSON obrigatório para saída estruturada.')
  const result = await runOperation({ systemPrompt, question:pergunta, history:historico, provider:provedor, structured:{ schema, name:schemaName }, profile, task, priority, signal, dataClass, cacheKey, cacheTtlMs })
  return { data:result.data, ...result }
}


export async function enviarMensagemStream({ systemPrompt, pergunta, historico=[], provedor, profile='assistant', task='texto-stream', priority='urgent', signal, dataClass='general', onChunk }) {
  let candidates = enforcePrivacy(await providerCandidates(provedor), dataClass)
  if (!candidates.length) {
    const e = new Error('Nenhum provedor de IA ativo e configurado. Configure Gemini ou OpenRouter em Integrações e APIs.')
    e.status=503; e.code='AI_NOT_CONFIGURED'; throw e
  }
  const errors=[]
  const profileCfg=resolveAiProfile(profile,candidates[0]?.metadata||{})
  return runAiQueued(async({queueWaitMs})=>{
    const deadlineAt=Date.now()+AI_OPERATION_TIMEOUT_MS
    for(const cfg of candidates){
      const circuit=circuitCanRun(cfg.id)
      if(!circuit.ok){errors.push({provedor:cfg.id,mensagem:`pausa temporária (${Math.ceil(circuit.retryAfterMs/1000)} s)`,status:503,code:'AI_CIRCUIT_OPEN'});continue}
      const adapter=aiAdapter(cfg.id)
      const {profile:resolved,params}=profileParams(cfg,profile)
      const prompt=promptComInstrucoes(cfg,systemPrompt,resolved)
      const question=truncateForTokens(redactAiText(pergunta),resolved.maxInputTokens)
      const history=truncarHistorico(historico)
      let emitted=false,lastError=null
      for(let attempt=0;attempt<2;attempt++){
        const started=Date.now()
        try{
          const remaining=deadlineAt-Date.now(); if(remaining<800){const e=new Error('Tempo máximo da operação de IA excedido.');e.status=504;e.code='AI_OPERATION_TIMEOUT';throw e}
          const result=await adapter.stream({cfg,systemPrompt:prompt,question,history,params,timeoutMs:Math.min(AI_TIMEOUT_MS,remaining),signal,onChunk:async chunk=>{emitted=true;await onChunk?.(chunk,{provider:cfg.id,model:cfg.model})}})
          if(!String(result.resposta||'').trim()){const e=new Error(`${cfg.id} retornou resposta vazia.`);e.status=502;e.code='AI_EMPTY_RESPONSE';throw e}
          circuitSuccess(cfg.id);recordHealth(cfg.id,true,{status:'streaming funcionando',model:result.modelo,latencyMs:Date.now()-started})
          await recordAiUsage({task,profile:resolved.name,provider:cfg.id,model:result.modelo,status:'success',inputTokens:result.tokens?.input_tokens,outputTokens:result.tokens?.output_tokens,costUsd:result.tokens?.cost_usd,latencyMs:Date.now()-started,queueWaitMs,retries:attempt,fallback:errors.length>0})
          return {...result,fallback:errors.length>0,falhasAnteriores:errors.map(x=>x.provedor),providerErrors:errors,queueWaitMs,profile:resolved.name}
        }catch(err){
          lastError=err
          if(emitted) throw err
          if(attempt===0&&retryable(err)){const wait=Math.min(Math.max(Number(err.retryAfterMs||0),500),2500);await sleep(wait,signal);continue}
          circuitFailure(cfg.id,err);recordHealth(cfg.id,false,{status:redactAiText(err.message),model:cfg.model,errorStatus:err.status||null,errorCode:err.code||null})
          await recordAiUsage({task,profile:resolved.name,provider:cfg.id,model:cfg.model,status:signal?.aborted?'cancelled':'error',latencyMs:Date.now()-started,queueWaitMs,retries:attempt,errorStatus:err.status,errorCode:err.code,errorMessage:redactAiText(err.message)})
        }
      }
      errors.push(failureShape(cfg,lastError||new Error('Falha no streaming')))
    }
    registrarFalhaIa(errors,task)
    const e=new Error(`Nenhum provedor de IA respondeu com sucesso. ${errors.map(x=>`${x.provedor}: ${x.mensagem}`).join(' | ')}`);e.status=errors.find(x=>x.status)?.status||502;e.providerErrors=errors;throw e
  },{priority:priority||profileCfg.priority,signal})
}

export async function provedorInfo() {
  const circuits = getCircuitStates()
  const candidates = await providerCandidates()
  const cfg = candidates.find(c=>!circuits[c.id]?.open) || candidates[0] || await chooseProvider()
  return {
    provedor:cfg.id, nome:{gemini:'Google Gemini',openrouter:'OpenRouter'}[cfg.id] || cfg.id,
    modelo:cfg.model, disponivel:Boolean(cfg.value) && cfg.enabled && !circuits[cfg.id]?.open,
    credencialBloqueada:Boolean(cfg.locked), origem:cfg.source || null, automatico:true,
    fila:getAiQueueStats(), circuit:circuits[cfg.id] || null, profiles:Object.keys(AI_PROFILES),
  }
}

const EDITORIAL_SCHEMA = {
  type:'object', properties:{
    titulo:{type:'string'}, titulos_alternativos:{type:'array',items:{type:'string'},maxItems:3}, resumo:{type:'string'}, seo_titulo:{type:'string'}, seo_descricao:{type:'string'}, tags:{type:'array',items:{type:'string'},maxItems:8}, categoria:{type:'string'},
    qualidade:{type:'object',properties:{nota:{type:'number'},alertas:{type:'array',items:{type:'string'}},pontos_fortes:{type:'array',items:{type:'string'}}},required:['nota','alertas','pontos_fortes'],additionalProperties:false},
  }, required:['titulo','titulos_alternativos','resumo','seo_titulo','seo_descricao','tags','categoria','qualidade'], additionalProperties:false,
}

export async function analisarNoticiaEditorial({ titulo='', resumo='', conteudo='', categorias=[], acao='analisar', provedor }) {
  const systemPrompt='Você é um assistente editorial de um portal jornalístico brasileiro. Nunca invente fatos, pessoas, números, datas ou fontes. Trabalhe somente com o texto fornecido. Preserve o sentido factual.'
  const profile = acao === 'rss' ? 'rss' : 'editorial'
  const pergunta=`TAREFA: ${acao}\nCATEGORIAS DISPONÍVEIS: ${categorias.join(', ')||'nenhuma'}\n\nTÍTULO:\n${redactAiText(titulo)}\n\nRESUMO:\n${redactAiText(resumo)}\n\n${wrapUntrusted('CONTEÚDO DA NOTÍCIA', truncateForTokens(conteudo, 10000))}\n\nLimites: resumo 300 caracteres, seo_titulo 60, seo_descricao 160, tags até 8. Se a tarefa não pedir alteração de um campo, mantenha uma sugestão conservadora.`
  const key = acao === 'rss' ? aiCacheKey('editorial-rss', {titulo,resumo,conteudo,categorias}) : null
  const result=await enviarJson({systemPrompt,pergunta,schema:EDITORIAL_SCHEMA,schemaName:'analise_editorial',provedor,profile,task:`editorial:${acao}`,dataClass:acao==='rss'?'rss_content':'editorial',cacheKey:key,cacheTtlMs:acao==='rss'?24*60*60_000:0})
  return {...result.data,_meta:{provedor:result.provedor,modelo:result.modelo,tokens:result.tokens,fallback:Boolean(result.fallback),falhasAnteriores:result.falhasAnteriores||[],structuredMode:result.structuredMode,cacheHit:Boolean(result.cacheHit),retries:result.retries||0}}
}

export async function sugerirDescricaoRepositorio({ nome='', descricaoAtual='', linguagem='', topicos=[], readme='', provedor }) {
  const systemPrompt='Você ajuda a escrever descrições curtas de repositórios GitHub em português do Brasil. Não invente funcionalidades, tecnologias ou finalidade. Use somente os dados fornecidos. Retorne apenas uma descrição em uma única linha, sem aspas, sem markdown e com no máximo 300 caracteres.'
  const pergunta=`REPOSITÓRIO: ${redactAiText(nome)}\nDESCRIÇÃO ATUAL: ${redactAiText(descricaoAtual||'não informada')}\nLINGUAGEM PRINCIPAL: ${redactAiText(linguagem||'não informada')}\nTÓPICOS: ${redactAiText((topicos||[]).join(', ')||'nenhum')}\n\n${wrapUntrusted('README DO REPOSITÓRIO', truncateForTokens(readme||'', 6000))}\n\nEscreva uma descrição objetiva, útil para a página do GitHub e fiel ao projeto.`
  const key=aiCacheKey('github-descricao',{nome,descricaoAtual,linguagem,topicos,readme})
  const result=await enviarMensagem({systemPrompt,pergunta,provedor,profile:'quick',task:'github:descricao',dataClass:'readme',cacheKey:key,cacheTtlMs:6*60*60_000})
  const descricao=String(result.resposta||'').replace(/^```[\s\S]*?\n?/,'').replace(/```$/,'').replace(/^['"“”]+|['"“”]+$/g,'').replace(/\s+/g,' ').trim().slice(0,300)
  if(!descricao) throw new Error('A IA não retornou uma descrição utilizável.')
  return {descricao,_meta:{provedor:result.provedor,modelo:result.modelo,tokens:result.tokens,fallback:Boolean(result.fallback),falhasAnteriores:result.falhasAnteriores||[],cacheHit:Boolean(result.cacheHit)}}
}

const LOG_DIAGNOSTIC_SCHEMA={type:'object',properties:{erro_principal:{type:'string'},etapa:{type:'string'},causa_provavel:{type:'string'},evidencias:{type:'array',items:{type:'string'}},o_que_funcionou:{type:'array',items:{type:'string'}},avisos:{type:'array',items:{type:'string'}},proximos_passos:{type:'array',items:{type:'string'}}},required:['erro_principal','etapa','causa_provavel','evidencias','o_que_funcionou','avisos','proximos_passos'],additionalProperties:false}
const LOG_FIX_SCHEMA={type:'object',properties:{erro_principal:{type:'string'},etapa:{type:'string'},causa_provavel:{type:'string'},evidencias:{type:'array',items:{type:'string'}},correcoes:{type:'array',items:{type:'object',properties:{titulo:{type:'string'},descricao:{type:'string'},arquivos_provaveis:{type:'array',items:{type:'string'}},risco:{type:'string',enum:['baixo','medio','alto']}},required:['titulo','descricao','arquivos_provaveis','risco'],additionalProperties:false}},validacao:{type:'array',items:{type:'string'}}},required:['erro_principal','etapa','causa_provavel','evidencias','correcoes','validacao'],additionalProperties:false}

export async function analisarLogsWorkflow({ repo='', workflow='', run={}, resumo={}, trechos='', modo='diagnostico', provedor }) {
  const corrigir=modo==='correcao'
  const systemPrompt='Você é um assistente técnico especializado em CI/CD e GitHub Actions. Analise apenas os dados reais fornecidos. Não invente arquivos, versões, causas ou comandos. Não exponha segredos. Indique claramente quando a causa for apenas provável.'
  const relevant = selectRelevantLogContext(trechos, 14000)
  const pergunta=`MODO: ${corrigir?'sugerir correções':'diagnosticar'}\nREPOSITÓRIO: ${redactAiText(repo)}\nWORKFLOW: ${redactAiText(workflow||'não informado')}\nRUN: ${JSON.stringify(redactAiData(run||{}))}\nRESUMO ESTRUTURAL: ${JSON.stringify(redactAiData(resumo||{}))}\n\n${wrapUntrusted('LOGS DO GITHUB ACTIONS', relevant)}\n\nSeja objetivo e indique quando a causa for apenas provável.`
  const key=aiCacheKey(`github-log-${modo}`,{repo,workflow,runId:run?.id||run?.run_id||null,resumo,trechos:relevant})
  const result=await enviarJson({systemPrompt,pergunta,schema:corrigir?LOG_FIX_SCHEMA:LOG_DIAGNOSTIC_SCHEMA,schemaName:corrigir?'correcao_workflow':'diagnostico_workflow',provedor,profile:'diagnostics',task:`github:workflow:${modo}`,dataClass:'github_logs',cacheKey:key,cacheTtlMs:24*60*60_000})
  return {...result.data,_meta:{provedor:result.provedor,modelo:result.modelo,tokens:result.tokens,fallback:Boolean(result.fallback),falhasAnteriores:result.falhasAnteriores||[],structuredMode:result.structuredMode,cacheHit:Boolean(result.cacheHit),retries:result.retries||0}}
}

const DIAGNOSTIC_SCHEMA={type:'object',properties:{ok:{type:'boolean'},mensagem:{type:'string'}},required:['ok','mensagem'],additionalProperties:false}

export async function testarProvedorIA({ id, secret, metadata={} }) {
  if (!PROVIDERS.includes(id)) throw new Error('Provedor de IA inválido.')
  const cfg = await providerConfig(id, { value:String(secret||'').trim(), metadata })
  if (!cfg.value) throw new Error('Credencial de IA ausente.')
  const adapter = aiAdapter(id)
  const conn = await adapter.connectivity({ cfg, timeoutMs:12000 })
  const { profile, params } = profileParams(cfg, 'quick', { maxTokens:80, temperature:0 })
  let result, structuredMode='schema'
  try{
    result = await adapter.generate({ cfg, systemPrompt:'Você é um teste de saúde do AL Sistemas.', question:'Retorne um JSON confirmando que a geração está funcionando.', structuredMode:'schema', schema:DIAGNOSTIC_SCHEMA, schemaName:'diagnostico_ia', params, timeoutMs:15000 })
  }catch(err){
    if(![400,404,422].includes(Number(err?.status||0)))throw err
    structuredMode='json'
    result = await adapter.generate({ cfg, systemPrompt:'Você é um teste de saúde do AL Sistemas.', question:'Retorne um objeto JSON com ok=true e uma mensagem curta.', structuredMode:'json', schema:DIAGNOSTIC_SCHEMA, schemaName:'diagnostico_ia', params, timeoutMs:15000 })
  }
  const data = validateStructured(parseJson(result.resposta), DIAGNOSTIC_SCHEMA)
  circuitSuccess(id); recordHealth(id,true,{status:'conectado e geração estruturada funcionando',model:result.modelo,latencyMs:conn.latencyMs})
  return { ok:Boolean(data.ok), mensagem:`${id==='gemini'?'Gemini':'OpenRouter'} conectado • ${result.modelo} • JSON estruturado OK`, model:result.modelo, latencyMs:conn.latencyMs, structured:true, structuredMode, profile:profile.name }
}

export async function listarModelosIA({ id, secret, metadata={} }) {
  if (!PROVIDERS.includes(id)) throw new Error('Provedor de IA inválido.')
  const cfg = await providerConfig(id, { value:String(secret||'').trim(), metadata })
  if (!cfg.value) throw new Error('Credencial de IA ausente.')
  return aiAdapter(id).listModels({ cfg, timeoutMs:15000 })
}

export async function diagnosticarIA({ deep=false }={}) {
  const providers=[]
  for (const id of PROVIDERS) {
    const cfg=await providerConfig(id)
    const circuit=getCircuitStates()[id]
    const last=healthMemory.get(id)
    const item={
      id,nome:id==='gemini'?'Google Gemini':'OpenRouter',configured:Boolean(cfg.value)||Boolean(cfg.locked),usable:Boolean(cfg.value),locked:Boolean(cfg.locked),enabled:cfg.enabled,primary:Boolean(cfg.metadata?.primary),model:cfg.model,source:cfg.source||null,
      ok:false,status:'não configurado',latencyMs:last?.latencyMs||null,lastCheckedAt:last?.checkedAt||null,circuitOpen:Boolean(circuit?.open),retryAfterMs:circuit?.retryAfterMs||0,
    }
    if(cfg.locked&&!cfg.value){ item.status='credencial bloqueada pela chave de criptografia'; providers.push(item); continue }
    if(!cfg.value){ providers.push(item); continue }
    if(!cfg.enabled){ item.status='configurado, porém pausado'; providers.push(item); continue }
    if(!deep){
      item.ok = circuit?.open ? false : (last ? Boolean(last.ok) : true)
      item.status = circuit?.open ? `pausa temporária após falhas (${Math.ceil((circuit.retryAfterMs||0)/1000)} s)` : last?.status || 'configurado; diagnóstico profundo não executado'
      providers.push(item); continue
    }
    try{
      const result=await testarProvedorIA({id,secret:cfg.value,metadata:cfg.metadata})
      item.ok=result.ok; item.status=result.mensagem; item.latencyMs=result.latencyMs; item.structuredOk=result.structured
    }catch(err){
      item.ok=false; item.status=redactAiText(err.message); item.error={status:err.status||null,code:err.code||null}; circuitFailure(id,err); recordHealth(id,false,{status:item.status,model:cfg.model,errorStatus:err.status||null,errorCode:err.code||null})
    }
    const latestCircuit=getCircuitStates()[id]
    item.circuitOpen=Boolean(latestCircuit?.open)
    item.retryAfterMs=latestCircuit?.retryAfterMs||0
    providers.push(item)
  }
  const ativos=providers.filter(p=>p.configured&&p.enabled)
  const ok=ativos.some(p=>p.ok)
  const principal=providers.find(p=>p.primary&&p.enabled&&p.configured)||ativos[0]||null
  return { ok, configured:providers.some(p=>p.configured), status:ok?`${principal?.nome||'IA'} disponível`:providers.some(p=>p.configured)?'IA configurada, mas indisponível':'Gemini/OpenRouter não configurados', principal:principal?{id:principal.id,nome:principal.nome,modelo:principal.model}:null, providers, timeoutMs:AI_TIMEOUT_MS, operationTimeoutMs:AI_OPERATION_TIMEOUT_MS, deep:Boolean(deep), queue:getAiQueueStats(), circuits:getCircuitStates(), profiles:AI_PROFILES }
}

export function resetAiRuntime(provider=null) { resetCircuit(provider); if(provider)healthMemory.delete(provider); else healthMemory.clear() }
