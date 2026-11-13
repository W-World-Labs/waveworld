import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeFlowSnapshotV3, decodeFlowSnapshot, encodeFlowSequence, decodeFlowSequence,
  compressSequenceBlob, decompressSequenceBlob, isCompressedSequence,
  quantizedFlowFrameBytes, FLOW_SNAPSHOT_V3_CONTENT_TYPE,
  type LbmDisplaySnapshot,
} from './flow-snapshot';

function makeSnapshot(overrides: Partial<LbmDisplaySnapshot> = {}): LbmDisplaySnapshot {
  const nx = 4, ny = 2, nz = 2, cells = nx * ny * nz, stride = 3;
  const display = new Float32Array(cells * stride);
  const flags = new Uint32Array(cells);
  for (let cell = 0; cell < cells; cell++) {
    flags[cell] = cell % 7 === 0 ? 1 : 0;
    display[cell * stride] = cell * 0.01;              // speed
    display[cell * stride + 1] = cell * -0.005;        // vorticity (negative range)
    display[cell * stride + 2] = cell * 2 - cells;     // pressure (mixed sign)
  }
  return { nx, ny, nz, step: 42, displayStride: 3, uLattice: 0.05, hasPressure: true, display, flags, ...overrides };
}

test('WVF3 quantized frame round-trips within u8 tolerance', () => {
  const snapshot = makeSnapshot();
  const encoded = encodeFlowSnapshotV3(snapshot);
  assert.equal(encoded.byteLength, quantizedFlowFrameBytes(snapshot));
  const decoded = decodeFlowSnapshot(encoded, FLOW_SNAPSHOT_V3_CONTENT_TYPE);
  assert.equal(decoded.nx, snapshot.nx);
  assert.equal(decoded.step, snapshot.step);
  assert.equal(decoded.hasPressure, true);
  assert.deepEqual([...decoded.flags], [...snapshot.flags]);
  for (let c = 0; c < snapshot.displayStride; c++) {
    let min = Infinity, max = -Infinity;
    for (let cell = 0; cell < snapshot.flags.length; cell++) {
      const v = snapshot.display[cell * snapshot.displayStride + c]!;
      min = Math.min(min, v); max = Math.max(max, v);
    }
    const tol = (max - min) / 255 / 2 + 1e-9;
    for (let cell = 0; cell < snapshot.flags.length; cell++) {
      const i = cell * snapshot.displayStride + c;
      assert.ok(Math.abs(decoded.display[i]! - snapshot.display[i]!) <= tol, `channel ${c} cell ${cell}: ${decoded.display[i]} vs ${snapshot.display[i]}`);
    }
  }
});

test('WVF3 constant channel encodes without division by zero', () => {
  const snapshot = makeSnapshot();
  snapshot.display.fill(0.5);
  const decoded = decodeFlowSnapshot(encodeFlowSnapshotV3(snapshot), FLOW_SNAPSHOT_V3_CONTENT_TYPE);
  assert.ok(decoded.display.every(v => Math.abs(v - 0.5) < 1e-7));
});

test('WVF3 rejects non-finite and oversized payloads', () => {
  const bad = makeSnapshot();
  bad.display[0] = Number.NaN;
  assert.throws(() => encodeFlowSnapshotV3(bad), /非有限值/);
  const frame = makeSnapshot();
  const encoded = Buffer.from(encodeFlowSnapshotV3(frame));
  encoded.writeUInt32LE(0xdeadbeef, 0);
  assert.throws(() => decodeFlowSnapshot(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)), /不支持/);
  // Truncated frame must fail the size check.
  const truncated = encodeFlowSnapshotV3(frame).slice(0, 100);
  assert.throws(() => decodeFlowSnapshot(truncated), /不完整|无效/);
});

test('WVS1 sequence round-trips and rejects malformed input', () => {
  const frames = [makeSnapshot({ step: 10 }), makeSnapshot({ step: 20 }), makeSnapshot({ step: 30 })];
  const decoded = decodeFlowSequence(encodeFlowSequence(frames));
  assert.equal(decoded.length, 3);
  assert.deepEqual(decoded.map(f => f.step), [10, 20, 30]);
  assert.throws(() => decodeFlowSequence(new ArrayBuffer(4)), /大小|格式/);
  assert.throws(() => encodeFlowSequence([]), /帧数/);
});

test('WVZ1 gzip envelope compresses and round-trips', async () => {
  const frames = Array.from({ length: 8 }, (_, i) => makeSnapshot({ step: i + 1 }));
  const raw = encodeFlowSequence(frames);
  const packed = await compressSequenceBlob(raw);
  assert.ok(isCompressedSequence(packed), 'compressible field data should be wrapped');
  assert.ok(packed.byteLength < raw.byteLength);
  const unpacked = await decompressSequenceBlob(packed);
  assert.equal(unpacked.byteLength, raw.byteLength);
  const decoded = decodeFlowSequence(unpacked);
  assert.equal(decoded.length, 8);
  // Non-WVZ input passes through untouched.
  const passthrough = await decompressSequenceBlob(raw);
  assert.equal(passthrough.byteLength, raw.byteLength);
  // Direct decode of a WVZ1 blob must fail loudly instead of misreading.
  assert.throws(() => decodeFlowSequence(packed), /解压/);
});
