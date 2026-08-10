import fs from 'node:fs/promises'
import path from 'node:path'
import { SYSTEM_ERROR_SPOOL_DIR } from './systemErrorSpool.js'
import { registrarErro } from './errorLogService.js'

export async function importarErrosAtualizadorSpool({ limit = 100 } = {}) {
  let imported = 0
  await fs.mkdir(SYSTEM_ERROR_SPOOL_DIR, { recursive: true }).catch(() => {})
  const names = (await fs.readdir(SYSTEM_ERROR_SPOOL_DIR).catch(() => []))
    .filter(n => n.endsWith('.json'))
    .sort()
    .slice(0, limit)
  for (const name of names) {
    const file = path.join(SYSTEM_ERROR_SPOOL_DIR, name)
    try {
      const payload = JSON.parse(await fs.readFile(file, 'utf8'))
      await registrarErro(payload)
      await fs.rm(file, { force: true })
      imported++
    } catch {
      // Mantém o arquivo para nova tentativa quando o banco estiver disponível.
    }
  }
  return imported
}
