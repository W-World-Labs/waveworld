use w_sim_kernels::{sensing::*, KernelError};

struct Buffers {
    code: Vec<f64>,
    v: Vec<f64>,
    y: Vec<f64>,
    x: Vec<f64>,
    error: Vec<f64>,
    qr: Vec<f64>,
    rhs: Vec<f64>,
    permutation: Vec<u32>,
}
impl Buffers {
    fn new(p: &SensingConfig) -> Self {
        let (n, k, m) = p.dimensions().unwrap();
        Self {
            code: vec![7.; m * k],
            v: vec![7.; k],
            y: vec![7.; m],
            x: vec![7.; n],
            error: vec![7.; n],
            qr: vec![7.; (m + n) * n],
            rhs: vec![7.; m + n],
            permutation: vec![7; n],
        }
    }
    fn run(
        &mut self,
        p: &SensingConfig,
        x: &[f64],
        s: &[f64],
        bias: &[f64],
        code: Option<&[f64]>,
    ) -> Result<SensingReadout, KernelError> {
        sense_array(
            p,
            x,
            s,
            bias,
            code,
            &mut SensingBuffers {
                encoding: &mut self.code,
                sensor_voltages: &mut self.v,
                measurements: &mut self.y,
                reconstructed: &mut self.x,
                error: &mut self.error,
                qr: &mut self.qr,
                rhs: &mut self.rhs,
                permutation: &mut self.permutation,
            },
        )
    }
    fn sampled(
        &mut self,
        p: &SensingConfig,
        x: &[f64],
        s: &[f64],
        bias: &[f64],
        rc: Option<&RcSamplingConfig>,
    ) -> (SampledSensingReadout, Vec<f64>, Vec<f64>) {
        let m = p.measurements as usize;
        let mut ideal = vec![7.; m];
        let mut sampled = vec![7.; m];
        let result = sense_array_sampled(
            p,
            x,
            s,
            bias,
            None,
            &mut SensingBuffers {
                encoding: &mut self.code,
                sensor_voltages: &mut self.v,
                measurements: &mut self.y,
                reconstructed: &mut self.x,
                error: &mut self.error,
                qr: &mut self.qr,
                rhs: &mut self.rhs,
                permutation: &mut self.permutation,
            },
            &mut SensingSampling {
                rc,
                ideal_voltages: &mut ideal,
                sampled_voltages: &mut sampled,
            },
        )
        .unwrap();
        (result, ideal, sampled)
    }
}
fn config(n: u32, k: u32) -> SensingConfig {
    SensingConfig {
        n,
        sensors: k,
        measurements: k,
        encoding: 0,
        seed: 0,
        reserved: 0,
        noise_peak_v: 0.,
        lambda: 0.,
    }
}
fn near(a: f64, b: f64, tol: f64) {
    assert!((a - b).abs() <= tol, "{a} != {b}, tolerance {tol}");
}

#[test]
fn inverse_and_bias_match_two_by_two_hand_solution() {
    let p = config(2, 2);
    let mut b = Buffers::new(&p);
    let r = b
        .run(&p, &[4., -2.], &[1., 2., 3., 5.], &[7., -3.], None)
        .unwrap();
    assert_eq!(b.code, [1., 0., 0., 1.]);
    assert_eq!(b.v, [7., -1.]);
    assert_eq!(b.y, b.v);
    assert_eq!((r.rank, r.status), (2, 0));
    assert_eq!(b.permutation, [1, 0]);
    near(b.x[0], 4., 3e-14);
    near(b.x[1], -2., 3e-14);
    assert!(r.rmse < 3e-14 && r.residual_rms < 3e-14);
}
#[test]
fn normalized_sylvester_four_channel_has_expected_orthogonal_encoding() {
    let p = SensingConfig {
        encoding: 1,
        ..config(4, 4)
    };
    let mut b = Buffers::new(&p);
    let mut s = [0.; 16];
    for i in 0..4 {
        s[i * 4 + i] = 1.;
    }
    let r = b.run(&p, &[1., 2., 3., 4.], &s, &[0.; 4], None).unwrap();
    assert_eq!(
        b.code,
        [0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5]
    );
    assert_eq!(b.y, [5., -1., -2., 0.]);
    assert_eq!(r.rank, 4);
    assert!(r.rmse < 2e-15);
    for i in 0..4 {
        for j in 0..4 {
            let dot = (0..4)
                .map(|k| b.code[k * 4 + i] * b.code[k * 4 + j])
                .sum::<f64>();
            assert_eq!(dot, if i == j { 1. } else { 0. });
        }
    }
}
#[test]
fn rectangular_custom_measurement_reconstructs_calibrated_input() {
    let p = SensingConfig {
        encoding: 2,
        measurements: 4,
        ..config(2, 3)
    };
    let mut b = Buffers::new(&p);
    let code = [1., 0., 0., 0., 1., 0., 0., 0., 1., 1., -1., 1.];
    let r = b
        .run(
            &p,
            &[2., -1.],
            &[1., 0., 0., 1., 1., 1.],
            &[0.25, -0.5, 1.],
            Some(&code),
        )
        .unwrap();
    assert_eq!(b.code, code);
    assert_eq!(b.v, [2.25, -1.5, 2.]);
    assert_eq!(b.y, [2.25, -1.5, 2., 5.75]);
    assert_eq!((r.rank, r.status), (2, 0));
    near(b.x[0], 2., 2e-15);
    near(b.x[1], -1., 2e-15);
}
#[test]
fn deficient_and_underdetermined_inputs_do_not_publish_zero_reconstructions() {
    let p = config(2, 2);
    let mut b = Buffers::new(&p);
    let r = b
        .run(&p, &[3., 4.], &[1., 2., 2., 4.], &[0., 0.], None)
        .unwrap();
    assert_eq!((r.rank, r.status), (1, 1));
    assert_eq!(b.y, [11., 22.]);
    assert_eq!(b.x, [0., 0.]);
    assert_eq!(b.error, [0., 0.]);
    assert_eq!((r.rmse, r.residual_rms), (0., 0.));
    let p = config(2, 1);
    let mut b = Buffers::new(&p);
    let r = b.run(&p, &[3., 4.], &[1., 2.], &[1.], None).unwrap();
    assert_eq!((r.rank, r.status), (1, 1));
    assert_eq!(b.y, [12.]);
    let p = SensingConfig { lambda: 1., ..p };
    let r = b.run(&p, &[3., 4.], &[1., 2.], &[1.], None).unwrap();
    assert_eq!((r.rank, r.status), (1, 2));
    near(b.x[0], 11. / 6., 3e-15);
    near(b.x[1], 22. / 6., 3e-15);
    let p = config(2, 2);
    let mut b = Buffers::new(&p);
    let r = b.run(&p, &[3., 4.], &[0.; 4], &[1., 2.], None).unwrap();
    assert_eq!((r.rank, r.status, r.rank_tolerance), (0, 1, 0.));
    assert_eq!(b.y, [1., 2.]);
}
#[test]
fn augmented_qr_ridge_matches_diagonal_closed_form_and_original_rank() {
    let p = SensingConfig {
        lambda: 2.,
        ..config(2, 2)
    };
    let mut b = Buffers::new(&p);
    let r = b
        .run(&p, &[4., -2.], &[2., 0., 0., 3.], &[0., 0.], None)
        .unwrap();
    assert_eq!((r.rank, r.status), (2, 2));
    near(b.x[0], 8. / 3., 2e-15);
    near(b.x[1], -18. / 11., 2e-15);
    let errors = [8. / 3. - 4., -18. / 11. + 2.];
    for (i, e) in errors.iter().enumerate() {
        near(b.error[i], *e, 2e-15);
    }
    near(
        r.rmse,
        ((errors[0] * errors[0] + errors[1] * errors[1]) / 2.).sqrt(),
        2e-15,
    );
    near(
        r.residual_rms,
        ((4. * errors[0] * errors[0] + 9. * errors[1] * errors[1]) / 2.).sqrt(),
        2e-15,
    );
}
#[test]
fn seeded_noise_and_reused_buffers_are_reproducible_and_bias_is_removed() {
    let p = SensingConfig {
        noise_peak_v: 0.5,
        seed: u32::MAX,
        ..config(2, 2)
    };
    let mut b = Buffers::new(&p);
    let r = b
        .run(&p, &[2., -3.], &[1., 0., 0., 1.], &[4., -2.], None)
        .unwrap();
    let before = (
        b.y.clone(),
        b.x.clone(),
        b.error.clone(),
        r.rng_state,
        r.rmse,
    );
    for (i, original) in [2., -3.].iter().enumerate() {
        near(b.x[i], b.y[i] - [4., -2.][i], 2e-15);
        assert!((b.x[i] - original).abs() <= 0.5);
    }
    let r = b
        .run(&p, &[2., -3.], &[1., 0., 0., 1.], &[4., -2.], None)
        .unwrap();
    assert_eq!(
        (
            b.y.clone(),
            b.x.clone(),
            b.error.clone(),
            r.rng_state,
            r.rmse
        ),
        before
    );
    let r = b
        .run(
            &SensingConfig {
                noise_peak_v: 0.,
                ..p
            },
            &[2., -3.],
            &[1., 0., 0., 1.],
            &[4., -2.],
            None,
        )
        .unwrap();
    assert_eq!(r.rng_state, before.3);
    assert_eq!(b.x, [2., -3.]);
    assert_eq!(b.error, [0., 0.]);
}
#[test]
fn pivoted_qr_retains_solution_when_normal_equations_lose_small_separation() {
    for scale in [1., 1e-100, 1e6] {
        let p = config(2, 2);
        let mut b = Buffers::new(&p);
        let scale = if scale == 1e6 { 999_999. } else { scale };
        let s = [scale, scale, scale, scale * (1. + 1e-8)];
        let r = b.run(&p, &[1., -1.], &s, &[0., 0.], None).unwrap();
        assert_eq!((r.rank, r.status), (2, 0));
        near(b.x[0], 1., 1e-7);
        near(b.x[1], -1., 1e-7);
        assert!(r.residual_rms < scale * 1e-14);
    }
}
#[test]
fn dimensions_nonfinite_bounds_buffers_and_overflow_fail_explicitly() {
    assert_eq!(core::mem::size_of::<SensingConfig>(), 40);
    assert_eq!(core::mem::size_of::<SensingReadout>(), 40);
    for p in [
        SensingConfig {
            n: 0,
            ..config(2, 2)
        },
        SensingConfig {
            n: 65,
            ..config(2, 2)
        },
        SensingConfig {
            sensors: 65,
            ..config(2, 2)
        },
        SensingConfig {
            encoding: 2,
            measurements: 129,
            ..config(2, 2)
        },
        SensingConfig {
            encoding: 1,
            ..config(2, 3)
        },
        SensingConfig {
            measurements: 1,
            ..config(2, 2)
        },
        SensingConfig {
            noise_peak_v: f64::NAN,
            ..config(2, 2)
        },
        SensingConfig {
            lambda: -1.,
            ..config(2, 2)
        },
        SensingConfig {
            reserved: 1,
            ..config(2, 2)
        },
    ] {
        assert!(p.dimensions().is_err());
    }
    let p = config(1, 1);
    let mut b = Buffers::new(&p);
    assert_eq!(
        b.run(&p, &[f64::NAN], &[1.], &[0.], None).unwrap_err(),
        KernelError::NonFiniteValue
    );
    assert_eq!(
        b.run(&p, &[1e6 + 1.], &[1.], &[0.], None).unwrap_err(),
        KernelError::InvalidCoefficient
    );
    assert_eq!(
        b.run(&p, &[], &[1.], &[0.], None).unwrap_err(),
        KernelError::BufferLength
    );
    assert_eq!(
        b.run(&p, &[1.], &[1.], &[0.], Some(&[1.])).unwrap_err(),
        KernelError::InvalidCoefficient
    );
    assert_eq!(
        b.run(
            &SensingConfig { encoding: 2, ..p },
            &[1.],
            &[1.],
            &[0.],
            None
        )
        .unwrap_err(),
        KernelError::InvalidCoefficient
    );
    assert_eq!(
        b.run(
            &SensingConfig {
                noise_peak_v: 1.,
                ..p
            },
            &[0.],
            &[f64::from_bits(1)],
            &[0.],
            None
        )
        .unwrap_err(),
        KernelError::NonFiniteValue
    );
    assert_eq!(b.x, [0.]);
}

#[test]
fn unresolvable_regularization_is_rejected_without_an_arbitrary_lambda_floor() {
    let p = SensingConfig {
        lambda: 1e-30,
        ..config(2, 2)
    };
    let mut b = Buffers::new(&p);
    assert_eq!(
        b.run(&p, &[3., 4.], &[1., 2., 2., 4.], &[0., 0.], None)
            .unwrap_err(),
        KernelError::InvalidState
    );
    assert_eq!(b.x, [0., 0.]);
    let p = SensingConfig {
        lambda: f64::from_bits(1),
        ..p
    };
    let r = b.run(&p, &[3., 4.], &[0.; 4], &[0., 0.], None).unwrap();
    assert_eq!((r.rank, r.status), (0, 2));
    assert_eq!(b.x, [0., 0.]);
}

#[test]
fn serial_rc_tau_and_sign_switch_decode_with_the_filtered_operator() {
    let p = config(2, 2);
    let mut b = Buffers::new(&p);
    let rc = RcSamplingConfig {
        resistance: 1.,
        capacitance: 1.,
        dwell: 1.,
        initial_voltage: 0.,
    };
    let (r, ideal, sampled) = b.sampled(&p, &[2., -2.], &[1., 0., 0., 1.], &[0., 0.], Some(&rc));
    let decay = (-1.0f64).exp();
    let q = 1. - decay;
    assert_eq!(ideal, [2., -2.]);
    near(sampled[0], 2. * q, 1e-15);
    near(sampled[1], -2. * q * q, 1e-15);
    assert_eq!(b.y, sampled);
    assert_eq!((r.sensing.rank, r.sensing.status), (2, 0));
    near(b.x[0], 2., 3e-15);
    near(b.x[1], -2., 3e-15);
    near(r.settling_fraction, q, 2e-16);
    assert_eq!(r.tau, 1.);
    // Post-solve RC scratch contains the actual causal A, not ideal identity.
    near(b.qr[0], q, 2e-16);
    assert_eq!(b.qr[1], 0.);
    near(b.qr[2], decay * q, 2e-16);
    near(b.qr[3], q, 2e-16);
}
#[test]
fn rc_filters_initial_voltage_and_bias_without_feedback_of_measurement_noise() {
    let p = config(2, 2);
    let mut b = Buffers::new(&p);
    let rc = RcSamplingConfig {
        resistance: 2.,
        capacitance: 0.5,
        dwell: 0.2,
        initial_voltage: 1.5,
    };
    let (r, ideal, without_noise) =
        b.sampled(&p, &[3., -4.], &[1., 2., 2., -1.], &[2., -3.], Some(&rc));
    assert_eq!(ideal, [-3., 7.]);
    near(b.x[0], 3., 1e-14);
    near(b.x[1], -4., 1e-14);
    let d = (-0.2f64).exp();
    near(without_noise[0], d * 1.5 + (1. - d) * (-3.), 2e-15);
    near(
        without_noise[1],
        d * without_noise[0] + (1. - d) * 7.,
        2e-15,
    );
    let (noisy, again, sampled) = b.sampled(
        &SensingConfig {
            noise_peak_v: 0.5,
            ..p
        },
        &[3., -4.],
        &[1., 2., 2., -1.],
        &[2., -3.],
        Some(&rc),
    );
    assert_eq!(sampled, without_noise);
    assert_eq!(again, ideal);
    assert_eq!(r.sensing.rng_state, noisy.sensing.rng_state);
    assert!(b.y.iter().zip(sampled).all(|(y, v)| (y - v).abs() <= 0.5));
}
#[test]
fn rc_extreme_dwell_preserves_small_settling_and_reaches_large_dwell_target() {
    let p = config(2, 2);
    let mut b = Buffers::new(&p);
    let tiny = RcSamplingConfig {
        resistance: 1e12,
        capacitance: 1.,
        dwell: 1e-12,
        initial_voltage: 0.,
    };
    let (r, _, sampled) = b.sampled(&p, &[1., 2.], &[1., 0., 0., 1.], &[0., 0.], Some(&tiny));
    assert!(r.settling_fraction > 0.);
    near(r.settling_fraction, 1e-24, 2e-40);
    near(sampled[0], 1e-24, 2e-40);
    near(sampled[1], 3e-24, 6e-40);
    near(b.x[0], 1., 2e-15);
    near(b.x[1], 2., 3e-15);
    let large = RcSamplingConfig {
        resistance: 1e-3,
        capacitance: 1e-15,
        dwell: 1e3,
        initial_voltage: 3.,
    };
    let (r, ideal, sampled) = b.sampled(&p, &[1., 2.], &[1., 0., 0., 1.], &[0., 0.], Some(&large));
    assert_eq!((r.settling_fraction, r.decay), (1., 0.));
    assert_eq!(ideal, sampled);
    assert_eq!(b.x, [1., 2.]);
}
#[test]
fn sampled_static_path_keeps_every_existing_output_and_rank_deficiency() {
    let p = SensingConfig {
        noise_peak_v: 0.25,
        lambda: 0.1,
        ..config(2, 2)
    };
    let mut b = Buffers::new(&p);
    let r = b
        .run(&p, &[4., -2.], &[1., 2., 3., 5.], &[7., -3.], None)
        .unwrap();
    let before = (
        b.code.clone(),
        b.v.clone(),
        b.y.clone(),
        b.x.clone(),
        b.error.clone(),
        b.qr.clone(),
        b.rhs.clone(),
        b.permutation.clone(),
    );
    let (after, ideal, sampled) = b.sampled(&p, &[4., -2.], &[1., 2., 3., 5.], &[7., -3.], None);
    assert_eq!(
        before,
        (
            b.code.clone(),
            b.v.clone(),
            b.y.clone(),
            b.x.clone(),
            b.error.clone(),
            b.qr.clone(),
            b.rhs.clone(),
            b.permutation.clone()
        )
    );
    assert_eq!(
        (r.rmse, r.residual_rms, r.rank, r.status),
        (
            after.sensing.rmse,
            after.sensing.residual_rms,
            after.sensing.rank,
            after.sensing.status
        )
    );
    assert_eq!(
        (after.settling_fraction, after.decay, after.tau),
        (1., 0., 0.)
    );
    assert_eq!(ideal, sampled);
    let rc = RcSamplingConfig {
        resistance: 1.,
        capacitance: 1.,
        dwell: 1.,
        initial_voltage: 0.,
    };
    let (r, _, _) = b.sampled(
        &config(2, 2),
        &[3., 4.],
        &[1., 2., 2., 4.],
        &[0., 0.],
        Some(&rc),
    );
    assert_eq!((r.sensing.rank, r.sensing.status), (1, 1));
    assert_eq!(b.x, [0., 0.]);
    assert_eq!(core::mem::size_of::<RcSamplingConfig>(), 32);
    assert_eq!(core::mem::size_of::<SampledSensingReadout>(), 64);
}
