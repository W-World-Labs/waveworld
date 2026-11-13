import { useEffect, useState } from 'react'
import {
  DEFAULT_BROWSER_RELEASES_BASE,
  fetchLatestReleasedMeta,
} from '../lib/knowledge/atlas/browserCatalog'
import type { ReleaseMeta } from '../lib/knowledge/atlas/releaseMeta'

/**
 * Silent when no static release catalog is deployed.
 * Shows latest verified KnowledgeRelease meta for Atlas paths.
 */
export function KnowledgeReleaseBadge({
  baseUrl = DEFAULT_BROWSER_RELEASES_BASE,
  zh = true,
}: {
  baseUrl?: string
  zh?: boolean
}) {
  const [meta, setMeta] = useState<ReleaseMeta | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchLatestReleasedMeta(baseUrl)
      .then((m) => {
        if (!cancelled) {
          setMeta(m)
          setErr(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setMeta(null)
          // 404/empty is silent; network shape errors stay quiet in UI
          setErr(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl])

  if (!meta) {
    if (err && import.meta.env?.DEV) {
      return (
        <p className="text-[10px] text-slate-600" title={err}>
          {zh ? '知识发布：未挂载' : 'Knowledge release: none'}
        </p>
      )
    }
    return null
  }

  const short = meta.sha256.slice(0, 12)

  return (
    <div
      className="rounded border border-edge/80 bg-edge/20 px-2.5 py-1.5 text-[11px] text-slate-400"
      data-knowledge-release-id={meta.id}
      data-knowledge-release-sha={meta.sha256}
    >
      <span className="text-slate-300">
        {zh ? '知识发布' : 'Knowledge release'}
      </span>
      <span className="mx-1.5 text-slate-600">·</span>
      <span className="font-mono text-wave/90">{meta.id}</span>
      <span className="mx-1.5 text-slate-600">·</span>
      <span className="font-mono text-slate-500" title={meta.sha256}>
        {short}…
      </span>
      <span className="mx-1.5 text-slate-600">·</span>
      <span>
        {meta.claimCount} {zh ? '条事实' : 'claims'}
      </span>
    </div>
  )
}
