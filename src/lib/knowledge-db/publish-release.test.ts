/**
 * K5: publish writes knowledge_releases (+ optional static JSON export).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildKnowledgeRelease } from '../knowledge/release.ts'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type EvidenceBinding,
  type SourceSnapshot,
} from '../knowledge/types.ts'
import {
  exportKnowledgeReleaseJson,
  persistKnowledgeReleaseToDb,
  publishKnowledgeReleaseToDb,
  upsertSourceSnapshots,
} from './publish-release.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere } from './paths.ts'

const root = repoRootFromHere()
const temps: string[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const p of temps) {
    try {
      fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(p + suffix)
      } catch {
        /* ignore */
      }
    }
  }
  temps.length = 0
  for (const d of tempDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  tempDirs.length = 0
})

function tempDb(): string {
  const p = path.join(
    os.tmpdir(),
    `waveworld-knowledge-publish-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

function tempDir(): string {
  const d = fs.mkdtempSync(
    path.join(os.tmpdir(), `waveworld-k5-export-${process.pid}-`),
  )
  tempDirs.push(d)
  return d
}

const EPOCH = '2026-08-06T04:00:00.000Z'

async function fixtureRelease() {
  const snap: SourceSnapshot = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'snap-k5-1',
    locator: 'https://doi.org/10.1000/k5-test',
    locatorKind: 'doi',
    capturedAt: EPOCH,
    contentSha256: 'a'.repeat(64),
    captureStatus: 'locator-only',
    provider: 'openalex',
    title: 'K5 fixture',
  }
  const claim: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'claim-k5-1',
    kind: 'other',
    subjectId: 'thermal-to-electric',
    statement: { note: 'k5 publish fixture' },
    state: 'released',
    createdAt: EPOCH,
    updatedAt: EPOCH,
  }
  const bind: EvidenceBinding = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'bind-k5-1',
    claimId: claim.id,
    sourceSnapshotId: snap.id,
    support: 'supports',
    locator: { path: '$.title' },
  }
  const release = await buildKnowledgeRelease({
    id: 'kr-k5-publish-fixture',
    releasedAt: EPOCH,
    claims: [claim],
    evidenceBindings: [bind],
    sourceSnapshots: [snap],
    conflictSets: [],
  })
  return { release, snap, claim, bind }
}

describe('publish-release (K5)', () => {
  it('upserts ingest snapshots without a release', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      const n = upsertSourceSnapshots(db, [
        {
          contractVersion: KNOWLEDGE_CONTRACT_VERSION,
          id: 'snap-ingest-only',
          locator: 'https://openalex.org/W1',
          locatorKind: 'url',
          capturedAt: EPOCH,
          contentSha256: 'b'.repeat(64),
          captureStatus: 'locator-only',
          provider: 'openalex',
          cursor: 'next*',
        },
      ])
      expect(n).toBe(1)
      const row = db
        .prepare(`SELECT provider, cursor FROM source_snapshots WHERE id = ?`)
        .get('snap-ingest-only') as { provider: string; cursor: string }
      expect(row.provider).toBe('openalex')
      expect(row.cursor).toBe('next*')
    } finally {
      db.close()
    }
  })

  it('writes knowledge_releases + membership; idempotent re-publish', async () => {
    const { release, claim } = await fixtureRelease()
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      const r1 = persistKnowledgeReleaseToDb(db, {
        release,
        meta: { pipeline: 'test' },
      })
      expect(r1.releaseId).toBe('kr-k5-publish-fixture')
      expect(r1.sha256).toBe(release.sha256)
      expect(r1.claimCount).toBe(1)

      const head = db
        .prepare(
          `SELECT id, sha256, state, export_relpath FROM knowledge_releases WHERE id = ?`,
        )
        .get(release.id) as {
        id: string
        sha256: string
        state: string
        export_relpath: string | null
      }
      expect(head.sha256).toBe(release.sha256)
      expect(head.state).toBe('released')
      expect(head.export_relpath).toBeNull()

      const mem = db
        .prepare(
          `SELECT claim_id FROM release_claims WHERE release_id = ?`,
        )
        .all(release.id) as Array<{ claim_id: string }>
      expect(mem.map((m) => m.claim_id)).toEqual([claim.id])

      const r2 = persistKnowledgeReleaseToDb(db, { release })
      expect(r2.sha256).toBe(r1.sha256)
      const count = db
        .prepare(`SELECT COUNT(*) AS c FROM knowledge_releases`)
        .get() as { c: number }
      expect(count.c).toBe(1)
    } finally {
      db.close()
    }
  })

  it('publishKnowledgeReleaseToDb with optional static export', async () => {
    const { release } = await fixtureRelease()
    const dbPath = tempDb()
    const exportRoot = tempDir()
    const result = await publishKnowledgeReleaseToDb(release, {
      dbPath,
      root,
      exportRoot,
      meta: { via: 'publishKnowledgeReleaseToDb' },
    })
    expect(result.dbPath).toBe(dbPath)
    expect(result.exportRelpath).toBe(
      path.posix.join(release.id, 'release.json'),
    )
    expect(result.exportFile).toBeTruthy()
    expect(fs.existsSync(result.exportFile!)).toBe(true)
    const body = JSON.parse(fs.readFileSync(result.exportFile!, 'utf8')) as {
      id: string
      sha256: string
    }
    expect(body.id).toBe(release.id)
    expect(body.sha256).toBe(release.sha256)

    const db = openKnowledgeDb({ dbPath, root, readonly: true })
    try {
      const row = db
        .prepare(
          `SELECT export_relpath, sha256 FROM knowledge_releases WHERE id = ?`,
        )
        .get(release.id) as { export_relpath: string; sha256: string }
      expect(row.export_relpath).toBe(`${release.id}/release.json`)
      expect(row.sha256).toBe(release.sha256)
    } finally {
      db.close()
    }
  })

  it('exportKnowledgeReleaseJson rejects unsafe ids', async () => {
    const { release } = await fixtureRelease()
    await expect(
      exportKnowledgeReleaseJson(tempDir(), {
        ...release,
        id: '../evil',
      }),
    ).rejects.toThrow(/unsafe release id/)
  })
})
