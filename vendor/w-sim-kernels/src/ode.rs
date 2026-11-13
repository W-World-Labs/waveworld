//! Existing circuit, oscillator and neuron ODEs. Caller-owned f64 trajectories.
use crate::{hypot, sin_cos, sqrt, KernelError};
fn finite(values: &[f64]) -> Result<(), KernelError> {
    if values.iter().all(|x| x.is_finite()) {
        Ok(())
    } else {
        Err(KernelError::NonFiniteValue)
    }
}
fn value(v: f64) -> Result<f64, KernelError> {
    finite(&[v])?;
    Ok(v)
}
fn dt(v: f64) -> Result<(), KernelError> {
    if v.is_finite() && v > 0. {
        Ok(())
    } else {
        Err(KernelError::InvalidCoefficient)
    }
}
fn count(start: usize, n: usize) -> Result<(), KernelError> {
    if n == 0
        || start
            .checked_add(n)
            .is_none_or(|end| end > u32::MAX as usize)
    {
        Err(KernelError::InvalidDimensions)
    } else {
        Ok(())
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct RlcConfig {
    pub l: f64,
    pub r: f64,
    pub c: f64,
    pub voltage: f64,
    pub dt: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct RlcState {
    pub q: f64,
    pub i: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct RlcReadout {
    pub omega0: f64,
    pub damping_ratio: f64,
    pub quality_factor: Option<f64>,
    pub damped_frequency: f64,
    pub energy: f64,
}
fn rlc_config(p: &RlcConfig) -> Result<(), KernelError> {
    finite(&[p.l, p.r, p.c, p.voltage])?;
    dt(p.dt)?;
    if p.l <= 0. || p.c <= 0. || p.r < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(())
}
// RLC, mutual, FHN and the laser rate equations share the same classical RK4
// operation order; `pub(crate)` so `laser.rs` does not duplicate the scheme.
pub(crate) fn rk4(
    state: [f64; 2],
    h: f64,
    deriv: impl Fn(f64, f64) -> [f64; 2],
) -> Result<[f64; 2], KernelError> {
    finite(&state)?;
    let [x, y] = state;
    let a = deriv(x, y);
    let b = deriv(x + (h / 2.) * a[0], y + (h / 2.) * a[1]);
    let c = deriv(x + (h / 2.) * b[0], y + (h / 2.) * b[1]);
    let d = deriv(x + h * c[0], y + h * c[1]);
    finite(&a)?;
    finite(&b)?;
    finite(&c)?;
    finite(&d)?;
    let out = [
        x + (h / 6.) * (a[0] + 2. * b[0] + 2. * c[0] + d[0]),
        y + (h / 6.) * (a[1] + 2. * b[1] + 2. * c[1] + d[1]),
    ];
    finite(&out)?;
    Ok(out)
}
fn rlc_inner(s: RlcState, p: &RlcConfig) -> Result<RlcState, KernelError> {
    let [q, i] = rk4([s.q, s.i], p.dt, |q, i| {
        [i, (p.voltage - p.r * i - q / p.c) / p.l]
    })?;
    Ok(RlcState { q, i })
}
pub fn rlc_step(s: RlcState, p: &RlcConfig) -> Result<RlcState, KernelError> {
    rlc_config(p)?;
    rlc_inner(s, p)
}
pub fn advance_rlc(
    p: &RlcConfig,
    s: &mut RlcState,
    out: &mut [RlcState],
) -> Result<(), KernelError> {
    rlc_config(p)?;
    count(0, out.len())?;
    finite(&[s.q, s.i])?;
    for slot in out {
        *s = rlc_inner(*s, p)?;
        *slot = *s;
    }
    Ok(())
}
pub fn read_rlc(p: &RlcConfig, s: RlcState) -> Result<RlcReadout, KernelError> {
    rlc_config(p)?;
    finite(&[s.q, s.i])?;
    let omega0 = value(1. / sqrt(p.l * p.c)?)?;
    let damping_ratio = value((p.r / 2.) * sqrt(p.c / p.l)?)?;
    let quality_factor = if p.r == 0. {
        None
    } else {
        Some(value(sqrt(p.l / p.c)? / p.r)?)
    };
    let damped_frequency = if damping_ratio < 1. {
        value(omega0 * sqrt(1. - damping_ratio * damping_ratio)?)?
    } else {
        0.
    };
    let energy = value(0.5 * p.l * s.i * s.i + 0.5 * (s.q * s.q) / p.c)?;
    Ok(RlcReadout {
        omega0,
        damping_ratio,
        quality_factor,
        damped_frequency,
        energy,
    })
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct MutualConfig {
    pub l1: f64,
    pub l2: f64,
    pub m: f64,
    pub r1: f64,
    pub r2: f64,
    pub v1: f64,
    pub v2: f64,
    pub dt: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct MutualState {
    pub i1: f64,
    pub i2: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct MutualRunState {
    pub i1: f64,
    pub i2: f64,
    pub primary_dissipation: f64,
    pub secondary_dissipation: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct MutualReadout {
    pub coupling: f64,
    pub turns_ratio: f64,
    pub secondary_voltage: f64,
    pub substeps: usize,
    pub secondary_share: f64,
}
fn mutual_config(p: &MutualConfig) -> Result<f64, KernelError> {
    finite(&[p.l1, p.l2, p.m, p.r1, p.r2, p.v1, p.v2])?;
    dt(p.dt)?;
    if p.l1 <= 0. || p.l2 <= 0. || p.r1 < 0. || p.r2 < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let cap = 0.99 * sqrt(p.l1 * p.l2)?;
    let m = p.m.clamp(-cap, cap);
    let determinant = p.l1 * p.l2 - m * m;
    if !determinant.is_finite() || determinant <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(m)
}
fn mutual_substeps(p: &MutualConfig, m: f64) -> Result<usize, KernelError> {
    let trace = (p.l2 * p.r1 + p.l1 * p.r2) / (p.l1 * p.l2 - m * m);
    let scaled = p.dt * trace / 2.;
    if !scaled.is_finite() || scaled > 65_536. {
        return Err(KernelError::UnsupportedFeature);
    }
    let whole = scaled as usize;
    Ok((whole + usize::from(scaled > whole as f64)).max(1))
}
fn mutual_inner(s: MutualState, p: &MutualConfig, m: f64) -> Result<MutualState, KernelError> {
    let [i1, i2] = rk4([s.i1, s.i2], p.dt, |i1, i2| {
        let d = p.l1 * p.l2 - m * m;
        let e1 = p.v1 - p.r1 * i1;
        let e2 = p.v2 - p.r2 * i2;
        [(p.l2 * e1 - m * e2) / d, (-m * e1 + p.l1 * e2) / d]
    })?;
    Ok(MutualState { i1, i2 })
}
pub fn mutual_step(s: MutualState, p: &MutualConfig) -> Result<MutualState, KernelError> {
    let m = mutual_config(p)?;
    mutual_inner(s, p, m)
}
fn run_state(s: MutualRunState) -> Result<(), KernelError> {
    finite(&[s.i1, s.i2, s.primary_dissipation, s.secondary_dissipation])?;
    if s.primary_dissipation < 0. || s.secondary_dissipation < 0. {
        return Err(KernelError::InvalidState);
    }
    Ok(())
}
fn share(s: MutualRunState) -> Result<f64, KernelError> {
    let sum = value(s.primary_dissipation + s.secondary_dissipation)?;
    Ok(if sum > 0. {
        s.secondary_dissipation / sum
    } else {
        0.
    })
}
pub fn advance_mutual(
    p: &MutualConfig,
    s: &mut MutualRunState,
    start_step: usize,
    sine: bool,
    omega: f64,
    out: &mut [MutualState],
    shares: &mut [f64],
) -> Result<(), KernelError> {
    let m = mutual_config(p)?;
    count(start_step, out.len())?;
    run_state(*s)?;
    finite(&[omega])?;
    if out.len() != shares.len() {
        return Err(KernelError::BufferLength);
    }
    if !sine && omega != 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let substeps = mutual_substeps(p, m)?;
    let h = p.dt / substeps as f64;
    dt(h)?;
    let mut sub = *p;
    sub.dt = h;
    for (offset, slot) in out.iter_mut().enumerate() {
        for j in 0..substeps {
            let time = (start_step + offset) as f64 * p.dt + (j as f64 + 0.5) * h;
            sub.v1 = if sine {
                value(p.v1 * sin_cos(omega * time)?.0)?
            } else {
                p.v1
            };
            let next = mutual_inner(MutualState { i1: s.i1, i2: s.i2 }, &sub, m)?;
            let secondary =
                s.secondary_dissipation + 0.5 * h * p.r2 * (s.i2 * s.i2 + next.i2 * next.i2);
            let primary =
                s.primary_dissipation + 0.5 * h * p.r1 * (s.i1 * s.i1 + next.i1 * next.i1);
            finite(&[secondary, primary])?;
            *s = MutualRunState {
                i1: next.i1,
                i2: next.i2,
                primary_dissipation: primary,
                secondary_dissipation: secondary,
            };
        }
        *slot = MutualState { i1: s.i1, i2: s.i2 };
        shares[offset] = share(*s)?;
    }
    Ok(())
}
pub fn read_mutual(p: &MutualConfig, s: MutualRunState) -> Result<MutualReadout, KernelError> {
    let m = mutual_config(p)?;
    run_state(s)?;
    Ok(MutualReadout {
        coupling: value(p.m / sqrt(p.l1 * p.l2)?)?,
        turns_ratio: sqrt(p.l2 / p.l1)?,
        secondary_voltage: value(p.v1 * sqrt(p.l2 / p.l1)?)?,
        substeps: mutual_substeps(p, m)?,
        secondary_share: share(s)?,
    })
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct OscillatorConfig {
    pub mass: f64,
    pub stiffness: f64,
    pub damping: f64,
    pub drive_amp: f64,
    pub drive_omega: f64,
    pub dt: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct OscillatorState {
    pub x: f64,
    pub v: f64,
}
fn oscillator_config(p: &OscillatorConfig) -> Result<(), KernelError> {
    finite(&[p.mass, p.stiffness, p.damping, p.drive_amp, p.drive_omega])?;
    dt(p.dt)?;
    if p.mass <= 0. || p.stiffness < 0. || p.damping < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(())
}
fn oscillator_inner(
    s: OscillatorState,
    p: &OscillatorConfig,
    t: f64,
) -> Result<OscillatorState, KernelError> {
    finite(&[s.x, s.v, t])?;
    let h = p.dt;
    let x = s.x;
    let v = s.v;
    let acc = |x: f64, v: f64, time: f64| -> Result<f64, KernelError> {
        value(
            (p.drive_amp * sin_cos(p.drive_omega * time)?.1 - p.damping * v - p.stiffness * x)
                / p.mass,
        )
    };
    let k1x = v;
    let k1v = acc(x, v, t)?;
    let k2x = v + 0.5 * h * k1v;
    let k2v = acc(x + 0.5 * h * k1x, v + 0.5 * h * k1v, t + 0.5 * h)?;
    let k3x = v + 0.5 * h * k2v;
    let k3v = acc(x + 0.5 * h * k2x, v + 0.5 * h * k2v, t + 0.5 * h)?;
    let k4x = v + h * k3v;
    let k4v = acc(x + h * k3x, v + h * k3v, t + h)?;
    Ok(OscillatorState {
        x: value(x + (h / 6.) * (k1x + 2. * k2x + 2. * k3x + k4x))?,
        v: value(v + (h / 6.) * (k1v + 2. * k2v + 2. * k3v + k4v))?,
    })
}
pub fn oscillator_step(
    s: OscillatorState,
    p: &OscillatorConfig,
    t: f64,
) -> Result<OscillatorState, KernelError> {
    oscillator_config(p)?;
    oscillator_inner(s, p, t)
}
pub fn advance_oscillator(
    p: &OscillatorConfig,
    s: &mut OscillatorState,
    start_step: usize,
    out: &mut [OscillatorState],
) -> Result<(), KernelError> {
    oscillator_config(p)?;
    count(start_step, out.len())?;
    finite(&[s.x, s.v])?;
    for (offset, slot) in out.iter_mut().enumerate() {
        *s = oscillator_inner(*s, p, (start_step + offset) as f64 * p.dt)?;
        *slot = *s;
    }
    Ok(())
}
pub fn oscillator_omega0(mass: f64, stiffness: f64) -> Result<f64, KernelError> {
    finite(&[mass, stiffness])?;
    if mass <= 0. || stiffness < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    sqrt(stiffness / mass)
}
pub fn oscillator_amplitude(p: &OscillatorConfig, omega: f64) -> Result<f64, KernelError> {
    oscillator_config(p)?;
    finite(&[omega])?;
    if p.drive_amp < 0. || omega < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let re = p.stiffness - p.mass * omega * omega;
    let im = p.damping * omega;
    let den = hypot(re, im)?;
    if den == 0. {
        return Err(KernelError::InvalidState);
    }
    value(p.drive_amp / den)
}
pub fn oscillator_curve(
    p: &OscillatorConfig,
    min: f64,
    max: f64,
    omega: &mut [f64],
    amplitude: &mut [f64],
) -> Result<(), KernelError> {
    oscillator_config(p)?;
    finite(&[min, max])?;
    if omega.len() < 2 || omega.len() > u32::MAX as usize {
        return Err(KernelError::InvalidDimensions);
    }
    if omega.len() != amplitude.len() {
        return Err(KernelError::BufferLength);
    }
    if min < 0. || max <= min {
        return Err(KernelError::InvalidCoefficient);
    }
    let n = omega.len();
    for i in 0..n {
        let w = min + ((max - min) * i as f64) / (n - 1) as f64;
        omega[i] = w;
        amplitude[i] = oscillator_amplitude(p, w)?;
    }
    Ok(())
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct NeuronConfig {
    pub current: f64,
    pub dt: f64,
    pub pulse_steps: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct NeuronState {
    pub v: f64,
    pub w: f64,
}
fn neuron_config(p: &NeuronConfig) -> Result<(), KernelError> {
    finite(&[p.current, p.pulse_steps])?;
    dt(p.dt)?;
    if p.pulse_steps < 0.
        || p.pulse_steps > u32::MAX as f64
        || p.pulse_steps != p.pulse_steps as u32 as f64
    {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(())
}
// FHN now advances with the shared classical RK4 step (was forward Euler);
// dt, pulse-window injection and the upward-crossing flag are unchanged.
fn neuron_inner(s: NeuronState, current: f64, h: f64) -> Result<NeuronState, KernelError> {
    let [v, w] = rk4([s.v, s.w], h, |v, w| {
        [
            v - (v * v * v) / 3. - w + current,
            0.08 * (v + 0.7 - 0.8 * w),
        ]
    })?;
    Ok(NeuronState { v, w })
}
pub fn neuron_step(s: NeuronState, p: &NeuronConfig) -> Result<NeuronState, KernelError> {
    neuron_config(p)?;
    neuron_inner(s, p.current, p.dt)
}
pub fn advance_neuron(
    p: &NeuronConfig,
    s: &mut NeuronState,
    pulses: &[u32],
    start_step: usize,
    out: &mut [f64],
    upward: &mut [u8],
) -> Result<(), KernelError> {
    neuron_config(p)?;
    count(start_step, out.len())?;
    finite(&[s.v, s.w])?;
    if out.len() != upward.len() {
        return Err(KernelError::BufferLength);
    }
    if pulses.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(KernelError::InvalidCoefficient);
    }
    for (offset, slot) in out.iter_mut().enumerate() {
        let step = (start_step + offset) as u64;
        let active = pulses
            .iter()
            .any(|&start| step >= start as u64 && step < start as u64 + p.pulse_steps as u64);
        let next = neuron_inner(*s, if active { p.current } else { 0. }, p.dt)?;
        upward[offset] = u8::from(s.v < 0. && next.v >= 0.);
        *s = next;
        *slot = s.v;
    }
    Ok(())
}
pub fn peak(values: &[f64]) -> Result<f64, KernelError> {
    if values.is_empty() {
        return Err(KernelError::InvalidDimensions);
    }
    finite(values)?;
    let mut out = values[0];
    for &v in &values[1..] {
        if v > out {
            out = v;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    #[test]
    fn bounded_trigonometry_and_hypot_match_std() {
        for i in -4096..=4096 {
            let x = i as f64 * 64.;
            let (s, c) = sin_cos(x).unwrap();
            assert!((s - x.sin()).abs() < 7e-16, "sin {x}");
            assert!((c - x.cos()).abs() < 7e-16, "cos {x}");
        }
        for x in [
            0.,
            -0.,
            1e-300,
            0.5,
            core::f64::consts::FRAC_PI_2,
            core::f64::consts::PI,
            261_000.123,
        ] {
            let (s, c) = sin_cos(x).unwrap();
            assert!((s - x.sin()).abs() < 7e-16);
            assert!((c - x.cos()).abs() < 7e-16);
        }
        for (x, y) in [(3_f64, 4.), (1e200, 1e200), (1e-200, 2e-200), (0., 0.)] {
            let expected = x.hypot(y);
            assert!((hypot(x, y).unwrap() - expected).abs() <= 3. * f64::EPSILON * expected);
        }
        assert!(sin_cos(262_145.).is_ok());
        assert!(sin_cos(f64::NAN).is_err());
        assert!(hypot(f64::MAX, f64::MAX).is_err());
    }
}
