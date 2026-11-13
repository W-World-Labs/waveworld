/**
 * Host platform tier map (A5 · ← #34 / docs/sim-platform-upgrade.md).
 *
 * L0 teaching · L1 windtunnel · L2 engineering Lab · L3 batch
 *
 * Pure data for Host entry surfaces (/ · /lab · /jobs). Does not claim the
 * engineering Lab is fully production-usable while it remains a preview.
 */

import { LAB_ISSUE_49_NOTE_EN, LAB_ISSUE_49_NOTE_ZH } from './lab-entry';

export type HostNavTierId = 'L0' | 'L1' | 'L2' | 'L3';

export type HostNavTier = {
  id: HostNavTierId;
  /** Short English product label (e.g. "teaching") */
  shortEn: string;
  shortZh: string;
  titleEn: string;
  titleZh: string;
  /** Honest one-line description — no overclaim */
  blurbEn: string;
  blurbZh: string;
  /** Primary host/atlas href for this tier (path or absolute) */
  href: string;
  /** Secondary related entries */
  relatedHrefs: readonly string[];
  /**
   * When true, UI must not imply this surface is fully production-ready.
   * L2 stays true while the Lab remains a preview.
   */
  blockedClaimFullyUsable: boolean;
  blockerIssue?: number;
};

/** Ordered L0 → L3 map shown on Host entry surfaces. */
export const HOST_NAV_TIERS: readonly HostNavTier[] = [
  {
    id: 'L0',
    shortEn: 'teaching',
    shortZh: '教学轻仿真',
    titleEn: 'L0 · Browser teaching demos',
    titleZh: 'L0 · 浏览器教学轻仿真',
    blurbEn:
      'Atlas Sims catalog leaves (2D / simple demos). Teaching and orientation only — not engineering CFD.',
    blurbZh: 'Atlas 仿真目录叶子（2D / 简易 demo）。仅教学与认路，不是工程 CFD。',
    href: '/',
    relatedHrefs: ['/fluid?legacy=1', '/sim?legacy=1'],
    blockedClaimFullyUsable: false,
  },
  {
    id: 'L1',
    shortEn: 'windtunnel',
    shortZh: '教学风洞',
    titleEn: 'L1 · Teaching wind tunnel (2D)',
    titleZh: 'L1 · 教学风洞（2D）',
    blurbEn:
      'Browser 2D Kármán street demo at /windtunnel?legacy=1. Not the WaveWorld 3D HQ Lab.',
    blurbZh: '浏览器 2D 卡门涡街 /windtunnel?legacy=1。不是 WaveWorld 3D 工程 Lab。',
    href: '/windtunnel?legacy=1',
    relatedHrefs: ['/fluid?legacy=1'],
    blockedClaimFullyUsable: false,
  },
  {
    id: 'L2',
    shortEn: 'engineering Lab',
    shortZh: '工程 Lab',
    titleEn: 'L2 · Engineering Lab (3D)',
    titleZh: 'L2 · 工程 Lab（3D）',
    blurbEn:
      'WebGPU HQ surface: Host /lab gateway · public /app/lab · Atlas /lab-cfd. Path live ≠ fully usable while the Lab is a preview.',
    blurbZh:
      'WebGPU HQ：Host /lab 网关 · 公网 /app/lab · Atlas /lab-cfd。路径可达 ≠ 在预览期内宣称完全可用。',
    href: '/lab',
    relatedHrefs: ['/app/lab/lab', '/lab-cfd'],
    blockedClaimFullyUsable: true,
    blockerIssue: Number(process.env.WAVEWORLD_LAB_BLOCKER_ISSUE ?? '53') || 53,
  },
  {
    id: 'L3',
    shortEn: 'batch',
    shortZh: '批算',
    titleEn: 'L3 · Batch / settlement jobs',
    titleZh: 'L3 · 批算 / 结算任务',
    blurbEn:
      'Host jobs board and Atlas /batch-jobs: claim → KPI + artifact. Settlement plane (W-Sim), not browser demos.',
    blurbZh: 'Host 任务板与 Atlas /batch-jobs：claim → KPI + artifact。结算平面（W-Sim），不是浏览器 demo。',
    href: '/jobs',
    relatedHrefs: ['/batch-jobs', '/api/health'],
    blockedClaimFullyUsable: false,
  },
] as const;

export const HOST_NAV_TIER_BY_ID: Readonly<Record<HostNavTierId, HostNavTier>> = {
  L0: HOST_NAV_TIERS[0]!,
  L1: HOST_NAV_TIERS[1]!,
  L2: HOST_NAV_TIERS[2]!,
  L3: HOST_NAV_TIERS[3]!,
};

/** Compact header links for Host pages (L1–L3 primary product paths). */
export const HOST_ENTRY_NAV_LINKS: readonly {
  tier: HostNavTierId;
  labelEn: string;
  href: string;
}[] = [
  { tier: 'L1', labelEn: 'L1 Teaching 2D', href: '/windtunnel?legacy=1' },
  { tier: 'L2', labelEn: 'L2 Lab gateway', href: '/lab' },
  { tier: 'L3', labelEn: 'L3 Jobs', href: '/jobs' },
  { tier: 'L3', labelEn: 'L3 Batch (Atlas)', href: '/batch-jobs' },
];

/** Shared Lab-preview honesty (re-export for entry pages / tests). */
export const NAV_TIER_L2_BLOCKER_NOTE_EN = LAB_ISSUE_49_NOTE_EN;
export const NAV_TIER_L2_BLOCKER_NOTE_ZH = LAB_ISSUE_49_NOTE_ZH;

/**
 * Structural invariants for Host nav honesty (unit + e2e/nav structure).
 * Throws with a message if the map drifts into misleading copy.
 */
export function assertHostNavTierHonesty(tiers: readonly HostNavTier[] = HOST_NAV_TIERS): void {
  const ids = tiers.map((t) => t.id);
  if (ids.join(',') !== 'L0,L1,L2,L3') {
    throw new Error(`Host nav tiers must be L0→L3 in order, got ${ids.join(',')}`);
  }

  const l0 = tiers.find((t) => t.id === 'L0')!;
  const l1 = tiers.find((t) => t.id === 'L1')!;
  const l2 = tiers.find((t) => t.id === 'L2')!;
  const l3 = tiers.find((t) => t.id === 'L3')!;

  if (!/teach/i.test(l0.shortEn) && !/teach/i.test(l0.titleEn)) {
    throw new Error('L0 must be labeled teaching');
  }
  if (!/windtunnel/i.test(l1.shortEn) && !/wind\s*tunnel/i.test(l1.titleEn)) {
    throw new Error('L1 must be labeled windtunnel');
  }
  if (!/lab/i.test(l2.shortEn) && !/lab/i.test(l2.titleEn)) {
    throw new Error('L2 must be labeled engineering Lab');
  }
  if (!/batch/i.test(l3.shortEn) && !/batch|job|settlement/i.test(l3.titleEn)) {
    throw new Error('L3 must be labeled batch');
  }

  // Do not let L1 hrefs look like the 3D Lab path
  if (l1.href.includes('/app/lab') || l1.href === '/lab') {
    throw new Error('L1 windtunnel must not point at engineering Lab paths');
  }
  if (!l1.href.includes('windtunnel')) {
    throw new Error('L1 primary href must include windtunnel');
  }

  // L2 honesty while the open Lab blocker is set (issue from WAVEWORLD_LAB_BLOCKER_ISSUE).
  if (!l2.blockedClaimFullyUsable || !l2.blockerIssue) {
    throw new Error('L2 must mark blockedClaimFullyUsable with a positive blockerIssue while open');
  }
  if (!/must not claim/i.test(NAV_TIER_L2_BLOCKER_NOTE_EN)) {
    throw new Error('L2 blocker note must forbid full-usability claim');
  }
  if (l2.href !== '/lab' && !l2.relatedHrefs.includes('/app/lab/lab')) {
    throw new Error('L2 must expose Host /lab and/or public /app/lab');
  }

  // L3 is jobs/batch, not windtunnel
  if (l3.href.includes('windtunnel')) {
    throw new Error('L3 batch must not primary-link to teaching windtunnel');
  }
}

/** Human-readable summary lines for status UIs. */
export function formatHostNavTierLine(tier: HostNavTier, lang: 'en' | 'zh' = 'en'): string {
  const title = lang === 'zh' ? tier.titleZh : tier.titleEn;
  const blurb = lang === 'zh' ? tier.blurbZh : tier.blurbEn;
  const block =
    tier.blockedClaimFullyUsable && tier.blockerIssue
      ? lang === 'zh'
        ? ` · blocker #${tier.blockerIssue}（不可宣称完全可用）`
        : ` · blocker #${tier.blockerIssue} (not fully usable claim)`
      : '';
  return `${title}${block}: ${blurb}`;
}
