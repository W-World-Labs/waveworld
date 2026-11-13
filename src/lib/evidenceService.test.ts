import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEvidence, importEvidence, listEvidence, prepareEvidenceImport, validateJobEvidenceReferences } from '../../apps/host/src/lib/tasks/evidence'
import { getArtifact, readArtifactBytes, saveArtifact } from '../../apps/host/src/lib/tasks/artifacts'
import { createAuditManifestArtifact, verifyAuditManifestArtifact } from '../../apps/host/src/lib/tasks/audit-manifest'
import { fingerprintJobSpec } from '../../apps/host/src/lib/tasks/job-fingerprint'
import type { JobRecord, JobResultV1, JobSpecV1 } from '../../apps/host/src/types/task'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'waveworld-evidence-'))

beforeAll(() => {
  process.env.TASK_DB_PATH = path.join(tempRoot, 'tasks.db')
  process.env.ARTIFACT_ROOT = path.join(tempRoot, 'artifacts')
})
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

describe('evidence import service', () => {
  it('persists measured bytes with an exact SHA-256 audit anchor', () => {
    const raw = Buffer.from('sample,O2,k_exc\nIr-1,0.21,1.0\n', 'utf8')
    const created = importEvidence({ kind: 'measured', title: 'Ir oxygen assay', format: 'csv', contentBase64: raw.toString('base64'), metadata: { instrument: 'oxygen probe' } }, 'user-1')
    expect(created.sha256).toBe(createHash('sha256').update(raw).digest('hex'))
    expect(getEvidence(created.id)).toMatchObject({ artifactId: created.artifactId, ownerUserId: 'user-1' })
    expect(readArtifactBytes(created.artifactId)?.data.equals(raw)).toBe(true)
  })

  it('canonicalizes literature metadata before hashing', () => {
    const first = prepareEvidenceImport({ kind: 'literature', title: 'ROS kinetics', doi: '10.1000/example', metadata: { page: 7, table: 2 } })
    const second = prepareEvidenceImport({ kind: 'literature', title: 'ROS kinetics', metadata: { table: 2, page: 7 }, doi: '10.1000/example' })
    expect(first.sha256).toBe(second.sha256)
    expect(JSON.parse(first.data.toString('utf8'))).toMatchObject({ doi: '10.1000/example', page: 7, table: 2 })
  })

  it('persists project scope on the evidence and its immutable artifact and lists only readable scopes', () => {
    const personal = importEvidence({ kind: 'literature', title: 'Personal paper', doi: '10.1/personal' }, 'scope-user')
    const project = importEvidence({ kind: 'literature', title: 'Team paper', doi: '10.1/team', projectId: 'project-a' }, 'project-editor')
    importEvidence({ kind: 'literature', title: 'Other project', doi: '10.1/other', projectId: 'project-b' }, 'other-editor')
    importEvidence({ kind: 'literature', title: 'Other personal', doi: '10.1/private' }, 'other-user')

    expect(project.projectId).toBe('project-a')
    expect(getArtifact(project.artifactId)?.meta).toMatchObject({ projectId: 'project-a', ownerUserId: 'project-editor' })
    expect(listEvidence({ ownerUserId: 'scope-user', projectIds: ['project-a'] }).map((item) => item.id).sort()).toEqual([personal.id, project.id].sort())
  })

  it('rejects malformed measured JSON before persistence', () => {
    expect(() => prepareEvidenceImport({ kind: 'measured', title: 'bad', format: 'json', contentBase64: Buffer.from('{').toString('base64') })).toThrow('measured JSON is invalid')
  })

  it('rejects missing, mismatched, cross-owner, and wrong-kind evidence anchors in queued specs', () => {
    const created = importEvidence({ kind: 'measured', title: 'Ir assay', format: 'csv', contentBase64: Buffer.from('t,T1\n0,0\n').toString('base64') }, 'user-1')
    const source: import('../../apps/host/src/types/task').PathEvidenceSource = { kind: 'measured', evidenceId: created.id, sha256: created.sha256, locator: 'row=2,column=T1' }
    const spec = {
      schemaVersion: 1, kind: 'path-experiment', parameters: {}, run: { maxSteps: 1 }, outputs: { forces: false, history: false },
      experiment: {
        experimentId: 'e', title: 'e', materials: [{ id: 'm', name: 'm', role: 'r', source }],
        steps: [{ id: 's', label: 's', mechanism: 'm', inputs: [], outputs: [], hypothesis: { status: 'candidate', description: 'h', sources: [{ kind: 'assumption', note: 'h' }] } }],
        parameters: {}, model: { id: 'x', version: '1' }, provenance: { createdAt: new Date().toISOString(), software: { name: 'x', version: '1' } },
      },
    } as import('../../apps/host/src/types/task').JobSpecV1
    expect(() => validateJobEvidenceReferences(spec, 'user-1')).not.toThrow()
    expect(() => validateJobEvidenceReferences(spec, 'user-2')).toThrow('belongs to another user')
    spec.experiment!.materials[0]!.source.sha256 = '0'.repeat(64)
    expect(() => validateJobEvidenceReferences(spec, 'user-1')).toThrow('does not match')
    spec.experiment!.materials[0]!.source.sha256 = created.sha256
    spec.experiment!.materials[0]!.source.kind = 'literature'
    expect(() => validateJobEvidenceReferences(spec, 'user-1')).toThrow('kind does not match')
  })

  it('allows a project editor to bind same-project evidence and rejects viewers and cross-project jobs', () => {
    const created = importEvidence({ kind: 'measured', title: 'Shared assay', format: 'csv', contentBase64: Buffer.from('t,T1\n0,0\n').toString('base64'), projectId: 'project-a' }, 'editor-1')
    const source = { kind: 'measured' as const, evidenceId: created.id, sha256: created.sha256 }
    const spec = {
      schemaVersion: 1, kind: 'path-experiment', parameters: {}, run: { maxSteps: 1 }, outputs: { forces: false, history: false },
      experiment: {
        experimentId: 'shared', title: 'shared', materials: [{ id: 'm', name: 'm', role: 'r', source }],
        steps: [{ id: 's', label: 's', mechanism: 'm', inputs: [], outputs: [], hypothesis: { status: 'candidate', description: 'h', sources: [{ kind: 'assumption', note: 'h' }] } }],
        parameters: {}, model: { id: 'x', version: '1' }, provenance: { createdAt: new Date().toISOString(), software: { name: 'x', version: '1' } },
      },
    } as JobSpecV1
    expect(() => validateJobEvidenceReferences(spec, 'editor-2', { projectId: 'project-a', canEditProject: true })).not.toThrow()
    expect(() => validateJobEvidenceReferences(spec, 'viewer-1', { projectId: 'project-a', canEditProject: false })).toThrow('requires project editor access')
    expect(() => validateJobEvidenceReferences(spec, 'editor-2', { projectId: 'project-b', canEditProject: true })).toThrow('different project')
    expect(() => validateJobEvidenceReferences(spec, 'editor-2')).toThrow('different project')
  })

  it('traces result through evidence and artifacts and detects byte tampering', () => {
    const raw = Buffer.from('time,T1\n0,0\n1,0.7\n')
    const evidence = importEvidence({ kind: 'measured', title: 'T1 trace', format: 'csv', contentBase64: raw.toString('base64') }, 'audit-user')
    const source = { kind: 'measured' as const, evidenceId: evidence.id, sha256: evidence.sha256, locator: 'row=3,column=T1', transform: 'identity' }
    const spec: JobSpecV1 = {
      schemaVersion: 1, kind: 'path-experiment', parameters: {}, run: { maxSteps: 1 }, outputs: { forces: false, history: false },
      experiment: {
        experimentId: 'audit-path', title: 'Audited Ir path', materials: [{ id: 'ir', name: 'Ir', role: 'sensitizer', source }],
        steps: [{ id: 'triplet', label: 'triplet', mechanism: 'ISC', inputs: ['S1'], outputs: ['T1'], hypothesis: { status: 'candidate', description: 'test', sources: [{ kind: 'assumption', note: 'test hypothesis' }] } }],
        parameters: { observedT1: { value: 0.7, source } }, model: { id: 'photosensitization-rk4', version: '1.0.0' },
        provenance: { createdAt: '2026-01-01T00:00:00.000Z', software: { name: 'WaveWorld', version: '1' } },
      },
    }
    const result: JobResultV1 = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 2 }, backend: { id: 'cpu-path-experiment', agentId: 'agent-1' }, experiment: { experimentId: 'audit-path', modelVersion: '1.0.0', outputs: { T1: { value: 0.7, source: { kind: 'computed' } } }, provenance: { computedAt: '2026-01-01T00:00:01.000Z', engineVersion: 'engine@1' } } }
    const job: JobRecord = { id: 'audit-job', name: 'audit', status: 'succeeded', priority: 0, kind: 'path-experiment', spec, result, error: null, createdBy: 'audit-user', agentId: 'agent-1', projectId: null, leaseExpiresAt: null, attempt: 0, maxAttempts: 3, progress: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', specFingerprint: fingerprintJobSpec(spec) }
    saveArtifact({ jobId: job.id, ownerUserId: job.createdBy, kind: 'solver-log', contentType: 'text/plain', data: Buffer.from('solver ok') })
    const { artifact, envelope } = createAuditManifestArtifact(job)
    expect(envelope.manifest.job.result.experiment?.outputs.T1.value).toBe(0.7)
    expect(envelope.manifest.evidence[0]).toMatchObject({ source: { evidenceId: evidence.id, locator: 'row=3,column=T1' }, artifact: { sha256: evidence.sha256 } })
    expect(envelope.manifest.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(verifyAuditManifestArtifact(artifact.id).manifestSha256).toBe(envelope.manifestSha256)

    const evidenceDisk = getArtifact(evidence.artifactId)
    expect(evidenceDisk).not.toBeNull()
    fs.writeFileSync(evidenceDisk!.absPath, Buffer.from('tampered but same?'))
    expect(() => verifyAuditManifestArtifact(artifact.id)).toThrow(/evidence artifact .* hash mismatch/)
  })

})
