import { macFieldSampleSteps, type MacFieldSnapshot } from '@w-sim/solvers-lbm/mac3d';
import type { JobSpecV1 } from '@w-sim/contracts';
import { isCompressedSequence } from './flow-snapshot';

export type { MacFieldSnapshot as MacFlowSnapshot } from '@w-sim/solvers-lbm/mac3d';
export const MAC_FLOW_SNAPSHOT_KIND = 'mac-flow-field';
export const MAC_FLOW_SEQUENCE_KIND = 'mac-flow-seq';
export const MAC_FLOW_SNAPSHOT_CONTENT_TYPE = 'application/vnd.waveworld.mac-field-v1';
export const MAC_FLOW_SEQUENCE_CONTENT_TYPE = 'application/vnd.waveworld.mac-flow-seq-v1';
export const MAX_MAC_FLOW_SNAPSHOT_BYTES = 32 * 1024 * 1024;
export const MAX_MAC_FLOW_SEQUENCE_BYTES = 256 * 1024 * 1024;
const MAGIC = 0x314d5657; // WVM1, little-endian; distinct from LBM WVF1.
const HEADER_BYTES = 32;

function snapshotSize(snapshot: Pick<MacFieldSnapshot, 'nx' | 'ny' | 'nz' | 'step' | 'displayStride'>): number {
  const { nx, ny, nz, step, displayStride } = snapshot;
  if (![nx, ny, nz, step].every(n => Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff) ||
      (displayStride !== 4 && displayStride !== 5)) throw new Error('MAC 流场尺寸、步数或分量数无效');
  const size = HEADER_BYTES + nx * ny * nz * (displayStride + 1) * 4;
  if (!Number.isSafeInteger(size) || size > MAX_MAC_FLOW_SNAPSHOT_BYTES) throw new Error('MAC 单帧超过 32 MiB');
  return size;
}

/** Physical fields: ux, uy, uz in m/s, gauge pressure in Pa, optional Celsius. */
export function assertMacFlowSnapshot(snapshot: MacFieldSnapshot): void {
  snapshotSize(snapshot);
  const cells = snapshot.nx * snapshot.ny * snapshot.nz;
  const { fields, flags, displayStride } = snapshot;
  if (!(fields instanceof Float32Array) || !(flags instanceof Uint32Array) ||
      fields.length !== cells * displayStride || flags.length !== cells) throw new Error('MAC 流场数据长度或类型不匹配');
  for (let cell = 0; cell < cells; cell++) {
    const flag = flags[cell], offset = cell * displayStride;
    if (flag > (displayStride === 5 ? 20 : 1)) throw new Error('MAC 流场含未知材料标记');
    for (let component = 0; component < displayStride; component++) {
      const value = fields[offset + component];
      if (!Number.isFinite(value)) throw new Error('MAC 流场含非有限值');
      if (flag !== 0 && component < 4 && value !== 0) throw new Error('MAC 固体的速度和压力必须为 0');
    }
    if (displayStride === 5 && fields[offset + 4] <= -273.15) throw new Error('MAC 温度必须高于绝对零度');
  }
}

/** MAC tasks currently require the complete sample plan, including maxSteps. */
export function assertMacFlowFrames(frames: readonly MacFieldSnapshot[], spec: Pick<JobSpecV1, 'run' | 'outputs'>, steps: number): void {
  const first = frames[0];
  if (!first || frames.length > 4096 || !Number.isSafeInteger(steps) || steps < 1 || steps !== spec.run.maxSteps) {
    throw new Error('MAC 流场序列或完成步数无效');
  }
  const bytes = frames.reduce((sum, frame) => sum + snapshotSize(frame), 0);
  if (bytes > MAX_MAC_FLOW_SEQUENCE_BYTES) throw new Error('MAC 流场序列超过 256 MiB');
  const expected = macFieldSampleSteps(spec.run.maxSteps, spec.outputs.fieldFrames, first.nx * first.ny * first.nz, first.displayStride === 5);
  if (frames.length !== expected.length) throw new Error('MAC 流场序列缺帧或超出采样范围');
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    assertMacFlowSnapshot(frame);
    if (frame.step !== expected[i] || frame.nx !== first.nx || frame.ny !== first.ny || frame.nz !== first.nz ||
        frame.displayStride !== first.displayStride || frame.flags.some((flag, cell) => flag !== first.flags[cell])) {
      throw new Error('MAC 流场帧的时刻、网格或模型不一致');
    }
  }
}

/** Save the sampled physical fields without solver-dependent color scaling. */
export function encodeMacFlowSnapshot(snapshot: MacFieldSnapshot): ArrayBuffer {
  assertMacFlowSnapshot(snapshot);
  const buffer = new ArrayBuffer(snapshotSize(snapshot));
  const view = new DataView(buffer);
  [MAGIC, snapshot.nx, snapshot.ny, snapshot.nz, snapshot.step, snapshot.displayStride, 0, 0]
    .forEach((value, i) => view.setUint32(i * 4, value, true));
  let offset = HEADER_BYTES;
  for (const value of snapshot.fields) { view.setFloat32(offset, value, true); offset += 4; }
  for (const value of snapshot.flags) { view.setUint32(offset, value, true); offset += 4; }
  return buffer;
}

/** Decoded arrays view the owned input buffer on little-endian hosts. */
export function decodeMacFlowSnapshot(buffer: ArrayBuffer): MacFieldSnapshot {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES || buffer.byteLength > MAX_MAC_FLOW_SNAPSHOT_BYTES) {
    throw new Error('MAC 流场数据大小无效');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(24, true) !== 0 || view.getUint32(28, true) !== 0) {
    throw new Error('不支持的 MAC 流场数据格式');
  }
  const dims = {
    nx: view.getUint32(4, true), ny: view.getUint32(8, true), nz: view.getUint32(12, true),
    step: view.getUint32(16, true), displayStride: view.getUint32(20, true) as 4 | 5,
  };
  if (snapshotSize(dims) !== buffer.byteLength) throw new Error('MAC 流场数据不完整');
  const cells = dims.nx * dims.ny * dims.nz;
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const fields = littleEndian ? new Float32Array(buffer, HEADER_BYTES, cells * dims.displayStride) : new Float32Array(cells * dims.displayStride);
  const flags = littleEndian ? new Uint32Array(buffer, HEADER_BYTES + fields.byteLength, cells) : new Uint32Array(cells);
  if (!littleEndian) {
    let offset = HEADER_BYTES;
    for (let i = 0; i < fields.length; i++, offset += 4) fields[i] = view.getFloat32(offset, true);
    for (let i = 0; i < flags.length; i++, offset += 4) flags[i] = view.getUint32(offset, true);
  }
  const snapshot = { ...dims, fields, flags };
  assertMacFlowSnapshot(snapshot);
  return snapshot;
}

const SEQUENCE_MAGIC = 0x31535657; // WVS1: counted sequence of WVM frames.
const SEQUENCE_HEADER_BYTES = 8;
/** Byte size of one WVM1 frame; used for upload batching decisions. */
export function macFlowFrameBytes(snapshot: Pick<MacFieldSnapshot, 'nx' | 'ny' | 'nz' | 'displayStride'>): number {
  return HEADER_BYTES + snapshot.nx * snapshot.ny * snapshot.nz * (snapshot.displayStride + 1) * 4;
}

/** WVS1 sequence: magic + u32 count + per-frame (u32 length + WVM1 blob). */
export function encodeMacFlowSequence(frames: MacFieldSnapshot[]): ArrayBuffer {
  if (!frames.length || frames.length > 4096) throw new Error('MAC 流场序列帧数无效');
  const blobs = frames.map(frame => encodeMacFlowSnapshot(frame));
  const size = SEQUENCE_HEADER_BYTES + blobs.reduce((sum, blob) => sum + 4 + blob.byteLength, 0);
  if (size > MAX_MAC_FLOW_SNAPSHOT_BYTES) throw new Error('MAC 流场序列超过大小限制');
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

export function decodeMacFlowSequence(buffer: ArrayBuffer): MacFieldSnapshot[] {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < SEQUENCE_HEADER_BYTES || buffer.byteLength > MAX_MAC_FLOW_SNAPSHOT_BYTES) {
    throw new Error('MAC 流场序列大小无效');
  }
  if (isCompressedSequence(buffer)) throw new Error('MAC 流场序列需要先解压 WVZ1 信封');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== SEQUENCE_MAGIC) throw new Error('不支持的 MAC 流场序列格式');
  const count = view.getUint32(4, true);
  if (!Number.isSafeInteger(count) || count < 1 || count > 4096) throw new Error('MAC 流场序列帧数无效');
  const frames: MacFieldSnapshot[] = [];
  let offset = SEQUENCE_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    if (offset + 4 > buffer.byteLength) throw new Error('MAC 流场序列不完整');
    const length = view.getUint32(offset, true);
    offset += 4;
    if (length < HEADER_BYTES || offset + length > buffer.byteLength) throw new Error('MAC 流场序列帧长度无效');
    frames.push(decodeMacFlowSnapshot(buffer.slice(offset, offset + length)));
    offset += length;
  }
  if (offset !== buffer.byteLength) throw new Error('MAC 流场序列含多余数据');
  return frames;
}

/** All field quantities are already SI/Celsius; dx is only needed for volume. */
export function summarizeMacFlowSnapshot(snapshot: MacFieldSnapshot, units: { dx?: number } | null = null) {
  assertMacFlowSnapshot(snapshot);
  let maxSpeed = -Infinity, pressureMin = Infinity, pressureMax = -Infinity;
  let fluidMin = Infinity, fluidMax = -Infinity, solidMin = Infinity, solidMax = -Infinity;
  const regions = Array.from({ length: 17 }, () => ({ cells: 0, min: Infinity, max: -Infinity }));
  for (let cell = 0; cell < snapshot.flags.length; cell++) {
    const flag = snapshot.flags[cell], offset = cell * snapshot.displayStride;
    if (flag === 0) {
      maxSpeed = Math.max(maxSpeed, Math.hypot(snapshot.fields[offset], snapshot.fields[offset + 1], snapshot.fields[offset + 2]));
      pressureMin = Math.min(pressureMin, snapshot.fields[offset + 3]);
      pressureMax = Math.max(pressureMax, snapshot.fields[offset + 3]);
    }
    if (snapshot.displayStride !== 5 || flag === 1) continue; // Insulated mask has no thermal state.
    const temperature = snapshot.fields[offset + 4];
    if (flag === 0) {
      fluidMin = Math.min(fluidMin, temperature); fluidMax = Math.max(fluidMax, temperature);
    } else {
      solidMin = Math.min(solidMin, temperature); solidMax = Math.max(solidMax, temperature);
      const region = regions[flag - 4];
      if (region) { region.cells++; region.min = Math.min(region.min, temperature); region.max = Math.max(region.max, temperature); }
    }
  }
  const range = (min: number, max: number) => Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
  const dx = units?.dx;
  const volume = typeof dx === 'number' && Number.isFinite(dx) && dx > 0 ? dx ** 3 : NaN;
  return {
    maxSpeedMps: Number.isFinite(maxSpeed) ? maxSpeed : null,
    pressurePa: range(pressureMin, pressureMax),
    fluidTemperatureC: range(fluidMin, fluidMax), solidTemperatureC: range(solidMin, solidMax),
    solidRegions: regions.map((region, index) => ({ flag: index + 4, cells: region.cells,
      volumeM3: Number.isFinite(volume * region.cells) && volume > 0 ? volume * region.cells : null,
      temperatureC: range(region.min, region.max),
    })).filter(region => region.cells > 0),
  };
}
