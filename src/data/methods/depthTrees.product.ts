/**
 * PRODUCT principle-depth trees — migrated onto methods-spine canonical ids.
 * Residuals / CI honesty KPI nodes stripped (title/id filter).
 *
 * GENERATED — re-run: npx tsx scripts/methods/migrate-principle-depth-product.ts
 * Source of truth for /method-depth product view after converge.
 */
import type { CalculationMethod } from '../../lib/principle-depth/types'
import productData from './depthTrees.product.json?compressed'

/** Legacy calculation ids → methods spine id */
export const DEPTH_LEGACY_TO_SPINE: Record<string, string> = {
  "method-alfven-speed": "method-alfven-speed",
  "kind-electro-thermal-igbt": "method-electro-thermal-igbt",
  "kind-lbm-d3q19": "method-lattice-boltzmann",
  "conversion-efficiency-generic": "method-exergy-analysis",
  "kind-acoustics-3d": "method-acoustics-3d",
  "kind-md-lj": "method-md-lj",
  "kind-em-fdtd-3d": "method-fdtd",
  "kind-structural-mindlin": "method-structural-mindlin",
  "kind-path-experiment": "method-photosensitization-kinetics"
} as const

/** All known aliases (legacy + spine) → spine id */
export const DEPTH_ID_ALIASES: Record<string, string> = {
  ...DEPTH_LEGACY_TO_SPINE,
  "method-alfven-speed": "method-alfven-speed",
  "method-electro-thermal-igbt": "method-electro-thermal-igbt",
  "method-lattice-boltzmann": "method-lattice-boltzmann",
  "method-exergy-analysis": "method-exergy-analysis",
  "method-acoustics-3d": "method-acoustics-3d",
  "method-md-lj": "method-md-lj",
  "method-fdtd": "method-fdtd",
  "method-structural-mindlin": "method-structural-mindlin",
  "method-photosensitization-kinetics": "method-photosensitization-kinetics",
}

export function resolveDepthSpineId(id: string): string {
  return DEPTH_ID_ALIASES[id] ?? DEPTH_LEGACY_TO_SPINE[id] ?? id
}

/** Spine-canonical product calculation methods (deduped, residual-free) */
export const PRODUCT_CALCULATION_METHODS: CalculationMethod[] = productData
