//! Explicit, constant-density laminar Navier-Stokes step on the voxel MAC grid.
//! Momentum uses conservative first-order donor-cell fluxes on staggered dual
//! volumes, physical kinematic viscosity, prescribed acceleration, then the
//! shared pressure projection. No eddy viscosity or automatic timestep changes.
//!
//! The element-wise half-control-volume construction follows the geometry in
//! https://dumux.org/docs/doxygen/master/group___face_centered_staggered_discretization.html
//! Frontal fluxes have full cell-face area; each owner cell contributes half of
//! each lateral face. This is our implementation, without DuMux code/dependencies.

use crate::{
    geometry::cell_count,
    mac_projection::{
        self, face_at, faces, Face, MacProjectionBuffers, MacProjectionConfig, MacProjectionError,
        MacProjectionStats,
    },
    KernelError,
};
use core::fmt;

#[derive(Clone, Copy, Debug)]
pub struct MacStepConfig {
    pub projection: MacProjectionConfig,
    /// Physical kinematic viscosity, m^2/s, finite and nonnegative.
    pub kinematic_viscosity_m2_s: f64,
    /// Exterior donor for tangential momentum entering pressure openings, m/s.
    /// Normal momentum uses the actual boundary normal velocity, not this value.
    pub open_velocity_m_s: [f64; 3],
}

/// Current velocities and accelerations are immutable, with the same staggered
/// layout as the projection. Acceleration is m/s^2 on active velocity DOFs;
/// prescribed normal-wall DOFs ignore acceleration. Next fields, pressure and
/// scratch must be discarded on failure. Swap current/next only on success.
pub struct MacStepBuffers<'a> {
    pub u: &'a [f64],
    pub v: &'a [f64],
    pub w: &'a [f64],
    pub acceleration_u: &'a [f64],
    pub acceleration_v: &'a [f64],
    pub acceleration_w: &'a [f64],
    pub next_u: &'a mut [f64],
    pub next_v: &'a mut [f64],
    pub next_w: &'a mut [f64],
    pub pressure: &'a mut [f64],
    pub work: &'a mut [f64],
    pub topology_work: &'a mut [u32],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MacStepStats {
    pub projection: MacProjectionStats,
    pub advection_cfl: f64,
    pub diffusion_cfl: f64,
    pub combined_cfl: f64,
    /// Discrete impulses ON the fluid. Internal active/active fluxes cancel.
    /// Wall includes momentum exchanged with prescribed zero normal-wall DOFs.
    pub wall_impulse_kg_m_s: [f64; 3],
    pub open_impulse_kg_m_s: [f64; 3],
    pub body_impulse_kg_m_s: [f64; 3],
    /// Dual-volume weighted momentum change caused by projection; this is not
    /// a separately integrated model force or a certified surface stress.
    pub pressure_impulse_kg_m_s: [f64; 3],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MacStepError {
    Invalid(KernelError),
    Projection(MacProjectionError),
    TimeStepExceeded {
        advection_cfl: f64,
        diffusion_cfl: f64,
        combined_cfl: f64,
    },
}

impl From<KernelError> for MacStepError {
    fn from(error: KernelError) -> Self {
        Self::Invalid(error)
    }
}
impl From<MacProjectionError> for MacStepError {
    fn from(error: MacProjectionError) -> Self {
        Self::Projection(error)
    }
}
impl fmt::Display for MacStepError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(error) => error.fmt(f),
            Self::Projection(error) => error.fmt(f),
            Self::TimeStepExceeded { advection_cfl, diffusion_cfl, combined_cfl } =>
                write!(f, "MAC explicit step exceeds combined CFL 1: advection {advection_cfl}, diffusion {diffusion_cfl}, combined {combined_cfl}"),
        }
    }
}
impl core::error::Error for MacStepError {}

#[derive(Default)]
struct Balance {
    advection: f64,
    diffusion: f64,
    outgoing: f64,
    diffusion_diagonal: f64,
    wall_advection: f64,
    wall_diffusion: f64,
    open_advection: f64,
}

#[derive(Clone, Copy)]
enum Boundary {
    Interior,
    Wall,
    Open,
}

impl Balance {
    // Area is measured in h^2, inverse distance in 1/h; q is outward m/s.
    fn add(
        &mut self,
        area: f64,
        q: f64,
        current: f64,
        neighbor: f64,
        inverse_distance: f64,
        boundary: Boundary,
    ) {
        let adv = area * q * if q >= 0.0 { current } else { neighbor };
        let diff = area * inverse_distance * (neighbor - current);
        self.advection += adv;
        self.diffusion += diff;
        self.outgoing += area * q.max(0.0);
        self.diffusion_diagonal += area * inverse_distance;
        match boundary {
            Boundary::Wall => {
                self.wall_advection += adv;
                self.wall_diffusion += diff;
            }
            Boundary::Open => self.open_advection += adv,
            Boundary::Interior => {}
        }
    }
}

fn velocity(fields: [&[f64]; 3], face: Face) -> f64 {
    if face.weight == 0.0 {
        0.0
    } else {
        fields[face.axis][face.index]
    }
}

fn balance(c: &MacStepConfig, flags: &[u8], fields: [&[f64]; 3], face: Face) -> Balance {
    let grid = &c.projection;
    let dims = [grid.nx, grid.ny, grid.nz];
    let a = face.axis;
    let current = velocity(fields, face);
    let mut sum = Balance::default();
    for (side, owner) in [face.left, face.right].into_iter().enumerate() {
        let sign = if side == 0 { -1.0 } else { 1.0 };
        let Some(cell) = owner else {
            // Pressure opening normal CV ends at its velocity DOF. Neither
            // p=0 nor this extrapolation prescribes a normal inflow velocity.
            sum.add(1.0, sign * current, current, current, 0.0, Boundary::Open);
            continue;
        };
        // Active face owners are fluid. The frontal interface is at its owner
        // cell centre, between two same-component normal velocity DOFs.
        let mut neighbor_pos = face.position;
        if side == 0 {
            neighbor_pos[a] -= 1;
        } else {
            neighbor_pos[a] += 1;
        }
        let neighbor_face = face_at(grid, flags, a, neighbor_pos);
        let neighbor = velocity(fields, neighbor_face);
        sum.add(
            1.0,
            sign * 0.5 * (current + neighbor),
            current,
            neighbor,
            1.0,
            if neighbor_face.weight == 0.0 {
                Boundary::Wall
            } else {
                Boundary::Interior
            },
        );

        // Each owner contributes its own half of all lateral faces. In a mixed
        // corner the fluid half and solid half therefore remain distinct.
        let cell_pos = [
            cell % grid.nx,
            cell / grid.nx % grid.ny,
            cell / (grid.nx * grid.ny),
        ];
        for b in 0..3 {
            if b == a {
                continue;
            }
            for lateral_side in 0..2 {
                let sign = if lateral_side == 0 { -1.0 } else { 1.0 };
                let outside = if lateral_side == 0 {
                    cell_pos[b] == 0
                } else {
                    cell_pos[b] + 1 == dims[b]
                };
                let mut normal_pos = cell_pos;
                normal_pos[b] += lateral_side;
                let normal = face_at(grid, flags, b, normal_pos);
                let q = sign * velocity(fields, normal);
                if outside {
                    if grid.open_faces & (1 << (2 * b + lateral_side)) != 0 {
                        sum.add(0.5, q, current, c.open_velocity_m_s[a], 0.0, Boundary::Open);
                    } else {
                        sum.add(0.5, 0.0, current, 0.0, 2.0, Boundary::Wall);
                    }
                } else {
                    let mut across = cell_pos;
                    if lateral_side == 0 {
                        across[b] -= 1;
                    } else {
                        across[b] += 1;
                    }
                    let neighbor_cell = across[0] + grid.nx * (across[1] + grid.ny * across[2]);
                    if flags[neighbor_cell] != 0 {
                        // Tangential no-slip is at h/2, ghost value -current.
                        sum.add(0.5, 0.0, current, 0.0, 2.0, Boundary::Wall);
                    } else {
                        let mut tangential_pos = face.position;
                        if lateral_side == 0 {
                            tangential_pos[b] -= 1;
                        } else {
                            tangential_pos[b] += 1;
                        }
                        let neighbor_face = face_at(grid, flags, a, tangential_pos);
                        sum.add(
                            0.5,
                            q,
                            current,
                            velocity(fields, neighbor_face),
                            1.0,
                            if neighbor_face.weight == 0.0 {
                                Boundary::Wall
                            } else {
                                Boundary::Interior
                            },
                        );
                    }
                }
            }
        }
    }
    sum
}

fn finite(values: &[f64]) -> Result<(), KernelError> {
    if values.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(KernelError::NonFiniteValue)
    }
}

/// One first-order-in-time momentum step followed by the unchanged MAC pressure
/// projection. Current fields must already satisfy impermeable normal walls
/// exactly and fluid-cell |D u| <= projection.absolute_divergence_tol. Call the
/// standalone projection to prepare arbitrary initial fields, not every step.
///
/// The local outgoing-advection plus explicit-diffusion coefficient must be <=1
/// at every active velocity DOF. No timestep/viscosity correction is performed.
/// Pressure openings use zero normal viscous gradient, extrapolated normal
/// momentum and specified incoming tangential momentum. These are artificial
/// truncation boundaries, not non-reflecting or energy-stable backflow models.
pub fn step_mac3d(
    c: &MacStepConfig,
    flags: &[u8],
    b: &mut MacStepBuffers<'_>,
) -> Result<MacStepStats, MacStepError> {
    let p = &c.projection;
    let n = cell_count(p.nx, p.ny, p.nz)?;
    if n > u32::MAX as usize {
        return Err(KernelError::InvalidDimensions.into());
    }
    let dims = [p.nx, p.ny, p.nz];
    let mut counts = [0; 3];
    for a in 0..3 {
        let mut fd = dims;
        fd[a] = fd[a].checked_add(1).ok_or(KernelError::InvalidDimensions)?;
        counts[a] = cell_count(fd[0], fd[1], fd[2])?;
    }
    let fields = [b.u, b.v, b.w];
    let accelerations = [b.acceleration_u, b.acceleration_v, b.acceleration_w];
    if flags.len() != n
        || b.pressure.len() != n
        || b.work.len() != n.checked_mul(6).ok_or(KernelError::InvalidDimensions)?
        || b.topology_work.len() != n.checked_mul(2).ok_or(KernelError::InvalidDimensions)?
        || [b.next_u.len(), b.next_v.len(), b.next_w.len()] != counts
        || (0..3).any(|a| fields[a].len() != counts[a] || accelerations[a].len() != counts[a])
    {
        return Err(KernelError::BufferLength.into());
    }
    if [p.dx_m, p.dt_s, p.density_kg_m3, p.absolute_divergence_tol]
        .iter()
        .any(|&v| !v.is_finite() || v <= 0.0)
        || !(0.0..1.0).contains(&p.relative_residual_tol)
        || !(1..=4096).contains(&p.max_iterations)
        || p.open_faces & !63 != 0
        || !c.kinematic_viscosity_m2_s.is_finite()
        || c.kinematic_viscosity_m2_s < 0.0
    {
        return Err(KernelError::InvalidCoefficient.into());
    }
    for field in fields.into_iter().chain(accelerations) {
        finite(field)?;
    }
    finite(&c.open_velocity_m_s)?;
    let h = p.dx_m;
    let volume = h * h * h;
    let mass = p.density_kg_m3 * volume;
    let advection_scale = p.dt_s / h;
    let diffusion_scale = c.kinematic_viscosity_m2_s * p.dt_s / (h * h);
    if [volume, mass, advection_scale]
        .iter()
        .any(|&v| !v.is_finite() || v <= 0.0)
        || !diffusion_scale.is_finite()
        || (c.kinematic_viscosity_m2_s > 0.0 && diffusion_scale == 0.0)
    {
        return Err(KernelError::InvalidCoefficient.into());
    }
    let divergence = &mut b.work[..n];
    divergence.fill(0.0);
    let mut valid_walls = true;
    faces(p, flags, |f| {
        if f.weight == 0.0 {
            valid_walls &= fields[f.axis][f.index] == 0.0;
        } else {
            let flux = fields[f.axis][f.index] / h;
            if let Some(k) = f.left {
                divergence[k] += flux;
            }
            if let Some(k) = f.right {
                divergence[k] -= flux;
            }
        }
    });
    finite(divergence)?;
    if !valid_walls
        || !flags.contains(&0)
        || divergence
            .iter()
            .any(|d| d.abs() > p.absolute_divergence_tol)
    {
        return Err(KernelError::InvalidState.into());
    }

    let mut advection_cfl: f64 = 0.0;
    let mut diffusion_cfl: f64 = 0.0;
    let mut combined_cfl: f64 = 0.0;
    let mut wall_impulse_kg_m_s = [0.0; 3];
    let mut open_impulse_kg_m_s = [0.0; 3];
    let mut body_impulse_kg_m_s = [0.0; 3];
    let mut predicted_momentum = [0.0; 3];
    let next = [&mut *b.next_u, &mut *b.next_v, &mut *b.next_w];
    let mut numerical_error = false;
    faces(p, flags, |f| {
        if f.weight == 0.0 {
            next[f.axis][f.index] = 0.0;
            return;
        }
        let sum = balance(c, flags, fields, f);
        let fraction = 1.0 / f.weight;
        let adv_cfl = advection_scale * sum.outgoing / fraction;
        let diff_cfl = diffusion_scale * sum.diffusion_diagonal / fraction;
        let combined = adv_cfl + diff_cfl;
        numerical_error |= finite(&[adv_cfl, diff_cfl, combined]).is_err();
        advection_cfl = advection_cfl.max(adv_cfl);
        diffusion_cfl = diffusion_cfl.max(diff_cfl);
        combined_cfl = combined_cfl.max(combined);
        let body = p.dt_s * accelerations[f.axis][f.index];
        let predicted = fields[f.axis][f.index]
            + (-advection_scale * sum.advection + diffusion_scale * sum.diffusion) / fraction
            + body;
        numerical_error |= !predicted.is_finite();
        next[f.axis][f.index] = predicted;
        wall_impulse_kg_m_s[f.axis] +=
            mass * (-advection_scale * sum.wall_advection + diffusion_scale * sum.wall_diffusion);
        open_impulse_kg_m_s[f.axis] -= mass * advection_scale * sum.open_advection;
        body_impulse_kg_m_s[f.axis] += mass * fraction * body;
        predicted_momentum[f.axis] += mass * fraction * predicted;
    });
    for values in [
        &wall_impulse_kg_m_s,
        &open_impulse_kg_m_s,
        &body_impulse_kg_m_s,
        &predicted_momentum,
    ] {
        finite(values)?;
    }
    if numerical_error {
        return Err(KernelError::NonFiniteValue.into());
    }
    if combined_cfl > 1.0 {
        return Err(MacStepError::TimeStepExceeded {
            advection_cfl,
            diffusion_cfl,
            combined_cfl,
        });
    }
    let projection = mac_projection::project_mac3d(
        p,
        flags,
        &mut MacProjectionBuffers {
            u: b.next_u,
            v: b.next_v,
            w: b.next_w,
            pressure: b.pressure,
            work: b.work,
            topology_work: b.topology_work,
        },
    )?;
    let mut final_momentum = [0.0; 3];
    let next = [&*b.next_u, &*b.next_v, &*b.next_w];
    faces(p, flags, |f| {
        if f.weight != 0.0 {
            final_momentum[f.axis] += mass / f.weight * next[f.axis][f.index];
        }
    });
    let pressure_impulse_kg_m_s =
        core::array::from_fn(|a| final_momentum[a] - predicted_momentum[a]);
    finite(&pressure_impulse_kg_m_s)?;
    Ok(MacStepStats {
        projection,
        advection_cfl,
        diffusion_cfl,
        combined_cfl,
        wall_impulse_kg_m_s,
        open_impulse_kg_m_s,
        body_impulse_kg_m_s,
        pressure_impulse_kg_m_s,
    })
}
