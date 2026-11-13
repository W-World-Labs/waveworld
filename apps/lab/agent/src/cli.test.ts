import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MAC_3D_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, LBM_THERMAL_FEATURES } from '@w-sim/contracts';

// Exercise the real CLI entrypoint: --help never builds runtime capabilities.
test('CLI once advertises implemented solver features and exits on an empty queue', { timeout: 20000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'waveworld-cli-once-'));
  const calls: string[] = [];
  const authorization: Array<string | undefined> = [];
  let capabilities: { backends: string[]; features: string[]; kinds: string[] } | undefined;
  const agent = { id: 'cli-smoke-agent', name: 'CLI smoke' };
  const server = createServer(async (request, response) => {
    calls.push(`${request.method} ${request.url}`);
    authorization.push(request.headers.authorization);
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/v1/agents/me' && request.method === 'GET') {
      response.end(JSON.stringify({ agent }));
    } else if (request.url === '/api/v1/agents/me' && request.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      capabilities = JSON.parse(Buffer.concat(chunks).toString()).capabilities;
      response.end(JSON.stringify({ agent: { ...agent, capabilities } }));
    } else if (request.url === '/api/v1/jobs/claim' && request.method === 'POST') {
      response.writeHead(204); response.end();
    } else {
      response.writeHead(404); response.end('{}');
    }
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const { stdout } = await promisify(execFile)(process.execPath, [
      '--import', 'tsx', fileURLToPath(new URL('./cli.ts', import.meta.url)), 'once',
      '--url', `http://127.0.0.1:${address.port}`, '--token', 'cli-smoke-token',
    ], {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)), timeout: 15000, maxBuffer: 1024 * 1024,
      env: { ...process.env, NODE_ENV: 'test', TUANLIU_DATA: directory,
        WAVEWORLD_PATH_PLUGIN_DIR: '', WAVEWORLD_BUILD_ID: 'cli-smoke' },
    });
    assert.deepEqual(calls, ['GET /api/v1/agents/me', 'PUT /api/v1/agents/me', 'POST /api/v1/jobs/claim']);
    assert.deepEqual(authorization, calls.map(() => 'Bearer cli-smoke-token'));
    assert.ok(capabilities?.backends.includes('cpu'));
    for (const feature of [LBM_GAUGE_FORCE_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, ...LBM_THERMAL_FEATURES]) {
      assert.ok(capabilities?.features.includes(feature), `CLI capability missing ${feature}`);
    }
    assert.match(stdout, /no job, exit/);
    assert.ok(capabilities?.features.includes(MAC_3D_FEATURE));
    assert.ok(capabilities?.kinds.includes('mac-3d'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI refuses an implicit Host address in production', { timeout: 20000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'waveworld-cli-no-host-'));
  try {
    await assert.rejects(
      promisify(execFile)(process.execPath, [
        '--import', 'tsx', fileURLToPath(new URL('./cli.ts', import.meta.url)), 'once',
      ], {
        cwd: fileURLToPath(new URL('../../../../', import.meta.url)), timeout: 15000,
        env: { ...process.env, NODE_ENV: 'production', TASK_API_URL: '', TUANLIU_DATA: directory },
      }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.match(error.stderr ?? '', /Set TASK_API_URL or pass --url in production/);
        return true;
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
