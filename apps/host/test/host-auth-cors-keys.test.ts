/**
 * #56 CORS + SameSite, #57 production bypass flags, #58 knowledge write keys.
 * Calls shipped helpers / routes — not a local re-implementation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import {
  corsHeadersForOrigin,
  middleware,
  resolveCorsAllowlist,
} from '../src/middleware.ts';
import {
  allowDevLogin,
  allowDevUserHeader,
  buildSessionCookie,
  resolveUser,
  sessionCookieSameSite,
} from '../src/lib/user-auth.ts';
import {
  requireKnowledgeRegistrationKey,
  requireKnowledgeWriteAuthIfConfigured,
} from '../src/lib/knowledge-write-auth.ts';
import { sameSecret } from '../src/lib/safe-error-message.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');

function pairsOriginWithCredentials(headers: Record<string, string>): boolean {
  return (
    typeof headers['Access-Control-Allow-Origin'] === 'string' &&
    headers['Access-Control-Allow-Origin'].length > 0 &&
    headers['Access-Control-Allow-Credentials'] === 'true'
  );
}

describe('Host CORS allowlist (#56)', () => {
  it('allows authenticated local Lab requests only in development', () => {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
      assert.equal(pairsOriginWithCredentials(corsHeadersForOrigin(origin, { NODE_ENV: 'development' })), true);
      assert.equal(pairsOriginWithCredentials(corsHeadersForOrigin(origin, { NODE_ENV: 'production' })), false);
    }
  });

  it('does not pair an arbitrary Origin with credentials (production empty allowlist)', () => {
    const env = { NODE_ENV: 'production' };
    assert.deepEqual(resolveCorsAllowlist(env), []);
    const headers = corsHeadersForOrigin('https://evil.example', env);
    assert.notEqual(headers['Access-Control-Allow-Origin'], 'https://evil.example');
    assert.equal(headers['Access-Control-Allow-Credentials'], undefined);
    assert.equal(pairsOriginWithCredentials(headers), false);
  });

  it('does not reflect a non-allowlisted Origin in development', () => {
    const headers = corsHeadersForOrigin('https://evil.example', { NODE_ENV: 'development' });
    assert.notEqual(headers['Access-Control-Allow-Origin'], 'https://evil.example');
    assert.equal(pairsOriginWithCredentials(headers), false);
  });

  it('allowlisted Origin receives ACAO + credentials', () => {
    const env = {
      NODE_ENV: 'production',
      WAVEWORLD_CORS_ORIGINS: 'https://waveworld.example, https://atlas.example',
    };
    const headers = corsHeadersForOrigin('https://waveworld.example', env);
    assert.equal(headers['Access-Control-Allow-Origin'], 'https://waveworld.example');
    assert.equal(headers['Access-Control-Allow-Credentials'], 'true');
    const denied = corsHeadersForOrigin('https://evil.example', env);
    assert.equal(pairsOriginWithCredentials(denied), false);
  });

  it('middleware entry rejects reflected-Origin + credentials for a foreign origin', () => {
    const prev = process.env.WAVEWORLD_CORS_ORIGINS;
    const prevNode = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env.WAVEWORLD_CORS_ORIGINS;
    try {
      const req = new NextRequest('http://127.0.0.1:3001/api/v1/me', {
        headers: { origin: 'https://evil.example' },
      });
      const res = middleware(req);
      assert.notEqual(res.headers.get('Access-Control-Allow-Origin'), 'https://evil.example');
      assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null);
    } finally {
      if (prev === undefined) delete process.env.WAVEWORLD_CORS_ORIGINS;
      else process.env.WAVEWORLD_CORS_ORIGINS = prev;
      if (prevNode === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
      else Object.assign(process.env, { NODE_ENV: prevNode });
    }
  });
});

describe('production session SameSite (#56)', () => {
  it('defaults to Lax when Secure is on and no override is set', () => {
    const env = { NODE_ENV: 'production' };
    assert.equal(sessionCookieSameSite(env), 'Lax');
    const cookie = buildSessionCookie('usr_testtoken', 3600, env);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /SameSite=None/);
    assert.match(cookie, /Secure/);
  });

  it('honors explicit W_ID_COOKIE_SAMESITE override', () => {
    const env = { NODE_ENV: 'production', W_ID_COOKIE_SAMESITE: 'None' };
    assert.equal(sessionCookieSameSite(env), 'None');
    assert.match(buildSessionCookie('usr_testtoken', 3600, env), /SameSite=None/);
  });
});

describe('production ignores bypass env flags (#57)', () => {
  const productionBypass = {
    NODE_ENV: 'production',
    TASK_DEV_AUTH: '1',
    TASK_ALLOW_DEV_LOGIN: '1',
  };

  it('allowDevUserHeader is false in production even if TASK_DEV_AUTH=1', () => {
    assert.equal(allowDevUserHeader(productionBypass), false);
    assert.equal(allowDevUserHeader({ NODE_ENV: 'test' }), true);
  });

  it('allowDevLogin is false in production even if TASK_ALLOW_DEV_LOGIN=1', () => {
    assert.equal(allowDevLogin(productionBypass), false);
    assert.equal(allowDevLogin({ NODE_ENV: 'test' }), true);
  });

  it('resolveUser ignores x-user-id when env is production + TASK_DEV_AUTH=1', async () => {
    const req = new Request('http://localhost/api/v1/me', {
      headers: { 'x-user-id': 'attacker', 'x-user-name': 'attacker' },
    });
    const user = await resolveUser(req, productionBypass);
    assert.equal(user, null);
  });

  it('resolveUser still accepts x-user-id outside production', async () => {
    const req = new Request('http://localhost/api/v1/me', {
      headers: { 'x-user-id': 'dev-user', 'x-user-name': 'Dev' },
    });
    const user = await resolveUser(req, { NODE_ENV: 'test' });
    assert.ok(user);
    assert.equal(user!.id, 'dev-user');
    assert.equal(user!.authProvider, 'header');
  });
});

describe('knowledge write-key sameSecret (#58)', () => {
  it('rejects a mismatched key (401) via the shipped helper', () => {
    const prev = {
      AGENT_REGISTRATION_KEY: process.env.AGENT_REGISTRATION_KEY,
      TASK_API_KEY: process.env.TASK_API_KEY,
      KNOWLEDGE_WRITE_KEY: process.env.KNOWLEDGE_WRITE_KEY,
      KNOWLEDGE_WRITE_API_KEY: process.env.KNOWLEDGE_WRITE_API_KEY,
    };
    process.env.AGENT_REGISTRATION_KEY = 'correct-operator-key-xx';
    delete process.env.TASK_API_KEY;
    delete process.env.KNOWLEDGE_WRITE_KEY;
    delete process.env.KNOWLEDGE_WRITE_API_KEY;
    try {
      const res = requireKnowledgeRegistrationKey(
        new Request('http://localhost/api/v1/knowledge/claims/promote', {
          method: 'POST',
          headers: { 'x-api-key': 'wrong-operator-key-yy' },
        }),
        'claims promote requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
      );
      assert.ok(res);
      assert.equal(res!.status, 401);
      assert.equal(sameSecret('wrong-operator-key-yy', 'correct-operator-key-xx'), false);
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('resolve-job configured-key path rejects a mismatch', () => {
    const prev = process.env.TASK_API_KEY;
    const prevKw = process.env.KNOWLEDGE_WRITE_API_KEY;
    process.env.TASK_API_KEY = 'resolve-job-secret-aa';
    delete process.env.KNOWLEDGE_WRITE_API_KEY;
    try {
      const res = requireKnowledgeWriteAuthIfConfigured(
        new Request('http://localhost/api/v1/knowledge/resolve-job', {
          method: 'POST',
          headers: { 'x-api-key': 'resolve-job-secret-bb' },
        }),
      );
      assert.ok(res);
      assert.equal(res!.status, 401);
    } finally {
      if (prev === undefined) delete process.env.TASK_API_KEY;
      else process.env.TASK_API_KEY = prev;
      if (prevKw === undefined) delete process.env.KNOWLEDGE_WRITE_API_KEY;
      else process.env.KNOWLEDGE_WRITE_API_KEY = prevKw;
    }
  });

  it('knowledge write helper source uses sameSecret, not === / !==', () => {
    const src = fs.readFileSync(
      path.join(here, '../src/lib/knowledge-write-auth.ts'),
      'utf8',
    );
    assert.match(src, /sameSecret/);
    assert.doesNotMatch(src, /provided !== expected/);
    assert.doesNotMatch(src, /key === expected/);
  });

  it('knowledge write routes delegate to the shared helper', () => {
    const routes = [
      'src/app/api/v1/knowledge/nodes/route.ts',
      'src/app/api/v1/knowledge/edges/route.ts',
      'src/app/api/v1/knowledge/materials/route.ts',
      'src/app/api/v1/knowledge/claims/route.ts',
      'src/app/api/v1/knowledge/claims/promote/route.ts',
      'src/app/api/v1/knowledge/claims/counts/route.ts',
      'src/app/api/v1/knowledge/claims/[id]/route.ts',
      'src/app/api/v1/knowledge/releases/route.ts',
      'src/app/api/v1/knowledge/conflicts/seed-demo/route.ts',
      'src/app/api/v1/knowledge/conflicts/[id]/resolve/route.ts',
      'src/app/api/v1/knowledge/conflicts/[id]/reopen/route.ts',
      'src/app/api/v1/knowledge/resolve-job/route.ts',
    ];
    for (const rel of routes) {
      const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
      assert.match(
        src,
        /requireKnowledge(RegistrationKey|WriteAuthIfConfigured)/,
        `${rel} must call the shared knowledge write helper`,
      );
      assert.doesNotMatch(src, /provided !== expected/, rel);
      assert.doesNotMatch(src, /key === expected/, rel);
    }
  });
});

describe('CI runs host unit tests (#59)', () => {
  it('CI runs Host tests and deploy consumes the CI-built package', () => {
    const ci = fs.readFileSync(path.join(waveRoot, '.gitea/workflows/ci.yml'), 'utf8');
    const deploy = fs.readFileSync(path.join(waveRoot, '.gitea/workflows/deploy.yml'), 'utf8');
    assert.match(ci, /npm run test:host/);
    assert.doesNotMatch(deploy, /npm run test:host|npm ci|npm install/);
    assert.match(deploy, /gitea-download-artifact/);
  });
});
