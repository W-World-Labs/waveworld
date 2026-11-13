/**
 * Knowledge source feature flag (EPIC #52 K3/K4/K9).
 *
 * `db`     — **default (K4)** Atlas/host reads Knowledge DB (knowledge.db / Host API).
 * `static` — opt-in dual-track: packaged ontology JSON/TS (seed / emergency fallback only).
 *
 * Env: KNOWLEDGE_SOURCE=static|db
 * @see docs/knowledge-db.md §5–§6
 */

export const KNOWLEDGE_SOURCE_ENV = 'KNOWLEDGE_SOURCE' as const

export type KnowledgeSource = 'static' | 'db'

export const KNOWLEDGE_SOURCES = ['static', 'db'] as const satisfies readonly KnowledgeSource[]

/**
 * Production / product default (K4): Knowledge DB is runtime authority.
 * Static ontology JSON/TS remains for seed-from-static and explicit `KNOWLEDGE_SOURCE=static`.
 */
export const DEFAULT_KNOWLEDGE_SOURCE: KnowledgeSource = 'db'

/**
 * Repo-relative static ontology paths that feed **seed only** (K1/K4/K9).
 * They are **not** production runtime authority; Host/Atlas default read path
 * is knowledge.db via `createKnowledgeAdapter()` / `/api/v1/knowledge/*`.
 * `edges.data.json` is explicitly seed-only — never sole prod truth.
 */
export const KNOWLEDGE_SEED_ONLY_STATIC_PATHS = [
  'src/data/ontology/nodes.ts',
  'src/data/ontology/edges.data.json',
  'src/data/ontology/edges.subform.data.json',
  'src/data/ontology/materials.data.json',
] as const

/** Canonical static edges file used by seed-from-static (not prod read authority). */
export const KNOWLEDGE_SEED_EDGES_DATA_PATH =
  'src/data/ontology/edges.data.json' as const

/**
 * Resolve active knowledge source from env (or injected map for tests).
 * Unknown / empty values fall back to DEFAULT_KNOWLEDGE_SOURCE (`db`).
 */
export function resolveKnowledgeSource(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): KnowledgeSource {
  const raw = (env[KNOWLEDGE_SOURCE_ENV] ?? '').trim().toLowerCase()
  if (raw === 'db' || raw === 'database' || raw === 'sqlite') return 'db'
  if (raw === 'static' || raw === 'json' || raw === 'file') return 'static'
  if (!raw) return DEFAULT_KNOWLEDGE_SOURCE
  return DEFAULT_KNOWLEDGE_SOURCE
}

export function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  return value === 'static' || value === 'db'
}
