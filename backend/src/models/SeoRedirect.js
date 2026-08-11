import mongoose from 'mongoose'
const schema=new mongoose.Schema({ origem:{type:String,required:true,unique:true,index:true}, destino:{type:String,required:true}, tipo:{type:Number,default:301}, ativo:{type:Boolean,default:true} },{timestamps:{createdAt:'criado_em',updatedAt:'atualizado_em'}})
export default mongoose.model('SeoRedirect',schema)
