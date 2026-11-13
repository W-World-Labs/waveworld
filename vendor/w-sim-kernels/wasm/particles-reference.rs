// Deterministic prepared inputs; waveform/RNG/lattice preparation stays outside Rust.
use w_sim_kernels::md::*;
fn bits(a: &[f32]) -> Vec<u32> {
    a.iter().map(|v| v.to_bits()).collect()
}
fn main() {
    let name = std::env::args().nth(1).unwrap_or_else(|| "nve".into());
    let dim = if name == "three" { 3 } else { 2 };
    let c = MdConfig {
        n: 4,
        dim,
        dt: 0.005,
        rc: 2.5,
    };
    let mut s = MdScalars {
        box_l: 8.,
        ..Default::default()
    };
    let mut pos: Vec<f32> = if dim == 2 {
        vec![1., 1., 2.4, 1.1, 1.2, 2.6, 2.65, 2.5]
    } else {
        vec![1., 1., 1.2, 2.4, 1.1, 1.4, 1.2, 2.6, 1.6, 2.65, 2.5, 2.7]
    };
    let mut vel = vec![
        0.12, -0.04, -0.08, 0.05, 0.03, 0.1, -0.07, -0.11, 0.09, -0.02, 0.06, -0.13,
    ];
    vel.truncate(4 * dim);
    let original = pos.clone();
    let initial_vel = vel.clone();
    let mut force = vec![0.; 4 * dim];
    let mut unwrapped = force.clone();
    let mut speed = vec![0.; 4];
    let charge = if name == "neutral" {
        [0., 0., 0., 0.]
    } else {
        [1., -1., 0., 0.5]
    };
    let sigma = [0.8, 1., 0.9, 1.1];
    let epsilon = [0.8, 1.2, 0., 1.1];
    let properties = ParticleProperties {
        charge: &charge,
        sigma: &sigma,
        epsilon: &epsilon,
    };
    let screening = ScreeningParams {
        eps_r: 3.2,
        lambda_d: 0.9,
        k_coulomb: if name == "no-coulomb" { 0. } else { 0.7 },
    };
    init_particles(
        &c,
        &mut s,
        &mut MdBuffers {
            pos: &mut pos,
            vel: &mut vel,
            force: &mut force,
            unwrapped: &mut unwrapped,
        },
        &properties,
        &screening,
    )
    .unwrap();
    let mut times = vec![];
    let mut msd = vec![];
    let mut completed = 0;
    for steps in [4, 1, 2, 3] {
        batch_particles(
            &c,
            &mut s,
            &mut MdBuffers {
                pos: &mut pos,
                vel: &mut vel,
                force: &mut force,
                unwrapped: &mut unwrapped,
            },
            &properties,
            &screening,
            if name == "nvt" { Some(0.4) } else { None },
            steps,
        )
        .unwrap();
        completed += steps;
        times.push(completed as f64 * 0.005);
        msd.push(
            read_md(&c, &s, &original, &vel, &unwrapped, &mut speed)
                .unwrap()
                .msd,
        );
    }
    let particle_obs =
        read_particles(&c, &s, &original, &vel, &unwrapped, &charge, &mut speed).unwrap();
    let obs = particle_obs.md;
    let stats = [
        obs.temperature,
        obs.kinetic,
        obs.potential,
        obs.total,
        obs.pressure,
        obs.msd,
        obs.box_l,
        obs.volume,
        obs.density,
        particle_obs.total_charge,
    ];
    let mut hist = [0.; 8];
    let mut r = [0.; 8];
    let mut g = [0.; 8];
    let rdf =
        radial_distribution(&c, s.box_l, &pos, s.box_l / 2., &mut hist, &mut r, &mut g).unwrap();
    let history = times
        .iter()
        .zip(&msd)
        .map(|(t, m)| format!("{{\"time\":{},\"msd\":{}}}", t, m))
        .collect::<Vec<_>>()
        .join(",");
    println!("{{\"dim\":{},\"initialPos\":{:?},\"initialVel\":{:?},\"pos\":{:?},\"vel\":{:?},\"force\":{:?},\"unwrapped\":{:?},\"state\":{:?},\"stats\":{:?},\"speed\":{:?},\"r\":{:?},\"g\":{:?},\"rdf\":{:?},\"history\":[{}],\"charge\":{:?},\"sigma\":{:?},\"epsilon\":{:?}}}",dim,bits(&original),bits(&initial_vel),bits(&pos),bits(&vel),bits(&force),bits(&unwrapped),[s.box_l,s.potential,s.virial,s.last_temperature],stats,bits(&speed),bits(&r),bits(&g),[rdf.r_max,rdf.pair_count as f64],history,bits(&charge),bits(&sigma),bits(&epsilon));
}
