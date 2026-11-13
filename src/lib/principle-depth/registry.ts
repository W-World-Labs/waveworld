/**
 * Seed calculation methods + principle trees (#86 / #96).
 * Full residual trees live in `parts/<id>.ts`. Product UI uses PRODUCT_CALCULATION_METHODS.
 */
import type { CalculationMethod } from './types'
import {
  PRODUCT_CALCULATION_METHODS,
  resolveDepthSpineId,
  DEPTH_LEGACY_TO_SPINE,
} from '../../data/methods/depthTrees.product'
import { CALCULATION_METHOD_ALFVEN_SPEED } from './parts/method-alfven-speed'
import { CALCULATION_KIND_ELECTRO_THERMAL_IGBT } from './parts/kind-electro-thermal-igbt'
import { CALCULATION_KIND_LBM_D3Q19 } from './parts/kind-lbm-d3q19'
import { CALCULATION_CONVERSION_EFFICIENCY_GENERIC } from './parts/conversion-efficiency-generic'
import { CALCULATION_KIND_ACOUSTICS_3D } from './parts/kind-acoustics-3d'
import { CALCULATION_KIND_MD_LJ } from './parts/kind-md-lj'
import { CALCULATION_KIND_EM_FDTD_3D } from './parts/kind-em-fdtd-3d'
import { CALCULATION_KIND_STRUCTURAL_MINDLIN } from './parts/kind-structural-mindlin'
import { CALCULATION_KIND_PATH_EXPERIMENT } from './parts/kind-path-experiment'

/** Built-in methods for parallel multi-depth explain UI. */
export const CALCULATION_METHODS: CalculationMethod[] = [
  CALCULATION_METHOD_ALFVEN_SPEED,
  CALCULATION_KIND_ELECTRO_THERMAL_IGBT,
  CALCULATION_KIND_LBM_D3Q19,
  CALCULATION_CONVERSION_EFFICIENCY_GENERIC,
  CALCULATION_KIND_ACOUSTICS_3D,
  CALCULATION_KIND_MD_LJ,
  CALCULATION_KIND_EM_FDTD_3D,
  CALCULATION_KIND_STRUCTURAL_MINDLIN,
  CALCULATION_KIND_PATH_EXPERIMENT,
]

// Export-417 (Expectation Failed empty-body honesty residual): no principle-depth method kind — residual noted only (like export-415/416).
//
// Product converge (2026-08): UI + list/get use residual-stripped trees on methods-spine
// ids (src/data/methods/depthTrees.product.ts). Full residual trees stay as LEGACY for
// compose/honesty regression tests and loop gates.

/** @deprecated Prefer PRODUCT_CALCULATION_METHODS — full residual-laden seed. */
export const LEGACY_CALCULATION_METHODS = CALCULATION_METHODS

const byIdLegacy = new Map(LEGACY_CALCULATION_METHODS.map((m) => [m.id, m]))
const byIdProduct = new Map(PRODUCT_CALCULATION_METHODS.map((m) => [m.id, m]))

export { PRODUCT_CALCULATION_METHODS, resolveDepthSpineId, DEPTH_LEGACY_TO_SPINE }

/** Product path: spine-canonical, residual-free. Resolves kind-* aliases. */
export function getCalculationMethod(id: string): CalculationMethod | undefined {
  const spine = resolveDepthSpineId(id)
  return byIdProduct.get(spine)
}

export function listCalculationMethods(): CalculationMethod[] {
  return [...PRODUCT_CALCULATION_METHODS]
}

/** Legacy residual trees (kind-* ids). For tests / CI honesty only. */
export function getLegacyCalculationMethod(id: string): CalculationMethod | undefined {
  return byIdLegacy.get(id) ?? byIdLegacy.get(resolveDepthSpineId(id))
}

export function listLegacyCalculationMethods(): CalculationMethod[] {
  return [...LEGACY_CALCULATION_METHODS]
}
