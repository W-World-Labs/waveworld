/** Maximum EPW upload size; keep aligned with the Lab selector limit. */
export const EPW_MAX_FILE_BYTES = 32 * 1024 * 1024

export type EpwFileSource = {
  name: string
  sizeBytes: number
  mediaType: string
  lastModified: number
}

export type EpwFileText = {
  text: string
  source: EpwFileSource
}

/** Read a bounded EPW upload while retaining its file identity and provenance. */
export async function readEpwFile(file: File): Promise<EpwFileText> {
  if (file.size > EPW_MAX_FILE_BYTES) {
    throw new Error(`EPW file exceeds the ${EPW_MAX_FILE_BYTES}-byte limit`)
  }

  return {
    text: await file.text(),
    source: {
      name: file.name,
      sizeBytes: file.size,
      mediaType: file.type,
      lastModified: file.lastModified,
    },
  }
}

// EPW data-dictionary missing markers (column indices are zero-based). The
// EnergyPlus dictionary defines these fields as missing at or above their
// listed thresholds; see https://energyplus.readthedocs.io/en/latest/auxiliary-programs/auxiliary-programs.html
const EPW_MISSING_AT_OR_ABOVE: Readonly<Record<number, number>> = {
  6: 99.9,
  7: 99.9,
  8: 999,
  9: 999999,
  10: 9999,
  11: 9999,
  12: 9999,
  13: 9999,
  14: 9999,
  15: 9999,
  16: 999900,
  17: 999900,
  18: 999900,
  19: 9999,
  20: 999,
  21: 999,
  22: 99,
  23: 99,
  24: 9999,
  25: 99999,
  26: 9,
  28: 999,
  29: 0.999,
  30: 999,
  31: 99,
  32: 999,
  33: 999,
  34: 99,
}

/**
 * Check only the gaps in the currently pinned native parser: EPW missing
 * markers and calendar ordering. Header/row structure and all other parsing
 * remain the native raw-text parser's responsibility.
 */
export function preflightEpwNativeGaps(text: string): void {
  const lines = text.split(/\r?\n/)
  // This selector only supports the native module's hourly series model.
  // Leave malformed headers for the native parser, but reject valid yet
  // unsupported data-period settings here with a direct explanation.
  const dataPeriods = (lines[7] ?? '').split(',')
  const periodCount = Number(dataPeriods[1]?.trim())
  const recordsPerHour = Number(dataPeriods[2]?.trim())
  if (Number.isFinite(periodCount) && Number.isFinite(recordsPerHour) &&
      (periodCount !== 1 || recordsPerHour !== 1)) {
    throw new Error('EPW preflight supports exactly one DATA PERIODS period with one record per hour')
  }
  const leapFlag = (lines[4] ?? '').split(',')[1]?.trim().toLowerCase()
  if (leapFlag !== 'yes' && leapFlag !== 'no') {
    throw new Error('EPW preflight requires HOLIDAYS/DAYLIGHT SAVINGS leap-year flag Yes or No')
  }
  const leapYearObserved = leapFlag === 'yes'

  let previousDateTime: { month: number; day: number; hour: number } | undefined
  let yearWraps = 0

  for (let lineIndex = 8; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? ''
    if (line.trim() === '') continue
    const fields = line.split(',')
    const timestamp: number[] = []
    for (let column = 0; column <= 4; column += 1) {
      const value = Number(fields[column]?.trim())
      if (!Number.isFinite(value)) {
        throw new Error(`EPW line ${lineIndex + 1}: invalid timestamp field ${column + 1}`)
      }
      timestamp.push(value)
    }

    const [year, month, day, hour, minute] = timestamp as [number, number, number, number, number]
    // The selector consumes one interval per hour; EPW records end at minute 60.
    if (!Number.isInteger(year) || year < 0 || year > 9999 ||
        !Number.isInteger(month) || month < 1 || month > 12 ||
        !Number.isInteger(day) || day < 1 ||
        !Number.isInteger(hour) || hour < 1 || hour > 24 ||
        !Number.isInteger(minute) || minute !== 60) {
      throw new Error(`EPW line ${lineIndex + 1}: invalid calendar timestamp`)
    }
    const monthLengths = [31, leapYearObserved ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if (day > monthLengths[month - 1]!) {
      throw new Error(`EPW line ${lineIndex + 1}: invalid calendar date`)
    }

    if (previousDateTime) {
      let expectedMonth = previousDateTime.month
      let expectedDay = previousDateTime.day
      let expectedHour: number
      if (previousDateTime.hour < 24) {
        expectedHour = previousDateTime.hour + 1
      } else {
        expectedHour = 1
        const previousMonthLength = [31, leapYearObserved ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][expectedMonth - 1]!
        if (expectedDay < previousMonthLength) {
          expectedDay += 1
        } else if (expectedMonth < 12) {
          expectedMonth += 1
          expectedDay = 1
        } else {
          expectedMonth = 1
          expectedDay = 1
          yearWraps += 1
          if (yearWraps > 1) {
            throw new Error(`EPW line ${lineIndex + 1}: timestamps may wrap across the year only once`)
          }
        }
      }
      // Source years in TMY files can change by month; cadence uses only the
      // shared calendar selected by the EPW leap-year header flag.
      if (month !== expectedMonth || day !== expectedDay || hour !== expectedHour) {
        throw new Error(`EPW line ${lineIndex + 1}: hourly timestamps must be contiguous`)
      }
    }
    previousDateTime = { month, day, hour }

    for (const [columnText, threshold] of Object.entries(EPW_MISSING_AT_OR_ABOVE)) {
      const column = Number(columnText)
      const raw = fields[column]?.trim()
      if (raw === undefined || raw === '') continue
      const value = Number(raw)
      if (Number.isFinite(value) && value >= threshold) {
        throw new Error(`EPW line ${lineIndex + 1}: field ${column + 1} is missing (EPW marker ${raw})`)
      }
    }
  }
}
