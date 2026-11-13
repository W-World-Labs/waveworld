import type { TouchstoneNetwork } from './touchstone'
import type { TouchstoneVswrResult } from './touchstone-vswr'

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Export submitted frequencies and native-returned S11 metrics without recalculation. */
export function buildTouchstoneVswrCsv(
  network: TouchstoneNetwork,
  result: TouchstoneVswrResult,
): string {
  const header = [
    'frequency_hz',
    's11_real',
    's11_imag',
    'magnitude',
    'vswr',
    'return_loss_db',
    'reflected_power_fraction',
    'reference_ohms',
  ]
  const rows = result.points.map((point) => [
    String(point.frequencyHz),
    String(point.s11[0]),
    String(point.s11[1]),
    String(point.magnitude),
    String(point.vswr),
    // +Infinity is the physical return loss for an ideal match, not missing data.
    point.returnLossDb === null ? 'Infinity' : String(point.returnLossDb),
    String(point.reflectedPowerFraction),
    String(network.referenceOhms),
  ])

  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}
