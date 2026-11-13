//! Short synthetic P–Q / momentum coupling checks, not a manufacturer fan or
//! an engineering cooling validation. The fan is a one-cell-thick body force.

use w_sim_kernels::fan_curve::{pressure_rise, FanCurvePoint};
use w_sim_kernels::mac_projection::MacProjectionConfig;
use w_sim_kernels::mac_step::{step_mac3d, MacStepBuffers, MacStepConfig, MacStepStats};

const NX: usize = 5;
const NY: usize = 3;
const NZ: usize = 3;
const H: f64 = 0.01;
const DT: f64 = 1e-4;
const RHO: f64 = 1.225;
const NU: f64 = 1.81e-5 / RHO;
const AREA: f64 = (NY * NZ) as f64 * H * H;
const FAN_FACE: usize = 2;
const CURVE: [FanCurvePoint; 2] = [
    FanCurvePoint {
        flow_m3_s: 0.0,
        pressure_pa: 20.0,
    },
    FanCurvePoint {
        flow_m3_s: 0.01,
        pressure_pa: 0.0,
    },
];

struct Case {
    config: MacStepConfig,
    u: Vec<f64>,
    v: Vec<f64>,
    w: Vec<f64>,
    acceleration_u: Vec<f64>,
    pressure: Vec<f64>,
}

impl Case {
    fn air() -> Self {
        Self {
            config: MacStepConfig {
                projection: MacProjectionConfig {
                    nx: NX,
                    ny: NY,
                    nz: NZ,
                    dx_m: H,
                    dt_s: DT,
                    density_kg_m3: RHO,
                    // Equal zero-pressure x openings; no imposed inlet speed.
                    // The four lateral faces are no-slip walls.
                    open_faces: 3,
                    max_iterations: 200,
                    absolute_divergence_tol: 1e-10,
                    relative_residual_tol: 0.0,
                },
                kinematic_viscosity_m2_s: NU,
                open_velocity_m_s: [0.0; 3],
            },
            u: vec![0.0; (NX + 1) * NY * NZ],
            v: vec![0.0; NX * (NY + 1) * NZ],
            w: vec![0.0; NX * NY * (NZ + 1)],
            acceleration_u: vec![0.0; (NX + 1) * NY * NZ],
            pressure: vec![0.0; NX * NY * NZ],
        }
    }

    fn drive_from_measured_flow(&mut self) -> f64 {
        let dp = pressure_rise(&CURVE, self.flow(FAN_FACE), 1.0).unwrap();
        self.acceleration_u.fill(0.0);
        for z in 0..NZ {
            for y in 0..NY {
                self.acceleration_u[FAN_FACE + (NX + 1) * (y + NY * z)] = dp / (RHO * H);
            }
        }
        dp
    }

    fn step(&mut self) -> MacStepStats {
        let n = NX * NY * NZ;
        let mut next_u = vec![0.0; self.u.len()];
        let mut next_v = vec![0.0; self.v.len()];
        let mut next_w = vec![0.0; self.w.len()];
        let stats = step_mac3d(
            &self.config,
            &vec![0; n],
            &mut MacStepBuffers {
                u: &self.u,
                v: &self.v,
                w: &self.w,
                acceleration_u: &self.acceleration_u,
                acceleration_v: &vec![0.0; self.v.len()],
                acceleration_w: &vec![0.0; self.w.len()],
                next_u: &mut next_u,
                next_v: &mut next_v,
                next_w: &mut next_w,
                pressure: &mut self.pressure,
                work: &mut vec![0.0; 6 * n],
                topology_work: &mut vec![0; 2 * n],
            },
        )
        .unwrap();
        self.u = next_u;
        self.v = next_v;
        self.w = next_w;
        stats
    }

    fn flow(&self, x: usize) -> f64 {
        (0..NZ)
            .flat_map(|z| (0..NY).map(move |y| self.u[x + (NX + 1) * (y + NY * z)]))
            .sum::<f64>()
            * H
            * H
    }

    // Independent dual-volume integral. Boundary normal faces own half a cell.
    fn momentum_x(&self) -> f64 {
        self.u
            .iter()
            .enumerate()
            .map(|(i, u)| {
                let x = i % (NX + 1);
                u * if x == 0 || x == NX { 0.5 } else { 1.0 }
            })
            .sum::<f64>()
            * RHO
            * H
            * H
            * H
    }

    fn kinetic_energy(&self) -> f64 {
        let dims = [NX, NY, NZ];
        let mut sum = 0.0;
        for (axis, field) in [&self.u, &self.v, &self.w].into_iter().enumerate() {
            let mut face_dims = dims;
            face_dims[axis] += 1;
            for (i, speed) in field.iter().enumerate() {
                let coord = [
                    i % face_dims[0],
                    i / face_dims[0] % face_dims[1],
                    i / (face_dims[0] * face_dims[1]),
                ];
                let weight = if coord[axis] == 0 || coord[axis] == dims[axis] {
                    0.5
                } else {
                    1.0
                };
                sum += weight * speed * speed;
            }
        }
        0.5 * RHO * H * H * H * sum
    }

    fn assert_divergence_and_flux(&self) {
        // Independent cell stencil, without the projection's matrix/traversal.
        for z in 0..NZ {
            for y in 0..NY {
                for x in 0..NX {
                    let ui = x + (NX + 1) * (y + NY * z);
                    let vi = x + NX * (y + (NY + 1) * z);
                    let wi = x + NX * (y + NY * z);
                    let divergence = (self.u[ui + 1] - self.u[ui] + self.v[vi + NX] - self.v[vi]
                        + self.w[wi + NX * NY]
                        - self.w[wi])
                        / H;
                    close(
                        divergence,
                        0.0,
                        self.config.projection.absolute_divergence_tol,
                    );
                }
            }
        }
        for x in 0..=NX {
            close(self.flow(x), self.flow(0), 1e-13);
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
fn physical_air_fan_curve_drives_and_releases_flow_in_three_steps() {
    let mut air = Case::air();
    let dp1 = air.drive_from_measured_flow();
    let first = air.step();
    // At rest, advection and viscosity contribute zero. A single internal
    // pressure jump between p=0 ends gives rho L dU/dt = dp, L=NX*H.
    let expected_u = 20.0 * DT / (RHO * NX as f64 * H);
    let expected_impulse = 20.0 * AREA * DT;
    assert_eq!(dp1, 20.0);
    for &u in &air.u {
        close(u, expected_u, 1e-12);
    }
    for &v in air.v.iter().chain(&air.w) {
        close(v, 0.0, 1e-12);
    }
    for (i, &pressure) in air.pressure.iter().enumerate() {
        let x = i % NX;
        let expected =
            -20.0 * (x as f64 + 0.5) / NX as f64 + if x >= FAN_FACE { 20.0 } else { 0.0 };
        close(pressure, expected, 1e-9);
    }
    close(air.momentum_x(), expected_impulse, 1e-18);
    close(first.body_impulse_kg_m_s[0], expected_impulse, 1e-18);
    let q1 = air.flow(FAN_FACE);
    close(q1, expected_u * AREA, 1e-14);
    air.assert_divergence_and_flux();

    let dp2 = air.drive_from_measured_flow();
    close(dp2, 20.0 * (1.0 - q1 / 0.01), 1e-12);
    assert!(dp2 > 0.0 && dp2 < dp1);
    air.step();
    let q2 = air.flow(FAN_FACE);
    assert!(q2 > q1);
    assert!(pressure_rise(&CURVE, q2, 1.0).unwrap() < dp2);
    air.assert_divergence_and_flux();

    let energy2 = air.kinetic_energy();
    let momentum2 = air.momentum_x();
    // Stop applying the actuator force; RPM=0 is outside this curve model.
    air.acceleration_u.fill(0.0);
    let third = air.step();
    assert_eq!(third.body_impulse_kg_m_s, [0.0; 3]);
    assert!(air.flow(FAN_FACE) < q2);
    assert!(air.momentum_x() < momentum2);
    assert!(air.kinetic_energy() < energy2);
    air.assert_divergence_and_flux();
    assert_eq!(air.config.kinematic_viscosity_m2_s, NU);
    assert_eq!(air.config.projection.dt_s, DT);

    let mut idle = Case::air();
    for _ in 0..3 {
        let stats = idle.step();
        assert_eq!(stats.body_impulse_kg_m_s, [0.0; 3]);
        assert_eq!(idle.kinetic_energy(), 0.0);
        assert_eq!(idle.flow(FAN_FACE), 0.0);
    }
}

#[test]
fn stopping_uniform_flow_has_resolved_wall_viscous_loss() {
    let initial_u = 20.0 * DT / (RHO * NX as f64 * H);
    let mut air = Case::air();
    air.u.fill(initial_u);
    let initial_momentum = air.momentum_x();
    let initial_energy = air.kinetic_energy();
    let stats = air.step();
    // Initially uniform x flow has exactly cancelling donor-cell advection.
    // Each side wall at H/2 contributes -2*nu*dt*U/H² to its adjacent row.
    let diffusion = NU * DT / (H * H);
    for (i, &u) in air.u.iter().enumerate() {
        let y = i / (NX + 1) % NY;
        let z = i / ((NX + 1) * NY);
        let walls = usize::from(y == 0 || y == NY - 1) + usize::from(z == 0 || z == NZ - 1);
        close(u, initial_u * (1.0 - 2.0 * diffusion * walls as f64), 1e-12);
    }
    // Independent integrated wall shear: tau_wall=-2*mu*U/H, summed
    // across both y walls and both z walls, each with length NX*H.
    let wall_impulse = -4.0 * (RHO * NU) * initial_u * NX as f64 * H * (NY + NZ) as f64 * DT;
    close(air.momentum_x() - initial_momentum, wall_impulse, 1e-18);
    close(stats.wall_impulse_kg_m_s[0], wall_impulse, 1e-18);
    assert!(air.kinetic_energy() < initial_energy);
    air.assert_divergence_and_flux();

    // An explicit inviscid diagnostic isolates viscosity from inlet forcing
    // and advection. The actual air case above keeps the physical NU and DT.
    let mut inviscid = Case::air();
    inviscid.config.kinematic_viscosity_m2_s = 0.0;
    inviscid.u.fill(initial_u);
    inviscid.step();
    for &u in &inviscid.u {
        close(u, initial_u, 1e-14);
    }
    close(inviscid.momentum_x(), initial_momentum, 1e-18);
    close(inviscid.kinetic_energy(), initial_energy, 1e-20);
    assert_eq!(air.config.kinematic_viscosity_m2_s, NU);
    assert_eq!(air.config.projection.dt_s, DT);
}
