import { useLocale } from '../lib/i18n'

/** 统一暂停/继续按钮（与 useRunning 配对）。 */
export function PlayPauseButton({
  running,
  onToggle,
}: {
  running: boolean
  onToggle: () => void
}) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  return (
    <button
      type="button"
      onClick={onToggle}
      className="btn border border-edge text-slate-300"
      aria-label={running ? (zh ? '暂停' : 'Pause') : zh ? '继续' : 'Resume'}
    >
      {running ? (zh ? '⏸ 暂停' : '⏸ Pause') : zh ? '▶ 继续' : '▶ Resume'}
    </button>
  )
}
