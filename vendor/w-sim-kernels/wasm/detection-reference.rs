//! Test-only std file adapter; no numerical implementation here.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{laser::*, nljd::*, radar::*};
fn doubles(out: &mut Vec<u8>, values: impl IntoIterator<Item = f64>) {
    for v in values {
        out.extend(v.to_le_bytes());
    }
}
fn main() {
    let input = fs::read(env::args().nth(1).unwrap()).unwrap();
    let u = |i| u32::from_le_bytes(input[i..i + 4].try_into().unwrap());
    let d = |i| f64::from_le_bytes(input[i..i + 8].try_into().unwrap());
    let f = |i| f32::from_le_bytes(input[i..i + 4].try_into().unwrap());
    let params = || LaserParams {
        tau_n: d(16),
        tau_c: d(24),
        b: d(32),
        spont: d(40),
    };
    let mut out = Vec::new();
    match u(0) {
        0 => {
            let p = RadarConfig {
                total_steps: u(16),
                mode: u(20),
                probes: core::array::from_fn(|i| u(24 + 4 * i)),
                reserved: [0; 2],
            };
            let mut s = RadarState::default();
            let mut f0 = vec![0.; CELLS];
            let mut f1 = vec![0.; CELLS];
            let mut mask = vec![0; CELLS];
            let mut traces = vec![0.; 4 * BUFFER];
            let mut b = RadarBuffers {
                field0: &mut f0,
                field1: &mut f1,
                mask: &mut mask,
                traces: &mut traces,
            };
            init_radar(&p, &mut s, &mut b).unwrap();
            if u(8) != 0 {
                s = RadarState {
                    completed: u(48),
                    current: u(52),
                    lengths: core::array::from_fn(|i| u(56 + i * 4)),
                    heads: core::array::from_fn(|i| u(72 + i * 4)),
                };
                for i in 0..CELLS {
                    b.field0[i] = f(88 + 4 * i);
                    b.field1[i] = f(88 + CELLS * 4 + 4 * i);
                }
                for i in 0..4 * BUFFER {
                    b.traces[i] = d(88 + CELLS * 8 + i * 8);
                }
            }
            while s.completed < p.total_steps {
                advance_radar(&p, &mut s, &mut b, 1).unwrap();
            }
            for v in [s.completed, s.current]
                .into_iter()
                .chain(s.lengths)
                .chain(s.heads)
            {
                out.extend(v.to_le_bytes());
            }
            for &v in b.field0.iter().chain(b.field1.iter()) {
                out.extend(v.to_le_bytes());
            }
            out.extend_from_slice(b.mask);
            doubles(&mut out, b.traces.iter().copied());
            for r in read_radar(&s, b.traces).unwrap() {
                doubles(
                    &mut out,
                    if let Some(r) = r {
                        [r.v, r.pp, 1.]
                    } else {
                        [0.; 3]
                    },
                );
            }
        }
        1 => {
            let p = RadarRangeParams {
                pt: d(16),
                gt: d(24),
                gr: d(32),
                lambda: d(40),
                sigma: d(48),
                s_min: d(56),
            };
            let r = radar_max_range(&p).unwrap();
            doubles(
                &mut out,
                [
                    r,
                    radar_received_power(&p, r / 2.).unwrap(),
                    radar_received_power(&p, r).unwrap(),
                    radar_received_power(&p, r * 2.).unwrap(),
                ],
            );
        }
        2 => {
            let p = LaserConfig {
                params: params(),
                pump: d(48),
                dt: d(56),
            };
            let mut s = LaserState { n: d(64), s: d(72) };
            doubles(&mut out, [s.n, s.s]);
            for _ in 0..u(4) {
                laser_step(&p.params, &mut s, p.pump, p.dt).unwrap();
                doubles(&mut out, [s.n, s.s]);
            }
            doubles(
                &mut out,
                [
                    threshold_pump(&p.params).unwrap(),
                    steady_photons(&p.params, p.pump).unwrap(),
                ],
            );
        }
        3 => {
            let mut curve = [LaserPoint::default(); 51];
            let r = laser_characteristics(&params(), d(48), &mut curve).unwrap();
            doubles(&mut out, [r.threshold, r.pump_max, r.steady_photons]);
            for v in curve {
                doubles(&mut out, [v.p, v.s]);
            }
        }
        4 => {
            let mut transfer = [0.; 81];
            let r = nljd_result(u(4), &mut transfer).unwrap();
            doubles(
                &mut out,
                [
                    r.coefficients.a2,
                    r.coefficients.a3,
                    r.harmonics.f1,
                    r.harmonics.f2,
                    r.harmonics.f3,
                    r.relative.f1,
                    r.relative.f2,
                    r.relative.f3,
                    r.verdict as f64,
                ],
            );
            doubles(&mut out, transfer);
        }
        5 => {
            let h = harmonic_amplitudes(d(16), d(24)).unwrap();
            doubles(&mut out, [h.f1, h.f2, h.f3]);
            for v in [-2., -1., 0., 0.5, 2.] {
                doubles(&mut out, [diode_response(v, d(16), d(24)).unwrap()]);
            }
        }
        6 => {
            let h = Harmonics {
                f1: d(16),
                f2: d(24),
                f3: d(32),
            };
            out.extend(classify(&h).unwrap().to_le_bytes());
        }
        _ => panic!("unknown test operation"),
    }
    io::stdout().write_all(&out).unwrap();
}
