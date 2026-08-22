import crypto from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function randomBase32(bytes = 20) {
  const data = crypto.randomBytes(bytes)
  let bits = ''
  for (const byte of data) bits += byte.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0')
    out += ALPHABET[parseInt(chunk, 2)]
  }
  return out
}

function decodeBase32(input = '') {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const char of clean) {
    const n = ALPHABET.indexOf(char)
    if (n < 0) continue
    bits += n.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function hotp(secret, counter, digits = 6) {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(buf).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(code % (10 ** digits)).padStart(digits, '0')
}

export function verifyTotp(secret, token, { window = 1, step = 30 } = {}) {
  const clean = String(token || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) return false
  const counter = Math.floor(Date.now() / 1000 / step)
  for (let drift = -window; drift <= window; drift += 1) {
    const expected = hotp(secret, counter + drift)
    try {
      if (crypto.timingSafeEqual(Buffer.from(clean), Buffer.from(expected))) return true
    } catch { /* tamanhos diferentes */ }
  }
  return false
}

export function otpauthUri({ secret, email, issuer = 'AL Sistemas' }) {
  const label = encodeURIComponent(`${issuer}:${email}`)
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

export function recoveryCodes(count = 8) {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-'))
}

export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex')
}
