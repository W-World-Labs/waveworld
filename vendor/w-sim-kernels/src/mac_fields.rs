//! SI cell fields sampled from MAC face velocities for display and replay.
//! Saved f32 display fields are not restart checkpoints of the f64 face state.

use crate::{
    geometry::cell_count,
    mac_projection::{face_at, MacProjectionConfig},
    KernelError,
};

pub struct MacCellFieldBuffers<'a> {
    pub u: &'a [f64],
    pub v: &'a [f64],
    pub w: &'a [f64],
    pub pressure_pa: &'a [f64],
    pub temperature_delta_k: Option<&'a [f64]>,
    /// Interleaved ux,uy,uz [m/s], pressure [Pa], optional absolute temperature [C].
    pub output: &'a mut [f32],
}

/// Sample the arithmetic mean of each cell's two component faces and return
/// the maximum cell-centred speed, computed in f64 before display conversion.
/// Solid velocity and pressure slots are zero; flags remain the authority for
/// their meaning. Thermal values retain solids and internal reservoirs.
/// This does not solve, project, normalize by an inlet speed or modify inputs.
/// On error discard the partially written display output.
pub fn sample_mac_cells(
    c: &MacProjectionConfig,
    flags: &[u8],
    ambient_c: f64,
    b: &mut MacCellFieldBuffers<'_>,
) -> Result<f64, KernelError> {
    let n = cell_count(c.nx, c.ny, c.nz)?;
    let dims = [c.nx, c.ny, c.nz];
    let mut counts = [0; 3];
    for a in 0..3 {
        let mut fd = dims;
        fd[a] = fd[a].checked_add(1).ok_or(KernelError::InvalidDimensions)?;
        counts[a] = cell_count(fd[0], fd[1], fd[2])?;
    }
    let stride = if b.temperature_delta_k.is_some() {
        5
    } else {
        4
    };
    if flags.len() != n
        || [b.u.len(), b.v.len(), b.w.len()] != counts
        || b.pressure_pa.len() != n
        || b.output.len() != n.checked_mul(stride).ok_or(KernelError::BufferLength)?
        || b.temperature_delta_k.is_some_and(|t| t.len() != n)
    {
        return Err(KernelError::BufferLength);
    }
    if flags.iter().any(|&f| {
        f > if b.temperature_delta_k.is_some() {
            20
        } else {
            1
        }
    }) {
        return Err(KernelError::UnsupportedFeature);
    }
    let fields = [b.u, b.v, b.w];
    if fields
        .into_iter()
        .chain([b.pressure_pa])
        .any(|v| v.iter().any(|x| !x.is_finite()))
        || b.temperature_delta_k
            .is_some_and(|t| t.iter().any(|x| !x.is_finite()))
    {
        return Err(KernelError::NonFiniteValue);
    }
    if b.temperature_delta_k.is_some() && (!ambient_c.is_finite() || ambient_c <= -273.15) {
        return Err(KernelError::InvalidCoefficient);
    }
    let mut maximum: f64 = 0.0;
    for (i, &flag) in flags.iter().enumerate() {
        let position = [i % c.nx, i / c.nx % c.ny, i / (c.nx * c.ny)];
        let mut velocity = [0.0; 3];
        if flag == 0 {
            for a in 0..3 {
                let mut other = position;
                other[a] += 1;
                velocity[a] = 0.5
                    * (fields[a][face_at(c, flags, a, position).index]
                        + fields[a][face_at(c, flags, a, other).index]);
            }
        }
        maximum = maximum.max(crate::hypot(
            crate::hypot(velocity[0], velocity[1])?,
            velocity[2],
        )?);
        for (a, &value) in velocity.iter().enumerate() {
            b.output[i * stride + a] = crate::field_value(value)?;
        }
        b.output[i * stride + 3] =
            crate::field_value(if flag == 0 { b.pressure_pa[i] } else { 0.0 })?;
        if let Some(temperature) = b.temperature_delta_k {
            let t = ambient_c + temperature[i];
            if !t.is_finite() {
                return Err(KernelError::NonFiniteValue);
            }
            if t <= -273.15 {
                return Err(KernelError::InvalidState);
            }
            b.output[i * stride + 4] = crate::field_value(t)?;
        }
    }
    Ok(maximum)
}
