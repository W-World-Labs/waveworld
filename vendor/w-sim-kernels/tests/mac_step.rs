use w_sim_kernels::{
    mac_projection::{MacProjectionConfig, MacProjectionError},
    mac_step::{step_mac3d, MacStepBuffers, MacStepConfig, MacStepError, MacStepStats},
    KernelError,
};

struct State {
    c: MacStepConfig,
    flags: Vec<u8>,
    current: [Vec<f64>; 3],
    acceleration: [Vec<f64>; 3],
    next: [Vec<f64>; 3],
    pressure: Vec<f64>,
    work: Vec<f64>,
    topology: Vec<u32>,
}

impl State {
    fn new(dims: [usize; 3], open_faces: u8) -> Self {
        let [nx, ny, nz] = dims;
        let n = nx * ny * nz;
        let current = core::array::from_fn(|a| {
            let mut d = dims;
            d[a] += 1;
            vec![0.0; d.into_iter().product()]
        });
        Self {
            c: MacStepConfig {
                projection: MacProjectionConfig {
                    nx,
                    ny,
                    nz,
                    dx_m: 1.0,
                    dt_s: 0.01,
                    density_kg_m3: 1.0,
                    open_faces,
                    max_iterations: 200,
                    absolute_divergence_tol: 1e-10,
                    relative_residual_tol: 0.0,
                },
                kinematic_viscosity_m2_s: 0.1,
                open_velocity_m_s: [0.0; 3],
            },
            flags: vec![0; n],
            acceleration: current.clone(),
            next: current.clone(),
            current,
            pressure: vec![0.0; n],
            work: vec![0.0; 6 * n],
            topology: vec![0; 2 * n],
        }
    }

    fn step(&mut self) -> Result<MacStepStats, MacStepError> {
        let [u, v, w] = &self.current;
        let [acceleration_u, acceleration_v, acceleration_w] = &self.acceleration;
        let [next_u, next_v, next_w] = &mut self.next;
        step_mac3d(
            &self.c,
            &self.flags,
            &mut MacStepBuffers {
                u,
                v,
                w,
                acceleration_u,
                acceleration_v,
                acceleration_w,
                next_u,
                next_v,
                next_w,
                pressure: &mut self.pressure,
                work: &mut self.work,
                topology_work: &mut self.topology,
            },
        )
    }

    fn face_index(&self, axis: usize, pos: [usize; 3]) -> usize {
        let p = &self.c.projection;
        let mut dims = [p.nx, p.ny, p.nz];
        dims[axis] += 1;
        pos[0] + dims[0] * (pos[1] + dims[1] * pos[2])
    }

    // Independent cell-centred quadrature, including zero normal-wall values.
    fn momentum(&self, fields: &[Vec<f64>; 3]) -> [f64; 3] {
        let p = &self.c.projection;
        let factor = 0.5 * p.density_kg_m3 * p.dx_m.powi(3);
        let mut result = [0.0; 3];
        for z in 0..p.nz {
            for y in 0..p.ny {
                for x in 0..p.nx {
                    if self.flags[x + p.nx * (y + p.ny * z)] != 0 {
                        continue;
                    }
                    for a in 0..3 {
                        let mut other = [x, y, z];
                        other[a] += 1;
                        result[a] += factor
                            * (fields[a][self.face_index(a, [x, y, z])]
                                + fields[a][self.face_index(a, other)]);
                    }
                }
            }
        }
        result
    }

    fn verify(&self, stats: MacStepStats) {
        let p = &self.c.projection;
        let mut largest: f64 = 0.0;
        for z in 0..p.nz {
            for y in 0..p.ny {
                for x in 0..p.nx {
                    if self.flags[x + p.nx * (y + p.ny * z)] != 0 {
                        continue;
                    }
                    let mut divergence = 0.0;
                    for a in 0..3 {
                        let mut other = [x, y, z];
                        other[a] += 1;
                        divergence += (self.next[a][self.face_index(a, other)]
                            - self.next[a][self.face_index(a, [x, y, z])])
                            / p.dx_m;
                    }
                    largest = largest.max(divergence.abs());
                }
            }
        }
        assert!(largest <= p.absolute_divergence_tol);
        close(stats.projection.final_divergence_linf, largest, 2e-14);
        let before = self.momentum(&self.current);
        let after = self.momentum(&self.next);
        for a in 0..3 {
            close(
                after[a] - before[a],
                stats.wall_impulse_kg_m_s[a]
                    + stats.open_impulse_kg_m_s[a]
                    + stats.body_impulse_kg_m_s[a]
                    + stats.pressure_impulse_kg_m_s[a],
                2e-12,
            );
        }
    }
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:.16e}, expected {expected:.16e}, tolerance {tolerance}"
    );
}

#[test]
fn uniform_open_flow_preserves_velocity_including_half_volume_boundaries() {
    let mut s = State::new([3, 3, 3], 63);
    s.c.open_velocity_m_s = [0.4, -0.2, 0.1];
    s.c.kinematic_viscosity_m2_s = 0.3;
    for a in 0..3 {
        s.current[a].fill(s.c.open_velocity_m_s[a]);
    }
    let stats = s.step().unwrap();
    for a in 0..3 {
        for &value in &s.next[a] {
            close(value, s.c.open_velocity_m_s[a], 2e-14);
        }
    }
    for &p in &s.pressure {
        close(p, 0.0, 2e-14);
    }
    s.verify(stats);
}

#[test]
fn tangential_backflow_donor_and_free_normal_velocity_work_for_both_signs() {
    for sign in [-1.0, 1.0] {
        let mut s = State::new([1, 1, 1], 63);
        s.c.projection.dt_s = 0.1;
        s.c.open_velocity_m_s = [17.0, 2.0, 0.0];
        s.current[0].fill(sign);
        let stats = s.step().unwrap();
        for &u in &s.next[0] {
            close(u, sign, 2e-14);
        }
        for &v in &s.next[1] {
            close(v, 0.2, 2e-14);
        }
        assert_eq!(s.next[2], [0.0, 0.0]);
        close(s.pressure[0], 0.0, 2e-14);
        close(stats.open_impulse_kg_m_s[1], 0.2, 2e-14);
        s.verify(stats);
    }
}

#[test]
fn tangential_outflow_uses_inside_donor_instead_of_reservoir() {
    let mut s = State::new([1, 1, 1], 63);
    s.current[0].fill(1.0);
    s.current[1].fill(1.0);
    s.c.open_velocity_m_s = [1.0, 2.0, 0.0];
    let stats = s.step().unwrap();
    for &v in &s.next[1] {
        close(v, 1.01, 2e-14);
    }
    for &u in &s.next[0] {
        close(u, 1.0, 2e-14);
    }
    close(stats.open_impulse_kg_m_s[1], 0.01, 2e-14);
    s.verify(stats);
}

#[test]
fn wall_tangential_half_distance_and_discrete_poiseuille_all_axes() {
    for flow_axis in 0..3 {
        let wall_axis = (flow_axis + 1) % 3;
        let dims = core::array::from_fn(|a| {
            if a == flow_axis || a == wall_axis {
                3
            } else {
                1
            }
        });
        for steady in [false, true] {
            let mut s = State::new(dims, 63 & !(3 << (2 * wall_axis)));
            s.c.kinematic_viscosity_m2_s = if steady { 1.0 } else { 0.5 };
            let mut face_dims = dims;
            face_dims[flow_axis] += 1;
            for z in 0..face_dims[2] {
                for y in 0..face_dims[1] {
                    for x in 0..face_dims[0] {
                        let pos = [x, y, z];
                        let k = s.face_index(flow_axis, pos);
                        s.current[flow_axis][k] = if steady {
                            [3.0, 5.0, 3.0][pos[wall_axis]]
                        } else {
                            1.0
                        };
                        s.acceleration[flow_axis][k] = if steady { 4.0 } else { 0.0 };
                    }
                }
            }
            let stats = s.step().unwrap();
            for z in 0..face_dims[2] {
                for y in 0..face_dims[1] {
                    for x in 0..face_dims[0] {
                        let pos = [x, y, z];
                        let k = s.face_index(flow_axis, pos);
                        let expected = if steady {
                            s.current[flow_axis][k]
                        } else if pos[wall_axis] == 1 {
                            1.0
                        } else {
                            0.99
                        };
                        close(s.next[flow_axis][k], expected, 3e-13);
                    }
                }
            }
            for &p in &s.pressure {
                close(p, 0.0, 3e-13);
            }
            s.verify(stats);
        }
    }
}

#[test]
fn each_owner_half_face_advects_circulation_and_physical_viscosity_damps_it() {
    for nu in [0.0, 0.1] {
        let mut s = State::new([2, 2, 1], 48);
        s.c.kinematic_viscosity_m2_s = nu;
        s.current[0][1] = 1.0;
        s.current[0][4] = -1.0;
        s.current[1][2] = -1.0;
        s.current[1][3] = 1.0;
        // Exact one-step donor loss is 1.5*u. Prematurely averaging the two
        // opposite lateral transporting velocities would incorrectly lose 0.5*u.
        let factor = 1.0 - 0.01 * (1.5 + 6.0 * nu);
        let stats = s.step().unwrap();
        for a in 0..3 {
            for (k, &value) in s.next[a].iter().enumerate() {
                close(value, s.current[a][k] * factor, 2e-14);
            }
        }
        let energy: f64 = s.next.iter().flatten().map(|v| 0.5 * v * v).sum();
        close(energy, 2.0 * factor * factor, 2e-14);
        for &p in &s.pressure {
            close(p, 0.0, 2e-14);
        }
        s.verify(stats);
    }
}

#[test]
fn mixed_fluid_and_solid_half_faces_have_distinct_wall_distances() {
    let mut s = State::new([2, 2, 1], 63);
    s.flags[3] = 20;
    s.c.kinematic_viscosity_m2_s = 1.0;
    s.current[0][..3].fill(1.0);
    let stats = s.step().unwrap();
    // Independent 3x3 pressure system Ahat=[[10,-1,-1],[-1,9,0],[-1,0,9]],
    // bhat=[.5,.5,1]. No values come from saved solver outputs.
    for (&actual, expected) in s
        .pressure
        .iter()
        .zip([3.0 / 44.0, 25.0 / 396.0, 47.0 / 396.0, 0.0])
    {
        close(actual, expected, 2e-13);
    }
    close(stats.wall_impulse_kg_m_s[0], -0.025, 2e-14);
    close(
        stats.pressure_impulse_kg_m_s[0],
        -0.01 * 47.0 / 396.0,
        2e-14,
    );
    close(
        s.momentum(&s.next)[0],
        2.0 - 0.025 - 0.01 * 47.0 / 396.0,
        2e-13,
    );
    assert!(s.next.iter().flatten().all(|v| v.is_finite()));
    s.verify(stats);
}

#[test]
fn body_acceleration_and_projection_use_si_density_length_and_time() {
    let mut s = State::new([2, 1, 1], 0);
    s.c.projection.dx_m = 2.0;
    s.c.projection.density_kg_m3 = 3.0;
    s.c.projection.dt_s = 0.1;
    s.acceleration[0][1] = 2.0;
    let stats = s.step().unwrap();
    for &v in s.next.iter().flatten() {
        close(v, 0.0, 2e-14);
    }
    close(s.pressure[0], 0.0, 2e-14);
    close(s.pressure[1], 12.0, 2e-13);
    close(stats.body_impulse_kg_m_s[0], 4.8, 2e-14);
    close(stats.pressure_impulse_kg_m_s[0], -4.8, 2e-14);
    assert_eq!(stats.wall_impulse_kg_m_s, [0.0; 3]);
    assert_eq!(stats.open_impulse_kg_m_s, [0.0; 3]);
    s.verify(stats);
}

#[test]
fn combined_local_cfl_is_required_even_when_each_term_is_below_one() {
    let mut s = State::new([3, 3, 3], 63);
    s.c.projection.dt_s = 1.0;
    s.c.kinematic_viscosity_m2_s = 0.11;
    s.c.open_velocity_m_s = [0.45, 0.0, 0.0];
    s.current[0].fill(0.45);
    let before = s.current.clone();
    let error = s.step().unwrap_err();
    let MacStepError::TimeStepExceeded {
        advection_cfl,
        diffusion_cfl,
        combined_cfl,
    } = error
    else {
        panic!("wrong error {error:?}");
    };
    close(advection_cfl, 0.9, 2e-14);
    close(diffusion_cfl, 0.66, 2e-14);
    close(combined_cfl, 1.56, 2e-14);
    assert_eq!(s.current, before);
    // Same physical viscosity, explicitly corrected timestep; no automatic fix.
    s.c.projection.dt_s = 0.1;
    let stats = s.step().unwrap();
    assert_eq!(s.c.kinematic_viscosity_m2_s, 0.11);
    s.verify(stats);
}

#[test]
fn closed_circulation_can_advance_three_steps_without_losing_its_volume_constraint() {
    let mut s = State::new([2, 2, 1], 48);
    s.current[0][1] = 1.0;
    s.current[0][4] = -1.0;
    s.current[1][2] = -1.0;
    s.current[1][3] = 1.0;
    let mut amplitude = 1.0;
    for _ in 0..3 {
        amplitude *= 1.0 - 0.01 * (1.5 * amplitude + 0.6);
        let stats = s.step().unwrap();
        close(s.next[0][1], amplitude, 2e-14);
        s.verify(stats);
        std::mem::swap(&mut s.current, &mut s.next);
    }
}

#[test]
fn invalid_state_nonfinite_input_and_projection_failure_never_change_current() {
    for mode in 0..7 {
        let mut s = State::new([2, 2, 1], 0);
        match mode {
            0 => s.c.kinematic_viscosity_m2_s = -1.0,
            1 => s.c.projection.dt_s = 0.0,
            2 => s.current[0][0] = 1.0, // prescribed impermeable wall
            3 => s.current[0][1] = 1.0, // unresolved initial divergence
            4 => {
                s.acceleration[2].pop();
            }
            5 => s.c.open_velocity_m_s[0] = f64::INFINITY,
            _ => s.c.projection.dx_m = 1e-200,
        }
        let before = s.current.clone();
        assert!(matches!(s.step(), Err(MacStepError::Invalid(_))));
        assert_eq!(s.current, before);
    }
    let mut s = State::new([2, 2, 1], 0);
    s.acceleration[0][1] = f64::NAN;
    assert_eq!(
        s.step(),
        Err(MacStepError::Invalid(KernelError::NonFiniteValue))
    );
    s.acceleration[0][1] = 2.0;
    s.acceleration[0][4] = 1.0;
    s.acceleration[1][2] = 1.0;
    s.acceleration[1][3] = 4.0;
    s.c.projection.max_iterations = 1;
    let before = s.current.clone();
    assert!(matches!(
        s.step(),
        Err(MacStepError::Projection(
            MacProjectionError::NotConverged { .. }
        ))
    ));
    assert_eq!(s.current, before);
    s.c.projection.max_iterations = 200;
    let stats = s.step().unwrap();
    s.verify(stats);
}
