//! Test-only fixture/byte adapter; every thermal operation uses the shared kernel.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{
    mac_projection::MacProjectionConfig,
    mac_thermal::{
        step_mac_thermal3d, MacThermalBuffers, ThermalConfig, ThermalMaterial, ThermalMode,
    },
    KernelError,
};

fn word(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}
fn double(b: &[u8], at: usize) -> f64 {
    f64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}

fn main() {
    let bytes = fs::read(env::args().nth(1).unwrap()).unwrap();
    let steps = word(&bytes, 0);
    assert!((1..=3).contains(&steps));
    let p = &bytes[4..1820];
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
    let thermal = ThermalConfig {
        gravity_per_kelvin: double(p, 64),
        dt_seconds: double(p, 72),
        ambient_c: double(p, 80),
        fixed_surface_c: double(p, 88),
        dx_meters: double(p, 96),
        fluid_density: double(p, 104),
        fluid_specific_heat: double(p, 112),
        fluid_conductivity: double(p, 120),
        solid_density: double(p, 128),
        solid_specific_heat: double(p, 136),
        solid_conductivity: double(p, 144),
        total_power_w: double(p, 152),
        mode: match word(p, 160) {
            0 => ThermalMode::FixedTemperature,
            1 => ThermalMode::SolidPower,
            _ => panic!("fixture mode"),
        },
        max_substeps: word(p, 164),
        temperature_scale_c: double(p, 168),
        material_count: word(p, 176) as usize,
        materials: std::array::from_fn(|i| ThermalMaterial {
            density: double(p, 184 + i * 32),
            specific_heat: double(p, 192 + i * 32),
            conductivity: double(p, 200 + i * 32),
            total_power_w: double(p, 208 + i * 32),
        }),
        contact_mask: std::array::from_fn(|i| word(p, 696 + i * 4)),
        contact_resistance: std::array::from_fn(|i| double(p, 728 + i * 8)),
    };
    let n = c.nx * c.ny * c.nz;
    let counts = [
        (c.nx + 1) * c.ny * c.nz,
        c.nx * (c.ny + 1) * c.nz,
        c.nx * c.ny * (c.nz + 1),
    ];
    let flags = &bytes[1820..1820 + n];
    let mut at = 1820 + n;
    let fields: Vec<Vec<f64>> = counts
        .into_iter()
        .map(|count| {
            let f = (0..count).map(|i| double(&bytes, at + i * 8)).collect();
            at += count * 8;
            f
        })
        .collect();
    let mut energy: Vec<f64> = (0..n).map(|i| double(&bytes, at + i * 8)).collect();
    assert_eq!(at + n * 8, bytes.len());
    let mut next = vec![f64::NAN; n];
    let mut temperature = vec![f64::NAN; n];
    let mut work = vec![f64::NAN; n];
    let mut out = io::BufWriter::new(io::stdout().lock());
    for _ in 0..steps {
        let current_bits: Vec<_> = energy.iter().map(|v| v.to_bits()).collect();
        let result = step_mac_thermal3d(
            &c,
            &thermal,
            flags,
            &mut MacThermalBuffers {
                u: &fields[0],
                v: &fields[1],
                w: &fields[2],
                energy: &energy,
                next_energy: &mut next,
                temperature_delta_k: &mut temperature,
                work: &mut work,
            },
        );
        assert_eq!(
            current_bits,
            energy.iter().map(|v| v.to_bits()).collect::<Vec<_>>()
        );
        let mut stats = [0xa5; 56];
        let status: u32 = match result {
            Ok(s) => {
                for (i, value) in [
                    s.thermal_energy_j,
                    s.source_energy_j,
                    s.boundary_energy_j,
                    s.energy_residual_j,
                    s.solid_max_c,
                    s.fluid_max_c,
                    s.substeps as f64,
                ]
                .into_iter()
                .enumerate()
                {
                    stats[i * 8..(i + 1) * 8].copy_from_slice(&value.to_le_bytes());
                }
                0
            }
            Err(error) => match error {
                KernelError::InvalidDimensions => 1,
                KernelError::BufferLength => 2,
                KernelError::InvalidCoefficient => 3,
                KernelError::NonFiniteValue => 4,
                KernelError::InvalidState => 5,
                KernelError::UnsupportedFeature => 6,
                KernelError::RayLimitExceeded => 8,
                KernelError::InvalidSolidTopology => 11,
            },
        };
        out.write_all(&status.to_le_bytes()).unwrap();
        out.write_all(&stats).unwrap();
        if status != 0 {
            break;
        }
        for field in [&next, &temperature] {
            for value in field {
                out.write_all(&value.to_le_bytes()).unwrap();
            }
        }
        std::mem::swap(&mut energy, &mut next);
    }
}
