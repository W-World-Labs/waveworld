import { describe, expect, it, vi } from 'vitest'
import {
  hostApiBase,
  labUiBase,
  isLabUiConfigured,
  isHostAuthError,
  oidcStartHref,
  setStoredUserToken,
  submitDemoJob,
  getStoredUserToken,
  fetchOntologyMethods,
  fetchOntologyMethodsWithFallback,
  fetchOntologyMetaWithFallback,
  importHostEvidence,
  fetchHostEvidence,
  fetchPathModelCatalog,
  createPathComparison,
  createResearchPublication,
  fetchAuthConfig,
  fetchKnowledgeConflicts,
  fetchHostJob,
  fetchHostJobResult,
  submitPathExperiment,
  submitSpatialIgbtJob,
  createJobShare,
  type HostPathExperimentSpec,
} from './hostApi'
import { buildIgbtSpatialJobSpec, createDefaultIgbtSpatialParameters } from './sim/igbt-spatial-job'

describe('hostApi config', () => {
  it('keeps Host API same-origin and SSR Lab UI on /app/lab', () => {
    expect(hostApiBase()).toBe('')
    expect(labUiBase()).toBe('/app/lab')
    expect(hostApiBase().endsWith('/')).toBe(false)
    expect(labUiBase().endsWith('/')).toBe(false)
  })

  it('isLabUiConfigured is true for local default lab UI', () => {
    // vitest/jsdom is local; loopback lab base is allowed
    expect(isLabUiConfigured()).toBe(true)
  })
})

describe('hostApi auth helpers', () => {
  it('isHostAuthError matches jobs HTTP 401 and not host-down', () => {
    expect(isHostAuthError(new Error('jobs HTTP 401'))).toBe(true)
    expect(isHostAuthError(new Error('health HTTP 503'))).toBe(false)
    expect(isHostAuthError('submit HTTP 401: {"error":"user authentication required"}')).toBe(true)
  })

  it('oidcStartHref points at Host start with returnTo', () => {
    expect(oidcStartHref('/batch-jobs', '')).toBe(
      '/api/v1/auth/oidc/start?returnTo=%2Fbatch-jobs',
    )
    expect(oidcStartHref('/my-projects', 'http://127.0.0.1:3001')).toContain(
      'returnTo=%2Fmy-projects',
    )
  })
})

describe('hostApi submitDemoJob body (shipped helper)', () => {
  it('builds a JobSpecV1-compatible payload against a mock fetch', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      return new Response(
        JSON.stringify({
          job: {
            id: 'test-job',
            name: 'waveworld-nav-demo',
            status: 'queued',
            progress: null,
            result: null,
            error: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    try {
      const job = await submitDemoJob('http://example.test:3001')
      expect(job.id).toBe('test-job')
      expect(job.status).toBe('queued')
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('http://example.test:3001/api/v1/jobs')
      expect(calls[0].init?.method).toBe('POST')
      const body = JSON.parse(String(calls[0].init?.body)) as {
        spec: { schemaVersion: number; kind: string; run: { maxSteps: number } }
      }
      expect(body.spec.schemaVersion).toBe(1)
      expect(body.spec.kind).toBe('lbm-d3q19')
      expect(body.spec.run.maxSteps).toBeGreaterThan(0)
    } finally {
      globalThis.fetch = orig
    }
  })

  it('submitDemoJob sends Authorization when token provided', async () => {
    const calls: { init?: RequestInit }[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init })
      return new Response(
        JSON.stringify({
          job: {
            id: 'j2',
            name: 'waveworld-nav-demo',
            status: 'queued',
            progress: null,
            result: null,
            error: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        { status: 201 },
      )
    }) as typeof fetch
    try {
      await submitDemoJob('http://example.test:3001', {
        token: 'usr_test_token',
        projectId: 'proj-1',
      })
      const headers = calls[0].init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer usr_test_token')
    } finally {
      globalThis.fetch = orig
    }
  })
})

describe('hostApi spatial IGBT submission', () => {
  it('posts the native spatial spec with session credentials and caller cancellation', async () => {
    const orig = globalThis.fetch
    let call: { url: string; init?: RequestInit } | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      call = { url: String(input), init }
      return new Response(JSON.stringify({ job: { id: 'igbt-job-1', status: 'queued', kind: 'electro-thermal-igbt', futureHostField: true } }), { status: 201 })
    }) as typeof fetch
    const controller = new AbortController()
    const built = buildIgbtSpatialJobSpec(createDefaultIgbtSpatialParameters())
    if (!built.ok) throw new Error(built.errors.join('\n'))
    const spec = built.spec
    try {
      const job = await submitSpatialIgbtJob(spec, controller.signal)
      expect(job.id).toBe('igbt-job-1')
      expect(call?.url).toBe(`${hostApiBase()}/api/v1/jobs`)
      expect(call?.init?.method).toBe('POST')
      expect(call?.init?.credentials).toBe('include')
      expect(call?.init?.signal?.aborted).toBe(false)
      expect(JSON.parse(String(call?.init?.body))).toEqual({ spec })
    } finally { globalThis.fetch = orig }
  })

  it.each([
    ['missing status', { id: 'job-1', kind: 'electro-thermal-igbt' }],
    ['unknown status', { id: 'job-1', status: 'done', kind: 'electro-thermal-igbt' }],
    ['foreign kind', { id: 'job-1', status: 'queued', kind: 'thermal-3d-steady' }],
    ['blank identifier', { id: '  ', status: 'queued', kind: 'electro-thermal-igbt' }],
    ['oversized identifier', { id: 'x'.repeat(129), status: 'queued', kind: 'electro-thermal-igbt' }],
  ])('rejects malformed Host acknowledgment: %s', async (_name, job) => {
    const orig = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ job }), { status: 201 })) as typeof fetch
    const built = buildIgbtSpatialJobSpec(createDefaultIgbtSpatialParameters())
    if (!built.ok) throw new Error(built.errors.join('\n'))
    try { await expect(submitSpatialIgbtJob(built.spec, new AbortController().signal)).rejects.toThrow('invalid spatial IGBT job acknowledgment') }
    finally { globalThis.fetch = orig }
  })
})

describe('hostApi evidence import', () => {
  it('posts measured bytes with the stored user token', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const originalFetch = globalThis.fetch
    const originalStorage = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'usr_evidence', setItem: () => undefined, removeItem: () => undefined } })
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify({ evidence: { id: 'ev-1', kind: 'measured', title: 'O2.csv', artifactId: 'a-1', sha256: 'a'.repeat(64), contentType: 'text/csv', bytes: 3, metadata: {}, ownerUserId: 'u', createdAt: '2026-01-01T00:00:00Z' } }), { status: 201 })
    }) as typeof fetch
    try {
      const record = await importHostEvidence({ kind: 'measured', title: 'O2.csv', format: 'csv', contentBase64: 'YQ==' }, 'http://host.test')
      expect(record.id).toBe('ev-1')
      expect(calls[0].url).toBe('http://host.test/api/v1/evidence/import')
      expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer usr_evidence')
      expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ kind: 'measured', format: 'csv', contentBase64: 'YQ==' })
    } finally {
      globalThis.fetch = originalFetch
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage })
    }
  })

  it('restores the authenticated evidence catalog after reload', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const originalFetch = globalThis.fetch
    const originalStorage = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'usr_restore', setItem: () => undefined, removeItem: () => undefined } })
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify({ evidence: [{ id: 'ev-restored', kind: 'literature', title: 'Paper', artifactId: 'a', sha256: 'b'.repeat(64), contentType: 'application/json', bytes: 2, metadata: { doi: '10.1/x' }, ownerUserId: 'u', projectId: null, createdAt: '2026-01-01T00:00:00Z' }] }), { status: 200 })
    }) as typeof fetch
    try {
      const records = await fetchHostEvidence('http://host.test')
      expect(records[0].id).toBe('ev-restored')
      expect(calls[0].url).toBe('http://host.test/api/v1/evidence?limit=200')
      expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer usr_restore')
    } finally {
      globalThis.fetch = originalFetch
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage })
    }
  })
})

describe('hostApi dynamic path-model catalog', () => {
  it('loads the authenticated Agent-advertised catalog', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const originalFetch = globalThis.fetch
    const originalStorage = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'usr_catalog', setItem: () => undefined, removeItem: () => undefined } })
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify({ models: [{ id: 'dynamic-model', version: '3.0.0', backends: ['cpu'], availableBackends: ['cpu'], available: true, availableAgentCount: 1, registeredAgentCount: 1, lastSeenAt: '2026-08-02T00:00:00Z' }] }), { status: 200 })
    }) as typeof fetch
    try {
      const models = await fetchPathModelCatalog('http://host.test')
      expect(models[0].id).toBe('dynamic-model')
      expect(calls[0].url).toBe('http://host.test/api/v1/path-models')
      expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer usr_catalog')
    } finally {
      globalThis.fetch = originalFetch
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage })
    }
  })
})

describe('hostApi research artifacts', () => {
  it('creates authenticated comparison and publication artifacts', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const originalFetch = globalThis.fetch
    const originalStorage = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => 'usr_research', setItem: () => undefined, removeItem: () => undefined },
    })
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (String(input).endsWith('/api/v1/comparisons')) {
        return new Response(JSON.stringify({ comparison: {
          id: 'cmp-1', artifact: { id: 'artifact-comparison' },
          envelope: { manifestSha256: 'manifest-comparison', manifest: {
            fingerprint: 'fingerprint-comparison',
            result: { baselineJobId: 'job-1', metrics: [], uncertainty: [] },
          } },
        } }), { status: 201 })
      }
      return new Response(JSON.stringify({ publication: {
        publicId: 'pub_test', version: 1, title: 'Ir ROS study', public: true,
        bundleArtifactId: 'artifact-bundle', bundleSha256: 'bundle-sha',
        manifestSha256: 'manifest-publication', createdAt: '2026-08-02T00:00:00Z',
      } }), { status: 201 })
    }) as typeof fetch

    try {
      const comparison = await createPathComparison(['job-1', 'job-2'], 'http://host.test')
      const publication = await createResearchPublication(
        ['job-1', 'job-2'], 'Ir ROS study', true, 'http://host.test',
      )

      expect(comparison.id).toBe('cmp-1')
      expect(publication.publicId).toBe('pub_test')
      expect(calls.map((call) => call.url)).toEqual([
        'http://host.test/api/v1/comparisons',
        'http://host.test/api/v1/publications',
      ])
      expect(calls.map((call) => JSON.parse(String(call.init?.body)))).toEqual([
        { jobIds: ['job-1', 'job-2'] },
        { jobIds: ['job-1', 'job-2'], title: 'Ir ROS study', public: true },
      ])
      for (const call of calls) {
        expect(call.init?.method).toBe('POST')
        expect((call.init?.headers as Record<string, string>).Authorization).toBe('Bearer usr_research')
      }
    } finally {
      globalThis.fetch = originalFetch
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage })
    }
  })
})

describe('hostApi shared job reads', () => {
  const base = 'https://host.example.test'
  const id = '29bd2bfe-5d86-4edb-a19e-cf051a6cebbb'
  const share = `shr_${'a'.repeat(43)}`

  it.each([
    { name: 'job detail', path: `/api/v1/jobs/${id}`, run: (token?: string) => fetchHostJob(id, base, token) },
    { name: 'stored result', path: `/api/v1/jobs/${id}/result`, run: (token?: string) => fetchHostJobResult(id, base, token) },
  ])('authenticates shared $name through the production header contract', async ({ run, path }) => {
    const requests: Request[] = []
    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      // Production Host rejects API query tokens; only this header grants access.
      if (request.headers.get('x-waveworld-share') !== share) return new Response('{}', { status: 404 })
      return Response.json({ job: { id }, jobId: id })
    }))
    try {
      await run(share)
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe(`${base}${path}`)
      expect(requests[0].headers.has('Authorization')).toBe(false)
      expect(requests[0].credentials).toBe('include')
      expect(requests[0].redirect).toBe('error')
      expect(requests[0].referrerPolicy).toBe('no-referrer')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves user authentication with and without a share grant', async () => {
    const requests: Request[] = []
    vi.stubGlobal('localStorage', { getItem: () => 'usr_existing_session' })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return Response.json({ job: { id }, jobId: id })
    }))
    try {
      await fetchHostJob(id, base, share)
      await fetchHostJobResult(id, base, share)
      await fetchHostJob(id, base)
      await fetchHostJobResult(id, base)
      expect(requests.map((request) => request.headers.get('x-waveworld-share'))).toEqual([share, share, null, null])
      for (const request of requests) {
        expect(request.headers.get('Authorization')).toBe('Bearer usr_existing_session')
        expect(request.credentials).toBe('include')
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('hostApi research session authentication', () => {
  const base = 'https://host.example.test'
  const experiment: HostPathExperimentSpec = {
    experimentId: 'experiment-1', title: 'Calibration', materials: [], steps: [], parameters: {},
    model: { id: 'kinetics', version: '1' },
    provenance: { createdAt: '2026-01-01T00:00:00Z', software: { name: 'WaveWorld', version: '1' } },
  }
  it.each([
    { name: 'path model catalog', run: () => fetchPathModelCatalog(base) },
    { name: 'evidence list', run: () => fetchHostEvidence(base) },
    { name: 'evidence import', run: () => importHostEvidence({ kind: 'measured', title: 'data.csv', format: 'csv', contentBase64: 'YQ==' }, base) },
    { name: 'saved job result', run: () => fetchHostJobResult('job-1', base) },
    { name: 'experiment submission', run: () => submitPathExperiment(experiment, { base }) },
    { name: 'job share', run: () => createJobShare(['job-1'], base) },
    { name: 'comparison', run: () => createPathComparison(['job-1', 'job-2'], base) },
    { name: 'publication', run: () => createResearchPublication(['job-1'], 'Study', false, base) },
  ])('includes a cookie-only session for cross-origin $name', async ({ run }) => {
    const requests: Request[] = []
    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    try {
      await run()
      expect(requests).toHaveLength(1)
      expect(requests[0].headers.has('Authorization')).toBe(false)
      expect(requests[0].credentials).toBe('include')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('hostApi bounded fetch signals', () => {
  it('attaches an AbortSignal to blocking host reads', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
    try {
      await fetchAuthConfig('http://host.test')
      await fetchPathModelCatalog('http://host.test')
      await fetchKnowledgeConflicts({}, 'http://host.test')
      await fetchHostJobResult('job-1', 'http://host.test')
      expect(calls).toHaveLength(4)
      for (const call of calls) {
        expect(call.init?.signal).toBeInstanceOf(AbortSignal)
        expect(call.init?.signal?.aborted).toBe(false)
      }
    } finally {
      globalThis.fetch = orig
    }
  })

  it('a hung host read rejects via the timeout signal', async () => {
    const orig = globalThis.fetch
    const realTimeout = AbortSignal.timeout
    const spy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => realTimeout(5))
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) {
          // Regression guard: an unbounded call would hang forever.
          setTimeout(() => reject(new Error('fetch had no abort signal')), 250)
          return
        }
        if (signal.aborted) {
          reject(signal.reason)
          return
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })) as typeof fetch
    try {
      await expect(fetchAuthConfig('http://host.test')).rejects.toMatchObject({
        name: 'TimeoutError',
      })
      expect(spy).toHaveBeenCalled()
    } finally {
      globalThis.fetch = orig
      spy.mockRestore()
    }
  })
})

describe('hostApi user token storage', () => {
  it('set/get stored user token (localStorage mock)', () => {
    const store = new Map<string, string>()
    const orig = globalThis.localStorage
    // minimal localStorage stub for node vitest
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v)
        },
        removeItem: (k: string) => {
          store.delete(k)
        },
      },
    })
    try {
      setStoredUserToken('usr_abc')
      expect(getStoredUserToken()).toBe('usr_abc')
      setStoredUserToken(null)
      expect(getStoredUserToken()).toBe(null)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: orig,
      })
    }
  })
})

describe('hostApi ontology fetch', () => {
  it('fetchOntologyMethods hits host list URL with query params', async () => {
    const calls: string[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(
        JSON.stringify({
          total: 1,
          offset: 0,
          limit: 10,
          fields: 'minimal',
          items: [{ id: 'm1', name: 'M', kind: 'wave', category: 'wave' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch
    try {
      const page = await fetchOntologyMethods(
        { limit: 10, offset: 0, fields: 'minimal', kind: 'wave' },
        'http://example.test:3001',
      )
      expect(page.source).toBe('host')
      expect(page.items[0].id).toBe('m1')
      expect(calls[0]).toContain('http://example.test:3001/api/v1/ontology/methods?')
      expect(calls[0]).toContain('limit=10')
      expect(calls[0]).toContain('fields=minimal')
      expect(calls[0]).toContain('kind=wave')
    } finally {
      globalThis.fetch = orig
    }
  })

  it('fetchOntologyMethodsWithFallback uses bundled data when host is down', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    try {
      const page = await fetchOntologyMethodsWithFallback(
        { limit: 5, offset: 0, fields: 'minimal' },
        'http://example.test:3001',
      )
      expect(page.source).toBe('bundled')
      expect(page.limit).toBe(5)
      expect(page.total).toBeGreaterThan(0)
      expect(page.items.length).toBeLessThanOrEqual(5)
      // stable id order
      const ids = page.items.map((i) => i.id)
      expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
      // minimal projection: no summary
      for (const item of page.items) {
        expect(item.summary).toBeUndefined()
        expect(item.category || item.kind).toBeTruthy()
      }
    } finally {
      globalThis.fetch = orig
    }
  })

  it('fetchOntologyMetaWithFallback falls back to bundled counts', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    try {
      const meta = await fetchOntologyMetaWithFallback('http://example.test:3001')
      expect(meta.source).toBe('bundled')
      expect(meta.methodCount).toBeGreaterThan(0)
      expect(Object.keys(meta.kinds).length).toBeGreaterThan(0)
    } finally {
      globalThis.fetch = orig
    }
  })
})
