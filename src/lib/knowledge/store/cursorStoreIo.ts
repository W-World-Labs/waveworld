/**
 * #48-K Disk I/O for scheduled ingest cursor store.
 * Default path: data/knowledge-ingest/cursors.json (operator-owned).
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import {
  emptyCursorStore,
  type ScheduledCursorStore,
} from '../ingest/dualSource'
import {
  parseCursorStore,
  serializeCursorStore,
} from '../ingest/scheduledIngest'

export const DEFAULT_CURSOR_STORE_REL = path.join(
  'data',
  'knowledge-ingest',
  'cursors.json',
)

export function resolveCursorStorePath(explicit?: string): string {
  if (explicit) return path.resolve(explicit)
  if (process.env.KNOWLEDGE_INGEST_CURSORS) {
    return path.resolve(process.env.KNOWLEDGE_INGEST_CURSORS)
  }
  return path.resolve(process.cwd(), DEFAULT_CURSOR_STORE_REL)
}

export async function loadCursorStore(
  filePath?: string,
): Promise<{ path: string; store: ScheduledCursorStore }> {
  const p = resolveCursorStorePath(filePath)
  try {
    const text = await readFile(p, 'utf8')
    const store = parseCursorStore(JSON.parse(text) as unknown)
    return { path: p, store }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      return { path: p, store: emptyCursorStore() }
    }
    throw e
  }
}

export async function saveCursorStore(
  store: ScheduledCursorStore,
  filePath?: string,
): Promise<string> {
  const p = resolveCursorStorePath(filePath)
  await mkdir(path.dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  await writeFile(tmp, serializeCursorStore(store), 'utf8')
  await rename(tmp, p)
  return p
}
