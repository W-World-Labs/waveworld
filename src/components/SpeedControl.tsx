import { useLocale } from '../lib/i18n'

/** 播放速度滑块（慢放↔快进）。不改物理 dt，只调每帧推进的仿真步数。 */
export function SpeedControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  return (
    <label className="flex items-center gap-2 text-slate-400">
      <span className="whitespace-nowrap">
        {zh ? '播放' : 'Play'} ×{value.toFixed(value < 1 ? 2 : 1)}
        {value < 1 && (
          <span className="ml-1 text-glow">{zh ? '慢放' : 'slow'}</span>
        )}
      </span>
      <input
        type="range"
        min={0.1}
        max={4}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={zh ? '播放速度' : 'Playback speed'}
      />
    </label>
  )
}
