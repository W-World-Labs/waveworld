import type { Spectrum } from '../data/spectrum'
import { pickLocaleString, useLocale } from '../lib/i18n'

export function SpectrumView({ spectrum }: { spectrum: Spectrum }) {
  const { locale } = useLocale()

  return (
    <div>
      <header className="mb-5">
        <h2 className="text-xl font-semibold text-white">{pickLocaleString(spectrum.title, spectrum.titleEn, locale)}</h2>
        <p className="mt-2 text-sm text-slate-400">{pickLocaleString(spectrum.subtitle, spectrum.subtitleEn, locale)}</p>
      </header>

      {/* 频谱条 */}
      <div className="mb-8 flex h-3 overflow-hidden rounded-full">
        {spectrum.bands.map((b) => (
          <div
            key={b.name}
            className="flex-1"
            style={{ background: b.color }}
            title={pickLocaleString(b.name, b.nameEn, locale)}
          />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {spectrum.bands.map((b) => {
          const name = pickLocaleString(b.name, b.nameEn, locale)
          const desc = pickLocaleString(b.desc, b.descEn, locale)
          const apps =
            locale === 'en' && b.appsEn?.length ? b.appsEn : b.apps
          return (
            <div key={b.name} className="card overflow-hidden p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: b.color }} />
                <h3 className="font-semibold text-white">{name}</h3>
              </div>
              <div className="mb-3 flex gap-4 font-mono text-xs text-slate-400">
                <span>λ {b.range}</span>
                <span>ƒ {b.freq}</span>
              </div>
              <p className="mb-3 text-sm text-slate-300">{desc}</p>
              <div className="flex flex-wrap gap-1.5">
                {apps.map((a) => (
                  <span key={a} className="rounded-full bg-edge/60 px-2 py-0.5 text-xs text-slate-300">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
