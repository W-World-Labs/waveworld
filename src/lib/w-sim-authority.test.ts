/**
 * WaveWorld consumes @w-sim/contracts as sole JobSpec authority.
 */
import { describe, expect, it } from 'vitest'
import {
  JOB_SPEC_SCHEMA_VERSION,
  defaultJobSpec,
  isJobSpecV1,
  acceptJobSpec,
  FLUID_KIND_SHELL,
  STRUCTURAL_KIND_SHELL,
  THERMAL_KIND_SHELL,
  type JobSpecV1,
} from '@w-sim/contracts'
// Product re-export surface (tuanliu types/task)
import {
  defaultJobSpec as taskDefault,
  isJobSpecV1 as taskIsJobSpec,
  JOB_SPEC_SCHEMA_VERSION as taskSchema,
} from '../../apps/host/src/types/task'

describe('W-Sim JobSpec authority (WaveWorld)', () => {
  it('task re-export matches contracts schema version', () => {
    expect(taskSchema).toBe(JOB_SPEC_SCHEMA_VERSION)
    expect(taskSchema).toBe(1)
  })

  it('task.defaultJobSpec is accepted by acceptJobSpec', () => {
    const spec = taskDefault({ run: { maxSteps: 7 } })
    expect(taskIsJobSpec(spec)).toBe(true)
    expect(isJobSpecV1(spec)).toBe(true)
    const r = acceptJobSpec(spec)
    expect(r.ok).toBe(true)
  })

  it('primary kind shells are valid JobSpecV1', () => {
    for (const shell of [FLUID_KIND_SHELL, STRUCTURAL_KIND_SHELL, THERMAL_KIND_SHELL]) {
      const spec: JobSpecV1 = shell.fixtureSpec()
      expect(acceptJobSpec(spec).ok).toBe(true)
      expect(defaultJobSpec({ kind: shell.kind }).kind).toBe(shell.kind)
    }
  })
})
