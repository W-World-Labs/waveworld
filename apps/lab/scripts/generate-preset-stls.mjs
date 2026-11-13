#!/usr/bin/env node
/**
 * Generate binary STL files for all wind-tunnel presets into public/models/.
 * Orientation: long axis +X (flow), up +Y, span +Z; nose toward -X when applicable.
 *
 * Usage: node scripts/generate-preset-stls.mjs [cylinder.stl sphere.stl ...]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'models');

// ─── mesh helpers ───────────────────────────────────────────────────────────

function emptyMesh() {
  return { positions: [], indices: [], solidTriangleCounts: [] };
}

function addBox(mesh, cx, cy, cz, sx, sy, sz) {
  const firstTriangle = mesh.indices.length / 3;
  const base = mesh.positions.length / 3;
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  for (const p of v) mesh.positions.push(...p);
  // outward faces (CCW from outside)
  const faces = [
    [0, 2, 1], [0, 3, 2], // -z
    [4, 5, 6], [4, 6, 7], // +z
    [0, 1, 5], [0, 5, 4], // -y
    [3, 7, 6], [3, 6, 2], // +y
    [0, 4, 7], [0, 7, 3], // -x
    [1, 2, 6], [1, 6, 5], // +x
  ];
  for (const f of faces) mesh.indices.push(base + f[0], base + f[1], base + f[2]);
  mesh.solidTriangleCounts.push(mesh.indices.length / 3 - firstTriangle);
}

function addCylinderY(mesh, cx, cy0, cy1, r, cz, seg = 24) {
  const firstTriangle = mesh.indices.length / 3;
  const base = mesh.positions.length / 3;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    mesh.positions.push(cx + Math.cos(a) * r, cy0, cz + Math.sin(a) * r);
  }
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    mesh.positions.push(cx + Math.cos(a) * r, cy1, cz + Math.sin(a) * r);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    mesh.indices.push(base + i, base + seg + j, base + j);
    mesh.indices.push(base + i, base + seg + i, base + seg + j);
  }
  const c0 = mesh.positions.length / 3;
  mesh.positions.push(cx, cy0, cz);
  const c1 = mesh.positions.length / 3;
  mesh.positions.push(cx, cy1, cz);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    mesh.indices.push(c0, base + i, base + j);
    mesh.indices.push(c1, base + seg + j, base + seg + i);
  }
  mesh.solidTriangleCounts.push(mesh.indices.length / 3 - firstTriangle);
}

function addCylinderX(mesh, x0, x1, r, cy, cz, seg = 16) {
  const firstTriangle = mesh.indices.length / 3;
  const base = mesh.positions.length / 3;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    mesh.positions.push(x0, cy + Math.cos(a) * r, cz + Math.sin(a) * r);
  }
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    mesh.positions.push(x1, cy + Math.cos(a) * r, cz + Math.sin(a) * r);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    mesh.indices.push(base + i, base + j, base + seg + j);
    mesh.indices.push(base + i, base + seg + j, base + seg + i);
  }
  const c0 = mesh.positions.length / 3;
  mesh.positions.push(x0, cy, cz);
  const c1 = mesh.positions.length / 3;
  mesh.positions.push(x1, cy, cz);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    mesh.indices.push(c0, base + j, base + i);
    mesh.indices.push(c1, base + seg + i, base + seg + j);
  }
  mesh.solidTriangleCounts.push(mesh.indices.length / 3 - firstTriangle);
}

function addSphere(mesh, cx, cy, cz, r, wSeg = 32, hSeg = 16) {
  const firstTriangle = mesh.indices.length / 3;
  const base = mesh.positions.length / 3;
  for (let y = 0; y <= hSeg; y++) {
    const v = y / hSeg;
    const phi = v * Math.PI;
    for (let x = 0; x <= wSeg; x++) {
      const u = x / wSeg;
      const theta = x === wSeg ? 0 : u * Math.PI * 2;
      const radial = y === 0 || y === hSeg ? 0 : Math.sin(phi);
      const px = cx - r * Math.cos(theta) * radial;
      const py = cy + r * Math.cos(phi);
      const pz = cz + r * Math.sin(theta) * radial;
      mesh.positions.push(px, py, pz);
    }
  }
  for (let y = 0; y < hSeg; y++) {
    for (let x = 0; x < wSeg; x++) {
      const a = base + y * (wSeg + 1) + x;
      const b = a + wSeg + 1;
      if (y > 0) mesh.indices.push(a, b, a + 1);
      if (y < hSeg - 1) mesh.indices.push(b, b + 1, a + 1);
    }
  }
  mesh.solidTriangleCounts.push(mesh.indices.length / 3 - firstTriangle);
}

function nacaYt(x, t = 0.12) {
  return (t / 0.2) * (
    0.2969 * Math.sqrt(Math.max(0, x)) -
    0.1260 * x -
    0.3516 * x * x +
    0.2843 * x * x * x -
    0.1015 * x * x * x * x
  );
}

/** Closed extruded airfoil along +Z (span). Chord along X, thickness along Y. */
function addAirfoilExtrude(mesh, chord, t, z0, z1, n = 40, ox = 0, oy = 0) {
  const outline = [];
  for (let i = n; i >= 0; i--) {
    const x = 0.5 * (1 - Math.cos((i / n) * Math.PI));
    outline.push([ox + x * chord, oy + nacaYt(x, t) * chord]);
  }
  for (let i = 1; i < n; i++) {
    const x = 0.5 * (1 - Math.cos((i / n) * Math.PI));
    outline.push([ox + x * chord, oy - nacaYt(x, t) * chord]);
  }
  const m = outline.length;
  const firstTriangle = mesh.indices.length / 3;
  const base = mesh.positions.length / 3;
  for (const [x, y] of outline) mesh.positions.push(x, y, z0);
  for (const [x, y] of outline) mesh.positions.push(x, y, z1);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    mesh.indices.push(base + i, base + j, base + m + j);
    mesh.indices.push(base + i, base + m + j, base + m + i);
  }
  let ccx = 0, ccy = 0;
  for (const [x, y] of outline) { ccx += x; ccy += y; }
  ccx /= m; ccy /= m;
  const fc = mesh.positions.length / 3;
  mesh.positions.push(ccx, ccy, z0);
  const bc = mesh.positions.length / 3;
  mesh.positions.push(ccx, ccy, z1);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    mesh.indices.push(fc, base + j, base + i);
    mesh.indices.push(bc, base + m + i, base + m + j);
  }
  mesh.solidTriangleCounts.push(mesh.indices.length / 3 - firstTriangle);
}

function transformMesh(mesh, fn) {
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, z] = fn(p[i], p[i + 1], p[i + 2]);
    p[i] = x; p[i + 1] = y; p[i + 2] = z;
  }
}

export function encodeBinaryStl(mesh, name = 'model') {
  const { positions, indices } = mesh;
  const faceCount = indices.length / 3;
  const buf = Buffer.alloc(84 + faceCount * 50);
  buf.write(name.slice(0, 80), 0, 'ascii');
  buf.writeUInt32LE(faceCount, 80);
  let o = 84;
  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3] * 3;
    const i1 = indices[f * 3 + 1] * 3;
    const i2 = indices[f * 3 + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    buf.writeFloatLE(nx, o); buf.writeFloatLE(ny, o + 4); buf.writeFloatLE(nz, o + 8);
    buf.writeFloatLE(ax, o + 12); buf.writeFloatLE(ay, o + 16); buf.writeFloatLE(az, o + 20);
    buf.writeFloatLE(bx, o + 24); buf.writeFloatLE(by, o + 28); buf.writeFloatLE(bz, o + 32);
    buf.writeFloatLE(cx, o + 36); buf.writeFloatLE(cy, o + 40); buf.writeFloatLE(cz, o + 44);
    buf.writeUInt16LE(0, o + 48);
    o += 50;
  }
  return buf;
}

function writeBinaryStl(filePath, mesh, name) {
  fs.writeFileSync(filePath, encodeBinaryStl(mesh, name));
  return mesh.indices.length / 3;
}

function parseAsciiStl(text) {
  const positions = [];
  const indices = [];
  const lines = text.split(/\r?\n/);
  let tri = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('vertex')) {
      const p = t.split(/\s+/);
      tri.push(parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]));
      if (tri.length === 9) {
        const base = positions.length / 3;
        positions.push(...tri);
        indices.push(base, base + 1, base + 2);
        tri = [];
      }
    }
  }
  return { positions, indices };
}

// ─── generators ─────────────────────────────────────────────────────────────

function genNaca0012() {
  const m = emptyMesh();
  // chord 1 along X, span 0.5 along Z, thickness Y — leading edge at x=0 (nose -x relative to center after shift)
  addAirfoilExtrude(m, 1.0, 0.12, -0.25, 0.25, 48);
  // center on origin, LE toward -x slightly: already LE at 0, center chord mid
  transformMesh(m, (x, y, z) => [x - 0.5, y, z]);
  return m;
}

function genCylinder() {
  const m = emptyMesh();
  // vertical cylinder (axis +Y) for classic 2D-like drag view with span
  addCylinderY(m, 0, -1, 1, 0.5, 0, 48);
  return m;
}

function genSphere() {
  const m = emptyMesh();
  addSphere(m, 0, 0, 0, 0.5, 40, 20);
  return m;
}

function genCar() {
  const m = emptyMesh();
  // Sedan-like: length X (nose -x), up Y, width Z
  const L = 4.5, W = 1.8, H = 0.55;
  // body
  addBox(m, 0, H / 2 + 0.15, 0, L, H, W * 0.95);
  // cabin
  addBox(m, -0.15, H + 0.15 + 0.28, 0, L * 0.48, 0.55, W * 0.88);
  // hood slope proxy (front box lower)
  addBox(m, -L * 0.32, 0.15 + 0.32, 0, L * 0.28, 0.35, W * 0.9);
  // trunk
  addBox(m, L * 0.32, 0.15 + 0.38, 0, L * 0.22, 0.4, W * 0.9);
  // wheels
  const wr = 0.32, ww = 0.22;
  for (const [x, z] of [[-1.4, -W / 2], [-1.4, W / 2], [1.35, -W / 2], [1.35, W / 2]]) {
    const first = m.positions.length;
    addCylinderX(m, -ww / 2, ww / 2, wr, wr, 0, 16);
    // Rigid +90° rotation about Y puts the wheel axle along vehicle width Z.
    for (let i = first; i < m.positions.length; i += 3) {
      const axial = m.positions[i];
      m.positions[i] = x + m.positions[i + 2];
      m.positions[i + 2] = z - axial;
    }
  }
  // nose toward -x already (hood at -x)
  return m;
}

function genAirplane() {
  const m = emptyMesh();
  // fuselage along X, nose -x, up Y, span Z
  addCylinderX(m, -5, 5, 0.55, 0, 0, 20);
  // nose cone (taper approx as smaller cylinder + sphere)
  addSphere(m, -5, 0, 0, 0.55, 16, 10);
  // main wing
  addBox(m, 0.2, -0.05, 0, 2.2, 0.18, 12);
  // horizontal tail
  addBox(m, 4.2, 0.1, 0, 1.0, 0.12, 4.2);
  // vertical tail
  addBox(m, 4.2, 0.9, 0, 1.0, 1.5, 0.12);
  // engines under wing
  addCylinderX(m, -0.6, 1.0, 0.28, -0.45, -2.5, 12);
  addCylinderX(m, -0.6, 1.0, 0.28, -0.45, 2.5, 12);
  return m;
}

function genAhmedProcedural() {
  // Standard Ahmed 25°: L=1.044, W=0.389, H=0.288; slant at rear (+x)
  const m = emptyMesh();
  const L = 1.044, W = 0.389, H = 0.288;
  const slantLen = 0.222; // ~H/tan(25°) approx for 25°
  const bodyL = L - slantLen;
  addBox(m, bodyL / 2, H / 2, 0, bodyL, H, W);
  // slant wedge as thin boxes stacked (simple)
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const x0 = bodyL + t0 * slantLen;
    const x1 = bodyL + t1 * slantLen;
    const h0 = H * (1 - t0);
    const h1 = H * (1 - t1);
    const hMid = (h0 + h1) / 2;
    const cx = (x0 + x1) / 2;
    const dx = x1 - x0;
    addBox(m, cx, hMid / 2, 0, dx + 0.001, hMid, W);
  }
  // front nose at x=0 → transform so nose is -x (flip X around center)
  transformMesh(m, (x, y, z) => [-(x - L / 2), y, z]);
  return m;
}

function genOneraM6() {
  // Simplified ONERA M6 semi-span: 30° leading-edge sweep, taper, ONERA-D-like (use NACA-ish 10%)
  // root chord ~0.8059 m, tip ~0.453 m, semi-span 1.1963 m — scale to ~1 m semi-span
  const m = emptyMesh();
  const semiSpan = 1.1963;
  const rootChord = 0.8059;
  const tipChord = 0.4532;
  const sweepLE = (30 * Math.PI) / 180;
  const sections = 16;
  const n = 36;
  const t = 0.098; // ~10% thick

  // build loft between root (z=0) and tip (z=semiSpan)
  const sectionPts = (chord, leX, z) => {
    const pts = [];
    for (let i = n; i >= 0; i--) {
      const u = 0.5 * (1 - Math.cos((i / n) * Math.PI));
      pts.push([leX + u * chord, nacaYt(u, t) * chord, z]);
    }
    for (let i = 1; i < n; i++) {
      const u = 0.5 * (1 - Math.cos((i / n) * Math.PI));
      pts.push([leX + u * chord, -nacaYt(u, t) * chord, z]);
    }
    return pts;
  };

  const rings = [];
  for (let s = 0; s <= sections; s++) {
    const eta = s / sections;
    const z = eta * semiSpan;
    const chord = rootChord * (1 - eta) + tipChord * eta;
    const leX = Math.tan(sweepLE) * z;
    rings.push(sectionPts(chord, leX, z));
  }
  const mRing = rings[0].length;
  for (const ring of rings) {
    for (const p of ring) m.positions.push(...p);
  }
  for (let s = 0; s < sections; s++) {
    const b0 = s * mRing;
    const b1 = (s + 1) * mRing;
    for (let i = 0; i < mRing; i++) {
      const j = (i + 1) % mRing;
      m.indices.push(b0 + i, b0 + j, b1 + j);
      m.indices.push(b0 + i, b1 + j, b1 + i);
    }
  }
  // root & tip caps
  const cap = (base, reverse) => {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < mRing; i++) {
      cx += m.positions[(base + i) * 3];
      cy += m.positions[(base + i) * 3 + 1];
      cz += m.positions[(base + i) * 3 + 2];
    }
    cx /= mRing; cy /= mRing; cz /= mRing;
    const c = m.positions.length / 3;
    m.positions.push(cx, cy, cz);
    for (let i = 0; i < mRing; i++) {
      const j = (i + 1) % mRing;
      if (reverse) m.indices.push(c, base + j, base + i);
      else m.indices.push(c, base + i, base + j);
    }
  };
  cap(0, true);
  cap(sections * mRing, false);

  // center roughly on origin; root at z=0 (symmetry plane)
  transformMesh(m, (x, y, z) => [x - rootChord * 0.4, y, z - semiSpan * 0.15]);
  return m;
}

function genServerChassis() {
  const m = emptyMesh();
  // Same open structural example as generateServerChassis in preset-models.ts.
  const L = 0.45, H = 0.09, D = 0.4, t = 0.012;
  addBox(m, 0, t / 2, 0, L, t, D);
  addBox(m, 0, H - t / 2, 0, L, t, D);
  addBox(m, 0, H / 2, -D / 2 + t / 2, L, H - 2 * t, t);
  addBox(m, 0, H / 2, D / 2 - t / 2, L, H - 2 * t, t);
  addBox(m, 0.04, 0.018, 0, 0.22, 0.012, 0.36); // motherboard
  for (const z of [-0.09, 0.09]) {
    addBox(m, -0.145, 0.024, z, 0.11, 0.024, 0.12); // drive bay
    addBox(m, 0.04, 0.03, z, 0.06, 0.012, 0.07); // processor package
    addBox(m, 0.04, 0.042, z, 0.09, 0.012, 0.10); // heat spreader
    for (const offset of [-0.036, 0, 0.036]) {
      addBox(m, 0.04, 0.057, z + offset, 0.09, 0.018, 0.012); // fins, 24 mm gaps
    }
  }
  for (const z of [-0.165, 0.165]) {
    addBox(m, 0.03, 0.036, z, 0.16, 0.024, 0.012); // memory bank
  }
  addBox(m, 0.17, 0.037, 0.14, 0.10, 0.05, 0.09); // power supply
  return m;
}

function genHeatSink() {
  const m = emptyMesh();
  const L = 0.09, W = 0.063, T_BASE = 0.007, H_FIN = 0.025, T_FIN = 0.0045, N_FIN = 6, PITCH = 0.0105;
  addBox(m, 0, T_BASE / 2, 0, L, T_BASE, W);
  const pack = N_FIN * T_FIN + (N_FIN - 1) * (PITCH - T_FIN);
  for (let k = 0; k < N_FIN; k++) {
    const z0 = -pack / 2 + k * PITCH;
    addBox(m, 0, T_BASE + H_FIN / 2, z0 + T_FIN / 2, L, H_FIN, T_FIN);
  }
  return m;
}

function genCube() {
  const m = emptyMesh();
  addBox(m, 0, 0, 0, 1, 1, 1);
  return m;
}

function genCone() {
  const m = emptyMesh();
  // cone along X: base at +x, apex at -x (nose -x)
  const seg = 36;
  const r = 0.5;
  const xApex = -0.75, xBase = 0.75;
  const base = m.positions.length / 3;
  m.positions.push(xApex, 0, 0);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    m.positions.push(xBase, Math.cos(a) * r, Math.sin(a) * r);
  }
  const cBase = m.positions.length / 3;
  m.positions.push(xBase, 0, 0);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    m.indices.push(base, base + 1 + j, base + 1 + i);
    m.indices.push(cBase, base + 1 + i, base + 1 + j);
  }
  return m;
}

function genBuilding() {
  const m = emptyMesh();
  // simple high-rise: tall in Y, flow along X
  addBox(m, 0, 1.5, 0, 0.8, 3.0, 0.8);
  // podium
  addBox(m, 0, 0.2, 0, 1.4, 0.4, 1.4);
  // setback top
  addBox(m, 0, 3.15, 0, 0.55, 0.3, 0.55);
  return m;
}

function genDrivAerLite() {
  // slightly more detailed bluff body car than Ahmed
  const m = emptyMesh();
  const L = 4.6, W = 1.9, H = 1.4;
  addBox(m, 0.1, 0.45, 0, L * 0.9, 0.7, W * 0.95); // lower body
  addBox(m, -0.2, 1.0, 0, L * 0.5, 0.7, W * 0.9); // cabin
  addBox(m, -L * 0.35, 0.55, 0, 0.9, 0.45, W * 0.9); // nose
  addBox(m, L * 0.35, 0.55, 0, 0.7, 0.45, W * 0.9); // rear
  // mirrors
  addBox(m, -0.5, 0.95, W * 0.52, 0.15, 0.1, 0.12);
  addBox(m, -0.5, 0.95, -W * 0.52, 0.15, 0.1, 0.12);
  // wheels
  for (const [x, z] of [[-1.4, -0.75], [-1.4, 0.75], [1.4, -0.75], [1.4, 0.75]]) {
    addCylinderX(m, x - 0.12, x + 0.12, 0.35, 0.35, z, 14);
  }
  return m;
}

export const GENERATED_PRESETS = [
  ['naca0012.stl', genNaca0012],
  ['cylinder.stl', genCylinder],
  ['sphere.stl', genSphere],
  ['car.stl', genCar],
  ['airplane.stl', genAirplane],
  ['onera-m6.stl', genOneraM6],
  ['server-chassis.stl', genServerChassis],
  ['heatsink.stl', genHeatSink],
  ['cube.stl', genCube],
  ['cone.stl', genCone],
  ['building.stl', genBuilding],
  ['drivaer-lite.stl', genDrivAerLite],
];

// ─── main ───────────────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const selected = new Set(process.argv.slice(2));
  for (const name of selected) if (name !== 'ahmed.stl' && !GENERATED_PRESETS.some(([file]) => file === name)) throw new Error(`Unknown preset file: ${name}`);
  for (const [name, gen] of GENERATED_PRESETS) {
    if (selected.size && !selected.has(name)) continue;
    const mesh = gen();
    const faces = writeBinaryStl(path.join(OUT, name), mesh, name);
    const size = fs.statSync(path.join(OUT, name)).size;
    console.log(`✓ ${name.padEnd(22)} faces=${String(faces).padStart(6)}  ${(size / 1024).toFixed(1)} KB`);
  }

  if (selected.size && !selected.has('ahmed.stl')) return;

  // Reorient downloaded Ahmed: (x,y,z) Z-up width-Y → Y-up, nose -x
  const ahmedPath = path.join(OUT, 'ahmed.stl');
  if (fs.existsSync(ahmedPath)) {
    const raw = fs.readFileSync(ahmedPath);
    let mesh;
    if (raw[0] === 0x73 /* 's' of solid */) {
      mesh = parseAsciiStl(raw.toString('utf8'));
    } else {
      // binary fallback
      const faces = raw.readUInt32LE(80);
      const positions = [];
      const indices = [];
      let o = 84;
      for (let f = 0; f < faces; f++) {
        const base = positions.length / 3;
        o += 12; // skip normal
        for (let v = 0; v < 3; v++) {
          positions.push(raw.readFloatLE(o), raw.readFloatLE(o + 4), raw.readFloatLE(o + 8));
          o += 12;
        }
        indices.push(base, base + 1, base + 2);
        o += 2;
      }
      mesh = { positions, indices };
    }
    // Z-up → Y-up: (x,y,z)->(x,z,-y); then nose: slant is at max x → flip so rear stays +x? 
    // README: 车头朝 -x. Ahmed rear slant is at high x in source → nose low x. Good for flow +x.
    // After (x,z,-y): still nose at min x. Flip X so nose -x relative to center: x' = -(x - mid)
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      minX = Math.min(minX, mesh.positions[i]);
      maxX = Math.max(maxX, mesh.positions[i]);
    }
    const midX = (minX + maxX) / 2;
    transformMesh(mesh, (x, y, z) => {
      // Z-up width-Y → Y-up width-Z, keep nose at smaller x then flip around center for -x nose
      const x1 = x;
      const y1 = z;
      const z1 = -y;
      return [-(x1 - midX), y1, z1];
    });
    const faces = writeBinaryStl(ahmedPath, mesh, 'ahmed_25deg_yup');
    console.log(`✓ ahmed.stl (reoriented)  faces=${faces}  ${(fs.statSync(ahmedPath).size / 1024).toFixed(1)} KB`);
  } else {
    const faces = writeBinaryStl(ahmedPath, genAhmedProcedural(), 'ahmed_proc');
    console.log(`✓ ahmed.stl (procedural)  faces=${faces}`);
  }

  console.log(`\nDone → ${OUT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
