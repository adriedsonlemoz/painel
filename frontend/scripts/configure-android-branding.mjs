import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res')
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
const stylesPath = path.join(resDir, 'values', 'styles.xml')
const sourceIcon = path.join(root, 'public', 'icons', 'al-sistemas-source.png')
const drawableDir = path.join(resDir, 'drawable-nodpi')
const targetIcon = path.join(drawableDir, 'al_sistemas_icon.png')
const appSurface = '#f0ede8'

function ensureFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} não encontrado: ${file}`)
}

ensureFile(manifestPath, 'AndroidManifest.xml')
ensureFile(stylesPath, 'styles.xml')
ensureFile(sourceIcon, 'Ícone aprovado')

fs.mkdirSync(drawableDir, { recursive: true })
fs.copyFileSync(sourceIcon, targetIcon)

let manifest = fs.readFileSync(manifestPath, 'utf8')
manifest = manifest.replace(/android:icon="[^"]+"/, 'android:icon="@drawable/al_sistemas_icon"')
if (/android:roundIcon="[^"]+"/.test(manifest)) {
  manifest = manifest.replace(/android:roundIcon="[^"]+"/, 'android:roundIcon="@drawable/al_sistemas_icon"')
} else {
  manifest = manifest.replace(/(<application\b[^>]*android:icon="@drawable\/al_sistemas_icon")/, '$1\n        android:roundIcon="@drawable/al_sistemas_icon"')
}
fs.writeFileSync(manifestPath, manifest)

let styles = fs.readFileSync(stylesPath, 'utf8')
const items = [
  ['android:statusBarColor', appSurface],
  ['android:navigationBarColor', appSurface],
  ['android:windowLightStatusBar', 'true'],
  ['android:windowLightNavigationBar', 'true'],
  ['android:windowBackground', appSurface],
]

styles = styles.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/g, (full, attrs, body) => {
  let next = body
  for (const [name, value] of items) {
    const re = new RegExp(`<item\\s+name=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>[\\s\\S]*?<\\/item>`, 'g')
    const item = `\n        <item name="${name}">${value}</item>`
    if (re.test(next)) next = next.replace(re, item.trimStart())
    else next += item
  }
  return `<style${attrs}>${next}\n    </style>`
})
fs.writeFileSync(stylesPath, styles)

console.log(`✓ Ícone AL Sistemas aplicado: ${path.relative(root, targetIcon)}`)
console.log(`✓ Barras do Android alinhadas ao painel: ${appSurface}`)
