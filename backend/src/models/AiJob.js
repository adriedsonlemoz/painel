import mongoose from 'mongoose'
const schema=new mongoose.Schema({
  type:{type:String,index:true}, status:{type:String,enum:['queued','running','succeeded','failed','cancelled'],default:'queued',index:true},
  progress:{type:Number,default:0}, message:String, payload:mongoose.Schema.Types.Mixed, result:mongoose.Schema.Types.Mixed,
  error:{message:String,code:String,status:Number}, createdBy:String,
  createdAt:{type:Date,default:Date.now,index:true}, startedAt:Date, finishedAt:Date,
  expiresAt:{type:Date,default:()=>new Date(Date.now()+7*86400000),index:true,expires:0},
},{versionKey:false})
export default mongoose.model('AiJob',schema)
