import 'dotenv/config'
import { writeBootstrap } from './src/utils/localVault.js'
const bootstrap={}
for (const key of ['MONGO_URI','MONGO_DB_NAME','JWT_SECRET']) if(process.env[key]) bootstrap[key]=process.env[key]
if(!Object.keys(bootstrap).length){ console.log('Nenhuma configuração de bootstrap encontrada no ambiente.'); process.exit(0) }
writeBootstrap(bootstrap)
console.log(`Migração concluída: ${Object.keys(bootstrap).join(', ')} foram copiadas para o cofre local criptografado.`)
console.log('Valide a reinicialização antes de remover as variáveis antigas. Nunca versione a pasta .al-sistemas/.')
