/**
 * #89 leftover Lab jobs API: assemble + canonical Host pointer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCanonicalHostJobsUrl,
  resolvePublicJobsSuccessor,
} from './assemble-job-spec.ts';

describe('tuanliu leftover jobs API (#89)', () => {
  it('uses a loopback default only outside production and requires a production target', () => {
    assert.equal(
      resolveCanonicalHostJobsUrl({}),
      'http://127.0.0.1:3001/api/v1/jobs',
    );
    assert.throws(
      () => resolveCanonicalHostJobsUrl({ NODE_ENV: 'production' }),
      /WAVEWORLD_HOST_URL or TASK_API_URL is required in production/,
    );
    assert.equal(
      resolveCanonicalHostJobsUrl({ WAVEWORLD_HOST_URL: 'https://example.test/' }),
      'https://example.test/api/v1/jobs',
    );
  });

  it('does not advertise loopback, private, or non-https bases', () => {
    assert.equal(resolvePublicJobsSuccessor({}), '/api/v1/jobs');
    assert.equal(
      resolvePublicJobsSuccessor({ WAVEWORLD_HOST_URL: 'http://127.0.0.1:3001' }),
      '/api/v1/jobs',
    );
    assert.equal(
      resolvePublicJobsSuccessor({ WAVEWORLD_HOST_URL: 'https://[::1]/' }),
      '/api/v1/jobs',
    );
    assert.equal(
      resolvePublicJobsSuccessor({ WAVEWORLD_HOST_URL: 'https://10.1.2.3/' }),
      '/api/v1/jobs',
    );
    assert.equal(
      resolvePublicJobsSuccessor({ WAVEWORLD_HOST_URL: 'https://192.168.1.9/' }),
      '/api/v1/jobs',
    );
    assert.equal(
      resolvePublicJobsSuccessor({ WAVEWORLD_HOST_URL: 'https://user:secret@example.test' }),
      '/api/v1/jobs',
    );
    assert.equal(
      resolvePublicJobsSuccessor({ WAVEWORLD_HOST_URL: 'https://example.test/' }),
      'https://example.test/api/v1/jobs',
    );
  });
});
