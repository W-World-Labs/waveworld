//! Test-only binary adapter; all numeric results come from the production core.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::ising::*;
fn word(b: &[u8], p: usize) -> u32 {
    u32::from_le_bytes(b[p..p + 4].try_into().unwrap())
}
fn double(b: &[u8], p: usize) -> f64 {
    f64::from_le_bytes(b[p..p + 8].try_into().unwrap())
}
fn main() {
    let b = fs::read(env::args().nth(1).unwrap()).unwrap();
    let mut c = IsingConfig {
        size: word(&b, 0) as usize,
        temperature: double(&b, 24),
    };
    let mut spins = vec![0; c.size * c.size];
    let mut rng = 0;
    let mut moments = IsingMoments::default();
    let algorithm = if word(&b, 12) == 0 {
        IsingAlgorithm::Metropolis
    } else {
        IsingAlgorithm::Heatbath
    };
    init_ising(&c, &mut spins, &mut rng, word(&b, 4), word(&b, 8) == 1).unwrap();
    let mut out = io::stdout().lock();
    for step in 0..=word(&b, 16) as usize {
        if step > 0 {
            let p = 32 + (step - 1) * 16;
            c.temperature = double(&b, p);
            sweep_ising(
                &c,
                &mut spins,
                &mut rng,
                Some(&mut moments),
                algorithm,
                word(&b, p + 8) == 1,
                word(&b, p + 12) == 1,
            )
            .unwrap();
        }
        for &s in &spins {
            out.write_all(&s.to_le_bytes()).unwrap();
        }
        out.write_all(&rng.to_le_bytes()).unwrap();
        let r = read_ising(&c, &spins, &moments).unwrap();
        let p = r.point;
        for v in [
            moments.n,
            moments.m,
            moments.abs_m,
            moments.m2,
            moments.e,
            moments.e2,
            r.magnetization,
            r.energy,
            p.samples as f64,
            p.mean_m.unwrap_or(0.),
            p.mean_abs_m.unwrap_or(0.),
            p.mean_energy.unwrap_or(0.),
            p.specific_heat.unwrap_or(0.),
            p.susceptibility.unwrap_or(0.),
            p.reference,
            onsager_tc(),
        ] {
            out.write_all(&v.to_le_bytes()).unwrap();
        }
    }
    // Scalar references use the same code too (including both critical neighbors).
    for t in [
        -1.,
        0.,
        f64::MIN_POSITIVE,
        0.5,
        1.,
        2.,
        2.2,
        onsager_tc() - 1e-6,
        f64::from_bits(onsager_tc().to_bits() - 1),
        onsager_tc(),
        f64::MAX,
    ] {
        out.write_all(&onsager_magnetization(t).unwrap().to_le_bytes())
            .unwrap();
    }
}
