use w_sim_kernels::{ode::*, KernelError};
#[test]
fn rlc_lossless_energy_damped_decay_and_chunks() {
    let p = RlcConfig {
        l: 2.,
        c: 0.5,
        r: 0.,
        voltage: 0.,
        dt: 0.01,
    };
    let initial = RlcState { q: 1., i: 0. };
    let mut s = initial;
    let mut out = [initial; 4];
    advance_rlc(&p, &mut s, &mut out).unwrap();
    let energy = read_rlc(&p, initial).unwrap().energy;
    assert!((read_rlc(&p, s).unwrap().energy - energy).abs() < 1e-12);
    assert!(read_rlc(&p, s).unwrap().quality_factor.is_none());
    let mut split = initial;
    advance_rlc(&p, &mut split, &mut [initial; 1]).unwrap();
    advance_rlc(&p, &mut split, &mut [initial; 3]).unwrap();
    assert_eq!((s.q, s.i), (split.q, split.i));
    let damped = RlcConfig { r: 2., ..p };
    assert!(
        read_rlc(&damped, rlc_step(initial, &damped).unwrap())
            .unwrap()
            .energy
            < energy
    );
}
#[test]
fn mutual_clamp_substeps_accounting_and_chunked_drive() {
    let p = MutualConfig {
        l1: 1.,
        l2: 0.09,
        m: 0.297,
        r1: 2.,
        r2: 4.,
        v1: 10.,
        v2: 0.,
        dt: 1. / 240.,
    };
    let mut run = MutualRunState::default();
    let mut out = [MutualState::default(); 4];
    let mut shares = [0.; 4];
    advance_mutual(
        &p,
        &mut run,
        0,
        true,
        4. * core::f64::consts::PI,
        &mut out,
        &mut shares,
    )
    .unwrap();
    assert_eq!(read_mutual(&p, run).unwrap().substeps, 5);
    assert!(run.primary_dissipation > 0. && run.secondary_dissipation > 0.);
    assert!(shares.iter().all(|x| *x > 0. && *x < 1.));
    let mut split = MutualRunState::default();
    advance_mutual(
        &p,
        &mut split,
        0,
        true,
        4. * core::f64::consts::PI,
        &mut out[..1],
        &mut shares[..1],
    )
    .unwrap();
    advance_mutual(
        &p,
        &mut split,
        1,
        true,
        4. * core::f64::consts::PI,
        &mut out[1..],
        &mut shares[1..],
    )
    .unwrap();
    assert_eq!(
        (
            run.i1,
            run.i2,
            run.primary_dissipation,
            run.secondary_dissipation
        ),
        (
            split.i1,
            split.i2,
            split.primary_dissipation,
            split.secondary_dissipation
        )
    );
    for sign in [-1., 1.] {
        let cap = MutualConfig {
            m: sign * 0.99 * 0.3,
            ..p
        };
        let excess = MutualConfig { m: sign * 2., ..p };
        let a = mutual_step(MutualState::default(), &cap).unwrap();
        let b = mutual_step(MutualState::default(), &excess).unwrap();
        assert_eq!((a.i1, a.i2), (b.i1, b.i2));
        assert!(
            read_mutual(&excess, MutualRunState::default())
                .unwrap()
                .coupling
                .abs()
                > 1.
        );
    }
}
#[test]
fn oscillator_drive_uses_stage_time_and_resonance_is_finite_off_singularity() {
    let p = OscillatorConfig {
        mass: 1.,
        stiffness: 4.,
        damping: 0.2,
        drive_amp: 1.,
        drive_omega: 2.,
        dt: 0.01,
    };
    let mut state = OscillatorState::default();
    let mut out = [state; 4];
    advance_oscillator(&p, &mut state, 7, &mut out).unwrap();
    let mut by_step = OscillatorState::default();
    for i in 7..11 {
        by_step = oscillator_step(by_step, &p, i as f64 * p.dt).unwrap();
    }
    assert_eq!((state.x, state.v), (by_step.x, by_step.v));
    assert!(state.x > 0. && state.v > 0.);
    let shifted =
        oscillator_step(OscillatorState::default(), &p, core::f64::consts::PI / 2.).unwrap();
    assert!(shifted.v < 0.);
    assert_eq!(oscillator_omega0(1., 4.).unwrap(), 2.);
    assert!(oscillator_amplitude(&p, 2.).unwrap() > oscillator_amplitude(&p, 4.).unwrap());
    assert!(oscillator_amplitude(&OscillatorConfig { damping: 0., ..p }, 2.).is_err());
}
#[test]
fn neuron_pulse_overlap_is_boolean_and_zero_crossings_are_upward_only() {
    let p = NeuronConfig {
        current: 1.,
        dt: 0.06,
        pulse_steps: 54.,
    };
    let initial = NeuronState { v: -0.01, w: -0.5 };
    let mut s = initial;
    let mut out = [0.; 4];
    let mut flags = [0; 4];
    advance_neuron(&p, &mut s, &[0, 1], 52, &mut out, &mut flags).unwrap();
    assert_eq!(flags, [1, 0, 0, 0]);
    let mut reference = initial;
    for step in 52..56 {
        reference = neuron_step(
            reference,
            &NeuronConfig {
                current: if step < 55 { 1. } else { 0. },
                ..p
            },
        )
        .unwrap();
    }
    assert_eq!((s.v, s.w), (reference.v, reference.w));
    assert_eq!(peak(&[-2., -0.1, -1.]).unwrap(), -0.1);
}
#[test]
fn invalid_coefficients_buffers_and_overflow_fail_explicitly() {
    let p = RlcConfig {
        l: 1.,
        r: 0.,
        c: 1.,
        voltage: 0.,
        dt: 0.01,
    };
    let s = RlcState { q: 1., i: 0. };
    for dt in [0., -1., f64::NAN, f64::INFINITY] {
        assert!(rlc_step(s, &RlcConfig { dt, ..p }).is_err());
    }
    assert!(rlc_step(s, &RlcConfig { c: 0., ..p }).is_err());
    assert!(rlc_step(RlcState { q: f64::NAN, ..s }, &p).is_err());
    assert!(rlc_step(
        s,
        &RlcConfig {
            voltage: f64::MAX,
            dt: 2.,
            ..p
        }
    )
    .is_err());
    assert!(advance_rlc(&p, &mut s.clone(), &mut []).is_err());
    let n = NeuronConfig {
        current: 1.,
        dt: 0.06,
        pulse_steps: 54.,
    };
    let mut neuron = NeuronState { v: -1.2, w: -0.6 };
    assert_eq!(
        advance_neuron(&n, &mut neuron, &[2, 1], 0, &mut [0.; 2], &mut [0; 2]),
        Err(KernelError::InvalidCoefficient)
    );
    assert!(advance_neuron(
        &n,
        &mut neuron,
        &[],
        u32::MAX as usize,
        &mut [0.; 2],
        &mut [0; 2]
    )
    .is_err());
    assert!(advance_neuron(&n, &mut neuron, &[], 0, &mut [0.; 2], &mut [0; 1]).is_err());
    assert!(neuron_step(NeuronState { v: f64::MAX, w: 0. }, &n).is_err());
    assert!(peak(&[]).is_err());
    assert!(peak(&[f64::NAN]).is_err());
}
