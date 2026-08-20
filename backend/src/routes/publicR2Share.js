import { Router } from 'express'
import crypto from 'node:crypto'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import R2Share from '../models/R2Share.js'
import { hydrateCloudflareEnv } from '../utils/cloudflareConfig.js'

const router = Router()

function hashToken(token='') {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function r2S3Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.CF_R2_ENDPOINT || `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY || '',
    },
  })
}

router.get('/:token', async (req, res, next) => {
  try {
    await hydrateCloudflareEnv()
    const share = await R2Share.findOne({ tokenHash: hashToken(req.params.token) }).lean()
    if (!share) return res.status(404).send('Link de compartilhamento não encontrado.')
    if (share.revokedAt) return res.status(410).send('Este link foi revogado.')
    if (new Date(share.expiresAt).getTime() <= Date.now()) return res.status(410).send('Este link expirou.')

    const out = await r2S3Client().send(new GetObjectCommand({ Bucket: share.bucket, Key: share.key }))
    const name = share.key.split('/').filter(Boolean).pop() || 'arquivo'
    res.setHeader('Content-Type', out.ContentType || 'application/octet-stream')
    if (out.ContentLength != null) res.setHeader('Content-Length', String(out.ContentLength))
    if (out.ETag) res.setHeader('ETag', String(out.ETag))
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
    res.setHeader('Cache-Control', 'private, no-store')
    R2Share.updateOne({ _id: share._id }, { $inc: { accessCount: 1 }, $set: { lastAccessAt: new Date() } }).catch(() => {})
    if (out.Body?.pipe) return out.Body.pipe(res)
    const bytes = out.Body?.transformToByteArray ? await out.Body.transformToByteArray() : new Uint8Array()
    res.end(Buffer.from(bytes))
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') return res.status(404).send('Arquivo não encontrado.')
    next(err)
  }
})

export default router
