//! D3Q19 BGK / Smagorinsky flow with conservative conjugate heat transport.
//!
//! Uses the product WebGPU direction numbering and AoS populations, not the
//! differently numbered SoA CPU reference fixtures. Cell index is
//! `x + nx * (y + ny * z)`, population index `cell * 19 + direction`.
//! Wind enters at x=0 along +x; y is the lift axis and z is spanwise.
//! Flags: 0 fluid, 1 insulated obstacle, 2 hot wall, 3 ambient wall, 4 conducting solid.
//! Thermal flags require the thermal model. Fan and +y Boussinesq acceleration
//! share Guo forcing. Default and up to 16 region materials; no radiation or general moving bodies.

use crate::sqrt;
pub use crate::thermal::{
    ThermalBuffers, ThermalConfig, ThermalMaterial, ThermalMode, ThermalStep, MAX_THERMAL_CONTACTS,
    MAX_THERMAL_MATERIALS,
};
use crate::{field_value, KernelError};

/// Native consumer handshake for fixed-rho-reference gauge obstacle forces.
pub const D3Q19_GAUGE_FORCE_VERSION: u32 = 1;
/// Native consumer handshake for current-stream non-equilibrium pressure outlets.
pub const D3Q19_NEE_OUTLET_VERSION: u32 = 1;
/// Consumer handshake for current-stream prescribed-velocity inlet extrapolation.
pub const D3Q19_NEE_INLET_VERSION: u32 = 1;
pub const D3Q19_MASS_BALANCE_VERSION: u32 = 1;
/// Optional current-population density pressure relative to the force reference.
pub const D3Q19_PRESSURE_FIELD_VERSION: u32 = 1;

pub const D3Q19_Q: usize = 19;
pub const D3Q19_C: [[i8; 3]; D3Q19_Q] = [
    [0, 0, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [1, 1, 0],
    [-1, -1, 0],
    [1, -1, 0],
    [-1, 1, 0],
    [1, 0, 1],
    [-1, 0, -1],
    [1, 0, -1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, -1],
    [0, 1, -1],
    [0, -1, 1],
];
pub const D3Q19_W: [f64; D3Q19_Q] = [
    1.0 / 3.0,
    1.0 / 18.0,
    1.0 / 18.0,
    1.0 / 18.0,
    1.0 / 18.0,
    1.0 / 18.0,
    1.0 / 18.0,
    1.0 / 36.0,
    1.0 / 36.0,
    1.0 / 36.0,
    1.0 / 36.0,
    1.0 / 36.0,
    1.0 / 36.0,
    1.0 / 36.0,
    1.0 / 36.0,
    1.0 / 36.0,
    1.0 / 36.0,
    1.0 / 36.0,
    1.0 / 36.0,
];
pub const D3Q19_OPPOSITE: [usize; D3Q19_Q] = [
    0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17,
];
const MIRROR_Y: [usize; D3Q19_Q] = [
    0, 1, 2, 4, 3, 5, 6, 9, 10, 7, 8, 11, 12, 13, 14, 18, 17, 16, 15,
];
const MIRROR_Z: [usize; D3Q19_Q] = [
    0, 1, 2, 3, 4, 6, 5, 7, 8, 9, 10, 13, 14, 11, 12, 17, 18, 15, 16,
];
const MAX_SPEED_SQUARED: f64 = 0.04;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum D3q19Boundary {
    /// Current-stream non-equilibrium extrapolation at both x faces: prescribed
    /// inlet velocity with inner density; prescribed outlet rho=1 with inner velocity.
    /// Boundary reconstruction can exchange mass with the exterior.
    WindTunnel,
    Periodic,
    Closed,
}

#[derive(Clone, Copy, Debug)]
pub struct D3q19Config {
    pub nx: usize,
    pub ny: usize,
    pub nz: usize,
    /// BGK relaxation time, finite > 0.5. Lattice viscosity = (tau - 0.5)/3.
    pub tau: f64,
    /// Initial uniform +x velocity and, in wind-tunnel mode, inlet velocity.
    pub u_inlet: f64,
    /// Smagorinsky constant; zero disables the LES stress correction.
    pub smagorinsky_cs: f64,
    /// Deterministic inlet noise amplitude (fraction, not percent), 0..=1.
    pub turbulence_intensity: f64,
    /// Specular y/z walls in WindTunnel mode. Closed mode is no-slip only.
    pub free_slip_walls: bool,
    /// Explicit adiabatic no-slip yMin plane; Some(0) is stationary, None keeps side-wall mode.
    /// Tangential +x speed, in lattice units. Its force is excluded from obstacle_force.
    pub ground_velocity: Option<f64>,
    pub boundary: D3q19Boundary,
    pub fan: Option<D3q19Fan>,
    pub thermal: Option<ThermalConfig>,
}

/// Constant pressure-rise actuator disk, already converted to lattice units.
#[derive(Clone, Copy, Debug)]
pub struct D3q19Fan {
    pub center: [f64; 3],
    pub normal: [f64; 3],
    pub radius_cells: f64,
    /// Delta-p * dt^2 / (physical_density * dx^2), across one cell of thickness.
    pub acceleration_lattice: f64,
}

impl D3q19Fan {
    fn validate(&self, dims: [usize; 3]) -> Result<(), KernelError> {
        if !self
            .center
            .iter()
            .chain(self.normal.iter())
            .all(|value| value.is_finite())
            || !self.radius_cells.is_finite()
            || self.radius_cells < 0.5
            || !self.acceleration_lattice.is_finite()
            || self.acceleration_lattice <= 0.0
            || (dot(self.normal, self.normal) - 1.0).abs() > 1e-6
        {
            return Err(KernelError::InvalidCoefficient);
        }
        for (axis, &dimension) in dims.iter().enumerate() {
            let n = self.normal[axis];
            let extent = self.radius_cells * sqrt((1.0 - n * n).max(0.0))? + 0.5 * n.abs();
            if self.center[axis] - extent < 1.0
                || self.center[axis] + extent > dimension as f64 - 1.0
            {
                return Err(KernelError::InvalidCoefficient);
            }
        }
        Ok(())
    }

    /// Flat-cell wrapper for callers that do not already track [x, y, z]
    /// (the per-step fused flag scan only reaches it until the first hit).
    fn contains_cell(&self, cell: usize, nx: usize, ny: usize) -> bool {
        self.contains([cell % nx, (cell / nx) % ny, cell / (nx * ny)])
    }

    fn contains(&self, position: [usize; 3]) -> bool {
        let position = position.map(|axis| axis as f64 + 0.5);
        let offset = [
            position[0] - self.center[0],
            position[1] - self.center[1],
            position[2] - self.center[2],
        ];
        let distance = dot(offset, self.normal);
        let radial2 = dot(offset, offset) - distance * distance;
        (-0.5..0.5).contains(&distance) && radial2 <= self.radius_cells * self.radius_cells
    }
}

impl D3q19Config {
    /// Checked cell count before allocating caller-owned buffers.
    pub fn cell_count(&self) -> Result<usize, KernelError> {
        if self.nx < 3 || self.ny < 3 || self.nz < 3 {
            return Err(KernelError::InvalidDimensions);
        }
        let count = self
            .nx
            .checked_mul(self.ny)
            .and_then(|xy| xy.checked_mul(self.nz))
            .ok_or(KernelError::InvalidDimensions)?;
        // Signed source coordinates and byte-addressable slices must fit.
        if count
            .checked_mul(D3Q19_Q * core::mem::size_of::<f32>())
            .is_none_or(|bytes| bytes > isize::MAX as usize)
        {
            return Err(KernelError::InvalidDimensions);
        }
        Ok(count)
    }

    fn validate(&self) -> Result<usize, KernelError> {
        let count = self.cell_count()?;
        let t = self.turbulence_intensity;
        let inlet_max_squared = self.u_inlet * self.u_inlet * ((1.0 + t) * (1.0 + t) + 2.0 * t * t);
        if !self.tau.is_finite()
            || self.tau <= 0.5
            || !(0.0..=0.3).contains(&self.smagorinsky_cs)
            || !(0.0..=1.0).contains(&t)
            || !self.u_inlet.is_finite()
            || self.u_inlet < 0.0
            || !inlet_max_squared.is_finite()
            || inlet_max_squared >= MAX_SPEED_SQUARED
        {
            return Err(KernelError::InvalidCoefficient);
        }
        if self.boundary != D3q19Boundary::WindTunnel
            && (self.free_slip_walls || t != 0.0 || self.ground_velocity.is_some())
        {
            return Err(KernelError::UnsupportedFeature);
        }
        if let Some(speed) = self.ground_velocity {
            if !speed.is_finite() || speed < 0.0 || speed as f32 >= 0.2 {
                return Err(KernelError::InvalidCoefficient);
            }
        }
        if let Some(fan) = self.fan {
            fan.validate([self.nx, self.ny, self.nz])?;
        }
        if let Some(thermal) = self.thermal.as_ref() {
            thermal.validate()?;
            if self.tau < 0.505 {
                return Err(KernelError::InvalidCoefficient);
            }
        }
        Ok(count)
    }

    fn acceleration(
        &self,
        cell: usize,
        position: [usize; 3],
        temperature: Option<&[f64]>,
    ) -> Option<[f64; 3]> {
        let fan = self
            .fan
            .filter(|fan| fan.contains(position))
            .map(|fan| fan.normal.map(|value| value * fan.acceleration_lattice));
        if let (Some(thermal), Some(temperature)) = (self.thermal.as_ref(), temperature) {
            let mut acceleration = fan.unwrap_or([0.; 3]);
            acceleration[1] += thermal.gravity_per_kelvin * temperature[cell];
            Some(acceleration)
        } else {
            fan
        }
    }
}

/// Per-step lattice mass in fluid cells 1 <= x <= nx-2. All values are measured
/// from actual f32 populations in f64; no flux is inferred from the mass change.
#[derive(Clone, Copy, Debug, Default)]
pub struct D3q19MassBalance {
    pub bulk_mass_before: f64,
    pub bulk_mass_after: f64,
    /// Actual streaming across x=0/1, positive INTO the internal volume.
    pub inlet_net_mass: f64,
    /// Actual streaming across x=nx-2/nx-1, positive OUT of the internal volume.
    pub outlet_net_mass: f64,
    /// Internal collision stored populations minus input populations.
    pub collision_mass_change: f64,
    /// NEE stored minus streamed populations at the numerical x=0 boundary.
    pub inlet_replacement_mass: f64,
    /// NEE stored minus streamed populations at the numerical x=nx-1 boundary.
    pub outlet_replacement_mass: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct D3q19Step {
    /// Single-step gauge force on flagged solids, in lattice force units, relative
    /// to rho_reference=1 at rest (the same f32 equilibrium weights as init).
    /// Excludes external domain walls. Raw momentum transfer equals this force
    /// plus the reference-pressure load over these exact model bounce-back links.
    pub obstacle_force: [f64; 3],
    /// Sum of fluid-cell densities after streaming and boundary application.
    pub mass: f64,
    pub mass_balance: D3q19MassBalance,
    pub max_speed: f64,
    pub thermal: Option<ThermalStep>,
}

fn validate_buffers(
    config: &D3q19Config,
    flags: &[u8],
    f: &[f32],
    post_collision: &[f32],
    velocity: &[f32],
    density: &[f32],
    thermal: Option<&ThermalBuffers<'_>>,
) -> Result<usize, KernelError> {
    let count = config.validate()?;
    if flags.len() != count
        || f.len() != count * D3Q19_Q
        || post_collision.len() != f.len()
        || velocity.len() != count * 3
        || density.len() != count
    {
        return Err(KernelError::BufferLength);
    }
    // One fused sweep collects every flag predicate the checks below need, so
    // a step costs a single pass instead of one scan per check. `seen` bit k
    // records flag value k (only 0..=20 are queried); `fan_hit` short-circuits
    // `fan.contains` exactly like the former `.any()` once one fluid fan cell
    // is found.
    let max_flag = if thermal.is_some() { 20 } else { 1 };
    let thermal_params = config.thermal.filter(|_| thermal.is_some());
    let mut seen = 0u32;
    let mut bad_flag = false;
    let mut fan_hit = false;
    for (cell, &flag) in flags.iter().enumerate() {
        bad_flag |= flag > max_flag;
        if flag <= 20 {
            seen |= 1u32 << flag;
        }
        if let Some(params) = thermal_params {
            bad_flag |= flag > 4 + params.material_count as u8
                || (flag >= 4 && params.mode != ThermalMode::SolidPower)
                || (flag == 2 && params.mode != ThermalMode::FixedTemperature);
        }
        if let (Some(fan), false, 0) = (config.fan, fan_hit, flag) {
            fan_hit = fan.contains_cell(cell, config.nx, config.ny);
        }
    }
    if config.thermal.is_some() != thermal.is_some() || bad_flag {
        return Err(KernelError::UnsupportedFeature);
    }
    if let (Some(params), Some(state)) = (config.thermal.as_ref(), thermal) {
        if (params.mode == ThermalMode::SolidPower && seen >> 4 == 0)
            || (params.mode == ThermalMode::FixedTemperature && seen & (1u32 << 2) == 0)
        {
            return Err(KernelError::InvalidState);
        }
        if (params.total_power_w > 0. && seen & (1u32 << 4) == 0)
            || (0..params.material_count).any(|i| seen & (1u32 << (5 + i as u32)) == 0)
        {
            return Err(KernelError::InvalidState);
        }
        params.validate_contacts(config, flags)?;
        if state.energy.len() != count
            || state.next_energy.len() != count
            || state.temperature_delta_k.len() != count
            || state.mass.len() != count
        {
            return Err(KernelError::BufferLength);
        }
    }
    if config.boundary == D3q19Boundary::WindTunnel
        && (0..count).step_by(config.nx).any(|cell| {
            (flags[cell] == 0 && flags[cell + 1] != 0)
                || (flags[cell + config.nx - 1] == 0 && flags[cell + config.nx - 2] != 0)
        })
    {
        return Err(KernelError::InvalidState);
    }
    if seen & 1 == 0 {
        return Err(KernelError::InvalidState);
    }
    if config.fan.is_some() && !fan_hit {
        return Err(KernelError::InvalidState);
    }
    Ok(count)
}

#[inline(always)]
fn mul_add(a: f64, b: f64, c: f64) -> f64 {
    #[cfg(all(target_arch = "x86_64", target_feature = "fma"))]
    unsafe {
        use core::arch::x86_64::{_mm_cvtsd_f64, _mm_fmadd_sd, _mm_set_sd};
        return _mm_cvtsd_f64(_mm_fmadd_sd(_mm_set_sd(a), _mm_set_sd(b), _mm_set_sd(c)));
    }
    #[allow(unreachable_code)]
    {
        a * b + c
    }
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    mul_add(a[0], b[0], mul_add(a[1], b[1], a[2] * b[2]))
}

fn equilibrium(q: usize, rho: f64, u: [f64; 3]) -> f64 {
    let cu = dot(D3Q19_C[q].map(f64::from), u);
    let poly = mul_add(-1.5, dot(u, u), mul_add(cu, 4.5 * cu, mul_add(cu, 3.0, 1.0)));
    (D3Q19_W[q] * rho) * poly
}

fn moments(
    populations: &[f32],
    acceleration: Option<[f64; 3]>,
) -> Result<(f64, [f64; 3]), KernelError> {
    let mut rho = 0.0;
    let mut momentum = [0.0; 3];
    for (q, &stored) in populations.iter().enumerate() {
        if !stored.is_finite() {
            return Err(KernelError::NonFiniteValue);
        }
        let value = stored as f64;
        rho += value;
        for (axis, component) in momentum.iter_mut().enumerate() {
            *component = mul_add(value, D3Q19_C[q][axis] as f64, *component);
        }
    }
    if !rho.is_finite() || rho <= 0.0 {
        return Err(KernelError::InvalidState);
    }
    let u = if let Some(acceleration) = acceleration {
        core::array::from_fn(|axis| (momentum[axis] + 0.5 * (rho * acceleration[axis])) / rho)
    } else {
        momentum.map(|value| value / rho)
    };
    if !u.iter().all(|value| value.is_finite()) {
        return Err(KernelError::NonFiniteValue);
    }
    if dot(u, u) >= MAX_SPEED_SQUARED {
        return Err(KernelError::InvalidState);
    }
    Ok((rho, u))
}

/// Initialize rho=1 and uniform +x equilibrium in dimensionless lattice units.
/// Buffers are supplied by the caller; this function allocates nothing.
pub fn init_d3q19(
    config: &D3q19Config,
    flags: &[u8],
    f: &mut [f32],
    post_collision: &mut [f32],
    velocity: &mut [f32],
    density: &mut [f32],
    mut thermal: Option<ThermalBuffers<'_>>,
) -> Result<(), KernelError> {
    let count = validate_buffers(
        config,
        flags,
        f,
        post_collision,
        velocity,
        density,
        thermal.as_ref(),
    )?;
    let u = [config.u_inlet, 0.0, 0.0];
    let mut initial = [0.0; D3Q19_Q];
    for (q, value) in initial.iter_mut().enumerate() {
        *value = field_value(equilibrium(q, 1.0, u))?;
    }
    for cell in 0..count {
        f[cell * D3Q19_Q..(cell + 1) * D3Q19_Q].copy_from_slice(&initial);
        post_collision[cell * D3Q19_Q..(cell + 1) * D3Q19_Q].copy_from_slice(&initial);
        velocity[cell * 3..cell * 3 + 3].copy_from_slice(&if flags[cell] == 0 {
            u.map(|v| v as f32)
        } else {
            [0.0; 3]
        });
        density[cell] = 1.0;
    }
    if let (Some(params), Some(state)) = (config.thermal.as_ref(), thermal.as_mut()) {
        crate::thermal::initialize(params, flags, f, state)?;
    }
    Ok(())
}

/// Collide -> pull stream / obstacle bounce-back -> boundaries -> moments.
/// `f` holds the completed next state on success; no buffer swap is needed.
/// `step_index` starts at 1 and determines reproducible inlet noise. `velocity`
/// and `density` describe the completed state, not a stale pre-stream snapshot.
/// Numerical failure may partially update the buffers: discard the failed job.
#[allow(clippy::too_many_arguments)]
pub fn step_d3q19(
    config: &D3q19Config,
    flags: &[u8],
    f: &mut [f32],
    post_collision: &mut [f32],
    velocity: &mut [f32],
    density: &mut [f32],
    mut thermal: Option<ThermalBuffers<'_>>,
    step_index: u32,
) -> Result<D3q19Step, KernelError> {
    validate_buffers(
        config,
        flags,
        f,
        post_collision,
        velocity,
        density,
        thermal.as_ref(),
    )?;
    if let (Some(params), Some(state)) = (config.thermal.as_ref(), thermal.as_mut()) {
        crate::thermal::refresh(params, flags, state)?;
    }
    let mut mass_balance = D3q19MassBalance::default();
    let (bulk_mass_before, collision_mass_change) = collide(
        config,
        flags,
        f,
        post_collision,
        velocity,
        density,
        thermal.as_ref().map(|state| &*state.temperature_delta_k),
    )?;
    mass_balance.bulk_mass_before = bulk_mass_before;
    mass_balance.collision_mass_change = collision_mass_change;
    let obstacle_force = stream(config, flags, f, post_collision, &mut mass_balance)?;
    if config.boundary == D3q19Boundary::WindTunnel {
        boundary(config, flags, f, step_index, &mut mass_balance)?;
    }
    let thermal_stats =
        if let (Some(params), Some(state)) = (config.thermal.as_ref(), thermal.as_mut()) {
            Some(crate::thermal::advance(
                config,
                params,
                flags,
                post_collision,
                f,
                state,
            )?)
        } else {
            None
        };
    let temperature = thermal.as_ref().map(|state| &*state.temperature_delta_k);
    let (mass, max_speed_squared) =
        finish_moments(config, flags, f, velocity, density, temperature, &mut mass_balance)?;
    Ok(D3q19Step {
        obstacle_force,
        mass,
        mass_balance,
        max_speed: sqrt(max_speed_squared)?,
        thermal: thermal_stats,
    })
}

fn finish_moments(
    config: &D3q19Config,
    flags: &[u8],
    f: &[f32],
    velocity: &mut [f32],
    density: &mut [f32],
    temperature: Option<&[f64]>,
    mass_balance: &mut D3q19MassBalance,
) -> Result<(f64, f64), KernelError> {
    #[cfg(feature = "parallel")]
    {
        finish_moments_parallel(config, flags, f, velocity, density, temperature, mass_balance)
    }
    #[cfg(not(feature = "parallel"))]
    {
        finish_moments_serial(config, flags, f, velocity, density, temperature, mass_balance)
    }
}

fn finish_moments_one_cell(
    config: &D3q19Config,
    flags: &[u8],
    f: &[f32],
    velocity: &mut [f32],
    density: &mut f32,
    temperature: Option<&[f64]>,
    cell: usize,
    position: [usize; 3],
) -> Result<(f64, f64), KernelError> {
    if flags[cell] != 0 {
        return Ok((0.0, 0.0));
    }
    let (rho, u) = moments(
        &f[cell * D3Q19_Q..(cell + 1) * D3Q19_Q],
        config.acceleration(cell, position, temperature),
    )?;
    *density = field_value(rho)?;
    velocity.copy_from_slice(&u.map(|value| value as f32));
    Ok((rho, dot(u, u)))
}

#[cfg(any(test, not(feature = "parallel")))]
fn finish_moments_serial(
    config: &D3q19Config,
    flags: &[u8],
    f: &[f32],
    velocity: &mut [f32],
    density: &mut [f32],
    temperature: Option<&[f64]>,
    mass_balance: &mut D3q19MassBalance,
) -> Result<(f64, f64), KernelError> {
    let mut mass = 0.0;
    let mut max_speed_squared: f64 = 0.0;
    // z/y/x iteration hands each cell its position directly; visit order
    // matches the original flat 0..n accumulation order.
    let mut cell = 0;
    for z in 0..config.nz {
        for y in 0..config.ny {
            for x in 0..config.nx {
                let (rho, speed2) = finish_moments_one_cell(
                    config,
                    flags,
                    f,
                    &mut velocity[cell * 3..cell * 3 + 3],
                    &mut density[cell],
                    temperature,
                    cell,
                    [x, y, z],
                )?;
                mass += rho;
                if flags[cell] == 0 && x > 0 && x + 1 < config.nx {
                    mass_balance.bulk_mass_after += rho;
                }
                max_speed_squared = max_speed_squared.max(speed2);
                cell += 1;
            }
        }
    }
    Ok((mass, max_speed_squared))
}

#[cfg(feature = "parallel")]
fn finish_moments_parallel(
    config: &D3q19Config,
    flags: &[u8],
    f: &[f32],
    velocity: &mut [f32],
    density: &mut [f32],
    temperature: Option<&[f64]>,
    mass_balance: &mut D3q19MassBalance,
) -> Result<(f64, f64), KernelError> {
    use rayon::prelude::*;
    use std::sync::Mutex;
    static SCRATCH: Mutex<(Vec<f64>, Vec<f64>)> = Mutex::new((Vec::new(), Vec::new()));
    let n = flags.len();
    let mut scratch = SCRATCH.lock().unwrap_or_else(|poison| poison.into_inner());
    if scratch.0.len() < n {
        scratch.0.resize(n, 0.0);
        scratch.1.resize(n, 0.0);
    } else {
        scratch.0[..n].fill(0.0);
        scratch.1[..n].fill(0.0);
    }
    let (rho_cells, speed_cells) = &mut *scratch;
    // nx-sized row chunks: one row index divmod instead of one per cell, and
    // rayon's split granularity stays O(ny*nz) rows rather than n cells.
    velocity
        .par_chunks_mut(config.nx * 3)
        .zip(density.par_chunks_mut(config.nx))
        .zip(rho_cells[..n].par_chunks_mut(config.nx))
        .zip(speed_cells[..n].par_chunks_mut(config.nx))
        .enumerate()
        .try_for_each(|(row, (((vels, denss), rhos), speed2s))| {
            let z = row / config.ny;
            let y = row % config.ny;
            for x in 0..config.nx {
                let (cell_rho, cell_speed) = finish_moments_one_cell(
                    config,
                    flags,
                    f,
                    &mut vels[x * 3..x * 3 + 3],
                    &mut denss[x],
                    temperature,
                    row * config.nx + x,
                    [x, y, z],
                )?;
                rhos[x] = cell_rho;
                speed2s[x] = cell_speed;
            }
            Ok(())
        })?;
    let mut mass = 0.0;
    let mut max_speed_squared: f64 = 0.0;
    let mut cell = 0;
    for _z in 0..config.nz {
        for _y in 0..config.ny {
            for x in 0..config.nx {
                mass += rho_cells[cell];
                if flags[cell] == 0 && x > 0 && x + 1 < config.nx {
                    mass_balance.bulk_mass_after += rho_cells[cell];
                }
                max_speed_squared = max_speed_squared.max(speed_cells[cell]);
                cell += 1;
            }
        }
    }
    Ok((mass, max_speed_squared))
}

/// Interleaved speed/vorticity magnitudes, matching the product shader's
/// clamped-neighbor central differences (including its boundary convention).
/// Solid velocities are zero; vorticity still uses the neighboring fluid.
/// Optional current populations append gauge density pressure Σ(f-f32(w))/3.
/// Inputs remain unchanged on failure; the partially written display is invalid.
pub fn display_d3q19(
    config: &D3q19Config,
    velocity: &[f32],
    flags: &[u8],
    temperature: Option<&[f64]>,
    populations: Option<&[f32]>,
    display: &mut [f32],
) -> Result<(), KernelError> {
    let (nx, ny, nz) = (config.nx, config.ny, config.nz);
    let count = crate::geometry::cell_count(nx, ny, nz)?;
    let stride = 2 + usize::from(config.thermal.is_some()) + usize::from(populations.is_some());
    if config.thermal.is_some() != temperature.is_some() {
        return Err(KernelError::UnsupportedFeature);
    }
    if let Some(params) = config.thermal.as_ref() {
        params.validate()?;
        params.validate_flags(flags)?;
    }
    if let Some(field) = temperature {
        if field.len() != count {
            return Err(KernelError::BufferLength);
        }
        if field.iter().any(|v| !v.is_finite()) {
            return Err(KernelError::NonFiniteValue);
        }
    }
    if let Some(field) = populations {
        if field.len()
            != count
                .checked_mul(D3Q19_Q)
                .ok_or(KernelError::BufferLength)?
        {
            return Err(KernelError::BufferLength);
        }
    }
    if flags.len() != count
        || velocity.len() != count.checked_mul(3).ok_or(KernelError::BufferLength)?
        || display.len() != count.checked_mul(stride).ok_or(KernelError::BufferLength)?
    {
        return Err(KernelError::BufferLength);
    }
    if flags
        .iter()
        .any(|&flag| flag > if config.thermal.is_some() { 20 } else { 1 })
    {
        return Err(KernelError::UnsupportedFeature);
    }
    if velocity.iter().any(|value| !value.is_finite()) {
        return Err(KernelError::NonFiniteValue);
    }
    let at = |cell: usize, axis: usize| {
        if flags[cell] == 0 {
            velocity[cell * 3 + axis] as f64
        } else {
            0.0
        }
    };
    let index = |x, y, z| x + nx * (y + ny * z);
    for z in 0..nz {
        for y in 0..ny {
            for x in 0..nx {
                let cell = index(x, y, z);
                let xm = index(x.saturating_sub(1), y, z);
                let xp = index((x + 1).min(nx - 1), y, z);
                let ym = index(x, y.saturating_sub(1), z);
                let yp = index(x, (y + 1).min(ny - 1), z);
                let zm = index(x, y, z.saturating_sub(1));
                let zp = index(x, y, (z + 1).min(nz - 1));
                let u = [at(cell, 0), at(cell, 1), at(cell, 2)];
                let vort = [
                    (at(yp, 2) - at(ym, 2)) * 0.5 - (at(zp, 1) - at(zm, 1)) * 0.5,
                    (at(zp, 0) - at(zm, 0)) * 0.5 - (at(xp, 2) - at(xm, 2)) * 0.5,
                    (at(xp, 1) - at(xm, 1)) * 0.5 - (at(yp, 0) - at(ym, 0)) * 0.5,
                ];
                display[cell * stride] = field_value(sqrt(dot(u, u))?)?;
                display[cell * stride + 1] = field_value(sqrt(dot(vort, vort))?)?;
                if let (Some(params), Some(field)) = (config.thermal.as_ref(), temperature) {
                    display[cell * stride + 2] =
                        field_value(field[cell] / params.temperature_scale_c)?;
                }
                if let Some(field) = populations {
                    let mut delta = 0.0;
                    if flags[cell] == 0 {
                        for q in 0..D3Q19_Q {
                            let value = field[cell * D3Q19_Q + q];
                            if !value.is_finite() {
                                return Err(KernelError::NonFiniteValue);
                            }
                            delta += value as f64 - D3Q19_W[q] as f32 as f64;
                        }
                    }
                    display[cell * stride + stride - 1] = field_value(delta / 3.0)?;
                }
            }
        }
    }
    Ok(())
}

fn collide_one_cell(
    config: &D3q19Config,
    flag: u8,
    populations: &[f32],
    post: &mut [f32],
    velocity: &mut [f32],
    density: &mut f32,
    temperature: Option<&[f64]>,
    cell: usize,
    position: [usize; 3],
    bulk_mass: &mut f64,
    collision_mass: &mut f64,
) -> Result<(), KernelError> {
    *bulk_mass = 0.0;
    *collision_mass = 0.0;
    if flag != 0 {
        velocity.fill(0.0);
        *density = 1.0;
        return Ok(());
    }
    let acceleration = config.acceleration(cell, position, temperature);
    let (rho, u) = moments(populations, acceleration)?;
    let bulk = position[0] > 0 && position[0] + 1 < config.nx;
    if bulk {
        *bulk_mass = rho;
    }
    let force = acceleration.map(|values| values.map(|value| rho * value));
    let mut fe = [0.0; D3Q19_Q];
    let mut stress = [0.0; 6]; // xx, yy, zz, xy, xz, yz
    for (q, value) in fe.iter_mut().enumerate() {
        *value = equilibrium(q, rho, u);
        if config.smagorinsky_cs > 0.0 {
            let d = populations[q] as f64 - *value;
            let [x, y, z] = D3Q19_C[q].map(f64::from);
            for (s, tensor) in stress
                .iter_mut()
                .zip([x * x, y * y, z * z, x * y, x * z, y * z])
            {
                *s += tensor * d;
            }
        }
    }
    if let Some([fx, fy, fz]) = force {
        stress[0] += u[0] * fx;
        stress[1] += u[1] * fy;
        stress[2] += u[2] * fz;
        stress[3] += 0.5 * (u[0] * fy + u[1] * fx);
        stress[4] += 0.5 * (u[0] * fz + u[2] * fx);
        stress[5] += 0.5 * (u[1] * fz + u[2] * fy);
    }
    let tau = if config.smagorinsky_cs > 0.0 {
        let [xx, yy, zz, xy, xz, yz] = stress;
        let q = sqrt(xx * xx + yy * yy + zz * zz + 2.0 * (xy * xy + xz * xz + yz * yz))?;
        0.5 * (config.tau
            + sqrt(
                config.tau * config.tau
                    + 18.0 * config.smagorinsky_cs * config.smagorinsky_cs * q / rho.max(1e-6),
            )?)
    } else {
        config.tau
    };
    if !tau.is_finite() || tau <= 0.5 {
        return Err(KernelError::InvalidState);
    }
    let omega = 1.0 / tau;
    for q in 0..D3Q19_Q {
        let value = populations[q] as f64;
        let collided = mul_add(omega, fe[q] - value, value);
        post[q] = field_value(if let Some(force) = force {
            let ci = D3Q19_C[q].map(f64::from);
            let cu = dot(ci, u);
            let source =
                core::array::from_fn(|axis| mul_add(9.0, cu * ci[axis], 3.0 * (ci[axis] - u[axis])));
            let guo = (D3Q19_W[q] * mul_add(0.5, -omega, 1.0)) * dot(source, force);
            collided + guo
        } else {
            collided
        })?;
        if bulk {
            *collision_mass += post[q] as f64 - value;
        }
    }
    velocity.copy_from_slice(&u.map(|value| value as f32));
    *density = field_value(rho)?;
    Ok(())
}

fn collide(
    config: &D3q19Config,
    flags: &[u8],
    f: &[f32],
    post_collision: &mut [f32],
    velocity: &mut [f32],
    density: &mut [f32],
    temperature: Option<&[f64]>,
) -> Result<(f64, f64), KernelError> {
    #[cfg(feature = "parallel")]
    {
        collide_parallel(
            config,
            flags,
            f,
            post_collision,
            velocity,
            density,
            temperature,
        )
    }
    #[cfg(not(feature = "parallel"))]
    {
        collide_serial(
            config,
            flags,
            f,
            post_collision,
            velocity,
            density,
            temperature,
        )
    }
}

#[cfg(any(test, not(feature = "parallel")))]
fn collide_serial(
    config: &D3q19Config,
    flags: &[u8],
    f: &[f32],
    post_collision: &mut [f32],
    velocity: &mut [f32],
    density: &mut [f32],
    temperature: Option<&[f64]>,
) -> Result<(f64, f64), KernelError> {
    let mut bulk_mass_before = 0.;
    let mut collision_mass_change = 0.;
    let mut cell = 0;
    for z in 0..config.nz {
        for y in 0..config.ny {
            for (x, &flag) in flags[cell..cell + config.nx].iter().enumerate() {
                let start = cell * D3Q19_Q;
                let mut bulk = 0.;
                let mut dcol = 0.;
                collide_one_cell(
                    config,
                    flag,
                    &f[start..start + D3Q19_Q],
                    &mut post_collision[start..start + D3Q19_Q],
                    &mut velocity[cell * 3..cell * 3 + 3],
                    &mut density[cell],
                    temperature,
                    cell,
                    [x, y, z],
                    &mut bulk,
                    &mut dcol,
                )?;
                bulk_mass_before += bulk;
                collision_mass_change += dcol;
                cell += 1;
            }
        }
    }
    Ok((bulk_mass_before, collision_mass_change))
}

#[cfg(feature = "parallel")]
fn collide_parallel(
    config: &D3q19Config,
    flags: &[u8],
    f: &[f32],
    post_collision: &mut [f32],
    velocity: &mut [f32],
    density: &mut [f32],
    temperature: Option<&[f64]>,
) -> Result<(f64, f64), KernelError> {
    use rayon::prelude::*;
    use std::sync::Mutex;
    static SCRATCH: Mutex<(Vec<f64>, Vec<f64>)> = Mutex::new((Vec::new(), Vec::new()));
    let n = flags.len();
    let mut scratch = SCRATCH.lock().unwrap_or_else(|poison| poison.into_inner());
    if scratch.0.len() < n {
        scratch.0.resize(n, 0.0);
        scratch.1.resize(n, 0.0);
    } else {
        scratch.0[..n].fill(0.0);
        scratch.1[..n].fill(0.0);
    }
    let (bulk_cells, dcol_cells) = &mut *scratch;
    // nx-sized row chunks: one row index divmod instead of one per cell.
    post_collision
        .par_chunks_mut(config.nx * D3Q19_Q)
        .zip(velocity.par_chunks_mut(config.nx * 3))
        .zip(density.par_chunks_mut(config.nx))
        .zip(bulk_cells[..n].par_chunks_mut(config.nx))
        .zip(dcol_cells[..n].par_chunks_mut(config.nx))
        .enumerate()
        .try_for_each(|(row, ((((posts, vels), denss), bulks), dcols))| {
            let z = row / config.ny;
            let y = row % config.ny;
            for x in 0..config.nx {
                collide_one_cell(
                    config,
                    flags[row * config.nx + x],
                    &f[(row * config.nx + x) * D3Q19_Q..(row * config.nx + x) * D3Q19_Q + D3Q19_Q],
                    &mut posts[x * D3Q19_Q..x * D3Q19_Q + D3Q19_Q],
                    &mut vels[x * 3..x * 3 + 3],
                    &mut denss[x],
                    temperature,
                    row * config.nx + x,
                    [x, y, z],
                    &mut bulks[x],
                    &mut dcols[x],
                )?;
            }
            Ok(())
        })?;
    // Same left-to-right cell order as collide_serial, including +0 solid slots.
    let bulk_mass_before = bulk_cells[..n].iter().fold(0.0, |sum, value| sum + *value);
    let collision_mass_change = dcol_cells[..n].iter().fold(0.0, |sum, value| sum + *value);
    Ok((bulk_mass_before, collision_mass_change))
}

/// Forward half-way transport link and the arrival population direction.
/// Specular side walls reflect only crossed y/z normals; tangential travel
/// remains intact. The reverse link starts with opposite[arrival]. Solids are
/// handled by the caller: a blocked reflected link uses obstacle bounce-back.
// Keep mapping in the hot flow/heat loops so the compiler can specialize directions.
#[inline(always)]
pub(crate) fn stream_destination(
    config: &D3q19Config,
    position: [usize; 3],
    q: usize,
) -> Option<(usize, usize)> {
    let dims = [config.nx, config.ny, config.nz];
    let mut dst =
        core::array::from_fn::<_, 3, _>(|axis| position[axis] as isize + D3Q19_C[q][axis] as isize);
    let mut arrival = q;
    // Ground no-slip takes precedence over any z specular reflection at an edge.
    // It is an impermeable local bounce-back link, not a thermal transport link.
    if config.ground_velocity.is_some() && dst[1] < 0 {
        return None;
    }
    if config.boundary == D3q19Boundary::Periodic {
        for axis in 0..3 {
            dst[axis] = dst[axis].rem_euclid(dims[axis] as isize);
        }
    } else if config.boundary == D3q19Boundary::WindTunnel && config.free_slip_walls {
        if dst[1] < 0 || dst[1] >= config.ny as isize {
            dst[1] = position[1] as isize;
            arrival = MIRROR_Y[arrival];
        }
        if dst[2] < 0 || dst[2] >= config.nz as isize {
            dst[2] = position[2] as isize;
            arrival = MIRROR_Z[arrival];
        }
    }
    if (0..3).any(|axis| dst[axis] < 0 || dst[axis] >= dims[axis] as isize) {
        return None;
    }
    Some((
        dst[0] as usize + config.nx * (dst[1] as usize + config.ny * dst[2] as usize),
        arrival,
    ))
}

fn stream_one_cell(
    config: &D3q19Config,
    flags: &[u8],
    post_collision: &[f32],
    streamed: &mut [f32],
    cell: usize,
    position: [usize; 3],
) -> Result<([f64; 3], f64, f64), KernelError> {
    let mut force = [0.0; 3];
    let mut inlet_net = 0.0;
    let mut outlet_net = 0.0;
    if flags[cell] != 0 {
        return Ok((force, inlet_net, outlet_net));
    }
    let [x, y, z] = position;
    let ground = config.ground_velocity.filter(|_| y == 0);
    let ground_density = if ground.is_some_and(|speed| speed != 0.0) {
        post_collision[cell * D3Q19_Q..(cell + 1) * D3Q19_Q]
            .iter()
            .map(|&value| value as f64)
            .sum()
    } else {
        0.0
    };
    for q in 0..D3Q19_Q {
        let opposite = D3Q19_OPPOSITE[q];
        let value = if let Some(speed) = ground.filter(|_| D3Q19_C[q][1] > 0) {
            field_value(
                post_collision[cell * D3Q19_Q + opposite] as f64
                    + 6.0 * D3Q19_W[q] * ground_density * D3Q19_C[q][0] as f64 * speed,
            )?
        } else if let Some((donor, reversed)) = stream_destination(config, [x, y, z], opposite) {
            if flags[donor] != 0 {
                let value = post_collision[cell * D3Q19_Q + opposite];
                let gauge = value as f64 - D3Q19_W[opposite] as f32 as f64;
                for (axis, component) in force.iter_mut().enumerate() {
                    *component += 2.0 * gauge * D3Q19_C[opposite][axis] as f64;
                }
                value
            } else {
                let value = post_collision[donor * D3Q19_Q + D3Q19_OPPOSITE[reversed]];
                if x <= 1 || x + 2 >= config.nx {
                    let donor_x = donor % config.nx;
                    let bulk = x > 0 && x + 1 < config.nx;
                    let donor_bulk = donor_x > 0 && donor_x + 1 < config.nx;
                    if bulk && donor_x == 0 {
                        inlet_net += value as f64;
                    }
                    if donor_bulk && x == 0 {
                        inlet_net -= value as f64;
                    }
                    if donor_bulk && x + 1 == config.nx {
                        outlet_net += value as f64;
                    }
                    if bulk && donor_x + 1 == config.nx {
                        outlet_net -= value as f64;
                    }
                }
                value
            }
        } else {
            post_collision[cell * D3Q19_Q + opposite]
        };
        if !value.is_finite() {
            return Err(KernelError::NonFiniteValue);
        }
        streamed[q] = value;
    }
    Ok((force, inlet_net, outlet_net))
}

fn stream(
    config: &D3q19Config,
    flags: &[u8],
    f: &mut [f32],
    post_collision: &[f32],
    mass_balance: &mut D3q19MassBalance,
) -> Result<[f64; 3], KernelError> {
    #[cfg(feature = "parallel")]
    {
        stream_parallel(config, flags, f, post_collision, mass_balance)
    }
    #[cfg(not(feature = "parallel"))]
    {
        stream_serial(config, flags, f, post_collision, mass_balance)
    }
}

#[cfg(any(test, not(feature = "parallel")))]
fn stream_serial(
    config: &D3q19Config,
    flags: &[u8],
    f: &mut [f32],
    post_collision: &[f32],
    mass_balance: &mut D3q19MassBalance,
) -> Result<[f64; 3], KernelError> {
    let mut force = [0.0; 3];
    let mut cell = 0;
    for z in 0..config.nz {
        for y in 0..config.ny {
            for x in 0..config.nx {
                let (cell_force, inlet, outlet) = stream_one_cell(
                    config,
                    flags,
                    post_collision,
                    &mut f[cell * D3Q19_Q..cell * D3Q19_Q + D3Q19_Q],
                    cell,
                    [x, y, z],
                )?;
                force[0] += cell_force[0];
                force[1] += cell_force[1];
                force[2] += cell_force[2];
                mass_balance.inlet_net_mass += inlet;
                mass_balance.outlet_net_mass += outlet;
                cell += 1;
            }
        }
    }
    if force.iter().any(|value| !value.is_finite()) {
        return Err(KernelError::NonFiniteValue);
    }
    Ok(force)
}

#[cfg(feature = "parallel")]
fn stream_parallel(
    config: &D3q19Config,
    flags: &[u8],
    f: &mut [f32],
    post_collision: &[f32],
    mass_balance: &mut D3q19MassBalance,
) -> Result<[f64; 3], KernelError> {
    use rayon::prelude::*;
    use std::sync::Mutex;
    static SCRATCH: Mutex<[Vec<f64>; 5]> =
        Mutex::new([Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new()]);
    let n = flags.len();
    let mut scratch = SCRATCH.lock().unwrap_or_else(|poison| poison.into_inner());
    for lane in scratch.iter_mut() {
        if lane.len() < n {
            lane.resize(n, 0.0);
        } else {
            lane[..n].fill(0.0);
        }
    }
    let [fx, fy, fz, inlet, outlet] = &mut *scratch;
    f.par_chunks_mut(config.nx * D3Q19_Q)
        .zip(fx[..n].par_chunks_mut(config.nx))
        .zip(fy[..n].par_chunks_mut(config.nx))
        .zip(fz[..n].par_chunks_mut(config.nx))
        .zip(inlet[..n].par_chunks_mut(config.nx))
        .zip(outlet[..n].par_chunks_mut(config.nx))
        .enumerate()
        .try_for_each(|(row, (((((fs, cxs), cys), czs), cins), couts))| {
            let z = row / config.ny;
            let y = row % config.ny;
            for x in 0..config.nx {
                let (cell_force, cell_inlet, cell_outlet) = stream_one_cell(
                    config,
                    flags,
                    post_collision,
                    &mut fs[x * D3Q19_Q..x * D3Q19_Q + D3Q19_Q],
                    row * config.nx + x,
                    [x, y, z],
                )?;
                cxs[x] = cell_force[0];
                cys[x] = cell_force[1];
                czs[x] = cell_force[2];
                cins[x] = cell_inlet;
                couts[x] = cell_outlet;
            }
            Ok(())
        })?;
    let mut force = [0.0; 3];
    for cell in 0..n {
        force[0] += fx[cell];
        force[1] += fy[cell];
        force[2] += fz[cell];
        mass_balance.inlet_net_mass += inlet[cell];
        mass_balance.outlet_net_mass += outlet[cell];
    }
    if force.iter().any(|value| !value.is_finite()) {
        return Err(KernelError::NonFiniteValue);
    }
    Ok(force)
}

fn hash(n: u32) -> f64 {
    let mut x = n.wrapping_mul(747_796_405).wrapping_add(2_891_336_453);
    x = ((x >> ((x >> 28) + 4)) ^ x).wrapping_mul(277_803_737);
    ((x >> 22) ^ x) as f64 / u32::MAX as f64
}

fn boundary(
    config: &D3q19Config,
    flags: &[u8],
    f: &mut [f32],
    step: u32,
    mass_balance: &mut D3q19MassBalance,
) -> Result<(), KernelError> {
    // Only the x==0 (inlet) and x==nx-1 (outlet) planes carry work, so iterate
    // them directly instead of sweeping the whole volume. Per (z, y) row the
    // inlet cell is still visited before the outlet cell, preserving the exact
    // mass_balance accumulation order of the former x-innermost loop.
    for z in 0..config.nz {
        for y in 0..config.ny {
            let row = config.nx * (y + config.ny * z);
            let cell = row;
            if flags[cell] == 0 {
                let start = cell * D3Q19_Q;
                // Guo/Zheng/Shi (2002), Eq. 11/14: neighbor pressure, prescribed
                // velocity. Density-form adaptation to this D3Q19 equilibrium.
                // Both moments and fneq come from the current streamed neighbor.
                let inner: [f32; D3Q19_Q] =
                    core::array::from_fn(|q| f[(cell + 1) * D3Q19_Q + q]);
                let (rho, u_inner) = moments(&inner, None)?;
                let u = inlet_velocity(config, cell, step);
                for q in 0..D3Q19_Q {
                    let before = f[start + q];
                    f[start + q] = field_value(
                        equilibrium(q, rho, u)
                            + (inner[q] as f64 - equilibrium(q, rho, u_inner)),
                    )?;
                    mass_balance.inlet_replacement_mass += f[start + q] as f64 - before as f64;
                }
            }
            if config.nx > 1 {
                let cell = row + config.nx - 1;
                if flags[cell] == 0 {
                    let start = cell * D3Q19_Q;
                    // Guo/Zheng/Shi (2002), DOI 10.1088/1009-1963/11/4/310.
                    // Read the current streamed fluid neighbor, never stale velocity/post.
                    // Bare moments make the extrapolated part carry zero mass/momentum.
                    let inner: [f32; D3Q19_Q] =
                        core::array::from_fn(|q| f[(cell - 1) * D3Q19_Q + q]);
                    let (rho, u) = moments(&inner, None)?;
                    for q in 0..D3Q19_Q {
                        let before = f[start + q];
                        f[start + q] = field_value(
                            equilibrium(q, 1.0, u) + (inner[q] as f64 - equilibrium(q, rho, u)),
                        )?;
                        mass_balance.outlet_replacement_mass += f[start + q] as f64
                            - before as f64;
                    }
                }
            }
        }
    }
    Ok(())
}

fn inlet_velocity(config: &D3q19Config, cell: usize, step: u32) -> [f64; 3] {
    let idx = cell as u32;
    let t = config.turbulence_intensity;
    let n1 = 2.0 * hash(idx ^ step.wrapping_mul(2_654_435_761)) - 1.0;
    let n2 = 2.0 * hash(idx.wrapping_mul(1_664_525) ^ step.wrapping_mul(1_013_904_223)) - 1.0;
    let n3 = 2.0 * hash(idx.wrapping_mul(22_695_477) ^ step.wrapping_mul(747_796_405)) - 1.0;
    [
        config.u_inlet * (1.0 + t * n1),
        config.u_inlet * t * n2,
        config.u_inlet * t * n3,
    ]
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::{
        dot, equilibrium, mul_add, sqrt, stream_destination, D3q19Boundary, D3q19Config, D3Q19_C,
        D3Q19_OPPOSITE, D3Q19_Q, D3Q19_W,
    };

    #[test]
    fn equilibrium_uses_fma_and_matches_the_bgk_polynomial() {
        let u = [0.04, -0.01, 0.02];
        let rho = 1.05;
        let u2 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
        for q in 0..D3Q19_Q {
            let cu = D3Q19_C[q][0] as f64 * u[0] + D3Q19_C[q][1] as f64 * u[1] + D3Q19_C[q][2] as f64 * u[2];
            let expanded = D3Q19_W[q] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * u2);
            let got = equilibrium(q, rho, u);
            assert!((got - expanded).abs() <= 4.0 * f64::EPSILON * expanded.abs().max(1.0), "{q}: {got} vs {expanded}");
        }
        assert_eq!(dot([1.0, 2.0, 3.0], [4.0, 5.0, 6.0]), mul_add(1.0, 4.0, mul_add(2.0, 5.0, 3.0 * 6.0)));
    }

    #[test]
    fn specular_links_are_reversible_and_do_not_reflect_open_x_boundaries() {
        let mut c = D3q19Config {
            nx: 5,
            ny: 4,
            nz: 3,
            tau: 0.8,
            u_inlet: 0.04,
            smagorinsky_cs: 0.,
            turbulence_intensity: 0.,
            ground_velocity: None,
            free_slip_walls: true,
            boundary: D3q19Boundary::WindTunnel,
            fan: None,
            thermal: None,
        };
        for ground in [None, Some(0.), Some(0.04)] {
            c.ground_velocity = ground;
            let mut seen = std::vec![false; c.cell_count().unwrap() * D3Q19_Q];
            for z in 0..c.nz {
                for y in 0..c.ny {
                    for x in 0..c.nx {
                        let i = x + c.nx * (y + c.ny * z);
                        for (q, &opposite) in D3Q19_OPPOSITE.iter().enumerate() {
                            if let Some((j, arrival)) = stream_destination(&c, [x, y, z], q) {
                                assert!(
                                    !seen[j * D3Q19_Q + arrival],
                                    "duplicate arrival {j}/{arrival}"
                                );
                                seen[j * D3Q19_Q + arrival] = true;
                                let position = [j % c.nx, (j / c.nx) % c.ny, j / (c.nx * c.ny)];
                                assert_eq!(
                                    stream_destination(&c, position, D3Q19_OPPOSITE[arrival]),
                                    Some((i, opposite))
                                );
                            }
                        }
                    }
                }
            }
            assert_eq!(stream_destination(&c, [0, 0, 0], 8), None); // x=-1 remains open.
            if ground.is_some() {
                assert_eq!(stream_destination(&c, [0, 0, 0], 9), None);
                assert_eq!(stream_destination(&c, [0, 0, 0], 16), None);
            } else {
                assert_eq!(stream_destination(&c, [0, 0, 0], 9), Some((1, 7))); // +x,-y reflects y only.
                assert_eq!(stream_destination(&c, [0, 0, 0], 16), Some((0, 15)));
                // Both y/z crossed.
            }
        }
    }

    #[test]
    fn no_std_sqrt_matches_hardware_across_les_range() {
        for value in [
            0.0,
            f64::from_bits(1),
            f64::MIN_POSITIVE,
            1e-90,
            1e-30,
            1e-12,
            0.25,
            0.505 * 0.505,
            0.64,
            1.0,
            2.0,
            10.0,
            1e20,
            1e80,
            f64::MAX,
        ] {
            let expected = value.sqrt();
            assert!((sqrt(value).unwrap() - expected).abs() <= 3.0 * f64::EPSILON * expected);
        }
        for i in 1..=1024 {
            let value = i as f64 / 1000.0;
            let expected = value.sqrt();
            assert!((sqrt(value).unwrap() - expected).abs() <= 3.0 * f64::EPSILON * expected);
        }
        assert!(sqrt(-1.0).is_err());
        assert!(sqrt(f64::NAN).is_err());
        assert!(sqrt(f64::INFINITY).is_err());
    }

    #[cfg(feature = "parallel")]
    #[test]
    fn parallel_collide_matches_serial_fields_and_ordered_mass() {
        use super::{collide_parallel, collide_serial, init_d3q19};
        let config = D3q19Config {
            nx: 8,
            ny: 4,
            nz: 4,
            tau: 0.8,
            u_inlet: 0.04,
            smagorinsky_cs: 0.12,
            turbulence_intensity: 0.0,
            ground_velocity: None,
            free_slip_walls: true,
            boundary: D3q19Boundary::WindTunnel,
            fan: None,
            thermal: None,
        };
        let count = config.cell_count().unwrap();
        let mut flags = std::vec![0_u8; count];
        flags[config.nx * 2 + 2] = 1;
        let mut f = std::vec![0.0; count * D3Q19_Q];
        let mut post_s = f.clone();
        let mut vel_s = std::vec![0.0; count * 3];
        let mut dens_s = std::vec![0.0; count];
        init_d3q19(&config, &flags, &mut f, &mut post_s, &mut vel_s, &mut dens_s, None).unwrap();
        let mut post_p = post_s.clone();
        let mut vel_p = vel_s.clone();
        let mut dens_p = dens_s.clone();
        let serial = collide_serial(&config, &flags, &f, &mut post_s, &mut vel_s, &mut dens_s, None).unwrap();
        let parallel = collide_parallel(&config, &flags, &f, &mut post_p, &mut vel_p, &mut dens_p, None).unwrap();
        assert_eq!(serial, parallel);
        assert_eq!(post_s, post_p);
        assert_eq!(vel_s, vel_p);
        assert_eq!(dens_s, dens_p);
    }

    #[cfg(feature = "parallel")]
    #[test]
    fn parallel_stream_matches_serial_fields_force_and_mass() {
        use super::{
            collide_serial, init_d3q19, stream_parallel, stream_serial, D3q19MassBalance,
        };
        let config = D3q19Config {
            nx: 8,
            ny: 4,
            nz: 4,
            tau: 0.8,
            u_inlet: 0.04,
            smagorinsky_cs: 0.12,
            turbulence_intensity: 0.0,
            ground_velocity: None,
            free_slip_walls: true,
            boundary: D3q19Boundary::WindTunnel,
            fan: None,
            thermal: None,
        };
        let count = config.cell_count().unwrap();
        let mut flags = std::vec![0_u8; count];
        flags[config.nx * 2 + 2] = 1;
        let mut f = std::vec![0.0; count * D3Q19_Q];
        let mut post = f.clone();
        let mut vel = std::vec![0.0; count * 3];
        let mut dens = std::vec![0.0; count];
        init_d3q19(&config, &flags, &mut f, &mut post, &mut vel, &mut dens, None).unwrap();
        collide_serial(&config, &flags, &f, &mut post, &mut vel, &mut dens, None).unwrap();
        let mut f_s = f.clone();
        let mut f_p = f.clone();
        let mut mass_s = D3q19MassBalance::default();
        let mut mass_p = D3q19MassBalance::default();
        let force_s = stream_serial(&config, &flags, &mut f_s, &post, &mut mass_s).unwrap();
        let force_p = stream_parallel(&config, &flags, &mut f_p, &post, &mut mass_p).unwrap();
        assert_eq!(force_s, force_p);
        assert_eq!(f_s, f_p);
        assert_eq!(mass_s.inlet_net_mass, mass_p.inlet_net_mass);
        assert_eq!(mass_s.outlet_net_mass, mass_p.outlet_net_mass);
    }

    #[cfg(feature = "parallel")]
    #[test]
    fn parallel_finish_moments_matches_serial_fields_mass_and_speed() {
        use super::{
            collide_serial, finish_moments_parallel, finish_moments_serial, init_d3q19,
            stream_serial, D3q19MassBalance,
        };
        let config = D3q19Config {
            nx: 8,
            ny: 4,
            nz: 4,
            tau: 0.8,
            u_inlet: 0.04,
            smagorinsky_cs: 0.12,
            turbulence_intensity: 0.0,
            ground_velocity: None,
            free_slip_walls: true,
            boundary: D3q19Boundary::WindTunnel,
            fan: None,
            thermal: None,
        };
        let count = config.cell_count().unwrap();
        let mut flags = std::vec![0_u8; count];
        flags[config.nx * 2 + 2] = 1;
        let mut f = std::vec![0.0; count * D3Q19_Q];
        let mut post = f.clone();
        let mut vel = std::vec![0.0; count * 3];
        let mut dens = std::vec![0.0; count];
        init_d3q19(&config, &flags, &mut f, &mut post, &mut vel, &mut dens, None).unwrap();
        collide_serial(&config, &flags, &f, &mut post, &mut vel, &mut dens, None).unwrap();
        stream_serial(&config, &flags, &mut f, &post, &mut D3q19MassBalance::default()).unwrap();
        let mut vel_s = std::vec![0.0; count * 3];
        let mut dens_s = std::vec![0.0; count];
        let mut vel_p = std::vec![0.0; count * 3];
        let mut dens_p = std::vec![0.0; count];
        let mut mass_s = D3q19MassBalance::default();
        let mut mass_p = D3q19MassBalance::default();
        let serial = finish_moments_serial(
            &config, &flags, &f, &mut vel_s, &mut dens_s, None, &mut mass_s,
        )
        .unwrap();
        let parallel = finish_moments_parallel(
            &config, &flags, &f, &mut vel_p, &mut dens_p, None, &mut mass_p,
        )
        .unwrap();
        assert_eq!(serial, parallel);
        assert_eq!(vel_s, vel_p);
        assert_eq!(dens_s, dens_p);
        assert_eq!(mass_s.bulk_mass_after, mass_p.bulk_mass_after);
    }
}
