import type { ParticleScene } from '../../src/lib/sim/particles'

/** Small imported-style mixture with explicit species order and nonzero net charge. */
export function particleScene(): ParticleScene {
  return {
    species: [
      { name: 'User A', count: 2, charge: 1.25, sigma: 0.8, epsilon: 0.7 },
      { name: 'User B', count: 2, charge: -0.25, sigma: 1.2, epsilon: 1.4 },
    ],
    boxL: 10, temperature: 0.5, thermostat: true, steps: 7, seed: 42,
    epsR: 24, lambdaD: 2.4, kCoulomb: 2.2,
    // 2D 导入体系：positions/velocities 为 N·2 分量，须显式 dim（缺省为作业路径 3D）。
    dim: 2 as const,
    positions: [2, 2, 5, 3.1, 2.1, 5, 2.8, 3.3],
    velocities: [0.1, -0.05, 0, 0.05, 0.1, 0, -0.05, -0.1],
    kind: [1, 0, 1, 0],
  }
}
