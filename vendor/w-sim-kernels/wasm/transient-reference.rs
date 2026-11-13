//! Test adapter only; all numerical functions come from the shared core.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::transient::*;
fn word(d: &[u8], p: usize) -> u32 {
    u32::from_le_bytes(d[p..p + 4].try_into().unwrap())
}
fn number(d: &[u8], p: usize) -> f64 {
    f64::from_le_bytes(d[p..p + 8].try_into().unwrap())
}
fn main() {
    let d = fs::read(env::args().nth(1).unwrap()).unwrap();
    let mut result = Vec::new();
    match word(&d, 0) {
        0 => {
            let p = TransientConfig {
                mode: word(&d, 8),
                reserved: word(&d, 12),
                v0: number(&d, 16),
                r: number(&d, 24),
                c: number(&d, 32),
                l: number(&d, 40),
            };
            let mut values = [0.; 241];
            let r = transient_result(&p, &mut values).unwrap();
            result.extend([r.tau, r.y_max, r.steady]);
            result.extend(values);
        }
        1 => {
            let (t, v, r, c, l) = (
                number(&d, 8),
                number(&d, 16),
                number(&d, 24),
                number(&d, 32),
                number(&d, 40),
            );
            let tau = time_constant_rc(r, c).unwrap();
            let w = first_order_weights(t, tau).unwrap();
            result.extend([
                tau,
                time_constant_rl(l, r).unwrap(),
                rc_charge(t, v, r, c).unwrap(),
                rc_discharge(t, v, r, c).unwrap(),
                rl_current(t, v, r, l).unwrap(),
                w.decay,
                w.settling_fraction,
            ]);
        }
        2 => {
            let p = FirstOrderConfig {
                voltage: number(&d, 8),
                resistance: number(&d, 16),
                capacitance: number(&d, 24),
                dt: number(&d, 32),
            };
            let mut state = number(&d, 40);
            result.push(state);
            for _ in 0..4 {
                first_order_step(&p, &mut state).unwrap();
                result.push(state);
            }
            let mut batch = number(&d, 40);
            first_order_advance(&p, &mut batch, 3).unwrap();
            first_order_advance(&p, &mut batch, 1).unwrap();
            result.push(batch);
        }
        3 => {
            let w = first_order_weights(number(&d, 8), number(&d, 16)).unwrap();
            result.extend([w.decay, w.settling_fraction]);
        }
        _ => panic!("unknown reference operation"),
    }
    let mut out = io::stdout().lock();
    for v in result {
        out.write_all(&v.to_le_bytes()).unwrap();
    }
}
