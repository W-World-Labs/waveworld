import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PHOTOSENSITIZATION_RK4_MODEL,
  PHOTOSENSITIZATION_STEADY_STATE_MODEL,
  runPathExperiment,
  type PathExperimentResult,
} from '../../apps/lab/agent/src/path-experiment-runner.ts';
import { resolveAgentBuildProvenance } from '../../apps/lab/agent/src/build-provenance.ts';
import { verifyGoldenCase } from './golden-case.mjs';
import { createHash } from 'node:crypto';
import { buildGoldenSpec, goldenCalibrationCsv, type GoldenDataset } from './golden-spec.ts';

export { buildGoldenSpec, goldenCalibrationCsv } from './golden-spec.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface GoldenRun {
  condition: string;
  model: { id: string; version: string };
  spec: PathExperimentJobSpecLike;
  result: PathExperimentResult;
}

export interface GoldenRunReport {
  schema: 'waveworld.golden-case-run/v1';
  caseId: string;
  manifestSha256: string;
  preregistrationSha256: string;
  formalRun: true;
  runs: GoldenRun[];
  decision: {
    status: 'pass' | 'fail' | 'uncertain';
    rk4FitsPass: boolean;
    oxygenSensitiveParameterRelativeDifference: number;
    parameterDifferencePass: boolean;
    normalizedRmseMax: number;
    threshold: { normalizedRmseMax: number; oxygenSensitiveParameterRelativeDifferenceMin: number };
  };
}

function scalar(result: PathExperimentResult, key: string): number {
  const value = result.experiment.outputs[key]?.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`golden run missing numeric output ${key}`);
  return value;
}

export async function runGoldenCase(caseRoot = path.join(repoRoot, 'research/golden-case')): Promise<GoldenRunReport> {
  const verified = verifyGoldenCase(caseRoot) as {
    caseId: string; manifestSha256: string; preregistrationSha256: string; datasets: GoldenDataset[];
  };
  const preregistration = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(path.join(caseRoot, 'preregistration.json'), 'utf8')));
  const buildProvenance = resolveAgentBuildProvenance();
  const models = [PHOTOSENSITIZATION_RK4_MODEL, PHOTOSENSITIZATION_STEADY_STATE_MODEL];
  const runs: GoldenRun[] = [];
  for (const dataset of verified.datasets) {
    for (const model of models) {
      const spec = buildGoldenSpec(dataset, model);
      const result = await runPathExperiment({ spec, agentId: 'golden-case-local', buildProvenance });
      runs.push({ condition: dataset.condition, model, spec, result });
    }
  }
  const rk4 = runs.filter((run) => run.model.id === PHOTOSENSITIZATION_RK4_MODEL.id);
  const rmses = rk4.map((run) => scalar(run.result, 'calibration.rmse'));
  const fittedKq = rk4.map((run) => scalar(run.result, 'fitted.k_q'));
  const relativeDifference = Math.abs(fittedKq[0] - fittedKq[1]) / Math.max(Math.abs(fittedKq[0]), Math.abs(fittedKq[1]), Number.EPSILON);
  const normalizedRmseMax = Math.max(...rmses);
  const threshold = {
    normalizedRmseMax: Number(preregistration.thresholds.normalizedRmseMax),
    oxygenSensitiveParameterRelativeDifferenceMin: Number(preregistration.thresholds.oxygenSensitiveParameterRelativeDifferenceMin),
  };
  const rk4FitsPass = normalizedRmseMax <= threshold.normalizedRmseMax;
  const parameterDifferencePass = relativeDifference >= threshold.oxygenSensitiveParameterRelativeDifferenceMin;
  return {
    schema: 'waveworld.golden-case-run/v1',
    caseId: verified.caseId,
    manifestSha256: verified.manifestSha256,
    preregistrationSha256: verified.preregistrationSha256,
    formalRun: true,
    runs,
    decision: {
      status: rk4FitsPass && parameterDifferencePass ? 'pass' : !rk4FitsPass ? 'fail' : 'uncertain',
      rk4FitsPass,
      oxygenSensitiveParameterRelativeDifference: relativeDifference,
      parameterDifferencePass,
      normalizedRmseMax,
      threshold,
    },
  };
}

export function resultSha256(result: PathExperimentResult): string {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runGoldenCase().then((report) => process.stdout.write(`${JSON.stringify(report)}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
