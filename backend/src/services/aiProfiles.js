export const AI_PROFILES = {
  assistant: { priority: 'high', temperature: 0.25, maxTokens: 1400, maxInputTokens: 12000, customInstructions: true, cacheTtlMs: 0 },
  quick: { priority: 'high', temperature: 0.15, maxTokens: 500, maxInputTokens: 5000, customInstructions: false, cacheTtlMs: 15 * 60_000 },
  editorial: { priority: 'normal', temperature: 0.25, maxTokens: 1500, maxInputTokens: 14000, customInstructions: true, cacheTtlMs: 0 },
  seo: { priority: 'normal', temperature: 0.2, maxTokens: 1300, maxInputTokens: 10000, customInstructions: true, cacheTtlMs: 30 * 60_000 },
  diagnostics: { priority: 'high', temperature: 0.1, maxTokens: 1800, maxInputTokens: 18000, customInstructions: false, cacheTtlMs: 24 * 60 * 60_000 },
  rss: { priority: 'background', temperature: 0.2, maxTokens: 1100, maxInputTokens: 10000, customInstructions: true, cacheTtlMs: 24 * 60 * 60_000 },
  translation: { priority: 'low', temperature: 0.05, maxTokens: 700, maxInputTokens: 6000, customInstructions: false, cacheTtlMs: 24 * 60 * 60_000 },
}

export function resolveAiProfile(name = 'assistant', metadata = {}) {
  const base = AI_PROFILES[name] || AI_PROFILES.assistant
  const override = metadata?.profiles?.[name] || {}
  const priorities=new Set(['urgent','high','normal','low','background'])
  const num=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}
  return {
    name,
    priority: priorities.has(override.priority) ? override.priority : base.priority,
    temperature: num(override.temperature,base.temperature,0,2),
    maxTokens: num(override.maxTokens,base.maxTokens,32,32768),
    maxInputTokens: num(override.maxInputTokens,base.maxInputTokens,500,100000),
    customInstructions: override.customInstructions == null ? base.customInstructions : Boolean(override.customInstructions),
    cacheTtlMs: num(override.cacheTtlMs,base.cacheTtlMs,0,7*24*60*60_000),
  }
}
