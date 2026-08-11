import mongoose from 'mongoose'

const categoriaSchema = new mongoose.Schema({
  nome:      { type: String, required: true, trim: true },
  slug:      { type: String, required: true, unique: true, trim: true },
  descricao: { type: String, default: '', trim: true },
  cor:       { type:String, default:'#1B5E3B' },
  icone:     { type:String, default:'', trim:true },
  ordem:     { type:Number, default:0, index:true },
  destaque:  { type:Boolean, default:false },
  ativa:     { type:Boolean, default:true },
  protegida: { type:Boolean, default:false },
  categoria_pai_id:{ type:mongoose.Schema.Types.ObjectId, ref:'Categoria', default:null },
  imagem_url:{ type:String, default:null }, imagem_public_id:{type:String,default:null}, imagem_alt:{type:String,default:''},
  seo_titulo:{type:String,default:null,maxlength:120}, seo_descricao:{type:String,default:null,maxlength:180},
}, { timestamps: { createdAt: 'criado_em' } })

// #10 — toJSON removido: plugin global em server.js já cuida de id/versionKey.

export default mongoose.model('Categoria', categoriaSchema)
