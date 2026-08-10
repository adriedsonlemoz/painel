import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const isTermux = Boolean(process.env.TERMUX_VERSION || String(process.env.PREFIX || '').includes('com.termux'))
if (!isTermux) process.exit(0)

console.log('⚡ Preparando cache opcional do Vite no Termux…')
const viteBin = path.resolve('node_modules/.bin/vite')
const result = spawnSync(viteBin, ['optimize'], {
  stdio: 'inherit',
  shell: false,
  timeout: 20000,
  killSignal: 'SIGKILL',
})

if (result.error?.code === 'ETIMEDOUT') {
  console.warn('⚠️ Aquecimento do Vite excedeu 20s e foi interrompido. O build continua válido.')
  process.exit(0)
}
if (result.status !== 0) {
  console.warn('⚠️ Não foi possível pré-aquecer o Vite; o cache será criado no primeiro acesso.')
}
process.exit(0)
