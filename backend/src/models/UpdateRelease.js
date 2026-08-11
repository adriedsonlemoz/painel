import mongoose from 'mongoose'

const platformStateSchema = new mongoose.Schema({
  id: { type:String, default:'' },
  status: { type:String, default:'pending' },
  url: { type:String, default:'' },
  message: { type:String, default:'' },
  checkedAt: { type:Date, default:null },
}, { _id:false })

const updateReleaseSchema = new mongoose.Schema({
  releaseId: { type:String, required:true, unique:true, index:true },
  version: { type:String, required:true, index:true },
  fromVersion: { type:String, default:'' },
  filename: { type:String, required:true },
  packageType: { type:String, default:'full' },
  packageSha256: { type:String, required:true },
  packageBytes: { type:Number, default:0 },
  bucket: { type:String, required:true },
  objectKey: { type:String, required:true },
  storage: { type:String, default:'r2' },
  changelog: { type:String, default:'' },
  integrity: { type:mongoose.Schema.Types.Mixed, default:{} },
  status: { type:String, default:'ready', index:true },
  repository: { type:String, default:'' },
  branch: { type:String, default:'main' },
  publishMode: { type:String, default:'project' },
  commitSha: { type:String, default:'' },
  commitUrl: { type:String, default:'' },
  previousCommitSha: { type:String, default:'' },
  githubStatus: { type:String, default:'pending' },
  vercel: { type:platformStateSchema, default:()=>({}) },
  render: { type:platformStateSchema, default:()=>({}) },
  productionReady: { type:Boolean, default:false },
  error: { type:String, default:'' },
  publishedAt: { type:Date, default:null },
  completedAt: { type:Date, default:null },
}, { timestamps:true })

updateReleaseSchema.index({ createdAt:-1 })

export default mongoose.model('UpdateRelease', updateReleaseSchema)
