//! Test-only native oracle for the molecular-dynamics kernel family behind
//! `md_init`, `md_step`, `md_batch`, `md_barostat`, `md_force`, `md_read`,
//! `md_rdf`, `md_diffusion` and the five `particles_*` exports. Reads one
//! binary case file holding the caller n/dim header, the 32-byte ABI config
//! blob, the 32-byte scalar state record, the optional bath, screening and
//! property records and every caller buffer; decodes the records exactly like
//! the WASM entry points (reserved words, bath flags and the particles
//! thermostat bit-rule included), runs the matching kernel call once, then
//! writes the status word and all caller-visible bytes so `md-tests.mjs`
//! compares native and WASM output exactly, including partially written
//! buffers and untouched sentinels left behind by kernel-level errors.
//!
//! Case file layout, all little-endian:
//!   u32 op, u32 n, u32 dim, u32 arg, f64 argf, u32 arg2, u32 pad;
//!   config[32]; state[32];
//!   op 2/3: bath[48];
//!   op 8..=11: screening[24], charge[n], sigma[n], epsilon[n] (f32);
//!   op 12: charge[n] (f32);
//!   op 0..=3, 8..=10: pos, vel, force, unwrapped (n*dim f32 each);
//!   op 4, 11: pos, force;
//!   op 5, 12: pos0, vel, unwrapped;
//!   op 6: pos;
//!   op 7: times[arg], msd[arg] (f64).
//! Output stream: u32 status, state[32], the same tail records, then the
//! call's output regions (scale / speed+stats / hist+r+g+stats / diffusion
//! output) exactly as they appear in caller memory after the single call.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::{
    md::{
        barostat_md, batch_md, batch_particles, compute_lj_forces,
        compute_particle_forces, diffusion_einstein, init_md, init_particles,
        radial_distribution, read_md, read_particles, step_md, step_particles, MdBath,
        MdBuffers, MdConfig, MdScalars, ParticleProperties, ScreeningParams,
    },
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
fn floats(b: &[u8], at: usize, count: usize) -> Vec<f32> {
    (0..count)
        .map(|i| f32::from_le_bytes(b[at + 4 * i..at + 4 * i + 4].try_into().unwrap()))
        .collect()
}
fn doubles(b: &[u8], at: usize, count: usize) -> Vec<f64> {
    (0..count)
        .map(|i| f64::from_le_bytes(b[at + 8 * i..at + 8 * i + 8].try_into().unwrap()))
        .collect()
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
fn write_f32(out: &mut impl Write, field: &[f32]) {
    for &v in field {
        out.write_all(&v.to_le_bytes()).unwrap();
    }
}
fn write_f64(out: &mut impl Write, field: &[f64]) {
    for &v in field {
        out.write_all(&v.to_le_bytes()).unwrap();
    }
}
fn write_state(out: &mut impl Write, s: &MdScalars) {
    write_f64(out, &[s.box_l, s.potential, s.virial, s.last_temperature]);
}

/// Decode the 32-byte `MdParameters` record like the ABI `md_parameters`
/// helper: nonzero reserved words are status 7, then `value_count` reports an
/// unsupported dimension (6) or zero/overflowing particle count (1).
fn decode_config(b: &[u8]) -> Result<MdConfig, u32> {
    if word(b, 8) != 0 || word(b, 12) != 0 {
        return Err(7);
    }
    let c = MdConfig {
        n: word(b, 0) as usize,
        dim: word(b, 4) as usize,
        dt: double(b, 16),
        rc: double(b, 24),
    };
    c.value_count().map_err(code)?;
    Ok(c)
}

/// Decode the 48-byte `MdBathParameters` record like the ABI `md_bath` helper:
/// unknown flag bits, a nonzero reserved word and nonzero bit patterns for
/// disabled targets are status 7.
fn decode_bath(b: &[u8]) -> Result<MdBath, u32> {
    let flags = word(b, 0);
    if flags > 3
        || word(b, 4) != 0
        || (flags & 1 == 0 && double(b, 8).to_bits() != 0)
        || (flags & 2 == 0 && double(b, 16).to_bits() != 0)
    {
        return Err(7);
    }
    Ok(MdBath {
        target_temperature: if flags & 1 == 1 {
            Some(double(b, 8))
        } else {
            None
        },
        target_pressure: if flags & 2 == 2 {
            Some(double(b, 16))
        } else {
            None
        },
        tau_p: double(b, 24),
        kappa_t: double(b, 32),
        max_scale: double(b, 40),
    })
}

fn properties<'a>(charge: &'a [f32], sigma: &'a [f32], epsilon: &'a [f32]) -> ParticleProperties<'a> {
    ParticleProperties {
        charge,
        sigma,
        epsilon,
    }
}

fn main() {
    let b = fs::read(env::args().nth(1).unwrap()).unwrap();
    let mut out = io::BufWriter::new(io::stdout().lock());
    let op = word(&b, 0);
    let n = word(&b, 4) as usize;
    let dim = word(&b, 8) as usize;
    let arg = word(&b, 12);
    let argf = double(&b, 16);
    let arg2 = word(&b, 24);
    let len = n * dim;
    let config = decode_config(&b[32..64]);
    let state_blob = &b[64..96];
    let mut state = MdScalars {
        box_l: double(state_blob, 0),
        potential: double(state_blob, 8),
        virial: double(state_blob, 16),
        last_temperature: double(state_blob, 24),
    };
    let mut at = 96;
    match op {
        // init / step / batch / barostat, homogeneous or heterogeneous.
        0 | 1 | 2 | 3 | 8 | 9 | 10 => {
            let mut echo: Vec<u8> = Vec::new();
            let bath = if matches!(op, 2 | 3) {
                echo.extend_from_slice(&b[at..at + 48]);
                let decoded = decode_bath(&b[at..at + 48]);
                at += 48;
                Some(decoded)
            } else {
                None
            };
            let particle = if (8..=11).contains(&op) {
                echo.extend_from_slice(&b[at..at + 24]);
                let screening = ScreeningParams {
                    eps_r: double(&b, at),
                    lambda_d: double(&b, at + 8),
                    k_coulomb: double(&b, at + 16),
                };
                at += 24;
                let charge = floats(&b, at, n);
                at += 4 * n;
                let sigma = floats(&b, at, n);
                at += 4 * n;
                let epsilon = floats(&b, at, n);
                at += 4 * n;
                Some((screening, charge, sigma, epsilon))
            } else {
                None
            };
            let mut pos = floats(&b, at, len);
            at += 4 * len;
            let mut vel = floats(&b, at, len);
            at += 4 * len;
            let mut force = floats(&b, at, len);
            at += 4 * len;
            let mut unwrapped = floats(&b, at, len);
            // The particles_batch export rejects an unknown thermostat bit or
            // a nonzero disabled-target bit pattern before reading any record.
            let rejected = op == 10 && (arg2 > 1 || (arg2 == 0 && argf.to_bits() != 0));
            let mut scale = f64::from_bits(SENT64);
            let code = if rejected {
                7
            } else if let Err(c) = &config {
                *c
            } else if let Some(Err(c)) = &bath {
                *c
            } else {
                let c = config.as_ref().unwrap();
                let result = {
                    let mut buffers = MdBuffers {
                        pos: &mut pos,
                        vel: &mut vel,
                        force: &mut force,
                        unwrapped: &mut unwrapped,
                    };
                    match (op, &particle) {
                        (0, None) => init_md(c, &mut state, &mut buffers).map(|_| 1.),
                        (1, None) => step_md(c, &mut state, &mut buffers).map(|_| 1.),
                        (2, None) => batch_md(
                            c,
                            &mut state,
                            &mut buffers,
                            bath.as_ref().unwrap().as_ref().unwrap(),
                            arg,
                        )
                        .map(|_| 1.),
                        (3, None) => barostat_md(
                            c,
                            &mut state,
                            &mut buffers,
                            bath.as_ref().unwrap().as_ref().unwrap(),
                        ),
                        (8, Some((s, q, sg, ep))) => init_particles(
                            c,
                            &mut state,
                            &mut buffers,
                            &properties(q, sg, ep),
                            s,
                        )
                        .map(|_| 1.),
                        (9, Some((s, q, sg, ep))) => step_particles(
                            c,
                            &mut state,
                            &mut buffers,
                            &properties(q, sg, ep),
                            s,
                        )
                        .map(|_| 1.),
                        (10, Some((s, q, sg, ep))) => batch_particles(
                            c,
                            &mut state,
                            &mut buffers,
                            &properties(q, sg, ep),
                            s,
                            if arg2 == 1 { Some(argf) } else { None },
                            arg,
                        )
                        .map(|_| 1.),
                        _ => unreachable!("case layout excludes this op"),
                    }
                };
                match result {
                    Ok(s) => {
                        scale = s;
                        0
                    }
                    Err(e) => code(e),
                }
            };
            out.write_all(&code.to_le_bytes()).unwrap();
            if code == 0 {
                write_state(&mut out, &state);
            } else {
                out.write_all(state_blob).unwrap();
            }
            out.write_all(&echo).unwrap();
            if let Some((_, q, sg, ep)) = &particle {
                write_f32(&mut out, q);
                write_f32(&mut out, sg);
                write_f32(&mut out, ep);
            }
            write_f32(&mut out, &pos);
            write_f32(&mut out, &vel);
            write_f32(&mut out, &force);
            write_f32(&mut out, &unwrapped);
            if op == 3 {
                out.write_all(&scale.to_le_bytes()).unwrap();
            }
        }
        // md_force / particles_force: force-only recompute, then pos + force.
        4 | 11 => {
            let mut echo: Vec<u8> = Vec::new();
            let particle = if op == 11 {
                echo.extend_from_slice(&b[at..at + 24]);
                let screening = ScreeningParams {
                    eps_r: double(&b, at),
                    lambda_d: double(&b, at + 8),
                    k_coulomb: double(&b, at + 16),
                };
                at += 24;
                let charge = floats(&b, at, n);
                at += 4 * n;
                let sigma = floats(&b, at, n);
                at += 4 * n;
                let epsilon = floats(&b, at, n);
                at += 4 * n;
                Some((screening, charge, sigma, epsilon))
            } else {
                None
            };
            let pos = floats(&b, at, len);
            at += 4 * len;
            let mut force = floats(&b, at, len);
            let code = match &config {
                Err(c) => *c,
                Ok(c) => {
                    let result = match &particle {
                        Some((s, q, sg, ep)) => compute_particle_forces(
                            c,
                            state.box_l,
                            &pos,
                            &mut force,
                            &properties(q, sg, ep),
                            s,
                        ),
                        None => compute_lj_forces(c, state.box_l, &pos, &mut force),
                    };
                    match result {
                        Ok(f) => {
                            state.potential = f.potential;
                            state.virial = f.virial;
                            0
                        }
                        Err(e) => code(e),
                    }
                }
            };
            out.write_all(&code.to_le_bytes()).unwrap();
            if code == 0 {
                write_state(&mut out, &state);
            } else {
                out.write_all(state_blob).unwrap();
            }
            out.write_all(&echo).unwrap();
            if let Some((_, q, sg, ep)) = &particle {
                write_f32(&mut out, q);
                write_f32(&mut out, sg);
                write_f32(&mut out, ep);
            }
            write_f32(&mut out, &pos);
            write_f32(&mut out, &force);
        }
        // md_read / particles_read: observables on supplied state; speed is
        // written by the kernel itself, stats only on success.
        5 | 12 => {
            let charge = if op == 12 {
                let q = floats(&b, at, n);
                at += 4 * n;
                Some(q)
            } else {
                None
            };
            let pos0 = floats(&b, at, len);
            at += 4 * len;
            let vel = floats(&b, at, len);
            at += 4 * len;
            let unwrapped = floats(&b, at, len);
            let stats_len = if op == 12 { 10 } else { 9 };
            let mut speed = vec![f32::from_bits(SENT32); n];
            let mut stats = vec![f64::from_bits(SENT64); stats_len];
            let code = match &config {
                Err(c) => *c,
                Ok(c) => {
                    let result = match &charge {
                        Some(q) => read_particles(c, &state, &pos0, &vel, &unwrapped, q, &mut speed)
                            .map(|s| (s.md, s.total_charge)),
                        None => read_md(c, &state, &pos0, &vel, &unwrapped, &mut speed)
                            .map(|s| (s, 0.)),
                    };
                    match result {
                        Ok((s, total)) => {
                            stats[..9].copy_from_slice(&[
                                s.temperature,
                                s.kinetic,
                                s.potential,
                                s.total,
                                s.pressure,
                                s.msd,
                                s.box_l,
                                s.volume,
                                s.density,
                            ]);
                            if stats_len == 10 {
                                stats[9] = total;
                            }
                            0
                        }
                        Err(e) => code(e),
                    }
                }
            };
            out.write_all(&code.to_le_bytes()).unwrap();
            out.write_all(state_blob).unwrap();
            if let Some(q) = &charge {
                write_f32(&mut out, q);
            }
            write_f32(&mut out, &pos0);
            write_f32(&mut out, &vel);
            write_f32(&mut out, &unwrapped);
            write_f32(&mut out, &speed);
            write_f64(&mut out, &stats);
        }
        // md_rdf: histogram scratch and both outputs, stats only on success.
        // A zero bin count cannot name a valid region, so it is status 2.
        6 => {
            let pos = floats(&b, at, len);
            let bins = arg as usize;
            let mut hist = vec![f64::from_bits(SENT64); bins];
            let mut r = vec![f32::from_bits(SENT32); bins];
            let mut g = vec![f32::from_bits(SENT32); bins];
            let mut stats = [f64::from_bits(SENT64); 2];
            let code = match &config {
                Err(c) => *c,
                Ok(c) => {
                    if bins == 0 {
                        2
                    } else {
                        match radial_distribution(
                            c,
                            state.box_l,
                            &pos,
                            argf,
                            &mut hist,
                            &mut r,
                            &mut g,
                        ) {
                            Ok(s) => {
                                stats = [s.r_max, s.pair_count as f64];
                                0
                            }
                            Err(e) => code(e),
                        }
                    }
                }
            };
            out.write_all(&code.to_le_bytes()).unwrap();
            out.write_all(state_blob).unwrap();
            write_f32(&mut out, &pos);
            write_f64(&mut out, &hist);
            write_f32(&mut out, &r);
            write_f32(&mut out, &g);
            write_f64(&mut out, &stats);
        }
        // md_diffusion: pure readout; output written only on success.
        7 => {
            let times = doubles(&b, at, arg as usize);
            at += 8 * arg as usize;
            let msd = doubles(&b, at, arg as usize);
            let mut output = [f64::from_bits(SENT64); 5];
            let code = match diffusion_einstein(&times, &msd, arg2 as usize, argf) {
                Ok(s) => {
                    output = [s.diffusion, s.slope, s.intercept, s.r2, s.n_fit as f64];
                    0
                }
                Err(e) => code(e),
            };
            out.write_all(&code.to_le_bytes()).unwrap();
            out.write_all(state_blob).unwrap();
            write_f64(&mut out, &times);
            write_f64(&mut out, &msd);
            write_f64(&mut out, &output);
        }
        _ => panic!("unknown reference operation"),
    }
    out.flush().unwrap();
}
