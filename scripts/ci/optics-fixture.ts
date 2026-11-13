import type { OpticsComponent } from '../../src/lib/lab/optics-lab'

/** User-assembled split path, with a lens and polarizer on the transmitted arm. */
export function opticsScene(): OpticsComponent[] {
  return [
    { id: 'source', kind: 'laser', x: 100, y: 300, rot: 0, length: 40, power: 1.2, wavelengthNm: 532 },
    { id: 'split', kind: 'splitter', x: 420, y: 300, rot: 45, length: 90, splitT: 0.3 },
    { id: 'lens', kind: 'lens', x: 520, y: 300, rot: 0, length: 180, focalLength: 160 },
    { id: 'polarizer', kind: 'polarizer', x: 600, y: 300, rot: 0, length: 180, polAngleDeg: 35 },
    { id: 'transmitted', kind: 'screen', x: 740, y: 300, rot: 180, length: 200 },
    { id: 'reflected', kind: 'screen', x: 420, y: 80, rot: 90, length: 200 },
  ]
}
