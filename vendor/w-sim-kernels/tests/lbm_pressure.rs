use w_sim_kernels::lbm::{
    display_d3q19, D3q19Boundary, D3q19Config, D3Q19_PRESSURE_FIELD_VERSION, D3Q19_W,
};
use w_sim_kernels::KernelError;

fn config() -> D3q19Config {
    D3q19Config {
        nx: 7,
        ny: 1,
        nz: 1,
        tau: 0.8,
        u_inlet: 0.,
        smagorinsky_cs: 0.,
        turbulence_intensity: 0.,
        free_slip_walls: true,
        ground_velocity: None,
        boundary: D3q19Boundary::WindTunnel,
        fan: None,
        thermal: None,
    }
}

#[test]
fn pressure_uses_the_stored_force_reference_and_retains_signed_small_signals() {
    assert_eq!(D3Q19_PRESSURE_FIELD_VERSION, 1);
    let c = config();
    let mut flags = [0; 7];
    flags[6] = 1;
    let mut f: Vec<f32> = (0..7).flat_map(|_| D3Q19_W.map(|v| v as f32)).collect();
    f[19] += 3. / 1024.;
    f[38] -= 3. / 1024.;
    f[3 * 19 + 1] += 3. * 2f32.powi(-27);
    f[3 * 19 + 2] += 3. * 2f32.powi(-27);
    let shear = 2f32.powi(-20);
    for q in [7, 8] {
        f[4 * 19 + q] += shear;
    }
    for q in [9, 10] {
        f[4 * 19 + q] -= shear;
    }
    // Same reference populations but a different display velocity; no Bernoulli proxy.
    let mut u = [0.; 21];
    u[5 * 3] = 0.04;
    let before = f.clone();
    let mut display = [0.; 21];
    display_d3q19(&c, &u, &flags, None, Some(&f), &mut display).unwrap();
    let pressure: Vec<f32> = display.chunks_exact(3).map(|v| v[2]).collect();
    assert_eq!(
        pressure,
        vec![0., 1. / 1024., -1. / 1024., 2f32.powi(-26), 0., 0., 0.]
    );
    assert_eq!(f, before);
    assert_eq!(
        pressure[1] as f64 * 1.25 * (0.01f64 / 0.0001).powi(2),
        12.20703125
    );
    assert_eq!(
        pressure[2] as f64 * 1.25 * (0.01f64 / 0.0001).powi(2),
        -12.20703125
    );
    let rounded_rho = f[3 * 19..4 * 19].iter().map(|&v| v as f64).sum::<f64>() as f32;
    assert_eq!((rounded_rho - 1.) / 3., 0.);
    assert_ne!(pressure[3], 0.);
    let xy = f[4 * 19 + 7] + f[4 * 19 + 8] - f[4 * 19 + 9] - f[4 * 19 + 10];
    assert_eq!(xy, 4. * shear);
    assert_eq!(
        pressure[4], 0.,
        "density pressure cannot stand in for the full stress tensor"
    );
    let mut old = [0.; 14];
    display_d3q19(&c, &u, &flags, None, None, &mut old).unwrap();
    for cell in 0..7 {
        assert_eq!(
            &display[cell * 3..cell * 3 + 2],
            &old[cell * 2..cell * 2 + 2]
        );
    }
}

#[test]
fn pressure_display_rejects_bad_input_without_mutating_populations() {
    let c = config();
    let u = [0.; 21];
    let flags = [0; 7];
    let mut output = [0.; 21];
    let mut f: Vec<f32> = (0..7).flat_map(|_| D3Q19_W.map(|v| v as f32)).collect();
    assert_eq!(
        display_d3q19(&c, &u, &flags, None, Some(&f[..132]), &mut output),
        Err(KernelError::BufferLength)
    );
    assert_eq!(
        display_d3q19(&c, &u, &flags, None, Some(&f), &mut output[..14]),
        Err(KernelError::BufferLength)
    );
    for invalid in [f32::NAN, f32::INFINITY] {
        f[0] = invalid;
        let before: Vec<_> = f.iter().map(|v| v.to_bits()).collect();
        assert_eq!(
            display_d3q19(&c, &u, &flags, None, Some(&f), &mut output),
            Err(KernelError::NonFiniteValue)
        );
        assert_eq!(f.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), before);
    }
    f.fill(f32::MAX);
    assert_eq!(
        display_d3q19(&c, &u, &flags, None, Some(&f), &mut output),
        Err(KernelError::NonFiniteValue)
    );
}
