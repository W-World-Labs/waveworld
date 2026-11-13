//! Test-only binary fixture adapter; stepping and fan interpolation stay in Rust.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{
    fan_curve::{pressure_rise, FanCurvePoint},
    mac_projection::{MacProjectionConfig, MacProjectionError},
    mac_step::{step_mac3d, MacStepBuffers, MacStepConfig, MacStepError},
};

fn word(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}
fn double(b: &[u8], at: usize) -> f64 {
    f64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}
fn put_word(b: &mut [u8], at: usize, value: u32) {
    b[at..at + 4].copy_from_slice(&value.to_le_bytes());
}
fn put_double(b: &mut [u8], at: usize, value: f64) {
    b[at..at + 8].copy_from_slice(&value.to_le_bytes());
}

fn main() {
    let bytes = fs::read(env::args().nth(1).unwrap()).unwrap();
    let steps = word(&bytes, 0);
    let fan = word(&bytes, 4) == 1;
    assert!((1..=3).contains(&steps));
    let p = &bytes[8..104];
    let c = MacStepConfig {
        projection: MacProjectionConfig {
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
        },
        kinematic_viscosity_m2_s: double(p, 64),
        open_velocity_m_s: [double(p, 72), double(p, 80), double(p, 88)],
    };
    let g = &c.projection;
    let n = g.nx * g.ny * g.nz;
    let counts = [
        (g.nx + 1) * g.ny * g.nz,
        g.nx * (g.ny + 1) * g.nz,
        g.nx * g.ny * (g.nz + 1),
    ];
    let flags = &bytes[104..104 + n];
    let mut at = 104 + n;
    let mut read_fields = || -> Vec<Vec<f64>> {
        counts
            .into_iter()
            .map(|count| {
                let values = (0..count).map(|i| double(&bytes, at + i * 8)).collect();
                at += count * 8;
                values
            })
            .collect()
    };
    let mut current = read_fields();
    let mut acceleration = read_fields();
    assert_eq!(at, bytes.len());
    let mut next: Vec<Vec<f64>> = counts
        .into_iter()
        .map(|count| vec![f64::NAN; count])
        .collect();
    let mut pressure = vec![f64::NAN; n];
    let mut work = vec![f64::NAN; 6 * n];
    let mut topology = vec![u32::MAX; 2 * n];
    let mut out = io::BufWriter::new(io::stdout().lock());
    for step in 0..steps {
        let (mut fan_flow, mut fan_pressure) = (0.0, 0.0);
        if fan {
            for values in &mut acceleration {
                values.fill(0.0);
            }
            for z in 0..g.nz {
                for y in 0..g.ny {
                    fan_flow +=
                        current[0][g.nx / 2 + (g.nx + 1) * (y + g.ny * z)] * g.dx_m * g.dx_m;
                }
            }
            if step < 2 {
                // Synthetic test curve; it is not a manufacturer/default fan.
                fan_pressure = pressure_rise(
                    &[
                        FanCurvePoint {
                            flow_m3_s: 0.0,
                            pressure_pa: 20.0,
                        },
                        FanCurvePoint {
                            flow_m3_s: 0.01,
                            pressure_pa: 0.0,
                        },
                    ],
                    fan_flow,
                    1.0,
                )
                .unwrap();
                for z in 0..g.nz {
                    for y in 0..g.ny {
                        acceleration[0][g.nx / 2 + (g.nx + 1) * (y + g.ny * z)] =
                            fan_pressure / (g.density_kg_m3 * g.dx_m);
                    }
                }
            }
        }
        let [nu, nv, nw] = next.as_mut_slice() else {
            unreachable!()
        };
        let result = step_mac3d(
            &c,
            flags,
            &mut MacStepBuffers {
                u: &current[0],
                v: &current[1],
                w: &current[2],
                acceleration_u: &acceleration[0],
                acceleration_v: &acceleration[1],
                acceleration_w: &acceleration[2],
                next_u: nu,
                next_v: nv,
                next_w: nw,
                pressure: &mut pressure,
                work: &mut work,
                topology_work: &mut topology,
            },
        );
        let mut stats = [0u8; 168];
        let status = match result {
            Ok(s) => {
                put_word(&mut stats, 0, s.projection.iterations);
                put_word(&mut stats, 4, s.projection.fluid_cells);
                put_word(&mut stats, 8, s.projection.closed_components);
                for (i, v) in [
                    s.projection.initial_divergence_linf,
                    s.projection.final_divergence_linf,
                    s.projection.allowed_divergence_linf,
                    s.projection.residual_linf_pa_per_m2,
                    s.advection_cfl,
                    s.diffusion_cfl,
                    s.combined_cfl,
                ]
                .into_iter()
                .enumerate()
                {
                    put_double(&mut stats, 16 + i * 8, v);
                }
                for (i, v) in s
                    .wall_impulse_kg_m_s
                    .into_iter()
                    .chain(s.open_impulse_kg_m_s)
                    .chain(s.body_impulse_kg_m_s)
                    .chain(s.pressure_impulse_kg_m_s)
                    .enumerate()
                {
                    put_double(&mut stats, 72 + i * 8, v);
                }
                0u32
            }
            Err(MacStepError::Projection(MacProjectionError::NotConverged {
                iterations,
                residual_linf_pa_per_m2,
                allowed_residual_linf_pa_per_m2,
            })) => {
                put_word(&mut stats, 0, iterations);
                put_double(&mut stats, 16, residual_linf_pa_per_m2);
                put_double(&mut stats, 24, allowed_residual_linf_pa_per_m2);
                9
            }
            Err(MacStepError::TimeStepExceeded {
                advection_cfl,
                diffusion_cfl,
                combined_cfl,
            }) => {
                for (i, v) in [advection_cfl, diffusion_cfl, combined_cfl]
                    .into_iter()
                    .enumerate()
                {
                    put_double(&mut stats, 48 + i * 8, v);
                }
                10
            }
            Err(error) => panic!("unexpected invalid native fixture: {error:?}"),
        };
        out.write_all(&status.to_le_bytes()).unwrap();
        out.write_all(&stats).unwrap();
        out.write_all(&fan_flow.to_le_bytes()).unwrap();
        out.write_all(&fan_pressure.to_le_bytes()).unwrap();
        for field in next.iter().chain([&pressure]) {
            for value in field {
                out.write_all(&value.to_le_bytes()).unwrap();
            }
        }
        if status != 0 {
            break;
        }
        std::mem::swap(&mut current, &mut next);
    }
}
