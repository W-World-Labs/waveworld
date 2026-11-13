//! Axis-aligned actuator disks shared by native and WASM MAC runners.
//! The pressure curve and every face selection, flow sum and force conversion
//! execute here; this is not a blade/rotor or stopped-fan resistance model.

use crate::{
    fan_curve::{pressure_rise, FanCurvePoint, MAX_FAN_CURVE_POINTS},
    geometry::cell_count,
    mac_projection::{face_at, MacProjectionConfig},
    KernelError,
};

pub const MAX_MAC_FANS: usize = 16;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct MacFanDisk {
    pub axis: u32,
    /// +1 or -1 along the selected global grid axis.
    pub direction: i32,
    /// Original model placement mapped to lattice coordinates; normal position
    /// is snapped to floor(center+0.5). The caller retains this original centre.
    pub center_cells: [f64; 3],
    pub radius_meters: f64,
    pub rpm_ratio: f64,
    /// Range in the caller's shared reference-RPM curve point array.
    pub curve_offset: u32,
    pub curve_count: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MacFanReadout {
    pub plane: u32,
    pub face_count: u32,
    pub area_m2: f64,
    /// Signed net flow in the fan's own forward direction, at step start.
    pub flow_m3_s: f64,
    pub pressure_rise_pa: f64,
    /// Signed force along the selected positive grid axis, on the fluid.
    pub force_n: f64,
}

pub struct MacFanBuffers<'a> {
    pub u: &'a [f64],
    pub v: &'a [f64],
    pub w: &'a [f64],
    /// Overwritten with fan-only acceleration in m/s^2; no stale force remains.
    pub acceleration_u: &'a mut [f64],
    pub acceleration_v: &'a mut [f64],
    pub acceleration_w: &'a mut [f64],
    pub readouts: &'a mut [MacFanReadout],
}

#[derive(Clone, Copy)]
struct RasterDisk {
    axis: usize,
    plane: usize,
    tangent: [usize; 2],
    center: [f64; 2],
    radius2: f64,
    min: [usize; 2],
    max: [usize; 2],
}

impl RasterDisk {
    fn new(c: &MacProjectionConfig, disk: &MacFanDisk) -> Result<Self, KernelError> {
        if disk.axis > 2
            || ![-1, 1].contains(&disk.direction)
            || disk.center_cells.iter().any(|v| !v.is_finite())
            || !disk.radius_meters.is_finite()
            || disk.radius_meters <= 0.0
        {
            return Err(KernelError::InvalidCoefficient);
        }
        let axis = disk.axis as usize;
        let dims = [c.nx, c.ny, c.nz];
        if disk.center_cells[axis] < 0.0 || disk.center_cells[axis] > dims[axis] as f64 {
            return Err(KernelError::InvalidCoefficient);
        }
        let plane = (disk.center_cells[axis] + 0.5) as usize;
        // Interior velocity DOFs have full h^3 dual volumes, so dp/(rho*h)
        // integrates to exactly dp times the rasterized disk area.
        if plane == 0 || plane >= dims[axis] {
            return Err(KernelError::InvalidState);
        }
        let tangent = match axis {
            0 => [1, 2],
            1 => [0, 2],
            _ => [0, 1],
        };
        let center = tangent.map(|a| disk.center_cells[a]);
        let radius = disk.radius_meters / c.dx_m;
        if !radius.is_finite() || radius <= 0.0 {
            return Err(KernelError::InvalidCoefficient);
        }
        let lower = center.map(|v| v - radius);
        let upper = center.map(|v| v + radius);
        if (0..2).any(|i| lower[i] < 0.0 || upper[i] > dims[tangent[i]] as f64) {
            return Err(KernelError::InvalidState);
        }
        let radius2 = radius * radius;
        if !radius2.is_finite() || radius2 <= 0.0 {
            return Err(KernelError::InvalidCoefficient);
        }
        Ok(Self {
            axis,
            plane,
            tangent,
            center,
            radius2,
            min: lower.map(|v| v as usize),
            max: core::array::from_fn(|i| (upper[i] as usize).min(dims[tangent[i]] - 1)),
        })
    }

    fn contains(&self, position: [usize; 3]) -> bool {
        let a = position[self.tangent[0]] as f64 + 0.5 - self.center[0];
        let b = position[self.tangent[1]] as f64 + 0.5 - self.center[1];
        position[self.axis] == self.plane && a * a + b * b <= self.radius2
    }

    fn visit(&self, mut visit: impl FnMut([usize; 3])) {
        for b in self.min[1]..=self.max[1] {
            for a in self.min[0]..=self.max[0] {
                let mut position = [0; 3];
                position[self.axis] = self.plane;
                position[self.tangent[0]] = a;
                position[self.tangent[1]] = b;
                if self.contains(position) {
                    visit(position);
                }
            }
        }
    }
}

/// Rebuild fan acceleration from the current face velocities, for 0..16 disks.
/// Empty disks mean no actuator, not a model of a stopped physical fan.
///
/// Disk circles must fit inside the domain and every selected face must have
/// fluid on both sides. Same-axis disks may not select the same grid face.
/// No clipping, blocked-face omission, or blade geometry is used as a mask.
/// Curves are supplied at the job's fluid density and their reference RPM.
/// RPM/reverse-flow/curve-domain admission is exactly fan_curve::pressure_rise.
/// Local reversed patches can occur if the disk's NET flow remains supported.
///
/// Results describe flow sampled at the beginning of the momentum step and
/// pressure applied during that step. Current velocity is never changed. On
/// failure discard all acceleration/readout outputs; do not advance momentum.
pub fn mac_fan_accelerations(
    c: &MacProjectionConfig,
    flags: &[u8],
    disks: &[MacFanDisk],
    points: &[FanCurvePoint],
    b: &mut MacFanBuffers<'_>,
) -> Result<(), KernelError> {
    let n = cell_count(c.nx, c.ny, c.nz)?;
    if n > u32::MAX as usize {
        return Err(KernelError::InvalidDimensions);
    }
    let dims = [c.nx, c.ny, c.nz];
    let mut counts = [0; 3];
    for a in 0..3 {
        let mut fd = dims;
        fd[a] = fd[a].checked_add(1).ok_or(KernelError::InvalidDimensions)?;
        counts[a] = cell_count(fd[0], fd[1], fd[2])?;
    }
    if flags.len() != n
        || disks.len() > MAX_MAC_FANS
        || b.readouts.len() != disks.len()
        || [b.u.len(), b.v.len(), b.w.len()] != counts
        || [
            b.acceleration_u.len(),
            b.acceleration_v.len(),
            b.acceleration_w.len(),
        ] != counts
    {
        return Err(KernelError::BufferLength);
    }
    if [c.dx_m, c.density_kg_m3]
        .iter()
        .any(|v| !v.is_finite() || *v <= 0.0)
    {
        return Err(KernelError::InvalidCoefficient);
    }
    let area = c.dx_m * c.dx_m;
    let force_scale = c.density_kg_m3 * c.dx_m;
    if [area, force_scale]
        .iter()
        .any(|v| !v.is_finite() || *v <= 0.0)
    {
        return Err(KernelError::InvalidCoefficient);
    }
    let velocity = [b.u, b.v, b.w];
    if velocity
        .iter()
        .any(|values| values.iter().any(|v| !v.is_finite()))
    {
        return Err(KernelError::NonFiniteValue);
    }
    let mut acceleration = [
        &mut *b.acceleration_u,
        &mut *b.acceleration_v,
        &mut *b.acceleration_w,
    ];
    for field in &mut acceleration {
        field.fill(0.0);
    }
    let mut resolved = [None; MAX_MAC_FANS];
    for (i, disk) in disks.iter().enumerate() {
        let raster = RasterDisk::new(c, disk)?;
        let start = disk.curve_offset as usize;
        let count = disk.curve_count as usize;
        let end = start.checked_add(count).ok_or(KernelError::BufferLength)?;
        if !(2..=MAX_FAN_CURVE_POINTS).contains(&count) || end > points.len() {
            return Err(KernelError::BufferLength);
        }
        let mut face_count = 0u32;
        let mut sum = 0.0;
        let mut invalid = false;
        raster.visit(|position| {
            let f = face_at(c, flags, raster.axis, position);
            invalid |= f.weight != 1.0;
            invalid |= resolved[..i].iter().flatten().any(|previous: &RasterDisk| {
                previous.axis == raster.axis && previous.contains(position)
            });
            face_count += 1;
            sum += velocity[raster.axis][f.index];
        });
        if invalid || face_count == 0 {
            return Err(KernelError::InvalidState);
        }
        let flow = disk.direction as f64 * sum * area;
        if !flow.is_finite() {
            return Err(KernelError::NonFiniteValue);
        }
        if sum != 0.0 && flow == 0.0 {
            return Err(KernelError::InvalidState);
        }
        let pressure = pressure_rise(&points[start..end], flow, disk.rpm_ratio)?;
        let value = disk.direction as f64 * pressure / force_scale;
        let disk_area = face_count as f64 * area;
        let force = disk.direction as f64 * pressure * disk_area;
        if !value.is_finite() || !disk_area.is_finite() || !force.is_finite() {
            return Err(KernelError::NonFiniteValue);
        }
        if disk_area <= 0.0 || (pressure > 0.0 && (value == 0.0 || force == 0.0)) {
            return Err(KernelError::InvalidState);
        }
        raster.visit(|position| {
            let f = face_at(c, flags, raster.axis, position);
            acceleration[raster.axis][f.index] = value;
        });
        b.readouts[i] = MacFanReadout {
            plane: raster.plane as u32,
            face_count,
            area_m2: disk_area,
            flow_m3_s: flow,
            pressure_rise_pa: pressure,
            force_n: force,
        };
        resolved[i] = Some(raster);
    }
    Ok(())
}
