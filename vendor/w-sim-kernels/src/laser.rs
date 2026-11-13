//! Existing two-level rate-equation teaching model; caller-owned FP64 state.
use crate::{hypot, sqrt, KernelError};
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct LaserParams {
    pub tau_n: f64,
    pub tau_c: f64,
    pub b: f64,
    pub spont: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct LaserConfig {
    pub params: LaserParams,
    pub pump: f64,
    pub dt: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct LaserState {
    pub n: f64,
    pub s: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct LaserPoint {
    pub p: f64,
    pub s: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct LaserReadout {
    pub threshold: f64,
    pub pump_max: f64,
    pub steady_photons: f64,
}
pub const DEFAULT: LaserParams = LaserParams {
    tau_n: 1.,
    tau_c: 0.05,
    b: 0.02,
    spont: 1e-4,
};
pub const LASER_DT: f64 = 0.02;
fn value(v: f64) -> Result<f64, KernelError> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}
fn params(p: &LaserParams) -> Result<(), KernelError> {
    if !p.tau_n.is_finite()
        || p.tau_n <= 0.
        || !p.tau_c.is_finite()
        || p.tau_c <= 0.
        || !p.b.is_finite()
        || p.b <= 0.
        || !p.spont.is_finite()
        || p.spont < 0.
    {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(())
}
fn pump(v: f64) -> Result<(), KernelError> {
    if !v.is_finite() || v < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(())
}
pub fn laser_step(
    p: &LaserParams,
    s: &mut LaserState,
    pump_value: f64,
    dt: f64,
) -> Result<(), KernelError> {
    params(p)?;
    pump(pump_value)?;
    if !dt.is_finite() || dt <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    if !s.n.is_finite() || !s.s.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    if s.n < 0. || s.s < 0. {
        return Err(KernelError::InvalidState);
    }
    // Classical RK4 (shared with the ODE kernels) replaces forward Euler.
    // Positivity: the ≥0 physical floor is applied once per accepted step to
    // the RK4 result, not per stage — clamping intermediate stages would break
    // fourth-order accuracy, while stage derivatives stay smooth anyway.
    let [n, photons] = crate::ode::rk4([s.n, s.s], dt, |n, ph| {
        [
            pump_value - n / p.tau_n - p.b * n * ph,
            p.b * n * ph - ph / p.tau_c + p.spont * n,
        ]
    })?;
    *s = LaserState {
        n: n.max(0.),
        s: photons.max(0.),
    };
    Ok(())
}
pub fn laser_advance(p: &LaserConfig, s: &mut LaserState, count: u32) -> Result<(), KernelError> {
    if count == 0 || count > 65_536 {
        return Err(KernelError::InvalidDimensions);
    }
    for _ in 0..count {
        laser_step(&p.params, s, p.pump, p.dt)?;
    }
    Ok(())
}
pub fn threshold_pump(p: &LaserParams) -> Result<f64, KernelError> {
    params(p)?;
    let product = value(p.b * p.tau_c)?;
    value(1. / product / p.tau_n)
}
pub fn steady_photons(p: &LaserParams, pump_value: f64) -> Result<f64, KernelError> {
    params(p)?;
    pump(pump_value)?;
    if pump_value == 0. || p.spont == 0. {
        return Ok(0.);
    }
    let a = value(p.b / p.tau_c)?;
    let b = value(1. / value(p.tau_n * p.tau_c)? - p.b * pump_value)?;
    let seed = value(p.spont * pump_value)?;
    let root = hypot(b, value(2. * sqrt(value(a * seed)?)?)?)?;
    let s = if b >= 0. {
        value(2. * seed)? / value(b + root)?
    } else {
        value(root - b)? / value(2. * a)?
    };
    value(s)
}
pub fn laser_characteristics(
    p: &LaserParams,
    pump_value: f64,
    curve: &mut [LaserPoint],
) -> Result<LaserReadout, KernelError> {
    if curve.len() != 51 {
        return Err(KernelError::BufferLength);
    }
    let threshold = threshold_pump(p)?;
    let pump_max = value(4. * threshold)?;
    let steady_photons = steady_photons(p, pump_value)?;
    for (i, v) in curve.iter_mut().enumerate() {
        let source = i as f64 * pump_max / 50.;
        *v = LaserPoint {
            p: source,
            s: self::steady_photons(p, source)?,
        };
    }
    Ok(LaserReadout {
        threshold,
        pump_max,
        steady_photons,
    })
}
