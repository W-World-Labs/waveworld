//! Existing SI Faraday/Lenz and uniform rotating-coil analytic models, FP64.
use crate::{sin_cos, KernelError};

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct FaradayConfig {
    pub omega: f64,
    pub b: f64,
    pub n: f64,
    pub area: f64,
    pub v_bar: f64,
    pub b_mot: f64,
    pub l_bar: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct FaradayReadout {
    pub peak: f64,
    pub linkage: f64,
    pub motional_emf: f64,
    pub frequency: f64,
    pub period: f64,
}
fn finite(v: f64) -> Result<f64, KernelError> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}
pub fn induced_emf(d_phi_dt: f64, n: f64) -> Result<f64, KernelError> {
    finite(d_phi_dt)?;
    finite(n)?;
    finite(-n * d_phi_dt)
}
pub fn motional_emf(b: f64, length: f64, v: f64) -> Result<f64, KernelError> {
    finite(b)?;
    finite(length)?;
    finite(v)?;
    finite(b * length * v)
}
fn linkage(n: f64, b: f64, area: f64) -> Result<f64, KernelError> {
    finite(n)?;
    finite(b)?;
    finite(area)?;
    finite(n * b * area)
}
pub fn peak_emf(n: f64, b: f64, area: f64, omega: f64) -> Result<f64, KernelError> {
    finite(omega)?;
    finite(linkage(n, b, area)? * omega)
}
pub fn rotating_coil_flux(
    t: f64,
    n: f64,
    b: f64,
    area: f64,
    omega: f64,
) -> Result<f64, KernelError> {
    finite(t)?;
    finite(omega)?;
    let amplitude = linkage(n, b, area)?;
    finite(amplitude * sin_cos(finite(omega * t)?)?.1)
}
pub fn rotating_coil_emf(
    t: f64,
    n: f64,
    b: f64,
    area: f64,
    omega: f64,
) -> Result<f64, KernelError> {
    finite(t)?;
    let peak = peak_emf(n, b, area, omega)?;
    finite(peak * sin_cos(finite(omega * t)?)?.0)
}
/// Single-turn flux input; forward/backward endpoint and centered interior
/// differences. Pass n=1 when the input already represents total flux linkage.
pub fn emf_from_flux_series(
    flux: &[f64],
    dt: f64,
    n: f64,
    out: &mut [f64],
) -> Result<(), KernelError> {
    if flux.len() != out.len() {
        return Err(KernelError::BufferLength);
    }
    if !dt.is_finite() || dt <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    finite(n)?;
    for &v in flux {
        finite(v)?;
    }
    let len = flux.len();
    for (i, value) in out.iter_mut().enumerate() {
        let derivative = if i == 0 {
            if len > 1 {
                finite(flux[1] - flux[0])? / dt
            } else {
                0.
            }
        } else if i == len - 1 {
            finite(flux[len - 1] - flux[len - 2])? / dt
        } else {
            finite(flux[i + 1] - flux[i - 1])? / finite(2. * dt)?
        };
        *value = induced_emf(finite(derivative)?, n)?;
    }
    Ok(())
}
pub fn faraday_result(
    p: &FaradayConfig,
    flux: &mut [f64],
    emf: &mut [f64],
) -> Result<FaradayReadout, KernelError> {
    if flux.len() != 361 || emf.len() != 361 {
        return Err(KernelError::BufferLength);
    }
    if !p.omega.is_finite() || p.omega <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let peak = peak_emf(p.n, p.b, p.area, p.omega)?;
    let linkage = linkage(p.n, p.b, p.area)?;
    let motional_emf = motional_emf(p.b_mot, p.l_bar, p.v_bar)?;
    let frequency = finite(p.omega / (2. * core::f64::consts::PI))?;
    let period = finite(1. / frequency)?;
    for i in 0..361 {
        // Retain the original generated time and phase order, including endpoints.
        let t = finite(finite(2. * period)? * i as f64)? / 360.;
        let (sin, cos) = sin_cos(finite(p.omega * t)?)?;
        flux[i] = finite(linkage * cos)?;
        emf[i] = finite(peak * sin)?;
    }
    Ok(FaradayReadout {
        peak,
        linkage,
        motional_emf,
        frequency,
        period,
    })
}
