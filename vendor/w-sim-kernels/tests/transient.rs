use w_sim_kernels::{transient::*, KernelError};
#[test]
fn stable_settling_keeps_small_ratios_and_matches_independent_expm1() {
    for x in [
        0.,
        1e-24,
        1e-12,
        0.49999999999999994,
        0.5,
        1.,
        5.,
        100.,
        745.,
        1e21,
    ] {
        let w = first_order_weights(x, 1.).unwrap();
        let expected = -(-x).exp_m1();
        assert!(
            (w.settling_fraction - expected).abs() <= 4e-16 * expected.max(1e-300),
            "{x}: {} vs {expected}",
            w.settling_fraction
        );
        assert!((w.decay - (-x).exp()).abs() <= 3e-16);
    }
    assert_eq!(
        first_order_weights(f64::MAX, f64::MIN_POSITIVE)
            .unwrap()
            .settling_fraction,
        1.
    );
}
#[test]
fn analytic_time_constants_boundaries_and_curves_are_consistent() {
    assert_eq!(time_constant_rc(1000., 1e-6).unwrap(), 1e-3);
    assert_eq!(time_constant_rl(0.5, 1000.).unwrap(), 0.0005);
    let q = 1. - (-1.0f64).exp();
    assert!((rc_charge(1e-3, 5., 1000., 1e-6).unwrap() - 5. * q).abs() < 1e-15);
    assert_eq!(rc_charge(0., 5., 1000., 1e-6).unwrap(), 0.);
    assert_eq!(rc_discharge(0., 5., 1000., 1e-6).unwrap(), 5.);
    for mode in 0..3 {
        let mut values = [0.; 241];
        let r = transient_result(
            &TransientConfig {
                mode,
                reserved: 0,
                v0: 5.,
                r: 1000.,
                c: 1e-6,
                l: 0.5,
            },
            &mut values,
        )
        .unwrap();
        assert_eq!(values[0], if mode == 1 { r.y_max } else { 0. });
        let fraction = if mode == 1 {
            (-5.0f64).exp()
        } else {
            1. - (-5.0f64).exp()
        };
        assert!((values[240] - r.y_max * fraction).abs() < 1e-15);
    }
}
#[test]
fn rk4_matches_its_independent_polynomial_and_partial_batches() {
    let p = FirstOrderConfig {
        voltage: 5.,
        resistance: 2.,
        capacitance: 0.5,
        dt: 0.1,
    };
    let mut state = 2.;
    first_order_step(&p, &mut state).unwrap();
    let z = -0.1;
    let polynomial = 1. + z + z * z / 2. + z * z * z / 6. + z * z * z * z / 24.;
    assert!((state - (5. + (2. - 5.) * polynomial)).abs() < 1e-15);
    let mut single = 2.;
    for _ in 0..4 {
        first_order_step(&p, &mut single).unwrap();
    }
    let mut batch = 2.;
    first_order_advance(&p, &mut batch, 3).unwrap();
    first_order_advance(&p, &mut batch, 1).unwrap();
    assert_eq!(single, batch);
}
#[test]
fn transient_bad_parameters_and_nonfinite_arithmetic_are_explicit() {
    assert!(time_constant_rc(0., 1.).is_err());
    assert!(time_constant_rc(f64::MAX, 2.).is_err());
    assert!(time_constant_rl(1., 0.).is_err());
    assert!(first_order_weights(-1., 1.).is_err());
    assert!(first_order_weights(f64::NAN, 1.).is_err());
    let p = FirstOrderConfig {
        voltage: f64::MAX,
        resistance: 1.,
        capacitance: 1.,
        dt: 1.,
    };
    let mut state = -f64::MAX;
    assert_eq!(
        first_order_step(&p, &mut state),
        Err(KernelError::NonFiniteValue)
    );
    assert_eq!(state, -f64::MAX);
    assert!(first_order_advance(&p, &mut state, 0).is_err());
    assert_eq!(core::mem::size_of::<TransientConfig>(), 40);
    assert_eq!(core::mem::size_of::<TransientReadout>(), 24);
    assert_eq!(core::mem::size_of::<FirstOrderConfig>(), 32);
}
