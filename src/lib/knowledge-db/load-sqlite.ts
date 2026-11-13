/**
 * Load better-sqlite3 from apps/host (monorepo native dep).
 * Root package does not depend on better-sqlite3 directly.
 *
 * Next.js webpack historically rewrote `import { createRequire } from 'node:module'`
 * to `void 0` inside server chunks (see `.next/server/chunks/*` →
 * `return (void 0)("better-sqlite3")`). Prefer `process.getBuiltinModule` so
 * Host `/api/v1/knowledge/*` can open SQLite under `next start`.
 */
import path from 'node:path'
import { repoRootFromHere } from './paths.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqliteDatabase = any

export type BetterSqlite3Ctor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase

type NodeRequireFn = (id: string) => unknown
type CreateRequireFn = (filename: string | URL) => NodeRequireFn

function resolveCreateRequire(): CreateRequireFn {
  // Node 20.16+ / 22: process.getBuiltinModule survives Next bundling.
  const getBuiltin = (
    process as NodeJS.Process & {
      getBuiltinModule?: (name: string) => { createRequire?: CreateRequireFn }
    }
  ).getBuiltinModule
  if (typeof getBuiltin === 'function') {
    const mod = getBuiltin('module')
    if (mod && typeof mod.createRequire === 'function') {
      return mod.createRequire.bind(mod) as CreateRequireFn
    }
  }

  // Static import may work outside Next (CLI / vitest).
  try {
    // Dynamic import of node:module is sync-unfriendly; use createRequire via eval
    // only as last resort so webpack cannot constant-fold it to undefined.
    // eslint-disable-next-line no-new-func
    const fromEval = new Function(
      'return require("node:module").createRequire',
    )() as CreateRequireFn
    if (typeof fromEval === 'function') return fromEval
  } catch {
    /* continue */
  }

  throw new Error(
    'createRequire unavailable (Node process.getBuiltinModule("module") missing)',
  )
}

/**
 * Resolve better-sqlite3 constructor from apps/host node_modules.
 * Tries monorepo root first, then process.cwd() (Host WorkingDirectory).
 */
export function loadBetterSqlite3(root = repoRootFromHere()): BetterSqlite3Ctor {
  const createRequire = resolveCreateRequire()
  const candidates = [
    path.join(root, 'apps', 'host', 'package.json'),
    path.join(root, 'ops', 'apps', 'host', 'package.json'),
    path.join(process.cwd(), 'package.json'),
    path.join(process.cwd(), 'apps', 'host', 'package.json'),
    path.join(process.cwd(), 'ops', 'apps', 'host', 'package.json'),
  ]
  const errors: string[] = []

  for (const hostPkg of candidates) {
    try {
      const require = createRequire(hostPkg)
      const mod = require('better-sqlite3') as BetterSqlite3Ctor | {
        default: BetterSqlite3Ctor
      }
      const ctor =
        typeof mod === 'function'
          ? mod
          : mod &&
              typeof mod === 'object' &&
              typeof (mod as { default?: unknown }).default === 'function'
            ? (mod as { default: BetterSqlite3Ctor }).default
            : null
      if (!ctor) {
        throw new Error('better-sqlite3 export is not a constructor')
      }
      return ctor
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${hostPkg}: ${msg}`)
    }
  }

  throw new Error(
    `better-sqlite3 not available (install apps/host deps). Tried: ${errors.join(' | ')}`,
  )
}
