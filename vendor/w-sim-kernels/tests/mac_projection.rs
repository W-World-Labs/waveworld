use w_sim_kernels::mac_projection::{
    project_mac3d, MacProjectionBuffers, MacProjectionConfig, MacProjectionError,
    MacProjectionStats,
};
use w_sim_kernels::KernelError;

struct Case {
    config: MacProjectionConfig,
    flags: Vec<u8>,
    u: Vec<f64>,
    v: Vec<f64>,
    w: Vec<f64>,
    pressure: Vec<f64>,
    work: Vec<f64>,
    topology_work: Vec<u32>,
}

impl Case {
    fn new(nx: usize, ny: usize, nz: usize, open_faces: u8) -> Self {
        let n = nx * ny * nz;
        Self {
            config: MacProjectionConfig {
                nx,
                ny,
                nz,
                dx_m: 1.0,
                dt_s: 1.0,
                density_kg_m3: 1.0,
                open_faces,
                max_iterations: 200,
                absolute_divergence_tol: 1e-11,
                relative_residual_tol: 0.0,
            },
            flags: vec![0; n],
            u: vec![0.0; (nx + 1) * ny * nz],
            v: vec![0.0; nx * (ny + 1) * nz],
            w: vec![0.0; nx * ny * (nz + 1)],
            pressure: vec![99.0; n],
            work: vec![99.0; 6 * n],
            topology_work: vec![99; 2 * n],
        }
    }

    fn project(&mut self) -> Result<MacProjectionStats, MacProjectionError> {
        project_mac3d(
            &self.config,
            &self.flags,
            &mut MacProjectionBuffers {
                u: &mut self.u,
                v: &mut self.v,
                w: &mut self.w,
                pressure: &mut self.pressure,
                work: &mut self.work,
                topology_work: &mut self.topology_work,
            },
        )
    }

    // Independent cell stencil: do not use the core's matrix or face traversal.
    fn divergences(&self) -> Vec<f64> {
        let c = &self.config;
        let mut out = vec![0.0; self.flags.len()];
        for z in 0..c.nz {
            for y in 0..c.ny {
                for x in 0..c.nx {
                    let k = x + c.nx * (y + c.ny * z);
                    if self.flags[k] != 0 {
                        continue;
                    }
                    let ui = x + (c.nx + 1) * (y + c.ny * z);
                    let vi = x + c.nx * (y + (c.ny + 1) * z);
                    let wi = x + c.nx * (y + c.ny * z);
                    out[k] = (self.u[ui + 1] - self.u[ui] + self.v[vi + c.nx] - self.v[vi]
                        + self.w[wi + c.nx * c.ny]
                        - self.w[wi])
                        / c.dx_m;
                }
            }
        }
        out
    }
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:.16e}, expected {expected:.16e}, tolerance {tolerance}"
    );
}

#[test]
fn uniform_throughflow_is_unchanged_without_iterations() {
    let mut case = Case::new(4, 3, 2, 3);
    case.u.fill(2.25);
    let stats = case.project().unwrap();
    assert_eq!(stats.iterations, 0);
    assert_eq!(stats.closed_components, 0);
    assert_eq!(stats.initial_divergence_linf, 0.0);
    assert_eq!(stats.final_divergence_linf, 0.0);
    assert!(case.u.iter().all(|&u| u == 2.25));
    assert!(case.pressure.iter().all(|&p| p == 0.0));
}

#[test]
fn single_cell_pressure_openings_have_half_cell_distance() {
    let mut case = Case::new(1, 1, 1, 3);
    case.config.dx_m = 2.0;
    case.config.dt_s = 0.5;
    case.config.density_kg_m3 = 3.0;
    case.u.copy_from_slice(&[-1.0, 1.0]);
    let stats = case.project().unwrap();
    close(case.pressure[0], -6.0, 1e-13);
    assert_eq!(case.u, [0.0, 0.0]);
    assert_eq!(stats.initial_divergence_linf, 1.0);
    assert_eq!(stats.final_divergence_linf, 0.0);
}

#[test]
fn two_cell_opening_oracle_all_axes_and_physical_scales() {
    // A wrong full-cell boundary can also make D=0, but yields 1/3 instead of
    // the independently derived half-cell result 1/2. Check both p and flux.
    for axis in 0..3 {
        for (h, rho, dt) in [
            (2.0, 3.0, 0.5),
            (2.0, 21.0, 0.5),
            (2.0, 3.0, 1.5),
            (0.02, 3.0, 0.5),
        ] {
            let mut dims = [1; 3];
            dims[axis] = 2;
            let mut case = Case::new(dims[0], dims[1], dims[2], 3 << (2 * axis));
            case.config.dx_m = h;
            case.config.density_kg_m3 = rho;
            case.config.dt_s = dt;
            [&mut case.u, &mut case.v, &mut case.w][axis][1] = 1.0;
            let stats = case.project().unwrap();
            close(case.pressure[0], -rho * h / (4.0 * dt), 1e-12);
            close(case.pressure[1], rho * h / (4.0 * dt), 1e-12);
            for &velocity in [&case.u, &case.v, &case.w][axis] {
                close(velocity, 0.5, 1e-13);
            }
            for d in case.divergences() {
                close(d, 0.0, 1e-11);
            }
            close(stats.final_divergence_linf, 0.0, 1e-11);
        }
    }
}

fn circulation_case() -> Case {
    let mut case = Case::new(2, 2, 1, 0);
    case.u[1] = 2.0;
    case.u[4] = 1.0;
    case.v[2] = 1.0;
    case.v[3] = 4.0;
    case
}

#[test]
fn projection_retains_closed_box_circulation_and_is_idempotent() {
    // u* is the sum of a nonzero solenoidal cycle and the gradient of
    // p=[0,1,2,4]. Clearing velocities would conserve volume but is incorrect.
    let mut case = circulation_case();
    let stats = case.project().unwrap();
    assert_eq!(stats.closed_components, 1);
    for (&actual, expected) in case.pressure.iter().zip([0.0, 1.0, 2.0, 4.0]) {
        close(actual, expected, 1e-13);
    }
    close(case.u[1], 1.0, 1e-13);
    close(case.u[4], -1.0, 1e-13);
    close(case.v[2], -1.0, 1e-13);
    close(case.v[3], 1.0, 1e-13);
    for d in case.divergences() {
        close(d, 0.0, 1e-13);
    }
    let before = (case.u.clone(), case.v.clone(), case.w.clone());
    case.project().unwrap();
    for (actual, expected) in case
        .u
        .iter()
        .chain(&case.v)
        .chain(&case.w)
        .zip(before.0.iter().chain(&before.1).chain(&before.2))
    {
        close(*actual, *expected, 1e-13);
    }
}

#[test]
fn each_closed_cavity_has_its_own_pin_including_an_isolated_cell() {
    let mut case = Case::new(7, 1, 1, 0);
    // Nonzero flags use the same occupancy meaning, with no thermal semantics.
    case.flags.copy_from_slice(&[0, 0, 4, 0, 0, 20, 0]);
    case.config.dx_m = 2.0;
    case.config.density_kg_m3 = 3.0;
    case.config.dt_s = 0.5;
    case.u.fill(17.0);
    case.v.fill(-23.0);
    case.w.fill(31.0);
    case.u[1] = 1.0;
    case.u[4] = -2.0;
    let stats = case.project().unwrap();
    assert_eq!(stats.closed_components, 3);
    assert_eq!(stats.fluid_cells, 5);
    for (&actual, expected) in case
        .pressure
        .iter()
        .zip([0.0, 12.0, 0.0, 0.0, -24.0, 0.0, 0.0])
    {
        close(actual, expected, 1e-12);
    }
    for &u in case.u.iter().chain(&case.v).chain(&case.w) {
        close(u, 0.0, 1e-13);
    }
    for d in case.divergences() {
        close(d, 0.0, 1e-13);
    }
}

#[test]
fn open_and_closed_components_do_not_share_a_pressure_gauge() {
    let mut case = Case::new(5, 1, 1, 1);
    case.flags[2] = 1;
    case.u[1] = 1.0;
    case.u[4] = 2.0;
    let stats = case.project().unwrap();
    assert_eq!(stats.closed_components, 1);
    for (&p, expected) in case.pressure.iter().zip([0.0, 1.0, 0.0, 0.0, 2.0]) {
        close(p, expected, 1e-13);
    }
    for d in case.divergences() {
        close(d, 0.0, 1e-13);
    }
}

#[test]
fn nonconvergence_preserves_velocity_and_checks_the_original_pin_equation() {
    let mut case = circulation_case();
    case.config.max_iterations = 1;
    case.config.absolute_divergence_tol = 1e-12;
    case.config.relative_residual_tol = 0.99;
    let before = (case.u.clone(), case.v.clone(), case.w.clone());
    let error = case.project().unwrap_err();
    let MacProjectionError::NotConverged {
        iterations,
        residual_linf_pa_per_m2,
        allowed_residual_linf_pa_per_m2,
    } = error
    else {
        panic!("wrong error: {error:?}");
    };
    assert_eq!(iterations, 1);
    // Exact first Jacobi-PCG iterate, independently computed as fractions. The
    // pinned cell is the largest residual and must not be omitted from the norm.
    close(residual_linf_pa_per_m2, 146.0 / 39.0, 2e-14);
    assert_eq!(allowed_residual_linf_pa_per_m2, 1e-12);
    assert_eq!((case.u.clone(), case.v.clone(), case.w.clone()), before);
    case.u[1] -= case.pressure[1] - case.pressure[0];
    case.u[4] -= case.pressure[3] - case.pressure[2];
    case.v[2] -= case.pressure[2] - case.pressure[0];
    case.v[3] -= case.pressure[3] - case.pressure[1];
    let expected = [146.0 / 39.0, -35.0 / 26.0, -145.0 / 78.0, -7.0 / 13.0];
    for (d, expected) in case.divergences().iter().zip(expected) {
        close(*d, expected, 2e-14);
    }
}

#[test]
fn relative_tolerance_can_tighten_but_never_relax_absolute_divergence() {
    for relative in [0.0, 0.99, 1e-14] {
        let mut case = circulation_case();
        case.config.relative_residual_tol = relative;
        let stats = case.project().unwrap();
        let target = if relative == 0.0 {
            1e-11
        } else {
            (relative * 5.0_f64).min(1e-11)
        };
        close(stats.allowed_divergence_linf, target, 1e-25);
        assert!(stats.final_divergence_linf <= target);
        assert!(stats.residual_linf_pa_per_m2 <= target);
    }
}

#[test]
fn three_dimensional_discrete_manufactured_pressure_is_recovered() {
    let mut case = Case::new(4, 3, 2, 63);
    case.config.dx_m = 0.17;
    case.config.dt_s = 0.013;
    case.config.density_kg_m3 = 1.225;
    let (nx, ny, nz) = (4, 3, 2);
    let p = |x: usize, y: usize, z: usize| {
        0.03 * (x * x) as f64 - 0.012 * (y * z + x) as f64 + 0.071 * y as f64 - 0.011 * z as f64
            + 0.037
    };
    let scale = case.config.dt_s / case.config.density_kg_m3 / case.config.dx_m;
    // Manufacture a pure pressure-gradient velocity independently of the core.
    for z in 0..nz {
        for y in 0..ny {
            for x in 0..=nx {
                case.u[x + (nx + 1) * (y + ny * z)] = scale
                    * if x == 0 {
                        2.0 * p(0, y, z)
                    } else if x == nx {
                        -2.0 * p(nx - 1, y, z)
                    } else {
                        p(x, y, z) - p(x - 1, y, z)
                    };
            }
        }
    }
    for z in 0..nz {
        for y in 0..=ny {
            for x in 0..nx {
                case.v[x + nx * (y + (ny + 1) * z)] = scale
                    * if y == 0 {
                        2.0 * p(x, 0, z)
                    } else if y == ny {
                        -2.0 * p(x, ny - 1, z)
                    } else {
                        p(x, y, z) - p(x, y - 1, z)
                    };
            }
        }
    }
    for z in 0..=nz {
        for y in 0..ny {
            for x in 0..nx {
                case.w[x + nx * (y + ny * z)] = scale
                    * if z == 0 {
                        2.0 * p(x, y, 0)
                    } else if z == nz {
                        -2.0 * p(x, y, nz - 1)
                    } else {
                        p(x, y, z) - p(x, y, z - 1)
                    };
            }
        }
    }
    let stats = case.project().unwrap();
    assert_eq!(stats.fluid_cells, 24);
    assert_eq!(stats.closed_components, 0);
    for z in 0..nz {
        for y in 0..ny {
            for x in 0..nx {
                close(case.pressure[x + nx * (y + ny * z)], p(x, y, z), 2e-11);
            }
        }
    }
    for &u in case.u.iter().chain(&case.v).chain(&case.w) {
        close(u, 0.0, 2e-12);
    }
    for d in case.divergences() {
        close(d, 0.0, 1e-11);
    }
}

#[test]
fn invalid_inputs_are_rejected_before_mutating_fields() {
    for invalid in 0..8 {
        let mut case = Case::new(2, 1, 1, 3);
        case.u[1] = 1.0;
        match invalid {
            0 => case.config.open_faces = 64,
            1 => case.config.dx_m = 0.0,
            2 => case.config.dt_s = f64::INFINITY,
            3 => case.config.relative_residual_tol = 1.0,
            4 => {
                case.work.pop();
            }
            5 => case.flags.fill(1),
            6 => case.config.nx = 0,
            _ => case.config.dx_m = 1e-300,
        }
        let before = (
            case.u.clone(),
            case.v.clone(),
            case.w.clone(),
            case.pressure.clone(),
        );
        assert!(matches!(
            case.project(),
            Err(MacProjectionError::Invalid(_))
        ));
        assert_eq!((case.u, case.v, case.w, case.pressure), before);
    }
    let mut case = Case::new(2, 1, 1, 3);
    case.u[0] = f64::NAN;
    assert_eq!(
        case.project(),
        Err(MacProjectionError::Invalid(KernelError::NonFiniteValue))
    );
    assert!(case.pressure.iter().all(|&p| p == 99.0));
}
