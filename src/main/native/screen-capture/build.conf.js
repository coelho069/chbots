// ============================================================
//  build.conf.js — Configuração de build para screen-capture
//  Usa node-gyp-build v2+ (sem compilação nativa adicional)
//  disponível em: https://github.com/prebuild/node-gyp-build
// ============================================================

const path = require('node:path';

// Força o carregamento do .node compilado para a arquitetura correta
module.exports = process.platform === 'win32' ? 'win32-x64' :
  process.platform === 'darwin' ? 'darwin-x64' :
  process.platform === 'linux' ? 'linux-x64' :
  process.platform;

// Caminho relativo ao .node dentro do diretório de instalação
module.exports.exports = {
  'win32-x64': 'build/Release/screen_capture.node',
  'darwin-x64': 'build/Release/screen_capture.node',
  'linux-x64': 'build/Release/screen_capture.node',
};