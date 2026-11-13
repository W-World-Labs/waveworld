use w_sim_kernels::{antenna::*, KernelError};
fn link() -> AntennaLinkConfig {
    AntennaLinkConfig {
        pt_dbm: 20.,
        gt_dbi: 6.,
        gr_dbi: 8.,
        frequency_hz: 2.4e9,
        distance_m: 100.,
        kind: 1,
        reserved: 0,
    }
}
fn array() -> ArrayConfig {
    ArrayConfig {
        d_over_lambda: 0.5,
        steer_deg: 20.,
        n: 8,
        reserved: 0,
    }
}

#[test]
fn fields_and_friis_keep_physical_relations() {
    assert_eq!(pattern_2d(1, 0.).unwrap(), 0.);
    assert_eq!(dipole_power(core::f64::consts::FRAC_PI_2).unwrap(), 1.);
    assert!((polarization_loss(core::f64::consts::FRAC_PI_4).unwrap() - 0.5).abs() < 1e-15);
    let p = link();
    let first = friis_link(&p).unwrap();
    let second = friis_link(&AntennaLinkConfig {
        distance_m: 1000.,
        ..p
    })
    .unwrap();
    assert!((second.fspl_db - first.fspl_db - 20.).abs() < 1e-12);
    assert_eq!(first.pr_dbm, p.pt_dbm + p.gt_dbi + p.gr_dbi - first.fspl_db);
    assert!(antenna_beamwidth(2).unwrap() < antenna_beamwidth(1).unwrap());
}
#[test]
fn zero_received_power_has_explicit_none() {
    let mut p = Antenna3dConfig {
        frequency_hz: 1e9,
        pt_dbm: 20.,
        distance_m: 100.,
        elevation_deg: 90.,
        polarization_deg: 0.,
    };
    let mut pattern = [0.; 49];
    assert!(antenna_3d(&p, &mut pattern).unwrap().pr_dbm.is_some());
    p.polarization_deg = 90.;
    let r = antenna_3d(&p, &mut pattern).unwrap();
    assert!(r.pr_dbm.is_none());
    assert_eq!(r.plf, 0.);
    p.polarization_deg = 0.;
    for theta in [0., 180.] {
        p.elevation_deg = theta;
        assert!(antenna_3d(&p, &mut pattern).unwrap().pr_dbm.is_none());
    }
}
#[test]
fn exact_array_sum_peaks_and_clipped_main_lobe() {
    let p = array();
    assert_eq!(array_factor(&p, p.steer_deg).unwrap(), 1.);
    assert_eq!(array_factor(&ArrayConfig { n: 0, ..p }, 0.).unwrap(), 0.);
    assert_eq!(
        array_factor(
            &ArrayConfig {
                d_over_lambda: 0.,
                ..p
            },
            0.
        )
        .unwrap(),
        1.
    );
    let mut scan = [ArraySample::default(); 2001];
    let r = array_beamwidth(
        &ArrayConfig {
            n: 12,
            d_over_lambda: 1.,
            steer_deg: 80.,
            reserved: 0,
        },
        &mut scan,
    )
    .unwrap();
    assert!(r.clipped);
    assert!(r.width_deg > 15. && r.width_deg < 25.);
    let broad = array_beamwidth(
        &ArrayConfig {
            n: 2,
            d_over_lambda: 0.25,
            steer_deg: 0.,
            reserved: 0,
        },
        &mut scan,
    )
    .unwrap();
    assert_eq!(broad.width_deg, 180.);
    assert!(broad.clipped);
    let mut lobes = [0.; 20];
    let n = grating_lobes(1., 0., &mut lobes).unwrap();
    assert_eq!(&lobes[..n], &[-90., 90.]);
    assert_eq!(grating_lobes(0., 0., &mut lobes).unwrap(), 0);
    assert_eq!(lobes, [0.; 20]);
    assert_eq!(grating_lobes(20., 0., &mut lobes).unwrap(), 20);
}
#[test]
fn helpers_match_independent_platform_math_in_supported_domains() {
    for x in [
        f64::from_bits(1),
        1e-300,
        0.5,
        1.,
        1.01,
        82.,
        1e300,
        f64::MAX,
    ] {
        let r = math_value(0, x).unwrap();
        assert!((r - x.log10()).abs() <= 5e-16 * x.log10().abs().max(1.));
    }
    for i in 0..=120 {
        let x = 5. * i as f64 / 120.;
        assert!((math_value(1, x).unwrap() / 10_f64.powf(x) - 1.).abs() < 4e-15);
    }
    for i in -100..=100 {
        let x = i as f64 / 100.;
        assert!((math_value(2, x).unwrap() - x.asin()).abs() < 7e-16);
    }
}
#[test]
fn invalid_coefficients_dimensions_and_overflow_fail() {
    assert_eq!(pattern_2d(3, 0.), Err(KernelError::InvalidCoefficient));
    assert_eq!(pattern_2d(0, f64::NAN), Err(KernelError::NonFiniteValue));
    assert!(friis_link(&AntennaLinkConfig {
        frequency_hz: 0.,
        ..link()
    })
    .is_err());
    assert!(friis_link(&AntennaLinkConfig {
        frequency_hz: f64::MAX,
        ..link()
    })
    .is_err());
    assert!(antenna_link(&link(), &mut [0.; 360], &mut [0.; 121]).is_err());
    assert!(array_pattern(&array(), &mut [ArraySample::default(); 1]).is_err());
    assert!(array_factor(&ArrayConfig { n: 4097, ..array() }, 0.).is_err());
    assert!(array_factor(
        &ArrayConfig {
            d_over_lambda: f64::MAX,
            ..array()
        },
        0.
    )
    .is_err());
    for (op, x) in [
        (0, 0.),
        (0, -1.),
        (1, 5.1),
        (2, 1.1),
        (3, 1.),
        (0, f64::INFINITY),
    ] {
        assert!(math_value(op, x).is_err());
    }
    assert_eq!(core::mem::size_of::<AntennaLinkConfig>(), 48);
    assert_eq!(core::mem::size_of::<AntennaLinkReadout>(), 32);
    assert_eq!(core::mem::size_of::<Antenna3dConfig>(), 40);
    assert_eq!(core::mem::size_of::<ArrayConfig>(), 24);
    assert_eq!(core::mem::size_of::<ArraySample>(), 16);
}
