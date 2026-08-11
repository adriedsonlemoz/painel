const states = new Map()
const FAILURE_THRESHOLD = Math.max(2, Number(process.env.AI_CIRCUIT_FAILURES || 3))
const DEFAULT_COOLDOWN_MS = Math.max(5000, Number(process.env.AI_CIRCUIT_COOLDOWN_MS || 60000))
const DAILY_QUOTA_COOLDOWN_MS = Math.max(DEFAULT_COOLDOWN_MS, Number(process.env.AI_DAILY_QUOTA_COOLDOWN_MS || 15 * 60_000))

function state(id) {
  if (!states.has(id)) states.set(id, { failures: 0, openUntil: 0, lastError: null, lastSuccessAt: null, lastFailureAt: null })
  return states.get(id)
}

export function circuitCanRun(id) {
  const s = state(id)
  const now = Date.now()
  if (s.openUntil > now) return { ok: false, retryAfterMs: s.openUntil - now, state: { ...s } }
  if (s.openUntil && s.openUntil <= now) { s.openUntil = 0; s.failures = 0 }
  return { ok: true, retryAfterMs: 0, state: { ...s } }
}

export function circuitSuccess(id) {
  const s = state(id)
  s.failures = 0; s.openUntil = 0; s.lastError = null; s.lastSuccessAt = Date.now()
}

export function circuitFailure(id, error = {}) {
  const s = state(id)
  s.failures += 1; s.lastFailureAt = Date.now(); s.lastError = String(error?.message || error || 'falha').slice(0, 300)
  const status = Number(error?.status || 0)
  const explicit = Number(error?.retryAfterMs || 0)
  const authFailure=[401,403].includes(status)
  const quotaText=JSON.stringify(error?.quota||[])
  const dailyQuota=/per.?day|requests?_per_day|daily|free_tier_requests/i.test(quotaText)||/per day|daily quota/i.test(String(error?.message||''))
  if (status === 429 || explicit > 0 || authFailure || s.failures >= FAILURE_THRESHOLD) {
    const exponential = DEFAULT_COOLDOWN_MS * Math.min(4, Math.max(1, s.failures - FAILURE_THRESHOLD + 1))
    const authCooldown=authFailure?Math.max(DEFAULT_COOLDOWN_MS,5*60_000):0
    const quotaCooldown=dailyQuota?DAILY_QUOTA_COOLDOWN_MS:0
    s.openUntil = Date.now() + Math.max(explicit, status === 429 ? DEFAULT_COOLDOWN_MS : 0, authCooldown, quotaCooldown, exponential)
  }
  return { ...s }
}

export function getCircuitStates() {
  const out = {}
  for (const [id, s] of states.entries()) out[id] = { ...s, open: s.openUntil > Date.now(), retryAfterMs: Math.max(0, s.openUntil - Date.now()) }
  return out
}

export function resetCircuit(id) {
  if (id) states.delete(id); else states.clear()
}
