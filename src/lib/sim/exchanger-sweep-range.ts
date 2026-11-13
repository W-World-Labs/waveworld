export type ExchangerSweepRange = {
  start: number
  end: number
  points: number
  spacing: 'linear' | 'log'
}

const MIN_UA = 1e-6
const MAX_UA = 1e9

function fail(message: string): never {
  throw new Error(message)
}

/** Build a bounded, endpoint-inclusive UA sweep without modifying its inputs. */
export function createExchangerUaValues(range: ExchangerSweepRange): number[] {
  if (!range || typeof range !== 'object' || Array.isArray(range)) {
    fail('Exchanger sweep range must be an object')
  }

  const value = range as unknown as Record<string, unknown>
  const keys = ['start', 'end', 'points', 'spacing']
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`Exchanger sweep range has unsupported field ${key}`)
  }
  for (const key of keys) {
    if (!(key in value)) fail(`Exchanger sweep range.${key} is required`)
  }

  const { start, end, points, spacing } = value
  if (typeof start !== 'number' || !Number.isFinite(start) || start < MIN_UA || start > MAX_UA) {
    fail(`UA start must be a finite number in [${MIN_UA}, ${MAX_UA}] W/K`)
  }
  if (typeof end !== 'number' || !Number.isFinite(end) || end < MIN_UA || end > MAX_UA) {
    fail(`UA end must be a finite number in [${MIN_UA}, ${MAX_UA}] W/K`)
  }
  if (start >= end) fail('UA start must be less than UA end')
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 2 || points > 64) {
    fail('UA sweep points must be an integer in [2, 64]')
  }
  if (spacing !== 'linear' && spacing !== 'log') {
    fail('UA sweep spacing must be linear or log')
  }

  const values = Array.from({ length: points }, (_, index) => {
    if (index === 0) return start
    if (index === points - 1) return end
    const fraction = index / (points - 1)
    return spacing === 'linear'
      ? start + (end - start) * fraction
      : start * Math.pow(end / start, fraction)
  })

  for (let index = 1; index < values.length; index += 1) {
    if (!(values[index] > values[index - 1])) {
      fail('UA sweep values are not distinct at the requested precision')
    }
  }
  if (values[0] !== start || values[values.length - 1] !== end) {
    fail('UA sweep endpoints could not be represented exactly')
  }

  return values
}
