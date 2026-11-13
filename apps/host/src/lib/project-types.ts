/**
 * User-owned project data model (WaveWorld host).
 *
 * Hierarchy:
 *   Workspace (tenant / team)
 *     └── User (owner / member)
 *           └── Project (owned work unit)
 *                 ├── models[]     (geometry refs)
 *                 ├── jobs[]       (via jobs.project_id)
 *                 ├── artifacts[]  (optional project-scoped)
 *                 └── settings     (default CFD / UI prefs)
 */

import type { JobKind } from '@w-sim/contracts';

export type ProjectStatus = 'active' | 'archived' | 'deleted';
export type ProjectVisibility = 'private' | 'workspace';
export type ProjectMemberRole = 'owner' | 'editor' | 'viewer';

export type ProjectModelSource = 'preset' | 'artifact' | 'url';

/** Default lab / batch preferences stored on the project */
export interface ProjectSettings {
  /** Default job kind for new batch runs (W-Sim JobKind) */
  defaultJobKind?: JobKind;
  /** Default CFD grid */
  gridPreset?: 'fast' | 'standard' | 'fine';
  modelResolution?: 'coarse' | 'standard' | 'high';
  inletVelocity?: number;
  angleOfAttack?: number;
  thermalEnabled?: boolean;
  /** Free-form UI prefs */
  ui?: Record<string, unknown>;
  /** Tags for filtering */
  tags?: string[];
}

export interface ProjectModelRef {
  id: string;
  projectId: string;
  name: string;
  source: ProjectModelSource;
  presetId?: string;
  artifactId?: string;
  url?: string;
  /** Bounding box / face counts etc. */
  metadata?: Record<string, unknown>;
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  userName?: string;
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  settings: ProjectSettings;
  thumbnailUrl: string | null;
  /** Denormalized job counts (updated lazily) */
  jobCount?: number;
  modelCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectRecord {
  models: ProjectModelRef[];
  members: ProjectMember[];
  /** Recent job ids (not full job payloads) */
  recentJobIds: string[];
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  visibility?: ProjectVisibility;
  settings?: ProjectSettings;
  workspaceId?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: Exclude<ProjectStatus, 'deleted'>;
  visibility?: ProjectVisibility;
  settings?: ProjectSettings;
  thumbnailUrl?: string | null;
}

export interface CreateProjectModelInput {
  name: string;
  source: ProjectModelSource;
  presetId?: string;
  artifactId?: string;
  url?: string;
  metadata?: Record<string, unknown>;
  isActive?: boolean;
}

export interface UpsertProjectMemberInput {
  userId: string;
  role: Exclude<ProjectMemberRole, 'owner'>;
  userName?: string;
}
