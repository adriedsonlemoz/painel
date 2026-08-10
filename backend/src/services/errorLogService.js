import crypto from 'node:crypto'
import ErroLog from '../models/ErroLog.js'

export const ERROR_DEDUP_WINDOW_MS = 60 * 1000

export function fingerprintErro({ tipo, mensagem, rota, stack, dados }) {
  const firstFrame = String(stack || '').split('\n').find(l => /at |https?:|src\//.test(l)) || ''
  const contextKey = dados?.jobId || dados?.source || dados?.requestId || ''
  return crypto.createHash('sha256')
    .update([tipo || '', mensagem || '', rota || '', firstFrame.trim(), contextKey].join('|'))
    .digest('hex')
}

export async function registrarErro({
  tipo,
  mensagem,
  stack = null,
  url = null,
  rota = null,
  user_agent = null,
  usuario_email = null,
  dados = null,
  dedupWindowMs = ERROR_DEDUP_WINDOW_MS,
}) {
  const normalized = {
    tipo,
    mensagem: String(mensagem || '').slice(0, 2000),
    stack: stack ? String(stack).slice(0, 10000) : null,
    url: url ? String(url).slice(0, 500) : null,
    rota: rota ? String(rota).slice(0, 200) : null,
    user_agent: user_agent ? String(user_agent).slice(0, 300) : null,
    usuario_email: usuario_email ? String(usuario_email).slice(0, 200) : null,
    dados: dados || null,
  }
  const fingerprint = fingerprintErro(normalized)
  const agora = new Date()
  const limite = new Date(agora.getTime() - dedupWindowMs)
  let erroSalvo = await ErroLog.findOneAndUpdate(
    { fingerprint, ultima_ocorrencia: { $gte: limite } },
    {
      $inc: { ocorrencias: 1 },
      $set: {
        ultima_ocorrencia: agora,
        url: normalized.url,
        rota: normalized.rota,
        user_agent: normalized.user_agent,
        dados: normalized.dados,
      },
    },
    { new: true }
  )
  if (!erroSalvo) {
    erroSalvo = await ErroLog.create({
      ...normalized,
      fingerprint,
      ocorrencias: 1,
      ultima_ocorrencia: agora,
    })
  }
  return erroSalvo
}
