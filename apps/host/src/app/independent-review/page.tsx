'use client';

import { useEffect, useState } from 'react';

export default function IndependentReviewPage() {
  const [publicId, setPublicId] = useState('');
  const [payload, setPayload] = useState('');
  const [message, setMessage] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPublicId(new URLSearchParams(window.location.search).get('publication') ?? '');
    fetch('/api/v1/me', { cache: 'no-store' }).then((response) => setNeedsLogin(response.status === 401)).catch(() => undefined);
  }, []);

  async function submit() {
    setBusy(true); setMessage('');
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const response = await fetch(`/api/v1/publications/${encodeURIComponent(publicId)}/reviews`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, payload: parsed }),
      });
      const body = await response.json() as { error?: string; review?: { id: string; recordSha256: string; semanticDecision: string } };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setMessage(`已写入不可变复核记录 ${body.review?.id}\nRecord SHA-256: ${body.review?.recordSha256}\n服务器复算科学结论: ${body.review?.semanticDecision}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const returnTo = `/independent-review?publication=${encodeURIComponent(publicId)}`;
  return <main style={{ maxWidth: 920, margin: '0 auto', lineHeight: 1.55 }}>
    <h1>黄金案例独立复核提交</h1>
    <p>先按仓库中的 <code>research/golden-case/INDEPENDENT_REVIEW.md</code> 在隔离目录完成正向验证和重签名篡改实验，再粘贴完整 v1 复核 JSON。服务器会重新验证原始发布包、重新执行语义校验和自己的篡改实验。发布者不能复核自己的包，且仅接受 W-ID 会话。</p>
    {needsLogin ? <p><a href={`/api/v1/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`}>使用自己的 W-ID 登录</a></p> : null}
    <label>Publication ID<br /><input style={{ width: '100%' }} value={publicId} onChange={(event) => setPublicId(event.target.value)} /></label>
    {publicId ? <p><a href={`/api/v1/publications/${encodeURIComponent(publicId)}/download`}>下载待复核发布包</a></p> : null}
    <label>完整复核 JSON<br /><textarea style={{ width: '100%', minHeight: 420, fontFamily: 'monospace' }} value={payload} onChange={(event) => setPayload(event.target.value)} /></label>
    <p><button type="button" disabled={busy || !publicId || !payload || needsLogin} onClick={() => void submit()}>{busy ? '服务器正在复核…' : '提交并固化复核记录'}</button></p>
    {message ? <pre style={{ whiteSpace: 'pre-wrap' }}>{message}</pre> : null}
  </main>;
}
