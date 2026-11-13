/**
 * Toolbar param label contract (#2 step 3.4 / #26):
 *   "名称=值" or "名称=值 单位"
 */
export function formatParamLabel(label: string, shown: string, unit?: string): string {
  const base = `${label}=${shown}`
  if (unit == null || unit === '') return base
  return `${base} ${unit}`
}
