use std::{hint::black_box, time::Instant};
use w_sim_kernels::lbm::{init_d3q19, step_d3q19, D3q19Boundary, D3q19Config, D3Q19_Q};
use w_sim_kernels::{seed_heat, seed_wave, step_heat, step_wave, Seed};

fn main() {
    let n = 512;
    let steps = 128;
    let seed = Seed {
        x: (n / 2) as isize,
        y: (n / 2) as isize,
        radius: 8,
        amount: 80.0,
    };
    let mut current = vec![0.0; n * n];
    let mut next = current.clone();
    seed_heat(&mut current, n, n, seed).unwrap();
    let start = Instant::now();
    for _ in 0..steps {
        step_heat(black_box(&current), black_box(&mut next), n, n, 0.25).unwrap();
        std::mem::swap(&mut current, &mut next);
    }
    let seconds = start.elapsed().as_secs_f64();
    println!(
        "heat: {n}x{n}, {steps} steps, {:.3} ms/step, {:.2} million cell updates/s",
        seconds * 1000.0 / steps as f64,
        (n * n * steps) as f64 / seconds / 1e6
    );
    current.fill(0.0);
    next.fill(0.0);
    seed_wave(&mut current, &mut next, n, seed).unwrap();
    let start = Instant::now();
    for _ in 0..steps {
        step_wave(
            black_box(&current),
            black_box(&mut next),
            n,
            0.25,
            0.999,
            None,
        )
        .unwrap();
        std::mem::swap(&mut current, &mut next);
    }
    let seconds = start.elapsed().as_secs_f64();
    println!(
        "wave: {n}x{n}, {steps} steps, {:.3} ms/step, {:.2} million interior cell updates/s",
        seconds * 1000.0 / steps as f64,
        ((n - 2) * (n - 2) * steps) as f64 / seconds / 1e6
    );
    black_box(current);

    let config = D3q19Config {
        nx: 32,
        ny: 16,
        nz: 16,
        tau: 0.8,
        u_inlet: 0.04,
        smagorinsky_cs: 0.12,
        turbulence_intensity: 0.01,
        ground_velocity: None,
        free_slip_walls: false,
        boundary: D3q19Boundary::WindTunnel,
        thermal: None,
        fan: None,
    };
    let count = config.cell_count().unwrap();
    let mut f = vec![0.0; count * D3Q19_Q];
    let mut post = f.clone();
    let mut velocity = vec![0.0; count * 3];
    let mut density = vec![0.0; count];
    let mut flags = vec![0; count];
    flags[8 + config.nx * (8 + config.ny * 8)] = 1;
    init_d3q19(
        &config,
        &flags,
        &mut f,
        &mut post,
        &mut velocity,
        &mut density,
        None,
    )
    .unwrap();
    let steps = 32;
    let start = Instant::now();
    for step in 1..=steps {
        black_box(
            step_d3q19(
                &config,
                &flags,
                &mut f,
                &mut post,
                &mut velocity,
                &mut density,
                None,
                step,
            )
            .unwrap(),
        );
    }
    let seconds = start.elapsed().as_secs_f64();
    println!(
        "D3Q19 BGK/LES: 32x16x16, {steps} steps, {:.3} ms/step, {:.2} million fluid cell updates/s",
        seconds * 1000.0 / steps as f64,
        ((count - 1) * steps as usize) as f64 / seconds / 1e6
    );
}
