import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(import.meta.dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: {
      alias: shared,
      // Força o CJS do node-cron (dist/node-cron.cjs, sem import.meta.url)
      // em vez do ESM (dist/node-cron.js) que quebra no bundle CJS do main.
      mainFields: ['main', 'module']
    },
    build: { minify: true }
  },
  preload: {
    resolve: { alias: shared },
    build: { minify: true }
  },
  renderer: {
    resolve: { alias: shared },
    plugins: [react()],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-xyflow': ['@xyflow/react'],
            'vendor-d3': ['react-force-graph-2d']
          }
        }
      }
    }
  }
})
