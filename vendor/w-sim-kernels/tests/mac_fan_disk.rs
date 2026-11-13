use w_sim_kernels::{
    fan_curve::FanCurvePoint,
    mac_fan::{mac_fan_accelerations, MacFanBuffers, MacFanDisk, MacFanReadout},
    mac_projection::MacProjectionConfig,
    KernelError,
};

struct Case {
    c: MacProjectionConfig,
    flags: Vec<u8>,
    velocity: [Vec<f64>; 3],
    acceleration: [Vec<f64>; 3],
    disks: Vec<MacFanDisk>,
    points: Vec<FanCurvePoint>,
    readouts: Vec<MacFanReadout>,
}
impl Case {
    fn new() -> Self {
        Self {
            c: MacProjectionConfig {
                nx: 5,
                ny: 5,
                nz: 5,
                dx_m: 0.1,
                dt_s: 0.01,
                density_kg_m3: 2.0,
                open_faces: 63,
                max_iterations: 200,
                absolute_divergence_tol: 1e-10,
                relative_residual_tol: 0.0,
            },
            flags: vec![0; 125],
            velocity: core::array::from_fn(|_| vec![0.0; 150]),
            acceleration: core::array::from_fn(|_| vec![99.0; 150]),
            disks: vec![MacFanDisk {
                axis: 0,
                direction: 1,
                center_cells: [2.49, 2.5, 2.5],
                radius_meters: 0.11,
                rpm_ratio: 1.0,
                curve_offset: 0,
                curve_count: 2,
            }],
            points: vec![
                FanCurvePoint {
                    flow_m3_s: 0.0,
                    pressure_pa: 20.0,
                },
                FanCurvePoint {
                    flow_m3_s: 1.0,
                    pressure_pa: 0.0,
                },
            ],
            readouts: vec![MacFanReadout::default()],
        }
    }
    fn run(&mut self) -> Result<(), KernelError> {
        let [au, av, aw] = &mut self.acceleration;
        mac_fan_accelerations(
            &self.c,
            &self.flags,
            &self.disks,
            &self.points,
            &mut MacFanBuffers {
                u: &self.velocity[0],
                v: &self.velocity[1],
                w: &self.velocity[2],
                acceleration_u: au,
                acceleration_v: av,
                acceleration_w: aw,
                readouts: &mut self.readouts,
            },
        )
    }
    fn face(&self, axis: usize, q: [usize; 3]) -> usize {
        let mut d = [5, 5, 5];
        d[axis] += 1;
        q[0] + d[0] * (q[1] + d[1] * q[2])
    }
}
fn close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 2e-12, "{actual} vs {expected}");
}

#[test]
fn circular_face_rasterization_flow_rpm_and_force_are_shared_for_all_axes_and_signs() {
    for axis in 0..3 {
        for sign in [-1, 1] {
            let mut s = Case::new();
            s.disks[0].axis = axis as u32;
            s.disks[0].direction = sign;
            s.disks[0].center_cells = [2.5; 3];
            s.disks[0].center_cells[axis] = 2.49;
            s.disks[0].rpm_ratio = 0.5;
            s.velocity[axis].fill(sign as f64 * 2.0);
            let before = s.velocity.clone();
            s.run().unwrap();
            let r = s.readouts[0];
            assert_eq!(r.plane, 2);
            assert_eq!(r.face_count, 5);
            close(r.area_m2, 0.05);
            close(r.flow_m3_s, 0.1);
            close(r.pressure_rise_pa, 4.0);
            close(r.force_n, sign as f64 * 0.2);
            let tangents: Vec<usize> = (0..3).filter(|&a| a != axis).collect();
            let mut expected = vec![0.0; 150];
            for offset in [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] {
                let mut q = [2; 3];
                q[tangents[0]] = (2 + offset[0]) as usize;
                q[tangents[1]] = (2 + offset[1]) as usize;
                expected[s.face(axis, q)] = sign as f64 * 20.0;
            }
            for a in 0..3 {
                for (i, &actual) in s.acceleration[a].iter().enumerate() {
                    close(actual, if a == axis { expected[i] } else { 0.0 });
                }
            }
            let force = s.acceleration[axis].iter().sum::<f64>() * 2.0 * 0.1_f64.powi(3);
            close(force, r.force_n);
            assert_eq!(s.velocity, before);
            assert_eq!(s.disks[0].center_cells[axis], 2.49);
        }
    }
}

#[test]
fn multiple_disks_use_their_curves_and_rebuild_acceleration_without_stale_force() {
    let mut s = Case::new();
    s.disks[0].radius_meters = 0.049;
    s.disks[0].center_cells = [2.5, 1.5, 1.5];
    let mut second = s.disks[0];
    second.center_cells = [2.5, 3.5, 3.5];
    second.curve_offset = 2;
    s.disks.push(second);
    s.readouts.resize(2, MacFanReadout::default());
    s.points.extend([
        FanCurvePoint {
            flow_m3_s: 0.0,
            pressure_pa: 8.0,
        },
        FanCurvePoint {
            flow_m3_s: 1.0,
            pressure_pa: 8.0,
        },
    ]);
    s.run().unwrap();
    assert_eq!(s.readouts[0].plane, 3);
    close(s.readouts[0].pressure_rise_pa, 20.0);
    close(s.readouts[1].pressure_rise_pa, 8.0);
    close(s.acceleration[0].iter().sum(), 140.0);
    s.disks[0].rpm_ratio = 0.5;
    s.run().unwrap();
    close(s.acceleration[0].iter().sum(), 65.0);
    s.disks.clear();
    s.readouts.clear();
    s.run().unwrap();
    assert!(s.acceleration.iter().flatten().all(|&a| a == 0.0));
}

#[test]
fn coincident_disks_blocked_faces_empty_rasters_and_clipped_geometry_are_rejected() {
    for mode in 0..7 {
        let mut s = Case::new();
        match mode {
            0 => {
                s.disks.push(s.disks[0]);
                s.readouts.resize(2, MacFanReadout::default());
            }
            1 => s.flags[1 + 5 * (2 + 5 * 2)] = 4,
            2 => {
                s.disks[0].center_cells = [2.0; 3];
                s.disks[0].radius_meters = 0.01;
            }
            3 => s.disks[0].center_cells[1] = 0.5,
            4 => s.disks[0].center_cells[0] = 0.49,
            5 => s.disks[0].center_cells[0] = 4.51,
            _ => {
                s.disks = vec![s.disks[0]; 17];
                s.readouts.resize(17, MacFanReadout::default());
            }
        }
        let before = s.velocity.clone();
        assert!(s.run().is_err());
        assert_eq!(s.velocity, before);
    }
}

#[test]
fn stopped_reverse_out_of_curve_and_malformed_input_have_no_fallback() {
    for (mode, expected) in [
        (0, KernelError::UnsupportedFeature),
        (1, KernelError::UnsupportedFeature),
        (2, KernelError::InvalidState),
        (3, KernelError::InvalidCoefficient),
        (4, KernelError::BufferLength),
        (5, KernelError::NonFiniteValue),
    ] {
        let mut s = Case::new();
        match mode {
            0 => s.disks[0].rpm_ratio = 0.0,
            1 => s.velocity[0].fill(-2.0),
            2 => s.velocity[0].fill(100.0),
            3 => s.disks[0].direction = 0,
            4 => s.disks[0].curve_offset = 2,
            _ => s.velocity[1][0] = f64::NAN,
        }
        assert_eq!(s.run(), Err(expected));
    }
}

#[test]
fn net_forward_flow_allows_a_local_recirculating_patch_without_abs_value() {
    let mut s = Case::new();
    s.velocity[0].fill(2.0);
    let center = s.face(0, [2, 2, 2]);
    s.velocity[0][center] = -1.0;
    s.run().unwrap();
    close(s.readouts[0].flow_m3_s, 0.07);
    close(s.readouts[0].pressure_rise_pa, 18.6);
}
