/**
 * Validates the material-card arithmetic returned by W-Sim's
 * sw-calculix-orthotropic-elastic card method. The module evaluates a material
 * card; it does not assemble or solve a finite-element problem, so this helper
 * makes no solver or general Abaqus/CalculiX parity claim.
 */
type RecordValue = Record<string, unknown>

const MODULE_ID = 'sw-calculix-orthotropic-elastic'
const METHOD_ID = 'method-algo-calculix-elastic-card'
const VOIGT_ORDER = ['11', '22', '33', '12', '13', '23']
const ENGINEERING_NAMES = ['E1', 'E2', 'E3', 'nu12', 'nu23', 'nu13', 'G12', 'G13', 'G23']
const ORTHO_NAMES = ['D1111', 'D1122', 'D2222', 'D1133', 'D2233', 'D3333', 'D1212', 'D1313', 'D2323']
const ANISO_NAMES = ['D1111', 'D1122', 'D2222', 'D1133', 'D2233', 'D3333', 'D1112', 'D2212', 'D3312', 'D1212', 'D1113', 'D2213', 'D3313', 'D1213', 'D1313', 'D1123', 'D2223', 'D3323', 'D1223', 'D1323', 'D2323']

function object(value: unknown, label: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function close(actual: number, expected: number, label: string, scale = Math.max(1, Math.abs(actual), Math.abs(expected)), tolerance = 1e-8): void {
  if (Math.abs(actual - expected) > tolerance * scale) throw new Error(`${label} is inconsistent`)
}

function vector(value: unknown, label: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${label} must contain exactly ${length} values`)
  return value.map((entry, index) => finite(entry, `${label}[${index}]`))
}

function matrix(value: unknown, label: string): number[] {
  // The evidenced W-Sim module serializes both matrices as row-major flat arrays.
  return vector(value, label, 36)
}

type ElasticType = 'iso' | 'engineering' | 'ortho' | 'aniso'

function elasticType(input: RecordValue): ElasticType {
  const raw = input.type ?? input.elasticType
  if (raw === undefined || raw === null) {
    if (Array.isArray(input.constants)) return input.constants.length === 21 ? 'aniso' : 'ortho'
    return input.E1 !== undefined || input.G12 !== undefined ? 'engineering' : 'iso'
  }
  if (typeof raw !== 'string') throw new Error('Submitted elastic type must be a string')
  const normalized = raw.trim().toLowerCase().replace(/[ _]/g, '-')
  if (['iso', 'isotropic', 'isotropy'].includes(normalized)) return 'iso'
  if (['engineering', 'engineering-constants', 'eng', 'engc'].includes(normalized)) return 'engineering'
  if (['ortho', 'orthotropic', 'orthotropy'].includes(normalized)) return 'ortho'
  if (['aniso', 'anisotropic', 'anisotropy', 'full'].includes(normalized)) return 'aniso'
  throw new Error(`Unsupported submitted elastic type '${raw}'`)
}

function namesFor(type: ElasticType): string[] {
  return type === 'iso' ? ['E', 'nu'] : type === 'engineering' ? ENGINEERING_NAMES : type === 'ortho' ? ORTHO_NAMES : ANISO_NAMES
}

function rowConstants(row: RecordValue, type: ElasticType, label: string): number[] {
  const names = namesFor(type)
  if (type === 'iso' || type === 'engineering') return names.map(name => finite(row[name], `${label}.${name}`))
  const raw = row.constants
  if (!Array.isArray(raw) || raw.length !== names.length) throw new Error(`${label}.constants must contain ${names.length} values`)
  return raw.map((value, index) => finite(value, `${label}.constants[${index}]`))
}

function expectedCardConstants(input: RecordValue, output: RecordValue, type: ElasticType): number[] {
  const rawLines = input.lines
  const rows: { temperature: number | undefined; values: number[] }[] = rawLines === undefined || rawLines === null
    ? [{ temperature: input.temperature === undefined ? undefined : finite(input.temperature, 'Submitted temperature'), values: rowConstants(input, type, 'Submitted material') }]
    : (() => {
      if (!Array.isArray(rawLines) || rawLines.length === 0) throw new Error('Submitted lines must be a nonempty array')
      return rawLines.map((value, index) => {
        const row = object(value, `Submitted line ${index}`)
        return {
          temperature: row.temperature === undefined || row.temperature === null ? undefined : finite(row.temperature, `Submitted line ${index} temperature`),
          values: rowConstants(row, type, `Submitted line ${index}`),
        }
      })
    })()

  const reportedTemperature = output.temperature === undefined || output.temperature === null
    ? undefined
    : finite(output.temperature, 'Result temperature')
  const target = reportedTemperature ?? rows[0]!.temperature
  if (rows.length === 1 || target === undefined) return rows[0]!.values
  const ordered = rows.slice().sort((a, b) => a.temperature! - b.temperature!)
  let lower = ordered[0]!
  let upper = ordered[ordered.length - 1]!
  const extrapolation = typeof input.extrapolation === 'string' ? input.extrapolation.toLowerCase() : 'error'
  if (target < lower.temperature! || target > upper.temperature!) {
    if (extrapolation === 'clamp' || ['constant', 'nearest'].includes(extrapolation)) return (target < lower.temperature! ? lower : upper).values
    if (!['linear', 'extrapolate'].includes(extrapolation)) throw new Error('Result temperature is outside submitted material lines')
    if (target < lower.temperature!) upper = ordered[1]!
    else lower = ordered[ordered.length - 2]!
  } else {
    for (let i = 0; i < ordered.length - 1; i++) {
      if (target >= ordered[i]!.temperature! && target <= ordered[i + 1]!.temperature!) {
        lower = ordered[i]!
        upper = ordered[i + 1]!
        break
      }
    }
  }
  const fraction = (target - lower.temperature!) / (upper.temperature! - lower.temperature!)
  return lower.values.map((value, index) => value + fraction * (upper.values[index]! - value))
}

/** Validate the W-Sim module envelope and card result against the submitted inputs. */
export function parseAbaqusOrthotropicElasticResult(raw: unknown, submittedInput: unknown): RecordValue {
  const input = object(submittedInput, 'Submitted material input')
  if (input.module !== MODULE_ID) throw new Error(`Submitted material module must be ${MODULE_ID}`)
  if (input.method !== METHOD_ID) throw new Error(`Submitted material method must be ${METHOD_ID}`)
  if (input.backend !== 'host') throw new Error('Orthotropic elastic source workflow requires the Host backend')
  const envelope = object(raw, 'Orthotropic elastic module response')
  if (envelope.ok !== true || envelope.module !== MODULE_ID) throw new Error('Orthotropic elastic module response envelope does not match')
  const backend = object(envelope.backend, 'Orthotropic elastic backend')
  if (backend.id !== 'w-sim-cuda-host' || backend.kind !== 'host-f64' || backend.deviceName !== 'w-sim-cuda-host') {
    throw new Error('Orthotropic elastic result did not report the pinned host-f64 backend')
  }
  const result = object(envelope.result, 'Orthotropic elastic result')
  if (result.methodId !== METHOD_ID) throw new Error('Orthotropic elastic response is not the material-card method')

  const type = elasticType(input)
  const expectedType = type === 'engineering' ? 'engineering' : type
  if (result.elasticType !== expectedType) throw new Error('Result elastic type does not match submitted material type')
  if (!Array.isArray(result.voigtOrder) || result.voigtOrder.length !== VOIGT_ORDER.length || result.voigtOrder.some((value, index) => value !== VOIGT_ORDER[index])) {
    throw new Error('Result Voigt order is not CalculiX (11,22,33,12,13,23)')
  }

  const inputLines = input.lines
  const lineCount = inputLines === undefined || inputLines === null ? 1 : Array.isArray(inputLines) ? inputLines.length : -1
  if (!Number.isInteger(result.lineCount) || result.lineCount !== lineCount || lineCount < 1) throw new Error('Result line count does not match submitted material lines')
  const expectedTemperature = input.temperature ?? (Array.isArray(inputLines) ? object(inputLines[0], 'Submitted line 0').temperature : undefined)
  if (expectedTemperature !== undefined && expectedTemperature !== null) {
    close(finite(result.temperature, 'Result temperature'), finite(expectedTemperature, 'Submitted temperature'), 'Result temperature')
  }

  const outputConstants = object(result.cardConstants, 'Result card constants')
  const expectedConstants = expectedCardConstants(input, result, type)
  for (const [index, name] of namesFor(type).entries()) {
    close(finite(outputConstants[name], `Result card constant ${name}`), expectedConstants[index]!, `Result card constant ${name}`)
  }

  const stiffness = matrix(result.stiffness, 'Result stiffness')
  const compliance = matrix(result.compliance, 'Result compliance')
  for (let row = 0; row < 6; row++) {
    for (let column = 0; column < 6; column++) {
      const c = stiffness[row * 6 + column]!
      const ct = stiffness[column * 6 + row]!
      const s = compliance[row * 6 + column]!
      const st = compliance[column * 6 + row]!
      close(c, ct, `Stiffness symmetry at (${row},${column})`, Math.max(1, Math.abs(c), Math.abs(ct)), 1e-10)
      close(s, st, `Compliance symmetry at (${row},${column})`, Math.max(1, Math.abs(s), Math.abs(st)), 1e-10)
      let product = 0
      let magnitude = 0
      for (let k = 0; k < 6; k++) {
        const term = stiffness[row * 6 + k]! * compliance[k * 6 + column]!
        product += term
        magnitude += Math.abs(term)
      }
      close(product, row === column ? 1 : 0, `Stiffness/compliance inverse at (${row},${column})`, Math.max(1, magnitude), 1e-8)
    }
  }

  if (input.eps !== undefined && input.eps !== null) {
    const eps = vector(input.eps, 'Submitted eps', 6)
    const alpha = [input.alpha1 ?? 0, input.alpha2 ?? 0, input.alpha3 ?? 0].map((value, index) => finite(value, `Submitted alpha${index + 1}`))
    const dT = input.dT === undefined || input.dT === null ? 0 : finite(input.dT, 'Submitted dT')
    const mechanical = vector(result.mechanicalStrain, 'Result mechanical strain', 6)
    for (let index = 0; index < 6; index++) close(mechanical[index]!, eps[index]! - (index < 3 ? alpha[index]! * dT : 0), `Mechanical strain[${index}]`)
    const stress = vector(result.stress, 'Result stress', 6)
    for (let row = 0; row < 6; row++) {
      let predicted = 0
      let magnitude = 0
      for (let column = 0; column < 6; column++) {
        const term = stiffness[row * 6 + column]! * mechanical[column]!
        predicted += term
        magnitude += Math.abs(term)
      }
      close(stress[row]!, predicted, `Result stress[${row}]`, Math.max(1, magnitude), 1e-8)
    }
  } else if (result.stress !== undefined) {
    throw new Error('Result includes stress although no strain was submitted')
  }

  return result
}
