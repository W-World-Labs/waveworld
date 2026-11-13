//! RC/RL first-order transients, deterministic FP64 analytic and RK4 helpers.
use crate::{exp_negative, KernelError};

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct FirstOrderWeights {
    pub decay: f64,
    pub settling_fraction: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct FirstOrderConfig {
    pub voltage: f64,
    pub resistance: f64,
    pub capacitance: f64,
    pub dt: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct TransientConfig {
    pub mode: u32,
    pub reserved: u32,
    pub v0: f64,
    pub r: f64,
    pub c: f64,
    pub l: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct TransientReadout {
    pub tau: f64,
    pub y_max: f64,
    pub steady: f64,
}

fn finite(x: f64) -> Result<f64, KernelError> {
    if x.is_finite() {
        Ok(x)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}
fn positive(x: f64) -> Result<f64, KernelError> {
    if x.is_finite() && x > 0. {
        Ok(x)
    } else {
        Err(KernelError::InvalidCoefficient)
    }
}

pub fn time_constant_rc(r: f64, c: f64) -> Result<f64, KernelError> {
    positive(r)?;
    positive(c)?;
    positive(finite(r * c)?)
}
pub fn time_constant_rl(l: f64, r: f64) -> Result<f64, KernelError> {
    positive(l)?;
    positive(r)?;
    positive(finite(l / r)?)
}

/// q=1-exp(-time/tau) is evaluated without subtracting near-equal numbers.
/// The large-ratio branch is exponential underflow to exact (0,1), including
/// finite positive time/tau whose quotient overflows. No time is altered.
pub fn first_order_weights(time: f64, tau: f64) -> Result<FirstOrderWeights, KernelError> {
    positive(tau)?;
    if !time.is_finite() || time < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let ratio = time / tau;
    if ratio >= 746. {
        return Ok(FirstOrderWeights {
            decay: 0.,
            settling_fraction: 1.,
        });
    }
    let decay = exp_negative(ratio)?;
    let q = if ratio <= 1. {
        let mut tail = 1.;
        for k in (2..=24).rev() {
            tail = 1. - (ratio / k as f64) * tail;
        }
        ratio * tail
    } else {
        1. - decay
    };
    Ok(FirstOrderWeights {
        decay,
        settling_fraction: q,
    })
}

impl FirstOrderWeights {
    /// Stable equivalent of decay*previous+q*target, exact at equal targets.
    pub(crate) fn sample(self, previous: f64, target: f64) -> Result<f64, KernelError> {
        finite(previous)?;
        finite(target)?;
        finite(if self.settling_fraction <= 0.5 {
            previous + self.settling_fraction * finite(target - previous)?
        } else {
            target + self.decay * finite(previous - target)?
        })
    }
}

pub fn rc_charge(t: f64, v0: f64, r: f64, c: f64) -> Result<f64, KernelError> {
    finite(v0)?;
    finite(v0 * first_order_weights(t, time_constant_rc(r, c)?)?.settling_fraction)
}
pub fn rc_discharge(t: f64, v0: f64, r: f64, c: f64) -> Result<f64, KernelError> {
    finite(v0)?;
    finite(v0 * first_order_weights(t, time_constant_rc(r, c)?)?.decay)
}
pub fn rl_current(t: f64, v0: f64, r: f64, l: f64) -> Result<f64, KernelError> {
    finite(v0)?;
    let tau = time_constant_rl(l, r)?;
    finite(finite(v0 / r)? * first_order_weights(t, tau)?.settling_fraction)
}

pub fn first_order_step(p: &FirstOrderConfig, state: &mut f64) -> Result<(), KernelError> {
    let tau = time_constant_rc(p.resistance, p.capacitance)?;
    positive(p.dt)?;
    finite(p.voltage)?;
    finite(*state)?;
    let v = *state;
    let deriv = |x: f64| -> Result<f64, KernelError> { finite((p.voltage - finite(x)?) / tau) };
    let k1 = deriv(v)?;
    let k2 = deriv(v + (p.dt / 2.) * k1)?;
    let k3 = deriv(v + (p.dt / 2.) * k2)?;
    let k4 = deriv(v + p.dt * k3)?;
    *state = finite(v + (p.dt / 6.) * (k1 + 2. * k2 + 2. * k3 + k4))?;
    Ok(())
}
pub fn first_order_advance(
    p: &FirstOrderConfig,
    state: &mut f64,
    count: u32,
) -> Result<(), KernelError> {
    if count == 0 || count > 65_536 {
        return Err(KernelError::InvalidDimensions);
    }
    for _ in 0..count {
        first_order_step(p, state)?;
    }
    Ok(())
}
pub fn transient_result(
    p: &TransientConfig,
    values: &mut [f64],
) -> Result<TransientReadout, KernelError> {
    if values.len() != 241 {
        return Err(KernelError::BufferLength);
    }
    if p.mode > 2 || p.reserved != 0 {
        return Err(KernelError::InvalidCoefficient);
    }
    finite(p.v0)?;
    positive(p.r)?;
    positive(p.c)?;
    positive(p.l)?;
    let tau = if p.mode == 2 {
        time_constant_rl(p.l, p.r)?
    } else {
        time_constant_rc(p.r, p.c)?
    };
    let y_max = finite(if p.mode == 2 { p.v0 / p.r } else { p.v0 })?;
    for (i, value) in values.iter_mut().enumerate() {
        let t = finite(finite(5. * tau)? * i as f64)? / 240.;
        let weights = first_order_weights(t, tau)?;
        *value = finite(
            y_max
                * if p.mode == 1 {
                    weights.decay
                } else {
                    weights.settling_fraction
                },
        )?;
    }
    Ok(TransientReadout {
        tau,
        y_max,
        steady: if p.mode == 1 { 0. } else { y_max },
    })
}
