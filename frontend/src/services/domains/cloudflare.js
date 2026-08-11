/**
 * cloudflare.js — Serviço de acesso à API Cloudflare (via backend proxy).
 */
import { api } from './http.js'

export const cloudflareService = {
  /** Verifica token e retorna info da conta */
  async status() {
    return api('/admin/cloudflare/status')
  },


  /** Descobre quais superfícies da conta o token realmente consegue ler */
  async capabilities() {
    return api('/admin/cloudflare/capabilities')
  },

  /** Hub de recursos detectados: Pages, KV, D1, Queues, Vectorize e AI Gateway */
  async resources() {
    return api('/admin/cloudflare/resources')
  },

  async pagesDeployments(project) {
    return api(`/admin/cloudflare/pages/${encodeURIComponent(project)}/deployments`)
  },
  async criarPagesProject(name, productionBranch = 'main') {
    return api('/admin/cloudflare/pages', {
      method: 'POST',
      body: JSON.stringify({ name, production_branch: productionBranch }),
    })
  },
  async deletarPagesProject(project) {
    return api(`/admin/cloudflare/pages/${encodeURIComponent(project)}`, { method:'DELETE' })
  },

  async listarKvNamespaces() { return api('/admin/cloudflare/kv/namespaces') },
  async criarKvNamespace(title) {
    return api('/admin/cloudflare/kv/namespaces', { method:'POST', body:JSON.stringify({title}) })
  },
  async renomearKvNamespace(id, title) {
    return api(`/admin/cloudflare/kv/namespaces/${encodeURIComponent(id)}`, { method:'PUT', body:JSON.stringify({title}) })
  },
  async deletarKvNamespace(id) {
    return api(`/admin/cloudflare/kv/namespaces/${encodeURIComponent(id)}`, { method:'DELETE' })
  },

  async listarD1() { return api('/admin/cloudflare/d1/databases') },
  async criarD1(name) {
    return api('/admin/cloudflare/d1/databases', { method:'POST', body:JSON.stringify({name}) })
  },
  async deletarD1(id) {
    return api(`/admin/cloudflare/d1/databases/${encodeURIComponent(id)}`, { method:'DELETE' })
  },

  async listarQueues() { return api('/admin/cloudflare/queues') },
  async criarQueue(queue_name) {
    return api('/admin/cloudflare/queues', { method:'POST', body:JSON.stringify({queue_name}) })
  },
  async deletarQueue(id) {
    return api(`/admin/cloudflare/queues/${encodeURIComponent(id)}`, { method:'DELETE' })
  },

  async vectorize() { return api('/admin/cloudflare/vectorize') },
  async criarVectorize(name, dimensions = 768, metric = 'cosine', description = '') {
    return api('/admin/cloudflare/vectorize', { method:'POST', body:JSON.stringify({name,dimensions,metric,description}) })
  },
  async deletarVectorize(name) {
    return api(`/admin/cloudflare/vectorize/${encodeURIComponent(name)}`, { method:'DELETE' })
  },
  async aiGateway() { return api('/admin/cloudflare/ai-gateway') },
  async criarAiGateway(id, collect_logs = true) {
    return api('/admin/cloudflare/ai-gateway', { method:'POST', body:JSON.stringify({id,collect_logs}) })
  },
  async deletarAiGateway(id) {
    return api(`/admin/cloudflare/ai-gateway/${encodeURIComponent(id)}`, { method:'DELETE' })
  },

  async definirBucketPadrao(bucket) {
    return api('/admin/cloudflare/r2/default-bucket', {
      method:'POST', body:JSON.stringify({bucket}),
    })
  },

  /** Lista todas as zonas da conta */
  async listarZonas(page = 1, limit = 20, q = '') {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (q) p.set('q', q)
    return api(`/admin/cloudflare/zonas?${p}`)
  },

  /** Lista registros DNS de uma zona */
  async listarDns(zoneId, { page = 1, limit = 50, tipo = '', q = '' } = {}) {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (tipo) p.set('tipo', tipo)
    if (q)    p.set('q', q)
    return api(`/admin/cloudflare/zonas/${zoneId}/dns?${p}`)
  },

  /** Cria um registro DNS */
  async criarDns(zoneId, payload) {
    return api(`/admin/cloudflare/zonas/${zoneId}/dns`, {
      method: 'POST',
      body:   JSON.stringify(payload),
    })
  },

  /** Atualiza um registro DNS */
  async atualizarDns(zoneId, recordId, payload) {
    return api(`/admin/cloudflare/zonas/${zoneId}/dns/${recordId}`, {
      method: 'PUT',
      body:   JSON.stringify(payload),
    })
  },

  /** Remove um registro DNS */
  async removerDns(zoneId, recordId) {
    return api(`/admin/cloudflare/zonas/${zoneId}/dns/${recordId}`, {
      method: 'DELETE',
    })
  },

  /** Analytics de tráfego de uma zona (últimas N horas) */
  async analytics(zoneId, horas = 24) {
    return api(`/admin/cloudflare/zonas/${zoneId}/analytics?horas=${horas}`)
  },

  /** Page rules ativas de uma zona */
  async pagerules(zoneId) {
    return api(`/admin/cloudflare/zonas/${zoneId}/pagerules`)
  },

  /** Eventos de firewall de uma zona */
  async firewall(zoneId, limit = 50) {
    return api(`/admin/cloudflare/zonas/${zoneId}/firewall?limit=${limit}`)
  },

  /** Status SSL/TLS de uma zona */
  async ssl(zoneId) {
    return api(`/admin/cloudflare/zonas/${zoneId}/ssl`)
  },

  /** Workers da conta */
  async workers() {
    return api('/admin/cloudflare/workers')
  },

  /** Purga cache de uma zona (tudo ou URLs específicas) */
  async purgeCache(zoneId, { tudo = false, urls = [] } = {}) {
    return api(`/admin/cloudflare/zonas/${zoneId}/purge`, {
      method: 'POST',
      body:   JSON.stringify({ tudo, urls }),
    })
  },

  /** Upload de um arquivo direto para o R2 via S3 API */
  async uploadObjeto(bucket, prefix, file) {
    const fd = new FormData()
    fd.append('file', file)
    if (prefix) fd.append('prefix', prefix)
    return api(`/admin/cloudflare/r2/buckets/${encodeURIComponent(bucket)}/upload`, {
      method: 'POST',
      body:   fd,
      headers: {},
    })
  },

  // ── R2 ────────────────────────────────────────────────────────

  /** Lista todos os buckets R2 da conta */
  async listarBuckets() {
    return api('/admin/cloudflare/r2/buckets')
  },

  /** Cria um bucket R2 */
  async criarBucket(name, locationHint = '') {
    return api('/admin/cloudflare/r2/buckets', {
      method: 'POST',
      body:   JSON.stringify({ name, locationHint }),
    })
  },

  /** Deleta um bucket R2 */
  async deletarBucket(bucket) {
    return api(`/admin/cloudflare/r2/buckets/${bucket}`, { method: 'DELETE' })
  },

  /** Lista objetos de um bucket (com paginação e prefixo) */
  async listarObjetos(bucket, { prefix = '', cursor = '', limit = 250, delim = '' } = {}) {
    const p = new URLSearchParams({ limit: String(limit) })
    if (prefix) p.set('prefix', prefix)
    if (cursor) p.set('cursor', cursor)
    if (delim)  p.set('delim', delim)
    return api(`/admin/cloudflare/r2/buckets/${encodeURIComponent(bucket)}/objects?${p}`)
  },

  /** Deleta um objeto */
  async deletarObjeto(bucket, key) {
    return api(
      `/admin/cloudflare/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(key)}`,
      { method: 'DELETE' }
    )
  },

  /** Deleta múltiplos objetos */
  async deletarObjetos(bucket, keys) {
    return api(`/admin/cloudflare/r2/buckets/${encodeURIComponent(bucket)}/objects`, {
      method: 'DELETE',
      body:   JSON.stringify({ keys }),
    })
  },

  /** Uso de armazenamento R2 (todos os buckets) */
  async usageR2() {
    return api('/admin/cloudflare/r2/usage')
  },
}
