import type { FluidScene, ConvectionScene } from '../../src/lib/sim/fluid'

export function fluidScene(): FluidScene {
  return { viscosity: 0.00005, diffusion: 0.00001, rotation: 0.02, decay: 0.995, steps: 3,
    seeds: [{ x: 1, y: 1, radius: 2, density: 40, vx: 0.5, vy: -0.2 }],
    inlet: { speed: 0.3, density: 2, spacing: 10, width: 2 },
    obstacle: Array.from({ length: 10000 }, (_, i) => [5030, 5031, 5130, 5131].includes(i) ? 1 : 0) }
}

export function convectionScene(): ConvectionScene {
  return { buoyancy: 0.07, steps: 3, initialDrop: true,
    seeds: [{ x: 55, y: 65, hot: false }, { x: 1, y: 1, hot: true }] }
}
