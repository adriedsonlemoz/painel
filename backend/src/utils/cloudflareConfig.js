import { getCredential } from './credentialStore.js'

function clean(v){ return String(v ?? '').trim() }

export async function getCloudflareConfig(){
  const stored = await getCredential('cloudflare', 'CF_API_TOKEN')
  let secrets = {}
  if(stored.value){
    try { secrets = JSON.parse(stored.value) } catch { secrets = { apiToken: stored.value } }
  }
  const meta = stored.metadata || {}
  return {
    apiToken: clean(secrets.apiToken || process.env.CF_API_TOKEN),
    accountId: clean(meta.accountId || process.env.CF_ACCOUNT_ID),
    r2AccessKeyId: clean(secrets.r2AccessKeyId || process.env.CF_R2_ACCESS_KEY_ID),
    r2SecretAccessKey: clean(secrets.r2SecretAccessKey || process.env.CF_R2_SECRET_ACCESS_KEY),
    r2Bucket: clean(meta.r2Bucket || process.env.CF_R2_BUCKET),
    r2PublicUrl: clean(meta.r2PublicUrl || process.env.CF_R2_PUBLIC_URL),
    r2Endpoint: clean(meta.r2Endpoint || process.env.CF_R2_ENDPOINT || (clean(meta.accountId || process.env.CF_ACCOUNT_ID) ? `https://${clean(meta.accountId || process.env.CF_ACCOUNT_ID)}.r2.cloudflarestorage.com` : '')),
    source: stored.value ? stored.source : 'environment',
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
