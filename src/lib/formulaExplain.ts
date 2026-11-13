/**
 * 公式解释层（KUX 靶 C）：把 Formula 的机器字段变成给人看的视图。
 * 不改 evalExpr 语义；不批量改 edges JSON。
 * plainZh 可选；缺省时从 expr + vars 推导。
 */
import type { Formula } from '../data/ontology/types'
import { FORMULA_VAR_MEANING_EN } from '../data/ontology/formula.varMeaningEn'
import type { Locale } from './i18n/types'

export interface FormulaVarRow {
  symbol: string
  /** vars 原文：通常已是「中文含义 + 单位」 */
  meaning: string
  sample?: number
}

/** Locale-aware formula variable meaning (Chinese source → EN overlay). */
export function formulaVarMeaning(meaning: string, locale: Locale = 'zh'): string {
  if (locale !== 'en') return meaning
  const curated = FORMULA_VAR_MEANING_EN[meaning]?.trim()
  if (curated) return curated
  // Fallback labels used when symbol only appears in sample
  if (meaning === '（算例输入）' || meaning === '算例输入') return 'sample input'
  return meaning
}

export interface FormulaExplainView {
  /** 一句人话：这个式子在算什么 */
  plainZh: string
  /** English plain line when curated; falls back to plainZh */
  plainEn?: string
  /** 机器/校验用表达式（可次要展示） */
  expr: string
  /** 左侧符号（若 expr 为 assignment） */
  lhs?: string
  vars: FormulaVarRow[]
  /** 工作算例结果 */
  expected?: number
  hasSample: boolean
}

/** 可选扩展：数据里可逐步补 plainZh/plainEn，旧数据不炸。 */
export type FormulaWithPlain = Formula & { plainZh?: string; plainEn?: string }

const ASSIGN_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/

export function parseAssignment(expr: string): { lhs: string; rhs: string } | null {
  const m = ASSIGN_RE.exec(expr)
  if (!m) return null
  return { lhs: m[1], rhs: m[2].trim() }
}

/** 把 sample 数值收成可读短串（不改物理值）。 */
export function formatSampleNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) {
    const [mant, exp] = n.toExponential(4).split('e')
    // 与定点分支一致：尾零修剪（1.0000×10^6 → 1×10^6；2.5000e-4 → 2.5×10^-4）
    return `${mant.replace(/\.?0+$/, '')}×10^${exp.replace(/^\+/, '')}`
  }
  // trim trailing zeros from toFixed
  const s = abs >= 100 ? n.toFixed(2) : abs >= 1 ? n.toFixed(4) : n.toFixed(6)
  return s.replace(/\.?0+$/, '') || '0'
}

/**
 * 从已有 vars / expr 推导人话一句。
 * 优先显式 plainZh；否则「求 X（含义）」或通用兜底。
 */
export function derivePlainZh(f: FormulaWithPlain): string {
  if (f.plainZh && f.plainZh.trim()) return f.plainZh.trim()

  const asg = parseAssignment(f.expr)
  if (asg) {
    const meaning = f.vars?.[asg.lhs]
    if (meaning && meaning.trim()) {
      return `计算 ${asg.lhs}（${meaning.trim()}）`
    }
    // 常见效率符号
    if (/^eta$/i.test(asg.lhs) || asg.lhs === 'η') {
      return '计算效率 η（输出有用功率 / 输入功率，或题设中的效率定义）'
    }
    if (/^Phi$/i.test(asg.lhs) || asg.lhs === 'Φ') {
      return `计算 ${asg.lhs}（量子产率或题设产率）`
    }
    if (/^COP$/i.test(asg.lhs)) {
      return '计算性能系数 COP（搬运/能效型，可大于 1）'
    }
    return `按右侧表达式计算 ${asg.lhs}`
  }

  return '下面给出该转换过程的关键量关系（代入算例可自检）'
}

/** English plain line: curated plainEn, else short structural fallback (no CJK). */
export function derivePlainEn(f: FormulaWithPlain): string {
  if (f.plainEn && f.plainEn.trim()) return f.plainEn.trim()
  const asg = parseAssignment(f.expr)
  if (asg) {
    if (/^eta$/i.test(asg.lhs) || asg.lhs === 'η') {
      return 'Computes efficiency η (useful output / input, or the problem’s definition).'
    }
    if (/^COP$/i.test(asg.lhs)) {
      return 'Computes COP (transport / heat-pump figure of merit; may exceed 1).'
    }
    return `Evaluates ${asg.lhs} from the right-hand side expression.`
  }
  return 'Key quantitative relation for this conversion (substitute sample values to self-check).'
}

export function explainFormula(
  f: FormulaWithPlain,
  locale: Locale = 'zh',
): FormulaExplainView {
  const asg = parseAssignment(f.expr)
  const sample = f.sample ?? {}
  const varKeys = new Set([
    ...Object.keys(f.vars ?? {}),
    ...Object.keys(sample),
  ])
  // 左侧若只是结果符号且不在 vars，仍可出现在表头说明里，不强制入表
  const vars: FormulaVarRow[] = [...varKeys]
    .filter((k) => k in (f.vars ?? {}) || k in sample)
    .sort((a, b) => a.localeCompare(b))
    .map((symbol) => {
      const raw = (f.vars ?? {})[symbol] ?? '（算例输入）'
      return {
        symbol,
        meaning: formulaVarMeaning(raw, locale),
        sample: sample[symbol],
      }
    })

  return {
    plainZh: derivePlainZh(f),
    plainEn: derivePlainEn(f),
    expr: f.expr,
    lhs: asg?.lhs,
    vars,
    expected: f.expected,
    hasSample: f.sample != null && Object.keys(f.sample).length > 0 && f.expected != null,
  }
}
