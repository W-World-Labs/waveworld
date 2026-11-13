import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelGeometry } from '../../types/model';
import type { Project } from '../stores/project-store';
import { encodeModelGeometry } from '../models/geometry-contract';
import { decodeStoredModel, saveProject } from './project-storage';

const geometry = (): ModelGeometry => ({
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
});

test('local model records restore old WGM2 and WGM1 blobs and preserve assembly metadata beside unchanged bytes', () => {
  const mesh = geometry(), data = encodeModelGeometry(mesh);
  assert.deepEqual(decodeStoredModel(data), mesh);
  const legacy = new Uint8Array(data.byteLength - 4);
  legacy.set(new Uint8Array(data, 0, 16)); legacy.set(new Uint8Array(data, 20), 16);
  new DataView(legacy.buffer).setUint32(0, 0x314d4757, true);
  assert.deepEqual(decodeStoredModel(legacy.buffer), mesh);
  const sourceParts = [
    { id: 'root', name: 'Assembly', triangleStart: 0, triangleCount: 1 },
    { id: 'surface', parentId: 'root', name: 'Surface', triangleStart: 0, triangleCount: 1 },
  ];
  const restored = decodeStoredModel(structuredClone({ data, sourceParts, futureField: true }));
  assert.deepEqual(restored, { ...mesh, sourceParts });
  assert.deepEqual(encodeModelGeometry(restored), data);
  assert.equal(restored.solidTriangleCounts, undefined);
  assert.deepEqual(decodeStoredModel({ data }), mesh);
});

test('local model record restoration rejects malformed bytes and sidecars bound to the wrong face range', () => {
  const data = encodeModelGeometry(geometry());
  for (const record of [null, {}, [], { data: new Uint8Array(data) }, { data: data.slice(0, -4) },
    { data, sourceParts: null }, { data, sourceParts: [{ id: 'part', name: 'Part', triangleStart: 0, triangleCount: 2 }] }]) {
    assert.throws(() => decodeStoredModel(record));
  }
});

test('invalid assembly metadata is rejected before a project or geometry write starts', async t => {
  t.mock.method(console, 'error', () => {});
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let databaseAccessed = false;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() {
    databaseAccessed = true; throw new Error('Invalid sidecars must not access IndexedDB');
  } });
  try {
    await assert.rejects(saveProject({ id: 'assembly-test' } as Project, {
      id: 'model', geometry: { ...geometry(),
        sourceParts: [{ id: 'part', name: 'Part', triangleStart: 1, triangleCount: 1 }] },
    }), /源部件信息无效/);
    assert.equal(databaseAccessed, false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});
