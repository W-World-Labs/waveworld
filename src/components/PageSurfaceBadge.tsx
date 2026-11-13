/**
 * Compact surface badge for page headers / toolbars.
 */
import { pickLocaleString, useLocale } from '../lib/i18n'
import {
  resolvePageSurface,
  SURFACE_META,
  type PageSurface,
} from '../lib/uiPageLayer'
import { useLocation } from 'react-router-dom'

export function PageSurfaceBadge({
  surface: forced,
  className = '',
}: {
  surface?: PageSurface
  className?: string
}) {
  const { locale } = useLocale()
  const { pathname } = useLocation()
  const surface = forced ?? resolvePageSurface(pathname)
  if (surface === 'home') return null
  const m = SURFACE_META[surface]
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        m.chip,
        className,
      ].join(' ')}
      data-page-surface={surface}
    >
      {pickLocaleString(m.labelZh, m.labelEn, locale)}
    </span>
  )
}
