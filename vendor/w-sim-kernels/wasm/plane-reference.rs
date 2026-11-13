//! Test-only file adapter. The crate remains allocation-free/no_std.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::plane::*;
fn main() {
    let data = fs::read(env::args().nth(1).unwrap()).unwrap();
    let uint = |p| u32::from_le_bytes(data[p..p + 4].try_into().unwrap());
    let val = |p| f64::from_le_bytes(data[p..p + 8].try_into().unwrap());
    let kind = uint(0);
    let n = uint(4) as usize;
    let xs: Vec<_> = (0..n).map(|i| val(56 + 8 * i)).collect();
    let mut a = vec![0.; n];
    let mut b = vec![0.; n];
    let mut result = Vec::new();
    match kind {
        0 => {
            let p = EmConfig {
                frequency_hz: val(16),
                refractive_index: val(24),
                e_peak: val(32),
                phase0: val(40),
            };
            let r = em_observables(&p).unwrap();
            sample_em(&p, val(8), &xs, &mut a, &mut b).unwrap();
            result.extend([
                r.wavelength_m,
                r.phase_velocity,
                r.impedance,
                r.b_peak,
                r.intensity_w_m2,
            ]);
            result.extend(a);
            result.extend(b);
        }
        1 => {
            let p = AcousticConfig {
                frequency_hz: val(16),
                rho: val(24),
                c: val(32),
                p_peak: val(40),
                phase0: val(48),
            };
            let r = acoustic_observables(&p).unwrap();
            sample_acoustic(&p, val(8), &xs, &mut a, &mut b).unwrap();
            result.extend([r.wavelength_m, r.impedance, r.v_peak, r.intensity_w_m2]);
            result.extend(a);
            result.extend(b);
        }
        2 => {
            let p = Em3dConfig {
                wave_number: val(16),
                amplitude: val(24),
                time: val(32),
            };
            let mut c = vec![0.; n];
            result.push(em3d_fields(&p, &mut a, &mut b, &mut c).unwrap());
            result.extend(a);
            result.extend(b);
            result.extend(c);
        }
        3 => {
            for x in xs {
                let (s, c) = phase_sin_cos(x).unwrap();
                result.extend([s, c]);
            }
        }
        _ => panic!("unsupported fixture"),
    }
    let bytes: Vec<_> = result.iter().flat_map(|v| v.to_le_bytes()).collect();
    io::stdout().write_all(&bytes).unwrap();
}
