'use client';

import { HOST_BUILD_STAMP } from '../../lib/build-stamp';
import {
  LAB_CFD_GATEWAY_NOTE_EN,
  LAB_CFD_GATEWAY_PATH,
  LAB_ISSUE_49_NOTE_EN,
  LAB_ISSUE_49_NOTE_ZH,
  LAB_NO_WEBGPU_NOTE_EN,
  LAB_NO_WEBGPU_NOTE_ZH,
  resolveHostLabGatewayMode,
  resolveHostLabHealthUrl,
  resolveHostLabIframeDecision,
  resolveHostLabPageUrl,
  resolveHostLabUiBase,
  type HostLabResolveInput,
} from '../../lib/lab-entry';
import { HOST_ENTRY_NAV_LINKS, HOST_NAV_TIER_BY_ID } from '../../lib/nav-tiers';
/**
 * Host-side lab gateway at /lab (L2 engineering Lab entry).
 *
 * Full WebGPU lab lives in apps/lab. Production must NOT iframe
 * http://127.0.0.1:3000 for public users — prefer same-origin /app/lab
 * (Caddy → tuanliu) or a non-loopback NEXT_PUBLIC_LAB_URL that matches
 * Atlas VITE_LAB_URL. Parallel Atlas gateway: /lab-cfd (SPA). Honesty:
 * #49 open → do not claim Lab fully usable; no WebGPU → explicit message +
 * teaching 2D (L1) links. Tiers: L0 teaching · L1 windtunnel · L2 this Lab ·
 * L3 batch. Iframe on/off + health degrade → pure resolveHostLabIframeDecision.
 */
import { useEffect, useMemo, useState } from 'react';

function runtimeLabInput(): HostLabResolveInput {
  const envLabUrl = (process.env.NEXT_PUBLIC_LAB_URL || '').trim() || null;
  if (typeof window === 'undefined') {
    return { envLabUrl };
  }
  return {
    envLabUrl,
    hostname: window.location.hostname,
    origin: window.location.origin,
  };
}

type Health = {
  ok?: boolean;
  status?: string;
  service?: string;
  version?: string;
  uptimeSeconds?: number;
  features?: string[];
};

type WebGpuStatus = 'checking' | 'available' | 'unavailable' | 'unknown';

export default function LabGatewayPage() {
  const [input, setInput] = useState<HostLabResolveInput>(() => runtimeLabInput());
  const [hostHealth, setHostHealth] = useState<Health | null>(null);
  const [hostHealthErr, setHostHealthErr] = useState<string | null>(null);
  const [labOk, setLabOk] = useState<boolean | null>(null);
  const [labHealthErr, setLabHealthErr] = useState<string | null>(null);
  const [iframeOn, setIframeOn] = useState(true);
  const [webgpu, setWebgpu] = useState<WebGpuStatus>('checking');

  useEffect(() => {
    setInput(runtimeLabInput());
  }, []);

  const labBase = useMemo(() => resolveHostLabUiBase(input), [input]);
  const labSrc = useMemo(() => resolveHostLabPageUrl(input), [input]);
  const mode = useMemo(() => resolveHostLabGatewayMode(input), [input]);
  const labHealthUrl = useMemo(
    () => (labSrc ? resolveHostLabHealthUrl(labBase) : null),
    [labSrc, labBase],
  );
  const live = mode === 'lab-live' && !!labSrc;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Health>;
      })
      .then((h) => {
        if (!cancelled) {
          setHostHealth(h);
          setHostHealthErr(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setHostHealth(null);
          setHostHealthErr(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!labHealthUrl) {
      setLabOk(null);
      setLabHealthErr(null);
      return;
    }
    setLabOk(null);
    setLabHealthErr(null);
    fetch(labHealthUrl, { method: 'GET', cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          try {
            const body = (await res.json()) as { ok?: boolean };
            setLabOk(body.ok !== false);
          } catch {
            setLabOk(true);
          }
          return;
        }
        // Older Lab builds may lack /api/health — soft-check page reachability.
        if (res.status === 404 && labSrc) {
          try {
            const page = await fetch(labSrc, { method: 'GET', cache: 'no-store' });
            if (!cancelled) {
              setLabOk(page.ok);
              if (!page.ok) setLabHealthErr(`Lab page HTTP ${page.status}`);
            }
          } catch (err: unknown) {
            if (!cancelled) {
              setLabOk(false);
              setLabHealthErr(err instanceof Error ? err.message : String(err));
            }
          }
          return;
        }
        if (!cancelled) {
          setLabOk(false);
          setLabHealthErr(`Lab health HTTP ${res.status}`);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLabOk(false);
          setLabHealthErr(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [labHealthUrl, labSrc]);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      if (typeof navigator === 'undefined') {
        if (!cancelled) setWebgpu('unknown');
        return;
      }
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } })
        .gpu;
      if (!gpu || typeof gpu.requestAdapter !== 'function') {
        if (!cancelled) setWebgpu('unavailable');
        return;
      }
      try {
        const adapter = await gpu.requestAdapter();
        if (!cancelled) setWebgpu(adapter ? 'available' : 'unavailable');
      } catch {
        if (!cancelled) setWebgpu('unavailable');
      }
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  const featureList = useMemo(
    () => hostHealth?.features?.slice(0, 12) ?? [],
    [hostHealth],
  );
  const iframeDecision = useMemo(
    () =>
      resolveHostLabIframeDecision({
        mode,
        labSrc,
        labOk,
        iframeOn,
      }),
    [mode, labSrc, labOk, iframeOn],
  );
  const showIframe = iframeDecision.show;
  const shellOnly = !showIframe;

  return (
    <main
      style={{
        margin: 0,
        minHeight: '100vh',
        background: '#09090b',
        color: '#e4e4e7',
        fontFamily: 'system-ui, sans-serif',
      }}
      data-lab-mode={mode}
      data-webgpu={webgpu}
    >
      <header
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '12px 16px',
          borderBottom: '1px solid #27272a',
        }}
      >
        <strong>WaveWorld Host · L2 Engineering Lab</strong>
        {labSrc ? (
          <a href={labSrc} target="_blank" rel="noreferrer" style={{ color: '#22d3ee' }}>
            Open L2 3D Lab
          </a>
        ) : (
          <a
            href="/app/lab/lab"
            style={{ color: '#22d3ee', fontSize: 14 }}
            title="tuanliu under /app/lab"
          >
            Try /app/lab/lab
          </a>
        )}
        <a href="/" style={{ color: '#a1a1aa' }}>
          L0–L3 map
        </a>
        {HOST_ENTRY_NAV_LINKS.filter((l) => l.href !== '/lab').map((link) => (
          <a key={`${link.tier}-${link.href}`} href={link.href} style={{ color: '#a1a1aa' }}>
            {link.labelEn}
          </a>
        ))}
        <a href={LAB_CFD_GATEWAY_PATH} style={{ color: '#a1a1aa' }} title={LAB_CFD_GATEWAY_NOTE_EN}>
          Atlas L2 gateway ({LAB_CFD_GATEWAY_PATH})
        </a>
        <a href="/api/health" style={{ color: '#a1a1aa' }}>
          Health
        </a>
      </header>

      {/* Status strip: mode · host · lab · WebGPU · #49 honesty */}
      <section
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 16px',
          alignItems: 'center',
          padding: '10px 16px',
          borderBottom: '1px solid #27272a',
          background: '#0c0c0f',
          fontSize: 13,
        }}
        role="status"
        aria-live="polite"
      >
        <span>
          L2 mode:{' '}
          <strong style={{ color: live ? '#34d399' : '#fbbf24' }}>
            {live
              ? 'Engineering Lab path live (not a full-usability claim)'
              : 'Shell fallback · Lab URL not embeddable'}
          </strong>
        </span>
        <span style={{ color: '#a1a1aa' }}>
          Host API:{' '}
          {hostHealthErr ? (
            <span style={{ color: '#f87171' }}>unreachable ({hostHealthErr})</span>
          ) : hostHealth ? (
            <span style={{ color: hostHealth.ok ? '#34d399' : '#fbbf24' }}>
              {hostHealth.status ?? (hostHealth.ok ? 'healthy' : 'degraded')}
            </span>
          ) : (
            'checking…'
          )}
        </span>
        <span style={{ color: '#a1a1aa' }}>
          3D Lab:{' '}
          {!labHealthUrl && <span style={{ color: '#fbbf24' }}>URL not configured</span>}
          {labHealthUrl && labOk === null && 'checking…'}
          {labHealthUrl && labOk === true && (
            <span style={{ color: '#34d399' }}>available</span>
          )}
          {labHealthUrl && labOk === false && (
            <span style={{ color: '#f87171' }}>
              temporarily unavailable
              {labHealthErr ? ` (${labHealthErr})` : ''}
            </span>
          )}
        </span>
        <span style={{ color: '#a1a1aa' }}>
          WebGPU:{' '}
          {webgpu === 'checking' && 'checking…'}
          {webgpu === 'available' && <span style={{ color: '#34d399' }}>available</span>}
          {webgpu === 'unavailable' && (
            <span style={{ color: '#fbbf24' }}>not available in this browser</span>
          )}
          {webgpu === 'unknown' && 'unknown'}
        </span>
      </section>

      {/* #49 honesty — always visible; never claim full Lab usable while open */}
      <aside
        style={{
          margin: '12px 16px 0',
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid #3f3f46',
          background: '#18181b',
          fontSize: 13,
          lineHeight: 1.5,
          color: '#d4d4d8',
        }}
        data-lab-honesty="preview"
      >
        <div style={{ color: '#a1a1aa', fontSize: 11, marginBottom: 4 }}>
          L2 reliability · Lab preview · {HOST_NAV_TIER_BY_ID.L2.shortEn}
        </div>
        <p style={{ margin: 0 }}>{LAB_ISSUE_49_NOTE_EN}</p>
        <p style={{ margin: '6px 0 0', color: '#71717a', fontSize: 12 }}>{LAB_ISSUE_49_NOTE_ZH}</p>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#a1a1aa' }}>
          Tiers: <strong>L0</strong> teaching · <strong>L1</strong> windtunnel ·{' '}
          <strong>L2</strong> this Lab · <strong>L3</strong> batch — L1 is not L2.
        </p>
      </aside>

      {webgpu === 'unavailable' && (
        <aside
          style={{
            margin: '10px 16px 0',
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #854d0e',
            background: '#1c1917',
            fontSize: 13,
            lineHeight: 1.5,
            color: '#fde68a',
          }}
          data-lab-honesty="no-webgpu"
        >
          <div style={{ fontSize: 11, marginBottom: 4, color: '#a8a29e' }}>No WebGPU</div>
          <p style={{ margin: 0 }}>{LAB_NO_WEBGPU_NOTE_EN}</p>
          <p style={{ margin: '6px 0 0', color: '#a8a29e', fontSize: 12 }}>
            {LAB_NO_WEBGPU_NOTE_ZH}
          </p>
          <p style={{ margin: '10px 0 0' }}>
            <a href="/windtunnel?legacy=1" style={{ color: '#22d3ee' }}>
              /windtunnel?legacy=1
            </a>{' '}
            · teaching 2D (no WebGPU required)
          </p>
        </aside>
      )}

      {labOk === false && labSrc && (
        <aside
          style={{
            margin: '10px 16px 0',
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #7f1d1d',
            background: '#1c0a0a',
            fontSize: 13,
            lineHeight: 1.5,
            color: '#fecaca',
          }}
          data-lab-honesty="lab-unreachable"
        >
          <strong>3D Lab temporarily unreachable</strong>
          <p style={{ margin: '6px 0 0' }}>
            Embed degraded to shell. Retry open in a new tab or use teaching 2D / jobs board.
            {labHealthErr ? ` Probe: ${labHealthErr}.` : ''}
          </p>
          <p style={{ margin: '8px 0 0' }}>
            <a href={labSrc} target="_blank" rel="noreferrer" style={{ color: '#22d3ee' }}>
              Open {labSrc}
            </a>
            {' · '}
            <a href="/windtunnel?legacy=1" style={{ color: '#22d3ee' }}>
              Teaching 2D
            </a>
            {' · '}
            <a href={LAB_CFD_GATEWAY_PATH} style={{ color: '#22d3ee' }}>
              Atlas {LAB_CFD_GATEWAY_PATH}
            </a>
          </p>
        </aside>
      )}

      {shellOnly ? (
        <section
          style={{ padding: 24, maxWidth: 760, lineHeight: 1.55 }}
          data-lab-iframe-reason={iframeDecision.reason}
        >
          <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>L2 · Engineering lab gateway</h1>
          {iframeDecision.degradeNoteEn ? (
            <p
              style={{
                margin: '0 0 12px',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #3f3f46',
                background: '#18181b',
                fontSize: 13,
                color: '#d4d4d8',
              }}
              data-lab-degrade={iframeDecision.reason}
            >
              {iframeDecision.degradeNoteEn}
            </p>
          ) : null}
          <p style={{ color: '#a1a1aa', marginTop: 0 }}>
            Host <strong>L2</strong> entry at <code style={{ color: '#d4d4d8' }}>/lab</code>. Public
            3D surface is <code style={{ color: '#d4d4d8' }}>/app/lab</code>
            {labSrc ? (
              <>
                {' '}
                (
                <a href={labSrc} target="_blank" rel="noreferrer" style={{ color: '#22d3ee' }}>
                  open full page
                </a>
                )
              </>
            ) : (
              <>
                {' '}
                (
                <a href="/app/lab/lab" style={{ color: '#22d3ee' }}>
                  /app/lab/lab
                </a>
                )
              </>
            )}
            . Atlas gateway:{' '}
            <a href={LAB_CFD_GATEWAY_PATH} style={{ color: '#22d3ee' }} title={LAB_CFD_GATEWAY_NOTE_EN}>
              {LAB_CFD_GATEWAY_PATH}
            </a>
            . Teaching 2D:{' '}
            <a href="/windtunnel?legacy=1" style={{ color: '#22d3ee' }}>
              /windtunnel?legacy=1
            </a>
            .
          </p>
          <div
            style={{
              border: '1px solid #27272a',
              borderRadius: 12,
              padding: 16,
              background: '#18181b',
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 13, color: '#71717a', marginBottom: 6 }}>Host health</div>
            {hostHealthErr && (
              <p style={{ color: '#f87171', margin: 0 }}>Unreachable: {hostHealthErr}</p>
            )}
            {hostHealth && (
              <p style={{ margin: 0 }}>
                <span style={{ color: hostHealth.ok ? '#34d399' : '#fbbf24' }}>
                  {hostHealth.status ?? (hostHealth.ok ? 'healthy' : 'degraded')}
                </span>
                {hostHealth.service ? ` · ${hostHealth.service}` : ''}
                {hostHealth.version ? ` · v${hostHealth.version}` : ''}
                {typeof hostHealth.uptimeSeconds === 'number'
                  ? ` · up ${Math.round(hostHealth.uptimeSeconds)}s`
                  : ''}
              </p>
            )}
            {featureList.length > 0 && (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#a1a1aa' }}>
                features: {featureList.join(', ')}
              </p>
            )}
          </div>
          <ul style={{ paddingLeft: 18, color: '#d4d4d8' }} data-host-nav-tiers="L0-L3">
            <li data-tier="L2">
              <strong>L2</strong> Engineering 3D Lab (tuanliu · WebGPU):{' '}
              <a href={labSrc || '/app/lab/lab'} style={{ color: '#22d3ee' }}>
                {labSrc || '/app/lab/lab'}
              </a>
              {' · '}
              <a href={LAB_CFD_GATEWAY_PATH} style={{ color: '#22d3ee' }}>
                {LAB_CFD_GATEWAY_PATH}
              </a>
            </li>
            <li data-tier="L1">
              <strong>L1</strong> Teaching wind tunnel (not L2):{' '}
              <a href="/windtunnel?legacy=1" style={{ color: '#22d3ee' }}>
                /windtunnel?legacy=1
              </a>
            </li>
            <li data-tier="L0">
              <strong>L0</strong> Browser teaching demos:{' '}
              <a href="/" style={{ color: '#22d3ee' }}>
                Host tier map
              </a>
            </li>
            <li data-tier="L3">
              <strong>L3</strong> Batch / settlement:{' '}
              <a href="/batch-jobs" style={{ color: '#22d3ee' }}>
                /batch-jobs
              </a>
              {' · '}
              <a href="/jobs" style={{ color: '#22d3ee' }}>
                /jobs
              </a>
            </li>
            <li>
              API health:{' '}
              <a href="/api/health" style={{ color: '#22d3ee' }}>
                /api/health
              </a>
              {labHealthUrl ? (
                <>
                  {' · Lab health: '}
                  <a href={labHealthUrl} style={{ color: '#22d3ee' }}>
                    {labHealthUrl}
                  </a>
                </>
              ) : null}
            </li>
          </ul>
          <p style={{ fontSize: 13, color: '#71717a', marginTop: 20 }}>
            Lab base: <code style={{ color: '#a1a1aa' }}>{labBase || '(empty)'}</code>
            {labBase && isLoopbackBaseHint(labBase)
              ? ' (loopback — public visitors use same-origin /app/lab).'
              : ' · public path under Caddy.'}
          </p>
          <p style={{ fontSize: 12, color: '#52525b', marginTop: 8 }}>
            Env: set <code>NEXT_PUBLIC_LAB_URL</code> and Atlas <code>VITE_LAB_URL</code> to the{' '}
            <em>same</em> public base (e.g. https://host/app/lab), or leave Host unset so this page
            defaults to same-origin /app/lab. Never bake loopback for public builds.
          </p>
          {live && labSrc && (
            <p style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setIframeOn(true)}
                style={{
                  background: '#0891b2',
                  color: '#fff',
                  border: 0,
                  borderRadius: 8,
                  padding: '8px 14px',
                  cursor: 'pointer',
                }}
              >
                Show 3D embed
              </button>
            </p>
          )}
          <p style={{ fontSize: 11, color: '#52525b', marginTop: 16 }}>
            host build {HOST_BUILD_STAMP}
          </p>
        </section>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderBottom: '1px solid #27272a',
              fontSize: 12,
              color: '#a1a1aa',
            }}
          >
            <span>
              L2 Engineering Lab embed · WebGPU · /app/lab · preview
              {webgpu === 'unavailable' ? ' · (browser has no WebGPU — Lab may fail inside iframe)' : ''}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {labSrc && (
                <a
                  href={labSrc}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: '#fff',
                    background: '#0891b2',
                    borderRadius: 6,
                    padding: '4px 10px',
                    textDecoration: 'none',
                  }}
                >
                  New tab
                </a>
              )}
              <button
                type="button"
                onClick={() => setIframeOn(false)}
                style={{
                  background: 'transparent',
                  color: '#a1a1aa',
                  border: '1px solid #3f3f46',
                  borderRadius: 6,
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                Collapse
              </button>
            </div>
          </div>
          <iframe
            title="lab"
            src={labSrc!}
            style={{ width: '100%', flex: 1, border: 0, minHeight: 480 }}
            allow="gpu"
            data-sim-stage="lab-iframe"
          />
        </div>
      )}
    </main>
  );
}

function isLoopbackBaseHint(url: string): boolean {
  return /127\.0\.0\.1|localhost|\[::1\]|::1/i.test(url);
}
