import mongoose from 'mongoose'

const fonteSchema = new mongoose.Schema({
  nome: { type: String, required: true, trim: true },
  url:{type:String,default:null}, dominio:{type:String,default:null,index:true}, nome_curto:{type:String,default:''}, descricao:{type:String,default:''}, credito_padrao:{type:String,default:''}, ativo:{type:Boolean,default:true,index:true},
  logo_url:{type:String,default:null}, logo_public_id:{type:String,default:null}, logo_alt:{type:String,default:''},
}, { timestamps: { createdAt: 'criado_em' } })

// #10 — toJSON removido: plugin global em server.js já cuida de id/versionKey.

export default mongoose.model('Fonte', fonteSchema)
