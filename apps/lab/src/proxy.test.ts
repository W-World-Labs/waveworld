/**
 * Lab API responses must leave the process with an explicit no-store.
 * Document routes already set it; /api/* did not, and the public edge
 * then served health and job reads with no Cache-Control.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from './proxy.ts';

describe('lab proxy cache', () => {
  it('sets private no-store on /api/* and keeps the CSP', () => {
    const res = proxy(new NextRequest('http://lab.local/api/health'));
    assert.match(res.headers.get('cache-control') ?? '', /no-store/);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.equal(csp.includes('wasm-unsafe-eval'), false);
  });
});
