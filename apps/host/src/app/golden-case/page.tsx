'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type GoldenStatus = {
  caseId: string; stage: 'not-started' | 'running' | 'failed' | 'ready-to-publish' | 'published';
  project: { id: string; name: string } | null;
  jobs: Array<{ id: string; name: string; status: string; model: { id: string; version: string } | null; agentId: string | null }>;
  comparison: { id: string; reused?: boolean } | null;
  publication: { publicId: string; bundleSha256: string; manifestSha256: string; downloadUrl: string } | null;
  independentReviews: Array<{ id: string; reviewerName: string; status: string; semanticDecision: string; recordSha256: string; createdAt: string }>;
};

export default function GoldenCasePage() {
  const [status, setStatus] = useState<GoldenStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const autoFinalizeAttempt = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/v1/golden-case', { cache: 'no-store' });
    if (response.status === 401) { setNeedsLogin(true); return; }
    const body = await response.json() as GoldenStatus & { error?: string };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    setNeedsLogin(false); setStatus(body); setError(null);
  }, []);

  const advance = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/v1/golden-case', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await response.json() as GoldenStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setStatus(body); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    const timer = setInterval(() => void refresh().catch(() => undefined), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (status?.stage !== 'ready-to-publish' || !status.project || busy) return;
    if (autoFinalizeAttempt.current === status.project.id) return;
    autoFinalizeAttempt.current = status.project.id;
    void advance();
  }, [advance, busy, status]);

  const label = status?.stage === 'ready-to-publish' ? '正在自动生成比较与发布包' : status?.stage === 'published' ? '重新验证幂等状态' : '一次启动：运行、比较并发布';
  return <main style={{ maxWidth: 960, margin: '0 auto', lineHeight: 1.55 }}>
    <h1>WaveWorld R1 黄金研究案例</h1>
    <p>真实 Zenodo 数据、冻结预注册、双条件双模型、生产 Agent、证据链与可离线复核发布包。首次点击后会自动推进到发布，不需要第二次确认。</p>
    {needsLogin ? <p><a href="/api/v1/auth/oidc/start?returnTo=%2Fgolden-case">使用 W-ID 登录并继续</a></p> : null}
    {!needsLogin ? <button type="button" disabled={busy} onClick={() => void advance()}>{busy ? '处理中…' : label}</button> : null}
    <button type="button" style={{ marginLeft: 8 }} onClick={() => void refresh()}>刷新</button>
    {error ? <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{error}</pre> : null}
    {status ? <>
      <h2>阶段：<code>{status.stage}</code></h2>
      <dl>
        <dt>Case ID</dt><dd><code>{status.caseId}</code></dd>
        <dt>Project</dt><dd>{status.project ? <code>{status.project.id}</code> : '尚未创建'}</dd>
        <dt>Comparison</dt><dd>{status.comparison ? <code>{status.comparison.id}</code> : '尚未生成'}</dd>
      </dl>
      <h2>生产 Jobs</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th align="left">模型</th><th align="left">状态</th><th align="left">Job ID</th><th align="left">Agent</th></tr></thead>
        <tbody>{status.jobs.map((job) => <tr key={job.id} style={{ borderTop: '1px solid #ddd' }}><td>{job.model ? `${job.model.id}@${job.model.version}` : job.name}</td><td><code>{job.status}</code></td><td><code>{job.id}</code></td><td><code>{job.agentId ?? '等待领取'}</code></td></tr>)}</tbody></table>
      {status.publication ? <section><h2>发布包</h2><p>Publication：<code>{status.publication.publicId}</code></p><p>Bundle SHA-256：<code>{status.publication.bundleSha256}</code></p><p>Manifest SHA-256：<code>{status.publication.manifestSha256}</code></p><p><a href={status.publication.downloadUrl}>下载 `.wwpub.json`</a> · <a href={`/independent-review?publication=${encodeURIComponent(status.publication.publicId)}`}>交给非实现者独立复核</a></p></section> : null}
      {status.independentReviews?.length ? <section><h2>独立复核</h2>{status.independentReviews.map((review) => <article key={review.id}><p><code>{review.status}</code> · 科学结论 <code>{review.semanticDecision}</code> · {review.reviewerName} · {review.createdAt}</p><p>Review record SHA-256：<code>{review.recordSha256}</code></p></article>)}</section> : <p>尚无由不同 W-ID 用户提交的独立复核记录。</p>}
      {status.stage === 'failed' ? <p style={{ color: 'crimson' }}>至少一个计算任务执行失败；保留失败记录，不自动重写或隐藏。</p> : null}
    </> : null}
  </main>;
}
