import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelFile } from './parser';
import { assertModelSourceParts } from './source-parts';

// Three vertices plus two instance translations/scales: no network, CAD or solver.
function fixture() {
  const bytes = Buffer.concat([
    Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer),
    Buffer.from(new Float32Array([2, 0, 0, -2, 0, 0]).buffer),
    Buffer.from(new Float32Array([1, 2, 1, -1, 1, 1]).buffer),
    Buffer.from(new Uint16Array([0, 1, 2]).buffer),
  ]);
  return {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Assembly', children: [1, 2] },
      { name: 'Repeated name', mesh: 0 },
      { name: 'Repeated name', mesh: 0, translation: [0, 0, 2] },
    ],
    meshes: [{ name: 'Original mesh', primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 24 },
      { buffer: 0, byteOffset: 84, byteLength: 6 },
    ],
    accessors: [
      // Deliberately loose bounds: the importer must use the actual positions.
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-2, 0, 0], max: [2, 2, 2] },
      { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
}

async function load(source: object) {
  return parseModelFile(new File([JSON.stringify(source)], 'assembly.gltf'));
}

test('preserves original duplicate names, stable IDs and exact occurrence face ranges', async () => {
  const source = fixture(), model = await load(source);
  assert.deepEqual(model.geometry.sourceParts, [
    { id: 'gltf-node:0', name: 'Assembly', triangleStart: 0, triangleCount: 2 },
    { id: 'gltf-node:1', parentId: 'gltf-node:0', name: 'Repeated name', triangleStart: 0, triangleCount: 1 },
    { id: 'gltf-node:2', parentId: 'gltf-node:0', name: 'Repeated name', triangleStart: 1, triangleCount: 1 },
  ]);
  assert.equal(model.geometry.solidTriangleCounts, undefined);
  assert.deepEqual(model.metadata.boundingBox.size, [1, 1, 2]);
  source.nodes[1].name = 'Renamed fan';
  const renamed = await load(source);
  assert.deepEqual(renamed.geometry.sourceParts?.map(p => p.id), model.geometry.sourceParts?.map(p => p.id));
  assertModelSourceParts(model.geometry);
});

test('mesh plus children has a separate geometry leaf; empty nodes are omitted; all primitives survive', async () => {
  const source = fixture();
  const nodes = [{ name: 'Mesh with child', mesh: 0, children: [1, 2] }, { name: 'Child', mesh: 0 }, { name: 'Empty' }];
  const single = await load({ ...source, nodes });
  assert.deepEqual(single.geometry.sourceParts?.map(p => [p.name, p.triangleStart, p.triangleCount]), [
    ['Mesh with child', 0, 2], ['自身网格', 0, 1], ['Child', 1, 1],
  ]);
  source.meshes[0].primitives.push({ attributes: { POSITION: 0 }, mode: 4 });
  const multi = await load({ ...source, nodes });
  assert.equal(multi.metadata.faceCount, 4);
  const parts = multi.geometry.sourceParts!;
  const parents = new Set(parts.map(p => p.parentId));
  assert.equal(parts.filter(p => !parents.has(p.id)).length, 4);
  assertModelSourceParts(multi.geometry);
});

test('expands world × instance transforms and repairs mirrored winding with matching normals', async () => {
  const source = fixture();
  const nodes = [
    { name: 'Parent', translation: [10, 0, 0], children: [1] },
    { name: 'Fan instances', mesh: 0, translation: [0, 5, 0],
      extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 1, SCALE: 2 } } } },
  ];
  const model = await load({ ...source, nodes, extensionsUsed: ['EXT_mesh_gpu_instancing'] });
  assert.deepEqual([...model.geometry.vertices], [12, 5, 0, 13, 5, 0, 12, 7, 0, 8, 5, 0, 7, 5, 0, 8, 6, 0]);
  assert.deepEqual([...model.geometry.indices], [0, 1, 2, 3, 5, 4]);
  model.geometry.normals.forEach((normal, i) => assert.ok(normal === (i % 3 === 2 ? 1 : 0)));
  assert.deepEqual(model.geometry.sourceParts?.map(p => [p.name, p.triangleCount]), [
    ['Parent', 2], ['Fan instances', 2], ['实例 1', 1], ['实例 2', 1],
  ]);
  assertModelSourceParts(model.geometry);
  // Two negative determinants cancel. Exercise the indexed path as well.
  const mirrored = await load({ ...source,
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 3 }] }],
    nodes: [{ ...nodes[0], scale: [-1, 1, 1] }, nodes[1]], extensionsUsed: ['EXT_mesh_gpu_instancing'],
  });
  assert.deepEqual([...mirrored.geometry.indices], [0, 2, 1, 3, 4, 5]);
});

test('rigid animation imports authored node transforms, not its first animated keyframe', async () => {
  const source = fixture();
  const bytes = Buffer.concat([
    Buffer.from(source.buffers[0].uri.split(',')[1], 'base64'), Buffer.alloc(2),
    Buffer.from(new Float32Array([0, 1]).buffer),
    Buffer.from(new Float32Array([100, 0, 0, 200, 0, 0]).buffer),
  ]);
  const model = await load({ ...source,
    nodes: [source.nodes[0], { ...source.nodes[1], translation: [3, 4, 5] }, source.nodes[2]],
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: [...source.bufferViews, { buffer: 0, byteOffset: 92, byteLength: 8 }, { buffer: 0, byteOffset: 100, byteLength: 24 }],
    accessors: [...source.accessors,
      { bufferView: 4, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 5, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    animations: [{ samplers: [{ input: 4, output: 5 }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }],
  });
  assert.deepEqual([...model.geometry.vertices.slice(0, 9)], [3, 4, 5, 4, 4, 5, 3, 5, 5]);
  assert.deepEqual(model.geometry.sourceParts?.map(p => p.id), ['gltf-node:0', 'gltf-node:1', 'gltf-node:2']);
});

test('rejects skin and morph declarations anywhere, including unused and zero-weight targets', async () => {
  const source = fixture();
  await assert.rejects(load({ ...source, skins: [{ joints: [0] }] }), /蒙皮和形变目标/);
  await assert.rejects(load({ ...source, meshes: [...source.meshes,
    { weights: [0], primitives: [{ attributes: { POSITION: 0 }, targets: [{ POSITION: 0 }] }] },
  ] }), /蒙皮和形变目标/);
  await assert.rejects(load({ ...source, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] }] }), /三角网格/);
});

test('preflight bounds geometry and instances before loading, and bounds empty/repeated trees', async () => {
  const source = fixture();
  const huge = structuredClone(source); huge.accessors[0].count = 6_000_003;
  await assert.rejects(load(huge), /展开后的网格超过/);
  const instances = structuredClone(source); instances.accessors[1].count = 16_385;
  await assert.rejects(load({ ...instances, extensionsUsed: ['EXT_mesh_gpu_instancing'], nodes: [
    { mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 1 } } } },
  ] }), /实例数量/);
  await assert.rejects(load({ ...source, nodes: [{ children: [0] }] }), /循环/);
  await assert.rejects(load({ ...source, nodes: Array.from({ length: 65 }, (_, i) => i === 64 ? { mesh: 0 } : { children: [i + 1] }) }), /64 层/);
  await assert.rejects(load({ ...source, nodes: [{}], scenes: [{ nodes: Array(16_385).fill(0) }] }), /节点总数/);
  await assert.rejects(load({ ...source, nodes: [{ mesh: 0, name: 'x'.repeat(257) }] }), /名称/);
});

test('rejects singular transforms and oversized transformed extents', async () => {
  const source = fixture();
  await assert.rejects(load({ ...source, nodes: [{ mesh: 0, scale: [0, 1, 1] }] }), /变换/);
  await assert.rejects(load({ ...source, nodes: [{ children: [1, 2] }, { mesh: 0 }, { mesh: 0, translation: [1e9, 0, 0] }] }), /坐标范围/);
});

test('embedded buffers decode locally with fetch-compatible bytes, without data: requests', async t => {
  const source = fixture(), expected = await load(source);
  const bytes = Buffer.from(source.buffers[0].uri.split(',')[1], 'base64');
  const percent = [...bytes].map(byte => `%${byte.toString(16).padStart(2, '0')}`).join('');
  const uris = [
    `data:application/octet-stream,${percent}%FF%00%80+?query#excluded`,
    `data:,${percent}%invalid%2520`,
    `data:;BASE64,${bytes.toString('base64').replace(/=/g, '%3D')}#excluded`,
    `data:application/gltf-buffer; base64,${bytes.toString('base64').replace(/=/g, '')}\n`,
    `data:application/octet-stream;base64,${bytes.toString('base64').replace(/.{8}/g, '$& ')}`,
  ];
  // Node's independent data: implementation is the byte oracle, outside the importer.
  const oracle = await Promise.all(uris.map(async uri => new Uint8Array(await (await fetch(uri)).arrayBuffer())));
  const created: { url: string; blob: Blob }[] = [], revoked: string[] = [];
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL, originalFetch = fetch;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { const url = create(blob); created.push({ url, blob }); return url; });
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); revoke(url); });
  t.mock.method(globalThis, 'fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(!String(input instanceof Request ? input.url : input).startsWith('data:'));
    return originalFetch(input, init);
  });
  for (const [index, uri] of uris.entries()) {
    const model = await load({ ...source, buffers: [{ byteLength: oracle[index].length, uri }] });
    assert.deepEqual(model.geometry, expected.geometry);
    assert.deepEqual(new Uint8Array(await created[index].blob.arrayBuffer()), oracle[index]);
    assert.equal(revoked[index], created[index].url);
  }
  assert.equal(created.length, uris.length);
});

test('one import shares duplicate embedded resources and releases them on success or failure', async t => {
  const source = fixture();
  const created: string[] = [], revoked: string[] = [];
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { const url = create(blob); created.push(url); return url; });
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); revoke(url); });
  const doubled = { ...source, buffers: [source.buffers[0], source.buffers[0]],
    bufferViews: [...source.bufferViews, { buffer: 1, byteOffset: 0, byteLength: 36 }],
    accessors: [...source.accessors, { ...source.accessors[0], bufferView: 4 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 4 } }] }],
  };
  assert.equal((await load(doubled)).metadata.faceCount, 4);
  assert.equal(created.length, 1);
  assert.deepEqual(revoked, created);

  const invalid = structuredClone(source);
  const bytes = Buffer.from(invalid.buffers[0].uri.split(',')[1], 'base64');
  bytes.writeUInt16LE(65535, 84);
  invalid.buffers[0].uri = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
  await assert.rejects(load({ ...invalid, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 3 }] }] }), /三角面索引越界/);
  assert.equal(created.length, 2);
  assert.deepEqual(revoked, created);

  for (const uri of ['data:missing-comma', 'data:;base64,A', 'data:;base64,AA?=', 'data:;base64,%EF%BB%BFYQ==']) {
    await assert.rejects(load({ ...source, buffers: [{ byteLength: 90, uri }] }), /glTF 内嵌资源/);
  }
  assert.equal(created.length, 2);
  assert.deepEqual(revoked, created);
});

test('external resource URIs fail closed instead of an unbounded FileLoader fetch', async t => {
  const source = fixture();
  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    requested.push(String(input instanceof Request ? input.url : input));
    return originalFetch(input, init);
  });
  // FileLoader wires an abort signal but no timeout; a relative or remote URI
  // would issue an unbounded request (Node has no CSP backstop). Fail closed.
  for (const uri of ['scene.bin', 'https://example.com/scene.bin', '//cdn.example.com/scene.bin', '/models/scene.bin']) {
    await assert.rejects(
      load({ ...source, buffers: [{ byteLength: 90, uri }] }),
      /glTF 外部资源/
    );
  }
  assert.deepEqual(requested, []);
});

test('import leaves caller-owned blob URLs usable', async () => {
  const source = fixture();
  const bytes = Buffer.from(source.buffers[0].uri.split(',')[1], 'base64');
  const uri = URL.createObjectURL(new Blob([bytes]));
  try {
    assert.equal((await load({ ...source, buffers: [{ byteLength: bytes.length, uri }] })).metadata.faceCount, 2);
    assert.deepEqual(new Uint8Array(await (await fetch(uri)).arrayBuffer()), new Uint8Array(bytes));
  } finally { URL.revokeObjectURL(uri); }
});
