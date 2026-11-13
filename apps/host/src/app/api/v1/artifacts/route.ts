import { ensureTaskEnv } from '../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

/**
 * Upload artifact (agent or authenticated user).
 * JSON: { jobId?, projectId?, kind, contentType?, base64 }
 * Raw binary: headers x-artifact-kind, x-job-id, x-project-id
 *
 * List: GET ?jobId=&projectId=
 * Auth: agent Bearer, user Bearer/cookie; open only in non-production unless ARTIFACT_REQUIRE_AUTH=1.
 * Residual after wave40: normalizeJobId on optional body/header jobId — garbage
 * → 400 invalid job id (not dishonest 404 "job not found").
 * Residual after wave41: normalizeProjectId on optional body/header projectId
 * + GET query jobId/projectId — garbage → 400 (not dishonest 403/empty list).
 * Do not claim Lab fully usable while #49/#54 open.
 */
async function uploadArtifactRoute(req: Request) {
  ensureTaskEnv();
  const { errorResponse, json, HttpError, readJson, readBytes } = await import('@/lib/tasks/http');
  const {
    saveArtifact,
    allowOpenArtifactAccess,
    getArtifactMaxBytes,
  } = await import('@/lib/tasks/artifacts');
  const { authenticateAgent, requireJobExecutor } = await import('@/lib/tasks/auth-agent');
  const { resolveUser } = await import('../../../../lib/user-auth');
  try {
    const auth = req.headers.get('authorization');
    let agent: { id: string } | null = authenticateAgent(auth);
    const user = agent ? null : await resolveUser(req);

    if (!agent && !user && !allowOpenArtifactAccess()) {
      throw new HttpError(
        401,
        'artifact upload requires agent or user authentication'
      );
    }

    // Uploads are byte-capped but were previously unbounded in count: an
    // authed principal could loop max-size POSTs and outpace artifact GC.
    // Keyed by principal, not IP — an agent fleet behind one NAT shares an IP.
    const { consumeArtifactUploadLimit, rateLimitedResponse } = await import('../../../../lib/rate-limit');
    const limited = consumeArtifactUploadLimit(req, { agentId: agent?.id, userId: user?.id });
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);

    let projectId: string | undefined;
    let jobId: string | undefined;
    let kind: string;
    let contentType: string;
    let data: Buffer;
    let ownerUserId = user?.id ?? null;

    const maxBytes = getArtifactMaxBytes();
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await readJson<{
        jobId?: string;
        projectId?: string;
        kind?: string;
        contentType?: string;
        base64?: string;
      }>(req, maxBytes * 2);
      if (!body.kind) throw new HttpError(400, 'kind required');
      if (!body.base64) throw new HttpError(400, 'base64 required');
      kind = body.kind;
      jobId = body.jobId;
      projectId = body.projectId;
      contentType = body.contentType || 'application/octet-stream';
      data = Buffer.from(body.base64, 'base64');
    } else {
      kind = req.headers.get('x-artifact-kind') || 'log';
      jobId = req.headers.get('x-job-id') ?? undefined;
      projectId = req.headers.get('x-project-id') ?? undefined;
      contentType = ct || 'application/octet-stream';
      data = Buffer.from(await readBytes(req, maxBytes));
    }
    // kind is a short contract string persisted as TEXT; bound it even though
    // the JSON body cap already applies — a multi-MB kind wastes a row's space.
    if (kind.length > 128) throw new HttpError(400, 'kind too long');

    // Residual after wave40: optional jobId must be UUID before getJob (createJob → UUID).
    // Residual after wave41: optional projectId must be UUID before canAccessProject
    // (createProject → UUID; garbage → 400 not dishonest 403 forbidden).
    const { normalizeJobId, normalizeProjectId } = await import('../../../../lib/job-sharing');
    if (jobId != null && jobId !== '') {
      const normalizedJobId = normalizeJobId(jobId);
      if (!normalizedJobId) return json({ error: 'invalid job id' }, 400);
      jobId = normalizedJobId;
    } else {
      jobId = undefined;
    }
    if (projectId != null && projectId !== '') {
      const normalizedProjectId = normalizeProjectId(projectId);
      if (!normalizedProjectId) return json({ error: 'invalid project id' }, 400);
      projectId = normalizedProjectId;
    } else {
      projectId = undefined;
    }

    if (!agent && req.headers.has('x-browser-agent')) {
      if (!jobId) throw new HttpError(400, 'browser artifacts must be linked to a job');
      agent = await requireJobExecutor(req, jobId);
    }

    // Users attaching to a project must be able to edit that project.
    if (projectId && user && !agent) {
      const { canAccessProject } = await import('../../../../lib/project-service');
      const role = await canAccessProject(projectId, user.id, user.workspaceId);
      if (role !== 'owner' && role !== 'editor') {
        throw new HttpError(403, 'forbidden: project write access required to upload artifact');
      }
    }

    if (jobId) {
      const { getJob } = await import('@/lib/tasks/service');
      const job = getJob(jobId);
      if (!job) throw new HttpError(404, 'job not found');
      if (agent) {
        if (job.agentId !== agent.id || (job.status !== 'leased' && job.status !== 'running') || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) {
          throw new HttpError(403, 'agent does not own an active lease for this job');
        }
        if (projectId && job.projectId !== projectId) throw new HttpError(403, 'job and artifact project mismatch');
        projectId = job.projectId ?? undefined;
        ownerUserId = job.createdBy;
      } else if (user) {
        const { userMayAccessJob } = await import('../../../../lib/job-sharing');
        if (!await userMayAccessJob(user, job, 'edit')) throw new HttpError(403, 'forbidden: job write access required');
        if (projectId && job.projectId && job.projectId !== projectId) throw new HttpError(403, 'job and artifact project mismatch');
      }
    } else if (agent && projectId) {
      throw new HttpError(400, 'agent project artifacts must be linked to an actively leased job');
    }

    const { decodeModelGeometry, MODEL_GEOMETRY_ARTIFACT_KIND, isModelGeometryContentType } = await import('../../../../../../lab/src/lib/models/geometry-contract');
    if (kind === MODEL_GEOMETRY_ARTIFACT_KIND) {
      if (!isModelGeometryContentType(contentType)) throw new HttpError(400, 'invalid model geometry content type');
      try { decodeModelGeometry(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, contentType); }
      catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'invalid model geometry'); }
    }
    const { decodeFlowSnapshot, decodeFlowSequence, FLOW_SNAPSHOT_KIND, FLOW_SEQUENCE_KIND, FLOW_SEQUENCE_CONTENT_TYPE, isFlowSnapshotContentType } = await import('../../../../../../lab/src/lib/cfd/flow-snapshot');
    if (kind === FLOW_SNAPSHOT_KIND) {
      if (!agent || !jobId) throw new HttpError(403, 'flow snapshots require the job agent');
      if (!isFlowSnapshotContentType(contentType)) throw new HttpError(400, 'invalid flow snapshot content type');
      try { decodeFlowSnapshot(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, contentType); }
      catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'invalid flow snapshot'); }
    }
    if (kind === FLOW_SEQUENCE_KIND) {
      if (!agent || !jobId) throw new HttpError(403, 'flow sequences require the job agent');
      if (contentType !== FLOW_SEQUENCE_CONTENT_TYPE) throw new HttpError(400, 'invalid flow sequence content type');
      try {
        const { inflateSequenceArtifact } = await import('../../../../lib/tasks/flow-inflate');
        const raw = inflateSequenceArtifact(data);
        decodeFlowSequence(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
      } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'invalid flow sequence'); }
    }
    const { decodeMacFlowSnapshot, decodeMacFlowSequence, MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SEQUENCE_KIND, MAC_FLOW_SNAPSHOT_CONTENT_TYPE, MAC_FLOW_SEQUENCE_CONTENT_TYPE } = await import('../../../../../../lab/src/lib/cfd/mac-flow-snapshot');
    if (kind === MAC_FLOW_SNAPSHOT_KIND) {
      if (!agent || !jobId) throw new HttpError(403, 'MAC fields require the job agent');
      if (contentType !== MAC_FLOW_SNAPSHOT_CONTENT_TYPE) throw new HttpError(400, 'invalid MAC field content type');
      try { decodeMacFlowSnapshot(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer); }
      catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'invalid MAC field'); }
    }
    if (kind === MAC_FLOW_SEQUENCE_KIND) {
      if (!agent || !jobId) throw new HttpError(403, 'MAC sequences require the job agent');
      if (contentType !== MAC_FLOW_SEQUENCE_CONTENT_TYPE) throw new HttpError(400, 'invalid MAC sequence content type');
      try {
        const { inflateSequenceArtifact } = await import('../../../../lib/tasks/flow-inflate');
        const raw = inflateSequenceArtifact(data);
        decodeMacFlowSequence(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
      } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'invalid MAC sequence'); }
    }
    const meta = saveArtifact({
      jobId: jobId ?? null,
      projectId: projectId ?? null,
      ownerUserId,
      kind,
      contentType,
      data,
    });
    return json({ artifact: meta }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

const uploadArtifactWithRadar = withRadarRoute('POST', '/api/v1/artifacts', uploadArtifactRoute);
export async function POST(req: Request) {
  return uploadArtifactWithRadar(req);
}

async function listArtifactsRoute(req: Request) {
  ensureTaskEnv();
  const { listArtifacts, allowOpenArtifactAccess, userMayAccessArtifact } = await import(
    '@/lib/tasks/artifacts'
  );
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  const { authenticateAgent } = await import('@/lib/tasks/auth-agent');
  const { resolveUser } = await import('../../../../lib/user-auth');
  try {
    const agent = authenticateAgent(req.headers.get('authorization'));
    const user = agent ? null : await resolveUser(req);

    if (!agent && !user && !allowOpenArtifactAccess()) {
      throw new HttpError(401, 'artifact list requires agent or user authentication');
    }

    const url = new URL(req.url);
    // Residual after wave41: optional list filters must be UUID (createJob /
    // createProject → UUID). Garbage query → 400 (not empty list / dishonest 403).
    const { normalizeJobId, normalizeProjectId } = await import('../../../../lib/job-sharing');
    let jobId: string | undefined;
    let projectId: string | undefined;
    const rawJobId = url.searchParams.get('jobId');
    if (rawJobId != null && rawJobId !== '') {
      const normalized = normalizeJobId(rawJobId);
      if (!normalized) return json({ error: 'invalid job id' }, 400);
      jobId = normalized;
    }
    const rawProjectId = url.searchParams.get('projectId');
    if (rawProjectId != null && rawProjectId !== '') {
      const normalized = normalizeProjectId(rawProjectId);
      if (!normalized) return json({ error: 'invalid project id' }, 400);
      projectId = normalized;
    }

    if (projectId && user && !agent) {
      const { canAccessProject } = await import('../../../../lib/project-service');
      const role = await canAccessProject(projectId, user.id, user.workspaceId);
      if (!role) {
        throw new HttpError(403, 'forbidden: no access to project artifacts');
      }
    }

    // Agents only ever upload or download-by-id; an unfiltered list would leak
    // fleet-wide job/project metadata to every registered token. Scope agent
    // lists to a jobId the agent actually holds (same ACL as artifact GET).
    if (agent) {
      if (!jobId) throw new HttpError(400, 'agent artifact list requires jobId');
      const { getJob } = await import('@/lib/tasks/service');
      const { agentMayAccessJob } = await import('../../../../lib/job-sharing');
      const job = getJob(jobId);
      if (!job || !agentMayAccessJob(agent, job, 'read')) {
        throw new HttpError(403, 'forbidden: agent does not hold this job');
      }
    }

    let items = listArtifacts({ jobId, projectId });

    // Users without a project filter only see artifacts they own or can access via project.
    if (user && !agent && !projectId) {
      const { canAccessProject } = await import('../../../../lib/project-service');
      const filtered = [];
      for (const a of items) {
        let access: 'owner' | 'editor' | 'viewer' | null = null;
        if (a.projectId) {
          access = await canAccessProject(a.projectId, user.id, user.workspaceId);
        }
        if (userMayAccessArtifact(a, user, access)) {
          filtered.push(a);
        }
      }
      items = filtered;
    }

    return json({ artifacts: items });
  } catch (err) {
    return errorResponse(err);
  }
}

const listArtifactsWithRadar = withRadarRoute('GET', '/api/v1/artifacts', listArtifactsRoute);
export async function GET(req: Request) {
  return listArtifactsWithRadar(req);
}
