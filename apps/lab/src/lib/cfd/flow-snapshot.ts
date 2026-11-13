import { lbmFieldSampleSteps, type LbmDisplaySnapshot } from '@w-sim/solvers-lbm/d3q19';
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts';
import { LBM_PRESSURE_FIELD_FEATURE } from '@w-sim/contracts';

export type { LbmDisplaySnapshot } from '@w-sim/solvers-lbm/d3q19';
export const FLOW_SNAPSHOT_KIND = 'lbm-display';
export const FLOW_SNAPSHOT_CONTENT_TYPE = 'application/vnd.waveworld.lbm-display-v1';
export const FLOW_SNAPSHOT_V2_CONTENT_TYPE = 'application/vnd.waveworld.lbm-display-v2';
export const FLOW_SNAPSHOT_V3_CONTENT_TYPE = 'application/vnd.waveworld.lbm-display-v3';
export const FLOW_SEQUENCE_KIND = 'lbm-display-seq';
export const FLOW_SEQUENCE_CONTENT_TYPE = 'application/vnd.waveworld.lbm-display-seq-v1';
export const MAX_FLOW_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAGIC = 0x31465657; // WVF1, little-endian.
const PRESSURE_MAGIC = 0x32465657; // WVF2: the final channel is lattice gauge pressure.
const QUANTIZED_MAGIC = 0x33465657; // WVF3: u8-quantized display channels + u8 flags, per-channel min/max.
const SEQUENCE_MAGIC = 0x31535657; // WVS1: counted sequence of WVF frames.
const COMPRESSED_MAGIC = 0x315a5657; // WVZ1: u32 raw size + gzip payload around a WVS1/WVM sequence.
const HEADER_BYTES = 32;
const SEQUENCE_HEADER_BYTES = 8;
const COMPRESSED_HEADER_BYTES = 8;
/** Upload batching threshold: one sequence artifact per ~4 MiB of quantized frames. */
export const FLOW_SEQUENCE_BATCH_BYTES = 4 * 1024 * 1024;

/** Old saved objects have no hasPressure field; stride 3 then means temperature. */
export function flowHasTemperature(snapshot: Pick<LbmDisplaySnapshot, 'displayStride' | 'hasPressure'>): boolean {
  return snapshot.displayStride === (snapshot.hasPressure === true ? 4 : 3);
}

export function flowPressureOffset(snapshot: Pick<LbmDisplaySnapshot, 'displayStride' | 'hasPressure'>): number | null {
  return snapshot.hasPressure === true ? snapshot.displayStride - 1 : null;
}

export function flowSnapshotContentType(snapshot: Pick<LbmDisplaySnapshot, 'hasPressure'>): string {
  return snapshot.hasPressure === true ? FLOW_SNAPSHOT_V2_CONTENT_TYPE : FLOW_SNAPSHOT_CONTENT_TYPE;
}

export function isFlowSnapshotContentType(value: unknown): value is string {
  return value === FLOW_SNAPSHOT_CONTENT_TYPE || value === FLOW_SNAPSHOT_V2_CONTENT_TYPE || value === FLOW_SNAPSHOT_V3_CONTENT_TYPE;
}

export function isFlowSequenceContentType(value: unknown): value is string {
  return value === FLOW_SEQUENCE_CONTENT_TYPE;
}

/** Validate one recorded physical sequence, including an early final step. */
export function assertFlowFrames(frames: LbmDisplaySnapshot[], spec: JobSpecV1, steps: number, derived?: JobResultV1['derived']): void {
  const first = frames[0];
  if (!first || !Number.isSafeInteger(steps) || steps < 1 || steps > spec.run.maxSteps) throw new Error('流场序列或完成步数无效');
  snapshotSize(first);
  if (flowHasTemperature(first) !== ((spec.parameters as { thermalEnabled?: boolean }).thermalEnabled === true)) {
    throw new Error('流场温度通道与保存的任务不一致');
  }
  const pressure = spec.outputs.fields?.includes('pressure') === true;
  if ((first.hasPressure === true) !== pressure) throw new Error('流场压力通道与保存的任务不一致');
  if (pressure && (derived?.[LBM_PRESSURE_FIELD_FEATURE] !== 1 || typeof derived.pressureScalePa !== 'number' ||
      !Number.isFinite(derived.pressureScalePa) || derived.pressureScalePa <= 0)) throw new Error('压力流场缺少有效的保存单位或执行器标记');
  const expected = lbmFieldSampleSteps(spec.run.maxSteps, spec.outputs.fieldFrames, first.flags.length, flowHasTemperature(first), pressure)
    .filter(step => step < steps).concat(steps);
  if (frames.length !== expected.length) throw new Error('流场序列缺帧或超出采样范围');
  let bytes = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    bytes += snapshotSize(frame);
    const cells = frame.nx * frame.ny * frame.nz;
    if (!(frame.display instanceof Float32Array) || !(frame.flags instanceof Uint32Array) ||
        frame.flags.length !== cells || frame.display.length !== cells * frame.displayStride || frame.display.some(value => !Number.isFinite(value)) ||
        frame.flags.some(flag => flag > (flowHasTemperature(frame) ? 20 : 1)) ||
        frame.step !== expected[i] || frame.nx !== first.nx || frame.ny !== first.ny || frame.nz !== first.nz ||
        frame.uLattice !== first.uLattice || frame.displayStride !== first.displayStride || frame.hasPressure !== first.hasPressure ||
        frame.flags.length !== first.flags.length || frame.display.length !== first.display.length ||
        frame.flags.some((flag, cell) => flag !== first.flags[cell])) throw new Error('流场帧的时刻、网格或模型不一致');
  }
  if (bytes > 256 * 1024 * 1024) throw new Error('流场序列超过 256 MiB');
}

/** Natural convection has no imposed reference speed; use the saved fluid peak for color only. */
export function flowSpeedReference(snapshot: LbmDisplaySnapshot): number {
  let reference = snapshot.uLattice;
  if (reference === 0) {
    for (let cell = 0; cell < snapshot.flags.length; cell++) {
      if (snapshot.flags[cell] === 0) reference = Math.max(reference, snapshot.display[cell * snapshot.displayStride]);
    }
  }
  return Math.max(reference, 1e-12);
}

/** Summarize saved cells in physical units; never use the current input controls. */
export function summarizeFlowSnapshot(snapshot: LbmDisplaySnapshot,
  units: Pick<NonNullable<JobResultV1['derived']>, 'ambientC' | 'temperatureScaleC' | 'dx' | 'dt' | 'pressureScalePa'> | null) {
  let maxSpeed = -Infinity, fluidMin = Infinity, fluidMax = -Infinity, solidMin = Infinity, solidMax = -Infinity;
  let pressureMin = Infinity, pressureMax = -Infinity;
  const pressureOffset = flowPressureOffset(snapshot);
  const regions = Array.from({ length: 17 }, () => ({ cells: 0, min: Infinity, max: -Infinity }));
  for (let cell = 0; cell < snapshot.flags.length; cell++) {
    const offset = cell * snapshot.displayStride;
    if (snapshot.flags[cell] === 0) {
      maxSpeed = Math.max(maxSpeed, snapshot.display[offset]);
      if (pressureOffset !== null) {
        pressureMin = Math.min(pressureMin, snapshot.display[offset + pressureOffset]);
        pressureMax = Math.max(pressureMax, snapshot.display[offset + pressureOffset]);
      }
    }
    if (!flowHasTemperature(snapshot)) continue;
    const temperature = snapshot.display[offset + 2];
    if (snapshot.flags[cell] === 0) {
      fluidMin = Math.min(fluidMin, temperature); fluidMax = Math.max(fluidMax, temperature);
    } else {
      solidMin = Math.min(solidMin, temperature); solidMax = Math.max(solidMax, temperature);
      const region = regions[snapshot.flags[cell] - 4];
      if (region) { region.cells++; region.min = Math.min(region.min, temperature); region.max = Math.max(region.max, temperature); }
    }
  }
  const { ambientC, temperatureScaleC, dx, dt, pressureScalePa } = units ?? {};
  const range = (min: number, max: number) => Number.isFinite(min) && Number.isFinite(max) &&
    typeof ambientC === 'number' && Number.isFinite(ambientC) &&
    typeof temperatureScaleC === 'number' && Number.isFinite(temperatureScaleC) && temperatureScaleC > 0
    ? { min: ambientC + min * temperatureScaleC, max: ambientC + max * temperatureScaleC } : null;
  return {
    maxSpeedMps: Number.isFinite(maxSpeed) && typeof dx === 'number' && Number.isFinite(dx) && dx > 0 &&
      typeof dt === 'number' && Number.isFinite(dt) && dt > 0 ? maxSpeed * dx / dt : null,
    pressurePa: typeof pressureScalePa === 'number' && pressureScalePa > 0 &&
      Number.isFinite(pressureMin * pressureScalePa) && Number.isFinite(pressureMax * pressureScalePa)
      ? { min: pressureMin * pressureScalePa, max: pressureMax * pressureScalePa } : null,
    fluidTemperatureC: range(fluidMin, fluidMax), solidTemperatureC: range(solidMin, solidMax),
    solidRegions: regions.map((region, index) => ({ flag: index + 4, cells: region.cells,
      volumeM3: typeof dx === 'number' && Number.isFinite(dx) && dx > 0 ? region.cells * dx ** 3 : null,
      temperatureC: range(region.min, region.max),
    })).filter((region) => region.cells > 0),
  };
}

function snapshotSize(snapshot: Pick<LbmDisplaySnapshot, 'nx' | 'ny' | 'nz' | 'step' | 'displayStride' | 'uLattice' | 'hasPressure'>): number {
  const { nx, ny, nz, step, displayStride, uLattice } = snapshot;
  if (![nx, ny, nz, step].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff) ||
      (snapshot.hasPressure !== undefined && snapshot.hasPressure !== true) ||
      (snapshot.hasPressure === true ? displayStride !== 3 && displayStride !== 4 : displayStride !== 2 && displayStride !== 3) ||
      !Number.isFinite(Math.fround(uLattice)) || uLattice < 0) {
    throw new Error('流场尺寸、步数或单位无效');
  }
  const size = HEADER_BYTES + nx * ny * nz * (displayStride + 1) * 4;
  if (!Number.isSafeInteger(size) || size > MAX_FLOW_SNAPSHOT_BYTES) throw new Error('流场数据超过大小限制');
  return size;
}

/** Exact sampled display buffer and solid-cell mask; no solver or resampling in the client. */
export function encodeFlowSnapshot(snapshot: LbmDisplaySnapshot): ArrayBuffer {
  const size = snapshotSize(snapshot);
  const cells = snapshot.nx * snapshot.ny * snapshot.nz;
  if (snapshot.display.length !== cells * snapshot.displayStride || snapshot.flags.length !== cells) throw new Error('流场数据长度不匹配');
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  [snapshot.hasPressure ? PRESSURE_MAGIC : MAGIC, snapshot.nx, snapshot.ny, snapshot.nz, snapshot.step, snapshot.displayStride].forEach((value, i) => view.setUint32(i * 4, value, true));
  view.setFloat32(24, snapshot.uLattice, true);
  if (snapshot.hasPressure) view.setUint32(28, 2 | Number(flowHasTemperature(snapshot)), true);
  let offset = HEADER_BYTES;
  for (const value of snapshot.display) {
    if (!Number.isFinite(Math.fround(value))) throw new Error('流场含非有限值');
    view.setFloat32(offset, value, true); offset += 4;
  }
  for (const value of snapshot.flags) {
    if (value > (flowHasTemperature(snapshot) ? 20 : 1)) throw new Error('流场含未知材料标记');
    view.setUint32(offset, value, true); offset += 4;
  }
  return buffer;
}

export function decodeFlowSnapshot(buffer: ArrayBuffer, contentType?: string): LbmDisplaySnapshot {
  if (buffer.byteLength < HEADER_BYTES || buffer.byteLength > MAX_FLOW_SNAPSHOT_BYTES) throw new Error('流场数据大小无效');
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true), channels = view.getUint32(28, true);
  if (magic === QUANTIZED_MAGIC) {
    if (contentType !== undefined && contentType !== FLOW_SNAPSHOT_V3_CONTENT_TYPE) throw new Error('流场文件类型与格式版本不一致');
    return decodeFlowSnapshotV3(view, buffer.byteLength);
  }
  if (magic !== MAGIC && magic !== PRESSURE_MAGIC) throw new Error('不支持的流场数据格式');
  if (magic === PRESSURE_MAGIC && (channels !== 2 && channels !== 3)) throw new Error('流场压力通道标记无效');
  const dims = {
    nx: view.getUint32(4, true), ny: view.getUint32(8, true), nz: view.getUint32(12, true),
    step: view.getUint32(16, true), displayStride: view.getUint32(20, true) as 2 | 3 | 4,
    uLattice: view.getFloat32(24, true),
    ...(magic === PRESSURE_MAGIC ? { hasPressure: true as const } : {}),
  };
  if (contentType !== undefined && contentType !== flowSnapshotContentType(dims)) throw new Error('流场文件类型与格式版本不一致');
  if (magic === PRESSURE_MAGIC && Boolean(channels & 1) !== flowHasTemperature(dims)) throw new Error('流场温度通道标记与分量数不一致');
  if (snapshotSize(dims) !== buffer.byteLength) throw new Error('流场数据不完整');
  const cells = dims.nx * dims.ny * dims.nz;
  // WVF1/WVF2 are aligned little-endian. Owned worker/download buffers can be viewed
  // directly on little-endian hosts, avoiding a second full sequence allocation.
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const display = littleEndian ? new Float32Array(buffer, HEADER_BYTES, cells * dims.displayStride) : new Float32Array(cells * dims.displayStride);
  const flags = littleEndian ? new Uint32Array(buffer, HEADER_BYTES + display.byteLength, cells) : new Uint32Array(cells);
  let offset = HEADER_BYTES;
  for (let i = 0; i < display.length; i++, offset += 4) {
    if (!littleEndian) display[i] = view.getFloat32(offset, true);
    if (!Number.isFinite(display[i])) throw new Error('流场含非有限值');
  }
  for (let i = 0; i < flags.length; i++, offset += 4) {
    if (!littleEndian) flags[i] = view.getUint32(offset, true);
    if (flags[i] > (flowHasTemperature(dims) ? 20 : 1)) throw new Error('流场含未知材料标记');
  }
  return { ...dims, display, flags };
}

function snapshotDims(snapshot: Pick<LbmDisplaySnapshot, 'nx' | 'ny' | 'nz' | 'step' | 'displayStride' | 'uLattice' | 'hasPressure'>): void {
  const { nx, ny, nz, step, displayStride, uLattice } = snapshot;
  if (![nx, ny, nz, step].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff) ||
      (snapshot.hasPressure !== undefined && snapshot.hasPressure !== true) ||
      (snapshot.hasPressure === true ? displayStride !== 3 && displayStride !== 4 : displayStride !== 2 && displayStride !== 3) ||
      !Number.isFinite(Math.fround(uLattice)) || uLattice < 0) {
    throw new Error('流场尺寸、步数或单位无效');
  }
}

/** Byte size of one WVF3-quantized frame; used for upload batching decisions. */
export function quantizedFlowFrameBytes(snapshot: Pick<LbmDisplaySnapshot, 'nx' | 'ny' | 'nz' | 'displayStride'>): number {
  return HEADER_BYTES + snapshot.displayStride * 8 + snapshot.nx * snapshot.ny * snapshot.nz * (snapshot.displayStride + 1);
}

/**
 * WVF3 render quantization: each display channel maps to u8 via per-frame
 * min/max, flags pack to u8. Remote playback only needs colormap input, so
 * f32 physics precision is unnecessary — this is ~4x smaller than WVF1/2.
 */
export function encodeFlowSnapshotV3(snapshot: LbmDisplaySnapshot): ArrayBuffer {
  snapshotDims(snapshot);
  const cells = snapshot.nx * snapshot.ny * snapshot.nz;
  const stride = snapshot.displayStride;
  if (snapshot.display.length !== cells * stride || snapshot.flags.length !== cells) throw new Error('流场数据长度不匹配');
  const size = quantizedFlowFrameBytes(snapshot);
  if (size > MAX_FLOW_SNAPSHOT_BYTES) throw new Error('流场数据超过大小限制');
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  [QUANTIZED_MAGIC, snapshot.nx, snapshot.ny, snapshot.nz, snapshot.step, stride].forEach((value, i) => view.setUint32(i * 4, value, true));
  view.setFloat32(24, snapshot.uLattice, true);
  // WVF3 channel word: bit0 thermal, bit1 pressure (unlike WVF2 where magic implies pressure).
  view.setUint32(28, (snapshot.hasPressure === true ? 2 : 0) | Number(flowHasTemperature(snapshot)), true);
  const out = new Uint8Array(buffer, HEADER_BYTES + stride * 8, cells * stride);
  for (let c = 0; c < stride; c++) {
    let min = Infinity, max = -Infinity;
    for (let cell = 0; cell < cells; cell++) {
      const value = snapshot.display[cell * stride + c]!;
      if (!Number.isFinite(value)) throw new Error('流场含非有限值');
      if (value < min) min = value;
      if (value > max) max = value;
    }
    view.setFloat32(HEADER_BYTES + c * 8, min, true);
    view.setFloat32(HEADER_BYTES + c * 8 + 4, max, true);
    const scale = max > min ? 255 / (max - min) : 0;
    for (let cell = 0; cell < cells; cell++) {
      out[cell * stride + c] = Math.round((snapshot.display[cell * stride + c]! - min) * scale);
    }
  }
  const flagLimit = flowHasTemperature(snapshot) ? 20 : 1;
  const outFlags = new Uint8Array(buffer, HEADER_BYTES + stride * 8 + cells * stride, cells);
  for (let cell = 0; cell < cells; cell++) {
    const flag = snapshot.flags[cell]!;
    if (flag > flagLimit) throw new Error('流场含未知材料标记');
    outFlags[cell] = flag;
  }
  return buffer;
}

function decodeFlowSnapshotV3(view: DataView, size: number): LbmDisplaySnapshot {
  const channels = view.getUint32(28, true);
  if (channels > 3) throw new Error('流场通道标记无效');
  const dims = {
    nx: view.getUint32(4, true), ny: view.getUint32(8, true), nz: view.getUint32(12, true),
    step: view.getUint32(16, true), displayStride: view.getUint32(20, true) as 2 | 3 | 4,
    uLattice: view.getFloat32(24, true),
    ...((channels & 2) !== 0 ? { hasPressure: true as const } : {}),
  };
  if (Boolean(channels & 1) !== flowHasTemperature(dims) || ![2, 3, 4].includes(dims.displayStride)) throw new Error('流场温度通道标记与分量数不一致');
  if (![dims.nx, dims.ny, dims.nz, dims.step].every(n => n > 0)) throw new Error('流场尺寸或步数无效');
  const cells = dims.nx * dims.ny * dims.nz;
  const stride = dims.displayStride;
  if (HEADER_BYTES + stride * 8 + cells * (stride + 1) !== size) throw new Error('流场数据不完整');
  const q = new Uint8Array(view.buffer, view.byteOffset + HEADER_BYTES + stride * 8, cells * stride);
  const qFlags = new Uint8Array(view.buffer, view.byteOffset + HEADER_BYTES + stride * 8 + cells * stride, cells);
  const display = new Float32Array(cells * stride);
  for (let c = 0; c < stride; c++) {
    const min = view.getFloat32(HEADER_BYTES + c * 8, true), max = view.getFloat32(HEADER_BYTES + c * 8 + 4, true);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error('流场量化范围无效');
    const inv = (max - min) / 255;
    for (let cell = 0; cell < cells; cell++) display[cell * stride + c] = min + q[cell * stride + c]! * inv;
  }
  const flags = new Uint32Array(cells);
  const flagLimit = flowHasTemperature(dims) ? 20 : 1;
  for (let cell = 0; cell < cells; cell++) {
    flags[cell] = qFlags[cell]!;
    if (flags[cell]! > flagLimit) throw new Error('流场含未知材料标记');
  }
  return { ...dims, display, flags };
}

/** WVS1 sequence: magic + u32 count + per-frame (u32 length + WVF blob). */
export function encodeFlowSequence(frames: LbmDisplaySnapshot[]): ArrayBuffer {
  if (!frames.length || frames.length > 4096) throw new Error('流场序列帧数无效');
  const blobs = frames.map(frame => encodeFlowSnapshotV3(frame));
  const size = SEQUENCE_HEADER_BYTES + blobs.reduce((sum, blob) => sum + 4 + blob.byteLength, 0);
  if (size > MAX_FLOW_SNAPSHOT_BYTES) throw new Error('流场序列超过大小限制');
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  view.setUint32(0, SEQUENCE_MAGIC, true);
  view.setUint32(4, blobs.length, true);
  let offset = SEQUENCE_HEADER_BYTES;
  for (const blob of blobs) {
    view.setUint32(offset, blob.byteLength, true);
    new Uint8Array(buffer, offset + 4, blob.byteLength).set(new Uint8Array(blob));
    offset += 4 + blob.byteLength;
  }
  return buffer;
}

/** True when the blob carries the WVZ1 gzip envelope around a WVS1/WVM sequence. */
export function isCompressedSequence(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 4) return false;
  return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === COMPRESSED_MAGIC;
}

export function decodeFlowSequence(buffer: ArrayBuffer): LbmDisplaySnapshot[] {
  if (buffer.byteLength < SEQUENCE_HEADER_BYTES || buffer.byteLength > MAX_FLOW_SNAPSHOT_BYTES) throw new Error('流场序列大小无效');
  if (isCompressedSequence(buffer)) throw new Error('流场序列需要先解压 WVZ1 信封');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== SEQUENCE_MAGIC) throw new Error('不支持的流场序列格式');
  const count = view.getUint32(4, true);
  if (!Number.isSafeInteger(count) || count < 1 || count > 4096) throw new Error('流场序列帧数无效');
  const frames: LbmDisplaySnapshot[] = [];
  let offset = SEQUENCE_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    if (offset + 4 > buffer.byteLength) throw new Error('流场序列不完整');
    const length = view.getUint32(offset, true);
    offset += 4;
    if (length < HEADER_BYTES || offset + length > buffer.byteLength) throw new Error('流场序列帧长度无效');
    frames.push(decodeFlowSnapshot(buffer.slice(offset, offset + length)));
    offset += length;
  }
  if (offset !== buffer.byteLength) throw new Error('流场序列含多余数据');
  return frames;
}

/**
 * WVZ1 gzip envelope for sequence uploads. Field data stays spatially
 * coherent after u8 quantization, so deflate typically halves it again.
 * Falls back to the raw sequence when compression does not pay.
 */
export async function compressSequenceBlob(raw: ArrayBuffer): Promise<ArrayBuffer> {
  const zipped = await new Response(
    new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  if (zipped.byteLength + COMPRESSED_HEADER_BYTES >= raw.byteLength) return raw;
  const buffer = new ArrayBuffer(COMPRESSED_HEADER_BYTES + zipped.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, COMPRESSED_MAGIC, true);
  view.setUint32(4, raw.byteLength, true);
  new Uint8Array(buffer, COMPRESSED_HEADER_BYTES).set(new Uint8Array(zipped));
  return buffer;
}

/** Reverse of compressSequenceBlob; transparent when the payload is not wrapped. */
export async function decompressSequenceBlob(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (buffer.byteLength < COMPRESSED_HEADER_BYTES || buffer.byteLength > MAX_FLOW_SNAPSHOT_BYTES) {
    throw new Error('序列数据大小无效');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== COMPRESSED_MAGIC) return buffer;
  const rawSize = view.getUint32(4, true);
  if (rawSize < SEQUENCE_HEADER_BYTES || rawSize > MAX_FLOW_SNAPSHOT_BYTES) throw new Error('序列解压大小无效');
  const reader = new Blob([buffer.slice(COMPRESSED_HEADER_BYTES)]).stream()
    .pipeThrough(new DecompressionStream('gzip')).getReader();
  const raw = new Uint8Array(rawSize);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > rawSize) throw new Error('序列解压超出声明大小');
      raw.set(value, offset);
      offset += value.byteLength;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (offset !== rawSize) throw new Error('序列解压大小不一致');
  return raw.buffer;
}
