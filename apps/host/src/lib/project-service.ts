import { ensureTaskEnv } from './ensure-task-env';
import type {
  CreateProjectInput,
  CreateProjectModelInput,
  ProjectDetail,
  ProjectMember,
  ProjectModelRef,
  ProjectRecord,
  ProjectSettings,
  ProjectStatus,
  ProjectVisibility,
  UpdateProjectInput,
  UpsertProjectMemberInput,
} from './project-types';

type Sqlite = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...args: unknown[]) => { changes: number };
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
};

async function db(): Promise<Sqlite> {
  ensureTaskEnv();
  const { getSqlite } = await import('@/lib/tasks/db');
  const sqlite = getSqlite() as Sqlite;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      visibility TEXT NOT NULL DEFAULT 'private',
      settings TEXT NOT NULL DEFAULT '{}',
      thumbnail_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_owner ON projects (owner_user_id, status);
    CREATE INDEX IF NOT EXISTS projects_workspace ON projects (workspace_id, status);

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      user_name TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS project_models (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      preset_id TEXT,
      artifact_id TEXT,
      url TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS project_models_project ON project_models (project_id);
    CREATE INDEX IF NOT EXISTS project_models_artifact ON project_models (artifact_id);

    -- Link jobs → projects (nullable for legacy jobs)
    -- SQLite: ADD COLUMN is idempotent only if we catch error
  `);
  try {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN project_id TEXT`);
  } catch {
    /* column exists */
  }
  try {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS jobs_project ON jobs (project_id)`);
  } catch {
    /* ok */
  }
  try {
    sqlite.exec(`ALTER TABLE artifacts ADD COLUMN project_id TEXT`);
  } catch {
    /* ok */
  }
  try {
    sqlite.exec(`ALTER TABLE artifacts ADD COLUMN owner_user_id TEXT`);
  } catch {
    /* ok */
  }
  try {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS artifacts_project ON artifacts (project_id)`);
  } catch {
    /* ok */
  }
  return sqlite;
}

function nowIso() {
  return new Date().toISOString();
}

function rowToProject(row: Record<string, unknown>): ProjectRecord {
  let settings: ProjectSettings = {};
  try {
    settings = JSON.parse(String(row.settings || '{}')) as ProjectSettings;
  } catch {
    settings = {};
  }
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    status: row.status as ProjectStatus,
    visibility: row.visibility as ProjectVisibility,
    settings,
    thumbnailUrl: row.thumbnail_url != null ? String(row.thumbnail_url) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToModel(row: Record<string, unknown>): ProjectModelRef {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(String(row.metadata || '{}')) as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    source: row.source as ProjectModelRef['source'],
    presetId: row.preset_id != null ? String(row.preset_id) : undefined,
    artifactId: row.artifact_id != null ? String(row.artifact_id) : undefined,
    url: row.url != null ? String(row.url) : undefined,
    metadata,
    isActive: Number(row.is_active) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** Can user read this project? */
export async function canAccessProject(
  projectId: string,
  userId: string,
  workspaceId: string
): Promise<'owner' | 'editor' | 'viewer' | null> {
  const sqlite = await db();
  const p = sqlite.prepare(`SELECT * FROM projects WHERE id = ? AND status != 'deleted'`).get(projectId) as
    | Record<string, unknown>
    | undefined;
  if (!p) return null;
  if (String(p.owner_user_id) === userId) return 'owner';
  const mem = sqlite
    .prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`)
    .get(projectId, userId) as { role: string } | undefined;
  if (mem) return mem.role as 'owner' | 'editor' | 'viewer';
  if (p.visibility === 'workspace' && String(p.workspace_id) === workspaceId) return 'viewer';
  return null;
}

export async function listProjectsForUser(input: {
  userId: string;
  workspaceId: string;
  status?: ProjectStatus;
  limit?: number;
}): Promise<ProjectRecord[]> {
  const sqlite = await db();
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const status = input.status ?? 'active';
  const rows = sqlite
    .prepare(
      `SELECT DISTINCT p.* FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id
       WHERE p.status = ?
         AND (
           p.owner_user_id = ?
           OR m.user_id = ?
           OR (p.visibility = 'workspace' AND p.workspace_id = ?)
         )
       ORDER BY p.updated_at DESC
       LIMIT ?`
    )
    .all(status, input.userId, input.userId, input.workspaceId, limit) as Record<string, unknown>[];

  return rows.map((r) => {
    const proj = rowToProject(r);
    const jc = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM jobs WHERE project_id = ?`)
      .get(proj.id) as { c: number };
    const mc = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM project_models WHERE project_id = ?`)
      .get(proj.id) as { c: number };
    proj.jobCount = jc?.c ?? 0;
    proj.modelCount = mc?.c ?? 0;
    return proj;
  });
}

/** IDs of every non-deleted project the principal may read, for scoped resources. */
export async function listAccessibleProjectIds(userId: string, workspaceId: string): Promise<string[]> {
  const sqlite = await db();
  const rows = sqlite.prepare(
    `SELECT DISTINCT p.id FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id
     WHERE p.status != 'deleted'
       AND (p.owner_user_id = ? OR m.user_id = ? OR (p.visibility = 'workspace' AND p.workspace_id = ?))`
  ).all(userId, userId, workspaceId) as Array<{ id: string }>;
  return rows.map((row) => String(row.id));
}

export async function createProject(
  owner: { id: string; workspaceId: string; name?: string },
  input: CreateProjectInput
): Promise<ProjectRecord> {
  const sqlite = await db();
  const name = input.name?.trim();
  if (!name) throw Object.assign(new Error('name is required'), { status: 400 });
  const id = crypto.randomUUID();
  const t = nowIso();
  const requestedWs = input.workspaceId?.trim();
  if (requestedWs && requestedWs !== owner.workspaceId) {
    throw Object.assign(new Error('workspaceId must match the authenticated session'), {
      status: 400,
    });
  }
  const workspaceId = owner.workspaceId || 'default';
  const settings = JSON.stringify(input.settings ?? {});
  sqlite
    .prepare(
      `INSERT INTO projects
       (id, owner_user_id, workspace_id, name, description, status, visibility, settings, thumbnail_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?)`
    )
    .run(
      id,
      owner.id,
      workspaceId,
      name,
      input.description?.trim() ?? '',
      input.visibility ?? 'private',
      settings,
      t,
      t
    );
  // owner as member
  sqlite
    .prepare(
      `INSERT OR REPLACE INTO project_members (project_id, user_id, role, user_name, created_at)
       VALUES (?, ?, 'owner', ?, ?)`
    )
    .run(id, owner.id, owner.name ?? null, t);

  return (await getProject(id))!;
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const sqlite = await db();
  const row = sqlite.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row || row.status === 'deleted') return null;
  const proj = rowToProject(row);
  const jc = sqlite.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE project_id = ?`).get(id) as {
    c: number;
  };
  const mc = sqlite
    .prepare(`SELECT COUNT(*) AS c FROM project_models WHERE project_id = ?`)
    .get(id) as { c: number };
  proj.jobCount = jc?.c ?? 0;
  proj.modelCount = mc?.c ?? 0;
  return proj;
}

export async function getProjectDetail(
  id: string
): Promise<ProjectDetail | null> {
  const base = await getProject(id);
  if (!base) return null;
  const sqlite = await db();
  const models = (
    sqlite
      .prepare(`SELECT * FROM project_models WHERE project_id = ? ORDER BY created_at DESC`)
      .all(id) as Record<string, unknown>[]
  ).map(rowToModel);
  const members = (
    sqlite.prepare(`SELECT * FROM project_members WHERE project_id = ?`).all(id) as Record<
      string,
      unknown
    >[]
  ).map(
    (r): ProjectMember => ({
      projectId: String(r.project_id),
      userId: String(r.user_id),
      role: r.role as ProjectMember['role'],
      userName: r.user_name != null ? String(r.user_name) : undefined,
      createdAt: String(r.created_at),
    })
  );
  const recentJobIds = (
    sqlite
      .prepare(`SELECT id FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 20`)
      .all(id) as { id: string }[]
  ).map((r) => r.id);
  return { ...base, models, members, recentJobIds };
}

function validPrincipalId(value: string): boolean {
  return /^[A-Za-z0-9_.:@-]{1,160}$/.test(value);
}

/** Project membership is owner-administered; editors cannot escalate ACLs. */
export async function upsertProjectMember(
  projectId: string,
  actorUserId: string,
  input: UpsertProjectMemberInput
): Promise<ProjectMember> {
  const sqlite = await db();
  const project = sqlite.prepare(`SELECT owner_user_id, status FROM projects WHERE id = ?`).get(projectId) as
    | { owner_user_id: string; status: string }
    | undefined;
  if (!project || project.status === 'deleted') throw Object.assign(new Error('project not found'), { status: 404 });
  if (project.owner_user_id !== actorUserId) throw Object.assign(new Error('only owner can manage project members'), { status: 403 });
  const userId = input.userId?.trim();
  if (!userId || !validPrincipalId(userId)) throw Object.assign(new Error('valid userId required'), { status: 400 });
  if (userId === project.owner_user_id) throw Object.assign(new Error('project owner role cannot be changed'), { status: 400 });
  if (input.role !== 'editor' && input.role !== 'viewer') throw Object.assign(new Error('role must be editor or viewer'), { status: 400 });
  const createdAt = nowIso();
  sqlite.prepare(
    `INSERT INTO project_members (project_id, user_id, role, user_name, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET role=excluded.role, user_name=excluded.user_name`
  ).run(projectId, userId, input.role, input.userName?.trim() || null, createdAt);
  sqlite.prepare(`UPDATE projects SET updated_at=? WHERE id=?`).run(createdAt, projectId);
  const row = sqlite.prepare(`SELECT * FROM project_members WHERE project_id=? AND user_id=?`).get(projectId, userId) as Record<string, unknown>;
  return {
    projectId: String(row.project_id), userId: String(row.user_id), role: row.role as ProjectMember['role'],
    userName: row.user_name == null ? undefined : String(row.user_name), createdAt: String(row.created_at),
  };
}

export async function removeProjectMember(projectId: string, actorUserId: string, userId: string): Promise<boolean> {
  const sqlite = await db();
  const project = sqlite.prepare(`SELECT owner_user_id, status FROM projects WHERE id = ?`).get(projectId) as
    | { owner_user_id: string; status: string }
    | undefined;
  if (!project || project.status === 'deleted') return false;
  if (project.owner_user_id !== actorUserId) throw Object.assign(new Error('only owner can manage project members'), { status: 403 });
  if (userId === project.owner_user_id) throw Object.assign(new Error('project owner cannot be removed'), { status: 400 });
  const result = sqlite.prepare(`DELETE FROM project_members WHERE project_id=? AND user_id=?`).run(projectId, userId);
  if (result.changes) sqlite.prepare(`UPDATE projects SET updated_at=? WHERE id=?`).run(nowIso(), projectId);
  return result.changes > 0;
}

export async function updateProject(
  id: string,
  ownerUserId: string,
  input: UpdateProjectInput
): Promise<ProjectRecord | null> {
  const role = await canAccessProject(id, ownerUserId, '');
  // re-check with workspace later; for update need editor+
  const sqlite = await db();
  const existing = sqlite.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing || existing.status === 'deleted') return null;
  const isOwner = String(existing.owner_user_id) === ownerUserId;
  const mem = sqlite
    .prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`)
    .get(id, ownerUserId) as { role: string } | undefined;
  if (!isOwner && mem?.role !== 'editor' && mem?.role !== 'owner') {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  void role;

  // Deletion changes access to every project resource and remains exclusive
  // to deleteProject's owner-only authorization path.
  if (input.status !== undefined && input.status !== 'active' && input.status !== 'archived') {
    throw Object.assign(new Error('status must be active or archived; use DELETE to delete a project'), { status: 400 });
  }

  const t = nowIso();
  const name = input.name?.trim() ?? String(existing.name);
  const description =
    input.description !== undefined ? input.description.trim() : String(existing.description ?? '');
  const status = input.status ?? String(existing.status);
  const visibility = input.visibility ?? String(existing.visibility);
  const settings =
    input.settings !== undefined
      ? JSON.stringify(input.settings)
      : String(existing.settings ?? '{}');
  const thumb =
    input.thumbnailUrl !== undefined
      ? input.thumbnailUrl
      : existing.thumbnail_url != null
        ? String(existing.thumbnail_url)
        : null;

  sqlite
    .prepare(
      `UPDATE projects SET name=?, description=?, status=?, visibility=?, settings=?, thumbnail_url=?, updated_at=?
       WHERE id=?`
    )
    .run(name, description, status, visibility, settings, thumb, t, id);

  return getProject(id);
}

export async function deleteProject(id: string, userId: string): Promise<boolean> {
  const sqlite = await db();
  const existing = sqlite.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return false;
  if (String(existing.owner_user_id) !== userId) {
    throw Object.assign(new Error('only owner can delete project'), { status: 403 });
  }
  const t = nowIso();
  sqlite.prepare(`UPDATE projects SET status='deleted', updated_at=? WHERE id=?`).run(t, id);
  return true;
}

export async function addProjectModel(
  projectId: string,
  userId: string,
  input: CreateProjectModelInput
): Promise<ProjectModelRef> {
  const { allowOpenArtifactAccess } = await import('./tasks/artifacts');
  const sqlite = await db();
  const p = sqlite.prepare(`SELECT * FROM projects WHERE id = ? AND status != 'deleted'`).get(projectId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw Object.assign(new Error('project not found'), { status: 404 });
  const isOwner = String(p.owner_user_id) === userId;
  const mem = sqlite
    .prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`)
    .get(projectId, userId) as { role: string } | undefined;
  if (!isOwner && mem?.role !== 'editor' && mem?.role !== 'owner') {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  if (!input.name?.trim()) throw Object.assign(new Error('name required'), { status: 400 });
  if (!['preset', 'artifact', 'url'].includes(input.source)) {
    throw Object.assign(new Error('invalid source'), { status: 400 });
  }

  // source=artifact must bind an artifact that belongs to this project (no cross-project attach).
  let artifactId: string | null = input.artifactId ?? null;
  if (input.source === 'artifact') {
    if (!artifactId?.trim()) {
      throw Object.assign(new Error('artifactId required when source=artifact'), { status: 400 });
    }
    artifactId = artifactId.trim();
    // Ensure columns exist for older DBs
    try {
      sqlite.exec(`ALTER TABLE artifacts ADD COLUMN project_id TEXT`);
    } catch {
      /* ok */
    }
    const art = sqlite.prepare(`SELECT id, project_id, owner_user_id FROM artifacts WHERE id = ?`).get(artifactId) as
      | { id: string; project_id: string | null; owner_user_id: string | null }
      | undefined;
    if (!art) {
      throw Object.assign(new Error('artifact not found'), { status: 404 });
    }
    const artProject = art.project_id != null ? String(art.project_id) : null;
    if (artProject && artProject !== projectId) {
      throw Object.assign(new Error('artifact belongs to a different project'), { status: 403 });
    }
    // Moving a personal artifact changes its read ACL. Editing the target
    // project does not authorize taking another user's private upload.
    if (!artProject) {
      if (art.owner_user_id ? art.owner_user_id !== userId : !allowOpenArtifactAccess()) {
        throw Object.assign(new Error('artifact owner access required'), { status: 403 });
      }
      const moved = sqlite.prepare(
        `UPDATE artifacts SET project_id = ? WHERE id = ? AND project_id IS NULL AND owner_user_id IS ?`
      ).run(projectId, artifactId, art.owner_user_id);
      if (moved.changes !== 1) {
        throw Object.assign(new Error('artifact scope changed; retry the request'), { status: 409 });
      }
    }
  }
  if (input.source === 'preset' && !input.presetId?.trim()) {
    throw Object.assign(new Error('presetId required when source=preset'), { status: 400 });
  }
  if (input.source === 'url' && !input.url?.trim()) {
    throw Object.assign(new Error('url required when source=url'), { status: 400 });
  }

  const id = crypto.randomUUID();
  const t = nowIso();
  if (input.isActive) {
    sqlite.prepare(`UPDATE project_models SET is_active=0 WHERE project_id=?`).run(projectId);
  }
  sqlite
    .prepare(
      `INSERT INTO project_models
       (id, project_id, name, source, preset_id, artifact_id, url, metadata, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      projectId,
      input.name.trim(),
      input.source,
      input.presetId ?? null,
      artifactId,
      input.url ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.isActive ? 1 : 0,
      t,
      t
    );
  sqlite.prepare(`UPDATE projects SET updated_at=? WHERE id=?`).run(t, projectId);
  const row = sqlite.prepare(`SELECT * FROM project_models WHERE id=?`).get(id) as Record<
    string,
    unknown
  >;
  return rowToModel(row);
}

export async function removeProjectModel(
  projectId: string,
  modelId: string,
  userId: string
): Promise<boolean> {
  const sqlite = await db();
  const p = sqlite.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as
    | Record<string, unknown>
    | undefined;
  if (!p || p.status === 'deleted') return false;
  const isOwner = String(p.owner_user_id) === userId;
  const mem = sqlite
    .prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`)
    .get(projectId, userId) as { role: string } | undefined;
  if (!isOwner && mem?.role !== 'editor' && mem?.role !== 'owner') {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  const r = sqlite
    .prepare(`DELETE FROM project_models WHERE id=? AND project_id=?`)
    .run(modelId, projectId);
  return r.changes > 0;
}

/** Attach an existing job to a project (owner/editor only). */
export async function attachJobToProject(
  projectId: string,
  jobId: string,
  userId: string
): Promise<boolean> {
  const sqlite = await db();
  const p = sqlite.prepare(`SELECT * FROM projects WHERE id = ? AND status != 'deleted'`).get(projectId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw Object.assign(new Error('project not found'), { status: 404 });
  const isOwner = String(p.owner_user_id) === userId;
  const mem = sqlite
    .prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`)
    .get(projectId, userId) as { role: string } | undefined;
  if (!isOwner && mem?.role !== 'editor' && mem?.role !== 'owner') {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  const job = sqlite.prepare(`SELECT id, created_by, project_id FROM jobs WHERE id = ?`).get(jobId) as { id: string; created_by: string | null; project_id: string | null } | undefined;
  if (!job) throw Object.assign(new Error('job not found'), { status: 404 });
  if (job.project_id && job.project_id !== projectId) {
    throw Object.assign(new Error('job already belongs to a different project'), { status: 403 });
  }
  if (!job.project_id && job.created_by !== userId) {
    throw Object.assign(new Error('only the job creator may attach an unscoped job'), { status: 403 });
  }
  sqlite.prepare(`UPDATE jobs SET project_id = ? WHERE id = ?`).run(projectId, jobId);
  sqlite.prepare(`UPDATE projects SET updated_at=? WHERE id=?`).run(nowIso(), projectId);
  return true;
}

export async function listJobsForProject(projectId: string): Promise<unknown[]> {
  const sqlite = await db();
  return sqlite
    .prepare(`SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(projectId);
}
