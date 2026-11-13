/**
 * Shared knowledge write / promote / list-gated key check.
 * All comparisons go through sameSecret (#58) — never `===` / `!==` on keys.
 */
import { consumeRateLimit, rateLimitedResponse } from './rate-limit';
import { sameSecret } from './safe-error-message';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export function knowledgeWriteExpectedKey(): string {
  return (
    process.env.AGENT_REGISTRATION_KEY ??
    process.env.TASK_API_KEY ??
    process.env.KNOWLEDGE_WRITE_KEY ??
    process.env.KNOWLEDGE_WRITE_API_KEY ??
    ''
  ).trim();
}

export function knowledgeWriteProvidedKey(req: Request): string {
  return (
    req.headers.get('x-agent-registration-key')?.trim() ||
    req.headers.get('x-api-key')?.trim() ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    ''
  );
}

/** Timing-safe match of the request's presented key against expected. */
export function knowledgeWriteKeyMatches(req: Request, expected: string): boolean {
  return sameSecret(knowledgeWriteProvidedKey(req), expected);
}

/**
 * Fail closed when no operator key is configured (503) or the presented
 * key does not match (401). Used by promote / seed-demo / CRUD writes.
 */
export function requireKnowledgeRegistrationKey(
  req: Request,
  writeDisabledMessage: string,
): Response | null {
  const limited = consumeRateLimit(req, 'knowledgeWrite');
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
  const expected = knowledgeWriteExpectedKey();
  if (!expected) {
    return new Response(
      JSON.stringify({
        error: 'write_disabled',
        message: writeDisabledMessage,
      }),
      { status: 503, headers: JSON_HEADERS },
    );
  }
  if (!knowledgeWriteKeyMatches(req, expected)) {
    return new Response(
      JSON.stringify({
        error: 'unauthorized',
        message: 'invalid registration key',
      }),
      { status: 401, headers: JSON_HEADERS },
    );
  }
  return null;
}

/**
 * resolve-job policy (K18): unset key = open (dev / public demos).
 * When a key is configured, require a timing-safe match on x-api-key or Bearer.
 */
export function requireKnowledgeWriteAuthIfConfigured(req: Request): Response | null {
  const expected =
    process.env.KNOWLEDGE_WRITE_API_KEY?.trim() || process.env.TASK_API_KEY?.trim() || '';
  if (!expected) return null;
  const key = req.headers.get('x-api-key')?.trim() || '';
  const auth = req.headers.get('authorization')?.trim() || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (sameSecret(key, expected) || sameSecret(bearer, expected)) return null;
  return new Response(JSON.stringify({ error: 'knowledge write auth required' }), {
    status: 401,
    headers: JSON_HEADERS,
  });
}
