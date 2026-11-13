import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMacFlowFrames, assertMacFlowSnapshot, decodeMacFlowSnapshot, encodeMacFlowSnapshot,
  summarizeMacFlowSnapshot, MAC_FLOW_SNAPSHOT_CONTENT_TYPE, MAC_FLOW_SNAPSHOT_KIND,
  MAX_MAC_FLOW_SNAPSHOT_BYTES, MAX_MAC_FLOW_SEQUENCE_BYTES, type MacFlowSnapshot,
} from './mac-flow-snapshot';

function snapshot(step = 1, thermal = false): MacFlowSnapshot {
  return { nx: 2, ny: 1, nz: 1, step, displayStride: thermal ? 5 : 4,
    fields: new Float32Array(thermal ? [3, 4, 12, -8, 35, 0, 0, 0, 0, 60] : [3, 4, 12, -8, 0, 0, 0, 0]),
    flags: new Uint32Array(thermal ? [0, 5] : [0, 1]),
  };
}

function plan(maxSteps: number, fieldFrames?: number) {
  return { run: { maxSteps }, outputs: { fieldFrames } };
}

test('WVM1 roundtrips exact physical f32 fields with an independent byte layout', () => {
  assert.equal(MAC_FLOW_SNAPSHOT_KIND, 'mac-flow-field');
  assert.equal(MAC_FLOW_SNAPSHOT_CONTENT_TYPE, 'application/vnd.waveworld.mac-field-v1');
  for (const thermal of [false, true]) {
    const original = snapshot(7, thermal), buffer = encodeMacFlowSnapshot(original);
    const stride = thermal ? 5 : 4;
    assert.equal(buffer.byteLength, 32 + 2 * (stride + 1) * 4);
    assert.deepEqual([...new Uint8Array(buffer, 0, 4)], [0x57, 0x56, 0x4d, 0x31]);
    const view = new DataView(buffer);
    assert.deepEqual(Array.from({ length: 7 }, (_, i) => view.getUint32(4 + i * 4, true)), [2, 1, 1, 7, stride, 0, 0]);
    assert.equal(view.getFloat32(32 + 3 * 4, true), -8);
    assert.equal(view.getUint32(32 + original.fields.byteLength + 4, true), thermal ? 5 : 1);
    assert.deepEqual(decodeMacFlowSnapshot(buffer), original);
  }
});

test('encode rejects invalid dimensions, field types, material masks and physical values', () => {
  for (const change of [{ nx: 0 }, { ny: 1.5 }, { nz: 0x1_0000_0000 }, { step: 0 }, { step: NaN }, { displayStride: 3 }]) {
    assert.throws(() => encodeMacFlowSnapshot({ ...snapshot(), ...change } as MacFlowSnapshot));
  }
  for (const values of [new Float32Array(7), new Float64Array(8), [3, 4, 12, -8, 0, 0, 0, 0]]) {
    assert.throws(() => encodeMacFlowSnapshot({ ...snapshot(), fields: values as Float32Array }), /长度或类型/);
  }
  assert.throws(() => encodeMacFlowSnapshot({ ...snapshot(), flags: new Uint32Array(1) }), /长度或类型/);
  for (const thermal of [false, true]) {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      const field = snapshot(1, thermal); field.fields[0] = invalid;
      assert.throws(() => encodeMacFlowSnapshot(field), /非有限/);
    }
    const unknown = snapshot(1, thermal); unknown.flags[1] = thermal ? 21 : 2;
    assert.throws(() => encodeMacFlowSnapshot(unknown), /材料/);
    for (let component = 0; component < 4; component++) {
      const solid = snapshot(1, thermal); solid.fields[solid.displayStride + component] = 0.01;
      assert.throws(() => encodeMacFlowSnapshot(solid), /固体/);
    }
  }
  for (const cell of [0, 1]) {
    const frozen = snapshot(1, true); frozen.fields[cell * 5 + 4] = -274;
    assert.throws(() => encodeMacFlowSnapshot(frozen), /绝对零度/);
  }
});

test('decode rejects legacy magic, nonzero reserved words, truncation and corrupted payloads', () => {
  const original = encodeMacFlowSnapshot(snapshot(1, true));
  for (const [offset, value] of [[0, 0x31465657], [24, 1], [28, 1], [4, 0], [20, 4]]) {
    const buffer = original.slice(0); new DataView(buffer).setUint32(offset, value, true);
    assert.throws(() => decodeMacFlowSnapshot(buffer));
  }
  for (const bytes of [0, 31, original.byteLength - 1]) assert.throws(() => decodeMacFlowSnapshot(original.slice(0, bytes)));
  const extra = new Uint8Array(original.byteLength + 4); extra.set(new Uint8Array(original));
  assert.throws(() => decodeMacFlowSnapshot(extra.buffer), /不完整/);
  for (const [offset, value] of [[32, NaN], [32 + 5 * 4, 1], [32 + 4 * 4, -274]]) {
    const buffer = original.slice(0); new DataView(buffer).setFloat32(offset, value, true);
    assert.throws(() => decodeMacFlowSnapshot(buffer));
  }
  const material = original.slice(0);
  new DataView(material).setUint32(32 + 10 * 4, 21, true);
  assert.throws(() => decodeMacFlowSnapshot(material), /材料/);
});

test('size limits reject oversized metadata and sequences before field allocation or traversal', () => {
  assert.equal(MAX_MAC_FLOW_SNAPSHOT_BYTES, 32 * 1024 * 1024);
  assert.equal(MAX_MAC_FLOW_SEQUENCE_BYTES, 256 * 1024 * 1024);
  const tooLarge = { ...snapshot(), nx: Math.floor((MAX_MAC_FLOW_SNAPSHOT_BYTES - 32) / 20) + 1 };
  assert.throws(() => assertMacFlowSnapshot(tooLarge), /32 MiB/);
  const nearLimit = { ...snapshot(), nx: Math.floor((MAX_MAC_FLOW_SNAPSHOT_BYTES - 32) / 20) };
  assert.throws(() => assertMacFlowFrames(Array.from({ length: 9 }, () => nearLimit), plan(9, 9), 9), /256 MiB/);
  assert.throws(() => assertMacFlowFrames(Array.from({ length: 17 }, () => snapshot()), plan(17, 16), 17), /序列/);
});

test('frame sequence requires the complete shared integer sample plan and one model', () => {
  const frames = [snapshot(1), snapshot(5), snapshot(9)];
  assert.doesNotThrow(() => assertMacFlowFrames(frames, plan(9, 3), 9));
  assert.doesNotThrow(() => assertMacFlowFrames([snapshot(9)], plan(9), 9));
  assert.doesNotThrow(() => assertMacFlowFrames([snapshot(1), snapshot(2)], plan(2, 16), 2));
  for (const bad of [[], frames.slice(0, 2), [frames[0], snapshot(4), frames[2]], [frames[0], frames[0], frames[2]], [...frames].reverse()]) {
    assert.throws(() => assertMacFlowFrames(bad, plan(9, 3), 9));
  }
  assert.throws(() => assertMacFlowFrames([snapshot(1), snapshot(5)], plan(9, 3), 5), /完成步数/);
  for (const count of [0, 17, 1.5]) assert.throws(() => assertMacFlowFrames([snapshot(9)], plan(9, count), 9));
  const grid = snapshot(5); grid.nx = 1; grid.ny = 2;
  assert.throws(() => assertMacFlowFrames([frames[0], grid, frames[2]], plan(9, 3), 9), /不一致/);
  const mask = snapshot(5); mask.flags[1] = 0;
  assert.throws(() => assertMacFlowFrames([frames[0], mask, frames[2]], plan(9, 3), 9), /不一致/);
  assert.throws(() => assertMacFlowFrames([frames[0], snapshot(5, true), frames[2]], plan(9, 3), 9), /不一致/);
});

test('summary uses physical vector magnitude, fluid pressure and absolute Celsius without ambient or dt', () => {
  const thermal = snapshot(3, true);
  assert.deepEqual(summarizeMacFlowSnapshot(thermal), {
    maxSpeedMps: 13, pressurePa: { min: -8, max: -8 },
    fluidTemperatureC: { min: 35, max: 35 }, solidTemperatureC: { min: 60, max: 60 },
    solidRegions: [{ flag: 5, cells: 1, volumeM3: null, temperatureC: { min: 60, max: 60 } }],
  });
  const scaled = summarizeMacFlowSnapshot(thermal, { dx: 0.5 });
  assert.equal(scaled.solidRegions[0].volumeM3, 0.125);
  assert.equal(scaled.maxSpeedMps, 13);
  for (const dx of [0, -1, Infinity, NaN, 1e200]) assert.equal(summarizeMacFlowSnapshot(thermal, { dx }).solidRegions[0].volumeM3, null);
  assert.deepEqual(summarizeMacFlowSnapshot(snapshot()), {
    maxSpeedMps: 13, pressurePa: { min: -8, max: -8 },
    fluidTemperatureC: null, solidTemperatureC: null, solidRegions: [],
  });
  const reservoirs: MacFlowSnapshot = { nx: 3, ny: 1, nz: 1, step: 1, displayStride: 5,
    fields: new Float32Array([0, 0, 0, 0, -100, 0, 0, 0, 0, 60, 0, 0, 0, 0, 25]), flags: new Uint32Array([1, 2, 3]) };
  assert.deepEqual(summarizeMacFlowSnapshot(reservoirs), { maxSpeedMps: null, pressurePa: null,
    fluidTemperatureC: null, solidTemperatureC: { min: 25, max: 60 }, solidRegions: [] });
});
