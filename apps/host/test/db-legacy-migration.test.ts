import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from '@/lib/tasks/db.ts';

describe('legacy task database migration', () => {
  it('adds evidence.project_id before creating its index', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(`
        CREATE TABLE evidence (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
          artifact_id TEXT NOT NULL, sha256 TEXT NOT NULL,
          content_type TEXT NOT NULL, metadata TEXT NOT NULL,
          owner_user_id TEXT, created_at TEXT NOT NULL
        );
      `);
      assert.doesNotThrow(() => ensureSchema(sqlite));
      const columns = sqlite.pragma('table_info(evidence)') as Array<{ name: string }>;
      assert.ok(columns.some((column) => column.name === 'project_id'));
      const indexes = sqlite.pragma('index_list(evidence)') as Array<{ name: string }>;
      assert.ok(indexes.some((index) => index.name === 'evidence_project'));
    } finally {
      sqlite.close();
    }
  });
});
