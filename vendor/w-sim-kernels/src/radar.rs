//! 2D TMz Yee FDTD radar teaching scene and separate free-space range helpers.
//!
//! The caller-owned buffers stay exactly the ones the WASM ABI passes:
//! `field0` holds Ez (f32, what the scope renders), `field1` packs Hx and Hy
//! as two fixed-point i16 lanes per f32 slot, `mask` is the 0/1 target
//! occupancy map and `traces` keeps the four probe rings. Material contrast
//! comes from the static target table: masked cells inside a target use that
//! target's permittivity or PEC; masked cells elsewhere are generic PEC
//! obstacles, matching the previous hard-reflector semantics.
use crate::{exp_negative, field_value, sin_cos, sqrt, KernelError};
pub const N: usize = 200;
pub const CELLS: usize = N * N;
pub const BUFFER: usize = 256;
pub const TX: [usize; 2] = [24, 100];
pub const TARGETS: [[usize; 4]; 3] = [
    [120, 30, 128, 170],
    [150, 50, 162, 66],
    [158, 130, 174, 150],
];
/// Per-target material: the wall and the Si slab are dielectric inclusions
/// (relative permittivity 4 and 12), the appliance is a perfect electric
/// conductor. `None` pins Ez to zero inside the target.
const TARGET_EPS: [Option<f64>; 3] = [Some(4.), Some(12.), None];
/// Courant number c·dt/dx in reduced units; the 2D CFL bound for the fastest
/// medium present (air, εr = 1) is COURANT·√2 ≤ 1.
pub const COURANT: f64 = 0.5;
/// Uniform reduced relative permeability.
const MU_R: f64 = 1.;
/// Quadratic sponge absorbing edge: multiplier ramp over the outer cells.
const SPONGE: usize = 20;
const SPONGE_MAX: f64 = 0.1;
/// Soft-source pulse: Gaussian envelope g(step) = PEAK·exp(-(step-T0)²/2σ²).
const PULSE_PEAK: f64 = 6.;
const PULSE_T0: f64 = 9.;
const PULSE_SIGMA: f64 = 2.;
/// CW soft source: amplitude and angular frequency per step (period ≈ 47.6
/// steps, wavelength ≈ 24 cells at COURANT = 0.5).
const CW_AMP: f64 = 3.;
const CW_OMEGA: f64 = 0.06 * 0.35 * 2. * core::f64::consts::PI;
/// Fixed-point scale for the packed Hx/Hy lanes; range ±8 before saturation.
const H_SCALE: f64 = 4096.;
pub const NO_PROBE: u32 = u32::MAX;
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct RadarConfig {
    pub total_steps: u32,
    pub mode: u32,
    pub probes: [u32; 4],
    pub reserved: [u32; 2],
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct RadarState {
    pub completed: u32,
    /// Kept for ABI layout; Ez always lives in `field0`, so this stays 0.
    pub current: u32,
    pub lengths: [u32; 4],
    pub heads: [u32; 4],
}
pub struct RadarBuffers<'a> {
    /// Ez field, f32 per cell.
    pub field0: &'a mut [f32],
    /// Packed Hx/Hy: each slot is two i16 fixed-point lanes (high = Hx, low = Hy).
    pub field1: &'a mut [f32],
    /// 0/1 obstacle occupancy; material is resolved through `TARGETS`.
    pub mask: &'a mut [u8],
    pub traces: &'a mut [f64],
}
#[derive(Clone, Copy, Debug)]
pub struct RadarChannel {
    pub v: f64,
    pub pp: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct RadarRangeParams {
    pub pt: f64,
    pub gt: f64,
    pub gr: f64,
    pub lambda: f64,
    pub sigma: f64,
    pub s_min: f64,
}
fn value(v: f64) -> Result<f64, KernelError> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}
fn config(p: &RadarConfig) -> Result<(), KernelError> {
    if !(1..=2000).contains(&p.total_steps)
        || p.mode > 1
        || p.reserved != [0; 2]
        || p.probes.iter().any(|&x| x != NO_PROBE && x >= CELLS as u32)
    {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(())
}
fn lengths(b: &RadarBuffers<'_>) -> Result<(), KernelError> {
    if b.field0.len() != CELLS
        || b.field1.len() != CELLS
        || b.mask.len() != CELLS
        || b.traces.len() != 4 * BUFFER
    {
        return Err(KernelError::BufferLength);
    }
    Ok(())
}
fn state(s: &RadarState, traces: &[f64]) -> Result<(), KernelError> {
    if traces.len() != 4 * BUFFER {
        return Err(KernelError::BufferLength);
    }
    if s.current > 1 {
        return Err(KernelError::InvalidState);
    }
    for ch in 0..4 {
        let len = s.lengths[ch] as usize;
        let head = s.heads[ch] as usize;
        if len > BUFFER || head >= BUFFER || (len == 0 && head != 0) {
            return Err(KernelError::InvalidState);
        }
        for i in 0..len {
            value(traces[ch * BUFFER + (head + i) % BUFFER])?;
        }
    }
    Ok(())
}
/// Relative permittivity at a masked cell, or `None` for PEC. Cells inside a
/// scene target take that target's material; other masked cells are generic
/// hard obstacles (PEC), preserving the previous fixed-zero behaviour.
fn target_eps(x: usize, y: usize) -> Option<f64> {
    for (i, [x0, y0, x1, y1]) in TARGETS.iter().enumerate() {
        if x >= *x0 && x <= *x1 && y >= *y0 && y <= *y1 {
            return TARGET_EPS[i];
        }
    }
    None
}
/// Pack two H components into one f32 slot as i16 fixed-point lanes.
/// `as i16` saturates at ±32767, so |H| above 8 clips instead of wrapping;
/// non-finite input is still a hard error, matching `field_value`.
fn pack_h(hx: f64, hy: f64) -> Result<f32, KernelError> {
    if !hx.is_finite() || !hy.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    let hi = ((hx * H_SCALE) as i16) as u16 as u32;
    let lo = ((hy * H_SCALE) as i16) as u16 as u32;
    Ok(f32::from_bits((hi << 16) | lo))
}
fn unpack_h(v: f32) -> (f64, f64) {
    let bits = v.to_bits();
    (
        ((bits >> 16) as u16) as i16 as f64 / H_SCALE,
        (bits as u16) as i16 as f64 / H_SCALE,
    )
}
pub fn radar_mask(mask: &mut [u8]) -> Result<(), KernelError> {
    if mask.len() != CELLS {
        return Err(KernelError::BufferLength);
    }
    mask.fill(0);
    for [x0, y0, x1, y1] in TARGETS {
        for y in y0..=y1 {
            for x in x0..=x1 {
                mask[x + y * N] = 1;
            }
        }
    }
    Ok(())
}
pub fn init_radar(
    p: &RadarConfig,
    s: &mut RadarState,
    b: &mut RadarBuffers<'_>,
) -> Result<(), KernelError> {
    config(p)?;
    lengths(b)?;
    radar_mask(b.mask)?;
    b.field0.fill(0.);
    b.field1.fill(0.);
    b.traces.fill(0.);
    *s = RadarState::default();
    Ok(())
}
/// One TMz Yee step: H half-step, E full-step with per-cell permittivity,
/// PEC pinning, quadratic sponge edge, then the soft source at TX.
/// On arithmetic failure the partially updated state must be discarded.
fn step_radar(b: &mut RadarBuffers<'_>, step: u32, mode: u32) -> Result<(), KernelError> {
    let h_coef = COURANT / MU_R;
    for j in 0..N {
        for i in 0..N {
            let k = i + j * N;
            let (hx, hy) = unpack_h(b.field1[k]);
            let dy = if j + 1 < N {
                b.field0[k + N] as f64 - b.field0[k] as f64
            } else {
                0.
            };
            let dx = if i + 1 < N {
                b.field0[k + 1] as f64 - b.field0[k] as f64
            } else {
                0.
            };
            b.field1[k] = pack_h(hx - h_coef * dy, hy + h_coef * dx)?;
        }
    }
    for j in 1..N - 1 {
        for i in 1..N - 1 {
            let k = i + j * N;
            let eps = if b.mask[k] == 0 {
                1.
            } else {
                match target_eps(i, j) {
                    Some(e) => e,
                    None => continue,
                }
            };
            let (_, hy_w) = unpack_h(b.field1[k - 1]);
            let (hx_s, _) = unpack_h(b.field1[k - N]);
            let (hx, hy) = unpack_h(b.field1[k]);
            let curl = (hy - hy_w) - (hx - hx_s);
            b.field0[k] = field_value(b.field0[k] as f64 + (COURANT / eps) * curl)?;
        }
    }
    for j in 1..N - 1 {
        for i in 1..N - 1 {
            let k = i + j * N;
            if b.mask[k] != 0 && target_eps(i, j).is_none() {
                b.field0[k] = 0.;
            }
        }
    }
    for j in 0..N {
        for i in 0..N {
            let edge = i.min(j).min(N - 1 - i).min(N - 1 - j);
            if edge >= SPONGE {
                continue;
            }
            let t = (SPONGE - edge) as f64 / SPONGE as f64;
            let f = 1. - SPONGE_MAX * t * t;
            let k = i + j * N;
            b.field0[k] = field_value(b.field0[k] as f64 * f)?;
            let (hx, hy) = unpack_h(b.field1[k]);
            b.field1[k] = pack_h(hx * f, hy * f)?;
        }
    }
    let amplitude = if mode == 1 {
        CW_AMP * sin_cos(step as f64 * CW_OMEGA)?.0
    } else {
        let off = step as f64 - PULSE_T0;
        PULSE_PEAK * exp_negative(off * off / (2. * PULSE_SIGMA * PULSE_SIGMA))?
    };
    let tx = TX[0] + TX[1] * N;
    b.field0[tx] = field_value(b.field0[tx] as f64 + amplitude)?;
    Ok(())
}
/// Advance exactly count steps, preserving sample cadence across chunk edges.
/// Heads index the oldest sample. On error discard this partially advanced run.
pub fn advance_radar(
    p: &RadarConfig,
    s: &mut RadarState,
    b: &mut RadarBuffers<'_>,
    count: u32,
) -> Result<(), KernelError> {
    config(p)?;
    lengths(b)?;
    state(s, b.traces)?;
    if count == 0 || count > 64 {
        return Err(KernelError::InvalidDimensions);
    }
    if s.completed
        .checked_add(count)
        .is_none_or(|end| end > p.total_steps)
    {
        return Err(KernelError::InvalidState);
    }
    if p.probes
        .iter()
        .enumerate()
        .any(|(ch, &v)| v == NO_PROBE && s.lengths[ch] != 0)
    {
        return Err(KernelError::InvalidState);
    }
    if b.field0.iter().any(|v| !v.is_finite()) {
        return Err(KernelError::NonFiniteValue);
    }
    // `field1` stores i16 lanes: every bit pattern decodes to a finite value.
    if b.mask.iter().any(|&v| v > 1) {
        return Err(KernelError::InvalidCoefficient);
    }
    for _ in 0..count {
        step_radar(b, s.completed, p.mode)?;
        s.completed += 1;
        if !s.completed.is_multiple_of(2) && s.completed != p.total_steps {
            continue;
        }
        for ch in 0..4 {
            if p.probes[ch] == NO_PROBE {
                continue;
            }
            let len = s.lengths[ch] as usize;
            let head = s.heads[ch] as usize;
            let at = (head + len) % BUFFER;
            b.traces[ch * BUFFER + at] = b.field0[p.probes[ch] as usize] as f64;
            if len == BUFFER {
                s.heads[ch] = ((head + 1) % BUFFER) as u32;
            } else {
                s.lengths[ch] += 1;
            }
        }
    }
    Ok(())
}
/// Sampled TMz energy diagnostic: ½ Σ (εr Ez² + μr (Hx² + Hy²)), with E and H
/// summed at their stored time levels, matching `fdtd::energy_fdtd`.
pub fn radar_field_energy(
    field0: &[f32],
    field1: &[f32],
    mask: &[u8],
) -> Result<f64, KernelError> {
    if field0.len() != CELLS || field1.len() != CELLS || mask.len() != CELLS {
        return Err(KernelError::BufferLength);
    }
    if field0.iter().any(|v| !v.is_finite()) {
        return Err(KernelError::NonFiniteValue);
    }
    let mut sum = 0.;
    for j in 0..N {
        for i in 0..N {
            let k = i + j * N;
            let eps = if mask[k] == 0 {
                1.
            } else {
                target_eps(i, j).unwrap_or(1.)
            };
            let e = field0[k] as f64;
            let (hx, hy) = unpack_h(field1[k]);
            sum += eps * e * e + MU_R * (hx * hx + hy * hy);
        }
    }
    let energy = 0.5 * sum;
    if !energy.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    Ok(energy)
}
pub fn read_radar(
    s: &RadarState,
    traces: &[f64],
) -> Result<[Option<RadarChannel>; 4], KernelError> {
    state(s, traces)?;
    let mut result = [None; 4];
    for (ch, out) in result.iter_mut().enumerate() {
        let len = s.lengths[ch] as usize;
        if len == 0 {
            continue;
        }
        let head = s.heads[ch] as usize;
        let mut lo = traces[ch * BUFFER + head];
        let mut hi = lo;
        for i in 1..len {
            let v = traces[ch * BUFFER + (head + i) % BUFFER];
            lo = lo.min(v);
            hi = hi.max(v);
        }
        *out = Some(RadarChannel {
            v: traces[ch * BUFFER + (head + len - 1) % BUFFER],
            pp: if hi == lo { 0. } else { value(hi - lo)? },
        });
    }
    Ok(result)
}
fn numerator(p: &RadarRangeParams) -> Result<f64, KernelError> {
    if [p.pt, p.gt, p.gr, p.lambda, p.sigma]
        .iter()
        .any(|v| !v.is_finite() || *v <= 0.)
    {
        return Err(KernelError::InvalidCoefficient);
    }
    value(p.pt * p.gt * p.gr * p.lambda * p.lambda * p.sigma)
}
pub fn radar_max_range(p: &RadarRangeParams) -> Result<f64, KernelError> {
    if !p.s_min.is_finite() || p.s_min <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let num = numerator(p)?;
    let f = 4. * core::f64::consts::PI;
    let den = value((f * f * f) * p.s_min)?;
    sqrt(sqrt(value(num / den)?)?)
}
pub fn radar_received_power(p: &RadarRangeParams, range: f64) -> Result<f64, KernelError> {
    if !range.is_finite() || range <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let num = numerator(p)?;
    let f = 4. * core::f64::consts::PI;
    let r2 = value(range * range)?;
    let den = value((f * f * f) * (r2 * r2))?;
    value(num / den)
}
pub fn radar_wavelength(frequency: f64) -> Result<f64, KernelError> {
    if !frequency.is_finite() || frequency <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    value(crate::plane::C0 / frequency)
}
pub fn radar_power_ratio_double_range() -> f64 {
    1. / 16.
}
