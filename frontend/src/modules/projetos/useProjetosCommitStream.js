import { useState, useCallback, useRef } from 'react'
import { BASE_URL } from '../../services/domains/http.js'
import { consumeSse } from '../../services/sseFetch.js'

export function useProjetosCommitStream(nomeProjeto) {
  const [eventos,setEventos]=useState([])
  const [etapaAtual,setEtapaAtual]=useState(null)
  const [progresso,setProgresso]=useState(0)
  const [stepData,setStepData]=useState(null)
  const [arquivos,setArquivos]=useState([])
  const [status,setStatus]=useState('idle')
  const [relatorio,setRelatorio]=useState(null)
  const controllerRef=useRef(null)

  const addEvento=useCallback(evento=>setEventos(prev=>[...prev,{...evento,id:Date.now()+Math.random()}]),[])

  const iniciarCommit=useCallback(({message,branch,autor,destPath,fonte,force=false}={})=>{
    controllerRef.current?.abort()
    const controller=new AbortController()
    controllerRef.current=controller
    setEventos([]);setEtapaAtual(null);setProgresso(0);setStepData(null);setArquivos([]);setRelatorio(null);setStatus('running')

    const url=`${BASE_URL}/projetos/${encodeURIComponent(nomeProjeto)}/commit-stream`
    let gotDone=false
    consumeSse(url,{
      method:'POST',signal:controller.signal,
      body:{message,branch,autor,destPath,fonte,force:String(Boolean(force))},
      onEvent:data=>{
        switch(data.type){
          case 'ping': break
          case 'narration': addEvento({tipo:'narration',msg:data.msg,nivel:data.nivel||'info',ts:data.ts});break
          case 'step':
            setEtapaAtual(data.etapa);setProgresso(data.progresso??0)
            if(data.idx!==undefined)setStepData({idx:data.idx,total:data.total,etapa:data.etapa})
            addEvento({tipo:'step',etapa:data.etapa,progresso:data.progresso,ts:data.ts});break
          case 'files':setArquivos(data.arquivos||[]);break
          case 'done':
            gotDone=true
            setStatus(data.status);setRelatorio(data)
            addEvento({tipo:'done',status:data.status,msg:data.msg,ts:data.ts})
            controllerRef.current=null
            break
          default:break
        }
      }
    }).then(()=>{
      if(!gotDone)setStatus(prev=>prev==='running'?'error':prev)
      controllerRef.current=null
    }).catch(err=>{
      if(err?.name==='AbortError')return
      setStatus(prev=>{
        if(prev!=='running')return prev
        addEvento({tipo:'narration',msg:err.message||'Conexão com o servidor foi interrompida.',nivel:'error',ts:new Date().toISOString()})
        return 'error'
      })
      controllerRef.current=null
    })
  },[nomeProjeto,addEvento])

  const cancelar=useCallback(()=>{controllerRef.current?.abort();controllerRef.current=null;setStatus('idle')},[])
  const resetar=useCallback(()=>{controllerRef.current?.abort();controllerRef.current=null;setEventos([]);setEtapaAtual(null);setProgresso(0);setStepData(null);setArquivos([]);setRelatorio(null);setStatus('idle')},[])

  return {eventos,etapaAtual,progresso,stepData,arquivos,status,relatorio,iniciarCommit,cancelar,resetar}
}
