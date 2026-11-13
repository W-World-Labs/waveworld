import type { HostPathExperimentResult, HostPathExperimentSpec } from './hostApi'
import type { HostEvidenceRecord, HostPathEvidence } from './hostApi'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** Parse stable references only; arbitrary snapshot payloads are intentionally rejected. */
export function parseCompareJobIds(value: string | null, limit = 8): string[] {
  return [...new Set((value ?? '').split(',').map((id) => id.trim()).filter((id) => ID_PATTERN.test(id)))].slice(0, limit)
}

export type PathExperimentView = {
  id: string
  title: string
  materials: HostPathExperimentSpec['materials']
  steps: HostPathExperimentSpec['steps']
  parameters: HostPathExperimentSpec['parameters']
  model: HostPathExperimentSpec['model']
  provenance: HostPathExperimentSpec['provenance']
  outputs: HostPathExperimentResult['outputs']
  resultProvenance: HostPathExperimentResult['provenance'] | null
  resultModelVersion: string | null
  resultMatchesSpec: boolean
}

/** Join immutable input and cached output without allowing a mismatched result to masquerade as this experiment. */
export function mapPathExperimentView(
  spec: HostPathExperimentSpec,
  result?: HostPathExperimentResult | null,
): PathExperimentView {
  const matches = result?.experimentId === spec.experimentId
  return {
    id: spec.experimentId,
    title: spec.title,
    materials: spec.materials,
    steps: spec.steps,
    parameters: spec.parameters,
    model: spec.model,
    provenance: spec.provenance,
    outputs: matches ? result.outputs : {},
    resultProvenance: matches ? result.provenance : null,
    resultModelVersion: matches ? result.modelVersion : null,
    resultMatchesSpec: result == null || matches,
  }
}

export function evidenceBinding(record: HostEvidenceRecord, locator: string, transform: string): HostPathEvidence {
  return {
    kind: record.kind,
    evidenceId: record.id,
    sha256: record.sha256,
    locator: locator.trim() || undefined,
    transform: transform.trim() || undefined,
    citation: record.kind === 'literature' ? String(record.metadata.citation ?? record.metadata.doi ?? record.title) : undefined,
    note: `Imported evidence: ${record.title}`,
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/** Minimal instrument CSV profile: required time plus T1 and/or singletO2 columns. */
export function parseCalibrationCsv(text: string): { time: number[]; T1?: number[]; singletO2?: number[] } | null {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean)
  if (rows.length < 2) return null
  const header = rows[0].split(',').map((cell) => cell.trim().toLowerCase())
  const timeIndex = header.indexOf('time')
  const t1Index = header.indexOf('t1')
  const oxygenIndex = header.findIndex((name) => name === 'singleto2' || name === 'singlet_o2' || name === '1o2')
  if (timeIndex < 0 || (t1Index < 0 && oxygenIndex < 0)) return null
  const time: number[] = []; const T1: number[] = []; const singletO2: number[] = []
  for (const row of rows.slice(1)) {
    const cells = row.split(',').map((cell) => cell.trim())
    // Number('') is zero, but an absent observation must never become a measurement.
    if ([timeIndex, t1Index, oxygenIndex].some((index) => index >= 0 && !cells[index])) return null
    const t = Number(cells[timeIndex])
    const triplet = t1Index >= 0 ? Number(cells[t1Index]) : undefined
    const oxygen = oxygenIndex >= 0 ? Number(cells[oxygenIndex]) : undefined
    if (!Number.isFinite(t) || t < 0 || (triplet !== undefined && !Number.isFinite(triplet)) || (oxygen !== undefined && !Number.isFinite(oxygen))) return null
    time.push(t); if (triplet !== undefined) T1.push(triplet); if (oxygen !== undefined) singletO2.push(oxygen)
  }
  if (!time.length) return null
  return { time, ...(t1Index >= 0 ? { T1 } : {}), ...(oxygenIndex >= 0 ? { singletO2 } : {}) }
}
