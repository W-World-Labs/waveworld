use w_sim_kernels::{faraday::*, KernelError};
#[test]
fn independent_lenz_motional_and_polynomial_flux_examples() {
    assert_eq!(induced_emf(3., 2.).unwrap(), -6.);
    assert_eq!(induced_emf(-3., 2.).unwrap(), 6.);
    assert_eq!(motional_emf(0.5, 2., 3.).unwrap(), 3.);
    let mut out = [0.; 4];
    emf_from_flux_series(&[0., 1., 4., 9.], 1., 2., &mut out).unwrap();
    assert_eq!(out, [-2., -4., -8., -10.]);
    emf_from_flux_series(&[1., 3., 5., 7.], 0.5, 3., &mut out).unwrap();
    assert_eq!(out, [-12.; 4]);
}
#[test]
fn single_and_empty_series_preserve_signed_zero_boundaries() {
    emf_from_flux_series(&[], 1., 2., &mut []).unwrap();
    let mut out = [1.];
    emf_from_flux_series(&[3.], 1., 2., &mut out).unwrap();
    assert_eq!(out[0].to_bits(), (-0.0f64).to_bits());
    assert_eq!(induced_emf(0., 1.).unwrap().to_bits(), (-0.0f64).to_bits());
}
#[test]
fn quarter_period_and_two_period_curve_have_expected_physical_scales() {
    let p = FaradayConfig {
        omega: 2. * core::f64::consts::PI,
        b: 0.2,
        n: 100.,
        area: 0.01,
        v_bar: 2.,
        b_mot: 0.5,
        l_bar: 0.2,
    };
    let mut flux = [0.; 361];
    let mut emf = [0.; 361];
    let r = faraday_result(&p, &mut flux, &mut emf).unwrap();
    assert_eq!(r.frequency, 1.);
    assert_eq!(r.period, 1.);
    assert_eq!(r.linkage, 0.2);
    assert_eq!(r.motional_emf, 0.2);
    assert_eq!(flux[0], r.linkage);
    assert_eq!(emf[0], 0.);
    assert!((emf[45] - r.peak).abs() < 1e-15);
    assert!(flux[45].abs() < 1e-15);
    assert!((flux[360] - r.linkage).abs() < 1e-15);
    let t = 0.13;
    let dt = 1e-6;
    let derivative = (rotating_coil_flux(t + dt, p.n, p.b, p.area, p.omega).unwrap()
        - rotating_coil_flux(t - dt, p.n, p.b, p.area, p.omega).unwrap())
        / (2. * dt);
    assert!((rotating_coil_emf(t, p.n, p.b, p.area, p.omega).unwrap() + derivative).abs() < 1e-9);
}
#[test]
fn invalid_coefficients_lengths_nonfinite_and_overflow_fail() {
    assert_eq!(core::mem::size_of::<FaradayConfig>(), 56);
    assert_eq!(core::mem::size_of::<FaradayReadout>(), 40);
    assert_eq!(induced_emf(f64::MAX, 2.), Err(KernelError::NonFiniteValue));
    assert!(motional_emf(f64::INFINITY, 1., 1.).is_err());
    assert!(rotating_coil_flux(f64::MAX, 1., 1., 1., 2.).is_err());
    assert!(emf_from_flux_series(&[1.], 0., 1., &mut [0.]).is_err());
    assert!(emf_from_flux_series(&[1., 2.], 1., 1., &mut [0.]).is_err());
    assert!(emf_from_flux_series(&[1., f64::NAN], 1., 1., &mut [0.; 2]).is_err());
    let p = FaradayConfig {
        omega: 0.,
        b: 1.,
        n: 1.,
        area: 1.,
        v_bar: 1.,
        b_mot: 1.,
        l_bar: 1.,
    };
    assert!(faraday_result(&p, &mut [0.; 361], &mut [0.; 361]).is_err());
}
