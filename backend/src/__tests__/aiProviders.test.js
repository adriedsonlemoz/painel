import { geminiAdapter, openRouterAdapter } from '../services/aiProviders.js'

describe('Adapters oficiais de IA',()=>{
  const originalFetch=global.fetch
  afterEach(()=>{global.fetch=originalFetch;jest.restoreAllMocks?.()})
  test('Gemini envia API key em x-goog-api-key, nunca na URL',async()=>{
    let seenUrl='',seenHeaders={}
    global.fetch=async(url,opts={})=>{seenUrl=String(url);seenHeaders=opts.headers||{};return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'OK'}]}}],usageMetadata:{}}),{status:200,headers:{'Content-Type':'application/json'}})}
    await geminiAdapter.generate({cfg:{id:'gemini',value:'AIzaTESTESEGREDO123456789012345',model:'gemini-test',metadata:{}},systemPrompt:'x',question:'y',params:{maxTokens:8,temperature:0},timeoutMs:5000})
    expect(seenUrl).not.toContain('key=')
    expect(seenHeaders['x-goog-api-key']).toBe('AIzaTESTESEGREDO123456789012345')
  })
  test('OpenRouter envia Bearer e parâmetros estruturados',async()=>{
    let body,headers
    global.fetch=async(_url,opts={})=>{body=JSON.parse(opts.body);headers=opts.headers;return new Response(JSON.stringify({model:'x',choices:[{message:{content:'{"ok":true}'}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200,headers:{'Content-Type':'application/json'}})}
    await openRouterAdapter.generate({cfg:{id:'openrouter',value:'sk-or-test',model:'free',metadata:{}},systemPrompt:'x',question:'y',structuredMode:'schema',schema:{type:'object'},schemaName:'teste',params:{maxTokens:8,temperature:0},timeoutMs:5000})
    expect(headers.Authorization).toBe('Bearer sk-or-test')
    expect(body.response_format.type).toBe('json_schema')
    expect(body.provider.require_parameters).toBe(true)
  })
})
