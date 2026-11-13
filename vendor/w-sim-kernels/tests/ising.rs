use w_sim_kernels::{ising::*, KernelError};

#[test]
fn rng_cold_init_and_periodic_flip_energy_are_exact() {
    let c = IsingConfig {
        size: 8,
        temperature: 0.5,
    };
    let mut s = [0; 64];
    let mut rng = 42;
    init_ising(&c, &mut s, &mut rng, 0, false).unwrap();
    assert_eq!(rng, 0);
    let before = read_ising(&c, &s, &IsingMoments::default()).unwrap();
    assert_eq!(before.energy, -2.);
    assert_eq!(before.magnetization, 1.);
    for index in [0, 7, 8, 63] {
        let delta = delta_energy(&c, &s, index).unwrap();
        s[index] = -1;
        assert_eq!(
            (read_ising(&c, &s, &IsingMoments::default()).unwrap().energy - before.energy) * 64.,
            delta
        );
        s[index] = 1;
    }
    assert_eq!(next_random(&mut rng), 0.26642920868471265);
    assert_eq!(rng, 0x6d2b79f5);
}

#[test]
fn sample_counts_nulls_and_reset_use_the_current_temperature() {
    let mut c = IsingConfig {
        size: 8,
        temperature: 0.5,
    };
    let mut s = [1; 64];
    let mut rng = 0;
    let mut m = IsingMoments::default();
    let first = read_ising(&c, &s, &m).unwrap().point;
    assert_eq!(first.mean_energy, None);
    assert_eq!(first.specific_heat, None);
    for count in 1..=3 {
        sweep_ising(
            &c,
            &mut s,
            &mut rng,
            Some(&mut m),
            IsingAlgorithm::Metropolis,
            true,
            false,
        )
        .unwrap();
        let p = read_ising(&c, &s, &m).unwrap().point;
        assert_eq!(p.samples, count);
        assert_eq!(p.mean_m, Some(1.));
        assert_eq!(p.specific_heat, if count > 1 { Some(0.) } else { None });
    }
    c.temperature = 4.;
    sweep_ising(
        &c,
        &mut s,
        &mut rng,
        Some(&mut m),
        IsingAlgorithm::Heatbath,
        false,
        true,
    )
    .unwrap();
    assert_eq!(m.n, 0.);
    assert_eq!(read_ising(&c, &s, &m).unwrap().point.temperature, 4.);
    assert_ne!(rng, 0);
}

#[test]
fn deterministic_reference_matches_std_and_is_finite_at_critical_neighbors() {
    assert_eq!(onsager_tc(), 2. / (1. + 2_f64.sqrt()).ln());
    let mut max_error = 0_f64;
    for i in 1..=2268 {
        let t = i as f64 / 1000.;
        let s = (2. / t).sinh();
        let expected = (1. - 1. / (s * s * s * s)).powf(0.125);
        let got = onsager_magnetization(t).unwrap();
        max_error = max_error.max((got - expected).abs());
        assert!(
            (got - expected).abs() < 3e-13,
            "T={t} got={got} std={expected}"
        );
    }
    let tc = onsager_tc();
    let near = f64::from_bits(tc.to_bits() - 1);
    let below = onsager_magnetization(near).unwrap();
    assert!(below > 0. && below < 0.02);
    assert_eq!(onsager_magnetization(tc).unwrap(), 0.);
    assert_eq!(onsager_magnetization(f64::MAX).unwrap(), 0.);
    assert_eq!(onsager_magnetization(f64::MIN_POSITIVE).unwrap(), 1.);
    assert_eq!(onsager_magnetization(-1.).unwrap(), 1.);
    assert!(onsager_magnetization(f64::NAN).is_err());
}

#[test]
fn invalid_state_parameters_and_moments_are_rejected_before_sweep() {
    let mut c = IsingConfig {
        size: 8,
        temperature: 2.,
    };
    let mut s = [1; 64];
    let mut rng = 99;
    for bad in [0., -1., f64::NAN, f64::INFINITY] {
        c.temperature = bad;
        assert!(init_ising(&c, &mut s, &mut rng, 0, true).is_err());
        assert_eq!(rng, 99);
    }
    c.temperature = 2.;
    s[0] = 0;
    assert_eq!(
        sweep_ising(
            &c,
            &mut s,
            &mut rng,
            None,
            IsingAlgorithm::Metropolis,
            false,
            false
        ),
        Err(KernelError::InvalidState)
    );
    s[0] = 1;
    for bad in [
        IsingMoments {
            n: 0.5,
            ..Default::default()
        },
        IsingMoments {
            m: f64::NAN,
            ..Default::default()
        },
        IsingMoments {
            n: 9_007_199_254_740_991.,
            ..Default::default()
        },
    ] {
        let mut m = bad;
        assert!(sweep_ising(
            &c,
            &mut s,
            &mut rng,
            Some(&mut m),
            IsingAlgorithm::Metropolis,
            true,
            false
        )
        .is_err());
    }
    assert!(sweep_ising(
        &c,
        &mut s,
        &mut rng,
        None,
        IsingAlgorithm::Metropolis,
        true,
        false
    )
    .is_err());
    assert_eq!(rng, 99);
    assert_eq!(s, [1; 64]);
    assert!(delta_energy(&c, &s, 64).is_err());
    assert!(delta_energy(&c, &s[..63], 0).is_err());
    for size in [0, 1, 46_341, usize::MAX] {
        c.size = size;
        assert!(c.cells().is_err());
    }
    assert_eq!(specific_heat(1., 0., 64, 2.).unwrap(), 0.);
    assert_eq!(specific_heat(1., 2., 64, 2.).unwrap(), 16.);
    assert_eq!(susceptibility(1., 2., 64, 2.).unwrap(), 32.);
    assert!(specific_heat(0., 1., 64, f64::MIN_POSITIVE).is_err());
    assert!(specific_heat(f64::MAX, 1., 64, 2.).is_err());
    assert!(susceptibility(0., 1., 0, 2.).is_err());
}
