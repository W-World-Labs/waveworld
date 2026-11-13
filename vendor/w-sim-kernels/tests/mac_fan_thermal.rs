//! Three physical steps of a synthetic body-force fan and two heated blocks.
//! This checks coupling and energy accounting, not rotor or server validation.

use w_sim_kernels::fan_curve::{pressure_rise, FanCurvePoint};
use w_sim_kernels::mac_projection::MacProjectionConfig;
use w_sim_kernels::mac_step::{step_mac3d, MacStepBuffers, MacStepConfig};
use w_sim_kernels::mac_thermal::{
    step_mac_thermal3d, MacThermalBuffers, ThermalConfig, ThermalMaterial, ThermalMode, ThermalStep,
};

const NX: usize = 5;
const NY: usize = 3;
const NZ: usize = 3;
const N: usize = NX * NY * NZ;
const H: f64 = 0.01;
const DT: f64 = 1e-4;
const RHO: f64 = 1.225;
const NU: f64 = 1.81e-5 / RHO;
const CP: f64 = 1005.0;
const AIR_K: f64 = 0.026;
const COPPER_K: f64 = 400.0;
const ALUMINIUM_K: f64 = 205.0;
const CONTACT_R: f64 = 0.001;
const POWER: f64 = 2.0;
const COPPER: usize = 2 + NX * NY;
const ALUMINIUM: usize = 3 + NX * NY;
const FAN_FACE: usize = 1;

struct Velocity {
    u: Vec<f64>,
    v: Vec<f64>,
    w: Vec<f64>,
}

impl Velocity {
    fn zero() -> Self {
        Self {
            u: vec![0.0; (NX + 1) * NY * NZ],
            v: vec![0.0; NX * (NY + 1) * NZ],
            w: vec![0.0; NX * NY * (NZ + 1)],
        }
    }

    fn flow(&self, x: usize) -> f64 {
        (0..NZ)
            .flat_map(|z| (0..NY).map(move |y| self.u[x + (NX + 1) * (y + NY * z)]))
            .sum::<f64>()
            * H
            * H
    }

    fn advance_fan(&mut self, config: &MacStepConfig, flags: &[u8]) -> f64 {
        // Synthetic SI curve, deliberately independent of manufacturer data.
        let curve = [
            FanCurvePoint {
                flow_m3_s: 0.0,
                pressure_pa: 20.0,
            },
            FanCurvePoint {
                flow_m3_s: 0.01,
                pressure_pa: 0.0,
            },
        ];
        let dp = pressure_rise(&curve, self.flow(FAN_FACE), 1.0).unwrap();
        let mut acceleration_u = vec![0.0; self.u.len()];
        for z in 0..NZ {
            for y in 0..NY {
                // Both cells owning this face are fluid; thickness is H.
                acceleration_u[FAN_FACE + (NX + 1) * (y + NY * z)] = dp / (RHO * H);
            }
        }
        let mut next = Self::zero();
        let stats = step_mac3d(
            config,
            flags,
            &mut MacStepBuffers {
                u: &self.u,
                v: &self.v,
                w: &self.w,
                acceleration_u: &acceleration_u,
                acceleration_v: &vec![0.0; self.v.len()],
                acceleration_w: &vec![0.0; self.w.len()],
                next_u: &mut next.u,
                next_v: &mut next.v,
                next_w: &mut next.w,
                pressure: &mut vec![0.0; N],
                work: &mut vec![0.0; 6 * N],
                topology_work: &mut vec![0; 2 * N],
            },
        )
        .unwrap();
        close(
            stats.body_impulse_kg_m_s[0],
            dp * (NY * NZ) as f64 * H * H * DT,
            1e-18,
        );
        assert!(
            stats.projection.final_divergence_linf <= config.projection.absolute_divergence_tol
        );
        *self = next;
        for x in 0..=NX {
            close(self.flow(x), self.flow(0), 1e-13);
        }
        dp
    }

    fn heat(
        &self,
        c: &MacProjectionConfig,
        p: &ThermalConfig,
        flags: &[u8],
        energy: &[f64],
    ) -> (Vec<f64>, Vec<f64>, ThermalStep) {
        let mut next_energy = vec![0.0; N];
        let mut temperature = vec![0.0; N];
        let stats = step_mac_thermal3d(
            c,
            p,
            flags,
            &mut MacThermalBuffers {
                u: &self.u,
                v: &self.v,
                w: &self.w,
                energy,
                next_energy: &mut next_energy,
                temperature_delta_k: &mut temperature,
                work: &mut vec![0.0; N],
            },
        )
        .unwrap();
        (next_energy, temperature, stats)
    }

    fn boundary_energy(&self, energy: &[f64]) -> f64 {
        // Independent outward flux at the two pressure openings. Inflow has
        // ambient sensible energy zero; openings have no conductive exchange.
        let mut outward = 0.0;
        for z in 0..NZ {
            for y in 0..NY {
                let left = NX * (y + NY * z);
                let ui = (NX + 1) * (y + NY * z);
                outward += (-self.u[ui]).max(0.0) * energy[left] / capacity(0)
                    + self.u[ui + NX].max(0.0) * energy[left + NX - 1] / capacity(0);
            }
        }
        -DT * RHO * CP * H * H * outward
    }
}

fn capacity(flag: u8) -> f64 {
    let density_cp = match flag {
        0 => RHO * CP,
        4 => 8960.0 * 385.0,
        5 => 2700.0 * 900.0,
        _ => panic!("unexpected test material"),
    };
    density_cp * H * H * H
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:.16e}, expected {expected:.16e}, tolerance {tolerance}"
    );
}

#[test]
fn physical_air_fan_transports_heat_with_solid_contact_and_open_energy_accounting() {
    let flow_config = MacStepConfig {
        projection: MacProjectionConfig {
            nx: NX,
            ny: NY,
            nz: NZ,
            dx_m: H,
            dt_s: DT,
            density_kg_m3: RHO,
            open_faces: 3,
            max_iterations: 200,
            absolute_divergence_tol: 1e-10,
            relative_residual_tol: 0.0,
        },
        kinematic_viscosity_m2_s: NU,
        open_velocity_m_s: [0.0; 3],
    };
    let mut thermal_config = ThermalConfig {
        gravity_per_kelvin: 0.0, // Passive heat transport; no buoyancy feedback.
        dt_seconds: DT,
        ambient_c: 25.0,
        fixed_surface_c: 0.0,
        dx_meters: H,
        fluid_density: RHO,
        fluid_specific_heat: CP,
        fluid_conductivity: AIR_K,
        solid_density: 8960.0,
        solid_specific_heat: 385.0,
        solid_conductivity: COPPER_K,
        total_power_w: POWER,
        mode: ThermalMode::SolidPower,
        max_substeps: 1,
        temperature_scale_c: 1.0,
        material_count: 1,
        materials: [ThermalMaterial::default(); 16],
        contact_resistance: [0.0; 136],
        contact_mask: [0; 5],
    };
    thermal_config.materials[0] = ThermalMaterial {
        density: 2700.0,
        specific_heat: 900.0,
        conductivity: ALUMINIUM_K,
        total_power_w: 0.0,
    };
    thermal_config.set_contact(0, 1, CONTACT_R).unwrap();
    let mut flags = vec![0; N];
    flags[COPPER] = 4;
    flags[ALUMINIUM] = 5;
    // Preheat the fluid, including the outlet: removal is observable in three
    // short steps without claiming that fan-cooled inlet air reached a chip.
    let mut energy = flags
        .iter()
        .map(|&flag| {
            capacity(flag)
                * match flag {
                    4 => 30.0,
                    5 => 20.0,
                    _ => 10.0,
                }
        })
        .collect::<Vec<_>>();
    let initial_total: f64 = energy.iter().sum();
    let mut fan = Velocity::zero();
    let still = Velocity::zero();
    let mut boundary_total = 0.0;
    let mut previous_dp = f64::INFINITY;
    let mut previous_flow = 0.0;

    for step in 0..3 {
        let dp = fan.advance_fan(&flow_config, &flags);
        assert!(dp > 0.0 && dp < previous_dp);
        assert!(fan.flow(FAN_FACE) > previous_flow);
        previous_dp = dp;
        previous_flow = fan.flow(FAN_FACE);
        let before: f64 = energy.iter().sum();
        let immutable_energy = energy.clone();
        let expected_boundary = fan.boundary_energy(&energy);
        assert!(expected_boundary < -1e-6);

        // Both heat calls receive exactly the same prior thermal state. The
        // control has no flow; material conduction, contacts and power match.
        let (quiet_energy, _, quiet) =
            still.heat(&flow_config.projection, &thermal_config, &flags, &energy);
        let (next, temperature, moving) =
            fan.heat(&flow_config.projection, &thermal_config, &flags, &energy);
        assert_eq!(energy, immutable_energy);
        assert_eq!(moving.substeps, 1);
        assert_eq!(quiet.substeps, 1);
        assert_eq!(quiet.boundary_energy_j, 0.0);
        close(moving.source_energy_j, POWER * DT, 1e-18);
        close(quiet.source_energy_j, POWER * DT, 1e-18);
        close(moving.boundary_energy_j, expected_boundary, 1e-13);
        let after: f64 = next.iter().sum();
        let quiet_after: f64 = quiet_energy.iter().sum();
        close(after - before, POWER * DT + expected_boundary, 1e-11);
        close(quiet_after - before, POWER * DT, 1e-11);
        close(after - quiet_after, expected_boundary, 1e-11);
        close(moving.thermal_energy_j, after, 1e-11);
        close(moving.energy_residual_j, 0.0, 1e-11);
        close(quiet.energy_residual_j, 0.0, 1e-11);
        for (i, &flag) in flags.iter().enumerate() {
            close(temperature[i], next[i] / capacity(flag), 1e-12);
        }

        if step == 0 {
            // Each solid has four fluid neighbours, one mutual contact and an
            // insulated outside face. All fluxes use the known old temperature.
            let g_copper_air = H * H / (H / (2.0 * COPPER_K) + H / (2.0 * AIR_K));
            let g_aluminium_air = H * H / (H / (2.0 * ALUMINIUM_K) + H / (2.0 * AIR_K));
            let g_contact = H * H / (H / (2.0 * COPPER_K) + CONTACT_R + H / (2.0 * ALUMINIUM_K));
            let copper_change = DT * (POWER - 4.0 * g_copper_air * 20.0 - g_contact * 10.0);
            let aluminium_change = DT * (g_contact * 10.0 - 4.0 * g_aluminium_air * 10.0);
            for candidate in [&next, &quiet_energy] {
                close(candidate[COPPER] - energy[COPPER], copper_change, 1e-12);
                close(
                    candidate[ALUMINIUM] - energy[ALUMINIUM],
                    aluminium_change,
                    1e-12,
                );
            }
            // The outlet cell next to aluminium receives heat from that block.
            // Initial uniform fluid temperature and D=0 cancel its advection;
            // the next step exports this newly heated air using its actual T.
            let warm_outlet = ALUMINIUM + 1;
            let outlet_face = NX + (NX + 1) * NY;
            assert!(fan.u[outlet_face] > 0.0);
            close(
                next[warm_outlet] - energy[warm_outlet],
                DT * g_aluminium_air * 10.0,
                1e-13,
            );
            for z in 0..NZ {
                for y in 0..NY {
                    let inlet = NX * (y + NY * z);
                    let inlet_face = (NX + 1) * (y + NY * z);
                    // Cold incoming air replaces only its transported volume;
                    // the entire inlet cell must not be pinned to ambient.
                    let entering = fan.u[inlet_face].max(0.0);
                    close(
                        next[inlet] - energy[inlet],
                        -DT * RHO * CP * H * H * entering * 10.0,
                        1e-13,
                    );
                    assert!(next[inlet] > 0.0);
                }
            }
            // Power can still raise chip temperature while the air exports heat.
            assert!(next[COPPER] > energy[COPPER]);
        }
        boundary_total += expected_boundary;
        energy = next;
    }
    close(
        energy.iter().sum::<f64>() - initial_total,
        3.0 * POWER * DT + boundary_total,
        1e-11,
    );
    assert_eq!(flow_config.kinematic_viscosity_m2_s, NU);
    assert_eq!(flow_config.projection.dt_s, DT);
    assert_eq!(thermal_config.dt_seconds, DT);
    assert_eq!(thermal_config.gravity_per_kelvin, 0.0);
}
