import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runGoldenCase } from './run-golden-case.ts';
import { defaultPhotoParams, initPhotoState, rk4Step } from '../../src/lib/sim/photosensitization.ts';
import { runPhotoRk4OnPhysicalGpu } from '../../apps/lab/agent/src/backends/path-rk4-webgpu.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function runGoldenGpuComparison() {
  const report = await runGoldenCase(path.join(repoRoot, 'research/golden-case'));
  const preregistration = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(path.join(repoRoot, 'research/golden-case/preregistration.json'), 'utf8')));
  const comparisons = [];
  for (const run of report.runs.filter((candidate) => candidate.model.id === 'photosensitization-rk4')) {
    const parameters = { ...defaultPhotoParams(), ...run.spec.parameters, steps: run.spec.run.maxSteps } as ReturnType<typeof defaultPhotoParams>;
    parameters.k_exc = Number(run.result.experiment.outputs['fitted.k_exc'].value);
    parameters.k_q = Number(run.result.experiment.outputs['fitted.k_q'].value);
    let cpu = initPhotoState(parameters);
    const cpuStates = [cpu];
    for (let step = 0; step < parameters.steps; step++) { cpu = rk4Step(cpu, parameters, parameters.dt); cpuStates.push(cpu); }
    const gpu = await runPhotoRk4OnPhysicalGpu(parameters, parameters.steps);
    let maxAbsoluteError = 0; let maxRelativeError = 0;
    for (let step = 0; step <= parameters.steps; step++) {
      const expected = [cpuStates[step].S0, cpuStates[step].S1, cpuStates[step].T1, cpuStates[step].singletO2];
      for (let field = 0; field < 4; field++) {
        const actual = gpu.states[step * 4 + field];
        const absolute = Math.abs(actual - expected[field]);
        const relative = absolute / Math.max(Math.abs(expected[field]), 1e-12);
        maxAbsoluteError = Math.max(maxAbsoluteError, absolute);
        maxRelativeError = Math.max(maxRelativeError, relative);
      }
    }
    const absLimit = Number(preregistration.thresholds.cpuGpuAbsoluteTolerance);
    const relLimit = Number(preregistration.thresholds.cpuGpuRelativeTolerance);
    comparisons.push({ condition: run.condition, deviceName: gpu.deviceName, steps: parameters.steps,
      precision: 'GPU f32 versus CPU f64', maxAbsoluteError, maxRelativeError,
      pass: maxAbsoluteError <= absLimit || maxRelativeError <= relLimit, absLimit, relLimit });
  }
  return { schema: 'waveworld.golden-case-gpu-comparison/v1', caseId: report.caseId,
    preregistrationSha256: report.preregistrationSha256, comparisons,
    pass: comparisons.length === 2 && comparisons.every((comparison) => comparison.pass) };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runGoldenGpuComparison().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1;
  });
}
