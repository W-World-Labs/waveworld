/**
 * Pure Lab URL / gateway copy for waveworld-host /lab (A1 residual).
 * Shared URL decisions live in Atlas `src/lib/labEntry.ts` (#74).
 * Aligns with Atlas so NEXT_PUBLIC_LAB_URL and
 * VITE_LAB_URL mean the same public base (prefer same-origin /app/lab).
 *
 * Topology (Caddy):
 *   Host /lab          → waveworld-host L2 gateway (this module + page)
 *   Atlas /lab-cfd     → SPA static (iframe of same /app/lab base)
 *   Public 3D surface  → /app/lab* → WaveWorld Lab (apps/lab)
 *
 * Unit-tested without React. Client page wires env + window.
 */

import {
  isLoopbackBase as sharedIsLoopbackBase,
  isLoopbackHostname as sharedIsLoopbackHostname,
  resolveLabUiBase as sharedResolveLabUiBase,
} from '../../../../src/lib/labEntry.ts';

export {
  isLoopbackBase as atlasIsLoopbackBase,
  isLoopbackHostname as atlasIsLoopbackHostname,
  resolveLabUiBase as atlasResolveLabUiBase,
} from '../../../../src/lib/labEntry.ts';

export type HostLabResolveInput = {
  /** NEXT_PUBLIC_LAB_URL (may include path prefix e.g. …/app/lab) */
  envLabUrl?: string | null;
  hostname?: string;
  origin?: string;
};

export function isLoopbackHostname(hostname: string): boolean {
  return sharedIsLoopbackHostname(hostname);
}

export function isLoopbackBase(url: string): boolean {
  return sharedIsLoopbackBase(url);
}

/** Normalize a public origin to scheme://host[:port] (strip /app/lab suffix if present). */
export function normalizePublicOrigin(publicOrigin: string): string {
  let o = (publicOrigin ?? '').trim().replace(/\/$/, '');
  if (!o) return '';
  // Operators sometimes paste the full Lab base; strip once so we do not double /app/lab.
  if (/\/app\/lab$/i.test(o)) {
    o = o.replace(/\/app\/lab$/i, '');
  }
  return o.replace(/\/$/, '');
}

/**
 * Base URL of the WaveWorld Lab app (no trailing slash).
 * Does not append the `/lab` page segment.
 *
 * Rules (match Atlas + production deploy):
 * 1. Non-loopback env wins.
 * 2. Public page + loopback/empty env → same-origin `/app/lab` (Caddy → apps/lab).
 * 3. Loopback page → env if set, else `http://127.0.0.1:3000`.
 */
export function resolveHostLabUiBase(input: HostLabResolveInput = {}): string {
  return sharedResolveLabUiBase({
    envLabUrl: input.envLabUrl,
    hostname: input.hostname,
    origin: input.origin,
  });
}

/** True when Lab base is embeddable/openable in this browser context. */
export function resolveHostLabConfigured(input: HostLabResolveInput = {}): boolean {
  const base = resolveHostLabUiBase(input);
  if (!base) return false;
  if (!isLoopbackBase(base)) return true;
  const hostname = input.hostname ?? '';
  // SSR / unit tests without hostname: allow loopback default
  if (!hostname && !input.origin) return true;
  return isLoopbackHostname(hostname);
}

/** Full engineering Lab page URL (…/lab) or null when not embeddable here. */
export function resolveHostLabPageUrl(input: HostLabResolveInput = {}): string | null {
  if (!resolveHostLabConfigured(input)) return null;
  const base = resolveHostLabUiBase(input);
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/lab`;
}

/** Health probe under Lab basePath: …/app/lab → …/app/lab/api/health */
export function resolveHostLabHealthUrl(labUiBase: string): string | null {
  const base = (labUiBase ?? '').trim().replace(/\/$/, '');
  if (!base) return null;
  return `${base}/api/health`;
}

export type HostLabGatewayMode = 'lab-live' | 'shell-fallback';

export function resolveHostLabGatewayMode(
  input: HostLabResolveInput = {},
): HostLabGatewayMode {
  return resolveHostLabPageUrl(input) ? 'lab-live' : 'shell-fallback';
}

/**
 * Pure iframe on/off + degrade decision for Host /lab (and documented
 * Atlas /lab-cfd parity). Readable shell when not embeddable.
 */
export type HostLabIframeReason =
  | 'live'
  | 'collapsed'
  | 'lab-unreachable'
  | 'not-configured'
  | 'shell-fallback';

export type HostLabIframeDecision = {
  show: boolean;
  reason: HostLabIframeReason;
  /** When show=false, operator/user-facing short reason (EN). */
  degradeNoteEn: string;
};

export type HostLabIframeInput = {
  mode: HostLabGatewayMode;
  labSrc: string | null;
  /** null = health still checking (allow provisional embed). */
  labOk: boolean | null;
  iframeOn: boolean;
};

const DEGRADE_NOTES: Record<Exclude<HostLabIframeReason, 'live'>, string> = {
  collapsed: 'Embed collapsed by user — shell links remain (open in new tab / teaching 2D / Atlas /lab-cfd).',
  'lab-unreachable':
    '3D Lab health failed — embed degraded to shell. Retry new tab or teaching 2D; Atlas gateway /lab-cfd uses the same /app/lab base.',
  'not-configured':
    'Lab URL not embeddable here — shell only. Prefer same-origin /app/lab; never iframe loopback for public visitors.',
  'shell-fallback':
    'Gateway in shell-fallback mode — no live embed. Check NEXT_PUBLIC_LAB_URL / same-origin /app/lab and Caddy /app/lab*.',
};

/**
 * Decide whether Host /lab should render the engineering Lab iframe.
 * Contract: live + user on + labOk !== false → show; else readable degrade.
 */
export function resolveHostLabIframeDecision(input: HostLabIframeInput): HostLabIframeDecision {
  if (!input.labSrc || input.mode !== 'lab-live') {
    const reason: HostLabIframeReason = !input.labSrc ? 'not-configured' : 'shell-fallback';
    return { show: false, reason, degradeNoteEn: DEGRADE_NOTES[reason] };
  }
  if (input.labOk === false) {
    return {
      show: false,
      reason: 'lab-unreachable',
      degradeNoteEn: DEGRADE_NOTES['lab-unreachable'],
    };
  }
  if (!input.iframeOn) {
    return { show: false, reason: 'collapsed', degradeNoteEn: DEGRADE_NOTES.collapsed };
  }
  return { show: true, reason: 'live', degradeNoteEn: '' };
}

/** Default open tracker while Lab remains a preview (#88). Not a closed historical issue. */
export const DEFAULT_LAB_BLOCKER_ISSUE = 53;

export function labPreviewNoteEn(blockerIssue: number): string {
  return `The engineering Lab is a preview (tracker #${blockerIssue}). This gateway must not claim the Lab is fully production-usable until WAVEWORLD_LAB_CLAIM_FULLY_USABLE=1.`;
}

export function labPreviewNoteZh(blockerIssue: number): string {
  return `工程 Lab 仍为预览（跟踪 #${blockerIssue}）。在 WAVEWORLD_LAB_CLAIM_FULLY_USABLE=1 之前，本网关不得宣称工程 Lab 已完全可用。`;
}

/** Shared product honesty — historical export name; text is preview copy, not closed #49. */
export const LAB_ISSUE_49_NOTE_EN = labPreviewNoteEn(DEFAULT_LAB_BLOCKER_ISSUE);

export const LAB_ISSUE_49_NOTE_ZH = labPreviewNoteZh(DEFAULT_LAB_BLOCKER_ISSUE);

/**
 * Machine-readable L2 honesty for Host /api/health and /api/readiness.
 * Host process ok/ready must never be interpreted as “Lab fully usable”
 * while the Lab remains a preview.
 */
export type HostLabUsabilityHonesty = {
  claimFullyUsable: boolean;
  blockerIssue: number;
  blockerOpen: boolean;
  /** Path/gateway live is independent of full usability. */
  pathLiveNotFullyUsable: boolean;
  noteEn: string;
  noteZh: string;
};

/** Open tracker for “Lab not fully usable” — default is the live backlog (#53), not closed #79/#49. */
export function labBlockerIssueNumber(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const n = Number(env.WAVEWORLD_LAB_BLOCKER_ISSUE ?? String(DEFAULT_LAB_BLOCKER_ISSUE));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_LAB_BLOCKER_ISSUE;
}

/** Honesty from env — WAVEWORLD_LAB_CLAIM_FULLY_USABLE=1 flips the claim. */
export function hostLabUsabilityHonesty(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HostLabUsabilityHonesty {
  const claimFullyUsable = env.WAVEWORLD_LAB_CLAIM_FULLY_USABLE === '1';
  const blockerIssue = labBlockerIssueNumber(env);
  const blockerOpen = !claimFullyUsable && env.WAVEWORLD_LAB_BLOCKER_OPEN !== '0';
  return {
    claimFullyUsable,
    blockerIssue,
    blockerOpen,
    pathLiveNotFullyUsable: !claimFullyUsable,
    noteEn: labPreviewNoteEn(blockerIssue),
    noteZh: labPreviewNoteZh(blockerIssue),
  };
}

/** Structural guard: health “ok” must not advertise full Lab usability. */
export function assertHostLabUsabilityHonesty(
  honesty: HostLabUsabilityHonesty = hostLabUsabilityHonesty(),
): void {
  if (honesty.blockerOpen) {
    if (honesty.claimFullyUsable) {
      throw new Error('claimFullyUsable must be false while Lab blocker is open');
    }
    if (!Number.isFinite(honesty.blockerIssue) || honesty.blockerIssue <= 0) {
      throw new Error('open Lab usability blocker must be a positive issue number');
    }
    if (!honesty.pathLiveNotFullyUsable) {
      throw new Error('pathLiveNotFullyUsable must be true while the Lab blocker is open');
    }
  }
  if (honesty.blockerOpen && !/must not claim/i.test(honesty.noteEn)) {
    throw new Error('lab usability noteEn must forbid full claim');
  }
  if (honesty.blockerOpen && !/不得宣称|不可宣称/.test(honesty.noteZh)) {
    throw new Error('lab usability noteZh must forbid full claim');
  }
}

/** Honest no-WebGPU messaging for browsers without a GPU adapter. */
export const LAB_NO_WEBGPU_NOTE_EN =
  'This browser has no WebGPU adapter. The engineering 3D Lab (W-sim LBM) requires WebGPU (Chrome/Edge 113+, Firefox 141+, Safari 26+ over HTTPS or localhost). Teaching 2D wind tunnel remains available without WebGPU.';

export const LAB_NO_WEBGPU_NOTE_ZH =
  '当前浏览器没有 WebGPU 适配器。工程 3D Lab（W-sim LBM）需要 WebGPU（Chrome/Edge 113+、Firefox 141+、Safari 26+；HTTPS 或 localhost）。教学 2D 风洞不依赖 WebGPU，仍可使用。';

export const LAB_ENV_COPY_HINT_EN =
  'Bake the same public base for Host and Atlas: NEXT_PUBLIC_LAB_URL and VITE_LAB_URL (e.g. https://host/app/lab). Prefer unset on public Host so the page defaults to same-origin /app/lab. Never bake loopback for public visitors.';

/** Atlas SPA path that embeds the same public Lab base (Caddy file_server → dist). */
export const LAB_CFD_GATEWAY_PATH = '/lab-cfd';

export const LAB_CFD_GATEWAY_NOTE_EN =
  'Atlas /lab-cfd is the SPA L2 gateway (same public /app/lab base as Host /lab). Caddy must route /lab and /lab/ only to Host — not /lab* — so /lab-cfd stays on the Atlas SPA. Both gateways must iframe or open the same NEXT_PUBLIC_LAB_URL ≡ VITE_LAB_URL base; path live ≠ fully usable while the Lab remains a preview.';

/**
 * Preferred production env pair (documentation / deploy examples).
 * Values are placeholders — operators substitute the public host.
 * NEXT_PUBLIC_LAB_URL and VITE_LAB_URL are always identical.
 */
export function preferredLabEnvPair(publicOrigin: string): {
  NEXT_PUBLIC_LAB_URL: string;
  VITE_LAB_URL: string;
  note: string;
  /** True when both keys are equal (always for this helper). */
  equal: boolean;
} {
  const o = normalizePublicOrigin(publicOrigin);
  const base = o ? `${o}/app/lab` : '/app/lab';
  return {
    NEXT_PUBLIC_LAB_URL: base,
    VITE_LAB_URL: base,
    note: LAB_ENV_COPY_HINT_EN,
    equal: true,
  };
}

/** Assert deploy bake contract: Host + Atlas Lab bases must match when both set. */
export function labEnvPairEqual(
  nextPublicLabUrl: string | null | undefined,
  viteLabUrl: string | null | undefined,
): boolean {
  const a = (nextPublicLabUrl ?? '').trim().replace(/\/$/, '');
  const b = (viteLabUrl ?? '').trim().replace(/\/$/, '');
  if (!a || !b) return true; // one unset is OK (Host prefers unset → same-origin)
  return a === b;
}
