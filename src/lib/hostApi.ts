/**
 * Phase 1/2 host API base for atlas UI → jobs backend.
 * Browser requests stay same-origin. Vite dev/preview and local Next Lab
 * provide private server-side proxies; production ingress owns /api routing.
 */
import {
  resolveHostApiBase,
  resolveFullLabPageUrl,
  resolveIsLabUiConfigured,
  resolveLabUiBase,
  type LabResolveInput,
} from './labEntry'
import type { JobSpecV1 } from '@w-sim/contracts'

export {
  resolveFullLabPageUrl,
  resolveIsLabUiConfigured,
  resolveLabUiBase,
} from './labEntry'
export type { LabResolveInput } from './labEntry'

export function hostApiBase(): string {
  return resolveHostApiBase(typeof window === 'undefined' ? {} : window.location)
}

function labResolveFromRuntime(): LabResolveInput {
  const envLabUrl = (import.meta as ImportMeta & { env?: Record<string, string> }).env
    ?.VITE_LAB_URL
  if (typeof window === 'undefined') {
    return { envLabUrl }
  }
  return {
    envLabUrl,
    hostname: window.location.hostname,
    port: window.location.port,
    origin: window.location.origin,
  }
}

/**
 * Full tuanliu Next lab UI base (WebGPU). Override with VITE_LAB_URL.
 *
 * Public hosts default to same-origin `/app/lab` (Caddy → tuanliu-lab).
 * Loopback only used for local Vite / dev.
 */
export function labUiBase(): string {
  return resolveLabUiBase(labResolveFromRuntime())
}

/**
 * True when labUiBase points at a browser-reachable full lab UI.
 * Loopback lab is allowed only on local pages (or outside a browser context).
 */
export function isLabUiConfigured(): boolean {
  return resolveIsLabUiConfigured(labResolveFromRuntime())
}

/** Engineering Lab page URL (…/lab) or null when not embeddable here. */
export function fullLabPageUrl(): string | null {
  return resolveFullLabPageUrl(labResolveFromRuntime())
}

export type HostJobSummary = {
  compute?: { provider: 'w-compute'; instanceId: string | null; phase: string; error: string | null }
  id: string
  name: string | null
  status: string
  kind?: string
  agentId?: string | null
  progress: { step?: number; total?: number; cd?: number; cl?: number; message?: string } | null
  result: {
    derived?: { engine?: string }
    summary?: { steps?: number; cd?: number; cl?: number; wallTimeMs?: number }
  } | null
  error: string | null
  /** Linked project when job was submitted with projectId. */
  projectId?: string | null
  createdAt: string
  updatedAt: string
}

export type HostJobDetail = HostJobSummary & {
  kind: string
  spec: {
    schemaVersion: number
    kind: string
    name?: string
    model?: Record<string, unknown>
    parameters: Record<string, unknown>
    run: Record<string, unknown>
    outputs: Record<string, unknown>
    requirements?: Record<string, unknown>
    experiment?: HostPathExperimentSpec
  }
  result: Record<string, unknown> | null
  specFingerprint?: string | null
  agentId?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

export type HostPathEvidence = {
  kind: 'measured' | 'literature' | 'assumption' | 'computed'
  citation?: string
  uri?: string
  note?: string
  evidenceId?: string
  sha256?: string
  locator?: string
  transform?: string
}

export type HostPathExperimentSpec = {
  experimentId: string
  title: string
  description?: string
  materials: Array<{ id: string; name: string; role: string; formula?: string; source: HostPathEvidence }>
  steps: Array<{
    id: string; label: string; mechanism: string; inputs: string[]; outputs: string[]
    hypothesis: { status: 'accepted' | 'candidate' | 'disputed'; description: string; sources: HostPathEvidence[] }
  }>
  parameters: Record<string, { value: string | number | boolean; unit?: string; source: HostPathEvidence }>
  model: { id: string; version: string; implementation?: string; checksum?: string }
  analysis?: {
    calibration?: {
      observations: { time: number[]; T1?: number[]; singletO2?: number[] }
      evidence?: HostPathEvidence
      fitParameters: Record<string, { min: number; max: number; gridPoints?: number }>
      rounds?: number
    }
    uncertainty?: {
      seed: number; samples: number; relativeSigma?: number
      parameters?: Record<string, { kind: 'uniform'; min: number; max: number } | { kind: 'normal'; sigma: number; min?: number; max?: number }>
    }
  }
  provenance: {
    createdAt: string; createdBy?: string; software: { name: string; version: string }
    parentSnapshot?: string; notes?: string
  }
}

export type HostPathExperimentResult = {
  experimentId: string
  modelVersion: string
  outputs: Record<string, { value: string | number | boolean | number[]; unit?: string; source?: HostPathEvidence }>
  provenance: { computedAt: string; engineVersion: string }
}

export type HostEvidenceRecord = {
  id: string
  kind: 'measured' | 'literature'
  title: string
  artifactId: string
  sha256: string
  contentType: string
  bytes: number
  metadata: Record<string, unknown>
  ownerUserId: string | null
  projectId: string | null
  createdAt: string
}

export type HostEvidenceImport = (
  | { kind: 'measured'; title: string; format: 'csv' | 'json'; contentBase64: string; contentType?: string; metadata?: Record<string, unknown> }
  | { kind: 'literature'; title: string; doi?: string; url?: string; citation?: string; metadata?: Record<string, unknown> }
) & { projectId?: string }

export type HostPathModelCatalogEntry = {
  id: string
  version: string
  backends: string[]
  availableBackends: string[]
  parameters?: Record<string, { type: 'number' | 'string' | 'boolean'; required?: boolean; min?: number; unit?: string; description?: string }>
  outputs?: Record<string, { type: 'number' | 'number[]'; unit?: string; description?: string }>
  analyses?: Array<'calibration' | 'uncertainty'>
  implementationSha256?: string
  implementationConflict?: boolean
  available: boolean
  availableAgentCount: number
  registeredAgentCount: number
  lastSeenAt: string | null
}

/**
 * Bounded signal for host API calls (workspace rule: remote calls get a
 * timeout so a half-open connection cannot hang the UI forever, and the
 * existing catch/degraded path can fire). Composes with a caller signal.
 */
function hostApiSignal(caller?: AbortSignal | null, timeoutMs = 15_000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return caller ? AbortSignal.any([caller, timeout]) : timeout
}

/** Load the authenticated, Agent-advertised path-model plugin catalog. */
export async function fetchPathModelCatalog(base = hostApiBase()): Promise<HostPathModelCatalogEntry[]> {
  const res = await fetch(`${base}/api/v1/path-models`, { headers: userAuthHeaders(), credentials: 'include', signal: hostApiSignal() })
  if (!res.ok) throw new Error(`path models HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { models?: HostPathModelCatalogEntry[] }
  return data.models ?? []
}

export async function importHostEvidence(input: HostEvidenceImport, base = hostApiBase()): Promise<HostEvidenceRecord> {
  const res = await fetch(`${base}/api/v1/evidence/import`, {
    method: 'POST', headers: userAuthHeaders({ 'Content-Type': 'application/json' }), credentials: 'include', body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`evidence import HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { evidence: HostEvidenceRecord }
  return data.evidence
}

/** Restore personal evidence plus evidence from every project visible to the user. */
export async function fetchHostEvidence(base = hostApiBase()): Promise<HostEvidenceRecord[]> {
  const res = await fetch(`${base}/api/v1/evidence?limit=200`, { headers: userAuthHeaders(), credentials: 'include', signal: hostApiSignal() })
  if (!res.ok) throw new Error(`evidence list HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return ((await res.json()) as { evidence?: HostEvidenceRecord[] }).evidence ?? []
}

export type HostJobStoredResult = {
  jobId: string
  status: string
  specFingerprint: string | null
  result: Record<string, unknown>
  artifacts: Array<Record<string, unknown>>
  audit?: { status: 'ready' | 'failed'; artifactId: string | null; manifestSha256: string | null; error: string | null } | null
}

/** Load the immutable job specification by stable database id. */
function userAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers = { ...(extra ?? {}) }
  const token = getStoredUserToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function fetchHostJob(id: string, base = hostApiBase(), shareToken?: string | null, signal?: AbortSignal): Promise<HostJobDetail> {
  const res = await fetch(`${base}/api/v1/jobs/${encodeURIComponent(id)}`, {
    headers: userAuthHeaders(shareToken ? { 'x-waveworld-share': shareToken } : undefined),
    credentials: 'include', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`job ${id} HTTP ${res.status}`)
  const data = (await res.json()) as { job: HostJobDetail }
  return data.job
}

/** Load the authoritative persisted result; this endpoint never re-solves the job. */
export async function fetchHostJobResult(id: string, base = hostApiBase(), shareToken?: string | null): Promise<HostJobStoredResult> {
  const res = await fetch(`${base}/api/v1/jobs/${encodeURIComponent(id)}/result`, {
    headers: userAuthHeaders(shareToken ? { 'x-waveworld-share': shareToken } : undefined),
    credentials: 'include', redirect: 'error', referrerPolicy: 'no-referrer', signal: hostApiSignal(),
  })
  if (!res.ok) throw new Error(`job result ${id} HTTP ${res.status}`)
  return res.json() as Promise<HostJobStoredResult>
}

/** Submit a protocol-complete path experiment; succeeded fingerprints are reused by Host. */
export async function submitPathExperiment(
  experiment: HostPathExperimentSpec,
  options: { projectId?: string; base?: string } = {},
): Promise<{ job: HostJobDetail; reused: boolean }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getStoredUserToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${options.base ?? hostApiBase()}/api/v1/jobs?reuse=1`, {
    method: 'POST', headers, credentials: 'include',
    body: JSON.stringify({
      ...(options.projectId ? { projectId: options.projectId } : {}),
      reuseSucceeded: true,
      spec: {
        schemaVersion: 1, kind: 'path-experiment', name: experiment.title,
        parameters: {}, run: { maxSteps: 1000, forceSampleEvery: 20 }, outputs: { forces: false, history: true },
        requirements: { backends: ['cpu'] }, experiment,
      },
    }),
  })
  if (!res.ok) throw new Error(`submit path experiment HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json() as Promise<{ job: HostJobDetail; reused: boolean }>
}

export async function fetchHostHealth(base = hostApiBase()): Promise<{
  ok: boolean
  status?: string
  service?: string
}> {
  const res = await fetch(`${base}/api/health`)
  if (!res.ok) throw new Error(`health HTTP ${res.status}`)
  return res.json() as Promise<{ ok: boolean; status?: string; service?: string }>
}

export async function fetchHostJobs(base = hostApiBase(), signal?: AbortSignal): Promise<HostJobSummary[]> {
  const res = await fetch(`${base}/api/v1/jobs?limit=50`, {
    headers: userAuthHeaders(),
    credentials: 'include',
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`jobs HTTP ${res.status}`)
  const data = (await res.json()) as { jobs: HostJobSummary[] }
  return data.jobs ?? []
}

export async function cancelHostJob(id: string, base = hostApiBase()): Promise<void> {
  const res = await fetch(`${base}/api/v1/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', headers: userAuthHeaders(), credentials: 'include',
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  })
  if (!res.ok) throw new Error(`cancel job HTTP ${res.status}`)
}

export async function fetchHostArtifact(id: string, base = hostApiBase()): Promise<Blob> {
  const res = await fetch(`${base}/api/v1/artifacts/${encodeURIComponent(id)}`, {
    headers: userAuthHeaders(), credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`artifact HTTP ${res.status}`)
  const limit = 32 * 1024 * 1024, reader = res.body?.getReader()
  if (!reader) throw new Error('Artifact response is empty')
  const chunks: ArrayBuffer[] = []
  let size = 0
  try {
    if (Number(res.headers.get('content-length')) > limit) throw new Error('Result file exceeds 32 MiB download limit')
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('Result file exceeds 32 MiB download limit')
      chunks.push(new Uint8Array(value).buffer)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return new Blob(chunks, { type: res.headers.get('content-type') ?? 'application/octet-stream' })
}

/** True when the Host process is up but the caller is not signed in. */
export function isHostAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\bHTTP 401\b/.test(msg)
}

/** Same-origin or host-base OIDC start URL. */
export function oidcStartHref(returnTo: string, base = hostApiBase()): string {
  const path = returnTo.startsWith('/') ? returnTo : `/${returnTo}`
  return `${base}/api/v1/auth/oidc/start?returnTo=${encodeURIComponent(path)}`
}

export async function createJobShare(jobIds: string[], base = hostApiBase()): Promise<{
  id: string; token: string; jobIds: string[]; expiresAt: string
}> {
  const res = await fetch(`${base}/api/v1/shares`, {
    method: 'POST', headers: userAuthHeaders({ 'Content-Type': 'application/json' }), credentials: 'include',
    body: JSON.stringify({ jobIds }),
  })
  if (!res.ok) throw new Error(`create share HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return ((await res.json()) as { share: { id: string; token: string; jobIds: string[]; expiresAt: string } }).share
}

export type HostPathComparison = {
  id: string
  artifact: { id: string; sha256?: string | null }
  envelope: { manifestSha256: string; manifest: {
    fingerprint: string
    result: {
      baselineJobId: string
      snapshots?: Array<{
        jobId: string
        model: { id: string; version: string; implementation?: string; checksum?: string }
        materials: Array<{ id: string; name: string; role: string }>
        steps: Array<{ id: string; label: string; mechanism: string; order: number; hypothesis: { status: string; description: string } }>
        parameters: Record<string, { value: string | number | boolean; unit?: string }>
        evidenceAnchors: Array<{ path: string; source: HostPathEvidence }>
      }>
      differences?: Array<{
        baselineJobId: string; jobId: string
        added: Array<{ path: string; value: unknown }>
        removed: Array<{ path: string; value: unknown }>
        changed: Array<{ path: string; baselineValue: unknown; value: unknown }>
      }>
      metrics: Array<{ key: string; unit: string | null; values: Array<{ jobId: string; value: number; absoluteDelta: number; relativeDelta: number | null }> }>
      uncertainty: Array<{ key: string; unit: string | null; intervals: Array<{ jobId: string; p10: number; p50: number; p90: number; overlapsBaseline: boolean }> }>
    }
  } }
}

export async function createPathComparison(jobIds: string[], base = hostApiBase()): Promise<HostPathComparison> {
  const res = await fetch(`${base}/api/v1/comparisons`, {
    method: 'POST', headers: userAuthHeaders({ 'Content-Type': 'application/json' }), credentials: 'include', body: JSON.stringify({ jobIds }),
  })
  if (!res.ok) throw new Error(`create comparison HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return ((await res.json()) as { comparison: HostPathComparison }).comparison
}

export type HostPublication = {
  publicId: string; version: number; title: string; public: boolean
  bundleArtifactId: string; bundleSha256: string; manifestSha256: string; createdAt: string
}

export async function createResearchPublication(
  jobIds: string[], title: string, isPublic: boolean, base = hostApiBase(),
  evidencePolicies?: Record<string, { mode: 'embed' | 'external' | 'exclude'; locator?: string; reason?: string }>,
): Promise<HostPublication> {
  const res = await fetch(`${base}/api/v1/publications`, {
    method: 'POST', headers: userAuthHeaders({ 'Content-Type': 'application/json' }), credentials: 'include',
    body: JSON.stringify({ jobIds, title, public: isPublic, ...(evidencePolicies ? { evidencePolicies } : {}) }),
  })
  if (!res.ok) throw new Error(`create publication HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return ((await res.json()) as { publication: HostPublication }).publication
}

export async function submitDemoJob(
  base = hostApiBase(),
  opts?: { projectId?: string; token?: string | null },
): Promise<HostJobSummary> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`
  const res = await fetch(`${base}/api/v1/jobs`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({
      projectId: opts?.projectId,
      knowledge: { kind: 'lbm-d3q19' },
      spec: {
        schemaVersion: 1,
        kind: 'lbm-d3q19',
        name: 'waveworld-nav-demo',
        model: { source: 'preset', presetId: 'cylinder' },
        parameters: {
          inletVelocity: 1,
          gridPreset: 'fast',
          modelResolution: 'coarse',
          wallCondition: 'no-slip',
          turbulenceIntensity: 1,
          smagorinskyCs: 0.12,
          fluidDensity: 1.225,
        },
        run: { maxSteps: 200, forceSampleEvery: 20, warmupSteps: 20 },
        outputs: { forces: true, history: true },
        requirements: { backends: ['webgpu', 'webgpu-dawn'] },
      },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`submit HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as { job: HostJobSummary }
  return data.job
}

/** Submit a typed solver job using the same session-cookie/bearer auth as other Host calls. */
export async function submitSpatialIgbtJob(spec: JobSpecV1, signal: AbortSignal): Promise<HostJobSummary> {
  const res = await fetch(`${hostApiBase()}/api/v1/jobs`, {
    method: 'POST',
    headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    body: JSON.stringify({ spec }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`submit spatial IGBT HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json() as { job?: HostJobSummary }
  const job = data?.job
  const knownStatuses = ['queued', 'leased', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled']
  if (!job || typeof job.id !== 'string' || job.id.trim() !== job.id || job.id.length < 1 || job.id.length > 128 ||
      typeof job.status !== 'string' || !knownStatuses.includes(job.status) || job.kind !== 'electro-thermal-igbt') {
    throw new Error('Host returned an invalid spatial IGBT job acknowledgment')
  }
  return job
}

// ── User identity / projects ───────────────────────────────────
//
// Auth: after login, Atlas stores `usr_*` in localStorage and sends
//   Authorization: Bearer usr_<token>
// on host API calls. Host also sets HttpOnly `ww_session` for same-origin use.
// XSS blast radius (#61): any Atlas XSS can read localStorage and steal the
// Bearer. Compensating control is CSP (script-src 'self') on Atlas/Host/Lab
// plus HSTS. Prefer the HttpOnly cookie on same-origin deploys.
// See GET /api/v1/auth/config and GET /api/v1/me.

const USER_TOKEN_KEY = 'waveworld_user_token'

export function getStoredUserToken(): string | null {
  try {
    return localStorage.getItem(USER_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setStoredUserToken(token: string | null) {
  try {
    if (token) localStorage.setItem(USER_TOKEN_KEY, token)
    else localStorage.removeItem(USER_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export type HostUser = {
  id: string
  name: string
  workspaceId: string
  createdAt?: string
  authProvider?: string
}

export type HostProject = {
  id: string
  ownerUserId: string
  workspaceId: string
  name: string
  description: string
  status: string
  visibility: string
  settings: Record<string, unknown>
  thumbnailUrl: string | null
  jobCount?: number
  modelCount?: number
  createdAt: string
  updatedAt: string
}

/** Headers for authenticated host API calls (Bearer usr_* from localStorage). */
function authHeaders(token?: string | null): Record<string, string> {
  const t = token ?? getStoredUserToken()
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (t) h.Authorization = `Bearer ${t}`
  return h
}

/**
 * Dev login against host. Stores token in localStorage for subsequent API calls.
 * user.id is stable for the same name+workspace across re-logins.
 */
export async function devLogin(
  name: string,
  workspaceId = 'default',
  base = hostApiBase(),
): Promise<{ user: HostUser; token: string }> {
  const res = await fetch(`${base}/api/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, workspaceId }),
  })
  if (!res.ok) throw new Error(`dev-login HTTP ${res.status}`)
  const data = (await res.json()) as {
    user: HostUser
    token: string
  }
  setStoredUserToken(data.token)
  return data
}

/** Current host user via Authorization Bearer (or session cookie if same-origin). */
export async function fetchMe(base = hostApiBase()): Promise<HostUser> {
  const res = await fetch(`${base}/api/v1/me`, {
    headers: authHeaders(),
    credentials: 'include',
    signal: hostApiSignal(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`me HTTP ${res.status}: ${text.slice(0, 120)}`)
  }
  const data = (await res.json()) as { user: HostUser }
  return data.user
}

/** Public auth config (OIDC configured? missing env?). */
export async function fetchAuthConfig(base = hostApiBase()): Promise<{
  devLogin: boolean
  oidc: { configured: boolean; missing: string[] }
}> {
  const res = await fetch(`${base}/api/v1/auth/config`, { signal: hostApiSignal() })
  if (!res.ok) throw new Error(`auth/config HTTP ${res.status}`)
  return res.json() as Promise<{
    devLogin: boolean
    oidc: { configured: boolean; missing: string[] }
  }>
}

/** Revoke session on host and clear local token. */
export async function logout(base = hostApiBase()): Promise<void> {
  try {
    await fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'include',
    })
  } finally {
    setStoredUserToken(null)
  }
}

export async function fetchMyProjects(base = hostApiBase()): Promise<HostProject[]> {
  const res = await fetch(`${base}/api/v1/projects`, {
    headers: authHeaders(),
    credentials: 'include',
    signal: hostApiSignal(),
  })
  if (!res.ok) throw new Error(`projects HTTP ${res.status}`)
  const data = (await res.json()) as { projects: HostProject[] }
  return data.projects ?? []
}

export async function createProject(
  input: { name: string; description?: string },
  base = hostApiBase(),
): Promise<HostProject> {
  const res = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`create project HTTP ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { project: HostProject }
  return data.project
}

export async function deleteProject(id: string, base = hostApiBase()): Promise<void> {
  const res = await fetch(`${base}/api/v1/projects/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`delete project HTTP ${res.status}`)
}

export async function fetchProjectDetail(
  id: string,
  base = hostApiBase(),
): Promise<{ project: HostProject & { models?: unknown[]; recentJobIds?: string[] }; role: string }> {
  const res = await fetch(`${base}/api/v1/projects/${id}`, {
    headers: authHeaders(),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`project detail HTTP ${res.status}`)
  return res.json() as Promise<{
    project: HostProject & { models?: unknown[]; recentJobIds?: string[] }
    role: string
  }>
}

// ── Ontology catalog (host API with offline fallback) ──────────
//
// Atlas requests the same-origin Host API. If it is unreachable, callers
// should use fetchOntologyMethodsWithFallback which loads bundled data.

export type HostMethodSummary = {
  id: string
  name: string
  nameEn?: string
  kind: string
  role?: string
  yearIntroduced?: number
  simPaths?: string[]
  parentId?: string
  summary?: string
  /** Present on fields=minimal list rows (alias of kind). */
  category?: string
}

export type HostMethodsPage = {
  total: number
  offset: number
  limit: number
  fields?: 'full' | 'minimal'
  items: HostMethodSummary[]
  /** Set when served from bundled atlas data (host unreachable / offline). */
  source?: 'host' | 'bundled'
}

export type HostOntologyMeta = {
  ok?: boolean
  methodCount: number
  kinds: Record<string, number>
  jobKinds: string[]
  defaults?: { limit: number; maxLimit: number; sort: string }
  source?: 'host' | 'bundled'
}

export type OntologyMethodsQuery = {
  q?: string
  kind?: string
  limit?: number
  offset?: number
  /** "minimal" | "id,name,category" | "full" (default). */
  fields?: string
}

function methodsQueryString(query: OntologyMethodsQuery = {}): string {
  const sp = new URLSearchParams()
  if (query.q) sp.set('q', query.q)
  if (query.kind) sp.set('kind', query.kind)
  if (query.limit != null) sp.set('limit', String(query.limit))
  if (query.offset != null) sp.set('offset', String(query.offset))
  if (query.fields) sp.set('fields', query.fields)
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** Page methods from host ontology API. Throws if host is down. */

/** K17: public conflict_sets list from Knowledge DB Host API. */
export type HostKnowledgeConflictSet = {
  id: string
  subjectId: string
  reason: string | null
  resolutionNote: string | null
  state: 'open' | 'resolved'
  claimIds: string[]
  createdAt: string
  updatedAt: string | null
  contractVersion: number
}

/** K31/K33: state filter open|resolved|all (server default all). */
export type KnowledgeConflictStateFilter = 'open' | 'resolved' | 'all'

export async function fetchKnowledgeConflicts(
  query: { limit?: number; state?: KnowledgeConflictStateFilter; q?: string } = {},
  base = hostApiBase(),
): Promise<{ items: HostKnowledgeConflictSet[]; total: number; state?: KnowledgeConflictStateFilter }> {
  const sp = new URLSearchParams()
  if (query.limit != null) sp.set('limit', String(query.limit))
  if (query.state) sp.set('state', query.state)
  if (query.q) sp.set('q', query.q)
  const qs = sp.toString()
  const url = `${base}/api/v1/knowledge/conflicts${qs ? `?${qs}` : ''}`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: hostApiSignal() })
  if (!res.ok) throw new Error(`knowledge conflicts failed: ${res.status}`)
  const data = (await res.json()) as {
    items?: HostKnowledgeConflictSet[]
    total?: number
    state?: string
  }
  const stateEcho =
    data.state === 'open' || data.state === 'resolved' || data.state === 'all'
      ? data.state
      : query.state
  return { items: data.items ?? [], total: data.total ?? 0, state: stateEcho }
}

/** Snapshot row from durable reverse index (K19 / C2). */
export type HostKnowledgeSnapshotRef = {
  id: string
  contentSha256?: string
  uri?: string | null
  capturedAt?: string | null
  [key: string]: unknown
}

/**
 * GET /api/v1/knowledge/snapshots?sha= — content_sha reverse index (C2/K19).
 * Rejects non-64-hex client-side to avoid 400 round-trips.
 */
export async function fetchKnowledgeSnapshotsByContentSha(
  sha: string,
  base = hostApiBase(),
): Promise<{ contentSha256: string; items: HostKnowledgeSnapshotRef[]; total: number }> {
  const trimmed = sha.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(trimmed)) {
    throw new Error('content sha must be 64 hex chars')
  }
  const url = `${base}/api/v1/knowledge/snapshots?sha=${encodeURIComponent(trimmed)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: hostApiSignal() })
  if (!res.ok) throw new Error(`knowledge snapshots failed: ${res.status}`)
  const data = (await res.json()) as {
    contentSha256?: string
    items?: HostKnowledgeSnapshotRef[]
    total?: number
  }
  return {
    contentSha256: data.contentSha256 ?? trimmed,
    items: data.items ?? [],
    total: data.total ?? (data.items?.length ?? 0),
  }
}

export async function fetchOntologyMethods(
  query: OntologyMethodsQuery = {},
  base = hostApiBase(),
): Promise<HostMethodsPage> {
  const res = await fetch(`${base}/api/v1/ontology/methods${methodsQueryString(query)}`)
  if (!res.ok) throw new Error(`ontology/methods HTTP ${res.status}`)
  const data = (await res.json()) as HostMethodsPage
  return { ...data, source: 'host' }
}

/** Single method by id from host. Throws on non-404 errors; returns null on 404. */
export async function fetchOntologyMethod(
  id: string,
  base = hostApiBase(),
): Promise<HostMethodSummary | null> {
  const res = await fetch(`${base}/api/v1/ontology/methods/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`ontology/methods/${id} HTTP ${res.status}`)
  const data = (await res.json()) as { method: HostMethodSummary }
  return data.method ?? null
}

/** Ontology meta (counts / kinds / jobKinds) from host. */
export async function fetchOntologyMeta(base = hostApiBase()): Promise<HostOntologyMeta> {
  const res = await fetch(`${base}/api/v1/ontology/meta`)
  if (!res.ok) throw new Error(`ontology/meta HTTP ${res.status}`)
  const data = (await res.json()) as HostOntologyMeta
  return { ...data, source: 'host' }
}

/**
 * Prefer host API when reachable; fall back to bundled METHODS for offline atlas.
 * Projection honors fields=minimal (id/name/kind|category only).
 */
export async function fetchOntologyMethodsWithFallback(
  query: OntologyMethodsQuery = {},
  base = hostApiBase(),
): Promise<HostMethodsPage> {
  try {
    return await fetchOntologyMethods(query, base)
  } catch {
    const { METHODS } = await import('../data/methods/methods')
    const q = query.q?.trim().toLowerCase()
    const kind = query.kind?.trim()
    let filtered = METHODS as Array<{
      id: string
      name: string
      nameEn?: string
      kind: string
      role?: string
      yearIntroduced?: number
      simPaths?: string[]
      parentId?: string
      summary: string
    }>
    filtered = [...filtered].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (kind) filtered = filtered.filter((m) => m.kind === kind)
    if (q) {
      filtered = filtered.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          (m.nameEn?.toLowerCase().includes(q) ?? false) ||
          m.summary.toLowerCase().includes(q),
      )
    }
    const total = filtered.length
    const offset = Math.max(0, query.offset ?? 0)
    const limit = Math.min(200, Math.max(1, query.limit ?? 50))
    const slice = filtered.slice(offset, offset + limit)
    const fieldsRaw = (query.fields ?? '').toLowerCase()
    const minimal =
      fieldsRaw === 'minimal' ||
      fieldsRaw === 'compact' ||
      /^id[,/\s]+name[,/\s]+(category|kind)/.test(fieldsRaw)
    const items: HostMethodSummary[] = minimal
      ? slice.map((m) => ({
          id: m.id,
          name: m.name,
          nameEn: m.nameEn,
          kind: m.kind,
          category: m.kind,
        }))
      : slice.map((m) => ({
          id: m.id,
          name: m.name,
          nameEn: m.nameEn,
          kind: m.kind,
          role: m.role,
          yearIntroduced: m.yearIntroduced,
          simPaths: m.simPaths,
          parentId: m.parentId,
          summary: m.summary,
        }))
    return {
      total,
      offset,
      limit,
      fields: minimal ? 'minimal' : 'full',
      items,
      source: 'bundled',
    }
  }
}

/** Host meta with bundled fallback (method count / kind histogram). */
export async function fetchOntologyMetaWithFallback(
  base = hostApiBase(),
): Promise<HostOntologyMeta> {
  try {
    return await fetchOntologyMeta(base)
  } catch {
    const { METHODS } = await import('../data/methods/methods')
    const kinds: Record<string, number> = {}
    for (const m of METHODS) {
      kinds[m.kind] = (kinds[m.kind] ?? 0) + 1
    }
    const sorted: Record<string, number> = {}
    for (const k of Object.keys(kinds).sort()) sorted[k] = kinds[k]
    return {
      ok: true,
      methodCount: METHODS.length,
      kinds: sorted,
      jobKinds: ['lbm-d3q19', 'fdtd-batch', 'export-report'],
      defaults: { limit: 50, maxLimit: 200, sort: 'id' },
      source: 'bundled',
    }
  }
}

/** Goal / loop harness meta from host (optional; throws if host down). */
export async function fetchGoalsMeta(base = hostApiBase()): Promise<{
  ok: boolean
  loops: Array<{ id: string; path: string; title: string; exists: boolean }>
  explorationGoals?: { path: string; goals: Array<{ id: string; goal: string }> }
}> {
  const res = await fetch(`${base}/api/v1/goals`)
  if (!res.ok) throw new Error(`goals HTTP ${res.status}`)
  return res.json() as Promise<{
    ok: boolean
    loops: Array<{ id: string; path: string; title: string; exists: boolean }>
    explorationGoals?: { path: string; goals: Array<{ id: string; goal: string }> }
  }>
}
