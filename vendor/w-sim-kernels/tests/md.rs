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
fn bath() -> MdBath {
    MdBath {
        target_temperature: None,
        target_pressure: None,
        tau_p: 0.8,
        kappa_t: 1.,
        max_scale: 0.02,
    }
}
struct Fields {
    pos: Vec<f32>,
    vel: Vec<f32>,
    force: Vec<f32>,
    unwrapped: Vec<f32>,
}
impl Fields {
    fn new(pos: Vec<f32>, vel: Vec<f32>) -> Self {
        let n = pos.len();
        Self {
            pos,
            vel,
            force: vec![0.; n],
            unwrapped: vec![0.; n],
        }
    }
    fn buffers(&mut self) -> MdBuffers<'_> {
        MdBuffers {
            pos: &mut self.pos,
            vel: &mut self.vel,
            force: &mut self.force,
            unwrapped: &mut self.unwrapped,
        }
    }
}
#[test]
fn pair_force_is_symmetric_and_preserves_periodic_negative_half_ties() {
    let c = config(2, 2);
    let mut f = [0.; 4];
    let stats = compute_lj_forces(&c, 4., &[0., 0., 2., 0.], &mut f).unwrap();
    assert!(f[0] > 0.);
    assert_eq!(f[0], -f[2]);
    assert_eq!(f[1], 0.);
    assert!(stats.potential < 0.);
    let mut translated = [0.; 4];
    let other = compute_lj_forces(&c, 4., &[12., 8., 14., 8.], &mut translated).unwrap();
    assert_eq!(f, translated);
    assert_eq!(stats.potential, other.potential);
    assert_eq!(stats.virial, other.virial);
    let mut reverse = [0.; 4];
    compute_lj_forces(&c, 4., &[2., 0., 0., 0.], &mut reverse).unwrap();
    assert_eq!(f, reverse);
    let mut rc = config(2, 2);
    rc.rc = 1.5;
    let r = compute_lj_forces(&rc, 8., &[0., 0., 1.5, 0.], &mut f).unwrap();
    assert_eq!(f, [0.; 4]);
    assert_eq!(r.potential, 0.);
}
#[test]
fn nve_verlet_keeps_small_case_energy_and_total_momentum() {
    let c = config(2, 2);
    let mut s = MdScalars {
        box_l: 8.,
        ..Default::default()
    };
    let mut f = Fields::new(vec![1., 1., 2.4, 1.], vec![0.1, 0., -0.1, 0.]);
    let pos0 = f.pos.clone();
    init_md(&c, &mut s, &mut f.buffers()).unwrap();
    let mut speed = [0.; 2];
    let initial = read_md(&c, &s, &pos0, &f.vel, &f.unwrapped, &mut speed).unwrap();
    for _ in 0..8 {
        step_md(&c, &mut s, &mut f.buffers()).unwrap();
    }
    let after = read_md(&c, &s, &pos0, &f.vel, &f.unwrapped, &mut speed).unwrap();
    assert!((after.total - initial.total).abs() < 1e-4);
    assert!((f.vel[0] + f.vel[2]).abs() < 1e-7);
    assert!(after.msd > 0.);
}
#[test]
fn thermostat_applies_one_batch_scale_for_all_partial_sizes() {
    for steps in 1..=4 {
        let c = config(1, 2);
        let mut s = MdScalars {
            box_l: 4.5,
            ..Default::default()
        };
        let mut f = Fields::new(vec![1., 1.], vec![0.2, 0.4]);
        init_md(&c, &mut s, &mut f.buffers()).unwrap();
        let mut b = bath();
        b.target_temperature = Some(0.3);
        batch_md(&c, &mut s, &mut f.buffers(), &b, steps).unwrap();
        assert!((s.last_temperature - 0.3).abs() < 1e-7);
    }
}
#[test]
fn npt_guards_scale_coordinates_and_recompute_force_without_scaling_velocity() {
    for dim in [2, 3] {
        for target in [-1e8, 1e8] {
            let c = config(2, dim);
            let mut s = MdScalars {
                box_l: 8.,
                ..Default::default()
            };
            let mut p = vec![1.; 2 * dim];
            p[dim] = 2.4;
            let mut f = Fields::new(p, vec![0.1; 2 * dim]);
            init_md(&c, &mut s, &mut f.buffers()).unwrap();
            let pos = f.pos.clone();
            let vel = f.vel.clone();
            let old = f.force.clone();
            let mut b = bath();
            b.target_pressure = Some(target);
            let scale = barostat_md(&c, &mut s, &mut f.buffers(), &b).unwrap();
            assert_eq!(scale, if target > 0. { 0.98 } else { 1.02 });
            assert_eq!(s.box_l, 8. * scale);
            assert_eq!(vel, f.vel);
            assert_ne!(old, f.force);
            for (i, &p) in pos.iter().enumerate() {
                assert_eq!(f.pos[i], (p as f64 * scale) as f32);
                assert_eq!(f.unwrapped[i], f.pos[i]);
            }
            let mut force = vec![0.; 2 * dim];
            let check = compute_lj_forces(&c, s.box_l, &f.pos, &mut force).unwrap();
            assert_eq!(force, f.force);
            assert_eq!(check.potential, s.potential);
            assert_eq!(check.virial, s.virial);
        }
    }
}
#[test]
fn disabled_or_infinite_tau_barostat_is_bitwise_noop() {
    let c = config(1, 2);
    let mut s = MdScalars {
        box_l: 4.5,
        ..Default::default()
    };
    let mut f = Fields::new(vec![1., 1.], vec![0.2, 0.4]);
    init_md(&c, &mut s, &mut f.buffers()).unwrap();
    for tau in [f64::INFINITY, 0., -1., f64::NAN] {
        let mut b = bath();
        b.target_pressure = Some(0.1);
        b.tau_p = tau;
        let before = (
            f.pos.clone(),
            f.unwrapped.clone(),
            f.force.clone(),
            s.box_l.to_bits(),
        );
        assert_eq!(barostat_md(&c, &mut s, &mut f.buffers(), &b).unwrap(), 1.);
        assert_eq!(
            before,
            (
                f.pos.clone(),
                f.unwrapped.clone(),
                f.force.clone(),
                s.box_l.to_bits()
            )
        );
    }
}
#[test]
fn wrapped_position_and_unwrapped_msd_use_separate_float32_stores() {
    let c = config(1, 2);
    let mut s = MdScalars {
        box_l: 4.,
        ..Default::default()
    };
    let mut f = Fields::new(vec![3.99, 0.01], vec![4., -4.]);
    let pos0 = f.pos.clone();
    init_md(&c, &mut s, &mut f.buffers()).unwrap();
    step_md(&c, &mut s, &mut f.buffers()).unwrap();
    assert!(f.pos[0] < 0.02 && f.pos[1] > 3.98);
    assert!(f.unwrapped[0] > 4. && f.unwrapped[1] < 0.);
    let obs = read_md(&c, &s, &pos0, &f.vel, &f.unwrapped, &mut [0.]).unwrap();
    assert!((obs.msd - 0.0008).abs() < 1e-8);
}
#[test]
fn rdf_counts_and_diffusion_fit_use_current_box_and_actual_times() {
    let c = config(2, 2);
    let mut hist = [0.; 4];
    let mut r = [0.; 4];
    let mut g = [0.; 4];
    let counts =
        radial_distribution(&c, 8., &[0., 0., 1.25, 0.], 99., &mut hist, &mut r, &mut g).unwrap();
    assert_eq!(counts.r_max, 4.);
    assert_eq!(counts.pair_count, 1);
    assert_eq!(hist, [0., 1., 0., 0.]);
    assert_eq!(r, [0.5, 1.5, 2.5, 3.5]);
    assert!((g[1] as f64 - 32. / (3. * core::f64::consts::PI)).abs() < 1e-6);
    let fit = diffusion_einstein(&[0., 0.02, 0.07, 0.1], &[1., 1.08, 1.28, 1.4], 2, 0.).unwrap();
    assert!((fit.diffusion - 1.).abs() < 1e-12);
    assert!((fit.intercept - 1.).abs() < 1e-12);
    assert_eq!(fit.n_fit, 4);
    assert_eq!(diffusion_einstein(&[], &[], 3, 0.2).unwrap().n_fit, 0);
}
#[test]
fn invalid_inputs_and_overlap_fail_instead_of_publishing_fake_finite_results() {
    let c = config(2, 2);
    assert_eq!(
        compute_lj_forces(&c, 8., &[1., 1., 1., 1.], &mut [0.; 4]).unwrap_err(),
        KernelError::InvalidState
    );
    assert_eq!(
        compute_lj_forces(&c, 8., &[0.; 3], &mut [0.; 4]).unwrap_err(),
        KernelError::BufferLength
    );
    assert_eq!(
        compute_lj_forces(&c, 8., &[f32::NAN, 0., 1., 1.], &mut [0.; 4]).unwrap_err(),
        KernelError::NonFiniteValue
    );
    let mut bad = c;
    bad.dim = 4;
    assert_eq!(
        compute_lj_forces(&bad, 8., &[0.; 8], &mut [0.; 8]).unwrap_err(),
        KernelError::UnsupportedFeature
    );
    let c = config(1, 2);
    let mut s = MdScalars {
        box_l: 4.,
        ..Default::default()
    };
    let mut f = Fields::new(vec![1., 1.], vec![0.1, 0.]);
    init_md(&c, &mut s, &mut f.buffers()).unwrap();
    for steps in [0, 5, 50] {
        assert_eq!(
            batch_md(&c, &mut s, &mut f.buffers(), &bath(), steps),
            Err(KernelError::InvalidCoefficient)
        );
    }
    let mut b = bath();
    b.target_temperature = Some(-1.);
    assert!(batch_md(&c, &mut s, &mut f.buffers(), &b, 1).is_err());
    assert!(diffusion_einstein(&[0., f64::NAN], &[0., 1.], 2, 0.).is_err());
}
