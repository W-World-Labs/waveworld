//! Tiny native adapter for the shared fan scalar, with command-line SI inputs.
use std::{
    env,
    io::{self, Write},
};
use w_sim_kernels::fan_curve::{pressure_rise, FanCurvePoint};

fn main() {
    let values: Vec<f64> = env::args().skip(1).map(|s| s.parse().unwrap()).collect();
    assert!(values.len() >= 6 && values.len() % 2 == 0);
    let points: Vec<_> = values[2..]
        .chunks_exact(2)
        .map(|p| FanCurvePoint {
            flow_m3_s: p[0],
            pressure_pa: p[1],
        })
        .collect();
    let result = pressure_rise(&points, values[0], values[1]).unwrap();
    io::stdout().write_all(&result.to_le_bytes()).unwrap();
}
