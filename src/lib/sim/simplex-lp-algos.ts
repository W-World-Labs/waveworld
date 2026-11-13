/**
 * Simplex method for LP · standard-form teaching stub (2-var max).
 * Maximize c·x s.t. A x ≤ b, x ≥ 0 via slack-augmented tableau pivots
 * until optimal or max pivot budget.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · linear programming. */
export const METHOD_LP = 'method-linear-programming'

/** Algo · simplex tableau pivot. */
export const METHOD_ALGO_SIMPLEX = 'method-algo-simplex'

/** Parent alias (aligns with familyId). */
export const LP_PARENT = METHOD_LP

export const LP_METHOD_IDS = [METHOD_ALGO_SIMPLEX] as const

/** LP in inequality form: max c·x s.t. A x ≤ b, x ≥ 0. */
export type LpStandard = {
  /** objective coefficients, length n */
  c: number[]
  /** constraint matrix m rows of length n */
  A: number[][]
  /** RHS, length m; require b_i ≥ 0 so origin is feasible (no Phase I) */
  b: number[]
}

export type SimplexStatus = 'optimal' | 'unbounded' | 'maxiter' | 'infeasible'

export type SimplexResult = {
  status: SimplexStatus
  /** optimal objective (or last) */
  objective: number
  /** primal x (original vars, length n) */
  x: number[]
  /** slack values (length m) */
  slack: number[]
  pivots: number
  /** final tableau (m+1) × (n+m+1); last col RHS; last row −c-reduced */
  tableau: number[][]
}

/**
 * Default 2-var teaching LP (origin feasible):
 *   max  3 x1 + 5 x2
 *   s.t.     x1        ≤ 4
 *                 2 x2 ≤ 12
 *            3 x1 + 2 x2 ≤ 18
 *            x1, x2 ≥ 0
 * Optimum at (2, 6), z* = 36.
 */
export function makeDefaultLp2(): LpStandard {
  return {
    c: [3, 5],
    A: [
      [1, 0],
      [0, 2],
      [3, 2],
    ],
    b: [4, 12, 18],
  }
}

/** Validate LP dims; b ≥ 0 for teaching Phase-I free start. */
export function assertLpStandard(lp: LpStandard): { n: number; m: number } {
  const n = lp.c.length
  const m = lp.b.length
  if (!(n > 0) || !(m > 0)) {
    throw new Error('assertLpStandard: need n≥1, m≥1')
  }
  if (lp.A.length !== m) {
    throw new Error('assertLpStandard: A rows must equal b length')
  }
  for (let i = 0; i < m; i++) {
    if (lp.A[i]!.length !== n) {
      throw new Error(`assertLpStandard: A[${i}] length must be n=${n}`)
    }
    if (!Number.isFinite(lp.b[i]!)) {
      throw new Error(`assertLpStandard: b[${i}] must be finite`)
    }
    if (lp.b[i]! < -1e-12) {
      throw new Error(
        'assertLpStandard: need b≥0 (origin feasible) for this toy simplex',
      )
    }
  }
  for (let j = 0; j < n; j++) {
    if (!Number.isFinite(lp.c[j]!)) {
      throw new Error(`assertLpStandard: c[${j}] must be finite`)
    }
  }
  return { n, m }
}

/**
 * Build initial simplex tableau for max c·x, A x + s = b, x,s ≥ 0.
 * Columns: x1..xn | s1..sm | RHS
 * Constraint rows: A | I | b
 * Objective row (max, −c convention): [−c | 0_slack | 0]
 * Enter most-negative reduced cost; optimal when all ≥ 0; z = RHS of obj row.
 */
export function buildTableau(lp: LpStandard): {
  tableau: number[][]
  basic: number[]
  n: number
  m: number
} {
  const { n, m } = assertLpStandard(lp)
  const cols = n + m + 1
  const tableau: number[][] = []
  const basic: number[] = []
  for (let i = 0; i < m; i++) {
    const row = new Array<number>(cols).fill(0)
    for (let j = 0; j < n; j++) row[j] = lp.A[i]![j]!
    row[n + i] = 1
    row[cols - 1] = lp.b[i]!
    tableau.push(row)
    basic.push(n + i) // slack i basic
  }
  const obj = new Array<number>(cols).fill(0)
  for (let j = 0; j < n; j++) obj[j] = -lp.c[j]!
  tableau.push(obj)
  return { tableau, basic, n, m }
}

/** Deep-copy tableau. */
export function cloneTableau(T: number[][]): number[][] {
  return T.map((r) => r.slice())
}

/**
 * Dantzig enter rule for max with −c obj row:
 * pick column j (non-RHS) with most negative obj-row entry.
 * Returns −1 if optimal (all ≥ −tol).
 */
export function selectEnterCol(tableau: number[][], tol = 1e-12): number {
  const m = tableau.length - 1
  const obj = tableau[m]!
  const last = obj.length - 1
  let bestJ = -1
  let best = -tol
  for (let j = 0; j < last; j++) {
    const v = obj[j]!
    if (v < best) {
      best = v
      bestJ = j
    }
  }
  return bestJ
}

/**
 * Ratio test: among rows i with a_{i,enter} > tol, minimize RHS / a.
 * Returns −1 if unbounded (no positive pivot).
 * On ties pick smallest row index (Bland-ish).
 */
export function selectLeaveRow(
  tableau: number[][],
  enter: number,
  tol = 1e-12,
): number {
  const m = tableau.length - 1
  const rhsCol = tableau[0]!.length - 1
  let bestI = -1
  let bestRatio = Number.POSITIVE_INFINITY
  for (let i = 0; i < m; i++) {
    const a = tableau[i]![enter]!
    if (a > tol) {
      const ratio = tableau[i]![rhsCol]! / a
      if (
        ratio < bestRatio - 1e-15 ||
        (Math.abs(ratio - bestRatio) <= 1e-15 && (bestI < 0 || i < bestI))
      ) {
        bestRatio = ratio
        bestI = i
      }
    }
  }
  return bestI
}

/**
 * Pivot tableau so row `leave` becomes unit in column `enter`.
 * Mutates tableau in place.
 */
export function pivot(
  tableau: number[][],
  leave: number,
  enter: number,
  tol = 1e-15,
): void {
  const rows = tableau.length
  const cols = tableau[0]!.length
  const piv = tableau[leave]![enter]!
  if (!(Math.abs(piv) > tol)) {
    throw new Error('pivot: pivot element too small')
  }
  for (let j = 0; j < cols; j++) {
    tableau[leave]![j] = tableau[leave]![j]! / piv
  }
  for (let i = 0; i < rows; i++) {
    if (i === leave) continue
    const factor = tableau[i]![enter]!
    if (Math.abs(factor) <= tol) {
      tableau[i]![enter] = 0
      continue
    }
    for (let j = 0; j < cols; j++) {
      tableau[i]![j] = tableau[i]![j]! - factor * tableau[leave]![j]!
    }
    tableau[i]![enter] = 0
  }
  tableau[leave]![enter] = 1
}

/**
 * Extract primal x (orig vars) and slack from basic map + RHS.
 * Nonbasic → 0. Objective = RHS of obj row (−c convention).
 */
export function extractSolution(
  tableau: number[][],
  basic: number[],
  n: number,
  m: number,
): { x: number[]; slack: number[]; objective: number } {
  const rhsCol = n + m
  const x = new Array<number>(n).fill(0)
  const slack = new Array<number>(m).fill(0)
  for (let i = 0; i < m; i++) {
    const varIdx = basic[i]!
    const val = tableau[i]![rhsCol]!
    if (varIdx < n) x[varIdx] = val
    else slack[varIdx - n] = val
  }
  const objective = tableau[m]![rhsCol]!
  return { x, slack, objective }
}

/**
 * Run primal simplex (max) from origin-feasible standard form.
 * Dantzig enter (most negative −c row), min-ratio leave.
 */
export function simplexMax(
  lp: LpStandard,
  opts?: { maxPivots?: number; tol?: number },
): SimplexResult {
  const { n, m } = assertLpStandard(lp)
  const maxPivots = opts?.maxPivots ?? 100
  const tol = opts?.tol ?? 1e-12
  const built = buildTableau(lp)
  const tableau = built.tableau
  const basic = built.basic.slice()
  let pivots = 0

  while (pivots < maxPivots) {
    const enter = selectEnterCol(tableau, tol)
    if (enter < 0) {
      const sol = extractSolution(tableau, basic, n, m)
      return {
        status: 'optimal',
        objective: sol.objective,
        x: sol.x,
        slack: sol.slack,
        pivots,
        tableau: cloneTableau(tableau),
      }
    }
    const leave = selectLeaveRow(tableau, enter, tol)
    if (leave < 0) {
      const sol = extractSolution(tableau, basic, n, m)
      return {
        status: 'unbounded',
        objective: sol.objective,
        x: sol.x,
        slack: sol.slack,
        pivots,
        tableau: cloneTableau(tableau),
      }
    }
    pivot(tableau, leave, enter, tol * 1e-3)
    basic[leave] = enter
    pivots++
  }

  const sol = extractSolution(tableau, basic, n, m)
  return {
    status: 'maxiter',
    objective: sol.objective,
    x: sol.x,
    slack: sol.slack,
    pivots,
    tableau: cloneTableau(tableau),
  }
}

/** Evaluate c·x. */
export function objectiveValue(
  c: ArrayLike<number>,
  x: ArrayLike<number>,
): number {
  let s = 0
  for (let i = 0; i < c.length; i++) s += c[i]! * x[i]!
  return s
}

/** Max constraint residual max_i (A_i x − b_i) and min x_j. */
export function primalFeasibility(
  lp: LpStandard,
  x: ArrayLike<number>,
): { maxViolation: number; minX: number } {
  const { n, m } = assertLpStandard(lp)
  let maxViolation = 0
  let minX = Infinity
  for (let j = 0; j < n; j++) {
    const v = x[j]!
    if (v < minX) minX = v
  }
  for (let i = 0; i < m; i++) {
    let ax = 0
    for (let j = 0; j < n; j++) ax += lp.A[i]![j]! * x[j]!
    const viol = ax - lp.b[i]!
    if (viol > maxViolation) maxViolation = viol
  }
  return { maxViolation, minX }
}

/**
 * Representative sample: simplex on default 2-var LP → z*=36 at (2,6).
 */
export function runSimplexSample(
  opts: { lp?: LpStandard; maxPivots?: number } = {},
): {
  n: number
  m: number
  status: SimplexStatus
  objective: number
  x: number[]
  expectedZ: number
  zErr: number
  maxViolation: number
  minX: number
  pivots: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SIMPLEX
  familyId: typeof METHOD_LP
} {
  const useDefault = opts.lp === undefined
  const lp = opts.lp ?? makeDefaultLp2()
  const { n, m } = assertLpStandard(lp)
  const r = simplexMax(lp, { maxPivots: opts.maxPivots ?? 50 })

  // Default instance closed form
  const expectedZ = useDefault ? 36 : objectiveValue(lp.c, r.x)
  const zErr = useDefault
    ? Math.abs(r.objective - expectedZ)
    : Math.abs(r.objective - objectiveValue(lp.c, r.x))
  const feas = primalFeasibility(lp, r.x)
  const finite =
    Number.isFinite(r.objective) &&
    r.x.every((v) => Number.isFinite(v)) &&
    r.slack.every((v) => Number.isFinite(v))

  let xMatch = true
  if (useDefault) {
    xMatch =
      Math.abs(r.x[0]! - 2) < 1e-8 && Math.abs(r.x[1]! - 6) < 1e-8
  }

  const ok =
    finite &&
    r.status === 'optimal' &&
    zErr < 1e-8 &&
    feas.maxViolation < 1e-8 &&
    feas.minX >= -1e-10 &&
    r.pivots > 0 &&
    xMatch &&
    Math.abs(r.objective - objectiveValue(lp.c, r.x)) < 1e-8

  return {
    n,
    m,
    status: r.status,
    objective: r.objective,
    x: r.x.slice(),
    expectedZ: useDefault ? 36 : r.objective,
    zErr,
    maxViolation: feas.maxViolation,
    minX: feas.minX,
    pivots: r.pivots,
    finite,
    ok,
    methodId: METHOD_ALGO_SIMPLEX,
    familyId: METHOD_LP,
  }
}
