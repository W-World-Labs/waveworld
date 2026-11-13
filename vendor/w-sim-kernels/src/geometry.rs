//! Triangle scan conversion in already-transformed lattice coordinates.
//! Same z-slice / even-odd / DDA convention as the product voxelizer, with
//! explicit solid groups combined by union. Unspecified groups are not inferred.

use crate::KernelError;
use core::cmp::Ordering;

/// Caller has validated distinct material indices in 0..=16.
pub(crate) fn thermal_contact_index(first: usize, second: usize) -> usize {
    let hi = first.max(second);
    let lo = first.min(second);
    hi * (hi - 1) / 2 + lo
}

/// Resolve solid pairs sharing a voxel face; edge/corner touching is not contact.
/// Result uses 136 unordered-pair bits; no cell buffer or allocation is added.
pub fn thermal_contact_faces(
    flags: &[u8],
    dims: [usize; 3],
    periodic: bool,
    mask: &mut [u32; 5],
) -> Result<(), KernelError> {
    let n = cell_count(dims[0], dims[1], dims[2])?;
    if flags.len() != n {
        return Err(KernelError::BufferLength);
    }
    if flags.iter().any(|&f| f > 20) {
        return Err(KernelError::UnsupportedFeature);
    }
    mask.fill(0);
    let stride = [1, dims[0], dims[0] * dims[1]];
    // z/y/x iteration hands each cell its [x, y, z] position directly instead
    // of three divisions per cell; the (i, axis) visit order is unchanged.
    let mut i = 0;
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let a = flags[i];
                if a >= 4 {
                    let at = [x, y, z];
                    for axis in 0..3 {
                        let j = if at[axis] + 1 < dims[axis] {
                            i + stride[axis]
                        } else if periodic {
                            i - at[axis] * stride[axis]
                        } else {
                            continue;
                        };
                        let b = flags[j];
                        if b >= 4 && a != b {
                            let index =
                                thermal_contact_index((a - 4) as usize, (b - 4) as usize);
                            mask[index / 32] |= 1 << (index % 32);
                        }
                    }
                }
                i += 1;
            }
        }
    }
    Ok(())
}

/// Assign normalized model-space AABBs to existing solid cell centers. Matrix
/// rows map lattice xyz to normalized source xyz; no rotated bounding-box enlargement.
pub fn assign_thermal_regions(
    flags: &mut [u8],
    dims: [usize; 3],
    matrix: &[f64; 12],
    bounds: &[[f64; 6]],
    counts: &mut [u32; 17],
) -> Result<(), KernelError> {
    let n = cell_count(dims[0], dims[1], dims[2])?;
    if flags.len() != n {
        return Err(KernelError::BufferLength);
    }
    if bounds.len() > 16 || flags.iter().any(|&f| f > 4) {
        return Err(KernelError::UnsupportedFeature);
    }
    if matrix.iter().any(|v| !v.is_finite()) {
        return Err(KernelError::InvalidCoefficient);
    }
    for (i, b) in bounds.iter().enumerate() {
        if b.iter().any(|v| !v.is_finite() || *v < 0. || *v > 1.)
            || (0..3).any(|k| b[k] >= b[k + 3])
        {
            return Err(KernelError::InvalidCoefficient);
        }
        if bounds[..i]
            .iter()
            .any(|a| (0..3).all(|k| b[k] < a[k + 3] && a[k] < b[k + 3]))
        {
            return Err(KernelError::InvalidState);
        }
    }
    counts.fill(0);
    for (i, flag) in flags.iter_mut().enumerate() {
        if *flag != 4 {
            continue;
        }
        let xyz = [
            (i % dims[0]) as f64 + 0.5,
            ((i / dims[0]) % dims[1]) as f64 + 0.5,
            (i / (dims[0] * dims[1])) as f64 + 0.5,
        ];
        let mut normalized = [0.; 3];
        for k in 0..3 {
            normalized[k] = matrix[k * 4] * xyz[0]
                + matrix[k * 4 + 1] * xyz[1]
                + matrix[k * 4 + 2] * xyz[2]
                + matrix[k * 4 + 3];
        }
        if normalized.iter().any(|v| !v.is_finite()) {
            return Err(KernelError::NonFiniteValue);
        }
        for (r, b) in bounds.iter().enumerate() {
            if (0..3).all(|k| {
                normalized[k] >= b[k]
                    && (normalized[k] < b[k + 3] || (b[k + 3] == 1. && normalized[k] <= 1.))
            }) {
                *flag = 5 + r as u8;
                break;
            }
        }
        counts[(*flag - 4) as usize] = counts[(*flag - 4) as usize]
            .checked_add(1)
            .ok_or(KernelError::InvalidDimensions)?;
    }
    if counts[1..=bounds.len()].contains(&0) {
        return Err(KernelError::InvalidState);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VoxelCounts {
    pub solid_cells: usize,
    pub frontal_area_cells: usize,
}

pub(crate) fn cell_count(nx: usize, ny: usize, nz: usize) -> Result<usize, KernelError> {
    if nx == 0 || ny == 0 || nz == 0 {
        return Err(KernelError::InvalidDimensions);
    }
    nx.checked_mul(ny)
        .and_then(|xy| xy.checked_mul(nz))
        .filter(|&count| count <= isize::MAX as usize)
        .ok_or(KernelError::InvalidDimensions)
}

// All scan coordinates are admitted within the exactly represented integer
// range below, so these no_std floor/ceil operations cannot saturate i64.
fn floor(value: f64) -> f64 {
    let integer = value as i64 as f64;
    if integer > value {
        integer - 1.0
    } else {
        integer
    }
}

fn ceil(value: f64) -> f64 {
    -floor(-value)
}

/// `vertices` contains xyz triples in lattice coordinates; `indices` contains
/// triangle vertex indices. Scratch requires at least 5 f64 values per triangle
/// (four segment coordinates and one row crossing). Buffers are reused for all
/// slices; there is no allocation. Flags are reset to zero before conversion.
/// Also checks oriented geometric edge closure, as `voxelize_solids` without
/// explicit groups. This does not certify self-intersection or resolved volume.
#[allow(clippy::too_many_arguments)]
pub fn voxelize_triangles(
    vertices: &[f32],
    indices: &[u32],
    nx: usize,
    ny: usize,
    nz: usize,
    flags: &mut [u8],
    scratch: &mut [f64],
) -> Result<VoxelCounts, KernelError> {
    voxelize_solids(vertices, indices, &[], nx, ny, nz, flags, scratch)
}

/// Consecutive triangle groups describe solid boundary sets: even-odd inside
/// each set (including explicitly grouped cavity shells), union across sets.
/// Nonempty counts must be positive and sum to the total triangle count. Empty
/// counts retain the single boundary-set convention of `voxelize_triangles`.
/// Each set must have nonzero-area triangles and every geometric edge must occur
/// exactly twice, in opposite directions. Coordinates are compared exactly;
/// zero-area triangles are ignored. This is not mesh repair, a self-intersection
/// check, or a certificate of manifold vertices or grid resolution.
/// Storage and surface marking are unchanged; scratch needs 5 f64 per triangle.
#[allow(clippy::too_many_arguments)]
pub fn voxelize_solids(
    vertices: &[f32],
    indices: &[u32],
    solid_triangle_counts: &[u32],
    nx: usize,
    ny: usize,
    nz: usize,
    flags: &mut [u8],
    scratch: &mut [f64],
) -> Result<VoxelCounts, KernelError> {
    let count = cell_count(nx, ny, nz)?;
    if !vertices.len().is_multiple_of(3) || !indices.len().is_multiple_of(3) || flags.len() != count
    {
        return Err(KernelError::BufferLength);
    }
    let triangles = indices.len() / 3;
    if !solid_triangle_counts.is_empty() {
        let grouped = solid_triangle_counts.iter().try_fold(0usize, |sum, &n| {
            if n == 0 {
                None
            } else {
                sum.checked_add(n as usize).filter(|&s| s <= triangles)
            }
        });
        if grouped != Some(triangles) {
            return Err(KernelError::InvalidState);
        }
    }
    let needed = triangles.checked_mul(5).ok_or(KernelError::BufferLength)?;
    if scratch.len() < needed {
        return Err(KernelError::BufferLength);
    }
    if vertices.iter().any(|value| !value.is_finite()) {
        return Err(KernelError::NonFiniteValue);
    }
    // Beyond this, unit-cell locations and DDA step integers cannot be safely
    // resolved in f64. Reject rather than silently run an enormous scan.
    if vertices
        .iter()
        .any(|value| (*value as f64).abs() > 2_251_799_813_685_248.0)
        || indices
            .iter()
            .any(|&index| index as usize >= vertices.len() / 3)
    {
        return Err(KernelError::InvalidState);
    }
    // Validate every declared set before changing any flags. The same scratch
    // is reused for topology and scanning, with no allocation or inferred groups.
    if solid_triangle_counts.is_empty() {
        validate_boundary_edges(vertices, indices, scratch)?;
    } else {
        let mut start = 0;
        for &n in solid_triangle_counts {
            let end = start + n as usize * 3;
            validate_boundary_edges(vertices, &indices[start..end], scratch)?;
            start = end;
        }
    }
    flags.fill(0);
    if solid_triangle_counts.is_empty() {
        fill_boundary_set(vertices, indices, nx, ny, nz, flags, scratch)?;
    } else {
        let mut start = 0;
        for &n in solid_triangle_counts {
            // The sum was checked against indices.len()/3 before any writes.
            let end = start + n as usize * 3;
            fill_boundary_set(vertices, &indices[start..end], nx, ny, nz, flags, scratch)?;
            start = end;
        }
    }
    let mut counts = VoxelCounts {
        solid_cells: 0,
        frontal_area_cells: 0,
    };
    for row in flags.chunks_exact(nx) {
        let solids = row.iter().filter(|&&value| value == 1).count();
        counts.solid_cells += solids;
        counts.frontal_area_cells += usize::from(solids > 0);
    }
    Ok(counts)
}

fn triangle_has_area(vertices: &[f32], triangle: &[u32]) -> bool {
    let [a, b, c] = [
        triangle[0] as usize * 3,
        triangle[1] as usize * 3,
        triangle[2] as usize * 3,
    ];
    let mut ab = [0.; 3];
    let mut ac = [0.; 3];
    for k in 0..3 {
        ab[k] = vertices[b + k] as f64 - vertices[a + k] as f64;
        ac[k] = vertices[c + k] as f64 - vertices[a + k] as f64;
    }
    (0..3).any(|k| ab[(k + 1) % 3] * ac[(k + 2) % 3] != ab[(k + 2) % 3] * ac[(k + 1) % 3])
}

fn compare_vertices(vertices: &[f32], a: u32, b: u32) -> Ordering {
    for k in 0..3 {
        let x = vertices[a as usize * 3 + k];
        let y = vertices[b as usize * 3 + k];
        // Finite input was checked above. Numeric equality also treats -0 as 0.
        if x != y {
            return x.total_cmp(&y);
        }
    }
    Ordering::Equal
}

fn ordered_edge(vertices: &[f32], encoded: f64) -> (u32, u32, bool) {
    let bits = encoded.to_bits();
    let (a, b) = ((bits >> 32) as u32, bits as u32);
    if compare_vertices(vertices, a, b) == Ordering::Less {
        (a, b, true)
    } else {
        (b, a, false)
    }
}

fn compare_edges(vertices: &[f32], a: f64, b: f64) -> Ordering {
    let (a0, a1, _) = ordered_edge(vertices, a);
    let (b0, b1, _) = ordered_edge(vertices, b);
    compare_vertices(vertices, a0, b0).then_with(|| compare_vertices(vertices, a1, b1))
}

fn validate_boundary_edges(
    vertices: &[f32],
    indices: &[u32],
    scratch: &mut [f64],
) -> Result<(), KernelError> {
    let mut count = 0;
    for triangle in indices.chunks_exact(3) {
        if !triangle_has_area(vertices, triangle) {
            continue;
        }
        for k in 0..3 {
            // Opaque u32 index pairs occupy existing f64 scratch slots. Never
            // perform floating-point operations on these possibly-NaN bit patterns.
            scratch[count] =
                f64::from_bits((u64::from(triangle[k]) << 32) | u64::from(triangle[(k + 1) % 3]));
            count += 1;
        }
    }
    if count == 0 {
        return Err(KernelError::InvalidSolidTopology);
    }
    let edges = &mut scratch[..count];
    edges.sort_unstable_by(|a, b| compare_edges(vertices, *a, *b));
    let mut first = 0;
    while first < edges.len() {
        let mut end = first + 1;
        while end < edges.len()
            && compare_edges(vertices, edges[first], edges[end]) == Ordering::Equal
        {
            end += 1;
        }
        if end - first != 2
            || ordered_edge(vertices, edges[first]).2 == ordered_edge(vertices, edges[first + 1]).2
        {
            return Err(KernelError::InvalidSolidTopology);
        }
        first = end;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn fill_boundary_set(
    vertices: &[f32],
    indices: &[u32],
    nx: usize,
    ny: usize,
    nz: usize,
    flags: &mut [u8],
    scratch: &mut [f64],
) -> Result<(), KernelError> {
    let triangles = indices.len() / 3;
    let needed = triangles * 5;
    let (segments, crossings) = scratch[..needed].split_at_mut(triangles * 4);
    for gz in 0..nz {
        let z_plane = gz as f64 + 0.5;
        let mut segment_count = 0;
        for triangle in indices.chunks_exact(3) {
            let [a, b, c] = [
                triangle[0] as usize * 3,
                triangle[1] as usize * 3,
                triangle[2] as usize * 3,
            ];
            let [za, zb, zc] = [
                vertices[a + 2] as f64,
                vertices[b + 2] as f64,
                vertices[c + 2] as f64,
            ];
            if z_plane < za.min(zb).min(zc) || z_plane >= za.max(zb).max(zc) {
                continue;
            }
            if !triangle_has_area(vertices, triangle) {
                continue;
            }
            let mut points = [0.0; 6];
            let mut point_count = 0;
            for (first, second) in [(a, b), (b, c), (c, a)] {
                let z1 = vertices[first + 2] as f64;
                let z2 = vertices[second + 2] as f64;
                if (z1 < z_plane && z2 >= z_plane) || (z2 < z_plane && z1 >= z_plane) {
                    let s = (z_plane - z1) / (z2 - z1);
                    for axis in 0..2 {
                        points[point_count * 2 + axis] = vertices[first + axis] as f64
                            + s * (vertices[second + axis] as f64 - vertices[first + axis] as f64);
                    }
                    point_count += 1;
                }
            }
            if point_count == 2 {
                segments[segment_count * 4..segment_count * 4 + 4].copy_from_slice(&points[..4]);
                segment_count += 1;
            }
        }
        let segments = &segments[..segment_count * 4];
        for segment in segments.chunks_exact(4) {
            mark_surface(segment, gz, nx, ny, flags)?;
        }
        for gy in 0..ny {
            let ys = gy as f64 + 0.5;
            let mut crossing_count = 0;
            for segment in segments.chunks_exact(4) {
                let [x1, y1, x2, y2] = [segment[0], segment[1], segment[2], segment[3]];
                if (y1 <= ys && ys < y2) || (y2 <= ys && ys < y1) {
                    crossings[crossing_count] = x1 + ((ys - y1) * (x2 - x1)) / (y2 - y1);
                    crossing_count += 1;
                }
            }
            let crossings = &mut crossings[..crossing_count];
            crossings.sort_unstable_by(f64::total_cmp);
            for pair in crossings.chunks_exact(2) {
                let start = ceil(pair[0] - 0.5).max(0.0);
                let end = floor(pair[1] - 0.5).min(nx as f64 - 1.0);
                if start <= end {
                    for gx in start as usize..=end as usize {
                        flags[gz * nx * ny + gy * nx + gx] = 1;
                    }
                }
            }
        }
    }
    Ok(())
}

fn mark_surface(
    segment: &[f64],
    gz: usize,
    nx: usize,
    ny: usize,
    flags: &mut [u8],
) -> Result<(), KernelError> {
    let [x1, y1, x2, y2] = [segment[0], segment[1], segment[2], segment[3]];
    let dx = x2 - x1;
    let dy = y2 - y1;
    let steps = ceil(dx.abs().max(dy.abs())) * 2.0 + 1.0;
    if steps >= 9_007_199_254_740_992.0 {
        return Err(KernelError::InvalidState);
    }
    // Retain the exact original DDA sample positions, but skip samples outside
    // the domain. Padding covers the rounding of the clipped integer limits.
    let mut first: f64 = 0.0;
    let mut last: f64 = 1.0;
    for (origin, delta, limit) in [(x1, dx, nx as f64), (y1, dy, ny as f64)] {
        if delta == 0.0 {
            if origin < 0.0 || origin >= limit {
                return Ok(());
            }
        } else {
            let a = -origin / delta;
            let b = (limit - origin) / delta;
            first = first.max(a.min(b));
            last = last.min(a.max(b));
        }
    }
    if first > last {
        return Ok(());
    }
    let first = (floor(first * steps) - 4.0).max(0.0) as u64;
    let last = (ceil(last * steps) + 4.0).min(steps) as u64;
    // An in-domain segment has at most O(nx+ny) half-cell samples, even when
    // the original mesh extends far outside the grid.
    if last.saturating_sub(first) > (nx as u64 + ny as u64).saturating_mul(4).saturating_add(32) {
        return Err(KernelError::InvalidState);
    }
    for k in first..=last {
        let x = floor(x1 + (dx * k as f64) / steps);
        let y = floor(y1 + (dy * k as f64) / steps);
        if x >= 0.0 && x < nx as f64 && y >= 0.0 && y < ny as f64 {
            flags[gz * nx * ny + y as usize * nx + x as usize] = 1;
        }
    }
    Ok(())
}
