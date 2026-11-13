import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const wsimKernelPath = resolve(
  process.cwd(),
  'node_modules/@w-sim/solvers-lbm/dist/wasm-kernel.js',
)
const wsimKernelName = `assets/wsim-lbm-kernel-${createHash('sha256')
  .update(readFileSync(wsimKernelPath))
  .digest('hex')
  .slice(0, 12)}.js`

function sharedWsimKernelPlugin(emitAsset: boolean): Plugin {
  return {
    name: 'shared-wsim-wasm-kernel',
    enforce: 'pre',
    apply: 'build',
    resolveId(source, importer) {
      if (
        source === './wasm-kernel.js' &&
        importer?.replaceAll('\\', '/').endsWith('/@w-sim/solvers-lbm/dist/wasm-kernel-loader.js')
      ) {
        return { id: `/${wsimKernelName}`, external: true }
      }
      return null
    },
    generateBundle() {
      if (emitAsset) {
        this.emitFile({
          type: 'asset',
          fileName: wsimKernelName,
          source: readFileSync(wsimKernelPath),
        })
      }
    },
  }
}

const compressedJsonPlugin: Plugin = {
  name: 'compressed-static-json',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!source.endsWith('.json?compressed') || !importer) return null
    const path = resolve(dirname(importer), source.slice(0, -'?compressed'.length))
    return `\0compressed-json:${Buffer.from(path).toString('base64url')}`
  },
  load(id) {
    const prefix = '\0compressed-json:'
    if (!id.startsWith(prefix)) return null
    const filePath = Buffer.from(id.slice(prefix.length), 'base64url').toString()
    const source = readFileSync(filePath)
    JSON.parse(source.toString('utf8'))
    const encoded = gzipSync(source, { level: 9 }).toString('base64')
    return `import { gunzipSync, strFromU8 } from 'fflate';\nexport default JSON.parse(strFromU8(gunzipSync(Uint8Array.from(atob(${JSON.stringify(encoded)}), c => c.charCodeAt(0)))));`
  },
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const hostTarget = (env.WAVEWORLD_HOST_URL || env.TASK_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '')
  const hostApiProxy = {
    '/api': {
      target: hostTarget,
      changeOrigin: false,
    },
  }
  return {
    plugins: [compressedJsonPlugin, react(), sharedWsimKernelPlugin(true)],
    // Browser clients use relative /api paths in dev as they do behind the
    // production ingress. Only the local proxy knows Host's development URL.
    server: { proxy: hostApiProxy },
    preview: { proxy: hostApiProxy },
    build: {
      outDir: 'dist',
      sourcemap: false,
      // Report large chunks without failing CI; budget gate is scripts/check-bundle-budget.mjs
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Keep three / react vendors split (pre-existing)
            if (id.includes('node_modules/three')) return 'three'
            if (
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react-router') ||
              id.includes('node_modules/react/')
            ) {
              return 'vendor'
            }
            // Ontology edge payload + heavy i18n overlays → dedicated async-friendly chunks (#4)
            if (
              id.includes('/src/data/ontology/edges.data.json') ||
              id.includes('/src/data/ontology/edges.subform.data.json')
            ) {
              return 'edges-data'
            }
            if (
              id.includes('/src/data/ontology/edges.plain') ||
              id.includes('/src/data/ontology/edges.nameEn') ||
              id.includes('/src/data/ontology/edges.principleEn') ||
              id.includes('/src/data/ontology/edges.consensusSummaryEn') ||
              id.includes('/src/data/ontology/edges.stanceEn') ||
              id.includes('/src/data/ontology/edges.efficiencyNoteEn')
            ) {
              return 'edges-i18n'
            }
            if (
              id.includes('/src/data/ontology/product.modelEn') ||
              id.includes('/src/data/ontology/product.specEn') ||
              id.includes('/src/data/ontology/product.vendorEn') ||
              id.includes('/src/data/ontology/device.nameEn') ||
              id.includes('/src/data/ontology/loss.') ||
              id.includes('/src/data/ontology/formula.varMeaningEn') ||
              id.includes('/src/data/ontology/app.nameEn')
            ) {
              return 'ontology-overlays'
            }
          },
        },
      },
    },
    worker: {
      format: 'es',
      plugins: () => [sharedWsimKernelPlugin(false)],
    },
    // 单元测试：只跑 src；e2e/ 由 Playwright 负责（全量路由无头渲染）
    test: {
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.ts'],
      exclude: [
        'node_modules',
        'dist',
        'e2e/**',
        'scripts/research/run-golden-case.test.ts',
        'scripts/research/diagnose-golden-gpu.test.ts',
        'scripts/research/preregistration-v2-draft.test.ts',
      ],
    },
  }
})
