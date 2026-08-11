/**
 * analysis.js — Serviço de domínio: Análise Inteligente (Sprint 4)
 *
 * Sprint 4 — ADIÇÃO PURA.
 */
import { api, authFetch, BASE_URL } from './http.js'

export const analysisService = {
  /** Overview geral: saúde do sistema, alertas, stats */
  overview: () => api('/analysis/overview'),

  /** Comparação local ↔ GitHub de um projeto */
  sync: (projectName) => api(`/analysis/sync/${encodeURIComponent(projectName)}`),

  /** Chat compatível em resposta JSON. */
  chat: (pergunta, contexto = {}, signal) =>
    api('/analysis/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ pergunta, contexto }),
      timeoutMs: 60000,
      signal,
    }),

  /** Streaming SSE do Assistente com cancelamento real. */
  chatStream: async (pergunta, contexto = {}, historico = [], { signal, onChunk, onStatus } = {}) => {
    const res = await authFetch(`${BASE_URL}/analysis/ai/chat/stream`, {
      method:'POST', signal, headers:{'Content-Type':'application/json','Accept':'text/event-stream'},
      body:JSON.stringify({pergunta,contexto,historico}),
    })
    if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.erro||`Erro ${res.status}`)}
    const reader=res.body.getReader(), decoder=new TextDecoder(); let buffer='', finalMeta=null
    while(true){
      const {value,done}=await reader.read(); if(done)break
      buffer+=decoder.decode(value,{stream:true})
      let idx
      while((idx=buffer.indexOf('\n\n'))>=0){
        const block=buffer.slice(0,idx);buffer=buffer.slice(idx+2)
        let event='message',data=''
        for(const line of block.split(/\r?\n/)){if(line.startsWith('event:'))event=line.slice(6).trim();else if(line.startsWith('data:'))data+=line.slice(5).trim()}
        if(!data)continue
        const payload=JSON.parse(data)
        if(event==='chunk')onChunk?.(payload.text||'')
        else if(event==='status')onStatus?.(payload)
        else if(event==='done')finalMeta=payload
        else if(event==='error'){const e=new Error(payload.erro||'Falha na IA');e.status=payload.status;e.codigo=payload.codigo;throw e}
      }
    }
    return finalMeta||{}
  },
}
