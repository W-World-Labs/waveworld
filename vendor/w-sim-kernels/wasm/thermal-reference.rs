//! Test-only native oracle for the standalone heat kernel and the thermal
//! region/contact helpers behind `heat`, `seed_heat`, `thermal_regions` and
//! `thermal_contact_faces`. Reads one binary case file and writes the status
//! words plus every output buffer byte, including partially written or
//! sentinel state left behind by kernel-level errors.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{
    geometry::{assign_thermal_regions, thermal_contact_faces},
    seed_heat, step_heat, KernelError, Seed,
};

const SENT32: u32 = 0xa5a5_a5a5;

fn word(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}
fn double(b: &[u8], at: usize) -> f64 {
    f64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}
fn floats(b: &[u8], at: usize, count: usize) -> Vec<f32> {
    (0..count)
        .map(|i| f32::from_le_bytes(b[at + 4 * i..at + 4 * i + 4].try_into().unwrap()))
        .collect()
}

fn status(result: Result<(), KernelError>) -> u32 {
    match result {
        Ok(()) => 0,
        Err(KernelError::InvalidDimensions) => 1,
        Err(KernelError::BufferLength) => 2,
        Err(KernelError::InvalidCoefficient) => 3,
        Err(KernelError::NonFiniteValue) => 4,
        Err(KernelError::InvalidState) => 5,
        Err(KernelError::UnsupportedFeature) => 6,
        Err(KernelError::RayLimitExceeded) => 8,
        Err(KernelError::InvalidSolidTopology) => 11,
    }
}

fn write_field(out: &mut impl Write, field: &[f32]) {
    for &v in field {
        out.write_all(&v.to_le_bytes()).unwrap();
    }
}

fn main() {
    let bytes = fs::read(env::args().nth(1).unwrap()).unwrap();
    let mut out = io::BufWriter::new(io::stdout().lock());
    match word(&bytes, 0) {
        // u32 width, u32 height, f64 r, u32 steps, f32 current[w*h]: alternate
        // buffers like the caller; record every status and both end states.
        0 => {
            let (w, h) = (word(&bytes, 4) as usize, word(&bytes, 8) as usize);
            let (r, steps) = (double(&bytes, 12), word(&bytes, 20) as usize);
            let n = w * h;
            let mut current = floats(&bytes, 24, n);
            let mut next = vec![f32::from_bits(SENT32); n];
            for _ in 0..steps {
                let code = status(step_heat(&current, &mut next, w, h, r));
                out.write_all(&code.to_le_bytes()).unwrap();
                if code == 0 {
                    core::mem::swap(&mut current, &mut next);
                }
            }
            write_field(&mut out, &current);
            write_field(&mut out, &next);
        }
        // u32 width, u32 height, i32 x, i32 y, u32 radius, f64 amount,
        // f32 field[w*h]: one clipped deposit over the supplied field.
        1 => {
            let (w, h) = (word(&bytes, 4) as usize, word(&bytes, 8) as usize);
            let seed = Seed {
                x: word(&bytes, 12) as i32 as isize,
                y: word(&bytes, 16) as i32 as isize,
                radius: word(&bytes, 20) as usize,
                amount: double(&bytes, 24),
            };
            let mut field = floats(&bytes, 32, w * h);
            let code = status(seed_heat(&mut field, w, h, seed));
            out.write_all(&code.to_le_bytes()).unwrap();
            write_field(&mut out, &field);
        }
        // u32 nx, ny, nz, u32 count, f64 matrix[12], f64 bounds[count][6],
        // u8 flags[n]: normalized-space region assignment and 17 counts.
        2 => {
            let dims = [
                word(&bytes, 4) as usize,
                word(&bytes, 8) as usize,
                word(&bytes, 12) as usize,
            ];
            let count = word(&bytes, 16) as usize;
            let mut matrix = [0.; 12];
            for (k, v) in matrix.iter_mut().enumerate() {
                *v = double(&bytes, 24 + 8 * k);
            }
            let mut at = 24 + 96;
            let bounds: Vec<[f64; 6]> = (0..count)
                .map(|_| {
                    let mut b = [0.; 6];
                    for (k, v) in b.iter_mut().enumerate() {
                        *v = double(&bytes, at + 8 * k);
                    }
                    at += 48;
                    b
                })
                .collect();
            let mut flags = bytes[at..at + dims[0] * dims[1] * dims[2]].to_vec();
            let mut counts = [SENT32; 17];
            let code = status(assign_thermal_regions(
                &mut flags, dims, &matrix, &bounds, &mut counts,
            ));
            out.write_all(&code.to_le_bytes()).unwrap();
            out.write_all(&flags).unwrap();
            for v in counts {
                out.write_all(&v.to_le_bytes()).unwrap();
            }
        }
        // u32 nx, ny, nz, u32 periodic, u8 flags[n]: shared-face contact mask.
        3 => {
            let dims = [
                word(&bytes, 4) as usize,
                word(&bytes, 8) as usize,
                word(&bytes, 12) as usize,
            ];
            let periodic = word(&bytes, 16) == 1;
            let flags = &bytes[20..20 + dims[0] * dims[1] * dims[2]];
            let mut mask = [SENT32; 5];
            let code = status(thermal_contact_faces(flags, dims, periodic, &mut mask));
            out.write_all(&code.to_le_bytes()).unwrap();
            for v in mask {
                out.write_all(&v.to_le_bytes()).unwrap();
            }
        }
        _ => panic!("unknown reference operation"),
    }
}
