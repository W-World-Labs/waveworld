import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { agents } from './schema';
import type { AgentCapabilities, AgentPublic, PathModelCapability, PathModelCatalogEntry, SolverBackendId } from '@/types/task';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * 注册/更新时校验能力形状——非数组字段若原样入库，会在 claim 时变成 TypeError 500。
 * Entry/string counts are bounded too: the stored JSON is re-parsed on EVERY
 * authenticated agent call and linearly scanned per claim, so a pathological
 * 256KB body of tiny strings would tax the whole control plane.
 */
const CAP_MAX_ENTRIES = 128;
const CAP_MAX_STRING = 128;

function assertCapabilitiesShape(capabilities: AgentCapabilities): void {
  const stringArray = (v: unknown) =>
    Array.isArray(v) && v.length <= CAP_MAX_ENTRIES &&
    v.every(x => typeof x === 'string' && x.length <= CAP_MAX_STRING);
  if (!stringArray(capabilities.backends) || (capabilities.backends as string[]).length === 0) {
    throw new AuthError('agent capabilities.backends must be a non-empty string array');
  }
  if (capabilities.kinds !== undefined && !stringArray(capabilities.kinds)) {
    throw new AuthError('agent capabilities.kinds must be a string array');
  }
  if (capabilities.features !== undefined && !stringArray(capabilities.features)) {
    throw new AuthError('agent capabilities.features must be a string array');
  }
  if (capabilities.pathModels !== undefined) {
    if (!Array.isArray(capabilities.pathModels) || capabilities.pathModels.length > CAP_MAX_ENTRIES ||
        capabilities.pathModels.some((model: PathModelCapability) =>
          !model.id?.trim() || model.id.length > CAP_MAX_STRING ||
          !model.version?.trim() || model.version.length > CAP_MAX_STRING ||
          !stringArray(model.backends) || model.backends.length === 0)) {
      throw new AuthError('invalid path model capability');
    }
  }
}

export async function registerAgent(input: {
  name: string;
  capabilities?: AgentCapabilities;
}): Promise<{ agent: AgentPublic; token: string }> {
  const db = getDb();
  const id = crypto.randomUUID();
  const token = generateToken();
  const now = new Date().toISOString();
  const capabilities: AgentCapabilities = input.capabilities ?? {
    // Fail closed: GPU/model capabilities must be explicitly probed and declared.
    backends: ['cpu'],
    maxGrid: 'fast',
    thermal: false,
    kinds: ['lbm-d3q19'],
  };
  assertCapabilitiesShape(capabilities);

  db.insert(agents)
    .values({
      id,
      name: input.name,
      tokenHash: hashToken(token),
      capabilities: JSON.stringify(capabilities),
      lastSeenAt: now,
      createdAt: now,
    })
    .run();

  return {
    token,
    agent: {
      id,
      name: input.name,
      capabilities,
      lastSeenAt: now,
      createdAt: now,
    },
  };
}

/**
 * lastSeenAt write throttle: authenticateAgent runs on EVERY agent call —
  * an idle agent's 2s claim poll otherwise produces a WAL write per poll
 * (~43k/day/agent of pure timestamp churn). Minute granularity is plenty
 * for an ops "last seen" display.
 */
const AGENT_LAST_SEEN_REFRESH_MS = 60_000;

export function authenticateAgent(authHeader: string | null): {
  id: string;
  name: string;
  capabilities: AgentCapabilities;
} | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  const db = getDb();
  const row = db
    .select()
    .from(agents)
    .where(eq(agents.tokenHash, hashToken(token)))
    .get();
  if (!row) return null;
  const lastSeenMs = Date.parse(row.lastSeenAt ?? '');
  if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs > AGENT_LAST_SEEN_REFRESH_MS) {
    const now = new Date().toISOString();
    db.update(agents).set({ lastSeenAt: now }).where(eq(agents.id, row.id)).run();
  }
  return {
    id: row.id,
    name: row.name,
    capabilities: JSON.parse(row.capabilities) as AgentCapabilities,
  };
}

export function requireAgent(req: Request) {
  const agent = authenticateAgent(req.headers.get('authorization'));
  if (!agent) {
    throw new AuthError('需要有效的 Agent Bearer token');
  }
  return agent;
}

/** Browser execution uses the user's session and this tab's existing job lease.
 * It never grants registration, global claim, or access to another user's job.
 */
export async function requireJobExecutor(req: Request, jobId: string): Promise<{ id: string }> {
  const agent = authenticateAgent(req.headers.get('authorization'));
  if (agent) return agent;
  const { requireUser } = await import('../user-auth');
  const { getJob } = await import('./service');
  const user = await requireUser(req);
  const id = req.headers.get('x-browser-agent');
  const job = getJob(jobId);
  const { isBrowserLbmJob } = await import('../../../../../src/lib/sim/lbm-compute');
  const { isNativeAlgorithmInput, isNativeModule } = await import('../../../../../src/lib/sim/module-compute');
  const inline = job?.kind === 'waveworld-module' && job.spec.model?.source === 'inline' ? job.spec.model.inline : undefined;
  const supported = job && (job.kind === 'mac-3d' || isBrowserLbmJob(job.spec) || (job.kind === 'waveworld-module' &&
    !isNativeAlgorithmInput(inline) && isNativeModule((job.spec.parameters as Record<string, unknown>)?.module)));
  if (!id || !/^browser-[0-9a-f-]{36}$/.test(id) || !job || job.createdBy !== user.id ||
      job.agentId !== id || !supported) {
    const error = new AuthError('This browser does not own the job lease');
    error.status = 403;
    throw error;
  }
  return { id };
}

export function updateAgentCapabilities(agentId: string, capabilities: AgentCapabilities): AgentPublic | null {
  assertCapabilitiesShape(capabilities);
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.update(agents).set({ capabilities: JSON.stringify(capabilities), lastSeenAt: now }).where(eq(agents.id, agentId)).run();
  if (!result.changes) return null;
  const row = db.select().from(agents).where(eq(agents.id, agentId)).get();
  return row ? { id: row.id, name: row.name, capabilities, lastSeenAt: now, createdAt: row.createdAt } : null;
}

export function getAgentCapabilities(agentId: string): AgentCapabilities | null {
  const row = getDb().select({ capabilities: agents.capabilities }).from(agents).where(eq(agents.id, agentId)).get();
  if (!row) return null;
  try { return JSON.parse(row.capabilities) as AgentCapabilities; } catch { return null; }
}

/**
 * Aggregate model manifests across Agents without exposing Agent identity or tokens.
 * Stale registrations remain visible as unavailable so saved specifications have a
 * useful explanation instead of silently disappearing from the UI.
 */
export function listPathModelCatalog(now = new Date()): PathModelCatalogEntry[] {
  const db = getDb();
  const onlineSeconds = positiveNumber(process.env.PATH_MODEL_AGENT_ONLINE_SECONDS, 120);
  const onlineAfter = now.getTime() - onlineSeconds * 1000;
  const catalog = new Map<string, {
    manifest: PathModelCapability;
    registeredAgentCount: number;
    availableAgentCount: number;
    backends: Set<SolverBackendId>;
    availableBackends: Set<SolverBackendId>;
    implementationDigests: Set<string>;
    lastSeenAt: string | null;
  }>();

  for (const row of db.select().from(agents).all()) {
    let capabilities: AgentCapabilities;
    try { capabilities = JSON.parse(row.capabilities) as AgentCapabilities; } catch { continue; }
    if (!Array.isArray(capabilities.pathModels)) continue;
    const lastSeenMs = row.lastSeenAt ? Date.parse(row.lastSeenAt) : Number.NaN;
    const online = Number.isFinite(lastSeenMs) && lastSeenMs >= onlineAfter;
    const advertisedByAgent = new Set<string>();
    for (const model of capabilities.pathModels) {
      if (!validPathModelCapability(model)) continue;
      const key = `${model.id}\u0000${model.version}`;
      if (advertisedByAgent.has(key)) continue;
      advertisedByAgent.add(key);
      const current = catalog.get(key) ?? {
        manifest: model,
        registeredAgentCount: 0,
        availableAgentCount: 0,
        backends: new Set<SolverBackendId>(),
        availableBackends: new Set<SolverBackendId>(),
        implementationDigests: new Set<string>(),
        lastSeenAt: null,
      };
      current.registeredAgentCount += 1;
      if (online) current.availableAgentCount += 1;
      for (const backend of model.backends) {
        current.backends.add(backend);
        if (online) current.availableBackends.add(backend);
      }
      if (online && model.implementationSha256) current.implementationDigests.add(model.implementationSha256);
      if (row.lastSeenAt && (!current.lastSeenAt || row.lastSeenAt > current.lastSeenAt)) current.lastSeenAt = row.lastSeenAt;
      // Prefer the richer declaration when older Agents only advertise execution capability.
      current.manifest = {
        ...current.manifest,
        ...(current.manifest.parameters ? {} : model.parameters ? { parameters: model.parameters } : {}),
        ...(current.manifest.outputs ? {} : model.outputs ? { outputs: model.outputs } : {}),
      };
      catalog.set(key, current);
    }
  }

  return [...catalog.values()].map((item) => {
    const implementationConflict = item.implementationDigests.size > 1;
    return {
      ...item.manifest,
      backends: [...item.backends].sort(),
      available: item.availableAgentCount > 0 && !implementationConflict,
      availableBackends: implementationConflict ? [] : [...item.availableBackends].sort(),
      availableAgentCount: implementationConflict ? 0 : item.availableAgentCount,
      registeredAgentCount: item.registeredAgentCount,
      lastSeenAt: item.lastSeenAt,
      ...(implementationConflict ? { implementationConflict } : {}),
    };
  }).sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function validPathModelCapability(value: PathModelCapability): boolean {
  return !!value?.id?.trim() && !!value.version?.trim() && Array.isArray(value.backends) && value.backends.length > 0;
}

function sameSecretLocal(actual: string | null | undefined, expected: string): boolean {
  if (actual == null || actual === '' || !expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkSubmitAuth(req: Request): boolean {
  const key = process.env.TASK_API_KEY?.trim();
  if (!key) return process.env.NODE_ENV !== 'production';
  return sameSecretLocal(req.headers.get('x-api-key'), key);
}

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
