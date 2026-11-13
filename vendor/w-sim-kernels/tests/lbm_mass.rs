use w_sim_kernels::lbm::{
    init_d3q19, step_d3q19, D3q19Boundary, D3q19Config, D3q19Fan, D3Q19_C,
    D3Q19_MASS_BALANCE_VERSION,
};

fn config() -> D3q19Config {
    D3q19Config {
        nx: 7,
        ny: 5,
        nz: 5,
        tau: 0.8,
        u_inlet: 0.04,
        smagorinsky_cs: 0.,
        turbulence_intensity: 0.,
        free_slip_walls: true,
        ground_velocity: None,
        boundary: D3q19Boundary::WindTunnel,
        fan: None,
        thermal: None,
    }
}
fn mass(c: &D3q19Config, flags: &[u8], f: &[f32], lo: usize, hi: usize) -> f64 {
    flags
        .iter()
        .enumerate()
        .filter(|&(cell, flag)| *flag == 0 && (lo..=hi).contains(&(cell % c.nx)))
        .flat_map(|(cell, _)| f[cell * 19..(cell + 1) * 19].iter())
        .map(|&v| v as f64)
        .sum()
}
fn close(a: f64, b: f64, tolerance: f64) {
    assert!((a - b).abs() <= tolerance, "{a} != {b}");
}

/// Independent FORWARD population accounting. Production uses pull links. This
/// oracle records where each immutable post population goes; no mass difference
/// is used to define the interface transport. It does not call stream_destination.
fn transport(c: &D3q19Config, flags: &[u8], post: &[f32]) -> [f64; 4] {
    let mut result = [0.; 4];
    for source in 0..flags.len() {
        if flags[source] != 0 {
            continue;
        }
        let p = [source % c.nx, source / c.nx % c.ny, source / (c.nx * c.ny)];
        for (q, d) in D3Q19_C.iter().enumerate() {
            let mut dest = p.map(|v| v as isize);
            for axis in 0..3 {
                dest[axis] += d[axis] as isize;
            }
            let ground = c.ground_velocity.is_some() && dest[1] < 0;
            if c.boundary == D3q19Boundary::Periodic {
                for (axis, n) in [c.nx, c.ny, c.nz].into_iter().enumerate() {
                    dest[axis] = dest[axis].rem_euclid(n as isize);
                }
            } else if c.boundary == D3q19Boundary::WindTunnel && c.free_slip_walls {
                for (axis, n) in [(1, c.ny), (2, c.nz)] {
                    if dest[axis] < 0 || dest[axis] >= n as isize {
                        dest[axis] = p[axis] as isize;
                    }
                }
            }
            let inside = !ground
                && [c.nx, c.ny, c.nz]
                    .iter()
                    .enumerate()
                    .all(|(a, &n)| dest[a] >= 0 && dest[a] < n as isize);
            let candidate = if inside {
                dest[0] as usize + c.nx * (dest[1] as usize + c.ny * dest[2] as usize)
            } else {
                source
            };
            let target = if flags[candidate] == 0 {
                candidate
            } else {
                source
            };
            let x = target % c.nx;
            let sx = p[0];
            let value = post[source * 19 + q] as f64;
            if sx == 0 && x > 0 && x + 1 < c.nx {
                result[0] += value;
            }
            if x == 0 && sx > 0 && sx + 1 < c.nx {
                result[0] -= value;
            }
            if x + 1 == c.nx && sx > 0 && sx + 1 < c.nx {
                result[1] += value;
            }
            if sx + 1 == c.nx && x > 0 && x + 1 < c.nx {
                result[1] -= value;
            }
            if x == 0 {
                result[2] += value;
            }
            if x + 1 == c.nx {
                result[3] += value;
            }
        }
    }
    result
}

#[test]
fn budget_measures_actual_forward_links_and_population_roundoff() {
    assert_eq!(D3Q19_MASS_BALANCE_VERSION, 1);
    for case in 0..8 {
        let mut c = config();
        c.free_slip_walls = case != 1;
        if case == 2 {
            c.ground_velocity = Some(0.04);
        }
        if case == 3 {
            c.boundary = D3q19Boundary::Periodic;
            c.free_slip_walls = false;
        }
        if case == 4 {
            c.boundary = D3q19Boundary::Closed;
            c.free_slip_walls = false;
        }
        if case == 5 {
            c.fan = Some(D3q19Fan {
                center: [3.5, 2.5, 2.5],
                normal: [0., 1., 0.],
                radius_cells: 0.5,
                acceleration_lattice: 0.002,
            });
        }
        let n = c.cell_count().unwrap();
        let mut flags = vec![0; n];
        if case == 6 {
            flags[3 + 7 * (2 + 5 * 2)] = 1;
        }
        if case == 7 {
            for x in [0, 1, 5, 6] {
                flags[x + 7 * (2 + 5 * 2)] = 1;
            }
        }
        let mut f = vec![0.; n * 19];
        let mut post = f.clone();
        let mut u = vec![0.; n * 3];
        let mut rho = vec![0.; n];
        init_d3q19(&c, &flags, &mut f, &mut post, &mut u, &mut rho, None).unwrap();
        for step in 1..=3 {
            let before = f.clone();
            let initial = mass(&c, &flags, &f, 1, 5);
            let result =
                step_d3q19(&c, &flags, &mut f, &mut post, &mut u, &mut rho, None, step).unwrap();
            let m = result.mass_balance;
            let expected = transport(&c, &flags, &post);
            close(m.bulk_mass_before, initial, 1e-12);
            close(m.bulk_mass_after, mass(&c, &flags, &f, 1, 5), 1e-12);
            close(result.mass, mass(&c, &flags, &f, 0, 6), 1e-12);
            let collision = mass(&c, &flags, &post, 1, 5) - mass(&c, &flags, &before, 1, 5);
            close(m.collision_mass_change, collision, 1e-12);
            close(m.inlet_net_mass, expected[0], 1e-12);
            close(m.outlet_net_mass, expected[1], 1e-12);
            let residual = m.bulk_mass_after - m.bulk_mass_before - m.inlet_net_mass
                + m.outlet_net_mass
                - m.collision_mass_change;
            // Moving-wall population corrections are written in f32; paired
            // corrections cancel before rounding. Their actual remainder is R.
            close(residual, 0., if case == 2 { 2e-7 } else { 1e-12 });
            if c.boundary == D3q19Boundary::WindTunnel && case != 2 {
                close(
                    m.inlet_replacement_mass,
                    mass(&c, &flags, &f, 0, 0) - expected[2],
                    1e-12,
                );
                close(
                    m.outlet_replacement_mass,
                    mass(&c, &flags, &f, 6, 6) - expected[3],
                    1e-12,
                );
            } else if c.boundary != D3q19Boundary::WindTunnel {
                assert_eq!(m.inlet_replacement_mass, 0.);
                assert_eq!(m.outlet_replacement_mass, 0.);
            }
            if case == 1 && step == 1 {
                // 105 passing links instead of the free-slip 125; area*u=1 is wrong.
                close(m.inlet_net_mass, 13. / 15., 2e-7);
            }
        }
    }
}

#[test]
fn numerical_boundary_replacement_is_distinct_from_internal_flux() {
    let mut c = config();
    c.u_inlet = 0.;
    let n = 175;
    let flags = vec![0; n];
    let mut f = vec![0.; n * 19];
    let mut post = f.clone();
    let mut u = vec![0.; n * 3];
    let mut rho = vec![0.; n];
    init_d3q19(&c, &flags, &mut f, &mut post, &mut u, &mut rho, None).unwrap();
    for cell in 0..n {
        if cell % 7 == 2 {
            for q in 0..19 {
                f[cell * 19 + q] = (w_sim_kernels::lbm::D3Q19_W[q] * 1.03) as f32;
            }
        }
    }
    let total_before = mass(&c, &flags, &f, 0, 6);
    let result = step_d3q19(&c, &flags, &mut f, &mut post, &mut u, &mut rho, None, 1).unwrap();
    let m = result.mass_balance;
    close(m.inlet_net_mass, 0., 1e-12);
    close(m.outlet_net_mass, 0., 1e-12);
    close(m.inlet_replacement_mass, 0.125, 1e-6);
    close(m.outlet_replacement_mass, 0., 1e-12);
    close(
        m.bulk_mass_after - m.bulk_mass_before,
        m.collision_mass_change,
        1e-12,
    );
    close(result.mass - total_before, 0.125, 1e-6);
}
