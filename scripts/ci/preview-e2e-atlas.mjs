import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preview } from 'vite'
import { validateFormalSpaHtml } from './assert-formal-spa.mjs'

// Exercise the shipped Atlas assets without sending synthetic activity to Radar.
const html = readFileSync('dist/index.html', 'utf8')
const bootstrapTag = validateFormalSpaHtml(html)
const outDir = mkdtempSync(join(tmpdir(), 'waveworld-preview-'))
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }))
cpSync('dist', outDir, { recursive: true })
writeFileSync(join(outDir, 'index.html'), html.replace(bootstrapTag, '<script type="application/json">'))

await preview({
  build: { outDir },
  preview: { host: '127.0.0.1', port: Number(process.env.E2E_PORT ?? 4173), strictPort: true },
})
