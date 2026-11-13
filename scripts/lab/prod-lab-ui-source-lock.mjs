#!/usr/bin/env node
/**
 * LAB source-lock: production UI must expose 构建清单 + 复制诊断报告 strings in source.
 * (CF HTML may be client-hydrated; do not require SSR Chinese.)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const files = [
  'apps/lab/src/components/upload/preset-model-selector.tsx',
  'apps/lab/src/app/lab/page.tsx',
]
const checks = [
  { rel: files[0], need: ['构建清单'] },
  { rel: files[1], need: ['复制诊断报告'] },
]
let fail = false
for (const { rel, need } of checks) {
  const abs = path.join(root, rel)
  const text = fs.readFileSync(abs, 'utf8')
  for (const s of need) {
    if (text.includes(s)) {
      console.log(`OK ${rel} contains ${s}`)
    } else {
      console.error(`FAIL ${rel} missing ${s}`)
      fail = true
    }
  }
}
if (fail) process.exit(1)
console.log(JSON.stringify({ ok: true, files }))
