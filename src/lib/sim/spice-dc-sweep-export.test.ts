import { describe, expect, it } from 'vitest'
import { buildSpiceDcSweepCsv } from './spice-dc-sweep-export'
import type { SpiceDcSweepResult } from './spice-import-adapter'

function result(nodeNames: string[] = ['out', '0', 'in']): SpiceDcSweepResult {
  return {
    methodId: 'method-algo-mna-dc-sweep',
    familyId: 'method-mna',
    sweepSource: 0,
    points: [
      { value: 0, nodeVoltages: Object.fromEntries(nodeNames.map((name) => [name, 0])) },
      { value: 5, nodeVoltages: Object.fromEntries(nodeNames.map((name, index) => [name, [3.75, 0, 5][index]])) },
      { value: 10, nodeVoltages: Object.fromEntries(nodeNames.map((name, index) => [name, [7.5, 0, 10][index]])) },
    ],
    backend: { id: 'host-f64-mna-dc-sweep' },
  }
}

describe('buildSpiceDcSweepCsv', () => {
  it('exports all returned points with a voltage axis and stable alphabetical node order', () => {
    expect(buildSpiceDcSweepCsv(result())).toBe([
      '"Sweep voltage (V)","\'Node 0 voltage (V)","\'Node in voltage (V)","\'Node out voltage (V)"',
      '"0","0","0","0"',
      '"5","0","5","3.75"',
      '"10","0","10","7.5"',
      '',
    ].join('\r\n'))
  })

  it('quotes CSV syntax and keeps formula-like or multiline node names as literal text headers', () => {
    const csv = buildSpiceDcSweepCsv(result(['line\nbreak', 'say "hi"', '=1+1', '@SUM(A1:A2)', '+cmd', '-cmd']))
    const [header] = csv.split('\r\n')

    expect(header).toBe('"Sweep voltage (V)","\'Node +cmd voltage (V)","\'Node -cmd voltage (V)","\'Node =1+1 voltage (V)","\'Node @SUM(A1:A2) voltage (V)","\'Node line\nbreak voltage (V)","\'Node say ""hi"" voltage (V)"')
    expect(csv).toContain('"\'Node =1+1 voltage (V)"')
    expect(csv).toContain('"\'Node say ""hi"" voltage (V)"')
  })
})
