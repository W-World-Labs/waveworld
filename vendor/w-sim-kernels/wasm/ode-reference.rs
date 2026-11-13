//! Test-only file adapter. Input cases originate in captured old product code.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::ode::*;
fn word(b: &[u8], p: usize) -> u32 {
    u32::from_le_bytes(b[p..p + 4].try_into().unwrap())
}
fn double(b: &[u8], p: usize) -> f64 {
    f64::from_le_bytes(b[p..p + 8].try_into().unwrap())
}
fn main() {
    let b = fs::read(env::args().nth(1).unwrap()).unwrap();
    let kind = word(&b, 0);
    let batch = word(&b, 4) == 1;
    let n = word(&b, 8) as usize;
    let start = word(&b, 12) as usize;
    let p: Vec<f64> = (0..8).map(|i| double(&b, 64 + i * 8)).collect();
    let s = [double(&b, 128), double(&b, 136)];
    let mut output = Vec::new();
    let mut emit = |v: f64| output.extend(v.to_le_bytes());
    match kind {
        0 => {
            let p = RlcConfig {
                l: p[0],
                r: p[1],
                c: p[2],
                voltage: p[3],
                dt: p[4],
            };
            let mut state = RlcState { q: s[0], i: s[1] };
            let mut out = vec![state; n];
            if batch {
                advance_rlc(&p, &mut state, &mut out).unwrap()
            } else {
                for slot in &mut out {
                    state = rlc_step(state, &p).unwrap();
                    *slot = state;
                }
            }
            for v in [state.q, state.i] {
                emit(v)
            }
            for slot in out {
                emit(slot.q);
                emit(slot.i)
            }
            let r = read_rlc(&p, state).unwrap();
            for v in [
                r.omega0,
                r.damping_ratio,
                r.quality_factor.unwrap_or(0.),
                r.damped_frequency,
                r.energy,
                f64::from(u8::from(r.quality_factor.is_some())),
            ] {
                emit(v)
            }
        }
        1 => {
            let p = MutualConfig {
                l1: p[0],
                l2: p[1],
                m: p[2],
                r1: p[3],
                r2: p[4],
                v1: p[5],
                v2: p[6],
                dt: p[7],
            };
            let mut state = MutualRunState {
                i1: s[0],
                i2: s[1],
                primary_dissipation: double(&b, 144),
                secondary_dissipation: double(&b, 152),
            };
            let mut out = vec![MutualState::default(); n];
            let mut shares = vec![0.; n];
            if batch {
                advance_mutual(
                    &p,
                    &mut state,
                    start,
                    word(&b, 16) == 1,
                    double(&b, 32),
                    &mut out,
                    &mut shares,
                )
                .unwrap()
            } else {
                for slot in &mut out {
                    *slot = mutual_step(
                        MutualState {
                            i1: state.i1,
                            i2: state.i2,
                        },
                        &p,
                    )
                    .unwrap();
                    state.i1 = slot.i1;
                    state.i2 = slot.i2;
                }
            }
            for v in [
                state.i1,
                state.i2,
                state.primary_dissipation,
                state.secondary_dissipation,
            ] {
                emit(v)
            }
            for slot in out {
                emit(slot.i1);
                emit(slot.i2)
            }
            if batch {
                for v in shares {
                    emit(v)
                }
            }
            let r = read_mutual(&p, state).unwrap();
            for v in [
                r.coupling,
                r.turns_ratio,
                r.secondary_voltage,
                r.substeps as f64,
                r.secondary_share,
            ] {
                emit(v)
            }
        }
        2 => {
            let p = OscillatorConfig {
                mass: p[0],
                stiffness: p[1],
                damping: p[2],
                drive_amp: p[3],
                drive_omega: p[4],
                dt: p[5],
            };
            let mut state = OscillatorState { x: s[0], v: s[1] };
            let mut out = vec![state; n];
            if batch {
                advance_oscillator(&p, &mut state, start, &mut out).unwrap()
            } else {
                for (i, slot) in out.iter_mut().enumerate() {
                    state = oscillator_step(state, &p, double(&b, 24) + i as f64 * p.dt).unwrap();
                    *slot = state;
                }
            }
            for v in [state.x, state.v] {
                emit(v)
            }
            for slot in out {
                emit(slot.x);
                emit(slot.v)
            }
            emit(oscillator_omega0(p.mass, p.stiffness).unwrap());
            emit(oscillator_amplitude(&p, p.drive_omega).unwrap());
            let mut omega = vec![0.; word(&b, 56) as usize];
            let mut amplitude = omega.clone();
            oscillator_curve(
                &p,
                double(&b, 40),
                double(&b, 48),
                &mut omega,
                &mut amplitude,
            )
            .unwrap();
            for v in omega.into_iter().chain(amplitude) {
                emit(v)
            }
        }
        3 => {
            let p = NeuronConfig {
                current: p[0],
                dt: p[1],
                pulse_steps: p[2],
            };
            let mut state = NeuronState { v: s[0], w: s[1] };
            let mut voltage = vec![0.; n];
            let mut flags = vec![0; n];
            let pulses: Vec<u32> = (0..word(&b, 20) as usize)
                .map(|i| word(&b, 160 + i * 4))
                .collect();
            let mut states = vec![state; n];
            if batch {
                advance_neuron(&p, &mut state, &pulses, start, &mut voltage, &mut flags).unwrap()
            } else {
                for (i, slot) in states.iter_mut().enumerate() {
                    state = neuron_step(state, &p).unwrap();
                    *slot = state;
                    voltage[i] = state.v;
                }
            }
            emit(state.v);
            emit(state.w);
            if batch {
                for &v in &voltage {
                    emit(v)
                }
            } else {
                for slot in states {
                    emit(slot.v);
                    emit(slot.w)
                }
            }
            let mut values = vec![s[0]];
            values.extend(voltage);
            emit(peak(&values).unwrap());
            if batch {
                output.extend(flags)
            }
        }
        _ => panic!("unknown test kind"),
    }
    io::stdout().write_all(&output).unwrap();
}
