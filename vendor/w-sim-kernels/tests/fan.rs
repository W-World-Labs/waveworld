use w_sim_kernels::lbm::{
    init_d3q19, step_d3q19, D3q19Boundary, D3q19Config, D3q19Fan, D3Q19_C, D3Q19_Q,
};
use w_sim_kernels::KernelError;

fn config(normal: [f64; 3], radius: f64) -> D3q19Config {
    D3q19Config {
        nx: 7,
        ny: 7,
        nz: 7,
        tau: 0.8,
        u_inlet: 0.0,
        smagorinsky_cs: 0.12,
        turbulence_intensity: 0.0,
        ground_velocity: None,
        free_slip_walls: false,
        boundary: D3q19Boundary::Periodic,
        thermal: None,
        fan: Some(D3q19Fan {
            center: [3.5; 3],
            normal,
            radius_cells: radius,
            acceleration_lattice: 0.001,
        }),
    }
}

struct State {
    f: Vec<f32>,
    post: Vec<f32>,
    u: Vec<f32>,
    rho: Vec<f32>,
    flags: Vec<u8>,
}
impl State {
    fn new(config: &D3q19Config) -> Self {
        let n = config.cell_count().unwrap();
        let mut state = Self {
            f: vec![0.; n * D3Q19_Q],
            post: vec![0.; n * D3Q19_Q],
            u: vec![0.; n * 3],
            rho: vec![0.; n],
            flags: vec![0; n],
        };
        init_d3q19(
            config,
            &state.flags,
            &mut state.f,
            &mut state.post,
            &mut state.u,
            &mut state.rho,
            None,
        )
        .unwrap();
        state
    }
    fn step(
        &mut self,
        config: &D3q19Config,
        step: u32,
    ) -> Result<w_sim_kernels::lbm::D3q19Step, KernelError> {
        step_d3q19(
            config,
            &self.flags,
            &mut self.f,
            &mut self.post,
            &mut self.u,
            &mut self.rho,
            None,
            step,
        )
    }
    fn totals(&self) -> (f64, [f64; 3]) {
        let mut mass = 0.;
        let mut momentum = [0.; 3];
        for (cell, &flag) in self.flags.iter().enumerate() {
            if flag != 0 {
                continue;
            }
            for (q, c) in D3Q19_C.iter().enumerate() {
                let value = self.f[cell * D3Q19_Q + q] as f64;
                mass += value;
                for axis in 0..3 {
                    momentum[axis] += value * c[axis] as f64;
                }
            }
        }
        (mass, momentum)
    }
}

#[test]
fn zero_inlet_accelerates_along_positive_negative_and_rotated_directions() {
    for normal in [
        [1., 0., 0.],
        [-1., 0., 0.],
        [0., 1., 0.],
        [0., -1., 0.],
        [0., 0., 1.],
        [0., 0., -1.],
        [0.6, 0.8, 0.],
    ] {
        let config = config(normal, 1.1);
        let mut state = State::new(&config);
        let mass = state.totals().0;
        for step in 1..=4 {
            let result = state.step(&config, step).unwrap();
            assert!(result.max_speed > 0. && result.max_speed < 0.02);
            assert!((result.mass - mass).abs() < mass * 3e-7);
        }
        let momentum = state.totals().1;
        let along: f64 = momentum.iter().zip(normal).map(|(v, n)| v * n).sum();
        assert!(along > 0.);
        for axis in 0..3 {
            assert!(
                (momentum[axis] - along * normal[axis]).abs() < 2e-6,
                "normal={normal:?}, momentum={momentum:?}"
            );
        }
    }
}

#[test]
fn solid_disk_cells_receive_no_force_and_momentum_accounts_for_body_reaction() {
    let config = config([1., 0., 0.], 1.1);
    let mut state = State::new(&config);
    let center = 3 + 7 * (3 + 7 * 3);
    state.flags[center] = 1;
    let before = state.totals();
    let result = state.step(&config, 1).unwrap();
    let after = state.totals();
    // Radius 1.1 covers a five-cell cross; masking its center leaves four fluid
    // cells. Their total applied force is 4*rho*a. Domain is periodic.
    assert!((after.1[0] - before.1[0] + result.obstacle_force[0] - 0.004).abs() < 2e-6);
    assert!((after.0 - before.0).abs() < before.0 * 3e-7);
    assert_eq!(&state.u[center * 3..center * 3 + 3], &[0.; 3]);
    let single = config_with_radius(config, 0.5);
    assert_eq!(
        state.step(&single, 2).unwrap_err(),
        KernelError::InvalidState
    );
}

fn config_with_radius(mut config: D3q19Config, radius: f64) -> D3q19Config {
    config.fan.as_mut().unwrap().radius_cells = radius;
    config
}

#[test]
fn completed_velocity_uses_one_half_step_force_correction() {
    let config = config([1., 0., 0.], 0.5);
    let mut state = State::new(&config);
    state.step(&config, 1).unwrap();
    let center = 3 + 7 * (3 + 7 * 3);
    assert!((state.u[center * 3] as f64 - 0.0005).abs() < 1e-9);
}

#[test]
fn invalid_fans_fail_explicitly_before_field_updates() {
    let valid = config([1., 0., 0.], 0.5);
    let mut state = State::new(&valid);
    let before = state.f.clone();
    for fan in [
        D3q19Fan {
            normal: [2., 0., 0.],
            ..valid.fan.unwrap()
        },
        D3q19Fan {
            normal: [f64::NAN, 0., 0.],
            ..valid.fan.unwrap()
        },
        D3q19Fan {
            radius_cells: 0.49,
            ..valid.fan.unwrap()
        },
        D3q19Fan {
            center: [0.; 3],
            ..valid.fan.unwrap()
        },
        D3q19Fan {
            acceleration_lattice: 0.,
            ..valid.fan.unwrap()
        },
        D3q19Fan {
            acceleration_lattice: f64::INFINITY,
            ..valid.fan.unwrap()
        },
    ] {
        let config = D3q19Config {
            fan: Some(fan),
            ..valid
        };
        assert_eq!(
            state.step(&config, 1).unwrap_err(),
            KernelError::InvalidCoefficient
        );
        assert_eq!(state.f, before);
    }
}
