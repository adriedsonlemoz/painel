import { api, BASE_URL, authFetch, withAuthHeaders } from './http.js'

function validarImagem(file) {
  if (!file) throw new Error('Nenhum arquivo selecionado')
  if (!file.type.startsWith('image/')) throw new Error('Apenas imagens são permitidas')
  if (file.size > 5 * 1024 * 1024) throw new Error('Imagem deve ter no máximo 5MB')
}

function uploadComProgresso(url, field, file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append(field, file)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    const headers = withAuthHeaders()
    headers.forEach((value, key) => xhr.setRequestHeader(key, value))
    xhr.upload.onprogress = ev => {
      if (ev.lengthComputable) onProgress?.(Math.min(99, Math.round((ev.loaded / ev.total) * 100)))
    }
    xhr.onerror = () => reject(new Error(`Não foi possível conectar ao backend em ${BASE_URL}.`))
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText || '{}') } catch { /* noop */ }
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(data.erro || `Erro ${xhr.status}`))
      onProgress?.(100)
      resolve(data)
    }
    xhr.send(fd)
  })
}

export const storageService = {
  async upload(file, onProgress) {
    validarImagem(file)
    const formData = new FormData()
    formData.append('imagem', file)
    onProgress?.(30)
    const res = await authFetch(`${BASE_URL}/upload`, { method: 'POST', credentials: 'include', body: formData })
    const data = await res.json()
    if (!res.ok) throw new Error(data.erro || 'Erro no upload')
    onProgress?.(100)
    return { url: data.url, public_id: data.public_id, storage: data.storage }
  },

  async uploadNoticia(file, onProgress) {
    validarImagem(file)
    return uploadComProgresso(`${BASE_URL}/upload/noticias`, 'imagem', file, onProgress)
  },

  async remover(public_id) {
    if (!public_id) return
    await api('/upload', { method: 'DELETE', body: JSON.stringify({ public_id }) })
  },
}
