/**
 * Forward-mode automatic differentiation via dual numbers.
 * Dual (val, der); ops add/mul/sin/exp; sample f(x)=sin(x^2).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · automatic differentiation. */
export const METHOD_AD = 'method-automatic-differentiation'

/** Algo · forward-mode AD (dual numbers). */
export const METHOD_ALGO_AD_FORWARD = 'method-algo-ad-forward'

/** Parent alias (aligns with familyId). */
export const AD_PARENT = METHOD_AD

export const AD_METHOD_IDS = [METHOD_ALGO_AD_FORWARD] as const

// ---------------------------------------------------------------------------
// Dual numbers
// ---------------------------------------------------------------------------

/** Dual number: real part val, infinitesimal (derivative) part der. */
export type Dual = { val: number; der: number }

/** Constant dual (derivative 0). */
export function dualConst(val: number): Dual {
  return { val, der: 0 }
}

/** Independent variable dual at seed point x0 (derivative 1). */
export function dualVar(x0: number): Dual {
  return { val: x0, der: 1 }
}

/** Create dual from value and derivative. */
export function dual(val: number, der: number): Dual {
  return { val, der }
}

/** a + b */
export function dualAdd(a: Dual, b: Dual): Dual {
  return { val: a.val + b.val, der: a.der + b.der }
}

/** a − b */
export function dualSub(a: Dual, b: Dual): Dual {
  return { val: a.val - b.val, der: a.der - b.der }
}

/** a · b  (product rule) */
export function dualMul(a: Dual, b: Dual): Dual {
  return {
    val: a.val * b.val,
    der: a.val * b.der + a.der * b.val,
  }
}

/** a / b  (quotient rule) */
export function dualDiv(a: Dual, b: Dual): Dual {
  const inv = 1 / b.val
  return {
    val: a.val * inv,
    der: (a.der * b.val - a.val * b.der) * inv * inv,
  }
}

/** c · a  (scalar left-multiply) */
export function dualScale(c: number, a: Dual): Dual {
  return { val: c * a.val, der: c * a.der }
}

/** sin(a) */
export function dualSin(a: Dual): Dual {
  return {
    val: Math.sin(a.val),
    der: Math.cos(a.val) * a.der,
  }
}

/** cos(a) */
export function dualCos(a: Dual): Dual {
  return {
    val: Math.cos(a.val),
    der: -Math.sin(a.val) * a.der,
  }
}

/** exp(a) */
export function dualExp(a: Dual): Dual {
  const e = Math.exp(a.val)
  return { val: e, der: e * a.der }
}

/** a^2 via mul (convenience). */
export function dualSquare(a: Dual): Dual {
  return dualMul(a, a)
}

// ---------------------------------------------------------------------------
// Differentiation helpers
// ---------------------------------------------------------------------------

/**
 * Forward-mode derivative of scalar f: Dual → Dual at x0.
 * Seed dualVar(x0); return (f.val, f.der).
 */
export function forwardDiff(
  f: (x: Dual) => Dual,
  x0: number,
): { value: number; derivative: number } {
  const y = f(dualVar(x0))
  return { value: y.val, derivative: y.der }
}

/**
 * Teaching sample: f(x) = sin(x^2).
 * Analytic: f' = 2 x cos(x^2).
 */
export function fSinX2(x: Dual): Dual {
  return dualSin(dualSquare(x))
}

/** Analytic f(x)=sin(x^2) and f'(x)=2x cos(x^2). */
export function analyticSinX2(x0: number): { value: number; derivative: number } {
  const x2 = x0 * x0
  return {
    value: Math.sin(x2),
    derivative: 2 * x0 * Math.cos(x2),
  }
}

/**
 * Teaching sample: g(x) = exp(sin(x)).
 * Analytic: g' = cos(x) exp(sin(x)).
 */
export function fExpSin(x: Dual): Dual {
  return dualExp(dualSin(x))
}

export function analyticExpSin(x0: number): { value: number; derivative: number } {
  const s = Math.sin(x0)
  const e = Math.exp(s)
  return {
    value: e,
    derivative: Math.cos(x0) * e,
  }
}

// ---------------------------------------------------------------------------
// Sample runner
// ---------------------------------------------------------------------------

/**
 * Representative sample: forward AD on f(x)=sin(x^2) (+ exp(sin) check).
 * Matches analytic derivatives; ok teaching gate.
 */
export function runAdForwardSample(
  opts: {
    x0?: number
    x1?: number
  } = {},
): {
  x0: number
  value: number
  derivative: number
  analyticValue: number
  analyticDerivative: number
  absErrValue: number
  absErrDerivative: number
  expSinAbsErrDer: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_AD_FORWARD
  familyId: typeof METHOD_AD
} {
  const x0 = opts.x0 ?? 1.2
  const x1 = opts.x1 ?? 0.7

  const ad = forwardDiff(fSinX2, x0)
  const an = analyticSinX2(x0)
  const absErrValue = Math.abs(ad.value - an.value)
  const absErrDerivative = Math.abs(ad.derivative - an.derivative)

  const ad2 = forwardDiff(fExpSin, x1)
  const an2 = analyticExpSin(x1)
  const expSinAbsErrDer = Math.abs(ad2.derivative - an2.derivative)

  const finite =
    Number.isFinite(ad.value) &&
    Number.isFinite(ad.derivative) &&
    Number.isFinite(ad2.value) &&
    Number.isFinite(ad2.derivative)

  const ok =
    finite &&
    absErrValue < 1e-12 &&
    absErrDerivative < 1e-12 &&
    expSinAbsErrDer < 1e-12

  return {
    x0,
    value: ad.value,
    derivative: ad.derivative,
    analyticValue: an.value,
    analyticDerivative: an.derivative,
    absErrValue,
    absErrDerivative,
    expSinAbsErrDer,
    finite,
    ok,
    methodId: METHOD_ALGO_AD_FORWARD,
    familyId: METHOD_AD,
  }
}
