/**
 * Agent-side complete payload check (mirrors host validateJobResult).
 * Kept local so the agent binary does not depend on Next path aliases.
 */
import type { JobResultV1 } from '@w-sim/contracts';
import { resultBackendAllowed } from './backends/native-cuda.ts';

/** Max length for backend.id / backend.agentId identity tokens (wave32 clamp). */
export const MAX_BACKEND_IDENTITY_LEN = 128;

/**
 * ASCII control characters (U+0000–U+001F, U+007F) are not usable identity
 * tokens (wave33 residual after length clamp / trim-stable).
 */
const BACKEND_IDENTITY_CONTROL = /[\u0000-\u001F\u007F]/;

export class AgentResultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentResultValidationError';
  }
}

function assertFinite(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AgentResultValidationError(
      `${path} must be a finite number (got ${typeof value === 'number' ? value : typeof value})`
    );
  }
}

function assertOptionalFinite(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  assertFinite(value, path);
}

/** Ensure Cd/Cl and summary fields are finite before POST /complete. */
export function assertCompleteResult(result: {
  schemaVersion?: number;
  summary?: {
    steps?: number;
    cd?: number;
    cl?: number;
    wallTimeMs?: number;
    dragN?: number;
    liftN?: number;
    sideN?: number;
    reynoldsPhysical?: number;
    reynoldsLattice?: number;
    solidCells?: number;
  };
  history?: JobResultV1['history'];
  thermal?: JobResultV1['thermal'];
  lbmMassBalance?: JobResultV1['lbmMassBalance'];
  mac?: JobResultV1['mac'];
  backend?: { id?: string; agentId?: string };
  error?: string;
}, requiredBackends?: readonly string[]): void {
  if (result.schemaVersion !== 1) {
    throw new AgentResultValidationError('result.schemaVersion must be 1');
  }
  // Envelope-level error cannot settle as success (host validateJobResult parity).
  if (typeof result.error === 'string' && result.error.length > 0) {
    throw new AgentResultValidationError('result carries an error message and cannot settle as a success');
  }
  if (!result.summary) {
    throw new AgentResultValidationError('result.summary required');
  }
  // ANY-OF 语义：产出结果的 backend.id 必须是请求集合的成员（cuda 系 id
  // 满足 cuda/native-cuda/webgpu，host 执行 id 满足 cpu）——静默替换后端
  // 即使数值正确也是谎报。
  if (requiredBackends?.length && !resultBackendAllowed(result.backend?.id, requiredBackends)) {
    throw new AgentResultValidationError(
      `result backend '${result.backend?.id ?? 'none'}' is not a member of requirements.backends [${requiredBackends.join(', ')}]`,
    );
  }
  assertFinite(result.summary.steps, 'result.summary.steps');
  // Host validateJobResult rejects negative step counts (parity residual).
  if (result.summary.steps < 0) {
    throw new AgentResultValidationError('result.summary.steps must be >= 0');
  }
  // Step counts are discrete integers (wave29 residual after solidCells integer).
  if (!Number.isInteger(result.summary.steps)) {
    throw new AgentResultValidationError('result.summary.steps must be an integer');
  }
  assertFinite(result.summary.wallTimeMs, 'result.summary.wallTimeMs');
  // Negative wall clock is not a usable runtime sample (honesty residual after wave26).
  if (result.summary.wallTimeMs < 0) {
    throw new AgentResultValidationError('result.summary.wallTimeMs must be >= 0');
  }
  assertOptionalFinite(result.summary.cd, 'result.summary.cd');
  assertOptionalFinite(result.summary.cl, 'result.summary.cl');
  // Host-parity optional LBM / force KPIs (when present must be finite).
  assertOptionalFinite(result.summary.dragN, 'result.summary.dragN');
  assertOptionalFinite(result.summary.liftN, 'result.summary.liftN');
  assertOptionalFinite(result.summary.sideN, 'result.summary.sideN');
  assertOptionalFinite(result.summary.reynoldsPhysical, 'result.summary.reynoldsPhysical');
  assertOptionalFinite(result.summary.reynoldsLattice, 'result.summary.reynoldsLattice');
  assertOptionalFinite(result.summary.solidCells, 'result.summary.solidCells');
  if (result.thermal !== undefined) {
    const t = result.thermal;
    if (!t || typeof t !== 'object' || (t.mode !== 'fixed-temperature' && t.mode !== 'solid-power')) {
      throw new AgentResultValidationError('result.thermal.mode is invalid');
    }
    for (const key of ['thermalEnergyJ', 'sourceEnergyJ', 'boundaryEnergyJ', 'energyResidualJ',
      'maxAbsEnergyResidualJ', 'solidMaxC', 'fluidMaxC', 'thermalSubsteps', 'solidVolumeM3'] as const) {
      assertFinite(t[key], `result.thermal.${key}`);
    }
    if (t.sourceEnergyJ < 0 || t.maxAbsEnergyResidualJ < 0 || t.solidVolumeM3 <= 0 ||
        !Number.isSafeInteger(t.thermalSubsteps) || t.thermalSubsteps < 1 || t.solidMaxC <= -273.15 || t.fluidMaxC <= -273.15) {
      throw new AgentResultValidationError('result.thermal contains invalid physical quantities');
    }
  }
  if (result.lbmMassBalance !== undefined) {
    const m = result.lbmMassBalance;
    if (!m || typeof m !== 'object' || m.scope !== 'internal-fluid-x') {
      throw new AgentResultValidationError('result.lbmMassBalance.scope is invalid');
    }
    for (const key of ['initialMassKg', 'finalMassKg', 'inletMassKg', 'outletMassKg', 'collisionMassChangeKg',
      'balanceResidualKg', 'maxAbsStepBalanceResidualKg', 'boundaryFinalMassKg',
      'inletReconstructionMassKg', 'outletReconstructionMassKg'] as const) {
      assertFinite(m[key], `result.lbmMassBalance.${key}`);
    }
    if (m.initialMassKg <= 0 || m.finalMassKg <= 0 || m.boundaryFinalMassKg < 0 || m.maxAbsStepBalanceResidualKg < 0) {
      throw new AgentResultValidationError('result.lbmMassBalance contains invalid mass quantities');
    }
  }
  if (result.mac !== undefined) {
    if (result.mac.samplePhase !== 'before-momentum-step' || !Array.isArray(result.mac.fans) || result.mac.fans.length > 16) {
      throw new AgentResultValidationError('MAC fan readouts require a bounded list and explicit sampling phase');
    }
    result.mac.fans.forEach((fan, index) => {
      for (const key of ['plane', 'faceCount', 'areaM2', 'flowM3s', 'pressureRisePa', 'forceN'] as const) assertFinite(fan[key], `result.mac.fans[${index}].${key}`);
      if (!Number.isInteger(fan.plane) || fan.plane < 1 || !Number.isInteger(fan.faceCount) || fan.faceCount < 1 ||
          fan.areaM2 <= 0 || fan.flowM3s < 0 || fan.pressureRisePa < 0 || typeof fan.name !== 'string' || !fan.name.trim()) {
        throw new AgentResultValidationError('MAC fan readout contains invalid physical quantities');
      }
    });
  }
  // Cell counts are non-negative integers when reported (wave27 >=0; wave28 integer).
  if (result.summary.solidCells != null) {
    if (result.summary.solidCells < 0) {
      throw new AgentResultValidationError('result.summary.solidCells must be >= 0');
    }
    if (!Number.isInteger(result.summary.solidCells)) {
      throw new AgentResultValidationError('result.summary.solidCells must be an integer');
    }
  }

  if (result.history) {
    const { step, cd, cl } = result.history;
    // Path-package results may only ship step indices (no Cd/Cl series).
    if (!Array.isArray(step)) {
      throw new AgentResultValidationError('result.history.step array required');
    }
    for (let i = 0; i < step.length; i++) {
      assertFinite(step[i], `result.history.step[${i}]`);
      // Step indices are non-negative integers (wave28 >=0; wave29 integer).
      if (step[i]! < 0) {
        throw new AgentResultValidationError(
          `result.history.step[${i}] must be >= 0`,
        );
      }
      if (!Number.isInteger(step[i]!)) {
        throw new AgentResultValidationError(
          `result.history.step[${i}] must be an integer`,
        );
      }
      // History sample indices must be non-decreasing (wave29 bounds residual).
      if (i > 0 && step[i]! < step[i - 1]!) {
        throw new AgentResultValidationError(
          `result.history.step must be non-decreasing (step[${i}] < step[${i - 1}])`,
        );
      }
      // Sample index must not exceed reported step count (wave30 bounds residual).
      if (step[i]! > result.summary.steps) {
        throw new AgentResultValidationError(
          `result.history.step[${i}] must be <= summary.steps`,
        );
      }
    }
    if (cd != null || cl != null) {
      if (!Array.isArray(cd) || !Array.isArray(cl)) {
        throw new AgentResultValidationError('result.history arrays required');
      }
      if (cd.length !== step.length || cl.length !== step.length) {
        throw new AgentResultValidationError('result.history length mismatch');
      }
      for (let i = 0; i < cd.length; i++) {
        assertFinite(cd[i], `result.history.cd[${i}]`);
        assertFinite(cl[i], `result.history.cl[${i}]`);
      }
    }
  }

  // Empty / whitespace-only backend.id is not authoritative identity
  // (host validateJobResult uses trim; honesty residual wave26).
  if (typeof result.backend?.id !== 'string' || result.backend.id.trim().length === 0) {
    throw new AgentResultValidationError('result.backend.id required');
  }
  // Padded ids are not trim-stable identity tokens (wave31 residual).
  if (result.backend.id !== result.backend.id.trim()) {
    throw new AgentResultValidationError(
      'result.backend.id must not have leading/trailing whitespace',
    );
  }
  // Overlong identity is not a usable backend token (wave32 length clamp).
  if (result.backend.id.length > MAX_BACKEND_IDENTITY_LEN) {
    throw new AgentResultValidationError(
      `result.backend.id must be <= ${MAX_BACKEND_IDENTITY_LEN} characters`,
    );
  }
  // Control characters are not usable identity tokens (wave33 residual).
  if (BACKEND_IDENTITY_CONTROL.test(result.backend.id)) {
    throw new AgentResultValidationError(
      'result.backend.id must not contain control characters',
    );
  }
  // Internal whitespace (ASCII space / Unicode space) is not a usable backend
  // identity token (wave34 residual after control-char reject).
  if (/\s/.test(result.backend.id)) {
    throw new AgentResultValidationError(
      'result.backend.id must not contain whitespace',
    );
  }
  // agentId is optional; when present must be a non-empty string (host parity).
  if (
    result.backend.agentId != null &&
    (typeof result.backend.agentId !== 'string' || result.backend.agentId.trim().length === 0)
  ) {
    throw new AgentResultValidationError(
      'result.backend.agentId must be a non-empty string when set',
    );
  }
  // Padded agentId is not a trim-stable identity token (wave31 residual).
  if (
    typeof result.backend.agentId === 'string' &&
    result.backend.agentId !== result.backend.agentId.trim()
  ) {
    throw new AgentResultValidationError(
      'result.backend.agentId must not have leading/trailing whitespace',
    );
  }
  // Overlong agentId is not a usable identity token (wave32 length clamp).
  if (
    typeof result.backend.agentId === 'string' &&
    result.backend.agentId.length > MAX_BACKEND_IDENTITY_LEN
  ) {
    throw new AgentResultValidationError(
      `result.backend.agentId must be <= ${MAX_BACKEND_IDENTITY_LEN} characters`,
    );
  }
  // Control characters are not usable agentId tokens (wave33 residual).
  if (
    typeof result.backend.agentId === 'string' &&
    BACKEND_IDENTITY_CONTROL.test(result.backend.agentId)
  ) {
    throw new AgentResultValidationError(
      'result.backend.agentId must not contain control characters',
    );
  }
  // Internal whitespace is not a usable agentId token (wave34 residual).
  if (typeof result.backend.agentId === 'string' && /\s/.test(result.backend.agentId)) {
    throw new AgentResultValidationError(
      'result.backend.agentId must not contain whitespace',
    );
  }
}
