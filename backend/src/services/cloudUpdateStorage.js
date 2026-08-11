import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getCredential } from '../utils/credentialStore.js'

function parseCloudflareSecret(value='') {
  try { return JSON.parse(value||'{}') }
  catch { return { apiToken:value||'' } }
}

export async function getR2UpdateConfig() {
  const c=await getCredential('cloudflare','CF_API_TOKEN')
  const parsed=parseCloudflareSecret(c.value)
  const accountId=String(c.metadata?.accountId||process.env.CF_ACCOUNT_ID||'').trim()
  const accessKeyId=String(parsed.r2AccessKeyId||process.env.CF_R2_ACCESS_KEY_ID||'').trim()
  const secretAccessKey=String(parsed.r2SecretAccessKey||process.env.CF_R2_SECRET_ACCESS_KEY||'').trim()
  const bucket=String(c.metadata?.r2Bucket||process.env.CF_R2_BUCKET||'').trim()
  const endpoint=String(c.metadata?.r2Endpoint||process.env.CF_R2_ENDPOINT||(accountId?`https://${accountId}.r2.cloudflarestorage.com`:'' )).trim().replace(/\/$/,'')
  const missing=[]
  if(!accountId)missing.push('Account ID')
  if(!accessKeyId)missing.push('R2 Access Key ID')
  if(!secretAccessKey)missing.push('R2 Secret Access Key')
  if(!bucket)missing.push('Bucket R2')
  if(!endpoint)missing.push('Endpoint R2')
  if(missing.length){
    const e=new Error(`R2 incompleto em Integrações e APIs: ${missing.join(', ')}.`)
    e.code='R2_NOT_CONFIGURED'
    throw e
  }
  return { accountId,accessKeyId,secretAccessKey,bucket,endpoint,source:c.source||null }
}

export function createR2Client(cfg) {
  return new S3Client({
    region:'auto',
    endpoint:cfg.endpoint,
    credentials:{accessKeyId:cfg.accessKeyId,secretAccessKey:cfg.secretAccessKey},
  })
}

export async function storeUpdatePackage(filePath,{version,filename,sha256}) {
  const cfg=await getR2UpdateConfig()
  const stat=await fsp.stat(filePath)
  const safeName=path.basename(filename).replace(/[^A-Za-z0-9._-]+/g,'-')
  const digest=String(sha256||'').replace(/[^a-f0-9]/gi,'').slice(0,16)||'package'
  const key=`updates/${version}/${digest}-${safeName}`
  const client=createR2Client(cfg)
  await client.send(new PutObjectCommand({
    Bucket:cfg.bucket,
    Key:key,
    Body:fs.createReadStream(filePath),
    ContentLength:stat.size,
    ContentType:'application/zip',
    Metadata:{version:String(version),sha256:String(sha256||'')},
  }))
  const head=await client.send(new HeadObjectCommand({Bucket:cfg.bucket,Key:key}))
  return {bucket:cfg.bucket,objectKey:key,bytes:Number(head.ContentLength||stat.size),etag:String(head.ETag||'').replaceAll('"',''),endpoint:cfg.endpoint}
}

export async function downloadUpdatePackage({bucket,objectKey},destination) {
  const cfg=await getR2UpdateConfig()
  if(bucket && bucket!==cfg.bucket) throw new Error(`O pacote está no bucket ${bucket}, mas Integrações e APIs aponta para ${cfg.bucket}.`)
  const client=createR2Client(cfg)
  const result=await client.send(new GetObjectCommand({Bucket:cfg.bucket,Key:objectKey}))
  if(!result.Body)throw new Error('R2 não retornou o conteúdo do pacote.')
  await fsp.mkdir(path.dirname(destination),{recursive:true})
  await pipeline(result.Body,fs.createWriteStream(destination))
  return destination
}

export async function deleteUpdatePackage({bucket,objectKey}) {
  const cfg=await getR2UpdateConfig()
  if(bucket && bucket!==cfg.bucket) throw new Error(`O pacote pertence ao bucket ${bucket}, não ao bucket configurado atualmente.`)
  const client=createR2Client(cfg)
  await client.send(new DeleteObjectCommand({Bucket:cfg.bucket,Key:objectKey}))
  return true
}

export async function testR2UpdateStorage() {
  const cfg=await getR2UpdateConfig()
  const client=createR2Client(cfg)
  // Teste real de S3: evita marcar R2 como conectado apenas porque os campos existem.
  await client.send(new ListObjectsV2Command({Bucket:cfg.bucket,MaxKeys:1,Prefix:'updates/'}))
  return {ok:true,bucket:cfg.bucket,endpoint:cfg.endpoint,source:cfg.source}
}
