'use client';

import { useEffect } from 'react';

/** Leave the Lab base path; the product has a single task center. */
export default function JobsPage() {
  useEffect(() => {
    const job = new URLSearchParams(window.location.search).get('job');
    window.location.replace('/batch-jobs' + (job ? `?job=${encodeURIComponent(job)}` : ''));
  }, []);
  return <p className="p-6 text-sm text-zinc-400">正在打开<a className="ml-1 text-cyan-300 underline" href="/batch-jobs" target="_top">计算任务</a>…</p>;
}
