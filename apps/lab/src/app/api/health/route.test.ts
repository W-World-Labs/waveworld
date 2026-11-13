/**
 * Drives the real shipped GET /api/health handler (not a mock).
 * App-relative path; with TUANLIU_BASE_PATH=/app/lab public URL is /app/lab/api/health.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from './route.ts';

describe('GET /api/health (tuanliu-lab)', () => {
  it('returns 200 JSON with ok and service tuanliu-lab', async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      status: string;
      service: string;
      version?: string;
      uptimeSeconds?: number;
      buildId?: string;
      time?: string;
      basePath?: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.status, 'healthy');
    assert.equal(body.service, 'tuanliu-lab');
    assert.equal(typeof body.version, 'string');
    assert.ok(body.version && body.version.length > 0);
    assert.equal(typeof body.uptimeSeconds, 'number');
    assert.ok((body.uptimeSeconds ?? -1) >= 0);
    assert.equal(typeof body.time, 'string');
    assert.ok(body.time && !Number.isNaN(Date.parse(body.time)));
    // No secrets in body
    const keys = Object.keys(body);
    for (const k of keys) {
      assert.equal(/secret|token|password|key/i.test(k), false);
    }
  });

  it('includes buildId when BUILD_ID is set', async () => {
    const prev = process.env.BUILD_ID;
    process.env.BUILD_ID = 'lab-test-build-xyz';
    try {
      const res = await GET();
      assert.equal(res.status, 200);
      const body = (await res.json()) as { buildId?: string };
      assert.equal(body.buildId, 'lab-test-build-xyz');
    } finally {
      if (prev === undefined) delete process.env.BUILD_ID;
      else process.env.BUILD_ID = prev;
    }
  });

  it('reports basePath when TUANLIU_BASE_PATH is set', async () => {
    const prev = process.env.TUANLIU_BASE_PATH;
    process.env.TUANLIU_BASE_PATH = '/app/lab';
    try {
      const res = await GET();
      assert.equal(res.status, 200);
      const body = (await res.json()) as { basePath?: string };
      assert.equal(body.basePath, '/app/lab');
    } finally {
      if (prev === undefined) delete process.env.TUANLIU_BASE_PATH;
      else process.env.TUANLIU_BASE_PATH = prev;
    }
  });
});
