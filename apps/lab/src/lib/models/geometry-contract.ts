// Geometry contract checks for parsed / generated meshes.
// Failures throw GeometryContractError with a short Chinese message suitable for UI cards.

import type { ModelGeometry, ModelMetadata } from '../../types/model';

export const MODEL_GEOMETRY_CONTENT_TYPE = 'application/vnd.waveworld.mesh-v2';
export const MODEL_GEOMETRY_ARTIFACT_KIND = 'model-geometry';
const MESH_MAGIC_V1 = 0x314d4757;
const MESH_MAGIC = 0x324d4757; // WGM2; all words are little-endian.

export function isModelGeometryContentType(value: string | null | undefined): boolean {
  return value === MODEL_GEOMETRY_CONTENT_TYPE || value === 'application/vnd.waveworld.mesh-v1';
}

/** Header-only check for streamed clients; full validation stays in decodeModelGeometry. */
export function modelGeometryContentType(buffer: ArrayBuffer): string {
  if (buffer.byteLength < 4) throw new GeometryContractError('byte_length', '模型数据不完整');
  const magic = new DataView(buffer).getUint32(0, true);
  if (magic === MESH_MAGIC) return MODEL_GEOMETRY_CONTENT_TYPE;
  if (magic === MESH_MAGIC_V1) return 'application/vnd.waveworld.mesh-v1';
  throw new GeometryContractError('format', '不支持的模型数据格式');
}

/** Exact simulation geometry; WGM1 remains readable for saved jobs. Writers use WGM2 only. */
export function encodeModelGeometry(geometry: ModelGeometry): ArrayBuffer {
  assertGeometryContract(geometry);
  const arrays = [geometry.vertices, geometry.normals, geometry.indices, geometry.solidTriangleCounts ?? new Uint32Array(0)];
  const buffer = new ArrayBuffer(20 + arrays.reduce((n, array) => n + array.length * 4, 0));
  const view = new DataView(buffer);
  view.setUint32(0, MESH_MAGIC, true);
  let offset = 20;
  arrays.forEach((array, index) => {
    view.setUint32(4 + index * 4, array.length, true);
    for (const value of array) {
      if (index >= 2) view.setUint32(offset, value, true);
      else view.setFloat32(offset, value, true);
      offset += 4;
    }
  });
  return buffer;
}

export function decodeModelGeometry(buffer: ArrayBuffer, contentType?: string): ModelGeometry {
  if (buffer.byteLength < 16 || buffer.byteLength > MAX_MODEL_GEOMETRY_BYTES) throw new GeometryContractError('byte_limit', '模型数据大小无效');
  const view = new DataView(buffer), actualContentType = modelGeometryContentType(buffer);
  const legacy = actualContentType !== MODEL_GEOMETRY_CONTENT_TYPE;
  if (contentType !== undefined && contentType !== actualContentType) {
    throw new GeometryContractError('format', '不支持的模型数据格式或内容类型不匹配');
  }
  const headerBytes = legacy ? 16 : 20;
  if (buffer.byteLength < headerBytes) throw new GeometryContractError('byte_length', '模型数据不完整');
  const lengths = [view.getUint32(4, true), view.getUint32(8, true), view.getUint32(12, true), legacy ? 0 : view.getUint32(16, true)];
  const payloadBytes = lengths.reduce((n, length) => n + length * 4, 0);
  if (payloadBytes > GEOMETRY_CONTRACT_LIMITS.maxGeometryBytes) throw new GeometryContractError('byte_limit', '模型数据大小无效');
  if (headerBytes + payloadBytes !== buffer.byteLength) throw new GeometryContractError('byte_length', '模型数据不完整');
  const arrays = [new Float32Array(lengths[0]), new Float32Array(lengths[1]), new Uint32Array(lengths[2]), new Uint32Array(lengths[3])] as const;
  let offset = headerBytes;
  arrays.forEach((array, index) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = index >= 2 ? view.getUint32(offset, true) : view.getFloat32(offset, true);
      offset += 4;
    }
  });
  const geometry: ModelGeometry = { vertices: arrays[0], normals: arrays[1], indices: arrays[2],
    ...(arrays[3].length ? { solidTriangleCounts: arrays[3] } : {}) };
  assertGeometryContract(geometry);
  return geometry;
}

/** Defaults sized to pass all shipped presets (incl. ~13 MB X-57) while rejecting runaway meshes. */
export const GEOMETRY_CONTRACT_LIMITS = {
  maxFaces: 2_000_000,
  maxVertices: 6_000_000,
  /** Payload of vertices, normals, indices, UVs and solid groups (bytes). */
  maxGeometryBytes: 80 * 1024 * 1024,
  /** Max extent along any axis of the axis-aligned bounding box. */
  maxBoundingExtent: 1e6,
  /** Reject zero-volume / degenerate meshes (all axes below this → empty). */
  minNonZeroExtent: 1e-12,
} as const;

export const MAX_MODEL_GEOMETRY_BYTES = GEOMETRY_CONTRACT_LIMITS.maxGeometryBytes + 20;

export type GeometryContractLimits = {
  maxFaces?: number;
  maxVertices?: number;
  maxGeometryBytes?: number;
  maxBoundingExtent?: number;
  minNonZeroExtent?: number;
};

export class GeometryContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GeometryContractError';
    this.code = code;
  }
}

function isFiniteNumber(n: number): boolean {
  return typeof n === 'number' && Number.isFinite(n);
}

function checkFiniteTripletArray(
  arr: ArrayLike<number>,
  label: string,
  code: string
): void {
  for (let i = 0; i < arr.length; i++) {
    if (!isFiniteNumber(arr[i])) {
      const comp = i % 3 === 0 ? 'x' : i % 3 === 1 ? 'y' : 'z';
      const index = Math.floor(i / 3);
      throw new GeometryContractError(
        code,
        `${label} 含非有限值（索引 ${index}.${comp} = ${arr[i]}）`
      );
    }
  }
}

/**
 * Validate mesh geometry used by Lab preview / voxelizer.
 * Does not mutate geometry. Throws GeometryContractError on failure.
 */
export function assertGeometryContract(
  geometry: ModelGeometry,
  limits: GeometryContractLimits = {}
): void {
  const maxFaces = limits.maxFaces ?? GEOMETRY_CONTRACT_LIMITS.maxFaces;
  const maxVertices = limits.maxVertices ?? GEOMETRY_CONTRACT_LIMITS.maxVertices;
  const maxGeometryBytes =
    limits.maxGeometryBytes ?? GEOMETRY_CONTRACT_LIMITS.maxGeometryBytes;
  const maxBoundingExtent =
    limits.maxBoundingExtent ?? GEOMETRY_CONTRACT_LIMITS.maxBoundingExtent;
  const minNonZeroExtent =
    limits.minNonZeroExtent ?? GEOMETRY_CONTRACT_LIMITS.minNonZeroExtent;

  const { vertices, normals, indices, uvs, solidTriangleCounts } = geometry;

  if (!vertices || typeof vertices.length !== 'number') {
    throw new GeometryContractError('empty', '网格顶点数据缺失');
  }
  if (!indices || typeof indices.length !== 'number') {
    throw new GeometryContractError('empty', '网格索引数据缺失');
  }

  const vertexCount = vertices.length / 3;
  if (!Number.isInteger(vertexCount) || vertices.length % 3 !== 0) {
    throw new GeometryContractError(
      'vertex_stride',
      `顶点数组长度不是 3 的倍数（length=${vertices.length}）`
    );
  }
  if (vertexCount < 3) {
    throw new GeometryContractError('empty', '网格为空（顶点数 < 3）');
  }
  if (vertexCount > maxVertices) {
    throw new GeometryContractError(
      'vertex_limit',
      `顶点数 ${vertexCount.toLocaleString()} 超过上限 ${maxVertices.toLocaleString()}`
    );
  }

  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new GeometryContractError(
      'index_stride',
      `索引长度无效（length=${indices.length}，需为 3 的倍数且非空）`
    );
  }

  const faceCount = indices.length / 3;
  if (faceCount < 1) {
    throw new GeometryContractError('empty', '网格为空（面数 = 0）');
  }
  if (faceCount > maxFaces) {
    throw new GeometryContractError(
      'face_limit',
      `面数 ${faceCount.toLocaleString()} 超过上限 ${maxFaces.toLocaleString()}`
    );
  }

  if (solidTriangleCounts?.length) {
    let groupedFaces = 0;
    for (const count of solidTriangleCounts) {
      if (!Number.isSafeInteger(count) || count <= 0 || count > faceCount) throw new GeometryContractError('solid_groups', '实体分组必须包含正整数三角面数');
      groupedFaces += count;
    }
    if (groupedFaces !== faceCount) throw new GeometryContractError('solid_groups', '实体分组三角面总数与网格不一致');
  }

  const vertexBytes = (vertices as Float32Array).byteLength ?? vertices.length * 4;
  const normalBytes = normals
    ? ((normals as Float32Array).byteLength ?? normals.length * 4)
    : 0;
  const indexBytes =
    (indices as Uint32Array).byteLength ?? indices.length * 4;
  const approxBytes = vertexBytes + normalBytes + indexBytes + (uvs?.byteLength ?? 0) + (solidTriangleCounts?.byteLength ?? 0);
  if (approxBytes > maxGeometryBytes) {
    throw new GeometryContractError(
      'byte_limit',
      `几何数据约 ${(approxBytes / 1024 / 1024).toFixed(1)} MB，超过上限 ${(maxGeometryBytes / 1024 / 1024).toFixed(0)} MB`
    );
  }

  checkFiniteTripletArray(vertices, '顶点', 'non_finite_vertex');
  if (uvs) {
    if (uvs.length !== vertexCount * 2) throw new GeometryContractError('uv_length', '纹理坐标长度与顶点数不一致');
    for (const value of uvs) if (!Number.isFinite(value)) throw new GeometryContractError('non_finite_uv', '纹理坐标含非有限值');
  }

  if (normals && normals.length > 0) {
    if (normals.length !== vertices.length) {
      throw new GeometryContractError(
        'normal_length',
        `法线长度 ${normals.length} 与顶点分量数 ${vertices.length} 不一致`
      );
    }
    checkFiniteTripletArray(normals, '法线', 'non_finite_normal');
  }

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (!Number.isInteger(idx) || idx < 0 || idx >= vertexCount) {
      throw new GeometryContractError(
        'index_range',
        `索引越界或非法（indices[${i}]=${idx}，有效范围 0..${vertexCount - 1}）`
      );
    }
  }

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  if (
    !isFiniteNumber(minX) ||
    !isFiniteNumber(minY) ||
    !isFiniteNumber(minZ) ||
    !isFiniteNumber(maxX) ||
    !isFiniteNumber(maxY) ||
    !isFiniteNumber(maxZ)
  ) {
    throw new GeometryContractError('bbox', '包围盒非有限（存在 NaN/Infinity 顶点）');
  }

  const sx = maxX - minX;
  const sy = maxY - minY;
  const sz = maxZ - minZ;
  if (sx > maxBoundingExtent || sy > maxBoundingExtent || sz > maxBoundingExtent) {
    throw new GeometryContractError(
      'bbox_extent',
      `包围盒过大（${sx.toExponential(2)} × ${sy.toExponential(2)} × ${sz.toExponential(2)}，上限 ${maxBoundingExtent}）`
    );
  }
  // Degenerate: all three axes effectively zero (point / empty)
  if (sx < minNonZeroExtent && sy < minNonZeroExtent && sz < minNonZeroExtent) {
    throw new GeometryContractError('bbox_degenerate', '包围盒退化（零体积点云）');
  }
}

/** Non-throwing helper for tests / callers that prefer a result object. */
export function checkGeometryContract(
  geometry: ModelGeometry,
  limits?: GeometryContractLimits
): { ok: true } | { ok: false; code: string; message: string } {
  try {
    assertGeometryContract(geometry, limits);
    return { ok: true };
  } catch (err) {
    if (err instanceof GeometryContractError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }
}

/**
 * Inspect exact Float32 positions without altering the mesh or welding nearby gaps.
 * Declared solids are checked separately; touching solids do not share boundary edges.
 * Sorted arrays use 8 bytes/vertex + 8 bytes/index of the largest declared solid.
 * This checks edge incidence/orientation, not self-intersections or volumetric validity.
 */
export function inspectGeometryTopology(geometry: ModelGeometry): Pick<ModelMetadata,
  'isWatertight' | 'manifoldEdges' | 'nonManifoldEdges' | 'topology'> {
  assertGeometryContract(geometry);
  const { vertices, indices } = geometry;
  const count = vertices.length / 3;
  const order = Uint32Array.from({ length: count }, (_, i) => i);
  const compare = (a: number, b: number) => vertices[a * 3] - vertices[b * 3]
    || vertices[a * 3 + 1] - vertices[b * 3 + 1] || vertices[a * 3 + 2] - vertices[b * 3 + 2];
  order.sort(compare);
  const welded = new Uint32Array(count);
  let unique = 0;
  for (let i = 0; i < count; i++) {
    if (i && compare(order[i - 1], order[i]) !== 0) unique++;
    welded[order[i]] = unique;
  }
  const groups = geometry.solidTriangleCounts?.length ? geometry.solidTriangleCounts : [indices.length / 3];
  let largestGroup = 0;
  for (const faces of groups) largestGroup = Math.max(largestGroup, faces);
  const edges = new Float64Array(largestGroup * 3);
  let start = 0, degenerateFaces = 0;
  let manifoldEdges = 0, nonManifoldEdges = 0, boundaryEdges = 0, inconsistentEdges = 0;
  for (const faces of groups) {
    const stop = start + faces * 3;
    let edgeCount = 0;
    for (let i = start; i < stop; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      const abx = vertices[b * 3] - vertices[a * 3], aby = vertices[b * 3 + 1] - vertices[a * 3 + 1], abz = vertices[b * 3 + 2] - vertices[a * 3 + 2];
      const acx = vertices[c * 3] - vertices[a * 3], acy = vertices[c * 3 + 1] - vertices[a * 3 + 1], acz = vertices[c * 3 + 2] - vertices[a * 3 + 2];
      if (aby * acz === abz * acy && abz * acx === abx * acz && abx * acy === aby * acx) {
        degenerateFaces++; continue;
      }
      for (const [from, to] of [[welded[a], welded[b]], [welded[b], welded[c]], [welded[c], welded[a]]]) {
        // Exact integer below 2^53 under maxVertices; low bit retains orientation.
        edges[edgeCount++] = (Math.min(from, to) * count + Math.max(from, to)) * 2 + Number(from > to);
      }
    }
    const sorted = edges.subarray(0, edgeCount).sort();
    for (let i = 0; i < sorted.length;) {
      const key = Math.floor(sorted[i] / 2);
      let end = i + 1;
      while (end < sorted.length && Math.floor(sorted[end] / 2) === key) end++;
      if (end - i === 1) boundaryEdges++;
      else if (end - i > 2) nonManifoldEdges++;
      else {
        manifoldEdges++;
        if (sorted[i] === sorted[i + 1]) inconsistentEdges++;
      }
      i = end;
    }
    start = stop;
  }
  return {
    isWatertight: manifoldEdges > 0 && !boundaryEdges && !nonManifoldEdges && !inconsistentEdges && !degenerateFaces,
    manifoldEdges, nonManifoldEdges, topology: { boundaryEdges, inconsistentEdges, degenerateFaces },
  };
}
