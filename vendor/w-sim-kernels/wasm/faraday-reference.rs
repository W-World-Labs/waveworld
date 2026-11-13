//! Test-only binary adapter to the production Rust functions.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::faraday::*;
fn word(d: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(d[at..at + 4].try_into().unwrap())
}
fn number(d: &[u8], at: usize) -> f64 {
    f64::from_le_bytes(d[at..at + 8].try_into().unwrap())
}
fn main() {
    let d = fs::read(env::args().nth(1).unwrap()).unwrap();
    let mut result = Vec::new();
    match word(&d, 0) {
        0 => {
            let p = FaradayConfig {
                omega: number(&d, 8),
                b: number(&d, 16),
                n: number(&d, 24),
                area: number(&d, 32),
                v_bar: number(&d, 40),
                b_mot: number(&d, 48),
                l_bar: number(&d, 56),
            };
            let mut flux = [0.; 361];
            let mut emf = [0.; 361];
            let r = faraday_result(&p, &mut flux, &mut emf).unwrap();
            result.extend([r.peak, r.linkage, r.motional_emf, r.frequency, r.period]);
            result.extend(flux);
            result.extend(emf);
        }
        1 => {
            let (t, n, b, a, w) = (
                number(&d, 8),
                number(&d, 16),
                number(&d, 24),
                number(&d, 32),
                number(&d, 40),
            );
            result.extend([
                rotating_coil_flux(t, n, b, a, w).unwrap(),
                rotating_coil_emf(t, n, b, a, w).unwrap(),
                peak_emf(n, b, a, w).unwrap(),
            ]);
        }
        2 => {
            let count = word(&d, 4) as usize;
            let flux: Vec<f64> = (0..count).map(|i| number(&d, 24 + i * 8)).collect();
            result.resize(count, 0.);
            emf_from_flux_series(&flux, number(&d, 8), number(&d, 16), &mut result).unwrap();
        }
        3 => {
            result.extend([
                induced_emf(number(&d, 8), number(&d, 16)).unwrap(),
                motional_emf(number(&d, 24), number(&d, 32), number(&d, 40)).unwrap(),
            ]);
        }
        _ => panic!("unknown reference operation"),
    }
    let mut out = io::stdout().lock();
    for v in result {
        out.write_all(&v.to_le_bytes()).unwrap();
    }
}
