use w_sim_kernels::{
    mac_projection::MacProjectionConfig,
    mac_thermal::{
        step_mac_thermal3d, MacThermalBuffers, ThermalConfig, ThermalMaterial, ThermalMode,
        ThermalStep, MAX_THERMAL_CONTACTS, MAX_THERMAL_MATERIALS,
    },
    KernelError,
};

struct Case {
    c: MacProjectionConfig,
    p: ThermalConfig,
    flags: Vec<u8>,
    velocity: [Vec<f64>; 3],
    energy: Vec<f64>,
    next: Vec<f64>,
    temperature: Vec<f64>,
    work: Vec<f64>,
}

impl Case {
    fn new(dims: [usize; 3]) -> Self {
        let [nx, ny, nz] = dims;
        let n = nx * ny * nz;
        Self {
            c: MacProjectionConfig {
                nx,
                ny,
                nz,
                dx_m: 1.0,
                dt_s: 1.0,
                density_kg_m3: 2.0,
                open_faces: 0,
                max_iterations: 200,
                absolute_divergence_tol: 1e-10,
                relative_residual_tol: 0.0,
            },
            p: ThermalConfig {
                gravity_per_kelvin: 0.0,
                dt_seconds: 1.0,
                ambient_c: 20.0,
                fixed_surface_c: 0.0,
                dx_meters: 1.0,
                fluid_density: 2.0,
                fluid_specific_heat: 3.0,
                fluid_conductivity: 0.3,
                solid_density: 1.0,
                solid_specific_heat: 1.0,
                solid_conductivity: 0.3,
                total_power_w: 0.0,
                mode: ThermalMode::SolidPower,
                max_substeps: 16,
                temperature_scale_c: 1.0,
                material_count: 0,
                materials: [ThermalMaterial::default(); MAX_THERMAL_MATERIALS],
                contact_resistance: [0.0; MAX_THERMAL_CONTACTS],
                contact_mask: [0; 5],
            },
            flags: vec![0; n],
            velocity: core::array::from_fn(|a| {
                let mut d = dims;
                d[a] += 1;
                vec![0.0; d.into_iter().product()]
            }),
            energy: vec![0.0; n],
            next: vec![99.0; n],
            temperature: vec![99.0; n],
            work: vec![99.0; n],
        }
    }
    fn run(&mut self) -> Result<ThermalStep, KernelError> {
        step_mac_thermal3d(
            &self.c,
            &self.p,
            &self.flags,
            &mut MacThermalBuffers {
                u: &self.velocity[0],
                v: &self.velocity[1],
                w: &self.velocity[2],
                energy: &self.energy,
                next_energy: &mut self.next,
                temperature_delta_k: &mut self.temperature,
                work: &mut self.work,
            },
        )
    }
    fn dt(&mut self, dt: f64) {
        self.c.dt_s = dt;
        self.p.dt_seconds = dt;
    }
    fn dx(&mut self, h: f64) {
        self.c.dx_m = h;
        self.p.dx_meters = h;
    }
    fn index(&self, q: [usize; 3]) -> usize {
        q[0] + self.c.nx * (q[1] + self.c.ny * q[2])
    }
    fn face_index(&self, axis: usize, q: [usize; 3]) -> usize {
        let mut d = [self.c.nx, self.c.ny, self.c.nz];
        d[axis] += 1;
        q[0] + d[0] * (q[1] + d[1] * q[2])
    }
    fn budget(&self, step: ThermalStep) {
        let change = self.next.iter().sum::<f64>() - self.energy.iter().sum::<f64>();
        close(change, step.source_energy_j + step.boundary_energy_j, 2e-12);
        close(step.energy_residual_j, 0.0, 2e-12);
        close(step.thermal_energy_j, self.next.iter().sum(), 2e-12);
    }
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:.16e}, expected {expected:.16e}, tolerance {tolerance}"
    );
}

fn flow(axis: usize, length: usize, u: f64) -> Case {
    let wall_axis = (axis + 1) % 3;
    let mut dims = [1; 3];
    dims[axis] = length;
    dims[wall_axis] = 3;
    let mut s = Case::new(dims);
    s.c.open_faces = 3 << (2 * axis);
    for layer in 0..3 {
        for i in 0..length {
            let mut q = [0; 3];
            q[axis] = i;
            q[wall_axis] = layer;
            let k = s.index(q);
            s.flags[k] = [0, 1, 4][layer];
        }
    }
    for i in 0..=length {
        let mut q = [0; 3];
        q[axis] = i;
        let k = s.face_index(axis, q);
        s.velocity[axis][k] = u;
    }
    s
}

#[test]
fn physical_heat_capacity_contact_resistance_and_material_sources() {
    for resistance in [0.0, 0.375] {
        let mut s = Case::new([4, 1, 1]);
        s.flags.copy_from_slice(&[4, 5, 1, 0]);
        s.dx(2.0);
        s.dt(0.5);
        s.p.solid_density = 1.0;
        s.p.solid_specific_heat = 2.0;
        s.p.solid_conductivity = 2.0;
        s.p.total_power_w = 4.0;
        s.p.material_count = 1;
        s.p.materials[0] = ThermalMaterial {
            density: 2.0,
            specific_heat: 4.0,
            conductivity: 8.0,
            total_power_w: 8.0,
        };
        s.p.set_contact(0, 1, resistance).unwrap();
        s.energy[0] = 160.0;
        s.energy[1] = 128.0;
        let step = s.run().unwrap();
        assert_eq!(step.substeps, 1);
        let transferred = 0.5 * 4.0 / (0.5 + resistance + 0.125) * 8.0;
        close(s.next[0], 160.0 - transferred + 2.0, 2e-13);
        close(s.next[1], 128.0 + transferred + 4.0, 2e-13);
        close(s.temperature[0], s.next[0] / 16.0, 2e-13);
        close(s.temperature[1], s.next[1] / 64.0, 2e-13);
        close(step.source_energy_j, 6.0, 2e-13);
        close(step.thermal_energy_j, 294.0, 2e-13);
        assert_eq!(step.boundary_energy_j, 0.0);
        assert_eq!(s.energy, [160.0, 128.0, 0.0, 0.0]);
        s.budget(step);
    }
}

#[test]
fn three_layer_shared_face_fluxes_use_one_old_temperature_state() {
    let mut s = Case::new([5, 1, 1]);
    s.flags.copy_from_slice(&[4, 5, 6, 1, 0]);
    s.dt(0.1);
    s.p.solid_specific_heat = 2.0;
    s.p.solid_conductivity = 2.0;
    s.p.material_count = 2;
    s.p.materials[0] = ThermalMaterial {
        density: 1.0,
        specific_heat: 3.0,
        conductivity: 4.0,
        total_power_w: 0.0,
    };
    s.p.materials[1] = ThermalMaterial {
        density: 1.0,
        specific_heat: 4.0,
        conductivity: 8.0,
        total_power_w: 0.0,
    };
    s.p.set_contact(0, 1, 0.125).unwrap();
    s.p.set_contact(1, 2, 0.0625).unwrap();
    s.energy[..3].copy_from_slice(&[24.0, 18.0, 4.0]);
    let step = s.run().unwrap();
    // Conductances 2 and 4 W/K, initial differences 6 and 5 K:
    // a shared 1.2 J enters the middle while 2 J leaves it.
    for (&actual, expected) in s.next[..3].iter().zip([22.8, 17.2, 6.0]) {
        close(actual, expected, 2e-13);
    }
    assert_eq!(step.substeps, 1);
    assert_eq!(step.boundary_energy_j, 0.0);
    s.budget(step);
}

#[test]
fn material_total_power_is_shared_only_by_that_flags_cells() {
    let mut s = Case::new([7, 1, 1]);
    s.flags.copy_from_slice(&[4, 1, 4, 1, 5, 1, 0]);
    s.dt(0.5);
    s.p.total_power_w = 6.0;
    s.p.material_count = 1;
    s.p.materials[0] = ThermalMaterial {
        density: 1.0,
        specific_heat: 1.0,
        conductivity: 1.0,
        total_power_w: 12.0,
    };
    let step = s.run().unwrap();
    assert_eq!(s.next, [1.5, 0.0, 1.5, 0.0, 6.0, 0.0, 0.0]);
    assert_eq!(step.source_energy_j, 9.0);
    assert_eq!(step.boundary_energy_j, 0.0);
    s.budget(step);
}

#[test]
fn inlet_cells_mix_by_real_face_flux_for_all_axes_and_flow_signs() {
    for axis in 0..3 {
        for sign in [-1.0, 1.0] {
            let mut s = flow(axis, 2, sign * 0.25);
            let mut second = [0; 3];
            second[axis] = 1;
            let j = s.index(second);
            s.energy[0] = if sign > 0.0 { 48.0 } else { 24.0 };
            s.energy[j] = if sign > 0.0 { 24.0 } else { 48.0 };
            let step = s.run().unwrap();
            let expected = if sign > 0.0 {
                [34.8, 31.2]
            } else {
                [31.2, 34.8]
            };
            close(s.next[0], expected[0], 2e-13);
            close(s.next[j], expected[1], 2e-13);
            close(step.boundary_energy_j, -6.0, 2e-13);
            close(step.thermal_energy_j, 66.0, 2e-13);
            assert_eq!(step.substeps, 1);
            assert!(
                s.next[0] > 0.0 && s.next[j] > 0.0,
                "inlet is not a thermostatic whole cell"
            );
            s.budget(step);
        }
    }
}

#[test]
fn internal_hot_and_ambient_reservoirs_account_for_heat_and_allow_negative_energy() {
    for initial_delta in [2.0, -2.0] {
        let mut s = Case::new([3, 1, 1]);
        s.flags.copy_from_slice(&[2, 0, 3]);
        s.dx(2.0);
        s.dt(0.5);
        s.p.fluid_specific_heat = 4.0;
        s.p.fluid_conductivity = 3.0;
        s.p.mode = ThermalMode::FixedTemperature;
        s.p.fixed_surface_c = 30.0;
        s.p.solid_density = 0.0;
        s.p.solid_specific_heat = 0.0;
        s.p.solid_conductivity = 0.0;
        s.energy[1] = 64.0 * initial_delta;
        let expected_boundary = 0.5 * 12.0 * (10.0 - 2.0 * initial_delta);
        let step = s.run().unwrap();
        close(s.next[1], 64.0 * initial_delta + expected_boundary, 2e-13);
        close(step.boundary_energy_j, expected_boundary, 2e-13);
        assert_eq!(s.next[0], 0.0);
        assert_eq!(s.next[2], 0.0);
        assert_eq!(s.temperature[0], 10.0);
        assert_eq!(s.temperature[2], 0.0);
        assert_eq!(step.substeps, 1);
        s.budget(step);
    }
}

#[test]
fn thermal_substeps_preserve_macro_time_and_equal_three_explicit_calls() {
    for sign in [-1.0, 1.0] {
        let mut s = flow(0, 1, 1.0);
        s.dt(2.0);
        s.energy[0] = sign * 60.0;
        s.p.max_substeps = 2;
        let before = s.energy.clone();
        assert!(matches!(s.run(), Err(KernelError::InvalidCoefficient)));
        assert_eq!(s.energy, before);
        s.p.max_substeps = 3;
        let step = s.run().unwrap();
        assert_eq!(step.substeps, 3);
        assert_eq!(s.c.dt_s, 2.0);
        assert_eq!(s.p.dt_seconds, 2.0);
        close(s.next[0], sign * 20.0 / 9.0, 2e-13);
        close(step.boundary_energy_j, -sign * 520.0 / 9.0, 2e-13);
        s.budget(step);
        let mut separate = flow(0, 1, 1.0);
        separate.dt(2.0 / 3.0);
        separate.energy[0] = sign * 60.0;
        let mut boundary = 0.0;
        for _ in 0..3 {
            let sub = separate.run().unwrap();
            assert_eq!(sub.substeps, 1);
            boundary += sub.boundary_energy_j;
            std::mem::swap(&mut separate.energy, &mut separate.next);
        }
        close(separate.energy[0], s.next[0], 2e-13);
        close(boundary, step.boundary_energy_j, 2e-13);
    }
}

#[test]
fn advection_and_conduction_share_one_combined_substep_bound() {
    let mut s = flow(0, 2, 0.6);
    s.p.fluid_conductivity = 2.4;
    s.p.max_substeps = 1;
    s.energy[0] = 48.0;
    s.energy[1] = 24.0;
    assert!(matches!(s.run(), Err(KernelError::InvalidCoefficient)));
    s.p.max_substeps = 2;
    let step = s.run().unwrap();
    assert_eq!(step.substeps, 2);
    close(s.next[0], 21.6, 2e-13);
    close(s.next[1], 32.4, 2e-13);
    close(step.boundary_energy_j, -18.0, 2e-13);
    s.budget(step);
}

#[test]
fn explicit_zero_contact_matches_default_while_absent_contact_is_rejected() {
    let mut base = Case::new([4, 1, 1]);
    base.flags.copy_from_slice(&[4, 5, 1, 0]);
    base.dt(0.1);
    base.p.material_count = 1;
    base.p.materials[0] = ThermalMaterial {
        density: 2.0,
        specific_heat: 3.0,
        conductivity: 0.6,
        total_power_w: 0.0,
    };
    base.energy[0] = 3.0;
    let step = base.run().unwrap();
    let reference = base.next.clone();
    base.p.set_contact(0, 1, 0.0).unwrap();
    let with_contact = base.run().unwrap();
    assert_eq!(base.next, reference);
    assert_eq!(step.substeps, with_contact.substeps);
    // Both material flags still exist, but are no longer in face contact.
    base.flags.copy_from_slice(&[4, 1, 5, 0]);
    base.energy.fill(0.0);
    assert!(matches!(base.run(), Err(KernelError::InvalidState)));
}

#[test]
fn invalid_parameters_states_and_unimplemented_buoyancy_preserve_inputs() {
    for mode in 0..12 {
        let mut s = flow(0, 2, 0.25);
        s.energy[0] = 48.0;
        s.energy[1] = 24.0;
        match mode {
            0 => s.c.dt_s *= 2.0,
            1 => s.c.dx_m *= 2.0,
            2 => s.c.density_kg_m3 *= 2.0,
            3 => s.p.gravity_per_kelvin = 0.01,
            4 => s.velocity[0][1] = 0.0, // nonzero fluid divergence
            5 => s.velocity[1][0] = 1.0, // closed normal wall
            6 => s.energy[2] = 1.0,      // insulated cell cannot store energy
            7 => s.energy[0] = -1e9,     // below absolute zero
            8 => s.flags[4] = 21,
            9 => {
                s.work.pop();
            }
            10 => s.p.max_substeps = 4097,
            _ => s.p.fluid_specific_heat = f64::MAX,
        }
        let before = (s.energy.clone(), s.velocity.clone());
        let error = s.run().unwrap_err();
        if mode == 3 {
            assert_eq!(error, KernelError::UnsupportedFeature);
        }
        assert_eq!((s.energy, s.velocity), before);
    }
    let mut s = flow(0, 2, 0.25);
    s.energy[0] = f64::NAN;
    assert!(matches!(s.run(), Err(KernelError::NonFiniteValue)));
    assert!(s.energy[0].is_nan());
}
