//! Constant-density pressure projection on a uniform, voxel-aligned 3D MAC grid.
//!
//! The face gradient and cell divergence define the same operator `A = -D G`.
//! This implements only the pressure constraint, not momentum/heat transport.
//! Derivation: Bridson and Mueller-Fischer, Fluid Simulation (SIGGRAPH 2007),
//! chapter 4: https://www.cs.ubc.ca/~rbridson/fluidsimulation/fluids_notes.pdf
//! Our outer pressure boundary is at the face, half a cell from its pressure
//! sample; its gradient therefore has twice the interior face coefficient.

use crate::{geometry::cell_count, KernelError};
use core::fmt;

#[derive(Clone, Copy, Debug)]
pub struct MacProjectionConfig {
    pub nx: usize,
    pub ny: usize,
    pub nz: usize,
    pub dx_m: f64,
    pub dt_s: f64,
    pub density_kg_m3: f64,
    /// Pressure-zero openings: bits 0..5 = xMin, xMax, yMin, yMax, zMin, zMax.
    /// Other outer faces are stationary impermeable walls.
    pub open_faces: u8,
    /// Jacobi-PCG iteration limit, 1..=4096; exhaustion is an explicit error.
    pub max_iterations: u32,
    /// Absolute maximum cell divergence, in s^-1, after wall velocities are set.
    pub absolute_divergence_tol: f64,
    /// Further tightens the absolute bound to min(abs, relative * initial D∞).
    /// Dimensionless, in [0,1); zero (or initial D∞=0) uses absolute alone.
    pub relative_residual_tol: f64,
}

/// All fields use f64 SI units and x-fastest storage. Face array dimensions are
/// `(nx+1,ny,nz)`, `(nx,ny+1,nz)`, `(nx,ny,nz+1)`, in m/s. Pressure is N Pa.
/// Scratch is exactly 6*N f64 and 2*N u32. No allocation occurs in the kernel.
pub struct MacProjectionBuffers<'a> {
    pub u: &'a mut [f64],
    pub v: &'a mut [f64],
    pub w: &'a mut [f64],
    pub pressure: &'a mut [f64],
    pub work: &'a mut [f64],
    pub topology_work: &'a mut [u32],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MacProjectionStats {
    pub iterations: u32,
    pub fluid_cells: u32,
    pub closed_components: u32,
    pub initial_divergence_linf: f64,
    pub final_divergence_linf: f64,
    pub allowed_divergence_linf: f64,
    /// Original physical Poisson residual, including every pinned cell, Pa/m^2.
    pub residual_linf_pa_per_m2: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MacProjectionError {
    Invalid(KernelError),
    NotConverged {
        iterations: u32,
        residual_linf_pa_per_m2: f64,
        allowed_residual_linf_pa_per_m2: f64,
    },
}

impl From<KernelError> for MacProjectionError {
    fn from(value: KernelError) -> Self {
        Self::Invalid(value)
    }
}

impl fmt::Display for MacProjectionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(error) => error.fmt(f),
            Self::NotConverged { iterations, residual_linf_pa_per_m2, allowed_residual_linf_pa_per_m2 } =>
                write!(f, "MAC pressure projection did not converge after {iterations} iterations: residual {residual_linf_pa_per_m2} Pa/m^2 exceeds {allowed_residual_linf_pa_per_m2} Pa/m^2"),
        }
    }
}

impl core::error::Error for MacProjectionError {}

#[derive(Clone, Copy)]
pub(crate) struct Face {
    pub(crate) axis: usize,
    pub(crate) index: usize,
    pub(crate) position: [usize; 3],
    pub(crate) left: Option<usize>,
    pub(crate) right: Option<usize>,
    pub(crate) weight: f64,
}

pub(crate) fn face_at(c: &MacProjectionConfig, flags: &[u8], axis: usize, pos: [usize; 3]) -> Face {
    let dims = [c.nx, c.ny, c.nz];
    let [x, y, z] = pos;
    let right = (pos[axis] < dims[axis]).then(|| x + c.nx * (y + c.ny * z));
    let left = (pos[axis] > 0).then(|| {
        let mut q = pos;
        q[axis] -= 1;
        q[0] + c.nx * (q[1] + c.ny * q[2])
    });
    let weight = match (left, right) {
        (Some(a), Some(b)) if flags[a] == 0 && flags[b] == 0 => 1.0,
        (None, Some(b)) if flags[b] == 0 && c.open_faces & (1 << (2 * axis)) != 0 => 2.0,
        (Some(a), None) if flags[a] == 0 && c.open_faces & (2 << (2 * axis)) != 0 => 2.0,
        _ => 0.0,
    };
    let mut fd = dims;
    fd[axis] += 1;
    Face {
        axis,
        index: x + fd[0] * (y + fd[1] * z),
        position: pos,
        left,
        right,
        weight,
    }
}

// One classification supplies D, G, the pressure matrix and impermeable faces.
pub(crate) fn faces(c: &MacProjectionConfig, flags: &[u8], mut visit: impl FnMut(Face)) {
    let dims = [c.nx, c.ny, c.nz];
    for axis in 0..3 {
        let mut fd = dims;
        fd[axis] += 1;
        for z in 0..fd[2] {
            for y in 0..fd[1] {
                for x in 0..fd[0] {
                    visit(face_at(c, flags, axis, [x, y, z]));
                }
            }
        }
    }
}

fn accumulate(out: &mut [f64], face: Face, value: f64) {
    if let Some(a) = face.left {
        out[a] += value;
    }
    if let Some(b) = face.right {
        out[b] -= value;
    }
}

fn apply(c: &MacProjectionConfig, flags: &[u8], p: &[f64], out: &mut [f64]) {
    out.fill(0.0);
    faces(c, flags, |face| {
        if face.weight != 0.0 {
            let difference = face.left.map_or(0.0, |a| p[a]) - face.right.map_or(0.0, |b| p[b]);
            accumulate(out, face, face.weight * difference);
        }
    });
}

fn norm(values: &[f64]) -> Result<f64, KernelError> {
    let mut largest: f64 = 0.0;
    for &value in values {
        if !value.is_finite() {
            return Err(KernelError::NonFiniteValue);
        }
        largest = largest.max(value.abs());
    }
    Ok(largest)
}

fn dot(a: &[f64], b: &[f64]) -> Result<f64, KernelError> {
    let value: f64 = a.iter().zip(b).map(|(a, b)| a * b).sum();
    if !value.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    Ok(value)
}

// Mark one pin in every component without a pressure opening. Keep the physical
// RHS intact at pins: deleting that equation must never hide a volume source.
fn components(c: &MacProjectionConfig, flags: &[u8], marks: &mut [u32], queue: &mut [u32]) -> u32 {
    marks.fill(0);
    let dims = [c.nx, c.ny, c.nz];
    let strides = [1, c.nx, c.nx * c.ny];
    let mut closed = 0;
    for start in 0..flags.len() {
        if flags[start] != 0 || marks[start] != 0 {
            continue;
        }
        let (mut head, mut tail) = (0, 1);
        queue[0] = start as u32;
        marks[start] = 1;
        let mut open = false;
        while head < tail {
            let k = queue[head] as usize;
            head += 1;
            let pos = [k % c.nx, (k / c.nx) % c.ny, k / (c.nx * c.ny)];
            for axis in 0..3 {
                for side in 0..2 {
                    let boundary = if side == 0 {
                        pos[axis] == 0
                    } else {
                        pos[axis] + 1 == dims[axis]
                    };
                    if boundary {
                        open |= c.open_faces & (1 << (2 * axis + side)) != 0;
                    } else {
                        let j = if side == 0 {
                            k - strides[axis]
                        } else {
                            k + strides[axis]
                        };
                        if flags[j] == 0 && marks[j] == 0 {
                            marks[j] = 1;
                            queue[tail] = j as u32;
                            tail += 1;
                        }
                    }
                }
            }
        }
        if !open {
            marks[start] = 2;
            closed += 1;
        }
    }
    closed
}

/// Project prescribed intermediate face velocities onto discrete zero divergence.
/// Flags follow the voxel occupancy convention: zero fluid, any nonzero solid.
///
/// Pressure starts from zero. Every closed fluid component pins its first cell
/// to zero Pa; open components use ambient zero Pa at their boundary faces.
/// Wall normal velocities are imposed as zero before forming the physical RHS.
/// No no-slip tangential/viscous condition, advection or force step is performed.
///
/// Structural, scalar and input-finiteness checks precede writes. Any failure
/// leaves input velocities unchanged; pressure and scratch must be discarded.
/// Numerical and derived-scale checks can fail after scratch has been written. Success
/// requires both the original full Poisson residual and corrected divergence
/// (including pinned cells) to pass; no residual mean is subtracted.
pub fn project_mac3d(
    c: &MacProjectionConfig,
    flags: &[u8],
    buffers: &mut MacProjectionBuffers<'_>,
) -> Result<MacProjectionStats, MacProjectionError> {
    let n = cell_count(c.nx, c.ny, c.nz)?;
    if n > u32::MAX as usize {
        return Err(KernelError::InvalidDimensions.into());
    }
    let fd = [
        cell_count(
            c.nx.checked_add(1).ok_or(KernelError::InvalidDimensions)?,
            c.ny,
            c.nz,
        )?,
        cell_count(
            c.nx,
            c.ny.checked_add(1).ok_or(KernelError::InvalidDimensions)?,
            c.nz,
        )?,
        cell_count(
            c.nx,
            c.ny,
            c.nz.checked_add(1).ok_or(KernelError::InvalidDimensions)?,
        )?,
    ];
    let work_len = n.checked_mul(6).ok_or(KernelError::InvalidDimensions)?;
    let topology_len = n.checked_mul(2).ok_or(KernelError::InvalidDimensions)?;
    if flags.len() != n
        || buffers.pressure.len() != n
        || buffers.work.len() != work_len
        || buffers.topology_work.len() != topology_len
        || [buffers.u.len(), buffers.v.len(), buffers.w.len()] != fd
    {
        return Err(KernelError::BufferLength.into());
    }
    if [c.dx_m, c.dt_s, c.density_kg_m3, c.absolute_divergence_tol]
        .iter()
        .any(|&v| !v.is_finite() || v <= 0.0)
        || !(0.0..1.0).contains(&c.relative_residual_tol)
        || !(1..=4096).contains(&c.max_iterations)
        || c.open_faces & !63 != 0
    {
        return Err(KernelError::InvalidCoefficient.into());
    }
    let h2 = c.dx_m * c.dx_m;
    let correction_scale = c.dt_s / c.density_kg_m3 / c.dx_m;
    let rhs_scale = c.density_kg_m3 / c.dt_s * h2;
    let residual_scale = c.density_kg_m3 / c.dt_s;
    if [h2, correction_scale, rhs_scale, residual_scale, 1.0 / h2]
        .iter()
        .any(|&v| !v.is_finite() || v <= 0.0)
    {
        return Err(KernelError::InvalidCoefficient.into());
    }
    for field in [&*buffers.u, &*buffers.v, &*buffers.w] {
        norm(field)?;
    }
    let fluid_cells = flags.iter().filter(|&&flag| flag == 0).count() as u32;
    if fluid_cells == 0 {
        return Err(KernelError::InvalidState.into());
    }

    let (rhs, work) = buffers.work.split_at_mut(n);
    let (r, work) = work.split_at_mut(n);
    let (direction, work) = work.split_at_mut(n);
    let (z, work) = work.split_at_mut(n);
    let (product, diagonal) = work.split_at_mut(n);
    let (marks, queue) = buffers.topology_work.split_at_mut(n);
    let closed_components = components(c, flags, marks, queue);
    let pressure = &mut *buffers.pressure;
    pressure.fill(0.0);
    rhs.fill(0.0);
    diagonal.fill(0.0);
    let velocities = [&*buffers.u, &*buffers.v, &*buffers.w];
    faces(c, flags, |face| {
        if face.weight != 0.0 {
            accumulate(rhs, face, velocities[face.axis][face.index] / c.dx_m);
            if let Some(a) = face.left {
                diagonal[a] += face.weight;
            }
            if let Some(b) = face.right {
                diagonal[b] += face.weight;
            }
        }
    });
    let initial_divergence_linf = norm(rhs)?;
    let allowed_divergence_linf = if c.relative_residual_tol > 0.0 && initial_divergence_linf > 0.0
    {
        c.absolute_divergence_tol
            .min(c.relative_residual_tol * initial_divergence_linf)
    } else {
        c.absolute_divergence_tol
    };
    let target = allowed_divergence_linf * rhs_scale;
    let allowed_residual_linf_pa_per_m2 = allowed_divergence_linf * residual_scale;
    if !target.is_finite()
        || target <= 0.0
        || !allowed_residual_linf_pa_per_m2.is_finite()
        || allowed_residual_linf_pa_per_m2 <= 0.0
    {
        return Err(KernelError::InvalidCoefficient.into());
    }
    for i in 0..n {
        rhs[i] *= -rhs_scale;
        if marks[i] != 1 {
            diagonal[i] = 1.0;
        }
        r[i] = if marks[i] == 1 { rhs[i] } else { 0.0 };
        z[i] = r[i] / diagonal[i];
        direction[i] = z[i];
    }
    let mut true_residual = norm(rhs)?;
    let mut rz = dot(r, z)?;
    let mut iterations = 0;
    while true_residual > target && iterations < c.max_iterations {
        apply(c, flags, direction, product);
        for i in 0..n {
            if marks[i] != 1 {
                product[i] = 0.0;
            }
        }
        let denominator = dot(direction, product)?;
        if denominator <= 0.0 || rz <= 0.0 {
            break;
        }
        let alpha = rz / denominator;
        for i in 0..n {
            pressure[i] += alpha * direction[i];
            r[i] -= alpha * product[i];
        }
        iterations += 1;
        let candidate = norm(r)? <= target || iterations == c.max_iterations;
        if candidate {
            apply(c, flags, pressure, product);
            for i in 0..n {
                product[i] = rhs[i] - product[i];
            }
            true_residual = norm(product)?;
            if true_residual <= target {
                break;
            }
            // Restart from the recomputed residual if roundoff has separated the
            // recursive residual from the actual original Poisson equation.
            for i in 0..n {
                r[i] = if marks[i] == 1 { product[i] } else { 0.0 };
            }
        }
        for i in 0..n {
            z[i] = r[i] / diagonal[i];
        }
        let next_rz = dot(r, z)?;
        let beta = if candidate { 0.0 } else { next_rz / rz };
        for i in 0..n {
            direction[i] = z[i] + beta * direction[i];
        }
        rz = next_rz;
    }
    // Always recompute, including the pin equation, even on CG breakdown.
    apply(c, flags, pressure, product);
    for i in 0..n {
        product[i] = rhs[i] - product[i];
    }
    let residual_linf_pa_per_m2 = norm(product)? / h2;
    if !residual_linf_pa_per_m2.is_finite() {
        return Err(KernelError::NonFiniteValue.into());
    }
    let failed = |residual| MacProjectionError::NotConverged {
        iterations,
        residual_linf_pa_per_m2: residual,
        allowed_residual_linf_pa_per_m2,
    };
    if residual_linf_pa_per_m2 > allowed_residual_linf_pa_per_m2 {
        return Err(failed(residual_linf_pa_per_m2));
    }
    // Preflight the actual stored velocity update and its divergence before
    // touching input velocities. This independently checks cancellation at pins.
    product.fill(0.0);
    let corrected = |face: Face| {
        if face.weight == 0.0 {
            0.0
        } else {
            let gradient = face.weight
                * (face.right.map_or(0.0, |b| pressure[b])
                    - face.left.map_or(0.0, |a| pressure[a]));
            velocities[face.axis][face.index] - correction_scale * gradient
        }
    };
    let mut finite = true;
    faces(c, flags, |face| {
        let value = corrected(face);
        finite &= value.is_finite();
        if face.weight != 0.0 {
            accumulate(product, face, value / c.dx_m);
        }
    });
    if !finite {
        return Err(KernelError::NonFiniteValue.into());
    }
    let final_divergence_linf = norm(product)?;
    if final_divergence_linf > allowed_divergence_linf {
        let residual = final_divergence_linf * residual_scale;
        if !residual.is_finite() {
            return Err(KernelError::NonFiniteValue.into());
        }
        return Err(failed(residual));
    }
    let fields = [&mut *buffers.u, &mut *buffers.v, &mut *buffers.w];
    faces(c, flags, |face| {
        fields[face.axis][face.index] = if face.weight == 0.0 {
            0.0
        } else {
            let gradient = face.weight
                * (face.right.map_or(0.0, |b| pressure[b])
                    - face.left.map_or(0.0, |a| pressure[a]));
            fields[face.axis][face.index] - correction_scale * gradient
        };
    });
    Ok(MacProjectionStats {
        iterations,
        fluid_cells,
        closed_components,
        initial_divergence_linf,
        final_divergence_linf,
        allowed_divergence_linf,
        residual_linf_pa_per_m2,
    })
}
