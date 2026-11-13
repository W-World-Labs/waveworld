//! Empirical blocked-section stability sweep for D3Q19 BGK (WindTunnel).
//! Run: cargo test -p w-sim-kernels --test lbm_blockage -- --ignored --nocapture

use w_sim_kernels::lbm::{init_d3q19, step_d3q19, D3q19Boundary, D3q19Config};

fn run_case(nx: usize, ny: usize, nz: usize, diameter: f64, u_inlet: f64, tau: f64, steps: u32) -> (f64, Option<u32>) {
    let config = D3q19Config {
        nx, ny, nz, tau, u_inlet,
        smagorinsky_cs: 0.12,
        turbulence_intensity: 0.0,
        ground_velocity: None,
        free_slip_walls: true,
        boundary: D3q19Boundary::WindTunnel,
        fan: None,
        thermal: None,
    };
    let count = nx * ny * nz;
    let mut flags = vec![0_u8; count];
    // Cylinder along z, centered in y, at x = nx/4.
    let cx = nx as f64 / 4.0;
    let cy = ny as f64 / 2.0;
    let r = diameter / 2.0;
    for z in 0..nz {
        for y in 0..ny {
            for x in 0..nx {
                let dx = x as f64 + 0.5 - cx;
                let dy = y as f64 + 0.5 - cy;
                if dx * dx + dy * dy <= r * r {
                    flags[x + nx * (y + ny * z)] = 1;
                }
            }
        }
    }
    let mut f = vec![0.0_f32; count * 19];
    let mut post = f.clone();
    let mut vel = vec![0.0_f32; count * 3];
    let mut dens = vec![0.0_f32; count];
    init_d3q19(&config, &flags, &mut f, &mut post, &mut vel, &mut dens, None).unwrap();
    let mut max_seen = 0.0_f64;
    for step in 1..=steps {
        match step_d3q19(&config, &flags, &mut f, &mut post, &mut vel, &mut dens, None, step) {
            Ok(s) => {
                if s.max_speed > max_seen {
                    max_seen = s.max_speed;
                }
            }
            Err(_) => return (max_seen, Some(step)),
        }
    }
    (max_seen, None)
}

#[test]
#[ignore]
fn sweep_blockage_at_low_tau() {
    let (nx, ny, nz) = (96usize, 32usize, 16usize);
    let (u, tau, steps) = (0.06_f64, 0.505_f64, 4000u32);
    for d in [4.0, 8.0, 12.0, 16.0, 20.0, 22.0, 24.0, 26.0, 28.0] {
        let blockage = d / ny as f64;
        let u_blocked = u / (1.0 - blockage);
        let (max_speed, fail_step) = run_case(nx, ny, nz, d, u, tau, steps);
        println!(
            "D={d:>4.1} blockage={blockage:.3} u_blocked={u_blocked:.3} max_speed={max_speed:.4} fail_step={fail_step:?}"
        );
    }
}
