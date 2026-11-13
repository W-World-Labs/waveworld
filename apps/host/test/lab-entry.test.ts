/**
 * A1 residual: Host lab entry / iframe degrade / env pair / lab-cfd notes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertHostLabUsabilityHonesty,
  hostLabUsabilityHonesty,
  isLoopbackBase,
  isLoopbackHostname,
  labEnvPairEqual,
  normalizePublicOrigin,
  preferredLabEnvPair,
  resolveHostLabConfigured,
  resolveHostLabGatewayMode,
  resolveHostLabHealthUrl,
  resolveHostLabIframeDecision,
  resolveHostLabPageUrl,
  resolveHostLabUiBase,
  LAB_CFD_GATEWAY_NOTE_EN,
  LAB_CFD_GATEWAY_PATH,
  LAB_ENV_COPY_HINT_EN,
  LAB_ISSUE_49_NOTE_EN,
  LAB_NO_WEBGPU_NOTE_EN,
} from '../src/lib/lab-entry.ts';

describe('isLoopbackHostname / isLoopbackBase', () => {
  it('recognizes loopback hostnames', () => {
    assert.equal(isLoopbackHostname('127.0.0.1'), true);
    assert.equal(isLoopbackHostname('localhost'), true);
    assert.equal(isLoopbackHostname('labs.auto.ml'), false);
  });

  it('recognizes loopback bases', () => {
    assert.equal(isLoopbackBase('http://127.0.0.1:3000'), true);
    assert.equal(isLoopbackBase('https://labs.auto.ml/app/lab'), false);
  });
});

describe('resolveHostLabUiBase', () => {
  it('public host without env → same-origin /app/lab', () => {
    const base = resolveHostLabUiBase({
      hostname: 'labs.auto.ml',
      origin: 'https://labs.auto.ml',
    });
    assert.equal(base, 'https://labs.auto.ml/app/lab');
  });

  it('public host with non-loopback env uses env', () => {
    assert.equal(
      resolveHostLabUiBase({
        envLabUrl: 'https://labs.auto.ml/app/lab/',
        hostname: 'labs.auto.ml',
        origin: 'https://labs.auto.ml',
      }),
      'https://labs.auto.ml/app/lab',
    );
  });

  it('public host ignores loopback env (uses same-origin /app/lab)', () => {
    assert.equal(
      resolveHostLabUiBase({
        envLabUrl: 'http://127.0.0.1:3000',
        hostname: 'labs.auto.ml',
        origin: 'https://labs.auto.ml',
      }),
      'https://labs.auto.ml/app/lab',
    );
  });

  it('loopback page uses loopback lab default', () => {
    assert.equal(
      resolveHostLabUiBase({
        hostname: '127.0.0.1',
        origin: 'http://127.0.0.1:3001',
      }),
      'http://127.0.0.1:3000',
    );
  });

  it('loopback page honors non-loopback env', () => {
    assert.equal(
      resolveHostLabUiBase({
        envLabUrl: 'https://labs.auto.ml/app/lab',
        hostname: '127.0.0.1',
        origin: 'http://127.0.0.1:3001',
      }),
      'https://labs.auto.ml/app/lab',
    );
  });
});

describe('resolveHostLabPageUrl / mode / health', () => {
  it('public → full /app/lab/lab page and lab-live mode', () => {
    const input = {
      hostname: 'labs.auto.ml',
      origin: 'https://labs.auto.ml',
    };
    assert.equal(
      resolveHostLabPageUrl(input),
      'https://labs.auto.ml/app/lab/lab',
    );
    assert.equal(resolveHostLabGatewayMode(input), 'lab-live');
    assert.equal(resolveHostLabConfigured(input), true);
  });

  it('health URL appends /api/health under basePath', () => {
    assert.equal(
      resolveHostLabHealthUrl('https://labs.auto.ml/app/lab'),
      'https://labs.auto.ml/app/lab/api/health',
    );
    assert.equal(resolveHostLabHealthUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/api/health');
    assert.equal(resolveHostLabHealthUrl(''), null);
  });
});

describe('resolveHostLabIframeDecision (on/off + degrade)', () => {
  const liveSrc = 'https://labs.auto.ml/app/lab/lab';

  it('shows iframe when lab-live, user on, health not false', () => {
    const d = resolveHostLabIframeDecision({
      mode: 'lab-live',
      labSrc: liveSrc,
      labOk: true,
      iframeOn: true,
    });
    assert.equal(d.show, true);
    assert.equal(d.reason, 'live');
  });

  it('allows provisional embed while health is still checking (labOk null)', () => {
    const d = resolveHostLabIframeDecision({
      mode: 'lab-live',
      labSrc: liveSrc,
      labOk: null,
      iframeOn: true,
    });
    assert.equal(d.show, true);
    assert.equal(d.reason, 'live');
  });

  it('degrades to shell when lab health fails', () => {
    const d = resolveHostLabIframeDecision({
      mode: 'lab-live',
      labSrc: liveSrc,
      labOk: false,
      iframeOn: true,
    });
    assert.equal(d.show, false);
    assert.equal(d.reason, 'lab-unreachable');
    assert.match(d.degradeNoteEn, /health failed/i);
    assert.match(d.degradeNoteEn, /lab-cfd/);
  });

  it('degrades when user collapses iframe (on/off)', () => {
    const d = resolveHostLabIframeDecision({
      mode: 'lab-live',
      labSrc: liveSrc,
      labOk: true,
      iframeOn: false,
    });
    assert.equal(d.show, false);
    assert.equal(d.reason, 'collapsed');
    assert.match(d.degradeNoteEn, /collapsed/i);
  });

  it('shell when not configured / no labSrc', () => {
    const d = resolveHostLabIframeDecision({
      mode: 'shell-fallback',
      labSrc: null,
      labOk: null,
      iframeOn: true,
    });
    assert.equal(d.show, false);
    assert.equal(d.reason, 'not-configured');
    assert.match(d.degradeNoteEn, /not embeddable/i);
  });
});

describe('env pair + honesty copy + lab-cfd', () => {
  it('preferredLabEnvPair keeps NEXT_PUBLIC_LAB_URL and VITE_LAB_URL identical', () => {
    const pair = preferredLabEnvPair('https://labs.auto.ml/');
    assert.equal(pair.NEXT_PUBLIC_LAB_URL, 'https://labs.auto.ml/app/lab');
    assert.equal(pair.VITE_LAB_URL, pair.NEXT_PUBLIC_LAB_URL);
    assert.equal(pair.equal, true);
    assert.match(pair.note, /NEXT_PUBLIC_LAB_URL/);
    assert.match(pair.note, /VITE_LAB_URL/);
  });

  it('preferredLabEnvPair does not double /app/lab when origin already is Lab base', () => {
    const pair = preferredLabEnvPair('https://labs.auto.ml/app/lab');
    assert.equal(pair.NEXT_PUBLIC_LAB_URL, 'https://labs.auto.ml/app/lab');
    assert.equal(pair.VITE_LAB_URL, pair.NEXT_PUBLIC_LAB_URL);
  });

  it('normalizePublicOrigin strips trailing /app/lab', () => {
    assert.equal(
      normalizePublicOrigin('https://labs.auto.ml/app/lab/'),
      'https://labs.auto.ml',
    );
    assert.equal(normalizePublicOrigin('https://labs.auto.ml'), 'https://labs.auto.ml');
  });

  it('labEnvPairEqual enforces NEXT_PUBLIC_LAB_URL ≡ VITE_LAB_URL when both set', () => {
    assert.equal(
      labEnvPairEqual(
        'https://labs.auto.ml/app/lab',
        'https://labs.auto.ml/app/lab',
      ),
      true,
    );
    assert.equal(
      labEnvPairEqual(
        'https://labs.auto.ml/app/lab',
        'http://127.0.0.1:3000',
      ),
      false,
    );
    // One unset is OK (Host prefers unset → same-origin /app/lab)
    assert.equal(labEnvPairEqual('', 'https://labs.auto.ml/app/lab'), true);
    assert.equal(labEnvPairEqual('https://labs.auto.ml/app/lab', null), true);
  });

  it('exposes preview honesty, no-WebGPU, and /lab-cfd gateway strings', () => {
    assert.match(LAB_ISSUE_49_NOTE_EN, /#53/);
    assert.doesNotMatch(LAB_ISSUE_49_NOTE_EN, /#49/);
    assert.match(LAB_ISSUE_49_NOTE_EN, /must not claim/i);
    assert.match(LAB_NO_WEBGPU_NOTE_EN, /WebGPU/i);
    assert.match(LAB_NO_WEBGPU_NOTE_EN, /Teaching 2D/i);
    assert.match(LAB_ENV_COPY_HINT_EN, /same-origin \/app\/lab/);
    assert.equal(LAB_CFD_GATEWAY_PATH, '/lab-cfd');
    assert.match(LAB_CFD_GATEWAY_NOTE_EN, /\/lab-cfd/);
    assert.match(LAB_CFD_GATEWAY_NOTE_EN, /\/lab and \/lab\//);
    assert.doesNotMatch(LAB_CFD_GATEWAY_NOTE_EN, /#49/);
  });

  it('hostLabUsabilityHonesty forbids full Lab claim while preview tracker is open', () => {
    const honesty = hostLabUsabilityHonesty();
    assert.equal(honesty.claimFullyUsable, false);
    assert.equal(honesty.blockerIssue, 53);
    assert.equal(honesty.blockerOpen, true);
    assert.equal(honesty.pathLiveNotFullyUsable, true);
    assert.match(honesty.noteEn, /#53/);
    assert.match(honesty.noteZh, /#53/);
    assert.doesNotMatch(honesty.noteEn, /#49|#79/);
    assert.doesNotThrow(() => assertHostLabUsabilityHonesty(honesty));
  });

  it('assertHostLabUsabilityHonesty rejects claimFullyUsable while blocker open', () => {
    assert.throws(
      () =>
        assertHostLabUsabilityHonesty({
          ...hostLabUsabilityHonesty(),
          claimFullyUsable: true,
        }),
      /claimFullyUsable/,
    );
  });

  it('assertHostLabUsabilityHonesty rejects zh note that omits #49 forbid claim', () => {
    assert.throws(
      () =>
        assertHostLabUsabilityHonesty({
          ...hostLabUsabilityHonesty(),
          noteZh: 'Lab 状态说明（无 blocker 引用）',
        }),
      /noteZh/,
    );
  });
});
