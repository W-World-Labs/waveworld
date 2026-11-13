import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import {
  createDefaultCstWaveguideStudy,
  createCstWaveguideStudyJob,
  parseCstWaveguideStudyResult,
} from './cst-waveguide-study.js'

const captured = createCstWaveguideStudyJob(createDefaultCstWaveguideStudy())
const input = captured.input

// Shape and values from waveguide_modes.rs::run_cst_field_samples. The
// parser checks this native response against the submitted input; it must not
// calculate replacement field values in the browser.
const nativeResponse = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1, wallTimeMs: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    module: 'waveguide-modes',
    backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
    result: {
      operation: 'cst-waveguide-electric-field-samples',
      familyId: 'method-waveguide-modes',
      family: input.family,
      m: input.m,
      n: input.n,
      frequencyHz: input.frequency,
      cutoffHz: 6_557_091_930.43,
      betaRadPerM: 144.4,
      normalization: 'peak Hz = 1 A/m',
      fieldSamples: input.fieldSamples.map((point: { x: number; y: number }, index: number) => ({
        x: point.x,
        y: point.y,
        exMagnitude: 0,
        eyMagnitude: index === 0 ? 1.0 : 0.75,
        ezMagnitude: 0,
      })),
      finite: true,
      ok: true,
      ...overrides,
    },
  },
})

const parse = (response: unknown = nativeResponse(), submitted = input) =>
  // The parser boundary accepts a contract-typed host envelope; the deliberate
  // cast lets these fixtures exercise malformed envelopes at runtime.
  parseCstWaveguideStudyResult(response as JobResultV1, submitted)

describe('CST waveguide field study', () => {
  it('builds the exact pinned host operation and retains the submitted job input', () => {
    expect(input).toMatchObject({
      module: 'waveguide-modes',
      backend: 'host',
      operation: 'cst-waveguide-electric-field-samples',
      family: 'TE',
      m: 1,
      n: 0,
    })
    expect(captured.spec.model?.inline).toEqual(input)
    expect(input.fieldSamples.length).toBeGreaterThan(0)
  })

  it('parses native rows in submitted order and preserves capture and host provenance', () => {
    const output = parse()

    expect(output.input).toEqual(input)
    expect(output.backend).toEqual({ id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' })
    expect(output.result).toMatchObject({
      family: input.family,
      m: input.m,
      n: input.n,
      frequencyHz: input.frequency,
      normalization: 'peak Hz = 1 A/m',
      finite: true,
      ok: true,
    })
    expect(output.result.fieldSamples).toEqual(nativeResponse().moduleResult.result.fieldSamples)
    expect(output.result.fieldSamples.map((row: { x: number; y: number }) => [row.x, row.y]))
      .toEqual(input.fieldSamples.map((point: { x: number; y: number }) => [point.x, point.y]))
  })

  it('rejects malformed envelopes, mismatched echoes, and failed native status', () => {
    const base = nativeResponse()
    expect(() => parse(null)).toThrow()
    expect(() => parse({ ...base, moduleResult: null })).toThrow()
    expect(() => parse({ ...base, moduleResult: { ...base.moduleResult, module: 'other' } })).toThrow()
    expect(() => parse({ ...base, moduleResult: { ...base.moduleResult, backend: { id: 'native-cuda' } } })).toThrow()
    expect(() => parse(nativeResponse({ operation: 'other' }))).toThrow()
    expect(() => parse(nativeResponse({ family: 'TM' }))).toThrow()
    expect(() => parse(nativeResponse({ m: input.m + 1 }))).toThrow()
    expect(() => parse(nativeResponse({ n: input.n + 1 }))).toThrow()
    expect(() => parse(nativeResponse({ frequencyHz: input.frequency + 1 }))).toThrow()
    expect(() => parse(nativeResponse({ finite: false }))).toThrow()
    expect(() => parse(nativeResponse({ ok: false }))).toThrow()
  })

  it('fails closed on missing, reordered, mismatched, or non-finite sample rows', () => {
    const base = nativeResponse()
    const rows = base.moduleResult.result.fieldSamples
    expect(() => parse(nativeResponse({ fieldSamples: rows.slice(1) }))).toThrow()
    expect(() => parse(nativeResponse({ fieldSamples: rows.map((row: any, index: number) =>
      index === 0 ? { ...row, x: row.x + 0.001 } : row,
    ) }))).toThrow()
    expect(() => parse(nativeResponse({ fieldSamples: [...rows].reverse() }))).toThrow()
    expect(() => parse(nativeResponse({ fieldSamples: rows.map((row: any, index: number) =>
      index === 0 ? { ...row, eyMagnitude: Number.NaN } : row,
    ) }))).toThrow()
    expect(() => parse(nativeResponse({ betaRadPerM: Number.POSITIVE_INFINITY }))).toThrow()
    expect(() => parse(nativeResponse({ cutoffHz: Number.NaN }))).toThrow()
    expect(() => parse(nativeResponse({ fieldSamples: rows.map((row: any, index: number) =>
      index === 0 ? { ...row, ezMagnitude: Number.NEGATIVE_INFINITY } : row,
    ) }))).toThrow()
  })
})
