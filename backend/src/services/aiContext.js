import { redactAiText } from './aiRedactor.js'

export function approxTokens(text = '') { return Math.max(1, Math.ceil(String(text).length / 4)) }

export function truncateForTokens(text = '', maxTokens = 8000) {
  const safe = redactAiText(text)
  const maxChars = Math.max(400, Math.floor(Number(maxTokens || 8000) * 4))
  if (safe.length <= maxChars) return safe
  return `${safe.slice(0, maxChars)}\n…[conteúdo truncado pelo gerenciador de contexto]`
}

export function selectRelevantLogContext(text = '', maxTokens = 12000) {
  const safe = redactAiText(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
  const lines = safe.split(/\r?\n/)
  const important = /error|erro|failed|failure|exception|fatal|panic|stack|traceback|exit code|npm ERR|ERR!|warning|warn|timeout|denied|unauthorized|forbidden/i
  const selected = new Set()
  lines.forEach((line, idx) => {
    if (!important.test(line)) return
    for (let i = Math.max(0, idx - 4); i <= Math.min(lines.length - 1, idx + 8); i++) selected.add(i)
  })
  const ordered = selected.size ? [...selected].sort((a,b)=>a-b).map(i=>lines[i]) : lines.slice(-500)
  return truncateForTokens(ordered.join('\n'), maxTokens)
}
