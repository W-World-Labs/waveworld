use w_sim_kernels::lbm::ThermalMaterial;
use w_sim_kernels::lbm::{
    display_d3q19, init_d3q19, step_d3q19, D3q19Boundary, D3q19Config, D3q19Fan, ThermalBuffers,
    ThermalConfig, ThermalMode, ThermalStep, D3Q19_C,
};
use w_sim_kernels::KernelError;

#[test]
fn area_contact_resistance_reduces_analytic_face_transfer_and_conserves_energy() {
    for r in [0., 0.5, 2.] {
        let mut c = config(D3q19Boundary::Closed);
        let p = c.thermal.as_mut().unwrap();
        p.material_count = 1;
        p.materials[0] = ThermalMaterial {
            density: 4.,
            specific_heat: 5.,
            conductivity: 0.2,
            total_power_w: 0.,
        };
        p.set_contact(1, 0, r).unwrap();
        let mut flags = vec![1; 125];
        flags[0] = 0;
        flags[62] = 4;
        flags[63] = 5;
        let mut s = Fields::new(&c, flags);
        s.energy[62] = s.mass[62] * 20. * 5.;
        let before = s.energy[62];
        let g = 0.1 * 0.1 / (0.1 / (2. * 0.1) + r + 0.1 / (2. * 0.2));
        let result = s.step(&c, 1).unwrap();
        close(s.energy[63], 0.01 * g * 5., 1e-16);
        close(s.energy[62], before - 0.01 * g * 5., 1e-16);
        close(result.thermal_energy_j, before, 1e-16);
        assert_eq!(result.source_energy_j, 0.);
        assert_eq!(result.boundary_energy_j, 0.);
        close(result.energy_residual_j, 0., 1e-16);
        if r > 0. {
            assert!(s.energy[63] < 0.01 * (2. * 0.1 / (1. / 0.1 + 1. / 0.2)) * 5.);
        }
    }
}

#[test]
fn explicit_zero_contact_preserves_fields_and_cfl_bits() {
    let mut c = config(D3q19Boundary::Closed);
    let p = c.thermal.as_mut().unwrap();
    p.material_count = 1;
    p.materials[0] = ThermalMaterial {
        density: 4.,
        specific_heat: 5.,
        conductivity: 20.,
        total_power_w: 0.3,
    };
    let mut flags = vec![0; 125];
    flags[62] = 4;
    flags[63] = 5;
    let mut without = Fields::new(&c, flags.clone());
    let mut zero = c;
    zero.thermal
        .as_mut()
        .unwrap()
        .set_contact(0, 1, 0.)
        .unwrap();
    let mut with = Fields::new(&zero, flags);
    for i in 1..=3 {
        let a = without.step(&c, i).unwrap();
        let b = with.step(&zero, i).unwrap();
        assert_eq!(a.substeps, b.substeps);
        assert_eq!(a.energy_residual_j.to_bits(), b.energy_residual_j.to_bits());
        assert_eq!(without.f, with.f);
        assert_eq!(without.energy, with.energy);
        assert_eq!(without.temperature, with.temperature);
        assert_eq!(without.mass, with.mass);
    }
}

#[test]
fn contacts_reject_invalid_pairs_unresolved_faces_and_unrepresentable_flux() {
    let mut c = config(D3q19Boundary::Closed);
    let p = c.thermal.as_mut().unwrap();
    p.material_count = 1;
    p.materials[0] = ThermalMaterial {
        density: 4.,
        specific_heat: 5.,
        conductivity: 0.2,
        total_power_w: 0.,
    };
    for (a, b, r) in [
        (0, 0, 0.),
        (0, 2, 0.),
        (0, 1, -1.),
        (0, 1, f64::INFINITY),
        (0, 1, f64::NAN),
    ] {
        assert!(p.set_contact(a, b, r).is_err());
    }
    p.set_contact(0, 1, 0.).unwrap();
    assert!(p.set_contact(1, 0, 1.).is_err());
    let mut flags = vec![0; 125];
    flags[62] = 4;
    flags[63] = 5;
    let mut s = Fields::new(&c, flags);
    s.flags[63] = 0;
    s.flags[68] = 5;
    assert_eq!(s.step(&c, 1).unwrap_err(), KernelError::InvalidState);
    s.flags[68] = 0;
    s.flags[63] = 5;
    c.thermal.as_mut().unwrap().contact_mask[4] = 256;
    assert!(s.step(&c, 1).is_err());
    c.thermal.as_mut().unwrap().contact_mask[4] = 0;
    c.thermal.as_mut().unwrap().contact_resistance[1] = -0.;
    assert!(s.step(&c, 1).is_err());
    c.thermal.as_mut().unwrap().contact_resistance[1] = 0.;
    c.thermal.as_mut().unwrap().contact_resistance[0] = f64::MAX;
    c.thermal.as_mut().unwrap().dx_meters = 1e-50;
    assert_eq!(s.step(&c, 1).unwrap_err(), KernelError::InvalidCoefficient);
}

#[test]
fn different_solid_materials_exchange_one_harmonic_face_flux_and_local_power() {
    let mut c = config(D3q19Boundary::Closed);
    let p = c.thermal.as_mut().unwrap();
    p.material_count = 1;
    p.materials[0] = ThermalMaterial {
        density: 4.,
        specific_heat: 5.,
        conductivity: 0.2,
        total_power_w: 2.,
    };
    let mut flags = vec![1; 125];
    flags[0] = 0;
    flags[62] = 4;
    flags[63] = 5;
    let mut s = Fields::new(&c, flags);
    assert!((s.mass[62] - 0.002).abs() < 1e-17);
    assert!((s.mass[63] - 0.004).abs() < 1e-17);
    s.energy[62] = s.mass[62] * 20. * 5.;
    let before = s.energy[62];
    let de = 0.01 * (2. * 0.1 / (1. / 0.1 + 1. / 0.2)) * 5.;
    let result = s.step(&c, 1).unwrap();
    assert_eq!(result.substeps, 1);
    assert!((s.energy[62] - (before - de)).abs() < 1e-15);
    assert!((s.energy[63] - (de + 0.02)).abs() < 1e-15);
    assert_eq!(result.source_energy_j, 0.02);
    assert_eq!(result.boundary_energy_j, 0.);
    assert!(result.energy_residual_j.abs() < 1e-15);
}

#[test]
fn single_palette_material_reproduces_original_uniform_solid_bits() {
    let mut c = config(D3q19Boundary::Closed);
    c.thermal.as_mut().unwrap().total_power_w = 0.2;
    let mut flags = vec![0; 125];
    flags[62] = 4;
    flags[63] = 4;
    let mut original = Fields::new(&c, flags.clone());
    let mut regional = c;
    let p = regional.thermal.as_mut().unwrap();
    p.material_count = 1;
    p.total_power_w = 0.;
    p.materials[0] = ThermalMaterial {
        density: 2.,
        specific_heat: 20.,
        conductivity: 0.1,
        total_power_w: 0.2,
    };
    flags[62] = 5;
    flags[63] = 5;
    let mut new = Fields::new(&regional, flags);
    for i in 1..=3 {
        let a = original.step(&c, i).unwrap();
        let b = new.step(&regional, i).unwrap();
        assert_eq!(a.source_energy_j, b.source_energy_j);
        assert_eq!(a.energy_residual_j, b.energy_residual_j);
    }
    assert_eq!(original.f, new.f);
    assert_eq!(original.energy, new.energy);
    assert_eq!(original.temperature, new.temperature);
    assert_eq!(original.mass, new.mass);
    regional.thermal.as_mut().unwrap().total_power_w = 1.;
    assert_eq!(
        new.step(&regional, 4).unwrap_err(),
        KernelError::InvalidState
    );
    regional.thermal.as_mut().unwrap().total_power_w = 0.;
    regional.thermal.as_mut().unwrap().material_count = 2;
    assert!(new.step(&regional, 4).is_err());
}
fn config(boundary: D3q19Boundary) -> D3q19Config {
    D3q19Config {
        nx: 5,
        ny: 5,
        nz: 5,
        tau: 0.8,
        u_inlet: 0.,
        smagorinsky_cs: 0.,
        turbulence_intensity: 0.,
        ground_velocity: None,
        free_slip_walls: false,
        boundary,
        fan: None,
        thermal: Some(ThermalConfig {
            gravity_per_kelvin: 0.,
            dt_seconds: 0.01,
            ambient_c: 25.,
            fixed_surface_c: 0.,
            dx_meters: 0.1,
            fluid_density: 1.,
            fluid_specific_heat: 10.,
            fluid_conductivity: 0.01,
            solid_density: 2.,
            solid_specific_heat: 20.,
            solid_conductivity: 0.1,
            total_power_w: 0.,
            mode: ThermalMode::SolidPower,
            max_substeps: 128,
            temperature_scale_c: 1.,
            material_count: 0,
            materials: [w_sim_kernels::lbm::ThermalMaterial::default(); 16],
            contact_resistance: [0.; 136],
            contact_mask: [0; 5],
        }),
    }
}
struct Fields {
    flags: Vec<u8>,
    f: Vec<f32>,
    post: Vec<f32>,
    u: Vec<f32>,
    rho: Vec<f32>,
    energy: Vec<f64>,
    next: Vec<f64>,
    temperature: Vec<f64>,
    mass: Vec<f64>,
}
impl Fields {
    fn new(c: &D3q19Config, flags: Vec<u8>) -> Self {
        let n = flags.len();
        let mut s = Self {
            flags,
            f: vec![0.; n * 19],
            post: vec![0.; n * 19],
            u: vec![0.; n * 3],
            rho: vec![0.; n],
            energy: vec![0.; n],
            next: vec![0.; n],
            temperature: vec![0.; n],
            mass: vec![0.; n],
        };
        init_d3q19(
            c,
            &s.flags,
            &mut s.f,
            &mut s.post,
            &mut s.u,
            &mut s.rho,
            Some(ThermalBuffers {
                energy: &mut s.energy,
                next_energy: &mut s.next,
                temperature_delta_k: &mut s.temperature,
                mass: &mut s.mass,
            }),
        )
        .unwrap();
        s
    }
    fn step(&mut self, c: &D3q19Config, i: u32) -> Result<ThermalStep, KernelError> {
        step_d3q19(
            c,
            &self.flags,
            &mut self.f,
            &mut self.post,
            &mut self.u,
            &mut self.rho,
            Some(ThermalBuffers {
                energy: &mut self.energy,
                next_energy: &mut self.next,
                temperature_delta_k: &mut self.temperature,
                mass: &mut self.mass,
            }),
            i,
        )
        .map(|r| r.thermal.unwrap())
    }
    fn seed(&mut self, c: &D3q19Config, i: usize, delta: f64) {
        let p = c.thermal.unwrap();
        self.energy[i] = self.mass[i]
            * if self.flags[i] == 4 {
                p.solid_specific_heat
            } else {
                p.fluid_specific_heat
            }
            * delta;
    }
}
fn close(a: f64, b: f64, tol: f64) {
    assert!((a - b).abs() <= tol, "{a} != {b}, delta {}", a - b);
}
#[test]
fn isolated_solid_power_matches_heat_capacity_and_zero_power_isothermal() {
    let mut c = config(D3q19Boundary::Closed);
    c.thermal.as_mut().unwrap().total_power_w = 2.;
    let mut flags = vec![1; 125];
    flags[0] = 0;
    flags[62] = 4;
    let mut s = Fields::new(&c, flags);
    let cap = s.mass[62] * 20.;
    for i in 1..=3 {
        let t = s.step(&c, i).unwrap();
        close(t.thermal_energy_j, 2. * 0.01 * i as f64, 2e-17);
        close(t.source_energy_j, 0.02, 0.);
        close(t.boundary_energy_j, 0., 0.);
        close(t.energy_residual_j, 0., 1e-17);
        close(s.temperature[62], 0.02 * i as f64 / cap, 5e-16);
    }
    c.thermal.as_mut().unwrap().total_power_w = 0.;
    let e = s.energy.clone();
    s.step(&c, 4).unwrap();
    assert_eq!(s.energy, e);
    let mut cold = Fields::new(&c, s.flags.clone());
    cold.step(&c, 1).unwrap();
    assert!(cold.temperature.iter().all(|&t| t == 0.));
}
#[test]
fn heterogeneous_interface_uses_one_harmonic_flux_and_conserves_energy() {
    let c = config(D3q19Boundary::Closed);
    let mut flags = vec![1; 125];
    flags[62] = 4;
    flags[63] = 0;
    let mut s = Fields::new(&c, flags);
    s.seed(&c, 62, 10.);
    let old = s.energy.clone();
    let expected = 0.01 * (2. * 0.1 / (1. / 0.1 + 1. / 0.01)) * 10.;
    let result = s.step(&c, 1).unwrap();
    close(old[62] - s.energy[62], expected, 1e-16);
    close(s.energy[63] - old[63], expected, 1e-16);
    close(result.energy_residual_j, 0., 1e-16);
    assert!(s.temperature[62] < 10. && s.temperature[63] > 0.);
}
#[test]
fn fixed_wall_is_same_flux_solver_with_boundary_energy_ledger() {
    let mut c = config(D3q19Boundary::Closed);
    let p = c.thermal.as_mut().unwrap();
    p.mode = ThermalMode::FixedTemperature;
    p.fixed_surface_c = 35.;
    p.solid_density = 0.;
    p.solid_specific_heat = 0.;
    p.solid_conductivity = 0.;
    p.temperature_scale_c = 10.;
    let mut flags = vec![1; 125];
    flags[62] = 2;
    flags[63] = 0;
    let mut s = Fields::new(&c, flags);
    let r = s.step(&c, 1).unwrap();
    close(r.thermal_energy_j, 0.01 * 2. * 0.01 * 0.1 * 10., 1e-18);
    close(r.thermal_energy_j, r.boundary_energy_j, 1e-18);
    close(r.source_energy_j, 0., 0.);
    close(r.energy_residual_j, 0., 1e-18);
    let mut display = vec![0.; 125 * 3];
    display_d3q19(&c, &s.u, &s.flags, Some(&s.temperature), None, &mut display).unwrap();
    let mut with_pressure = vec![0.; s.flags.len() * 4];
    display_d3q19(
        &c,
        &s.u,
        &s.flags,
        Some(&s.temperature),
        Some(&s.f),
        &mut with_pressure,
    )
    .unwrap();
    for cell in 0..s.flags.len() {
        assert_eq!(
            &with_pressure[cell * 4..cell * 4 + 3],
            &display[cell * 3..cell * 3 + 3]
        );
        if s.flags[cell] != 0 {
            assert_eq!(with_pressure[cell * 4 + 3], 0.);
        }
    }
    assert_eq!(display[62 * 3 + 2], 1.);
}
#[test]
fn uniform_temperature_tracks_actual_lbm_mass_and_closed_energy() {
    let mut c = config(D3q19Boundary::Periodic);
    c.u_inlet = 0.03;
    let mut flags = vec![0; 125];
    flags[62] = 4;
    let mut s = Fields::new(&c, flags);
    for i in 0..125 {
        if s.flags[i] == 0 {
            for value in &mut s.f[i * 19..i * 19 + 19] {
                *value *= 1. + 0.0001 * (i % 5) as f32;
            }
            s.mass[i] = s.f[i * 19..i * 19 + 19]
                .iter()
                .map(|&v| v as f64)
                .sum::<f64>()
                * c.thermal.unwrap().fluid_density
                * 0.1
                * 0.1
                * 0.1;
        }
        s.seed(&c, i, 2.);
    }
    let initial: f64 = s.energy.iter().sum();
    for i in 1..=3 {
        let r = s.step(&c, i).unwrap();
        close(r.thermal_energy_j, initial, 2e-14);
        close(r.energy_residual_j, 0., 2e-14);
        for cell in 0..125 {
            close(s.temperature[cell], 2., 3e-7);
            if s.flags[cell] == 0 {
                let mass = s.f[cell * 19..cell * 19 + 19]
                    .iter()
                    .map(|&v| v as f64)
                    .sum::<f64>()
                    * 0.001;
                close(s.mass[cell], mass, 1e-18);
            }
        }
    }
}
#[test]
fn wind_boundaries_account_for_incoming_and_outgoing_energy() {
    for slip in [false, true] {
        let mut c = config(D3q19Boundary::WindTunnel);
        c.u_inlet = 0.03;
        c.free_slip_walls = slip;
        let mut flags = vec![0; 125];
        flags[62] = 4;
        let mut s = Fields::new(&c, flags);
        for i in 0..125 {
            s.seed(&c, i, 3.);
        }
        let mut energy: f64 = s.energy.iter().sum();
        for step in 1..=3 {
            let r = s.step(&c, step).unwrap();
            close(r.thermal_energy_j - energy, r.boundary_energy_j, 2e-14);
            close(r.energy_residual_j, 0., 2e-14);
            assert!(r.boundary_energy_j < 0.);
            energy = r.thermal_energy_j;
            for i in (0..125).step_by(5) {
                assert_eq!(s.temperature[i], 0.);
            }
        }
    }
}
#[test]
fn substeps_enforce_positive_conduction_weights_and_fail_at_cap() {
    let mut c = config(D3q19Boundary::Closed);
    let p = c.thermal.as_mut().unwrap();
    p.dt_seconds = 0.2;
    p.fluid_conductivity = 1.;
    p.solid_conductivity = 10.;
    let mut flags = vec![1; 125];
    flags[62] = 4;
    flags[63] = 0;
    let mut s = Fields::new(&c, flags.clone());
    s.seed(&c, 62, 10.);
    let r = s.step(&c, 1).unwrap();
    assert!(r.substeps > 1);
    assert!(s.temperature[62] >= 0. && s.temperature[62] <= 10.);
    assert!(s.temperature[63] >= 0. && s.temperature[63] <= 10.);
    close(r.energy_residual_j, 0., 1e-15);
    c.thermal.as_mut().unwrap().max_substeps = 1;
    let mut fail = Fields::new(&c, flags);
    assert_eq!(
        fail.step(&c, 1).unwrap_err(),
        KernelError::InvalidCoefficient
    );
}
#[test]
fn thermal_parameters_and_state_fail_closed() {
    let mut c = config(D3q19Boundary::Closed);
    let mut flags = vec![0; 125];
    flags[62] = 4;
    let mut s = Fields::new(&c, flags);
    s.energy[62] = f64::NAN;
    assert_eq!(s.step(&c, 1).unwrap_err(), KernelError::NonFiniteValue);
    s.energy[62] = 0.;
    s.mass[0] *= 2.;
    assert_eq!(s.step(&c, 1).unwrap_err(), KernelError::InvalidState);
    c.thermal.as_mut().unwrap().total_power_w = -1.;
    assert_eq!(s.step(&c, 1).unwrap_err(), KernelError::InvalidCoefficient);
    c.thermal.as_mut().unwrap().total_power_w = 0.;
    c.tau = 0.5001;
    assert_eq!(s.step(&c, 1).unwrap_err(), KernelError::InvalidCoefficient);
}
#[test]
fn fan_and_kelvin_buoyancy_share_one_half_force_correction() {
    let mut c = config(D3q19Boundary::Closed);
    c.thermal.as_mut().unwrap().gravity_per_kelvin = 0.0001;
    c.fan = Some(D3q19Fan {
        center: [2.5, 2.5, 2.5],
        normal: [1., 0., 0.],
        radius_cells: 1.,
        acceleration_lattice: 0.001,
    });
    let mut flags = vec![0; 125];
    flags[31] = 4;
    let mut s = Fields::new(&c, flags);
    s.seed(&c, 62, 1.);
    s.step(&c, 1).unwrap();
    let mut rho = 0.;
    let mut mom = [0.; 3];
    for (q, direction) in D3Q19_C.iter().enumerate() {
        let f = s.f[62 * 19 + q] as f64;
        rho += f;
        for (axis, m) in mom.iter_mut().enumerate() {
            *m += f * direction[axis] as f64;
        }
    }
    let a = [0.001, 0.0001 * s.temperature[62], 0.];
    for axis in 0..3 {
        let u = ((mom[axis] + 0.5 * rho * a[axis]) / rho) as f32;
        assert_eq!(s.u[62 * 3 + axis].to_bits(), u.to_bits());
    }
}

#[test]
fn missing_solid_or_fluid_and_excess_advected_mass_are_rejected() {
    let c = config(D3q19Boundary::Closed);
    let mut flags = vec![0; 125];
    flags[62] = 4;
    let mut s = Fields::new(&c, flags);
    s.flags[62] = 0;
    assert_eq!(s.step(&c, 1).unwrap_err(), KernelError::InvalidState);
    s.flags.fill(4);
    assert_eq!(s.step(&c, 1).unwrap_err(), KernelError::InvalidState);
    s.flags.fill(0);
    s.flags[62] = 4;
    // Balanced opposing nonequilibrium populations have zero initial momentum,
    // but their post-collision outgoing mass exceeds the positive-weight CFL.
    let start = 13 * 19;
    s.f[start] += 8.;
    s.f[start + 1] -= 4.;
    s.f[start + 2] -= 4.;
    assert_eq!(s.step(&c, 1).unwrap_err(), KernelError::InvalidState);
}

#[test]
fn slip_corner_preserves_mass_for_asymmetric_forced_flow() {
    let mut c = config(D3q19Boundary::WindTunnel);
    c.ny = 4;
    c.nz = 3;
    c.u_inlet = 0.02;
    c.free_slip_walls = true;
    c.fan = Some(D3q19Fan {
        center: [2.5, 2., 1.5],
        normal: [0.6, 0.8, 0.],
        radius_cells: 0.5,
        acceleration_lattice: 0.001,
    });
    c.thermal.as_mut().unwrap().total_power_w = 0.2;
    let mut flags = vec![0; 60];
    flags[32] = 4;
    flags[22] = 3;
    let mut s = Fields::new(&c, flags);
    let mut previous = 0.;
    for step in 1..=3 {
        // Actual reflected transport must retain the strict per-cell mass check.
        let stats = s.step(&c, step).unwrap();
        close(
            stats.thermal_energy_j - previous,
            stats.source_energy_j + stats.boundary_energy_j,
            1e-14,
        );
        close(stats.energy_residual_j, 0., 1e-14);
        for i in 0..60 {
            if s.flags[i] == 0 {
                let mass = s.f[i * 19..(i + 1) * 19]
                    .iter()
                    .map(|&f| f as f64)
                    .sum::<f64>()
                    * 0.001;
                close(s.mass[i], mass, 1e-18);
            }
        }
        previous = stats.thermal_energy_j;
    }
}

#[test]
fn slip_wall_advects_heat_on_both_direct_and_reflected_links() {
    let mut c = config(D3q19Boundary::WindTunnel);
    c.nx = 7;
    c.u_inlet = 0.04;
    c.free_slip_walls = true;
    c.thermal.as_mut().unwrap().fluid_conductivity = 1e-12;
    let mut flags = vec![0; 175];
    flags[171] = 4;
    let mut s = Fields::new(&c, flags);
    let donor = 2 + c.nx * c.ny * 2;
    let target = donor + 1;
    s.seed(&c, donor, 10.);
    let initial = s.energy[donor];
    let stats = s.step(&c, 1).unwrap();
    let donor_mass = s.post[donor * 19..(donor + 1) * 19]
        .iter()
        .map(|&f| f as f64)
        .sum::<f64>()
        * 0.001;
    let theta = initial / (donor_mass * 10.);
    // +x straight transport and (+x,-y) reflected at y=0 connect the same
    // physical cells but are distinct populations. Reverse reflected ray is (-x,-y).
    let direct = s.post[donor * 19 + 1] as f64 - s.post[target * 19 + 2] as f64;
    let reflected = s.post[donor * 19 + 9] as f64 - s.post[target * 19 + 8] as f64;
    assert!(reflected > 0.);
    close(
        s.energy[target],
        0.001 * (direct + reflected) * 10. * theta,
        1e-12,
    );
    close(stats.energy_residual_j, 0., 1e-14);
    for i in 0..175 {
        if s.flags[i] == 0 {
            let mass = s.f[i * 19..(i + 1) * 19]
                .iter()
                .map(|&f| f as f64)
                .sum::<f64>()
                * 0.001;
            close(s.mass[i], mass, 1e-18);
        }
    }
}

#[test]
fn stationary_and_moving_ground_keep_corner_heat_and_fluid_mass_consistent() {
    for ground in [0., 0.04] {
        let mut c = config(D3q19Boundary::WindTunnel);
        c.nx = 15;
        c.free_slip_walls = true;
        c.u_inlet = 0.04;
        c.ground_velocity = Some(ground);
        let count = c.cell_count().unwrap();
        let mut flags = vec![0; count];
        flags[7 + c.nx * (2 + c.ny * 2)] = 4;
        let mut s = Fields::new(&c, flags);
        s.seed(&c, 7, 8.);
        s.seed(&c, 7 + c.nx * c.ny * 2, 12.);
        let before: f64 = s.energy.iter().sum();
        for step in 1..=3 {
            let stats = s.step(&c, step).unwrap();
            assert_eq!(stats.substeps, 1);
            close(stats.boundary_energy_j, 0., 1e-14);
            close(stats.source_energy_j, 0., 0.);
            close(stats.energy_residual_j, 0., 1e-14);
            close(s.energy.iter().sum(), before, 1e-14);
            for i in 0..count {
                if s.flags[i] == 0 {
                    let mass = s.f[i * 19..(i + 1) * 19]
                        .iter()
                        .map(|&f| f as f64)
                        .sum::<f64>()
                        * 0.001;
                    close(s.mass[i], mass, 1e-18);
                }
            }
        }
        assert!(s.energy[8] > 0.); // The hotspot actually advected/diffused.
    }
}


#[test]
fn nee_pressure_outlet_accounts_for_hot_outflow_and_ambient_mass_inflow() {
    let mut c = config(D3q19Boundary::WindTunnel);
    c.nx = 7;
    c.u_inlet = 0.04;
    c.free_slip_walls = true;
    for delta_rho in [0.03, -0.3] {
        let mut flags = vec![0; 175];
        flags[0] = 4; // Required solid is cold and far from the warmed outlet.
        let mut s = Fields::new(&c, flags);
        for cell in 0..175 {
            if cell % 7 == 5 {
                for q in 0..19 { s.f[cell * 19 + q] *= (1. + delta_rho) as f32; }
                s.mass[cell] = s.f[cell * 19..cell * 19 + 19].iter()
                    .map(|&v| v as f64).sum::<f64>() * 0.001;
            }
            if cell % 7 >= 4 { s.seed(&c, cell, 3.); }
        }
        let before: f64 = s.energy.iter().sum();
        let r = s.step(&c, 1).unwrap();
        // Every outlet has warm inner fluid. The outgoing net population mass is
        // rho*U + delta_rho*sum_{cx=+1} f_eq. Negative values are ambient inflow,
        // which contributes zero sensible energy. No heat reaches the inlet.
        let outward = c.u_inlet + delta_rho * (1. + 3. * c.u_inlet + 3. * c.u_inlet.powi(2)) / 6.;
        let expected = -25. * 0.001 * 10. * 3. * outward.max(0.);
        // f32 population rounding accumulated over 25 outlet nodes.
        close(r.boundary_energy_j, expected, 1e-7);
        close(r.thermal_energy_j - before, expected, 1e-7);
        close(r.energy_residual_j, 0., 2e-14);
        assert_eq!(r.source_energy_j, 0.);
        for cell in (6..175).step_by(7) {
            close(s.mass[cell], 0.001, 1e-10);
            close(s.rho[cell] as f64, 1., 1e-7);
            if outward < 0. { assert!(s.temperature[cell] > 0. && s.temperature[cell] < 3.); }
        }
    }
}

#[test]
fn nee_velocity_inlet_thermostat_accounts_for_warm_backflow_and_conduction() {
    let mut c = config(D3q19Boundary::WindTunnel);
    c.nx = 7;
    c.u_inlet = 0.04;
    c.free_slip_walls = true;
    for delta in [0.3, -0.3] {
        let mut flags = vec![0; 175];
        flags[6] = 4; // Cold required solid is beyond this one-step thermal stencil.
        let mut s = Fields::new(&c, flags);
        for cell in (1..175).step_by(7) {
            for q in 0..19 { s.f[cell * 19 + q] *= (1. + delta) as f32; }
            s.mass[cell] = s.f[cell * 19..cell * 19 + 19].iter()
                .map(|&v| v as f64).sum::<f64>() * 0.001;
            s.seed(&c, cell, 3.);
        }
        let before: f64 = s.energy.iter().sum();
        let r = s.step(&c, 1).unwrap();
        // Aggregate the five +/-x populations independently. Their net mass
        // crosses 0->1 and 1->2; only warm backflow into cell0 leaves the domain.
        let u = c.u_inlet;
        let into = u - delta * (1. - 3.*u + 3.*u*u) / 6.;
        let out = u + delta * (1. + 3.*u + 3.*u*u) / 6.;
        let remaining = 1. + delta - (-into).max(0.) - out.max(0.);
        let streamed_rho = 1. + delta + into - out;
        let mixed_temperature = 3. * remaining / streamed_rho;
        let expected = -25. * 0.001 * 10. * 3. * (-into).max(0.)
            - 25. * 0.01 * (0.01 * 0.1) * mixed_temperature;
        // All advection uses old temperature; one conduction substep then
        // removes dt*k*dx*T1 through the ambient inlet-cell thermostat.
        assert_eq!(r.substeps, 1);
        close(r.boundary_energy_j, expected, 1e-7);
        close(r.thermal_energy_j - before, expected, 1e-7);
        close(r.energy_residual_j, 0., 2e-14);
        assert_eq!(r.source_energy_j, 0.);
        for cell in (0..175).step_by(7) {
            close(s.mass[cell], 0.001 * streamed_rho, 1e-10);
            assert_eq!(s.energy[cell], 0.);
            assert_eq!(s.temperature[cell], 0.);
            close(s.u[cell*3] as f64, u, 3e-8);
        }
    }
}
