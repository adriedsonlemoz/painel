import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BACKEND_ROOT = path.resolve(__dirname, '../..')
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION)
// Cofre fora da árvore do projeto: apagar/reinstalar ~/Painel não apaga a
// conexão Mongo nem a chave que protege as credenciais persistidas no banco.
const DEFAULT_DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'al-sistemas-config')
  : path.join(os.homedir(), '.al-sistemas')
const DATA_DIR = path.resolve(process.env.AL_CONFIG_DIR || DEFAULT_DATA_DIR)
const KEY_FILE = path.join(DATA_DIR, 'master.key')
const VAULT_FILE = path.join(DATA_DIR, 'bootstrap.vault.json')
const LEGACY_DIRS = [
  path.join(BACKEND_ROOT, '.al-sistemas'),
  path.resolve('.al-sistemas'),
].filter((v,i,a)=>a.indexOf(v)===i)

function ensureDir() { fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 }) }
function migrateLegacyVaultIfNeeded() {
  if (fs.existsSync(VAULT_FILE)) return
  for (const legacyDir of LEGACY_DIRS) {
    if (path.resolve(legacyDir) === path.resolve(DATA_DIR)) continue
    const legacyVault = path.join(legacyDir, 'bootstrap.vault.json')
    const legacyKey = path.join(legacyDir, 'master.key')
    if (!fs.existsSync(legacyVault)) continue
    // Não importar um cofre órfão sem a chave que o abre; isso só recriaria
    // o erro de autenticação criptográfica na instalação nova.
    if (!fs.existsSync(legacyKey) && !process.env.CREDENTIALS_MASTER_KEY) continue
    ensureDir()
    if (fs.existsSync(legacyKey) && !fs.existsSync(KEY_FILE)) fs.copyFileSync(legacyKey, KEY_FILE)
    fs.copyFileSync(legacyVault, VAULT_FILE)
    try { fs.chmodSync(KEY_FILE, 0o600) } catch {}
    try { fs.chmodSync(VAULT_FILE, 0o600) } catch {}
    return
  }
}
function loadKey() {
  migrateLegacyVaultIfNeeded()
  if (process.env.CREDENTIALS_MASTER_KEY) return crypto.createHash('sha256').update(process.env.CREDENTIALS_MASTER_KEY).digest()
  ensureDir()
  if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('base64url'), { mode: 0o600 })
  return crypto.createHash('sha256').update(fs.readFileSync(KEY_FILE, 'utf8').trim()).digest()
}
function seal(data) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return { v: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: encrypted.toString('base64url') }
}
function open(payload) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(payload.iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64url')), decipher.final()]).toString('utf8'))
}
export function readBootstrap() {
  try {
    migrateLegacyVaultIfNeeded()
    return fs.existsSync(VAULT_FILE) ? open(JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'))) : {}
  } catch { return {} }
}

export function writeBootstrap(patch) {
  ensureDir()
  const next = { ...readBootstrap(), ...patch, updatedAt: new Date().toISOString() }
  const tmp = `${VAULT_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(seal(next), null, 2), { mode: 0o600 })
  fs.renameSync(tmp, VAULT_FILE)
  return next
}
export function deleteBootstrapKeys(keys = []) {
  const next = readBootstrap(); keys.forEach(k => delete next[k]); writeBootstrap(next); return next
}

export function resetBootstrapVault() {
  // Limpar/refazer o setup remove a configuração de bootstrap, mas preserva
  // master.key. Essa chave também protege as credenciais salvas no MongoDB;
  // apagá-la faria GitHub/Cloudinary/IA ficarem ilegíveis após um novo setup.
  try { if (fs.existsSync(VAULT_FILE)) fs.rmSync(VAULT_FILE, { force: true }) } catch {}
  return { dataDir: DATA_DIR, removed: true, masterKeyPreserved:true }
}

export function credentialEncryptionMaterial() {
  if (process.env.CREDENTIALS_MASTER_KEY) return String(process.env.CREDENTIALS_MASTER_KEY)
  migrateLegacyVaultIfNeeded()
  ensureDir()
  if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('base64url'), { mode: 0o600 })
  return fs.readFileSync(KEY_FILE, 'utf8').trim()
}
export function bootstrapValue(key, envName = key) { return readBootstrap()[key] || process.env[envName] || '' }
export function ensureBootstrapSecrets() {
  const current = readBootstrap()
  const patch = {}
  if (!current.JWT_SECRET) patch.JWT_SECRET = crypto.randomBytes(48).toString('base64url')
  if (!current.SETUP_TOKEN) patch.SETUP_TOKEN = crypto.randomBytes(32).toString('base64url')
  const next = Object.keys(patch).length ? writeBootstrap(patch) : current
  process.env.JWT_SECRET = next.JWT_SECRET
  return next
}
export function isBootstrapConfigured() {
  const cfg = readBootstrap()
  return Boolean(cfg.INSTALL_COMPLETED || (cfg.MONGO_URI && cfg.JWT_SECRET))
}
export function isInstallCompleted() { return Boolean(readBootstrap().INSTALL_COMPLETED) }

export function vaultPaths() { return { dataDir: DATA_DIR, keyFile: KEY_FILE, vaultFile: VAULT_FILE } }
