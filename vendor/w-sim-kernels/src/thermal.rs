//! Conservative sensible energy (relative to ambient) on the flow voxel grid.
//! Advection uses net D3Q19 population mass exchange, not interpolated velocity.
//! Conduction uses one shared harmonic face flux; fixed walls are reservoirs at
//! the fluid/solid halfway face. Explicit substeps obey a positive-coefficient CFL.
use crate::lbm::{stream_destination, D3q19Boundary, D3q19Config, D3Q19_OPPOSITE, D3Q19_Q};
use crate::KernelError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThermalMode {
    FixedTemperature,
    SolidPower,
}
pub const MAX_THERMAL_MATERIALS: usize = 16;
pub const MAX_THERMAL_CONTACTS: usize = 136;
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct ThermalMaterial {
    pub density: f64,
    pub specific_heat: f64,
    pub conductivity: f64,
    pub total_power_w: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct ThermalConfig {
    pub gravity_per_kelvin: f64,
    pub dt_seconds: f64,
    pub ambient_c: f64,
    pub fixed_surface_c: f64,
    pub dx_meters: f64,
    pub fluid_density: f64,
    pub fluid_specific_heat: f64,
    pub fluid_conductivity: f64,
    pub solid_density: f64,
    pub solid_specific_heat: f64,
    pub solid_conductivity: f64,
    pub total_power_w: f64,
    pub mode: ThermalMode,
    pub max_substeps: u32,
    pub temperature_scale_c: f64,
    pub material_count: usize,
    pub materials: [ThermalMaterial; MAX_THERMAL_MATERIALS],
    /// Unordered pair hi*(hi-1)/2+lo, material 0 default and 1..16 regions.
    pub contact_resistance: [f64; MAX_THERMAL_CONTACTS],
    /// Explicit contacts, including R=0; unused high bits and slots stay zero.
    pub contact_mask: [u32; 5],
}

/// Four distinct caller-owned f64[N] buffers. Temperature is a difference in K;
/// energy is J relative to ambient, mass is kg. No swaps or allocations.
pub struct ThermalBuffers<'a> {
    pub energy: &'a mut [f64],
    pub next_energy: &'a mut [f64],
    pub temperature_delta_k: &'a mut [f64],
    pub mass: &'a mut [f64],
}

#[derive(Clone, Copy, Debug)]
pub struct ThermalStep {
    pub thermal_energy_j: f64,
    pub source_energy_j: f64,
    /// Net heat/advected sensible energy entering through external reservoirs.
    pub boundary_energy_j: f64,
    pub energy_residual_j: f64,
    pub solid_max_c: f64,
    pub fluid_max_c: f64,
    pub substeps: u32,
}

impl ThermalConfig {
    pub fn set_contact(
        &mut self,
        first: usize,
        second: usize,
        resistance: f64,
    ) -> Result<(), KernelError> {
        if first == second
            || first > MAX_THERMAL_MATERIALS
            || second > MAX_THERMAL_MATERIALS
            || first > self.material_count
            || second > self.material_count
            || !resistance.is_finite()
            || resistance < 0.
            || self.mode != ThermalMode::SolidPower
        {
            return Err(KernelError::InvalidCoefficient);
        }
        let index = crate::geometry::thermal_contact_index(first, second);
        let bit = 1 << (index % 32);
        if self.contact_mask[index / 32] & bit != 0 {
            return Err(KernelError::InvalidState);
        }
        self.contact_mask[index / 32] |= bit;
        self.contact_resistance[index] = resistance;
        Ok(())
    }

    pub(crate) fn validate(&self) -> Result<(), KernelError> {
        if self.material_count > MAX_THERMAL_MATERIALS
            || (self.material_count > 0 && self.mode != ThermalMode::SolidPower)
        {
            return Err(KernelError::UnsupportedFeature);
        }
        for (i, m) in self.materials.iter().enumerate() {
            let values = [m.density, m.specific_heat, m.conductivity, m.total_power_w];
            if i >= self.material_count {
                if values.iter().any(|v| v.to_bits() != 0) {
                    return Err(KernelError::InvalidCoefficient);
                }
            } else if !values[..3].iter().all(|v| v.is_finite() && *v > 0.)
                || !m.total_power_w.is_finite()
                || m.total_power_w < 0.
                || !(m.total_power_w * self.dt_seconds).is_finite()
            {
                return Err(KernelError::InvalidCoefficient);
            }
        }
        if self.contact_mask[4] & !255 != 0
            || (self.mode != ThermalMode::SolidPower && self.contact_mask != [0; 5])
        {
            return Err(KernelError::InvalidCoefficient);
        }
        for hi in 1..=MAX_THERMAL_MATERIALS {
            for lo in 0..hi {
                let index = crate::geometry::thermal_contact_index(lo, hi);
                let r = self.contact_resistance[index];
                if self.contact_mask[index / 32] & (1 << (index % 32)) == 0 {
                    if r.to_bits() != 0 {
                        return Err(KernelError::InvalidCoefficient);
                    }
                } else {
                    if hi > self.material_count || !r.is_finite() || r < 0. {
                        return Err(KernelError::InvalidCoefficient);
                    }
                    if r > 0. {
                        let g = conductance(self, (lo + 4) as u8, (hi + 4) as u8);
                        if !g.is_finite() || g <= 0. {
                            return Err(KernelError::InvalidCoefficient);
                        }
                    }
                }
            }
        }
        if !self.gravity_per_kelvin.is_finite()
            || self.gravity_per_kelvin < 0.
            || !self.ambient_c.is_finite()
            || self.ambient_c <= -273.15
            || ![
                self.dt_seconds,
                self.dx_meters,
                self.fluid_density,
                self.fluid_specific_heat,
                self.fluid_conductivity,
                self.temperature_scale_c,
            ]
            .iter()
            .all(|&v| v.is_finite() && v > 0.)
            || !self.total_power_w.is_finite()
            || self.total_power_w < 0.
            || self.max_substeps == 0
            || self.max_substeps > 4096
        {
            return Err(KernelError::InvalidCoefficient);
        }
        match self.mode {
            ThermalMode::FixedTemperature => {
                if !self.fixed_surface_c.is_finite()
                    || self.fixed_surface_c <= self.ambient_c
                    || !(self.fixed_surface_c - self.ambient_c).is_finite()
                    || self.total_power_w != 0.
                    || self.solid_density != 0.
                    || self.solid_specific_heat != 0.
                    || self.solid_conductivity != 0.
                {
                    return Err(KernelError::InvalidCoefficient);
                }
            }
            ThermalMode::SolidPower => {
                if self.fixed_surface_c != 0.
                    || ![
                        self.solid_density,
                        self.solid_specific_heat,
                        self.solid_conductivity,
                    ]
                    .iter()
                    .all(|&v| v.is_finite() && v > 0.)
                {
                    return Err(KernelError::InvalidCoefficient);
                }
            }
        }
        let volume = self.dx_meters * self.dx_meters * self.dx_meters;
        if !volume.is_finite()
            || volume <= 0.
            || !(self.total_power_w * self.dt_seconds).is_finite()
        {
            return Err(KernelError::InvalidCoefficient);
        }
        Ok(())
    }

    pub(crate) fn validate_contacts(
        &self,
        c: &D3q19Config,
        flags: &[u8],
    ) -> Result<(), KernelError> {
        self.validate_contact_faces(
            [c.nx, c.ny, c.nz],
            c.boundary == D3q19Boundary::Periodic,
            flags,
        )
    }

    pub(crate) fn validate_contact_faces(
        &self,
        dims: [usize; 3],
        periodic: bool,
        flags: &[u8],
    ) -> Result<(), KernelError> {
        if self.contact_mask == [0; 5] {
            return Ok(());
        }
        let mut resolved = [0; 5];
        crate::geometry::thermal_contact_faces(flags, dims, periodic, &mut resolved)?;
        if (0..5).any(|i| resolved[i] & self.contact_mask[i] != self.contact_mask[i]) {
            return Err(KernelError::InvalidState);
        }
        Ok(())
    }

    pub(crate) fn validate_flags(&self, flags: &[u8]) -> Result<(), KernelError> {
        if flags.iter().any(|&f| {
            f > 4 + self.material_count as u8
                || (f >= 4 && self.mode != ThermalMode::SolidPower)
                || (f == 2 && self.mode != ThermalMode::FixedTemperature)
        }) {
            return Err(KernelError::UnsupportedFeature);
        }
        if (self.mode == ThermalMode::SolidPower && !flags.iter().any(|&f| f >= 4))
            || (self.mode == ThermalMode::FixedTemperature && !flags.contains(&2))
        {
            return Err(KernelError::InvalidState);
        }
        if (self.total_power_w > 0. && !flags.contains(&4))
            || (0..self.material_count).any(|i| !flags.contains(&(5 + i as u8)))
        {
            return Err(KernelError::InvalidState);
        }
        Ok(())
    }

    fn mass_unit(&self) -> f64 {
        self.fluid_density * self.dx_meters * self.dx_meters * self.dx_meters
    }
    pub(crate) fn cp(&self, flag: u8) -> f64 {
        if flag > 4 {
            self.materials[(flag - 5) as usize].specific_heat
        } else if flag == 4 {
            self.solid_specific_heat
        } else {
            self.fluid_specific_heat
        }
    }
    fn k(&self, flag: u8) -> f64 {
        if flag > 4 {
            self.materials[(flag - 5) as usize].conductivity
        } else if flag == 4 {
            self.solid_conductivity
        } else {
            self.fluid_conductivity
        }
    }
}

fn population_mass(pop: &[f32], cell: usize, unit: f64) -> Result<f64, KernelError> {
    let rho: f64 = pop[cell * D3Q19_Q..(cell + 1) * D3Q19_Q]
        .iter()
        .map(|&v| v as f64)
        .sum();
    let mass = rho * unit;
    if !mass.is_finite() || mass <= 0. {
        return Err(KernelError::InvalidState);
    }
    Ok(mass)
}

pub(crate) fn initialize(
    p: &ThermalConfig,
    flags: &[u8],
    f: &[f32],
    s: &mut ThermalBuffers<'_>,
) -> Result<(), KernelError> {
    s.energy.fill(0.);
    s.next_energy.fill(0.);
    for (i, &flag) in flags.iter().enumerate() {
        s.mass[i] = match flag {
            0 => population_mass(f, i, p.mass_unit())?,
            4..=20 => {
                (if flag == 4 {
                    p.solid_density
                } else {
                    p.materials[(flag - 5) as usize].density
                }) * p.dx_meters
                    * p.dx_meters
                    * p.dx_meters
            }
            _ => 0.,
        };
    }
    refresh(p, flags, s)
}

pub(crate) fn refresh(
    p: &ThermalConfig,
    flags: &[u8],
    s: &mut ThermalBuffers<'_>,
) -> Result<(), KernelError> {
    for i in 0..s.energy.len() {
        if !(s.energy[i].is_finite()
            && s.next_energy[i].is_finite()
            && s.temperature_delta_k[i].is_finite()
            && s.mass[i].is_finite())
        {
            return Err(KernelError::NonFiniteValue);
        }
    }
    for (i, &flag) in flags.iter().enumerate() {
        s.temperature_delta_k[i] = match flag {
            0 | 4..=20 => {
                let capacity = s.mass[i] * p.cp(flag);
                if !capacity.is_finite() || capacity <= 0. {
                    return Err(KernelError::InvalidState);
                }
                s.energy[i] / capacity
            }
            2 => p.fixed_surface_c - p.ambient_c,
            _ => 0.,
        };
        if !s.temperature_delta_k[i].is_finite()
            || p.ambient_c + s.temperature_delta_k[i] <= -273.15
        {
            return Err(KernelError::InvalidState);
        }
        if flag != 0 && flag < 4 && (s.energy[i] != 0. || s.mass[i] != 0.) {
            return Err(KernelError::InvalidState);
        }
    }
    Ok(())
}

/// Neighbor at pos + delta; returns the flat index and the neighbor position
/// (callers need the x coordinate for the reservoir test without re-dividing).
fn neighbor_pos(
    c: &D3q19Config,
    pos: [usize; 3],
    delta: [i8; 3],
) -> Option<(usize, [usize; 3])> {
    let dims = [c.nx, c.ny, c.nz];
    let mut at = pos.map(|v| v as isize);
    for axis in 0..3 {
        at[axis] += delta[axis] as isize;
        if c.boundary == D3q19Boundary::Periodic {
            if at[axis] < 0 {
                at[axis] += dims[axis] as isize;
            }
            if at[axis] >= dims[axis] as isize {
                at[axis] -= dims[axis] as isize;
            }
        } else if at[axis] < 0 || at[axis] >= dims[axis] as isize {
            return None;
        }
    }
    let at = at.map(|v| v as usize);
    Some((at[0] + c.nx * (at[1] + c.ny * at[2]), at))
}

/// Same predicate as the former reservoir(cell): cell % nx == 0 is x == 0.
fn reservoir_at(c: &D3q19Config, x: usize, flag: u8) -> bool {
    flag == 2 || flag == 3 || (flag == 0 && c.boundary == D3q19Boundary::WindTunnel && x == 0)
}

pub(crate) fn conductance(p: &ThermalConfig, first: u8, second: u8) -> f64 {
    if first == 1 || second == 1 {
        return 0.;
    }
    if first == 2 || first == 3 {
        return 2. * p.k(second) * p.dx_meters;
    }
    if second == 2 || second == 3 {
        return 2. * p.k(first) * p.dx_meters;
    }
    if first >= 4 && second >= 4 && first != second {
        let r = p.contact_resistance
            [crate::geometry::thermal_contact_index((first - 4) as usize, (second - 4) as usize)];
        if r > 0. {
            return p.dx_meters * p.dx_meters
                / (p.dx_meters / (2. * p.k(first)) + r + p.dx_meters / (2. * p.k(second)));
        }
    }
    2. * p.dx_meters / (1. / p.k(first) + 1. / p.k(second))
}

/// Total energy injected by each material flag over the original physical dt.
pub(crate) fn source_energies(
    p: &ThermalConfig,
    flags: &[u8],
    solid_counts: &mut [usize; MAX_THERMAL_MATERIALS + 1],
    sources: &mut [f64; MAX_THERMAL_MATERIALS + 1],
) -> Result<f64, KernelError> {
    solid_counts.fill(0);
    sources.fill(0.);
    for &flag in flags {
        if flag >= 4 {
            solid_counts[(flag - 4) as usize] += 1;
        }
    }
    sources[0] = p.total_power_w * p.dt_seconds;
    for i in 0..p.material_count {
        sources[i + 1] = p.materials[i].total_power_w * p.dt_seconds;
    }
    let mut source = sources[0];
    for &region_source in &sources[1..=p.material_count] {
        source += region_source;
    }
    if !source.is_finite() {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(source)
}

/// First-order operator splitting: mass-consistent upwind advection, then
/// conservative conduction/source substeps. Numerical errors discard the job.
pub(crate) fn advance(
    c: &D3q19Config,
    p: &ThermalConfig,
    flags: &[u8],
    post: &[f32],
    f: &[f32],
    s: &mut ThermalBuffers<'_>,
) -> Result<ThermalStep, KernelError> {
    let before: f64 = s.energy.iter().sum();
    let unit = p.mass_unit();
    let mut boundary_energy = 0.;
    // Collision preserves density up to f32 rounding. Refuse inconsistent state;
    // do not silently inject energy to force a chosen temperature.
    for (i, &flag) in flags.iter().enumerate() {
        if flag == 0 {
            let mass = population_mass(post, i, unit)?;
            if (mass - s.mass[i]).abs() > 5e-6 * mass {
                return Err(KernelError::InvalidState);
            }
            s.mass[i] = mass;
        }
    }
    refresh(p, flags, s)?;
    // Outgoing *net* mass per cell must leave nonnegative retained energy weight.
    // z/y/x loops hand stream_destination its position directly — the flat-i
    // divmod per cell is gone; the (i, q) pair sequence is unchanged.
    s.next_energy.fill(0.);
    let mut i = 0;
    for z in 0..c.nz {
        for y in 0..c.ny {
            for x in 0..c.nx {
                let flag = flags[i];
                if flag == 0 {
                    let position = [x, y, z];
                    for q in 1..D3Q19_Q {
                        if let Some((j, arrival)) = stream_destination(c, position, q) {
                            let reverse = D3Q19_OPPOSITE[arrival];
                            if flags[j] != 0 || (i, q) >= (j, reverse) {
                                continue;
                            }
                            let dm = unit
                                * (post[i * D3Q19_Q + q] as f64
                                    - post[j * D3Q19_Q + reverse] as f64);
                            if !dm.is_finite() {
                                return Err(KernelError::NonFiniteValue);
                            }
                            if dm >= 0. {
                                s.next_energy[i] += dm;
                            } else {
                                s.next_energy[j] -= dm;
                            }
                        }
                    }
                }
                i += 1;
            }
        }
    }
    for (i, &flag) in flags.iter().enumerate() {
        if flag == 0 && s.next_energy[i] > 0.9 * s.mass[i] {
            return Err(KernelError::InvalidState);
        }
    }
    s.next_energy.copy_from_slice(s.energy);
    let mut i = 0;
    for z in 0..c.nz {
        for y in 0..c.ny {
            for x in 0..c.nx {
                let flag = flags[i];
                if flag == 0 {
                    let position = [x, y, z];
                    for q in 1..D3Q19_Q {
                        if let Some((j, arrival)) = stream_destination(c, position, q) {
                            let reverse = D3Q19_OPPOSITE[arrival];
                            if flags[j] != 0 || (i, q) >= (j, reverse) {
                                continue;
                            }
                            let dm = unit
                                * (post[i * D3Q19_Q + q] as f64
                                    - post[j * D3Q19_Q + reverse] as f64);
                            let donor = if dm >= 0. { i } else { j };
                            let de =
                                dm * p.fluid_specific_heat * s.temperature_delta_k[donor];
                            s.next_energy[i] -= de;
                            s.next_energy[j] += de;
                            s.mass[i] -= dm;
                            s.mass[j] += dm;
                        }
                    }
                }
                i += 1;
            }
        }
    }
    let mut i = 0;
    for _z in 0..c.nz {
        for _y in 0..c.ny {
            for x in 0..c.nx {
                let flag = flags[i];
                if flag == 0 {
                    let target = population_mass(f, i, unit)?;
                    if !s.mass[i].is_finite() || s.mass[i] <= 0. {
                        return Err(KernelError::InvalidState);
                    }
                    let dm = target - s.mass[i];
                    if c.boundary == D3q19Boundary::WindTunnel && (x == 0 || x == c.nx - 1) {
                        // Open reservoirs: incoming mass has ambient enthalpy; outgoing
                        // mass takes the cell's mixed sensible enthalpy. Inlet is thermostatic.
                        if dm < 0. {
                            let de = dm / s.mass[i] * s.next_energy[i];
                            s.next_energy[i] += de;
                            boundary_energy += de;
                        }
                        if x == 0 {
                            boundary_energy -= s.next_energy[i];
                            s.next_energy[i] = 0.;
                        }
                    } else if dm.abs() > 5e-6 * target {
                        return Err(KernelError::InvalidState);
                    }
                    s.mass[i] = target;
                }
                i += 1;
            }
        }
    }
    s.energy.copy_from_slice(s.next_energy);
    refresh(p, flags, s)?;
    // Sum conductances into caller-owned scratch to determine explicit dt bound.
    // Coefficients depend only on the supplied materials during this step.
    // Preserve the ordered pair: contact-resistance addition is not reordered.
    let mut conductances = [[0.; MAX_THERMAL_MATERIALS + 5]; MAX_THERMAL_MATERIALS + 5];
    for (first, row) in conductances.iter_mut().enumerate().take(p.material_count + 5) {
        for (second, value) in row.iter_mut().enumerate().take(p.material_count + 5) {
            *value = conductance(p, first as u8, second as u8);
        }
    }
    s.next_energy.fill(0.);
    let mut i = 0;
    for z in 0..c.nz {
        for y in 0..c.ny {
            for x in 0..c.nx {
                let flag = flags[i];
                let ri = reservoir_at(c, x, flag);
                for d in [[1, 0, 0], [0, 1, 0], [0, 0, 1]] {
                    if let Some((j, at)) = neighbor_pos(c, [x, y, z], d) {
                        let g = conductances[flag as usize][flags[j] as usize];
                        if g == 0. || (ri && reservoir_at(c, at[0], flags[j])) {
                            continue;
                        }
                        if !g.is_finite() || g < 0. {
                            return Err(KernelError::InvalidCoefficient);
                        }
                        if !ri {
                            s.next_energy[i] += g;
                        }
                        if !reservoir_at(c, at[0], flags[j]) {
                            s.next_energy[j] += g;
                        }
                    }
                }
                i += 1;
            }
        }
    }
    let mut required: f64 = 1.;
    let mut i = 0;
    for _z in 0..c.nz {
        for _y in 0..c.ny {
            for x in 0..c.nx {
                let flag = flags[i];
                if (flag == 0 || flag >= 4) && !reservoir_at(c, x, flag) {
                    required = required
                        .max(p.dt_seconds * s.next_energy[i] / (0.9 * s.mass[i] * p.cp(flag)));
                }
                i += 1;
            }
        }
    }
    if !required.is_finite() || required > p.max_substeps as f64 {
        return Err(KernelError::InvalidCoefficient);
    }
    let substeps = required as u32 + u32::from(required > required as u32 as f64);
    let dt = p.dt_seconds / substeps as f64;
    let mut solid_counts = [0usize; MAX_THERMAL_MATERIALS + 1];
    let mut sources = [0.; MAX_THERMAL_MATERIALS + 1];
    let source = source_energies(p, flags, &mut solid_counts, &mut sources)?;
    for _ in 0..substeps {
        s.next_energy.copy_from_slice(s.energy);
        let mut i = 0;
        for z in 0..c.nz {
            for y in 0..c.ny {
                for x in 0..c.nx {
                    let flag = flags[i];
                    if flag >= 4 {
                        let material = (flag - 4) as usize;
                        s.next_energy[i] +=
                            sources[material] / solid_counts[material] as f64 / substeps as f64;
                    }
                    let ri = reservoir_at(c, x, flag);
                    for d in [[1, 0, 0], [0, 1, 0], [0, 0, 1]] {
                        if let Some((j, at)) = neighbor_pos(c, [x, y, z], d) {
                            let g = conductances[flag as usize][flags[j] as usize];
                            if g == 0. {
                                continue;
                            }
                            let rj = reservoir_at(c, at[0], flags[j]);
                            if ri && rj {
                                continue;
                            }
                            let de =
                                dt * g * (s.temperature_delta_k[j] - s.temperature_delta_k[i]);
                            if !ri {
                                s.next_energy[i] += de;
                            }
                            if !rj {
                                s.next_energy[j] -= de;
                            }
                            if ri {
                                boundary_energy -= de;
                            }
                            if rj {
                                boundary_energy += de;
                            }
                        }
                    }
                    i += 1;
                }
            }
        }
        s.energy.copy_from_slice(s.next_energy);
        refresh(p, flags, s)?;
    }
    let after: f64 = s.energy.iter().sum();
    let mut solid_max = f64::NEG_INFINITY;
    let mut fluid_max = f64::NEG_INFINITY;
    for (i, &flag) in flags.iter().enumerate() {
        let t = p.ambient_c + s.temperature_delta_k[i];
        if flag == 0 {
            fluid_max = fluid_max.max(t);
        }
        if flag >= 2 {
            solid_max = solid_max.max(t);
        }
    }
    let residual = after - before - source - boundary_energy;
    if ![after, boundary_energy, residual, solid_max, fluid_max]
        .iter()
        .all(|v| v.is_finite())
    {
        return Err(KernelError::NonFiniteValue);
    }
    Ok(ThermalStep {
        thermal_energy_j: after,
        source_energy_j: source,
        boundary_energy_j: boundary_energy,
        energy_residual_j: residual,
        solid_max_c: solid_max,
        fluid_max_c: fluid_max,
        substeps,
    })
}
