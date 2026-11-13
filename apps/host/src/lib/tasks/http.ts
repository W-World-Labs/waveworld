import { AuthError } from './auth-agent';
import { captureRadarException } from '../radar-telemetry';

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(data, { status, headers });
}

export function errorResponse(err: unknown) {
  if (err instanceof AuthError) {
    return json({ error: err.message }, err.status);
  }
  if (err instanceof HttpError) {
    return json({ error: err.message }, err.status);
  }
  if (err instanceof Error && typeof (err as Error & { status?: number }).status === 'number') {
    const status = (err as Error & { status: number }).status;
    // 4xx-shaped throws carry deliberate client messages (independent-review
    // Object.assign pattern); 5xx internals stay server-side — never echo
    // SQLite/fs diagnostics into the response body.
    if (status < 500) return json({ error: err.message }, status);
    captureRadarException(err, status);
    console.error(err);
    return json({ error: 'Internal error' }, status);
  }
  captureRadarException(err);
  console.error(err);
  return json({ error: 'Internal error' }, 500);
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

/**
 * JSON body reader with an optional hard byte cap. Content-Length is checked
 * first; absent/lied headers still get bounded by the stream reader (the body
 * is cancelled the moment it exceeds maxBytes — req.json() alone is unbounded).
 */
async function readBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, `request body exceeds the ${maxBytes} byte limit`);
  }
  try {
    if (!req.body) return new Uint8Array(0);
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new HttpError(413, `request body exceeds the ${maxBytes} byte limit`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (chunks.length === 1) return chunks[0]!;
    // Keep the copy byte-sized: expanding chunks to number[] can exhaust the
    // JavaScript heap even when an upload is well below the configured cap.
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'Invalid request body');
  }
}

/**
 * Binary body reader with a hard byte cap — same bounded streaming as readJson
 * for endpoints that take raw octets instead of JSON (e.g. artifact upload).
 */
export async function readBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  return readBody(req, maxBytes);
}

export async function readJson<T>(req: Request, maxBytes?: number): Promise<T> {
  if (maxBytes === undefined) {
    try {
      return (await req.json()) as T;
    } catch {
      throw new HttpError(400, 'Invalid JSON body');
    }
  }
  let text: string;
  try {
    text = new TextDecoder().decode(await readBody(req, maxBytes));
  } catch (err) {
    if (err instanceof HttpError && err.status === 413) throw err;
    throw new HttpError(400, 'Invalid JSON body');
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}
