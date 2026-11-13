//! Homogeneous LJ MD and heterogeneous LJ + screened Coulomb particles.
//! Prepared states/properties are supplied by the product; no RNG or force-field plugins.
//! Works in 2D and 3D (`MdConfig::dim`); pair work uses an order-preserving
//! cell list so every accepted pair is replayed in the all-pairs (i, j)
//! sequence and stored f32 force bits stay identical.
use crate::{exp_negative, field_value, sqrt, KernelError};
use core::cell::UnsafeCell;
use core::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Copy, Debug)]
pub struct MdConfig {
    pub n: usize,
    pub dim: usize,
    pub dt: f64,
    pub rc: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct MdScalars {
    pub box_l: f64,
    pub potential: f64,
    pub virial: f64,
    pub last_temperature: f64,
}
pub struct MdBuffers<'a> {
    pub pos: &'a mut [f32],
    pub vel: &'a mut [f32],
    pub force: &'a mut [f32],
    pub unwrapped: &'a mut [f32],
}
#[derive(Clone, Copy, Debug)]
pub struct MdBath {
    pub target_temperature: Option<f64>,
    pub target_pressure: Option<f64>,
    pub tau_p: f64,
    pub kappa_t: f64,
    pub max_scale: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct ForceStats {
    pub potential: f64,
    pub virial: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct MdObservables {
    pub temperature: f64,
    pub kinetic: f64,
    pub potential: f64,
    pub total: f64,
    pub pressure: f64,
    pub msd: f64,
    pub box_l: f64,
    pub volume: f64,
    pub density: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct RdfStats {
    pub r_max: f64,
    pub pair_count: u64,
}
#[derive(Clone, Copy, Debug)]
pub struct DiffusionResult {
    pub diffusion: f64,
    pub slope: f64,
    pub intercept: f64,
    pub r2: f64,
    pub n_fit: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct ScreeningParams {
    pub eps_r: f64,
    pub lambda_d: f64,
    pub k_coulomb: f64,
}
#[derive(Clone, Copy)]
pub struct ParticleProperties<'a> {
    pub charge: &'a [f32],
    pub sigma: &'a [f32],
    pub epsilon: &'a [f32],
}
pub struct ParticleObservables {
    pub md: MdObservables,
    pub total_charge: f64,
}
// Only the two existing product force sources, sharing pair iteration and Verlet.
#[derive(Clone, Copy)]
enum ForceSource<'a> {
    Homogeneous,
    Particles(ParticleProperties<'a>, ScreeningParams),
}
impl ForceSource<'_> {
    fn validate(self, n: usize) -> Result<(), KernelError> {
        if let Self::Particles(p, s) = self {
            fields(n, &[p.charge, p.sigma, p.epsilon])?;
            if p.sigma.iter().any(|&v| v <= 0.)
                || p.epsilon.iter().any(|&v| v < 0.)
                || !s.eps_r.is_finite()
                || !s.lambda_d.is_finite()
                || !s.k_coulomb.is_finite()
                || s.k_coulomb < 0.
            {
                return Err(KernelError::InvalidCoefficient);
            }
        }
        Ok(())
    }
}

impl MdConfig {
    pub fn value_count(&self) -> Result<usize, KernelError> {
        if self.dim != 2 && self.dim != 3 {
            return Err(KernelError::UnsupportedFeature);
        }
        if self.n == 0 {
            return Err(KernelError::InvalidDimensions);
        }
        self.n
            .checked_mul(self.dim)
            .ok_or(KernelError::InvalidDimensions)
    }
    fn validate(&self, box_l: f64) -> Result<usize, KernelError> {
        let len = self.value_count()?;
        if !box_l.is_finite()
            || box_l <= 0.
            || !self.rc.is_finite()
            || self.rc <= 0.
            || !self.dt.is_finite()
            || self.dt <= 0.
        {
            return Err(KernelError::InvalidCoefficient);
        }
        let rc2 = self.rc * self.rc;
        if !rc2.is_finite() || rc2 == 0. || !volume(box_l, self.dim)?.is_finite() {
            return Err(KernelError::InvalidCoefficient);
        }
        Ok(len)
    }
}
fn finite(value: f64) -> Result<f64, KernelError> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}
fn fields(len: usize, arrays: &[&[f32]]) -> Result<(), KernelError> {
    for a in arrays {
        if a.len() != len {
            return Err(KernelError::BufferLength);
        }
        if a.iter().any(|v| !v.is_finite()) {
            return Err(KernelError::NonFiniteValue);
        }
    }
    Ok(())
}
fn validate_state(c: &MdConfig, s: &MdScalars, b: &MdBuffers<'_>) -> Result<(), KernelError> {
    let len = c.validate(s.box_l)?;
    fields(len, &[b.pos, b.vel, b.force, b.unwrapped])?;
    if !s.potential.is_finite()
        || !s.virial.is_finite()
        || !s.last_temperature.is_finite()
        || s.last_temperature < 0.
    {
        return Err(KernelError::NonFiniteValue);
    }
    Ok(())
}
fn volume(box_l: f64, dim: usize) -> Result<f64, KernelError> {
    let v = if dim == 2 {
        box_l * box_l
    } else {
        box_l * box_l * box_l
    };
    if !v.is_finite() || v <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(v)
}
// Finite f64 floor, without libm. Values >=2^52 already have integral spacing.
fn floor(value: f64) -> f64 {
    let bits = value.to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32 - 1023;
    if exponent < 0 {
        return if value == 0. {
            value
        } else if value < 0. {
            -1.
        } else {
            0.
        };
    }
    if exponent >= 52 {
        return value;
    }
    let mask = (1u64 << (52 - exponent)) - 1;
    if bits & mask == 0 {
        return value;
    }
    let trunc = f64::from_bits(bits & !mask);
    if value < 0. {
        trunc - 1.
    } else {
        trunc
    }
}
/// JS Math.round tie is toward +infinity, including negative half-box distances.
pub(crate) fn round_js(value: f64) -> f64 {
    if value.abs() >= 4_503_599_627_370_496. {
        return value;
    }
    // Adding 0.5 first can round the predecessor of 0.5 up to 1.0.
    let lower = floor(value);
    let rounded = if value - lower < 0.5 {
        lower
    } else {
        lower + 1.
    };
    if rounded == 0. && value.is_sign_negative() {
        -0.
    } else {
        rounded
    }
}
fn displacement(a: f32, b: f32, box_l: f64) -> Result<f64, KernelError> {
    let d = a as f64 - b as f64;
    let q = finite(d / box_l)?;
    finite(d - box_l * round_js(q))
}
/// Finite deterministic roots needed by batch thermostat (1..4) and barostat (2/3).
/// These are not libm pow: low f64 bits can differ from JavaScript Math.pow.
fn root(value: f64, degree: usize) -> Result<f64, KernelError> {
    if !value.is_finite() || value < 0. {
        return Err(KernelError::NonFiniteValue);
    }
    match degree {
        1 => Ok(value),
        2 => sqrt(value),
        4 => sqrt(sqrt(value)?),
        3 => {
            if value == 0. {
                return Ok(0.);
            }
            let (v, factor) = if value < f64::MIN_POSITIVE {
                (value * 18_014_398_509_481_984., 1. / 262_144.)
            } else {
                (value, 1.)
            };
            let mut x = f64::from_bits(v.to_bits() / 3 + 0x2aa0_0000_0000_0000);
            for _ in 0..16 {
                let next = (2. * x + v / (x * x)) / 3.;
                if !next.is_finite() || next <= 0. {
                    return Err(KernelError::NonFiniteValue);
                }
                if (next - x).abs() <= 3. * f64::EPSILON * next {
                    if (v / (next * next) / next - 1.).abs() > 16. * f64::EPSILON {
                        return Err(KernelError::InvalidState);
                    }
                    return finite(next * factor);
                }
                x = next;
            }
            Err(KernelError::InvalidState)
        }
        _ => Err(KernelError::UnsupportedFeature),
    }
}

fn screened_coulomb(
    r2: f64,
    qi: f64,
    qj: f64,
    s: ScreeningParams,
) -> Result<(f64, f64), KernelError> {
    if s.k_coulomb == 0. {
        return Ok((0., 0.));
    }
    let r2c = r2.max(1e-8);
    let r = sqrt(r2c)?;
    let eps_r = s.eps_r.max(1e-6);
    let lambda = s.lambda_d.max(1e-6);
    let c = finite((s.k_coulomb * qi * qj) / eps_r)?;
    let e = exp_negative(r / lambda)?;
    Ok((
        finite((c * e) / r)?,
        finite(c * e * (1. / (lambda * r2c) + 1. / (r * r2c)))?,
    ))
}

/// Same pair order and per-pair f32 stores as computeForcesGeneric+ljTerm.
/// r² sums unrounded minimum-image displacements; force uses their f32 copies.
pub fn compute_lj_forces(
    c: &MdConfig,
    box_l: f64,
    pos: &[f32],
    force: &mut [f32],
) -> Result<ForceStats, KernelError> {
    compute_forces(c, box_l, pos, force, ForceSource::Homogeneous)
}
pub fn compute_particle_forces(
    c: &MdConfig,
    box_l: f64,
    pos: &[f32],
    force: &mut [f32],
    properties: &ParticleProperties<'_>,
    screening: &ScreeningParams,
) -> Result<ForceStats, KernelError> {
    compute_forces(
        c,
        box_l,
        pos,
        force,
        ForceSource::Particles(*properties, *screening),
    )
}
// === Order-preserving cell list ===
/// Upper bound equals the WasmMd admission bound; next[] is indexed by particle.
const LIST_MAX_N: usize = 65536;
/// head[] bound: >= 40^3, the largest 3D stencil grid (side >= rc) for L <= 100.
const LIST_MAX_CELLS: usize = 65536;
/// Per-centre stencil members before that centre falls back to an all-pairs scan.
const LIST_MAX_CANDIDATES: usize = 4096;
const NO_LINK: u32 = u32::MAX;
/// Linked-list cell scratch living in linear memory (BSS). The ABI has no
/// scratch channel and no_std forbids allocation, so the list is rebuilt here
/// per force call; with a real cut-off the accepted pair set is the same one
/// a Verlet list would walk, only the cell membership is recomputed.
struct CellScratch {
    head: [u32; LIST_MAX_CELLS],
    next: [u32; LIST_MAX_N],
    candidates: [u32; LIST_MAX_CANDIDATES],
}
/// SharedScratch is Sync only because every access runs under ScratchGuard's
/// mutex and a single-threaded embedder never observes an intermediate state.
struct SharedScratch(UnsafeCell<CellScratch>);
unsafe impl Sync for SharedScratch {}
static CELL_SCRATCH: SharedScratch = SharedScratch(UnsafeCell::new(CellScratch {
    head: [0; LIST_MAX_CELLS],
    next: [0; LIST_MAX_N],
    candidates: [0; LIST_MAX_CANDIDATES],
}));
static CELL_SCRATCH_TAKEN: AtomicBool = AtomicBool::new(false);
/// Short-lived spin mutex around CELL_SCRATCH. The ABI surface is
/// synchronous, but an embedder may call kernels from more than one thread
/// (e.g. a wasm run next to a native one); the guard keeps that safe too.
struct ScratchGuard;
impl ScratchGuard {
    fn take() -> Self {
        while CELL_SCRATCH_TAKEN
            .compare_exchange_weak(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            core::hint::spin_loop();
        }
        ScratchGuard
    }
}
impl Drop for ScratchGuard {
    fn drop(&mut self) {
        CELL_SCRATCH_TAKEN.store(false, Ordering::Release);
    }
}
/// Cells per axis for a cubic box: the largest count whose `dim`-power fits
/// the head[] budget, so the side `L / axis` stays >= rc and the ±1-cell
/// stencil always covers every in-range pair.
fn cell_axis_count(box_l: f64, rc: f64, dim: usize) -> usize {
    let raw = floor(box_l / rc);
    if !(raw >= 1.) {
        return 1;
    }
    let mut cells = raw.min(LIST_MAX_CELLS as f64) as usize;
    while cells > 1 && cells.checked_pow(dim as u32).map_or(true, |v| v > LIST_MAX_CELLS) {
        cells >>= 1;
    }
    cells
}
/// Periodic cell coordinate of one component: wrapped into [0, L) the same
/// way the integrator wraps positions, then scaled by the cell count.
fn cell_axis(x: f32, box_l: f64, cells: usize) -> usize {
    let w = x as f64 - box_l * floor(x as f64 / box_l);
    let i = floor((w / box_l) * cells as f64);
    if i < 0. {
        0
    } else if i >= cells as f64 {
        cells - 1
    } else {
        i as usize
    }
}
fn compute_forces(
    c: &MdConfig,
    box_l: f64,
    pos: &[f32],
    force: &mut [f32],
    source: ForceSource<'_>,
) -> Result<ForceStats, KernelError> {
    let len = c.validate(box_l)?;
    fields(len, &[pos])?;
    source.validate(c.n)?;
    if force.len() != len {
        return Err(KernelError::BufferLength);
    }
    let rc2 = c.rc * c.rc;
    let shift = if matches!(source, ForceSource::Homogeneous) {
        let inv6 = 1. / (rc2 * rc2 * rc2);
        finite(4. * (inv6 * inv6 - inv6))?
    } else {
        0. // Heterogeneous shifts depend on each pair's actual sigma/epsilon.
    };
    force.fill(0.);
    // The cell list replays the identical (i, j) sequence, so force bits are
    // unchanged. The all-pairs scan remains for systems above the scratch
    // bound and for boxes so small that the ±1-cell stencil covers every cell.
    let axis = cell_axis_count(box_l, c.rc, c.dim);
    if c.n <= LIST_MAX_N && axis >= 4 {
        let _guard = ScratchGuard::take();
        let scratch = unsafe { &mut *CELL_SCRATCH.0.get() };
        compute_forces_cells(c, box_l, rc2, pos, force, source, shift, axis, scratch)
    } else {
        compute_forces_pairs(c, box_l, rc2, pos, force, source, shift)
    }
}
/// One (i, j) evaluation, identical to the former all-pairs inner body: the
/// f64 displacement sum, the same skip/error order and the same per-pair f32
/// force stores, so both pair traversals produce the same bits.
#[allow(clippy::too_many_arguments)]
fn eval_pair(
    c: &MdConfig,
    box_l: f64,
    rc2: f64,
    pos: &[f32],
    force: &mut [f32],
    source: ForceSource<'_>,
    base_shift: f64,
    i: usize,
    j: usize,
    potential: &mut f64,
    virial: &mut f64,
) -> Result<(), KernelError> {
    let mut d = [0f32; 3];
    let mut r2 = 0.;
    for k in 0..c.dim {
        let dk = displacement(pos[i * c.dim + k], pos[j * c.dim + k], box_l)?;
        d[k] = field_value(dk)?;
        r2 += dk * dk;
    }
    if !r2.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    if r2 >= rc2 {
        return Ok(());
    }
    if r2 <= 0. {
        return Err(KernelError::InvalidState);
    }
    let (sigma2, epsilon, shift) = match source {
        ForceSource::Homogeneous => (1., 1., base_shift),
        ForceSource::Particles(p, _) => {
            let sigma = (p.sigma[i] as f64 + p.sigma[j] as f64) * 0.5;
            let sigma2 = sigma * sigma;
            let epsilon = sqrt(p.epsilon[i] as f64 * p.epsilon[j] as f64)?;
            let inv6 = (sigma2 * sigma2 * sigma2) / (rc2 * rc2 * rc2);
            (
                sigma2,
                epsilon,
                finite(4. * epsilon * (inv6 * inv6 - inv6))?,
            )
        }
    };
    let inv2 = sigma2 / r2;
    let sr6 = inv2 * inv2 * inv2;
    let sr12 = sr6 * sr6;
    *potential += 4. * epsilon * (sr12 - sr6) - shift;
    // Actual existing path is ljTerm's 24/r², not ljPair's 24*(1/r²).
    let mut f_over_r = (24. * epsilon / r2) * (2. * sr12 - sr6);
    if let ForceSource::Particles(p, s) = source {
        let (u, f) = screened_coulomb(r2, p.charge[i] as f64, p.charge[j] as f64, s)?;
        // Preserve JS term accumulation: potential receives LJ, then Coulomb.
        *potential += u;
        f_over_r += f;
    }
    *virial += f_over_r * r2;
    for k in 0..c.dim {
        let f = f_over_r * d[k] as f64;
        force[i * c.dim + k] = field_value(force[i * c.dim + k] as f64 + f)?;
        force[j * c.dim + k] = field_value(force[j * c.dim + k] as f64 - f)?;
    }
    Ok(())
}
/// Reference traversal and fallback: strict lexicographic (i, j>i) order.
fn compute_forces_pairs(
    c: &MdConfig,
    box_l: f64,
    rc2: f64,
    pos: &[f32],
    force: &mut [f32],
    source: ForceSource<'_>,
    base_shift: f64,
) -> Result<ForceStats, KernelError> {
    let mut potential = 0.;
    let mut virial = 0.;
    for i in 0..c.n {
        for j in i + 1..c.n {
            eval_pair(
                c,
                box_l,
                rc2,
                pos,
                force,
                source,
                base_shift,
                i,
                j,
                &mut potential,
                &mut virial,
            )?;
        }
    }
    Ok(ForceStats {
        potential: finite(potential)?,
        virial: finite(virial)?,
    })
}
/// Cell-list traversal: for each centre i, forward partners (j > i) living in
/// the ±1-cell periodic stencil are collected, sorted back into ascending j
/// and replayed through `eval_pair`, so accepted pairs reach the f32 force
/// stores in exactly the all-pairs order. The stencil covers every pair
/// inside rc because the cell side is kept >= rc. A centre whose stencil
/// holds more than `LIST_MAX_CANDIDATES` members (a degenerate cluster) falls
/// back to the plain inner scan for that i.
#[allow(clippy::too_many_arguments)]
fn compute_forces_cells(
    c: &MdConfig,
    box_l: f64,
    rc2: f64,
    pos: &[f32],
    force: &mut [f32],
    source: ForceSource<'_>,
    base_shift: f64,
    axis: usize,
    s: &mut CellScratch,
) -> Result<ForceStats, KernelError> {
    let cell_count = axis
        .checked_pow(c.dim as u32)
        .ok_or(KernelError::InvalidDimensions)?;
    s.head[..cell_count].fill(NO_LINK);
    for i in 0..c.n {
        let mut id = 0usize;
        let mut stride = 1usize;
        for k in 0..c.dim {
            id += cell_axis(pos[i * c.dim + k], box_l, axis) * stride;
            stride *= axis;
        }
        s.next[i] = s.head[id];
        s.head[id] = i as u32;
    }
    let mut potential = 0.;
    let mut virial = 0.;
    for i in 0..c.n {
        // Per-axis neighbour coordinates {ci-1, ci, ci+1} mod axis; axis >= 4
        // here, so the three entries are always distinct.
        let mut near = [[0usize; 3]; 3];
        for k in 0..c.dim {
            let ic = cell_axis(pos[i * c.dim + k], box_l, axis);
            near[k] = [(ic + axis - 1) % axis, ic, (ic + 1) % axis];
        }
        let zset: &[usize] = if c.dim == 3 { &near[2] } else { &[0] };
        let mut m = 0usize;
        let mut overflow = false;
        'stencil: for &cx in &near[0] {
            for &cy in &near[1] {
                for &cz in zset {
                    let mut link = s.head[cx + axis * (cy + axis * cz)];
                    while link != NO_LINK {
                        let j = link as usize;
                        if j > i {
                            if m == LIST_MAX_CANDIDATES {
                                overflow = true;
                                break 'stencil;
                            }
                            s.candidates[m] = j as u32;
                            m += 1;
                        }
                        link = s.next[j];
                    }
                }
            }
        }
        if overflow {
            for j in i + 1..c.n {
                eval_pair(
                    c,
                    box_l,
                    rc2,
                    pos,
                    force,
                    source,
                    base_shift,
                    i,
                    j,
                    &mut potential,
                    &mut virial,
                )?;
            }
        } else {
            s.candidates[..m].sort_unstable();
            for k in 0..m {
                eval_pair(
                    c,
                    box_l,
                    rc2,
                    pos,
                    force,
                    source,
                    base_shift,
                    i,
                    s.candidates[k] as usize,
                    &mut potential,
                    &mut virial,
                )?;
            }
        }
    }
    Ok(ForceStats {
        potential: finite(potential)?,
        virial: finite(virial)?,
    })
}
fn kinetic(vel: &[f32]) -> Result<f64, KernelError> {
    let mut sum = 0.;
    for &v in vel {
        sum += v as f64 * v as f64
    }
    finite(0.5 * sum)
}
fn temperature(c: &MdConfig, vel: &[f32]) -> Result<f64, KernelError> {
    finite(2. * kinetic(vel)? / (c.dim * c.n) as f64)
}
fn pressure(c: &MdConfig, s: &MdScalars, t: f64) -> Result<f64, KernelError> {
    let v = volume(s.box_l, c.dim)?;
    finite((c.n as f64 / v) * t + s.virial / (c.dim as f64 * v))
}
pub fn init_md(c: &MdConfig, s: &mut MdScalars, b: &mut MdBuffers<'_>) -> Result<(), KernelError> {
    init_with_source(c, s, b, ForceSource::Homogeneous)
}
pub fn init_particles(
    c: &MdConfig,
    s: &mut MdScalars,
    b: &mut MdBuffers<'_>,
    p: &ParticleProperties<'_>,
    screening: &ScreeningParams,
) -> Result<(), KernelError> {
    init_with_source(c, s, b, ForceSource::Particles(*p, *screening))
}
fn init_with_source(
    c: &MdConfig,
    s: &mut MdScalars,
    b: &mut MdBuffers<'_>,
    source: ForceSource<'_>,
) -> Result<(), KernelError> {
    let len = c.validate(s.box_l)?;
    fields(len, &[b.pos, b.vel])?;
    if b.force.len() != len || b.unwrapped.len() != len {
        return Err(KernelError::BufferLength);
    }
    let f = compute_forces(c, s.box_l, b.pos, b.force, source)?;
    b.unwrapped.copy_from_slice(b.pos);
    s.potential = f.potential;
    s.virial = f.virial;
    s.last_temperature = temperature(c, b.vel)?;
    Ok(())
}
pub fn step_md(c: &MdConfig, s: &mut MdScalars, b: &mut MdBuffers<'_>) -> Result<(), KernelError> {
    step_with_source(c, s, b, ForceSource::Homogeneous)
}
pub fn step_particles(
    c: &MdConfig,
    s: &mut MdScalars,
    b: &mut MdBuffers<'_>,
    p: &ParticleProperties<'_>,
    screening: &ScreeningParams,
) -> Result<(), KernelError> {
    step_with_source(c, s, b, ForceSource::Particles(*p, *screening))
}
fn step_with_source(
    c: &MdConfig,
    s: &mut MdScalars,
    b: &mut MdBuffers<'_>,
    source: ForceSource<'_>,
) -> Result<(), KernelError> {
    validate_state(c, s, b)?;
    source.validate(c.n)?;
    let half = 0.5 * c.dt;
    for (v, &f) in b.vel.iter_mut().zip(b.force.iter()) {
        *v = field_value(*v as f64 + half * f as f64)?;
    }
    for k in 0..b.pos.len() {
        let dx = b.vel[k] as f64 * c.dt;
        b.unwrapped[k] = field_value(b.unwrapped[k] as f64 + dx)?;
        let p = b.pos[k] as f64 + dx;
        let quotient = finite(p / s.box_l)?;
        b.pos[k] = field_value(p - s.box_l * floor(quotient))?;
    }
    let f = compute_forces(c, s.box_l, b.pos, b.force, source)?;
    s.potential = f.potential;
    s.virial = f.virial;
    for (v, &f) in b.vel.iter_mut().zip(b.force.iter()) {
        *v = field_value(*v as f64 + half * f as f64)?;
    }
    s.last_temperature = temperature(c, b.vel)?;
    Ok(())
}
fn validate_bath(bath: &MdBath) -> Result<(), KernelError> {
    if bath
        .target_temperature
        .is_some_and(|v| !v.is_finite() || v < 0.)
        || bath.target_pressure.is_some_and(|v| !v.is_finite())
        || !bath.kappa_t.is_finite()
        || bath.kappa_t < 0.
        || !bath.max_scale.is_finite()
        || !(0.0..1.0).contains(&bath.max_scale)
    {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(())
}
pub fn barostat_md(
    c: &MdConfig,
    s: &mut MdScalars,
    b: &mut MdBuffers<'_>,
    bath: &MdBath,
) -> Result<f64, KernelError> {
    validate_state(c, s, b)?;
    validate_bath(bath)?;
    let Some(target) = bath.target_pressure else {
        return Ok(1.);
    };
    // Existing no-op cases: nonpositive/NaN tau; +infinity gives dt/tau=0.
    if bath.tau_p <= 0. || bath.tau_p.is_nan() {
        return Ok(1.);
    }
    let p = pressure(c, s, temperature(c, b.vel)?)?;
    let mu_pow = finite(1. - bath.kappa_t * (c.dt / bath.tau_p) * (target - p))?.max(0.);
    let scale = root(mu_pow, c.dim)?.clamp(1. - bath.max_scale, 1. + bath.max_scale);
    if scale == 1. {
        return Ok(1.);
    }
    s.box_l = finite(s.box_l * scale)?;
    for k in 0..b.pos.len() {
        b.pos[k] = field_value(b.pos[k] as f64 * scale)?;
        b.unwrapped[k] = field_value(b.unwrapped[k] as f64 * scale)?;
    }
    let f = compute_lj_forces(c, s.box_l, b.pos, b.force)?;
    s.potential = f.potential;
    s.virial = f.virial;
    Ok(scale)
}
pub fn batch_md(
    c: &MdConfig,
    s: &mut MdScalars,
    b: &mut MdBuffers<'_>,
    bath: &MdBath,
    steps: u32,
) -> Result<(), KernelError> {
    batch_with_source(c, s, b, bath, steps, ForceSource::Homogeneous)
}
pub fn batch_particles(
    c: &MdConfig,
    s: &mut MdScalars,
    b: &mut MdBuffers<'_>,
    p: &ParticleProperties<'_>,
    screening: &ScreeningParams,
    target_temperature: Option<f64>,
    steps: u32,
) -> Result<(), KernelError> {
    let bath = MdBath {
        target_temperature,
        target_pressure: None,
        tau_p: 1.,
        kappa_t: 1.,
        max_scale: 0.02,
    };
    batch_with_source(
        c,
        s,
        b,
        &bath,
        steps,
        ForceSource::Particles(*p, *screening),
    )
}
fn batch_with_source(
    c: &MdConfig,
    s: &mut MdScalars,
    b: &mut MdBuffers<'_>,
    bath: &MdBath,
    steps: u32,
    source: ForceSource<'_>,
) -> Result<(), KernelError> {
    if !(1..=4).contains(&steps) {
        return Err(KernelError::InvalidCoefficient);
    }
    validate_state(c, s, b)?;
    validate_bath(bath)?;
    source.validate(c.n)?;
    let batch = if let Some(target) = bath.target_temperature {
        if s.last_temperature <= 0. {
            1.
        } else {
            sqrt(target / s.last_temperature)?
        }
    } else {
        1.
    };
    let scale = if batch == 1. {
        1.
    } else {
        root(batch, steps as usize)?
    };
    for _ in 0..steps {
        step_with_source(c, s, b, source)?;
        if scale != 1. {
            for v in b.vel.iter_mut() {
                *v = field_value(*v as f64 * scale)?;
            }
        }
        if bath.target_pressure.is_some() {
            barostat_md(c, s, b, bath)?;
        }
    }
    s.last_temperature = temperature(c, b.vel)?;
    Ok(())
}
pub fn read_particles(
    c: &MdConfig,
    s: &MdScalars,
    pos0: &[f32],
    vel: &[f32],
    unwrapped: &[f32],
    charge: &[f32],
    speed: &mut [f32],
) -> Result<ParticleObservables, KernelError> {
    fields(c.n, &[charge])?;
    let mut total_charge = 0.;
    for &q in charge {
        total_charge += q as f64;
    }
    Ok(ParticleObservables {
        md: read_md(c, s, pos0, vel, unwrapped, speed)?,
        total_charge: finite(total_charge)?,
    })
}
pub fn read_md(
    c: &MdConfig,
    s: &MdScalars,
    pos0: &[f32],
    vel: &[f32],
    unwrapped: &[f32],
    speed: &mut [f32],
) -> Result<MdObservables, KernelError> {
    let len = c.validate(s.box_l)?;
    fields(len, &[pos0, vel, unwrapped])?;
    if speed.len() != c.n {
        return Err(KernelError::BufferLength);
    }
    let ke = kinetic(vel)?;
    let t = 2. * ke / (c.dim * c.n) as f64;
    let mut distance = 0.;
    for i in 0..c.n {
        let mut v2 = 0.;
        for k in 0..c.dim {
            let v = vel[i * c.dim + k] as f64;
            v2 += v * v;
        }
        speed[i] = field_value(sqrt(v2)?)?;
    }
    for k in 0..len {
        let d = unwrapped[k] as f64 - pos0[k] as f64;
        distance += d * d;
    }
    let v = volume(s.box_l, c.dim)?;
    Ok(MdObservables {
        temperature: finite(t)?,
        kinetic: ke,
        potential: finite(s.potential)?,
        total: finite(ke + s.potential)?,
        pressure: pressure(c, s, t)?,
        msd: finite(distance / c.n as f64)?,
        box_l: s.box_l,
        volume: v,
        density: finite(c.n as f64 / v)?,
    })
}
pub fn radial_distribution(
    c: &MdConfig,
    box_l: f64,
    pos: &[f32],
    r_max: f64,
    hist: &mut [f64],
    r: &mut [f32],
    g: &mut [f32],
) -> Result<RdfStats, KernelError> {
    let len = c.validate(box_l)?;
    fields(len, &[pos])?;
    let bins = hist.len();
    if bins == 0 || r.len() != bins || g.len() != bins {
        return Err(KernelError::BufferLength);
    }
    if !r_max.is_finite() || r_max <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let rm = r_max.min(box_l / 2.);
    let dr = rm / bins as f64;
    if dr <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    hist.fill(0.);
    let mut pair_count = 0u64;
    for i in 0..c.n {
        for j in i + 1..c.n {
            let mut r2 = 0.;
            for k in 0..c.dim {
                let d = displacement(pos[i * c.dim + k], pos[j * c.dim + k], box_l)?;
                r2 += d * d;
            }
            if r2 <= 0. {
                continue;
            }
            let rr = sqrt(r2)?;
            if rr >= rm {
                continue;
            }
            let bin = (rr / dr) as usize;
            if bin >= bins {
                return Err(KernelError::InvalidState);
            }
            hist[bin] += 1.;
            pair_count += 1;
        }
    }
    let density = finite(c.n as f64 / volume(box_l, c.dim)?)?;
    for k in 0..bins {
        let inner = k as f64 * dr;
        let outer = (k + 1) as f64 * dr;
        let shell = if c.dim == 2 {
            core::f64::consts::PI * (outer * outer - inner * inner)
        } else {
            (4. / 3.) * core::f64::consts::PI * (outer * outer * outer - inner * inner * inner)
        };
        r[k] = field_value((k as f64 + 0.5) * dr)?;
        g[k] = field_value(if shell > 0. {
            (2. * hist[k] / c.n as f64) / (density * shell)
        } else {
            0.
        })?;
    }
    Ok(RdfStats {
        r_max: rm,
        pair_count,
    })
}
pub fn diffusion_einstein(
    t: &[f64],
    msd: &[f64],
    dim: usize,
    skip: f64,
) -> Result<DiffusionResult, KernelError> {
    if dim != 2 && dim != 3 {
        return Err(KernelError::UnsupportedFeature);
    }
    if !skip.is_finite() || !(0.0..=1.0).contains(&skip) {
        return Err(KernelError::InvalidCoefficient);
    }
    let len = t.len().min(msd.len());
    if t[..len]
        .iter()
        .chain(msd[..len].iter())
        .any(|v| !v.is_finite())
    {
        return Err(KernelError::NonFiniteValue);
    }
    let start = (len as f64 * skip) as usize;
    let n = len - start;
    if n < 2 {
        return Ok(DiffusionResult {
            diffusion: 0.,
            slope: 0.,
            intercept: if n == 1 { msd[start] } else { 0. },
            r2: 0.,
            n_fit: n,
        });
    }
    let (mut sx, mut sy, mut sxx, mut sxy, mut syy) = (0., 0., 0., 0., 0.);
    for i in start..len {
        sx += t[i];
        sy += msd[i];
        sxx += t[i] * t[i];
        sxy += t[i] * msd[i];
        syy += msd[i] * msd[i];
    }
    let nf = n as f64;
    let denom = finite(nf * sxx - sx * sx)?;
    let slope = if denom == 0. {
        0.
    } else {
        (nf * sxy - sx * sy) / denom
    };
    let intercept = (sy - slope * sx) / nf;
    let total = syy - (sy * sy) / nf;
    let residual = syy - intercept * sy - slope * sxy;
    let r2 = if total == 0. {
        1.
    } else {
        finite(1. - residual / total)?.max(0.)
    };
    Ok(DiffusionResult {
        diffusion: finite(slope / (2. * dim as f64))?,
        slope: finite(slope)?,
        intercept: finite(intercept)?,
        r2,
        n_fit: n,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn screened_exponential_matches_std_across_normal_and_subnormal_range() {
        let mut max_relative = 0.0f64;
        for i in 0..=7460 {
            let x = i as f64 * 0.1;
            let expected = (-x).exp();
            let actual = exp_negative(x).unwrap();
            let absolute = (actual - expected).abs();
            assert!(absolute <= 2e-15 * expected + f64::from_bits(1));
            if expected >= f64::MIN_POSITIVE {
                max_relative = max_relative.max(absolute / expected);
            }
        }
        assert!(max_relative < 2e-15);
        for x in [
            0.,
            1e-15,
            0.34657359027997264,
            708.3964185322641,
            744.4400719213812,
            745.1332191019411,
            746.,
            1e300,
        ] {
            assert!(
                (exp_negative(x).unwrap() - (-x).exp()).abs()
                    <= 2e-15 * (-x).exp() + f64::from_bits(1)
            );
        }
        for x in [-1., f64::NAN, f64::INFINITY] {
            assert!(exp_negative(x).is_err());
        }
    }
    #[test]
    fn bounded_roots_match_std_in_admitted_uses() {
        for value in [0.0f64, 1e-300, 0.01, 0.2, 0.98, 1., 1.02, 5., 100., 1e300] {
            for degree in 1..=4 {
                let expected = value.powf(1. / degree as f64);
                assert!(
                    (root(value, degree).unwrap() - expected).abs()
                        <= 2e-13 * expected.max(f64::MIN_POSITIVE)
                );
            }
        }
        for value in [-1., f64::NAN, f64::INFINITY] {
            assert!(root(value, 3).is_err());
        }
    }
    #[test]
    fn floor_and_round_keep_javascript_negative_ties() {
        for v in [-9.5, -2., -1.5, -0.5, -0.1, 0., 0.5, 1.5, 9.9, 1e30] {
            assert_eq!(floor(v), v.floor());
        }
        assert_eq!(round_js(-0.5).to_bits(), (-0.0f64).to_bits());
        assert_eq!(round_js(0.5), 1.);
        assert_eq!(round_js(-1.5), -1.);
        for (half, below, at, above) in [
            (0.5f64, 0., 1., 1.),
            (1.5, 1., 2., 2.),
            (-0.5, -1., -0., -0.),
            (-1.5, -2., -1., -1.),
        ] {
            let bits = half.to_bits();
            let (lower, upper) = if half > 0. {
                (f64::from_bits(bits - 1), f64::from_bits(bits + 1))
            } else {
                (f64::from_bits(bits + 1), f64::from_bits(bits - 1))
            };
            assert_eq!(round_js(lower).to_bits(), f64::to_bits(below));
            assert_eq!(round_js(half).to_bits(), f64::to_bits(at));
            assert_eq!(round_js(upper).to_bits(), f64::to_bits(above));
        }
    }
    // === Cell list and 3D coverage ===
    extern crate std;
    use std::time::Instant;
    use std::vec::Vec;
    /// Deterministic [0, 1) double stream; enough disorder for cell tests.
    fn xorshift(state: &mut u64) -> f64 {
        let mut s = *state | 1;
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        *state = s;
        (s >> 11) as f64 * (1. / 9007199254740992.)
    }
    /// Cubic lattice + small deterministic jitter, wrapped into [0, L).
    fn lattice_positions(n: usize, dim: usize, l: f64, seed: u64) -> Vec<f32> {
        let per = (n as f64).powf(1. / dim as f64).ceil() as usize;
        let spacing = l / per as f64;
        let mut rng = seed;
        let mut pos = std::vec![0f32; n * dim];
        for i in 0..n {
            let mut rem = i;
            for k in 0..dim {
                let cell = rem % per;
                rem /= per;
                let x = (cell as f64 + 0.5) * spacing + (xorshift(&mut rng) - 0.5) * spacing * 0.2;
                pos[i * dim + k] = (x - l * floor(x / l)) as f32;
            }
        }
        pos
    }
    /// n sites packed into a [0, slab)³ corner so every centre sees > LIST_MAX_CANDIDATES
    /// stencil members and the per-centre all-pairs fallback runs.
    fn dense_slab(n: usize, dim: usize, _l: f64, slab: f64, seed: u64) -> Vec<f32> {
        let per = (n as f64).powf(1. / dim as f64).ceil() as usize;
        let spacing = slab / per as f64;
        let mut rng = seed;
        let mut pos = std::vec![0f32; n * dim];
        for i in 0..n {
            let mut rem = i;
            for k in 0..dim {
                let cell = rem % per;
                rem /= per;
                let x = (cell as f64 + 0.5) * spacing + (xorshift(&mut rng) - 0.5) * spacing * 0.1;
                pos[i * dim + k] = x.clamp(0., slab - 1e-4) as f32;
            }
        }
        pos
    }
    fn assert_forces_bitwise_equal(a: &[f32], b: &[f32]) {
        assert_eq!(a.len(), b.len());
        for (k, (&x, &y)) in a.iter().zip(b.iter()).enumerate() {
            assert_eq!(x.to_bits(), y.to_bits(), "force[{k}]");
        }
    }
    #[test]
    fn cell_list_replays_the_all_pairs_sequence_bitwise() {
        for &(dim, n, l, seed) in &[
            (2usize, 512usize, 20., 11u64),
            (3, 512, 12., 12),
            (3, 2048, 16., 13),
            (2, 1024, 40., 14),
        ] {
            let c = MdConfig { n, dim, dt: 0.005, rc: 2.5 };
            let pos = lattice_positions(n, dim, l, seed);
            let rc2 = c.rc * c.rc;
            let inv6 = 1. / (rc2 * rc2 * rc2);
            let shift = 4. * (inv6 * inv6 - inv6);
            let mut f_ref = std::vec![0f32; n * dim];
            let mut f_cell = std::vec![0f32; n * dim];
            let reference = compute_forces_pairs(
                &c, l, rc2, &pos, &mut f_ref, ForceSource::Homogeneous, shift,
            );
            let listed = compute_lj_forces(&c, l, &pos, &mut f_cell);
            assert_eq!(reference.is_ok(), listed.is_ok(), "dim={dim} n={n} L={l}");
            let (a, b) = (reference.unwrap(), listed.unwrap());
            assert_eq!(a.potential.to_bits(), b.potential.to_bits());
            assert_eq!(a.virial.to_bits(), b.virial.to_bits());
            assert_forces_bitwise_equal(&f_ref, &f_cell);
        }
    }
    #[test]
    fn cell_list_covers_degenerate_clusters_via_per_centre_fallback() {
        // Slab packs > LIST_MAX_CANDIDATES partners into one stencil; the
        // fallback must still reproduce the all-pairs result bit for bit.
        let (dim, n, l) = (3usize, 4500usize, 30.);
        let c = MdConfig { n, dim, dt: 0.005, rc: 2.5 };
        let pos = dense_slab(n, dim, l, 7., 17);
        let rc2 = c.rc * c.rc;
        let inv6 = 1. / (rc2 * rc2 * rc2);
        let shift = 4. * (inv6 * inv6 - inv6);
        let mut f_ref = std::vec![0f32; n * dim];
        let mut f_cell = std::vec![0f32; n * dim];
        let reference = compute_forces_pairs(&c, l, rc2, &pos, &mut f_ref, ForceSource::Homogeneous, shift);
        let listed = compute_lj_forces(&c, l, &pos, &mut f_cell);
        assert_eq!(reference.is_ok(), listed.is_ok());
        let (a, b) = (reference.unwrap(), listed.unwrap());
        assert_eq!(a.potential.to_bits(), b.potential.to_bits());
        assert_eq!(a.virial.to_bits(), b.virial.to_bits());
        assert_forces_bitwise_equal(&f_ref, &f_cell);
    }
    #[test]
    fn cell_list_replays_particles_source_bitwise() {
        // Heterogeneous LJ + screened Coulomb takes the same traversal.
        let (dim, n, l) = (3usize, 729usize, 13.);
        let c = MdConfig { n, dim, dt: 0.005, rc: 2.5 };
        let pos = lattice_positions(n, dim, l, 19);
        let mut charge = std::vec![0f32; n];
        let mut sigma = std::vec![0f32; n];
        let mut epsilon = std::vec![0f32; n];
        let mut rng = 23u64;
        for i in 0..n {
            charge[i] = (xorshift(&mut rng) * 4. - 2.) as f32;
            sigma[i] = (0.8 + xorshift(&mut rng) * 0.4) as f32;
            epsilon[i] = (0.5 + xorshift(&mut rng)) as f32;
        }
        let p = ParticleProperties { charge: &charge, sigma: &sigma, epsilon: &epsilon };
        let screening = ScreeningParams { eps_r: 4., lambda_d: 3., k_coulomb: 1. };
        let mut f_ref = std::vec![0f32; n * dim];
        let mut f_cell = std::vec![0f32; n * dim];
        let reference = compute_forces_pairs(
            &c, l, c.rc * c.rc, &pos, &mut f_ref,
            ForceSource::Particles(p, screening), 0.,
        );
        let listed = compute_particle_forces(&c, l, &pos, &mut f_cell, &p, &screening);
        assert_eq!(reference.is_ok(), listed.is_ok());
        let (a, b) = (reference.unwrap(), listed.unwrap());
        assert_eq!(a.potential.to_bits(), b.potential.to_bits());
        assert_eq!(a.virial.to_bits(), b.virial.to_bits());
        assert_forces_bitwise_equal(&f_ref, &f_cell);
    }
    #[test]
    fn rdf_3d_ideal_gas_is_flat() {
        let (n, dim, l) = (1500usize, 3usize, 12.);
        let c = MdConfig { n, dim, dt: 0.005, rc: 2.5 };
        let mut rng = 7u64;
        let mut pos = std::vec![0f32; n * dim];
        for v in pos.iter_mut() {
            *v = (xorshift(&mut rng) * l) as f32;
        }
        let bins = 48;
        let mut hist = std::vec![0f64; bins];
        let mut r = std::vec![0f32; bins];
        let mut g = std::vec![0f32; bins];
        radial_distribution(&c, l, &pos, l / 2., &mut hist, &mut r, &mut g).unwrap();
        let mut sum = 0.;
        let mut count = 0;
        for k in 0..bins {
            let rk = r[k] as f64;
            if (2.5..5.5).contains(&rk) {
                sum += g[k] as f64;
                count += 1;
            }
        }
        let mean = sum / count as f64;
        assert!((mean - 1.).abs() < 0.1, "3D ideal-gas g(r) mean {mean}");
    }
    /// Build an NVE 3D state on a lattice with T0-scaled drift-free velocities.
    fn nve_state(
        n: usize,
        l: f64,
        t0: f64,
        seed: u64,
    ) -> (MdConfig, MdScalars, Vec<f32>, Vec<f32>, Vec<f32>, Vec<f32>) {
        let dim = 3;
        let c = MdConfig { n, dim, dt: 0.005, rc: 2.5 };
        let pos = lattice_positions(n, dim, l, seed);
        let mut vel = std::vec![0f32; n * dim];
        let mut rng = seed + 1;
        for v in vel.iter_mut() {
            *v = (xorshift(&mut rng) - 0.5) as f32;
        }
        for k in 0..dim {
            let mean =
                vel.iter().skip(k).step_by(dim).map(|v| *v as f64).sum::<f64>() / n as f64;
            for i in 0..n {
                vel[i * dim + k] = (vel[i * dim + k] as f64 - mean) as f32;
            }
        }
        let factor = sqrt(t0 / temperature(&c, &vel).unwrap()).unwrap();
        for v in vel.iter_mut() {
            *v = (*v as f64 * factor) as f32;
        }
        (
            c,
            MdScalars { box_l: l, potential: 0., virial: 0., last_temperature: 0. },
            pos,
            vel,
            std::vec![0f32; n * dim],
            std::vec![0f32; n * dim],
        )
    }
    #[test]
    fn nve_3d_energy_drift_stays_bounded() {
        // rho* = 0.5 liquid: L = (512/0.5)^(1/3) ~ 10.1 -> axis 4, cell path.
        let (n, l) = (512usize, (512f64 / 0.5).powf(1. / 3.));
        let (c, mut s, mut pos, mut vel, mut force, mut unwrapped) = nve_state(n, l, 0.8, 29);
        let mut b = MdBuffers {
            pos: &mut pos, vel: &mut vel, force: &mut force, unwrapped: &mut unwrapped,
        };
        init_md(&c, &mut s, &mut b).unwrap();
        let e0 = kinetic(b.vel).unwrap() + s.potential;
        for _ in 0..400 {
            step_md(&c, &mut s, &mut b).unwrap();
        }
        let e1 = kinetic(b.vel).unwrap() + s.potential;
        let drift = (e1 - e0).abs() / e0.abs().max(1.);
        assert!(drift < 0.01, "3D NVE energy drift {drift}");
    }
    #[test]
    fn cell_list_2048_3d_steps_per_second() {
        // Perf signal, not a wall-clock contract: report steps/s and require
        // the listed traversal to beat the all-pairs reference clearly.
        let (n, dim, l) = (2048usize, 3usize, (2048f64 / 0.5).powf(1. / 3.));
        let (c, mut s, mut pos, mut vel, mut force, mut unwrapped) = nve_state(n, l, 0.8, 31);
        {
            let mut b = MdBuffers {
                pos: &mut pos, vel: &mut vel, force: &mut force, unwrapped: &mut unwrapped,
            };
            init_md(&c, &mut s, &mut b).unwrap();
            for _ in 0..5 {
                step_md(&c, &mut s, &mut b).unwrap();
            }
            let t0 = Instant::now();
            let steps = 20;
            for _ in 0..steps {
                step_md(&c, &mut s, &mut b).unwrap();
            }
            let listed = t0.elapsed().as_secs_f64() / steps as f64;
            // All-pairs reference force cost on the same configuration.
            let rc2 = c.rc * c.rc;
            let inv6 = 1. / (rc2 * rc2 * rc2);
            let shift = 4. * (inv6 * inv6 - inv6);
            let mut scratch = std::vec![0f32; n * dim];
            let t1 = Instant::now();
            for _ in 0..steps {
                scratch.fill(0.);
                compute_forces_pairs(
                    &c, l, rc2, b.pos, &mut scratch, ForceSource::Homogeneous, shift,
                )
                .unwrap();
            }
            let pairs = t1.elapsed().as_secs_f64() / steps as f64;
            let t2 = Instant::now();
            for _ in 0..steps {
                scratch.fill(0.);
                compute_lj_forces(&c, l, b.pos, &mut scratch).unwrap();
            }
            let cellforce = t2.elapsed().as_secs_f64() / steps as f64;
            std::eprintln!(
                "[md] 3D N=2048: {:.0} steps/s ({:.3} ms/step); cell force {:.3} ms; all-pairs force {:.3} ms; speedup {:.1}x",
                1. / listed, listed * 1e3, cellforce * 1e3, pairs * 1e3, pairs / cellforce
            );
            assert!(
                cellforce < pairs * 0.8,
                "cell traversal {cellforce:.4}s vs pairs {pairs:.4}s"
            );
        }
    }
}
