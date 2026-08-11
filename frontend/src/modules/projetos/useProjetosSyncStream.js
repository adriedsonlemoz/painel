import { useState, useCallback, useRef } from 'react'
import { BASE_URL } from '../../services/domains/http.js'
import { consumeSse } from '../../services/sseFetch.js'

export function useProjetosSyncStream(nomeProjeto) {
  const [eventos,setEventos]=useState([])
  const [etapaAtual,setEtapaAtual]=useState(null)
  const [progresso,setProgresso]=useState(0)
  const [arquivos,setArquivos]=useState([])
  const [status,setStatus]=useState('idle')
  const [relatorio,setRelatorio]=useState(null)
  const controllerRef=useRef(null)
  const addEvento=useCallback(evento=>setEventos(prev=>[...prev,{...evento,id:Date.now()+Math.random()}]),[])

  const iniciarSync=useCallback(()=>{
    controllerRef.current?.abort()
    const controller=new AbortController();controllerRef.current=controller
    setEventos([]);setEtapaAtual(null);setProgresso(0);setArquivos([]);setRelatorio(null);setStatus('running')
    const url=`${BASE_URL}/projetos/${encodeURIComponent(nomeProjeto)}/sync-stream`
    let gotDone=false
    consumeSse(url,{signal:controller.signal,onEvent:data=>{
      switch(data.type){
        case 'ping':break
        case 'narration':addEvento({tipo:'narration',msg:data.msg,nivel:data.nivel||'info',ts:data.ts});break
        case 'step':setEtapaAtual(data.etapa);setProgresso(data.progresso??0);addEvento({tipo:'step',etapa:data.etapa,progresso:data.progresso,ts:data.ts});break
        case 'files':setArquivos(data.arquivos||[]);break
        case 'done':gotDone=true;setStatus(data.status);setRelatorio(data);addEvento({tipo:'done',status:data.status,msg:data.msg,ts:data.ts});controllerRef.current=null;break
        default:break
      }
    }}).then(()=>{if(!gotDone)setStatus(prev=>prev==='running'?'error':prev)}).catch(err=>{
      if(err?.name==='AbortError')return
      setStatus(prev=>{if(prev!=='running')return prev;addEvento({tipo:'narration',msg:err.message||'Conexão com o servidor foi interrompida.',nivel:'error',ts:new Date().toISOString()});return 'error'})
    }).finally(()=>{controllerRef.current=null})
  },[nomeProjeto,addEvento])

  const cancelar=useCallback(()=>{controllerRef.current?.abort();controllerRef.current=null;setStatus('idle')},[])
  const resetar=useCallback(()=>{controllerRef.current?.abort();controllerRef.current=null;setEventos([]);setEtapaAtual(null);setProgresso(0);setArquivos([]);setRelatorio(null);setStatus('idle')},[])
  return {eventos,etapaAtual,progresso,arquivos,status,relatorio,iniciarSync,cancelar,resetar}
}
