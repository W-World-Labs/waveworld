import type { CoatingStudyDraft, CoatingStudyInput } from './coating-study-input';
import type { CoatingStudyResult } from './coating-study-result';

const CSV_COLUMNS = [
  'wavelength_nm',
  'R',
  'T',
  'A',
  'Rs',
  'Ts',
  'As',
  'Rp',
  'Tp',
  'Ap',
] as const;

function validatedSamples(input: CoatingStudyInput, result: CoatingStudyResult) {
  const samples = result.spectrum;
  if (!Array.isArray(samples) || samples.length !== input.wavelengths.length) {
    throw new Error('Coating study sweep row count does not match submitted wavelengths');
  }

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!sample || sample.lambda !== input.wavelengths[index]) {
      throw new Error(`Coating study wavelength mismatch at sweep row ${index}`);
    }
    for (const key of ['Rs', 'Ts', 'As', 'Rp', 'Tp', 'Ap', 'R', 'T', 'A'] as const) {
      if (!Number.isFinite(sample[key]) || sample[key] < 0 || sample[key] > 1) {
        throw new Error(`Coating study sweep row ${index} has an invalid ${key} value`);
      }
    }
    if (!Number.isFinite(sample.energyResidual) || Math.abs(sample.energyResidual) > 1e-9) {
      throw new Error(`Coating study sweep row ${index} has an invalid energy residual`);
    }
  }
  return samples;
}

/** Export the native sweep in submitted wavelength order without recalculating it. */
export function buildCoatingStudyCsv(input: CoatingStudyInput, result: CoatingStudyResult): string {
  const samples = validatedSamples(input, result);
  const selected = (sample: (typeof samples)[number], value: 'R' | 'T' | 'A') => {
    if (input.polarization === 's') return sample[`${value}s` as 'Rs' | 'Ts' | 'As'];
    if (input.polarization === 'p') return sample[`${value}p` as 'Rp' | 'Tp' | 'Ap'];
    return sample[value];
  };
  const rows = samples.map((sample) => [
    sample.lambda,
    selected(sample, 'R'),
    selected(sample, 'T'),
    selected(sample, 'A'),
    sample.Rs,
    sample.Ts,
    sample.As,
    sample.Rp,
    sample.Tp,
    sample.Ap,
  ].join(','));

  return `${CSV_COLUMNS.join(',')}\n${rows.join('\n')}\n`;
}

/** Capture the exact submitted and returned data with explicit claim limits. */
export function buildCoatingStudyReport(
  draft: CoatingStudyDraft,
  input: CoatingStudyInput,
  result: CoatingStudyResult,
  jobId: string,
): string {
  validatedSamples(input, result);
  return `${JSON.stringify({
    schemaVersion: '1.0',
    jobId,
    claimLimits: {
      commercialVendor: 'No commercial-vendor affiliation, certification, or endorsement is claimed.',
      parity: 'No parity with commercial software or independent reference is claimed.',
      gpu: 'No GPU execution or GPU validation is claimed; the submitted backend is host.',
    },
    draft,
    input,
    result,
  })}\n`;
}
