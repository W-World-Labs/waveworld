use w_sim_kernels::lbm::{
    init_d3q19, step_d3q19, D3q19Boundary, D3q19Config, D3Q19_C, D3Q19_NEE_INLET_VERSION, D3Q19_Q,
    D3Q19_W,
};
use w_sim_kernels::KernelError;

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

struct State {
    flags: Vec<u8>,
    f: Vec<f32>,
    post: Vec<f32>,
    u: Vec<f32>,
    rho: Vec<f32>,
}
impl State {
    fn new(c: &D3q19Config) -> Self {
        let n = c.cell_count().unwrap();
        let mut s = Self {
            flags: vec![0; n],
            f: vec![0.; n * 19],
            post: vec![0.; n * 19],
            u: vec![0.; n * 3],
            rho: vec![0.; n],
        };
        s.init(c).unwrap();
        s
    }
    fn init(&mut self, c: &D3q19Config) -> Result<(), KernelError> {
        init_d3q19(
            c,
            &self.flags,
            &mut self.f,
            &mut self.post,
            &mut self.u,
            &mut self.rho,
            None,
        )
    }
    fn step(
        &mut self,
        c: &D3q19Config,
        step: u32,
    ) -> Result<w_sim_kernels::lbm::D3q19Step, KernelError> {
        step_d3q19(
            c,
            &self.flags,
            &mut self.f,
            &mut self.post,
            &mut self.u,
            &mut self.rho,
            None,
            step,
        )
    }
    fn seed(&mut self, cell: usize, rho: f64, u: [f64; 3]) {
        for (q, d) in D3Q19_C.iter().enumerate() {
            let cu: f64 = (0..3).map(|a| d[a] as f64 * u[a]).sum();
            let u2: f64 = u.iter().map(|x| x * x).sum();
            self.f[cell * 19 + q] =
                (D3Q19_W[q] * rho * (1. + 3. * cu + 4.5 * cu * cu - 1.5 * u2)) as f32;
        }
    }
    fn moments(&self, cell: usize) -> (f64, [f64; 3], f64) {
        let mut rho = 0.;
        let mut j = [0.; 3];
        let mut xy = 0.;
        for (q, d) in D3Q19_C.iter().enumerate() {
            let f = self.f[cell * 19 + q] as f64;
            rho += f;
            for a in 0..3 {
                j[a] += f * d[a] as f64;
            }
            xy += f * d[0] as f64 * d[1] as f64;
        }
        (rho, j.map(|v| v / rho), xy - j[0] * j[1] / rho)
    }
}
fn close(a: f64, b: f64, tol: f64) {
    assert!((a - b).abs() <= tol, "{a} != {b}");
}

#[test]
fn nee_inlet_keeps_uniform_equilibrium_including_slip_corners() {
    assert_eq!(D3Q19_NEE_INLET_VERSION, 1);
    for speed in [0., 0.04] {
        let mut c = config();
        c.u_inlet = speed;
        let mut s = State::new(&c);
        for step in 1..=3 {
            let result = s.step(&c, step).unwrap();
            assert_eq!(result.obstacle_force, [0.; 3]);
            for cell in 0..175 {
                let (rho, u, stress) = s.moments(cell);
                close(rho, 1., 2e-7);
                close(u[0], speed, 3e-8);
                close(u[1], 0., 1e-8);
                close(u[2], 0., 1e-8);
                close(stress, 0., 1e-8);
            }
        }
    }
}

#[test]
fn nee_inlet_retains_independently_derived_current_stream_shear() {
    let c = config();
    let mut s = State::new(&c);
    for cell in 0..175 {
        s.seed(cell, 1., [0.04, 0.003 * (cell % 7) as f64, 0.]);
    }
    // Deliberately stale public macro buffers must not supply the donor moments.
    s.u.fill(0.12);
    s.rho.fill(1.5);
    s.step(&c, 1).unwrap();
    let inlet = 7 * (2 + 5 * 2);
    let (rho, u, shear) = s.moments(inlet);
    let (_, inner_u, inner_shear) = s.moments(inlet + 1);
    close(rho, 1., 1e-7);
    close(u[0], 0.04, 3e-8);
    close(u[1], 0., 1e-8);
    // In the streamed interior: uy=s*x-U*s and Pi_xy=U*s*x-s/3.
    // Thus fneq shear=s*(U^2-1/3), not zero or pre-stream equilibrium.
    close(inner_u[1], 0.003 * (1. - 0.04), 1e-8);
    for v in [shear, inner_shear] {
        close(v, 0.003 * (0.04_f64.powi(2) - 1. / 3.), 1e-8);
    }
}

#[test]
fn inlet_density_uses_current_donor_and_boundary_reconstruction_mass_is_accounted() {
    let c = config();
    let mut s = State::new(&c);
    for cell in 0..175 {
        s.seed(cell, if cell % 7 == 2 { 1.03 } else { 1. }, [0.04, 0., 0.]);
    }
    let before: f64 = s.f.iter().map(|&v| v as f64).sum();
    let result = s.step(&c, 1).unwrap();
    let extra = 0.03 * (1. - 3. * 0.04 + 3. * 0.04_f64.powi(2)) / 6.;
    let inlet = 7 * (2 + 5 * 2);
    let (rho, u, _) = s.moments(inlet);
    let (rho_inner, u_inner, _) = s.moments(inlet + 1);
    close(rho, 1. + extra, 1e-7);
    close(rho, rho_inner, 3e-8);
    close(u[0], 0.04, 3e-8);
    close(u_inner[0], (0.04 - extra) / (1. + extra), 3e-8);
    // Independent plane aggregation of pre-boundary streaming. Tangential
    // specular links permute each full plane; missing x links bounce locally.
    let mut raw = [0.; 2];
    let mut prescribed = [0.; 2];
    for row in 0..25 {
        for (side, x) in [0, 6].into_iter().enumerate() {
            let inward = if side == 0 { 1 } else { 5 };
            let outward_cx = if side == 0 { -1 } else { 1 };
            for (q, d) in D3Q19_C.iter().enumerate() {
                if d[0] == 0 {
                    raw[side] += s.post[(row * 7 + x) * 19 + q] as f64;
                }
                if d[0] == outward_cx {
                    raw[side] += s.post[(row * 7 + x) * 19 + q] as f64;
                    raw[side] += s.post[(row * 7 + inward) * 19 + q] as f64;
                }
            }
            prescribed[side] += if side == 0 {
                s.moments(row * 7 + 1).0
            } else {
                1.
            };
        }
    }
    let post_mass: f64 = s.post.iter().map(|&v| v as f64).sum();
    let reconstruction = prescribed[0] + prescribed[1] - raw[0] - raw[1];
    assert!(
        reconstruction > 0.1,
        "this open boundary has a real mass source"
    );
    close(
        result.mass - before,
        (post_mass - before) + reconstruction,
        2e-6,
    );
}

#[test]
fn inlet_admission_rejects_solid_donor_before_mutation_but_skips_solid_boundary() {
    let mut c = config();
    let mut s = State::new(&c);
    s.flags[1 + 7 * (2 + 5 * 2)] = 1;
    let before = s.f.clone();
    assert_eq!(s.step(&c, 1).unwrap_err(), KernelError::InvalidState);
    assert_eq!(s.init(&c), Err(KernelError::InvalidState));
    assert_eq!(s.f, before);
    s.flags[7 * (2 + 5 * 2)] = 1;
    s.init(&c).unwrap();
    s.step(&c, 1).unwrap();
    for boundary in [D3q19Boundary::Closed, D3q19Boundary::Periodic] {
        c.boundary = boundary;
        c.free_slip_walls = false;
        s.flags[7 * (2 + 5 * 2)] = 0;
        s.init(&c).unwrap();
        s.step(&c, 1).unwrap();
    }
}

#[test]
fn inlet_prescribed_noise_and_current_donor_survive_wall_ground_intersections() {
    // Hash is independently evaluated as the documented integer operation sequence.
    let hash = |n: u32| {
        let mut x = n.wrapping_mul(747_796_405).wrapping_add(2_891_336_453);
        x = ((x >> ((x >> 28) + 4)) ^ x).wrapping_mul(277_803_737);
        ((x >> 22) ^ x) as f64 / u32::MAX as f64
    };
    for slip in [false, true] {
        for ground in [None, Some(0.), Some(0.04)] {
            let mut c = config();
            c.free_slip_walls = slip;
            c.ground_velocity = ground;
            c.turbulence_intensity = 0.1;
            let mut s = State::new(&c);
            let step = 3_u32;
            s.step(&c, step).unwrap();
            for cell in (0..175).step_by(7) {
                let idx = cell as u32;
                let noise = [
                    hash(idx ^ step.wrapping_mul(2_654_435_761)),
                    hash(idx.wrapping_mul(1_664_525) ^ step.wrapping_mul(1_013_904_223)),
                    hash(idx.wrapping_mul(22_695_477) ^ step.wrapping_mul(747_796_405)),
                ]
                .map(|h| 2. * h - 1.);
                let (rho, u, shear) = s.moments(cell);
                let inner = s.moments(cell + 1);
                close(rho, inner.0, 1e-7);
                close(shear, inner.2, 1e-8);
                for a in 0..3 {
                    close(
                        u[a],
                        0.04 * ((if a == 0 { 1. } else { 0. }) + 0.1 * noise[a]),
                        3e-8,
                    );
                }
            }
        }
    }
}

#[test]
fn invalid_inlet_donor_populations_fail_explicitly() {
    for invalid in [0., f32::NAN] {
        let c = config();
        let mut s = State::new(&c);
        s.f[85 * D3Q19_Q..86 * D3Q19_Q].fill(invalid);
        let error = s.step(&c, 1).unwrap_err();
        assert_eq!(
            error,
            if invalid.is_nan() {
                KernelError::NonFiniteValue
            } else {
                KernelError::InvalidState
            }
        );
    }
}

#[test]
fn fan_on_inner_layer_does_not_add_half_force_to_prescribed_inlet() {
    let mut c = config();
    c.u_inlet = 0.;
    c.fan = Some(w_sim_kernels::lbm::D3q19Fan {
        center: [1.5, 2.5, 2.5],
        normal: [0., 1., 0.],
        radius_cells: 0.5,
        acceleration_lattice: 0.002,
    });
    let mut s = State::new(&c);
    s.step(&c, 1).unwrap();
    let inlet = 7 * (2 + 5 * 2);
    let (_, u, _) = s.moments(inlet);
    let (_, inner_bare, _) = s.moments(inlet + 1);
    // The isolated forced cell sends its collision impulse to neighbors; its
    // own final macro velocity still contains the local half-force correction.
    assert!(s.u[(inlet + 1) * 3 + 1] > 0.);
    close(s.u[(inlet + 1) * 3 + 1] as f64 - inner_bare[1], 0.001, 1e-9);
    for (a, &component) in u.iter().enumerate() {
        close(component, 0., 1e-8);
        close(s.u[inlet * 3 + a] as f64, 0., 1e-8);
    }
}
