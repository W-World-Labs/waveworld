/**
 * openapi-routes.test.ts — the published simulation contract
 * (openapi-simulation.yaml) must not drift from the implemented route
 * tree: every declared path+method has to resolve to a real
 * src/app/api route.ts exporting that method. A spec entry with no
 * implementation is a broken promise to consumers; a renamed route that
 * forgets the spec is the same break in the other direction (declared
 * surface only — internal routes may exist undocumented).
 *
 * The paths block is flat YAML (path keys at indent 2, method keys at
 * indent 4) so it parses without a yaml dependency.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HOST_ROOT = path.resolve(import.meta.dirname, '..');
const SPEC = path.join(HOST_ROOT, 'openapi-simulation.yaml');
const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

function declaredOperations(): Array<{ specPath: string; method: string }> {
  const lines = readFileSync(SPEC, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^paths:/.test(l));
  assert.notEqual(start, -1, 'spec has no paths block');
  const ops: Array<{ specPath: string; method: string }> = [];
  let current = '';
  for (const line of lines.slice(start + 1)) {
    if (/^[^\s/]/.test(line)) break; // next top-level section ends paths:
    const p = line.match(/^  (\/\S+):\s*$/);
    if (p) { current = p[1]; continue; }
    const m = line.match(/^    ([a-z]+):\s*$/);
    if (m && METHODS.has(m[1])) ops.push({ specPath: current, method: m[1] });
  }
  assert.ok(ops.length >= 8, `expected the contract surface (>=8 ops), parsed ${ops.length}`);
  return ops;
}

function routeFile(specPath: string): string {
  const rel = specPath.replace('/api/', 'api/').replace(/\{([^}]+)\}/g, '[$1]');
  return path.join(HOST_ROOT, 'src/app', rel, 'route.ts');
}

test('every declared contract operation has an implemented route', () => {
  const missing: string[] = [];
  for (const op of declaredOperations()) {
    if (op.specPath === '/.well-known/ai4s-module.json') {
      const file = path.resolve(HOST_ROOT, '../../public/.well-known/ai4s-module.json');
      if (!existsSync(file)) {
        missing.push(`GET ${op.specPath} → no public descriptor (${file})`);
        continue;
      }
      const descriptor = JSON.parse(readFileSync(file, 'utf8')) as {
        schemaVersion?: string; moduleId?: string; version?: string;
        capabilities?: Array<Record<string, unknown>>;
      };
      if (descriptor.schemaVersion !== 'ai4s-module/1' || descriptor.moduleId !== 'waveworld' ||
          descriptor.version !== '2.0.0' ||
          !descriptor.capabilities?.some(capability =>
            capability.id === 'simulation.jobs' && capability.contract === 'waveworld-jobs/1' &&
            capability.transport === 'http' && capability.path === '/api/v1/jobs' &&
            capability.mode === 'numerical' && capability.authentication === 'provider-session') ||
          !descriptor.capabilities?.some(capability =>
            capability.id === 'simulation.workspace' && capability.contract === 'waveworld-workspace/1' &&
            capability.transport === 'link' && capability.path === '/app/lab/lab' &&
            capability.authentication === 'provider-session')) {
        missing.push(`GET ${op.specPath} → descriptor does not advertise the documented provider capability`);
      }
      continue;
    }
    const file = routeFile(op.specPath);
    if (!existsSync(file)) {
      missing.push(`${op.method.toUpperCase()} ${op.specPath} → no route.ts (${file})`);
      continue;
    }
    const src = readFileSync(file, 'utf8');
    const exported = new RegExp(`export\\s+(async\\s+)?function\\s+${op.method.toUpperCase()}\\b`).test(src);
    if (!exported) missing.push(`${op.method.toUpperCase()} ${op.specPath} → route.ts does not export ${op.method.toUpperCase()}`);
  }
  assert.deepEqual(missing, [], `contract drift:\n${missing.join('\n')}`);
});

test('contract version is semver and paths stay under /api/', () => {
  const spec = readFileSync(SPEC, 'utf8');
  assert.match(spec, /version:\s*\d+\.\d+\.\d+/, 'info.version must be semver');
  for (const op of declaredOperations()) {
    assert.ok(op.specPath.startsWith('/api/') || op.specPath === '/.well-known/ai4s-module.json', `${op.specPath} escapes the API surface`);
  }
});
