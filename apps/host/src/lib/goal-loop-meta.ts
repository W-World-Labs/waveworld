/**
 * Lightweight goal / loop harness meta for the host API.
 * Reads docs/loops + docs/exploration-goals.md headers only — never serves full
 * markdown as a product path (static files under docs/ remain the source of truth).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LoopDocMeta = {
  id: string;
  path: string;
  title: string;
  exists: boolean;
  bytes?: number;
};

export type ExplorationGoalRow = {
  id: string;
  goal: string;
  observable: string;
};

export type GoalLoopMeta = {
  ok: true;
  source: 'repo-docs';
  loops: LoopDocMeta[];
  explorationGoals: {
    path: string;
    exists: boolean;
    goals: ExplorationGoalRow[];
  };
  snapshot: {
    source: string;
    note: string;
    targets: Array<{ id: string; status: string; note: string }>;
  };
};

const LOOP_DOCS: Array<{ id: string; rel: string; title: string }> = [
  { id: 'waveworld-loop', rel: 'docs/loops/WAVEWORLD-LOOP.md', title: 'WaveWorld unified loop' },
  { id: 'kux-loop', rel: 'docs/loops/kux-loop.md', title: 'KUX loop (product background)' },
  { id: 'how-to-write-loops', rel: 'docs/loops/HOW-TO-WRITE-LOOPS.md', title: 'How to write loops' },
  {
    id: 'waveworld-loop-prompts',
    rel: 'docs/loops/waveworld-loop-prompts.md',
    title: 'Legacy loop prompts (merged)',
  },
];

function waveRoot(): string {
  // apps/host/src/lib → repo root
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../..');
}

function fileMeta(rel: string): { exists: boolean; bytes?: number } {
  const abs = path.join(waveRoot(), rel);
  try {
    const st = fs.statSync(abs);
    return { exists: st.isFile(), bytes: st.size };
  } catch {
    return { exists: false };
  }
}

function readText(rel: string): string | null {
  const abs = path.join(waveRoot(), rel);
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Parse G1… rows from docs/exploration-goals.md table. */
export function parseExplorationGoals(md: string): ExplorationGoalRow[] {
  const rows: ExplorationGoalRow[] = [];
  for (const line of md.split('\n')) {
    // | G1 | Smith chart … | Path `smith` … | `npx vitest…` |
    const m = line.match(
      /^\|\s*(G\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/
    );
    if (!m) continue;
    if (m[1] === '#') continue;
    rows.push({
      id: m[1].trim(),
      goal: m[2].trim(),
      observable: m[3].trim(),
    });
  }
  return rows;
}

/** Parse progress-snapshot target rows from kux-loop.md. */
export function parseKuxSnapshotTargets(
  md: string
): Array<{ id: string; status: string; note: string }> {
  const targets: Array<{ id: string; status: string; note: string }> = [];
  for (const line of md.split('\n')) {
    // | **C 公式人话** | ✅ | `FormulaBlock` … |
    const m = line.match(/^\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const id = m[1].trim();
    // skip header-like
    if (id === '靶' || id.toLowerCase() === 'target') continue;
    targets.push({
      id,
      status: m[2].trim(),
      note: m[3].trim().slice(0, 160),
    });
  }
  return targets;
}

export function getGoalLoopMeta(): GoalLoopMeta {
  const loops: LoopDocMeta[] = LOOP_DOCS.map((d) => {
    const meta = fileMeta(d.rel);
    return {
      id: d.id,
      path: d.rel,
      title: d.title,
      exists: meta.exists,
      bytes: meta.bytes,
    };
  });

  const explorationRel = 'docs/exploration-goals.md';
  const explorationText = readText(explorationRel);
  const goals = explorationText ? parseExplorationGoals(explorationText) : [];

  const kuxRel = 'docs/loops/kux-loop.md';
  const kuxText = readText(kuxRel);
  const targets = kuxText ? parseKuxSnapshotTargets(kuxText) : [];

  return {
    ok: true,
    source: 'repo-docs',
    loops,
    explorationGoals: {
      path: explorationRel,
      exists: explorationText != null,
      goals,
    },
    snapshot: {
      source: kuxRel,
      note: 'Progress snapshot from kux-loop.md (read-only meta; docs/ is authority).',
      targets,
    },
  };
}
