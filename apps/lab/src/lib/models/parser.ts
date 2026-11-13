// 3D 模型解析器（STL/OBJ/glTF）

import type { UploadedModel, ModelGeometry, ModelMetadata, ModelSourcePart } from '../../types/model';
import { assertGeometryContract, inspectGeometryTopology, GEOMETRY_CONTRACT_LIMITS, GeometryContractError } from './geometry-contract';

import { assertModelSourceParts, MODEL_SOURCE_PART_LIMITS } from './source-parts';

/** Soft cap before parse (matches uploader UI). Rejects obviously huge blobs early. */
export const MAX_MODEL_FILE_BYTES = 50 * 1024 * 1024;

export async function parseModelFile(
  file: File,
  onProgress?: (progress: number) => void
): Promise<UploadedModel> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (file.size > MAX_MODEL_FILE_BYTES) {
    throw new GeometryContractError(
      'file_size',
      `文件过大: ${(file.size / 1024 / 1024).toFixed(2)} MB（最大 ${MAX_MODEL_FILE_BYTES / 1024 / 1024} MB）`
    );
  }

  onProgress?.(10);

  let geometry: ModelGeometry;

  switch (extension) {
    case 'stl':
      geometry = parseStlGeometry(await file.arrayBuffer());
      break;
    case 'obj':
      geometry = await parseOBJ(file);
      break;
    case 'gltf':
    case 'glb':
      geometry = await parseGLTF(file);
      break;
    default:
      throw new Error(`不支持的文件格式: ${extension}`);
  }

  onProgress?.(80);

  // Post-parse geometry contract (finite verts/normals, index range, bbox, limits)
  assertGeometryContract(geometry);

  // 计算元数据
  const metadata = computeMetadata(file, geometry);

  onProgress?.(100);

  return {
    metadata,
    geometry,
  };
}

export function parseStlGeometry(buffer: ArrayBuffer): ModelGeometry {
  if (buffer.byteLength > MAX_MODEL_FILE_BYTES) throw new GeometryContractError('file_size', 'STL 文件超过 50 MiB');
  const view = new DataView(buffer);

  // 二进制 STL：80 字节头 + uint32 面数 + 每面 50 字节；否则当 ASCII
  let isBinary = false;
  if (view.byteLength >= 84) {
    const triCount = view.getUint32(80, true);
    const expected = 84 + triCount * 50;
    // 允许末尾少量填充；ASCII 的 "solid..." 几乎不会命中精确长度
    if (triCount > 0 && expected <= view.byteLength && expected + 512 >= view.byteLength) {
      isBinary = true;
    } else {
      const head = new TextDecoder().decode(buffer.slice(0, 5)).toLowerCase();
      isBinary = head !== 'solid';
    }
  }

  if (isBinary) {
    const geometry = parseBinarySTL(view);
    assertGeometryContract(geometry);
    return geometry;
  }
  const text = new TextDecoder().decode(buffer);
  const geometry = parseASCIISTL(text);
  assertGeometryContract(geometry);
  return geometry;
}

function parseBinarySTL(view: DataView): ModelGeometry {
  const triangleCount = view.getUint32(80, true);
  if (84 + triangleCount * 50 > view.byteLength) throw new GeometryContractError('byte_length', 'STL 三角面数据不完整');
  if (triangleCount > GEOMETRY_CONTRACT_LIMITS.maxFaces || triangleCount * 84 > GEOMETRY_CONTRACT_LIMITS.maxGeometryBytes) throw new GeometryContractError('byte_limit', 'STL 展开后的网格超过大小上限');
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  
  let offset = 84;
  
  for (let i = 0; i < triangleCount; i++) {
    // 法线
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    
    // 三个顶点
    for (let j = 0; j < 3; j++) {
      vertices.push(
        view.getFloat32(offset + 12 + j * 12, true),
        view.getFloat32(offset + 16 + j * 12, true),
        view.getFloat32(offset + 20 + j * 12, true)
      );
      normals.push(nx, ny, nz);
      indices.push(i * 3 + j);
    }
    
    offset += 50;
  }
  
  return {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

function parseASCIISTL(text: string): ModelGeometry {
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  
  const lines = text.split('\n');
  let vertexIndex = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('facet normal')) {
      const parts = trimmed.split(/\s+/);
      const nx = parseFloat(parts[2]);
      const ny = parseFloat(parts[3]);
      const nz = parseFloat(parts[4]);
      
      // 读取三个顶点
      for (let i = 0; i < 3; i++) {
        normals.push(nx, ny, nz);
      }
    } else if (trimmed.startsWith('vertex')) {
      const parts = trimmed.split(/\s+/);
      vertices.push(
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      );
      indices.push(vertexIndex++);
    }
  }
  
  return {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

async function parseOBJ(file: File): Promise<ModelGeometry> {
  const { ShapeUtils, Vector2 } = await import('three');
  const positions: number[][] = [], sourceNormals: number[][] = [], texcoords: number[][] = [];
  const vertices: number[] = [], normals: number[] = [], indices: number[] = [], uvs: number[] = [];
  let hasUvs = false;
  const fail = (message: string): never => { throw new GeometryContractError('obj_format', message); };
  const resolveIndex = (value: string, source: number[][]) => {
    if (!/^[+-]?\d+$/.test(value)) return fail(`OBJ 索引无效: ${value}`);
    const n = Number(value), index = n > 0 ? n - 1 : source.length + n;
    if (!Number.isSafeInteger(n) || n === 0 || index < 0 || index >= source.length) return fail(`OBJ 索引越界: ${value}`);
    return source[index];
  };
  for (const line of (await file.text()).split(/\r?\n/)) {
    const parts = line.split('#', 1)[0].trim().split(/\s+/);
    const tag = parts.shift();
    if (tag === 'v' || tag === 'vn' || tag === 'vt') {
      const size = tag === 'vt' ? 2 : 3;
      const values = parts.slice(0, size).map(Number);
      if (values.length !== size || !values.every(Number.isFinite)) fail('OBJ 顶点、法线或纹理坐标无效');
      // Mesh positions use Cartesian coordinates; do not silently ignore rational weights.
      if (tag === 'v' && parts.length === 4 && Number(parts[3]) !== 1) fail('OBJ 暂不支持非单位齐次坐标');
      (tag === 'v' ? positions : tag === 'vn' ? sourceNormals : texcoords).push(values);
    } else if (tag === 'f') {
      if (parts.length < 3 || parts.length > 4096) fail('OBJ 面需包含 3–4096 个顶点');
      const face = parts.map(part => {
        const fields = part.split('/');
        if (fields.length > 3) fail('OBJ 面索引格式无效');
        return { p: resolveIndex(fields[0], positions), uv: fields[1] ? resolveIndex(fields[1], texcoords) : null,
          n: fields[2] ? resolveIndex(fields[2], sourceNormals) : null };
      });
      let triangles = [[0, 1, 2]];
      if (face.length > 3) {
        // Project a planar polygon onto its dominant plane; ear clipping also handles concave faces.
        const normal = [0, 0, 0];
        for (let i = 0; i < face.length; i++) {
          const a = face[i].p, b = face[(i + 1) % face.length].p;
          normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
          normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
          normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
        }
        const length = Math.hypot(...normal);
        if (!length) fail('OBJ 多边形退化，无法三角化');
        const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
        const axes = [0, 1, 2].filter(i => i !== axis), origin = face[0].p;
        let extent = 0, deviation = 0;
        for (const { p } of face) {
          const d = p.map((v, i) => v - origin[i]);
          extent = Math.max(extent, Math.hypot(...d));
          deviation = Math.max(deviation, Math.abs(d.reduce((sum, v, i) => sum + v * normal[i], 0)) / length);
        }
        if (deviation > extent * 1e-6) fail('OBJ 多边形不共面，请先三角化');
        const contour = face.map(({ p }) => new Vector2(p[axes[0]], p[axes[1]]));
        const area = ShapeUtils.area(contour);
        triangles = ShapeUtils.triangulateShape(contour, []);
        if (triangles.length !== face.length - 2) fail('OBJ 多边形无法完整三角化');
        // Earcut normalizes orientation; restore the source face winding.
        for (const triangle of triangles) {
          const [a, b, c] = triangle.map(i => contour[i]);
          if (((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * area < 0) {
            [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
          }
        }
      }
      if ((vertices.length / 3 + triangles.length * 3) * 36 > GEOMETRY_CONTRACT_LIMITS.maxGeometryBytes) fail('OBJ 展开后的网格超过大小上限');
      for (const triangle of triangles) {
        const points = triangle.map(i => face[i]);
        const [a, b, c] = points.map(p => p.p);
        const ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]);
        const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        const length = Math.hypot(...normal) || 1;
        for (const point of points) {
          indices.push(vertices.length / 3);
          vertices.push(...point.p); normals.push(...(point.n ?? normal.map(v => v / length)));
          uvs.push(...(point.uv ?? [0, 0])); hasUvs ||= point.uv !== null;
        }
      }
    }
  }
  return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), indices: new Uint32Array(indices),
    ...(hasUvs ? { uvs: new Float32Array(uvs) } : {}) };
}

// Prepared from the installed Three.js dependency before dev/build. Keep Node
// filesystem resolution in the build script, outside this client import graph.
const DRACO_DECODER_PATH = `${(process.env.NEXT_PUBLIC_TUANLIU_BASE_PATH || '').replace(/\/$/, '')}/draco/`;

function ensureNodeLoaderPolyfills(): void {
  // three FileLoader uses ProgressEvent; Node test runners lack it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.ProgressEvent === 'undefined') {
    g.ProgressEvent = class ProgressEvent extends Event {
      lengthComputable: boolean;
      loaded: number;
      total: number;
      constructor(
        type: string,
        init?: { lengthComputable?: boolean; loaded?: number; total?: number }
      ) {
        super(type);
        this.lengthComputable = !!init?.lengthComputable;
        this.loaded = init?.loaded ?? 0;
        this.total = init?.total ?? 0;
      }
    };
  }
  if (!g.self) g.self = globalThis;
}

/** Decode embedded resources locally: fetching data: is blocked by our CSP. */
function decodeGltfResource(uri: string, remainingBytes: number): Blob {
  const url = new URL(uri);
  url.hash = '';
  const comma = url.href.indexOf(',');
  if (comma < 0) throw new GeometryContractError('resource_uri', 'glTF 内嵌资源缺少数据分隔符');
  let mime = url.href.slice(5, comma).trim();
  const base64 = /; *base64$/i.test(mime);
  if (base64) mime = mime.replace(/; *base64$/i, '');
  if (!mime || mime.startsWith(';')) mime = `text/plain${mime || ';charset=US-ASCII'}`;

  // Percent escapes represent bytes, including %FF, not UTF-8 characters.
  const bytes = new TextEncoder().encode(url.href.slice(comma + 1));
  const hex = (c: number) => c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 37) {
      const high = hex(bytes[i + 1]), low = hex(bytes[i + 2]);
      if (high >= 0 && low >= 0) {
        bytes[length++] = high * 16 + low;
        i += 2;
        continue;
      }
    }
    bytes[length++] = bytes[i];
  }
  const assertSize = (size: number) => {
    if (size > remainingBytes) throw new GeometryContractError('byte_limit', 'glTF 内嵌资源合计超过 50 MiB');
  };
  let decoded = bytes.subarray(0, length);
  if (base64) {
    // Preserve a BOM so atob rejects it, just like any other non-base64 byte.
    const encoded = new TextDecoder('utf-8', { ignoreBOM: true }).decode(decoded).replace(/[\t\n\f\r ]/g, '');
    assertSize(Math.floor(encoded.replace(/={1,2}$/, '').length * 3 / 4));
    let binary: string;
    try { binary = atob(encoded); }
    catch { throw new GeometryContractError('resource_uri', 'glTF 内嵌资源的 Base64 编码无效'); }
    decoded = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) decoded[i] = binary.charCodeAt(i);
  }
  assertSize(decoded.byteLength);
  return new Blob([decoded], { type: mime });
}

async function parseGLTF(file: File): Promise<ModelGeometry> {
  // 浏览器端用 three.js GLTFLoader 展开场景网格
  ensureNodeLoaderPolyfills();
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');

  const buffer = await file.arrayBuffer();
  const resources = new Map<string, string>();
  let resourceBytes = 0, resourcesClosed = false;
  let resourceError: Error | undefined;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(uri => {
    if (resourcesClosed) throw new GeometryContractError('resource_uri', 'glTF 导入已结束');
    // FileLoader 的 fetch 没有超时：除调用方持有的 blob: 与本地解码的 data: 外，
    // 其余 URI（相对路径、http(s): 等）会产生无界外部请求，Node 下更无 CSP 兜底。
    if (/^blob:/i.test(uri)) return uri;
    if (!/^data:/i.test(uri)) {
      resourceError ??= new GeometryContractError('resource_uri', 'glTF 外部资源不受支持：请内嵌 data: 资源或改用 .glb 单文件');
      throw resourceError;
    }
    const existing = resources.get(uri);
    if (existing) return existing;
    try {
      const blob = decodeGltfResource(uri, MAX_MODEL_FILE_BYTES - resourceBytes);
      const localUrl = URL.createObjectURL(blob);
      resources.set(uri, localUrl);
      resourceBytes += blob.size;
      return localUrl;
    } catch (error) {
      resourceError ??= error instanceof GeometryContractError ? error : new GeometryContractError('resource_uri', 'glTF 内嵌资源无法解码');
      throw resourceError;
    }
  });
  const loader = new GLTFLoader(manager);
  loader.register(parser => ({ name: 'WaveWorldStaticGeometry', beforeRoot: () => {
    const source = parser.json;
    // Rigid animation imports the authored node pose; no animation is evaluated.
    // Reject deformation anywhere, including unused skins and zero-weight targets.
    if (source.skins?.length || source.meshes?.some((mesh: { primitives: { targets?: unknown[] }[] }) => mesh.primitives.some(p => p.targets?.length))) {
      throw new GeometryContractError('deformation', 'glTF 蒙皮和形变目标暂不支持；请导出已烘焙的静态网格');
    }
    let vertices = 0, faces = 0, visitedNodes = 0;
    const visiting = new Set<number>();
    const visit = (id: number, depth: number) => {
      if (++visitedNodes > MODEL_SOURCE_PART_LIMITS.maxParts) throw new GeometryContractError('source_parts', 'glTF 装配节点总数超过 16384 上限');
      if (visiting.has(id) || depth > MODEL_SOURCE_PART_LIMITS.maxDepth) throw new GeometryContractError('source_parts', 'glTF 装配存在循环或超过 64 层');
      const node = source.nodes?.[id];
      if (!node) throw new GeometryContractError('source_parts', 'glTF 装配节点不存在');
      visiting.add(id);
      let instances = 1;
      const attributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes as Record<string, number> | undefined;
      if (attributes) {
        const counts = Object.values(attributes).map(index => source.accessors?.[index]?.count);
        instances = counts[0];
        if (!Number.isSafeInteger(instances) || instances < 1 || instances > MODEL_SOURCE_PART_LIMITS.maxParts || counts.some(count => count !== instances)) throw new GeometryContractError('source_parts', 'glTF 实例数量不一致、无效或超过上限');
      }
      if (node.mesh !== undefined) for (const primitive of source.meshes[node.mesh].primitives) {
        const mode = primitive.mode ?? 4;
        if (![4, 5, 6].includes(mode)) throw new GeometryContractError('primitive', 'glTF 当前仅支持三角网格，请将线段或点转换为网格');
        const count = source.accessors[primitive.attributes.POSITION]?.count;
        const indices = primitive.indices === undefined ? count : source.accessors[primitive.indices]?.count;
        vertices += count * instances;
        faces += (mode === 4 ? indices / 3 : Math.max(0, indices - 2)) * instances;
        assertGltfExpandedSize(vertices, faces);
      }
      for (const child of node.children ?? []) visit(child, depth + 1);
      visiting.delete(id);
    };
    for (const scene of source.scenes ?? []) for (const id of scene.nodes ?? []) visit(id, 1);
    return null;
  } }));
  // NASA / Khronos samples often ship Draco-compressed meshes.
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER_PATH);
  loader.setDRACOLoader(draco);

  let gltf: Awaited<ReturnType<typeof loader.parseAsync>>;
  try {
    gltf = await new Promise<Awaited<ReturnType<typeof loader.parseAsync>>>((resolve, reject) => {
      loader.parse(
        buffer,
        '',
        (result) => resolve(result),
        (err) => reject(err instanceof Error ? err : new Error(String(err)))
      );
    });
  } catch (error) {
    throw resourceError ?? error;
  } finally {
    resourcesClosed = true;
    for (const url of resources.values()) URL.revokeObjectURL(url);
    resources.clear();
    draco.dispose();
  }

  const sourceParts: ModelSourcePart[] = [];
  type Mesh = InstanceType<typeof THREE.Mesh>;
  type Matrix = InstanceType<typeof THREE.Matrix4>;
  const chunks: { mesh: Mesh; matrix: Matrix; mirrored: boolean }[] = [];
  const checked = new Set<InstanceType<typeof THREE.BufferGeometry>>();
  const bounds = new THREE.Box3();
  const source = gltf.parser.json;
  const seenIds = new Map<string, number>();
  let faceCount = 0, vertexCount = 0, objectOrdinal = 0;
  const fail = (code: string, message: string): never => { throw new GeometryContractError(code, message); };
  const part = (id: string, name: string, parentId: string | undefined, depth: number) => {
    if (depth > MODEL_SOURCE_PART_LIMITS.maxDepth || sourceParts.length >= MODEL_SOURCE_PART_LIMITS.maxParts) fail('source_parts', '装配层级或部件数量超过上限');
    if (!name.length || name.length > MODEL_SOURCE_PART_LIMITS.maxTextLength) fail('source_parts', '装配部件名称须为 1–256 个字符');
    const value: ModelSourcePart = { id, name, ...(parentId ? { parentId } : {}), triangleStart: faceCount, triangleCount: 0 };
    sourceParts.push(value);
    return value;
  };
  const append = (mesh: Mesh, matrix: Matrix) => {
    const geom = mesh.geometry, pos = geom.getAttribute('position'), idx = geom.getIndex();
    if (!pos || pos.itemSize !== 3 || pos.count < 3) fail('empty', 'glTF 网格缺少有效三维顶点');
    const count = idx?.count ?? pos.count;
    if (!Number.isSafeInteger(count) || count < 3 || count % 3) fail('index_stride', 'glTF 网格不是完整三角面');
    assertGltfExpandedSize(vertexCount + pos.count, faceCount + count / 3);
    if (!checked.has(geom)) {
      for (let i = 0; i < count; i++) {
        const index = idx?.getX(i) ?? i;
        if (!Number.isSafeInteger(index) || index < 0 || index >= pos.count) fail('index_range', 'glTF 三角面索引越界');
      }
      for (let i = 0; i < pos.count; i++) {
        if (![pos.getX(i), pos.getY(i), pos.getZ(i)].every(Number.isFinite)) fail('non_finite_vertex', 'glTF 顶点含非有限值');
      }
      if (!geom.getAttribute('normal')) geom.computeVertexNormals();
      const normal = geom.getAttribute('normal');
      if (normal.itemSize !== 3 || normal.count !== pos.count) fail('normal_length', 'glTF 法线与顶点数量不一致');
      for (let i = 0; i < normal.count; i++) {
        if (![normal.getX(i), normal.getY(i), normal.getZ(i)].every(Number.isFinite)) fail('non_finite_normal', 'glTF 法线含非有限值');
      }
      // Recompute from actual positions; accessor min/max are not trusted bounds.
      geom.computeBoundingBox();
      checked.add(geom);
    }
    const e = matrix.elements, determinant = matrix.determinant();
    if (!e.every(Number.isFinite) || e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || e[15] !== 1 || !Number.isFinite(determinant) || determinant === 0 ||
        !new THREE.Matrix3().getNormalMatrix(matrix).elements.every(Number.isFinite)) fail('transform', 'glTF 实例变换必须有限、可逆且为仿射变换');
    const transformed = geom.boundingBox!.clone().applyMatrix4(matrix);
    if (![...transformed.min.toArray(), ...transformed.max.toArray()].every(value => Number.isFinite(Math.fround(value)))) fail('transform', 'glTF 实例坐标超出 FP32 范围');
    bounds.union(transformed);
    if (bounds.getSize(new THREE.Vector3()).toArray().some(value => value > GEOMETRY_CONTRACT_LIMITS.maxBoundingExtent)) fail('bbox_extent', 'glTF 实例展开后的坐标范围超过上限');
    chunks.push({ mesh, matrix, mirrored: determinant < 0 });
    vertexCount += pos.count; faceCount += count / 3;
  };
  const visit = (object: InstanceType<typeof THREE.Object3D>, parentId: string | undefined, depth: number) => {
    const ordinal = objectOrdinal++, ref = gltf.parser.associations.get(object);
    const key = ref?.nodes === undefined ? `gltf-object:${ordinal}` : `gltf-node:${ref.nodes}`;
    const occurrence = seenIds.get(key) ?? 0; seenIds.set(key, occurrence + 1);
    const id = occurrence ? `${key}:occurrence:${occurrence}` : key;
    const originalName = ref?.nodes !== undefined ? source.nodes[ref.nodes]?.name : ref?.meshes !== undefined ? source.meshes[ref.meshes]?.name : undefined;
    const name = originalName || (typeof object.userData.name === 'string' ? object.userData.name : '') || object.name || (ref?.nodes === undefined ? `网格 ${ordinal + 1}` : `节点 ${ref.nodes}`);
    if (typeof name !== 'string') fail('source_parts', 'glTF 部件名称必须为文本');
    const start = sourceParts.length, own = part(id, name, parentId, depth);
    const mesh = object as Mesh;
    if (mesh.isMesh) {
      if ((mesh as InstanceType<typeof THREE.SkinnedMesh>).isSkinnedMesh || Object.keys(mesh.geometry.morphAttributes).length) fail('deformation', '请将蒙皮或形变目标烘焙为静态网格后导入');
      const instanced = mesh as InstanceType<typeof THREE.InstancedMesh>;
      if (instanced.isInstancedMesh) {
        if (!Number.isSafeInteger(instanced.count) || instanced.count < 1 || instanced.count > MODEL_SOURCE_PART_LIMITS.maxParts) fail('source_parts', 'glTF 实例数量无效或超过上限');
        for (let i = 0; i < instanced.count; i++) {
          const child = part(`${id}:instance:${i}`, `实例 ${i + 1}`, id, depth + 1);
          const matrix = new THREE.Matrix4(); instanced.getMatrixAt(i, matrix); matrix.premultiply(mesh.matrixWorld);
          append(mesh, matrix); child.triangleCount = faceCount - child.triangleStart;
        }
      } else {
        const leaf = object.children.length ? part(`${id}:primitive`, '自身网格', id, depth + 1) : own;
        append(mesh, mesh.matrixWorld.clone()); leaf.triangleCount = faceCount - leaf.triangleStart;
      }
    }
    for (const child of object.children) visit(child, id, depth + 1);
    own.triangleCount = faceCount - own.triangleStart;
    if (!own.triangleCount) sourceParts.splice(start, 1);
  };
  try {
    // Three treats texture load failures as optional; our decoding limits are not.
    if (resourceError) throw resourceError;
    gltf.scene.updateMatrixWorld(true);
    for (const child of gltf.scene.children) visit(child, undefined, 1);
    if (!faceCount) fail('empty', 'glTF 中未找到可渲染网格');
    // Counts, all instance transforms and bounds have passed before output allocation.
    const vertices = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3), indices = new Uint32Array(faceCount * 3);
    let vertexOffset = 0, indexOffset = 0;
    const vector = new THREE.Vector3();
    for (const { mesh, matrix, mirrored } of chunks) {
      const geom = mesh.geometry, pos = geom.getAttribute('position'), normal = geom.getAttribute('normal'), idx = geom.getIndex();
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
      for (let i = 0; i < pos.count; i++) {
        vector.fromBufferAttribute(pos, i).applyMatrix4(matrix).toArray(vertices, (vertexOffset + i) * 3);
        vector.fromBufferAttribute(normal, i).applyNormalMatrix(normalMatrix).toArray(normals, (vertexOffset + i) * 3);
      }
      const count = idx?.count ?? pos.count;
      for (let i = 0; i < count; i += 3) {
        indices[indexOffset++] = vertexOffset + (idx?.getX(i) ?? i);
        indices[indexOffset++] = vertexOffset + (idx?.getX(i + (mirrored ? 2 : 1)) ?? i + (mirrored ? 2 : 1));
        indices[indexOffset++] = vertexOffset + (idx?.getX(i + (mirrored ? 1 : 2)) ?? i + (mirrored ? 1 : 2));
      }
      vertexOffset += pos.count;
    }
    const geometry: ModelGeometry = { vertices, normals, indices, sourceParts };
    assertModelSourceParts(geometry);
    return geometry;
  } finally {
    const geometries = new Set<InstanceType<typeof THREE.BufferGeometry>>(), materials = new Set<InstanceType<typeof THREE.Material>>();
    for (const scene of gltf.scenes) scene.traverse(object => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
}

/** Check source counts before GLTFLoader allocates an InstancedMesh or expanded output. */
function assertGltfExpandedSize(vertices: number, faces: number) {
  if (!Number.isSafeInteger(vertices) || !Number.isSafeInteger(faces) || vertices < 0 || faces < 0 || vertices > GEOMETRY_CONTRACT_LIMITS.maxVertices || faces > GEOMETRY_CONTRACT_LIMITS.maxFaces ||
      vertices * 24 + faces * 12 > GEOMETRY_CONTRACT_LIMITS.maxGeometryBytes) throw new GeometryContractError('byte_limit', 'glTF 实例展开后的网格超过大小上限');
}

function computeMetadata(file: File, geometry: ModelGeometry): ModelMetadata {
  const vertices = geometry.vertices;
  
  // 计算包围盒
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  
  for (let i = 0; i < vertices.length; i += 3) {
    minX = Math.min(minX, vertices[i]);
    minY = Math.min(minY, vertices[i + 1]);
    minZ = Math.min(minZ, vertices[i + 2]);
    maxX = Math.max(maxX, vertices[i]);
    maxY = Math.max(maxY, vertices[i + 1]);
    maxZ = Math.max(maxZ, vertices[i + 2]);
  }
  
  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  
  const size: [number, number, number] = [
    maxX - minX,
    maxY - minY,
    maxZ - minZ,
  ];
  
  return {
    id: crypto.randomUUID(),
    name: file.name,
    format: file.name.split('.').pop()?.toLowerCase() as any,
    fileSize: file.size,
    uploadDate: new Date(),
    vertexCount: vertices.length / 3,
    faceCount: geometry.indices.length / 3,
    boundingBox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      center,
      size,
    },
    ...inspectGeometryTopology(geometry),
    hasNormals: geometry.normals.length > 0,
    hasUVs: geometry.uvs !== undefined,
  };
}
