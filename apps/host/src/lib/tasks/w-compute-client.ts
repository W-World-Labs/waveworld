/** W-Compute's public DTOs. Product identity is the cluster id, never the URL. */
export type ComputeAllocation = {
  name: string;
  template_id: string;
  cpu_millis: number;
  memory_mib: number;
  gpu_count: number;
  command: string[];
  datasets: { id: string; version: string }[];
  pricing_version?: string;
};
export type ComputeInstance = {
  id: string; cluster_id: string; name: string; template_id: string;
  state: string; desired: string; exit_code: number | null;
  generation: number; observed_generation: number; reserved: boolean;
};
export type ComputeQuote = {
  pricing_version: string; currency: string; enabled: boolean;
  compute_hour: { amount_micros: string; amount_decimal: string };
  storage_gib_hour_micros: number;
};

export class ComputeHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(`W-Compute HTTP ${status}: ${code}`); }
}

export class WComputeClient {
  private readonly origin: string;
  constructor(baseUrl: string, private readonly token: string, readonly clusterId: string, private readonly fetchImpl: typeof fetch = fetch) {
    const url = new URL(baseUrl);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid W-Compute API origin');
    if (!token || !clusterId) throw new Error('W-Compute credential and cluster are required');
    this.origin = url.origin;
  }

  private async request(path: string, method = 'GET', body?: string | Uint8Array, headers?: Record<string, string>): Promise<Uint8Array> {
    const response = await this.fetchImpl(this.origin + path, {
      method, redirect: 'error', cache: 'no-store',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': typeof body === 'string' ? 'application/json' : 'application/octet-stream', ...headers },
      body: body as BodyInit | undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const limit = response.ok ? 32 * 1024 * 1024 : 4096;
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('W-Compute response exceeds 32 MiB'); }
    const reader = response.body?.getReader();
    if (!reader) {
      if (!response.ok) throw new ComputeHttpError(response.status, 'request_failed');
      return new Uint8Array();
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('W-Compute response exceeds 32 MiB');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (!response.ok) {
      // Expose only known stable error codes, never upstream diagnostic text.
      let code = response.status === 404 ? 'not_found' : 'request_failed';
      try {
        const value = JSON.parse(new TextDecoder().decode(bytes)).error;
        if (['price_changed', 'idempotency_conflict'].includes(value)) code = value;
      } catch { /* Non-JSON errors retain the safe HTTP code. */ }
      throw new ComputeHttpError(response.status, code);
    }
    return bytes;
  }
  private async json<T>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.request(path, method, body === undefined ? undefined : JSON.stringify(body), headers))) as T;
  }
  private cluster(path: string) { return `/api/clusters/${encodeURIComponent(this.clusterId)}${path}`; }
  quote(allocation: ComputeAllocation) { return this.json<ComputeQuote>(this.cluster('/billing/quote'), 'POST', allocation); }
  create(allocation: ComputeAllocation, key: string) {
    return this.json<ComputeInstance>(this.cluster('/instances'), 'POST', allocation, { 'Idempotency-Key': key });
  }
  listInstances() { return this.json<ComputeInstance[]>(this.cluster('/instances')); }
  getInstance(id: string) { return this.json<ComputeInstance>(`/api/instances/${encodeURIComponent(id)}`); }
  stop(id: string) { return this.json<ComputeInstance>(`/api/instances/${encodeURIComponent(id)}/actions`, 'POST', { action: 'stop' }); }
  async putFile(id: string, name: string, bytes: Uint8Array) {
    if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('Compute file exceeds 32 MiB');
    await this.request(`/api/instances/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`, 'PUT', bytes);
  }
  getFile(id: string, name: string) { return this.request(`/api/instances/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`); }
}

export type ComputeConfig = {
  origin: string; token: string; clusterId: string; templateId: string;
  cpuMillis: number; memoryMib: number; maxWallTimeMs: number; maxConcurrent: number;
  maxHourlyMicros: string; maxStorageGibHourlyMicros: string; currency: string;
};

/** Deployment configuration; a hostname change never changes the cluster identity. */
export function getComputeConfig(env: Readonly<Record<string, string | undefined>> = process.env): ComputeConfig | null {
  if (!env.W_COMPUTE_API_URL && env.W_COMPUTE_ENABLED !== '1') return null;
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const n = env[key] ? Number(env[key]) : fallback;
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  const money = (key: string) => {
    const value = env[key]?.trim() || '0';
    if (!/^\d{1,18}$/.test(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  const currency = env.W_COMPUTE_CURRENCY?.trim() || 'CNY';
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid W_COMPUTE_CURRENCY');
  return {
    currency, origin: required('W_COMPUTE_API_URL'), token: required('W_COMPUTE_TOKEN'),
    clusterId: required('W_COMPUTE_CLUSTER_ID'), templateId: required('W_COMPUTE_TEMPLATE_ID'),
    cpuMillis: integer('W_COMPUTE_CPU_MILLIS', 1000, 100, 128000),
    memoryMib: integer('W_COMPUTE_MEMORY_MIB', 512, 128, 1048576),
    maxWallTimeMs: integer('W_COMPUTE_MAX_WALL_TIME_MS', 120000, 1000, 86400000),
    maxConcurrent: integer('W_COMPUTE_MAX_CONCURRENT', 1, 1, 16),
    maxHourlyMicros: money('W_COMPUTE_MAX_HOURLY_MICROS'),
    maxStorageGibHourlyMicros: money('W_COMPUTE_MAX_STORAGE_GIB_HOURLY_MICROS'),
  };
}

export function nativeComputeAllocation(id: string, config: ComputeConfig): ComputeAllocation {
  return { name: `waveworld-${id}`, template_id: config.templateId,
    cpu_millis: config.cpuMillis, memory_mib: config.memoryMib, gpu_count: 0, datasets: [],
    command: ['/usr/local/bin/waveworld-agent', 'execute-file', '--directory', '/w-workspace', '--job-id', id] };
}
