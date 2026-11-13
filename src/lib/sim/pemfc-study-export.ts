import type { PemfcStudyDraft, PemfcPolarizationInput } from './pemfc-study-input'
import type { PemfcStudyResult } from './pemfc-study-result'

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Export each native polarization sample, including samples at the voltage floor. */
export function pemfcStudyCsv(result: PemfcStudyResult): string {
  const header = [
    'current_density_A_cm2',
    'cell_voltage_V',
    'power_density_W_cm2',
  ]
  const rows = result.result.curve.current.map((current, index) => [
    String(current),
    String(result.result.curve.voltage[index]),
    String(result.result.curve.power[index]),
  ])

  return [header, ...rows].map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** Build a portable study snapshot; this JSON is not a COMSOL interchange file. */
export function pemfcStudyReport(args: {
  draft: PemfcStudyDraft
  input: PemfcPolarizationInput
  result: PemfcStudyResult
  jobId: string | null
}): string {
  const { draft, input, result, jobId } = args
  const { current, voltage, power } = result.result.curve
  let sampledMaximumIndex = 0
  for (let index = 1; index < power.length; index += 1) {
    if (power[index] > power[sampledMaximumIndex]) sampledMaximumIndex = index
  }

  return JSON.stringify({
    schemaVersion: 1,
    jobId,
    units: {
      temperature: 'K',
      pressure: 'atm',
      currentDensity: 'A/cm^2',
      resistance: 'ohm cm^2',
      voltage: 'V',
      powerDensity: 'W/cm^2',
      native: result.result.units,
    },
    draft,
    input,
    result,
    sampledMaximumPower: {
      currentDensity: current[sampledMaximumIndex],
      voltage: voltage[sampledMaximumIndex],
      powerDensity: power[sampledMaximumIndex],
      sampleIndex: sampledMaximumIndex,
      interpretation: 'Maximum among returned native samples only; not optimized or a continuous maximum.',
    },
    boundaries: {
      scope: result.result.scopeNote,
      voltageFloor: 'Native cell voltage is truncated at 0 V. Zero-voltage samples are retained and indicate the model floor.',
      sampledMaximum: 'The reported maximum power is the largest returned sample and is not an optimized or continuous maximum.',
      efficiency: 'Voltage efficiency is cell voltage divided by E_Nernst; it is not system or fuel efficiency.',
      model: 'Guided algebraic polarization study with prescribed temperature, partial pressures, and area-specific resistance; no spatial multiphysics, parameter fitting, or membrane-property calculation.',
      export: 'This is a WaveWorld study report snapshot, not a .mph file or COMSOL interchange format.',
    },
  }, null, 2) + '\n'
}
