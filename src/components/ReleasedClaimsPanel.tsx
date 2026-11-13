import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_BROWSER_RELEASES_BASE,
  fetchLatestReleased,
} from '../lib/knowledge/atlas/browserCatalog'
import {
  claimsForSubject,
  indexClaimsBySubject,
  statementPreview,
  type ClaimsBySubjectIndex,
  type SubjectClaimView,
} from '../lib/knowledge/atlas/claimsBySubject'
import { safeHttpUrl } from '../lib/safeUrl'

/**
 * #48-J Matrix deep view: released claims + evidence for one subject (edge id).
 * Silent when no catalog / no claims for subject.
 */
export function ReleasedClaimsPanel({
  subjectId,
  baseUrl = DEFAULT_BROWSER_RELEASES_BASE,
  zh = true,
}: {
  subjectId: string
  baseUrl?: string
  zh?: boolean
}) {
  const [index, setIndex] = useState<ClaimsBySubjectIndex | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    fetchLatestReleased(baseUrl)
      .then((release) => {
        if (cancelled) return
        if (!release) {
          setIndex(null)
          return
        }
        setIndex(indexClaimsBySubject(release))
      })
      .catch(() => {
        if (!cancelled) {
          setIndex(null)
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl])

  const views = useMemo(
    () => (index ? claimsForSubject(index, subjectId) : []),
    [index, subjectId],
  )

  if (!index || views.length === 0) {
    if (failed && import.meta.env?.DEV) {
      return (
        <p className="mt-2 text-[10px] text-slate-600">
          {zh ? '知识声明：未挂载' : 'Released claims: none'}
        </p>
      )
    }
    return null
  }

  return (
    <div
      className="mt-3 rounded border border-wave/20 bg-wave/5 px-3 py-2"
      data-released-claims-subject={subjectId}
      data-knowledge-release-id={index.releaseId}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
        <span className="font-semibold uppercase tracking-wide text-wave/80">
          {zh ? '已发布声明' : 'Released claims'}
        </span>
        <span className="font-mono text-slate-600">{index.releaseId}</span>
        <span>
          {views.length} {zh ? '条' : ''}
        </span>
      </div>
      <ul className="space-y-2">
        {views.map((v) => (
          <ClaimRow key={v.claim.id} view={v} zh={zh} />
        ))}
      </ul>
    </div>
  )
}

function ClaimRow({ view, zh }: { view: SubjectClaimView; zh: boolean }) {
  const { claim, bindings, conflictSets } = view
  return (
    <li className="border-t border-edge/40 pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded bg-edge/50 px-1.5 py-0.5 font-mono text-slate-300">
          {claim.kind}
        </span>
        {claim.confidence != null && (
          <span className="text-slate-500">
            conf {claim.confidence.toFixed(2)}
          </span>
        )}
        {conflictSets.length > 0 && (
          <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-amber-200/90">
            {zh ? `争议×${conflictSets.length}` : `conflict×${conflictSets.length}`}
          </span>
        )}
      </div>
      <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-slate-400 break-all">
        {statementPreview(claim.statement, 200)}
      </p>
      {bindings.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {bindings.map(({ binding, snapshot }) => {
            const loc = snapshot?.locator
            const href = loc ? safeHttpUrl(loc) : null
            const quote = binding.locator?.quote
            return (
              <div key={binding.id} className="text-[10px] text-slate-500">
                <span className="text-slate-600">{binding.support}</span>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 text-wave/70 underline break-all"
                  >
                    {snapshot?.title || loc}
                  </a>
                ) : loc ? (
                  <span className="ml-1 break-all">{loc}</span>
                ) : null}
                {quote && (
                  <span className="ml-1 italic text-slate-600">
                    “{quote.slice(0, 80)}
                    {quote.length > 80 ? '…' : ''}”
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </li>
  )
}
