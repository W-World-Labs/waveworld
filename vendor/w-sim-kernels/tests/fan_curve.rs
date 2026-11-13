use w_sim_kernels::fan_curve::{pressure_rise, FanCurvePoint, MAX_FAN_CURVE_POINTS};
use w_sim_kernels::KernelError;

// Synthetic numbers only; these are not manufacturer data or calibration.
const CURVE: [FanCurvePoint; 3] = [
    FanCurvePoint {
        flow_m3_s: 0.0,
        pressure_pa: 100.0,
    },
    FanCurvePoint {
        flow_m3_s: 0.1,
        pressure_pa: 60.0,
    },
    FanCurvePoint {
        flow_m3_s: 0.2,
        pressure_pa: 0.0,
    },
];

fn close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-12, "{actual} != {expected}");
}

#[test]
fn exact_knots_and_piecewise_linear_static_pressure() {
    for point in CURVE {
        assert_eq!(
            pressure_rise(&CURVE, point.flow_m3_s, 1.0),
            Ok(point.pressure_pa)
        );
    }
    close(pressure_rise(&CURVE, 0.05, 1.0).unwrap(), 80.0);
    close(pressure_rise(&CURVE, 0.15, 1.0).unwrap(), 30.0);
}

#[test]
fn rpm_affinity_scales_flow_and_pressure_together() {
    for ratio in [0.25, 0.5, 0.8, 1.0] {
        for flow in [0.0, 0.05, 0.1, 0.15, 0.2] {
            let expected = ratio * ratio * pressure_rise(&CURVE, flow, 1.0).unwrap();
            close(
                pressure_rise(&CURVE, flow * ratio, ratio).unwrap(),
                expected,
            );
        }
        assert_eq!(pressure_rise(&CURVE, 0.2 * ratio, ratio), Ok(0.0));
        assert_eq!(
            pressure_rise(&CURVE, 0.2 * ratio + 1e-8, ratio),
            Err(KernelError::InvalidState)
        );
    }
    assert_eq!(
        pressure_rise(&CURVE, 0.15, 0.5),
        Err(KernelError::InvalidState)
    );
}

#[test]
fn accepts_non_monotonic_pressure_and_nonzero_flow_endpoints() {
    let curve = [
        FanCurvePoint {
            flow_m3_s: 1.0,
            pressure_pa: 100.0,
        },
        FanCurvePoint {
            flow_m3_s: 2.0,
            pressure_pa: 60.0,
        },
        FanCurvePoint {
            flow_m3_s: 3.0,
            pressure_pa: 75.0,
        },
        FanCurvePoint {
            flow_m3_s: 4.0,
            pressure_pa: 20.0,
        },
    ];
    assert_eq!(pressure_rise(&curve, 2.5, 1.0), Ok(67.5));
    assert_eq!(pressure_rise(&curve, 1.25, 0.5), Ok(16.875));
    assert_eq!(pressure_rise(&curve, 0.5, 0.5), Ok(25.0));
    assert_eq!(pressure_rise(&curve, 2.0, 0.5), Ok(5.0));
    for flow in [0.0, 0.499999, 2.000001] {
        assert_eq!(
            pressure_rise(&curve, flow, 0.5),
            Err(KernelError::InvalidState)
        );
    }
}

#[test]
fn validates_all_knots_without_sorting_or_modifying_the_curve() {
    for bad in [
        FanCurvePoint {
            flow_m3_s: f64::NAN,
            pressure_pa: 10.0,
        },
        FanCurvePoint {
            flow_m3_s: f64::INFINITY,
            pressure_pa: 10.0,
        },
        FanCurvePoint {
            flow_m3_s: 0.2,
            pressure_pa: f64::NAN,
        },
        FanCurvePoint {
            flow_m3_s: 0.2,
            pressure_pa: f64::INFINITY,
        },
    ] {
        let curve = [CURVE[0], CURVE[1], bad];
        // Even an exact first endpoint cannot conceal invalid trailing data.
        assert_eq!(
            pressure_rise(&curve, 0.0, 1.0),
            Err(KernelError::NonFiniteValue)
        );
    }
    for bad in [
        FanCurvePoint {
            flow_m3_s: -0.1,
            pressure_pa: 10.0,
        },
        FanCurvePoint {
            flow_m3_s: 0.05,
            pressure_pa: 10.0,
        },
        FanCurvePoint {
            flow_m3_s: 0.1,
            pressure_pa: 10.0,
        },
        FanCurvePoint {
            flow_m3_s: 0.2,
            pressure_pa: -1.0,
        },
    ] {
        let curve = [CURVE[0], CURVE[1], bad];
        let original = curve;
        assert_eq!(
            pressure_rise(&curve, 0.0, 1.0),
            Err(KernelError::InvalidCoefficient)
        );
        assert_eq!(curve, original);
    }
}

#[test]
fn rejects_invalid_queries_and_does_not_model_stopped_or_reversed_fans() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            pressure_rise(&CURVE, value, 1.0),
            Err(KernelError::NonFiniteValue)
        );
        assert_eq!(
            pressure_rise(&CURVE, 0.1, value),
            Err(KernelError::NonFiniteValue)
        );
    }
    assert_eq!(
        pressure_rise(&CURVE, -0.1, 1.0),
        Err(KernelError::UnsupportedFeature)
    );
    assert_eq!(
        pressure_rise(&CURVE, 0.0, 0.0),
        Err(KernelError::UnsupportedFeature)
    );
    for ratio in [-0.1, 1.000001, 2.0] {
        assert_eq!(
            pressure_rise(&CURVE, 0.1, ratio),
            Err(KernelError::InvalidCoefficient)
        );
    }
}

#[test]
fn bounds_point_count_including_the_largest_admitted_curve() {
    assert_eq!(pressure_rise(&[], 0.0, 1.0), Err(KernelError::BufferLength));
    assert_eq!(
        pressure_rise(&CURVE[..1], 0.0, 1.0),
        Err(KernelError::BufferLength)
    );
    let curve: Vec<_> = (0..=MAX_FAN_CURVE_POINTS)
        .map(|i| FanCurvePoint {
            flow_m3_s: i as f64,
            pressure_pa: if i % 2 == 0 { 100.0 } else { 50.0 },
        })
        .collect();
    assert_eq!(
        pressure_rise(&curve, 0.0, 1.0),
        Err(KernelError::BufferLength)
    );
    assert_eq!(
        pressure_rise(&curve[..MAX_FAN_CURVE_POINTS], 254.5, 1.0),
        Ok(75.0)
    );
    assert_eq!(pressure_rise(&CURVE[..2], 0.05, 1.0), Ok(80.0));
}

#[test]
fn rejects_scaling_underflow_and_collapsed_flow_intervals() {
    assert_eq!(
        pressure_rise(&CURVE, 0.0, f64::MIN_POSITIVE),
        Err(KernelError::InvalidState)
    );
    let tiny = f64::from_bits(1);
    for curve in [
        [
            FanCurvePoint {
                flow_m3_s: 0.0,
                pressure_pa: 1.0,
            },
            FanCurvePoint {
                flow_m3_s: tiny,
                pressure_pa: 0.0,
            },
        ],
        [
            FanCurvePoint {
                flow_m3_s: 0.0,
                pressure_pa: tiny,
            },
            FanCurvePoint {
                flow_m3_s: 1.0,
                pressure_pa: 0.0,
            },
        ],
        [
            FanCurvePoint {
                flow_m3_s: f64::from_bits(3),
                pressure_pa: 1.0,
            },
            FanCurvePoint {
                flow_m3_s: f64::from_bits(4),
                pressure_pa: 0.0,
            },
        ],
    ] {
        assert_eq!(
            pressure_rise(&curve, tiny, 0.5),
            Err(KernelError::InvalidState)
        );
    }
}

#[test]
fn rejects_interpolation_underflow_but_preserves_representable_small_pressure() {
    let curve = [
        FanCurvePoint {
            flow_m3_s: 0.0,
            pressure_pa: 0.0,
        },
        FanCurvePoint {
            flow_m3_s: f64::MAX,
            pressure_pa: 1.0,
        },
    ];
    assert_eq!(
        pressure_rise(&curve, f64::MIN_POSITIVE, 1.0),
        Err(KernelError::InvalidState)
    );
    let curve = [
        FanCurvePoint {
            flow_m3_s: 0.0,
            pressure_pa: 0.0,
        },
        FanCurvePoint {
            flow_m3_s: 1.0,
            pressure_pa: f64::from_bits(1),
        },
    ];
    assert_eq!(
        pressure_rise(&curve, 0.25, 1.0),
        Err(KernelError::InvalidState)
    );
    let curve = [
        FanCurvePoint {
            flow_m3_s: 0.0,
            pressure_pa: f64::from_bits(1),
        },
        FanCurvePoint {
            flow_m3_s: 1.0,
            pressure_pa: 0.0,
        },
    ];
    assert_eq!(
        pressure_rise(&curve, 0.75, 1.0),
        Err(KernelError::InvalidState)
    );
    let curve = [
        FanCurvePoint {
            flow_m3_s: 0.0,
            pressure_pa: 0.0,
        },
        FanCurvePoint {
            flow_m3_s: 1.0,
            pressure_pa: f64::MAX,
        },
    ];
    assert_eq!(
        pressure_rise(&curve, f64::from_bits(1), 1.0),
        Ok(f64::from_bits(1) * f64::MAX)
    );
}

#[test]
fn zero_pressure_is_valid_and_pressure_does_not_overflow_on_finite_large_knots() {
    for pressure in [0.0, f64::MAX] {
        let curve = [
            FanCurvePoint {
                flow_m3_s: 0.0,
                pressure_pa: pressure,
            },
            FanCurvePoint {
                flow_m3_s: 1.0,
                pressure_pa: pressure,
            },
        ];
        for flow in [0.0, 0.25, 0.5, 0.75, 1.0] {
            assert_eq!(pressure_rise(&curve, flow, 1.0), Ok(pressure));
        }
    }
}

#[test]
fn knots_keep_the_c_abi_layout_for_native_and_wasm_callers() {
    assert_eq!(core::mem::size_of::<FanCurvePoint>(), 16);
    assert_eq!(core::mem::align_of::<FanCurvePoint>(), 8);
    assert_eq!(core::mem::offset_of!(FanCurvePoint, flow_m3_s), 0);
    assert_eq!(core::mem::offset_of!(FanCurvePoint, pressure_pa), 8);
}
