//! Allocation-free numerical kernels shared by native and WASM callers.
//!
//! Field precision is defined by each module; the MAC pressure projection uses
//! f64 throughout. Wave and heat retain the addition order of the WaveWorld
//! reference functions. These kernels have not completed engineering CFD validation.
//! Native `parallel` collide, pull stream, and moment finish keep the serial
//! cell-order reductions; WASM stays single-thread.
#![cfg_attr(not(feature = "parallel"), no_std)]

use core::fmt;

pub mod antenna;
pub mod fan_curve;
pub mod faraday;
pub mod fdtd;
pub mod fluid;
pub mod geometry;
pub mod ising;
pub mod laser;
pub mod lbm;
pub mod mac_projection;
pub mod mac_fan;
pub mod mac_fields;
pub mod mac_step;
pub mod mac_thermal;
pub mod md;
pub mod nljd;
pub mod ode;
pub mod optics;
mod phase;
pub mod plane;
pub mod radar;
pub mod sensing;
mod thermal;
pub mod transient;

pub const WAVE_MAX_A: f64 = 0.5;
pub const HEAT_MAX_R: f64 = 0.25;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KernelError {
    InvalidDimensions,
    BufferLength,
    InvalidCoefficient,
    NonFiniteValue,
    InvalidState,
    UnsupportedFeature,
    RayLimitExceeded,
    InvalidSolidTopology,
}

impl fmt::Display for KernelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidDimensions => "invalid grid dimensions",
            Self::BufferLength => "buffer length does not match grid dimensions",
            Self::InvalidCoefficient => "coefficient exceeds the explicit stability bounds",
            Self::NonFiniteValue => "field or update contains a non-finite value",
            Self::InvalidState => {
                "density, velocity, or numerical iteration is outside the admitted range"
            }
            Self::RayLimitExceeded => {
                "optics trace exceeded 20000 processed rays; reduce lasers or splitters"
            }
            Self::UnsupportedFeature => {
                "requested physical feature is not implemented by this kernel"
            }
            Self::InvalidSolidTopology => {
                "solid boundary is empty, open, non-manifold at an edge, or inconsistently oriented; each nonzero-area geometric edge must occur twice in opposite directions"
            }
        })
    }
}

impl core::error::Error for KernelError {}

fn cells(width: usize, height: usize) -> Result<usize, KernelError> {
    if width == 0 || height == 0 {
        return Err(KernelError::InvalidDimensions);
    }
    width
        .checked_mul(height)
        .ok_or(KernelError::InvalidDimensions)
}

fn field_value(value: f64) -> Result<f32, KernelError> {
    let stored = value as f32;
    if stored.is_finite() {
        Ok(stored)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}

/// Advance a square wave field with fixed zero walls and optional hard obstacles.
///
/// Overwrites `previous_next` with the next field. Swap the two buffers only
/// after success. On numerical error the output can be partially written and
/// must be discarded. No allocation, copying, or pointer aliasing is required.
pub fn step_wave(
    current: &[f32],
    previous_next: &mut [f32],
    n: usize,
    a: f64,
    damping: f64,
    obstacles: Option<&[u8]>,
) -> Result<(), KernelError> {
    if n < 3 {
        return Err(KernelError::InvalidDimensions);
    }
    let len = cells(n, n)?;
    if current.len() != len
        || previous_next.len() != len
        || obstacles.is_some_and(|mask| mask.len() != len)
    {
        return Err(KernelError::BufferLength);
    }
    if !(0.0..=WAVE_MAX_A).contains(&a) || !(0.0..=1.0).contains(&damping) {
        return Err(KernelError::InvalidCoefficient);
    }
    for y in 1..n - 1 {
        for x in 1..n - 1 {
            let k = x + y * n;
            let center = current[k] as f64;
            let lap = current[k - 1] as f64
                + current[k + 1] as f64
                + current[k - n] as f64
                + current[k + n] as f64
                - 4.0 * center;
            previous_next[k] =
                field_value((2.0 * center - previous_next[k] as f64 + a * lap) * damping)?;
        }
    }
    previous_next[..n].fill(0.0);
    previous_next[len - n..].fill(0.0);
    for y in 1..n - 1 {
        previous_next[y * n] = 0.0;
        previous_next[y * n + n - 1] = 0.0;
    }
    if let Some(mask) = obstacles {
        for (value, &solid) in previous_next.iter_mut().zip(mask) {
            if solid != 0 {
                *value = 0.0;
            }
        }
    }
    Ok(())
}

/// Advance a rectangular heat field with insulated (zero flux) boundaries.
///
/// `r = alpha * dt / dx^2` must be in `0..=0.25`. The discrete stencil
/// conserves total heat up to `f32` rounding. Buffers must have equal exact grid
/// lengths. On numerical error discard the partially written output.
pub fn step_heat(
    current: &[f32],
    next: &mut [f32],
    width: usize,
    height: usize,
    r: f64,
) -> Result<(), KernelError> {
    let len = cells(width, height)?;
    if current.len() != len || next.len() != len {
        return Err(KernelError::BufferLength);
    }
    if !(0.0..=HEAT_MAX_R).contains(&r) {
        return Err(KernelError::InvalidCoefficient);
    }
    for y in 0..height {
        for x in 0..width {
            let k = x + y * width;
            let c = current[k] as f64;
            let n = if y > 0 { current[k - width] as f64 } else { c };
            let s = if y < height - 1 {
                current[k + width] as f64
            } else {
                c
            };
            let w = if x > 0 { current[k - 1] as f64 } else { c };
            let e = if x < width - 1 {
                current[k + 1] as f64
            } else {
                c
            };
            next[k] = field_value(c + r * (n + s + w + e - 4.0 * c))?;
        }
    }
    Ok(())
}

/// Circular initial deposit in grid coordinates, not a continuous source.
#[derive(Clone, Copy, Debug)]
pub struct Seed {
    pub x: isize,
    pub y: isize,
    pub radius: usize,
    pub amount: f64,
}

/// Add a heat deposit, clipping the circle to the field bounds.
pub fn seed_heat(
    field: &mut [f32],
    width: usize,
    height: usize,
    seed: Seed,
) -> Result<(), KernelError> {
    seed_field(field, width, height, seed, 0)
}

/// Apply the same wave displacement to both time levels (initially at rest).
/// Fixed walls are excluded, matching the WaveWorld wave source convention.
pub fn seed_wave(
    current: &mut [f32],
    previous: &mut [f32],
    n: usize,
    seed: Seed,
) -> Result<(), KernelError> {
    if n < 3 {
        return Err(KernelError::InvalidDimensions);
    }
    if previous.len() != cells(n, n)? {
        return Err(KernelError::BufferLength);
    }
    seed_field(current, n, n, seed, 1)?;
    seed_field(previous, n, n, seed, 1)
}

fn seed_field(
    field: &mut [f32],
    width: usize,
    height: usize,
    seed: Seed,
    wall: usize,
) -> Result<(), KernelError> {
    if field.len() != cells(width, height)? {
        return Err(KernelError::BufferLength);
    }
    if !seed.amount.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    // Walk only actual cells: even a seed radius near usize::MAX is bounded by
    // the field size, with no signed integer subtraction/squaring overflow.
    let radius_squared = (seed.radius as f64) * (seed.radius as f64);
    for y in wall..height - wall {
        for x in wall..width - wall {
            let dx = x as f64 - seed.x as f64;
            let dy = y as f64 - seed.y as f64;
            if dx * dx + dy * dy <= radius_squared {
                let k = x + y * width;
                field[k] = field_value(field[k] as f64 + seed.amount)?;
            }
        }
    }
    Ok(())
}

/// Bounded Newton sqrt for the no_std native/WASM kernel. Exponent scaling
/// handles subnormals. Failure to reach a near-machine-precision fixed point
/// returns an error instead of silently accepting an inaccurate LES viscosity.
pub(crate) fn sqrt(value: f64) -> Result<f64, KernelError> {
    if !value.is_finite() || value < 0.0 {
        return Err(KernelError::NonFiniteValue);
    }
    if value == 0.0 {
        return Ok(0.0);
    }
    let (scaled, factor) = if value < f64::MIN_POSITIVE {
        (value * 18_014_398_509_481_984.0, 1.0 / 134_217_728.0)
    } else {
        (value, 1.0)
    };
    let mut result = f64::from_bits((scaled.to_bits() >> 1) + 0x1ff8_0000_0000_0000);
    for _ in 0..8 {
        let next = 0.5 * result + 0.5 * (scaled / result);
        if !next.is_finite() {
            return Err(KernelError::NonFiniteValue);
        }
        if (next - result).abs() <= 2.0 * f64::EPSILON * next {
            return Ok(next * factor);
        }
        result = next;
    }
    Err(KernelError::InvalidState)
}

// exp(-x) only, for finite x>=0. Reduce to |r|<=ln(2)/2, then sum 18 terms.
// The analytic truncation bound is <3e-26; floating-point rounding dominates.
// Split ln(2) keeps k*ln(2) cancellation accurate through the subnormal range.
pub(crate) fn exp_negative(x: f64) -> Result<f64, KernelError> {
    if !x.is_finite() || x < 0. {
        return Err(KernelError::NonFiniteValue);
    }
    if x >= 746. {
        return Ok(0.); // Below half the smallest f64 subnormal: rounds to zero.
    }
    let scaled = x * core::f64::consts::LOG2_E;
    let whole = scaled as i32;
    let k = whole + i32::from(scaled - whole as f64 >= 0.5);
    let r = (-x + k as f64 * 6.931_471_803_691_238e-1) + k as f64 * 1.908_214_929_270_587_7e-10;
    let mut term = 1.;
    let mut sum = 1.;
    for n in 1..=18 {
        term *= r / n as f64;
        sum += term;
    }
    let result = if k <= 1022 {
        sum * f64::from_bits(((1023 - k) as u64) << 52)
    } else {
        (sum * f64::from_bits(((2045 - k) as u64) << 52)) * f64::MIN_POSITIVE
    };
    if result.is_finite() && result >= 0. {
        Ok(result)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}

/// Deterministic finite binary64 trigonometry. Preserve the existing split pi/2
/// path through 2^18; larger inputs use fixed-point quadrant/remainder reduction.
pub(crate) fn sin_cos(angle: f64) -> Result<(f64, f64), KernelError> {
    if !angle.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    if angle.abs() > 262_144. {
        return Ok(phase::large_sin_cos(angle));
    }
    let scaled = angle * core::f64::consts::FRAC_2_PI;
    let quadrant = if scaled >= 0. {
        (scaled + 0.5) as i64
    } else {
        (scaled - 0.5) as i64
    };
    let r = (angle - quadrant as f64 * 1.570_796_326_734_125_6)
        - quadrant as f64 * 6.077_100_506_506_192e-11;
    Ok(map_quadrant(sin_cos_reduced(r), quadrant.rem_euclid(4)))
}
fn sin_cos_reduced(r: f64) -> (f64, f64) {
    let r2 = r * r;
    let mut s = r;
    let mut c = 1.;
    let mut st = r;
    let mut ct = 1.;
    for k in 1..=12 {
        st *= -r2 / ((2 * k) * (2 * k + 1)) as f64;
        ct *= -r2 / ((2 * k - 1) * (2 * k)) as f64;
        s += st;
        c += ct;
    }
    (s, c)
}
fn map_quadrant((s, c): (f64, f64), quadrant: i64) -> (f64, f64) {
    match quadrant {
        0 => (s, c),
        1 => (c, -s),
        2 => (-s, -c),
        _ => (-c, s),
    }
}
pub(crate) fn hypot(x: f64, y: f64) -> Result<f64, KernelError> {
    if !x.is_finite() || !y.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    let max = x.abs().max(y.abs());
    if max == 0. {
        return Ok(0.);
    }
    let r = x.abs().min(y.abs()) / max;
    let result = max * sqrt(1. + r * r)?;
    if result.is_finite() {
        Ok(result)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}
