/**
 * useAnalysis.js — Hook: Análise Inteligente (Sprint 4)
 *
 * Sprint 4 — ADIÇÃO PURA.
 * Gerencia carregamento do overview de análise e do chat com IA.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { analysisService } from '../../services/domains/analysis.js'

export function useAnalysisOverview() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro,    setErro]    = useState(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const res = await analysisService.overview()
      setData(res)
    } catch (e) {
      setErro(e.message || 'Erro ao carregar análise')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  return { data, loading, erro, recarregar: carregar }
}

export function useSync(projectName) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [erro,    setErro]    = useState(null)

  const executar = useCallback(async () => {
    if (!projectName) return
    setLoading(true)
    setErro(null)
    try {
      const res = await analysisService.sync(projectName)
      setData(res)
    } catch (e) {
      setErro(e.message || 'Erro ao sincronizar')
    } finally {
      setLoading(false)
    }
  }, [projectName])

  return { data, loading, erro, executar }
}

export function useAIChat() {
  const [mensagens, setMensagens] = useState([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [status, setStatus] = useState('')
  const controllerRef = useRef(null)

  const enviar = useCallback(async (pergunta, contexto = {}) => {
    if (!pergunta?.trim() || loading) return
    const novaMensagem = { role:'user', conteudo:pergunta, timestamp:new Date().toISOString() }
    setMensagens(prev => [...prev, novaMensagem])
    setLoading(true); setErro(null); setStatus('Preparando…')
    const controller = new AbortController(); controllerRef.current = controller
    const assistantId=`ai-${Date.now()}`
    setMensagens(prev => [...prev,{id:assistantId,role:'assistant',conteudo:'',streaming:true,timestamp:new Date().toISOString()}])
    try {
      const historico = mensagens.filter(m=>['user','assistant'].includes(m.role) && m.conteudo).slice(-10).map(m=>({role:m.role,content:m.conteudo}))
      const meta = await analysisService.chatStream(pergunta, contexto, historico, {
        signal:controller.signal,
        onStatus:s=>setStatus(s.mensagem||''),
        onChunk:chunk=>setMensagens(prev=>prev.map(m=>m.id===assistantId?{...m,conteudo:(m.conteudo||'')+chunk}:m)),
      })
      setMensagens(prev=>prev.map(m=>m.id===assistantId?{...m,streaming:false,modelo:meta.modelo,provedor:meta.provedor,tokens:meta.tokens,aviso:meta.aviso}:m))
      setStatus('')
    } catch (e) {
      const cancelled=controller.signal.aborted
      setErro(cancelled?'Geração cancelada.':e.message||'Erro ao consultar IA')
      setMensagens(prev=>prev.map(m=>m.id===assistantId?{...m,role:cancelled?'assistant':'error',streaming:false,conteudo:m.conteudo||(cancelled?'Geração cancelada.':e.message||'Erro ao consultar IA')}:m))
      setStatus('')
    } finally { controllerRef.current=null; setLoading(false) }
  }, [loading, mensagens])

  const cancelar = useCallback(() => { controllerRef.current?.abort(); setStatus('Cancelando…') }, [])
  const limpar = useCallback(() => { controllerRef.current?.abort(); setMensagens([]); setErro(null); setStatus('') }, [])
  return { mensagens, loading, erro, status, enviar, cancelar, limpar }
}

