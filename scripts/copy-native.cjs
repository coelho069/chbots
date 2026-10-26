'use strict';

// copy-native.cjs — Copia os módulos nativos para o diretório de build.
// Após `electron-vite build`, os módulos TypeScript em src/main/native/
// ficam em out/main/native/, mas os .node compilados ainda não existem.
// Este script garante que os bindings .node estejam disponíveis após o build.

const fs = require('fs');
const path = require('path');

const nativeModules = [
  'screen-capture',
  'ocr',
  'process-list',
  'vm-detection',
];

// Raiz do projeto (onde está o node_modules)
const projectRoot = path.resolve(__dirname, '..');

// Onde os .node dos módulos nativos se encontram (caminho relativo ao Grok Bot)
// Ex: resources/app.asar.unpacked/dist/deps/{module}/build/Release/*.node
const depsRoot = path.resolve(projectRoot, 'resources', 'app.asar.unpacked', 'dist', 'deps');

const srcRoot = path.resolve(projectRoot, 'src', 'main', 'native');
const outRoot = path.resolve(projectRoot, 'out', 'main', 'native');

// Garante que o diretório de saída existe
if (!fs.existsSync(outRoot)) {
  fs.mkdirSync(outRoot, { recursive: true });
  console.log(`copy-native: criado diretório ${outRoot}`);
}

for (const moduleName of nativeModules) {
  // 1. Copia os arquivos TypeScript da src para out
  const srcDir = path.join(srcRoot, moduleName);
  const outDir = path.join(outRoot, moduleName);

  if (fs.existsSync(srcDir)) {
    copyRecursiveSync(srcDir, outDir);
    console.log(`copy-native: copiado ${moduleName}/ (TypeScript) -> ${outDir}`);
  } else {
    console.warn(`copy-native: módulo ${moduleName} não encontrado em src, pulando`);
  }

  // 2. Copia os .node compilados da pasta deps para o out
  const nodeRoot = path.join(depsRoot, moduleName, 'build', 'Release');
  if (fs.existsSync(nodeRoot)) {
    const nodeFiles = fs.readdirSync(nodeRoot).filter(f => f.endsWith('.node'));
    for (const nodeFile of nodeFiles) {
      const srcNode = path.join(nodeRoot, nodeFile);
      const destNode = path.join(outDir, 'build', 'Release', nodeFile);
      // Cria o diretório build/Release se necessário
      const destDir = path.dirname(destNode);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(srcNode, destNode);
      console.log(`copy-native: copiado binário ${nodeFile} -> ${destNode}`);
    }
  } else {
    console.log(`copy-native: ${moduleName} não possui .node compilados em ${nodeRoot}`);
  }
}

function copyRecursiveSync(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const entry of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

