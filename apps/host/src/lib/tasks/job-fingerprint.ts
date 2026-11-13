/**
 * Stable fingerprints for JobSpecV1 (prior compute reuse) and JobResultV1
 * (settlement idempotency on complete).
 *
 * Spec fingerprint: kind, workspace, model, physics params, run, outputs.
 * Excludes cosmetic name only. Same fingerprint ⇒ same intended solve.
 *
 * Result fingerprint: settlement-relevant outcome fields for applySettlement keys.
 * Same key ⇒ idempotent double-complete; different key after settled ⇒ conflict.
 */
import { createHash } from 'node:crypto';
import type { ModuleJobResult } from '../../../../../src/lib/sim/module-compute';
import type {
  JobModelRef,
  JobParameters,
  JobResultV1,
  JobRunConfig,
  JobSpecV1,
  PathExperimentSpecV1,
} from '@/types/task';

function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // null-proto：'__proto__' 作为数据键必须保留——普通对象上 out['__proto__']=v
    // 走原型 setter，key 被吞掉会让仅差该字段的 spec 指纹碰撞。
    const out: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(obj).sort()) {
      const v = obj[k];
      if (v === undefined) continue;
      out[k] = sortKeysDeep(v);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return String(value);
  }
  return value;
}

function normalizeModel(model: JobModelRef | undefined): Record<string, unknown> | null {
  if (!model) return null;
  return {
    source: model.source,
    presetId: model.presetId ?? null,
    artifactId: model.artifactId ?? null,
    url: model.url ?? null,
    referenceArea: model.referenceArea ?? null,
    referenceLength: model.referenceLength ?? null,
    ...(model.inline === undefined ? {} : { inline: sortKeysDeep(model.inline) }),
  };
}

function normalizeParameters(p: JobParameters): Record<string, unknown> {
  return sortKeysDeep({ ...p }) as Record<string, unknown>;
}

function normalizeRun(run: JobRunConfig): Record<string, unknown> {
  return sortKeysDeep({
    maxSteps: run.maxSteps,
    forceSampleEvery: run.forceSampleEvery ?? null,
    warmupSteps: run.warmupSteps ?? null,
    stopWhen: run.stopWhen ?? null,
  }) as Record<string, unknown>;
}

function normalizeExperiment(experiment: PathExperimentSpecV1 | undefined): unknown {
  if (!experiment) return null;
  // provenance 缺失/非对象时不得 TypeError——非 path 类 kind 的 experiment 字段
  // 不受 host 准入校验约束。
  const { createdAt: _createdAt, createdBy: _createdBy, notes: _notes, ...computeProvenance } =
    (experiment.provenance ?? {}) as NonNullable<PathExperimentSpecV1['provenance']>;
  return sortKeysDeep({
    ...experiment,
    // Submission time/author/notes are audit metadata, not solver inputs. Keeping
    // them in the fingerprint would defeat reuse for an otherwise identical run.
    provenance: computeProvenance,
  });
}

/**
 * Canonical object that uniquely identifies "the same compute request"
 * for reuse / skip recompute.
 */
export function canonicalizeJobSpecForFingerprint(spec: JobSpecV1): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: spec.kind,
    workspaceId: spec.workspaceId ?? 'default',
    model: normalizeModel(spec.model),
    parameters: normalizeParameters(spec.parameters ?? {}),
    run: normalizeRun(spec.run),
    outputs: sortKeysDeep(spec.outputs ?? { forces: true, history: false }),
    // Backend requirements affect which solver runs; include for safety.
    requirements: sortKeysDeep(spec.requirements ?? null),
    // Complete compute-significant path (including sources/model version) is
    // included; submission audit metadata is normalized out above.
    experiment: normalizeExperiment(spec.experiment),
  };
}

/** Hex SHA-256 of canonical JSON (stable key order). */
export function fingerprintJobSpec(spec: JobSpecV1): string {
  const canonical = canonicalizeJobSpecForFingerprint(spec);
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Canonical object identifying "the same settlement outcome" for complete
 * idempotency. Includes KPIs, artifacts, experiment outputs; excludes nothing
 * the agent can flip to forge a different scientific claim under the same key.
 */
export function canonicalizeJobResultForFingerprint(result: JobResultV1): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion: result.schemaVersion,
    summary: result.summary,
    history: result.history ?? null,
    derived: result.derived ?? null,
    thermal: result.thermal ?? null,
    ...(result.mac === undefined ? {} : { mac: result.mac }),
    ...(result.lbmMassBalance === undefined ? {} : { lbmMassBalance: result.lbmMassBalance }),
    artifacts: result.artifacts ?? null,
    experiment: result.experiment ?? null,
    ...((result as Partial<ModuleJobResult>).moduleResult === undefined ? {} : {
      moduleResult: (result as ModuleJobResult).moduleResult,
    }),
    error: result.error ?? null,
    backend: result.backend
      ? {
          id: result.backend.id,
          agentId: result.backend.agentId ?? null,
          deviceName: result.backend.deviceName ?? null,
          provenance: result.backend.provenance
            ? {
                agentBuildId: result.backend.provenance.agentBuildId,
                modelImplementationSha256: result.backend.provenance.modelImplementationSha256,
                dependencyLockSha256: result.backend.provenance.dependencyLockSha256,
              }
            : null,
        }
      : null,
    backendId: result.backendId ?? null,
  }) as Record<string, unknown>;
}

/** Hex SHA-256 of canonical result JSON (settlement fingerprint material). */
export function fingerprintJobResult(result: JobResultV1): string {
  const json = JSON.stringify(canonicalizeJobResultForFingerprint(result));
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Settlement key for applySettlement on Host complete:
 * `jobId:sha256(canonical result)`. Same payload ⇒ same key.
 */
export function settlementKeyForResult(jobId: string, result: JobResultV1): string {
  return `${jobId}:${fingerprintJobResult(result)}`;
}
