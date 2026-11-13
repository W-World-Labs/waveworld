/**
 * Curated example metadata for WaveWorld's COMSOL native cases page.
 * These describe the native W-Sim examples; they do not imply .mph fidelity or
 * parity with COMSOL products.
 */
export interface ComsolNativeCaseInput {
  module: string
  [key: string]: unknown
}

export interface ComsolNativeCase {
  file: string
  module: string
  summary: string
  selector: string
  input: ComsolNativeCaseInput
  exampleName: string
  limitations: string
  testsWritten: string[]
  sourceUrls: string[]
}

export const COMSOL_NATIVE_CASES: readonly ComsolNativeCase[] = [
  {
    "file": "sw_comsol_acoustic_dg_b.rs",
    "module": "sw-comsol-acoustic-dg-b",
    "summary": "Adds an exact one-dimensional linear-acoustic Riemann profile query for a pressure/velocity jump, including its characteristic front regions and intermediate state.",
    "selector": "method-algo-acoustic-dg-riemann (alias: riemann); requires left/right [pressure, velocity], x, time >= 0, rho0 > 0, c > 0; optional x0.",
    "input": {
      "module": "sw-comsol-acoustic-dg-b",
      "method": "method-algo-acoustic-dg-riemann",
      "rho0": 1.225,
      "c": 343.0,
      "left": [
        2.0,
        0.0
      ],
      "right": [
        0.0,
        0.0
      ],
      "x": 0.0,
      "x0": 0.0,
      "time": 0.001
    },
    "exampleName": "unique-comsol-acoustic-dg-riemann-profile",
    "limitations": "Exact analytic point query for one jump in an infinite, homogeneous, lossless 1D medium. It is a transient reference, not a DG mesh solver or time integrator; no boundaries, material interfaces, attenuation, or nonlinear acoustics. Host-f64 only; CUDA requests fail closed.",
    "testsWritten": [
      "riemann_profile_has_exact_star_and_far_field_regions",
      "riemann_profile_rejects_negative_time_and_bad_selector"
    ],
    "sourceUrls": [
      "https://www.comsol.com/comsol-multiphysics/model-builder",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_environment.18.39.html"
    ]
  },
  {
    "file": "sw_comsol_acoustic_structure.rs",
    "module": "sw-comsol-acoustic-structure",
    "summary": "Layered and mass-air-mass stacks can be terminated by a rigid wall and report reflected and absorbed incident power.",
    "selector": "model=layered (or mass-air-mass), termination=rigid",
    "input": {
      "module": "sw-comsol-acoustic-structure",
      "model": "layered",
      "termination": "rigid",
      "frequencyHz": 1000.0,
      "elements": [
        {
          "type": "fluid",
          "rho": 1.21,
          "c": 343.0,
          "thickness": 0.08575
        },
        {
          "type": "plate",
          "surfaceMass": 1.0,
          "rigidity": 350.7,
          "lossFactor": 0.066
        }
      ]
    },
    "exampleName": "unique-comsol-acoustic-structure-rigid-backed-quarter-wave",
    "limitations": "Host-f64 normal-incidence transfer-matrix model; rigid-backed mode is limited to layered and mass-air-mass stacks, with lossless fluid layers and a perfectly rigid termination. It is not a general finite-element ASI solver.",
    "testsWritten": [
      "rigid_backed_lossless_layer_reflects_all_incident_power",
      "rigid_backed_quarter_wave_and_matched_lossy_plate_absorbs_all_power",
      "admission_rejects_missing_and_unknown"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.aco/aco_ug_pressure.05.110.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.aco/aco_ug_pressure.05.163.html"
    ]
  },
  {
    "file": "sw_comsol_ale_mesh.rs",
    "module": "sw-comsol-ale-mesh",
    "summary": "Laplace smoothing now applies rectangular-grid inverse-spacing weights and accepts harmonic quadratic Dirichlet displacement fields.",
    "selector": "quantity=laplace-smooth with uBoundary=[a,b,c,d,e] for a+b*x+c*y+d*(x^2-y^2)+e*x*y",
    "input": {
      "module": "sw-comsol-ale-mesh",
      "quantity": "laplace-smooth",
      "nx": 5,
      "ny": 5,
      "Lx": 2.0,
      "Ly": 1.0,
      "uBoundary": [
        0.0,
        0.0,
        0.0,
        1.0,
        0.0
      ]
    },
    "exampleName": "unique-comsol-ale-rectangular-harmonic-displacement",
    "limitations": "Host-f64 algebraic mesh smoothing on a rectangular uniform grid only; no transient ALE update, PDE assembly, remeshing, 3D mesh, or coupled fluid-structure solve. Boundary polynomials are limited to linear and harmonic quadratic terms.",
    "testsWritten": [
      "laplace_smoothing_respects_rectangular_grid_spacing",
      "laplace_smoothing_reproduces_linear_field",
      "admission_fail_closed"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_non_isothermal.rs",
    "module": "sw-comsol-non-isothermal",
    "summary": "Computes axisymmetric cylindrical viscous dissipation from an (r,z) velocity gradient, including the hoop strain u_r/r.",
    "selector": "quantity=dissipation with coordinateSystem=axisymmetric, radius and radialVelocity",
    "input": {
      "module": "sw-comsol-non-isothermal",
      "quantity": "dissipation",
      "coordinateSystem": "axisymmetric",
      "radius": 0.25,
      "radialVelocity": 2.5,
      "mu": 0.002,
      "gradU": [
        [
          10.0,
          0.0
        ],
        [
          0.0,
          -20.0
        ]
      ]
    },
    "exampleName": "unique-comsol-axisymmetric-dissipation",
    "limitations": "Host-f64 local evaluation only; assumes axisymmetric Newtonian flow and a finite off-axis sample. It does not solve coupled flow/energy fields or handle the r=0 axis limit.",
    "testsWritten": [
      "axisymmetric_dissipation_includes_hoop_strain",
      "axisymmetric_dissipation_rejects_axis_and_wrong_gradient_shape"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_battery_thermal_runaway_b.rs",
    "module": "sw-comsol-battery-thermal-runaway-b",
    "summary": "Adds a bounded fixed-step RK4 time-dependent Semenov heat-balance study with lumped heat capacity, Arrhenius generation, and Newton cooling.",
    "selector": "method=cooling-transient (aliases: semenov-transient, time-dependent-cooling); requires C, Tinit, duration in addition to Ea, q0, hA, Ta; dt is the maximum step.",
    "input": {
      "module": "sw-comsol-battery-thermal-runaway-b",
      "method": "cooling-transient",
      "Ea": 20000,
      "q0": 10000,
      "hA": 1,
      "Ta": 300,
      "C": 100,
      "Tinit": 900,
      "duration": 2,
      "dt": 0.001
    },
    "exampleName": "unique-comsol-battery-runaway-b-cooling-transient",
    "limitations": "0-D lumped ODE only; fixed-step RK4 with caller-controlled step size and a 50,000,000-step ceiling; reported peak is sampled at step endpoints. It does not resolve spatial heat transport, electrochemical PDEs, reactant depletion, or multi-step chemistry.",
    "testsWritten": [
      "cooling_transient_matches_newton_cooling_limit",
      "cooling_transient_captures_heat_generation_against_cooling",
      "cooling_transient_rejects_invalid_and_unsupported_requests"
    ],
    "sourceUrls": [
      "https://www.comsol.com/comsol-multiphysics/model-builder",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_environment.18.39.html"
    ]
  },
  {
    "file": "sw_comsol_bem_laplace2d.rs",
    "module": "sw-comsol-bem-laplace2d",
    "summary": "Reports interior potential gradients from the differentiated 2D Laplace single-layer panel integral.",
    "selector": "evalPoints now returns gradX, gradY, and gradMagnitude with each potential sample",
    "input": {
      "module": "sw-comsol-bem-laplace2d",
      "boundary": [
        [
          -2.0,
          -2.0
        ],
        [
          2.0,
          -2.0
        ],
        [
          2.0,
          2.0
        ],
        [
          -2.0,
          2.0
        ]
      ],
      "dirichlet": [
        0.0,
        2.0,
        0.0,
        -2.0
      ],
      "evalPoints": [
        [
          0.25,
          0.1
        ]
      ]
    },
    "exampleName": "unique-comsol-bem-laplace2d-interior-gradient",
    "limitations": "Host-f64 constant-panel midpoint-collocation BEM; the gradient uses fixed-order panel quadrature and loses accuracy near the boundary. Dense solve capped at 512 panels; GPU requests remain unsupported.",
    "testsWritten": [
      "interior_gradient_matches_affine_harmonic_field"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_boltzmann_eedf.rs",
    "module": "sw-comsol-boltzmann-eedf",
    "summary": "Computes reaction rate coefficients from bounded piecewise-linear cross-section tables over the EEDF energy domain.",
    "selector": "quantity=rate with crossSection energy/cross-section pairs; quantity=eedf may also request the rate diagnostic",
    "input": {
      "module": "sw-comsol-boltzmann-eedf",
      "quantity": "rate",
      "TeV": 1.0,
      "nCells": 32,
      "uMax": 4.0,
      "crossSection": [
        [
          0.0,
          0.0
        ],
        [
          2.0,
          1e-20
        ],
        [
          4.0,
          5e-21
        ]
      ]
    },
    "exampleName": "unique-comsol-boltzmann-eedf-tabulated-reaction-rate",
    "limitations": "Host-f64 reaction-rate integration over the existing cell-centered generalized EEDF; cross sections are linearly interpolated, must cover [0,uMax], and do not add inelastic collisions to the self-consistent two-term Boltzmann solve.",
    "testsWritten": [
      "rate_tabulated_constant_cross_section_matches_zero_threshold_step",
      "eedf_tabulated_linear_cross_section_adds_rate_diagnostic",
      "tabulated_rate_rejects_bad_or_incomplete_cross_section_tables"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_cathodic_protection.rs",
    "module": "sw-comsol-cathodic-protection",
    "summary": "Adds signed local Butler-Volmer electrode kinetics with bounded exponential evaluation and optional total-current conversion from electrode area.",
    "selector": "method-algo-butler-volmer (also butler-volmer)",
    "input": {
      "module": "sw-comsol-cathodic-protection",
      "method": "butler-volmer",
      "exchangeCurrentDensity": 10.0,
      "overpotential": -0.05,
      "anodicTransferCoefficient": 0.5,
      "cathodicTransferCoefficient": 0.5,
      "electrons": 2.0,
      "temperature": 298.15,
      "area": 0.25
    },
    "exampleName": "unique-comsol-cathodic-protection-butler-volmer-polarization",
    "limitations": "Host-f64 local activation-kinetics calculation only. Assumes supplied constant exchange current density and temperature; does not couple concentration, mass transport, electrolyte potential, spatial current distribution, or evolving geometry. Requested CUDA remains unsupported.",
    "testsWritten": [
      "butler_volmer_zero_and_small_signal_limit",
      "butler_volmer_has_signed_symmetric_polarization",
      "butler_volmer_rejects_invalid_coefficients_and_unbounded_exponents"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.corr/corr_ug_electrochem.06.147.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.fce/fce_ug_electrochem.07.095.html"
    ]
  },
  {
    "file": "sw_comsol_chem_bc.rs",
    "module": "sw-comsol-chem-bc",
    "summary": "Adds COMSOL external-convection boundary flux from a bulk concentration and nonnegative mass-transfer coefficient, reported outward-positive.",
    "selector": "bc=external-convection with kC, cBulk, and c",
    "input": {
      "module": "sw-comsol-chem-bc",
      "bc": "external-convection",
      "kC": 2e-05,
      "cBulk": 0.5,
      "c": 2.0
    },
    "exampleName": "unique-comsol-chem-bc-external-convection",
    "limitations": "Analytic pointwise external-film exchange only: it does not solve the exterior domain or add modeled-domain advection; host-f64 only.",
    "testsWritten": [
      "external_convection_matches_robin_exchange_and_equilibrium_limit",
      "external_convection_admits_only_finite_nonnegative_transfer_data"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.4/doc/com.comsol.help.mfl/mfl_ug_chemsptrans.11.16.html"
    ]
  },
  {
    "file": "sw_comsol_cma_es.rs",
    "module": "sw-comsol-cma-es",
    "summary": "Adds a validated per-coordinate initialMean input to center CMA-ES searches while preserving the default start and trajectory.",
    "selector": "initialMean: finite coordinate array of length dim, each in [-1e6,1e6]",
    "input": {
      "module": "sw-comsol-cma-es",
      "problem": "sphere",
      "dim": 2,
      "initialMean": [
        3.0,
        -4.0
      ],
      "sigma": 0.05,
      "generations": 100,
      "seed": 19,
      "backend": "host"
    },
    "exampleName": "unique-comsol-cma-es-custom-start-mean",
    "limitations": "The module still optimizes only its built-in unconstrained sphere, Rosenbrock, and Rastrigin objectives; initialMean selects the search center and does not constrain design variables. Host-f64 only; it does not claim COMSOL result parity.",
    "testsWritten": [
      "custom_initial_mean_centers_the_sampled_population",
      "custom_initial_mean_admission_is_fail_closed"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_coefficient_form.rs",
    "module": "sw-comsol-coefficient-form",
    "summary": "Adds scalar outward Robin endpoint conditions n·(c∇u+αu)+r·u=g to the 1D P1 coefficient-form assembler, including endpoint stiffness, source, reporting, and fail-closed admission.",
    "selector": "method-algo-coefficient-form-1d with robin0/robinL >= 0 and paired flux0/fluxL outward sources",
    "input": {
      "module": "sw-comsol-coefficient-form",
      "method": "method-algo-coefficient-form-1d",
      "length": 1.0,
      "elements": 4,
      "c": 1.0,
      "f": 0.0,
      "robin0": 2.0,
      "flux0": -1.0,
      "robinL": 2.0,
      "fluxL": 3.0,
      "probes": [
        0.0,
        0.5,
        1.0
      ]
    },
    "exampleName": "unique-comsol-coefficient-form-robin-endpoints",
    "limitations": "Host-f64 only; scalar nonnegative Robin coefficients and scalar outward sources at the endpoints on a uniform 1D continuous-P1 mesh. No symbolic expressions, arbitrary geometry, General/Weak Form compiler, or time-dependent model is provided.",
    "testsWritten": [
      "robin_transfer_boundary_gives_linear_exact",
      "robin_boundary_admission_is_nonnegative_and_excludes_dirichlet"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_equationbased.32.036.html"
    ]
  },
  {
    "file": "sw_comsol_acoustic_bcs.rs",
    "module": "sw-comsol-acoustic-bcs",
    "summary": "Computes phase-aware oblique plane-wave reflection and absorbed power for passive complex surface impedance.",
    "selector": "bc=impedance with optional impedanceImagZ as Im(Zs); impedanceZ remains Re(Zs).",
    "input": {
      "module": "sw-comsol-acoustic-bcs",
      "bc": "impedance",
      "impedanceZ": 420.175,
      "impedanceImagZ": 420.175,
      "rho": 1.225,
      "c": 343.0,
      "thetaDeg": 0.0
    },
    "exampleName": "unique-comsol-complex-acoustic-impedance",
    "limitations": "Host-f64 frequency-local plane-wave boundary calculation for passive locally reacting surfaces; it does not fit frequency-dependent impedance models or represent tangential boundary coupling.",
    "testsWritten": [
      "complex_impedance_captures_reactive_phase_and_loss",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.aco/aco_ug_pressure.05.171.html"
    ]
  },
  {
    "file": "sw_comsol_coupling_strategy.rs",
    "module": "sw-comsol-coupling-strategy",
    "summary": "Adds a bounded constant damping factor for fully coupled Newton corrections and reports the resolved factor.",
    "selector": "newtonDamping with strategy fully-coupled; factor must be in (0, 1]",
    "input": {
      "module": "sw-comsol-coupling-strategy",
      "strategy": "fully-coupled",
      "p": 0.0,
      "q": 0.0,
      "newtonDamping": 0.5,
      "tol": 1e-12
    },
    "exampleName": "unique-comsol-coupling-strategy-damped-newton",
    "limitations": "Uses a constant damping factor on the analytic two-variable Newton update; it has no adaptive line search or general COMSOL solver equivalence, and convergence is limited by maxIters.",
    "testsWritten": [
      "damped_newton_has_analytic_linear_limit_and_reports_convergence",
      "admission_fail_closed"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_current_distribution.rs",
    "module": "sw-comsol-current-distribution",
    "summary": "Adds a Robin terminal-transfer boundary condition to the thin-gap secondary and tertiary current profiles, with exact profile and average-current formulas.",
    "selector": "quantity=secondary with tipTransfer (beta, 1/m) >= 0",
    "input": {
      "module": "sw-comsol-current-distribution",
      "quantity": "secondary",
      "kappa": 1.0,
      "h": 0.001,
      "L": 0.1,
      "Rct": 10.0,
      "eta0": 0.1,
      "tipTransfer": 10.0,
      "x": 0.05
    },
    "exampleName": "unique-comsol-current-distribution-robin-tip-transfer",
    "limitations": "One-dimensional linear transmission-line model with a linear Robin tip load; it is not a coupled multidimensional electrochemical PDE solve. The coefficient is finite and nonnegative; GPU execution remains unsupported.",
    "testsWritten": [
      "secondary_robin_tip_transfer_closed_form",
      "robin_tip_transfer_rejects_negative_admission"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_dg_compressible.rs",
    "module": "sw-comsol-dg-compressible",
    "summary": "The P1 Euler residual now supports stationary inviscid slip walls with exact zero-mass, pressure-only momentum, zero-energy boundary fluxes.",
    "selector": "method-algo-dg-euler-residual with leftBoundary/rightBoundary set to slip-wall; neighbor remains the default and requires its corresponding exterior state.",
    "input": {
      "module": "sw-comsol-dg-compressible",
      "method": "method-algo-dg-euler-residual",
      "leftBoundary": "slip-wall",
      "leftNode": [
        1.0,
        2.0,
        1.0
      ],
      "rightNode": [
        1.0,
        2.0,
        1.0
      ],
      "rightState": [
        1.0,
        2.0,
        1.0
      ],
      "dx": 0.5
    },
    "exampleName": "unique-comsol-dg-euler-residual-slip-wall",
    "limitations": "Host-f64 1D P1 residual only; slip walls are stationary and inviscid. No moving walls, viscous wall treatment, transient solve, multidimensional or arbitrary-order DG, or outlet/inlet boundary models are implemented.",
    "testsWritten": [
      "residual_slip_wall_uses_exact_impermeable_euler_flux",
      "residual_slip_walls_preserve_static_uniform_state",
      "residual_rejects_unimplemented_boundary_condition"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.corr/corr_ug_fluidflow.09.094.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_high_mach.08.15.html"
    ]
  },
  {
    "file": "sw_comsol_em_dgtd.rs",
    "module": "sw-comsol-em-dgtd",
    "summary": "P1 Maxwell DG residuals can impose ideal PEC or PMC walls using reflection-parity ghost traces, enforcing zero tangential E or H at either element face.",
    "selector": "method-algo-dgtd-residual with leftBoundary or rightBoundary set to pec|pmc; omit the corresponding leftState or rightState.",
    "input": {
      "module": "sw-comsol-em-dgtd",
      "method": "method-algo-dgtd-residual",
      "leftBoundary": "pec",
      "leftNode": [
        3.0,
        2.0
      ],
      "rightNode": [
        3.0,
        2.0
      ],
      "rightState": [
        3.0,
        2.0
      ],
      "eps": 1.0,
      "mu": 1.0,
      "dx": 0.25
    },
    "exampleName": "unique-comsol-dgtd-pec-left-wall",
    "limitations": "One-dimensional, one-element P1 semi-discrete residual with ideal PEC/PMC mirror conditions only; no transient field march, multi-D mesh, PML, port, impedance, or absorbing boundary conditions. Host-f64 only.",
    "testsWritten": [
      "residual_pec_pmc_walls_enforce_tangential_fields",
      "residual_wall_boundary_admission_is_explicit"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_participating_radiation_b.rs",
    "module": "sw-comsol-participating-radiation-b",
    "summary": "DOM now supports opaque diffuse-gray walls whose bounded emissivity controls blackbody emission and diffuse reflection of incident irradiation.",
    "selector": "method=dom with wallEmissivity1 and wallEmissivity2 in [0,1]",
    "input": {
      "module": "sw-comsol-participating-radiation-b",
      "method": "dom",
      "absorption": 1.0,
      "scattering": 0.5,
      "thickness": 1.0,
      "T1": 900.0,
      "T2": 500.0,
      "Tmedium": 700.0,
      "wallEmissivity1": 0.5,
      "wallEmissivity2": 0.9,
      "nOrd": 8,
      "nCells": 40
    },
    "exampleName": "unique-comsol-dom-gray-wall-reflection",
    "limitations": "Host-f64, stationary 1D plane-parallel gray transport with isotropic medium scattering and opaque diffuse walls; no spectral properties, specular reflection, 3D geometry, or coupled transient energy solve.",
    "testsWritten": [
      "dom_diffuse_gray_reflecting_walls_preserve_closed_cavity_equilibrium",
      "dom_gray_wall_admission_is_bounded_and_method_scoped"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_theory.07.063.html"
    ]
  },
  {
    "file": "sw_comsol_eigenfrequency_b.rs",
    "module": "sw-comsol-eigenfrequency-b",
    "summary": "Adds Rayleigh mass and stiffness proportional damping to system eigenfrequency modes, reporting modal damping ratios, damped oscillation frequencies, and decay rates.",
    "selector": "method-comsol-eigenfrequency-system with optional rayleighMassDamping (s^-1) and rayleighStiffnessDamping (s) coefficients",
    "input": {
      "module": "sw-comsol-eigenfrequency-b",
      "method": "method-comsol-eigenfrequency-system",
      "stiffness": [
        [
          4.0
        ]
      ],
      "mass": [
        [
          1.0
        ]
      ],
      "rayleighMassDamping": 2.0
    },
    "exampleName": "unique-comsol-eigenfrequency-system-rayleigh-damped-sdoF",
    "limitations": "Host-f64 only. Damping is limited to classical Rayleigh C = alpha_M M + beta_K K for the supplied linear system. Non-proportional damping and complex mode vectors are unsupported. Rigid-body modal damping fields are null because the scalar modal reduction omits the additional non-oscillatory mass-damping pole; critically damped and overdamped modes have null oscillation frequency.",
    "testsWritten": [
      "system_rayleigh_damping_reports_modal_decay_and_damped_frequency",
      "system_rayleigh_damping_handles_critical_and_rigid_modes",
      "system_rayleigh_damping_rejects_invalid_coefficients_and_unknown_models"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.sme/sme_ug_modeling.05.004.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.sme/sme_ug_solid.07.043.html"
    ]
  },
  {
    "file": "sw_comsol_electrokinetic.rs",
    "module": "sw-comsol-electrokinetic",
    "summary": "Computes the Poisson-Boltzmann Grahame surface charge for symmetric z:z salts, inferring integer valence from ion species or accepting saltValence with ionic strength.",
    "selector": "method=double-layer with zeta and either symmetric concentrations/charges or ionicStrength plus saltValence",
    "input": {
      "module": "sw-comsol-electrokinetic",
      "method": "double-layer",
      "concentrations": [
        1.0,
        1.0
      ],
      "charges": [
        2.0,
        -2.0
      ],
      "zeta": 0.01
    },
    "exampleName": "unique-comsol-electrokinetic-grahame-2to2",
    "limitations": "Algebraic Grahame surface charge for a symmetric equal-concentration integer-valence z:z electrolyte only; this does not solve Poisson-Boltzmann or include Stern layers, surface chemistry, or transport. Ionic-strength-only inputs default to 1:1 unless saltValence is given. Host-f64 backend only.",
    "testsWritten": [
      "grahame_symmetric_2to2_salt_and_linear_limit",
      "grahame_rejects_invalid_or_mismatched_salt_valence",
      "surface_charge_grahame_golden"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.models.corr.diffuse_double_layer/models.corr.diffuse_double_layer.pdf",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.mfl/mfl_ug_fluidflow_single.06.45.html"
    ]
  },
  {
    "file": "sw_comsol_em_bcs.rs",
    "module": "sw-comsol-em-bcs",
    "summary": "Adds a passive user-defined complex surface impedance path that computes polarization-specific reflection and absorptance from resistance and reactance.",
    "selector": "bc=impedance with surfaceResistance (ohms) and optional surfaceReactance (ohms); mutually exclusive with surfaceImpedanceZ and frequency/conductivity inputs.",
    "input": {
      "module": "sw-comsol-em-bcs",
      "bc": "impedance",
      "surfaceResistance": 75.3460627334,
      "surfaceReactance": 37.6730313667,
      "polarization": "s",
      "thetaDeg": 0.0
    },
    "exampleName": "unique-comsol-em-bcs-complex-surface-impedance",
    "limitations": "Scalar local Leontovich reflection algebra at one incidence angle; passive isotropic impedance only. No mesh, field assembly, dispersive material model, anisotropic tensor impedance, or full COMSOL solver equivalence.",
    "testsWritten": [
      "impedance_explicit_complex_surface_law",
      "impedance_complex_surface_admission"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.4/doc/com.comsol.help.rf/RFModuleUsersGuide.pdf"
    ]
  },
  {
    "file": "sw_comsol_em_heating.rs",
    "module": "sw-comsol-em-heating",
    "summary": "Adds an optional convective Robin heat-loss boundary at the slab back face and verifies the FV profile against the corresponding analytical solution.",
    "selector": "hBack (W/m^2/K) with optional T_inf (K); hBack=0 preserves the adiabatic boundary.",
    "input": {
      "module": "sw-comsol-em-heating",
      "mode": "dielectric",
      "f": 1000000000.0,
      "epsR": 4.0,
      "lossTan": 0.01,
      "E0": 10.0,
      "k": 2.0,
      "L": 0.5,
      "T_0": 300.0,
      "hBack": 10.0,
      "T_inf": 280.0,
      "nz": 65
    },
    "exampleName": "unique-comsol-em-heating-convective-back-face",
    "limitations": "Steady one-dimensional slab with constant conductivity and exponential EM source; no transient heat-up, radiation, temperature-dependent properties, cavity resonance, or coil geometry. Host-f64 only.",
    "testsWritten": [
      "lossless_slab_with_back_convection_matches_linear_robin_solution",
      "convection_removes_heat_from_the_em_heated_slab",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_modeling.06.21.html"
    ]
  },
  {
    "file": "sw_comsol_emw_mie.rs",
    "module": "sw-comsol-emw-mie",
    "summary": "Added angle-resolved unpolarized differential scattering cross section and normalized efficiency from the existing sphere Mie amplitudes.",
    "selector": "method=differential-cross-section with radius+wavelength, refractiveIndex or m, and optional anglesDeg (up to 4096)",
    "input": {
      "module": "sw-comsol-emw-mie",
      "method": "differential-cross-section",
      "radius": 1e-06,
      "wavelength": 6.283185307179586e-06,
      "refractiveIndex": 1.5,
      "anglesDeg": [
        0,
        90,
        180
      ]
    },
    "exampleName": "unique-comsol-emw-mie-differential-cross-section",
    "limitations": "Exact homogeneous isotropic sphere Mie series only; dimensional output requires radius and wavelength; unpolarized far-field observable, not a mesh-based FEM field solve or a layered-particle model.",
    "testsWritten": [
      "differential_cross_section_has_rayleigh_angular_limit_and_units",
      "differential_cross_section_requires_dimensional_geometry"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.woptics/woptics_ug_optics.6.06.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.models.rf.rcs_sphere/rcs_sphere.html"
    ]
  },
  {
    "file": "sw_comsol_heat_fluids.rs",
    "module": "sw-comsol-heat-fluids",
    "summary": "Generalizes the external flat-plate mixed-flow average Nusselt correction to honor a caller-selected critical Reynolds number while preserving the conventional default at 5e5.",
    "selector": "quantity=external, body=flat-plate, regime=mixed, criticalRe",
    "input": {
      "module": "sw-comsol-heat-fluids",
      "quantity": "external",
      "body": "flat-plate",
      "Re": 600000.0,
      "L": 1.0,
      "Pr": 0.7,
      "k": 0.026,
      "regime": "mixed",
      "criticalRe": 200000.0
    },
    "exampleName": "unique-comsol-flat-plate-mixed-custom-transition",
    "limitations": "This is an algebraic host-f64 correlation with a sharp transition; it does not solve a boundary-layer or coupled flow-energy PDE and does not reproduce COMSOL's smoothed transition treatment. Fluid properties are caller-supplied scalars.",
    "testsWritten": [
      "external_flat_plate_mixed_transition_uses_custom_critical_reynolds",
      "external_flat_plate_local_position_must_be_on_plate"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_theory.07.098.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.models.heat.flat_plate_nitf_turbulent/flat_plate_nitf_turbulent.html"
    ]
  },
  {
    "file": "sw_comsol_flow_bc.rs",
    "module": "sw-comsol-flow-bc",
    "summary": "Adds a moving no-slip wall boundary that prescribes a finite 2D or 3D translational wall velocity as the fluid boundary velocity.",
    "selector": "bc=moving-wall with wallVelocity=[ux,uy] or [ux,uy,uz] in m/s",
    "input": {
      "module": "sw-comsol-flow-bc",
      "bc": "moving-wall",
      "wallVelocity": [
        0.4,
        0.0
      ]
    },
    "exampleName": "unique-comsol-flow-moving-wall",
    "limitations": "Host-f64 kinematic boundary evaluator only: models instantaneous translational no-slip velocity in the lab frame; it does not move a mesh, evolve wall position, or solve flow fields.",
    "testsWritten": [
      "moving_wall_prescribes_lab_frame_no_slip_velocity",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_single.06.030.html"
    ]
  },
  {
    "file": "sw_comsol_hartmann.rs",
    "module": "sw-comsol-hartmann",
    "summary": "Adds an open-circuit Hartmann channel solution that selects the uniform spanwise electric field for zero cross-section-integrated current and reports its effect on flow and centerline Lorentz force.",
    "selector": "electricalBoundary=openCircuit",
    "input": {
      "module": "sw-comsol-hartmann",
      "B0": 2.0,
      "a": 1.0,
      "sigma": 1.0,
      "mu": 1.0,
      "dpdx": -1.0,
      "electricalBoundary": "openCircuit"
    },
    "exampleName": "unique-comsol-hartmann-open-circuit-zero-net-current",
    "limitations": "Steady fully developed 1D channel with uniform material properties and a transverse uniform magnetic field. The open-circuit case imposes a uniform field to make integrated spanwise current zero; it does not resolve finite-conductivity walls, 3D return-current paths, entrance flow, turbulence, or transient induction. Host f64 only.",
    "testsWritten": [
      "open_circuit_enforces_zero_net_current",
      "open_circuit_zero_field_limit_matches_poiseuille",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.4/doc/com.comsol.help.models.acdc.hartmann_flow_in_liquid_metal_blanket/hartmann_flow_in_liquid_metal_blanket.html",
      "https://doc.comsol.com/6.4/doc/com.comsol.help.models.acdc.hartmann_boundary_layer/hartmann_boundary_layer.html"
    ]
  },
  {
    "file": "sw_comsol_heat_solids.rs",
    "module": "sw-comsol-heat-solids",
    "summary": "Adds per-interface area-specific thermal contact resistance to steady multilayer conduction, including local cylindrical/spherical interface areas and temperature jumps.",
    "selector": "quantity=steady with contactResistance containing one finite nonnegative m^2*K/W value per layer interface",
    "input": {
      "module": "sw-comsol-heat-solids",
      "quantity": "steady",
      "geometry": "plane",
      "layers": [
        {
          "thickness": 0.1,
          "conductivity": 1.0
        },
        {
          "thickness": 0.2,
          "conductivity": 0.5
        }
      ],
      "contactResistance": [
        0.2
      ],
      "area": 2.0,
      "T_hot": 100.0,
      "T_cold": 0.0
    },
    "exampleName": "unique-comsol-heat-solids-contact-interface",
    "limitations": "Host-f64 closed-form 1-D series network only. Contact resistance is a supplied constant area-specific value, not a COMSOL microscopic contact correlation or a multidimensional contact solve; no CUDA path.",
    "testsWritten": [
      "steady_plane_contact_resistance_creates_interface_temperature_jump",
      "contact_resistance_is_admitted_only_for_each_real_layer_interface"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_theory.07.090.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_interfaces.08.31.html"
    ]
  },
  {
    "file": "sw_comsol_induction_machine.rs",
    "module": "sw-comsol-induction-machine",
    "summary": "Adds a bounded bisection solve for the low-slip induction-machine operating point that balances a specified constant load torque, including the analytic synchronous no-load limit.",
    "selector": "quantity=load-match with loadTorque in N m",
    "input": {
      "module": "sw-comsol-induction-machine",
      "quantity": "load-match",
      "vPhase": 220.0,
      "frequency": 60.0,
      "poles": 4,
      "r1": 0.2,
      "x1": 0.4,
      "r2": 0.15,
      "x2": 0.4,
      "xm": 20.0,
      "loadTorque": 205.25214306218865
    },
    "exampleName": "unique-comsol-induction-machine-constant-load-equilibrium",
    "limitations": "Host-f64 lumped equivalent-circuit steady-state only; constant load torque and low-slip motoring branch, with no FEM field solve, inertia/startup, saturation, or generator operation.",
    "testsWritten": [
      "load_match_recovers_known_low_slip_equilibrium",
      "load_match_zero_load_is_synchronous_open_rotor_limit",
      "load_match_rejects_load_above_breakdown_torque"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.4/doc/com.comsol.help.models.llcreop.induction_motor_llcreop/induction_motor_llcreop.html"
    ]
  },
  {
    "file": "sw_comsol_joule_heating_b.rs",
    "module": "sw-comsol-joule-heating-b",
    "summary": "Adds a closed-form convective back-face thermal boundary to inductive slab heating with reported flux and energy balance.",
    "selector": "mode=inductive with h_back and optional T_ambient",
    "input": {
      "module": "sw-comsol-joule-heating-b",
      "mode": "inductive",
      "h_back": 10000.0,
      "T_surface": 300.0,
      "T_ambient": 290.0,
      "N": 101
    },
    "exampleName": "unique-comsol-joule-induction-convective-back-face",
    "limitations": "Host-f64 1-D skin-depth source in a constant-k slab; surface temperature is prescribed and only the back face can convect. No finite-length eddy-current, two-face convection, radiation, or transient solve.",
    "testsWritten": [
      "induction_convective_back_face_balances_power",
      "induction_zero_back_transfer_is_insulated_limit",
      "induction_admission_fail_closed"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_lagrange_line.rs",
    "module": "sw-comsol-lagrange-line",
    "summary": "Assembles an exact-quadrature 1D P1-P5 diffusion stiffness matrix for a positive diffusivity varying linearly between element endpoints.",
    "selector": "method=element with diffusivityLeft and diffusivityRight",
    "input": {
      "module": "sw-comsol-lagrange-line",
      "method": "element",
      "order": 2,
      "length": 2.0,
      "diffusivityLeft": 1.0,
      "diffusivityRight": 3.0
    },
    "exampleName": "unique-comsol-lagrange-line-affine-diffusivity",
    "limitations": "Single reference line element, host-f64 only; affine positive scalar diffusivity; no mesh assembly, boundary conditions, global solve, nonlinear coefficient, or material table.",
    "testsWritten": [
      "affine_diffusivity_matches_linear_element_analytic_integral",
      "affine_diffusivity_rejects_nonpositive_endpoint_and_overflow"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_equationbased.32.027.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_equationbased.32.014.html"
    ]
  },
  {
    "file": "sw_comsol_electric_currents.rs",
    "module": "sw-comsol-electric-currents",
    "summary": "Computes exact steady radial resistance for contiguous layered cylindrical or spherical conductors by summing each isotropic layer's series resistance.",
    "selector": "quantity=conductor with geometry=layered-radial-cylinder or layered-radial-sphere and layers array",
    "input": {
      "module": "sw-comsol-electric-currents",
      "quantity": "conductor",
      "geometry": "layered-radial-cylinder",
      "length": 0.1,
      "layers": [
        {
          "rInner": 0.001,
          "rOuter": 0.002,
          "conductivity": 58000000
        },
        {
          "rInner": 0.002,
          "rOuter": 0.003,
          "conductivity": 29000000
        }
      ]
    },
    "exampleName": "unique-comsol-layered-radial-conductor",
    "limitations": "Stationary closed-form 1-D radial conduction for 2 to 64 exactly contiguous concentric isotropic layers with perfect electrical contact; no FEM fields, anisotropy, contact resistance, temperature dependence, or AC skin effect. Reports host-f64 results only and rejects GPU requests.",
    "testsWritten": [
      "layered_radial_conductor_homogeneous_limit_and_material_series",
      "layered_radial_conductor_rejects_gaps_and_wrong_geometry"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.acdc/acdc_ug_electric_fields.07.087.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.acdc/acdc_ug_electric_fields.07.071.html"
    ]
  },
  {
    "file": "sw_comsol_les_wale.rs",
    "module": "sw-comsol-les-wale",
    "summary": "Adds bounded pooled Germano–Lilly least-squares calibration from caller-supplied homogeneous-region samples to dynamic Smagorinsky mode.",
    "selector": "model=dynamic-smagorinsky with germanoSamples (1–4096 paired L/M tensor objects) instead of pointwise L and M",
    "input": {
      "module": "sw-comsol-les-wale",
      "model": "dynamic-smagorinsky",
      "gradient": [
        [
          0,
          1,
          0
        ],
        [
          0,
          0,
          0
        ],
        [
          0,
          0,
          0
        ]
      ],
      "delta": 1,
      "cmax2": 1,
      "germanoSamples": [
        {
          "L": [
            [
              -0.1,
              0,
              0
            ],
            [
              0,
              -0.1,
              0
            ],
            [
              0,
              0,
              -0.1
            ]
          ],
          "M": [
            [
              1,
              0,
              0
            ],
            [
              0,
              1,
              0
            ],
            [
              0,
              0,
              1
            ]
          ]
        },
        {
          "L": [
            [
              -1,
              0,
              0
            ],
            [
              0,
              -1,
              0
            ],
            [
              0,
              0,
              -1
            ]
          ],
          "M": [
            [
              2,
              0,
              0
            ],
            [
              0,
              2,
              0
            ],
            [
              0,
              0,
              2
            ]
          ]
        }
      ]
    },
    "exampleName": "unique-comsol-les-germano-pooling",
    "limitations": "Host-f64 algebraic closure only. Samples are supplied by the caller and pooled equally by summing the Germano least-squares numerator and denominator; no spatial/test filtering, Lagrangian averaging, filtered Navier–Stokes solve, wall treatment, or GPU path is implemented.",
    "testsWritten": [
      "dynamic_smagorinsky_pools_germano_samples_by_least_squares_weight",
      "dynamic_germano_samples_reject_ambiguous_or_invalid_inputs"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_single.06.022.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_single.06.125.html"
    ]
  },
  {
    "file": "sw_comsol_les_smagorinsky.rs",
    "module": "sw-comsol-les-smagorinsky",
    "summary": "Derives van Driest wall damping y+ from caller-supplied wall distance, friction velocity, and molecular kinematic viscosity, with fail-closed input validation.",
    "selector": "wallDistance + frictionVelocity + nu (mutually exclusive with yPlus)",
    "input": {
      "module": "sw-comsol-les-smagorinsky",
      "gradient": [
        [
          0.0,
          1.0,
          0.0
        ],
        [
          0.0,
          0.0,
          0.0
        ],
        [
          0.0,
          0.0,
          0.0
        ]
      ],
      "cs": 0.17,
      "delta": 0.1,
      "nu": 1e-05,
      "wallDistance": 0.0005,
      "frictionVelocity": 0.5
    },
    "exampleName": "unique-comsol-les-smagorinsky-wall-units",
    "limitations": "Host-f64 algebraic closure only. Wall distance and friction velocity must be supplied by the caller; this module does not solve for either quantity or perform LES time stepping. The y+ derivation requires positive molecular nu and does not certify wall resolution.",
    "testsWritten": [
      "derives_wall_units_from_distance_friction_velocity_and_viscosity",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_single.06.106.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_single.06.125.html"
    ]
  },
  {
    "file": "sw_comsol_moisture_transport.rs",
    "module": "sw-comsol-moisture-transport",
    "summary": "Adds bounded inverse GAB/BET sorption to recover water activity from target moisture content with a checked forward residual.",
    "selector": "quantity=inverse-sorption; inputs wMonolayer, c, optional k/model, and targetMoistureContent (finite and nonnegative); activity is not accepted.",
    "input": {
      "module": "sw-comsol-moisture-transport",
      "quantity": "inverse-sorption",
      "wMonolayer": 0.06,
      "c": 10.0,
      "k": 0.8,
      "targetMoistureContent": 0.08695652173913043
    },
    "exampleName": "unique-comsol-moisture-inverse-sorption",
    "limitations": "Host-f64 closure only. Uses at most 80 bisection steps and rejects results above 1e-10 relative forward residual; finite-k=1 targets too close to the BET singularity may fail this tolerance. No transient moisture PDE, FEM, hysteresis, temperature-gradient coupling, condensation, or liquid transport.",
    "testsWritten": [
      "inverse_sorption_recovers_activity_and_dry_limit",
      "inverse_sorption_rejects_unreachable_or_invalid_targets"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_molecular_flow.rs",
    "module": "sw-comsol-molecular-flow",
    "summary": "Adds steady throughput and effective pumping speed for a long-tube molecular-flow path coupled in series to a finite-speed vacuum pump.",
    "selector": "method=pumping (aliases pump, effective-pumping-speed); requires pumpSpeed, pUpstream, and pDownstream",
    "input": {
      "module": "sw-comsol-molecular-flow",
      "method": "pumping",
      "T": 293.0,
      "molarMass": 0.0280134,
      "R": 0.05,
      "L": 0.5,
      "pumpSpeed": 0.1,
      "pUpstream": 2.0,
      "pDownstream": 0.5
    },
    "exampleName": "unique-comsol-molecular-flow-finite-pump",
    "limitations": "Host-f64 lumped steady estimate using the asymptotic long-tube conductance (L > 8R/3; accuracy needs L much larger than R), constant pump speed, and ideal-gas reservoir nodes; no geometry-resolved angular-flux transport, pump curve, or transient pump-down solve.",
    "testsWritten": [
      "pumping_finite_speed_couples_path_and_pressure_drop",
      "pumping_speed_limits_recover_the_limiting_resistance",
      "pumping_rejects_missing_or_reversed_reservoir_pressures"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.4/doc/com.comsol.help.models.molec.rotating_plate/rotating_plate.html",
      "https://doc.comsol.com/6.4/doc/com.comsol.help.molec/molec_ug_fluidflow_rarefied.6.32.html"
    ]
  },
  {
    "file": "sw_comsol_multiphase.rs",
    "module": "sw-comsol-multiphase",
    "summary": "Extends level-set curvature and continuum surface tension from 2D to full 3D Hessian geometry, including z-normal and z-force components.",
    "selector": "quantity=level-set with gradZ and phiXZ/phiYZ/phiZZ inputs",
    "input": {
      "module": "sw-comsol-multiphase",
      "quantity": "level-set",
      "phi": 0.0,
      "gradX": 1.0,
      "gradY": 0.0,
      "gradZ": 0.0,
      "phiXX": 0.0,
      "phiYY": 100.0,
      "phiZZ": 100.0,
      "epsilon": 0.0001,
      "sigma": 0.0728
    },
    "exampleName": "unique-comsol-multiphase-levelset-sphere-3d",
    "limitations": "Pointwise host-f64 level-set geometry and CSF evaluation only; supplied gradient/Hessian must describe a smooth signed-distance field. No transport, reinitialization, coupled flow solve, or CUDA implementation.",
    "testsWritten": [
      "level_set_sphere_uses_three_dimensional_mean_curvature",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.mfl/mfl_ug_fluidflow_multi.07.21.html"
    ]
  },
  {
    "file": "sw_comsol_surface_chemistry.rs",
    "module": "sw-comsol-surface-chemistry",
    "summary": "Adds multisite competitive Langmuir adsorption with integer species footprints, a bounded vacancy root solve, and separate molecule/site coverage outputs.",
    "selector": "quantity=multisite-langmuir with K, p, and siteOccupancy arrays",
    "input": {
      "module": "sw-comsol-surface-chemistry",
      "quantity": "multisite-langmuir",
      "K": [
        1.0,
        1.0
      ],
      "p": [
        1.0,
        1.0
      ],
      "siteOccupancy": [
        2,
        1
      ]
    },
    "exampleName": "unique-comsol-multisite-langmuir-competitive-adsorption",
    "limitations": "Host-f64 equilibrium mean-field isotherm only; at most 64 species, occupancy 1..=32 and dimensionless K*p <= 1e24 per species. Omits lateral interactions, distinct site types, surface transport and transient kinetics; no CUDA path.",
    "testsWritten": [
      "multisite_langmuir_single_species_analytical_occupancy_two",
      "multisite_langmuir_unit_footprints_reduce_to_langmuir",
      "multisite_langmuir_mixed_footprints_respect_site_balance",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.echem/echem_ug_chemsptrans.07.112.html"
    ]
  },
  {
    "file": "sw_comsol_nonlinear_material.rs",
    "module": "sw-comsol-nonlinear-material",
    "summary": "Adds a bounded traction-free uniaxial closure for compressible neo-Hookean material evaluation by solving the equal lateral stretch that makes both transverse Cauchy stresses zero.",
    "selector": "method=method-algo-hyperelastic with stretch and lateralCondition=traction-free",
    "input": {
      "module": "sw-comsol-nonlinear-material",
      "method": "method-algo-hyperelastic",
      "mu": 2.0,
      "lambda": 5.0,
      "stretch": 1.2,
      "lateralCondition": "traction-free"
    },
    "exampleName": "unique-comsol-neo-hookean-traction-free-uniaxial",
    "limitations": "Point evaluation of the compressible neo-Hookean law only; the new closure solves equal transverse stretches for a diagonal uniaxial state, not general finite-element boundary value problems or anisotropic material laws. Host-f64 only.",
    "testsWritten": [
      "hyperelastic_traction_free_lateral_stretch_satisfies_zero_transverse_stress",
      "hyperelastic_traction_free_unity_stretch_is_exactly_stress_free",
      "hyperelastic_traction_free_rejects_conflicts_and_invalid_conditions"
    ],
    "sourceUrls": [
      "https://www.comsol.com/comsol-multiphysics/model-builder",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_environment.18.39.html"
    ]
  },
  {
    "file": "sw_comsol_nernst_planck.rs",
    "module": "sw-comsol-nernst-planck",
    "summary": "Binary Maxwell-Stefan mode now computes both species fluxes under a prescribed total molar flux and reports their flux sum.",
    "selector": "quantity=maxwell-stefan, closure=total-molar-flux, totalMolarFlux=<mol/m^2/s>",
    "input": {
      "module": "sw-comsol-nernst-planck",
      "quantity": "maxwell-stefan",
      "D12": 0.5,
      "c": 3.0,
      "x1": 0.25,
      "gradX1": -2.0,
      "closure": "total-molar-flux",
      "totalMolarFlux": 10.0
    },
    "exampleName": "unique-comsol-nernst-planck-total-molar-flux",
    "limitations": "Host-f64 algebraic binary mixture closure with constant total molar concentration; no PDE, pressure or velocity solution, temperature/composition-dependent diffusivity, or multicomponent Maxwell-Stefan coupling.",
    "testsWritten": [
      "maxwell_stefan_prescribed_total_flux_satisfies_binary_relation",
      "maxwell_stefan_total_flux_closure_requires_explicit_value"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_chemsptrans.11.052.html"
    ]
  },
  {
    "file": "sw_comsol_nonnewtonian_b.rs",
    "module": "sw-comsol-nonnewtonian-b",
    "summary": "Plane-Couette profiles now accept all five existing inelastic viscosity models and report constitutive wall stress, apparent viscosity, and finite limiting behavior.",
    "selector": "flow=plane-couette with model=power-law (or another model already accepted by the viscosity method)",
    "input": {
      "module": "sw-comsol-nonnewtonian-b",
      "method": "method-algo-rheology-laminar-profile",
      "flow": "plane-couette",
      "gap": 2.0,
      "wallVelocity": 8.0,
      "model": "power-law",
      "K": 2.0,
      "n": 0.5,
      "samples": 5
    },
    "exampleName": "unique-comsol-nonnewtonian-b-couette-powerlaw-stress",
    "limitations": "Closed-form steady fully developed plane Couette simple shear with no pressure gradient; this does not solve general flow PDEs. Bingham and Herschel-Bulkley use this module's explicit Papanastasiou regularization. Host-f64 only.",
    "testsWritten": [
      "laminar_couette_powerlaw_uses_constitutive_stress",
      "laminar_couette_powerlaw_zero_speed_is_finite_limit",
      "laminar_couette_unknown_constitutive_model_rejected"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_single.06.082.html"
    ]
  },
  {
    "file": "sw_comsol_structural_bc.rs",
    "module": "sw-comsol-structural-bc",
    "summary": "Adds exact directional roller constraints over multiple displacement DOFs, preserving tangent motion and reporting constraint reactions.",
    "selector": "roller_constraints",
    "input": {
      "module": "sw-comsol-structural-bc",
      "dofs": 2,
      "stiffness": [
        [
          4.0,
          0.0
        ],
        [
          0.0,
          12.0
        ]
      ],
      "forces": [
        0.0,
        12.0
      ],
      "roller_constraints": [
        {
          "terms": [
            {
              "dof": 0,
              "coefficient": 1.0
            },
            {
              "dof": 1,
              "coefficient": 1.0
            }
          ]
        }
      ]
    },
    "exampleName": "unique-comsol-oblique-roller-normal",
    "limitations": "Host-f64 dense linear static system with at most 32 DOFs and 32 independent roller constraints. Normals are fixed algebraic vectors; this does not model finite sliding over curved geometry or assemble an FE mesh. Dependent constraints and inconsistent prescribed values fail closed.",
    "testsWritten": [
      "directional_roller_leaves_tangent_motion_free",
      "directional_roller_respects_prescribed_displacement",
      "directional_roller_rejects_invalid_or_dependent_constraints"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.sme/sme_ug_solid.07.065.html"
    ]
  },
  {
    "file": "sw_comsol_view_factors_b.rs",
    "module": "sw-comsol-view-factors-b",
    "summary": "Computes view factors for unequal laterally offset parallel rectangles with bounded midpoint quadrature, reciprocity, and optional blackbody exchange.",
    "selector": "configuration=offset-parallel-rectangles with a1,b1,a2,b2,c,offsetX,offsetY and optional quadratureOrder (4..=256)",
    "input": {
      "module": "sw-comsol-view-factors-b",
      "configuration": "offset-parallel-rectangles",
      "a1": 1.0,
      "b1": 1.0,
      "a2": 1.0,
      "b2": 1.0,
      "c": 1.0,
      "offsetX": 0.25,
      "offsetY": -0.1,
      "quadratureOrder": 64
    },
    "exampleName": "unique-comsol-offset-parallel-rectangle-view-factor",
    "limitations": "Host-f64 only. Midpoint integration is second-order and bounded to at most 256 squared samples; increase quadratureOrder to assess convergence. Supports only unobstructed mutually facing parallel rectangles and blackbody exchange, not arbitrary geometry, occlusion, grey radiosity, spectral behavior, or participating media.",
    "testsWritten": [
      "offset_parallel_rectangles_matches_aligned_limit_and_offset_symmetry",
      "offset_parallel_rectangles_admission_is_bounded_and_finite"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_interfaces.08.50.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_theory.07.056.html"
    ]
  },
  {
    "file": "sw_comsol_thermoelastic_3d.rs",
    "module": "sw-comsol-thermoelastic-3d",
    "summary": "Adds a host-f64 3-D orthotropic thermoelastic constitutive update with reciprocal compliance inversion, directional thermal strain, full stress output, and positive-definite material admission.",
    "selector": "method=orthotropic (or method-algo-comsol-thermoelastic-orthotropic-3d); provide E1/E2/E3, nu12/nu23/nu31, G12/G23/G31, optional three-entry alpha and six-entry eps.",
    "input": {
      "module": "sw-comsol-thermoelastic-3d",
      "method": "orthotropic",
      "E1": 135000000000.0,
      "E2": 10000000000.0,
      "E3": 10000000000.0,
      "nu12": 0.28,
      "nu23": 0.35,
      "nu31": 0.04,
      "G12": 5000000000.0,
      "G23": 3800000000.0,
      "G31": 5000000000.0,
      "alpha": [
        1e-06,
        2.5e-05,
        2.5e-05
      ],
      "Tref": 293.15,
      "T": 353.15,
      "eps": [
        0.0005,
        0.0002,
        0.0002,
        0.0001,
        0.0,
        0.0
      ]
    },
    "exampleName": "unique-comsol-orthotropic-thermoelastic-3d",
    "limitations": "Homogeneous small-strain linear orthotropic material-point response in material axes. No coordinate rotation, spatial temperature/stress gradients, mesh solve, nonlinear material behavior, or CUDA backend.",
    "testsWritten": [
      "orthotropic_isotropic_limit_matches_existing_constitutive_method",
      "orthotropic_directional_modulus_and_thermal_free_strain",
      "orthotropic_rejects_unstable_compliance_and_malformed_alpha"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.sme/sme_ug_theory.06.026.html"
    ]
  },
  {
    "file": "sw_comsol_param_sweep.rs",
    "module": "sw-comsol-param-sweep",
    "summary": "Adds an OAT sensitivity selector that reports least-squares response slopes, intercepts, and R-squared per parameter from supplied sweep samples.",
    "selector": "method=method-algo-param-sweep-sensitivity (or sensitivity) with sweepType=one-at-a-time, parameters, samples, and optional responseNames",
    "input": {
      "module": "sw-comsol-param-sweep",
      "method": "method-algo-param-sweep-sensitivity",
      "sweepType": "one-at-a-time",
      "parameters": [
        {
          "name": "x",
          "list": [
            1,
            2,
            4
          ]
        },
        {
          "name": "z",
          "list": [
            10,
            20
          ]
        }
      ],
      "samples": [
        [
          32,
          34,
          38,
          62
        ]
      ],
      "responseNames": [
        "y"
      ]
    },
    "exampleName": "unique-comsol-param-sweep-oat-response-sensitivity",
    "limitations": "Host-f64 postprocessing only. Requires a one-at-a-time design and at least two distinct levels per parameter; fits are descriptive linear regressions of supplied responses, not PDE derivatives, and do not measure parameter interactions or re-solve a model.",
    "testsWritten": [
      "sensitivity_fits_oat_linear_response_for_each_parameter",
      "sensitivity_rejects_non_oat_and_unidentifiable_parameters"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_peltier.rs",
    "module": "sw-comsol-peltier",
    "summary": "Computes the integrated COMSOL-sign Thomson source across Tc..Th from constant dAlpha and signed total current, alongside existing lumped Peltier/TEC outputs.",
    "selector": "dAlpha with module=sw-comsol-peltier; output integratedThomsonHeat",
    "input": {
      "module": "sw-comsol-peltier",
      "alpha": 0.0002,
      "R": 1.5,
      "K": 0.8,
      "Tc": 300,
      "Th": 340,
      "I": 2,
      "dAlpha": 1e-07
    },
    "exampleName": "unique-comsol-peltier-integrated-thomson-source",
    "limitations": "Host-f64 lumped single-leg algebra only. The Thomson integral assumes uniform 1-D total current and constant dAlpha over the interval; R and K remain temperature independent, and integratedThomsonHeat is reported separately from the constant-alpha endpoint TEC formulas. Not a coupled field solve.",
    "testsWritten": [
      "integrated_thomson_source_uses_temperature_interval_and_current_sign",
      "dalpha_sets_thomson_coefficient",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_theory.07.083.html"
    ]
  },
  {
    "file": "sw_comsol_pemfc.rs",
    "module": "sw-comsol-pemfc",
    "summary": "Species mode now closes ideal anode and cathode outlet molar flows from Faraday consumption, stoichiometric feed, and inert nitrogen balance.",
    "selector": "method=species; adds H2AnodeOutlet, O2CathodeOutlet, N2CathodeOutlet, cathodeDryOutlet, and H2OCathodeProduced outputs",
    "input": {
      "module": "sw-comsol-pemfc",
      "method": "species",
      "I": 100.0,
      "nCells": 1,
      "lambdaFuel": 1.2,
      "lambdaAir": 2.0,
      "airO2MoleFraction": 0.21
    },
    "exampleName": "unique-comsol-pemfc-species-outlets",
    "limitations": "Reduced-order ideal species balance; assumes no reactant crossover or purge and reports cathode water formation without a liquid/vapor split. It does not solve species transport PDEs or predict flow maldistribution.",
    "testsWritten": [
      "species_goldens",
      "species_outlets_close_at_stoichiometric_feed",
      "admission_fail_closed"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_piezo_constitutive.rs",
    "module": "sw-comsol-piezo-constitutive",
    "summary": "Added an all-components open-circuit mode that solves the transverse and poling-axis electric fields so D1, D2, and D3 close to zero under arbitrary 6mm stress.",
    "selector": "openCircuitMode=all-components",
    "input": {
      "module": "sw-comsol-piezo-constitutive",
      "T5": 2000000,
      "openCircuitMode": "all-components"
    },
    "exampleName": "unique-comsol-piezo-full-open-circuit-shear",
    "limitations": "Host-f64, single-point linear 6mm constitutive calculation with diagonal epsT; voltageVector assumes a uniform field across thickness. It does not solve structural equilibrium, spatial electrostatics, electrode/fringing fields, or frequency-dependent loss.",
    "testsWritten": [
      "all_components_open_circuit_closes_shear_generated_transverse_displacement",
      "open_circuit_mode_rejects_unknown_boundary_condition",
      "non_finite_derived_open_circuit_voltage_is_rejected"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.4/doc/com.comsol.help.sme/sme_ug_theory.06.043.html",
      "https://doc.comsol.com/6.4/doc/com.comsol.help.edis/edis_ug_acdc.7.30.html"
    ]
  },
  {
    "file": "sw_comsol_poroacoustics.rs",
    "module": "sw-comsol-poroacoustics",
    "summary": "Computes angle-dependent reflection and absorption for rigid-backed Delany-Bazley, Miki, and JCA layers using conserved tangential wavenumber.",
    "selector": "incidenceAngleDegrees (with thickness; 0 <= angle < 90)",
    "input": {
      "module": "sw-comsol-poroacoustics",
      "model": "delany-bazley",
      "sigma": 20000.0,
      "frequency": 500.0,
      "thickness": 0.05,
      "incidenceAngleDegrees": 45.0
    },
    "exampleName": "unique-comsol-poroacoustics-oblique-rigid-layer",
    "limitations": "Host-f64 plane-wave calculation for a homogeneous isotropic equivalent-fluid single layer backed by a rigid wall; it does not model FE fields, diffraction, anisotropy, or multilayers.",
    "testsWritten": [
      "oblique_layer_normal_limit_and_tangential_wavenumber",
      "oblique_layer_rejects_invalid_or_unbound_angles"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.models.aco.porous_absorber/porous_absorber.html",
      "https://doc.comsol.com/6.4/doc/com.comsol.help.aco/aco_ug_pressure.05.023.html"
    ]
  },
  {
    "file": "sw_comsol_porous_flow.rs",
    "module": "sw-comsol-porous-flow",
    "summary": "Darcy mode now accepts a finite symmetric positive-definite 2D or 3D permeability tensor and computes anisotropic flux plus mobility and hydraulic-conductivity tensors.",
    "selector": "quantity=darcy with permeabilityTensor instead of K",
    "input": {
      "module": "sw-comsol-porous-flow",
      "quantity": "darcy",
      "permeabilityTensor": [
        [
          4e-10,
          1e-10
        ],
        [
          1e-10,
          2e-10
        ]
      ],
      "mu": 0.001,
      "rho": 1000,
      "g": 9.80665,
      "gradP": [
        1000,
        0
      ],
      "porosity": 0.35
    },
    "exampleName": "unique-comsol-porous-anisotropic-darcy-tensor",
    "limitations": "This is a local algebraic Darcy closure only; the tensor must be constant for this evaluation and no spatial PDE, tensor-valued Darcy number, or CUDA backend is implemented.",
    "testsWritten": [
      "darcy_anisotropic_tensor_includes_cross_axis_flux",
      "diagonal_tensor_matches_scalar_darcy_limit",
      "anisotropic_darcy_rejects_non_spd_or_cuda_requests"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.4/doc/com.comsol.help.models.ssf.fractured_reservoir_flow/fractured_reservoir_flow.html",
      "https://www.comsol.com/comsol-multiphysics/model-builder"
    ]
  },
  {
    "file": "sw_comsol_porous_heat.rs",
    "module": "sw-comsol-porous-heat",
    "summary": "Layered shell mode now adds prescribed area-normalized contact resistances in series and reports the resulting heat-flow and interface temperature jumps.",
    "selector": "quantity=shell with interfaceResistances containing one finite nonnegative value per adjacent layer pair",
    "input": {
      "module": "sw-comsol-porous-heat",
      "quantity": "shell",
      "layers": [
        {
          "thickness": 1.0,
          "conductivity": 2.0,
          "density": 1000.0,
          "cp": 1000.0
        },
        {
          "thickness": 1.0,
          "conductivity": 4.0,
          "density": 1000.0,
          "cp": 1000.0
        }
      ],
      "interfaceResistances": [
        0.5
      ],
      "T_hot": 310.0,
      "T_cold": 300.0
    },
    "exampleName": "unique-comsol-porous-heat-shell-contact-resistance",
    "limitations": "The implementation is a host-f64 closed-form 1D layered conduction model with uniform temperature-independent contact resistance; it does not derive contact resistance from pressure or gap physics and is not a transient or multidimensional COMSOL solver.",
    "testsWritten": [
      "shell_contact_resistance_adds_series_drop",
      "shell_contact_resistance_admission_is_bounded_and_dimensioned"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_ht_features.09.093.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_ht_features.09.105.html"
    ]
  },
  {
    "file": "sw_comsol_pipe_flow.rs",
    "module": "sw-comsol-pipe-flow",
    "summary": "Adds circular-pipe laminar power-law rheology using the Metzner–Reed generalized Reynolds number, with fail-closed admission outside its supported domain.",
    "selector": "Per-edge powerLaw {consistencyIndex, flowBehaviorIndex}; output exposes rheology and generalizedReynolds.",
    "input": {
      "module": "sw-comsol-pipe-flow",
      "methodId": "method-algo-pipe-flow-1d",
      "rho": 998.2,
      "mu": 0.001002,
      "nodes": [
        {
          "id": "in",
          "head": 0.0001
        },
        {
          "id": "out",
          "head": 0.0
        }
      ],
      "edges": [
        {
          "id": "pipe",
          "from": "in",
          "to": "out",
          "length": 10.0,
          "diameter": 0.05,
          "powerLaw": {
            "consistencyIndex": 0.001002,
            "flowBehaviorIndex": 0.7
          }
        }
      ]
    },
    "exampleName": "unique-comsol-power-law-laminar-pipe",
    "limitations": "Host-f64 stationary incompressible single-phase network. Power-law edges use the circular-pipe Metzner–Reed laminar factor only and are rejected at Re_MR >= 2100; non-circular sections, rough-wall corrections, transition/turbulence, compressibility, transients, heat transfer, and two-phase flow remain unsupported.",
    "testsWritten": [
      "power_law_newtonian_limit_matches_existing_pipe_model",
      "shear_thinning_power_law_changes_flow_and_reports_generalized_reynolds",
      "power_law_rejects_bad_index_and_non_laminar_solution"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.models.pipe.slurry_transport/slurry_transport.html"
    ]
  },
  {
    "file": "sw_comsol_rans_models.rs",
    "module": "sw-comsol-rans-models",
    "summary": "Adds COMSOL-style standard k-epsilon inlet estimates from reference velocity, turbulence intensity, and turbulence length scale.",
    "selector": "method=method-algo-rans-inlet-values with referenceVelocity, turbulentIntensity, and turbulenceLengthScale",
    "input": {
      "module": "sw-comsol-rans-models",
      "method": "method-algo-rans-inlet-values",
      "referenceVelocity": 10.0,
      "turbulentIntensity": 0.05,
      "turbulenceLengthScale": 0.1
    },
    "exampleName": "unique-comsol-rans-standard-ke-inlet-values",
    "limitations": "Algebraic standard k-epsilon boundary estimate only, using Cmu=0.09; it does not create boundary fields or apply model-specific inlet laws for RNG, realizable, v2-f, or low-Re closures.",
    "testsWritten": [
      "inlet_values_standard_ke_golden_and_scaling",
      "inlet_values_reject_nonphysical_or_unbounded_results"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_single.06.118.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_single.06.011.html"
    ]
  },
  {
    "file": "sw_comsol_ray_trace.rs",
    "module": "sw-comsol-ray-trace",
    "summary": "Adds single-boundary Fresnel ray splitting with reflected and refracted directions plus s, p, or unpolarized power fractions for lossless dielectric interfaces.",
    "selector": "method=interface; optional polarization=s|p|unpolarized (defaults to unpolarized)",
    "input": {
      "module": "sw-comsol-ray-trace",
      "method": "interface",
      "n1": 1.0,
      "n2": 1.5,
      "dir": [
        0.6,
        0.0,
        -0.8
      ],
      "normal": [
        0.0,
        0.0,
        1.0
      ],
      "polarization": "unpolarized"
    },
    "exampleName": "unique-comsol-ray-trace-fresnel-interface",
    "limitations": "Host f64 only; one planar, lossless, nonmagnetic interface with real positive refractive indices. Uses incoherent power fractions and does not model phase, polarization transport, absorption, thin films, or geometry traversal.",
    "testsWritten": [
      "interface_normal_incidence_fresnel_power_is_conserved",
      "interface_brewster_angle_cancels_p_reflection",
      "interface_tir_has_unit_reflectance_and_no_transmission",
      "interface_rejects_unknown_polarization_and_foreign_use"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.roptics/roptics_ug_optics.6.64.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.roptics/roptics_ug_modeling.5.14.html"
    ]
  },
  {
    "file": "sw_comsol_charged_particle.rs",
    "module": "sw-comsol-charged-particle",
    "summary": "Adds an opt-in relativistic Boris momentum pusher with subluminal velocity recovery, Lorentz factors, and relativistic kinetic energy for one particle in uniform static fields.",
    "selector": "integrator=relativistic-boris; requires positive finite c in v0 units; default integrator=boris remains compatible",
    "input": {
      "module": "sw-comsol-charged-particle",
      "q": 1.0,
      "m": 1.0,
      "B": [
        0.0,
        0.0,
        0.0
      ],
      "E": [
        1.0,
        0.0,
        0.0
      ],
      "v0": [
        0.0,
        0.0,
        0.0
      ],
      "dt": 0.5,
      "steps": 2,
      "integrator": "relativistic-boris",
      "c": 2.0
    },
    "exampleName": "unique-comsol-relativistic-charged-particle-boris",
    "limitations": "Host f64 single-particle integration in uniform static fields. Position uses post-step velocity; analytic gyro summaries remain Newtonian. No field interpolation, collisions, radiation reaction, particle-particle interaction, or self-consistent space charge.",
    "testsWritten": [
      "relativistic_uniform_electric_field_matches_momentum_solution",
      "relativistic_magnetic_rotation_preserves_energy_and_speed",
      "relativistic_mode_rejects_invalid_or_unmapped_requests"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.particle/particle_ug_multiphysics.09.13.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.particle/particle_ug_acdc.07.02.html"
    ]
  },
  {
    "file": "sw_comsol_schrodinger_poisson.rs",
    "module": "sw-comsol-schrodinger-poisson",
    "summary": "Adds a node-wise relative-permittivity profile to Poisson and self-consistent updates, with harmonic face values that preserve dielectric displacement flux.",
    "selector": "method=poisson or selfconsistent with epsilon_r_profile (cells+1 positive finite values; mutually exclusive with epsilon_r)",
    "input": {
      "module": "sw-comsol-schrodinger-poisson",
      "method": "poisson",
      "length": 1e-08,
      "cells": 8,
      "phi_left": 0.0,
      "phi_right": 1.0,
      "charge_density": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0
      ],
      "epsilon_r_profile": [
        2.0,
        2.0,
        2.0,
        2.0,
        2.0,
        8.0,
        8.0,
        8.0,
        8.0
      ]
    },
    "exampleName": "unique-comsol-schrodinger-poisson-layered-dielectric",
    "limitations": "One-dimensional isotropic electrostatics with a node-sampled relative-permittivity profile and harmonic face interpolation; interfaces are grid-resolved, and polarization, explicit interface surface charge, anisotropy, and spatially varying effective mass are not modeled. Host-f64 only.",
    "testsWritten": [
      "poisson_layered_dielectric_matches_series_capacitor_limit",
      "dielectric_profile_admission_is_finite_sized_and_unambiguous"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.acdc/acdc_ug_theory.05.18.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_acdc.26.28.html"
    ]
  },
  {
    "file": "sw_comsol_semiconductor_driftdiffusion.rs",
    "module": "sw-comsol-semiconductor-driftdiffusion",
    "summary": "Adds an abrupt-junction depletion approximation under DC bias with depletion widths, peak field, charge, and junction capacitance.",
    "selector": "method=depletion-bias; supply n_i, n_a, n_d and optional bias_voltage, temperature, epsilon_r, area.",
    "input": {
      "module": "sw-comsol-semiconductor-driftdiffusion",
      "method": "depletion-bias",
      "n_i": 1e+16,
      "n_a": 1e+23,
      "n_d": 1e+22,
      "bias_voltage": -0.5,
      "area": 1e-08
    },
    "exampleName": "unique-comsol-semiconductor-depletion-bias-reverse-junction",
    "limitations": "Host-f64 quasi-static 1D abrupt-junction depletion approximation with uniform fully ionized dopants and Maxwell-Boltzmann built-in voltage; requires bias_voltage < built-in voltage and does not solve biased carrier continuity, recombination, breakdown, degeneracy, or multidimensional geometry.",
    "testsWritten": [
      "depletion_bias_zero_bias_matches_equilibrium_and_charge_balance",
      "depletion_bias_reverse_bias_follows_square_root_scaling",
      "depletion_bias_rejects_forward_bias_past_flat_band"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.semicond/semicond_ug_semiconductor.6.02.html"
    ]
  },
  {
    "file": "sw_comsol_sobol.rs",
    "module": "sw-comsol-sobol",
    "summary": "Adds deterministic independent Saltelli replicate batches and reports first- and total-order index standard errors with normal-approximation 95% intervals.",
    "selector": "replicates: integer 2..=64; n * replicates <= 2000000; backend host or auto",
    "input": {
      "module": "sw-comsol-sobol",
      "model": "ishigami",
      "n": 1024,
      "seed": 5,
      "a": 7.0,
      "b": 0.1,
      "replicates": 4,
      "backend": "host"
    },
    "exampleName": "unique-comsol-sobol-replicate-confidence-intervals",
    "limitations": "Only the Ishigami benchmark is supported. Replicate intervals use a normal approximation from between-batch variance and can be unreliable with few or highly skewed batches. Replicated intervals run on the host; explicit CUDA requests fail closed. The existing ok flag still gates the mean estimates against analytical Ishigami indices.",
    "testsWritten": [
      "replicate_batches_report_reproducible_confidence_intervals",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.uq/uq_ug_modeling.4.10.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.uq/uq_ug_modeling.4.13.html"
    ]
  },
  {
    "file": "sw_comsol_temp_property.rs",
    "module": "sw-comsol-temp-property",
    "summary": "Computes sensible enthalpy change by analytically integrating a tabulated nonnegative Cp(T) curve with linear or PCHIP interpolation.",
    "selector": "method-algo-enthalpy-from-cp; interpolation=linear|pchip; extrapolation=constant|linear",
    "input": {
      "module": "sw-comsol-temp-property",
      "method": "method-algo-enthalpy-from-cp",
      "temps": [
        300.0,
        400.0,
        500.0
      ],
      "values": [
        900.0,
        1000.0,
        1100.0
      ],
      "referenceTemperature": 300.0,
      "temperature": 450.0,
      "interpolation": "linear",
      "extrapolation": "constant"
    },
    "exampleName": "unique-comsol-temp-property-enthalpy-from-cp",
    "limitations": "Host-f64 only. Assumes positive absolute temperature, nonnegative specific heat capacity, fixed composition, and constant-pressure temperature-only sensible enthalpy; pressure work, phase changes, and density/composition coupling are not modeled. Table size is capped at 100000 nodes.",
    "testsWritten": [
      "enthalpy_from_constant_cp_is_exact_and_signed",
      "enthalpy_pchip_integral_is_exact_for_symmetric_table",
      "enthalpy_admission_rejects_negative_capacity_and_bad_interpolation"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_theory.07.003.html"
    ]
  },
  {
    "file": "sw_comsol_thermal_bc.rs",
    "module": "sw-comsol-thermal-bc",
    "summary": "Adds a fail-closed surface-to-ambient gray-radiation boundary that computes outward heat flux and area-integrated power from emissivity and absolute temperatures.",
    "selector": "bc=radiation (aliases: surface-radiation, surface-to-ambient-radiation); requires surfaceTemperature and ambientTemperature in K plus emissivity in [0,1].",
    "input": {
      "module": "sw-comsol-thermal-bc",
      "bc": "radiation",
      "surfaceTemperature": 400.0,
      "ambientTemperature": 300.0,
      "emissivity": 0.8,
      "area": 0.25
    },
    "exampleName": "unique-comsol-thermal-boundary-surface-radiation",
    "limitations": "Host-f64 analytic single-surface-to-large-ambient gray radiation only; excludes view factors, surface-to-surface exchange, solar irradiation, and coupled convection. Radiation temperatures must be absolute kelvin.",
    "testsWritten": [
      "surface_radiation_matches_stefan_boltzmann_and_sign",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.heat/heat_ug_ht_features.09.088.html"
    ]
  },
  {
    "file": "sw_comsol_thermoviscous_acoustics_b.rs",
    "module": "sw-comsol-thermoviscous-acoustics-b",
    "summary": "The exact thermoviscous slit mode now supports an adiabatic wall that removes the thermal bulk-modulus boundary-layer correction while retaining no-slip viscous losses.",
    "selector": "method=slit with thermalWallCondition=adiabatic (isothermal remains the default)",
    "input": {
      "module": "sw-comsol-thermoviscous-acoustics-b",
      "method": "slit",
      "rho0": 1.2041,
      "c": 343.0,
      "mu": 1.825e-05,
      "pr": 0.71,
      "frequencyHz": 1000.0,
      "gamma": 1.4,
      "halfWidthH": 0.0001,
      "thermalWallCondition": "adiabatic"
    },
    "exampleName": "unique-comsol-thermoviscous-slit-adiabatic-wall",
    "limitations": "Host-f64 exact 1D parallel-plate slit model only; adiabatic walls suppress the wall thermal-layer term, while the no-slip viscous model remains. No field FEM, arbitrary geometry, transient solve, wall heat-transfer coupling, or CUDA path.",
    "testsWritten": [
      "slit_adiabatic_wall_removes_thermal_bulk_modulus_correction",
      "thermal_wall_condition_is_slit_only_and_fails_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.4/doc/com.comsol.help.aco/aco_ug_thermo.09.09.html"
    ]
  },
  {
    "file": "sw_comsol_tline_transient.rs",
    "module": "sw-comsol-tline-transient",
    "summary": "Adds finite rectangular source pulses by superposing the existing Bergeron step response and a delayed negative step, with samples on both edge lattices.",
    "selector": "pulseWidth (seconds; positive finite value selects a rectangular pulse, omission preserves step excitation)",
    "input": {
      "module": "sw-comsol-tline-transient",
      "z0": 50.0,
      "delay": 1e-09,
      "sourceVoltage": 1.0,
      "sourceResistance": 50.0,
      "loadResistance": 50.0,
      "pulseWidth": 2e-09,
      "bounces": 2
    },
    "exampleName": "unique-comsol-tline-finite-rectangular-pulse",
    "limitations": "Ideal lossless line with constant resistive/open/short termination only. Rectangular pulse uses linear superposition of two step solutions and reports the step-response steady-state metadata; no lossy line, dispersion, finite rise time, or arbitrary waveform support. Host f64 only.",
    "testsWritten": [
      "rectangular_pulse_superposes_step_edges",
      "pulse_width_must_be_positive_and_finite"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_comsol_topopt_simp.rs",
    "module": "sw-comsol-topopt-simp",
    "summary": "Adds eroded, nominal, and dilated Heaviside projections with volume fractions and projection-chain sensitivities for a bounded robust topology-design threshold offset.",
    "selector": "robustDelta",
    "input": {
      "module": "sw-comsol-topopt-simp",
      "grid": [
        1
      ],
      "density": [
        0.4
      ],
      "strainEnergy": [
        2.0
      ],
      "E0": 1.0,
      "Emin": 0.0,
      "penal": 2.0,
      "beta": 4.0,
      "eta": 0.5,
      "robustDelta": 0.1
    },
    "exampleName": "unique-comsol-topopt-simp-robust-projection",
    "limitations": "Deterministic 2D-grid mathematical postprocessing only; no FE state solve, optimizer, robust objective selection, or manufacturing analysis. The offset is a single scalar threshold perturbation and must be less than min(eta, 1-eta). The quadratic filter is bounded to 2048 elements. Host calculations use f64; existing explicit CUDA behavior remains limited to the filter stage.",
    "testsWritten": [
      "robust_three_field_projection_orders_and_limits",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.4/doc/com.comsol.help.opt/opt_ug_theory.5.23.html",
      "https://doc.comsol.com/6.4/doc/com.comsol.help.models.opt.mbb_beam_optimization/mbb_beam_optimization.html"
    ]
  },
  {
    "file": "sw_comsol_structural_elements_c.rs",
    "module": "sw-comsol-structural-elements-c",
    "summary": "Adds an optional consistent translational mass matrix for two-node 2D and 3D trusses from density, area, and element length.",
    "selector": "massMatrix=\"consistent\" with positive density; supported for truss2d/truss3d only",
    "input": {
      "module": "sw-comsol-structural-elements-c",
      "element": "truss2d",
      "nodes": [
        [
          0.0,
          0.0
        ],
        [
          3.0,
          4.0
        ]
      ],
      "E": 10.0,
      "A": 2.0,
      "density": 3.0,
      "massMatrix": "consistent"
    },
    "exampleName": "unique-comsol-truss-consistent-mass-matrix",
    "limitations": "Returns a local linear-truss translational mass matrix only; no global assembly, time/modal solver, rotary inertia, or mass matrices for beams, membranes, plates, or shells. Backend remains host-f64.",
    "testsWritten": [
      "truss_consistent_mass_matrix_matches_analytical_integral",
      "truss_consistent_mass_is_absent_without_explicit_request",
      "truss_consistent_mass_rejects_invalid_requests"
    ],
    "sourceUrls": [
      "https://doc.comsol.com/6.3/doc/com.comsol.help.sme/sme_ug_modeling.05.023.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.sme/sme_ug_modeling.05.025.html",
      "https://doc.comsol.com/6.3/doc/com.comsol.help.sme/sme_ug_modeling.05.004.html"
    ]
  }
]

/** Return a fresh submit payload, supplying the host backend when omitted. */
export function toComsolNativeCaseInput(
  example: ComsolNativeCase,
): ComsolNativeCaseInput {
  const input = { ...example.input }
  if (!Object.prototype.hasOwnProperty.call(input, 'backend')) {
    input.backend = 'host'
  }
  return input
}
