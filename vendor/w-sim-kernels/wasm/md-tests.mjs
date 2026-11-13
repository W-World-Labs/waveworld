// Native/WASM parity for the molecular-dynamics kernel family behind the
// `md_*` and `particles_*` exports: homogeneous LJ NVE/NVT/NPT and
// heterogeneous LJ + screened-Coulomb runs go through the committed kernel
// artifact, then status words, the mutable scalar record, every caller buffer
// (including untouched sentinels) and the read/RDF/diffusion readouts are
// compared byte-exact against `md-parity-reference.rs`. No JS duplicate of
// pair iteration, minimum-image rounding or bounded-root bath scaling.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-md-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const module = new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64'));
assert.deepEqual(WebAssembly.Module.imports(module), []);

const u32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; };
const f32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
const f64 = values => { const b = Buffer.alloc(8 * values.length); values.forEach((v, i) => b.writeDoubleLE(v, i * 8)); return b; };
const sentinel = bytes => Buffer.alloc(bytes, 0xa5);

// The 32-byte config blob: u32 n/dim, u32 reserved0/reserved1, f64 dt, f64 rc.
const configBlob = c => {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(c.configN ?? c.n ?? 4, 0);
  b.writeUInt32LE(c.configDim ?? c.dim ?? 2, 4);
  b.writeUInt32LE(c.reserved0 ?? 0, 8);
  b.writeUInt32LE(c.reserved1 ?? 0, 12);
  b.writeDoubleLE(c.dt ?? .005, 16);
  b.writeDoubleLE(c.rc ?? 2.5, 24);
  return b;
};
// The 32-byte mutable scalar record: box_l, potential, virial, last_temperature.
const stateBlob = s => {
  const v = { box_l: 8, potential: -1.5, virial: .7, last_temperature: .8, ...s };
  return f64([v.box_l, v.potential, v.virial, v.last_temperature]);
};
// The 48-byte bath blob: u32 flags/reserved, then f64 targets, tau_p, kappa_t, max_scale.
const bathBlob = c => {
  const v = { flags: 0, reserved: 0, target_temperature: 0, target_pressure: 0, tau_p: .8, kappa_t: 1, max_scale: .02, ...c };
  const b = Buffer.alloc(48);
  b.writeUInt32LE(v.flags, 0);
  b.writeUInt32LE(v.reserved, 4);
  [v.target_temperature, v.target_pressure, v.tau_p, v.kappa_t, v.max_scale]
    .forEach((x, i) => b.writeDoubleLE(x, 8 + 8 * i));
  return b;
};
// The 24-byte screening record: f64 eps_r, lambda_d, k_coulomb.
const screeningBlob = s => {
  const v = { eps_r: 3.2, lambda_d: .9, k_coulomb: .7, ...s };
  return f64([v.eps_r, v.lambda_d, v.k_coulomb]);
};

const POS2 = [1, 1, 2.4, 1.1, 1.2, 2.6, 2.65, 2.5];
const POS3 = [1, 1, 1.2, 2.4, 1.1, 1.4, 1.2, 2.6, 1.6, 2.65, 2.5, 2.7];
const spread = (n, dim) => Array.from({ length: n * dim }, (_, i) => 1 + 1.1 * ((i / dim) | 0) + .55 * (i % dim));
const posDefault = (n, dim) => (dim === 2 && n === 4 ? POS2 : dim === 3 && n === 4 ? POS3 : spread(n, dim)).slice(0, n * dim);
const velDefault = len => Array.from({ length: len }, (_, i) => ((i * 7) % 5 - 2) * .05);
const forceDefault = len => Array.from({ length: len }, (_, i) => ((i * 5) % 7 - 3) * .04);
const chargeDefault = n => Array.from({ length: n }, (_, i) => [1, -1, .5, -.5, .25][i % 5]);
const sigmaDefault = n => Array.from({ length: n }, (_, i) => .9 + .1 * (i % 3));

// Per-entry-point case-file tail and appended output regions; the reference
// oracle documents the same wire layout at the top of md-parity-reference.rs.
const LAYOUT = {
  init: { op: 0, tail: 'full' },
  step: { op: 1, tail: 'full' },
  batch: { op: 2, tail: 'full', bath: true },
  barostat: { op: 3, tail: 'full', bath: true, out: 'scale' },
  force: { op: 4, tail: 'pf' },
  read: { op: 5, tail: 'read', out: 'stats9' },
  rdf: { op: 6, tail: 'pos', out: 'rdf' },
  diffusion: { op: 7, tail: 'series', out: 'diff' },
  pinit: { op: 8, tail: 'full', particle: 'full' },
  pstep: { op: 9, tail: 'full', particle: 'full' },
  pbatch: { op: 10, tail: 'full', particle: 'full' },
  pforce: { op: 11, tail: 'pf', particle: 'full' },
  pread: { op: 12, tail: 'read', particle: 'charge', out: 'stats10' },
};

const cases = [
  // md_init: prepared 2D/3D states, then record and state rejections.
  { op: 'init', name: 'init-2d' },
  { op: 'init', name: 'init-3d', dim: 3 },
  { op: 'init', name: 'init-3d-five', dim: 3, n: 5 },
  { op: 'init', name: 'init-coincident', pos: [1, 1, 1, 1, 2.6, 2.6, 4, 4] },
  { op: 'init', name: 'init-nan-pos', pos: POS2.with(3, NaN) },
  { op: 'init', name: 'init-nan-vel', vel: velDefault(8).with(6, Infinity) },
  { op: 'init', name: 'init-reserved0', reserved0: 1 },
  { op: 'init', name: 'init-reserved1', reserved1: 7 },
  { op: 'init', name: 'init-dim-1', configDim: 1 },
  { op: 'init', name: 'init-dim-4', configDim: 4 },
  { op: 'init', name: 'init-zero-n', configN: 0 },
  { op: 'init', name: 'init-box-zero', state: { box_l: 0 } },
  { op: 'init', name: 'init-box-nan', state: { box_l: NaN } },
  { op: 'init', name: 'init-dt-zero', dt: 0 },
  { op: 'init', name: 'init-dt-neg', dt: -.005 },
  { op: 'init', name: 'init-rc-overflow', rc: 1e300 },
  // md_step: single Verlet on supplied mid-run state.
  { op: 'step', name: 'step-2d' },
  { op: 'step', name: 'step-3d', dim: 3 },
  { op: 'step', name: 'step-nan-force', force: forceDefault(8).with(2, NaN) },
  { op: 'step', name: 'step-neg-temp', state: { last_temperature: -1 } },
  { op: 'step', name: 'step-nan-potential', state: { potential: NaN } },
  // md_batch: NVE, thermostat roots of degrees 1..4, embedded barostat, 3D.
  { op: 'batch', name: 'batch-nve-4', steps: 4, bath: {} },
  { op: 'batch', name: 'batch-nvt-1', steps: 1, bath: { flags: 1, target_temperature: .4 } },
  { op: 'batch', name: 'batch-nvt-2', steps: 2, bath: { flags: 1, target_temperature: .4 } },
  { op: 'batch', name: 'batch-nvt-3', steps: 3, bath: { flags: 1, target_temperature: .4 } },
  { op: 'batch', name: 'batch-npt-4', steps: 4, bath: { flags: 3, target_temperature: .4, target_pressure: .15 } },
  { op: 'batch', name: 'batch-npt-3d', dim: 3, steps: 3, bath: { flags: 3, target_temperature: .4, target_pressure: .15 } },
  { op: 'batch', name: 'batch-cold-nvt', steps: 2, state: { last_temperature: 0 }, bath: { flags: 1, target_temperature: .4 } },
  { op: 'batch', name: 'batch-steps-0', steps: 0, bath: {} },
  { op: 'batch', name: 'batch-steps-5', steps: 5, bath: {} },
  { op: 'batch', name: 'batch-bath-flags', steps: 1, bath: { flags: 4 } },
  { op: 'batch', name: 'batch-bath-reserved', steps: 1, bath: { reserved: 1 } },
  { op: 'batch', name: 'batch-disabled-temp', steps: 1, bath: { flags: 0, target_temperature: .4 } },
  { op: 'batch', name: 'batch-disabled-temp-negzero', steps: 1, bath: { flags: 0, target_temperature: -0 } },
  { op: 'batch', name: 'batch-disabled-pressure', steps: 1, bath: { flags: 1, target_temperature: .4, target_pressure: .2 } },
  { op: 'batch', name: 'batch-max-scale-1', steps: 1, bath: { flags: 1, target_temperature: .4, max_scale: 1 } },
  { op: 'batch', name: 'batch-kappa-neg', steps: 1, bath: { kappa_t: -1 } },
  { op: 'batch', name: 'batch-temp-neg', steps: 1, bath: { flags: 1, target_temperature: -.4 } },
  // md_barostat: direct scale readout, clamps and documented no-ops.
  { op: 'barostat', name: 'barostat-expand', bath: { flags: 2, target_pressure: -1e6 } },
  { op: 'barostat', name: 'barostat-shrink', bath: { flags: 2, target_pressure: 1e3 } },
  { op: 'barostat', name: 'barostat-3d', dim: 3, bath: { flags: 2, target_pressure: 1e3 } },
  { op: 'barostat', name: 'barostat-no-target', bath: { flags: 1, target_temperature: .4 } },
  { op: 'barostat', name: 'barostat-tau-zero', bath: { flags: 2, target_pressure: .15, tau_p: 0 } },
  { op: 'barostat', name: 'barostat-tau-nan', bath: { flags: 2, target_pressure: .15, tau_p: NaN } },
  { op: 'barostat', name: 'barostat-tau-inf', bath: { flags: 2, target_pressure: .15, tau_p: Infinity } },
  // md_force: potential/virial writeback on the scalar record.
  { op: 'force', name: 'force-2d' },
  { op: 'force', name: 'force-3d', dim: 3 },
  { op: 'force', name: 'force-beyond-rc', pos: [.5, .5, 4, 4, .5, 4, 4, .5] },
  { op: 'force', name: 'force-bad-box', state: { box_l: -1 } },
  // md_read: speed array plus all nine observables.
  { op: 'read', name: 'read-2d' },
  { op: 'read', name: 'read-3d', dim: 3 },
  { op: 'read', name: 'read-inf-potential', state: { potential: Infinity } },
  // md_rdf: histogram, r/g outputs and r_max clamping.
  { op: 'rdf', name: 'rdf-2d', bins: 8, rMax: 4 },
  { op: 'rdf', name: 'rdf-3d', dim: 3, bins: 8, rMax: 4 },
  { op: 'rdf', name: 'rdf-clamped', bins: 8, rMax: 100 },
  { op: 'rdf', name: 'rdf-bins-0', bins: 0, rMax: 4 },
  { op: 'rdf', name: 'rdf-rmax-0', bins: 8, rMax: 0 },
  { op: 'rdf', name: 'rdf-rmax-nan', bins: 8, rMax: NaN },
  // md_diffusion: Einstein fit on supplied MSD series.
  { op: 'diffusion', name: 'diffusion-2d', len: 5, skip: .2 },
  { op: 'diffusion', name: 'diffusion-3d', len: 5, argDim: 3 },
  { op: 'diffusion', name: 'diffusion-empty', len: 0 },
  { op: 'diffusion', name: 'diffusion-skip-1', len: 4, skip: 1 },
  { op: 'diffusion', name: 'diffusion-one-fit', len: 4, skip: .75 },
  { op: 'diffusion', name: 'diffusion-bad-dim', len: 4, argDim: 4 },
  { op: 'diffusion', name: 'diffusion-skip-over', len: 4, skip: 1.5 },
  { op: 'diffusion', name: 'diffusion-nan-time', len: 4, times: [.005, NaN, .015, .02] },
  // particles_*: heterogeneous properties, screened Coulomb and thermostat.
  { op: 'pinit', name: 'pinit-mixed' },
  { op: 'pinit', name: 'pinit-neutral', charge: [0, 0, 0, 0] },
  { op: 'pinit', name: 'pinit-no-coulomb', screening: { k_coulomb: 0 } },
  { op: 'pinit', name: 'pinit-3d', dim: 3 },
  { op: 'pinit', name: 'pinit-sigma-zero', sigma: [1, 0, 1, 1] },
  { op: 'pinit', name: 'pinit-epsilon-neg', epsilon: [1, -1, 1, 1] },
  { op: 'pinit', name: 'pinit-k-neg', screening: { k_coulomb: -1 } },
  { op: 'pinit', name: 'pinit-eps-nan', screening: { eps_r: NaN } },
  { op: 'pinit', name: 'pinit-charge-nan', charge: [1, NaN, .5, -.5] },
  { op: 'pstep', name: 'pstep-2d' },
  { op: 'pstep', name: 'pstep-3d', dim: 3 },
  { op: 'pbatch', name: 'pbatch-nve', steps: 4, thermostat: 0 },
  { op: 'pbatch', name: 'pbatch-nvt', steps: 3, thermostat: 1, target: .4 },
  { op: 'pbatch', name: 'pbatch-nvt-cold', steps: 2, thermostat: 1, target: .4, state: { last_temperature: 0 } },
  { op: 'pbatch', name: 'pbatch-thermostat-2', steps: 1, thermostat: 2 },
  { op: 'pbatch', name: 'pbatch-target-set', steps: 1, thermostat: 0, target: .5 },
  { op: 'pbatch', name: 'pbatch-target-negzero', steps: 1, thermostat: 0, target: -0 },
  { op: 'pbatch', name: 'pbatch-target-neg', steps: 1, thermostat: 1, target: -.4 },
  { op: 'pbatch', name: 'pbatch-steps-0', steps: 0, thermostat: 0 },
  { op: 'pforce', name: 'pforce-2d' },
  { op: 'pforce', name: 'pforce-3d', dim: 3 },
  { op: 'pread', name: 'pread-2d' },
  { op: 'pread', name: 'pread-3d', dim: 3 },
];

function run(c) {
  const L = LAYOUT[c.op], op = L.op;
  const n = c.n ?? 4, dim = c.dim ?? 2, len = n * dim;
  const bins = c.bins ?? 0, series = c.len ?? 0;
  const steps = c.steps ?? 0;
  const arg = c.op === 'rdf' ? bins : c.op === 'diffusion' ? series : steps;
  const argf = c.rMax ?? c.skip ?? c.target ?? 0;
  const arg2 = c.argDim ?? c.thermostat ?? (c.op === 'diffusion' ? dim : 0);
  const e = new WebAssembly.Instance(module).exports;
  let at = Math.ceil(e.heap_base() / 8) * 8;
  const alloc = (bytes, a = 8) => { at = Math.ceil(at / a) * a; const p = at; at += bytes; return p; };
  const cp = alloc(32), sp = alloc(32);
  const bp = L.bath ? alloc(48) : 0;
  const scrP = L.particle === 'full' ? alloc(24) : 0;
  const qP = L.particle ? alloc(4 * n, 4) : 0;
  const sigP = L.particle === 'full' ? alloc(4 * n, 4) : 0;
  const epsP = L.particle === 'full' ? alloc(4 * n, 4) : 0;
  const posP = L.tail === 'read' || L.tail === 'series' ? 0 : alloc(4 * len, 4);
  const velP = L.tail === 'full' || L.tail === 'read' ? alloc(4 * len, 4) : 0;
  const forceP = L.tail === 'full' || L.tail === 'pf' ? alloc(4 * len, 4) : 0;
  const unwrP = L.tail === 'full' || L.tail === 'read' ? alloc(4 * len, 4) : 0;
  const pos0P = L.tail === 'read' ? alloc(4 * len, 4) : 0;
  const speedP = L.tail === 'read' ? alloc(4 * n, 4) : 0;
  const statsP = L.out === 'stats9' || L.out === 'stats10' ? alloc(80) : 0;
  const scaleP = L.out === 'scale' ? alloc(8) : 0;
  const histP = L.out === 'rdf' ? alloc(8 * Math.max(bins, 1)) : 0;
  const rP = L.out === 'rdf' ? alloc(4 * Math.max(bins, 1), 4) : 0;
  const gP = L.out === 'rdf' ? alloc(4 * Math.max(bins, 1), 4) : 0;
  const rdfP = L.out === 'rdf' ? alloc(16) : 0;
  const timesP = L.tail === 'series' && series ? alloc(8 * series) : 0;
  const msdP = L.tail === 'series' && series ? alloc(8 * series) : 0;
  const doutP = L.out === 'diff' ? alloc(40) : 0;
  if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
  const mem = new Uint8Array(e.memory.buffer);
  const initLike = c.op === 'init' || c.op === 'pinit';
  const posB = f32(c.pos ?? posDefault(n, dim));
  const velB = f32(c.vel ?? velDefault(len));
  const forceB = c.force ? f32(c.force) : initLike ? sentinel(4 * len) : f32(forceDefault(len));
  const unwrB = c.unwrapped ? f32(c.unwrapped) : initLike ? sentinel(4 * len) : f32(posDefault(n, dim).map((v, i) => v + .01 * (i % 3)));
  const pos0B = f32(c.pos0 ?? posDefault(n, dim));
  const times = c.times ?? Array.from({ length: series }, (_, i) => (i + 1) * .005);
  const msd = c.msd ?? Array.from({ length: series }, (_, i) => (i + 1) ** 2 * 1e-6);
  const cfg = configBlob(c), st = stateBlob(c.state), bth = L.bath ? bathBlob(c.bath) : null;
  const scr = scrP ? screeningBlob(c.screening) : null;
  const qB = qP ? f32(c.charge ?? chargeDefault(n)) : null;
  const sigB = sigP ? f32(c.sigma ?? sigmaDefault(n)) : null;
  const epsB = epsP ? f32(c.epsilon ?? Array(n).fill(1)) : null;
  mem.set(cfg, cp); mem.set(st, sp);
  if (bth) mem.set(bth, bp);
  if (scr) mem.set(scr, scrP);
  if (qB) mem.set(qB, qP); if (sigB) mem.set(sigB, sigP); if (epsB) mem.set(epsB, epsP);
  if (posP) mem.set(posB, posP);
  if (velP) mem.set(velB, velP);
  if (forceP) mem.set(forceB, forceP);
  if (unwrP) mem.set(unwrB, unwrP);
  if (pos0P) mem.set(pos0B, pos0P);
  if (speedP) mem.fill(0xa5, speedP, speedP + 4 * n);
  if (statsP) mem.fill(0xa5, statsP, statsP + 80);
  if (scaleP) mem.fill(0xa5, scaleP, scaleP + 8);
  if (histP) { mem.fill(0xa5, histP, histP + 8 * Math.max(bins, 1)); mem.fill(0xa5, rP, rP + 4 * Math.max(bins, 1)); mem.fill(0xa5, gP, gP + 4 * Math.max(bins, 1)); mem.fill(0xa5, rdfP, rdfP + 16); }
  if (timesP) { mem.set(f64(times), timesP); mem.set(f64(msd), msdP); }
  if (doutP) mem.fill(0xa5, doutP, doutP + 40);

  const status = (() => {
    switch (op) {
      case 0: return e.md_init(cp, sp, posP, velP, forceP, unwrP);
      case 1: return e.md_step(cp, sp, posP, velP, forceP, unwrP);
      case 2: return e.md_batch(cp, sp, bp, posP, velP, forceP, unwrP, steps);
      case 3: return e.md_barostat(cp, sp, bp, posP, velP, forceP, unwrP, scaleP);
      case 4: return e.md_force(cp, sp, posP, forceP);
      case 5: return e.md_read(cp, sp, pos0P, velP, unwrP, speedP, statsP);
      case 6: return e.md_rdf(cp, sp, posP, bins, c.rMax ?? 4, histP, rP, gP, rdfP);
      case 7: return e.md_diffusion(timesP, msdP, series, arg2, c.skip ?? 0, doutP);
      case 8: return e.particles_init(cp, sp, scrP, posP, velP, forceP, unwrP, qP, sigP, epsP);
      case 9: return e.particles_step(cp, sp, scrP, posP, velP, forceP, unwrP, qP, sigP, epsP);
      case 10: return e.particles_batch(cp, sp, scrP, posP, velP, forceP, unwrP, qP, sigP, epsP, c.target ?? 0, c.thermostat ?? 0, steps);
      case 11: return e.particles_force(cp, sp, scrP, posP, forceP, qP, sigP, epsP);
      case 12: return e.particles_read(cp, sp, pos0P, velP, unwrP, qP, speedP, statsP);
    }
  })();

  const slice = (p, bytes) => Buffer.from(mem.slice(p, p + bytes));
  const parts = [u32([status]), slice(sp, 32)];
  if (bp) parts.push(slice(bp, 48));
  if (scrP) parts.push(slice(scrP, 24));
  if (qB) parts.push(slice(qP, 4 * n));
  if (sigB) parts.push(slice(sigP, 4 * n), slice(epsP, 4 * n));
  if (L.tail === 'full') parts.push(slice(posP, 4 * len), slice(velP, 4 * len), slice(forceP, 4 * len), slice(unwrP, 4 * len));
  if (L.tail === 'pf') parts.push(slice(posP, 4 * len), slice(forceP, 4 * len));
  if (L.tail === 'read') parts.push(slice(pos0P, 4 * len), slice(velP, 4 * len), slice(unwrP, 4 * len));
  if (L.tail === 'pos') parts.push(slice(posP, 4 * len));
  if (L.tail === 'series' && series) parts.push(slice(timesP, 8 * series), slice(msdP, 8 * series));
  if (scaleP) parts.push(slice(scaleP, 8));
  if (speedP) parts.push(slice(speedP, 4 * n));
  if (statsP) parts.push(slice(statsP, op === 12 ? 80 : 72));
  if (histP) parts.push(slice(histP, 8 * bins), slice(rP, 4 * bins), slice(gP, 4 * bins), slice(rdfP, 16));
  if (doutP) parts.push(slice(doutP, 40));

  const head = Buffer.alloc(32);
  head.writeUInt32LE(op, 0); head.writeUInt32LE(n, 4); head.writeUInt32LE(dim, 8);
  head.writeUInt32LE(arg, 12); head.writeDoubleLE(argf, 16); head.writeUInt32LE(arg2, 24);
  const fileParts = [head, cfg, st];
  if (bth) fileParts.push(bth);
  if (scr) fileParts.push(scr);
  if (qB) fileParts.push(qB);
  if (sigB) fileParts.push(sigB, epsB);
  if (L.tail === 'full') fileParts.push(posB, velB, forceB, unwrB);
  if (L.tail === 'pf') fileParts.push(posB, forceB);
  if (L.tail === 'read') fileParts.push(pos0B, velB, unwrB);
  if (L.tail === 'pos') fileParts.push(posB);
  if (L.tail === 'series' && series) fileParts.push(f64(times), f64(msd));
  return { input: Buffer.concat(fileParts), got: Buffer.concat(parts) };
}

try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'md-parity-reference'), file = join(scratch, 'input');
  execFileSync('rustc', [join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib], { stdio: 'inherit', timeout: 60000 });
  execFileSync('rustc', [fileURLToPath(new URL('./md-parity-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native], { stdio: 'inherit', timeout: 60000 });

  for (const c of cases) {
    const r = run(c);
    writeFileSync(file, r.input);
    assert.deepEqual(r.got, execFileSync(native, [file], { timeout: 10000 }), `${c.name}: status/state/buffers/readouts native/WASM bytes`);
  }

  // ABI-level rejections return status 2 (or the documented early status)
  // without touching a single caller byte.
  {
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const base = at;
    const alloc = (bytes, a = 8) => { at = Math.ceil(at / a) * a; const p = at; at += bytes; return p; };
    const n = 4, len = 8;
    const cp = alloc(32), sp = alloc(32), bp = alloc(48), scr = alloc(24);
    const pos = alloc(4 * len, 4), vel = alloc(4 * len, 4), force = alloc(4 * len, 4), unwr = alloc(4 * len, 4), pos0 = alloc(4 * len, 4);
    const q = alloc(4 * n, 4), sigma = alloc(4 * n, 4), eps = alloc(4 * n, 4);
    const speed = alloc(4 * n, 4), stats = alloc(80), hist = alloc(64), r = alloc(32, 4), g = alloc(32, 4), rstats = alloc(16);
    const times = alloc(40), msd = alloc(40), dout = alloc(40), scale = alloc(8), guard = alloc(8);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const mem = new Uint8Array(e.memory.buffer);
    mem.set(configBlob({}), cp);
    mem.set(stateBlob({}), sp);
    mem.set(bathBlob({ flags: 3, target_temperature: .4, target_pressure: .15 }), bp);
    mem.set(screeningBlob({}), scr);
    mem.set(f32(posDefault(n, 2)), pos); mem.set(f32(velDefault(len)), vel);
    mem.set(f32(forceDefault(len)), force); mem.set(f32(posDefault(n, 2)), unwr); mem.set(f32(posDefault(n, 2)), pos0);
    mem.set(f32(chargeDefault(n)), q); mem.set(f32(sigmaDefault(n)), sigma); mem.set(f32(Array(n).fill(1)), eps);
    mem.fill(0xa5, guard, guard + 8);
    assert.equal(e.md_init(cp, sp, pos, vel, force, unwr), 0);
    const snapshot = Buffer.from(mem.slice(base));
    const same = () => assert.deepEqual(Buffer.from(mem.slice(base)), snapshot, 'rejection precedes caller-memory writes');
    const end = e.memory.buffer.byteLength;
    for (const [call, want] of [
      // config/state: null, misaligned, below heap, aliasing particle buffers.
      [() => e.md_init(0, sp, pos, vel, force, unwr), 2],
      [() => e.md_init(cp + 4, sp, pos, vel, force, unwr), 2],
      [() => e.md_init(e.heap_base() - 8, sp, pos, vel, force, unwr), 2],
      [() => e.md_init(cp, sp + 4, pos, vel, force, unwr), 2],
      [() => e.md_init(cp, cp, pos, vel, force, unwr), 2],
      // pos/vel/force/unwrapped: pairwise alias, misalignment, out of bounds.
      [() => e.md_init(cp, sp, pos, pos, force, unwr), 2],
      [() => e.md_init(cp, sp, pos, vel, force, pos), 2],
      [() => e.md_init(cp, sp, pos, vel, force, unwr + 1), 2],
      [() => e.md_init(cp, sp, pos, vel, force, end - 4), 2],
      [() => e.md_step(cp, sp, pos, vel, vel, unwr), 2],
      // bath and the standalone barostat scale output.
      [() => e.md_batch(cp, sp, 0, pos, vel, force, unwr, 1), 2],
      [() => e.md_batch(cp, sp, bp + 4, pos, vel, force, unwr, 1), 2],
      [() => e.md_batch(cp, sp, pos, pos, vel, force, unwr, 1), 7],
      [() => e.md_batch(cp, sp, bp, pos, vel, force, bp, 1), 2],
      [() => e.md_barostat(cp, sp, bp, pos, vel, force, unwr, 0), 2],
      [() => e.md_barostat(cp, sp, bp, pos, vel, force, unwr, sp), 2],
      [() => e.md_barostat(cp, sp, bp, pos, vel, force, unwr, scale + 1), 2],
      // force-only recompute.
      [() => e.md_force(cp, sp, pos, pos), 2],
      [() => e.md_force(cp, 0, pos, force), 2],
      [() => e.md_force(cp, sp, pos, force + 2), 2],
      // read/RDF/diffusion outputs and their aliases.
      [() => e.md_read(cp, sp, pos0, vel, unwr, vel, stats), 2],
      [() => e.md_read(cp, sp, pos0, vel, unwr, speed, stats + 4), 2],
      [() => e.md_read(cp, sp, pos0, vel, unwr, speed, end - 8), 2],
      [() => e.md_rdf(cp, sp, pos, 8, 4, hist, hist, g, rstats), 2],
      [() => e.md_rdf(cp, sp, pos, 8, 4, hist, r, g, hist), 2],
      [() => e.md_rdf(cp, sp, pos, 8, 4, end - 8, r, g, rstats), 2],
      [() => e.md_diffusion(times, msd, 4, 2, .2, times), 2],
      [() => e.md_diffusion(0, msd, 4, 2, .2, dout), 2],
      [() => e.md_diffusion(times, 0, 4, 2, .2, dout), 2],
      [() => e.md_diffusion(times, msd, 4, 2, .2, dout + 4), 2],
      // screening record and per-particle properties.
      [() => e.particles_init(cp, sp, 0, pos, vel, force, unwr, q, sigma, eps), 2],
      [() => e.particles_init(cp, sp, scr + 4, pos, vel, force, unwr, q, sigma, eps), 2],
      [() => e.particles_init(cp, sp, scr, pos, vel, force, unwr, q + 1, sigma, eps), 2],
      [() => e.particles_init(cp, sp, scr, pos, vel, force, unwr, q, sigma, pos), 2],
      [() => e.particles_step(cp, sp, scr, pos, vel, force, unwr, sigma, sigma, eps), 2],
      [() => e.particles_batch(cp, sp, scr, pos, vel, force, unwr, unwr, sigma, eps, .4, 1, 1), 2],
      [() => e.particles_read(cp, sp, pos0, vel, unwr, q, q, stats), 2],
      [() => e.particles_read(cp, sp, pos0, vel, unwr, q, speed, end - 8), 2],
      [() => e.particles_force(cp, sp, scr, pos, scr, q, sigma, eps), 2],
      [() => e.particles_force(cp, sp, scr, pos, force, q, sigma, end - 4), 2],
      // Documented kernel-level rejections also write nothing.
      [() => e.md_batch(cp, sp, bp, pos, vel, force, unwr, 0), 3],
      [() => e.md_batch(cp, sp, bp, pos, vel, force, unwr, 5), 3],
      [() => e.md_diffusion(times, msd, 4, 4, .2, dout), 6],
      [() => e.md_diffusion(times, msd, 4, 2, 1.5, dout), 3],
      [() => e.md_rdf(cp, sp, pos, 8, -1, hist, r, g, rstats), 3],
      [() => e.particles_batch(cp, sp, scr, pos, vel, force, unwr, q, sigma, eps, 0, 2, 1), 7],
      [() => e.particles_batch(cp, sp, scr, pos, vel, force, unwr, q, sigma, eps, .5, 0, 1), 7],
    ]) {
      assert.equal(call(), want);
      same();
    }
    assert.equal(e.md_step(cp, sp, pos, vel, force, unwr), 0, 'same memory reusable after rejected calls');
    assert.equal(e.md_diffusion(0, 0, 0, 2, .2, dout), 0, 'empty diffusion series is admitted');
  }
  console.log(`MD: ${cases.length} binary cases native/WASM byte-exact over md_init/step/batch/barostat/force/read/rdf/diffusion and all particles_* exports — NVE/NVT/NPT, 2D/3D, thermostat roots 1-4, scale clamps and no-op taus, screened-Coulomb variants, RDF/diffusion readouts, and every documented record/state rejection; ABI alias/bounds block leaves caller memory untouched.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
