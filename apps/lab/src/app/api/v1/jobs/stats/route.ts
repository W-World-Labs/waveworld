import { errorResponse, json } from '@/lib/tasks/http';
import { LAB_JOB_READ_CACHE, mayReadLabJobQueue } from '@/lib/tasks/job-read-gate';
import { getJobStats } from '@/lib/tasks/service';

export const runtime = 'nodejs';

/** Queue counters for ops / multi-agent dashboards. */
export async function GET(req: Request) {
  try {
    if (!mayReadLabJobQueue(req)) {
      return json({ error: 'authentication required' }, 401, LAB_JOB_READ_CACHE);
    }
    return json({ stats: getJobStats() }, 200, LAB_JOB_READ_CACHE);
  } catch (err) {
    return errorResponse(err);
  }
}
