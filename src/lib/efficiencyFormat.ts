/**
 * 效率展示层（KUX 靶 B）。
 * - 本体边：Quantity 数值（0–1 的 η，或 >1 的 COP）→ 统一 format
 * - conversions/transducers：历史字符串 "5-15%" → parse 后再 format（legacy display-only，不写回 JSON）
 * 数据层仍可为 string；禁止页面手写 ad-hoc parse 分叉。
 */

export type EfficiencyKindDisplay = 'eta' | 'cop' | 'unknown'

export interface ParsedEfficiency {
  /** 0–1 分数，或 COP 原值（>1） */
  min?: number
  max?: number
  kind: EfficiencyKindDisplay
  /** 是否成功解析出数字 */
  ok: boolean
  /** 原始串（legacy） */
  raw?: string
}

/** 0–1 或百分数 → 人话百分比串 */
export function formatPercent(x: number, digits?: number): string {
  if (!Number.isFinite(x)) return '—'
  // 已是 0–1
  const pct = x > 1 && x <= 100 ? x : x * 100
  const d = digits ?? (pct < 10 ? 1 : 0)
  const s = pct.toFixed(d).replace(/\.0$/, '')
  return `${s}%`
}

/** COP 显示：2.5× 或 2–4× */
export function formatCop(min?: number, max?: number): string {
  if (min == null && max == null) return '—'
  if (min != null && max != null && min !== max) {
    return `${trimNum(min)}–${trimNum(max)}×`
  }
  const v = max ?? min!
  return `${trimNum(v)}×`
}

function trimNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const s = n < 10 ? n.toFixed(2) : n.toFixed(1)
  return s.replace(/\.?0+$/, '')
}

/**
 * 本体边效率 → 展示串。
 * transport：COP；否则 η 百分比区间。
 */
export function formatQuantityEfficiency(
  min?: number,
  max?: number,
  opts?: { transport?: boolean },
): string {
  if (opts?.transport) return formatCop(min, max)
  if (min == null && max == null) return '—'
  if (min != null && max != null) {
    if (min === max) return formatPercent(min)
    return `${formatPercent(min)} – ${formatPercent(max)}`
  }
  return formatPercent((max ?? min)!)
}

/**
 * 解析 legacy 字符串（conversions / transducers）。
 * 支持：5-15%、5–15%、>95%、≥ 90%、约 40%、0.2-0.4、COP 3-5 等。
 */
export function parseEfficiencyText(raw: string): ParsedEfficiency {
  const s = (raw ?? '').trim()
  if (!s) return { kind: 'unknown', ok: false, raw: s }

  // COP 字样或无 % 且值明显 >1
  const looksCop = /\bcop\b/i.test(s) || /性能系数/.test(s)

  // > 95% / ≥90%
  const gt = s.match(/^[>≥]\s*([\d.]+)\s*%?$/)
  if (gt) {
    let v = Number(gt[1])
    if (v > 1) v = v / 100
    return { min: v, max: undefined, kind: looksCop ? 'cop' : 'eta', ok: true, raw: s }
  }

  // 5-15% / 5–15 % / 15-47%
  const rangePct = s.match(/^([\d.]+)\s*[-–—~]\s*([\d.]+)\s*%$/)
  if (rangePct) {
    let a = Number(rangePct[1])
    let b = Number(rangePct[2])
    if (a > 1 || b > 1) {
      a /= 100
      b /= 100
    }
    return { min: Math.min(a, b), max: Math.max(a, b), kind: 'eta', ok: true, raw: s }
  }

  // 单值 20%
  const onePct = s.match(/^([\d.]+)\s*%$/)
  if (onePct) {
    let v = Number(onePct[1])
    if (v > 1) v /= 100
    return { min: v, max: v, kind: 'eta', ok: true, raw: s }
  }

  // 无百分号区间 3-5（视为 COP 或原始比）
  const rangeBare = s.match(/^([\d.]+)\s*[-–—~]\s*([\d.]+)$/)
  if (rangeBare) {
    const a = Number(rangeBare[1])
    const b = Number(rangeBare[2])
    const kind: EfficiencyKindDisplay =
      looksCop || a > 1 || b > 1 ? 'cop' : 'eta'
    const min = kind === 'eta' && a <= 1 ? a : a
    const max = kind === 'eta' && b <= 1 ? b : b
    // 若两者都 ≤1 且无 %，按分数 η
    if (kind === 'eta' && a <= 1 && b <= 1) {
      return { min: a, max: b, kind: 'eta', ok: true, raw: s }
    }
    if (a > 1 || b > 1) {
      return { min: Math.min(a, b), max: Math.max(a, b), kind: 'cop', ok: true, raw: s }
    }
    return { min, max, kind, ok: true, raw: s }
  }

  return { kind: 'unknown', ok: false, raw: s }
}

/** legacy 字符串 → 统一展示（解析失败则原样返回，不丢信息） */
export function formatEfficiencyText(raw: string): string {
  const p = parseEfficiencyText(raw)
  if (!p.ok) return raw || '—'
  if (p.kind === 'cop') return formatCop(p.min, p.max)
  return formatQuantityEfficiency(p.min, p.max)
}

/** 进度条宽度 0–100：η 用 max*100；COP 用 max/10 封顶视觉 */
export function efficiencyBarWidthPct(
  max: number | undefined,
  opts?: { transport?: boolean },
): number {
  if (max == null || !Number.isFinite(max)) return 0
  if (opts?.transport) {
    // COP 典型 1–6，按 /6 映射
    return Math.min(100, Math.max(0, (max / 6) * 100))
  }
  // η：若误传百分数 >1 且 ≤100，先归一
  const frac = max > 1 && max <= 100 ? max / 100 : max
  return Math.min(100, Math.max(0, frac * 100))
}
