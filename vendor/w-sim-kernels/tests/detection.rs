use w_sim_kernels::{laser::*, nljd::*, radar::*, KernelError};
fn config() -> RadarConfig {
    RadarConfig {
        total_steps: 5,
        mode: 0,
        probes: [20024, 20026, 6120, NO_PROBE],
        reserved: [0; 2],
    }
}
#[test]
fn radar_chunks_share_cadence_and_complete_reset() {
    let p = config();
    let mut s = RadarState::default();
    let mut f0 = vec![0.; CELLS];
    let mut f1 = vec![0.; CELLS];
    let mut mask = vec![0; CELLS];
    let mut traces = vec![0.; 4 * BUFFER];
    let mut b = RadarBuffers {
        field0: &mut f0,
        field1: &mut f1,
        mask: &mut mask,
        traces: &mut traces,
    };
    init_radar(&p, &mut s, &mut b).unwrap();
    assert_eq!(b.mask[120 + 30 * N], 1);
    assert_eq!(b.mask[119 + 30 * N], 0);
    assert_eq!(b.mask[174 + 150 * N], 1);
    assert_eq!(s.current, 0);
    advance_radar(&p, &mut s, &mut b, 2).unwrap();
    assert_eq!(s.lengths, [1, 1, 1, 0]);
    advance_radar(&p, &mut s, &mut b, 2).unwrap();
    assert_eq!(s.lengths, [2, 2, 2, 0]);
    advance_radar(&p, &mut s, &mut b, 1).unwrap();
    assert_eq!(s.lengths, [3, 3, 3, 0]);
    assert!(read_radar(&s, b.traces).unwrap()[0].unwrap().v > 0.);
    assert_eq!(read_radar(&s, b.traces).unwrap()[2].unwrap().v, 0.);
    let expected = (b.field0.to_vec(), b.field1.to_vec(), b.traces.to_vec());
    init_radar(&p, &mut s, &mut b).unwrap();
    assert!(b.field0.iter().all(|&v| v == 0.));
    advance_radar(&p, &mut s, &mut b, 5).unwrap();
    // field1 packs Hx/Hy as i16 lanes: compare bit patterns, since the packed
    // words may decode as NaN when read as f32.
    assert_eq!(&*b.field0, &expected.0[..]);
    assert_eq!(
        b.field1.iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
        expected.1.iter().map(|v| v.to_bits()).collect::<Vec<_>>()
    );
    assert_eq!(&*b.traces, &expected.2[..]);
}
#[test]
fn radar_checkpoint_rolls_history_without_running_512_steps() {
    let p = RadarConfig {
        total_steps: 515,
        mode: 1,
        ..config()
    };
    let mut s = RadarState::default();
    let mut f0 = vec![0.; CELLS];
    let mut f1 = vec![0.; CELLS];
    let mut mask = vec![0; CELLS];
    let mut traces = vec![0.; 4 * BUFFER];
    let mut b = RadarBuffers {
        field0: &mut f0,
        field1: &mut f1,
        mask: &mut mask,
        traces: &mut traces,
    };
    init_radar(&p, &mut s, &mut b).unwrap();
    s.completed = 512;
    s.lengths = [256, 256, 256, 0];
    for (i, v) in b.traces[..3 * BUFFER].iter_mut().enumerate() {
        *v = i as f64;
    }
    advance_radar(&p, &mut s, &mut b, 3).unwrap();
    assert_eq!(s.heads, [2, 2, 2, 0]);
    assert_eq!(s.lengths, [256, 256, 256, 0]);
    assert_eq!(s.completed, 515);
    assert_eq!(b.traces[2], 2.);
    assert!(read_radar(&s, b.traces).unwrap()[3].is_none());
}
#[test]
fn radar_bad_state_and_buffers_fail_before_advance() {
    let p = config();
    let mut s = RadarState::default();
    let mut f0 = vec![0.; CELLS];
    let mut f1 = vec![0.; CELLS];
    let mut mask = vec![0; CELLS];
    let mut traces = vec![0.; 4 * BUFFER];
    let mut b = RadarBuffers {
        field0: &mut f0,
        field1: &mut f1,
        mask: &mut mask,
        traces: &mut traces,
    };
    init_radar(&p, &mut s, &mut b).unwrap();
    assert_eq!(
        advance_radar(&p, &mut s, &mut b, 0),
        Err(KernelError::InvalidDimensions)
    );
    assert_eq!(
        advance_radar(&p, &mut s, &mut b, 6),
        Err(KernelError::InvalidState)
    );
    b.field0[0] = f32::NAN;
    assert_eq!(
        advance_radar(&p, &mut s, &mut b, 1),
        Err(KernelError::NonFiniteValue)
    );
    assert_eq!(s.completed, 0);
    init_radar(&p, &mut s, &mut b).unwrap();
    s.heads[0] = 256;
    assert_eq!(
        read_radar(&s, b.traces).unwrap_err(),
        KernelError::InvalidState
    );
    s.heads[0] = 0;
    s.lengths[0] = 2;
    b.traces[0] = -f64::MAX;
    b.traces[1] = f64::MAX;
    assert_eq!(
        read_radar(&s, b.traces).unwrap_err(),
        KernelError::NonFiniteValue
    );
}
/// Run a radar scene to completion in <=64-step chunks, returning the buffers.
fn run_scene(
    p: &RadarConfig,
    clear_mask: bool,
) -> (RadarState, Vec<f32>, Vec<f32>, Vec<u8>, Vec<f64>) {
    let mut s = RadarState::default();
    let mut f0 = vec![0.; CELLS];
    let mut f1 = vec![0.; CELLS];
    let mut mask = vec![0; CELLS];
    let mut traces = vec![0.; 4 * BUFFER];
    let mut b = RadarBuffers {
        field0: &mut f0,
        field1: &mut f1,
        mask: &mut mask,
        traces: &mut traces,
    };
    init_radar(&p, &mut s, &mut b).unwrap();
    if clear_mask {
        b.mask.fill(0);
    }
    while s.completed < p.total_steps {
        let n = (p.total_steps - s.completed).min(64);
        advance_radar(&p, &mut s, &mut b, n).unwrap();
    }
    (s, f0, f1, mask, traces)
}
fn trace(s: &RadarState, traces: &[f64], ch: usize) -> Vec<f64> {
    (0..s.lengths[ch] as usize)
        .map(|i| traces[ch * BUFFER + (s.heads[ch] as usize + i) % BUFFER])
        .collect()
}
/// Samples are taken every two completed steps; sample i is step 2i+2.
fn argmax_window(trace: &[f64], from: usize, to: usize) -> usize {
    (from..to.min(trace.len()))
        .max_by(|&a, &b| trace[a].abs().total_cmp(&trace[b].abs()))
        .unwrap()
}
#[test]
fn radar_fdtd_pec_echo_matches_round_trip_delay() {
    // PEC slab face at x=100, probe on the TX line at x=60: the echo must lag
    // the direct pulse by 2d/c = 2*40/0.5 = 160 steps = 80 samples.
    let probe = 60 + 100 * N;
    let p = RadarConfig {
        total_steps: 400,
        mode: 0,
        probes: [probe as u32, NO_PROBE, NO_PROBE, NO_PROBE],
        reserved: [0; 2],
    };
    let mut s = RadarState::default();
    let mut f0 = vec![0.; CELLS];
    let mut f1 = vec![0.; CELLS];
    let mut mask = vec![0; CELLS];
    let mut traces = vec![0.; 4 * BUFFER];
    let mut b = RadarBuffers {
        field0: &mut f0,
        field1: &mut f1,
        mask: &mut mask,
        traces: &mut traces,
    };
    init_radar(&p, &mut s, &mut b).unwrap();
    // Masked cells outside the static target table are generic PEC obstacles.
    b.mask.fill(0);
    for y in 90..=110 {
        for x in 100..=104 {
            b.mask[x + y * N] = 1;
        }
    }
    while s.completed < p.total_steps {
        let n = (p.total_steps - s.completed).min(64);
        advance_radar(&p, &mut s, &mut b, n).unwrap();
    }
    let t = trace(&s, b.traces, 0);
    assert!(t.len() >= 150);
    let direct = argmax_window(&t, 10, 80);
    let echo = argmax_window(&t, 90, 160);
    assert!(t[direct].abs() > 0.1, "direct pulse at the probe");
    assert!(t[echo].abs() > 0.05, "PEC echo at the probe");
    let delay_steps = 2. * (echo - direct) as f64;
    let expected = 2. * (100. - 60.) / COURANT;
    assert!(
        (delay_steps - expected).abs() <= 20.,
        "echo delay {delay_steps} steps vs round trip {expected}"
    );
}
#[test]
fn radar_fdtd_scattered_field_zero_without_targets() {
    // No scatterers: the scene is deterministic and identical runs match
    // bitwise. With targets, the probe trace is identical until the first
    // echo returns, then diverges (real scattered field).
    let probe = 60 + 100 * N;
    let p = RadarConfig {
        total_steps: 400,
        mode: 0,
        probes: [probe as u32, NO_PROBE, NO_PROBE, NO_PROBE],
        reserved: [0; 2],
    };
    let (sa, _f0a, _f1a, _ma, ta) = run_scene(&p, true);
    let (sb, _f0b, _f1b, _mb, tb) = run_scene(&p, true);
    assert_eq!(ta, tb);
    let (sc, _f0c, _f1c, _mc, tc) = run_scene(&p, false);
    let clean = trace(&sa, &ta, 0);
    let clean2 = trace(&sb, &tb, 0);
    let scene = trace(&sc, &tc, 0);
    assert_eq!(clean, clean2);
    // The wall face at x=120 is first reached near step 200; its echo cannot
    // return to the probe before ~step 320 (sample 160).
    assert_eq!(&clean[..150], &scene[..150]);
    assert!(
        clean[160..]
            .iter()
            .zip(&scene[160..])
            .any(|(a, b)| (a - b).abs() > 1e-6),
        "targets must produce a scattered field"
    );
}
#[test]
fn radar_fdtd_energy_decays_after_pulse_passes() {
    let p = RadarConfig {
        total_steps: 1200,
        mode: 0,
        probes: [NO_PROBE; 4],
        reserved: [0; 2],
    };
    let mut s = RadarState::default();
    let mut f0 = vec![0.; CELLS];
    let mut f1 = vec![0.; CELLS];
    let mut mask = vec![0; CELLS];
    let mut traces = vec![0.; 4 * BUFFER];
    let mut b = RadarBuffers {
        field0: &mut f0,
        field1: &mut f1,
        mask: &mut mask,
        traces: &mut traces,
    };
    init_radar(&p, &mut s, &mut b).unwrap();
    advance_radar(&p, &mut s, &mut b, 60).unwrap();
    let early = radar_field_energy(b.field0, b.field1, b.mask).unwrap();
    assert!(early > 0., "pulse must carry field energy");
    while s.completed < p.total_steps {
        let n = (p.total_steps - s.completed).min(64);
        advance_radar(&p, &mut s, &mut b, n).unwrap();
    }
    let late = radar_field_energy(b.field0, b.field1, b.mask).unwrap();
    assert!(
        late < 0.5 * early,
        "sponge must absorb the pulse: early {early}, late {late}"
    );
}
#[test]
fn radar_range_closes_received_power_and_inverse_fourth_law() {
    let p = RadarRangeParams {
        pt: 1000.,
        gt: 1000.,
        gr: 1000.,
        lambda: 0.03,
        sigma: 1.,
        s_min: 1e-12,
    };
    let r = radar_max_range(&p).unwrap();
    let received = radar_received_power(&p, r).unwrap();
    assert!((received / p.s_min - 1.).abs() < 2e-15);
    assert_eq!(
        radar_received_power(&p, 2. * r).unwrap() / received,
        radar_power_ratio_double_range()
    );
    assert!(radar_max_range(&RadarRangeParams { pt: f64::MAX, ..p }).is_err());
    assert!(radar_received_power(&p, f64::MAX).is_err());
    assert!(radar_wavelength(f64::INFINITY).is_err());
}
#[test]
fn laser_steady_state_has_small_equation_residual_and_zero_seed_branch() {
    for source in [0., 400., 1000., 2500., 4000.] {
        let p = DEFAULT;
        let s = steady_photons(&p, source).unwrap();
        let n = source / (1. / p.tau_n + p.b * s);
        assert!((source - n / p.tau_n - p.b * n * s).abs() < 1e-9);
        assert!((p.b * n * s - s / p.tau_c + p.spont * n).abs() < 1e-9);
    }
    assert_eq!(
        steady_photons(
            &LaserParams {
                spont: 0.,
                ..DEFAULT
            },
            4000.
        )
        .unwrap(),
        0.
    );
}
#[test]
fn laser_chunks_keep_step_order_and_reject_hidden_overflow() {
    let p = LaserConfig {
        params: DEFAULT,
        pump: 1200.,
        dt: LASER_DT,
    };
    let mut one = LaserState::default();
    let mut batched = one;
    for _ in 0..5 {
        laser_step(&p.params, &mut one, p.pump, p.dt).unwrap();
    }
    laser_advance(&p, &mut batched, 2).unwrap();
    laser_advance(&p, &mut batched, 3).unwrap();
    assert_eq!([one.n, one.s], [batched.n, batched.s]);
    let mut s = LaserState { n: 1., s: 0. };
    laser_step(&DEFAULT, &mut s, 0., 2.).unwrap();
    // RK4 tracks the physical ~e^-2 decay instead of Euler's undershoot that
    // used to hit the ≥0 floor: n decays but stays positive, never negative.
    assert!(s.n > 0. && s.n < 1.);
    let mut s = LaserState { n: f64::MAX, s: 0. };
    assert_eq!(
        laser_step(
            &LaserParams {
                tau_n: 1e-300,
                spont: 0.,
                ..DEFAULT
            },
            &mut s,
            0.,
            1.
        ),
        Err(KernelError::NonFiniteValue)
    );
    assert_eq!(s.n, f64::MAX);
    assert!(threshold_pump(&LaserParams {
        b: f64::MAX,
        tau_c: 2.,
        ..DEFAULT
    })
    .is_err());
    assert!(laser_advance(&p, &mut s, 0).is_err());
}
#[test]
fn shockley_harmonics_and_classification_come_from_measured_ratios() {
    // Shockley i = Is·(e^{v/nVt} − 1): at v = nVt·ln 2 the current equals Is.
    let v = 0.25 * core::f64::consts::LN_2;
    assert!((diode_response(v, 0.5, 0.25).unwrap() - 0.5).abs() < 1e-12);
    for kind in 0..3 {
        let h = harmonics(kind).unwrap();
        assert_eq!(classify(&h).unwrap(), kind);
        let mut transfer = [0.; 81];
        let r = nljd_result(kind, &mut transfer).unwrap();
        assert!((r.relative.f1 + r.relative.f2 + r.relative.f3 - 1.).abs() < 3e-16);
    }
    // Measured-ratio thresholds: tied 2f = 3f at 2% of the fundamental is a
    // junction (even order wins the tie); at 0.5% it is below the detection
    // threshold and reads as linear metal.
    assert_eq!(
        classify(&Harmonics {
            f1: 1.,
            f2: 0.02,
            f3: 0.02
        })
        .unwrap(),
        0
    );
    assert_eq!(
        classify(&Harmonics {
            f1: 1.,
            f2: 0.005,
            f3: 0.005
        })
        .unwrap(),
        2
    );
    assert!(diode_response(f64::MAX, 1., 1.).is_err());
    assert!(harmonic_amplitudes(f64::NAN, 0.).is_err());
    assert!(classify(&Harmonics {
        f1: 1.,
        f2: -1.,
        f3: 0.
    })
    .is_err());
    assert!(junction_coefficients(3).is_err());
}
#[test]
fn detection_fixed_layouts_match_abi() {
    use core::mem::size_of;
    assert_eq!(size_of::<RadarConfig>(), 32);
    assert_eq!(size_of::<RadarState>(), 40);
    assert_eq!(size_of::<RadarRangeParams>(), 48);
    assert_eq!(size_of::<LaserParams>(), 32);
    assert_eq!(size_of::<LaserConfig>(), 48);
    assert_eq!(size_of::<LaserState>(), 16);
    assert_eq!(size_of::<LaserPoint>(), 16);
    assert_eq!(size_of::<LaserReadout>(), 24);
    assert_eq!(size_of::<Harmonics>(), 24);
}
