import { api } from './http.js'

export const setupService = {
  async status()                  { return api('/setup/status') },
  async instalar(dados)           { return api('/setup', { method: 'POST', body: JSON.stringify(dados) }) },
  async seed({ nome_site = 'AL Sistemas', limpar_antes = false, dados_escolhidos } = {}) {
    return api('/setup/seed', { method: 'POST', body: JSON.stringify({ nome_site, limpar_antes, dados_escolhidos }) })
  },
  async resetDb({ confirmar, manter_usuarios = true } = {}) {
    return api('/setup/reset-db', { method: 'POST', body: JSON.stringify({ confirmar, manter_usuarios }) })
  },
  async lerEnvConfig()            { return api('/setup/env-config') },
  async salvarEnvConfig(dados)    { return api('/setup/env-config', { method: 'POST', body: JSON.stringify(dados) }) },
  async testarMongo(config, mongo_db_name = 'alsistemas') { const body = typeof config === 'string' ? { mongo_uri: config, mongo_db_name } : config; return api('/setup/test-mongo', { method: 'POST', body: JSON.stringify(body) }) },
  async adotarInstalacao(dados)      { return api('/setup/adotar-instalacao', { method: 'POST', body: JSON.stringify(dados) }) },
  async limparConfigLocal()          { return api('/setup/limpar-config-local', { method: 'POST', body: JSON.stringify({ confirmar: 'LIMPAR_CONFIG_LOCAL' }) }) },
  async testarCloudinary(dados)   { return api('/setup/test-cloudinary', { method: 'POST', body: JSON.stringify(dados) }) },
  async desativarArquivo()        { return api('/setup/desativar-arquivo', { method: 'POST' }) },
}
