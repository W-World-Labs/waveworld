'use client';

import { formatDiagnosticCode, getLabBuildId } from '@/lib/lab-diagnostics';

type Props = {
  title: string;
  message: string;
  /** Failure code for diagnostic string (e.g. webgpu_unavailable). */
  code?: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** data-* marker for tests / production evidence. */
  dataAttr?: string;
  tone?: 'red' | 'amber';
};

/**
 * Shared local recovery panel: title, message, copyable diagnostic, actions.
 * Stays inside Lab chrome — never the Next whole-page boundary.
 */
export function LocalErrorPanel({
  title,
  message,
  code = 'local_error',
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  dataAttr = 'local',
  tone = 'red',
}: Props) {
  const buildId = getLabBuildId();
  const diagnostic = formatDiagnosticCode(code, buildId);
  const titleClass = tone === 'amber' ? 'text-amber-200' : 'text-red-300';
  const borderClass =
    tone === 'amber'
      ? 'border-amber-800 bg-amber-950/40'
      : 'border-zinc-700 bg-zinc-900';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${diagnostic}\nbuild=${buildId}\n${message}`
      );
    } catch {
      // Clipboard may be denied; still show the code for manual copy.
    }
  };

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center ${borderClass}`}
      role="alert"
      data-sim-local-error={dataAttr}
      data-diagnostic={diagnostic}
    >
      <p className={`text-sm font-medium ${titleClass}`}>{title}</p>
      <p className="max-w-lg break-words text-xs text-zinc-500">{message}</p>
      <p className="font-mono text-[10px] text-zinc-600">
        诊断码 <span className="text-zinc-400">{diagnostic}</span>
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
          onClick={onPrimary}
        >
          {primaryLabel}
        </button>
        {secondaryLabel && onSecondary && (
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            onClick={onSecondary}
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800"
          onClick={() => void copy()}
          data-copy-diagnostic
        >
          复制诊断
        </button>
      </div>
    </div>
  );
}
