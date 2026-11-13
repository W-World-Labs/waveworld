import { copyFile, mkdir } from 'node:fs/promises';

// Reuse the pinned Three.js package; builds and CI need no decoder CDN access.
const source = new URL('../examples/jsm/libs/draco/', import.meta.resolve('three'));
const target = new URL('../public/draco/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
  await copyFile(new URL(name, source), new URL(name, target));
}
console.log('Prepared same-origin Draco decoders from the installed Three.js package');
