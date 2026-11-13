//! Test-only native oracle for the MAC SI cell-field sampler (mac_sample).
//! Reads one binary case file and prints the status word, the f64 maximum
//! cell-speed readout and every display byte, including partially written
//! output after kernel-level errors.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{
    mac_fields::{sample_mac_cells, MacCellFieldBuffers},
    mac_projection::MacProjectionConfig,
    KernelError,
};

const SENT64: u64 = 0xa5a5_a5a5_a5a5_a5a5;
const SENT32: u32 = 0xa5a5_a5a5;

fn word(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}
fn double(b: &[u8], at: usize) -> f64 {
    f64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}
fn doubles(b: &[u8], at: usize, count: usize) -> Vec<f64> {
    (0..count).map(|i| double(b, at + 8 * i)).collect()
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

fn main() {
    let bytes = fs::read(env::args().nth(1).unwrap()).unwrap();
    let thermal = word(&bytes, 0);
    assert!(thermal <= 1, "the thermal selector is 0 or 1");
    let p = &bytes[4..68];
    assert_eq!(word(p, 20), 0, "the reserved config word stays zero");
    assert!(word(p, 12) <= 63, "open_faces is a six-bit mask");
    let c = MacProjectionConfig {
        nx: word(p, 0) as usize,
        ny: word(p, 4) as usize,
        nz: word(p, 8) as usize,
        open_faces: word(p, 12) as u8,
        max_iterations: word(p, 16),
        dx_m: double(p, 24),
        dt_s: double(p, 32),
        density_kg_m3: double(p, 40),
        absolute_divergence_tol: double(p, 48),
        relative_residual_tol: double(p, 56),
    };
    let ambient = double(&bytes, 68);
    let n = c.nx * c.ny * c.nz;
    let counts = [
        (c.nx + 1) * c.ny * c.nz,
        c.nx * (c.ny + 1) * c.nz,
        c.nx * c.ny * (c.nz + 1),
    ];
    let mut at = 76;
    let flags = &bytes[at..at + n];
    at += n;
    let u = doubles(&bytes, at, counts[0]);
    at += counts[0] * 8;
    let v = doubles(&bytes, at, counts[1]);
    at += counts[1] * 8;
    let w = doubles(&bytes, at, counts[2]);
    at += counts[2] * 8;
    let pressure = doubles(&bytes, at, n);
    at += n * 8;
    let temperature = if thermal == 1 {
        let t = doubles(&bytes, at, n);
        at += n * 8;
        Some(t)
    } else {
        None
    };
    assert_eq!(at, bytes.len());
    let mut output = vec![f32::from_bits(SENT32); n * (4 + thermal as usize)];
    let mut maximum = f64::from_bits(SENT64);
    let result = sample_mac_cells(
        &c,
        flags,
        ambient,
        &mut MacCellFieldBuffers {
            u: &u,
            v: &v,
            w: &w,
            pressure_pa: &pressure,
            temperature_delta_k: temperature.as_deref(),
            output: &mut output,
        },
    );
    let code = status(result.map(|value| maximum = value));
    let mut out = io::BufWriter::new(io::stdout().lock());
    out.write_all(&code.to_le_bytes()).unwrap();
    out.write_all(&maximum.to_le_bytes()).unwrap();
    for &value in output.iter() {
        out.write_all(&value.to_le_bytes()).unwrap();
    }
}
