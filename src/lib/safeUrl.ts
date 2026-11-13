/** Allow only http(s) URLs for data-driven hrefs. */
export function safeHttpUrl(href: string | undefined | null): string | null {
  if (!href || typeof href !== 'string') return null
  try {
    const u = new URL(href)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href
  } catch { /* ignore */ }
  return null
}
