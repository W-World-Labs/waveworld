import { redirect } from 'next/navigation';

/** The Atlas task center owns task browsing for every solver. */
export default async function JobsPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  redirect('/batch-jobs' + (typeof job === 'string' ? `?job=${encodeURIComponent(job)}` : ''));
}
