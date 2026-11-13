/**
 * A5 host nav tier copy honesty (L0 teaching / L1 windtunnel / L2 Lab / L3 batch).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertHostNavTierHonesty,
  formatHostNavTierLine,
  HOST_ENTRY_NAV_LINKS,
  HOST_NAV_TIER_BY_ID,
  HOST_NAV_TIERS,
  NAV_TIER_L2_BLOCKER_NOTE_EN,
  NAV_TIER_L2_BLOCKER_NOTE_ZH,
} from '../src/lib/nav-tiers.ts';

describe('HOST_NAV_TIERS structure', () => {
  it('lists L0→L3 with teaching / windtunnel / Lab / batch labels', () => {
    assert.deepEqual(
      HOST_NAV_TIERS.map((t) => t.id),
      ['L0', 'L1', 'L2', 'L3'],
    );
    assert.match(HOST_NAV_TIER_BY_ID.L0.shortEn, /teach/i);
    assert.match(HOST_NAV_TIER_BY_ID.L1.shortEn, /windtunnel/i);
    assert.match(HOST_NAV_TIER_BY_ID.L2.shortEn, /lab/i);
    assert.match(HOST_NAV_TIER_BY_ID.L3.shortEn, /batch/i);
  });

  it('does not let L1 teaching windtunnel pretend to be L2 Lab', () => {
    const l1 = HOST_NAV_TIER_BY_ID.L1;
    assert.match(l1.href, /windtunnel/);
    assert.equal(l1.href.includes('/app/lab'), false);
    assert.match(l1.blurbEn, /not the waveworld 3d/i);
  });

  it('keeps L2 blockedClaimFullyUsable while Lab is a preview', () => {
    const l2 = HOST_NAV_TIER_BY_ID.L2;
    assert.equal(l2.blockedClaimFullyUsable, true);
    assert.equal(l2.blockerIssue, 53);
    assert.equal(l2.href, '/lab');
    assert.ok(l2.relatedHrefs.includes('/app/lab/lab') || l2.relatedHrefs.includes('/lab-cfd'));
    assert.match(NAV_TIER_L2_BLOCKER_NOTE_EN, /#53/);
    assert.match(NAV_TIER_L2_BLOCKER_NOTE_EN, /must not claim/i);
    assert.match(NAV_TIER_L2_BLOCKER_NOTE_ZH, /#53/);
  });

  it('maps L3 to jobs/batch settlement, not demos', () => {
    const l3 = HOST_NAV_TIER_BY_ID.L3;
    assert.equal(l3.href, '/jobs');
    assert.ok(l3.relatedHrefs.some((h) => h.includes('batch-jobs') || h.includes('jobs')));
    assert.match(l3.blurbEn, /settlement|batch|claim/i);
  });

  it('assertHostNavTierHonesty accepts the shipped map', () => {
    assert.doesNotThrow(() => assertHostNavTierHonesty());
  });

  it('assertHostNavTierHonesty rejects L2 without #49 block', () => {
    const bad = HOST_NAV_TIERS.map((t) =>
      t.id === 'L2' ? { ...t, blockedClaimFullyUsable: false, blockerIssue: undefined } : t,
    );
    assert.throws(() => assertHostNavTierHonesty(bad), /blockedClaimFullyUsable|#49/);
  });

  it('assertHostNavTierHonesty rejects L1 pointing at Lab', () => {
    const bad = HOST_NAV_TIERS.map((t) =>
      t.id === 'L1' ? { ...t, href: '/lab' } : t,
    );
    assert.throws(() => assertHostNavTierHonesty(bad), /L1/);
  });

  it('entry nav links cover L1–L3 product paths', () => {
    const tiers = new Set(HOST_ENTRY_NAV_LINKS.map((l) => l.tier));
    assert.ok(tiers.has('L1'));
    assert.ok(tiers.has('L2'));
    assert.ok(tiers.has('L3'));
    assert.ok(HOST_ENTRY_NAV_LINKS.some((l) => l.href === '/lab'));
    assert.ok(HOST_ENTRY_NAV_LINKS.some((l) => l.href === '/jobs'));
  });

  it('formatHostNavTierLine mentions blocker for L2', () => {
    const line = formatHostNavTierLine(HOST_NAV_TIER_BY_ID.L2, 'en');
    assert.match(line, /#53/);
    assert.match(line, /not fully usable/i);
  });
});
