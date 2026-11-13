import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { HttpError, readBytes, readJson } from '../src/lib/tasks/http';

function streamedRequest(chunks: Uint8Array[], headers?: HeadersInit) {
  return new Request('http://host.test/upload', {
    method: 'POST', headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit);
}

test('body reader preserves binary subarrays and UTF-8 split across chunks', async () => {
  const source = Uint8Array.of(99, 0, 128, 255, 99);
  const req = streamedRequest([source.subarray(1, 3), source.subarray(3, 4)]);
  assert.deepEqual(await readBytes(req, 3), Uint8Array.of(0, 128, 255));
  assert.equal(req.body!.locked, false);

  const value = { text: '\u{1f30a}' };
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  assert.deepEqual(await readJson(streamedRequest(Array.from(bytes, (b) => Uint8Array.of(b))), bytes.length), value);
  assert.deepEqual(await readBytes(new Request('http://host.test'), 1), new Uint8Array());
});

test('body reader cancels over-limit streams despite a false Content-Length', async () => {
  let cancelled = false;
  const req = new Request('http://host.test/upload', {
    method: 'POST', headers: { 'Content-Length': '1' },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2));
        controller.enqueue(Uint8Array.of(3, 4));
      },
      cancel() { cancelled = true; },
    }),
    duplex: 'half',
  } as RequestInit);
  await assert.rejects(readBytes(req, 3), (err) => err instanceof HttpError && err.status === 413);
  assert.equal(cancelled, true);
  assert.equal(req.body!.locked, false);
});

test('JSON reads preserve size errors and release failed streams', async () => {
  await assert.rejects(
    readJson(streamedRequest([], { 'Content-Length': '4' }), 3),
    (err) => err instanceof HttpError && err.status === 413,
  );
  const req = new Request('http://host.test/upload', {
    method: 'POST', duplex: 'half',
    body: new ReadableStream({ start(controller) { controller.error(new Error('transport failed')); } }),
  } as RequestInit);
  await assert.rejects(readJson(req, 1024), (err) => err instanceof HttpError && err.status === 400);
  assert.equal(req.body!.locked, false);
});

test('a 16 MiB chunked upload fits in a 96 MiB JavaScript heap', () => {
  const child = spawnSync(process.execPath, ['--max-old-space-size=96', '--import', 'tsx', '-e', `
    const assert = require('node:assert/strict');
    const { createHash } = require('node:crypto');
    const { readBytes } = require('./src/lib/tasks/http.ts');
    (async () => {
      const expected = createHash('sha256');
      let index = 0;
      const req = new Request('http://host.test/upload', {
        method: 'POST', duplex: 'half',
        body: new ReadableStream({
          pull(controller) {
            if (index === 256) { controller.close(); return; }
            const chunk = new Uint8Array(64 * 1024).fill(index++);
            expected.update(chunk);
            controller.enqueue(chunk);
          },
        }),
      });
      const bytes = await readBytes(req, 16 * 1024 * 1024);
      assert.equal(bytes.byteLength, 16 * 1024 * 1024);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.digest('hex'));
    })().catch(err => { console.error(err); process.exitCode = 1; });
  `], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, `upload child failed (${child.signal}): ${child.stderr}`);
});
