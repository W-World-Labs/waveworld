use w_sim_kernels::{
    mac_fields::{sample_mac_cells, MacCellFieldBuffers},
    mac_projection::MacProjectionConfig,
    KernelError,
};

fn config(nx: usize) -> MacProjectionConfig {
    MacProjectionConfig {
        nx,
        ny: 1,
        nz: 1,
        dx_m: 0.1,
        dt_s: 0.01,
        density_kg_m3: 1.2,
        open_faces: 63,
        max_iterations: 200,
        absolute_divergence_tol: 1e-10,
        relative_residual_tol: 0.0,
    }
}

#[test]
fn cell_fields_average_faces_in_si_and_maximum_is_computed_before_f32_rounding() {
    let mut out = [99.0; 8];
    let max = sample_mac_cells(
        &config(2),
        &[0, 1],
        0.0,
        &mut MacCellFieldBuffers {
            u: &[2.0, 4.0, 1000.0],
            v: &[2.0, 1000.0, 6.0, 1000.0],
            w: &[10.0, 1000.0, 14.0, 1000.0],
            pressure_pa: &[25.0, 999.0],
            temperature_delta_k: None,
            output: &mut out,
        },
    )
    .unwrap();
    assert_eq!(out, [3.0, 4.0, 12.0, 25.0, 0.0, 0.0, 0.0, 0.0]);
    assert!((max - 13.0).abs() < 2e-13);
    let mut out = [0.0; 4];
    let value = 1.0 + 1e-8;
    let max = sample_mac_cells(
        &config(1),
        &[0],
        0.0,
        &mut MacCellFieldBuffers {
            u: &[value, value],
            v: &[0.0; 2],
            w: &[0.0; 2],
            pressure_pa: &[0.0],
            temperature_delta_k: None,
            output: &mut out,
        },
    )
    .unwrap();
    assert_eq!(out[0], 1.0);
    assert_eq!(max, value);
}

#[test]
fn thermal_snapshot_keeps_solid_and_internal_reservoir_absolute_temperatures() {
    let mut out = [99.0; 15];
    let max = sample_mac_cells(
        &config(3),
        &[0, 4, 2],
        20.0,
        &mut MacCellFieldBuffers {
            u: &[0.0; 4],
            v: &[0.0; 6],
            w: &[0.0; 6],
            pressure_pa: &[1.0, 999.0, 777.0],
            temperature_delta_k: Some(&[5.0, 15.0, 25.0]),
            output: &mut out,
        },
    )
    .unwrap();
    assert_eq!(max, 0.0);
    assert_eq!(
        out,
        [0.0, 0.0, 0.0, 1.0, 25.0, 0.0, 0.0, 0.0, 0.0, 35.0, 0.0, 0.0, 0.0, 0.0, 45.0]
    );
}

#[test]
fn malformed_nonfinite_or_unrepresentable_display_fields_fail_explicitly() {
    for mode in 0..5 {
        let mut out = [0.0; 5];
        let mut pressure = [0.0];
        let mut u = [0.0; 2];
        let mut flags = [0];
        let delta = [-400.0];
        match mode {
            0 => pressure[0] = f64::MAX,
            1 => u[0] = f64::NAN,
            2 => flags[0] = 2,
            _ => {}
        }
        let thermal = if mode == 3 {
            Some(delta.as_slice())
        } else {
            None
        };
        let output = if mode == 3 {
            &mut out[..]
        } else if mode == 4 {
            &mut out[..3]
        } else {
            &mut out[..4]
        };
        let result = sample_mac_cells(
            &config(1),
            &flags,
            20.0,
            &mut MacCellFieldBuffers {
                u: &u,
                v: &[0.0; 2],
                w: &[0.0; 2],
                pressure_pa: &pressure,
                temperature_delta_k: thermal,
                output,
            },
        );
        let expected = match mode {
            0 | 1 => KernelError::NonFiniteValue,
            2 => KernelError::UnsupportedFeature,
            3 => KernelError::InvalidState,
            _ => KernelError::BufferLength,
        };
        assert_eq!(result, Err(expected));
    }
}
