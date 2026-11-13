/**
 * 烟雾路由清单：与 src/nav.ts 单一事实源对齐（无 React 依赖，Playwright 可直接 import）。
 * 新增叶子页时只需改 nav.ts + router 懒加载；e2e 自动覆盖。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ALL_LEAVES, DOMAINS } from '../src/nav'

export type SmokeRoute = { path: string; label: string }

type PhenomenonRow = { id: string; name: string }

const here = dirname(fileURLToPath(import.meta.url))
const phenomena = JSON.parse(
  readFileSync(join(here, '../src/data/ontology/phenomena.data.json'), 'utf8'),
) as PhenomenonRow[]

const home: SmokeRoute = { path: '/', label: '首页' }

const hubs: SmokeRoute[] = DOMAINS.map((d) => ({
  path: `/d/${d.key}`,
  label: `域枢纽 · ${d.label}`,
}))

const leaves: SmokeRoute[] = ALL_LEAVES.map((l) => ({
  path: `/${l.path}`,
  label: l.label,
}))

const phenomenaIndex: SmokeRoute = { path: '/phenomena', label: '前沿现象索引' }

const phenomenonDetails: SmokeRoute[] = phenomena.map((p) => ({
  path: `/phenomena/${p.id}`,
  label: `现象 · ${p.name}`,
}))

/** 去重保序的全量烟雾路径。 */
export const SMOKE_ROUTES: SmokeRoute[] = (() => {
  const seen = new Set<string>()
  const out: SmokeRoute[] = []
  for (const r of [home, ...hubs, ...leaves, phenomenaIndex, ...phenomenonDetails]) {
    if (seen.has(r.path)) continue
    seen.add(r.path)
    out.push(r)
  }
  return out
})()
