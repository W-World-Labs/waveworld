use w_sim_kernels::{fluid::*, KernelError};
fn config() -> FluidConfig {
    FluidConfig {
        n: 8,
        iterations: 12,
        dt: 0.05,
        viscosity: 0.,
        diffusion: 0.,
        thermal: false,
        buoyancy: 0.,
        ambient: 0.,
        inlet_speed: None,
    }
}
struct State {
    fields: [Vec<f32>; 10],
}
impl State {
    fn new() -> Self {
        Self {
            fields: core::array::from_fn(|_| vec![0.; 64]),
        }
    }
    fn buffers(&mut self) -> FluidBuffers<'_> {
        let [vx, vy, vx0, vy0, dens, dens0, p, div, scalar0, temp] = &mut self.fields;
        FluidBuffers {
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
        }
    }
}
#[test]
fn closed_scalar_uniform_transport_and_zero_flow_stay_constant() {
    let c = config();
    let mut s = State::new();
    s.fields[4].fill(2.5);
    for _ in 0..3 {
        step_fluid(&c, &mut s.buffers(), None).unwrap();
    }
    assert!(s.fields[4].iter().all(|&x| x == 2.5));
    assert!(s.fields[0].iter().chain(&s.fields[1]).all(|&x| x == 0.));
    let stats = read_fluid(
        &c,
        &s.fields[0],
        &s.fields[1],
        &s.fields[4],
        &s.fields[9],
        1,
    )
    .unwrap();
    assert_eq!(stats.mean_density, 2.5);
    assert_eq!(stats.max_divergence, 0.);
}
#[test]
fn inlet_faces_and_pressure_outlet_match_their_average_constraints() {
    let mut c = config();
    c.inlet_speed = Some(0.2);
    let mut x = vec![0.1; 64];
    set_boundary(&c, 1, &mut x).unwrap();
    for j in 1..7 {
        assert!(((x[j * 8] as f64 + x[j * 8 + 1] as f64) * 0.5 - 0.2).abs() < 1e-8);
        assert_eq!(x[j * 8 + 7], x[j * 8 + 6]);
    }
    set_boundary(&c, 3, &mut x).unwrap();
    for j in 1..7 {
        assert_eq!(x[j * 8 + 7], -x[j * 8 + 6]);
    }
}
#[test]
fn projection_reduces_nonzero_interior_divergence() {
    let mut c = config();
    c.iterations = 100;
    let mut vx = vec![0.; 64];
    let mut vy = vx.clone();
    vx[27] = 0.1;
    vy[35] = 0.05;
    let before = max_divergence(&vx, &vy, 8, 2).unwrap();
    let mut p = vec![0.; 64];
    let mut div = p.clone();
    project(&c, &mut vx, &mut vy, &mut p, &mut div).unwrap();
    assert!(max_divergence(&vx, &vy, 8, 2).unwrap() < before);
}
#[test]
fn projection_converges_within_sweep_budget_at_8192_cell_tier() {
    let mut c = config();
    c.iterations = 64;
    for (n, sweep_ceiling) in [(91usize, 4096.), (128, 4096.)] {
        for inlet in [None, Some(0.05)] {
            c.n = n;
            c.inlet_speed = inlet;
            let cells = n * n;
            let mut vx = vec![0f32; cells];
            let mut vy = vec![0f32; cells];
            let mut p = vec![0f32; cells];
            let mut div = vec![0f32; cells];
            let (mid, s2) = (n as f64 * 0.5, (n as f64 * 0.12).powi(2));
            for j in 1..n - 1 {
                for i in 1..n - 1 {
                    let d2 = (i as f64 - mid).powi(2) + (j as f64 - mid).powi(2);
                    let g = (-d2 / s2).exp() as f32;
                    vx[i + j * n] = g;
                    vy[i + j * n] = -0.5 * g;
                }
            }
            project(&c, &mut vx, &mut vy, &mut p, &mut div).unwrap();
            assert!(
                div[0] < sweep_ceiling,
                "n={n} inlet={inlet:?} exhausted budget: {} sweeps",
                div[0]
            );
            assert!(
                div[1] < 1e-6,
                "n={n} inlet={inlet:?} residual {:e} above 1e-6",
                div[1]
            );
            assert!(
                max_divergence(&vx, &vy, n, 1).unwrap() < 1e-4,
                "n={n} inlet={inlet:?} divergence not driven down"
            );
        }
    }
}
#[test]
fn iteration_budget_above_4096_is_admission_rejected_not_clamped() {
    let mut c = config();
    let mut s = State::new();
    for iterations in [8192, 16384, 32768] {
        c.iterations = iterations;
        assert_eq!(
            step_fluid(&c, &mut s.buffers(), None),
            Err(KernelError::InvalidCoefficient)
        );
        let mut x = vec![0f32; 64];
        let x0 = vec![0f32; 64];
        assert_eq!(
            linear_solve(&c, 0, &mut x, &x0, 1., 1.),
            Err(KernelError::InvalidCoefficient)
        );
    }
}
#[test]
fn per_step_reservoir_decay_cooling_and_obstacle_keep_existing_order() {
    let mut c = config();
    c.dt = 0.;
    c.thermal = true;
    let mut s = State::new();
    s.fields[9].fill(10.);
    let mut mask = vec![0; 64];
    mask[27] = 1;
    s.fields[0][27] = 2.;
    s.fields[4][27] = 3.;
    let source = FluidSource {
        dye: Some(DyeInlet {
            density: 4.,
            spacing: 3.,
            width: 1.,
        }),
        density_decay: 0.5,
        temperature_cooling: 0.75,
    };
    advance_fluid(&c, &mut s.buffers(), Some(&mask), &source).unwrap();
    assert_eq!(s.fields[4][3 * 8 + 1], 2.);
    assert_eq!(s.fields[4][2 * 8 + 1], 0.);
    assert_eq!(s.fields[4][27], 0.);
    assert_eq!(s.fields[0][27], 0.);
    assert_eq!(s.fields[9][27], 7.5);
}
#[test]
fn buoyancy_hot_moves_negative_y_and_cold_moves_positive_y() {
    let mut c = config();
    c.thermal = true;
    c.buoyancy = 5.;
    c.ambient = 1.;
    let mut vy = vec![0.; 64];
    let mut temp = vec![1.; 64];
    temp[27] = 11.;
    temp[28] = -9.;
    apply_buoyancy(&c, &mut vy, &temp).unwrap();
    assert_eq!(vy[27], -2.5);
    assert_eq!(vy[28], 2.5);
    assert_eq!(vy[0], 0.);
}
#[test]
fn invalid_coefficients_lengths_fields_and_overflow_fail_without_fake_finite_values() {
    let mut c = config();
    let mut s = State::new();
    s.fields[8][10] = f32::NAN;
    assert_eq!(
        step_fluid(&c, &mut s.buffers(), None),
        Err(KernelError::NonFiniteValue)
    );
    s.fields[8][10] = 0.;
    assert_eq!(
        step_fluid(&c, &mut s.buffers(), Some(&[0; 63])),
        Err(KernelError::BufferLength)
    );
    for dt in [f64::NAN, -1., f64::INFINITY] {
        c.dt = dt;
        assert_eq!(
            step_fluid(&c, &mut s.buffers(), None),
            Err(KernelError::InvalidCoefficient)
        );
    }
    c.dt = 0.05;
    let x0 = vec![0.; 64];
    assert_eq!(
        linear_solve(&c, 0, &mut s.fields[4], &x0, 1., 0.),
        Err(KernelError::InvalidCoefficient)
    );
    assert_eq!(
        advect(&c, 0, &mut s.fields[4], &x0, &x0[..63], &x0),
        Err(KernelError::BufferLength)
    );
    c.thermal = true;
    c.buoyancy = f64::MAX;
    s.fields[9][27] = f32::MAX;
    assert_eq!(
        step_fluid(&c, &mut s.buffers(), None),
        Err(KernelError::NonFiniteValue)
    );
}
