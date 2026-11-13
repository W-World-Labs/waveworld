//! Periodic square-lattice Ising model, J=kB=1, zero external field.
//! Persistent integer spins/RNG and f64 observations; no allocation or libm.
use crate::{exp_negative, sqrt, KernelError};

#[derive(Clone, Copy, Debug)]
pub struct IsingConfig {
    pub size: usize,
    pub temperature: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct IsingMoments {
    pub n: f64,
    pub m: f64,
    pub abs_m: f64,
    pub m2: f64,
    pub e: f64,
    pub e2: f64,
}

#[derive(Clone, Copy, Debug)]
pub enum IsingAlgorithm {
    Metropolis,
    Heatbath,
}

#[derive(Clone, Copy, Debug)]
pub struct IsingPoint {
    pub temperature: f64,
    pub samples: u64,
    pub mean_m: Option<f64>,
    pub mean_abs_m: Option<f64>,
    pub mean_energy: Option<f64>,
    pub specific_heat: Option<f64>,
    pub susceptibility: Option<f64>,
    pub reference: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct IsingReadout {
    pub magnetization: f64,
    pub energy: f64,
    pub point: IsingPoint,
}

impl IsingConfig {
    pub fn cells(&self) -> Result<usize, KernelError> {
        let n = self
            .size
            .checked_mul(self.size)
            .ok_or(KernelError::InvalidDimensions)?;
        if self.size < 2 || n > i32::MAX as usize {
            return Err(KernelError::InvalidDimensions);
        }
        if !self.temperature.is_finite() || self.temperature <= 0. {
            return Err(KernelError::InvalidCoefficient);
        }
        Ok(n)
    }
    fn validate(&self, spins: &[i8]) -> Result<usize, KernelError> {
        let n = self.cells()?;
        if spins.len() != n {
            return Err(KernelError::BufferLength);
        }
        if spins.iter().any(|&s| s != -1 && s != 1) {
            return Err(KernelError::InvalidState);
        }
        Ok(n)
    }
}

impl IsingMoments {
    fn validate(&self) -> Result<(), KernelError> {
        if [self.n, self.m, self.abs_m, self.m2, self.e, self.e2]
            .iter()
            .any(|v| !v.is_finite())
        {
            return Err(KernelError::NonFiniteValue);
        }
        if self.n < 0.
            || self.n > 9_007_199_254_740_991.
            || self.n != self.n as u64 as f64
            || self.m.abs() > self.n
            || self.abs_m < 0.
            || self.abs_m > self.n
            || self.m2 < 0.
            || self.m2 > self.n
            || self.e.abs() > 2. * self.n
            || self.e2 < 0.
            || self.e2 > 4. * self.n
        {
            return Err(KernelError::InvalidState);
        }
        Ok(())
    }
}

/// Mulberry32, including its modulo-2^32 state and exact draw order.
pub fn next_random(state: &mut u32) -> f64 {
    *state = state.wrapping_add(0x6d2b79f5);
    let mut t = (*state ^ (*state >> 15)).wrapping_mul(1 | *state);
    t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
    (t ^ (t >> 14)) as f64 / 4_294_967_296.
}

pub fn init_ising(
    c: &IsingConfig,
    spins: &mut [i8],
    rng: &mut u32,
    seed: u32,
    hot: bool,
) -> Result<(), KernelError> {
    if spins.len() != c.cells()? {
        return Err(KernelError::BufferLength);
    }
    *rng = seed;
    for spin in spins {
        *spin = if hot && next_random(rng) < 0.5 { -1 } else { 1 };
    }
    Ok(())
}

fn neighbors(spins: &[i8], l: usize, i: usize) -> i32 {
    let x = i % l;
    let y = i / l;
    let xm = if x == 0 { l - 1 } else { x - 1 };
    let xp = if x + 1 == l { 0 } else { x + 1 };
    let ym = if y == 0 { l - 1 } else { y - 1 };
    let yp = if y + 1 == l { 0 } else { y + 1 };
    spins[y * l + xm] as i32
        + spins[y * l + xp] as i32
        + spins[ym * l + x] as i32
        + spins[yp * l + x] as i32
}

pub fn delta_energy(c: &IsingConfig, spins: &[i8], index: usize) -> Result<f64, KernelError> {
    if index >= c.validate(spins)? {
        return Err(KernelError::InvalidDimensions);
    }
    Ok((2 * spins[index] as i32 * neighbors(spins, c.size, index)) as f64)
}

fn boltzmann(energy: f64, t: f64) -> Result<f64, KernelError> {
    if t <= energy / 746. {
        Ok(0.)
    } else {
        exp_negative(energy / t)
    }
}

fn observations(spins: &[i8], l: usize) -> (f64, f64) {
    let mut m = 0_i64;
    let mut energy = 0_i64;
    for y in 0..l {
        for x in 0..l {
            let i = y * l + x;
            let right = y * l + if x + 1 == l { 0 } else { x + 1 };
            let up = (if y + 1 == l { 0 } else { y + 1 }) * l + x;
            m += spins[i] as i64;
            energy -= spins[i] as i64 * (spins[right] as i64 + spins[up] as i64);
        }
    }
    (
        m as f64 / spins.len() as f64,
        energy as f64 / spins.len() as f64,
    )
}

/// One sweep is exactly size² random-site attempts. Reset precedes the sweep;
/// sampling follows it. A numerical error invalidates this step's output.
pub fn sweep_ising(
    c: &IsingConfig,
    spins: &mut [i8],
    rng: &mut u32,
    mut moments: Option<&mut IsingMoments>,
    algorithm: IsingAlgorithm,
    sample: bool,
    reset: bool,
) -> Result<(), KernelError> {
    let n = c.validate(spins)?;
    if (sample || reset) && moments.is_none() {
        return Err(KernelError::InvalidState);
    }
    if let Some(m) = moments.as_deref() {
        m.validate()?;
        if sample && !reset && m.n == 9_007_199_254_740_991. {
            return Err(KernelError::InvalidState);
        }
    }
    let e4 = boltzmann(4., c.temperature)?;
    let e8 = boltzmann(8., c.temperature)?;
    let probabilities = [
        e8 / (1. + e8),
        e4 / (1. + e4),
        0.5,
        1. / (1. + e4),
        1. / (1. + e8),
    ];
    if reset {
        *moments.as_deref_mut().ok_or(KernelError::InvalidState)? = IsingMoments::default();
    }
    for _ in 0..n {
        let i = (next_random(rng) * n as f64) as usize;
        let h = neighbors(spins, c.size, i);
        match algorithm {
            IsingAlgorithm::Metropolis => {
                let de = 2 * spins[i] as i32 * h;
                if de <= 0 || next_random(rng) < if de == 4 { e4 } else { e8 } {
                    spins[i] = -spins[i];
                }
            }
            IsingAlgorithm::Heatbath => {
                spins[i] = if next_random(rng) < probabilities[((h + 4) / 2) as usize] {
                    1
                } else {
                    -1
                }
            }
        }
    }
    if sample {
        let (m, e) = observations(spins, c.size);
        let s = moments.ok_or(KernelError::InvalidState)?;
        s.n += 1.;
        s.m += m;
        s.abs_m += m.abs();
        s.m2 += m * m;
        s.e += e;
        s.e2 += e * e;
        s.validate()?;
    }
    Ok(())
}

/// Correctly rounded 2/ln(1+sqrt(2)); no platform-specific logarithm.
pub fn onsager_tc() -> f64 {
    2.269_185_314_213_022
}

pub fn onsager_magnetization(t: f64) -> Result<f64, KernelError> {
    if !t.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    if t <= 0. || t < 0.1 {
        return Ok(1.);
    }
    if t >= onsager_tc() {
        return Ok(0.);
    }
    let delta = 2. * (onsager_tc() - t) / (t * onsager_tc());
    let x = if delta <= 0.5 {
        // Evaluate sinh(ac+delta)-1 without cancellation at the critical point.
        let mut term = delta;
        let mut sinh = delta;
        let mut cosh_minus_one = 0.;
        for n in 2..=18 {
            term *= delta / n as f64;
            if n % 2 == 0 {
                cosh_minus_one += term;
            } else {
                sinh += term;
            }
        }
        let d = cosh_minus_one + core::f64::consts::SQRT_2 * sinh;
        let s = 1. + d;
        d * (4. + d * (6. + d * (4. + d))) / (s * s * s * s)
    } else {
        let e = exp_negative(2. / t)?;
        let s = (1. / e - e) / 2.;
        1. - 1. / (s * s * s * s)
    };
    sqrt(sqrt(sqrt(x)?)?)
}

fn fluctuation(mean: f64, mean2: f64, n: usize, t: f64, heat: bool) -> Result<f64, KernelError> {
    if !mean.is_finite() || !mean2.is_finite() || !t.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    if n == 0 || n > i32::MAX as usize || t <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let variance = mean2 - mean * mean;
    if !variance.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    let v = variance.max(0.) * n as f64 / if heat { t * t } else { t };
    if v.is_finite() {
        Ok(v)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}

pub fn specific_heat(mean: f64, mean2: f64, n: usize, t: f64) -> Result<f64, KernelError> {
    fluctuation(mean, mean2, n, t, true)
}
pub fn susceptibility(mean: f64, mean2: f64, n: usize, t: f64) -> Result<f64, KernelError> {
    fluctuation(mean, mean2, n, t, false)
}

pub fn read_ising(
    c: &IsingConfig,
    spins: &[i8],
    s: &IsingMoments,
) -> Result<IsingReadout, KernelError> {
    let n = c.validate(spins)?;
    s.validate()?;
    let (m, e) = observations(spins, c.size);
    Ok(IsingReadout {
        magnetization: m.abs(),
        energy: e,
        point: IsingPoint {
            temperature: c.temperature,
            samples: s.n as u64,
            mean_m: if s.n > 0. { Some(s.m / s.n) } else { None },
            mean_abs_m: if s.n > 0. { Some(s.abs_m / s.n) } else { None },
            mean_energy: if s.n > 0. { Some(s.e / s.n) } else { None },
            specific_heat: if s.n > 1. {
                Some(specific_heat(s.e / s.n, s.e2 / s.n, n, c.temperature)?)
            } else {
                None
            },
            susceptibility: if s.n > 1. {
                Some(susceptibility(s.m / s.n, s.m2 / s.n, n, c.temperature)?)
            } else {
                None
            },
            reference: onsager_magnetization(c.temperature)?,
        },
    })
}
