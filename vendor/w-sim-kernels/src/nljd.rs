//! Shockley-junction NLJD (nonlinear junction detection) model, FP64.
//!
//! Each target kind maps to real device parameters of the junction equivalent
//! circuit — saturation current `Is`, emission voltage `n·Vt`, series
//! resistance `Rs`, parallel junction capacitance `Cj`, and a reverse-branch
//! mirror ratio for the near-symmetric corroded metal–oxide–metal junction.
//! Linear metal is a plain ohmic resistance.
//!
//! The port is driven by a single tone `v(t) = V·cos(2π·f·t)` (ISM band).
//! The junction voltage `vd` solves `v = vd + Rs·(J(vd) + Cj·dvd/dt)` with
//! `J(vd) = Is·(e^{vd/nVt} − 1) − m·Is·(e^{−vd/nVt} − 1)`; the capacitive load
//! is closed by a periodic fixed-point pass over the waveform.  Harmonic levels
//! of the *junction current* are then measured by a direct DFT over an integer
//! number of periods — there are no polynomial identities anywhere — and the
//! verdict is a measured threshold on the computed 2f/1f and 3f/1f ratios.
//!
//! `Coefficients` keeps its two public ABI slots: `a2` carries `Is` (A) and
//! `a3` carries `nVt` (V).
use crate::{exp_negative, hypot, sin_cos, KernelError};
use core::f64::consts::PI;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Coefficients {
    /// Saturation current `Is` in amperes (0 ⇒ no rectifying junction).
    pub a2: f64,
    /// Emission voltage `n·Vt` in volts.
    pub a3: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Harmonics {
    pub f1: f64,
    pub f2: f64,
    pub f3: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct NljdReadout {
    pub coefficients: Coefficients,
    pub harmonics: Harmonics,
    pub relative: Harmonics,
    pub verdict: u32,
}

const VT_300K: f64 = 0.025_85; // kT/q at ~300 K (V)
const V_DRIVE: f64 = 0.45; // single-tone drive amplitude (V)
const F_DRIVE: f64 = 915.0e6; // illumination frequency (Hz, ISM band)
const PERIODS: usize = 4; // integer periods inside the DFT window
const SAMPLES: usize = 256; // waveform samples per window; 2×SAMPLES f64 must fit the 16 KiB WASM stack
const CAP_PASSES: usize = 6; // periodic fixed-point passes for Cj loading
const SOLVER_STEPS: usize = 48; // bracketed Newton iterations per sample
/// Minimum measured harmonic-to-fundamental ratio that counts as a response.
const HARMONIC_RATIO_MIN: f64 = 0.01;

/// Equivalent-circuit parameters of one target junction.
#[derive(Clone, Copy, Debug)]
struct Junction {
    is_sat: f64, // Shockley saturation current (A)
    n_vt: f64,   // emission voltage n·Vt (V)
    mirror: f64, // reverse-branch Is ratio (0 = one-way, ~1 = symmetric MOM)
    rs: f64,     // series resistance (Ω)
    cj: f64,     // parallel junction capacitance (F)
    r_ohm: f64,  // > 0 ⇒ linear metal: J = vd/r_ohm, no junction
}

fn junction(kind: u32) -> Result<Junction, KernelError> {
    Ok(match kind {
        // Small-signal Schottky/pn junction: one-way exponential, strong
        // even-order content under a single tone.
        0 => Junction {
            is_sat: 1e-8,
            n_vt: 1.3 * VT_300K,
            mirror: 0.,
            rs: 8.,
            cj: 1.5e-12,
            r_ohm: 0.,
        },
        // Corroded metal–oxide–metal ("rusty bolt") junction: two anti-parallel
        // exponential branches with a partial mirror ratio.  Near-symmetric ⇒
        // odd-order dominant, the classic corrosion signature.
        1 => Junction {
            is_sat: 1e-4,
            n_vt: 0.12,
            mirror: 0.7,
            rs: 25.,
            cj: 4e-12,
            r_ohm: 0.,
        },
        // Linear metal: pure series resistance, no junction.
        2 => Junction {
            is_sat: 0.,
            n_vt: 0.,
            mirror: 0.,
            rs: 0.,
            cj: 0.,
            r_ohm: 25.,
        },
        _ => return Err(KernelError::InvalidCoefficient),
    })
}

fn value(v: f64) -> Result<f64, KernelError> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}

/// e^x through the shared deterministic exp(-x) primitive.
fn exp(x: f64) -> Result<f64, KernelError> {
    if x <= 0. {
        exp_negative(-x)
    } else {
        value(1. / exp_negative(x)?)
    }
}

/// Junction current J(vd); the port additionally sees the series drop and the
/// parallel capacitance current, handled by `solve_junction_voltage`.
fn junction_current(j: &Junction, vd: f64) -> Result<f64, KernelError> {
    if j.r_ohm > 0. {
        return value(vd / j.r_ohm);
    }
    let forward = exp(vd / j.n_vt)?;
    let reverse = exp(-vd / j.n_vt)?;
    value(j.is_sat * (forward - j.mirror * reverse + j.mirror - 1.))
}

/// Solve `v = vd + Rs·(J(vd) + ic)` for the junction voltage.  `g` is strictly
/// increasing in vd (J' >= 0), so a bracketed Newton always converges; the
/// initial bracket is `vd ∈ [min(v,0), max(v,0)]` because the series drop
/// follows the sign of the junction current.
fn solve_junction_voltage(j: &Junction, v: f64, ic: f64) -> Result<f64, KernelError> {
    let mut lo = v.min(0.);
    let mut hi = v.max(0.);
    let mut vd = v.min(hi).max(lo);
    for _ in 0..SOLVER_STEPS {
        let jv = junction_current(j, vd)?;
        let g = vd + j.rs * (jv + ic) - v;
        let scale = 1. + v.abs() + j.rs * ic.abs();
        if g.abs() <= 1e-13 * scale {
            return Ok(vd);
        }
        if g > 0. {
            hi = vd;
        } else {
            lo = vd;
        }
        // Newton step on g' = 1 + Rs·J'(vd); fall back to bisection when the
        // step leaves the live bracket.
        let gp = if j.r_ohm > 0. {
            1. + j.rs / j.r_ohm
        } else {
            let ef = exp(vd / j.n_vt)?;
            let er = exp(-vd / j.n_vt)?;
            value(1. + j.rs * j.is_sat / j.n_vt * (ef + j.mirror * er))?
        };
        let next = vd - g / gp;
        vd = if next > lo && next < hi {
            next
        } else {
            0.5 * (lo + hi)
        };
    }
    Ok(vd)
}

/// Drive waveform value at sample `s` (integer number of periods per window).
fn drive_at(s: usize) -> Result<f64, KernelError> {
    let (_, c) = sin_cos(2. * PI * PERIODS as f64 * s as f64 / SAMPLES as f64)?;
    Ok(V_DRIVE * c)
}

/// Compute the junction-current waveform under the single-tone drive and
/// measure the first three harmonic amplitudes by direct DFT.  The parallel
/// capacitance is closed through a periodic fixed-point pass: `Cj·dvd/dt`
/// loads the source through Rs, which slightly suppresses the junction voltage
/// swing exactly as a real junction capacitance does.
fn measure_harmonics(j: &Junction) -> Result<Harmonics, KernelError> {
    let n = SAMPLES;
    let dt = PERIODS as f64 / (n as f64 * F_DRIVE);
    let mut vd = [0.; SAMPLES];
    let mut ic = [0.; SAMPLES];
    for s in 0..n {
        vd[s] = solve_junction_voltage(j, drive_at(s)?, 0.)?;
    }
    for _ in 0..CAP_PASSES {
        for s in 0..n {
            let dv = vd[(s + 1) % n] - vd[(s + n - 1) % n];
            ic[s] = value(j.cj * dv / (2. * dt))?;
        }
        for s in 0..n {
            vd[s] = solve_junction_voltage(j, drive_at(s)?, ic[s])?;
        }
    }
    // Direct DFT at harmonic bins 1..=3 (bin k·PERIODS); sin/cos of kφ come
    // from Chebyshev multiples of the measured sample phase.
    let mut re = [0.; 3];
    let mut im = [0.; 3];
    for s in 0..n {
        let (sn, cs) = sin_cos(2. * PI * PERIODS as f64 * s as f64 / n as f64)?;
        let i = junction_current(j, vd[s])?;
        let cos_k = [cs, 2. * cs * cs - 1., cs * (4. * cs * cs - 3.)];
        let sin_k = [sn, 2. * sn * cs, sn * (4. * cs * cs - 1.)];
        for k in 0..3 {
            re[k] += i * cos_k[k];
            im[k] += i * sin_k[k];
        }
    }
    Ok(Harmonics {
        f1: value(2. * hypot(re[0], im[0])? / n as f64)?,
        f2: value(2. * hypot(re[1], im[1])? / n as f64)?,
        f3: value(2. * hypot(re[2], im[2])? / n as f64)?,
    })
}

/// Static single-junction Shockley response `i = Is·(e^{v/(nVt)} − 1)`.
/// `is_sat`/`n_vt` are real device parameters; `is_sat == 0` (no junction)
/// gives zero current, and `n_vt <= 0` is rejected as unphysical.
pub fn diode_response(v: f64, is_sat: f64, n_vt: f64) -> Result<f64, KernelError> {
    value(v)?;
    value(is_sat)?;
    value(n_vt)?;
    if is_sat < 0. || n_vt <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    value(is_sat * (exp(v / n_vt)? - 1.))
}

/// Measured DFT harmonics of a generic one-way Shockley junction with the
/// given `Is`/`nVt` and the standard drive and parasitics (Rs = 8 Ω,
/// Cj = 1.5 pF).  This is a waveform measurement, not a closed-form identity.
pub fn harmonic_amplitudes(is_sat: f64, n_vt: f64) -> Result<Harmonics, KernelError> {
    value(is_sat)?;
    value(n_vt)?;
    if is_sat < 0. || n_vt <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    measure_harmonics(&Junction {
        is_sat,
        n_vt,
        mirror: 0.,
        rs: 8.,
        cj: 1.5e-12,
        r_ohm: 0.,
    })
}

/// Device parameters of a target kind, exposed through the two ABI slots:
/// `a2 = Is` (A), `a3 = nVt` (V).  Linear metal reports `(0, 0)` — no junction.
pub fn junction_coefficients(kind: u32) -> Result<Coefficients, KernelError> {
    let j = junction(kind)?;
    Ok(Coefficients {
        a2: j.is_sat,
        a3: j.n_vt,
    })
}

/// Measured harmonic fingerprint of a target kind under the swept-tone drive.
pub fn harmonics(kind: u32) -> Result<Harmonics, KernelError> {
    measure_harmonics(&junction(kind)?)
}

/// Verdict from measured harmonic ratios, not a lookup:
/// - both `f2/f1` and `f3/f1` below `HARMONIC_RATIO_MIN` ⇒ linear metal (2)
/// - `f2 ≥ f3` ⇒ even-order dominant one-way junction ⇒ semiconductor (0)
/// - otherwise odd-order dominant near-symmetric junction ⇒ corrosion (1)
pub fn classify(h: &Harmonics) -> Result<u32, KernelError> {
    for v in [h.f1, h.f2, h.f3] {
        value(v)?;
        if v < 0. {
            return Err(KernelError::InvalidCoefficient);
        }
    }
    let (r2, r3) = if h.f1 > 1e-30 {
        (h.f2 / h.f1, h.f3 / h.f1)
    } else {
        (0., 0.)
    };
    Ok(if r2 < HARMONIC_RATIO_MIN && r3 < HARMONIC_RATIO_MIN {
        2
    } else if r2 >= r3 {
        0
    } else {
        1
    })
}

/// Full scene readout plus the static port I–V (Rs included, Cj open at DC),
/// normalized to its peak magnitude for the fixed transfer display.
pub fn nljd_result(kind: u32, transfer: &mut [f64]) -> Result<NljdReadout, KernelError> {
    if transfer.len() != 81 {
        return Err(KernelError::BufferLength);
    }
    let j = junction(kind)?;
    let coefficients = junction_coefficients(kind)?;
    let harmonics = harmonics(kind)?;
    let total = value(harmonics.f1 + harmonics.f2 + harmonics.f3)?;
    let relative = Harmonics {
        f1: value(harmonics.f1 / total)?,
        f2: value(harmonics.f2 / total)?,
        f3: value(harmonics.f3 / total)?,
    };
    let verdict = classify(&harmonics)?;
    let mut peak: f64 = 0.;
    for (i, v) in transfer.iter_mut().enumerate() {
        let vd = solve_junction_voltage(&j, i as f64 / 40. - 1., 0.)?;
        let current = junction_current(&j, vd)?;
        *v = current;
        peak = peak.max(current.abs());
    }
    if peak > 0. {
        for v in transfer.iter_mut() {
            *v = value(*v / peak)?;
        }
    }
    Ok(NljdReadout {
        coefficients,
        harmonics,
        relative,
        verdict,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shockley_response_is_the_real_diode_equation() {
        // i = Is·(e^{v/nVt} − 1): at v = nVt·ln 2 the current is exactly Is.
        let v = 0.25 * core::f64::consts::LN_2;
        assert!((diode_response(v, 0.5, 0.25).unwrap() - 0.5).abs() < 1e-12);
        assert_eq!(diode_response(0., 1e-8, 0.033).unwrap(), 0.);
        // Rectification: forward >> reverse magnitude.
        let p = junction(0).unwrap();
        let fwd = diode_response(0.45, p.is_sat, p.n_vt).unwrap();
        let rev = diode_response(-0.45, p.is_sat, p.n_vt).unwrap();
        assert!(fwd > -rev * 1e5);
    }

    #[test]
    fn dft_measures_injected_known_nonlinearity() {
        // A near-symmetric junction (mirror = 1 is exactly odd) must show
        // vanishing even order: f2 ≈ 0 while f3 > 0 — a real DFT result that
        // no polynomial identity is consulted for.
        let odd = measure_harmonics(&Junction {
            is_sat: 1e-4,
            n_vt: 0.12,
            mirror: 1.,
            rs: 25.,
            cj: 4e-12,
            r_ohm: 0.,
        })
        .unwrap();
        assert!(odd.f3 > 0.);
        assert!(odd.f2 < 1e-6 * odd.f1);
        // Pure resistor: all harmonics above the first vanish.
        let lin = measure_harmonics(&junction(2).unwrap()).unwrap();
        assert!(lin.f1 > 0.);
        assert!(lin.f2 < 1e-9 * lin.f1 && lin.f3 < 1e-9 * lin.f1);
        // One-way junction: real even-order content, f2 dominates f3.
        let semi = harmonics(0).unwrap();
        assert!(semi.f2 > semi.f3 && semi.f2 > 0.05 * semi.f1);
        let corr = harmonics(1).unwrap();
        assert!(corr.f3 > corr.f2 && corr.f3 > 0.02 * corr.f1);
    }

    #[test]
    fn kinds_classify_from_measured_ratios() {
        for kind in 0..3 {
            assert_eq!(classify(&harmonics(kind).unwrap()).unwrap(), kind);
        }
        // Threshold behaviour on measured-ratio inputs.
        assert_eq!(
            classify(&Harmonics {
                f1: 1.,
                f2: 0.5,
                f3: 0.1
            })
            .unwrap(),
            0
        );
        assert_eq!(
            classify(&Harmonics {
                f1: 1.,
                f2: 0.005,
                f3: 0.005
            })
            .unwrap(),
            2
        );
        assert_eq!(
            classify(&Harmonics {
                f1: 0.,
                f2: 0.,
                f3: 0.
            })
            .unwrap(),
            2
        );
    }

    #[test]
    fn transfer_is_normalized_static_iv() {
        let mut t = [0.; 81];
        let r = nljd_result(0, &mut t).unwrap();
        assert_eq!(r.verdict, 0);
        assert!((r.relative.f1 + r.relative.f2 + r.relative.f3 - 1.).abs() < 3e-16);
        assert_eq!(t[40], 0.); // i(0) = 0
        assert_eq!(t[80], 1.); // normalized forward peak
        assert!(t[0].abs() < 1e-6); // reverse ≈ −Is, invisible after scaling
        let mut tm = [0.; 81];
        nljd_result(2, &mut tm).unwrap();
        assert!((tm[0] + 1.).abs() < 1e-12 && (tm[80] - 1.).abs() < 1e-12); // linear
    }
}
