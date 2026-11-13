//! Constant-density, conservative conjugate heat transport driven by MAC faces.
//! Energy is sensible energy relative to ambient, in J. Advection, conduction
//! and sources use the same old substep temperature, with a combined explicit
//! positive-coefficient limit. This does not apply buoyancy or change the flow.
//! Finite-volume basis: https://pages.nist.gov/fipy/en/stable/numerical/discret.html

pub use crate::thermal::{
    ThermalConfig, ThermalMaterial, ThermalMode, ThermalStep, MAX_THERMAL_CONTACTS,
    MAX_THERMAL_MATERIALS,
};
use crate::{
    geometry::cell_count,
    mac_projection::{faces, Face, MacProjectionConfig},
    thermal::{conductance, source_energies},
    KernelError,
};

/// u/v/w use the existing MAC face layout in m/s; energy is readonly f64[N] J.
/// next_energy, temperature_delta_k and work are distinct f64[N] output/scratch
/// buffers. Work stores heat capacities (J/K). Discard all three on failure;
/// the original energy and velocities are never modified.
pub struct MacThermalBuffers<'a> {
    pub u: &'a [f64],
    pub v: &'a [f64],
    pub w: &'a [f64],
    pub energy: &'a [f64],
    pub next_energy: &'a mut [f64],
    pub temperature_delta_k: &'a mut [f64],
    pub work: &'a mut [f64],
}

fn finite(values: &[f64]) -> Result<(), KernelError> {
    if values.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(KernelError::NonFiniteValue)
    }
}

fn active(flag: u8) -> bool {
    flag == 0 || flag >= 4
}

fn refresh(
    p: &ThermalConfig,
    flags: &[u8],
    energy: &[f64],
    capacity: &[f64],
    temperature: &mut [f64],
) -> Result<(), KernelError> {
    finite(energy)?;
    for (i, &flag) in flags.iter().enumerate() {
        temperature[i] = if active(flag) {
            energy[i] / capacity[i]
        } else if flag == 2 {
            p.fixed_surface_c - p.ambient_c
        } else {
            0.0
        };
        let absolute_c = p.ambient_c + temperature[i];
        if !temperature[i].is_finite() || !absolute_c.is_finite() {
            return Err(KernelError::NonFiniteValue);
        }
        if absolute_c <= -273.15 || (!active(flag) && energy[i] != 0.0) {
            return Err(KernelError::InvalidState);
        }
    }
    Ok(())
}

// Signed W/K multiplying the donor's temperature difference. Density is the
// prescribed constant physical density, not a lattice-population surrogate.
fn advective_coefficient(p: &ThermalConfig, velocity: f64) -> f64 {
    p.fluid_density * p.dx_meters * p.dx_meters * velocity * p.fluid_specific_heat
}

fn face_conductance(p: &ThermalConfig, flags: &[u8], face: Face) -> Result<f64, KernelError> {
    let (Some(i), Some(j)) = (face.left, face.right) else {
        return Ok(0.0);
    };
    if flags[i] == 1 || flags[j] == 1 || (!active(flags[i]) && !active(flags[j])) {
        return Ok(0.0);
    }
    let g = conductance(p, flags[i], flags[j]);
    if !g.is_finite() || g <= 0.0 {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(g)
}

/// Advance heat over exactly c.dt_s, using a fixed supplied divergence-free
/// velocity field. c and p must specify identical dx, dt and fluid density.
/// Nonzero gravity_per_kelvin is unsupported: buoyancy is a separate coupling.
///
/// Fluid-fluid face flux is rho*A*u*cp*upwind(deltaT). Pressure openings admit
/// ambient fluid (deltaT=0) and export local sensible enthalpy, with no normal
/// conduction. Closed outer faces are insulated; inlet cells are never pinned.
/// Internal flags 2/3 are hot/ambient reservoirs, 1 insulated, 4..20 materials.
/// Each thermal substep obeys dt_sub*(outgoing enthalpy coefficient+sum G)/C
/// <=0.9. The required integer count is reported and bounded by max_substeps;
/// no material property, macroscopic timestep or source power is changed.
pub fn step_mac_thermal3d(
    c: &MacProjectionConfig,
    p: &ThermalConfig,
    flags: &[u8],
    b: &mut MacThermalBuffers<'_>,
) -> Result<ThermalStep, KernelError> {
    let n = cell_count(c.nx, c.ny, c.nz)?;
    let dims = [c.nx, c.ny, c.nz];
    let mut counts = [0; 3];
    for a in 0..3 {
        let mut fd = dims;
        fd[a] = fd[a].checked_add(1).ok_or(KernelError::InvalidDimensions)?;
        counts[a] = cell_count(fd[0], fd[1], fd[2])?;
    }
    if flags.len() != n
        || b.energy.len() != n
        || b.next_energy.len() != n
        || b.temperature_delta_k.len() != n
        || b.work.len() != n
        || [b.u.len(), b.v.len(), b.w.len()] != counts
    {
        return Err(KernelError::BufferLength);
    }
    p.validate()?;
    if p.gravity_per_kelvin != 0.0 {
        return Err(KernelError::UnsupportedFeature);
    }
    if c.dx_m != p.dx_meters
        || c.dt_s != p.dt_seconds
        || c.density_kg_m3 != p.fluid_density
        || c.open_faces & !63 != 0
        || !c.absolute_divergence_tol.is_finite()
        || c.absolute_divergence_tol <= 0.0
    {
        return Err(KernelError::InvalidCoefficient);
    }
    p.validate_flags(flags)?;
    if !flags.contains(&0) {
        return Err(KernelError::InvalidState);
    }
    p.validate_contact_faces(dims, false, flags)?;
    let velocities = [b.u, b.v, b.w];
    for values in velocities.into_iter().chain([b.energy]) {
        finite(values)?;
    }
    let before: f64 = b.energy.iter().sum();
    if !before.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }

    // Use existing temperature output as temporary divergence storage before
    // initialization. No extra allocation or pressure projection is needed.
    b.temperature_delta_k.fill(0.0);
    let mut valid_walls = true;
    faces(c, flags, |f| {
        let u = velocities[f.axis][f.index];
        if f.weight == 0.0 {
            valid_walls &= u == 0.0;
        } else {
            let flux = u / c.dx_m;
            if let Some(k) = f.left {
                b.temperature_delta_k[k] += flux;
            }
            if let Some(k) = f.right {
                b.temperature_delta_k[k] -= flux;
            }
        }
    });
    finite(b.temperature_delta_k)?;
    if !valid_walls
        || b.temperature_delta_k
            .iter()
            .any(|d| d.abs() > c.absolute_divergence_tol)
    {
        return Err(KernelError::InvalidState);
    }
    let volume = p.dx_meters * p.dx_meters * p.dx_meters;
    for (i, &flag) in flags.iter().enumerate() {
        b.work[i] = if active(flag) {
            let density = if flag == 0 {
                p.fluid_density
            } else if flag == 4 {
                p.solid_density
            } else {
                p.materials[(flag - 5) as usize].density
            };
            let capacity = density * volume * p.cp(flag);
            if !capacity.is_finite() || capacity <= 0.0 {
                return Err(KernelError::InvalidCoefficient);
            }
            capacity
        } else {
            0.0
        };
    }
    refresh(p, flags, b.energy, b.work, b.temperature_delta_k)?;

    // The outgoing advection and conduction diagonals must be added before
    // choosing substeps. Rates on the receiving/donor cells cannot be swapped.
    b.next_energy.fill(0.0);
    let mut error = None;
    faces(c, flags, |f| {
        match face_conductance(p, flags, f) {
            Err(e) => error = Some(e),
            Ok(g) => {
                if let Some(i) = f.left {
                    if active(flags[i]) {
                        b.next_energy[i] += g;
                    }
                }
                if let Some(j) = f.right {
                    if active(flags[j]) {
                        b.next_energy[j] += g;
                    }
                }
            }
        }
        if f.weight != 0.0 {
            let coefficient = advective_coefficient(p, velocities[f.axis][f.index]);
            if !coefficient.is_finite() {
                error = Some(KernelError::NonFiniteValue);
            }
            if coefficient >= 0.0 {
                if let Some(i) = f.left {
                    b.next_energy[i] += coefficient;
                }
            } else if let Some(j) = f.right {
                b.next_energy[j] -= coefficient;
            }
        }
    });
    if let Some(e) = error {
        return Err(e);
    }
    finite(b.next_energy)?;
    let mut required: f64 = 1.0;
    for (i, &flag) in flags.iter().enumerate() {
        if active(flag) {
            required = required.max(p.dt_seconds * b.next_energy[i] / (0.9 * b.work[i]));
        }
    }
    if !required.is_finite() || required > p.max_substeps as f64 {
        return Err(KernelError::InvalidCoefficient);
    }
    let substeps = required as u32 + u32::from(required > required as u32 as f64);
    let dt = p.dt_seconds / substeps as f64;
    if !dt.is_finite() || dt <= 0.0 {
        return Err(KernelError::InvalidCoefficient);
    }
    let mut solid_counts = [0; MAX_THERMAL_MATERIALS + 1];
    let mut sources = [0.0; MAX_THERMAL_MATERIALS + 1];
    let source = source_energies(p, flags, &mut solid_counts, &mut sources)?;
    b.next_energy.copy_from_slice(b.energy);
    let mut boundary = 0.0;
    for _ in 0..substeps {
        // Temperature remains frozen through this complete explicit substep.
        // In-place additions to next_energy do not affect any face donor.
        for (i, &flag) in flags.iter().enumerate() {
            if flag >= 4 {
                let material = (flag - 4) as usize;
                b.next_energy[i] +=
                    sources[material] / solid_counts[material] as f64 / substeps as f64;
            }
        }
        let mut error = None;
        faces(c, flags, |f| {
            match face_conductance(p, flags, f) {
                Err(e) => error = Some(e),
                Ok(g) => {
                    if g != 0.0 {
                        let (Some(i), Some(j)) = (f.left, f.right) else {
                            return;
                        };
                        let de = dt * g * (b.temperature_delta_k[j] - b.temperature_delta_k[i]);
                        if !de.is_finite() {
                            error = Some(KernelError::NonFiniteValue);
                        }
                        if active(flags[i]) {
                            b.next_energy[i] += de;
                        } else {
                            boundary -= de;
                        }
                        if active(flags[j]) {
                            b.next_energy[j] -= de;
                        } else {
                            boundary += de;
                        }
                    }
                }
            }
            if f.weight != 0.0 {
                let coefficient = advective_coefficient(p, velocities[f.axis][f.index]);
                let donor = if coefficient >= 0.0 { f.left } else { f.right };
                let de = dt * coefficient * donor.map_or(0.0, |i| b.temperature_delta_k[i]);
                if !de.is_finite() {
                    error = Some(KernelError::NonFiniteValue);
                }
                if let Some(i) = f.left {
                    b.next_energy[i] -= de;
                } else {
                    boundary += de;
                }
                if let Some(j) = f.right {
                    b.next_energy[j] += de;
                } else {
                    boundary -= de;
                }
            }
        });
        if let Some(e) = error {
            return Err(e);
        }
        refresh(p, flags, b.next_energy, b.work, b.temperature_delta_k)?;
    }
    let after: f64 = b.next_energy.iter().sum();
    let mut solid_max = f64::NEG_INFINITY;
    let mut fluid_max = f64::NEG_INFINITY;
    for (i, &flag) in flags.iter().enumerate() {
        let t = p.ambient_c + b.temperature_delta_k[i];
        if flag == 0 {
            fluid_max = fluid_max.max(t);
        }
        if flag >= 2 {
            solid_max = solid_max.max(t);
        }
    }
    let residual = after - before - source - boundary;
    finite(&[after, source, boundary, residual, solid_max, fluid_max])?;
    Ok(ThermalStep {
        thermal_energy_j: after,
        source_energy_j: source,
        boundary_energy_j: boundary,
        energy_residual_j: residual,
        solid_max_c: solid_max,
        fluid_max_c: fluid_max,
        substeps,
    })
}
