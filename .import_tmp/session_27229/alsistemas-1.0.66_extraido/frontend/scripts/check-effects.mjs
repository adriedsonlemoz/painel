import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('src')
const problems = []

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full)
    else if (/\.(jsx?|tsx?)$/.test(name)) inspect(full)
  }
}

function inspect(file) {
  const src = fs.readFileSync(file, 'utf8')
  const patterns = [
    { re: /useEffect\s*\(\s*async\b/g, reason: 'useEffect(async ...) retorna Promise' },
    { re: /useEffect\s*\(\s*\(\s*\)\s*=>\s*(?!\{)[A-Za-z_$][\w$]*\s*\(/g, reason: 'useEffect com retorno implícito de chamada; confirme se não retorna Promise' },
  ]
  for (const { re, reason } of patterns) {
    let m
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length
      problems.push(`${path.relative(process.cwd(), file)}:${line} — ${reason}`)
    }
  }
}

walk(root)
if (problems.length) {
  console.error('Possíveis useEffect inseguros encontrados:')
  for (const p of problems) console.error(`- ${p}`)
  process.exit(1)
}
console.log('OK: nenhum padrão conhecido de useEffect com Promise/cleanup inválido foi encontrado.')
