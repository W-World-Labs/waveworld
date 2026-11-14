//! 2D incompressible Navier-Stokes teaching discretization: semi-Lagrangian
//! advection, implicit GS diffusion and a CONVERGENT SOR pressure projection
//! (real L-infinity residual criterion, fixed internal budget, honest
//! non-convergence error). The projection pair is a backward-difference
//! divergence composed with a forward-difference gradient, so it annihilates
//! exactly the divergence that `max_divergence` reports. Approximate solid-cell
//! clearing; not body-fitted CFD or 3D CHT. f32 persistent fields, f64 solver
//! arithmetic; source/decay belongs to physics steps.
use crate::{field_value, sin_cos, sqrt, KernelError};

/// Relative L∞ residual target shared by the implicit solves on this grid.
const SOLVE_REL_TOL: f64 = 1e-6;
/// Absolute residual floor in Stam grid-scaled units; covers near-zero systems.
const SOLVE_ABS_TOL: f64 = 1e-11;
/// One f32 field rounding contributes ~ε|x| to a residual; keep a safe margin
/// as the honest floor for plain f32 stored fields.
const SOLVE_STORE_TOL: f64 = 64. * f32::EPSILON as f64;
/// Internal sweep budget for the pressure projection. The solve runs to its
/// residual tolerance, which needs Θ(n) SOR sweeps; the cap only bounds
/// pathological inputs, so projected fields never depend on the configured
/// linear-solve budget. Exhaustion is reported, never silently accepted.
const PROJECTION_MAX_SWEEPS: u32 = 4096;
/// The exact pressure residual is expensive (a full stencil pass), so it is
/// only refreshed every few sweeps; intermediate sweeps continue on the last
/// still-failing bound and the cap is enforced exactly.
const PROJECTION_RESIDUAL_EVERY: u32 = 4;

#[derive(Clone, Copy, Debug)]
pub struct FluidConfig {
    pub n: usize,
    /// Sweep cap for the implicit diffusion/linear solves, which exit early on
    /// the residual tolerance. The pressure projection uses its own fixed
    /// budget so a converged result cannot depend on this parameter.
    pub iterations: u32,
    pub dt: f64,
    pub viscosity: f64,
    pub diffusion: f64,
    pub thermal: bool,
    pub buoyancy: f64,
    pub ambient: f64,
    pub inlet_speed: Option<f64>,
}
pub struct FluidBuffers<'a> {
    pub vx: &'a mut [f32],
    pub vy: &'a mut [f32],
    pub vx0: &'a mut [f32],
    pub vy0: &'a mut [f32],
    pub dens: &'a mut [f32],
    pub dens0: &'a mut [f32],
    pub p: &'a mut [f32],
    pub div: &'a mut [f32],
    pub scalar0: &'a mut [f32],
    pub temp: &'a mut [f32],
}
#[derive(Clone, Copy, Debug)]
pub struct DyeInlet {
    pub density: f64,
    pub spacing: f64,
    pub width: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct FluidSource {
    pub dye: Option<DyeInlet>,
    pub density_decay: f64,
    pub temperature_cooling: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct FluidStats {
    pub peak_density: f64,
    pub mean_density: f64,
    pub max_speed: f64,
    pub min_temperature: f64,
    pub max_temperature: f64,
    pub max_divergence: f64,
}
impl FluidConfig {
    pub fn cell_count(&self) -> Result<usize, KernelError> {
        if self.n < 3 {
            return Err(KernelError::InvalidDimensions);
        }
        self.n
            .checked_mul(self.n)
            .filter(|&n| n <= isize::MAX as usize / 4)
            .ok_or(KernelError::InvalidDimensions)
    }
    fn validate(&self) -> Result<usize, KernelError> {
        let count = self.cell_count()?;
        if self.iterations > 4096
            || ![self.dt, self.viscosity, self.diffusion]
                .iter()
                .all(|v| v.is_finite() && *v >= 0.)
            || !self.buoyancy.is_finite()
            || !self.ambient.is_finite()
            || self.inlet_speed.is_some_and(|v| !v.is_finite())
        {
            return Err(KernelError::InvalidCoefficient);
        }
        Ok(count)
    }
}
fn fields(c: &FluidConfig, xs: &[&[f32]]) -> Result<(), KernelError> {
    let n = c.validate()?;
    for x in xs {
        if x.len() != n {
            return Err(KernelError::BufferLength);
        }
        if x.iter().any(|v| !v.is_finite()) {
            return Err(KernelError::NonFiniteValue);
        }
    }
    Ok(())
}
fn boundary_kind(b: u32) -> Result<(), KernelError> {
    if b > 3 {
        Err(KernelError::UnsupportedFeature)
    } else {
        Ok(())
    }
}
fn bnd(c: &FluidConfig, b: u32, x: &mut [f32]) -> Result<(), KernelError> {
    let n = c.n;
    for i in 1..n - 1 {
        x[i] = if b == 2 { -x[i + n] } else { x[i + n] };
        x[i + (n - 1) * n] = if b == 2 {
            -x[i + (n - 2) * n]
        } else {
            x[i + (n - 2) * n]
        };
    }
    for j in 1..n - 1 {
        let left = x[1 + j * n] as f64;
        let right = x[n - 2 + j * n] as f64;
        if let Some(u) = c.inlet_speed {
            x[j * n] = field_value(if b == 1 {
                2. * u - left
            } else if b == 2 {
                -left
            } else {
                left
            })?;
            x[n - 1 + j * n] = if b == 3 { -right as f32 } else { right as f32 };
        } else {
            x[j * n] = if b == 1 { -left as f32 } else { left as f32 };
            x[n - 1 + j * n] = if b == 1 { -right as f32 } else { right as f32 };
        }
    }
    x[0] = field_value(0.5 * (x[1] as f64 + x[n] as f64))?;
    x[(n - 1) * n] = field_value(0.5 * (x[1 + (n - 1) * n] as f64 + x[(n - 2) * n] as f64))?;
    x[n - 1] = field_value(0.5 * (x[n - 2] as f64 + x[n - 1 + n] as f64))?;
    x[n * n - 1] = field_value(0.5 * (x[n * n - 2] as f64 + x[n - 1 + (n - 2) * n] as f64))?;
    Ok(())
}
pub fn set_boundary(c: &FluidConfig, b: u32, x: &mut [f32]) -> Result<(), KernelError> {
    fields(c, &[x])?;
    boundary_kind(b)?;
    bnd(c, b, x)
}
fn solve(
    c: &FluidConfig,
    b: u32,
    x: &mut [f32],
    x0: &[f32],
    a: f64,
    denominator: f64,
) -> Result<(), KernelError> {
    let reciprocal = 1. / denominator;
    if !a.is_finite() || !denominator.is_finite() || !reciprocal.is_finite() {
        return Err(KernelError::InvalidCoefficient);
    }
    let n = c.n;
    let mut rhs_max: f64 = 0.;
    for j in 1..n - 1 {
        for i in 1..n - 1 {
            rhs_max = rhs_max.max((x0[i + j * n] as f64).abs());
        }
    }
    let relative = SOLVE_REL_TOL * rhs_max;
    // |Ax| is bounded by (|denominator| + 4|a|)·|x|; one f32 store cannot
    // resolve a residual below that scale, which is the honest floor.
    let matrix = (denominator.abs() + 4. * a.abs()).max(1.);
    let mut iterations = 0;
    loop {
        // Exact f64 residual r = x0 - A·x of the current stored iterate.
        let mut residual: f64 = 0.;
        let mut x_max: f64 = 0.;
        for j in 1..n - 1 {
            for i in 1..n - 1 {
                let k = i + j * n;
                let r = x0[k] as f64
                    - (denominator * x[k] as f64
                        - a * (x[k + 1] as f64
                            + x[k - 1] as f64
                            + x[k + n] as f64
                            + x[k - n] as f64));
                residual = residual.max(r.abs());
                x_max = x_max.max((x[k] as f64).abs());
            }
        }
        if residual <= relative
            .max(SOLVE_STORE_TOL * matrix * x_max)
            .max(SOLVE_ABS_TOL)
        {
            return Ok(());
        }
        if iterations >= c.iterations {
            // Honest non-convergence: callers must discard the partial field.
            return Err(KernelError::InvalidState);
        }
        for j in 1..n - 1 {
            for i in 1..n - 1 {
                let k = i + j * n;
                x[k] = field_value(
                    (x0[k] as f64
                        + a * (x[k + 1] as f64
                            + x[k - 1] as f64
                            + x[k + n] as f64
                            + x[k - n] as f64))
                        * reciprocal,
                )?;
            }
        }
        bnd(c, b, x)?;
        iterations += 1;
    }
}
pub fn linear_solve(
    c: &FluidConfig,
    b: u32,
    x: &mut [f32],
    x0: &[f32],
    a: f64,
    denominator: f64,
) -> Result<(), KernelError> {
    fields(c, &[x, x0])?;
    boundary_kind(b)?;
    solve(c, b, x, x0, a, denominator)
}
fn diffusion(
    c: &FluidConfig,
    b: u32,
    x: &mut [f32],
    x0: &[f32],
    diff: f64,
) -> Result<(), KernelError> {
    if !diff.is_finite() || diff < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let a = c.dt * diff * (c.n - 2) as f64 * (c.n - 2) as f64;
    solve(c, b, x, x0, a, 1. + 4. * a)
}
pub fn diffuse(
    c: &FluidConfig,
    b: u32,
    x: &mut [f32],
    x0: &[f32],
    diff: f64,
) -> Result<(), KernelError> {
    fields(c, &[x, x0])?;
    boundary_kind(b)?;
    diffusion(c, b, x, x0, diff)
}
/// Divergence RHS of the projection, in Stam grid-scaled units: the negative
/// backward difference of the stored velocity, interior cells only. This is the
/// exact discrete divergence that the projection drives to the residual
/// tolerance and that `max_divergence` reports, so the solved equation, the
/// velocity correction and the reported statistic all use one consistent
/// operator. The backward difference also puts the left-edge ghost (inlet
/// flux, or the mirrored closed wall) and the top-edge ghost into the
/// constraint, so boundary flow is enforced rather than invisible.
fn divergence(c: &FluidConfig, vx: &[f32], vy: &[f32], div: &mut [f32]) -> Result<(), KernelError> {
    let n = c.n;
    let nf = n as f64;
    for j in 1..n - 1 {
        for i in 1..n - 1 {
            let k = i + j * n;
            div[k] = field_value(
                -(vx[k] as f64 - vx[k - 1] as f64 + vy[k] as f64 - vy[k - n] as f64) / nf,
            )?;
        }
    }
    bnd(c, 0, div)
}

// Specialize the invariant low-word choice once per full residual pass.
fn projection_residual<const HAS_LOW: bool>(
    n: usize,
    p: &[f32],
    div: &[f32],
    lo: &[f32],
    mut p_max: f64,
) -> (f64, f64) {
    let mut residual: f64 = 0.;
    for j in 1..n - 1 {
        for i in 1..n - 1 {
            let k = i + j * n;
            let pair = |k: usize| p[k] as f64 + if HAS_LOW { lo[k] as f64 } else { 0. };
            let pk = pair(k);
            let r = div[k] as f64
                - (4. * pk - pair(k - 1) - pair(k + 1) - pair(k - n) - pair(k + n));
            residual = residual.max(r.abs());
            p_max = p_max.max(pk.abs());
        }
    }
    (residual, p_max)
}

/// Convergent pressure projection: in-place successive over-relaxation on the
/// five-point Poisson equation `4p - Σp_nb = div`, iterated until the true f64
/// residual `||div - L·p||∞` meets `max(1e-6·||div||∞, storage floor)` or the
/// fixed sweep budget is exhausted (an honest `InvalidState` error). `lo` is an
/// optional same-length scratch holding the pressure's low word, which turns
/// the solve into double-single arithmetic and removes the f32 storage floor;
/// `p` is reused across calls as the warm start. The velocity correction
/// `v -= nf·∇_forward p` is applied to every velocity sample the backward
/// divergence reads — including the left/top edge samples through their
/// ghost pressures — which makes `v` discretely divergence-free to the same
/// tolerance on every interior cell; edge velocities are deliberately not
/// re-mirrored afterwards because that would break the identity. After the
/// correction, `div` is rewritten with the true post-projection divergence,
/// and its two boundary ghost cells [0]/[1] (never read as divergence
/// samples) record the sweep count and the achieved residual for the caller.
fn projection(
    c: &FluidConfig,
    vx: &mut [f32],
    vy: &mut [f32],
    p: &mut [f32],
    div: &mut [f32],
    mut lo: Option<&mut [f32]>,
) -> Result<(), KernelError> {
    let n = c.n;
    let nf = n as f64;
    // Fresh velocity ghosts make the measured divergence well-defined before
    // the constraint is formed (the inlet face lives in vx's left column).
    bnd(c, 1, vx)?;
    bnd(c, 2, vy)?;
    if c.inlet_speed.is_none() {
        // Closed grid: the discrete Neumann problem is singular — solvable
        // only when the divergence RHS sums to zero, i.e. when net flux into
        // the interior control volume vanishes. The backward-difference
        // control volume ends at the right/bottom interior ring, the only
        // CV-boundary faces whose velocity is a free interior sample, so any
        // advection-created net expansion is absorbed there by a uniform
        // compensating shift — the closed-box analogue of the inlet scene's
        // Dirichlet pressure outlet. This beats removing the RHS mean, which
        // would leave the imbalance behind as a uniform residual divergence.
        let mut net: f64 = 0.;
        for j in 1..n - 1 {
            net += vx[n - 2 + j * n] as f64 - vx[j * n] as f64;
        }
        for i in 1..n - 1 {
            net += vy[i + (n - 2) * n] as f64 - vy[i] as f64;
        }
        let delta = field_value(net / (2. * (n - 2) as f64))? as f64;
        for j in 1..n - 1 {
            let k = n - 2 + j * n;
            vx[k] = field_value(vx[k] as f64 - delta)?;
        }
        for i in 1..n - 1 {
            let k = i + (n - 2) * n;
            vy[k] = field_value(vy[k] as f64 - delta)?;
        }
    }
    divergence(c, vx, vy, div)?;
    if let Some(l) = lo.as_deref_mut() {
        l.fill(0.);
    }
    bnd(c, 3, p)?;
    // Classical SOR optimum is 2/(1+sin(π/(n-1))) for the Dirichlet Poisson
    // problem; on this mostly-Neumann system the empirically faster factor
    // sits ~2% higher (≈1.98 at n≈100), still safely inside the 0<ω<2
    // convergence region of the SPD operator.
    let omega =
        (2.04 / (1. + sin_cos(core::f64::consts::PI / (n - 1) as f64)?.0)).min(1.98);
    let mut rhs_max: f64 = 0.;
    for j in 1..n - 1 {
        for i in 1..n - 1 {
            rhs_max = rhs_max.max((div[i + j * n] as f64).abs());
        }
    }
    let relative = SOLVE_REL_TOL * rhs_max;
    let storage = if lo.is_some() {
        SOLVE_STORE_TOL * f32::EPSILON as f64
    } else {
        SOLVE_STORE_TOL
    };
    // Exact f64 residual r = div - L·p of the current stored iterate.
    let (mut residual, mut p_max) = match lo.as_deref() {
        Some(l) => projection_residual::<true>(n, p, div, l, 0.),
        None => projection_residual::<false>(n, p, div, &[], 0.),
    };
    let mut iterations: u32 = 0;
    while residual > relative.max(storage * p_max).max(SOLVE_ABS_TOL) {
        if iterations >= PROJECTION_MAX_SWEEPS {
            // Honest non-convergence: velocities are left uncorrected and must
            // be discarded rather than silently reported as incompressible.
            return Err(KernelError::InvalidState);
        }
        for j in 1..n - 1 {
            for i in 1..n - 1 {
                let k = i + j * n;
                let (pk, nb) = match lo.as_deref() {
                    Some(l) => (
                        p[k] as f64 + l[k] as f64,
                        (p[k - 1] as f64 + l[k - 1] as f64)
                            + (p[k + 1] as f64 + l[k + 1] as f64)
                            + (p[k - n] as f64 + l[k - n] as f64)
                            + (p[k + n] as f64 + l[k + n] as f64),
                    ),
                    None => (
                        p[k] as f64,
                        p[k - 1] as f64 + p[k + 1] as f64 + p[k - n] as f64 + p[k + n] as f64,
                    ),
                };
                let next = pk + 0.25 * omega * (div[k] as f64 - (4. * pk - nb));
                let hi = field_value(next)?;
                p[k] = hi;
                if let Some(l) = lo.as_deref_mut() {
                    l[k] = (next - hi as f64) as f32;
                }
            }
        }
        bnd(c, 3, p)?;
        if let Some(l) = lo.as_deref_mut() {
            bnd(c, 3, l)?;
        }
        iterations += 1;
        if iterations % PROJECTION_RESIDUAL_EVERY == 0 || iterations == PROJECTION_MAX_SWEEPS {
            (residual, p_max) = match lo.as_deref() {
                Some(l) => projection_residual::<true>(n, p, div, l, p_max),
                None => projection_residual::<false>(n, p, div, &[], p_max),
            };
        }
    }
    // v -= nf·∇_forward p on every sample the backward divergence touches:
    // vx at columns 0..=n-2 (the left edge is corrected through its ghost
    // pressure) and vy at rows 0..=n-2 likewise. No velocity bnd afterwards:
    // re-mirroring the edges would overwrite exactly the samples that make the
    // discrete divergence identity hold.
    for j in 1..n - 1 {
        for i in 0..n - 1 {
            let k = i + j * n;
            let (pe, pk) = match lo.as_deref() {
                Some(l) => (p[k + 1] as f64 + l[k + 1] as f64, p[k] as f64 + l[k] as f64),
                None => (p[k + 1] as f64, p[k] as f64),
            };
            vx[k] = field_value(vx[k] as f64 - nf * (pe - pk))?;
        }
    }
    for j in 0..n - 1 {
        for i in 1..n - 1 {
            let k = i + j * n;
            let (ps, pk) = match lo.as_deref() {
                Some(l) => (p[k + n] as f64 + l[k + n] as f64, p[k] as f64 + l[k] as f64),
                None => (p[k + n] as f64, p[k] as f64),
            };
            vy[k] = field_value(vy[k] as f64 - nf * (ps - pk))?;
        }
    }
    // Recompute div as the true post-projection divergence of the stored
    // velocity; then record the solver bookkeeping in unused ghost cells.
    divergence(c, vx, vy, div)?;
    div[0] = iterations as f32;
    div[1] = residual as f32;
    Ok(())
}
pub fn project(
    c: &FluidConfig,
    vx: &mut [f32],
    vy: &mut [f32],
    p: &mut [f32],
    div: &mut [f32],
) -> Result<(), KernelError> {
    fields(c, &[vx, vy, p, div])?;
    projection(c, vx, vy, p, div, None)
}
fn advection(
    c: &FluidConfig,
    b: u32,
    d: &mut [f32],
    d0: &[f32],
    vx: &[f32],
    vy: &[f32],
) -> Result<(), KernelError> {
    let n = c.n;
    let dt = c.dt * (n - 2) as f64;
    for j in 1..n - 1 {
        for i in 1..n - 1 {
            let k = i + j * n;
            let xx = i as f64 - dt * vx[k] as f64;
            let yy = j as f64 - dt * vy[k] as f64;
            if !xx.is_finite() || !yy.is_finite() {
                return Err(KernelError::NonFiniteValue);
            }
            let x = xx.clamp(0.5, n as f64 - 1.5);
            let y = yy.clamp(0.5, n as f64 - 1.5);
            let i0 = x as usize;
            let i1 = i0 + 1;
            let j0 = y as usize;
            let j1 = j0 + 1;
            let s1 = x - i0 as f64;
            let s0 = 1. - s1;
            let t1 = y - j0 as f64;
            let t0 = 1. - t1;
            d[k] = field_value(
                s0 * (t0 * d0[i0 + j0 * n] as f64 + t1 * d0[i0 + j1 * n] as f64)
                    + s1 * (t0 * d0[i1 + j0 * n] as f64 + t1 * d0[i1 + j1 * n] as f64),
            )?;
        }
    }
    bnd(c, b, d)
}
pub fn advect(
    c: &FluidConfig,
    b: u32,
    d: &mut [f32],
    d0: &[f32],
    vx: &[f32],
    vy: &[f32],
) -> Result<(), KernelError> {
    fields(c, &[d, d0, vx, vy])?;
    boundary_kind(b)?;
    advection(c, b, d, d0, vx, vy)
}
pub fn apply_buoyancy(c: &FluidConfig, vy: &mut [f32], temp: &[f32]) -> Result<(), KernelError> {
    fields(c, &[vy, temp])?;
    buoyancy(c, vy, temp)
}
fn buoyancy(c: &FluidConfig, vy: &mut [f32], temp: &[f32]) -> Result<(), KernelError> {
    if c.thermal && c.buoyancy != 0. {
        for j in 1..c.n - 1 {
            for i in 1..c.n - 1 {
                let k = i + j * c.n;
                vy[k] =
                    field_value(vy[k] as f64 - c.dt * c.buoyancy * (temp[k] as f64 - c.ambient))?;
            }
        }
    }
    Ok(())
}
fn obstacle(mask: Option<&[u8]>, vx: &mut [f32], vy: &mut [f32], dens: &mut [f32]) {
    if let Some(mask) = mask {
        for (i, &m) in mask.iter().enumerate() {
            if m != 0 {
                vx[i] = 0.;
                vy[i] = 0.;
                dens[i] = 0.;
            }
        }
    }
}
pub fn apply_obstacle(
    c: &FluidConfig,
    vx: &mut [f32],
    vy: &mut [f32],
    dens: &mut [f32],
    mask: Option<&[u8]>,
) -> Result<(), KernelError> {
    fields(c, &[vx, vy, dens])?;
    if mask.is_some_and(|m| m.len() != vx.len()) {
        return Err(KernelError::BufferLength);
    }
    obstacle(mask, vx, vy, dens);
    Ok(())
}
fn state(c: &FluidConfig, s: &FluidBuffers<'_>, mask: Option<&[u8]>) -> Result<(), KernelError> {
    fields(
        c,
        &[
            s.vx, s.vy, s.vx0, s.vy0, s.dens, s.dens0, s.p, s.div, s.scalar0, s.temp,
        ],
    )?;
    if mask.is_some_and(|m| m.len() != s.vx.len()) {
        return Err(KernelError::BufferLength);
    }
    Ok(())
}
fn step(c: &FluidConfig, s: &mut FluidBuffers<'_>, mask: Option<&[u8]>) -> Result<(), KernelError> {
    buoyancy(c, s.vy, s.temp)?;
    obstacle(mask, s.vx, s.vy, s.dens);
    if c.inlet_speed.is_some() {
        bnd(c, 1, s.vx)?;
        bnd(c, 2, s.vy)?;
    }
    if c.viscosity > 0. {
        diffusion(c, 1, s.vx0, s.vx, c.viscosity)?;
        diffusion(c, 2, s.vy0, s.vy, c.viscosity)?;
        projection(c, s.vx0, s.vy0, s.p, s.div, Some(s.dens0))?;
    } else {
        projection(c, s.vx, s.vy, s.p, s.div, Some(s.dens0))?;
        s.vx0.copy_from_slice(s.vx);
        s.vy0.copy_from_slice(s.vy);
    }
    advection(c, 1, s.vx, s.vx0, s.vx0, s.vy0)?;
    advection(c, 2, s.vy, s.vy0, s.vx0, s.vy0)?;
    obstacle(mask, s.vx, s.vy, s.dens);
    projection(c, s.vx, s.vy, s.p, s.div, Some(s.dens0))?;
    obstacle(mask, s.vx, s.vy, s.dens);
    if c.thermal {
        s.scalar0.copy_from_slice(s.temp);
        advection(c, 0, s.temp, s.scalar0, s.vx, s.vy)?;
    }
    if c.diffusion > 0. {
        diffusion(c, 0, s.dens0, s.dens, c.diffusion)?;
    }
    s.scalar0
        .copy_from_slice(if c.diffusion > 0. { s.dens0 } else { s.dens });
    advection(c, 0, s.dens, s.scalar0, s.vx, s.vy)?;
    obstacle(mask, s.vx, s.vy, s.dens);
    // 染料是非负示踪量；隐式扩散解的 ~1e-13 级残差噪声不应穿透到输出。
    s.dens.iter_mut().for_each(|v| {
        if *v < 0. {
            *v = 0.;
        }
    });
    Ok(())
}
pub fn step_fluid(
    c: &FluidConfig,
    s: &mut FluidBuffers<'_>,
    mask: Option<&[u8]>,
) -> Result<(), KernelError> {
    state(c, s, mask)?;
    step(c, s, mask)
}
pub fn advance_fluid(
    c: &FluidConfig,
    s: &mut FluidBuffers<'_>,
    mask: Option<&[u8]>,
    source: &FluidSource,
) -> Result<(), KernelError> {
    state(c, s, mask)?;
    if ![source.density_decay, source.temperature_cooling]
        .iter()
        .all(|v| v.is_finite() && *v >= 0.)
    {
        return Err(KernelError::InvalidCoefficient);
    }
    if let Some(dye) = source.dye {
        if !dye.density.is_finite()
            || !dye.spacing.is_finite()
            || dye.spacing <= 0.
            || !dye.width.is_finite()
            || dye.width < 0.
        {
            return Err(KernelError::InvalidCoefficient);
        }
        for y in 1..c.n - 1 {
            let value = field_value(if (y as f64) % dye.spacing < dye.width {
                dye.density
            } else {
                0.
            })?;
            s.dens[y * c.n + 1] = value;
            s.dens[y * c.n] = value;
        }
    }
    step(c, s, mask)?;
    // Even factors of one follow the original f64 operation / f32 store.
    for d in s.dens.iter_mut() {
        *d = field_value(*d as f64 * source.density_decay)?;
    }
    for t in s.temp.iter_mut() {
        *t = field_value(*t as f64 * source.temperature_cooling)?;
    }
    Ok(())
}
pub fn max_divergence(vx: &[f32], vy: &[f32], n: usize, margin: usize) -> Result<f64, KernelError> {
    if n < 3 || margin > n {
        return Err(KernelError::InvalidDimensions);
    }
    let len = n.checked_mul(n).ok_or(KernelError::InvalidDimensions)?;
    if vx.len() != len || vy.len() != len {
        return Err(KernelError::BufferLength);
    }
    if vx.iter().chain(vy.iter()).any(|v| !v.is_finite()) {
        return Err(KernelError::NonFiniteValue);
    }
    // Backward difference: the exact divergence the pressure projection
    // drives to its residual tolerance, in velocity-difference units.
    let mut max: f64 = 0.;
    for y in margin..n - margin {
        for x in margin..n - margin {
            let dv = vx[x + y * n] as f64 - vx[x.saturating_sub(1) + y * n] as f64
                + vy[x + y * n] as f64
                - vy[x + y.saturating_sub(1) * n] as f64;
            max = max.max(dv.abs());
        }
    }
    Ok(max)
}
pub fn read_fluid(
    c: &FluidConfig,
    vx: &[f32],
    vy: &[f32],
    dens: &[f32],
    temp: &[f32],
    margin: usize,
) -> Result<FluidStats, KernelError> {
    fields(c, &[vx, vy, dens, temp])?;
    let mut peak: f64 = 0.;
    let mut sum = 0.;
    let mut v2: f64 = 0.;
    let mut tmin = f64::INFINITY;
    let mut tmax = f64::NEG_INFINITY;
    for i in 0..dens.len() {
        peak = peak.max(dens[i] as f64);
        sum += dens[i] as f64;
        v2 = v2.max(vx[i] as f64 * vx[i] as f64 + vy[i] as f64 * vy[i] as f64);
        tmin = tmin.min(temp[i] as f64);
        tmax = tmax.max(temp[i] as f64);
    }
    Ok(FluidStats {
        peak_density: peak,
        mean_density: sum / dens.len() as f64,
        max_speed: sqrt(v2)?,
        min_temperature: tmin,
        max_temperature: tmax,
        max_divergence: max_divergence(vx, vy, c.n, margin)?,
    })
}
