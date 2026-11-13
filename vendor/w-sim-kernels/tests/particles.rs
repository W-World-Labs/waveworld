use w_sim_kernels::md::*;
use w_sim_kernels::KernelError;

fn config(n: usize, dim: usize) -> MdConfig {
    MdConfig {
        n,
        dim,
        dt: 0.005,
        rc: 2.5,
    }
}
fn screening() -> ScreeningParams {
    ScreeningParams {
        eps_r: 3.2,
        lambda_d: 0.9,
        k_coulomb: 0.7,
    }
}

#[test]
fn heterogeneous_pair_uses_lorentz_berthelot_and_ordered_coulomb_sum() {
    let p = ParticleProperties {
        charge: &[1., -0.5],
        sigma: &[0.8, 1.2],
        epsilon: &[0.5, 2.],
    };
    let c = config(2, 2);
    let s = screening();
    let r = 1.5f64;
    let sigma = (0.8f32 as f64 + 1.2f32 as f64) * 0.5;
    let sr6 = (sigma * sigma / (r * r)).powi(3);
    let cut6 = (sigma / 2.5).powi(6);
    let u_lj = 4. * (sr6 * sr6 - sr6) - 4. * (cut6 * cut6 - cut6);
    let f_lj = (24. / (r * r)) * (2. * sr6 * sr6 - sr6);
    let constant = -0.5 * s.k_coulomb / s.eps_r;
    let e = (-r / s.lambda_d).exp();
    let uc = constant * e / r;
    let fc = constant * e * (1. / (s.lambda_d * r * r) + 1. / (r * r * r));
    let mut f = [0.; 4];
    let stats = compute_particle_forces(&c, 8., &[0., 0., 1.5, 0.], &mut f, &p, &s).unwrap();
    assert!((stats.potential - (u_lj + uc)).abs() < 1e-14);
    assert!((stats.virial - (f_lj + fc) * r * r).abs() < 1e-14);
    assert_eq!(f[0], ((f_lj + fc) * -r) as f32);
    assert_eq!(f[0], -f[2]);
    assert_eq!(f[1], 0.);
    // Small sigma/rc must not evaluate an unrelated unit-sigma shift that overflows.
    let c = MdConfig { rc: 2.5e-30, ..c };
    let p = ParticleProperties {
        charge: &[0., 0.],
        sigma: &[1e-30, 1e-30],
        epsilon: &[1., 1.],
    };
    let tiny = compute_particle_forces(
        &c,
        8.,
        &[0., 0., 1.5e-30, 0.],
        &mut f,
        &p,
        &ScreeningParams { k_coulomb: 0., ..s },
    )
    .unwrap();
    assert!(tiny.potential.is_finite() && f.iter().all(|v| v.is_finite()));
}

#[test]
fn signed_charge_force_and_soft_core_floors_match_existing_formula() {
    let c = config(2, 2);
    for q in [-1., 0., 1.] {
        let p = ParticleProperties {
            charge: &[1., q],
            sigma: &[1., 1.],
            epsilon: &[0., 0.],
        };
        let mut f = [0.; 4];
        let s = screening();
        compute_particle_forces(&c, 8., &[0., 0., 1., 0.], &mut f, &p, &s).unwrap();
        assert_eq!(f[0].signum(), if q == 0. { 1. } else { -q });
        assert_eq!(f[0], -f[2]);
    }
    let r = 1e-5f32 as f64;
    let s = ScreeningParams {
        eps_r: -1.,
        lambda_d: 0.,
        k_coulomb: 1.,
    };
    let p = ParticleProperties {
        charge: &[1., -1.],
        sigma: &[1e-6, 1e-6],
        epsilon: &[0., 0.],
    };
    let mut f = [0.; 4];
    let actual = compute_particle_forces(&c, 8., &[0., 0., r as f32, 0.], &mut f, &p, &s).unwrap();
    let e = (-100f64).exp();
    let expected_u = -1e6 * e / 1e-4;
    let expected_f = -1e6 * e * (1. / (1e-6 * 1e-8) + 1. / (1e-4 * 1e-8));
    assert!((actual.potential / expected_u - 1.).abs() < 1e-13);
    assert!((actual.virial / (expected_f * r * r) - 1.).abs() < 1e-13);
    assert_eq!(f[0], (-r * expected_f) as f32);
}

#[test]
fn uniform_no_coulomb_keeps_md_batches_and_observables_bitwise() {
    for steps in 1..=4 {
        for target in [None, Some(0.3)] {
            let c = config(4, 2);
            let mut a = MdScalars {
                box_l: 8.,
                ..Default::default()
            };
            let mut b = a;
            let mut pos = [1., 1., 2.4, 1.1, 1.2, 2.6, 2.65, 2.5];
            let mut vel = [0.12, -0.04, -0.08, 0.05, 0.03, 0.1, -0.07, -0.11];
            let (mut pp, mut vv, mut ff, mut uu) = (pos, vel, [0.; 8], [0.; 8]);
            let (mut force, mut unwrapped) = ([0.; 8], [0.; 8]);
            let p = ParticleProperties {
                charge: &[1., -1., 0., 0.5],
                sigma: &[1.; 4],
                epsilon: &[1.; 4],
            };
            let s = ScreeningParams {
                k_coulomb: 0.,
                ..screening()
            };
            let mut md = MdBuffers {
                pos: &mut pos,
                vel: &mut vel,
                force: &mut force,
                unwrapped: &mut unwrapped,
            };
            let mut particles = MdBuffers {
                pos: &mut pp,
                vel: &mut vv,
                force: &mut ff,
                unwrapped: &mut uu,
            };
            init_md(&c, &mut a, &mut md).unwrap();
            init_particles(&c, &mut b, &mut particles, &p, &s).unwrap();
            batch_md(
                &c,
                &mut a,
                &mut md,
                &MdBath {
                    target_temperature: target,
                    target_pressure: None,
                    tau_p: 1.,
                    kappa_t: 1.,
                    max_scale: 0.02,
                },
                steps,
            )
            .unwrap();
            batch_particles(&c, &mut b, &mut particles, &p, &s, target, steps).unwrap();
            assert_eq!(md.pos, particles.pos);
            assert_eq!(md.vel, particles.vel);
            assert_eq!(md.force, particles.force);
            assert_eq!(md.unwrapped, particles.unwrapped);
            assert_eq!(a.potential.to_bits(), b.potential.to_bits());
            assert_eq!(a.virial.to_bits(), b.virial.to_bits());
            assert_eq!(a.last_temperature.to_bits(), b.last_temperature.to_bits());
        }
    }
}

#[test]
fn charged_nve_preserves_small_case_energy_momentum_and_charge() {
    let c = config(4, 2);
    let mut s = MdScalars {
        box_l: 8.,
        ..Default::default()
    };
    let mut pos = [1., 1., 2.4, 1.1, 1.2, 2.6, 2.65, 2.5];
    let pos0 = pos;
    let mut vel = [0.12, -0.04, -0.08, 0.05, 0.03, 0.1, -0.07, -0.11];
    let momentum = [
        vel.iter().step_by(2).sum::<f32>(),
        vel.iter().skip(1).step_by(2).sum::<f32>(),
    ];
    let (mut force, mut unwrapped) = ([0.; 8], [0.; 8]);
    let p = ParticleProperties {
        charge: &[1., -1., 0., 0.5],
        sigma: &[0.8, 1., 0.9, 1.1],
        epsilon: &[0.8, 1.2, 0., 1.1],
    };
    let mut b = MdBuffers {
        pos: &mut pos,
        vel: &mut vel,
        force: &mut force,
        unwrapped: &mut unwrapped,
    };
    init_particles(&c, &mut s, &mut b, &p, &screening()).unwrap();
    let before = read_particles(&c, &s, &pos0, b.vel, b.unwrapped, p.charge, &mut [0.; 4]).unwrap();
    for _ in 0..2 {
        batch_particles(&c, &mut s, &mut b, &p, &screening(), None, 4).unwrap();
    }
    let after = read_particles(&c, &s, &pos0, b.vel, b.unwrapped, p.charge, &mut [0.; 4]).unwrap();
    assert!((after.md.total - before.md.total).abs() < 1e-4);
    assert_eq!(after.total_charge, 0.5);
    for (axis, expected) in momentum.into_iter().enumerate() {
        assert!((b.vel.iter().skip(axis).step_by(2).sum::<f32>() - expected).abs() < 1e-7);
    }
}

#[test]
fn force_helpers_accept_two_three_dimensions_and_unwrapped_periodic_coordinates() {
    for dim in [2, 3] {
        let c = config(2, dim);
        let mut p = vec![0.; 2 * dim];
        p[dim] = 2.;
        let properties = ParticleProperties {
            charge: &[1., -1.],
            sigma: &[0.8, 1.1],
            epsilon: &[0.8, 1.2],
        };
        let mut f = vec![0.; p.len()];
        let a = compute_particle_forces(&c, 4., &p, &mut f, &properties, &screening()).unwrap();
        for x in &mut p {
            *x += 12.;
        }
        let mut translated = vec![0.; p.len()];
        let b = compute_particle_forces(&c, 4., &p, &mut translated, &properties, &screening())
            .unwrap();
        assert_eq!(f, translated);
        assert_eq!(a.potential, b.potential);
        assert_eq!(a.virial, b.virial);
    }
}

#[test]
fn invalid_particle_properties_and_screening_fail_before_advancing() {
    let c = config(2, 2);
    let mut f = [7.; 4];
    let mut p = ParticleProperties {
        charge: &[1., -1.],
        sigma: &[1., 1.],
        epsilon: &[1., 1.],
    };
    for sigma in [&[0., 1.][..], &[-1., 1.], &[f32::NAN, 1.], &[1.]] {
        p.sigma = sigma;
        assert!(
            compute_particle_forces(&c, 8., &[0., 0., 1., 0.], &mut f, &p, &screening()).is_err()
        );
        assert_eq!(f, [7.; 4]);
    }
    p.sigma = &[1., 1.];
    p.epsilon = &[-1., 1.];
    assert!(compute_particle_forces(&c, 8., &[0., 0., 1., 0.], &mut f, &p, &screening()).is_err());
    p.epsilon = &[1., 1.];
    for s in [
        ScreeningParams {
            eps_r: f64::INFINITY,
            ..screening()
        },
        ScreeningParams {
            lambda_d: f64::NAN,
            ..screening()
        },
        ScreeningParams {
            k_coulomb: -1.,
            ..screening()
        },
    ] {
        assert!(compute_particle_forces(&c, 8., &[0., 0., 1., 0.], &mut f, &p, &s).is_err());
    }
    assert_eq!(
        compute_particle_forces(&c, 8., &[0.; 4], &mut f, &p, &screening()).unwrap_err(),
        KernelError::InvalidState
    );
}
