const OFFICIAL_ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
}

function endpointBase(cfg) {
  const configured = String(cfg.metadata?.apiUrl || '').trim().replace(/\/$/, '')
  if (!configured) return OFFICIAL_ENDPOINTS[cfg.id]
  try {
    const u = new URL(configured)
    if (cfg.id === 'gemini' && u.hostname === 'generativelanguage.googleapis.com') return configured
    if (cfg.id === 'openrouter' && u.hostname === 'openrouter.ai') return configured
  } catch {}
  return OFFICIAL_ENDPOINTS[cfg.id]
}

function parseRetryAfter(headers) {
  const raw = headers?.get?.('retry-after')
  if (!raw) return 0
  const sec = Number(raw)
  if (Number.isFinite(sec)) return Math.max(0, sec * 1000)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}


function parseRetryAfterData(data) {
  const details = Array.isArray(data?.error?.details) ? data.error.details : []
  for (const item of details) {
    const raw = item?.retryDelay || item?.retry_delay
    if (typeof raw === 'string') {
      const m = raw.match(/^([0-9.]+)s$/i)
      if (m) return Math.max(0, Math.round(Number(m[1]) * 1000))
    }
    if (raw && typeof raw === 'object') {
      const sec = Number(raw.seconds || 0), nanos = Number(raw.nanos || 0)
      if (Number.isFinite(sec) || Number.isFinite(nanos)) return Math.max(0, Math.round((sec || 0) * 1000 + (nanos || 0) / 1e6))
    }
  }
  const msg = String(data?.error?.message || data?.message || '')
  const m = msg.match(/retry(?:\s+in|\s+after)?\s+([0-9.]+)\s*s/i)
  return m ? Math.max(0, Math.round(Number(m[1]) * 1000)) : 0
}

function quotaDetails(data) {
  const details = Array.isArray(data?.error?.details) ? data.error.details : []
  const violations=[]
  for(const item of details){
    const rows=Array.isArray(item?.violations)?item.violations:[]
    for(const v of rows)violations.push({metric:v.quotaMetric||v.metric||'',id:v.quotaId||v.id||'',value:v.quotaValue||v.value||'',dimensions:v.quotaDimensions||v.dimensions||{}})
  }
  return violations.slice(0,8)
}
function makeError(data, status, label, headers) {
  const message = data?.error?.message || data?.message || `${label} respondeu ${status}`
  const e = new Error(message)
  e.status = status
  e.retryAfterMs = Math.max(parseRetryAfter(headers), parseRetryAfterData(data))
  e.quota = quotaDetails(data)
  e.provider = label.toLowerCase()
  return e
}

function signalWithTimeout(timeoutMs, externalSignal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), Math.max(1000, Number(timeoutMs) || 20000))
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason)
    else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true })
  }
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) }
}

async function fetchJson(url, options = {}, timeoutMs = 20000, externalSignal) {
  const { signal, cleanup } = signalWithTimeout(timeoutMs, externalSignal)
  try {
    const res = await fetch(url, { ...options, signal })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  } catch (err) {
    if (signal.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      const e = new Error(externalSignal?.aborted ? 'Operação de IA cancelada.' : `Tempo limite da IA excedido (${Math.round(timeoutMs / 1000)} s)`)
      e.status = externalSignal?.aborted ? 499 : 504
      e.code = externalSignal?.aborted ? 'AI_ABORTED' : 'AI_TIMEOUT'
      throw e
    }
    throw err
  } finally { cleanup() }
}


async function fetchRaw(url, options = {}, timeoutMs = 20000, externalSignal) {
  const { signal, cleanup } = signalWithTimeout(timeoutMs, externalSignal)
  try {
    const res = await fetch(url, { ...options, signal })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw makeError(data, res.status, 'IA', res.headers)
    }
    return { res, cleanup, signal }
  } catch (err) {
    cleanup()
    if (signal.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      const e = new Error(externalSignal?.aborted ? 'Operação de IA cancelada.' : `Tempo limite da IA excedido (${Math.round(timeoutMs / 1000)} s)`)
      e.status = externalSignal?.aborted ? 499 : 504
      e.code = externalSignal?.aborted ? 'AI_ABORTED' : 'AI_TIMEOUT'
      throw e
    }
    throw err
  }
}

async function consumeSse(res, onData) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n')
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx); buffer = buffer.slice(idx + 2)
      for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data && data !== '[DONE]') await onData(data)
      }
    }
  }
  if (buffer.trim()) {
    for (const line of buffer.split(/\r?\n/)) if (line.startsWith('data:')) {
      const data = line.slice(5).trim(); if (data && data !== '[DONE]') await onData(data)
    }
  }
}
function normalizeHistory(history = []) {
  return history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') }))
}

function usageOpenAI(data = {}) {
  return { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0, cost_usd: Number(data.usage?.cost || 0) || 0 }
}

export const openRouterAdapter = {
  id: 'openrouter',
  async generate({ cfg, systemPrompt, question, history = [], structuredMode = null, schema = null, schemaName = 'al_response', params = {}, timeoutMs, signal }) {
    const body = {
      model: cfg.model,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      messages: [{ role: 'system', content: systemPrompt }, ...normalizeHistory(history), { role: 'user', content: question }],
    }
    if (structuredMode === 'schema') {
      body.response_format = { type: 'json_schema', json_schema: { name: String(schemaName).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), strict: true, schema } }
      body.provider = { require_parameters: true }
    } else if (structuredMode === 'json') { body.response_format = { type: 'json_object' }; body.provider = { require_parameters: true } }
    const headers = {
      Authorization: `Bearer ${cfg.value}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost',
      'X-Title': 'AL Sistemas',
    }
    const { res, data } = await fetchJson(`${endpointBase(cfg)}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs, signal)
    if (!res.ok) throw makeError(data, res.status, 'OpenRouter', res.headers)
    const content = data.choices?.[0]?.message?.content || ''
    return { resposta: content, modelo: data.model || cfg.model, tokens: usageOpenAI(data), provedor: 'openrouter', structuredMode }
  },
  async stream({ cfg, systemPrompt, question, history = [], params = {}, timeoutMs, signal, onChunk }) {
    const body = { model: cfg.model, max_tokens: params.maxTokens, temperature: params.temperature, stream: true,
      messages: [{ role:'system', content:systemPrompt }, ...normalizeHistory(history), { role:'user', content:question }] }
    const headers = { Authorization:`Bearer ${cfg.value}`, 'Content-Type':'application/json', 'HTTP-Referer':process.env.FRONTEND_URL||'http://localhost', 'X-Title':'AL Sistemas' }
    const { res, cleanup } = await fetchRaw(`${endpointBase(cfg)}/chat/completions`, { method:'POST', headers, body:JSON.stringify(body) }, timeoutMs, signal)
    let text = '', usage = { input_tokens:0, output_tokens:0 }, model = cfg.model
    try {
      await consumeSse(res, async raw => {
        const data = JSON.parse(raw)
        model = data.model || model
        const delta = data.choices?.[0]?.delta?.content || ''
        if (delta) { text += delta; await onChunk?.(delta) }
        if (data.usage) usage = usageOpenAI(data)
      })
    } finally { cleanup() }
    return { resposta:text, modelo:model, tokens:usage, provedor:'openrouter', streamed:true }
  },
  async connectivity({ cfg, timeoutMs = 12000, signal }) {
    const started = Date.now()
    const { res, data } = await fetchJson(`${endpointBase(cfg)}/models`, { headers: { Authorization: `Bearer ${cfg.value}`, Accept: 'application/json' } }, timeoutMs, signal)
    if (!res.ok) throw makeError(data, res.status, 'OpenRouter', res.headers)
    const models = Array.isArray(data.data) ? data.data : []
    const found = cfg.model === 'openrouter/free' || models.some(m => m.id === cfg.model)
    return { latencyMs: Date.now() - started, model: cfg.model, detail: found ? 'modelo disponível' : `chave válida; modelo ${cfg.model} não apareceu na lista` }
  },
  async listModels({ cfg, timeoutMs = 15000, signal }) {
    const { res, data } = await fetchJson(`${endpointBase(cfg)}/models`, { headers: { Authorization: `Bearer ${cfg.value}`, Accept: 'application/json' } }, timeoutMs, signal)
    if (!res.ok) throw makeError(data, res.status, 'OpenRouter', res.headers)
    return (data.data || []).map(m => ({
      id: m.id, name: m.name || m.id,
      free: Number(m.pricing?.prompt || 1) === 0 && Number(m.pricing?.completion || 1) === 0,
      contextLength: m.context_length || null,
      supportsStructured: Array.isArray(m.supported_parameters) ? m.supported_parameters.some(p => /response_format|structured_outputs/i.test(p)) : null,
    })).filter(m => m.id).sort((a,b) => Number(Boolean(b.free)) - Number(Boolean(a.free)) || a.name.localeCompare(b.name))
  },
}

export const geminiAdapter = {
  id: 'gemini',
  async generate({ cfg, systemPrompt, question, history = [], structuredMode = null, schema = null, params = {}, timeoutMs, signal }) {
    const contents = [
      ...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content ?? '') }] })),
      { role: 'user', parts: [{ text: question }] },
    ]
    const generationConfig = { maxOutputTokens: params.maxTokens }
    if(!/^gemini-3(?:\.|-)/i.test(String(cfg.model||'')))generationConfig.temperature=params.temperature
    if (structuredMode === 'schema') { generationConfig.responseMimeType = 'application/json'; generationConfig.responseJsonSchema = schema }
    else if (structuredMode === 'json') generationConfig.responseMimeType = 'application/json'
    const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.value }
    const { res, data } = await fetchJson(`${endpointBase(cfg)}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST', headers,
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig }),
    }, timeoutMs, signal)
    if (!res.ok) throw makeError(data, res.status, 'Gemini', res.headers)
    return {
      resposta: data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '',
      modelo: cfg.model,
      tokens: { input_tokens: data.usageMetadata?.promptTokenCount || 0, output_tokens: data.usageMetadata?.candidatesTokenCount || 0 },
      provedor: 'gemini', structuredMode,
    }
  },
  async stream({ cfg, systemPrompt, question, history = [], params = {}, timeoutMs, signal, onChunk }) {
    const contents = [...history.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:String(m.content??'')}]})),{role:'user',parts:[{text:question}]}]
    const headers = { 'Content-Type':'application/json', 'x-goog-api-key':cfg.value }
    const generationConfig={maxOutputTokens:params.maxTokens}; if(!/^gemini-3(?:\.|-)/i.test(String(cfg.model||'')))generationConfig.temperature=params.temperature
    const body = { systemInstruction:{parts:[{text:systemPrompt}]}, contents, generationConfig }
    const { res, cleanup } = await fetchRaw(`${endpointBase(cfg)}/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`, { method:'POST', headers, body:JSON.stringify(body) }, timeoutMs, signal)
    let text='', usage={input_tokens:0,output_tokens:0}
    try {
      await consumeSse(res, async raw => {
        const data=JSON.parse(raw)
        const delta=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||''
        if(delta){ text+=delta; await onChunk?.(delta) }
        if(data.usageMetadata) usage={input_tokens:data.usageMetadata.promptTokenCount||usage.input_tokens,output_tokens:data.usageMetadata.candidatesTokenCount||usage.output_tokens}
      })
    } finally { cleanup() }
    return {resposta:text,modelo:cfg.model,tokens:usage,provedor:'gemini',streamed:true}
  },
  async connectivity({ cfg, timeoutMs = 12000, signal }) {
    const started = Date.now()
    const headers = { Accept: 'application/json', 'x-goog-api-key': cfg.value }
    const { res, data } = await fetchJson(`${endpointBase(cfg)}/models/${encodeURIComponent(cfg.model)}`, { headers }, timeoutMs, signal)
    if (!res.ok) throw makeError(data, res.status, 'Gemini', res.headers)
    return { latencyMs: Date.now() - started, model: cfg.model, detail: data.displayName || cfg.model }
  },
  async listModels({ cfg, timeoutMs = 15000, signal }) {
    const headers = { Accept: 'application/json', 'x-goog-api-key': cfg.value }
    const { res, data } = await fetchJson(`${endpointBase(cfg)}/models?pageSize=1000`, { headers }, timeoutMs, signal)
    if (!res.ok) throw makeError(data, res.status, 'Gemini', res.headers)
    return (data.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => ({
      id: String(m.name || '').replace(/^models\//, ''), name: m.displayName || String(m.name || '').replace(/^models\//, ''),
      free: null, contextLength: m.inputTokenLimit || null, supportsStructured: true,
    })).filter(m => m.id)
  },
}

export function aiAdapter(id) {
  if (id === 'gemini') return geminiAdapter
  if (id === 'openrouter') return openRouterAdapter
  throw new Error(`Provedor de IA não suportado: ${id}`)
}
