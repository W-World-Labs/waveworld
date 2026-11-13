import { describe, expect, it } from 'vitest'
import { spiceAcImportPinError, supportsDcOperatingPoint, supportsDcSweep } from './SpiceImportPanel'
import type { MnaImport } from '../../lib/sim/spice-import-adapter'
import { supportsSpiceTransient } from '../../lib/sim/spice-transient-adapter'

const imported = {
  mnaInput: {
    module: 'mna',
    method: 'method-algo-mna-dc',
    circuit: {
      nodes: 2,
      vSources: [{ a: 1, b: 0, v: 10 }],
      resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }],
    },
  },
} as unknown as MnaImport

const sweepImported = {
  mnaInput: {
    module: 'mna',
    method: 'method-algo-mna-dc-sweep',
    circuit: {
      nodes: 2,
      resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }],
      capacitors: [],
      inductors: [],
      vSources: [{ a: 1, b: 0, v: 10 }],
      iSources: [],
      diodes: [],
    },
    sweep: { source: 0, start: 0, stop: 10, steps: 3 },
  },
  mnaJobSpec: {
    schemaVersion: 1,
    kind: 'waveworld-module',
    parameters: { module: 'mna' },
    model: { source: 'inline', inline: {
      module: 'mna',
      method: 'method-algo-mna-dc-sweep',
      circuit: {
        nodes: 2,
        resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }],
        capacitors: [], inductors: [], vSources: [{ a: 1, b: 0, v: 10 }], iSources: [], diodes: [],
      },
      sweep: { source: 0, start: 0, stop: 10, steps: 3 },
    } },
    run: { maxSteps: 3 },
    outputs: {},
  },
  nodeMap: { '0': 0, in: 1, out: 2 },
} as unknown as MnaImport

const transientImported = {
  mnaInput: {
    module: 'mna',
    method: 'method-algo-mna-transient-be',
    circuit: {
      nodes: 2,
      resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }],
      capacitors: [{ a: 2, b: 0, c: 1e-6 }],
      inductors: [{ a: 1, b: 2, l: 1e-3 }],
      vSources: [{ a: 1, b: 0, v: 10 }],
      iSources: [],
      diodes: [],
    },
    dt: 1e-6,
    steps: 1000,
  },
  mnaJobSpec: {
    schemaVersion: 1,
    kind: 'waveworld-module',
    parameters: { module: 'mna' },
    model: { source: 'inline', inline: {
      module: 'mna',
      method: 'method-algo-mna-transient-be',
      circuit: {
        nodes: 2,
        resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }],
        capacitors: [{ a: 2, b: 0, c: 1e-6 }],
        inductors: [{ a: 1, b: 2, l: 1e-3 }],
        vSources: [{ a: 1, b: 0, v: 10 }],
        iSources: [],
        diodes: [],
      },
      dt: 1e-6,
      steps: 1000,
    } },
    run: { maxSteps: 1000 },
    outputs: {},
  },
  nodeMap: { '0': 0, in: 1, out: 2 },
  diagnostics: [],
} as unknown as MnaImport

describe('SPICE DC run eligibility', () => {
  it('allows only a linear R/V/I operating-point deck', () => {
    expect(supportsDcOperatingPoint('.title divider\nV1 in 0 10\nR1 in out 1k\nR2 out 0 3k\n.op\n.end', imported)).toBe(true)
  })

  it.each([
    '.dc V1 0 10 1',
    '.tran 1u 1m',
    '.ac dec 10 1 1k',
    '.op\nD1 out 0 DFAST',
    '.op\nC1 out 0 1u',
    '.op\n.include parts.lib',
  ])('rejects unsupported analysis or device while leaving export independent: %s', (unsupported) => {
    expect(supportsDcOperatingPoint(`V1 in 0 10\nR1 in out 1k\nR2 out 0 3k\n${unsupported}\n.end`, imported)).toBe(false)
  })
})

describe('SPICE AC import pin boundary', () => {
  it('blocks .ac decks before submitting them to the released parser pin', () => {
    expect(spiceAcImportPinError('.title filter\nV1 in 0 AC 1\nR1 in 0 1k\n.ac lin 1 1k 1k\n.end'))
      .toMatch(/dda2f6f1e1def3d9a49bea48c8766d222b2d8a14.*does not support \.ac deck import/)
    expect(spiceAcImportPinError('* .ac dec 3 1 10\nR1 in 0 1k\n.end')).toBeNull()
    expect(spiceAcImportPinError('V1 in 0 AC 1\nR1 in 0 1k\n.end')).toBeNull()
  })
})

describe('SPICE DC sweep eligibility', () => {
  it('allows one independent voltage-source sweep in a linear R/V/I deck', () => {
    expect(supportsDcSweep(
      '.title divider\nV1 in 0 DC 10\nR1 in out 1k\nR2 out 0 3k\n.dc V1 0 10 5\n.end',
      sweepImported,
    )).toBe(true)
  })

  it('accepts directive and element names without regard to case and ignores comments', () => {
    expect(supportsDcSweep(
      '* voltage divider\n.TITLE divider\nv1 in 0 dc 10\nR1 in out 1k $ load\nr2 out 0 3k\n.DC v1 0 10 5\n.END',
      sweepImported,
    )).toBe(true)
  })

  it.each([
    '.op\n.dc V1 0 10 5',
    '.tran 1u 1m',
    '.ac dec 10 1 1k',
    'C1 out 0 1u',
    'L1 out 0 1m',
    'D1 out 0 DFAST',
    '.model DFAST D',
    '.include parts.lib',
    '.dc I1 0 10 5',
    '.dc R1 0 10 5',
  ])('rejects unsupported sweep deck feature: %s', (unsupported) => {
    expect(supportsDcSweep(
      `V1 in 0 DC 10\nR1 in out 1k\nR2 out 0 3k\n.dc V1 0 10 5\n${unsupported}\n.end`,
      sweepImported,
    )).toBe(false)
  })

  it.each([
    'V1 in 0 PULSE(0 10 0 1n 1n 1u 2u)',
    'V1 in 0 AC 1 0',
  ])('rejects a non-DC voltage source form: %s', (sourceLine) => {
    const deck = '.title divider\nV1 in 0 DC 10\nR1 in out 1k\nR2 out 0 3k\n.dc V1 0 10 5\n.end'
    expect(supportsDcSweep(deck.replace('V1 in 0 DC 10', sourceLine), sweepImported)).toBe(false)
  })

  it.each(['I1', 'R1'])('rejects a .dc target that is not a voltage source: %s', (target) => {
    const deck = '.title divider\nV1 in 0 DC 10\nR1 in out 1k\nR2 out 0 3k\n.dc V1 0 10 5\n.end'
    expect(supportsDcSweep(deck.replace('.dc V1', `.dc ${target}`), sweepImported)).toBe(false)
  })

  it('rejects an imported operating-point method even when the deck contains a .dc sweep', () => {
    expect(supportsDcSweep(
      'V1 in 0 DC 10\nR1 in out 1k\nR2 out 0 3k\n.dc V1 0 10 5\n.end',
      imported,
    )).toBe(false)
  })
})

describe('SPICE transient eligibility', () => {
  it('allows a constant source in a linear RLC deck', () => {
    expect(supportsSpiceTransient(
      '.title RLC transient\nV1 in 0 DC 10\nR1 in out 1k\nC1 out 0 1u\nL1 in out 1m\n.tran 1u 1m\n.end',
      transientImported,
    )).toBe(true)
  })

  it('accepts directive and element names without regard to case and ignores comments', () => {
    expect(supportsSpiceTransient(
      '* RLC transient\n.TITLE RLC transient\nv1 in 0 dc 10\nr1 in out 1k $ resistor\nc1 out 0 1u\nl1 in out 1m\n.TRAN 1u 1m\n.END',
      transientImported,
    )).toBe(true)
  })

  it.each([
    '.ic V(out)=0',
    '.uic',
    '.op',
    '.include parts.lib',
    '.model DFAST D',
  ])('rejects initial conditions or an extra directive: %s', (extra) => {
    expect(supportsSpiceTransient(
      `V1 in 0 DC 10\nR1 in out 1k\nC1 out 0 1u\nL1 in out 1m\n.tran 1u 1m\n${extra}\n.end`,
      transientImported,
    )).toBe(false)
  })

  it.each([
    'V1 in 0 PULSE(0 10 0 1n 1n 1u 2u)',
    'I1 in 0 SIN(0 1 1k)',
    'V1 in 0 AC 1 0',
  ])('rejects an unsupported source or waveform: %s', (sourceLine) => {
    expect(supportsSpiceTransient(
      `R1 in out 1k\nC1 out 0 1u\nL1 in out 1m\n.tran 1u 1m\n${sourceLine}\n.end`,
      transientImported,
    )).toBe(false)
  })

  it('rejects decks without reactive components', () => {
    expect(supportsSpiceTransient(
      'V1 in 0 DC 10\nR1 in 0 1k\n.tran 1u 1m\n.end',
      transientImported,
    )).toBe(false)
  })

  it('rejects an imported method other than MNA transient backward Euler', () => {
    expect(supportsSpiceTransient(
      'V1 in 0 DC 10\nR1 in out 1k\nC1 out 0 1u\nL1 in out 1m\n.tran 1u 1m\n.end',
      sweepImported,
    )).toBe(false)
  })
})
