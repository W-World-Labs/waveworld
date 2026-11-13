import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** SQLite 默认后端（无 Docker 可多进程 claim）；Postgres 可后续切换 */
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  capabilities: text('capabilities').notNull(), // JSON
  lastSeenAt: text('last_seen_at'),
  createdAt: text('created_at').notNull(),
});

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  name: text('name'),
  status: text('status').notNull(),
  priority: integer('priority').notNull().default(0),
  kind: text('kind').notNull(),
  spec: text('spec').notNull(), // JSON JobSpecV1
  result: text('result'), // JSON JobResultV1
  error: text('error'),
  createdBy: text('created_by'),
  agentId: text('agent_id'),
  projectId: text('project_id'),
  leaseExpiresAt: text('lease_expires_at'),
  attempt: integer('attempt').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  progress: text('progress'), // JSON
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  /** SHA-256 of canonical JobSpec for prior-compute reuse */
  specFingerprint: text('spec_fingerprint'),
});

/** Immutable terminal receipt for one exact Host lease attempt. */
export const jobAttemptOutcomes = sqliteTable('job_attempt_outcomes', {
  jobId: text('job_id').notNull(),
  attempt: integer('attempt').notNull(),
  agentId: text('agent_id').notNull(),
  outcome: text('outcome').notNull(), // JSON JobHostOutcome
  createdAt: text('created_at').notNull(),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  jobId: text('job_id'),
  projectId: text('project_id'),
  ownerUserId: text('owner_user_id'),
  kind: text('kind').notNull(),
  storageKey: text('storage_key').notNull(),
  contentType: text('content_type').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256'),
  createdAt: text('created_at').notNull(),
});

export const evidence = sqliteTable('evidence', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  artifactId: text('artifact_id').notNull(),
  sha256: text('sha256').notNull(),
  contentType: text('content_type').notNull(),
  metadata: text('metadata').notNull(),
  ownerUserId: text('owner_user_id'),
  projectId: text('project_id'),
  createdAt: text('created_at').notNull(),
});

export const jobAudits = sqliteTable('job_audits', {
  jobId: text('job_id').primaryKey(),
  status: text('status').notNull(),
  artifactId: text('artifact_id'),
  manifestSha256: text('manifest_sha256'),
  error: text('error'),
  updatedAt: text('updated_at').notNull(),
});
