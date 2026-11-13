import { checkSubmitAuth } from '@/lib/tasks/auth-agent';
import { errorResponse, HttpError, json, readJson } from '@/lib/tasks/http';
import { LAB_JOB_READ_CACHE, mayReadLabJobQueue } from '@/lib/tasks/job-read-gate';
import { createJob, listJobs } from '@/lib/tasks/service';
import { SpecValidationError, validateJobSpec } from '@/lib/tasks/validate-spec';
import type { JobKind, JobSpecV1, JobStatus } from '@/types/task';
import { resolveCanonicalHostJobsUrl, resolvePublicJobsSuccessor } from '@/lib/assemble-job-spec';

export const runtime = 'nodejs';

/** Leftover Lab jobs API — Host :3001 is canonical (#74 / #89). */
function deprecationHeaders(): Record<string, string> {
  const successor = resolvePublicJobsSuccessor();
  return {
    Deprecation: 'true',
    Link: `<${successor}>; rel="successor-version"`,
    'X-WaveWorld-Canonical-Jobs': successor,
  };
}

export async function GET(req: Request) {
  try {
    if (!mayReadLabJobQueue(req)) {
      return json(
        { error: 'user authentication required' },
        401,
        { ...deprecationHeaders(), ...LAB_JOB_READ_CACHE },
      );
    }
    const url = new URL(req.url);
    const status = url.searchParams.get('status') as JobStatus | null;
    const kind = url.searchParams.get('kind') as JobKind | null;
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const jobs = listJobs({
      status: status ?? undefined,
      kind: kind ?? undefined,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return json({ jobs }, 200, { ...deprecationHeaders(), ...LAB_JOB_READ_CACHE });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { consumeRateLimit, rateLimitedResponse } = await import('@/lib/tasks/rate-limit');
    const limited = consumeRateLimit(req, 'jobSubmit');
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    if (!checkSubmitAuth(req)) {
      return json({ error: 'Invalid or missing x-api-key' }, 401, deprecationHeaders());
    }
    const body = await readJson<{
      spec: JobSpecV1;
      knowledge?: {
        kind?: string;
        releaseId?: string;
        packClaimId?: string;
        packSubjectId?: string;
        materialClaimIds?: string[];
      };
      priority?: number;
      createdBy?: string;
      maxAttempts?: number;
    }>(req, 4 * 1024 * 1024);
    if (!body.spec) throw new HttpError(400, 'spec required');
    if (body.spec.model?.source === 'artifact') {
      throw new HttpError(400, `模型文件任务请使用统一 Host 接口：${resolvePublicJobsSuccessor()}`);
    }
    if (body.knowledge) {
      const hostUrl = resolveCanonicalHostJobsUrl();
      let forwarded: Response;
      try {
        forwarded = await fetch(hostUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(req.headers.get('x-api-key')
              ? { 'x-api-key': req.headers.get('x-api-key') as string }
              : {}),
            ...(req.headers.get('authorization')
              ? { authorization: req.headers.get('authorization') as string }
              : {}),
          },
          body: JSON.stringify(body),
          // 上游 Host 转发必须有界：客户端断开或 Host 挂起都不能让本路由无限等待。
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]),
        });
      } catch (e) {
        throw new HttpError(502, `统一 Host 任务转发失败：${e instanceof Error ? e.message : String(e)}`);
      }
      const text = await forwarded.text();
      return new Response(text, {
        status: forwarded.status,
        headers: {
          'content-type': forwarded.headers.get('content-type') || 'application/json',
          ...deprecationHeaders(),
        },
      });
    }
    try {
      validateJobSpec(body.spec);
    } catch (e) {
      if (e instanceof SpecValidationError) throw new HttpError(400, e.message);
      throw e;
    }
    const job = createJob({
      spec: body.spec,
      priority: body.priority,
      createdBy: body.createdBy ?? req.headers.get('x-created-by'),
      maxAttempts: body.maxAttempts,
    });
    return json({ job }, 201, deprecationHeaders());
  } catch (err) {
    return errorResponse(err);
  }
}
