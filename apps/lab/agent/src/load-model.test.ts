import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { loadModelGeometry } from './load-model.ts';

test('URL models cannot contact an agent loopback service', async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.end('solid fixture\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid fixture');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  try {
    await assert.rejects(
      loadModelGeometry({ source: 'url', url: `http://127.0.0.1:${port}/internal.stl` }),
      /public network address/,
    );
    assert.equal(requests, 0, 'reject before contacting the internal service');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
