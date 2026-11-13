//! Test-only file adapter: fixture initial conditions are captured from the old JS owner.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::fluid::*;
fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
}
fn double(bytes: &[u8], at: usize) -> f64 {
    f64::from_le_bytes(bytes[at..at + 8].try_into().unwrap())
}
fn main() {
    let bytes = fs::read(env::args().nth(1).unwrap()).unwrap();
    let p = &bytes[12..76];
    let src = &bytes[76..124];
    let c = FluidConfig {
        n: word(p, 0) as usize,
        iterations: word(p, 4),
        thermal: word(p, 8) == 1,
        inlet_speed: if word(p, 12) == 1 {
            Some(double(p, 56))
        } else {
            None
        },
        dt: double(p, 16),
        viscosity: double(p, 24),
        diffusion: double(p, 32),
        buoyancy: double(p, 40),
        ambient: double(p, 48),
    };
    let source = FluidSource {
        dye: if word(src, 0) == 1 {
            Some(DyeInlet {
                density: double(src, 8),
                spacing: double(src, 16),
                width: double(src, 24),
            })
        } else {
            None
        },
        density_decay: double(src, 32),
        temperature_cooling: double(src, 40),
    };
    let n = c.n * c.n;
    let mask = if word(&bytes, 8) == 1 {
        Some(&bytes[124..124 + n])
    } else {
        None
    };
    let mut fields: Vec<Vec<f32>> = (0..10)
        .map(|k| {
            bytes[124 + n + k * n * 4..124 + n + (k + 1) * n * 4]
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                .collect()
        })
        .collect();
    let [vx, vy, vx0, vy0, dens, dens0, p, div, scalar0, temp] = fields.as_mut_slice() else {
        panic!()
    };
    let mut state = FluidBuffers {
        vx,
        vy,
        vx0,
        vy0,
        dens,
        dens0,
        p,
        div,
        scalar0,
        temp,
    };
    for _ in 0..word(&bytes, 0) {
        if word(&bytes, 4) == 1 {
            advance_fluid(&c, &mut state, mask, &source).unwrap();
        } else {
            step_fluid(&c, &mut state, mask).unwrap();
        }
    }
    if let Some(helper) = env::args().nth(2) {
        let b = env::args().nth(3).unwrap().parse::<u32>().unwrap();
        match helper.as_str() {
            "set_boundary" => set_boundary(&c, b, state.dens),
            "linear_solve" => linear_solve(&c, b, state.dens, state.dens0, 0.3, 2.),
            "diffuse" => diffuse(&c, b, state.dens, state.dens0, 0.003),
            "project" => project(&c, state.vx, state.vy, state.p, state.div),
            "advect" => advect(&c, b, state.dens, state.dens0, state.vx, state.vy),
            "apply_buoyancy" => apply_buoyancy(&c, state.vy, state.temp),
            "apply_obstacle" => apply_obstacle(&c, state.vx, state.vy, state.dens, mask),
            _ => panic!("unknown helper"),
        }
        .unwrap();
    }
    let stats = read_fluid(&c, state.vx, state.vy, state.dens, state.temp, 1).unwrap();
    let mut out = io::BufWriter::new(io::stdout().lock());
    for field in fields {
        for v in field {
            out.write_all(&v.to_le_bytes()).unwrap();
        }
    }
    for v in [
        stats.peak_density,
        stats.mean_density,
        stats.max_speed,
        stats.min_temperature,
        stats.max_temperature,
        stats.max_divergence,
    ] {
        out.write_all(&v.to_le_bytes()).unwrap();
    }
}
