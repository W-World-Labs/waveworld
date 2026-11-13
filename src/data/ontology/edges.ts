import { isConversionEdge, type ConversionEdge } from './types'
import main from './edges.data.json?compressed'
import subform from './edges.subform.data.json?compressed'
import plainZhMap from './edges.plainZh.json?compressed'
import plainEnMap from './edges.plainEn.json?compressed'
import { EDGE_NAME_EN } from './edges.nameEn'
import { EDGE_PRINCIPLE_EN } from './edges.principleEn'
import { EDGE_CONSENSUS_SUMMARY_EN } from './edges.consensusSummaryEn'
import { EDGE_STANCE_EN } from './edges.stanceEn'
import { PRODUCT_MODEL_EN } from './product.modelEn'
import { PRODUCT_SPEC_EN } from './product.specEn'
import { PRODUCT_VENDOR_EN } from './product.vendorEn'

// 转换边数据来自 deep-research + 对抗式物理核查工作流：
//  - edges.data.json     顶层形式间 153 条（10×10 全覆盖）
//  - edges.subform.data.json  8 大类子形态级 74 条
//  - edges.plainZh.json  KUX 靶 G：公式人话一句（只增解释，不改物理/expr）
//  - edges.nameEn.ts     i18n English display names (optional, progressive)
//  - edges.principleEn.ts i18n English principle one-liners (optional, progressive)
// 均经 scripts/clean-edges.mjs 用与 src/lib/formula.ts 同语义的求值器校验+快照
// （每条 Formula 的 expected = evalExpr(expr, sample)，由 ontology.test.ts 永久守护）。
// 合并时按 id 去重（主集优先）；合并后 isConversionEdge 结构校验——坏数据直接 throw。
const seen = new Set<string>()
const merged: ConversionEdge[] = []
for (const [i, raw] of ([...main, ...subform] as unknown[]).entries()) {
  if (!isConversionEdge(raw)) {
    const id = raw && typeof raw === 'object' && 'id' in raw ? String((raw as { id: unknown }).id) : '?'
    throw new Error(`edges data[${i}] id=${id}: invalid ConversionEdge`)
  }
  if (seen.has(raw.id)) continue
  seen.add(raw.id)
  const nameEn = raw.nameEn ?? EDGE_NAME_EN[raw.id]
  const principleEn = raw.principleEn ?? EDGE_PRINCIPLE_EN[raw.id]
  let edge: ConversionEdge = raw
  if (nameEn) edge = { ...edge, nameEn }
  if (principleEn) edge = { ...edge, principleEn }
  // Consensus i18n overlays (do not overwrite existing summaryEn/stanceEn)
  const summaryEn = edge.consensus.summaryEn ?? EDGE_CONSENSUS_SUMMARY_EN[edge.id]
  let consensus = edge.consensus
  if (summaryEn && !edge.consensus.summaryEn) {
    consensus = { ...consensus, summaryEn }
  }
  if (consensus.viewpoints?.length) {
    let touched = false
    const viewpoints = consensus.viewpoints.map((v) => {
      const stanceEn = v.stanceEn ?? EDGE_STANCE_EN[v.stance]
      if (stanceEn && !v.stanceEn) {
        touched = true
        return { ...v, stanceEn }
      }
      return v
    })
    if (touched) consensus = { ...consensus, viewpoints }
  }
  if (consensus !== edge.consensus) edge = { ...edge, consensus }
  // Progressive product i18n overlays (do not overwrite Chinese or existing *En)
  if (edge.products?.length) {
    let productsTouched = false
    const products = edge.products.map((p) => {
      let next = p
      if (p.spec && !p.specEn?.trim()) {
        const specEn = PRODUCT_SPEC_EN[p.spec]?.trim()
        if (specEn) {
          productsTouched = true
          next = { ...next, specEn }
        }
      }
      if (p.vendor && !next.vendorEn?.trim()) {
        const vendorEn = PRODUCT_VENDOR_EN[p.vendor]?.trim()
        if (vendorEn) {
          productsTouched = true
          next = { ...next, vendorEn }
        }
      }
      if (p.model && !next.modelEn?.trim()) {
        const modelEn = PRODUCT_MODEL_EN[p.model]?.trim()
        if (modelEn) {
          productsTouched = true
          next = { ...next, modelEn }
        }
      }
      return next
    })
    if (productsTouched) edge = { ...edge, products }
  }
  merged.push(edge)
}

/** 并入人话 plainZh / plainEn：不覆盖已有字段；未知 id 在测试中拦截。 */
const PLAIN: Record<string, string> = plainZhMap as Record<string, string>
const PLAIN_EN: Record<string, string> = plainEnMap as Record<string, string>
for (const e of merged) {
  if (!e.formula) continue
  let f = e.formula
  const zh = PLAIN[e.id]
  if (zh && !zh.startsWith('_') && !f.plainZh) {
    f = { ...f, plainZh: zh }
  }
  const en = PLAIN_EN[e.id]
  if (en && !en.startsWith('_') && !f.plainEn) {
    f = { ...f, plainEn: en }
  }
  if (f !== e.formula) e.formula = f
}

export const EDGES: ConversionEdge[] = merged

/** 导出 map 供测试：plainZh 词条必须对应真实边 id。 */
export const EDGE_PLAIN_ZH_IDS = Object.keys(PLAIN).filter((k) => !k.startsWith('_'))
