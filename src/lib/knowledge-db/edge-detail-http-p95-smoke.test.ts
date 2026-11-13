/**
 * K14: automated Host edge-detail HTTP p95 smoke harness tests.
 * Mock-fetch unit tests always run (knowledge-db gate).
 * Live Host probe runs when KNOWLEDGE_HTTP_P95_LIVE=1 (or CLI script).
 */
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  EDGE_DETAIL_HTTP_P95_BUDGET_MS,
  formatEdgeDetailHttpP95Report,
  KNOWLEDGE_HTTP_P95_CACHEBUSTER_PARAM,
  measureEdgeDetailHttpP95,
  resolveHttpP95BudgetMs,
  resolveKnowledgeHttpP95Base,
  DEFAULT_KNOWLEDGE_HTTP_P95_BASE,
} from './edge-detail-http-p95-smoke.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const VALID_CACHEBUSTER = 'a'.repeat(64)

function validEdgeItem(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    fromNodeId: 'from-node',
    toNodeId: 'to-node',
    name: 'edge name',
    nameEn: 'edge name',
    principle: 'principle',
    principleEn: 'principle',
    efficiencyKind: 'conversion',
    efficiency: { value: 0.5, unit: '1' },
    formula: null,
    lossMechanisms: [],
    maturity: null,
    apps: null,
    consensus: { status: 'established' },
    refs: [],
    status: 'active',
    devices: [],
    products: [],
    releasedClaims: [],
    ...overrides,
  }
}

function twentyEdgeIds(prefix = 'edge'): string[] {
  return Array.from({ length: 20 }, (_, i) => `${prefix}-${i}`)
}

type CliResult = {
  code: number | null
  stdout: string
  stderr: string
}

function runK14Cli(args: string[]): Promise<CliResult> {
  const cliPath = path.resolve(
    process.cwd(),
    'scripts/knowledge/edge-detail-http-p95-smoke.ts',
  )
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function listenLocalHttp(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: ReturnType<typeof createServer>; baseUrl: string }> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('local K14 test server did not expose an address')
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

async function closeLocalHttp(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

describe('edge-detail-http-p95-smoke helpers', () => {
  it('resolveKnowledgeHttpP95Base prefers explicit then env then loopback', () => {
    expect(resolveKnowledgeHttpP95Base('https://example.test/')).toBe(
      'https://example.test',
    )
    expect(resolveKnowledgeHttpP95Base(undefined)).toBe(
      DEFAULT_KNOWLEDGE_HTTP_P95_BASE,
    )
  })

  it('resolveHttpP95BudgetMs defaults to documented budget', () => {
    expect(resolveHttpP95BudgetMs()).toBe(EDGE_DETAIL_HTTP_P95_BUDGET_MS)
    expect(resolveHttpP95BudgetMs(150)).toBe(150)
  })
})

describe('K14 edge-detail HTTP p95 measure (mock fetch)', () => {
  it('keeps one list, five warmups, forty timed samples, and serial 20-id/embed=true cycling', async () => {
    const edgeIds = Array.from({ length: 20 }, (_, i) => `edge-${i}`)
    const requests: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight--
      if (new URL(url).pathname.endsWith('/edges')) {
        return jsonResponse(200, {
          items: edgeIds.map((id) => ({ id })),
          total: edgeIds.length,
        })
      }
      const id = decodeURIComponent(new URL(url).pathname.split('/').pop()!)
      return jsonResponse(200, {
        item: validEdgeItem(id),
      })
    }

    const report = await measureEdgeDetailHttpP95({
      baseUrl: 'http://mock-host.test',
      fetchImpl,
      sampleEdgeCount: 20,
      budgetMs: EDGE_DETAIL_HTTP_P95_BUDGET_MS,
      cachebuster: VALID_CACHEBUSTER,
    })

    expect(requests).toHaveLength(1 + 5 + 40)
    expect(new URL(requests[0]!).searchParams.get('limit')).toBe('20')
    expect(new URL(requests[0]!).searchParams.get('status')).toBe('active')
    expect(maxInFlight).toBe(1)
    expect(report.iterations).toBe(40)
    expect(report.warmup).toBe(5)
    expect(report.edgeIds).toEqual(edgeIds)
    expect(report.samplesMs).toHaveLength(40)
    expect(report.embedReleasedClaims).toBe(true)
    expect(report.embed).toBe(true)
    expect(report.sampleCount).toBe(40)
    expect(report.edgeCount).toBe(20)
    expect(report.cachebuster).toBe(VALID_CACHEBUSTER)
    expect(report.edgeIdSummary).toEqual({
      count: 20,
      first: edgeIds[0],
      last: edgeIds[19],
    })

    const detailRequests = requests.slice(1).map((url) => new URL(url))
    expect(
      detailRequests.map((url) =>
        decodeURIComponent(url.pathname.split('/').pop()!),
      ),
    ).toEqual([
      ...edgeIds.slice(0, 5),
      ...Array.from({ length: 40 }, (_, i) => edgeIds[i % edgeIds.length]),
    ])
    expect(detailRequests.every((url) => url.searchParams.get('embed') === 'true')).toBe(
      true,
    )
    expect(
      detailRequests.every(
        (url) =>
          url.searchParams.get(KNOWLEDGE_HTTP_P95_CACHEBUSTER_PARAM) ===
          VALID_CACHEBUSTER,
      ),
    ).toBe(true)
  })

  it('includes delayed response-body read and JSON/item validation in timed samples', async () => {
    const bodyDelayMs = 35
    let bodyReadComplete = false
    const edgeIds = twentyEdgeIds('delayed-edge')
    const fetchImpl: typeof fetch = async (input) => {
      const id = decodeURIComponent(
        new URL(String(input)).pathname.split('/').pop()!,
      )
      return {
        status: 200,
        text: async () => {
          await new Promise((resolve) => setTimeout(resolve, bodyDelayMs))
          bodyReadComplete = true
          return JSON.stringify({ item: validEdgeItem(id) })
        },
      } as Response
    }

    const report = await measureEdgeDetailHttpP95({
      baseUrl: 'http://mock-host.test',
      fetchImpl,
      edgeIds,
      iterations: 1,
      warmup: 0,
      timeoutMs: 1_000,
      cachebuster: VALID_CACHEBUSTER,
    })

    expect(bodyReadComplete).toBe(true)
    expect(report.samplesMs[0]).toBeGreaterThanOrEqual(bodyDelayMs - 2)
  })

  it('adds the explicit release cachebuster to list and detail URLs', async () => {
    const cachebuster = VALID_CACHEBUSTER
    const edgeIds = twentyEdgeIds('cache-edge')
    const requests: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (new URL(url).pathname.endsWith('/edges')) {
        return jsonResponse(200, {
          items: edgeIds.map((id) => ({ id })),
          total: edgeIds.length,
        })
      }
      const id = decodeURIComponent(new URL(url).pathname.split('/').pop()!)
      return jsonResponse(200, { item: validEdgeItem(id) })
    }

    await measureEdgeDetailHttpP95({
      baseUrl: 'http://mock-host.test',
      fetchImpl,
      iterations: 1,
      warmup: 0,
      sampleEdgeCount: 20,
      cachebuster,
    })

    expect(requests).toHaveLength(2)
    expect(
      requests.every(
        (url) => new URL(url).searchParams.get(KNOWLEDGE_HTTP_P95_CACHEBUSTER_PARAM) === cachebuster,
      ),
    ).toBe(true)
  })

  it('fails closed for an invalid cachebuster before making a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      measureEdgeDetailHttpP95({
        baseUrl: 'http://mock-host.test',
        fetchImpl,
        edgeIds: twentyEdgeIds('invalid-cache'),
        iterations: 1,
        warmup: 0,
        cachebuster: 'A'.repeat(64),
      }),
    ).rejects.toThrow(
      /cachebuster is required and must be exactly 64 lowercase hexadecimal characters/,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed when cachebuster is missing before making a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      measureEdgeDetailHttpP95({
        baseUrl: 'http://mock-host.test',
        fetchImpl,
        edgeIds: twentyEdgeIds('missing-cache'),
        iterations: 1,
        warmup: 0,
      }),
    ).rejects.toThrow(/cachebuster is required/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires explicit edge ids to be exactly 20 unique safe ids', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      measureEdgeDetailHttpP95({
        baseUrl: 'http://mock-host.test',
        fetchImpl,
        edgeIds: ['edge-1', 'edge-2'],
        iterations: 1,
        warmup: 0,
        cachebuster: VALID_CACHEBUSTER,
      }),
    ).rejects.toThrow(/explicit edge ids must contain exactly 20 ids/)

    await expect(
      measureEdgeDetailHttpP95({
        baseUrl: 'http://mock-host.test',
        fetchImpl,
        edgeIds: Array.from({ length: 20 }, () => 'duplicate-edge'),
        iterations: 1,
        warmup: 0,
        cachebuster: VALID_CACHEBUSTER,
      }),
    ).rejects.toThrow(/explicit edge ids must be unique/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not source a cachebuster from the environment', async () => {
    const cachebuster = VALID_CACHEBUSTER
    const envCachebuster = 'b'.repeat(64)
    const envNames = [
      'K14_CACHEBUSTER',
      'EDGE_DETAIL_HTTP_P95_CACHEBUSTER',
      'WAVEWORLD_CACHEBUSTER',
      'WAVEWORLD_K14_CACHEBUSTER',
    ]
    const previous = new Map(
      envNames.map((name) => [name, process.env[name]] as const),
    )
    for (const name of envNames) process.env[name] = envCachebuster

    const requests: string[] = []
    const edgeIds = twentyEdgeIds('env-edge')
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (new URL(url).pathname.endsWith('/edges')) {
        return jsonResponse(200, {
          items: edgeIds.map((id) => ({ id })),
          total: edgeIds.length,
        })
      }
      const id = decodeURIComponent(new URL(url).pathname.split('/').pop()!)
      return jsonResponse(200, { item: validEdgeItem(id) })
    }

    try {
      await measureEdgeDetailHttpP95({
        baseUrl: 'http://mock-host.test',
        fetchImpl,
        iterations: 1,
        warmup: 0,
        cachebuster,
      })
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }

    expect(
      requests.every(
        (url) =>
          new URL(url).searchParams.get(KNOWLEDGE_HTTP_P95_CACHEBUSTER_PARAM) ===
          cachebuster,
      ),
    ).toBe(true)
  })

  it('fails when nearest-rank p95 is exactly the 200ms budget', async () => {
    const edgeIds = twentyEdgeIds('boundary-edge')
    let now = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
      const current = now
      now += EDGE_DETAIL_HTTP_P95_BUDGET_MS
      return current
    })
    const fetchImpl: typeof fetch = async (input) => {
      const id = decodeURIComponent(
        new URL(String(input)).pathname.split('/').pop()!,
      )
      return jsonResponse(200, { item: validEdgeItem(id) })
    }

    try {
      const report = await measureEdgeDetailHttpP95({
        baseUrl: 'http://mock-host.test',
        fetchImpl,
        edgeIds,
        iterations: 1,
        warmup: 0,
        budgetMs: EDGE_DETAIL_HTTP_P95_BUDGET_MS,
        cachebuster: VALID_CACHEBUSTER,
      })

      expect(report.samplesMs).toEqual([EDGE_DETAIL_HTTP_P95_BUDGET_MS])
      expect(report.p95Ms).toBe(EDGE_DETAIL_HTTP_P95_BUDGET_MS)
      expect(report.pass).toBe(false)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('reports p50/p95/max and pass when under budget', async () => {
    const edgeIds = twentyEdgeIds('report-edge')
    let listHits = 0
    let detailHits = 0
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/api/v1/knowledge/edges?')) {
        listHits++
        return jsonResponse(200, {
          source: 'db',
          items: edgeIds.map((id) => ({ id })),
          total: edgeIds.length,
        })
      }
      if (url.includes('/api/v1/knowledge/edges/')) {
        detailHits++
        // tiny artificial delay so samples are non-zero but << budget
        await new Promise((r) => setTimeout(r, 1))
        const id = decodeURIComponent(url.split('/edges/')[1]!.split('?')[0]!)
        return jsonResponse(200, {
          source: 'db',
          item: validEdgeItem(id),
        })
      }
      return jsonResponse(404, { error: 'not found' })
    }

    const report = await measureEdgeDetailHttpP95({
      baseUrl: 'http://mock-host.test',
      fetchImpl,
      iterations: 20,
      warmup: 2,
      sampleEdgeCount: 20,
      budgetMs: EDGE_DETAIL_HTTP_P95_BUDGET_MS,
      embedReleasedClaims: true,
      cachebuster: VALID_CACHEBUSTER,
    })

    // eslint-disable-next-line no-console
    console.log(formatEdgeDetailHttpP95Report(report))

    expect(listHits).toBe(1)
    expect(detailHits).toBe(20 + 2)
    expect(report.edgeIds).toEqual(edgeIds)
    expect(report.iterations).toBe(20)
    expect(report.sampleCount).toBe(20)
    expect(report.edgeCount).toBe(20)
    expect(report.samplesMs).toHaveLength(20)
    expect(report.p50Ms).toBeGreaterThan(0)
    expect(report.p95Ms).toBeGreaterThanOrEqual(report.p50Ms)
    expect(report.maxMs).toBeGreaterThanOrEqual(report.p95Ms)
    expect(report.pass).toBe(true)
    expect(report.p95Ms).toBeLessThan(EDGE_DETAIL_HTTP_P95_BUDGET_MS)
    expect(report.lastStatus).toBe(200)
    expect(formatEdgeDetailHttpP95Report(report)).toContain('pass=true')
  })

  it('sets pass=false when p95 exceeds budget (still returns measured)', async () => {
    const edgeIds = twentyEdgeIds('slow-edge')
    const fetchImpl: typeof fetch = async (input) => {
      await new Promise((r) => setTimeout(r, 25))
      const id = decodeURIComponent(
        new URL(String(input)).pathname.split('/').pop()!,
      )
      return jsonResponse(200, {
        item: validEdgeItem(id),
      })
    }

    const report = await measureEdgeDetailHttpP95({
      baseUrl: 'http://mock-host.test',
      fetchImpl,
      iterations: 8,
      warmup: 1,
      edgeIds,
      budgetMs: 5, // intentionally tight
      cachebuster: VALID_CACHEBUSTER,
    })

    expect(report.pass).toBe(false)
    expect(report.p95Ms).toBeGreaterThanOrEqual(5)
    expect(formatEdgeDetailHttpP95Report(report)).toContain('pass=false')
  })

  it('throws with measured context when Host returns non-200', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/api/v1/knowledge/edges?')) {
        return jsonResponse(200, { items: [{ id: 'x' }], total: 1 })
      }
      return jsonResponse(500, {
        error: 'better-sqlite3 not available',
      })
    }

    await expect(
      measureEdgeDetailHttpP95({
        baseUrl: 'http://mock-host.test',
        fetchImpl,
        edgeIds: twentyEdgeIds('non-200'),
        iterations: 1,
        warmup: 0,
        cachebuster: VALID_CACHEBUSTER,
      }),
    ).rejects.toThrow(/edge HTTP 500/)
  })
})

describe('K14 edge-detail HTTP p95 CLI integration', () => {
  it('runs the real CLI against a local Host-shaped server and emits auditable JSON', async () => {
    const edgeIds = twentyEdgeIds('cli-edge')
    const requests: URL[] = []
    const { server, baseUrl } = await listenLocalHttp((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      requests.push(url)
      res.setHeader('Content-Type', 'application/json')

      if (url.pathname === '/api/v1/knowledge/edges') {
        res.statusCode = 200
        res.end(
          JSON.stringify({
            items: edgeIds.map((id) => ({ id })),
            total: edgeIds.length,
          }),
        )
        return
      }

      const detailPrefix = '/api/v1/knowledge/edges/'
      if (url.pathname.startsWith(detailPrefix)) {
        const id = decodeURIComponent(url.pathname.slice(detailPrefix.length))
        res.statusCode = edgeIds.includes(id) ? 200 : 404
        res.end(
          JSON.stringify(
            res.statusCode === 200
              ? { item: validEdgeItem(id) }
              : { error: 'unknown edge' },
          ),
        )
        return
      }

      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
    })

    try {
      const result = await runK14Cli([
        '--base',
        baseUrl,
        '--iterations',
        '40',
        '--warmup',
        '5',
        '--sample-edges',
        '20',
        '--embed',
        'true',
        '--cachebuster',
        VALID_CACHEBUSTER,
      ])

      expect(result.code).toBe(0)
      const jsonStart = result.stdout.lastIndexOf('\n{')
      expect(jsonStart).toBeGreaterThanOrEqual(0)
      const report = JSON.parse(result.stdout.slice(jsonStart + 1)) as Record<
        string,
        unknown
      >
      expect(report).toMatchObject({
        pass: true,
        budgetMs: 200,
        iterations: 40,
        warmup: 5,
        sampleCount: 40,
        edgeCount: 20,
        edgeIds,
        edgeIdSummary: {
          count: 20,
          first: edgeIds[0],
          last: edgeIds[19],
        },
        embed: true,
        embedReleasedClaims: true,
        cachebuster: VALID_CACHEBUSTER,
        baseUrl,
        lastStatus: 200,
      })
      expect(report.samplesMs).toEqual(
        expect.arrayContaining([expect.any(Number)]),
      )
      expect(report.samplesMs).toHaveLength(40)
      expect(report.p95Ms).toEqual(expect.any(Number))

      expect(requests).toHaveLength(1 + 5 + 40)
      expect(requests[0]!.searchParams.get('limit')).toBe('20')
      expect(requests[0]!.searchParams.get('status')).toBe('active')
      expect(
        requests.every(
          (url) =>
            url.searchParams.get(KNOWLEDGE_HTTP_P95_CACHEBUSTER_PARAM) ===
            VALID_CACHEBUSTER,
        ),
      ).toBe(true)
      expect(
        requests.slice(1).every(
          (url) => url.searchParams.get('embed') === 'true',
        ),
      ).toBe(true)
      expect(
        requests.slice(1).map((url) =>
          decodeURIComponent(url.pathname.split('/').pop()!),
        ),
      ).toEqual([
        ...edgeIds.slice(0, 5),
        ...Array.from({ length: 40 }, (_, i) => edgeIds[i % edgeIds.length]),
      ])
    } finally {
      await closeLocalHttp(server)
    }
  })

  it('fails the real CLI for malformed detail items without a final report', async () => {
    const edgeIds = twentyEdgeIds('cli-invalid-edge')
    let detailMode: 'empty' | 'wrong-id' = 'empty'
    const { server, baseUrl } = await listenLocalHttp((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      res.setHeader('Content-Type', 'application/json')

      if (url.pathname === '/api/v1/knowledge/edges') {
        res.statusCode = 200
        res.end(
          JSON.stringify({
            items: edgeIds.map((id) => ({ id })),
            total: edgeIds.length,
          }),
        )
        return
      }

      const detailPrefix = '/api/v1/knowledge/edges/'
      if (url.pathname.startsWith(detailPrefix)) {
        const id = decodeURIComponent(url.pathname.slice(detailPrefix.length))
        const item =
          detailMode === 'empty' ? {} : validEdgeItem(`${id}-wrong`)
        res.statusCode = 200
        res.end(JSON.stringify({ item }))
        return
      }

      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
    })

    const cliArgs = [
      '--base',
      baseUrl,
      '--iterations',
      '1',
      '--warmup',
      '0',
      '--sample-edges',
      '20',
      '--embed',
      'true',
      '--cachebuster',
      VALID_CACHEBUSTER,
    ]

    try {
      for (const mode of ['empty', 'wrong-id'] as const) {
        detailMode = mode
        const result = await runK14Cli(cliArgs)

        expect(result.code).not.toBe(0)
        expect(result.stderr).toMatch(
          /edge item shape\/id\/embed invalid/,
        )
        expect(result.stdout).not.toContain('"samplesMs"')
        expect(result.stdout).not.toMatch(/\n\{\n/)
      }
    } finally {
      await closeLocalHttp(server)
    }
  })
})

const runLive =
  process.env.KNOWLEDGE_HTTP_P95_LIVE === '1' ||
  process.env.KNOWLEDGE_HTTP_P95_LIVE === 'true'

describe.runIf(runLive)('K14 live Host edge-detail HTTP p95 budget', () => {
  it(
    `GET /api/v1/knowledge/edges/:id p95 < ${EDGE_DETAIL_HTTP_P95_BUDGET_MS}ms`,
    async () => {
      const report = await measureEdgeDetailHttpP95({
        iterations: 40,
        warmup: 5,
        sampleEdgeCount: 20,
        embedReleasedClaims: true,
        cachebuster: VALID_CACHEBUSTER,
      })
      // eslint-disable-next-line no-console
      console.log(formatEdgeDetailHttpP95Report(report))
      expect(
        report.pass,
        `edge-detail HTTP p95 budget missed: ${formatEdgeDetailHttpP95Report(report)}`,
      ).toBe(true)
      expect(report.p95Ms).toBeLessThan(EDGE_DETAIL_HTTP_P95_BUDGET_MS)
    },
    120_000,
  )
})
