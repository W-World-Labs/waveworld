import { STAR_CCM_CFL_METHOD, STAR_CCM_CFL_MODULE } from './star-ccm-cfl'

export type StarCcmCflResultRow = {
  dt: number
  directionalSpectralRate: number
  localRatio: number
}

const validatedResultBrand: unique symbol = Symbol('validatedStarCcmCflResult')

/** A Host response after its shape and every requested cell row have been checked. */
export type ValidatedStarCcmCflResult = {
  readonly response: Readonly<Record<string, unknown>>
  readonly dtRef: number
  readonly cells: readonly StarCcmCflResultRow[]
  readonly [validatedResultBrand]: true
}

function fail(message: string): never {
  throw new Error(`Invalid directional CFL Host result: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Validate the returned data shape and row count; this does not recalculate CFL physics. */
export function validateStarCcmCflResult(
  value: unknown,
  requestedCellCount: number,
): ValidatedStarCcmCflResult {
  if (!Number.isSafeInteger(requestedCellCount) || requestedCellCount <= 0) {
    fail('requested cell count must be a positive safe integer')
  }
  if (!isRecord(value)) fail('response must be an object')
  if (value.module !== STAR_CCM_CFL_MODULE) fail('module does not match the directional CFL operation')
  if (value.methodId !== STAR_CCM_CFL_METHOD) fail('method does not match the directional CFL operation')
  if (!isRecord(value.result)) fail('result must be an object')

  const result = value.result
  if (!positiveFinite(result.dtRef)) fail('result.dtRef must be a finite positive number')
  const dtRef = result.dtRef
  if (!Array.isArray(result.cells)) fail('result.cells must be an array')
  if (result.cells.length !== requestedCellCount) {
    fail(`result.cells must contain exactly ${requestedCellCount} rows`)
  }

  const cells: StarCcmCflResultRow[] = result.cells.map((row, index) => {
    if (!isRecord(row)) fail(`result.cells row ${index + 1} must be an object`)
    if (!positiveFinite(row.dt)) fail(`result.cells row ${index + 1} dt must be finite and positive`)
    if (!positiveFinite(row.directionalSpectralRate)) {
      fail(`result.cells row ${index + 1} directionalSpectralRate must be finite and positive`)
    }
    if (!positiveFinite(row.localRatio) || row.localRatio > 1) {
      fail(`result.cells row ${index + 1} localRatio must be finite, positive, and at most 1`)
    }
    const expectedRatio = row.dt / dtRef
    const tolerance = 1e-9 * Math.max(Math.abs(expectedRatio), Number.MIN_VALUE)
    if (!Number.isFinite(expectedRatio) || Math.abs(row.localRatio - expectedRatio) > tolerance) {
      fail(`result.cells row ${index + 1} localRatio is inconsistent with dt / dtRef`)
    }
    return {
      dt: row.dt,
      directionalSpectralRate: row.directionalSpectralRate,
      localRatio: row.localRatio,
    }
  })

  return { response: value, dtRef, cells, [validatedResultBrand]: true }
}

/** Format all validated result rows alongside their source IDs, preserving row order. */
export function formatStarCcmCflResultCsv(
  result: ValidatedStarCcmCflResult,
  sourceCellIds: readonly number[],
): string {
  if (!Array.isArray(sourceCellIds) || sourceCellIds.length !== result.cells.length) {
    fail(`source cell IDs must contain exactly ${result.cells.length} entries`)
  }
  const seen = new Set<number>()
  for (let index = 0; index < sourceCellIds.length; index += 1) {
    const id = sourceCellIds[index]
    if (!Number.isSafeInteger(id) || id <= 0) fail(`source cell ID ${index + 1} must be a positive safe integer`)
    if (seen.has(id)) fail(`source cell ID ${id} is repeated`)
    seen.add(id)
  }
  return [
    'cellId,dt,directionalSpectralRate,localRatio',
    ...result.cells.map((row, index) =>
      `${sourceCellIds[index]},${row.dt},${row.directionalSpectralRate},${row.localRatio}`),
  ].join('\n')
}
