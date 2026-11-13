use w_sim_kernels::fdtd::{
    add_soft_source, energy_fdtd, step_fdtd, FdtdBoundary, FdtdBuffers, FdtdConfig,
};
use w_sim_kernels::KernelError;
fn config() -> FdtdConfig {
    FdtdConfig {
        nx: 5,
        ny: 5,
        dt: 0.25,
        mu: 1.,
        boundary: FdtdBoundary::Pec,
    }
}
struct State {
    ez: Vec<f32>,
    hx: Vec<f32>,
    hy: Vec<f32>,
    left: Vec<f32>,
    right: Vec<f32>,
    bottom: Vec<f32>,
    top: Vec<f32>,
}
impl State {
    fn new() -> Self {
        Self {
            ez: vec![0.; 25],
            hx: vec![0.; 25],
            hy: vec![0.; 25],
            left: vec![0.; 5],
            right: vec![0.; 5],
            bottom: vec![0.; 5],
            top: vec![0.; 5],
        }
    }
    fn buffers(&mut self) -> FdtdBuffers<'_> {
        FdtdBuffers {
            ez: &mut self.ez,
            hx: &mut self.hx,
            hy: &mut self.hy,
            prev_left: &mut self.left,
            prev_right: &mut self.right,
            prev_bottom: &mut self.bottom,
            prev_top: &mut self.top,
        }
    }
}
#[test]
fn impulse_uses_updated_magnetic_field_and_local_permittivity() {
    let c = config();
    let mut s = State::new();
    s.ez[12] = 1.;
    let mut eps = vec![1.; 25];
    eps[12] = 2.;
    step_fdtd(&c, &eps, None, &mut s.buffers()).unwrap();
    assert_eq!(s.hx[7], -0.25);
    assert_eq!(s.hx[12], 0.25);
    assert_eq!(s.hy[11], 0.25);
    assert_eq!(s.hy[12], -0.25);
    assert_eq!(s.ez[12], 0.875);
    for i in [7, 11, 13, 17] {
        assert_eq!(s.ez[i], 0.0625)
    }
    assert_eq!(
        energy_fdtd(&c, &eps, &s.ez, &s.hx, &s.hy).unwrap(),
        0.8984375
    );
}
#[test]
fn pec_mask_and_walls_are_zero_and_pec_histories_are_untouched() {
    let c = config();
    let mut s = State::new();
    s.ez.fill(0.5);
    s.hx[24] = 0.3;
    s.hy[24] = -0.2;
    s.left.fill(0.1);
    s.top.fill(0.2);
    let mut mask = vec![0; 25];
    mask[12] = 7;
    step_fdtd(&c, &[1.; 25], Some(&mask), &mut s.buffers()).unwrap();
    for i in 0..25 {
        if !(5..20).contains(&i) || i % 5 == 0 || i % 5 == 4 || i == 12 {
            assert_eq!(s.ez[i], 0.)
        }
    }
    assert_eq!(s.left, [0.1; 5]);
    assert_eq!(s.top, [0.2; 5]);
    // Missing forward neighbors contribute zero gradient, retaining the stored H.
    assert_eq!(s.hx[24], 0.3);
    assert_eq!(s.hy[24], -0.2);
}
#[test]
fn mur_updates_histories_after_both_pairs_of_edges() {
    let mut c = config();
    c.boundary = FdtdBoundary::Mur;
    let mut s = State::new();
    s.ez[12] = 1.;
    s.left.fill(0.125);
    s.bottom.fill(-0.25);
    step_fdtd(&c, &[1.; 25], None, &mut s.buffers()).unwrap();
    assert_ne!(s.ez[0], 0.);
    for j in 0..5 {
        assert_eq!(s.left[j], s.ez[j * 5 + 1]);
        assert_eq!(s.right[j], s.ez[j * 5 + 3])
    }
    for i in 0..5 {
        assert_eq!(s.bottom[i], s.ez[5 + i]);
        assert_eq!(s.top[i], s.ez[15 + i])
    }
}
#[test]
fn bad_cfl_coefficients_dimensions_lengths_and_nonfinite_state_fail_before_mutation() {
    let c = config();
    for dt in [0., -1., 1., f64::NAN, f64::INFINITY] {
        let mut bad = c;
        bad.dt = dt;
        let mut s = State::new();
        s.ez[12] = 1.;
        assert_eq!(
            step_fdtd(&bad, &[1.; 25], None, &mut s.buffers()),
            Err(KernelError::InvalidCoefficient)
        );
        assert_eq!(s.ez[12], 1.);
        assert_eq!(s.hx, [0.; 25]);
    }
    for mu in [0., -1., f64::NAN] {
        let mut bad = c;
        bad.mu = mu;
        assert!(step_fdtd(&bad, &[1.; 25], None, &mut State::new().buffers()).is_err())
    }
    for value in [0., -1., 0.01, f32::NAN, f32::INFINITY] {
        let mut eps = [1.; 25];
        eps[12] = value;
        assert_eq!(
            step_fdtd(&c, &eps, None, &mut State::new().buffers()),
            Err(KernelError::InvalidCoefficient)
        );
    }
    let mut bad = c;
    bad.nx = 2;
    assert_eq!(
        step_fdtd(&bad, &[1.; 25], None, &mut State::new().buffers()),
        Err(KernelError::InvalidDimensions)
    );
    assert_eq!(
        step_fdtd(&c, &[1.; 24], None, &mut State::new().buffers()),
        Err(KernelError::BufferLength)
    );
    assert_eq!(
        step_fdtd(&c, &[1.; 25], Some(&[0; 24]), &mut State::new().buffers()),
        Err(KernelError::BufferLength)
    );
    let mut s = State::new();
    s.left.pop();
    assert_eq!(
        step_fdtd(&c, &[1.; 25], None, &mut s.buffers()),
        Err(KernelError::BufferLength)
    );
    let mut s = State::new();
    s.top[4] = f32::NAN;
    assert_eq!(
        step_fdtd(&c, &[1.; 25], None, &mut s.buffers()),
        Err(KernelError::NonFiniteValue)
    );
    assert_eq!(s.hx, [0.; 25]);
}
#[test]
fn source_and_energy_reject_invalid_or_overflowing_values() {
    let mut s = State::new();
    add_soft_source(&mut s.ez, 5, 5, 2, 2, 0.1).unwrap();
    assert_eq!(s.ez[12], 0.1);
    assert_eq!(
        add_soft_source(&mut s.ez, 5, 5, 5, 0, 1.),
        Err(KernelError::InvalidDimensions)
    );
    assert_eq!(
        add_soft_source(&mut s.ez, 5, 5, 0, 0, f64::NAN),
        Err(KernelError::NonFiniteValue)
    );
    assert_eq!(
        add_soft_source(&mut s.ez, 5, 5, 0, 0, f64::MAX),
        Err(KernelError::NonFiniteValue)
    );
    s.hy[0] = f32::INFINITY;
    assert_eq!(
        energy_fdtd(&config(), &[1.; 25], &s.ez, &s.hx, &s.hy),
        Err(KernelError::NonFiniteValue)
    );
}

#[test]
fn finite_input_that_overflows_a_float32_update_is_rejected() {
    let mut c = config();
    c.dt = 0.5;
    let mut s = State::new();
    s.hy[12] = f32::MAX;
    s.hy[11] = -f32::MAX;
    s.hx[12] = -f32::MAX;
    s.hx[7] = f32::MAX;
    assert_eq!(
        step_fdtd(&c, &[1.; 25], None, &mut s.buffers()),
        Err(KernelError::NonFiniteValue)
    );
}
