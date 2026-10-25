'use strict'
const fs = require('fs')
const file = 'out/main/index.js'
const src = fs.readFileSync(file, 'utf8')
const fixed = src.replace(
  /\(0,([A-Za-z$_]\w*\.fileURLToPath)\)\(([A-Za-z$_]\w*)\.url\)/g,
  '(0,$1)(require("url").pathToFileURL(__filename).href)'
)
if (fixed !== src) {
  fs.writeFileSync(file, fixed, 'utf8')
  console.log('patch-bundle: corrigido fileURLToPath(import.meta.url) → pathToFileURL(__filename)')
} else if (src.includes('fileURLToPath')) {
  console.error('patch-bundle: ERRO — fileURLToPath encontrado mas padrão não casou. Verifique o bundle.')
  process.exit(1)
} else {
  console.log('patch-bundle: ok — nenhum fileURLToPath no bundle (dependências externalizadas)')
}
