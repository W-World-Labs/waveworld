//! Test-only binary adapter; numerical work calls the same public Rust API.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{sensing::*, KernelError};
fn word(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(data[at..at + 4].try_into().unwrap())
}
fn number(data: &[u8], at: usize) -> f64 {
    f64::from_le_bytes(data[at..at + 8].try_into().unwrap())
}
fn array(data: &[u8], at: &mut usize, n: usize) -> Vec<f64> {
    let v = (0..n).map(|i| number(data, *at + i * 8)).collect();
    *at += n * 8;
    v
}
fn code(e: KernelError) -> u32 {
    match e {
        KernelError::InvalidDimensions => 1,
        KernelError::BufferLength => 2,
        KernelError::InvalidCoefficient => 3,
        KernelError::NonFiniteValue => 4,
        KernelError::InvalidState => 5,
        KernelError::UnsupportedFeature => 6,
        KernelError::RayLimitExceeded => 8,
        KernelError::InvalidSolidTopology => 11,
    }
}
fn main() {
    let data = fs::read(env::args().nth(1).unwrap()).unwrap();
    let p = SensingConfig {
        n: word(&data, 0),
        sensors: word(&data, 4),
        measurements: word(&data, 8),
        encoding: word(&data, 12),
        seed: word(&data, 16),
        reserved: word(&data, 20),
        noise_peak_v: number(&data, 24),
        lambda: number(&data, 32),
    };
    let (n, k, m) = p.dimensions().unwrap();
    let mut at = 40;
    let input = array(&data, &mut at, n);
    let sensing = array(&data, &mut at, k * n);
    let bias = array(&data, &mut at, k);
    let custom = if p.encoding == 2 {
        Some(array(&data, &mut at, m * k))
    } else {
        None
    };
    let sampled = at < data.len();
    let rc = if sampled {
        let enabled = word(&data, at);
        at += 4;
        if enabled == 1 {
            let v = array(&data, &mut at, 4);
            Some(RcSamplingConfig {
                resistance: v[0],
                capacitance: v[1],
                dwell: v[2],
                initial_voltage: v[3],
            })
        } else {
            assert_eq!(enabled, 0);
            None
        }
    } else {
        None
    };
    assert_eq!(at, data.len());
    let mut encoding = vec![7.; m * k];
    let mut sensor_voltages = vec![7.; k];
    let mut measurements = vec![7.; m];
    let mut reconstructed = vec![7.; n];
    let mut error = vec![7.; n];
    let mut qr = vec![7.; (m + n) * n];
    let mut rhs = vec![7.; m + n];
    let mut permutation = vec![7; n];
    let mut ideal = vec![7.; m];
    let mut sampled_voltages = vec![7.; m];
    let mut output = io::stdout().lock();
    let mut buffers = SensingBuffers {
        encoding: &mut encoding,
        sensor_voltages: &mut sensor_voltages,
        measurements: &mut measurements,
        reconstructed: &mut reconstructed,
        error: &mut error,
        qr: &mut qr,
        rhs: &mut rhs,
        permutation: &mut permutation,
    };
    let result = if sampled {
        sense_array_sampled(
            &p,
            &input,
            &sensing,
            &bias,
            custom.as_deref(),
            &mut buffers,
            &mut SensingSampling {
                rc: rc.as_ref(),
                ideal_voltages: &mut ideal,
                sampled_voltages: &mut sampled_voltages,
            },
        )
        .map(|r| (r.sensing, Some([r.settling_fraction, r.decay, r.tau])))
    } else {
        sense_array(&p, &input, &sensing, &bias, custom.as_deref(), &mut buffers).map(|r| (r, None))
    };
    match result {
        Err(e) => output.write_all(&code(e).to_le_bytes()).unwrap(),
        Ok((r, response)) => {
            output.write_all(&0u32.to_le_bytes()).unwrap();
            for v in [r.rmse, r.residual_rms, r.rank_tolerance] {
                output.write_all(&v.to_le_bytes()).unwrap();
            }
            for v in [r.rank, r.status, r.rng_state, r.reserved] {
                output.write_all(&v.to_le_bytes()).unwrap();
            }
            if let Some(values) = response {
                for v in values {
                    output.write_all(&v.to_le_bytes()).unwrap();
                }
            }
            for a in [
                encoding,
                sensor_voltages,
                measurements,
                reconstructed,
                error,
                qr,
                rhs,
            ] {
                for v in a {
                    output.write_all(&v.to_le_bytes()).unwrap();
                }
            }
            for v in permutation {
                output.write_all(&v.to_le_bytes()).unwrap();
            }
            if sampled {
                for a in [ideal, sampled_voltages] {
                    for v in a {
                        output.write_all(&v.to_le_bytes()).unwrap();
                    }
                }
            }
        }
    }
}
