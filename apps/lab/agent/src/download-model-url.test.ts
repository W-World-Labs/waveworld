import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { downloadModelUrl } from './download-model-url.ts';

test('rejects private, special-purpose, mapped and alternate numeric addresses before HTTP', async (t) => {
  t.mock.method(http, 'get', () => { throw new Error('must not open a request'); });
  for (const hostname of [
    '0.0.0.0', '10.1.2.3', '100.100.100.200', '127.0.0.1', '2130706433', '0x7f000001',
    '169.254.169.254', '172.16.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1',
    '[::1]', '[::ffff:127.0.0.1]', '[fc00::1]', '[fe80::1]',
    '[64:ff9b::a00:1]', '[2002:7f00:1::]', '[2001:db8::1]',
  ]) {
    await assert.rejects(downloadModelUrl(`http://${hostname}/model.stl`), /public network address/, hostname);
  }
  for (const url of ['file:///etc/passwd', 'ftp://example.test/model.stl', 'http://user:password@example.test/model.stl']) {
    await assert.rejects(downloadModelUrl(url), /HTTP\(S\) without credentials/);
  }
});

test('rejects private DNS and mixed public/private DNS answers', async (t) => {
  let answers: dns.LookupAddress[] = [{ address: '127.0.0.1', family: 4 }];
  t.mock.method(dns, 'lookup', (_hostname: string, _options: dns.LookupOptions, callback: (error: Error | null, addresses: dns.LookupAddress[]) => void) => {
    process.nextTick(callback, null, answers);
  });
  await assert.rejects(downloadModelUrl('http://private.example.test/model.stl'), /public network address/);
  answers = [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }];
  await assert.rejects(downloadModelUrl('http://mixed.example.test/model.stl'), /public network address/);
});

/** Map the validated public socket address to a local fixture only in tests. */
async function publicServer(t: TestContext, handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  let lookups = 0;
  t.mock.method(dns, 'lookup', (_hostname: string, _options: dns.LookupOptions, callback: (error: Error | null, addresses: dns.LookupAddress[]) => void) => {
    lookups++;
    process.nextTick(callback, null, [{ address: '93.184.216.34', family: 4 }]);
  });
  const realGet = http.get;
  t.mock.method(http, 'get', (url: URL, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    assert.equal(options.agent, false);
    assert.equal(typeof options.lookup, 'function');
    return realGet(url, {
      ...options,
      lookup: (hostname, lookupOptions, complete) => {
        options.lookup!(hostname, lookupOptions, (error, address, family) => {
          if (error) { complete(error, ''); return; }
          // The production lookup must pass exactly the checked public IP.
          if (Array.isArray(address)) {
            assert.deepEqual(address, [{ address: '93.184.216.34', family: 4 }]);
            complete(null, [{ address: '127.0.0.1', family: 4 }]);
          } else {
            assert.equal(address, '93.184.216.34');
            assert.equal(family, 4);
            complete(null, '127.0.0.1', 4);
          }
        });
      },
    }, callback);
  });
  return {
    url: `http://public.example.test:${(server.address() as AddressInfo).port}`,
    lookups: () => lookups,
  };
}

test('public downloads use the checked DNS answer and preserve relative redirects and exact bytes', async (t) => {
  const bytes = Buffer.from([0, 1, 2, 3, 0xff]);
  let requests = 0;
  const fixture = await publicServer(t, (req, res) => {
    requests++;
    assert.match(req.headers.host!, /^public\.example\.test:/);
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/model.stl' });
      res.end();
    } else res.end(bytes);
  });
  assert.deepEqual(Buffer.from(await downloadModelUrl(`${fixture.url}/redirect`)), bytes);
  assert.equal(requests, 2);
  assert.equal(fixture.lookups(), 2, 'one DNS lookup per connection; no unvalidated re-resolution');
});

test('a public redirect cannot reach a private address and redirect loops are bounded', async (t) => {
  let requests = 0;
  const fixture = await publicServer(t, (req, res) => {
    requests++;
    res.writeHead(302, { Location: req.url === '/private' ? 'http://169.254.169.254/latest/meta-data/' : '/loop' });
    res.end();
  });
  await assert.rejects(downloadModelUrl(`${fixture.url}/private`), /public network address/);
  assert.equal(requests, 1);
  await assert.rejects(downloadModelUrl(`${fixture.url}/loop`), /redirect limit/);
  assert.equal(requests, 7, 'at most five redirects for each download');
});

test('oversized headers and streamed bodies are rejected and incomplete bodies can be cancelled', async (t) => {
  const fixture = await publicServer(t, (req, res) => {
    if (req.url === '/large-header') {
      res.writeHead(200, { 'Content-Length': 51 * 1024 * 1024 });
      res.flushHeaders();
    } else if (req.url === '/large-body') {
      const chunk = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < 51; i++) res.write(chunk);
      res.end();
    } else {
      res.writeHead(200);
      res.write('partial');
    }
  });
  await assert.rejects(downloadModelUrl(`${fixture.url}/large-header`), /exceeds 50 MiB/);
  await assert.rejects(downloadModelUrl(`${fixture.url}/large-body`), /exceeds 50 MiB/);
  const cancel = new AbortController();
  const pending = downloadModelUrl(`${fixture.url}/stalled`, cancel.signal);
  const timer = setTimeout(() => cancel.abort(), 50);
  try { await assert.rejects(pending, { name: 'AbortError' }); }
  finally { clearTimeout(timer); }
});
