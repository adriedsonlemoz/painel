const DEFAULT_DB = 'alsistemas'
const DEFAULT_PORT = 27017

function clean(value='') { return String(value ?? '').trim() }
function encode(value='') { return encodeURIComponent(clean(value)) }

function sanitizeAtlasHost(value='') {
  let host = clean(value)
    .replace(/^mongodb\+srv:\/\//i, '')
    .replace(/^mongodb:\/\//i, '')
  // Aceita também uma Connection String completa colada no campo de cluster.
  if (host.includes('@')) host = host.slice(host.lastIndexOf('@') + 1)
  host = host.split(/[/?#]/, 1)[0].trim().replace(/\.$/, '')
  // mongodb+srv resolve a porta via DNS SRV e nunca aceita :27017 (ou qualquer porta explícita).
  host = host.replace(/:\d+$/, '')
  return host
}

export function normalizeMongoProvider(value='') {
  const provider = clean(value).toLowerCase()
  return ['atlas','vps','custom'].includes(provider) ? provider : 'custom'
}

export function buildMongoUri(config = {}) {
  const provider = normalizeMongoProvider(config.provider || config.mongo_provider)
  const databaseName = clean(config.databaseName || config.mongo_db_name) || DEFAULT_DB

  if (provider === 'custom') {
    const uri = clean(config.uri || config.mongo_uri)
    if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) throw new Error('A URI deve começar com mongodb:// ou mongodb+srv://')
    return { provider, uri, databaseName }
  }

  const username = clean(config.username || config.mongo_username)
  const password = clean(config.password || config.mongo_password)
  if (!username) throw new Error('Informe o usuário do MongoDB.')
  if (!password) throw new Error('Informe a senha do MongoDB.')

  if (provider === 'atlas') {
    const host = sanitizeAtlasHost(config.host || config.mongo_host)
    if (!host) throw new Error('Informe o endereço do cluster Atlas.')
    const uri = `mongodb+srv://${encode(username)}:${encode(password)}@${host}/?retryWrites=true&w=majority`
    return { provider, uri, databaseName, host, port: null, authSource: null }
  }

  const host = clean(config.host || config.mongo_host) || '127.0.0.1'
  const port = Number(config.port || config.mongo_port || DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta do MongoDB inválida.')
  const authSource = clean(config.authSource || config.mongo_auth_source) || 'admin'
  const tls = Boolean(config.tls || config.mongo_tls)
  const params = new URLSearchParams({ authSource })
  if (tls) params.set('tls','true')
  const uri = `mongodb://${encode(username)}:${encode(password)}@${host}:${port}/?${params.toString()}`
  return { provider, uri, databaseName, host, port, authSource, tls }
}

export function mongoPublicConfig(vault = {}) {
  const provider = normalizeMongoProvider(vault.MONGO_PROVIDER || (vault.MONGO_URI?.startsWith('mongodb+srv://') ? 'atlas' : vault.MONGO_URI ? 'custom' : 'custom'))
  return {
    provider,
    databaseName: vault.MONGO_DB_NAME || DEFAULT_DB,
    host: vault.MONGO_HOST || '',
    // Atlas (mongodb+srv) resolve a porta por DNS SRV; nunca expor/propagar 27017 nesse modo.
    port: provider === 'atlas' ? null : Number(vault.MONGO_PORT || DEFAULT_PORT),
    authSource: provider === 'atlas' ? '' : (vault.MONGO_AUTH_SOURCE || 'admin'),
    tls: provider === 'atlas' ? false : (vault.MONGO_TLS === true || vault.MONGO_TLS === 'true'),
    usernameConfigured: Boolean(vault.MONGO_USERNAME),
    passwordConfigured: Boolean(vault.MONGO_PASSWORD),
  }
}

export function mongoVaultPatch(result, config = {}) {
  const patch = {
    MONGO_URI: result.uri,
    MONGO_DB_NAME: result.databaseName,
    MONGO_PROVIDER: result.provider,
  }
  if (result.provider !== 'custom') {
    patch.MONGO_HOST = result.host || ''
    patch.MONGO_PORT = result.port ? String(result.port) : ''
    patch.MONGO_AUTH_SOURCE = result.authSource || ''
    patch.MONGO_TLS = result.tls ? 'true' : 'false'
    patch.MONGO_USERNAME = clean(config.username || config.mongo_username)
    patch.MONGO_PASSWORD = clean(config.password || config.mongo_password)
  }
  return patch
}
