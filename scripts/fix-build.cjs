'use strict'
// Gera o bundle e empacota o instalador NSIS em build-out/ (CH-BOTS-Setup.exe).
// Não apaga build-out/: builds anteriores e dados do usuário são preservados.
const { execFileSync } = require('child_process')
const path = require('path')

const root = path.resolve(__dirname, '..')
const run = (script, args) =>
  execFileSync(process.execPath, [path.join(root, 'node_modules', script), ...args], { cwd: root, stdio: 'inherit' })

run('electron-vite/bin/electron-vite.js', ['build'])
// Mesmo passo do "postbuild" do npm, que não roda ao chamar electron-vite direto.
run(path.join('..', 'scripts', 'patch-bundle.cjs'), [])
// --config explícito: não depender de qual arquivo de config o electron-builder acha primeiro.
run('electron-builder/cli.js', ['--config', 'electron-builder.yml', '--win', 'nsis', '--publish', 'never'])
