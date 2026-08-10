import fs from 'node:fs/promises'
import path from 'node:path'
import { STATE_DIR } from './systemUpdateService.js'

export const SYSTEM_ERROR_SPOOL_DIR = path.join(STATE_DIR, 'error-spool')

function safeName(value='erro') {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 80)
}

export async function gravarErroSistemaSpool(payload) {
  await fs.mkdir(SYSTEM_ERROR_SPOOL_DIR, { recursive: true })
  const ts = Date.now()
  const file = path.join(SYSTEM_ERROR_SPOOL_DIR, `${ts}-${safeName(payload?.dados?.jobId || payload?.tipo)}-${Math.random().toString(16).slice(2)}.json`)
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ ...payload, capturado_em: new Date().toISOString() }, null, 2))
  await fs.rename(tmp, file)
  return file
}
