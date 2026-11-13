export default {
  manifest: {
    id: 'fixture-runtime-model',
    version: '1.0.0',
    backends: ['cpu'],
    parameters: { alpha: { type: 'number', required: true, min: 0 } },
    outputs: { score: { type: 'number' } }
  },
  run({ parameters, maxSteps }) {
    return { steps: maxSteps, metrics: { score: Number(parameters.alpha) } };
  }
};
