import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelGeometry, ModelSourcePart } from '../../types/model';
import { encodeModelGeometry } from './geometry-contract';
import { assertModelSourceParts, MODEL_SOURCE_PART_LIMITS } from './source-parts';

const geometry = (): ModelGeometry => ({
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  normals: new Float32Array(12),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]),
});
const parts = (): ModelSourcePart[] => [
  { id: 'assembly', name: '机箱', triangleStart: 0, triangleCount: 4 },
  { id: 'right', parentId: 'assembly', name: '同名部件', triangleStart: 2, triangleCount: 2 },
  { id: 'left', parentId: 'assembly', name: '同名部件', triangleStart: 0, triangleCount: 2 },
  { id: 'primitive', parentId: 'right', name: '表面', triangleStart: 2, triangleCount: 2 },
];

test('source hierarchy allows repeated names and open surface leaves without changing geometry or WGM2', () => {
  const mesh = geometry(), wire = encodeModelGeometry(mesh);
  assertModelSourceParts(mesh); // Older models have no source hierarchy.
  mesh.sourceParts = parts();
  const before = structuredClone(mesh);
  assertModelSourceParts(mesh);
  assert.deepEqual(mesh, before, 'validating siblings must not reorder the source tree');
  assert.deepEqual(encodeModelGeometry(mesh), wire, 'source parts never enter the compute artifact');
  assert.equal(mesh.solidTriangleCounts, undefined, 'surface parts do not declare independent solids');
  mesh.sourceParts = parts().slice(1, 3).map(part => ({ ...part, parentId: undefined }));
  assertModelSourceParts(mesh); // Multiple roots partition the same complete model.
});

test('source hierarchy rejects wrong face bindings, cycles, missing parents and incomplete coverage', () => {
  const corruptions: Array<[string, (source: ModelSourcePart[]) => void]> = [
    ['duplicate id', source => { source[1].id = source[0].id; }],
    ['missing parent', source => { source[1].parentId = 'absent'; }],
    ['forward parent or cycle', source => { source[0].parentId = 'primitive'; }],
    ['self parent', source => { source[1].parentId = source[1].id; }],
    ['negative start', source => { source[0].triangleStart = -1; }],
    ['fractional start', source => { source[1].triangleStart = 1.5; }],
    ['non-finite count', source => { source[0].triangleCount = Infinity; }],
    ['zero count', source => { source[1].triangleCount = 0; }],
    ['out of bounds', source => { source[0].triangleCount = 5; }],
    ['outside parent', source => { source[3].triangleStart = 1; }],
    ['overlapping siblings', source => { source[2].triangleCount = 3; }],
    ['missing sibling faces', source => { source[2].triangleCount = 1; }],
    ['missing child faces', source => { source[3].triangleCount = 1; }],
    ['empty name', source => { source[0].name = ' '; }],
    ['long id', source => { source[0].id = 'x'.repeat(257); }],
    ['long name', source => { source[0].name = 'x'.repeat(257); }],
  ];
  for (const [label, corrupt] of corruptions) {
    const mesh = { ...geometry(), sourceParts: parts() };
    corrupt(mesh.sourceParts);
    assert.throws(() => assertModelSourceParts(mesh), /源部件信息无效/, label);
  }
  for (const sourceParts of [[], null, {}, [null]]) {
    assert.throws(() => assertModelSourceParts({ ...geometry(), sourceParts } as ModelGeometry), /源部件信息无效/);
  }
  const missingRootFaces = [{ id: 'only', name: 'only', triangleStart: 1, triangleCount: 3 }];
  assert.throws(() => assertModelSourceParts({ ...geometry(), sourceParts: missingRootFaces }), /未分配/);
});

test('source hierarchy bounds depth, text and record count without recursive traversal', () => {
  const mesh = geometry();
  mesh.sourceParts = Array.from({ length: MODEL_SOURCE_PART_LIMITS.maxDepth }, (_, i) => ({
    id: `part-${i}`, name: 'n'.repeat(256), ...(i ? { parentId: `part-${i - 1}` } : {}), triangleStart: 0, triangleCount: 4,
  }));
  assertModelSourceParts(mesh);
  mesh.sourceParts.push({ id: 'too-deep', name: 'leaf', parentId: 'part-63', triangleStart: 0, triangleCount: 4 });
  assert.throws(() => assertModelSourceParts(mesh), /层级/);
  mesh.indices = new Uint32Array(MODEL_SOURCE_PART_LIMITS.maxParts * 3);
  mesh.sourceParts = Array.from({ length: MODEL_SOURCE_PART_LIMITS.maxParts }, (_, i) => ({
    id: `leaf-${i}`, name: 'leaf', triangleStart: i, triangleCount: 1,
  }));
  assertModelSourceParts(mesh);
  mesh.sourceParts.push({ id: 'too-many', name: 'leaf', triangleStart: 0, triangleCount: 1 });
  assert.throws(() => assertModelSourceParts(mesh), /部件数量/);
});
