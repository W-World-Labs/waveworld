use w_sim_kernels::lbm::{
    init_d3q19, step_d3q19, D3q19Boundary, D3q19Config, D3q19Step, D3Q19_C, D3Q19_OPPOSITE,
    D3Q19_Q, D3Q19_W,
};
use w_sim_kernels::KernelError;

fn config(boundary: D3q19Boundary) -> D3q19Config {
    D3q19Config {
        nx: 5,
        ny: 4,
        nz: 3,
        tau: 0.8,
        u_inlet: 0.04,
        smagorinsky_cs: 0.0,
        turbulence_intensity: 0.0,
        ground_velocity: None,
        free_slip_walls: false,
        boundary,
        thermal: None,
        fan: None,
    }
}

struct Fields {
    f: Vec<f32>,
    post: Vec<f32>,
    velocity: Vec<f32>,
    density: Vec<f32>,
    flags: Vec<u8>,
}

impl Fields {
    fn new(config: &D3q19Config, solid: Option<usize>) -> Self {
        let count = config.cell_count().unwrap();
        let mut fields = Self {
            f: vec![0.0; count * D3Q19_Q],
            post: vec![0.0; count * D3Q19_Q],
            velocity: vec![0.0; count * 3],
            density: vec![0.0; count],
            flags: vec![0; count],
        };
        if let Some(cell) = solid {
            fields.flags[cell] = 1;
        }
        init_d3q19(
            config,
            &fields.flags,
            &mut fields.f,
            &mut fields.post,
            &mut fields.velocity,
            &mut fields.density,
            None,
        )
        .unwrap();
        fields
    }

    fn step(&mut self, config: &D3q19Config, index: u32) -> Result<D3q19Step, KernelError> {
        step_d3q19(
            config,
            &self.flags,
            &mut self.f,
            &mut self.post,
            &mut self.velocity,
            &mut self.density,
            None,
            index,
        )
    }

    fn mass_and_momentum(&self) -> (f64, [f64; 3]) {
        let mut mass = 0.0;
        let mut momentum = [0.0; 3];
        for (cell, &flag) in self.flags.iter().enumerate() {
            if flag != 0 {
                continue;
            }
            for (q, direction) in D3Q19_C.iter().enumerate() {
                let value = self.f[cell * D3Q19_Q + q] as f64;
                mass += value;
                for axis in 0..3 {
                    momentum[axis] += value * direction[axis] as f64;
                }
            }
        }
        (mass, momentum)
    }
}

#[test]
fn product_lattice_has_correct_opposites_and_isotropic_second_moments() {
    assert!((D3Q19_W.iter().sum::<f64>() - 1.0).abs() < 1e-15);
    for (q, c) in D3Q19_C.iter().enumerate() {
        assert_eq!(D3Q19_C[D3Q19_OPPOSITE[q]], c.map(|value| -value));
    }
    for a in 0..3 {
        for b in 0..3 {
            let moment: f64 = D3Q19_C
                .iter()
                .zip(D3Q19_W)
                .map(|(c, w)| w * c[a] as f64 * c[b] as f64)
                .sum();
            assert!((moment - if a == b { 1.0 / 3.0 } else { 0.0 }).abs() < 1e-15);
        }
    }
}

#[test]
fn periodic_nonuniform_flow_conserves_mass_and_momentum() {
    let config = config(D3q19Boundary::Periodic);
    let mut fields = Fields::new(&config, None);
    // Local density / momentum perturbations force real collide-stream motion;
    // a uniform equilibrium alone would not exercise transport.
    fields.f[7 * D3Q19_Q] += 0.003;
    fields.f[18 * D3Q19_Q + 1] += 0.002;
    fields.f[18 * D3Q19_Q + 2] -= 0.002;
    let before = fields.mass_and_momentum();
    for step in 1..=6 {
        let result = fields.step(&config, step).unwrap();
        assert_eq!(result.obstacle_force, [0.0; 3]);
        assert!(result.max_speed > 0.0 && result.max_speed < 0.06);
    }
    let after = fields.mass_and_momentum();
    assert!((after.0 - before.0).abs() < before.0 * 3e-7);
    for axis in 0..3 {
        assert!((after.1[axis] - before.1[axis]).abs() < 3e-6);
    }
    assert!(fields.f.iter().all(|value| value.is_finite()));
}

#[test]
fn solid_force_matches_fluid_momentum_loss_and_preserves_mass() {
    let config = config(D3q19Boundary::Periodic);
    let solid = 2 + config.nx * (2 + config.ny);
    let mut fields = Fields::new(&config, Some(solid));
    let before = fields.mass_and_momentum();
    let result = fields.step(&config, 1).unwrap();
    let after = fields.mass_and_momentum();
    assert!(result.obstacle_force[0] > 0.0);
    assert!((after.0 - before.0).abs() < before.0 * 3e-7);
    for axis in 0..3 {
        assert!((after.1[axis] - before.1[axis] + result.obstacle_force[axis]).abs() < 3e-6);
    }
    assert_eq!(&fields.velocity[solid * 3..solid * 3 + 3], &[0.0; 3]);
    assert_eq!(fields.density[solid], 1.0);
}

#[test]
fn closed_box_conserves_mass_and_excludes_domain_wall_forces() {
    let config = config(D3q19Boundary::Closed);
    let mut fields = Fields::new(&config, None);
    let before = fields.mass_and_momentum();
    let result = fields.step(&config, 1).unwrap();
    let after = fields.mass_and_momentum();
    assert!((after.0 - before.0).abs() < before.0 * 3e-7);
    assert!(after.1[0] < before.1[0]);
    assert_eq!(result.obstacle_force, [0.0; 3]);
}

#[test]
fn wind_inlet_outlet_and_slip_wall_fields_are_current() {
    let mut config = config(D3q19Boundary::WindTunnel);
    config.free_slip_walls = true;
    let mut fields = Fields::new(&config, None);
    for step in 1..=3 {
        fields.step(&config, step).unwrap();
    }
    for (cell, velocity) in fields.velocity.chunks_exact(3).enumerate() {
        assert!(
            (velocity[0] as f64 - config.u_inlet).abs() < 3e-8,
            "cell={cell}, u={velocity:?}, rho={}",
            fields.density[cell]
        );
        assert!(velocity[1].abs() < 1e-8 && velocity[2].abs() < 1e-8);
        if cell % config.nx == config.nx - 1 {
            assert!((fields.density[cell] as f64 - 1.0).abs() < 1e-7);
        }
    }
    config.free_slip_walls = false;
    let mut no_slip = Fields::new(&config, None);
    no_slip.step(&config, 1).unwrap();
    // x=2,y=0,z=1 is a side wall, away from inlet/outlet corners.
    let wall = 2 + config.nx * config.ny;
    assert!((no_slip.velocity[wall * 3] as f64 - 2.0 * config.u_inlet / 3.0).abs() < 1e-7);
}

#[test]
fn les_and_inlet_noise_are_reproducible_and_obstacle_flow_stays_finite() {
    let mut config = config(D3q19Boundary::WindTunnel);
    config.smagorinsky_cs = 0.12;
    config.turbulence_intensity = 0.01;
    let solid = 2 + config.nx * (2 + config.ny);
    let mut first = Fields::new(&config, Some(solid));
    let mut second = Fields::new(&config, Some(solid));
    for step in 1..=6 {
        let result = first.step(&config, step).unwrap();
        second.step(&config, step).unwrap();
        assert!(result.obstacle_force.iter().all(|value| value.is_finite()));
        assert!(result.max_speed < 0.2);
    }
    assert_eq!(first.f, second.f);
    assert!(first.velocity[1].abs() > 0.0); // inlet transverse noise is applied
    assert!(first
        .density
        .iter()
        .all(|value| value.is_finite() && *value > 0.0));
}

#[test]
fn rejects_unsupported_physics_and_invalid_or_unstable_state() {
    let mut config = config(D3q19Boundary::WindTunnel);
    let mut fields = Fields::new(&config, None);
    fields.flags[2] = 2;
    assert_eq!(
        fields.step(&config, 1).unwrap_err(),
        KernelError::UnsupportedFeature
    );
    fields.flags[2] = 3;
    assert_eq!(
        fields.step(&config, 1).unwrap_err(),
        KernelError::UnsupportedFeature
    );
    fields.flags[2] = 0;
    fields.f[0] = f32::NAN;
    assert_eq!(
        fields.step(&config, 1).unwrap_err(),
        KernelError::NonFiniteValue
    );
    fields.f[..D3Q19_Q].fill(0.0);
    assert_eq!(
        fields.step(&config, 1).unwrap_err(),
        KernelError::InvalidState
    );
    fields.f[1] = 1.0; // density positive but speed 1 exceeds low-Mach bound
    assert_eq!(
        fields.step(&config, 1).unwrap_err(),
        KernelError::InvalidState
    );
    config.tau = 0.5;
    assert_eq!(
        fields.step(&config, 1).unwrap_err(),
        KernelError::InvalidCoefficient
    );
    config.tau = f64::INFINITY;
    assert_eq!(
        fields.step(&config, 1).unwrap_err(),
        KernelError::InvalidCoefficient
    );
    config.tau = 0.8;
    config.boundary = D3q19Boundary::Periodic;
    config.free_slip_walls = true;
    assert_eq!(
        fields.step(&config, 1).unwrap_err(),
        KernelError::UnsupportedFeature
    );
    config.free_slip_walls = false;
    config.nx = usize::MAX;
    assert_eq!(
        config.cell_count().unwrap_err(),
        KernelError::InvalidDimensions
    );
}

#[test]
fn slip_reflection_keeps_tangential_travel_at_faces_and_corners() {
    let mut c = config(D3q19Boundary::WindTunnel);
    c.nx = 7;
    c.ny = 5;
    c.nz = 5;
    c.free_slip_walls = true;
    for (target, donor, incoming, departure) in [
        ([3, 0, 2], [2, 0, 2], [1, 1, 0], [1, -1, 0]),
        ([3, 4, 2], [2, 4, 2], [1, -1, 0], [1, 1, 0]),
        ([3, 2, 0], [2, 2, 0], [1, 0, 1], [1, 0, -1]),
        ([3, 2, 4], [2, 2, 4], [1, 0, -1], [1, 0, 1]),
        ([3, 0, 0], [3, 0, 1], [0, 1, -1], [0, -1, -1]),
        ([3, 0, 0], [3, 0, 0], [0, 1, 1], [0, -1, -1]),
        ([3, 4, 4], [3, 4, 3], [0, -1, 1], [0, 1, 1]),
    ] {
        let index = |p: [usize; 3]| p[0] + c.nx * (p[1] + c.ny * p[2]);
        let (i, j) = (index(target), index(donor));
        let q = D3Q19_C.iter().position(|&v| v == incoming).unwrap();
        let r = D3Q19_C.iter().position(|&v| v == departure).unwrap();
        let mut fields = Fields::new(&c, None);
        fields.f[j * D3Q19_Q] += 0.003;
        fields.step(&c, 1).unwrap();
        assert_eq!(
            fields.f[i * D3Q19_Q + q],
            fields.post[j * D3Q19_Q + r],
            "target={target:?}, donor={donor:?}, incoming={incoming:?}"
        );
        if i != j {
            assert_ne!(fields.f[i * D3Q19_Q + q], fields.post[i * D3Q19_Q + r]);
        }
    }
}

#[test]
fn slip_transport_preserves_mass_and_tangential_momentum_including_blocked_reflected_links() {
    let mut c = config(D3q19Boundary::WindTunnel);
    // Keep the one-step perturbation away from both NEE donor layers.
    c.nx = 9;
    c.ny = 5;
    c.nz = 5;
    c.free_slip_walls = true;
    for solid in [None, Some(3 + c.nx * c.ny * 2)] {
        let mut fields = Fields::new(&c, solid);
        let target = 4 + c.nx * c.ny * 2;
        fields.f[target * D3Q19_Q + 9] += 0.001;
        fields.f[target * D3Q19_Q + 10] -= 0.001;
        let before = fields.mass_and_momentum();
        let result = fields.step(&c, 1).unwrap();
        let after = fields.mass_and_momentum();
        assert!((after.0 - before.0).abs() < 2e-6);
        // Side walls exert no x impulse; x reservoirs are outside this one-step perturbation.
        assert!((after.1[0] - before.1[0] + result.obstacle_force[0]).abs() < 2e-6);
        if solid.is_some() {
            // The mirrored donor of incoming (1,1,0) is solid. The entire blocked
            // link uses obstacle bounce-back and is included in obstacle impulse.
            assert_eq!(
                fields.f[target * D3Q19_Q + 7],
                fields.post[target * D3Q19_Q + 8]
            );
            assert!(result.obstacle_force[0] > 0.);
        } else {
            assert_eq!(result.obstacle_force, [0.; 3]);
        }
    }
}

#[test]
fn moving_ground_has_analytic_impulse_without_wall_mass_or_obstacle_force() {
    let mut c = config(D3q19Boundary::WindTunnel);
    c.nx = 7;
    c.ny = 5;
    c.nz = 5;
    c.free_slip_walls = true;
    c.u_inlet = 0.;
    c.ground_velocity = Some(0.03);
    let mut fields = Fields::new(&c, None);
    let target = 3 + c.nx * c.ny * 2;
    let mass_before = fields.mass_and_momentum().0;
    let stats = fields.step(&c, 1).unwrap();
    let rho: f64 = fields.post[target * 19..(target + 1) * 19]
        .iter()
        .map(|&v| v as f64)
        .sum();
    let mut delta_mass = 0.;
    let mut delta_jx = 0.;
    for (q, direction) in D3Q19_C.iter().enumerate() {
        if direction[1] > 0 {
            let reflected = fields.post[target * 19 + D3Q19_OPPOSITE[q]] as f64;
            let delta = fields.f[target * 19 + q] as f64 - reflected;
            let expected = rho * 0.03 / 6. * direction[0] as f64;
            assert!(
                (delta - expected).abs() < 2e-9,
                "q={q}, delta={delta}, expected={expected}"
            );
            delta_mass += delta;
            delta_jx += delta * direction[0] as f64;
        }
    }
    assert!(delta_mass.abs() < 2e-9);
    assert!((delta_jx - rho * 0.03 / 3.).abs() < 4e-9);
    assert!((fields.velocity[target * 3] as f64 - 0.01).abs() < 1e-8);
    // Paired moving-wall corrections have zero mass; the NEE inlet copies
    // this unchanged inner density while prescribing zero boundary velocity.
    assert!((fields.mass_and_momentum().0 - mass_before).abs() < 2e-6);
    for i in 0..c.cell_count().unwrap() {
        if i % c.nx != 0 {
            let after: f64 = fields.f[i * 19..(i + 1) * 19]
                .iter()
                .map(|&v| v as f64)
                .sum();
            let before: f64 = fields.post[i * 19..(i + 1) * 19]
                .iter()
                .map(|&v| v as f64)
                .sum();
            assert!((after - before).abs() < 5e-8);
        }
    }
    assert_eq!(stats.obstacle_force, [0.; 3]);
}

#[test]
fn stationary_ground_is_not_disabled_and_comoving_ground_preserves_uniform_flow() {
    let mut c = config(D3q19Boundary::WindTunnel);
    c.free_slip_walls = true;
    for ground in [None, Some(c.u_inlet), Some(0.)] {
        c.ground_velocity = ground;
        let mut fields = Fields::new(&c, None);
        fields.step(&c, 1).unwrap();
        let target = 2 + c.nx * c.ny;
        let expected = if ground == Some(0.) {
            2. * c.u_inlet / 3.
        } else {
            c.u_inlet
        };
        assert!((fields.velocity[target * 3] as f64 - expected).abs() < 1e-7);
        if ground != Some(0.) {
            for step in 2..=5 {
                fields.step(&c, step).unwrap();
            }
            for u in fields.velocity.chunks_exact(3) {
                assert!((u[0] as f64 - c.u_inlet).abs() < 1e-7);
                assert!(u[1].abs() < 1e-7 && u[2].abs() < 1e-7);
            }
        }
    }
    c.free_slip_walls = false;
    c.ground_velocity = None;
    let mut old = Fields::new(&c, None);
    let mut stationary = Fields::new(&c, None);
    old.f[27 * 19] += 0.003;
    stationary.f.copy_from_slice(&old.f);
    for step in 1..=3 {
        old.step(&c, step).unwrap();
        let mut grounded = c;
        grounded.ground_velocity = Some(0.);
        stationary.step(&grounded, step).unwrap();
        assert_eq!(old.f, stationary.f);
        assert_eq!(old.velocity, stationary.velocity);
    }
}

#[test]
fn ground_takes_precedence_only_for_rays_crossing_the_bottom_wall() {
    let mut c = config(D3q19Boundary::WindTunnel);
    c.nx = 7;
    c.ny = 5;
    c.nz = 5;
    c.free_slip_walls = true;
    c.ground_velocity = Some(0.);
    let mut fields = Fields::new(&c, None);
    // Nonuniform populations distinguish same-cell BB from tangential mirrors.
    for (i, populations) in fields.f.chunks_exact_mut(19).enumerate() {
        populations[0] += i as f32 * 0.00001;
    }
    fields.step(&c, 1).unwrap();
    for (target, donor, q, r) in [
        ([3, 0, 0], [3, 0, 0], 7, 8),   // Crosses ground, no x tangential shift.
        ([3, 0, 0], [3, 0, 0], 15, 16), // Crosses ground and z: full BB.
        ([3, 0, 0], [3, 0, 0], 17, 18), // Crosses only ground: full BB.
        ([3, 0, 0], [2, 0, 0], 11, 13), // Crosses only z: keep x shift.
        ([3, 0, 0], [3, 1, 0], 18, 16), // Crosses only z: keep y shift.
    ] {
        let i = target[0] + c.nx * (target[1] + c.ny * target[2]);
        let j = donor[0] + c.nx * (donor[1] + c.ny * donor[2]);
        assert_eq!(
            fields.f[i * 19 + q],
            fields.post[j * 19 + r],
            "target={target:?}, donor={donor:?}, q={q}"
        );
    }
    // Existing whole-node x inlet/outlet reset retains priority at their ground edges.
    for z in 0..c.nz {
        let inlet = c.nx * c.ny * z;
        assert!((fields.velocity[inlet * 3] as f64 - c.u_inlet).abs() < 1e-7);
    }
}

#[test]
fn ground_rejects_non_wind_modes_and_unrepresentable_speeds() {
    let mut c = config(D3q19Boundary::WindTunnel);
    let mut fields = Fields::new(&c, None);
    for speed in [-0.01, 0.2, 0.199999999, f64::INFINITY, f64::NAN] {
        c.ground_velocity = Some(speed);
        assert_eq!(
            fields.step(&c, 1).unwrap_err(),
            KernelError::InvalidCoefficient
        );
    }
    c.ground_velocity = Some(0.);
    for boundary in [D3q19Boundary::Closed, D3q19Boundary::Periodic] {
        c.boundary = boundary;
        assert_eq!(
            fields.step(&c, 1).unwrap_err(),
            KernelError::UnsupportedFeature
        );
    }
}

// These are tiny physical checks (175 cells, at most two steps), not a CFD convergence suite.
#[test]
fn gauge_force_is_zero_at_rest_for_closed_and_ground_contact_surfaces() {
    for body_y in [0, 2] {
        let mut c = config(D3q19Boundary::WindTunnel);
        (c.nx, c.ny, c.nz) = (7, 5, 5);
        c.u_inlet = 0.;
        c.free_slip_walls = true;
        c.ground_velocity = Some(0.);
        let mut fields = Fields::new(&c, None);
        for x in 2..=4 {
            for y in body_y..=body_y + 1 {
                fields.flags[x + c.nx * (y + c.ny * 2)] = 1;
            }
        }
        for step in 1..=2 {
            let stats = fields.step(&c, step).unwrap();
            assert_eq!(stats.obstacle_force, [0.; 3], "body_y={body_y}");
            assert_eq!(stats.max_speed, 0.);
        }
    }
}

#[test]
fn gauge_force_retains_uniform_pressure_offsets_and_a_nonuniform_pressure_difference() {
    for (mode, expected) in [(0, [0., -1. / 96., 0.]), (1, [0., 1. / 96., 0.]), (2, [5. / 288., 0., 0.])] {
        let mut c = config(D3q19Boundary::WindTunnel);
        (c.nx, c.ny, c.nz) = (7, 5, 5);
        c.u_inlet = 0.;
        c.free_slip_walls = true;
        c.ground_velocity = Some(0.);
        let mut fields = Fields::new(&c, Some(3 + c.nx * c.ny * 2));
        for cell in 0..c.cell_count().unwrap() {
            let rho = match mode {
                0 => 1. + 1. / 32.,
                1 => 1. - 1. / 32.,
                _ => if cell % c.nx < 3 { 1. + 1. / 32. } else if cell % c.nx > 3 { 1. - 1. / 32. } else { 1. },
            };
            for (q, &w) in D3Q19_W.iter().enumerate() {
                fields.f[cell * D3Q19_Q + q] = (w * rho) as f32;
            }
        }
        let stats = fields.step(&c, 1).unwrap();
        for axis in 0..3 {
            assert!((stats.obstacle_force[axis] - expected[axis]).abs() < 2e-7,
                "mode={mode}, force={:?}, expected={expected:?}", stats.obstacle_force);
        }
    }
}

#[test]
fn gauge_force_plus_reference_load_accounts_for_raw_fluid_momentum_loss() {
    for body_y in [0, 2] {
        let mut c = config(D3q19Boundary::Closed);
        (c.nx, c.ny, c.nz) = (7, 5, 5);
        let mut fields = Fields::new(&c, None);
        for x in 2..=4 {
            for y in body_y..=body_y + 1 {
                fields.flags[x + c.nx * (y + c.ny * 2)] = 1;
            }
        }
        let before = fields.mass_and_momentum();
        let stats = fields.step(&c, 1).unwrap();
        let after = fields.mass_and_momentum();
        let (mut raw, mut reference, mut walls) = ([0.; 3], [0.; 3], [0.; 3]);
        // Independent forward links on a closed box: all exterior departures
        // hit domain walls, all in-domain flagged destinations hit the model.
        for cell in 0..c.cell_count().unwrap() {
            if fields.flags[cell] != 0 { continue; }
            let xyz = [cell % c.nx, cell / c.nx % c.ny, cell / (c.nx * c.ny)];
            for (q, direction) in D3Q19_C.iter().enumerate() {
                let dst = core::array::from_fn::<_, 3, _>(|a| xyz[a] as isize + direction[a] as isize);
                let outside = (0..3).any(|a| dst[a] < 0 || dst[a] >= [c.nx, c.ny, c.nz][a] as isize);
                let solid = !outside && fields.flags[dst[0] as usize + c.nx * (dst[1] as usize + c.ny * dst[2] as usize)] != 0;
                for axis in 0..3 {
                    let impulse = 2. * fields.post[cell * D3Q19_Q + q] as f64 * direction[axis] as f64;
                    if outside { walls[axis] += impulse; }
                    if solid {
                        raw[axis] += impulse;
                        reference[axis] += 2. * D3Q19_W[q] as f32 as f64 * direction[axis] as f64;
                    }
                }
            }
        }
        let reference_y = if body_y == 0 { -3. * (2. * (1_f64 / 18.) as f32 as f64 + 8. * (1_f64 / 36.) as f32 as f64) } else { 0. };
        assert!((reference[1] - reference_y).abs() < 1e-14);
        for axis in 0..3 {
            assert!((stats.obstacle_force[axis] + reference[axis] - raw[axis]).abs() < 1e-14);
            assert!((after.1[axis] - before.1[axis] + stats.obstacle_force[axis] + reference[axis] + walls[axis]).abs() < 3e-6);
        }
        assert!((after.0 - before.0).abs() < 3e-6);
    }
}


#[test]
fn pressure_outlet_retains_shear_and_uses_current_streamed_moments() {
    assert_eq!(w_sim_kernels::lbm::D3Q19_NEE_OUTLET_VERSION, 1);
    let mut c = config(D3q19Boundary::WindTunnel);
    (c.nx, c.ny, c.nz) = (7, 5, 5);
    c.free_slip_walls = true;
    for shear in [true, false] {
        let mut fields = Fields::new(&c, None);
        for cell in 0..175 {
            let x = cell % 7;
            let y = cell / 7 % 5;
            let rho = if !shear && x == 4 { 1.03 } else { 1. };
            let ux = c.u_inlet + if shear { 0.003 * (y as f64 - 2.) } else { 0. };
            for (q, direction) in D3Q19_C.iter().enumerate() {
                let cu = direction[0] as f64 * ux;
                fields.f[cell * 19 + q] = (D3Q19_W[q] * rho
                    * (1. + 3. * cu + 4.5 * cu * cu - 1.5 * ux * ux)) as f32;
            }
        }
        fields.step(&c, 1).unwrap();
        let inner = 5 + 7 * (2 + 5 * 2);
        let outlet = inner + 1;
        let extra_mass = 0.03 * (1. + 3. * c.u_inlet + 3. * c.u_inlet.powi(2)) / 6.;
        let expected_u = if shear { c.u_inlet } else { (c.u_inlet + extra_mass) / (1. + extra_mass) };
        for cell in [inner, outlet] {
            assert!((fields.velocity[cell * 3] as f64 - expected_u).abs() < 3e-8);
            let pxy: f64 = D3Q19_C.iter().enumerate().map(|(q, d)|
                d[0] as f64 * d[1] as f64 * fields.f[cell * 19 + q] as f64).sum();
            let non_equilibrium = pxy - fields.density[cell] as f64
                * fields.velocity[cell * 3] as f64 * fields.velocity[cell * 3 + 1] as f64;
            // Independent streamed linear-shear moment: Pi_xy = -rho*(du_x/dy)/3.
            assert!((non_equilibrium - if shear { -0.001 } else { 0. }).abs() < 1e-8);
        }
        assert!((fields.density[outlet] as f64 - 1.).abs() < 1e-7);
        assert!((fields.density[inner] as f64 - if shear { 1. } else { 1. + extra_mass }).abs() < 1e-7);
    }
}

#[test]
fn pressure_outlet_rejects_a_solid_inner_neighbor_before_updating_fields() {
    let mut c = config(D3q19Boundary::WindTunnel);
    let mut fields = Fields::new(&c, None);
    fields.flags[c.nx - 2] = 1;
    let before = fields.f.clone();
    assert_eq!(fields.step(&c, 1).unwrap_err(), KernelError::InvalidState);
    assert_eq!(fields.f, before);
    assert_eq!(init_d3q19(&c, &fields.flags, &mut fields.f, &mut fields.post,
        &mut fields.velocity, &mut fields.density, None), Err(KernelError::InvalidState));
    assert_eq!(fields.f, before);
    for boundary in [D3q19Boundary::Closed, D3q19Boundary::Periodic] {
        c.boundary = boundary;
        init_d3q19(&c, &fields.flags, &mut fields.f, &mut fields.post,
            &mut fields.velocity, &mut fields.density, None).unwrap();
    }
}
