//! Test-only native oracle for the triangle scan converter behind `voxelize`
//! and `voxelize_solids`: z-slice even-odd fill, DDA surface marking, explicit
//! solid groups and the boundary-edge closure checks. Reads one binary case
//! file and writes the status word, both voxel counts and every flags/scratch
//! byte, including partially written buffers and sentinels left behind by
//! kernel-level errors.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{geometry::voxelize_solids, KernelError};

const SENT64: u64 = 0xa5a5_a5a5_a5a5_a5a5;
const SENT32: u32 = 0xa5a5_a5a5;
const SENT8: u8 = 0xa5;

fn word(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}
fn words(b: &[u8], at: usize, count: usize) -> Vec<u32> {
    (0..count).map(|i| word(b, at + 4 * i)).collect()
}
fn floats(b: &[u8], at: usize, count: usize) -> Vec<f32> {
    (0..count)
        .map(|i| f32::from_le_bytes(b[at + 4 * i..at + 4 * i + 4].try_into().unwrap()))
        .collect()
}

fn status(error: KernelError) -> u32 {
    match error {
        KernelError::InvalidDimensions => 1,
        KernelError::BufferLength => 2,
        KernelError::InvalidCoefficient => 3,
        KernelError::NonFiniteValue => 4,
        KernelError::InvalidState => 5,
        KernelError::UnsupportedFeature => 6,
        KernelError::RayLimitExceeded => 8,
        KernelError::InvalidSolidTopology => 11,
    }
}

fn main() {
    let bytes = fs::read(env::args().nth(1).unwrap()).unwrap();
    // u32 nx, ny, nz, vertex_count, triangle_count, solid_count;
    // f32 vertices[3*vc]; u32 indices[3*tc]; u32 solid_triangle_counts[sc].
    let (nx, ny, nz) = (
        word(&bytes, 0) as usize,
        word(&bytes, 4) as usize,
        word(&bytes, 8) as usize,
    );
    let (vc, tc, sc) = (
        word(&bytes, 12) as usize,
        word(&bytes, 16) as usize,
        word(&bytes, 20) as usize,
    );
    let mut at = 24;
    let vertices = floats(&bytes, at, 3 * vc);
    at += 12 * vc;
    let indices = words(&bytes, at, 3 * tc);
    at += 12 * tc;
    let groups = words(&bytes, at, sc);
    at += 4 * sc;
    assert_eq!(at, bytes.len());
    // Dimension failures precede every buffer access in the kernel, so an
    // invalid cell product only needs an empty caller region here.
    let n = nx
        .checked_mul(ny)
        .and_then(|xy| xy.checked_mul(nz))
        .filter(|&count| count <= isize::MAX as usize)
        .unwrap_or(0);
    let mut flags = vec![SENT8; n];
    let mut scratch = vec![f64::from_bits(SENT64); 5 * tc];
    let result = voxelize_solids(
        &vertices,
        &indices,
        &groups,
        nx,
        ny,
        nz,
        &mut flags,
        &mut scratch,
    );
    let (code, counts) = match result {
        Ok(value) => (
            0,
            [value.solid_cells as u32, value.frontal_area_cells as u32],
        ),
        Err(error) => (status(error), [SENT32, SENT32]),
    };
    let mut out = io::BufWriter::new(io::stdout().lock());
    out.write_all(&code.to_le_bytes()).unwrap();
    for value in counts {
        out.write_all(&value.to_le_bytes()).unwrap();
    }
    out.write_all(&flags).unwrap();
    for value in scratch {
        out.write_all(&value.to_le_bytes()).unwrap();
    }
}
