import mongoose from 'mongoose'

const noticiaRevisaoSchema = new mongoose.Schema({
  noticia_id:{ type:mongoose.Schema.Types.ObjectId, ref:'Noticia', required:true, index:true },
  usuario_id:{ type:mongoose.Schema.Types.ObjectId, ref:'Usuario', default:null },
  usuario_nome:{ type:String, default:'' },
  usuario_email:{ type:String, default:'' },
  motivo:{ type:String, enum:['criacao','edicao','autosave','restauracao','status','ia','rss'], default:'edicao' },
  snapshot:{ type:mongoose.Schema.Types.Mixed, required:true },
}, { timestamps:{ createdAt:'criado_em', updatedAt:false } })
noticiaRevisaoSchema.index({ noticia_id:1, criado_em:-1 })
export default mongoose.model('NoticiaRevisao', noticiaRevisaoSchema)
