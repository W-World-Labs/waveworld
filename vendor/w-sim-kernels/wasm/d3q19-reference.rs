//! Test-only native oracle for the D3Q19 BGK kernel behind `d3q19_init`,
//! `d3q19_step` and `d3q19_display`. Reads one binary case file holding the
//! 1888-byte ABI parameter blob, caller cell count, flags and optional
//! supplied state; decodes the blob exactly like the WASM entry points, then
//! writes every status word, the 19-word step stats readout, all state buffers
//! and both display strides, including partially written or sentinel bytes
//! left behind by kernel-level errors.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{
    lbm::{
        display_d3q19, init_d3q19, step_d3q19, D3q19Boundary, D3q19Config, D3q19Fan,
        ThermalBuffers, ThermalConfig, ThermalMaterial, ThermalMode, D3Q19_Q,
    },
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
fn floats(b: &[u8], at: usize, count: usize) -> Vec<f32> {
    (0..count)
        .map(|i| f32::from_le_bytes(b[at + 4 * i..at + 4 * i + 4].try_into().unwrap()))
        .collect()
}
fn doubles(b: &[u8], at: usize, count: usize) -> Vec<f64> {
    (0..count)
        .map(|i| f64::from_le_bytes(b[at + 8 * i..at + 8 * i + 8].try_into().unwrap()))
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

fn write_f32(out: &mut impl Write, field: &[f32]) {
    for &v in field {
        out.write_all(&v.to_le_bytes()).unwrap();
    }
}
fn write_f64(out: &mut impl Write, field: &[f64]) {
    for &v in field {
        out.write_all(&v.to_le_bytes()).unwrap();
    }
}

/// Decode the wire-format `D3q19Parameters` exactly like the ABI `parameters`
/// helper: version/reserved-slot rejections are 7, bad enum discriminants 6.
fn decode(b: &[u8]) -> Result<D3q19Config, u32> {
    let u = |at: usize| word(b, at);
    let d = |at: usize| double(b, at);
    let material_count = u(240);
    if u(56) != 11 || material_count > 16 {
        return Err(7);
    }
    let ground_velocity = match u(244) {
        0 if d(248).to_bits() == 0 => None,
        1 => Some(d(248)),
        _ => return Err(7),
    };
    let thermal_enabled = u(60);
    let mode = u(224);
    if (mode == 0 || thermal_enabled == 0) && material_count != 0 {
        return Err(7);
    }
    if b[256 + material_count as usize * 32..768]
        .iter()
        .any(|&v| v != 0)
    {
        return Err(7);
    }
    let mut contact_mask = [0u32; 5];
    let mut contact_resistance = [0f64; 136];
    for i in 0..5 {
        contact_mask[i] = u(768 + 4 * i);
    }
    for i in 0..136 {
        contact_resistance[i] = d(800 + 8 * i);
    }
    if [u(788), u(792), u(796)] != [0; 3]
        || contact_mask[4] & !255 != 0
        || ((mode == 0 || thermal_enabled == 0) && contact_mask != [0; 5])
        || contact_resistance.iter().enumerate().any(|(i, &r)| {
            contact_mask[i / 32] & (1 << (i % 32)) == 0 && r.to_bits() != 0
        })
    {
        return Err(7);
    }
    let thermal = match thermal_enabled {
        0 => {
            if b[128..240].iter().any(|&v| v != 0) {
                return Err(7);
            }
            None
        }
        1 => {
            let mut materials = [ThermalMaterial {
                density: 0.,
                specific_heat: 0.,
                conductivity: 0.,
                total_power_w: 0.,
            }; 16];
            for (i, m) in materials.iter_mut().enumerate() {
                *m = ThermalMaterial {
                    density: d(256 + 32 * i),
                    specific_heat: d(264 + 32 * i),
                    conductivity: d(272 + 32 * i),
                    total_power_w: d(280 + 32 * i),
                };
            }
            Some(ThermalConfig {
                gravity_per_kelvin: d(128),
                dt_seconds: d(136),
                ambient_c: d(144),
                fixed_surface_c: d(152),
                dx_meters: d(160),
                fluid_density: d(168),
                fluid_specific_heat: d(176),
                fluid_conductivity: d(184),
                solid_density: d(192),
                solid_specific_heat: d(200),
                solid_conductivity: d(208),
                total_power_w: d(216),
                mode: match mode {
                    0 => ThermalMode::FixedTemperature,
                    1 => ThermalMode::SolidPower,
                    _ => return Err(6),
                },
                max_substeps: u(228),
                temperature_scale_c: d(232),
                material_count: material_count as usize,
                materials,
                contact_resistance,
                contact_mask,
            })
        }
        _ => return Err(6),
    };
    let fan = match u(20) {
        0 => {
            if (64..128).step_by(8).any(|at| d(at).to_bits() != 0) {
                return Err(7);
            }
            None
        }
        1 => Some(D3q19Fan {
            center: [d(64), d(72), d(80)],
            normal: [d(96), d(104), d(112)],
            radius_cells: d(88),
            acceleration_lattice: d(120),
        }),
        _ => return Err(6),
    };
    let boundary = match u(12) {
        0 => D3q19Boundary::WindTunnel,
        1 => D3q19Boundary::Periodic,
        2 => D3q19Boundary::Closed,
        _ => return Err(6),
    };
    if u(16) > 1 {
        return Err(6);
    }
    Ok(D3q19Config {
        nx: u(0) as usize,
        ny: u(4) as usize,
        nz: u(8) as usize,
        tau: d(24),
        u_inlet: d(32),
        smagorinsky_cs: d(40),
        turbulence_intensity: d(48),
        ground_velocity,
        free_slip_walls: u(16) == 1,
        boundary,
        fan,
        thermal,
    })
}

/// Dimension and thermal-buffer-presence checks run before the kernel in each
/// ABI entry point; the region machinery they sit in cannot fail natively.
fn preflight(config: &D3q19Config, has_thermal: bool) -> u32 {
    match config.cell_count() {
        Err(error) => status(error),
        Ok(_) if config.thermal.is_some() != has_thermal => 2,
        Ok(_) => 0,
    }
}

fn thermal_buffers<'a>(
    has_thermal: bool,
    energy: &'a mut [f64],
    next_energy: &'a mut [f64],
    temperature: &'a mut [f64],
    mass: &'a mut [f64],
) -> Option<ThermalBuffers<'a>> {
    has_thermal.then_some(ThermalBuffers {
        energy,
        next_energy,
        temperature_delta_k: temperature,
        mass,
    })
}

fn write_step(
    out: &mut impl Write,
    result: Result<w_sim_kernels::lbm::D3q19Step, KernelError>,
) {
    match result {
        Ok(value) => {
            let mut s = [0f64; 19];
            let [fx, fy, fz] = value.obstacle_force;
            s[..5].copy_from_slice(&[fx, fy, fz, value.mass, value.max_speed]);
            if let Some(t) = value.thermal {
                s[5..12].copy_from_slice(&[
                    t.thermal_energy_j,
                    t.source_energy_j,
                    t.boundary_energy_j,
                    t.energy_residual_j,
                    t.solid_max_c,
                    t.fluid_max_c,
                    t.substeps as f64,
                ]);
            }
            let m = value.mass_balance;
            s[12..].copy_from_slice(&[
                m.bulk_mass_before,
                m.bulk_mass_after,
                m.inlet_net_mass,
                m.outlet_net_mass,
                m.collision_mass_change,
                m.inlet_replacement_mass,
                m.outlet_replacement_mass,
            ]);
            out.write_all(&0u32.to_le_bytes()).unwrap();
            write_f64(out, &s);
        }
        Err(error) => {
            out.write_all(&status(error).to_le_bytes()).unwrap();
            out.write_all(&[0xa5; 152]).unwrap();
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_steps(
    out: &mut impl Write,
    config: &D3q19Config,
    has_thermal: bool,
    flags: &[u8],
    f: &mut [f32],
    post: &mut [f32],
    velocity: &mut [f32],
    density: &mut [f32],
    energy: &mut [f64],
    next_energy: &mut [f64],
    temperature: &mut [f64],
    mass: &mut [f64],
    steps: usize,
) {
    // The ABI re-validates regions on every call, so a preflight failure
    // repeats identically for each step and never touches the stats slot.
    let pre = preflight(config, has_thermal);
    for i in 1..=steps {
        if pre != 0 {
            out.write_all(&pre.to_le_bytes()).unwrap();
            out.write_all(&[0xa5; 152]).unwrap();
            continue;
        }
        let result = step_d3q19(
            config,
            flags,
            f,
            post,
            velocity,
            density,
            thermal_buffers(has_thermal, energy, next_energy, temperature, mass),
            i as u32,
        );
        write_step(out, result);
    }
}

fn write_state(
    out: &mut impl Write,
    has_thermal: bool,
    f: &[f32],
    post: &[f32],
    velocity: &[f32],
    density: &[f32],
    energy: &[f64],
    next_energy: &[f64],
    temperature: &[f64],
    mass: &[f64],
) {
    write_f32(out, f);
    write_f32(out, post);
    write_f32(out, velocity);
    write_f32(out, density);
    if has_thermal {
        write_f64(out, energy);
        write_f64(out, next_energy);
        write_f64(out, temperature);
        write_f64(out, mass);
    }
}

fn write_display(
    out: &mut impl Write,
    config: &D3q19Config,
    velocity: &[f32],
    flags: &[u8],
    temperature: Option<&[f64]>,
    populations: Option<&[f32]>,
    n: usize,
) {
    let stride = 2 + usize::from(config.thermal.is_some()) + usize::from(populations.is_some());
    let mut display = vec![f32::from_bits(SENT32); n * stride];
    let result = display_d3q19(config, velocity, flags, temperature, populations, &mut display);
    let code = match result {
        Ok(()) => 0,
        Err(error) => status(error),
    };
    out.write_all(&code.to_le_bytes()).unwrap();
    write_f32(out, &display);
}

fn main() {
    let bytes = fs::read(env::args().nth(1).unwrap()).unwrap();
    let mut out = io::BufWriter::new(io::stdout().lock());
    // u32 op, u32 caller cell count, u32 thermal buffers present, then the
    // 1888-byte parameter blob and flags[count].
    let op = word(&bytes, 0);
    let n = word(&bytes, 4) as usize;
    let has_thermal = word(&bytes, 8) != 0;
    let blob = &bytes[12..12 + 1888];
    let mut at = 12 + 1888;
    let flags = bytes[at..at + n].to_vec();
    at += n;
    match op {
        // u32 steps: init, indexed steps, then both display frames.
        0 => {
            let steps = word(&bytes, at) as usize;
            let mut f = vec![f32::from_bits(SENT32); n * D3Q19_Q];
            let mut post = f.clone();
            let mut velocity = vec![f32::from_bits(SENT32); n * 3];
            let mut density = vec![f32::from_bits(SENT32); n];
            let mut energy = vec![f64::from_bits(SENT64); n];
            let mut next_energy = energy.clone();
            let mut temperature = energy.clone();
            let mut mass = energy.clone();
            let decoded = decode(blob);
            let init_status = match &decoded {
                Err(code) => *code,
                Ok(config) => match preflight(config, has_thermal) {
                    0 => {
                        let result = init_d3q19(
                            config,
                            &flags,
                            &mut f,
                            &mut post,
                            &mut velocity,
                            &mut density,
                            thermal_buffers(
                                has_thermal,
                                &mut energy,
                                &mut next_energy,
                                &mut temperature,
                                &mut mass,
                            ),
                        );
                        match result {
                            Ok(()) => 0,
                            Err(error) => status(error),
                        }
                    }
                    code => code,
                },
            };
            out.write_all(&init_status.to_le_bytes()).unwrap();
            if init_status == 0 {
                let config = decoded.as_ref().unwrap();
                run_steps(
                    &mut out, config, has_thermal, &flags, &mut f, &mut post, &mut velocity,
                    &mut density, &mut energy, &mut next_energy, &mut temperature, &mut mass,
                    steps,
                );
            }
            write_state(
                &mut out, has_thermal, &f, &post, &velocity, &density, &energy, &next_energy,
                &temperature, &mass,
            );
            if init_status == 0 {
                let config = decoded.as_ref().unwrap();
                let temperature = has_thermal.then_some(&*temperature);
                write_display(&mut out, config, &velocity, &flags, temperature, None, n);
                write_display(&mut out, config, &velocity, &flags, temperature, Some(&f[..]), n);
            }
        }
        // f32 velocity[3n], u32 has_populations, f32 populations[19n],
        // u32 has_temperature, f64 temperature[n], u32 display floats:
        // a single display call on fully supplied inputs.
        1 => {
            let velocity = floats(&bytes, at, 3 * n);
            at += 12 * n;
            let populations = (word(&bytes, at) != 0).then(|| floats(&bytes, at + 4, 19 * n));
            at += 4 + 76 * n * usize::from(populations.is_some());
            let temperature = (word(&bytes, at) != 0).then(|| doubles(&bytes, at + 4, n));
            at += 4 + 8 * n * usize::from(temperature.is_some());
            let display_len = word(&bytes, at) as usize;
            let mut display = vec![f32::from_bits(SENT32); display_len];
            let code = match decode(blob) {
                Err(code) => code,
                Ok(config) => match config.cell_count() {
                    Err(error) => status(error),
                    Ok(_) if config.thermal.is_some() != temperature.is_some() => 2,
                    Ok(_) => match display_d3q19(
                        &config,
                        &velocity,
                        &flags,
                        temperature.as_deref(),
                        populations.as_deref(),
                        &mut display,
                    ) {
                        Ok(()) => 0,
                        Err(error) => status(error),
                    },
                },
            };
            out.write_all(&code.to_le_bytes()).unwrap();
            write_f32(&mut out, &display);
        }
        // f32 f[19n], f32 post[19n], f32 velocity[3n], f32 density[n],
        // f64 energy/next_energy/temperature/mass[n] when thermal, u32 steps:
        // indexed steps on fully supplied state, then all buffers back.
        2 => {
            let mut f = floats(&bytes, at, 19 * n);
            at += 76 * n;
            let mut post = floats(&bytes, at, 19 * n);
            at += 76 * n;
            let mut velocity = floats(&bytes, at, 3 * n);
            at += 12 * n;
            let mut density = floats(&bytes, at, n);
            at += 4 * n;
            let mut energy = vec![f64::from_bits(SENT64); n];
            let mut next_energy = energy.clone();
            let mut temperature = energy.clone();
            let mut mass = energy.clone();
            if has_thermal {
                energy = doubles(&bytes, at, n);
                next_energy = doubles(&bytes, at + 8 * n, n);
                temperature = doubles(&bytes, at + 16 * n, n);
                mass = doubles(&bytes, at + 24 * n, n);
                at += 32 * n;
            }
            let steps = word(&bytes, at) as usize;
            match &decode(blob) {
                Err(code) => {
                    for _ in 0..steps {
                        out.write_all(&code.to_le_bytes()).unwrap();
                        out.write_all(&[0xa5; 152]).unwrap();
                    }
                }
                Ok(config) => run_steps(
                    &mut out, config, has_thermal, &flags, &mut f, &mut post, &mut velocity,
                    &mut density, &mut energy, &mut next_energy, &mut temperature, &mut mass,
                    steps,
                ),
            }
            write_state(
                &mut out, has_thermal, &f, &post, &velocity, &density, &energy, &next_energy,
                &temperature, &mass,
            );
        }
        _ => panic!("unknown reference operation"),
    }
}
