import { getCredential } from './credentialStore.js'

function clean(v){ return String(v ?? '').trim() }

export async function getCloudflareConfig(){
  const stored = await getCredential('cloudflare', 'CF_API_TOKEN')
  let secrets = {}
  if(stored.value){
    try { secrets = JSON.parse(stored.value) } catch { secrets = { apiToken: stored.value } }
  }
  const meta = stored.metadata || {}
  const apiTokenStored=clean(secrets.apiToken)
  const r2AccessStored=clean(secrets.r2AccessKeyId)
  const r2SecretStored=clean(secrets.r2SecretAccessKey)
  const accountStored=clean(meta.accountId)
  const bucketStored=clean(meta.r2Bucket)
  const publicUrlStored=clean(meta.r2PublicUrl)
  const endpointStored=clean(meta.r2Endpoint)
  return {
    apiToken: clean(apiTokenStored || process.env.CF_API_TOKEN),
    accountId: clean(accountStored || process.env.CF_ACCOUNT_ID),
    r2AccessKeyId: clean(r2AccessStored || process.env.CF_R2_ACCESS_KEY_ID),
    r2SecretAccessKey: clean(r2SecretStored || process.env.CF_R2_SECRET_ACCESS_KEY),
    r2Bucket: clean(bucketStored || process.env.CF_R2_BUCKET),
    r2PublicUrl: clean(publicUrlStored || process.env.CF_R2_PUBLIC_URL),
    r2Endpoint: clean(endpointStored || process.env.CF_R2_ENDPOINT || (clean(accountStored || process.env.CF_ACCOUNT_ID) ? `https://${clean(accountStored || process.env.CF_ACCOUNT_ID)}.r2.cloudflarestorage.com` : '')),
    source: stored.value ? stored.source : 'environment',
    sources:{
      apiToken:apiTokenStored?(stored.source||'vault'):process.env.CF_API_TOKEN?'environment':null,
      accountId:accountStored?(stored.source||'vault'):process.env.CF_ACCOUNT_ID?'environment':null,
      r2AccessKeyId:r2AccessStored?(stored.source||'vault'):process.env.CF_R2_ACCESS_KEY_ID?'environment':null,
      r2SecretAccessKey:r2SecretStored?(stored.source||'vault'):process.env.CF_R2_SECRET_ACCESS_KEY?'environment':null,
      r2Bucket:bucketStored?(stored.source||'vault'):process.env.CF_R2_BUCKET?'environment':null,
      r2PublicUrl:publicUrlStored?(stored.source||'vault'):process.env.CF_R2_PUBLIC_URL?'environment':null,
      r2Endpoint:endpointStored?(stored.source||'vault'):process.env.CF_R2_ENDPOINT?'environment':null,
    },
    locked: Boolean(stored.locked),
  }
}

export async function hydrateCloudflareEnv(){
  const c = await getCloudflareConfig()
  if(c.apiToken) process.env.CF_API_TOKEN = c.apiToken
  if(c.accountId) process.env.CF_ACCOUNT_ID = c.accountId
  if(c.r2AccessKeyId) process.env.CF_R2_ACCESS_KEY_ID = c.r2AccessKeyId
  if(c.r2SecretAccessKey) process.env.CF_R2_SECRET_ACCESS_KEY = c.r2SecretAccessKey
  if(c.r2Bucket) process.env.CF_R2_BUCKET = c.r2Bucket
  if(c.r2PublicUrl) process.env.CF_R2_PUBLIC_URL = c.r2PublicUrl
  if(c.r2Endpoint) process.env.CF_R2_ENDPOINT = c.r2Endpoint
  return c
}
