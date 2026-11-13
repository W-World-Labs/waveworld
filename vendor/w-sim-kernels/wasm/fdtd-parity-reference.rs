//! Test-only native oracle for the reduced-unit TMz Yee kernel behind
//! `fdtd_step`, `fdtd_source` and `fdtd_energy`. Reads one binary case file
//! and writes the status words plus every output buffer byte, including
//! partially written or sentinel state left behind by kernel-level errors.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{
    fdtd::{add_soft_source, energy_fdtd, step_fdtd, FdtdBoundary, FdtdBuffers, FdtdConfig},
    KernelError,
};

const SENT64: u64 = 0xa5a5_a5a5_a5a5_a5a5;

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
        // u32 nx, ny, boundary, steps, has_mask; f64 dt, mu; f32 eps[n],
        // u8 mask[n]?, f32 ez/hx/hy[n], f32 left/right[ny], f32 bottom/top[nx]:
        // in-place stepping; record every status and all end-state buffers.
        0 => {
            let (nx, ny) = (word(&bytes, 4) as usize, word(&bytes, 8) as usize);
            let boundary = if word(&bytes, 12) == 1 {
                FdtdBoundary::Pec
            } else {
                FdtdBoundary::Mur
            };
            let (steps, has_mask) = (word(&bytes, 16) as usize, word(&bytes, 20) == 1);
            let (dt, mu) = (double(&bytes, 24), double(&bytes, 32));
            let n = nx * ny;
            let mut at = 40;
            let eps = floats(&bytes, at, n);
            at += 4 * n;
            let mask = has_mask.then(|| {
                let m = bytes[at..at + n].to_vec();
                at += n;
                m
            });
            let mut ez = floats(&bytes, at, n);
            at += 4 * n;
            let mut hx = floats(&bytes, at, n);
            at += 4 * n;
            let mut hy = floats(&bytes, at, n);
            at += 4 * n;
            let mut left = floats(&bytes, at, ny);
            at += 4 * ny;
            let mut right = floats(&bytes, at, ny);
            at += 4 * ny;
            let mut bottom = floats(&bytes, at, nx);
            at += 4 * nx;
            let mut top = floats(&bytes, at, nx);
            let config = FdtdConfig {
                nx,
                ny,
                dt,
                mu,
                boundary,
            };
            for _ in 0..steps {
                let code = status(step_fdtd(
                    &config,
                    &eps,
                    mask.as_deref(),
                    &mut FdtdBuffers {
                        ez: &mut ez,
                        hx: &mut hx,
                        hy: &mut hy,
                        prev_left: &mut left,
                        prev_right: &mut right,
                        prev_bottom: &mut bottom,
                        prev_top: &mut top,
                    },
                ));
                out.write_all(&code.to_le_bytes()).unwrap();
            }
            for field in [&ez, &hx, &hy, &left, &right, &bottom, &top] {
                write_field(&mut out, field);
            }
        }
        // u32 nx, ny, count; count x (u32 x, u32 y, f64 amplitude); f32 ez[n]:
        // independent soft-source deposits over one shared field.
        1 => {
            let (nx, ny, count) = (
                word(&bytes, 4) as usize,
                word(&bytes, 8) as usize,
                word(&bytes, 12) as usize,
            );
            let mut at = 16;
            let sources: Vec<(usize, usize, f64)> = (0..count)
                .map(|_| {
                    let s = (
                        word(&bytes, at) as usize,
                        word(&bytes, at + 4) as usize,
                        double(&bytes, at + 8),
                    );
                    at += 16;
                    s
                })
                .collect();
            let mut ez = floats(&bytes, at, nx * ny);
            for (x, y, amplitude) in sources {
                let code = status(add_soft_source(&mut ez, nx, ny, x, y, amplitude));
                out.write_all(&code.to_le_bytes()).unwrap();
            }
            write_field(&mut out, &ez);
        }
        // u32 nx, ny, boundary; f64 dt, mu; f32 eps/ez/hx/hy[n]: sampled
        // energy, with sentinel bits when the kernel rejects the state.
        2 => {
            let (nx, ny) = (word(&bytes, 4) as usize, word(&bytes, 8) as usize);
            let boundary = if word(&bytes, 12) == 1 {
                FdtdBoundary::Pec
            } else {
                FdtdBoundary::Mur
            };
            let (dt, mu) = (double(&bytes, 16), double(&bytes, 24));
            let n = nx * ny;
            let eps = floats(&bytes, 32, n);
            let ez = floats(&bytes, 32 + 4 * n, n);
            let hx = floats(&bytes, 32 + 8 * n, n);
            let hy = floats(&bytes, 32 + 12 * n, n);
            let config = FdtdConfig {
                nx,
                ny,
                dt,
                mu,
                boundary,
            };
            let (code, energy) = match energy_fdtd(&config, &eps, &ez, &hx, &hy) {
                Ok(value) => (status(Ok(())), value.to_bits()),
                Err(error) => (status(Err(error)), SENT64),
            };
            out.write_all(&code.to_le_bytes()).unwrap();
            out.write_all(&energy.to_le_bytes()).unwrap();
        }
        _ => panic!("unknown reference operation"),
    }
}
