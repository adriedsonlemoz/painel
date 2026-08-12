import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here=path.dirname(fileURLToPath(import.meta.url))
const root=path.resolve(here,'..')
const themeDir=path.join(root,'src/themes')
const required=['--adm-bg','--adm-surface','--adm-surface2','--adm-border','--adm-border2','--adm-text','--adm-muted','--adm-subtle','--adm-accent','--adm-accent-d','--adm-accent-rgb','--adm-red','--adm-amber','--adm-blue','--adm-success','--adm-topnav-bg','--adm-overlay','--adm-shadow','--adm-shadow-md']
const names=['light','dark','ocean','rose']
let failed=false
for(const name of names){
  const mod=await import(pathToFileURL(path.join(themeDir,`${name}.js`)))
  const theme=mod.default
  const missing=required.filter(k=>!theme?.vars?.[k])
  if(missing.length){failed=true;console.error(`✗ ${name}: faltam ${missing.join(', ')}`)}
  else console.log(`✓ ${name}: ${required.length}/${required.length} tokens`)
}
const css=fs.readFileSync(path.join(root,'src/styles/admin.css'),'utf8')
for(const marker of ['gh-repo-workspace','integration-card-grid','cf-central','@media (max-width: 700px)','--adm-overlay']){
  if(!css.includes(marker)){failed=true;console.error(`✗ admin.css: marcador ausente ${marker}`)}
}
if(!failed) console.log('✓ consistência estrutural e responsiva validada')
process.exit(failed?1:0)
