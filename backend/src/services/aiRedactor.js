const SECRET_PATTERNS = [
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_\-]{12,}\b/g,
  /\bsk-or-[A-Za-z0-9_\-]{12,}\b/g,
  /\bcfat_[A-Za-z0-9_\-]{12,}\b/g,
  /\bAIza[A-Za-z0-9_\-]{20,}\b/g,
  /\bAKIA[A-Z0-9]{12,}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\-/]+=*/gi,
  /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g,
  /mongodb(?:\+srv)?:\/\/([^\s:@/]+):([^\s@/]+)@/gi,
  /([?&](?:token|key|api_key|apikey|secret|signature|sig|access_token)=)[^&\s]+/gi,
  /((?:authorization|cookie|set-cookie|x-api-key|x-goog-api-key|x-apisports-key)\s*[:=]\s*)[^\r\n,;]+/gi,
  /((?:password|passwd|senha|secret|client_secret|private_key)\s*[:=]\s*)[^\s,;]+/gi,
]

export function redactAiText(value = '') {
  let text = String(value ?? '')
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, prefix) => {
      if (/^mongodb/i.test(match)) return match.replace(/\/\/[^@]+@/, '//[SEGREDO]@')
      if (prefix && typeof prefix === 'string' && prefix.length < match.length) return `${prefix}[SEGREDO]`
      return '[SEGREDO]'
    })
  }
  return text
}

export function redactAiData(value, depth = 0) {
  if (depth > 8) return '[TRUNCADO]'
  if (value == null) return value
  if (typeof value === 'string') return redactAiText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(v => redactAiData(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      if (/token|secret|password|senha|cookie|authorization|api[_-]?key|private[_-]?key/i.test(key)) out[key] = '[SEGREDO]'
      else out[key] = redactAiData(val, depth + 1)
    }
    return out
  }
  return String(value)
}

export function wrapUntrusted(label, content) {
  const safeLabel = String(label || 'DADOS EXTERNOS').replace(/[\r\n]+/g, ' ').slice(0, 80)
  return `<<< DADOS NÃO CONFIÁVEIS: ${safeLabel} >>>\n${redactAiText(content)}\n<<< FIM DOS DADOS NÃO CONFIÁVEIS >>>`
}
