//! Reduced-unit 2D TMz Yee update, preserving the existing product step order.
//! Cell-major f32 fields, f64 arithmetic; no source waveform/model generation.
//!
//! Outer-boundary choices: first-order Mur (`Mur`), PEC walls (`Pec`),
//! second-order Mur (`Mur2`, Taflove & Hagness 3rd ed. §6.4.2) and a
//! complex-frequency-shifted convolutional PML (`Cpml`, Roden–Gedney CFS-PML).
//! `Mur2` and `Cpml` need extra per-edge histories or ψ auxiliaries supplied
//! through [`step_fdtd_ex`]; [`step_fdtd`] keeps the original Mur/Pec surface.
//! WASM ABI codes: Mur = 0, Pec = 1, Mur2 = 2, Cpml = 3.
use crate::{cells, exp_negative, field_value, KernelError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FdtdBoundary {
    /// First-order Mur radiation boundary (WASM ABI code 0).
    Mur,
    /// Perfect electric conductor walls: boundary Ez = 0 (WASM ABI code 1).
    Pec,
    /// Second-order Mur radiation boundary (WASM ABI code 2); requires
    /// [`FdtdMur2`] second time-level histories via [`step_fdtd_ex`].
    Mur2,
    /// CFS-PML absorbing layer (WASM ABI code 3); requires [`FdtdCpml`]
    /// ψ convolution state via [`step_fdtd_ex`].
    Cpml,
}

#[derive(Clone, Copy, Debug)]
pub struct FdtdConfig {
    pub nx: usize,
    pub ny: usize,
    pub dt: f64,
    /// Uniform reduced permeability; permittivity is supplied per cell.
    pub mu: f64,
    pub boundary: FdtdBoundary,
}

pub struct FdtdBuffers<'a> {
    pub ez: &'a mut [f32],
    pub hx: &'a mut [f32],
    pub hy: &'a mut [f32],
    pub prev_left: &'a mut [f32],
    pub prev_right: &'a mut [f32],
    pub prev_bottom: &'a mut [f32],
    pub prev_top: &'a mut [f32],
}

/// Second time-level histories for [`FdtdBoundary::Mur2`]. The second-order
/// update mixes `E^{n+1}`, `E^n` and `E^{n-1}` at the boundary cell and at the
/// first interior cell; `FdtdBuffers::prev_*` already hold `E^n` interior, so
/// these slices store the `E^{n-1}` pair. Left/right slices have length `ny`,
/// bottom/top `nx`. All start at zero.
pub struct FdtdMur2<'a> {
    /// `E^{n-1}` at the boundary cell `i = 0`, indexed by row `j`.
    pub left: &'a mut [f32],
    /// `E^{n-1}` at the boundary cell `i = nx - 1`, indexed by row `j`.
    pub right: &'a mut [f32],
    /// `E^{n-1}` at the boundary cell `j = 0`, indexed by column `i`.
    pub bottom: &'a mut [f32],
    /// `E^{n-1}` at the boundary cell `j = ny - 1`, indexed by column `i`.
    pub top: &'a mut [f32],
    /// `E^{n-1}` at the interior cell `i = 1`, indexed by row `j`.
    pub left_inner: &'a mut [f32],
    /// `E^{n-1}` at the interior cell `i = nx - 2`, indexed by row `j`.
    pub right_inner: &'a mut [f32],
    /// `E^{n-1}` at the interior cell `j = 1`, indexed by column `i`.
    pub bottom_inner: &'a mut [f32],
    /// `E^{n-1}` at the interior cell `j = ny - 2`, indexed by column `i`.
    pub top_inner: &'a mut [f32],
}

/// Roden–Gedney ψ convolution auxiliaries for [`FdtdBoundary::Cpml`]. Each ψ
/// is a full-grid `nx·ny` f32 array (4·n·4 B ≈ 640 kB at 200×200); entries
/// outside the PML strips stay zero. All start at zero.
pub struct FdtdCpml<'a> {
    /// ψ on the `∂Hy/∂x` term of the `Ez` update (left/right strips).
    pub psi_ez_x: &'a mut [f32],
    /// ψ on the `∂Hx/∂y` term of the `Ez` update (bottom/top strips).
    pub psi_ez_y: &'a mut [f32],
    /// ψ on the `∂Ez/∂y` term of the `Hx` update (bottom/top strips).
    pub psi_hx_y: &'a mut [f32],
    /// ψ on the `∂Ez/∂x` term of the `Hy` update (left/right strips).
    pub psi_hy_x: &'a mut [f32],
}

/// CPML cells per side before clamping to `(n - 2) / 2` on small grids.
pub const CPML_CELLS: usize = 10;
/// Polynomial grading order m for σ and κ across the layer (Taflove §7.5.2).
pub const CPML_ORDER: u32 = 3;
/// κ_max at the outer wall; 1 keeps plain σ-only coordinate stretching.
pub const CPML_KAPPA_MAX: f64 = 1.;
/// σ_max = 0.8·(m + 1)/(η·Δx), the usual optimal-conductivity estimate;
/// reduced units η = √(μ/ε) = 1, Δx = 1.
pub const CPML_SIGMA_MAX: f64 = 0.8 * (CPML_ORDER as f64 + 1.);
/// α_max of the complex frequency shift, largest at the inner PML interface
/// and graded linearly to zero at the outer wall.
pub const CPML_ALPHA_MAX: f64 = 0.24;

impl FdtdConfig {
    pub fn cell_count(&self) -> Result<usize, KernelError> {
        if self.nx < 3 || self.ny < 3 {
            return Err(KernelError::InvalidDimensions);
        }
        cells(self.nx, self.ny)
    }

    fn validate(&self, eps: &[f32]) -> Result<usize, KernelError> {
        let n = self.cell_count()?;
        if eps.len() != n {
            return Err(KernelError::BufferLength);
        }
        if !self.dt.is_finite() || self.dt <= 0. || !self.mu.is_finite() || self.mu <= 0. {
            return Err(KernelError::InvalidCoefficient);
        }
        let mut min_eps = f64::INFINITY;
        for &e in eps {
            if !e.is_finite() || e <= 0. {
                return Err(KernelError::InvalidCoefficient);
            }
            min_eps = min_eps.min(e as f64);
        }
        // The fastest material controls the 2D CFL bound, not vacuum alone.
        // This ordering avoids squaring a potentially very large dt.
        let courant_squared = (self.dt / self.mu) * (self.dt / min_eps) * 2.;
        if !courant_squared.is_finite() || courant_squared > 1. {
            return Err(KernelError::InvalidCoefficient);
        }
        Ok(n)
    }
}

fn finite_fields(fields: &[&[f32]]) -> Result<(), KernelError> {
    if fields
        .iter()
        .any(|field| field.iter().any(|v| !v.is_finite()))
    {
        return Err(KernelError::NonFiniteValue);
    }
    Ok(())
}

/// Roden–Gedney recursive-convolution pair at `depth` cells into a layer of
/// `layer` cells (depth = layer at the outer wall, → 0 at the interface):
/// `b = exp(-(σ/κ + α)·dt)`, `c = σ·(b − 1)/(σ·κ + κ²·α)`, reduced ε₀ = Δx = 1.
fn cpml_bc(depth: f64, layer: f64, dt: f64) -> Result<(f64, f64), KernelError> {
    let t = depth / layer;
    let mut grading = 1.;
    for _ in 0..CPML_ORDER {
        grading *= t;
    }
    let sigma = CPML_SIGMA_MAX * grading;
    let kappa = 1. + (CPML_KAPPA_MAX - 1.) * grading;
    let alpha = CPML_ALPHA_MAX * (1. - t);
    let b = exp_negative((sigma / kappa + alpha) * dt)?;
    let denominator = sigma * kappa + kappa * kappa * alpha;
    let c = if denominator > 0. {
        sigma * (b - 1.) / denominator
    } else {
        0.
    };
    Ok((b, c))
}

/// In-place H -> E -> PEC mask -> boundary -> history update.
/// Mur preserves the product's vacuum coefficient (dt-1)/(dt+1), including the
/// left/right-before-bottom/top corner ordering. Masked outer cells are then
/// subject to the selected outer boundary, exactly as in the original product.
/// `Mur2` and `Cpml` are only available through [`step_fdtd_ex`], which carries
/// their extra state; this entry point answers `UnsupportedFeature` for them.
/// On arithmetic failure discard the partially updated state; input validation
/// (dimensions, coefficients, lengths, finite values) runs before any mutation.
pub fn step_fdtd(
    config: &FdtdConfig,
    eps: &[f32],
    pec_mask: Option<&[u8]>,
    state: &mut FdtdBuffers<'_>,
) -> Result<(), KernelError> {
    step_fdtd_impl(config, eps, pec_mask, state, None, None)
}

/// Same update as [`step_fdtd`] with the additional absorbing-boundary state.
/// `boundary == Mur2` requires `mur2` (eight edge slices, all zeroed at start);
/// `boundary == Cpml` requires `cpml` (four full-grid ψ arrays). Extra state
/// the selected boundary does not need is ignored, so callers may always pass
/// both. `Mur`/`Pec` accept `None` for both and match [`step_fdtd`] exactly.
pub fn step_fdtd_ex(
    config: &FdtdConfig,
    eps: &[f32],
    pec_mask: Option<&[u8]>,
    state: &mut FdtdBuffers<'_>,
    mur2: Option<&mut FdtdMur2<'_>>,
    cpml: Option<&mut FdtdCpml<'_>>,
) -> Result<(), KernelError> {
    step_fdtd_impl(config, eps, pec_mask, state, mur2, cpml)
}

fn step_fdtd_impl(
    config: &FdtdConfig,
    eps: &[f32],
    pec_mask: Option<&[u8]>,
    state: &mut FdtdBuffers<'_>,
    mur2: Option<&mut FdtdMur2<'_>>,
    mut cpml: Option<&mut FdtdCpml<'_>>,
) -> Result<(), KernelError> {
    let n = config.validate(eps)?;
    let FdtdConfig {
        nx,
        ny,
        dt,
        mu,
        boundary,
    } = *config;
    if state.ez.len() != n
        || state.hx.len() != n
        || state.hy.len() != n
        || state.prev_left.len() != ny
        || state.prev_right.len() != ny
        || state.prev_bottom.len() != nx
        || state.prev_top.len() != nx
        || pec_mask.is_some_and(|mask| mask.len() != n)
    {
        return Err(KernelError::BufferLength);
    }
    finite_fields(&[
        state.ez,
        state.hx,
        state.hy,
        state.prev_left,
        state.prev_right,
        state.prev_bottom,
        state.prev_top,
    ])?;
    match boundary {
        FdtdBoundary::Mur2 => {
            let m2 = mur2.as_deref().ok_or(KernelError::UnsupportedFeature)?;
            if m2.left.len() != ny
                || m2.right.len() != ny
                || m2.bottom.len() != nx
                || m2.top.len() != nx
                || m2.left_inner.len() != ny
                || m2.right_inner.len() != ny
                || m2.bottom_inner.len() != nx
                || m2.top_inner.len() != nx
            {
                return Err(KernelError::BufferLength);
            }
            finite_fields(&[
                m2.left,
                m2.right,
                m2.bottom,
                m2.top,
                m2.left_inner,
                m2.right_inner,
                m2.bottom_inner,
                m2.top_inner,
            ])?;
        }
        FdtdBoundary::Cpml => {
            let p = cpml.as_deref().ok_or(KernelError::UnsupportedFeature)?;
            if p.psi_ez_x.len() != n
                || p.psi_ez_y.len() != n
                || p.psi_hx_y.len() != n
                || p.psi_hy_x.len() != n
            {
                return Err(KernelError::BufferLength);
            }
            finite_fields(&[p.psi_ez_x, p.psi_ez_y, p.psi_hx_y, p.psi_hy_x])?;
        }
        _ => {}
    }
    let coef = dt / mu;
    for j in 0..ny {
        for i in 0..nx {
            let k = j * nx + i;
            let dy = if j + 1 < ny {
                state.ez[k + nx] as f64 - state.ez[k] as f64
            } else {
                0.
            };
            state.hx[k] = field_value(state.hx[k] as f64 - coef * dy)?;
            let dx = if i + 1 < nx {
                state.ez[k + 1] as f64 - state.ez[k] as f64
            } else {
                0.
            };
            state.hy[k] = field_value(state.hy[k] as f64 + coef * dx)?;
        }
    }
    if boundary == FdtdBoundary::Cpml {
        let p = cpml.as_deref_mut().ok_or(KernelError::UnsupportedFeature)?;
        let px = CPML_CELLS.min((nx - 2) / 2);
        let py = CPML_CELLS.min((ny - 2) / 2);
        if px > 0 {
            // ψ_hy_x at Hy nodes i+1/2 inside the left/right x-PML strips:
            // ψ ← b·ψ + c·∂Ez/∂x, then Hy += (dt/μ)·ψ.
            for i in 0..px {
                let (b, c) = cpml_bc(px as f64 - i as f64 - 0.5, px as f64, dt)?;
                for j in 0..ny {
                    let k = j * nx + i;
                    let d = if i + 1 < nx {
                        state.ez[k + 1] as f64 - state.ez[k] as f64
                    } else {
                        0.
                    };
                    let psi = field_value(b * p.psi_hy_x[k] as f64 + c * d)?;
                    p.psi_hy_x[k] = psi;
                    state.hy[k] = field_value(state.hy[k] as f64 + coef * psi as f64)?;
                }
            }
            let right_start = nx - 1 - px;
            for i in right_start..nx {
                let (b, c) = cpml_bc(i as f64 + 0.5 - right_start as f64, px as f64, dt)?;
                for j in 0..ny {
                    let k = j * nx + i;
                    let d = if i + 1 < nx {
                        state.ez[k + 1] as f64 - state.ez[k] as f64
                    } else {
                        0.
                    };
                    let psi = field_value(b * p.psi_hy_x[k] as f64 + c * d)?;
                    p.psi_hy_x[k] = psi;
                    state.hy[k] = field_value(state.hy[k] as f64 + coef * psi as f64)?;
                }
            }
        }
        if py > 0 {
            // ψ_hx_y at Hx nodes j+1/2 inside the bottom/top y-PML strips:
            // ψ ← b·ψ + c·∂Ez/∂y, then Hx -= (dt/μ)·ψ.
            for j in 0..py {
                let (b, c) = cpml_bc(py as f64 - j as f64 - 0.5, py as f64, dt)?;
                for i in 0..nx {
                    let k = j * nx + i;
                    let d = if j + 1 < ny {
                        state.ez[k + nx] as f64 - state.ez[k] as f64
                    } else {
                        0.
                    };
                    let psi = field_value(b * p.psi_hx_y[k] as f64 + c * d)?;
                    p.psi_hx_y[k] = psi;
                    state.hx[k] = field_value(state.hx[k] as f64 - coef * psi as f64)?;
                }
            }
            let top_start = ny - 1 - py;
            for j in top_start..ny {
                let (b, c) = cpml_bc(j as f64 + 0.5 - top_start as f64, py as f64, dt)?;
                for i in 0..nx {
                    let k = j * nx + i;
                    let d = if j + 1 < ny {
                        state.ez[k + nx] as f64 - state.ez[k] as f64
                    } else {
                        0.
                    };
                    let psi = field_value(b * p.psi_hx_y[k] as f64 + c * d)?;
                    p.psi_hx_y[k] = psi;
                    state.hx[k] = field_value(state.hx[k] as f64 - coef * psi as f64)?;
                }
            }
        }
    }
    for j in 1..ny - 1 {
        for i in 1..nx - 1 {
            let k = j * nx + i;
            let curl = (state.hy[k] as f64 - state.hy[k - 1] as f64)
                - (state.hx[k] as f64 - state.hx[k - nx] as f64);
            state.ez[k] = field_value(state.ez[k] as f64 + (dt / eps[k] as f64) * curl)?;
        }
    }
    if boundary == FdtdBoundary::Cpml {
        let p = cpml.as_deref_mut().ok_or(KernelError::UnsupportedFeature)?;
        let px = CPML_CELLS.min((nx - 2) / 2);
        let py = CPML_CELLS.min((ny - 2) / 2);
        if px > 0 {
            // ψ_ez_x at Ez nodes inside the left/right strips (interior cells
            // only): ψ ← b·ψ + c·∂Hy/∂x, then Ez += (dt/ε)·ψ.
            for i in 1..px.min(nx - 1) {
                let (b, c) = cpml_bc(px as f64 - i as f64, px as f64, dt)?;
                for j in 1..ny - 1 {
                    let k = j * nx + i;
                    let d = state.hy[k] as f64 - state.hy[k - 1] as f64;
                    let psi = field_value(b * p.psi_ez_x[k] as f64 + c * d)?;
                    p.psi_ez_x[k] = psi;
                    state.ez[k] =
                        field_value(state.ez[k] as f64 + (dt / eps[k] as f64) * psi as f64)?;
                }
            }
            let right_start = nx - 1 - px;
            for i in (right_start + 1).max(1)..nx - 1 {
                let (b, c) = cpml_bc(i as f64 - right_start as f64, px as f64, dt)?;
                for j in 1..ny - 1 {
                    let k = j * nx + i;
                    let d = state.hy[k] as f64 - state.hy[k - 1] as f64;
                    let psi = field_value(b * p.psi_ez_x[k] as f64 + c * d)?;
                    p.psi_ez_x[k] = psi;
                    state.ez[k] =
                        field_value(state.ez[k] as f64 + (dt / eps[k] as f64) * psi as f64)?;
                }
            }
        }
        if py > 0 {
            // ψ_ez_y at Ez nodes inside the bottom/top strips; the term enters
            // the Ez update with a minus sign (-(∂Hx/∂y + ψ)).
            for j in 1..py.min(ny - 1) {
                let (b, c) = cpml_bc(py as f64 - j as f64, py as f64, dt)?;
                for i in 1..nx - 1 {
                    let k = j * nx + i;
                    let d = state.hx[k] as f64 - state.hx[k - nx] as f64;
                    let psi = field_value(b * p.psi_ez_y[k] as f64 + c * d)?;
                    p.psi_ez_y[k] = psi;
                    state.ez[k] =
                        field_value(state.ez[k] as f64 - (dt / eps[k] as f64) * psi as f64)?;
                }
            }
            let top_start = ny - 1 - py;
            for j in (top_start + 1).max(1)..ny - 1 {
                let (b, c) = cpml_bc(j as f64 - top_start as f64, py as f64, dt)?;
                for i in 1..nx - 1 {
                    let k = j * nx + i;
                    let d = state.hx[k] as f64 - state.hx[k - nx] as f64;
                    let psi = field_value(b * p.psi_ez_y[k] as f64 + c * d)?;
                    p.psi_ez_y[k] = psi;
                    state.ez[k] =
                        field_value(state.ez[k] as f64 - (dt / eps[k] as f64) * psi as f64)?;
                }
            }
        }
    }
    if let Some(mask) = pec_mask {
        for (e, &flag) in state.ez.iter_mut().zip(mask) {
            if flag != 0 {
                *e = 0.;
            }
        }
    }
    match boundary {
        FdtdBoundary::Pec | FdtdBoundary::Cpml => {
            // PEC walls; for Cpml this is the PEC backing closing the layer.
            for i in 0..nx {
                state.ez[i] = 0.;
                state.ez[(ny - 1) * nx + i] = 0.;
            }
            for j in 0..ny {
                state.ez[j * nx] = 0.;
                state.ez[j * nx + nx - 1] = 0.;
            }
            return Ok(());
        }
        FdtdBoundary::Mur => {}
        FdtdBoundary::Mur2 => {
            let m2 = mur2.ok_or(KernelError::UnsupportedFeature)?;
            // Taflove 2nd-order Mur, e.g. left edge i = 0:
            // E^{n+1}(0,j) = -E^{n-1}(1,j) + k1·(E^{n+1}(1,j) + E^{n-1}(0,j))
            //   + k2·(E^n(0,j) + E^n(1,j))
            //   + k3·(E^n(0,j+1) - 2E^n(0,j) + E^n(0,j-1)
            //        + E^n(1,j+1) - 2E^n(1,j) + E^n(1,j-1)),
            // k1 = (dt-1)/(dt+1), k2 = 2/(dt+1), k3 = dt²/(2(dt+1))
            // in reduced c = Δx = 1. The k3 tangential second difference is
            // what earns second order; without it the form collapses to Mur1
            // for near-normal waves. prev_* hold E^n(interior); the FdtdMur2
            // slices hold the E^{n-1} pair; all shift one level per edge.
            // Tangential terms read time-n neighbours along the edge, so each
            // edge walks upward carrying the just-overwritten cell in a rolling
            // variable. Corners use the first-order form: the second-order
            // stencil there mixes time levels across the two adjacent edges
            // and is unstable (the classic Mur2 corner blow-up).
            let k1 = (dt - 1.) / (dt + 1.);
            let k2 = 2. / (dt + 1.);
            let k3 = dt * dt / (2. * (dt + 1.));
            let mut lb_prev = state.ez[0] as f64;
            let mut rb_prev = state.ez[nx - 1] as f64;
            for j in 1..ny - 1 {
                let lb = j * nx;
                let e_bnd_n = state.ez[lb] as f64;
                let e_in_np1 = state.ez[lb + 1] as f64;
                let e_in_n = state.prev_left[j] as f64;
                let e_bnd_nm1 = m2.left[j] as f64;
                let e_in_nm1 = m2.left_inner[j] as f64;
                let tang = state.ez[lb + nx] as f64 - 2. * e_bnd_n + lb_prev
                    + state.prev_left[j + 1] as f64 - 2. * e_in_n
                    + state.prev_left[j - 1] as f64;
                lb_prev = e_bnd_n;
                state.ez[lb] = field_value(
                    -e_in_nm1 + k1 * (e_in_np1 + e_bnd_nm1)
                        + k2 * (e_bnd_n + e_in_n)
                        + k3 * tang,
                )?;
                m2.left[j] = e_bnd_n as f32;
                m2.left_inner[j] = e_in_n as f32;
                let rb = lb + nx - 1;
                let e_bnd_n = state.ez[rb] as f64;
                let e_in_np1 = state.ez[rb - 1] as f64;
                let e_in_n = state.prev_right[j] as f64;
                let e_bnd_nm1 = m2.right[j] as f64;
                let e_in_nm1 = m2.right_inner[j] as f64;
                let tang = state.ez[rb + nx] as f64 - 2. * e_bnd_n + rb_prev
                    + state.prev_right[j + 1] as f64 - 2. * e_in_n
                    + state.prev_right[j - 1] as f64;
                rb_prev = e_bnd_n;
                state.ez[rb] = field_value(
                    -e_in_nm1 + k1 * (e_in_np1 + e_bnd_nm1)
                        + k2 * (e_bnd_n + e_in_n)
                        + k3 * tang,
                )?;
                m2.right[j] = e_bnd_n as f32;
                m2.right_inner[j] = e_in_n as f32;
            }
            let mut bb_prev = state.ez[0] as f64;
            let mut tb_prev = state.ez[(ny - 1) * nx] as f64;
            for i in 1..nx - 1 {
                let e_bnd_n = state.ez[i] as f64;
                let e_in_np1 = state.ez[nx + i] as f64;
                let e_in_n = state.prev_bottom[i] as f64;
                let e_bnd_nm1 = m2.bottom[i] as f64;
                let e_in_nm1 = m2.bottom_inner[i] as f64;
                let tang = state.ez[i + 1] as f64 - 2. * e_bnd_n + bb_prev
                    + state.prev_bottom[i + 1] as f64 - 2. * e_in_n
                    + state.prev_bottom[i - 1] as f64;
                bb_prev = e_bnd_n;
                state.ez[i] = field_value(
                    -e_in_nm1 + k1 * (e_in_np1 + e_bnd_nm1)
                        + k2 * (e_bnd_n + e_in_n)
                        + k3 * tang,
                )?;
                m2.bottom[i] = e_bnd_n as f32;
                m2.bottom_inner[i] = e_in_n as f32;
                let top = (ny - 1) * nx + i;
                let e_bnd_n = state.ez[top] as f64;
                let e_in_np1 = state.ez[top - nx] as f64;
                let e_in_n = state.prev_top[i] as f64;
                let e_bnd_nm1 = m2.top[i] as f64;
                let e_in_nm1 = m2.top_inner[i] as f64;
                let tang = state.ez[top + 1] as f64 - 2. * e_bnd_n + tb_prev
                    + state.prev_top[i + 1] as f64 - 2. * e_in_n
                    + state.prev_top[i - 1] as f64;
                tb_prev = e_bnd_n;
                state.ez[top] = field_value(
                    -e_in_nm1 + k1 * (e_in_np1 + e_bnd_nm1)
                        + k2 * (e_bnd_n + e_in_n)
                        + k3 * tang,
                )?;
                m2.top[i] = e_bnd_n as f32;
                m2.top_inner[i] = e_in_n as f32;
            }
            for i in [0usize, nx - 1] {
                state.ez[i] = field_value(
                    state.prev_bottom[i] as f64
                        + k1 * (state.ez[nx + i] as f64 - state.ez[i] as f64),
                )?;
                let top = (ny - 1) * nx + i;
                state.ez[top] = field_value(
                    state.prev_top[i] as f64
                        + k1 * (state.ez[top - nx] as f64 - state.ez[top] as f64),
                )?;
            }
            // Same prev_* shift as the first-order path: interior E^{n+1}.
            for j in 0..ny {
                state.prev_left[j] = state.ez[j * nx + 1];
                state.prev_right[j] = state.ez[j * nx + nx - 2];
            }
            for i in 0..nx {
                state.prev_bottom[i] = state.ez[nx + i];
                state.prev_top[i] = state.ez[(ny - 2) * nx + i];
            }
            return Ok(());
        }
    }
    let c_mur = (dt - 1.) / (dt + 1.);
    for j in 0..ny {
        let lb = j * nx;
        state.ez[lb] = field_value(
            state.prev_left[j] as f64 + c_mur * (state.ez[lb + 1] as f64 - state.ez[lb] as f64),
        )?;
        let rb = lb + nx - 1;
        state.ez[rb] = field_value(
            state.prev_right[j] as f64 + c_mur * (state.ez[rb - 1] as f64 - state.ez[rb] as f64),
        )?;
    }
    for i in 0..nx {
        state.ez[i] = field_value(
            state.prev_bottom[i] as f64 + c_mur * (state.ez[nx + i] as f64 - state.ez[i] as f64),
        )?;
        let top = (ny - 1) * nx + i;
        state.ez[top] = field_value(
            state.prev_top[i] as f64 + c_mur * (state.ez[top - nx] as f64 - state.ez[top] as f64),
        )?;
    }
    for j in 0..ny {
        state.prev_left[j] = state.ez[j * nx + 1];
        state.prev_right[j] = state.ez[j * nx + nx - 2];
    }
    for i in 0..nx {
        state.prev_bottom[i] = state.ez[nx + i];
        state.prev_top[i] = state.ez[(ny - 2) * nx + i];
    }
    Ok(())
}

/// A prepared soft-source sample, with f64 addition and one f32 store.
/// Source timing/waveforms stay in the product's single preparation function.
pub fn add_soft_source(
    ez: &mut [f32],
    nx: usize,
    ny: usize,
    x: usize,
    y: usize,
    amplitude: f64,
) -> Result<(), KernelError> {
    if ez.len() != cells(nx, ny)? {
        return Err(KernelError::BufferLength);
    }
    if x >= nx || y >= ny {
        return Err(KernelError::InvalidDimensions);
    }
    if !amplitude.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    let k = y * nx + x;
    ez[k] = field_value(ez[k] as f64 + amplitude)?;
    Ok(())
}

/// Same sampled-energy diagnostic as the product: E and half-staggered H are
/// summed at their stored time levels. This is not an exactly conserved Yee
/// invariant or an engineering-accuracy claim.
pub fn energy_fdtd(
    config: &FdtdConfig,
    eps: &[f32],
    ez: &[f32],
    hx: &[f32],
    hy: &[f32],
) -> Result<f64, KernelError> {
    let n = config.validate(eps)?;
    if ez.len() != n || hx.len() != n || hy.len() != n {
        return Err(KernelError::BufferLength);
    }
    finite_fields(&[ez, hx, hy])?;
    let mut sum = 0.;
    for k in 0..n {
        let e = ez[k] as f64;
        let x = hx[k] as f64;
        let y = hy[k] as f64;
        sum += eps[k] as f64 * e * e + config.mu * (x * x + y * y);
    }
    let energy = 0.5 * sum;
    if !energy.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    Ok(energy)
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use std::vec::Vec;

    const NX: usize = 120;
    const NY: usize = 120;
    const DT: f64 = 0.5 / 1.414_213_562_373_095_1; // Courant S = 0.5

    /// Full state for every boundary mode; mur2/cpml extras are allocated up
    /// front so one constructor serves all `FdtdBoundary` values.
    struct Field {
        eps: Vec<f32>,
        ez: Vec<f32>,
        hx: Vec<f32>,
        hy: Vec<f32>,
        prev_left: Vec<f32>,
        prev_right: Vec<f32>,
        prev_bottom: Vec<f32>,
        prev_top: Vec<f32>,
        m2: [Vec<f32>; 8],
        psi: [Vec<f32>; 4],
    }

    impl Field {
        fn new(nx: usize, ny: usize) -> Self {
            let n = nx * ny;
            Self {
                eps: std::vec![1.; n],
                ez: std::vec![0.; n],
                hx: std::vec![0.; n],
                hy: std::vec![0.; n],
                prev_left: std::vec![0.; ny],
                prev_right: std::vec![0.; ny],
                prev_bottom: std::vec![0.; nx],
                prev_top: std::vec![0.; nx],
                m2: [
                    std::vec![0.; ny],
                    std::vec![0.; ny],
                    std::vec![0.; nx],
                    std::vec![0.; nx],
                    std::vec![0.; ny],
                    std::vec![0.; ny],
                    std::vec![0.; nx],
                    std::vec![0.; nx],
                ],
                psi: [
                    std::vec![0.; n],
                    std::vec![0.; n],
                    std::vec![0.; n],
                    std::vec![0.; n],
                ],
            }
        }

        fn step(&mut self, nx: usize, ny: usize, boundary: FdtdBoundary) {
            let config = FdtdConfig {
                nx,
                ny,
                dt: DT,
                mu: 1.,
                boundary,
            };
            let [ml, mr, mb, mt, mli, mri, mbi, mti] = &mut self.m2;
            let [pex, pey, phx, phy] = &mut self.psi;
            step_fdtd_ex(
                &config,
                &self.eps,
                None,
                &mut FdtdBuffers {
                    ez: &mut self.ez,
                    hx: &mut self.hx,
                    hy: &mut self.hy,
                    prev_left: &mut self.prev_left,
                    prev_right: &mut self.prev_right,
                    prev_bottom: &mut self.prev_bottom,
                    prev_top: &mut self.prev_top,
                },
                Some(&mut FdtdMur2 {
                    left: ml,
                    right: mr,
                    bottom: mb,
                    top: mt,
                    left_inner: mli,
                    right_inner: mri,
                    bottom_inner: mbi,
                    top_inner: mti,
                }),
                Some(&mut FdtdCpml {
                    psi_ez_x: pex,
                    psi_ez_y: pey,
                    psi_hx_y: phx,
                    psi_hy_x: phy,
                }),
            )
            .unwrap();
        }

        /// Sampled energy over the window `margin` cells inside the walls, so
        /// the Cpml measurement excludes fields still decaying inside the layer
        /// and every boundary is scored over the same interior.
        fn interior_energy(&self, nx: usize, ny: usize, margin: usize) -> f64 {
            let mut sum = 0.;
            for j in margin..ny - margin {
                for i in margin..nx - margin {
                    let k = j * nx + i;
                    let e = self.ez[k] as f64;
                    let x = self.hx[k] as f64;
                    let y = self.hy[k] as f64;
                    sum += e * e + x * x + y * y;
                }
            }
            0.5 * sum
        }
    }

    /// Center Gaussian soft source for 40 steps, then 560 steps of free
    /// radiation: the pulse crosses ~200 cells at c·dt ≈ 0.354 cells/step, so
    /// the residual is measured well after the first boundary reflection.
    fn absorbed_residual(boundary: FdtdBoundary) -> (f64, f64) {
        let mut field = Field::new(NX, NY);
        let margin = CPML_CELLS + 4;
        let mut peak = 0.;
        for t in 0..600 {
            if t < 40 {
                let x = (t as f64 - 18.) / 6.;
                let amp = exp_negative(0.5 * x * x).unwrap();
                add_soft_source(&mut field.ez, NX, NY, NX / 2, NY / 2, amp).unwrap();
            }
            field.step(NX, NY, boundary);
            let energy = field.interior_energy(NX, NY, margin);
            if energy > peak {
                peak = energy;
            }
        }
        (peak, field.interior_energy(NX, NY, margin))
    }

    #[test]
    fn mur2_and_cpml_reflect_less_than_mur1() {
        let (peak, mur1) = absorbed_residual(FdtdBoundary::Mur);
        let (_, mur2) = absorbed_residual(FdtdBoundary::Mur2);
        let (_, cpml) = absorbed_residual(FdtdBoundary::Cpml);
        std::eprintln!(
            "interior residual/peak: mur1 {mur1:.6} ({:.4}), mur2 {mur2:.6} ({:.5}), cpml {cpml:.6} ({:.6})",
            mur1 / peak,
            mur2 / peak,
            cpml / peak
        );
        // A point-source residual at t = 600 is dominated by grazing and
        // corner content, where second-order Mur and PML gains shrink to
        // factors of a few; the orders-of-magnitude check is the plane-wave
        // test below.
        assert!(peak > 0. && mur1 > 0.);
        assert!(mur2 < mur1 * 0.75, "mur2 {mur2} vs mur1 {mur1}");
        assert!(cpml < mur1 * 0.1, "cpml {cpml} vs mur1 {mur1}");
    }

    /// Plane-wave reflection coefficient per boundary, measured by reference
    /// subtraction. The test domain is 200 wide; the reference is 600 wide
    /// with identical source and left/top/bottom walls, so every echo except
    /// the test's right wall cancels in the difference. A tall domain keeps
    /// line-source end diffraction away from the probe during the first
    /// reflected packet, isolating the near-normal-incidence reflection.
    #[test]
    fn absorbing_modes_reduce_normal_incidence_reflection() {
        let (nx_t, nx_r, ny, steps) = (200usize, 600usize, 200usize, 900usize);
        let (probe_i, probe_j) = (170usize, ny / 2);
        let run = |nx: usize, boundary: FdtdBoundary| -> Vec<f64> {
            let mut f = Field::new(nx, ny);
            let mut rec = std::vec![0f64; steps];
            for t in 0..steps {
                if t < 400 {
                    // Smooth narrowband pulse: Mur's parasitic boundary modes
                    // respond mostly to the short-pulse edge.
                    let x = (t as f64 - 100.) / 24.;
                    let amp = exp_negative(0.5 * x * x).unwrap();
                    // Keep the soft source off the walls, matching the product
                    // source layout; a directly driven Mur2 boundary cell feeds
                    // the two-level recursion and can grow.
                    for j in 10..ny - 10 {
                        add_soft_source(&mut f.ez, nx, ny, 40, j, amp).unwrap();
                    }
                }
                f.step(nx, ny, boundary);
                rec[t] = f.ez[probe_j * nx + probe_i] as f64;
            }
            rec
        };
        // The wall echo returns to the probe near t ≈ 620–740 at S = 0.5
        // (wave speed 0.354 cells/step). The window captures the direct
        // near-normal reflected packet; earlier diff is Mur1-level
        // corner/oblique content both schemes share (Mur2 corners fall back
        // to first order), later diff includes re-reflections.
        let mut ratios = std::vec::Vec::new();
        for boundary in [
            FdtdBoundary::Mur,
            FdtdBoundary::Mur2,
            FdtdBoundary::Cpml,
        ] {
            let test = run(nx_t, boundary);
            let refr = run(nx_r, boundary);
            let mut inc = 0f64;
            let mut refp = 0f64;
            for t in 0..steps {
                inc = inc.max(refr[t].abs());
                if (600..780).contains(&t) {
                    refp = refp.max((test[t] - refr[t]).abs());
                }
            }
            ratios.push(refp / inc);
            std::eprintln!(
                "{boundary:?}: incident {inc:.4}, reflected {refp:.6}, |r| = {:.6}",
                refp / inc
            );
        }
        let (mur1, mur2, cpml) = (ratios[0], ratios[1], ratios[2]);
        assert!(mur2 < mur1 * 0.1, "mur2 {mur2} vs mur1 {mur1}");
        assert!(cpml < mur1 * 0.01, "cpml {cpml} vs mur1 {mur1}");

        // Long-run check: the Mur2 two-level recursion must stay bounded; the
        // test/ref diff should decay once the reflected energy leaves.
        {
            let mut ft = Field::new(nx_t, ny);
            let mut fr = Field::new(nx_r, ny);
            let mut early = 0f64;
            let mut late = 0f64;
            for t in 0..1600 {
                if t < 400 {
                    let x = (t as f64 - 100.) / 24.;
                    let amp = exp_negative(0.5 * x * x).unwrap();
                    for j in 10..ny - 10 {
                        add_soft_source(&mut ft.ez, nx_t, ny, 40, j, amp).unwrap();
                        add_soft_source(&mut fr.ez, nx_r, ny, 40, j, amp).unwrap();
                    }
                }
                ft.step(nx_t, ny, FdtdBoundary::Mur2);
                fr.step(nx_r, ny, FdtdBoundary::Mur2);
                if t == 700 || t == 1599 {
                    let mut m = 0f64;
                    for j in 2..ny - 2 {
                        for i in 2..nx_t - 2 {
                            m = m.max(
                                (ft.ez[j * nx_t + i] as f64 - fr.ez[j * nx_r + i] as f64).abs(),
                            );
                        }
                    }
                    if t == 700 {
                        early = m;
                    } else {
                        late = m;
                    }
                }
            }
            std::eprintln!("mur2 interior diff: t=700 {early:.6}, t=1599 {late:.6}");
            assert!(late < early, "mur2 diff not decaying: {early} -> {late}");
        }
    }

    #[test]
    fn absorbing_modes_require_their_extra_state() {
        let mut field = Field::new(8, 8);
        let config = FdtdConfig {
            nx: 8,
            ny: 8,
            dt: DT,
            mu: 1.,
            boundary: FdtdBoundary::Mur2,
        };
        // The legacy surface has no room for the extra state.
        assert_eq!(
            step_fdtd(
                &config,
                &field.eps,
                None,
                &mut FdtdBuffers {
                    ez: &mut field.ez,
                    hx: &mut field.hx,
                    hy: &mut field.hy,
                    prev_left: &mut field.prev_left,
                    prev_right: &mut field.prev_right,
                    prev_bottom: &mut field.prev_bottom,
                    prev_top: &mut field.prev_top,
                },
            ),
            Err(KernelError::UnsupportedFeature)
        );
        assert_eq!(
            step_fdtd_ex(
                &config,
                &field.eps,
                None,
                &mut FdtdBuffers {
                    ez: &mut field.ez,
                    hx: &mut field.hx,
                    hy: &mut field.hy,
                    prev_left: &mut field.prev_left,
                    prev_right: &mut field.prev_right,
                    prev_bottom: &mut field.prev_bottom,
                    prev_top: &mut field.prev_top,
                },
                None,
                None,
            ),
            Err(KernelError::UnsupportedFeature)
        );
        // Short histories are rejected before any mutation.
        let mut short = std::vec![0.; 7];
        let [_ml, mr, mb, mt, mli, mri, mbi, mti] = &mut field.m2;
        let [_pex, pey, phx, phy] = &mut field.psi;
        assert_eq!(
            step_fdtd_ex(
                &config,
                &field.eps,
                None,
                &mut FdtdBuffers {
                    ez: &mut field.ez,
                    hx: &mut field.hx,
                    hy: &mut field.hy,
                    prev_left: &mut field.prev_left,
                    prev_right: &mut field.prev_right,
                    prev_bottom: &mut field.prev_bottom,
                    prev_top: &mut field.prev_top,
                },
                Some(&mut FdtdMur2 {
                    left: &mut short,
                    right: mr,
                    bottom: mb,
                    top: mt,
                    left_inner: mli,
                    right_inner: mri,
                    bottom_inner: mbi,
                    top_inner: mti,
                }),
                None,
            ),
            Err(KernelError::BufferLength)
        );
        let mut pml_config = config;
        pml_config.boundary = FdtdBoundary::Cpml;
        let mut psi_short = std::vec![0.; 63];
        assert_eq!(
            step_fdtd_ex(
                &pml_config,
                &field.eps,
                None,
                &mut FdtdBuffers {
                    ez: &mut field.ez,
                    hx: &mut field.hx,
                    hy: &mut field.hy,
                    prev_left: &mut field.prev_left,
                    prev_right: &mut field.prev_right,
                    prev_bottom: &mut field.prev_bottom,
                    prev_top: &mut field.prev_top,
                },
                None,
                Some(&mut FdtdCpml {
                    psi_ez_x: &mut psi_short,
                    psi_ez_y: pey,
                    psi_hx_y: phx,
                    psi_hy_x: phy,
                }),
            ),
            Err(KernelError::BufferLength)
        );
        assert!(field.ez.iter().all(|&v| v == 0.));
    }

    #[test]
    fn cpml_stays_stable_on_grids_smaller_than_the_layer() {
        // The layer clamps to (n - 2) / 2 cells per side; on a 9-wide grid the
        // strips still leave an interior and the step stays finite.
        let mut field = Field::new(9, 9);
        field.ez[4 * 9 + 4] = 1.;
        for _ in 0..60 {
            field.step(9, 9, FdtdBoundary::Cpml);
        }
        assert!(field.ez.iter().all(|v| v.is_finite()));
        assert!(field.psi.iter().flatten().all(|v| v.is_finite()));
    }

    #[test]
    fn mur2_keeps_zero_field_and_shifts_histories() {
        let mut field = Field::new(NX, NY);
        field.ez[NY / 2 * NX + NX / 2] = 1.;
        field.step(NX, NY, FdtdBoundary::Mur2);
        assert!(field.ez.iter().all(|v| v.is_finite()));
        // After one step the first interior column becomes the stored E^n.
        for j in 0..NY {
            assert_eq!(field.prev_left[j], field.ez[j * NX + 1]);
            assert_eq!(field.m2[4][j], 0.); // E^{n-1}(1, j) was the previous prev_left
        }
    }
}
