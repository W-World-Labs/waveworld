import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameExportWriter } from './frame-export';
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts';

type Written = Map<string, Uint8Array>;

// Minimal in-memory FileSystemDirectoryHandle stand-in for the writer contract.
function fakeDir(written: Written = new Map(), failOn?: string): FileSystemDirectoryHandle {
  const prefix: string[] = [];
  const make = (path: string[]): FileSystemDirectoryHandle => ({
    getDirectoryHandle: async (name: string) => make([...path, name]),
    getFileHandle: async (name: string) => ({
      createWritable: async () => {
        const file = [...path, name].join('/');
        return {
          write: async (data: ArrayBuffer | string) => {
            if (name === failOn) throw new Error('disk full');
            written.set(file, typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
          },
          close: async () => {},
        } as FileSystemWritableFileStream;
      },
    } as unknown as FileSystemFileHandle),
  } as FileSystemDirectoryHandle);
  void prefix;
  return make([]);
}

const spec = { schemaVersion: 1, kind: 'lbm-d3q19', run: { maxSteps: 3 }, outputs: {} } as JobSpecV1;
const result = { schemaVersion: 1, summary: { steps: 3, wallTimeMs: 1 }, backend: { id: 'cpu' } } as JobResultV1;

test('streams frames then writes manifest/spec/result with step indexes', async () => {
  const written = new Map();
  const writer = createFrameExportWriter(fakeDir(written), 'run-1', 'wvf');
  writer.push(new Uint8Array([1, 2]).buffer as ArrayBuffer, 1);
  writer.push(new Uint8Array([3]).buffer as ArrayBuffer, 2);
  await writer.finish(spec, result);
  assert.deepEqual([...written.keys()].sort(), [
    'run-1/frames/frame-0000.wvf', 'run-1/frames/frame-0001.wvf',
    'run-1/manifest.json', 'run-1/result.json', 'run-1/spec.json',
  ]);
  const manifest = JSON.parse(new TextDecoder().decode(written.get('run-1/manifest.json')));
  assert.equal(manifest.frameFormat, 'wvf');
  assert.deepEqual(manifest.frames.map((f: { step: number }) => f.step), [1, 2]);
  assert.deepEqual(manifest.frames.map((f: { bytes: number }) => f.bytes), [2, 1]);
});

test('uses the requested extension and fails finish on write errors', async () => {
  const written = new Map();
  const writer = createFrameExportWriter(fakeDir(written, 'frame-0000.wvm'), 'run-2', 'wvm');
  writer.push(new Uint8Array([9]).buffer as ArrayBuffer, 7);
  await assert.rejects(() => writer.finish(spec, result), /disk full/);
  assert.equal(written.has('run-2/manifest.json'), false);
});
