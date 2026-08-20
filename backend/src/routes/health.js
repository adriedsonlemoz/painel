/**
 * #9 — Health check detalhado: MongoDB, Redis, Cloudinary, GitHub e IA (Gemini/OpenRouter).
 */
import { getCredential } from '../utils/credentialStore.js'
import { Router } from 'express'
import mongoose from 'mongoose'
import { isRedisDisponivel } from '../utils/redis.js'
import { verificarCloudinary } from '../config/index.js'
import { diagnosticarIA } from '../utils/aiClient.js'
import { getCloudflareConfig } from '../utils/cloudflareConfig.js'

const router = Router()

/** Verifica se o token GitHub está configurado e válido via /rate_limit */
async function verificarGitHub() {
  const { value: token } = await getCredential('github', 'GITHUB_TOKEN')
  if (!token) return { ok: false, status: 'token não configurado' }
  const res = await Promise.race([
    fetch('https://api.github.com/rate_limit', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
  ])
  if (!res.ok) return { ok: false, status: `erro ${res.status}` }
  const data = await res.json()
  const restante = data?.rate?.remaining ?? null
  return {
    ok: true,
    status: restante !== null ? `${restante} req restantes` : 'conectado',
  }
}

/** Verifica Cloudflare (token + S3 credentials) */
async function verificarCloudflare() {
  const cfg = await getCloudflareConfig()
  const token = cfg.apiToken
  const s3Key = cfg.r2AccessKeyId
  const s3Sec = cfg.r2SecretAccessKey
  if (!token) return { ok: false, status: 'CF_API_TOKEN não configurado' }
  try {
    const headers = { Authorization: `Bearer ${token}` }
    const verify = async (url) => Promise.race([
      fetch(url, { headers }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
    ])
    let res = cfg.accountId
      ? await verify(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.accountId)}/tokens/verify`)
      : await verify('https://api.cloudflare.com/client/v4/user/tokens/verify')
    if (!res.ok && cfg.accountId) res = await verify('https://api.cloudflare.com/client/v4/user/tokens/verify')
    if (!res.ok) return { ok: false, status: `token inválido (${res.status})` }
    return {
      ok: true,
      status: s3Key && s3Sec ? 'token + S3 configurados' : 'token ok (S3 ausente)',
    }
  } catch (e) {
    return { ok: false, status: e.message }
  }
}

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Verifica saúde do servidor e dependências
 *     tags: [Sistema]
 *     responses:
 *       200:
 *         description: Servidor saudável
 *       503:
 *         description: MongoDB desconectado
 */
router.get('/', (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1
  res.status(mongoOk ? 200 : 503).json({
    ok: mongoOk,
    env: process.env.NODE_ENV,
    latencia_ms: 0,
    servicos: {
      mongodb: { ok: mongoOk, status: mongoOk ? 'conectado' : 'conectando/desconectado' },
      redis: { ok: isRedisDisponivel(), status: isRedisDisponivel() ? 'conectado' : 'indisponível (cache em memória ativo)' },
    },
    uptime_s: Math.round(process.uptime()),
  })
})

// Diagnóstico profundo para o painel. Serviços externos nunca ficam no caminho
// do health check usado pelo atualizador ou pela inicialização do portal.
router.get('/detalhado', async (_req, res) => {
  const inicio = Date.now()
  const mongoOk     = mongoose.connection.readyState === 1
  const mongoStatus = mongoOk ? 'conectado' : 'desconectado'
  const redisOk     = isRedisDisponivel()
  const redisStatus = redisOk ? 'conectado' : 'indisponível (cache em memória ativo)'

  const [cloudinaryResult, githubResult, iaResult, cloudflareResult] = await Promise.allSettled([
    Promise.race([verificarCloudinary(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]),
    verificarGitHub(), diagnosticarIA({ deep: false }), verificarCloudflare(),
  ])

  const cloudinaryStatus = cloudinaryResult.status === 'fulfilled' ? cloudinaryResult.value : { ok:false, erro:cloudinaryResult.reason?.message ?? 'erro' }
  const githubStatus = githubResult.status === 'fulfilled' ? githubResult.value : { ok:false, status:githubResult.reason?.message ?? 'erro' }
  const iaStatus = iaResult.status === 'fulfilled' ? iaResult.value : { ok:false, status:iaResult.reason?.message ?? 'erro', providers:[] }
  const cloudflareStatus = cloudflareResult.status === 'fulfilled' ? cloudflareResult.value : { ok:false, status:cloudflareResult.reason?.message ?? 'erro' }

  res.status(mongoOk ? 200 : 503).json({
    ok: mongoOk, env: process.env.NODE_ENV, latencia_ms: Date.now() - inicio,
    servicos: {
      mongodb: { ok:mongoOk, status:mongoStatus }, redis:{ ok:redisOk, status:redisStatus },
      cloudinary:{ ok:cloudinaryStatus.ok, status:cloudinaryStatus.ok ? 'conectado' : cloudinaryStatus.erro },
      github:{ ok:githubStatus.ok, status:githubStatus.status },
      ia:{ ok:iaStatus.ok, status:iaStatus.status, principal:iaStatus.principal || null, queue:iaStatus.queue||null, circuits:iaStatus.circuits||{}, providers:(iaStatus.providers || []).map(p=>({ id:p.id, nome:p.nome, ok:p.ok, status:p.status, modelo:p.model, configurado:p.configured, ativo:p.enabled })) },
      cloudflare:{ ok:cloudflareStatus.ok, status:cloudflareStatus.status },
    },
  })
})

export default router
