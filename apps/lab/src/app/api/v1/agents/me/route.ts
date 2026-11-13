import { requireAgent } from '@/lib/tasks/auth-agent';
import { errorResponse, json } from '@/lib/tasks/http';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const agent = requireAgent(req);
    return json({ agent });
  } catch (err) {
    return errorResponse(err);
  }
}
