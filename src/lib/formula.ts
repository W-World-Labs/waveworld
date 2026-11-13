// 极小安全表达式求值器。支持 + - * / ^、一元负号、括号、数字、标识符、
// 单参数函数（sqrt/cbrt/exp/ln/log/log10/log2/sin/cos/tan/asin/acos/atan/sinh/cosh/tanh/abs/sign）
// 与常数 pi、e。expr 允许 "lhs = rhs"，求值取 rhs。不使用 eval/new Function。
//
// 变量优先于常数：若 vars 提供了 e（如电子电荷），用变量值；否则 e=Math.E、pi=Math.PI。

type Tok =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'func'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, exp: Math.exp,
  ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  abs: Math.abs, sign: Math.sign,
}

function tokenize(s: string): Tok[] {
  const out: Tok[] = []
  let i = 0
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
      out.push({ t: 'num', v: parseFloat(s.slice(i, j)) })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++
      const name = s.slice(i, j)
      // 函数：标识符后紧跟 '('（允许中间空格）
      let k = j
      while (k < s.length && (s[k] === ' ' || s[k] === '\t')) k++
      if (s[k] === '(' && name in FUNCS) out.push({ t: 'func', v: name })
      else out.push({ t: 'id', v: name })
      i = j
      continue
    }
    throw new Error(`非法字符: ${c}`)
  }
  return out
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }
const RIGHT = new Set(['^', 'u-'])

function toRPN(toks: Tok[]): Tok[] {
  const out: Tok[] = []
  const ops: Tok[] = []
  let prevValue = false
  for (const tk of toks) {
    if (tk.t === 'num' || tk.t === 'id') { out.push(tk); prevValue = true; continue }
    if (tk.t === 'func') { ops.push(tk); prevValue = false; continue }
    if (tk.t === 'lp') { ops.push(tk); prevValue = false; continue }
    if (tk.t === 'rp') {
      while (ops.length && ops[ops.length - 1].t !== 'lp') out.push(ops.pop()!)
      if (!ops.length) throw new Error('括号不匹配')
      ops.pop() // lp
      if (ops.length && ops[ops.length - 1].t === 'func') out.push(ops.pop()!)
      prevValue = true
      continue
    }
    // op
    let v = tk.v!
    if (v === '-' && !prevValue) v = 'u-'
    const prec = v === 'u-' ? 3 : PREC[v]
    while (ops.length) {
      const top = ops[ops.length - 1]
      if (top.t === 'func') { out.push(ops.pop()!); continue }
      if (top.t !== 'op') break
      const topV = top.v!
      const topPrec = topV === 'u-' ? 3 : PREC[topV]
      if (topPrec > prec || (topPrec === prec && !RIGHT.has(v))) out.push(ops.pop()!)
      else break
    }
    ops.push({ t: 'op', v })
    prevValue = false
  }
  while (ops.length) {
    const o = ops.pop()!
    if (o.t === 'lp') throw new Error('括号不匹配')
    out.push(o)
  }
  return out
}

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E }

function evalRPN(rpn: Tok[], vars: Record<string, number>): number {
  const st: number[] = []
  for (const tk of rpn) {
    if (tk.t === 'num') { st.push(tk.v); continue }
    if (tk.t === 'id') {
      // 变量优先；否则常数 pi/e
      const val = vars[tk.v]
      if (typeof val === 'number' && !Number.isNaN(val)) { st.push(val); continue }
      if (tk.v in CONSTS) { st.push(CONSTS[tk.v]); continue }
      throw new Error(`缺变量: ${tk.v}`)
    }
    if (tk.t === 'func') {
      const a = st.pop()
      if (a === undefined) throw new Error('函数缺参数')
      st.push(FUNCS[tk.v](a))
      continue
    }
    if (tk.t === 'op') {
      if (tk.v === 'u-') {
        const a = st.pop()
        if (a === undefined) throw new Error('栈下溢')
        st.push(-a)
        continue
      }
      const b = st.pop()
      const a = st.pop()
      if (a === undefined || b === undefined) throw new Error('栈下溢')
      switch (tk.v) {
        case '+': st.push(a + b); break
        case '-': st.push(a - b); break
        case '*': st.push(a * b); break
        case '/':
          if (b === 0) throw new Error('除零')
          st.push(a / b)
          break
        case '^': st.push(a ** b); break
        default: throw new Error(`未知算子: ${tk.v}`)
      }
    }
  }
  if (st.length !== 1) throw new Error('表达式无效')
  return st[0]
}

/** 求值 expr（允许 "lhs = rhs"，取 rhs）。 */
export function evalExpr(expr: string, vars: Record<string, number>): number {
  const rhs = expr.includes('=') ? expr.slice(expr.indexOf('=') + 1) : expr
  return evalRPN(toRPN(tokenize(rhs)), vars)
}
