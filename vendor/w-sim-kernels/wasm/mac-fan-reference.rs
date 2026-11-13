//! Test-only native oracle for the MAC actuator-disk kernel (mac_fans).
//! Reads one binary case file and prints the status word plus every output
//! buffer byte, including partially written state after kernel-level errors.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{
    fan_curve::FanCurvePoint,
    mac_fan::{mac_fan_accelerations, MacFanBuffers, MacFanDisk, MacFanReadout},
    mac_projection::MacProjectionConfig,
    KernelError,
};

const SENT64: u64 = 0xa5a5_a5a5_a5a5_a5a5;
const SENT32: u32 = 0xa5a5_a5a5;

fn word(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}
fn double(b: &[u8], at: usize) -> f64 {
    f64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}
fn doubles(b: &[u8], at: usize, count: usize) -> Vec<f64> {
    (0..count).map(|i| double(b, at + 8 * i)).collect()
}

fn status(result: Result<(), KernelError>) -> u32 {
    match result {
        Ok(()) => 0,
        Err(KernelError::InvalidDimensions) => 1,
        Err(KernelError::BufferLength) => 2,
        Err(KernelError::InvalidCoefficient) => 3,
        Err(KernelError::NonFiniteValue) => 4,
        Err(KernelError::InvalidState) => 5,
        Err(KernelError::UnsupportedFeature) => 6,
        Err(KernelError::RayLimitExceeded) => 8,
        Err(KernelError::InvalidSolidTopology) => 11,
    }
}

fn main() {
    let bytes = fs::read(env::args().nth(1).unwrap()).unwrap();
    assert_eq!(word(&bytes, 0), 0, "only the fan operation is modeled");
    let p = &bytes[4..68];
    let c = MacProjectionConfig {
        nx: word(p, 0) as usize,
        ny: word(p, 4) as usize,
        nz: word(p, 8) as usize,
        open_faces: word(p, 12) as u8,
        max_iterations: word(p, 16),
        dx_m: double(p, 24),
        dt_s: double(p, 32),
        density_kg_m3: double(p, 40),
        absolute_divergence_tol: double(p, 48),
        relative_residual_tol: double(p, 56),
    };
    let n = c.nx * c.ny * c.nz;
    let counts = [
        (c.nx + 1) * c.ny * c.nz,
        c.nx * (c.ny + 1) * c.nz,
        c.nx * c.ny * (c.nz + 1),
    ];
    let count = word(&bytes, 68) as usize;
    let point_count = word(&bytes, 72) as usize;
    let mut at = 76;
    let disks: Vec<MacFanDisk> = (0..count)
        .map(|_| {
            let disk = MacFanDisk {
                axis: word(&bytes, at),
                direction: i32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()),
                center_cells: [
                    double(&bytes, at + 8),
                    double(&bytes, at + 16),
                    double(&bytes, at + 24),
                ],
                radius_meters: double(&bytes, at + 32),
                rpm_ratio: double(&bytes, at + 40),
                curve_offset: word(&bytes, at + 48),
                curve_count: word(&bytes, at + 52),
            };
            at += 56;
            disk
        })
        .collect();
    let points: Vec<FanCurvePoint> = (0..point_count)
        .map(|_| {
            let point = FanCurvePoint {
                flow_m3_s: double(&bytes, at),
                pressure_pa: double(&bytes, at + 8),
            };
            at += 16;
            point
        })
        .collect();
    let flags = &bytes[at..at + n];
    at += n;
    let u = doubles(&bytes, at, counts[0]);
    at += counts[0] * 8;
    let v = doubles(&bytes, at, counts[1]);
    at += counts[1] * 8;
    let w = doubles(&bytes, at, counts[2]);
    at += counts[2] * 8;
    assert_eq!(at, bytes.len());
    let mut acceleration_u = vec![f64::from_bits(SENT64); counts[0]];
    let mut acceleration_v = vec![f64::from_bits(SENT64); counts[1]];
    let mut acceleration_w = vec![f64::from_bits(SENT64); counts[2]];
    let mut readouts = vec![
        MacFanReadout {
            plane: SENT32,
            face_count: SENT32,
            area_m2: f64::from_bits(SENT64),
            flow_m3_s: f64::from_bits(SENT64),
            pressure_rise_pa: f64::from_bits(SENT64),
            force_n: f64::from_bits(SENT64),
        };
        count
    ];
    let code = status(mac_fan_accelerations(
        &c,
        flags,
        &disks,
        &points,
        &mut MacFanBuffers {
            u: &u,
            v: &v,
            w: &w,
            acceleration_u: &mut acceleration_u,
            acceleration_v: &mut acceleration_v,
            acceleration_w: &mut acceleration_w,
            readouts: &mut readouts,
        },
    ));
    let mut out = io::BufWriter::new(io::stdout().lock());
    out.write_all(&code.to_le_bytes()).unwrap();
    for field in [&acceleration_u, &acceleration_v, &acceleration_w] {
        for &value in field.iter() {
            out.write_all(&value.to_le_bytes()).unwrap();
        }
    }
    for r in &readouts {
        out.write_all(&r.plane.to_le_bytes()).unwrap();
        out.write_all(&r.face_count.to_le_bytes()).unwrap();
        for v in [r.area_m2, r.flow_m3_s, r.pressure_rise_pa, r.force_n] {
            out.write_all(&v.to_le_bytes()).unwrap();
        }
    }
}
