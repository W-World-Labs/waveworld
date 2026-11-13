/**
 * Re-export / regenerate product depth trees from LEGACY registry.
 *
 *   npx tsx scripts/methods/migrate-principle-depth-product.ts
 *
 * Writes:
 *   - src/data/methods/depthTrees.product.ts
 *   - runtime/principle-depth-migration-report.json
 *
 * Product trees: residual/honesty KPI nodes stripped (title/id filter);
 * ids remapped kind-* → methods spine.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WW_ROOT = path.resolve(__dirname, '../..')

// Dynamic import of LEGACY array before product override path
// Import the raw registry module — CALCULATION_METHODS is still the full seed array.
const registryUrl = pathToFileURL(
  path.join(WW_ROOT, 'src/lib/principle-depth/registry.ts'),
).href

const { CALCULATION_METHODS } = await import(registryUrl)
import type { CalculationMethod, ExplainNode } from '../../src/lib/principle-depth/types.ts'

function isResidualNode(n: ExplainNode): boolean {
  const title = `${n.id} ${n.titleZh} ${n.titleEn ?? ''}`
  return /residual|残差|Honest|诚实|Dragomir|Hellinger|Bhattacharyya|export-\d+|Compose KPI|合成 KPI|基础 KPI|packaging-honest|joint-max|vs-rect|skillEnvelope|vMeasure|Sexviguple|quinqueviguple|dual residual|联合门/i.test(
    title,
  )
}

function stripResiduals(node: ExplainNode): ExplainNode | null {
  if (isResidualNode(node)) return null
  const kids = (node.children ?? [])
    .map(stripResiduals)
    .filter((c): c is ExplainNode => c != null)
  return { ...node, children: kids.length ? kids : undefined }
}

const CANONICAL: Record<string, string> = {
  'method-alfven-speed': 'method-alfven-speed',
  'kind-electro-thermal-igbt': 'method-electro-thermal-igbt',
  'kind-lbm-d3q19': 'method-lattice-boltzmann',
  'conversion-efficiency-generic': 'method-exergy-analysis',
  'kind-acoustics-3d': 'method-acoustics-3d',
  'kind-md-lj': 'method-md-lj',
  'kind-em-fdtd-3d': 'method-fdtd',
  'kind-structural-mindlin': 'method-structural-mindlin',
  'kind-path-experiment': 'method-photosensitization-kinetics',
}

function countNodes(n: ExplainNode): number {
  return 1 + (n.children ?? []).reduce((s, c) => s + countNodes(c), 0)
}

const productBySpine = new Map<string, CalculationMethod>()
const report: {
  legacyId: string
  spineId: string
  nodesBefore: number
  nodesAfter: number
  dropped: number
}[] = []

for (const m of CALCULATION_METHODS as CalculationMethod[]) {
  const spineId = CANONICAL[m.id]
  if (!spineId) throw new Error(`no canonical for ${m.id}`)
  const cleaned = stripResiduals(m.explainRoot)
  if (!cleaned) throw new Error(`empty tree after strip for ${m.id}`)
  const before = countNodes(m.explainRoot)
  const after = countNodes(cleaned)
  report.push({
    legacyId: m.id,
    spineId,
    nodesBefore: before,
    nodesAfter: after,
    dropped: before - after,
  })

  const entry: CalculationMethod = {
    ...m,
    id: spineId,
    explainRoot: {
      ...cleaned,
      id: `${spineId.replace(/^method-/, '')}-depth-root`,
    },
  }
  const prev = productBySpine.get(spineId)
  if (!prev || countNodes(entry.explainRoot) >= countNodes(prev.explainRoot)) {
    productBySpine.set(spineId, entry)
  }
}

const product = [...productBySpine.values()]

function emitNode(n: ExplainNode, indent: number): string {
  const sp = '  '.repeat(indent)
  const lines: string[] = [`${sp}{`]
  lines.push(`${sp}  id: ${JSON.stringify(n.id)},`)
  lines.push(`${sp}  layer: ${JSON.stringify(n.layer)},`)
  lines.push(`${sp}  titleZh: ${JSON.stringify(n.titleZh)},`)
  if (n.titleEn) lines.push(`${sp}  titleEn: ${JSON.stringify(n.titleEn)},`)
  lines.push(`${sp}  bodyZh: ${JSON.stringify(n.bodyZh)},`)
  if (n.bodyEn) lines.push(`${sp}  bodyEn: ${JSON.stringify(n.bodyEn)},`)
  if (n.formula) lines.push(`${sp}  formula: ${JSON.stringify(n.formula)},`)
  if (n.simMethodIds?.length)
    lines.push(`${sp}  simMethodIds: ${JSON.stringify(n.simMethodIds)},`)
  if (n.jobKinds?.length) lines.push(`${sp}  jobKinds: ${JSON.stringify(n.jobKinds)},`)
  if (n.claimKinds?.length)
    lines.push(`${sp}  claimKinds: ${JSON.stringify(n.claimKinds)},`)
  if (n.children?.length) {
    lines.push(`${sp}  children: [`)
    for (const c of n.children) lines.push(emitNode(c, indent + 2) + ',')
    lines.push(`${sp}  ],`)
  }
  lines.push(`${sp}}`)
  return lines.join('\n')
}

function emitMethod(m: CalculationMethod): string {
  const lines = ['  {']
  lines.push(`    id: ${JSON.stringify(m.id)},`)
  lines.push(`    titleZh: ${JSON.stringify(m.titleZh)},`)
  if (m.titleEn) lines.push(`    titleEn: ${JSON.stringify(m.titleEn)},`)
  lines.push(`    layer: ${JSON.stringify(m.layer)},`)
  lines.push(`    summaryZh: ${JSON.stringify(m.summaryZh)},`)
  if (m.summaryEn) lines.push(`    summaryEn: ${JSON.stringify(m.summaryEn)},`)
  if (m.simMethodIds?.length)
    lines.push(`    simMethodIds: ${JSON.stringify(m.simMethodIds)},`)
  if (m.jobKinds?.length) lines.push(`    jobKinds: ${JSON.stringify(m.jobKinds)},`)
  lines.push(`    explainRoot:`)
  lines.push(emitNode(m.explainRoot, 2) + ',')
  lines.push('  }')
  return lines.join('\n')
}

const header = `/**
 * PRODUCT principle-depth trees — migrated onto methods-spine canonical ids.
 * Residuals / CI honesty KPI nodes stripped (title/id filter).
 *
 * GENERATED — re-run: npx tsx scripts/methods/migrate-principle-depth-product.ts
 * Source of truth for /method-depth product view after converge.
 */
import type { CalculationMethod } from '../../lib/principle-depth/types'

/** Legacy calculation ids → methods spine id */
export const DEPTH_LEGACY_TO_SPINE: Record<string, string> = ${JSON.stringify(CANONICAL, null, 2)} as const

/** All known aliases (legacy + spine) → spine id */
export const DEPTH_ID_ALIASES: Record<string, string> = {
  ...DEPTH_LEGACY_TO_SPINE,
${product.map((m) => `  ${JSON.stringify(m.id)}: ${JSON.stringify(m.id)},`).join('\n')}
}

export function resolveDepthSpineId(id: string): string {
  return DEPTH_ID_ALIASES[id] ?? DEPTH_LEGACY_TO_SPINE[id] ?? id
}

/** Spine-canonical product calculation methods (deduped, residual-free) */
export const PRODUCT_CALCULATION_METHODS: CalculationMethod[] = [
${product.map(emitMethod).join(',\n')}
]
`

const outTs = path.join(WW_ROOT, 'src/data/methods/depthTrees.product.ts')
const outReport = path.join(WW_ROOT, 'runtime/principle-depth-migration-report.json')
mkdirSync(path.dirname(outReport), { recursive: true })
writeFileSync(outTs, header)
writeFileSync(
  outReport,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      productMethodCount: product.length,
      report,
      totalNodesBefore: report.reduce((s, r) => s + r.nodesBefore, 0),
      totalNodesAfter: report.reduce((s, r) => s + r.nodesAfter, 0),
      spineIds: product.map((m) => m.id),
    },
    null,
    2,
  ),
)

console.log(
  JSON.stringify(
    {
      ok: true,
      product: product.length,
      totalBefore: report.reduce((s, r) => s + r.nodesBefore, 0),
      totalAfter: report.reduce((s, r) => s + r.nodesAfter, 0),
      outTs,
    },
    null,
    2,
  ),
)
