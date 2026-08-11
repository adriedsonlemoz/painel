import crypto from 'node:crypto'
import AiCache from '../models/AiCache.js'

export function aiCacheKey(task, payload) {
  return crypto.createHash('sha256').update(`${task}\n${JSON.stringify(payload ?? null)}`).digest('hex')
}

export async function getAiCache(key) {
  if (!key) return null
  try {
    const doc = await AiCache.findOne({ key, expiresAt: { $gt: new Date() } }).lean()
    return doc?.payload ?? null
  } catch { return null }
}

export async function setAiCache(key, task, payload, ttlMs) {
  if (!key || !ttlMs) return
  try {
    await AiCache.findOneAndUpdate({ key }, { $set: { task, payload, expiresAt: new Date(Date.now() + ttlMs), updatedAt: new Date() } }, { upsert: true })
  } catch {}
}
