// Corrige fileURLToPath(import.meta.url) em dependências bundladas no main CJS.
// O rolldown substitui import.meta por {} e .url fica undefined → crash na init.
// Padrão minificado: (0,X.fileURLToPath)(Y.url) onde Y={}.
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
} else {
  console.log('patch-bundle: padrão não encontrado (bundle já está limpo)')
}
