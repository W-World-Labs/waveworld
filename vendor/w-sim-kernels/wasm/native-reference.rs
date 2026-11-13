// Tiny native reference for tests.mjs. No separate numerical implementation.
use w_sim_kernels::lbm::{init_d3q19, step_d3q19, D3q19Boundary, D3q19Config, D3q19Fan, D3Q19_Q};
use w_sim_kernels::{seed_heat, seed_wave, step_heat, step_wave, Seed};

fn bits(values: &[f32]) -> Vec<u32> {
    values.iter().map(|value| value.to_bits()).collect()
}

fn main() {
    let case = std::env::args().nth(1).unwrap_or_default();
    if case.starts_with("inlet-") {
        inlet_reference(&case);
        return;
    }
    if case == "solid-geometry" {
        let vertices = [
            2., 2., 2., 10., 2., 2., 10., 10., 2., 2., 10., 2., 2., 2., 10., 10., 2., 10., 10.,
            10., 10., 2., 10., 10., 6., 4., 3., 14., 4., 3., 14., 12., 3., 6., 12., 3., 6., 4.,
            11., 14., 4., 11., 14., 12., 11., 6., 12., 11.,
        ];
        let indices = [
            0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7,
            3, 3, 7, 4, 3, 4, 0,
        ];
        let both: Vec<u32> = indices
            .iter()
            .copied()
            .chain(indices.iter().map(|i| i + 8))
            .collect();
        let mut flags = [0; 18 * 16 * 14];
        let counts = w_sim_kernels::geometry::voxelize_solids(
            &vertices,
            &both,
            &[12, 12],
            18,
            16,
            14,
            &mut flags,
            &mut [0.; 120],
        )
        .unwrap();
        println!(
            "{{\"flags\":{:?},\"counts\":{:?}}}",
            flags,
            [counts.solid_cells, counts.frontal_area_cells]
        );
        return;
    }
    let mut wave = vec![0.0; 49];
    let mut previous = wave.clone();
    seed_wave(
        &mut wave,
        &mut previous,
        7,
        Seed {
            x: 2,
            y: 3,
            radius: 2,
            amount: 1.3,
        },
    )
    .unwrap();
    let mut mask = vec![0; 49];
    mask[25] = 1;
    for _ in 0..5 {
        step_wave(&wave, &mut previous, 7, 0.25, 0.997, Some(&mask)).unwrap();
        std::mem::swap(&mut wave, &mut previous);
    }
    let mut heat = vec![0.0; 35];
    let mut next = heat.clone();
    seed_heat(
        &mut heat,
        7,
        5,
        Seed {
            x: 0,
            y: 3,
            radius: 2,
            amount: 1.3,
        },
    )
    .unwrap();
    for _ in 0..5 {
        step_heat(&heat, &mut next, 7, 5, 0.23).unwrap();
        std::mem::swap(&mut heat, &mut next);
    }
    let config = D3q19Config {
        nx: 5,
        ny: 4,
        nz: 3,
        tau: 0.8,
        u_inlet: 0.04,
        smagorinsky_cs: 0.12,
        turbulence_intensity: 0.01,
        ground_velocity: if case.starts_with("isothermal-ground-") { Some(if case.ends_with("moving") { 0.04 } else { 0. }) } else { None },
        free_slip_walls: case == "isothermal-slip" || case.starts_with("isothermal-ground-"),
        boundary: D3q19Boundary::WindTunnel,
        thermal: None,
        fan: None,
    };
    let count = config.cell_count().unwrap();
    let mut f = vec![0.0; count * D3Q19_Q];
    let mut post = f.clone();
    let mut velocity = vec![0.0; count * 3];
    let mut density = vec![0.0; count];
    let mut flags = vec![0; count];
    flags[32] = 1;
    init_d3q19(
        &config,
        &flags,
        &mut f,
        &mut post,
        &mut velocity,
        &mut density,
        None,
    )
    .unwrap();
    let mut stats = [0.0; 5];
    for step in 1..=5 {
        let result = step_d3q19(
            &config,
            &flags,
            &mut f,
            &mut post,
            &mut velocity,
            &mut density,
            None,
            step,
        )
        .unwrap();
        stats = [
            result.obstacle_force[0],
            result.obstacle_force[1],
            result.obstacle_force[2],
            result.mass,
            result.max_speed,
        ];
    }
    let mut display = vec![0.; count * 2];
    w_sim_kernels::lbm::display_d3q19(&config, &velocity, &flags, None, None, &mut display).unwrap();
    let vertices = [
        1., 1., 1., 3., 1., 1., 3., 3., 1., 1., 3., 1., 1., 1., 3., 3., 1., 3., 3., 3., 3., 1., 3.,
        3.,
    ];
    let indices = [
        0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3,
        3, 7, 4, 3, 4, 0,
    ];
    let mut mesh_flags = [0; 6 * 4 * 4];
    let counts = w_sim_kernels::geometry::voxelize_triangles(
        &vertices,
        &indices,
        6,
        4,
        4,
        &mut mesh_flags,
        &mut [0.; 60],
    )
    .unwrap();
    let fan_config = D3q19Config {
        u_inlet: 0.,
        turbulence_intensity: 0.,
        fan: Some(D3q19Fan {
            center: [2.5, 2., 1.5],
            normal: [0.6, 0.8, 0.],
            radius_cells: 0.5,
            acceleration_lattice: 0.001,
        }),
        ..config
    };
    let mut fan_f = vec![0.; count * D3Q19_Q];
    let mut fan_post = fan_f.clone();
    let mut fan_velocity = vec![0.; count * 3];
    let mut fan_density = vec![0.; count];
    init_d3q19(
        &fan_config,
        &flags,
        &mut fan_f,
        &mut fan_post,
        &mut fan_velocity,
        &mut fan_density,
        None,
    )
    .unwrap();
    let mut fan_stats = [0.; 5];
    for step in 1..=5 {
        let result = step_d3q19(
            &fan_config,
            &flags,
            &mut fan_f,
            &mut fan_post,
            &mut fan_velocity,
            &mut fan_density,
            None,
            step,
        )
        .unwrap();
        fan_stats = [
            result.obstacle_force[0],
            result.obstacle_force[1],
            result.obstacle_force[2],
            result.mass,
            result.max_speed,
        ];
    }
    assert!(fan_stats[4] > 0.);
    let fixed = case.starts_with("fixed");
    let isolated = case.ends_with("-isolated");
    let natural = case.ends_with("-natural");
    let regions = case.contains("regions");
    let flowing = case.ends_with("-flow") || case.ends_with("-slip") || case.contains("-ground-");
    let substeps = case == "power-substeps";
    let mut thermal_config = D3q19Config {
        u_inlet: if flowing { 0.02 } else { 0. },
        ground_velocity: if case.contains("-ground-") { Some(if case.ends_with("moving") { 0.02 } else { 0. }) } else { None },
        free_slip_walls: case.ends_with("-slip") || case.contains("-ground-"),
        fan: if isolated || natural {
            None
        } else {
            fan_config.fan
        },
        thermal: Some(w_sim_kernels::lbm::ThermalConfig {
            gravity_per_kelvin: 0.001,
            dt_seconds: 0.01,
            ambient_c: 25.,
            fixed_surface_c: if fixed { 35. } else { 0. },
            dx_meters: 0.1,
            fluid_density: 1.,
            fluid_specific_heat: 10.,
            fluid_conductivity: if substeps { 5. } else { 0.01 },
            solid_density: if fixed { 0. } else { 2. },
            solid_specific_heat: if fixed { 0. } else { 20. },
            solid_conductivity: if fixed {
                0.
            } else if substeps {
                50.
            } else {
                0.1
            },
            total_power_w: if fixed || case == "power-zero" {
                0.
            } else {
                0.2
            },
            mode: if fixed {
                w_sim_kernels::lbm::ThermalMode::FixedTemperature
            } else {
                w_sim_kernels::lbm::ThermalMode::SolidPower
            },
            max_substeps: 128,
            material_count: 0,
            materials: [w_sim_kernels::lbm::ThermalMaterial::default(); 16],
            contact_resistance: [0.; 136],
            contact_mask: [0; 5],
            temperature_scale_c: if fixed { 10. } else { 1. },
        }),
        ..fan_config
    };
    let mut thermal_flags = flags.clone();
    thermal_flags[32] = if fixed { 2 } else { 4 };
    thermal_flags[22] = 3;
    if isolated {
        thermal_flags.fill(1);
        thermal_flags[32] = 4;
        thermal_flags[2] = 0; // Isolated fluid, away from either open boundary donor.
    }
    if regions {
        let p = thermal_config.thermal.as_mut().unwrap();
        p.material_count = 2;
        p.materials[0] = w_sim_kernels::lbm::ThermalMaterial {
            density: 4.,
            specific_heat: 5.,
            conductivity: 0.2,
            total_power_w: 0.3,
        };
        p.materials[1] = w_sim_kernels::lbm::ThermalMaterial {
            density: 3.,
            specific_heat: 30.,
            conductivity: 0.05,
            total_power_w: 0.,
        };
        if case == "power-regions-only" || isolated || natural {
            p.total_power_w = 0.;
            thermal_flags[32] = 5;
            // Keep the xMax inner fluid layer clear for the pressure outlet.
            thermal_flags[if isolated { 33 } else { 37 }] = 6;
        } else {
            thermal_flags[33] = 5;
            thermal_flags[34] = 6;
        }
    }
    if case.contains("contact") {
        let p = thermal_config.thermal.as_mut().unwrap();
        p.set_contact(0, 1, if case.ends_with("-zero") { 0. } else { 0.5 })
            .unwrap();
        p.set_contact(2, 1, if case.ends_with("-zero") { 0. } else { 2. })
            .unwrap();
    }
    let mut tf = vec![0.; count * D3Q19_Q];
    let mut tp = tf.clone();
    let mut tu = vec![0.; count * 3];
    let mut tr = vec![0.; count];
    let mut energy = vec![0.; count];
    let mut next_energy = energy.clone();
    let mut mass = vec![0.; count];
    let mut temperature = vec![0.; count];
    init_d3q19(
        &thermal_config,
        &thermal_flags,
        &mut tf,
        &mut tp,
        &mut tu,
        &mut tr,
        Some(w_sim_kernels::lbm::ThermalBuffers {
            energy: &mut energy,
            next_energy: &mut next_energy,
            temperature_delta_k: &mut temperature,
            mass: &mut mass,
        }),
    )
    .unwrap();
    let mut thermal_stats = [0.; 12];
    for step in 1..=3 {
        let result = step_d3q19(
            &thermal_config,
            &thermal_flags,
            &mut tf,
            &mut tp,
            &mut tu,
            &mut tr,
            Some(w_sim_kernels::lbm::ThermalBuffers {
                energy: &mut energy,
                next_energy: &mut next_energy,
                temperature_delta_k: &mut temperature,
                mass: &mut mass,
            }),
            step,
        )
        .unwrap();
        let t = result.thermal.unwrap();
        thermal_stats = [
            result.obstacle_force[0],
            result.obstacle_force[1],
            result.obstacle_force[2],
            result.mass,
            result.max_speed,
            t.thermal_energy_j,
            t.source_energy_j,
            t.boundary_energy_j,
            t.energy_residual_j,
            t.solid_max_c,
            t.fluid_max_c,
            t.substeps as f64,
        ];
    }
    let mut thermal_display = vec![0.; count * 3];
    w_sim_kernels::lbm::display_d3q19(
        &thermal_config,
        &tu,
        &thermal_flags,
        Some(&temperature),
        None,
        &mut thermal_display,
    )
    .unwrap();
    let mut thermal_pressure_display = vec![0.; count * 4];
    w_sim_kernels::lbm::display_d3q19(&thermal_config, &tu, &thermal_flags, Some(&temperature), Some(&tf), &mut thermal_pressure_display).unwrap();
    let mut region_flags = [4u8; 125];
    region_flags[0] = 0;
    let mut region_counts = [0u32; 17];
    w_sim_kernels::geometry::assign_thermal_regions(
        &mut region_flags,
        [5, 5, 5],
        &[0., 0.2, 0., 0., -0.2, 0., 0., 1., 0., 0., 0.2, 0.],
        &[[0., 0., 0., 0.5, 1., 1.], [0.5, 0., 0., 1., 1., 1.]],
        &mut region_counts,
    )
    .unwrap();
    let thermal_json=format!("{{\"f\":{:?},\"post\":{:?},\"velocity\":{:?},\"density\":{:?},\"energy\":{:?},\"nextEnergy\":{:?},\"temperature\":{:?},\"mass\":{:?},\"display\":{:?},\"stats\":{:?},\"pressureDisplay\":{:?}}}",bits(&tf),bits(&tp),bits(&tu),bits(&tr),energy,next_energy,temperature,mass,bits(&thermal_display),thermal_stats,bits(&thermal_pressure_display));
    println!("{{\"wave\":{:?},\"heat\":{:?},\"f\":{:?},\"post\":{:?},\"velocity\":{:?},\"density\":{:?},\"stats\":{:?},\"display\":{:?},\"meshFlags\":{:?},\"meshCounts\":{:?},\"fanF\":{:?},\"fanPost\":{:?},\"fanVelocity\":{:?},\"fanDensity\":{:?},\"fanStats\":{:?},\"regionFlags\":{:?},\"regionCounts\":{:?},\"thermal\":{}}}",
        bits(&wave), bits(&heat), bits(&f), bits(&post), bits(&velocity), bits(&density), stats,
        bits(&display), mesh_flags, [counts.solid_cells, counts.frontal_area_cells],
        bits(&fan_f), bits(&fan_post), bits(&fan_velocity), bits(&fan_density), fan_stats, region_flags, region_counts, thermal_json);
}

fn inlet_reference(case: &str) {
    let c = D3q19Config {
        nx: 7, ny: 5, nz: 5, tau: 0.8, u_inlet: 0.04, smagorinsky_cs: 0.,
        turbulence_intensity: 0., free_slip_walls: true, ground_velocity: None,
        boundary: D3q19Boundary::WindTunnel, fan: None, thermal: None,
    };
    let mut f = vec![0.; 175*19]; let mut post = f.clone();
    let mut u = vec![0.; 175*3]; let mut rho = vec![0.; 175]; let flags = vec![0; 175];
    init_d3q19(&c, &flags, &mut f, &mut post, &mut u, &mut rho, None).unwrap();
    for cell in 0..175 {
        let density = if case=="inlet-density" && cell%7==2 { 1.03 } else { 1. };
        let velocity = [0.04, if case=="inlet-shear" {0.003*(cell%7) as f64} else {0.}, 0.];
        for (q, d) in w_sim_kernels::lbm::D3Q19_C.iter().enumerate() {
            let cu: f64 = (0..3).map(|a| d[a] as f64 * velocity[a]).sum();
            let u2: f64 = velocity.iter().map(|v| v*v).sum();
            f[cell*19+q] = (w_sim_kernels::lbm::D3Q19_W[q]*density*(1.+3.*cu+4.5*cu*cu-1.5*u2)) as f32;
        }
    }
    let r = step_d3q19(&c, &flags, &mut f, &mut post, &mut u, &mut rho, None, 1).unwrap();
    let stats = [r.obstacle_force[0],r.obstacle_force[1],r.obstacle_force[2],r.mass,r.max_speed];
    let mut pressure_display=vec![0.;175*3];
    w_sim_kernels::lbm::display_d3q19(&c,&u,&flags,None,Some(&f),&mut pressure_display).unwrap();
    let m=r.mass_balance;
    let mass_balance=[m.bulk_mass_before,m.bulk_mass_after,m.inlet_net_mass,m.outlet_net_mass,m.collision_mass_change,m.inlet_replacement_mass,m.outlet_replacement_mass];
    println!("{{\"f\":{:?},\"post\":{:?},\"velocity\":{:?},\"density\":{:?},\"stats\":{:?},\"massBalance\":{:?},\"pressureDisplay\":{:?}}}",bits(&f),bits(&post),bits(&u),bits(&rho),stats,mass_balance,bits(&pressure_display));
}
