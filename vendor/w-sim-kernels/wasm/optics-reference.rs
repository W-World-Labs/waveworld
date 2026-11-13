//! Test-only binary adapter. Configs come from captured original product scenes.
use std::{
    env, fs,
    io::{self, Write},
};
use w_sim_kernels::optics::*;
fn word(b: &[u8], p: usize) -> u32 {
    u32::from_le_bytes(b[p..p + 4].try_into().unwrap())
}
fn double(b: &[u8], p: usize) -> f64 {
    f64::from_le_bytes(b[p..p + 8].try_into().unwrap())
}
fn emit<T>(out: &mut Vec<u8>, slice: &[T]) {
    out.extend(unsafe {
        std::slice::from_raw_parts(slice.as_ptr() as *const u8, std::mem::size_of_val(slice))
    });
}
fn main() {
    let raw = fs::read(env::args().nth(1).unwrap()).unwrap();
    if let Some(helper) = env::args().nth(2) {
        let a: Vec<f64> = (0..6).map(|i| double(&raw, i * 8)).collect();
        let direction = |d: Direction| vec![d.dx, d.dy];
        let values = match helper.as_str() {
            "unit" => direction(unit_from_rot(a[0]).unwrap()),
            "normalize" => direction(normalize(a[0], a[1]).unwrap()),
            "reflect" => direction(reflect(a[0], a[1], a[2], a[3]).unwrap()),
            "refract" => {
                if let Some(d) = refract(a[0], a[1], a[2], a[3], a[4], a[5]).unwrap() {
                    vec![d.dx, d.dy, 1.]
                } else {
                    vec![0.; 3]
                }
            }
            "incidence" => vec![incidence_angle_deg(a[0], a[1], a[2], a[3]).unwrap()],
            "malus" => {
                vec![malus_factor(if a[2] == 1. { Some(a[0]) } else { None }, a[1]).unwrap()]
            }
            "intersection" => {
                let g = SegmentGeom {
                    x0: double(&raw, 64),
                    y0: double(&raw, 72),
                    x1: double(&raw, 80),
                    y1: double(&raw, 88),
                    nx: double(&raw, 96),
                    ny: double(&raw, 104),
                };
                if let Some(h) = ray_segment_hit(a[0], a[1], a[2], a[3], &g, 1e-4).unwrap() {
                    vec![h.t, h.s, h.x, h.y, 1.]
                } else {
                    vec![0.; 5]
                }
            }
            _ => panic!("unknown helper"),
        };
        let mut out = Vec::new();
        emit(&mut out, &values);
        io::stdout().write_all(&out).unwrap();
        return;
    }
    let c = OpticsConfig {
        component_count: word(&raw, 0),
        max_bounces: word(&raw, 4),
        screen_bins: word(&raw, 8),
        reserved: 0,
    };
    let n = c.component_count as usize;
    let components: Vec<_> = (0..n)
        .map(|i| {
            let p = 16 + i * 88;
            OpticsComponent {
                kind: word(&raw, p),
                reserved: 0,
                x: double(&raw, p + 8),
                y: double(&raw, p + 16),
                rot: double(&raw, p + 24),
                length: double(&raw, p + 32),
                power: double(&raw, p + 40),
                wavelength_nm: double(&raw, p + 48),
                focal_length: double(&raw, p + 56),
                n: double(&raw, p + 64),
                pol_angle_deg: double(&raw, p + 72),
                split_t: double(&raw, p + 80),
            }
        })
        .collect();
    let mut state = OpticsState::default();
    let mut geoms = vec![SegmentGeom::default(); n];
    let mut stack = vec![OpticsRay::default(); STACK_CAPACITY];
    let mut segments = vec![RaySegment::default(); MAX_RAYS];
    let mut hits = vec![RayHit::default(); MAX_RAYS];
    let mut events = vec![OpticsEvent::default(); MAX_RAYS];
    let mut profiles = vec![ScreenProfile::default(); n];
    let mut bins = vec![0.; n * c.screen_bins as usize];
    let mut b = OpticsBuffers {
        geoms: &mut geoms,
        stack: &mut stack,
        segments: &mut segments,
        hits: &mut hits,
        events: &mut events,
        profiles: &mut profiles,
        bins: &mut bins,
    };
    init_trace(&c, &components, &mut state, &mut b).unwrap();
    let seed = b.stack[..state.stack_len as usize].to_vec();
    while !advance_trace(&c, &components, &mut state, &mut b, 17).unwrap() {}
    read_trace(&c, &state, &mut b).unwrap();
    let mut out = Vec::new();
    emit(&mut out, &[state]);
    emit(&mut out, b.geoms);
    emit(&mut out, &seed);
    emit(&mut out, &b.segments[..state.segment_count as usize]);
    emit(&mut out, &b.hits[..state.hit_count as usize]);
    emit(&mut out, &b.events[..state.event_count as usize]);
    emit(&mut out, &b.profiles[..state.profile_count as usize]);
    emit(&mut out, b.bins);
    io::stdout().write_all(&out).unwrap();
}
