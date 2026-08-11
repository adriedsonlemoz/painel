import mongoose from 'mongoose'
const schema=new mongoose.Schema({
  titulo:{type:String,required:true,trim:true}, assunto:{type:String,required:true,trim:true}, preheader:{type:String,default:''},
  noticia_ids:[{type:mongoose.Schema.Types.ObjectId,ref:'Noticia'}], html:{type:String,default:''}, texto:{type:String,default:''},
  status:{type:String,enum:['rascunho','agendada','enviando','enviada','falhou'],default:'rascunho',index:true},
  agendada_para:{type:Date,default:null,index:true}, enviada_em:{type:Date,default:null}, total_destinatarios:{type:Number,default:0}, total_enviados:{type:Number,default:0}, total_falhas:{type:Number,default:0}, ultimo_erro:{type:String,default:null},
},{timestamps:{createdAt:'criado_em',updatedAt:'atualizado_em'}})
export default mongoose.model('NewsletterCampanha',schema)
