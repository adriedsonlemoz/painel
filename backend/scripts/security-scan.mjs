import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanSecrets } from '../src/services/securityScanner.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const result = await scanSecrets(root)

console.log(`Security scan: ${result.scannedFiles} arquivo(s), ${result.critical} crítico(s), ${result.high} alto(s).`)
for (const finding of result.findings) {
  console.log(`${finding.severity.toUpperCase()} ${finding.rule} ${finding.file}:${finding.line} ${finding.preview}`)
}
if (result.critical > 0) {
  console.error('Publicação bloqueada: possível segredo crítico de alta confiança detectado.')
  process.exit(1)
}
