import AiUsage from '../models/AiUsage.js'

export async function recordAiUsage(entry = {}) {
  try {
    await AiUsage.create({
      task: entry.task || 'unknown', profile: entry.profile || 'assistant', provider: entry.provider || null,
      model: entry.model || null, status: entry.status || 'success', inputTokens: Number(entry.inputTokens || 0),
      outputTokens: Number(entry.outputTokens || 0), costUsd: Number(entry.costUsd || 0), latencyMs: Number(entry.latencyMs || 0), queueWaitMs: Number(entry.queueWaitMs || 0),
      fallback: Boolean(entry.fallback), retries: Number(entry.retries || 0), cacheHit: Boolean(entry.cacheHit),
      errorStatus: entry.errorStatus || null, errorCode: entry.errorCode || null,
      errorMessage: entry.errorMessage ? String(entry.errorMessage).slice(0, 500) : null,
      meta: entry.meta || undefined,
    })
  } catch {}
}

export async function getAiUsageSummary(days = 7) {
  const since = new Date(Date.now() - Math.max(1, Math.min(90, Number(days || 7))) * 86400000)
  const rows = await AiUsage.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: {
      _id: null, total: { $sum: 1 }, success: { $sum: { $cond: [{ $in: ['$status',['success','cache']] },1,0] } },
      errors: { $sum: { $cond: [{ $eq: ['$status','error'] },1,0] } }, fallbacks: { $sum: { $cond: ['$fallback',1,0] } },
      cacheHits: { $sum: { $cond: ['$cacheHit',1,0] } }, inputTokens: { $sum: '$inputTokens' }, outputTokens: { $sum: '$outputTokens' }, costUsd: { $sum: '$costUsd' },
      avgLatencyMs: { $avg: '$latencyMs' }, avgQueueWaitMs: { $avg: '$queueWaitMs' },
    } },
  ])
  const providers = await AiUsage.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: '$provider', total: { $sum: 1 }, success: { $sum: { $cond: [{ $in: ['$status',['success','cache']] },1,0] } }, errors: { $sum: { $cond: [{ $eq: ['$status','error'] },1,0] } }, inputTokens: { $sum: '$inputTokens' }, outputTokens: { $sum: '$outputTokens' }, costUsd: { $sum: '$costUsd' }, avgLatencyMs: { $avg: '$latencyMs' } } },
    { $sort: { total: -1 } },
  ])
  const tasks = await AiUsage.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: '$task', total: { $sum: 1 }, errors: { $sum: { $cond: [{ $eq: ['$status','error'] },1,0] } } } },
    { $sort: { total: -1 } }, { $limit: 12 },
  ])
  return { days: Number(days || 7), ...(rows[0] || { total:0,success:0,errors:0,fallbacks:0,cacheHits:0,inputTokens:0,outputTokens:0,avgLatencyMs:0,avgQueueWaitMs:0 }), providers, tasks }
}
