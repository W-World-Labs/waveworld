import { authenticateAgent } from '@/lib/tasks/auth-agent';
import { allowOpenArtifactAccess, getArtifact, readArtifactBytes, statArtifactFile } from '@/lib/tasks/artifacts';
import { errorResponse, HttpError, json } from '@/lib/tasks/http';
import { normalizeArtifactId } from '@/lib/tasks/job-id';
import { consumeArtifactReadLimit, rateLimitedResponse } from '@/lib/tasks/rate-limit';
import { getJob } from '@/lib/tasks/service';

export const runtime = 'nodejs';

/**
 * Leftover Lab artifact download. Host :3001 is the canonical jobs plane;
 * this route stays reachable at /app/lab/api/v1/artifacts/:id.
 * statArtifactFile keeps a store fault (EACCES/ELOOP/EIO) honest — 500
 * "artifact storage unavailable", never the 404 existsSync returned for
 * the same fault. A byte or hash mismatch is 409, not a silent body.
 * Production is not world-readable: only the agent that holds the
 * artifact's job may download. Non-production stays open for local dev,
 * same rule as Host allowOpenArtifactAccess.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const artifactId = normalizeArtifactId(id);
    if (!artifactId) return json({ error: 'invalid artifact id' }, 400);
    const agentForLimit = authenticateAgent(req.headers.get('authorization'));
    const limited = consumeArtifactReadLimit(req, agentForLimit?.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const found = getArtifact(artifactId);
    if (!found || statArtifactFile(found.absPath) === 'missing') {
      return json({ error: 'Artifact not found' }, 404);
    }
    if (!allowOpenArtifactAccess()) {
      const agent = agentForLimit;
      if (!agent) throw new HttpError(401, 'artifact download requires authentication');
      const job = found.meta.jobId ? getJob(found.meta.jobId) : null;
      const holds = !!found.meta.jobId && !!job
        && job.id === found.meta.jobId
        && !!job.agentId && job.agentId === agent.id;
      if (!holds) throw new HttpError(403, 'forbidden: agent does not hold this job');
    }
    const verified = readArtifactBytes(artifactId);
    if (!verified) return json({ error: 'Artifact failed integrity verification' }, 409);
    const data = verified.data;
    const safeName = found.meta.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': found.meta.contentType,
        'Content-Length': String(found.meta.bytes),
        'Content-Disposition': `attachment; filename="${safeName}"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
