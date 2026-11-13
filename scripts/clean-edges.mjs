// 用与 src/lib/formula.ts 完全同语义的纯 JS 求值器，校验+清洗工作流产出的边数据。
// - from/to 合法性、id 去重
// - 每条 formula：JS 求值（溢出→Infinity，与 TS 运行时一致）；finite 则 snap expected=eval（运行时
//   测试用同一求值器，故必须一致）；非 finite/解析失败则剥离 sample/expected（仅保留 expr 展示）并标记 unverified
// - QA 信号：agent 给的 expected 与求值结果偏差 >DISC_TOL 时**判为不一致并以非零码退出**（不再静默 snap 掩盖）——
//   这是发现「公式/算例写错」的唯一信号；作者须核对物理与算术后再回归。传 --allow-disc 可在确认无误时放行。
// 用法：node scripts/clean-edges.mjs <workflow-output.json> <out edges.data.json> [extraValid.json] [--allow-disc]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, exp: Math.exp, ln: Math.log, log: Math.log,
  log10: Math.log10, log2: Math.log2, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh,
  tanh: Math.tanh, abs: Math.abs, sign: Math.sign,
}
const CONSTS = { pi: Math.PI, e: Math.E }
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }
const RIGHT = new Set(['^', 'u-'])

function tokenize(s) {
  const out = []; let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t') { i++; continue }
    if (c === '(') { out.push({ t: 'lp' }); i++; continue }
    if (c === ')') { out.push({ t: 'rp' }); i++; continue }
    if ('+-*/^'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue }
    if (/[0-9.]/.test(c)) {
      let j = i + 1
      while (j < s.length && /[0-9.eE]/.test(s[j])) {
        if ((s[j] === 'e' || s[j] === 'E') && (s[j + 1] === '+' || s[j + 1] === '-')) j++
        j++
      }
      out.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++
      const name = s.slice(i, j); let k = j
      while (k < s.length && (s[k] === ' ' || s[k] === '\t')) k++
      if (s[k] === '(' && name in FUNCS) out.push({ t: 'func', v: name })
      else out.push({ t: 'id', v: name })
      i = j; continue
    }
    throw new Error(`bad char ${c}`)
  }
  return out
}
function toRPN(toks) {
  const out = [], ops = []; let prev = false
  for (const tk of toks) {
    if (tk.t === 'num' || tk.t === 'id') { out.push(tk); prev = true; continue }
    if (tk.t === 'func') { ops.push(tk); prev = false; continue }
    if (tk.t === 'lp') { ops.push(tk); prev = false; continue }
    if (tk.t === 'rp') {
      while (ops.length && ops[ops.length - 1].t !== 'lp') out.push(ops.pop())
      if (!ops.length) throw new Error('paren')
      ops.pop()
      if (ops.length && ops[ops.length - 1].t === 'func') out.push(ops.pop())
      prev = true; continue
    }
    let v = tk.v
    if (v === '-' && !prev) v = 'u-'
    const prec = v === 'u-' ? 4 : PREC[v]
    while (ops.length) {
      const top = ops[ops.length - 1]
      if (top.t === 'func') { out.push(ops.pop()); continue }
      if (top.t !== 'op') break
      const tp = top.v === 'u-' ? 4 : PREC[top.v]
      if (tp > prec || (tp === prec && !RIGHT.has(v))) out.push(ops.pop())
      else break
    }
    ops.push({ t: 'op', v }); prev = false
  }
  while (ops.length) { const o = ops.pop(); if (o.t === 'lp') throw new Error('paren'); out.push(o) }
  return out
}
function evalRPN(rpn, vars) {
  const st = []
  for (const tk of rpn) {
    if (tk.t === 'num') { st.push(tk.v); continue }
    if (tk.t === 'id') {
      const val = vars[tk.v]
      if (typeof val === 'number' && !Number.isNaN(val)) { st.push(val); continue }
      if (tk.v in CONSTS) { st.push(CONSTS[tk.v]); continue }
      throw new Error(`missing ${tk.v}`)
    }
    if (tk.t === 'func') { st.push(FUNCS[tk.v](st.pop())); continue }
    if (tk.t === 'op') {
      if (tk.v === 'u-') { st.push(-st.pop()); continue }
      const b = st.pop(), a = st.pop()
      st.push(tk.v === '+' ? a + b : tk.v === '-' ? a - b : tk.v === '*' ? a * b : tk.v === '/' ? a / b : a ** b)
    }
  }
  if (st.length !== 1) throw new Error('invalid')
  return st[0]
}
function evalExpr(expr, vars) {
  const rhs = expr.includes('=') ? expr.slice(expr.indexOf('=') + 1) : expr
  return evalRPN(toRPN(tokenize(rhs)), vars)
}

const VALID = new Set(['electromagnetic','electric','mechanical','thermal','chemical','nuclear','acoustic','radiant','gravitational','mass','em-radio','em-micro','em-ir','em-visible','em-uv','em-xray','em-gamma','el-static','el-current','el-field'])

// Merge live ontology node ids so VALID tracks nodes.ts / nodes.subforms.json.
// Only node `id`s (not edge endpoints) — keeps filtering strict to known nodes.
const ontologyDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/data/ontology')
function addJsonNodeIds(file) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(ontologyDir, file), 'utf8'))
    for (const item of (Array.isArray(data) ? data : [])) {
      if (item && typeof item.id === 'string') VALID.add(item.id)
    }
  } catch { /* optional live data */ }
}
function addTsNodeIds(file) {
  try {
    const src = fs.readFileSync(path.join(ontologyDir, file), 'utf8')
    for (const m of src.matchAll(/\bid:\s*'([^']+)'/g)) VALID.add(m[1])
  } catch { /* optional */ }
}
addJsonNodeIds('nodes.subforms.json')
addTsNodeIds('nodes.ts')

const argv = process.argv.slice(2).filter((a) => a !== '--allow-disc')
const allowDisc = process.argv.includes('--allow-disc')
const [inPath, outPath, extraValidPath] = argv
const DISC_TOL = 1e-3 // agent expected 与求值结果的容许相对偏差（>此值视为写错）
if (extraValidPath) for (const id of JSON.parse(fs.readFileSync(extraValidPath, 'utf8'))) VALID.add(id)
const d = JSON.parse(fs.readFileSync(inPath, 'utf8'))
const edges = (d.result?.edges) || d.edges || d
let comp = 0, unverified = 0, disc = 0
const uncomp = [], discs = []
function proc(fm, owner) {
  if (!fm) return
  const { expr, sample, expected } = fm
  if (!expr || sample == null || expected == null) { unverified++; uncomp.push([owner, 'no-sample', expr]); delete fm.sample; delete fm.expected; return }
  let got
  try { got = evalExpr(expr, sample) } catch (e) { unverified++; uncomp.push([owner, String(e.message), expr]); delete fm.sample; delete fm.expected; return }
  if (!Number.isFinite(got)) { unverified++; uncomp.push([owner, 'non-finite', expr]); delete fm.sample; delete fm.expected; return }
  comp++
  const rel = Math.abs(got - expected) / Math.max(Math.abs(expected), 1e-30)
  if (rel > DISC_TOL) { disc++; discs.push([owner, expr, expected, got, rel]) }
  fm.expected = got; fm.tol = 1e-6
}
const clean = [], seen = new Set(), bad = []
for (const e of edges) {
  if (!VALID.has(e.from) || !VALID.has(e.to)) { bad.push([e.id, e.from, e.to]); continue }
  while (seen.has(e.id)) e.id += '-2'
  seen.add(e.id)
  proc(e.formula, e.id)
  for (const l of (e.lossMechanisms || [])) proc(l.formula, e.id + '/' + (l.name || 'loss'))
  clean.push(e)
}
fs.writeFileSync(outPath, JSON.stringify(clean, null, 1))
console.log(`clean edges: ${clean.length}  dropped-illegal: ${bad.length}`)
console.log(`formulas computable+snapped: ${comp}  unverified(stripped): ${unverified}  discrepancy>2%: ${disc}`)
if (uncomp.length) { console.log('-- unverified --'); for (const u of uncomp) console.log('  ', u[0], '|', u[1], '|', u[2]) }
if (discs.length) { console.log('-- discrepancies (agent expected ≠ eval) --'); for (const u of discs) console.log('  ', u[0], '|', u[1], '| agentExp=', u[2], 'eval=', u[3], `(${(u[4]*100).toFixed(2)}%)`) }
if (bad.length) { console.log('-- illegal endpoints --'); for (const b of bad) console.log('  ', b.join(' ')) }
if (disc > 0 && !allowDisc) {
  console.error(`\n✗ ${disc} 条公式的 agent expected 与求值结果偏差 >${DISC_TOL}：请核对公式/算例物理与算术后再回归（确认无误可加 --allow-disc 放行）。`)
  process.exitCode = 1
}
