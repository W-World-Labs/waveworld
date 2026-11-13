/**
 * Thin seam: TaskApiClient (HTTP product client) → @w-sim/runtime JobHostClient.
 * Solvers stay out of this file; claim/progress/complete/fail + optional lease renew.
 */

import { type JobHostClient, type AgentIdentity } from '@w-sim/runtime';
import type { JobProgress, JobResultV1 } from '@w-sim/contracts';
import type { TaskApiClient } from './client.ts';
import { failRetryableForMessage } from './guarded-claim.ts';
import {
  HostJobCancelledError,
  isUsableLeaseDeadline,
  SOFT_LEASE_RENEW_MS,
} from './lease-deadline.ts';

// Lease-deadline predicates live in lease-deadline.ts so guarded-claim can
// consume them without an import cycle; re-export keeps this module's public
// surface unchanged.
export {
  HostJobCancelledError,
  isAuthoritativeLeaseExpiresAt,
  isRealCalendarDatePrefix,
  hasIsoDateTimeShape,
  isUsableLeaseDeadline,
  SOFT_LEASE_RENEW_MS,
  LEASE_CLOCK_SKEW_MS,
} from './lease-deadline.ts';

/**
 * Map host.fail error text → TaskApiClient retryable flag.
 * Single taxonomy with processJob / failRetryableForMessage: lease-loss is
 * non-retryable; other fails stay retryable so a capable peer can reclaim
 * (issue #7 residual).
 */
export function retryableForHostFail(error: string): boolean {
  return failRetryableForMessage(error);
}

/**
 * Max length for claim jobId after trim (wave33 residual after wave32 trim).
 * Overlong / empty identity is not a usable job handle — claim returns null.
 */
export const MAX_JOB_ID_LEN = 128;

/**
 * C0 + DEL + C1 control characters (U+0000–U+001F, U+007F–U+009F) are not usable
 * job handles (wave34 C0/DEL + wave38 C1 residual after wave33 empty/overlong
 * claim null). C1 includes NEL (U+0085), a line terminator not matched by JS `\s`.
 */
const JOB_ID_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Invisible / format characters that survive String.trim and are not matched by
 * \s or C0/C1 control — not usable job handles (wave35 zero-width + wave36 bidi
 * / Cf glue + wave37 deprecated-format / BMP variation-selector + wave38 Mongolian
 * FVS1–3 / VS Supplement / object-replacement + wave39 FVS4 / Language Tags /
 * U+FFFD + wave40 Arabic/Syriac number-sign Cf + wave41 Khmer inherent vowels /
 * musical-symbol format / BMP noncharacters residual after wave34 control claim null):
 * - U+00AD soft hyphen
 * - U+034F combining grapheme joiner
 * - U+0600–U+0605 Arabic number signs / footnotes / sanctions (Cf; wave40)
 * - U+061C Arabic letter mark
 * - U+06DD Arabic end of ayah (Cf; wave40)
 * - U+070F Syriac abbreviation mark (Cf; wave40)
 * - U+08E2 Arabic disputed end of ayah (Cf; wave40)
 * - U+17B4–U+17B5 Khmer inherent vowels (invisible Cf dual-handle; wave41)
 * - U+180B–U+180D Mongolian free variation selectors FVS1–3 (dual-handle; wave38)
 * - U+180E Mongolian vowel separator
 * - U+180F Mongolian free variation selector FVS4 (Unicode 13; wave39 residual)
 * - U+200B–U+200F ZWSP / ZWNJ / ZWJ / LRM / RLM
 * - U+202A–U+202E bidi embeddings / overrides / PDF
 * - U+2060–U+206F word joiner + invisible math + bidi isolates + deprecated
 *   format controls (U+206A–U+206F; U+2065 unassigned included in the range)
 * - U+FE00–U+FE0F BMP variation selectors (dual-handle glue; survive NFC/NFKC)
 * - U+FEFF BOM when embedded (leading/trailing BOM is already stripped by trim)
 * - U+FFF9–U+FFFB interlinear annotation anchors / separator
 * - U+FFFC object replacement character (placeholder glue; wave38)
 * - U+FFFD replacement character (corruption dual-handle glue; wave39)
 * - U+FFFE–U+FFFF BMP noncharacters (not portable identity scalars; wave41)
 * - U+1D173–U+1D17A Musical symbol begin/end beam / tie / slur / phrase (Cf;
 *   plane-1 invisible dual-handle; wave41 residual after Language Tags)
 * - U+E0001 Language Tag + U+E0020–U+E007F tag alphabet / cancel (plane-14
 *   invisible dual-handle; wave39 residual after VS Supplement)
 * - U+E0100–U+E01EF Variation Selectors Supplement (plane-14 dual-handle; wave38)
 *
 * `u` flag required for plane-1 musical-symbol Cf / plane-14 Language Tag /
 * VS Supplement code points.
 */
const JOB_ID_INVISIBLE_FORMAT =
  /[\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u08E2\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\uFFF9-\uFFFF\u{1D173}-\u{1D17A}\u{E0001}\u{E0020}-\u{E007F}\u{E0100}-\u{E01EF}]/u;

/**
 * URL-path separators / resolvers are not usable job handles (wave66 claim
 * residual after wave41 hygiene). claim jobId is interpolated raw into
 * `/api/v1/jobs/<id>/heartbeat|complete|fail` (and `?jobId=` / X-Job-Id on
 * artifact transfer); WHATWG URL resolution normalizes `.`/`..` path segments
 * and treats `\` as `/` for http(s) special schemes, `?`/`#` truncate the
 * path, and `%` can smuggle a decoded separator through hosts that decode
 * before routing. Host job ids are `crypto.randomUUID()` — none of these are
 * legitimate identity characters, so a corrupt/hostile claim id must not
 * steer authenticated control-plane calls off the job route.
 */
const JOB_ID_URL_PATH_HOSTILE = /[/\\?#%]/;

/**
 * True when a claim jobId is a usable handle after trim: non-empty, ≤ MAX_JOB_ID_LEN,
 * no C0/C1 control chars, no internal whitespace, no zero-width/bidi/format/VS/
 * Mongolian-FVS/Language-Tag/Arabic-Syriac-Cf/Khmer-inherent/musical-Cf/
 * object-replacement/FFFD–FFFF glue, no URL-path separators or `.`/`..`
 * dot-segments, well-formed UTF-16 (no unpaired surrogates), and
 * NFKC-canonical form (wave33 length + wave34–wave41 hygiene + wave66
 * path-escape residual).
 *
 * Non-NFKC (NFD `e` + combining acute, fullwidth/compatibility forms) is dishonest
 * dual-handle residue — the same visual/compatibility identity must not claim under
 * multiple code-unit sequences (wave36 NFC + wave37 NFKC residual).
 * Unpaired surrogates / ill-formed UTF-16 are corruption dual-handles (wave40).
 */
export function isUsableClaimJobId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const id = value.trim();
  if (id.length === 0 || id.length > MAX_JOB_ID_LEN) return false;
  if (JOB_ID_CONTROL.test(id)) return false;
  // Trim already removed ends; remaining \s is internal space / Unicode space.
  if (/\s/.test(id)) return false;
  // Zero-width / soft-hyphen / bidi / WJ / VS / Mongolian FVS / Language Tags /
  // Arabic-Syriac Cf / Khmer inherent / musical Cf / FFFC–FFFF / embedded BOM
  // survive trim and \s (wave35–wave41 claim residual).
  if (JOB_ID_INVISIBLE_FORMAT.test(id)) return false;
  // Path separators / `?`/`#`/`%` and `.`/`..` dot-segments escape the job
  // route under WHATWG URL resolution when jobId is interpolated raw into
  // control-plane paths (wave66 claim residual; legit ids are UUIDs).
  if (JOB_ID_URL_PATH_HOSTILE.test(id)) return false;
  if (id === '.' || id === '..') return false;
  // Unpaired UTF-16 surrogates are not Unicode scalar values — not portable
  // job handles (wave40 residual after multi-null / empty-after-strip hygiene).
  if (typeof id.isWellFormed === 'function' && !id.isWellFormed()) return false;
  // Require NFKC so composed vs decomposed *and* compatibility dual-handles
  // (fullwidth, ligatures) cannot claim under multiple sequences (wave36→wave37).
  if (id !== id.normalize('NFKC')) return false;
  return true;
}

/**
 * Usable lease deadline out of a heartbeat response — one parse shared by
 * renewLease and progressWithLease.
 */
function heartbeatLeaseDeadline(res: unknown): string {
  const lease = (res as { job?: { leaseExpiresAt?: string | null } })?.job?.leaseExpiresAt;
  return isUsableLeaseDeadline(lease)
    ? lease.trim()
    : new Date(Date.now() + SOFT_LEASE_RENEW_MS).toISOString();
}

/** JobHostClient plus an optional lease-returning progress post. */
export type JobHostClientWithProgressLease = JobHostClient & {
  /**
   * Like `progress`, but returns the renewed lease deadline the heartbeat
   * response already carried — a caller that consumes it skips the separate
   * renewLease POST per progress event (heartbeat itself renews server-side).
   */
  progressWithLease?: (jobId: string, progress: JobProgress) => Promise<string>;
};

/**
 * Adapt the existing agent HTTP client to the portable JobHostClient port
 * used by runGuardedClaimLoopOnce / createMemoryJobHost.
 *
 * Lease renew maps to heartbeat: failure ⇒ lease lost (null) so product guards
 * can refuse stale terminal publish (issue #7).
 */
export function createJobHostFromTaskApi(client: TaskApiClient): JobHostClientWithProgressLease {
  return {
    async registerAgent(_agent: AgentIdentity): Promise<void> {
      // Registration is performed by the CLI (`TaskApiClient.register`) before
      // the claim loop starts; the runtime port is a no-op here.
    },

    async claim(_agentId: string) {
      const job = await client.claim();
      if (!job) return null;
      // Usable hold signal only — garbage/calendar-rollover/space-SQL/zone-naive/
      // T24/leap-second/bad/non-civil-offset/past-skew must not be advertised as an
      // absolute host deadline (wave30–wave33 claim soft-hold).
      const rawLease = job.leaseExpiresAt;
      const leaseExpiresAt = isUsableLeaseDeadline(rawLease)
        ? rawLease.trim()
        : undefined;
      // Trim-stable job identity (wave32); empty/overlong/C0-C1/internal-space/
      // zero-width/bidi/VS/FVS/Language-Tag/Arabic-Syriac-Cf/Khmer/musical-Cf/
      // FFFD–FFFF/unpaired-surrogate/non-NFKC is not a usable handle
      // (wave33–wave41 claim residual); URL-path separators / `.`/`..`
      // dot-segments likewise (wave66 path-escape residual).
      const jobId = typeof job.id === 'string' ? job.id.trim() : job.id;
      if (!isUsableClaimJobId(jobId)) {
        return null;
      }
      if (!Number.isSafeInteger(job.attempt) || job.attempt < 0) return null;
      return {
        jobId,
        spec: job.spec,
        attempt: job.attempt,
        leaseExpiresAt,
      };
    },

    async progress(jobId: string, progress: JobProgress): Promise<void> {
      await client.heartbeat(jobId, progress);
    },

    async progressWithLease(jobId: string, progress: JobProgress): Promise<string> {
      return heartbeatLeaseDeadline(await client.heartbeat(jobId, progress));
    },

    async complete(jobId: string, result: JobResultV1, attempt: number) {
      return client.complete(jobId, result, attempt);
    },

    async fail(jobId: string, error: string, attempt: number) {
      return client.fail(jobId, error, attempt, retryableForHostFail(error));
    },

    async renewLease(jobId: string, _agentId: string): Promise<string | null> {
      try {
        // Usable expiry: portable calendar ISO *and* not already past beyond
        // clock skew. Bare years, garbage, space/SQL, zone-naive local, T24/
        // leap-second, impossible/fractional/non-civil zone offsets, empty,
        // non-string, or expired-past-skew → soft deadline; Host accepted
        // heartbeat without a usable future hold — lease still held
        // (wave27–wave33 claim-loop/lease).
        return heartbeatLeaseDeadline(await client.heartbeat(jobId));
      } catch (err) {
        // Only a *definitive* rejection is lease loss: the host answered and
        // refused our ownership (4xx other than transient 408/429 — includes
        // 401/403, which cannot settle anything anyway). A 409 whose body says
        // the job was cancelled surfaces as AbortError so settlement records
        // 'cancelled', not 'lease_lost'. Transport failures, 5xx and timeouts
        // rethrow — collapsing them into lease loss would permanently fail a
        // still-leased job (failRetryableForMessage(LEASE_LOST) === false).
        const m = err instanceof Error ? err.message : String(err);
        const status = /\b(\d{3})\b/.exec(m)?.[1];
        if (status === '409' && /cancelled/i.test(m)) {
          throw new HostJobCancelledError();
        }
        if (status) {
          const code = Number(status);
          if (code >= 400 && code < 500 && code !== 408 && code !== 429) {
            console.warn(`[agent:lease] heartbeat rejected for ${jobId}: ${m.slice(0, 200)}`);
            return null;
          }
        }
        throw err;
      }
    },
  };
}
