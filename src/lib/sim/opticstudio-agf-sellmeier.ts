import type { JobSpecV1 } from '@w-sim/contracts'
import type { OpticStudioAgfGlass } from './opticstudio-agf-glass'
import { createModuleJobSpec } from './module-compute'

export interface OpticStudioAgfSellmeierData {
  glassName: string
  formulaId: 2
  minLambdaUm: number
  maxLambdaUm: number
  terms: Array<{ B: number; C: number }>
}

export type OpticStudioAgfSellmeierInput = {
  module: 'sellmeier'
  backend: 'host'
  method: 'method-algo-sellmeier-n-multi'
  lam_um: number
  terms: Array<{ B: number; C: number }>
}

export interface OpticStudioAgfSellmeierJob {
  input: OpticStudioAgfSellmeierInput
  spec: JobSpecV1
  provenance: {
    glassName: string
    lam_um: number
    minLambdaUm: number
    maxLambdaUm: number
    method: 'method-algo-sellmeier-n-multi'
  }
}

function fail(message: string): never {
  throw new Error(message)
}

function recordNumbers(row: string, tag: string): number[] {
  const fields = row.trim().split(/\s+/u)
  if (fields.shift() !== tag) return fail(`AGF ${tag} metadata row is malformed`)
  const values = fields.map((field) => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(field)) {
      return fail(`AGF ${tag} metadata must contain only finite numeric values`)
    }
    const value = Number(field)
    if (!Number.isFinite(value)) return fail(`AGF ${tag} metadata must contain only finite numeric values`)
    return value
  })
  return values
}

/** Read Sellmeier-1 coefficients and the wavelength limits from parsed AGF metadata. */
export function readOpticStudioAgfSellmeier(glass: OpticStudioAgfGlass): OpticStudioAgfSellmeierData {
  if (glass.formulaId !== 2) return fail(`Glass ${glass.name} uses formula ${glass.formulaId}; Sellmeier-1 requires formula 2`)

  const supportedTags = new Set(['ED', 'CD', 'TD', 'MD', 'OD', 'LD', 'IT', 'BD', 'GC'])
  const unsupported = glass.metadata.find((row) => !supportedTags.has(row.tag))
  if (unsupported) return fail(`Glass ${glass.name} contains unsupported AGF record ${unsupported.tag}`)

  const cdRows = glass.metadata.filter((row) => row.tag === 'CD')
  if (cdRows.length !== 1) return fail(`Glass ${glass.name} must contain exactly one CD record`)
  const coefficients = recordNumbers(cdRows[0].raw, 'CD')
  if (coefficients.length !== 2 && coefficients.length !== 4 && coefficients.length !== 6) {
    return fail(`Glass ${glass.name} CD record must contain exactly 2, 4, or 6 coefficients`)
  }

  const ldRows = glass.metadata.filter((row) => row.tag === 'LD')
  if (ldRows.length !== 1) return fail(`Glass ${glass.name} must contain exactly one LD record`)
  const limits = recordNumbers(ldRows[0].raw, 'LD')
  if (limits.length !== 2 || limits[0] <= 0 || limits[1] <= 0 || limits[0] >= limits[1]) {
    return fail(`Glass ${glass.name} LD limits must be finite, positive, and increasing`)
  }

  const terms: Array<{ B: number; C: number }> = []
  for (let i = 0; i < coefficients.length; i += 2) {
    terms.push({ B: coefficients[i], C: coefficients[i + 1] })
  }
  return { glassName: glass.name, formulaId: 2, minLambdaUm: limits[0], maxLambdaUm: limits[1], terms }
}

/** Build the native host job envelope for one wavelength within the glass LD range. */
export function createOpticStudioAgfSellmeierJob(
  glass: OpticStudioAgfGlass,
  lam_um: number,
): OpticStudioAgfSellmeierJob {
  const data = readOpticStudioAgfSellmeier(glass)
  if (!Number.isFinite(lam_um) || lam_um < data.minLambdaUm || lam_um > data.maxLambdaUm) {
    return fail(`Wavelength must be finite and within ${glass.name} LD range ${data.minLambdaUm}–${data.maxLambdaUm} µm`)
  }
  if (data.terms.some(({ C }) => C > 0 && lam_um <= Math.sqrt(C))) {
    return fail('The current native Sellmeier pin requires a wavelength above every Sellmeier pole')
  }
  const input: OpticStudioAgfSellmeierInput = {
    module: 'sellmeier',
    method: 'method-algo-sellmeier-n-multi',
    backend: 'host',
    lam_um,
    terms: data.terms,
  }
  return {
    input,
    spec: createModuleJobSpec(input),
    provenance: {
      glassName: data.glassName,
      lam_um,
      minLambdaUm: data.minLambdaUm,
      maxLambdaUm: data.maxLambdaUm,
      method: 'method-algo-sellmeier-n-multi',
    },
  }
}
