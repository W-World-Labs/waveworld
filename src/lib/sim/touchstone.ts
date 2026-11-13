export type ComplexPair = [number, number]

export type TouchstoneNetwork = {
  fileName: string
  ports: number
  frequencyUnit: 'Hz' | 'kHz' | 'MHz' | 'GHz'
  format: 'RI' | 'MA' | 'DB'
  /** Port 1 reference, kept for compatibility with existing S11 consumers. */
  referenceOhms: number
  /** Optional ordered Touchstone 2.x [Reference] values, one real impedance per port. */
  referenceImpedancesOhms?: number[]
  points: Array<{ frequencyHz: number; s: ComplexPair[] }>
}

const MAX_FILE_BYTES = 512 * 1024
const MAX_RECORDS = 4096
export const TOUCHSTONE_MAX_PORTS = 8
const DECIMAL = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
const UNIT_SCALE: Record<TouchstoneNetwork['frequencyUnit'], number> = {
  Hz: 1,
  kHz: 1e3,
  MHz: 1e6,
  GHz: 1e9,
}

function finiteNumber(token: string, label: string): number {
  if (!DECIMAL.test(token)) throw new Error(`${label} must be a decimal or E-notation number`)
  const value = Number(token)
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function parseOption(tokens: string[]): {
  frequencyUnit: TouchstoneNetwork['frequencyUnit']
  format: TouchstoneNetwork['format']
  referenceOhms: number
} {
  let unit: string | undefined
  let format: string | undefined
  let referenceOhms: number | undefined
  let parameter = false
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (['HZ', 'KHZ', 'MHZ', 'GHZ'].includes(token)) {
      if (unit) throw new Error('Touchstone option line must specify one frequency unit')
      unit = token
    } else if (['RI', 'MA', 'DB'].includes(token)) {
      if (format) throw new Error('Touchstone option line must specify one data format')
      format = token
    } else if (token === 'S') {
      if (parameter) throw new Error('Touchstone option line must specify one S parameter type')
      parameter = true
    } else if (token === 'R') {
      if (referenceOhms !== undefined || index + 1 >= tokens.length) {
        throw new Error('Touchstone option line must include one R value')
      }
      referenceOhms = finiteNumber(tokens[index + 1], 'Touchstone reference resistance')
      index += 1
    } else {
      throw new Error(`Unsupported Touchstone option token '${token}'`)
    }
  }
  if (!unit || !format || !parameter || referenceOhms === undefined) {
    throw new Error('Touchstone option line must specify frequency unit, S, format, and R reference')
  }
  if (referenceOhms <= 0) throw new Error('Touchstone reference resistance must be positive')
  const frequencyUnit = ({ HZ: 'Hz', KHZ: 'kHz', MHZ: 'MHz', GHZ: 'GHz' } as const)[unit as 'HZ' | 'KHZ' | 'MHZ' | 'GHZ']
  return { frequencyUnit, format: format as TouchstoneNetwork['format'], referenceOhms }
}

function complexPair(first: number, second: number, format: TouchstoneNetwork['format']): ComplexPair {
  if (format === 'RI') return [first, second]
  const magnitude = format === 'MA' ? first : 10 ** (first / 20)
  if (!Number.isFinite(magnitude) || magnitude < 0) {
    throw new Error('Touchstone magnitude conversion must be finite and nonnegative')
  }
  const radians = (second % 360) * (Math.PI / 180)
  const real = magnitude * Math.cos(radians)
  const imaginary = magnitude * Math.sin(radians)
  if (!Number.isFinite(real) || !Number.isFinite(imaginary)) {
    throw new Error('Touchstone complex conversion must be finite')
  }
  return [real, imaginary]
}

/** Parse the bounded Touchstone 1.0 S-parameter subset accepted by the local CST workflow. */
function parseTouchstoneV1(text: string, fileName: string): TouchstoneNetwork {
  if (typeof text !== 'string') throw new Error('Touchstone file contents must be text')
  if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) {
    throw new Error('Touchstone file exceeds the 512 KiB limit')
  }
  const extension = /\.s(\d+)p$/i.exec(fileName)
  const ports = extension ? Number(extension[1]) : 0
  if (!extension || !Number.isInteger(ports) || ports < 1 || ports > TOUCHSTONE_MAX_PORTS) {
    throw new Error(`Choose a Touchstone .s1p through .s${TOUCHSTONE_MAX_PORTS}p file`)
  }
  const cleanText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let option: ReturnType<typeof parseOption> | undefined
  let sawData = false
  const points: TouchstoneNetwork['points'] = []
  // 1/2-port legacy rows are scalar records. Multiport Touchstone1 uses a
  // row-wise full matrix: one row per line for 3/4 ports, and at most four
  // complex pairs on each line for 5+ ports (with each row starting a line).
  let scalarFields: number[] = []
  let matrixFrequencyHz: number | undefined
  let matrix: ComplexPair[] = []
  let matrixRow = 0
  let matrixRowPairs = 0

  for (const [lineIndex, originalLine] of cleanText.split(/\r\n|\n|\r/).entries()) {
    const line = originalLine.split('!')[0].trim()
    if (!line) continue
    if (line.startsWith('[') || line.includes('[') || line.includes(']')) {
      throw new Error(`Touchstone 2.0 keywords are unsupported (line ${lineIndex + 1})`)
    }
    if (line.startsWith('#')) {
      if (sawData) throw new Error(`Touchstone option line must appear before data (line ${lineIndex + 1})`)
      if (option) throw new Error(`Duplicate Touchstone option line (line ${lineIndex + 1})`)
      const tokens = line.slice(1).trim().split(/\s+/).map((token) => token.toUpperCase())
      option = parseOption(tokens)
      continue
    }
    if (!option) throw new Error(`Touchstone data requires an explicit option line (line ${lineIndex + 1})`)
    sawData = true
    const tokens = line.split(/[ \t]+/)
    const values = tokens.map(token => finiteNumber(token, `Touchstone value on line ${lineIndex + 1}`))
    if (ports <= 2) {
      scalarFields.push(...values)
      const width = 1 + 2 * (ports === 1 ? 1 : 4)
      while (scalarFields.length >= width) {
        if (points.length >= MAX_RECORDS) throw new Error('Touchstone file exceeds the 4096 record limit')
        const fields = scalarFields.splice(0, width)
        const frequencyHz = fields[0] * UNIT_SCALE[option.frequencyUnit]
        if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
          throw new Error(`Touchstone frequency must convert to a finite positive Hz value (line ${lineIndex + 1})`)
        }
        const previous = points[points.length - 1]
        if (previous && frequencyHz <= previous.frequencyHz) {
          throw new Error(`Touchstone frequencies must be strictly increasing (line ${lineIndex + 1})`)
        }
        const s: ComplexPair[] = []
        for (let index = 1; index < width; index += 2) {
          const pair = complexPair(fields[index], fields[index + 1], option.format)
          if (!pair.every(Number.isFinite)) throw new Error('Touchstone S-parameter conversion must be finite')
          s.push(pair)
        }
        points.push({ frequencyHz, s })
      }
      continue
    }

    const hasFrequency = matrixFrequencyHz === undefined
    const entries = hasFrequency ? values.slice(1) : values
    const pairs = entries.length / 2
    if ((entries.length % 2) !== 0) throw new Error(`Touchstone multiport row has an incomplete complex pair (line ${lineIndex + 1})`)
    if (pairs < 1) throw new Error(`Touchstone multiport row is empty (line ${lineIndex + 1})`)
    if (ports >= 5 && pairs > 4) throw new Error(`Touchstone 1.0 lines may contain at most four parameter pairs (line ${lineIndex + 1})`)
    if (ports <= 4 && pairs !== ports) {
      throw new Error(`Touchstone ${ports}-port matrix rows must contain exactly ${ports} parameter pairs per line (line ${lineIndex + 1})`)
    }
    if (hasFrequency) {
      if (points.length >= MAX_RECORDS) throw new Error('Touchstone file exceeds the 4096 record limit')
      const frequencyHz = values[0] * UNIT_SCALE[option.frequencyUnit]
      if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
        throw new Error(`Touchstone frequency must convert to a finite positive Hz value (line ${lineIndex + 1})`)
      }
      const previous = points[points.length - 1]
      if (previous && frequencyHz <= previous.frequencyHz) {
        throw new Error(`Touchstone frequencies must be strictly increasing (line ${lineIndex + 1})`)
      }
      matrixFrequencyHz = frequencyHz
      matrix = []
      matrixRow = 0
      matrixRowPairs = 0
    }
    const expectedPairsOnLine = ports <= 4 ? ports : Math.min(4, ports - matrixRowPairs)
    if (pairs > expectedPairsOnLine) {
      throw new Error(`Touchstone multiport row has too many parameter pairs on one line (line ${lineIndex + 1})`)
    }
    for (let index = 0; index < entries.length; index += 2) {
      const pair = complexPair(entries[index], entries[index + 1], option.format)
      if (!pair.every(Number.isFinite)) throw new Error('Touchstone S-parameter conversion must be finite')
      matrix.push(pair)
    }
    matrixRowPairs += pairs
    if (matrixRowPairs === ports) {
      matrixRow += 1
      matrixRowPairs = 0
    }
    if (matrixRow === ports) {
      points.push({ frequencyHz: matrixFrequencyHz as number, s: matrix })
      matrixFrequencyHz = undefined
      matrix = []
      matrixRow = 0
      matrixRowPairs = 0
    }
  }
  if (!option) throw new Error('Touchstone file is missing its explicit option line')
  if (ports <= 2 && scalarFields.length) throw new Error(`Touchstone file ends with an incomplete ${ports}-port record`)
  if (ports > 2 && matrixFrequencyHz !== undefined) throw new Error(`Touchstone file ends with an incomplete ${ports}-port matrix`)
  if (!points.length) throw new Error('Touchstone file must contain at least one complete record')

  // Touchstone1 two-port order is S11, S21, S12, S22. For 3+ ports,
  // `s` is the full matrix in row-wise S11,S12...S1N,S21...SNN order.
  return {
    fileName,
    ports,
    frequencyUnit: option.frequencyUnit,
    format: option.format,
    referenceOhms: option.referenceOhms,
    points,
  }
}

function parseTouchstoneV2(text: string, fileName: string, expectedPorts?: number): TouchstoneNetwork {
  const lines = text.split(/\r\n|\n|\r/).map((original, index) => ({
    number: index + 1,
    value: original.split('!')[0].replace(/[ \t]+$/, ''),
  })).filter(({ value }) => value.trim().length > 0)
  const keyword = (line: string) => /^\[([^\]]+)\](?:[ \t]+(.*))?$/.exec(line)
  const expectKeyword = (line: typeof lines[number] | undefined, name: string, label: string) => {
    if (!line) throw new Error('Touchstone 2.x file is missing ' + label)
    const parsed = keyword(line.value)
    if (!parsed || parsed[1].toUpperCase() !== name.toUpperCase()) {
      throw new Error('Touchstone 2.x expected ' + label + ' (line ' + line.number + ')')
    }
    return (parsed[2] ?? '').trim()
  }
  const oneArgument = (value: string, label: string) => {
    const args = value ? value.split(/[ \t]+/) : []
    if (args.length !== 1) throw new Error(label + ' must have exactly one argument')
    return args[0]
  }

  let cursor = 0
  const version = oneArgument(expectKeyword(lines[cursor++], 'Version', '[Version]'), '[Version]')
  if (version !== '2.0' && version !== '2.1') throw new Error('Touchstone [Version] must be 2.0 or 2.1')

  const optionLine = lines[cursor++]
  if (!optionLine || !optionLine.value.startsWith('#')) {
    throw new Error('Touchstone 2.x requires one explicit option line after [Version]')
  }
  const option = parseOption(optionLine.value.slice(1).trim().split(/[ \t]+/).map((token) => token.toUpperCase()))

  const portsLine = lines[cursor++]
  const portsToken = oneArgument(expectKeyword(portsLine, 'Number of Ports', '[Number of Ports]'), '[Number of Ports]')
  const declaredPorts = finiteNumber(portsToken, 'Touchstone port count')
  if (!Number.isInteger(declaredPorts) || declaredPorts < 1 || declaredPorts > TOUCHSTONE_MAX_PORTS) {
    throw new Error('Touchstone [Number of Ports] must be an integer from 1 to ' + TOUCHSTONE_MAX_PORTS)
  }
  if (expectedPorts !== undefined && declaredPorts !== expectedPorts) {
    throw new Error('Touchstone [Number of Ports] must match the .sNp filename')
  }
  const ports = declaredPorts

  let declaredFrequencies: number | undefined
  let twoPortOrder: '21_12' | '12_21' | undefined
  let matrixFormat: 'FULL' | 'LOWER' | 'UPPER' = 'FULL'
  let referenceValues: number[] = []
  let referenceSeen = false
  let readingReference = false
  let networkDataSeen = false
  const seen = new Set<string>(['VERSION', 'NUMBER OF PORTS'])
  while (cursor < lines.length) {
    const line = lines[cursor++]
    if (line.value.startsWith('#')) throw new Error('Duplicate or late Touchstone option line (line ' + line.number + ')')
    const parsed = keyword(line.value)
    if (!parsed) {
      if (!readingReference) throw new Error('Unexpected data before [Network Data] (line ' + line.number + ')')
      const tokens = line.value.trim().split(/[ \t]+/)
      referenceValues.push(...tokens.map((token) => finiteNumber(token, 'Touchstone [Reference] value on line ' + line.number)))
      continue
    }
    const name = parsed[1].toUpperCase()
    const args = (parsed[2] ?? '').trim()
    if (name === 'NETWORK DATA') {
      if (args) throw new Error('[Network Data] does not accept arguments')
      networkDataSeen = true
      break
    }
    if (!['TWO-PORT DATA ORDER', 'NUMBER OF FREQUENCIES', 'REFERENCE', 'MATRIX FORMAT'].includes(name)) {
      throw new Error('Unsupported Touchstone 2.x keyword or section "' + parsed[1] + '" (line ' + line.number + ')')
    }
    readingReference = false
    if (seen.has(name)) throw new Error('Duplicate Touchstone [' + parsed[1] + '] keyword (line ' + line.number + ')')
    seen.add(name)
    if (name === 'TWO-PORT DATA ORDER') {
      if (ports !== 2) throw new Error('[Two-Port Data Order] is only permitted for 2-port files')
      const value = oneArgument(args, '[Two-Port Data Order]')
      if (value !== '21_12' && value !== '12_21') throw new Error('[Two-Port Data Order] must be 21_12 or 12_21')
      twoPortOrder = value
    } else if (name === 'NUMBER OF FREQUENCIES') {
      const value = finiteNumber(oneArgument(args, '[Number of Frequencies]'), 'Touchstone frequency count')
      if (!Number.isInteger(value) || value < 1 || value > MAX_RECORDS) {
        throw new Error('Touchstone [Number of Frequencies] must be an integer from 1 to ' + MAX_RECORDS)
      }
      declaredFrequencies = value
    } else if (name === 'REFERENCE') {
      if (args) referenceValues.push(...args.split(/[ \t]+/).map((token) => finiteNumber(token, 'Touchstone [Reference] value')))
      referenceSeen = true
      readingReference = true
    } else {
      const value = oneArgument(args, '[Matrix Format]').toUpperCase()
      if (value !== 'FULL' && value !== 'LOWER' && value !== 'UPPER') {
        throw new Error('Touchstone [Matrix Format] must be Full, Lower, or Upper')
      }
      matrixFormat = value
    }
  }
  if (!networkDataSeen) throw new Error('Touchstone 2.x file is missing [Network Data]')
  if (declaredFrequencies === undefined) throw new Error('Touchstone 2.x file is missing [Number of Frequencies]')
  if (ports === 2 && twoPortOrder === undefined) throw new Error('Touchstone 2.x 2-port files require [Two-Port Data Order]')
  if (ports !== 2 && twoPortOrder !== undefined) throw new Error('[Two-Port Data Order] is only permitted for 2-port files')
  if (referenceSeen) {
    if (referenceValues.length !== ports) throw new Error('Touchstone [Reference] must specify one value per port (' + ports + ')')
    if (referenceValues.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error('Touchstone [Reference] values must be positive finite resistances')
    }
  }
  const referenceOhms = referenceSeen ? referenceValues[0] : option.referenceOhms

  const matrixEntryCount = matrixFormat === 'FULL'
    ? ports * ports
    : ports * (ports + 1) / 2
  const recordWidth = 1 + 2 * matrixEntryCount
  const points: TouchstoneNetwork['points'] = []
  let record: number[] = []
  let sawEnd = false
  while (cursor < lines.length) {
    const line = lines[cursor++]
    const parsed = keyword(line.value)
    if (parsed) {
      if (parsed[1].toUpperCase() !== 'END' || (parsed[2] ?? '').trim()) {
        throw new Error('Unsupported Touchstone 2.x section "' + parsed[1] + '" after [Network Data] (line ' + line.number + ')')
      }
      if (record.length) throw new Error('Touchstone 2.x file ends with an incomplete network matrix')
      sawEnd = true
      break
    }
    if (line.value.startsWith('#')) throw new Error('Touchstone option line is not allowed in network data (line ' + line.number + ')')
    const tokens = line.value.trim().split(/[ \t]+/)
    const values = tokens.map((token) => finiteNumber(token, 'Touchstone value on line ' + line.number))
    if (!record.length) {
      const frequencyHz = values[0] * UNIT_SCALE[option.frequencyUnit]
      if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
        throw new Error('Touchstone frequency must convert to a finite positive Hz value (line ' + line.number + ')')
      }
      const previous = points[points.length - 1]
      if (previous && frequencyHz <= previous.frequencyHz) {
        throw new Error('Touchstone frequencies must be strictly increasing (line ' + line.number + ')')
      }
      record.push(values[0])
      values.splice(0, 1)
    }
    record.push(...values)
    if (record.length > recordWidth) throw new Error('Touchstone network data line contains values beyond its matrix (line ' + line.number + ')')
    if (record.length === recordWidth) {
      const entries: ComplexPair[] = []
      for (let index = 1; index < recordWidth; index += 2) {
        const pair = complexPair(record[index], record[index + 1], option.format)
        if (!pair.every(Number.isFinite)) throw new Error('Touchstone S-parameter conversion must be finite')
        entries.push(pair)
      }
      let s: ComplexPair[]
      if (matrixFormat === 'FULL') {
        s = entries
      } else {
        // Lower/Upper declare a symmetric matrix. Expand the stored triangle
        // into the canonical row-major representation; this does not validate
        // physical reciprocity of an input full matrix.
        s = Array.from({ length: ports * ports }, () => [0, 0] as ComplexPair)
        let entryIndex = 0
        for (let row = 0; row < ports; row += 1) {
          const startColumn = matrixFormat === 'LOWER' ? 0 : row
          const endColumn = matrixFormat === 'LOWER' ? row + 1 : ports
          for (let column = startColumn; column < endColumn; column += 1) {
            const pair = entries[entryIndex++]
            s[row * ports + column] = pair
            if (row !== column) s[column * ports + row] = [pair[0], pair[1]]
          }
        }
      }
      // Keep the existing network representation for 2-port S11 consumers.
      if (matrixFormat === 'FULL' && ports === 2 && twoPortOrder === '12_21') [s[1], s[2]] = [s[2], s[1]]
      points.push({ frequencyHz: record[0] * UNIT_SCALE[option.frequencyUnit], s })
      record = []
      if (points.length > declaredFrequencies) throw new Error('Touchstone file contains more records than [Number of Frequencies]')
    }
  }
  if (!sawEnd) throw new Error('Touchstone 2.x file is missing [End]')
  if (cursor !== lines.length) throw new Error('Touchstone data is not allowed after [End]')
  if (record.length) throw new Error('Touchstone 2.x file ends with an incomplete network matrix')
  if (points.length !== declaredFrequencies) throw new Error('Touchstone record count does not match [Number of Frequencies]')
  return {
    fileName,
    ports,
    frequencyUnit: option.frequencyUnit,
    format: option.format,
    referenceOhms,
    ...(referenceSeen ? { referenceImpedancesOhms: [...referenceValues] } : {}),
    points,
  }
}

export function parseTouchstone(text: string, fileName: string): TouchstoneNetwork {
  if (typeof text !== 'string') throw new Error('Touchstone file contents must be text')
  const cleanText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const firstLine = cleanText.split(/\r\n|\n|\r/).map((line) => line.split('!')[0].trim()).find((line) => line.length > 0)
  if (firstLine?.toUpperCase().startsWith('[VERSION]')) {
    if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) throw new Error('Touchstone file exceeds the 512 KiB limit')
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(cleanText)) {
      throw new Error('Touchstone files must contain ASCII text, tabs, and line endings only')
    }
    const extension = /\.s(\d+)p$/i.exec(fileName)
    const touchstoneTsExtension = /\.ts$/i.test(fileName)
    const filenamePorts = extension ? Number(extension[1]) : undefined
    if ((!extension && !touchstoneTsExtension) ||
        (filenamePorts !== undefined && (!Number.isInteger(filenamePorts) || filenamePorts < 1 || filenamePorts > TOUCHSTONE_MAX_PORTS))) {
      throw new Error('Choose a Touchstone .s1p through .s' + TOUCHSTONE_MAX_PORTS + 'p file, or a Touchstone 2.x .ts file')
    }
    return parseTouchstoneV2(cleanText, fileName, filenamePorts)
  }
  return parseTouchstoneV1(text, fileName)
}
