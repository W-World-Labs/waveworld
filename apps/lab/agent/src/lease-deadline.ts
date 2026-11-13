/**
 * Lease-deadline predicates shared by the TaskApi HTTP adapter
 * (host-client.ts) and the guarded claim/settle core (guarded-claim.ts).
 *
 * Extracted so the guarded core can consume them without an import cycle:
 * host-client imports failRetryableForMessage from guarded-claim.
 */

/** Soft renew window when host omits or gives an unusable leaseExpiresAt. */
export const SOFT_LEASE_RENEW_MS = 30_000;

/**
 * Host-confirmed cancellation observed through a heartbeat rejection
 * (409 + cancelled body). Distinct from a transport-level AbortError:
 * a timeout-shaped or foreign abort is *transient* and must retry inside
 * the last-known lease window, not settle 'cancelled'. Only renewLease's
 * definitive-cancel branch produces this class, so `instanceof` is the
 * precise discriminator in the guarded core.
 */
export class HostJobCancelledError extends Error {
  override name = 'AbortError';
  constructor() {
    super('job cancelled by host');
  }
}

/**
 * Agent clock may run slightly ahead of host. An ISO deadline older than
 * `now - skew` is treated as unusable (soft-hold) rather than advertised as
 * a live hold signal (honesty residual wave28 clock-skew soft-hold).
 */
export const LEASE_CLOCK_SKEW_MS = 5_000;

/**
 * True when the leading YYYY-MM-DD is a real Gregorian calendar day (UTC).
 * Rejects Date.parse rollover garbage such as 2026-02-30 → 2026-03-02
 * (honesty residual wave29 far-future / calendar garbage soft-hold).
 */
export function isRealCalendarDatePrefix(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  // Date.UTC year 0–99 map to 1900–1999; require exact component round-trip.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * True when, after a real YYYY-MM-DD prefix, the remainder is either empty
 * (date-only ISO — ES Date.parse treats as UTC midnight) or a `T`/`t` time with
 * real clock components and an **explicit** timezone designator (Z or ±HH:MM).
 *
 * Date.parse accepts several non-portable forms that must soft-hold rather than
 * advertise as absolute host deadlines:
 * - SQL/space separators (`2026-01-01 12:00:00`) — wave30
 * - timezone-naive local datetimes (`2026-01-01T12:00:00`) — wave31
 * - T24:00:00 end-of-day rollover — wave31
 * - leap-second :60 and impossible zone offsets (±HH≥24 / ±MM≥60) — wave32
 * - fractional / second-resolution zone suffixes (`+00:00.5`, `+00:00:00`) — wave32
 * - non-civil zone offsets beyond ISO 8601 ±14:00 (`+15:00`, `+14:30`) — wave33
 */
export function hasIsoDateTimeShape(value: string): boolean {
  if (value.length < 10) return false;
  const rest = value.slice(10);
  if (rest.length === 0) return true;
  if (rest[0] !== 'T' && rest[0] !== 't') return false;
  // HH:MM[:SS[.frac]] + mandatory zone (Z/z or ±HH:MM / ±HHMM).
  // Zone must be whole-minute; fractional-second offsets and ±HH:MM:SS soft-hold.
  const m = /^[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?([Zz]|[+-]\d{2}:?\d{2})$/.exec(
    rest,
  );
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] != null ? Number(m[3]) : 0;
  // Reject T24:00:00 rollover, leap-second :60, and other non-clock fields.
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || !Number.isInteger(ss)) return false;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return false;
  // Explicit zone: civil ISO 8601 range ±14:00 (wave32 rejected ±HH≥24; wave33
  // soft-holds Date.parse-accepted but non-civil +15..+23 / +14:mm for mm≠0).
  const zone = m[4]!;
  if (zone !== 'Z' && zone !== 'z') {
    const zm = /^[+-](\d{2}):?(\d{2})$/.exec(zone);
    if (!zm) return false;
    const oh = Number(zm[1]);
    const om = Number(zm[2]);
    if (!Number.isInteger(oh) || !Number.isInteger(om)) return false;
    if (oh < 0 || oh > 14 || om < 0 || om > 59) return false;
    // ISO 8601 extreme offset is exactly ±14:00 (not ±14:30).
    if (oh === 14 && om !== 0) return false;
  }
  return true;
}

/**
 * True when leaseExpiresAt is an authoritative absolute deadline.
 *
 * Requires a real calendar date prefix (YYYY-MM-DD…), portable ISO date/datetime
 * shape (date-only or `T` time with real clock + explicit whole-minute zone —
 * not space/SQL, not timezone-naive local, not T24/leap-second, not impossible
 * or fractional zone offsets), plus a finite Date.parse so V8 quirks like
 * Date.parse("2099") / Date.parse("1") / Feb-30 rollover / space datetime are
 * not treated as host deadlines. null/undefined/""/whitespace/garbage /
 * bare-year / invalid calendar days / non-ISO separators / zone-naive /
 * bad / non-civil offsets → soft-hold path (wave26–wave33 claim-loop/lease).
 * Does not apply clock-skew / past-deadline filtering — see isUsableLeaseDeadline.
 */
export function isAuthoritativeLeaseExpiresAt(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Full calendar date only — bare years/numbers parse in V8 but are not ISO deadlines.
  if (!isRealCalendarDatePrefix(trimmed)) return false;
  // Reject non-portable separators / naive local / T24 / leap-second / bad offsets.
  if (!hasIsoDateTimeShape(trimmed)) return false;
  return Number.isFinite(Date.parse(trimmed));
}

/**
 * True when leaseExpiresAt is authoritative *and* still a usable hold signal
 * under agent clock (not expired beyond LEASE_CLOCK_SKEW_MS).
 *
 * Past calendar ISO from host still means "heartbeat accepted" — soft-hold
 * rather than returning a dead deadline (wave28 residual).
 */
export function isUsableLeaseDeadline(
  value: unknown,
  nowMs: number = Date.now(),
  skewMs: number = LEASE_CLOCK_SKEW_MS,
): value is string {
  if (!isAuthoritativeLeaseExpiresAt(value)) return false;
  const exp = Date.parse(value.trim());
  return exp >= nowMs - skewMs;
}
