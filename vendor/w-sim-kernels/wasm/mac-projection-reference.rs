//! Test-only file adapter; both hosts call the same pressure projection kernel.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::mac_projection::{
    project_mac3d, MacProjectionBuffers, MacProjectionConfig, MacProjectionError,
};

fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
}

fn double(bytes: &[u8], at: usize) -> f64 {
    f64::from_le_bytes(bytes[at..at + 8].try_into().unwrap())
}

fn main() {
    let bytes = fs::read(env::args().nth(1).unwrap()).unwrap();
    let c = MacProjectionConfig {
        nx: word(&bytes, 0) as usize,
        ny: word(&bytes, 4) as usize,
        nz: word(&bytes, 8) as usize,
        open_faces: word(&bytes, 12) as u8,
        max_iterations: word(&bytes, 16),
        dx_m: double(&bytes, 24),
        dt_s: double(&bytes, 32),
        density_kg_m3: double(&bytes, 40),
        absolute_divergence_tol: double(&bytes, 48),
        relative_residual_tol: double(&bytes, 56),
    };
    let n = c.nx * c.ny * c.nz;
    let counts = [
        (c.nx + 1) * c.ny * c.nz,
        c.nx * (c.ny + 1) * c.nz,
        c.nx * c.ny * (c.nz + 1),
    ];
    let flags = &bytes[64..64 + n];
    let mut at = 64 + n;
    let mut fields: Vec<Vec<f64>> = counts
        .into_iter()
        .map(|count| {
            let field = (0..count).map(|i| double(&bytes, at + i * 8)).collect();
            at += count * 8;
            field
        })
        .collect();
    assert_eq!(at, bytes.len());
    let [u, v, w] = fields.as_mut_slice() else {
        unreachable!()
    };
    let mut pressure = vec![f64::NAN; n];
    let mut work = vec![f64::NAN; 6 * n];
    let mut topology_work = vec![u32::MAX; 2 * n];
    let result = project_mac3d(
        &c,
        flags,
        &mut MacProjectionBuffers {
            u,
            v,
            w,
            pressure: &mut pressure,
            work: &mut work,
            topology_work: &mut topology_work,
        },
    );
    let mut out = io::BufWriter::new(io::stdout().lock());
    // Test wire flag only: 1=success, 0=error; this is not an executor protocol.
    out.write_all(&u32::from(result.is_ok()).to_le_bytes())
        .unwrap();
    let (words, doubles) = match result {
        Ok(s) => (
            [s.iterations, s.fluid_cells, s.closed_components, 0],
            [
                s.initial_divergence_linf,
                s.final_divergence_linf,
                s.allowed_divergence_linf,
                s.residual_linf_pa_per_m2,
            ],
        ),
        Err(MacProjectionError::NotConverged {
            iterations,
            residual_linf_pa_per_m2,
            allowed_residual_linf_pa_per_m2,
        }) => (
            [iterations, 0, 0, 0],
            [
                residual_linf_pa_per_m2,
                allowed_residual_linf_pa_per_m2,
                0.,
                0.,
            ],
        ),
        Err(error) => panic!("unexpected invalid native test input: {error:?}"),
    };
    for value in words {
        out.write_all(&value.to_le_bytes()).unwrap();
    }
    for value in doubles {
        out.write_all(&value.to_le_bytes()).unwrap();
    }
    for field in fields.iter().chain([&pressure]) {
        for value in field {
            out.write_all(&value.to_le_bytes()).unwrap();
        }
    }
}
