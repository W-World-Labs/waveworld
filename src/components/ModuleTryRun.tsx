import { useEffect, useState } from 'react'
import { runnerFor } from '../data/methods/moduleRegistry'
import { methodById } from '../data/methods/methods'
import { localizedName, useLocale } from '../lib/i18n'

const MAX_PREVIEW = 400
const FLOAT_DIGITS = 6

function formatNumber(n: number): number | string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return n
  // Round display floats; keep as number so JSON stays compact
  return Number(n.toFixed(FLOAT_DIGITS))
}

function formatRunResult(out: unknown): string {
  try {
    const s = JSON.stringify(out, (_k, v) => (typeof v === 'number' ? formatNumber(v) : v))
    if (s == null) return String(out)
    return s.length > MAX_PREVIEW ? `${s.slice(0, MAX_PREVIEW)}…` : s
  } catch {
    return String(out).slice(0, MAX_PREVIEW)
  }
}

/** 方法目录「试跑模块」：有绑定则渲染，无绑定则不显示。 */
export function ModuleTryRun({ methodId }: { methodId: string }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const binding = runnerFor(methodId)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    setPreview(null)
    setError(null)
    setRunning(false)
  }, [methodId])

  if (!binding) return null

  const methodMeta = methodById(methodId)
  const familyMeta = methodById(binding.family)
  const methodLabel = methodMeta ? localizedName(methodMeta, locale) : binding.label
  const familyLabel = familyMeta ? localizedName(familyMeta, locale) : binding.family

  const onTry = () => {
    setRunning(true)
    setError(null)
    setPreview(null)
    try {
      const out = binding.run()
      setPreview(formatRunResult(out))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mt-3 border-t border-edge pt-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onTry}
          disabled={running}
          className="btn border border-wave/40 text-[11px] text-wave hover:bg-wave/10 disabled:cursor-not-allowed disabled:opacity-50"
          title={methodLabel}
        >
          {running ? (zh ? '运行中…' : 'Running…') : zh ? '试跑模块' : 'Try module'}
        </button>
        <span className="rounded bg-panel/80 px-1.5 py-0.5 text-[10px] text-slate-500">
          {familyLabel}
        </span>
        <span className="text-[10px] text-slate-600">{methodLabel}</span>
      </div>
      {error != null && (
        <pre className="max-h-28 overflow-auto rounded border border-red-500/40 bg-red-950/30 p-2 font-mono text-xs text-red-300 whitespace-pre-wrap">
          {error}
        </pre>
      )}
      {preview != null && error == null && (
        <pre className="max-h-28 overflow-auto rounded border border-edge bg-panel/60 p-2 font-mono text-xs text-slate-300 whitespace-pre-wrap">
          {preview}
        </pre>
      )}
    </div>
  )
}
