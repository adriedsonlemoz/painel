import AiJob from '../models/AiJob.js'
import { redactAiData, redactAiText } from './aiRedactor.js'
const controllers=new Map()

export async function createAiJob({type,payload={},createdBy=null,runner}){
  const doc=await AiJob.create({type,payload:redactAiData(payload),createdBy,status:'queued',progress:0,message:'Na fila'})
  const id=String(doc._id), controller=new AbortController(); controllers.set(id,controller)
  setImmediate(async()=>{
    try{
      await AiJob.findByIdAndUpdate(id,{$set:{status:'running',startedAt:new Date(),progress:5,message:'Iniciando'}})
      const update=async(progress,message)=>AiJob.findByIdAndUpdate(id,{$set:{progress:Math.max(0,Math.min(99,Number(progress||0))),message:String(message||'Processando')}}).catch(()=>{})
      const result=await runner({signal:controller.signal,update,jobId:id})
      if(controller.signal.aborted){await AiJob.findByIdAndUpdate(id,{$set:{status:'cancelled',progress:100,message:'Cancelado',finishedAt:new Date()}});return}
      await AiJob.findByIdAndUpdate(id,{$set:{status:'succeeded',progress:100,message:'Concluído',result:redactAiData(result),finishedAt:new Date()}})
    }catch(err){
      await AiJob.findByIdAndUpdate(id,{$set:{status:controller.signal.aborted?'cancelled':'failed',progress:100,message:controller.signal.aborted?'Cancelado':'Falhou',error:{message:redactAiText(err.message).slice(0,800),code:err.code||null,status:err.status||null},finishedAt:new Date()}}).catch(()=>{})
    }finally{controllers.delete(id)}
  })
  return safeJob(doc.toObject())
}

export function safeJob(doc){
  if(!doc)return null
  return {id:String(doc._id),type:doc.type,status:doc.status,progress:doc.progress||0,message:doc.message||'',result:doc.result||null,error:doc.error||null,createdAt:doc.createdAt,startedAt:doc.startedAt,finishedAt:doc.finishedAt}
}
export async function getAiJob(id){
  const doc=await AiJob.findById(id).lean()
  if(doc&&['queued','running'].includes(doc.status)&&Date.now()-new Date(doc.createdAt).getTime()>15*60_000){doc.status='failed';doc.error={message:'Job interrompido por reinício ou tempo excessivo.',code:'AI_JOB_STALE',status:504};doc.progress=100;await AiJob.findByIdAndUpdate(id,{$set:{status:doc.status,error:doc.error,progress:100,finishedAt:new Date()}}).catch(()=>{})}
  return safeJob(doc)
}
export async function cancelAiJob(id){const c=controllers.get(String(id));if(c)c.abort();await AiJob.findByIdAndUpdate(id,{$set:{status:'cancelled',progress:100,message:'Cancelando',finishedAt:new Date()}});return getAiJob(id)}
