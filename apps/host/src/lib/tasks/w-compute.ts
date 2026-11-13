import { randomUUID } from 'node:crypto';
import { MAC_3D_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, LBM_THERMAL_FEATURES } from '@w-sim/contracts';
import { getSqlite, withTransaction } from './db';
import { claimJob, completeJob, failJob, getJob, heartbeatJob } from './service';
import { isTerminalStatus } from '@/types/task';
import type { ComputeJobFile, ComputeResultFile } from '../../types/compute';
import { ComputeHttpError, WComputeClient, getComputeConfig, type ComputeAllocation, type ComputeConfig, type ComputeInstance } from './w-compute-client';
import { prepareComputeLbm, storeComputeFlow, expectedComputeFlowSteps } from './compute-lbm';
import { prepareComputeMac, storeComputeMacFlow, expectedComputeMacSteps } from './compute-mac';
import { MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SNAPSHOT_CONTENT_TYPE } from '../../../../lab/src/lib/cfd/mac-flow-snapshot';
import { isNativeAlgorithmInput, readModuleJobInput, type ModuleComputeInput } from '../../../../../src/lib/sim/module-compute';
import { prepareParticleInput } from '../../../../../src/lib/sim/particles';
import { prepareMdInput } from '../../../../../src/lib/sim/md';
import { prepareFdtdInput, type FdtdScene } from '../../../../../src/lib/sim/fdtd';
import { SpecValidationError } from './validate-spec';
import { readArtifactBytes } from './artifacts';
import { FLOW_SNAPSHOT_KIND, flowSnapshotContentType, MAX_FLOW_SNAPSHOT_BYTES } from '../../../../lab/src/lib/cfd/flow-snapshot';
import { captureRadarException, withRadarOperation } from '../radar-telemetry';

type ComputeRun = {
  job_id: string; cluster_id: string; allocation: string; max_wall_time_ms: number;
  instance_id: string | null; phase: string; deadline_ms: number; create_attempts: number;
  failures: number; lock_owner: string | null; lock_until_ms: number; error: string | null;
  input_json: string | null;
};
const agentId = (id: string) => `compute-${id}`;
const safeError = (error: unknown) => error instanceof ComputeHttpError ? error.message : 'W-Compute connection or result validation failed';
type LegacyFdtdInput = Extract<ModuleComputeInput, { module: 'fdtd'; scene: FdtdScene }>;
function isLegacyFdtdInput(input: ModuleComputeInput): input is LegacyFdtdInput {
  return input.module === 'fdtd' && !isNativeAlgorithmInput(input);
}

/** Durable phases and a DB lease allow multiple Host processes and crash recovery. */
export async function reconcileComputeJobs(config: ComputeConfig, client = new WComputeClient(config.origin, config.token, config.clusterId)): Promise<void> {
  const sqlite = getSqlite(), owner = randomUUID();
  const pending = sqlite.prepare(`SELECT job_id FROM compute_runs WHERE cluster_id = ? AND phase != 'stopped'
    AND lock_until_ms <= ? ORDER BY CASE WHEN phase = 'queued' THEN 1 ELSE 0 END, updated_at LIMIT 32`)
    .all(config.clusterId, Date.now()) as { job_id: string }[];
  for (const { job_id: id } of pending) {
    const row = withTransaction(db => {
      const candidate = db.prepare('SELECT * FROM compute_runs WHERE job_id = ? AND lock_until_ms <= ?').get(id, Date.now()) as ComputeRun | undefined;
      if (!candidate) return null;
      const job = getJob(id);
      if (!job) return null;
      if (candidate.phase === 'queued' && !isTerminalStatus(job.status)) {
        const active = db.prepare("SELECT count(*) AS n FROM compute_runs WHERE cluster_id = ? AND phase NOT IN ('queued', 'stopped')").get(config.clusterId) as { n: number };
        if (active.n >= config.maxConcurrent && Date.now() < candidate.deadline_ms) return null;
        const claimed = claimJob({ jobId: id, agentId: agentId(id), managedCompute: true,
          workspaceId: job.spec.workspaceId ?? 'default', capabilities: { kinds: ['waveworld-module', 'lbm-d3q19', 'mac-3d'], backends: ['cpu'], thermal: true, fan: true, features: [MAC_3D_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, ...LBM_THERMAL_FEATURES] } });
        if (!claimed) {
          // 预留与能力不再匹配（如后端要求漂移或已被外部领取）：释放预留让
          // job 回到普通队列，而不是 throw——那会卡住整轮 reconcile。
          db.prepare('DELETE FROM compute_runs WHERE job_id = ?').run(id);
          return null;
        }
        candidate.phase = 'quoting';
      }
      db.prepare('UPDATE compute_runs SET phase = ?, lock_owner = ?, lock_until_ms = ? WHERE job_id = ?')
        .run(candidate.phase, owner, Date.now() + 120000, id);
      return candidate;
    });
    if (!row) continue;
    const save = (changes: Partial<ComputeRun>) => {
      const keys = Object.keys(changes) as (keyof ComputeRun)[];
      if (!sqlite.prepare(`UPDATE compute_runs SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE job_id = ? AND lock_owner = ?`)
        .run(...keys.map(k => changes[k]), new Date().toISOString(), id, owner).changes) throw new Error('Compute worker lease lost');
      Object.assign(row, changes);
    };
    const fail = (message: string) => {
      failJob({ jobId: id, agentId: agentId(id), error: message, retryable: false });
      save({ phase: 'stopping', error: message });
    };
    const deadlineExceeded = () => {
      if (Date.now() < row.deadline_ms) return false;
      fail('W-Compute job exceeded its queue and execution deadline');
      return true;
    };
    const owned = (instance: ComputeInstance) => {
      const allocation = JSON.parse(row.allocation) as ComputeAllocation;
      if (!instance || typeof instance.id !== 'string' || instance.cluster_id !== row.cluster_id ||
          instance.name !== allocation.name || instance.template_id !== allocation.template_id) throw new Error('Unexpected compute instance');
      return instance;
    };
    try {
      const job = getJob(id)!;
      if (isTerminalStatus(job.status)) save({ phase: 'stopping' });
      else if (deadlineExceeded()) { /* failure is durable; continue instance cleanup below */ }
      else heartbeatJob({ jobId: id, agentId: agentId(id) });

      if (row.phase === 'stopping') {
        if (!row.instance_id) {
          if (row.create_attempts === 0) { save({ phase: 'stopped' }); continue; }
          // A lost create response is not proof that no billable instance exists.
          const match = (await withRadarOperation('wcompute.stop.inspect', () => client.listInstances()))
            .find(i => i.name === JSON.parse(row.allocation).name);
          if (match) save({ instance_id: owned(match).id });
          else { save({ error: 'Creation outcome unresolved; instance cleanup requires reconciliation' }); continue; }
        }
        let instance: ComputeInstance;
        try {
          instance = owned(await withRadarOperation('wcompute.stop.inspect', () => client.getInstance(row.instance_id!),
            error => error instanceof ComputeHttpError && error.status === 404));
        } catch (error) {
          // A definitive 404 means no billable instance remains on the cluster,
          // so cleanup is complete. Unlike an unreachable node, this records an
          // honest terminal state: the run ends without claiming an observed stop.
          if (error instanceof ComputeHttpError && error.status === 404) {
            save({ phase: 'stopped', error: 'Compute instance was already absent from the cluster; its shutdown was not observed' });
            continue;
          }
          throw error;
        }
        if (['stopped', 'deleted'].includes(instance.state) && !instance.reserved && instance.observed_generation >= instance.generation) {
          save({ phase: 'stopped', error: null });
        } else if (instance.desired !== 'stopped' && instance.desired !== 'deleted') {
          await withRadarOperation('wcompute.stop.request', () => client.stop(instance.id));
        }
        continue;
      }
      if (row.phase === 'quoting') {
        if (!row.input_json) {
          const envelope: ComputeJobFile = { schemaVersion: 1, jobId: id, spec: job.spec, maxWallTimeMs: row.max_wall_time_ms, inputs: [] };
          if (job.kind === 'mac-3d') {
            const { mac, mask } = prepareComputeMac(job);
            const allocation = JSON.parse(row.allocation) as ComputeAllocation;
            const n = mac.nx * mac.ny * mac.nz;
            const faces = (mac.nx + 1) * mac.ny * mac.nz + mac.nx * (mac.ny + 1) * mac.nz + mac.nx * mac.ny * (mac.nz + 1);
            const bytes = 24 * faces + n * (mac.thermal ? 121 : 89) + 32 * 1024 * 1024;
            if (bytes > allocation.memory_mib * 1024 * 1024) { fail('Configured instance memory is too small for this MAC grid'); continue; }
            envelope.mac = mac;
            envelope.inputs = [{ artifactId: mask.id, name: 'flags.bin', bytes: mask.bytes, sha256: mask.sha256! }];
          } else if (job.kind === 'lbm-d3q19') {
            const { lbm, mask } = prepareComputeLbm(job);
            const allocation = JSON.parse(row.allocation) as ComputeAllocation;
            if (mask.bytes * ((lbm.thermal ? 236 : 200) + (job.spec.outputs.fields?.includes('pressure') ? 8 : 0)) + 32 * 1024 * 1024 > allocation.memory_mib * 1024 * 1024) {
              fail('Configured instance memory is too small for this LBM grid'); continue;
            }
            envelope.lbm = lbm;
            envelope.inputs = [{ artifactId: mask.id, name: 'flags.bin', bytes: mask.bytes, sha256: mask.sha256! }];
          } else {
            if (isNativeAlgorithmInput(job.spec.model?.inline)) {
              throw new SpecValidationError('Native algorithm operations must use the native W-Sim module backend, not managed W-Compute');
            }
            const input = readModuleJobInput(job.spec);
            if (isLegacyFdtdInput(input)) envelope.fdtd = prepareFdtdInput(input.scene);
            if (input.module === 'md') envelope.md = prepareMdInput(input.scene);
            if (input.module === 'particles') envelope.md = prepareParticleInput(input.scene);
          }
          save({ input_json: JSON.stringify(envelope) });
        }
        const allocation = JSON.parse(row.allocation) as ComputeAllocation;
        const quote = await withRadarOperation('wcompute.quote', () => client.quote(allocation));
        if (typeof quote.pricing_version !== 'string' || typeof quote.enabled !== 'boolean' ||
            !/^\d{1,18}$/.test(quote.compute_hour?.amount_micros) || !Number.isSafeInteger(quote.storage_gib_hour_micros) || quote.storage_gib_hour_micros < 0) throw new Error('Invalid quote');
        if (quote.enabled && (quote.currency !== config.currency || BigInt(quote.compute_hour.amount_micros) > BigInt(config.maxHourlyMicros) || BigInt(quote.storage_gib_hour_micros) > BigInt(config.maxStorageGibHourlyMicros))) {
          fail('W-Compute quote exceeds configured compute or persistent-storage price limit'); continue;
        }
        save({ allocation: JSON.stringify({ ...allocation, pricing_version: quote.pricing_version }), phase: 'ready', failures: 0, error: null });
      } else if (row.phase === 'ready' || row.phase === 'creating') {
        if (row.create_attempts >= 3) { fail('W-Compute creation outcome uncertain after two retries'); continue; }
        save({ phase: 'creating', create_attempts: row.create_attempts + 1 });
        const instance = owned(await withRadarOperation('wcompute.create', () => client.create(JSON.parse(row.allocation), id)));
        save({ instance_id: instance.id, phase: 'staging', failures: 0, error: null });
      } else if (row.phase === 'staging') {
        const instance = owned(await withRadarOperation('wcompute.stage.instance', () => client.getInstance(row.instance_id!)));
        if (['error', 'exited', 'stopped', 'deleted'].includes(instance.state)) { fail('Compute instance exited before receiving input'); continue; }
        if (instance.state !== 'running') continue;
        if (isTerminalStatus(getJob(id)!.status)) { save({ phase: 'stopping' }); continue; }
        // Earlier wave/heat runs may have reached staging before input persistence existed.
        const envelope: ComputeJobFile = row.input_json ? JSON.parse(row.input_json) :
          { schemaVersion: 1, jobId: id, spec: job.spec, maxWallTimeMs: row.max_wall_time_ms, inputs: [] };
        if (job.kind === 'mac-3d' && !envelope.mac) throw new Error('Missing prepared MAC input');
        if (job.kind === 'lbm-d3q19' && !envelope.lbm) throw new Error('Missing prepared LBM input');
        if (job.kind === 'waveworld-module' && (job.spec.parameters as Record<string, unknown>).module === 'fdtd' && !envelope.fdtd) throw new Error('Missing prepared FDTD input');
        if (job.kind === 'waveworld-module' && ['md', 'particles'].includes(String((job.spec.parameters as Record<string, unknown>).module)) && !envelope.md) throw new Error('Missing prepared MD input');
        for (const file of envelope.inputs) {
          const input = readArtifactBytes(file.artifactId);
          if (!input || input.meta.jobId !== id || input.meta.bytes !== file.bytes || input.meta.sha256 !== file.sha256) throw new Error('Compute input is missing or corrupt');
          await withRadarOperation('wcompute.stage.upload', () => client.putFile(instance.id, file.name, input.data));
        }
        if (isTerminalStatus(getJob(id)!.status)) { save({ phase: 'stopping' }); continue; }
        // job.json is the commit marker, uploaded only after every input is durable.
        await withRadarOperation('wcompute.stage.commit', () =>
          client.putFile(instance.id, 'job.json', new TextEncoder().encode(JSON.stringify(envelope))));
        save({ phase: 'running', failures: 0, error: null });
      } else if (row.phase === 'running' || row.phase === 'collecting') {
        let bytes: Uint8Array;
        try {
          bytes = await withRadarOperation('wcompute.run.poll', () => client.getFile(row.instance_id!, 'result.json'),
            error => error instanceof ComputeHttpError && error.status === 404);
        }
        catch (error) {
          if (!(error instanceof ComputeHttpError) || error.status !== 404) throw error;
          if (row.phase === 'collecting') { fail('Compute instance ended without a result file'); continue; }
          const instance = owned(await withRadarOperation('wcompute.run.poll', () => client.getInstance(row.instance_id!)));
          // The process may commit result.json between the GET and its exit report.
          save({ phase: ['exited', 'error', 'stopped', 'deleted'].includes(instance.state) ? 'collecting' : 'running', failures: 0, error: null });
          continue;
        }
        const result = JSON.parse(new TextDecoder().decode(bytes)) as ComputeResultFile;
        if (result.schemaVersion !== 1 || result.jobId !== id || !Array.isArray(result.files) || result.files.length > 4096 || !['succeeded', 'failed'].includes(result.status)) throw new Error('Invalid compute result envelope');
        if (result.status === 'failed') { fail(typeof result.error === 'string' ? result.error.slice(0, 512) : 'Native computation failed'); continue; }
        if (!result.result) throw new Error('Missing compute result');
        const needsFlow = ['lbm-d3q19', 'mac-3d'].includes(job.kind) && !!job.spec.outputs.fields?.length;
        if (!needsFlow && result.files.length !== 0) throw new Error('Unexpected compute output files');
        if (needsFlow) {
          const input = JSON.parse(row.input_json!) as ComputeJobFile;
          const mac = job.kind === 'mac-3d';
          if (mac ? !input.mac : !input.lbm) throw new Error('Missing prepared compute grid');
          const steps = mac ? expectedComputeMacSteps(job, result.result.summary.steps, input.mac!) : expectedComputeFlowSteps(job, result.result.summary.steps, input.lbm!);
          const kind = mac ? MAC_FLOW_SNAPSHOT_KIND : FLOW_SNAPSHOT_KIND;
          const contentType = mac ? MAC_FLOW_SNAPSHOT_CONTENT_TYPE : flowSnapshotContentType({ ...(job.spec.outputs.fields?.includes('pressure') ? { hasPressure: true } : {}) });
          if (result.files.length !== steps.length) throw new Error('Unexpected compute output frames');
          let totalBytes = 0;
          for (let index = 0; index < result.files.length; index++) {
            const file = result.files[index], step = steps[index];
            const name = index === steps.length - 1 ? 'flow.bin' : `flow-${step}.bin`;
            if (file.name !== name || (file.step === undefined ? mac || (job.spec.outputs.fieldFrames ?? 1) > 1 : file.step !== step) ||
                file.kind !== kind || file.contentType !== contentType ||
                !Number.isSafeInteger(file.bytes) || file.bytes < 32 || file.bytes > MAX_FLOW_SNAPSHOT_BYTES) throw new Error('Invalid compute flow manifest');
            totalBytes += file.bytes;
          }
          if (totalBytes > 256 * 1024 * 1024) throw new Error('Compute flow history exceeds byte limit');
          result.result.artifacts = [];
          for (let index = 0; index < result.files.length; index++) {
            if (deadlineExceeded()) break;
            // Each bounded transfer makes progress; keep both leases live while
            // collecting a trajectory that can outlast one lease interval.
            save({ lock_until_ms: Date.now() + 120000 });
            if (!heartbeatJob({ jobId: id, agentId: agentId(id) })) throw new Error('Compute job lease lost while collecting frames');
            const file = result.files[index];
            const data = await withRadarOperation('wcompute.collect.download', () => client.getFile(row.instance_id!, file.name));
            if (data.length !== file.bytes) throw new Error('Truncated compute output');
            if (isTerminalStatus(getJob(id)!.status) || deadlineExceeded()) break;
            result.result.artifacts.push(mac ? storeComputeMacFlow(job, data, steps[index], input.mac!, input.inputs[0].artifactId) :
              storeComputeFlow(job, data, steps[index], input.lbm!, input.inputs[0].artifactId));
          }
          if (isTerminalStatus(getJob(id)!.status)) { save({ phase: 'stopping' }); continue; }
        }
        if (deadlineExceeded()) continue;
        // Reassert controller ownership after the last awaited transfer, then
        // settle synchronously so a stale collector cannot publish success.
        save({ lock_until_ms: Date.now() + 120000 });
        // Existing settlement validates field statistics and saves under the job's owner/project.
        const completed = completeJob({ jobId: id, agentId: agentId(id), result: result.result });
        if (completed?.status !== 'succeeded') throw new Error('Compute result was not settled');
        save({ phase: 'stopping', failures: 0 });
      }
    } catch (error) {
      captureRadarException(error);
      const message = safeError(error);
      if (row.phase === 'stopping') save({ error: message });
      else if (error instanceof SpecValidationError) fail(error.message);
      else if (error instanceof ComputeHttpError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
        // A definitive create rejection has no new instance to clean up. Idempotency conflicts remain uncertain.
        if (row.phase === 'creating' && (error.code === 'price_changed' || (error.status !== 409 && row.create_attempts === 1))) save({ create_attempts: 0 });
        fail(message);
      } else if (row.failures >= 2) fail(message);
      else save({ failures: row.failures + 1, error: message });
    } finally {
      // RPCs have 30 s deadlines and at most two retries across reconciliation rounds.
      // Cleanup remains durable and keeps reconciling; an unreachable node is never reported stopped.
      sqlite.prepare('UPDATE compute_runs SET lock_owner = NULL, lock_until_ms = ? WHERE job_id = ? AND lock_owner = ?')
        .run(Date.now() + (row.error ? 10000 : 1000), id, owner);
    }
  }
}

/**
 * Honest terminal state for reservations no reconciler will service. A row
 * that never reached instance creation cannot back a billable instance, so
 * its job fails visibly instead of queueing forever behind a compute_runs row
 * that also blocks external claim. Rows that may back a live instance keep
 * their phase so a re-enabled reconciler can resume instance cleanup, and
 * unexpired locks are respected for peers that still have W-Compute enabled.
 */
export function finalizeOrphanedComputeRuns(): number {
  const t = new Date().toISOString(), now = Date.now();
  const orphans = `SELECT job_id FROM compute_runs WHERE phase != 'stopped'
    AND instance_id IS NULL AND create_attempts = 0 AND lock_until_ms <= ?`;
  return withTransaction(db => {
    db.prepare(`UPDATE jobs SET status = 'failed', error = ?, agent_id = NULL, lease_expires_at = NULL,
      progress = NULL, finished_at = ?, updated_at = ?
      WHERE status IN ('queued', 'leased', 'running') AND id IN (${orphans})`)
      .run('W-Compute was disabled before the managed run started', t, t, now);
    return db.prepare(`UPDATE compute_runs SET phase = 'stopped', error = ?, updated_at = ?
      WHERE job_id IN (${orphans})`)
      .run('W-Compute was disabled before an instance was allocated; no compute work was performed', t, now);
  }).changes;
}

/** One loop per Host process. DB leases coordinate workers; no global singleton. */
export function startComputeReconciler(): () => void {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, lastError = '';
  const tick = async () => {
    try {
      const config = getComputeConfig();
      if (config) await reconcileComputeJobs(config); else finalizeOrphanedComputeRuns();
      lastError = '';
    } catch (error) {
      const message = safeError(error);
      if (message !== lastError) console.error(message);
      lastError = message;
    } finally {
      if (!stopped) { timer = setTimeout(tick, 2000); timer.unref(); }
    }
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
