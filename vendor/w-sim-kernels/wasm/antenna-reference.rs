//! Test-only std binary adapter; all math is in the shared no_std crate.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::antenna::*;
fn main() {
    let bytes = fs::read(env::args().nth(1).unwrap()).unwrap();
    let u = |i| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
    let d = |i| f64::from_le_bytes(bytes[i..i + 8].try_into().unwrap());
    let link = || AntennaLinkConfig {
        pt_dbm: d(16),
        gt_dbi: d(24),
        gr_dbi: d(32),
        frequency_hz: d(40),
        distance_m: d(48),
        kind: u(56),
        reserved: u(60),
    };
    let array = || ArrayConfig {
        d_over_lambda: d(16),
        steer_deg: d(24),
        n: u(32),
        reserved: u(36),
    };
    let mut out = Vec::new();
    match u(0) {
        0 => {
            let mut pattern = [0.; 361];
            let mut powers = [0.; 121];
            let r = antenna_link(&link(), &mut pattern, &mut powers).unwrap();
            out.extend([r.directivity_db, r.beamwidth_deg, r.pr_dbm, r.fspl_db]);
            out.extend(pattern);
            out.extend(powers);
        }
        1 => {
            let p = Antenna3dConfig {
                frequency_hz: d(16),
                pt_dbm: d(24),
                distance_m: d(32),
                elevation_deg: d(40),
                polarization_deg: d(48),
            };
            let mut pattern = [0.; 49];
            let r = antenna_3d(&p, &mut pattern).unwrap();
            out.extend([
                r.pr_dbm.unwrap_or(0.),
                r.fspl_db,
                r.plf,
                if r.pr_dbm.is_some() { 1. } else { 0. },
            ]);
            out.extend(pattern);
        }
        2 => {
            let p = array();
            let mut pattern = [ArraySample::default(); 361];
            let mut scan = [ArraySample::default(); 2001];
            let mut phases = vec![0.; p.n as usize];
            let mut grating = [0.; 20];
            let r = array_result(&p, &mut pattern, &mut scan, &mut phases, &mut grating).unwrap();
            out.extend([
                r.beamwidth_deg,
                if r.beamwidth_clipped { 1. } else { 0. },
                r.grating_count as f64,
            ]);
            for v in pattern.into_iter().chain(scan) {
                out.extend([v.theta, v.gain]);
            }
            out.extend(phases);
            out.extend(grating);
        }
        3 => out.push(pattern_2d(u(8), d(16)).unwrap()),
        4 => out.push(directivity_db(u(8)).unwrap()),
        5 => out.push(antenna_beamwidth(u(8)).unwrap()),
        6 => out.push(polarization_loss(d(16)).unwrap()),
        7 => out.push(dipole_power(d(16)).unwrap()),
        8 => out.push(array_factor(&array(), d(48)).unwrap()),
        9 => {
            let mut scan = vec![ArraySample::default(); u(12) as usize];
            let r = array_beamwidth(&array(), &mut scan).unwrap();
            out.extend([r.width_deg, if r.clipped { 1. } else { 0. }]);
            for v in scan {
                out.extend([v.theta, v.gain]);
            }
        }
        10 => {
            let mut lobes = [0.; 20];
            let n = grating_lobes(d(16), d(24), &mut lobes).unwrap();
            out.push(n as f64);
            out.extend(lobes);
        }
        11 => out.push(math_value(u(8), d(16)).unwrap()),
        12 => {
            let r = friis_link(&link()).unwrap();
            out.extend([r.pr_dbm, r.fspl_db]);
        }
        13 => {
            for i in 0..u(12) as usize {
                out.push(math_value(u(16 + i * 16), d(24 + i * 16)).unwrap());
            }
        }
        _ => panic!("bad fixture operation"),
    }
    io::stdout()
        .write_all(&out.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<_>>())
        .unwrap();
}
