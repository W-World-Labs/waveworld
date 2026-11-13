/**
 * Ontology catalog + list/detail route handlers (pagination, sort, 404, projection).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

before(() => {
  // catalog is pure (no DB); ensure a clean import path for repeated runs
});

describe('ontology-catalog listMethods pagination', () => {
  it('defaults limit=50, offset=0 and returns total', async () => {
    const { listMethods, clearOntologyCache } = await import('../src/lib/ontology-catalog.ts');
    clearOntologyCache();
    const page = await listMethods({});
    assert.equal(page.offset, 0);
    assert.equal(page.limit, 50);
    assert.ok(page.total > 0, 'expected methods in catalog');
    assert.ok(page.items.length <= 50);
    assert.equal(page.items.length, Math.min(50, page.total));
    assert.equal(page.fields, 'full');
  });

  it('clamps invalid limit/offset (NaN, negative, over max)', async () => {
    const { listMethods } = await import('../src/lib/ontology-catalog.ts');
    const badLimit = await listMethods({ limit: Number.NaN, offset: -10 });
    assert.equal(badLimit.limit, 50);
    assert.equal(badLimit.offset, 0);

    const over = await listMethods({ limit: 9999 });
    assert.equal(over.limit, 200);

    const zero = await listMethods({ limit: 0 });
    assert.equal(zero.limit, 1);
  });

  it('stable sort by id across pages (no overlap, monotonic)', async () => {
    const { listMethods } = await import('../src/lib/ontology-catalog.ts');
    const p0 = await listMethods({ limit: 10, offset: 0 });
    const p1 = await listMethods({ limit: 10, offset: 10 });
    const ids0 = p0.items.map((m) => m.id);
    const ids1 = p1.items.map((m) => m.id);
    assert.equal(ids0.length, Math.min(10, p0.total));
    // pages disjoint
    for (const id of ids1) assert.ok(!ids0.includes(id), `overlap ${id}`);
    // sorted
    const all = [...ids0, ...ids1];
    const sorted = [...all].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(all, sorted);
  });

  it('offset beyond total yields empty items but correct total', async () => {
    const { listMethods } = await import('../src/lib/ontology-catalog.ts');
    const first = await listMethods({ limit: 1, offset: 0 });
    const past = await listMethods({ limit: 10, offset: first.total + 5 });
    assert.equal(past.total, first.total);
    assert.equal(past.items.length, 0);
  });

  it('fields=minimal projects id/name/category only', async () => {
    const { listMethods } = await import('../src/lib/ontology-catalog.ts');
    const page = await listMethods({ limit: 5, fields: 'minimal' });
    assert.equal(page.fields, 'minimal');
    assert.ok(page.items.length > 0);
    for (const item of page.items) {
      assert.ok(item.id);
      assert.ok(item.name);
      assert.ok('category' in item || 'kind' in item);
      assert.equal((item as { summary?: string }).summary, undefined);
      assert.equal((item as { role?: string }).role, undefined);
    }
  });

  it('fields=id,name,category is minimal projection', async () => {
    const { listMethods } = await import('../src/lib/ontology-catalog.ts');
    const page = await listMethods({ limit: 3, fields: 'id,name,category' });
    assert.equal(page.fields, 'minimal');
  });

  it('kind filter + q search reduce total', async () => {
    const { listMethods, ontologyMeta } = await import('../src/lib/ontology-catalog.ts');
    const meta = await ontologyMeta();
    const kind = Object.keys(meta.kinds)[0];
    assert.ok(kind);
    const byKind = await listMethods({ kind, limit: 200 });
    assert.equal(byKind.total, meta.kinds[kind]);
    assert.ok(byKind.items.every((m) => m.kind === kind || (m as { category?: string }).category === kind));

    const q = await listMethods({ q: 'zzzzzz-no-match-waveworld', limit: 10 });
    assert.equal(q.total, 0);
  });
});

describe('ontology-catalog getMethod', () => {
  it('returns summary for existing id and null for missing', async () => {
    const { listMethods, getMethod } = await import('../src/lib/ontology-catalog.ts');
    const page = await listMethods({ limit: 1 });
    const id = page.items[0].id;
    const hit = await getMethod(id);
    assert.ok(hit);
    assert.equal(hit!.id, id);
    assert.ok(hit!.summary);

    const miss = await getMethod('method-does-not-exist-xyz');
    assert.equal(miss, null);

    const empty = await getMethod('  ');
    assert.equal(empty, null);
  });
});

describe('GET ontology routes (shipped handlers)', () => {
  it('GET /api/v1/ontology/methods paginates via query string', async () => {
    const { GET } = await import('../src/app/api/v1/ontology/methods/route.ts');
    const res = await GET(
      new Request('http://localhost:3001/api/v1/ontology/methods?limit=7&offset=0&fields=minimal')
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      total: number;
      limit: number;
      offset: number;
      fields: string;
      items: Array<{ id: string; category?: string }>;
    };
    assert.equal(body.limit, 7);
    assert.equal(body.offset, 0);
    assert.equal(body.fields, 'minimal');
    assert.ok(body.items.length <= 7);
    assert.ok(body.total >= body.items.length);
  });

  it('GET /api/v1/ontology/methods/[id] returns 404 for missing', async () => {
    const { GET } = await import('../src/app/api/v1/ontology/methods/[id]/route.ts');
    const res = await GET(new Request('http://localhost:3001/api/v1/ontology/methods/nope'), {
      params: Promise.resolve({ id: 'nope-method-id-404' }),
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string; id: string };
    assert.match(body.error, /not found/i);
    assert.equal(body.id, 'nope-method-id-404');
  });

  it('GET /api/v1/ontology/methods/[id] returns method for known id', async () => {
    const { listMethods } = await import('../src/lib/ontology-catalog.ts');
    const { GET } = await import('../src/app/api/v1/ontology/methods/[id]/route.ts');
    const page = await listMethods({ limit: 1 });
    const id = page.items[0].id;
    const res = await GET(new Request(`http://localhost:3001/api/v1/ontology/methods/${id}`), {
      params: Promise.resolve({ id }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { method: { id: string } };
    assert.equal(body.method.id, id);
  });

  it('GET /api/v1/ontology/meta includes defaults and methodCount', async () => {
    const { GET } = await import('../src/app/api/v1/ontology/meta/route.ts');
    const res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      methodCount: number;
      defaults: { limit: number; sort: string };
      cache: { loaded: boolean };
    };
    assert.equal(body.ok, true);
    assert.ok(body.methodCount > 0);
    assert.equal(body.defaults.limit, 50);
    assert.equal(body.defaults.sort, 'id');
    assert.equal(body.cache.loaded, true);
  });
});

describe('GET /api/v1/goals (loop harness meta)', () => {
  it('exposes loop docs inventory without full markdown body', async () => {
    const { GET } = await import('../src/app/api/v1/goals/route.ts');
    const res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: true;
      loops: Array<{ id: string; path: string; exists: boolean }>;
      explorationGoals: { path: string; exists: boolean; goals: Array<{ id: string }> };
      snapshot: { targets: Array<{ id: string }> };
    };
    assert.equal(body.ok, true);
    assert.ok(body.loops.length >= 2);
    assert.ok(body.loops.every((l) => l.path.startsWith('docs/loops/')));
    assert.ok(body.loops.some((l) => l.exists));
    assert.equal(body.explorationGoals.path, 'docs/exploration-goals.md');
    // meta only — no giant body field
    assert.equal((body as { body?: string }).body, undefined);
  });
});
