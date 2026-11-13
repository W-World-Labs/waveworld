//! Existing homogeneous monochromatic plane-wave helpers. FP64 throughout;
//! these are analytic fields, not spatial Maxwell/acoustic PDE solvers.
use crate::{sin_cos, sqrt, KernelError};

pub const C0: f64 = 299_792_458.;
pub const MU0: f64 = 4e-7 * core::f64::consts::PI;
pub const EPS0: f64 = 1. / (MU0 * C0 * C0);
pub const EM3D_SAMPLES: usize = 140;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct EmConfig {
    pub frequency_hz: f64,
    pub refractive_index: f64,
    pub e_peak: f64,
    pub phase0: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct EmObservables {
    pub wavelength_m: f64,
    pub phase_velocity: f64,
    pub impedance: f64,
    pub b_peak: f64,
    pub intensity_w_m2: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct AcousticConfig {
    pub frequency_hz: f64,
    pub rho: f64,
    pub c: f64,
    pub p_peak: f64,
    pub phase0: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct AcousticObservables {
    pub wavelength_m: f64,
    pub impedance: f64,
    pub v_peak: f64,
    pub intensity_w_m2: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Em3dConfig {
    pub wave_number: f64,
    pub amplitude: f64,
    pub time: f64,
}

fn finite(values: &[f64]) -> Result<(), KernelError> {
    if values.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(KernelError::NonFiniteValue)
    }
}

pub fn phase_sin_cos(angle: f64) -> Result<(f64, f64), KernelError> {
    sin_cos(angle)
}

pub fn em_observables(p: &EmConfig) -> Result<EmObservables, KernelError> {
    finite(&[p.frequency_hz, p.refractive_index, p.e_peak, p.phase0])?;
    if p.frequency_hz <= 0. || p.refractive_index < 1. || p.e_peak < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let phase_velocity = C0 / p.refractive_index;
    let wavelength_m = phase_velocity / p.frequency_hz;
    let impedance = sqrt(MU0 / EPS0)? / p.refractive_index;
    let b_peak = p.e_peak / phase_velocity;
    let intensity_w_m2 = (p.e_peak * p.e_peak) / (2. * impedance);
    finite(&[p.e_peak * p.e_peak, 2. * impedance])?;
    finite(&[
        wavelength_m,
        phase_velocity,
        impedance,
        b_peak,
        intensity_w_m2,
    ])?;
    Ok(EmObservables {
        wavelength_m,
        phase_velocity,
        impedance,
        b_peak,
        intensity_w_m2,
    })
}

/// Exact-length, disjoint caller-owned buffers. On error discard all outputs;
/// a late arithmetic overflow can leave a prefix written. Empty samples are OK.
pub fn sample_em(
    p: &EmConfig,
    time: f64,
    xs: &[f64],
    e: &mut [f64],
    b: &mut [f64],
) -> Result<(), KernelError> {
    if xs.len() != e.len() || xs.len() != b.len() {
        return Err(KernelError::BufferLength);
    }
    let obs = em_observables(p)?;
    finite(&[time])?;
    finite(xs)?;
    let omega = 2. * core::f64::consts::PI * p.frequency_hz;
    let k = omega / obs.phase_velocity;
    finite(&[omega, k, omega * time])?;
    for ((&x, e), b) in xs.iter().zip(e).zip(b) {
        let arg = k * x - omega * time + p.phase0;
        let cos = sin_cos(arg)?.1;
        *e = p.e_peak * cos;
        *b = obs.b_peak * cos;
        finite(&[*e, *b])?;
    }
    Ok(())
}

pub fn acoustic_observables(p: &AcousticConfig) -> Result<AcousticObservables, KernelError> {
    finite(&[p.frequency_hz, p.rho, p.c, p.p_peak, p.phase0])?;
    if p.frequency_hz <= 0. || p.rho <= 0. || p.c <= 0. || p.p_peak < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let impedance = p.rho * p.c;
    let wavelength_m = p.c / p.frequency_hz;
    let v_peak = p.p_peak / impedance;
    let intensity_w_m2 = (p.p_peak * p.p_peak) / (2. * impedance);
    finite(&[p.p_peak * p.p_peak, 2. * impedance])?;
    finite(&[wavelength_m, impedance, v_peak, intensity_w_m2])?;
    Ok(AcousticObservables {
        wavelength_m,
        impedance,
        v_peak,
        intensity_w_m2,
    })
}

pub fn sample_acoustic(
    p: &AcousticConfig,
    time: f64,
    xs: &[f64],
    pressure: &mut [f64],
    velocity: &mut [f64],
) -> Result<(), KernelError> {
    if xs.len() != pressure.len() || xs.len() != velocity.len() {
        return Err(KernelError::BufferLength);
    }
    let obs = acoustic_observables(p)?;
    finite(&[time])?;
    finite(xs)?;
    let omega = 2. * core::f64::consts::PI * p.frequency_hz;
    let k = omega / p.c;
    finite(&[omega, k, omega * time])?;
    for ((&x, pressure), velocity) in xs.iter().zip(pressure).zip(velocity) {
        let arg = k * x - omega * time + p.phase0;
        let cos = sin_cos(arg)?.1;
        *pressure = p.p_peak * cos;
        *velocity = obs.v_peak * cos;
        finite(&[*pressure, *velocity])?;
    }
    Ok(())
}

pub fn em3d_fields(
    p: &Em3dConfig,
    z: &mut [f64],
    ey: &mut [f64],
    cbx: &mut [f64],
) -> Result<f64, KernelError> {
    if z.len() != EM3D_SAMPLES || ey.len() != EM3D_SAMPLES || cbx.len() != EM3D_SAMPLES {
        return Err(KernelError::BufferLength);
    }
    finite(&[p.wave_number, p.amplitude, p.time])?;
    if p.wave_number <= 0. || p.amplitude < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let wavelength = 2. * core::f64::consts::PI / p.wave_number;
    finite(&[wavelength])?;
    for i in 0..EM3D_SAMPLES {
        z[i] = -14. + 2. * 14. * i as f64 / (EM3D_SAMPLES - 1) as f64;
        ey[i] = p.amplitude * sin_cos(p.wave_number * (z[i] - p.time))?.0;
        cbx[i] = -ey[i];
        finite(&[ey[i], cbx[i]])?;
    }
    Ok(wavelength)
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    #[test]
    fn readouts_phase_and_sample_relations() {
        let p = EmConfig {
            frequency_hz: 1e9,
            refractive_index: 2.,
            e_peak: 100.,
            phase0: 0.,
        };
        let r = em_observables(&p).unwrap();
        assert_eq!(r.wavelength_m, C0 / 2. / 1e9);
        let (mut e, mut b) = ([0.; 3], [0.; 3]);
        sample_em(&p, 0., &[0., 0.1, 1e20], &mut e, &mut b).unwrap();
        assert_eq!(e[0], 100.);
        for i in 0..3 {
            assert!((e[i] / r.phase_velocity - b[i]).abs() < 1e-21);
        }
        let p = AcousticConfig {
            frequency_hz: 1e20,
            rho: 1e-6,
            c: 1e-6,
            p_peak: 1e6,
            phase0: 1e6,
        };
        sample_acoustic(&p, 1e6, &[-1e20, 0., 1e20], &mut e, &mut b).unwrap();
        assert!(e.iter().chain(&b).all(|v| v.is_finite()));
    }
    #[test]
    fn invalid_input_is_explicit() {
        let mut p = EmConfig {
            frequency_hz: 1.,
            refractive_index: 1.,
            e_peak: 1.,
            phase0: 0.,
        };
        assert_eq!(
            sample_em(&p, 0., &[0.], &mut [], &mut []),
            Err(KernelError::BufferLength)
        );
        assert_eq!(
            sample_em(&p, 0., &[f64::NAN], &mut [0.], &mut [0.]),
            Err(KernelError::NonFiniteValue)
        );
        p.phase0 = f64::INFINITY;
        assert_eq!(em_observables(&p).unwrap_err(), KernelError::NonFiniteValue);
        p.phase0 = 0.;
        p.frequency_hz = 0.;
        assert_eq!(
            em_observables(&p).unwrap_err(),
            KernelError::InvalidCoefficient
        );
        p.frequency_hz = f64::MAX;
        assert_eq!(
            sample_em(&p, 0., &[0.], &mut [0.], &mut [0.]),
            Err(KernelError::NonFiniteValue)
        );
        assert!(phase_sin_cos(f64::MAX).unwrap().0.is_finite());
        assert_eq!(phase_sin_cos(f64::NAN), Err(KernelError::NonFiniteValue));
    }
    #[test]
    fn finite_phases_and_threshold_neighbors_match_std() {
        for x in [
            262_144.,
            f64::from_bits(262_144_f64.to_bits() + 1),
            1e20,
            -6e46,
            1e200,
            f64::MAX,
        ] {
            let (s, c) = phase_sin_cos(x).unwrap();
            assert!((s - x.sin()).abs() < 7e-16, "{x} sin {s}");
            assert!((c - x.cos()).abs() < 7e-16, "{x} cos {c}");
        }
        assert_eq!(core::mem::size_of::<EmConfig>(), 32);
        assert_eq!(core::mem::size_of::<EmObservables>(), 40);
        assert_eq!(core::mem::size_of::<AcousticConfig>(), 40);
        assert_eq!(core::mem::size_of::<AcousticObservables>(), 32);
        assert_eq!(core::mem::size_of::<Em3dConfig>(), 24);
    }
}
