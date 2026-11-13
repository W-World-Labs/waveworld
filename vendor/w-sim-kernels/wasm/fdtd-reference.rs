// Tiny migration reference; expected JSON was captured from the original TS
// Yee update before removal. This binary calls only the shared Rust core.
use w_sim_kernels::fdtd::{
    add_soft_source, energy_fdtd, step_fdtd, FdtdBoundary, FdtdBuffers, FdtdConfig,
};
fn bits(field: &[f32]) -> Vec<u32> {
    field.iter().map(|v| v.to_bits()).collect()
}
fn main() {
    let boundary = if std::env::args().nth(1).as_deref() == Some("pec") {
        FdtdBoundary::Pec
    } else {
        FdtdBoundary::Mur
    };
    let c = FdtdConfig {
        nx: 5,
        ny: 4,
        dt: 0.25,
        mu: 1.5,
        boundary,
    };
    let eps: Vec<f32> = (0..20).map(|i| if i % 5 >= 3 { 2. } else { 1. }).collect();
    let mut mask = [0; 20];
    mask[0] = 1;
    mask[7] = 1;
    mask[12] = 2;
    let mut ez: Vec<f32> = (0..20)
        .map(|i| ((i % 5) as f64 - 2.) as f32 * 0.125)
        .collect();
    let mut hx: Vec<f32> = (0..20)
        .map(|i| ((i % 3) as f64 - 1.) as f32 * 0.0625)
        .collect();
    let mut hy: Vec<f32> = (0..20)
        .map(|i| ((i % 4) as f64 - 2.) as f32 * 0.03125)
        .collect();
    let mut left: Vec<f32> = (0..4).map(|j| ((j as f64 - 1.) * 0.01) as f32).collect();
    let mut right: Vec<f32> = (0..4).map(|j| (j as f64 * 0.02) as f32).collect();
    let mut bottom: Vec<f32> = (0..5).map(|i| ((i as f64 - 2.) * 0.015) as f32).collect();
    let mut top: Vec<f32> = (0..5).map(|i| (i as f64 * 0.01) as f32).collect();
    for sample in [0.3, -0.2, 0.05] {
        add_soft_source(&mut ez, 5, 4, 1, 2, sample).unwrap();
        step_fdtd(
            &c,
            &eps,
            Some(&mask),
            &mut FdtdBuffers {
                ez: &mut ez,
                hx: &mut hx,
                hy: &mut hy,
                prev_left: &mut left,
                prev_right: &mut right,
                prev_bottom: &mut bottom,
                prev_top: &mut top,
            },
        )
        .unwrap();
    }
    let energy = energy_fdtd(&c, &eps, &ez, &hx, &hy).unwrap();
    println!("{{\"ez\":{:?},\"hx\":{:?},\"hy\":{:?},\"left\":{:?},\"right\":{:?},\"bottom\":{:?},\"top\":{:?},\"energy\":{}}}",bits(&ez),bits(&hx),bits(&hy),bits(&left),bits(&right),bits(&bottom),bits(&top),energy);
}
