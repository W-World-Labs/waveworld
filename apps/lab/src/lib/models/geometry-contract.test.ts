/**
 * Geometry contract + representative parse path (NACA STL, Duck/Milk Truck GLB).
 *
 * Run from apps/lab:
 *   node --import tsx --test src/lib/models/geometry-contract.test.ts
 */

import assert from 'node:assert/strict';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';

import type { ModelGeometry } from '@/types/model';
import {
  assertGeometryContract,
  checkGeometryContract,
  GeometryContractError,
  GEOMETRY_CONTRACT_LIMITS,
} from './geometry-contract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '../../../public/models');

function triangle(): ModelGeometry {
  return {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

// ---------------------------------------------------------------------------
// Unit: contract rules
// ---------------------------------------------------------------------------

test('assertGeometryContract accepts a minimal finite triangle', () => {
  assert.doesNotThrow(() => assertGeometryContract(triangle()));
  assert.equal(checkGeometryContract(triangle()).ok, true);
});

test('rejects empty mesh', () => {
  const g: ModelGeometry = {
    vertices: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
  };
  const r = checkGeometryContract(g);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /空|顶点/);
});

test('rejects non-finite vertices', () => {
  const g = triangle();
  g.vertices[0] = Number.NaN;
  assert.throws(() => assertGeometryContract(g), GeometryContractError);
  const r = checkGeometryContract(g);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'non_finite_vertex');
});

test('rejects non-finite normals', () => {
  const g = triangle();
  g.normals[1] = Number.POSITIVE_INFINITY;
  const r = checkGeometryContract(g);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'non_finite_normal');
});

test('rejects out-of-range indices', () => {
  const g = triangle();
  g.indices[2] = 99;
  const r = checkGeometryContract(g);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'index_range');
});

test('rejects face count over limit', () => {
  const g = triangle();
  assert.throws(
    () => assertGeometryContract(g, { maxFaces: 0 }),
    (err: unknown) => err instanceof GeometryContractError && err.code === 'face_limit'
  );
});

test('rejects degenerate bounding box', () => {
  const g: ModelGeometry = {
    vertices: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
  const r = checkGeometryContract(g);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'bbox_degenerate');
});

test('rejects oversized bounding extent', () => {
  const g = triangle();
  g.vertices[3] = 1e9; // x of second vertex
  const r = checkGeometryContract(g, { maxBoundingExtent: 1000 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'bbox_extent');
});

// ---------------------------------------------------------------------------
// Integration: real preset files under public/models
// ---------------------------------------------------------------------------

function loadFile(name: string): File {
  const p = path.join(MODELS_DIR, name);
  assert.ok(fs.existsSync(p), `missing model fixture: ${p}`);
  const buf = fs.readFileSync(p);
  return new File([buf], name);
}

/** GLTFLoader expects browser globals when textures are present (Node CI). */
function installNodeGltfPolyfills(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g.self) g.self = globalThis;
  if (!g.Image) {
    g.Image = class Image {
      width = 0;
      height = 0;
      onload: (() => void) | null = null;
      onerror: ((err?: unknown) => void) | null = null;
      private _src = '';
      set src(v: string) {
        this._src = v;
        queueMicrotask(() => {
          this.width = 1;
          this.height = 1;
          this.onload?.();
        });
      }
      get src() {
        return this._src;
      }
    };
  }
  if (!g.document) {
    g.document = {
      createElementNS: () => new g.Image(),
      createElement: () => new g.Image(),
    };
  }
}

test('parses NACA0012 STL and passes geometry contract', async () => {
  const { parseModelFile } = await import('./parser');
  const model = await parseModelFile(loadFile('naca0012.stl'));
  assert.ok(model.metadata.faceCount > 0);
  assert.ok(model.metadata.vertexCount >= 3);
  assert.equal(model.metadata.faceCount, 384);
  // parseModelFile already asserts contract; re-check for explicit test signal
  assert.doesNotThrow(() => assertGeometryContract(model.geometry));
  const bb = model.metadata.boundingBox;
  for (const n of [...bb.min, ...bb.max, ...bb.size]) {
    assert.ok(Number.isFinite(n), `bbox component ${n}`);
  }
  assert.ok(bb.size[0] > 0 || bb.size[1] > 0 || bb.size[2] > 0);
});

test('parses Duck GLB and passes geometry contract', async () => {
  installNodeGltfPolyfills();
  const { parseModelFile } = await import('./parser');
  const model = await parseModelFile(loadFile('duck.glb'));
  assert.ok(model.metadata.faceCount > 100, `faces=${model.metadata.faceCount}`);
  assert.ok(model.metadata.vertexCount > 100);
  assert.doesNotThrow(() => assertGeometryContract(model.geometry));
  // indices in range already enforced by contract
  const maxIdx = Math.max(...Array.from(model.geometry.indices.slice(0, 30)));
  assert.ok(maxIdx < model.geometry.vertices.length / 3);
});

test('parses Milk Truck GLB and passes geometry contract', async () => {
  installNodeGltfPolyfills();
  const { parseModelFile } = await import('./parser');
  const model = await parseModelFile(loadFile('milk-truck.glb'));
  assert.ok(model.metadata.faceCount > 100, `faces=${model.metadata.faceCount}`);
  assert.doesNotThrow(() => assertGeometryContract(model.geometry));
});

test('procedural NACA generator satisfies contract', async () => {
  const { generatePresetModel } = await import('./preset-models');
  const { geometry, metadata } = generatePresetModel('naca0012');
  assert.doesNotThrow(() => assertGeometryContract(geometry));
  assert.equal(metadata.id, 'naca0012');
  assert.ok(metadata.faceCount >= 1);
});

test('limits constants leave headroom for largest shipped preset file size', () => {
  // X-57 is ~13 MB on disk; contract byte budget is geometry arrays after expand.
  assert.ok(GEOMETRY_CONTRACT_LIMITS.maxGeometryBytes >= 50 * 1024 * 1024);
  assert.ok(GEOMETRY_CONTRACT_LIMITS.maxFaces >= 100_000);
});

// Geometry-only fixtures: no CFD steps, listeners or external downloads.
import { parseModelFile, parseStlGeometry } from './parser';
import { inspectGeometryTopology, encodeModelGeometry, decodeModelGeometry } from './geometry-contract';
const parseObj = (text: string) => parseModelFile(new File([text], 'fixture.obj'));
const positionsByFace = (g: ModelGeometry) => Array.from(g.indices, i => Array.from(g.vertices.slice(i * 3, i * 3 + 3)));

test('OBJ preserves source IDs, unused vertices and face order through job transport', async () => {
  const { geometry } = await parseObj('v 99 99 99\nv 0 0 0\nv 2 0 0\nv 0 3 0\nf 4 2 3 # source order differs');
  assert.deepEqual(positionsByFace(geometry), [[0, 3, 0], [0, 0, 0], [2, 0, 0]]);
  assert.deepEqual(Array.from(geometry.normals), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const decoded = decodeModelGeometry(encodeModelGeometry(geometry));
  assert.deepEqual(positionsByFace(decoded), positionsByFace(geometry));
  assert.deepEqual(decoded.normals, geometry.normals);
});

test('OBJ supports negative references and independent normal and texture indices', async () => {
  const { geometry } = await parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0.2 0.3\nvt 0.7 0.8\nvn 0 0 -1\nf -1/2/1 -3/1/1 -2/2/1\nv 999 999 999');
  assert.deepEqual(positionsByFace(geometry), [[0, 1, 0], [0, 0, 0], [1, 0, 0]]);
  assert.deepEqual(Array.from(geometry.normals), [0, 0, -1, 0, 0, -1, 0, 0, -1]);
  assert.deepEqual(geometry.uvs, new Float32Array([0.7, 0.8, 0.2, 0.3, 0.7, 0.8]));
});

test('OBJ concave triangulation preserves area and winding', async () => {
  const vertices = 'v 0 0 0\nv 2 0 0\nv 2 2 0\nv 1 1 0\nv 0 2 0\n';
  for (const [face, expected] of [['1 2 3 4 5', 3], ['5 4 3 2 1', -3]] as const) {
    const { geometry } = await parseObj(vertices + 'f ' + face);
    const points = positionsByFace(geometry); let area = 0;
    for (let i = 0; i < points.length; i += 3) {
      const [a, b, c] = points.slice(i, i + 3);
      const signed = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      assert.ok(signed * expected > 0, 'triangle winding'); area += signed;
    }
    assert.equal(area, expected);
  }
});

test('OBJ invalid references and nonplanar faces fail explicitly', async () => {
  const vertices = 'v 0 0 0\nv 1 0 0\nv 0 1 0\n';
  for (const face of ['0 2 3', '1 2 4', '-4 -2 -1', '1x 2 3', '1//1 2//1 3//1', '1/1 2/1 3/1']) {
    await assert.rejects(() => parseObj(vertices + 'f ' + face), GeometryContractError);
  }
  await assert.rejects(() => parseObj(vertices + 'v 1 1 1\nf 1 2 4 3'), /不共面/);
});

function tetrahedron(): ModelGeometry {
  return { vertices: new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,1]), normals: new Float32Array(0),
    indices: new Uint32Array([0,2,1, 0,1,3, 1,2,3, 2,0,3]) };
}

test('topology welds identical positions without changing geometry or closing real gaps', () => {
  const g = tetrahedron(), before = encodeModelGeometry(g), report = inspectGeometryTopology(g);
  assert.equal(report.isWatertight, true); assert.equal(report.manifoldEdges, 6);
  assert.deepEqual(report.topology, { boundaryEdges: 0, inconsistentEdges: 0, degenerateFaces: 0 });
  assert.deepEqual(encodeModelGeometry(g), before);
  const expanded = { vertices: new Float32Array(positionsByFace(g).flat()), normals: new Float32Array(0), indices: Uint32Array.from({length:12}, (_, i) => i) };
  assert.deepEqual(inspectGeometryTopology(expanded), report);
  expanded.vertices[0] = 1e-7;
  assert.equal(inspectGeometryTopology(expanded).isWatertight, false);
});

test('topology distinguishes open edges, winding conflicts, extra faces and zero-area triangles', () => {
  const open = tetrahedron(); open.indices = open.indices.slice(3);
  assert.equal(inspectGeometryTopology(open).topology?.boundaryEdges, 3);
  const flipped = tetrahedron(); [flipped.indices[0], flipped.indices[1]] = [flipped.indices[1], flipped.indices[0]];
  assert.equal(inspectGeometryTopology(flipped).topology?.inconsistentEdges, 3);
  const extra = tetrahedron(); extra.indices = new Uint32Array([...extra.indices, 0,2,1]);
  assert.equal(inspectGeometryTopology(extra).nonManifoldEdges, 3);
  const flat = triangle(); flat.vertices.set([0,0,0, 1,0,0, 2,0,0]);
  const report = inspectGeometryTopology(flat);
  assert.equal(report.topology?.degenerateFaces, 1); assert.equal(report.isWatertight, false);
});

test('topology keeps declared overlapping solids independent without inferring source-part semantics', () => {
  const a = tetrahedron();
  const together: ModelGeometry = { vertices: new Float32Array([...a.vertices, ...a.vertices]), normals: new Float32Array(0),
    indices: new Uint32Array([...a.indices, ...a.indices.map(i => i + 4)]),
    sourceParts: [{ id: 'first', name: 'First part', triangleStart: 0, triangleCount: 4 },
      { id: 'second', name: 'Second part', triangleStart: 4, triangleCount: 4 }] };
  assert.equal(inspectGeometryTopology(together).nonManifoldEdges, 6, 'display parts never declare solids');
  together.solidTriangleCounts = new Uint32Array([4, 4]);
  const before = encodeModelGeometry(together);
  assert.deepEqual(inspectGeometryTopology(together), { isWatertight: true, manifoldEdges: 12, nonManifoldEdges: 0,
    topology: { boundaryEdges: 0, inconsistentEdges: 0, degenerateFaces: 0 } });
  assert.deepEqual(encodeModelGeometry(together), before);
  assert.deepEqual(inspectGeometryTopology(decodeModelGeometry(before)), inspectGeometryTopology(together));
});

test('separate open boundary groups cannot close each other; cavities keep their declared grouping', () => {
  const split = { ...tetrahedron(), solidTriangleCounts: new Uint32Array([2, 2]) };
  const report = inspectGeometryTopology(split);
  assert.equal(report.isWatertight, false);
  assert.equal(report.topology?.boundaryEdges, 8);
  const outer = tetrahedron(), inner = tetrahedron();
  inner.vertices = inner.vertices.map(value => value * 0.2 + 0.1);
  const hollow: ModelGeometry = { vertices: new Float32Array([...outer.vertices, ...inner.vertices]), normals: new Float32Array(0),
    indices: new Uint32Array([...outer.indices, ...inner.indices.map(i => i + 4)]), solidTriangleCounts: new Uint32Array([8]) };
  const before = encodeModelGeometry(hollow);
  assert.equal(inspectGeometryTopology(hollow).isWatertight, true);
  assert.deepEqual(encodeModelGeometry(hollow), before, 'inspection must not split a cavity into another solid');
});

test('open imports report measured boundaries rather than assumed watertightness', async () => {
  const { metadata } = await parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3');
  assert.equal(metadata.isWatertight, false); assert.equal(metadata.topology?.boundaryEdges, 3);
});

test('truncated binary STL fails before allocation', () => {
  const bytes = new ArrayBuffer(84); new DataView(bytes).setUint32(80, 1_000_000, true);
  assert.throws(() => parseStlGeometry(bytes), /不完整/);
});

test('Agent and browser parse the same STL and reject the same invalid geometry', async (t: TestContext) => {
  const { loadModelGeometry } = await import('../../../agent/src/load-model');
  const source = 'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 2 0 0\nvertex 0 3 0\nendloop\nendfacet\nendsolid triangle';
  let body = source;
  const server = http.createServer((_req, res) => res.end(body));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // The production downloader validates the DNS result passed to the socket.
  // Map that public test answer to this local fixture only after validation.
  t.mock.method(dns, 'lookup', (_hostname: string, _options: dns.LookupOptions, callback: (error: Error | null, addresses: dns.LookupAddress[]) => void) => {
    process.nextTick(callback, null, [{ address: '93.184.216.34', family: 4 }]);
  });
  const realGet = http.get;
  t.mock.method(http, 'get', (url: URL, options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => realGet(url, {
    ...options,
    lookup: (hostname, lookupOptions, complete) => options.lookup!(hostname, lookupOptions, (error, address, family) => {
      if (error) { complete(error, ''); return; }
      if (Array.isArray(address)) {
        assert.deepEqual(address, [{ address: '93.184.216.34', family: 4 }]);
        complete(null, [{ address: '127.0.0.1', family: 4 }]);
      } else {
        assert.equal(address, '93.184.216.34');
        assert.equal(family, 4);
        complete(null, '127.0.0.1', 4);
      }
    }),
  }, callback));

  const url = `http://public.example.test:${(server.address() as AddressInfo).port}/mesh.stl`;
  const agent = await loadModelGeometry({source:'url',url});
  const browser = await parseModelFile(new File([source], 'mesh.stl'));
  assert.deepEqual(agent, browser.geometry);
  const invalid = source.replace('vertex 2 0 0', 'vertex NaN 0 0');
  body = invalid;
  await assert.rejects(() => loadModelGeometry({source:'url',url}), /非有限/);
  await assert.rejects(() => parseModelFile(new File([invalid], 'mesh.stl')), /非有限/);
});

test('shipped and procedural cylinder/sphere have closed outward faces without pole or seam defects', async () => {
  const { generatePresetModel } = await import('./preset-models');
  for (const id of ['cylinder', 'sphere']) {
    for (const model of [generatePresetModel(id), await parseModelFile(loadFile(id + '.stl'))]) {
      const { metadata, geometry: {vertices:v, indices} } = model;
      assert.equal(metadata.isWatertight, true, `${id}: ${JSON.stringify(metadata.topology)}`);
      let volume = 0;
      for (let f = 0; f < indices.length; f += 3) {
        const a = indices[f] * 3, b = indices[f + 1] * 3, c = indices[f + 2] * 3;
        volume += (v[a] * (v[b+1]*v[c+2]-v[b+2]*v[c+1]) + v[a+1] * (v[b+2]*v[c]-v[b]*v[c+2]) + v[a+2] * (v[b]*v[c+1]-v[b+1]*v[c])) / 6;
      }
      const expected = id === 'sphere' ? Math.PI / 6 : Math.PI / 2;
      assert.ok(Math.abs(volume - expected) / expected < 0.025, `${id}: signed volume=${volume}`);
    }
  }
  const airplane = await parseModelFile(loadFile('airplane.stl'));
  assert.equal(airplane.metadata.topology?.boundaryEdges, 0);
  assert.equal(airplane.metadata.topology?.degenerateFaces, 0);
  // The simplified assembly still has shared edges between overlapping components.
  assert.ok(airplane.metadata.nonManifoldEdges > 0);
  assert.equal(airplane.metadata.isWatertight, false);
});


test('WGM2 preserves explicit solids while WGM1 saved models retain their single boundary set', () => {
  const g = { ...tetrahedron(), solidTriangleCounts: new Uint32Array([4]) };
  const bytes = encodeModelGeometry(g);
  assert.deepEqual(decodeModelGeometry(bytes, 'application/vnd.waveworld.mesh-v2'), g);
  assert.throws(() => decodeModelGeometry(bytes, 'application/vnd.waveworld.mesh-v1'), /类型不匹配/);
  assert.throws(() => decodeModelGeometry(bytes.slice(0, -4)), /不完整/);
  for (const counts of [[0], [3], [4, 4]]) assert.throws(() => encodeModelGeometry({ ...g, solidTriangleCounts: new Uint32Array(counts) }), /实体分组/);
  // The persisted v1 header has no group word or group payload.
  const ungrouped = encodeModelGeometry(tetrahedron());
  const v1 = new Uint8Array(ungrouped.byteLength - 4);
  v1.set(new Uint8Array(ungrouped, 0, 16)); v1.set(new Uint8Array(ungrouped, 20), 16);
  new DataView(v1.buffer).setUint32(0, 0x314d4757, true);
  assert.deepEqual(decodeModelGeometry(v1.buffer, 'application/vnd.waveworld.mesh-v1'), tetrahedron());
  const malformed = bytes.slice(0);
  new DataView(malformed).setUint32(16, 0xffffffff, true);
  assert.throws(() => decodeModelGeometry(malformed), /大小无效/);
});

test('declared preset solids are tied to exact shipped bytes, never inferred for an uploaded STL', async () => {
  const { applyPresetSolidGroups, resetModelsManifestCacheForTests, isModelsManifest } = await import('./models-manifest');
  const { PRESET_MODELS, loadPresetModel, generatePresetModel } = await import('./preset-models');
  const { loadModelGeometry } = await import('../../../agent/src/load-model');
  const { voxelizeModel } = await import('@w-sim/solvers-lbm/d3q19');
  const manifest = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, 'manifest.json'), 'utf8'));
  assert.equal(isModelsManifest({ ...manifest, solidGroupsVersion: undefined }), false);
  const originalFetch = globalThis.fetch, originalRoot = process.env.TUANLIU_ROOT;
  process.env.TUANLIU_ROOT = path.resolve(MODELS_DIR, '../..');
  globalThis.fetch = async input => new Response(fs.readFileSync(path.join(MODELS_DIR, String(input).split('/').at(-1)!)));
  resetModelsManifestCacheForTests();
  try {
    for (const id of ['car', 'drivaer-lite', 'building', 'heatsink', 'server-chassis', 'airplane']) {
      const loaded = await loadPresetModel(PRESET_MODELS.find(p => p.id === id)!);
      assert.equal(loaded.fromFile, true, loaded.warning);
      assert.ok(loaded.geometry.solidTriangleCounts!.length > 1, id);
      assert.deepEqual(loaded.metadata.topology, inspectGeometryTopology(loaded.geometry).topology, id + ' uses declared-solid topology');
      assert.equal(loaded.metadata.isWatertight, generatePresetModel(id).metadata.isWatertight, id + ' file and generated topology agree');
      const agent = await loadModelGeometry({ source: 'preset', presetId: id });
      assert.deepEqual(agent, loaded.geometry, id);
      const raw = await loadFile(id + '.stl').arrayBuffer();
      assert.equal(parseStlGeometry(raw).solidTriangleCounts, undefined, 'uploads never inherit preset identity');
      {
        const options = { nx: 30, ny: 40, nz: 22, characteristicCells: 14, angleOfAttackDeg: 7 };
        const fromFile = voxelizeModel({ ...options, geometry: loaded.geometry });
        const generated = voxelizeModel({ ...options, geometry: generatePresetModel(id).geometry });
        assert.deepEqual(generated.flags, fromFile.flags, id + ' procedural and file masks');
      }
      const bad = raw.slice(0); new Uint8Array(bad)[0] ^= 1;
      await assert.rejects(applyPresetSolidGroups(parseStlGeometry(raw), bad, manifest.files.find((f: { file: string }) => f.file === id + '.stl')), /版本不一致/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRoot === undefined) delete process.env.TUANLIU_ROOT; else process.env.TUANLIU_ROOT = originalRoot;
    resetModelsManifestCacheForTests();
  }
});


test('car wheel axles span the vehicle width Z in generated and shipped geometry', async () => {
  const { generatePresetModel } = await import('./preset-models');
  const { applyPresetSolidGroups } = await import('./models-manifest');
  const raw = await loadFile('car.stl').arrayBuffer();
  const manifest = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, 'manifest.json'), 'utf8'));
  const shipped = await applyPresetSolidGroups(parseStlGeometry(raw), raw, manifest.files.find((file: { file: string }) => file.file === 'car.stl'));
  for (const geometry of [generatePresetModel('car').geometry, shipped]) {
    assert.deepEqual(Array.from(geometry.solidTriangleCounts!), [12, 12, 12, 12, 64, 64, 64, 64]);
    for (let wheel = 0; wheel < 4; wheel++) {
      const start = (48 + wheel * 64) * 3;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const vertex of geometry.indices.slice(start, start + 64 * 3)) {
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], geometry.vertices[vertex * 3 + axis]);
          max[axis] = Math.max(max[axis], geometry.vertices[vertex * 3 + axis]);
        }
      }
      for (const [axis, size] of [0.64, 0.64, 0.22].entries()) {
        assert.ok(Math.abs(max[axis] - min[axis] - size) < 1e-6, `wheel ${wheel + 1}, axis ${'XYZ'[axis]} must span ${size} m`);
      }
    }
  }
});
