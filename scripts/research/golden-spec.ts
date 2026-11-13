import type { JobSpecV1 } from '../../apps/host/src/types/task';

export interface GoldenDataset {
  path: string; condition: string; sha256: string; sourceSha256: string;
  transformed: Array<{ time: number; singletO2: number }>;
}

function measuredSource(dataset: GoldenDataset) {
  return { kind: 'measured' as const, citation: 'Sandberg et al.; doi:10.5281/zenodo.7469900; Figure 1C',
    uri: 'https://doi.org/10.5281/zenodo.7469900', locator: dataset.condition,
    transform: 'waveworld.mb-transient-normalization/v1' };
}

export function goldenCalibrationCsv(dataset: GoldenDataset): Buffer {
  return Buffer.from(`time,singletO2\n${dataset.transformed.map((row) => `${row.time},${row.singletO2}`).join('\n')}\n`, 'utf8');
}

export function buildGoldenSpec(dataset: GoldenDataset, model: { id: string; version: string }, evidence?: { id: string; sha256: string }): JobSpecV1 {
  const observations = { time: dataset.transformed.map((row) => row.time), singletO2: dataset.transformed.map((row) => row.singletO2) };
  const oxygen = dataset.path.includes('n2-') ? 0.02 : 1; const isRk4 = model.id === 'photosensitization-rk4';
  return {
    schemaVersion: 1, kind: 'path-experiment', name: `Golden case: ${dataset.condition} / ${model.id}`,
    parameters: { k_exc: 0.4, k_f: 2, k_isc: 3, k_T: 0.2, k_q: 1, k_d: 5, k_I: 0.3, O2: oxygen, substrate: 1, cTot: 1, dt: 0.01 },
    run: { maxSteps: 922, forceSampleEvery: 10 }, outputs: { forces: false, history: true },
    experiment: {
      experimentId: `mb-pbs-oxygen-transient-2026:${dataset.path.includes('n2-') ? 'n2' : 'air'}:${model.id}`,
      title: `Methylene Blue transient response — ${dataset.condition}`, model,
      materials: [{ id: 'methylene-blue-pbs', name: 'Methylene Blue in PBS', role: 'photosensitizer system', source: measuredSource(dataset) }],
      steps: [{ id: 'excitation-transient', label: 'excitation to monitored transient-state response', mechanism: 'photosensitization kinetics',
        inputs: ['Methylene Blue', 'optical excitation', dataset.condition], outputs: ['normalized transient-state proxy'],
        hypothesis: { status: 'candidate', description: 'Oxygenation changes the fitted kinetics of the normalized transient response.', sources: [measuredSource(dataset)] } }],
      parameters: {
        oxygenCondition: { value: dataset.path.includes('n2-') ? 'nitrogen-saturated' : 'air-saturated', source: measuredSource(dataset) },
        excitationIntensity: { value: 431, unit: 'W cm^-2', source: measuredSource(dataset) }, pH: { value: 3.5, source: measuredSource(dataset) },
      },
      provenance: { createdAt: '2026-08-02T16:30:00.000Z', software: { name: 'WaveWorld golden-case runner', version: '1' } },
      ...(isRk4 ? { analysis: {
        calibration: { observations,
          ...(evidence ? { evidence: { kind: 'measured' as const, evidenceId: evidence.id, sha256: evidence.sha256,
            citation: 'Sandberg et al.; doi:10.5281/zenodo.7469900; Figure 1C', uri: 'https://doi.org/10.5281/zenodo.7469900',
            locator: 'columns=time,T1|singletO2', transform: 'CSV numeric parse v1' } } : {}),
          fitParameters: { k_exc: { min: 0.05, max: 2, gridPoints: 13 }, k_q: { min: 0.05, max: 8, gridPoints: 17 } }, rounds: 4 },
        uncertainty: { seed: 20260802, samples: 200, parameters: { k_exc: { kind: 'normal' as const, sigma: 0.03, min: 0.001 },
          k_q: { kind: 'normal' as const, sigma: 0.08, min: 0.001 } } },
      } } : {}),
    },
  };
}
