import { describe, expect, it } from 'vitest'
import { parseTouchstone, type TouchstoneNetwork } from './touchstone'
import { createTouchstoneVswrJob } from './touchstone-vswr'

const twoPort = (): TouchstoneNetwork => parseTouchstone(
  '# GHz S RI R 50\n1 0.2 0.1 0.8 0 0.7 0 0.1 0\n2 0.3 0.1 0.6 0 0.5 0 0.2 0\n',
  'fixture.s2p',
)

const mutate = (change: (network: TouchstoneNetwork) => TouchstoneNetwork) =>
  change(twoPort()) as unknown as TouchstoneNetwork

describe('Touchstone VSWR job input', () => {
  it('submits the first S-parameter from Touchstone two-port order as S11', () => {
    const network = twoPort()
    const { input } = createTouchstoneVswrJob(network)

    expect(input).toEqual({
      module: 'vswr',
      backend: 'host',
      operation: 'cst-s11-vswr-sweep',
      frequenciesHz: [1e9, 2e9],
      s11: [[0.2, 0.1], [0.3, 0.1]],
    })
  })

  it('accepts a multiport matrix but preserves the same S11-only native input', () => {
    const network = parseTouchstone(
      '# GHz S RI R 50\n' +
        '1 0.2 0.1 0.01 0 0.02 0\n' +
        '0.03 0 0.3 0 0.04 0\n' +
        '0.05 0 0.06 0 0.4 0\n',
      'fixture.s3p',
    )
    const { input, spec } = createTouchstoneVswrJob(network)

    expect(input).toEqual({
      module: 'vswr',
      backend: 'host',
      operation: 'cst-s11-vswr-sweep',
      frequenciesHz: [1e9],
      s11: [[0.2, 0.1]],
    })
    expect(Object.keys(input).sort()).toEqual(['backend', 'frequenciesHz', 'module', 'operation', 's11'])
    expect(spec.model?.inline).toEqual(input)
  })

  it('preserves imported S11 samples when ports have different reference impedances', () => {
    const network = {
      ...twoPort(),
      referenceImpedancesOhms: [50, 75],
    }
    const { input } = createTouchstoneVswrJob(network)

    // Touchstone S-parameters are already expressed in the file's reference
    // system. Keep the port-1 reference on the local network metadata, but do
    // not renormalize S11 or add fields to the native job schema.
    expect(input).toEqual({
      module: 'vswr',
      backend: 'host',
      operation: 'cst-s11-vswr-sweep',
      frequenciesHz: [1e9, 2e9],
      s11: [[0.2, 0.1], [0.3, 0.1]],
    })
    expect(Object.keys(input).sort()).toEqual(['backend', 'frequenciesHz', 'module', 'operation', 's11'])
  })

  it('uses only the admitted operation and the native CUDA transport', () => {
    const { input, spec } = createTouchstoneVswrJob(twoPort())

    expect(input).toMatchObject({ module: 'vswr', backend: 'host', operation: 'cst-s11-vswr-sweep' })
    expect(spec.kind).toBe('waveworld-module')
    expect(spec.parameters).toMatchObject({ module: 'vswr' })
    expect(spec.requirements?.backends).toEqual(['cuda'])
    expect(spec.model).toMatchObject({ source: 'inline', inline: input })
    expect(spec.model?.inline).toMatchObject({ backend: 'host', operation: 'cst-s11-vswr-sweep' })
  })

  it('revalidates untrusted direct-call shape and point bounds', () => {
    expect(() => createTouchstoneVswrJob(null as unknown as TouchstoneNetwork)).toThrow()
    expect(() => createTouchstoneVswrJob({ ...twoPort(), ports: 3 } as unknown as TouchstoneNetwork)).toThrow()
    expect(() => createTouchstoneVswrJob({ ...twoPort(), ports: 0 } as unknown as TouchstoneNetwork)).toThrow()
    expect(() => createTouchstoneVswrJob({ ...twoPort(), fileName: ' ' })).toThrow()
    expect(() => createTouchstoneVswrJob({ ...twoPort(), unexpected: true } as unknown as TouchstoneNetwork)).toThrow()
    expect(() => createTouchstoneVswrJob({ ...twoPort(), points: [] })).toThrow()
    expect(() => createTouchstoneVswrJob({ ...twoPort(), points: Array(4097).fill(twoPort().points[0]) })).toThrow()
  })

  it('requires finite, positive, strictly increasing frequencies', () => {
    for (const frequenciesHz of [[0, 2], [-1, 2], [1, 1], [2, 1], [1, Number.NaN], [1, Number.POSITIVE_INFINITY]]) {
      const network = twoPort()
      network.points = network.points.map((point, index) => ({ ...point, frequencyHz: frequenciesHz[index] }))
      expect(() => createTouchstoneVswrJob(network)).toThrow()
    }
  })

  it('requires the expected finite complex-pair dimensions for every port', () => {
    const onePort = parseTouchstone('# MHz S RI R 75\n1 0.2 0.1\n', 'fixture.s1p')
    const badNetworks = [
      { ...onePort, points: [{ ...onePort.points[0], s: [] }] },
      { ...onePort, points: [{ ...onePort.points[0], s: [[0.2, 0.1], [0, 0]] as [number, number][] }] },
      mutate(network => ({ ...network, points: network.points.map(point => ({ ...point, s: point.s.slice(1) })) })),
      mutate(network => ({ ...network, points: network.points.map(point => ({ ...point, s: [...point.s, [0, 0] as [number, number]] })) })),
      mutate(network => ({ ...network, points: network.points.map(point => ({ ...point, s: [[0.2] as unknown as [number, number], ...point.s.slice(1)] })) })),
      mutate(network => ({ ...network, points: network.points.map(point => ({ ...point, s: [[Number.NaN, 0] as [number, number], ...point.s.slice(1)] })) })),
      mutate(network => ({ ...network, points: network.points.map(point => ({ ...point, s: [point.s[0], [0, Number.POSITIVE_INFINITY], ...point.s.slice(2)] })) })),
    ]
    for (const network of badNetworks) expect(() => createTouchstoneVswrJob(network)).toThrow()
  })

  it('requires a positive finite reference resistance and strictly passive S11 magnitude', () => {
    for (const referenceOhms of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createTouchstoneVswrJob({ ...twoPort(), referenceOhms })).toThrow()
    }

    const outOfRange = twoPort()
    outOfRange.points[0].s[0] = [1, 0]
    expect(() => createTouchstoneVswrJob(outOfRange)).toThrow()
    const overUnity = twoPort()
    overUnity.points[0].s[0] = [0.8, 0.7]
    expect(() => createTouchstoneVswrJob(overUnity)).toThrow()
  })

  it('rejects invalid per-port reference impedance metadata', () => {
    const network = twoPort()
    const invalidNetworks = [
      { ...network, referenceImpedancesOhms: [50] },
      { ...network, referenceImpedancesOhms: [50, 75, 100] },
      { ...network, referenceImpedancesOhms: [50, 0] },
      { ...network, referenceImpedancesOhms: [50, Number.NaN] },
      { ...network, referenceImpedancesOhms: [50, Number.POSITIVE_INFINITY] },
    ]

    for (const invalid of invalidNetworks) {
      expect(() => createTouchstoneVswrJob(invalid)).toThrow()
    }
  })
})
