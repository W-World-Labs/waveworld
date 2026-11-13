/** Small recorded-signal files shared by replay and numerical scene inputs. */
export type SignalRecording = {
  name: string
  sampleRate: number
  unit: string
  channels: { name: string; values: number[] }[]
  source?: string
  license?: string
}
export const RECORDING_MAX_BYTES = 4 * 1024 * 1024
export const RECORDING_MAX_SAMPLES = 20000

export function validateRecording(value: unknown): asserts value is SignalRecording {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Recording must be an object')
  const r = value as Partial<SignalRecording>
  if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 128) throw new Error('Recording name must contain 1–128 characters')
  if (typeof r.unit !== 'string' || !r.unit.trim() || r.unit.length > 16) throw new Error('Recording unit is required (up to 16 characters)')
  if (typeof r.sampleRate !== 'number' || !Number.isFinite(r.sampleRate) || r.sampleRate < 1 || r.sampleRate > 100000) throw new Error('Sample rate must be in 1–100000 Hz')
  if (!Array.isArray(r.channels) || r.channels.length < 1 || r.channels.length > 8) throw new Error('Recording requires 1–8 channels')
  const names = new Set<string>()
  let count = 0
  for (const ch of r.channels) {
    if (!ch || typeof ch.name !== 'string' || !ch.name.trim() || ch.name.length > 64 || names.has(ch.name)) throw new Error('Channel names must be unique and contain 1–64 characters')
    names.add(ch.name)
    if (!Array.isArray(ch.values) || ch.values.length < 2 || ch.values.length > RECORDING_MAX_SAMPLES || (count && ch.values.length !== count)) throw new Error('Channels require 2–20000 equally sized samples')
    count = ch.values.length
    if (ch.values.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e6)) throw new Error('Samples must be finite numbers with magnitude <= 1000000')
  }
  for (const key of ['source', 'license'] as const) {
    const url = r[key]
    if (url !== undefined && (typeof url !== 'string' || url.length > 2048 || !/^https?:\/\//.test(url))) throw new Error(`${key} must be an HTTP(S) URL`)
  }
}

/** Numeric CSV: explicit sample rate/unit metadata, channel header, equal-width rows. */
export function parseSignalCsv(text: string): SignalRecording {
  if (text.length > RECORDING_MAX_BYTES) throw new Error('Recording exceeds 4 MiB')
  const metadata: Record<string, string> = Object.create(null)
  let channels: SignalRecording['channels'] = []
  const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
  for (const [index, raw] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      const match = /^#\s*([a-z_]+)=(.*)$/.exec(line)
      if (match) metadata[match[1]] = match[2].trim()
      continue
    }
    const cells = line.split(',').map(cell => cell.trim())
    if (!channels.length) {
      if (cells.length > 8) throw new Error('Recording requires at most 8 channels')
      channels = cells.map(name => ({ name, values: [] }))
      continue
    }
    if (cells.length !== channels.length || cells.some(cell => !numberPattern.test(cell))) throw new Error(`Invalid numeric CSV row ${index + 1}`)
    if (channels[0].values.length >= RECORDING_MAX_SAMPLES) throw new Error('Recording exceeds 20000 frames')
    cells.forEach((cell, ch) => channels[ch].values.push(Number(cell)))
  }
  const recording = { name: metadata.name, sampleRate: Number(metadata.sample_rate_hz), unit: metadata.unit,
    channels, ...(metadata.source ? { source: metadata.source } : {}), ...(metadata.license ? { license: metadata.license } : {}) }
  validateRecording(recording)
  return recording
}
