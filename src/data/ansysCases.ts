/** Curated W-Sim case examples mapped to Ansys product capabilities. These are not vendor project files or solver parity claims. */
export interface AnsysNativeCaseInput { module: string; [key: string]: unknown }

export interface AnsysNativeCase {
  file: string
  module: string
  product: string
  summary: string
  selector: string
  input: AnsysNativeCaseInput
  exampleName: string
  limitations: string
  testsWritten: string[]
  sourceUrls: string[]
}

export const ANSYS_NATIVE_CASES: readonly AnsysNativeCase[] = [
  {
    "file": "sw_ansys_adjoint.rs",
    "module": "sw-ansys-adjoint",
    "product": "Fluent",
    "summary": "Adds a quadratic least-squares observation objective J = 0.5||Cx-y||^2, derives its state gradient, solves the corresponding discrete adjoint, and checks sensitivities by finite differences.",
    "selector": "objectiveMatrix and objectiveTarget supplied together in place of g",
    "input": {
      "module": "sw-ansys-adjoint",
      "A": [
        [
          2,
          0
        ],
        [
          0,
          1
        ]
      ],
      "b": [
        2,
        1
      ],
      "objectiveMatrix": [
        [
          1,
          1
        ]
      ],
      "objectiveTarget": [
        1
      ],
      "dbdp": [
        [
          1,
          0
        ]
      ],
      "checkGradient": true
    },
    "exampleName": "unique-ansys-adjoint-least-squares-observation",
    "limitations": "Host-f64 linear primal system only; C and y are fixed with respect to design parameters. Does not assemble CFD residuals, evaluate force/drag, mesh geometry, or provide Fluent solver parity.",
    "testsWritten": [
      "observation_objective_golden_and_fd",
      "observation_objective_rejects_ambiguous_or_malformed_inputs"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_ansys_amg.rs",
    "module": "sw-ansys-amg",
    "product": "Fluent",
    "summary": "Adds fixed nonzero endpoint Dirichlet values to the 1D Poisson AMG solve by moving boundary contributions into the first and last interior RHS entries.",
    "selector": "leftBoundary and rightBoundary finite numbers, valid only with problem=poisson1d and solve methods",
    "input": {
      "module": "sw-ansys-amg",
      "problem": "poisson1d",
      "n": 3,
      "rhs": [
        0,
        0,
        0
      ],
      "leftBoundary": 2,
      "rightBoundary": 8,
      "tol": 1e-12
    },
    "exampleName": "unique-ansys-fluent-amg-poisson1d-dirichlet-boundaries",
    "limitations": "Host-f64 discrete 1D uniform h=1 Poisson system only; the added fields represent fixed endpoint values, not general Fluent boundary zones. CUDA requests remain unsupported.",
    "testsWritten": [
      "poisson1d_nonzero_dirichlet_boundaries_reproduce_linear_profile",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://ansys.synopsys.com/products/fluids/ansys-fluent"
    ]
  },
  {
    "file": "sw_ansys_bertotti_core_loss.rs",
    "module": "sw-ansys-bertotti-core-loss",
    "product": "Maxwell",
    "summary": "Computes classical thin-lamination eddy loss from a periodic, uniformly sampled scalar flux-density waveform using the mean squared piecewise-linear dB/dt.",
    "selector": "method: waveform-eddy with fluxDensitySamples, samplePeriod, conductivity, thickness, and density",
    "input": {
      "module": "sw-ansys-bertotti-core-loss",
      "method": "waveform-eddy",
      "fluxDensitySamples": [
        -1,
        0,
        1,
        0
      ],
      "samplePeriod": 0.0025,
      "conductivity": 2000000,
      "thickness": 0.0005,
      "density": 7650
    },
    "exampleName": "unique-ansys-bertotti-sampled-waveform-eddy",
    "limitations": "Host-f64 postprocessor for one periodic scalar B(t) cycle. Assumes uniform through-thickness flux in a thin lamination and piecewise-linear interpolation between uniformly spaced samples. Returns the classical eddy component only; it does not solve fields or model hysteresis, excess loss, rotating flux, DC bias, temperature dependence, or GSE/iGSE terms.",
    "testsWritten": [
      "sampled_waveform_classical_eddy_uses_periodic_piecewise_linear_slopes",
      "sampled_constant_flux_has_zero_classical_eddy_loss",
      "sampled_waveform_rejects_invalid_step_and_missing_material_property"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v242/en/Subsystems/Maxwell/Content/CoreLossforTransientSolvers.htm",
      "https://people.montefiore.uliege.be/geuzaine/ELEC0041/05magdynFDvsTD_nonlinear_forces.pdf"
    ]
  },
  {
    "file": "sw_ansys_cavitation.rs",
    "module": "sw-ansys-cavitation",
    "product": "Fluent",
    "summary": "Added independent Schnerr-Sauer evaporation and condensation source multipliers, preserving prior results with unit defaults and routing coefficient-bearing requests through host f64.",
    "selector": "Optional ssCProd and ssCDest finite nonnegative scalar or per-cell inputs; default 1.0. Explicit CUDA requests using either field are unsupported; auto selects host.",
    "input": {
      "module": "sw-ansys-cavitation",
      "model": "schnerr-sauer",
      "backend": "host",
      "p": [
        100,
        1900
      ],
      "pVapor": 1000,
      "rhoL": 1000,
      "rhoV": 1,
      "alpha": 0.5,
      "ssCProd": 2,
      "ssCDest": 0.25
    },
    "exampleName": "unique-ansys-fluent-cavitation-schnerr-sauer-branch-coefficients",
    "limitations": "Only scales the existing Schnerr-Sauer source on host f64; no solver, flow evolution, or matching CUDA coefficient implementation is added. Unit defaults preserve the module's established output.",
    "testsWritten": [
      "schnerr_sauer_branch_coefficients_scale_independently",
      "schnerr_sauer_coefficients_reject_negative_and_cuda_requests"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/flu_th/flu_th_sec_multiphase_cavitation.html"
    ]
  },
  {
    "file": "sw_ansys_cavity_q.rs",
    "module": "sw-ansys-cavity-q",
    "product": "HFSS",
    "summary": "Analytic TM010/TE011 pillbox cavity resonance and unloaded Q, with optional measured effective wall surface resistance at the predicted resonant frequency.",
    "selector": "surfaceResistance (Ohm) replaces the sigma-based classical skin-effect value; sigma and surfaceResistance cannot both be supplied.",
    "input": {
      "module": "sw-ansys-cavity-q",
      "radius": 0.05,
      "length": 0.1,
      "mode": "TM010",
      "surfaceResistance": 0.002,
      "lossTangent": 0.0001
    },
    "exampleName": "unique-ansys-hfss-cavity-q-measured-wall-loss",
    "limitations": "Host f64 analytical cylindrical cavity only, limited to TM010 and TE011. Supplied surface resistance is assumed valid at the computed resonance; no frequency-dispersion model, roughness, port radiation, mode coupling, or arbitrary-geometry FEM.",
    "testsWritten": [
      "measured_surface_resistance_replaces_conductivity_model",
      "admission_fail_closed"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_ansys_cht_interface.rs",
    "module": "sw-ansys-cht-interface",
    "product": "Fluent",
    "summary": "Layered 1D steady wall conduction accepts uniform volumetric heat generation per shell and reports the resulting boundary flux, shell flux jump, and analytical exit temperatures.",
    "selector": "method=shell-conduction with optional layers[].generation (W/m^3)",
    "input": {
      "module": "sw-ansys-cht-interface",
      "method": "shell-conduction",
      "T_a": 100,
      "T_b": 0,
      "layers": [
        {
          "thickness": 1,
          "kappa": 2,
          "generation": 10
        }
      ]
    },
    "exampleName": "unique-ansys-fluent-shell-uniform-generation",
    "limitations": "Host f64 analytical 1D steady conduction only; conductivity and volumetric generation are constant within each of at most 256 shells. No in-plane conduction, transient effects, radiation, or general multidimensional CHT solve.",
    "testsWritten": [
      "shell_conduction_uniform_generation_analytical",
      "shell_conduction_rejects_nonfinite_generation"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/flu_ug/flu_ug_sec_hxfer.html",
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/pdf/Ansys_Fluent_UDF_Manual.pdf"
    ]
  },
  {
    "file": "sw_ansys_conduction_acdc.rs",
    "module": "sw-ansys-conduction-acdc",
    "product": "Maxwell",
    "summary": "Adds finite real contact resistance at each interface in the 1D layered AC/DC conduction network, reporting the complex voltage jump and matching the closed-form series impedance.",
    "selector": "Layered method accepts interfaceResistance: an array of nonnegative area-specific contact resistances in ohm m^2, one per adjacent layer pair; omission or zero retains ideal contact.",
    "input": {
      "module": "sw-ansys-conduction-acdc",
      "method": "layered",
      "area": 2,
      "voltage": 6,
      "layers": [
        {
          "thickness": 1,
          "conductivity": 1
        },
        {
          "thickness": 1,
          "conductivity": 1
        }
      ],
      "interfaceResistance": [
        4
      ]
    },
    "exampleName": "unique-ansys-layered-contact-resistance",
    "limitations": "Host-f64 1D series network only. Interface resistance is purely real and uniform over the supplied cross-sectional area; it has no capacitive or inductive component. No 3D mesh or general Maxwell solver equivalence is claimed.",
    "testsWritten": [
      "layered_contact_resistance_adds_interface_drop",
      "layered_zero_contact_resistance_is_the_legacy_limit",
      "admission_fail_closed",
      "gpu_backend_unsupported"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v251/en/Subsystems/Maxwell/Content/Maxwell/AssigningaThinLayerBoundaryfora3DACConductionSolver.htm",
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v242/en/Subsystems/Maxwell/Content/2DDCConductionBoundaries.htm"
    ]
  },
  {
    "file": "sw_ansys_contact_mechanics.rs",
    "module": "sw-ansys-contact-mechanics",
    "product": "Mechanical",
    "summary": "Adds an optional elastic Hertz sphere/plane normal contact law. With normalLaw=hertz and frictionless contact, normal force is (4/3) effectiveModulus * sqrt(effectiveRadius) * penetration^(3/2), with finite force admission checks. Existing linear penalty behavior remains the default.",
    "selector": "normalLaw=hertz, effectiveModulus, effectiveRadius; contactType must be frictionless",
    "input": {
      "module": "sw-ansys-contact-mechanics",
      "normalLaw": "hertz",
      "contactType": "frictionless",
      "effectiveModulus": 1000000,
      "effectiveRadius": 0.01,
      "kn": 1000,
      "displacements": [
        [
          0,
          -0.0001,
          0
        ]
      ]
    },
    "exampleName": "unique-ansys-mechanical-hertz-contact",
    "limitations": "Local elastic Hertz sphere/rigid-plane normal force only; effectiveModulus is the reduced elastic modulus and effectiveRadius is the effective curvature radius. Requires frictionless contact. No pressure field, contact search, FE assembly/equilibrium, damping, plasticity, or GPU implementation. kn remains required by the existing contact input contract but is unused by the Hertz normal law.",
    "testsWritten": [
      "hertz_sphere_plane_normal_force_matches_analytical_value",
      "hertz_law_rejects_nonfrictionless_and_invalid_geometry"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/motion_pre/motion_pre_troubleshooting_stifness_penetration.html"
    ]
  },
  {
    "file": "sw_ansys_convection_scheme.rs",
    "module": "sw-ansys-convection-scheme",
    "product": "Fluent",
    "summary": "Adds the classical uniform-grid Koren third-order TVD limiter for MUSCL face reconstruction and limiter-map evaluation.",
    "selector": "limiter=koren with scheme=muscl or operation=limiter; host-f64 only",
    "input": {
      "module": "sw-ansys-convection-scheme",
      "scheme": "muscl",
      "limiter": "koren",
      "values": [
        0,
        1,
        2,
        3
      ],
      "velocity": 1,
      "backend": "host"
    },
    "exampleName": "unique-ansys-fluent-koren-muscl-limiter",
    "limitations": "Clean-room classical uniform-grid flux limiter psi=max(0,min(2r,(1+2r)/3,2)); no variable-grid correction, multidimensional gradient reconstruction, bit-exact Fluent parity, or CUDA support. Explicit CUDA requests fail closed; auto selects host for Koren.",
    "testsWritten": [
      "koren_limiter_matches_third_order_formula_and_linear_face",
      "limiter_tvd_bounds_hold",
      "koren_is_rejected_by_explicit_cuda_backend"
    ],
    "sourceUrls": [
      "https://www.sciencedirect.com/science/article/pii/S0168927400000568"
    ]
  },
  {
    "file": "sw_ansys_creep_garofalo.rs",
    "module": "sw-ansys-creep-garofalo",
    "product": "Mechanical",
    "summary": "Integrates generalized Garofalo creep strain exactly across a bounded piecewise-constant stress history, including zero-stress unload holds.",
    "selector": "method=method-load-history; fields A, B, n, stressSteps[{duration,stress}], optional strain0 and Q/R/T",
    "input": {
      "module": "sw-ansys-creep-garofalo",
      "method": "method-load-history",
      "A": 1,
      "B": 1,
      "n": 1,
      "strain0": 0,
      "stressSteps": [
        {
          "duration": 1,
          "stress": 1
        },
        {
          "duration": 2,
          "stress": 0
        }
      ]
    },
    "exampleName": "unique-ansys-mechanical-garofalo-stress-holds",
    "limitations": "Host f64 material-point response for prescribed piecewise-constant uniaxial stress holds at one fixed optional Arrhenius temperature; no load interpolation, multiaxial flow rule, element equilibrium, damage, or CUDA implementation.",
    "testsWritten": [
      "load_history_accumulates_hold_and_unload_steps",
      "load_history_rejects_invalid_steps_and_cuda"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/pdf/ANSYS_Mechanical_APDL_Material_Reference.pdf"
    ]
  },
  {
    "file": "sw_ansys_des_blending.rs",
    "module": "sw-ansys-des-blending",
    "product": "Fluent",
    "summary": "Adds a simplified SST-IDDES pointwise wall/grid blended length-scale closure alongside the existing DES, DDES and SBES calculations.",
    "selector": "method=iddes (aliases: improved-ddes, improved-delayed-des); SST inputs d, delta or deltas, k, omega; optional nuT, kappa, gradUMag or strainMag, cdes, cd1, cd2.",
    "input": {
      "module": "sw-ansys-des-blending",
      "method": "iddes",
      "model": "sst",
      "d": 0.1,
      "delta": 0.1,
      "k": 0.04,
      "omega": 10,
      "nuT": 1e-10,
      "gradUMag": 1
    },
    "exampleName": "unique-ansys-fluent-sst-iddes-wall-grid-length",
    "limitations": "Pointwise host-f64 simplified SST-IDDES length scale with the original elevation function set to zero and fixed C_DES default; not a turbulence transport solver. Non-SST models and explicit CUDA requests are unsupported.",
    "testsWritten": [
      "iddes_sst_simplified_length_golden",
      "iddes_rejects_unsupported_model_and_cuda"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/flu_th/flu_th_sec_iddes.html",
      "https://cfd.spb.ru/agarbaruk/doc/2012_Gritskevich-et-al._Development-of-DDES-and-IDDES-Formulations-for-the-k-w-Shear-Stress-Transport-Model.pdf"
    ]
  },
  {
    "file": "sw_ansys_dpm_eom.rs",
    "module": "sw-ansys-dpm-eom",
    "product": "Fluent",
    "summary": "Adds the Stokes-Cunningham drag law using molecular mean free path to correct instantaneous forces and trajectory relaxation for small spherical particles.",
    "selector": "dragLaw=stokes-cunningham with meanFreePath > 0",
    "input": {
      "module": "sw-ansys-dpm-eom",
      "rhoP": 1000,
      "rhoF": 1.225,
      "d": 1e-7,
      "mu": 0.0000181,
      "dragLaw": "stokes-cunningham",
      "meanFreePath": 6.6e-8
    },
    "exampleName": "unique-ansys-fluent-dpm-stokes-cunningham-slip-drag",
    "limitations": "Host f64 single-particle force and trajectory support; spherical particles only. Rejects meanFreePath/d >= 1 because the Cunningham correction is not intended for free-molecular flow. Does not provide Brownian forcing or claim full Fluent parity.",
    "testsWritten": [
      "stokes_cunningham_correction_golden",
      "stokes_cunningham_changes_trajectory",
      "stokes_cunningham_rejects_free_molecular_and_missing_mean_free_path"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/flu_th/x1-62400016.7.3.html"
    ]
  },
  {
    "file": "sw_ansys_eulerian_multiphase_b.rs",
    "module": "sw-ansys-eulerian-multiphase-b",
    "product": "Fluent",
    "summary": "Adds the host-f64 Gidaspow granular-energy conductivity closure, including Carnahan-Starling or Lun-Savage radial distribution selection.",
    "selector": "method-ansys-granular-conductivity; fields alphaS, rhoS, d, theta, optional e, g0Model, alphaSMax",
    "input": {
      "module": "sw-ansys-eulerian-multiphase-b",
      "method": "method-ansys-granular-conductivity",
      "alphaS": 0.2,
      "rhoS": 2500,
      "d": 0.001,
      "e": 0.7,
      "theta": 0.025,
      "g0Model": "lun-savage",
      "alphaSMax": 0.6
    },
    "exampleName": "unique-ansys-fluent-gidaspow-granular-conductivity",
    "limitations": "Computes one local algebraic Gidaspow coefficient in host f64; it does not solve the granular-temperature transport equation or claim Fluent-wide equivalence. CUDA/GPU requests fail closed.",
    "testsWritten": [
      "gidaspow_conductivity_has_dilute_limit_and_sqrt_theta_scaling",
      "gidaspow_conductivity_uses_requested_radial_distribution_model",
      "gidaspow_conductivity_rejects_invalid_temperature_and_cuda"
    ],
    "sourceUrls": [
      "https://www.afs.enea.it/project/neptunius/docs/fluent/html/th/node327.htm",
      "https://cpp.openfoam.org/dev/GidaspowConductivity_8C_source.html"
    ]
  },
  {
    "file": "sw_ansys_explicit_dynamics.rs",
    "module": "sw-ansys-explicit-dynamics",
    "product": "Ansys",
    "summary": "Adds a host-f64 1-D right-end outgoing-wave impedance dashpot with rho*A*c_d force, separate boundary energy-loss reporting, and fail-closed rejection on CUDA.",
    "selector": "analysis.absorbingRight=true",
    "input": {
      "module": "sw-ansys-explicit-dynamics",
      "material": {
        "E": 2000000000,
        "rho": 1000
      },
      "analysis": {
        "type": "bar",
        "length": 1,
        "nElements": 1,
        "fixedLeft": true,
        "initialVelocity": [
          0,
          1
        ],
        "absorbingRight": true,
        "steps": 1
      }
    },
    "exampleName": "unique-ansys-explicit-dynamics-right-impedance-boundary",
    "limitations": "Approximate linear normal-incidence outgoing-wave boundary for a 1-D elastic bar; host-f64 only; no reflected-wave correction, nonlinear material, multi-D boundary, or CUDA implementation.",
    "testsWritten": [
      "right_impedance_boundary_absorbs_outgoing_rod_energy",
      "absorbing_right_must_be_boolean"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/exd_ag/ds_impedance_boundary.html"
    ]
  },
  {
    "file": "sw_ansys_finite_array.rs",
    "module": "sw-ansys-finite-array",
    "product": "HFSS",
    "summary": "Finite-array S-matrix mode now reports per-element incident and outgoing wave power plus aggregate net power entering the multiport network for the selected complex excitations, rejecting non-finite derived power values.",
    "selector": "mode=finite with sMatrix and optional excitation; outputs element[].incidentPower, element[].outgoingPower, element[].netPortPower, totalIncidentPower, totalOutgoingPower, netPowerIntoNetwork, and netPowerFraction",
    "input": {
      "module": "sw-ansys-finite-array",
      "mode": "finite",
      "sMatrix": [
        [
          0.1,
          0.2
        ],
        [
          0.2,
          0.1
        ]
      ],
      "excitation": [
        1,
        1
      ]
    },
    "exampleName": "unique-ansys-hfss-finite-array-power-balance",
    "limitations": "Host-f64 post-processing of a caller-supplied linear N-port scattering matrix only; assumes real power-normalized modal waves. Net power into the modeled ports includes power coupled out through other ports and is not a loss-only or radiation-power estimate. No HFSS field solve, mesh, port-mode extraction, or CUDA backend is provided.",
    "testsWritten": [
      "finite_array_power_balance_includes_mutual_outgoing_waves",
      "finite_array_rejects_overflow_in_derived_wave_power"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v242/en/Subsystems/HFSS/Content/HFSS/SParameters.htm",
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v242/en/Subsystems/HFSS/Content/HFSS/AcceptedPower.htm"
    ]
  },
  {
    "file": "sw_ansys_finite_rate_eddy.rs",
    "module": "sw-ansys-finite-rate-eddy",
    "product": "Fluent",
    "summary": "Adds an optional signed fuel heating value and reports volumetric heat release or absorption from the blended finite-rate/eddy-dissipation fuel rate.",
    "selector": "heatOfCombustion (J/kg fuel; positive releases heat, negative absorbs heat)",
    "input": {
      "module": "sw-ansys-finite-rate-eddy",
      "temperature": 1000,
      "density": 1,
      "turbulentKineticEnergy": 1,
      "turbulentDissipationRate": 10,
      "stoichiometricRatio": 4,
      "fuel": {
        "name": "CH4",
        "massFraction": 0.05,
        "molarMass": 0.01604
      },
      "oxidizer": {
        "name": "O2",
        "massFraction": 0.2,
        "molarMass": 0.032
      },
      "arrhenius": {
        "preExponential": 1000000,
        "activationEnergy": 0
      },
      "heatOfCombustion": 25000000
    },
    "exampleName": "unique-ansys-fluent-finite-rate-eddy-heat-release",
    "limitations": "Cell-local host-f64 source estimate only. Heating value is caller-supplied in J/kg fuel; the module does not solve energy, species transport, or flow, and reports null heatReleaseRate if no value is supplied.",
    "testsWritten": [
      "heat_release_tracks_blended_fuel_rate_and_sign",
      "rejects_non_finite_energy_source"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/flu_th/flu_th_sec_volumetric.html",
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/flu_ug/flu_ug_fvdefs.html"
    ]
  },
  {
    "file": "sw_ansys_fluent_bc.rs",
    "module": "sw-ansys-fluent-bc",
    "product": "Fluent",
    "summary": "Computes prescribed-temperature wall heat flux from imposed load, external convection, and gray-surface radiation, with optional area-integrated heat rate.",
    "selector": "quantity=wall (aliases thermal-wall, wall-thermal, wall-heat-transfer); wallTemperature with optional heatFlux, heatTransferCoefficient+referenceTemperature, emissivity+radiationTemperature, and area.",
    "input": {
      "module": "sw-ansys-fluent-bc",
      "quantity": "wall",
      "wallTemperature": 300,
      "heatFlux": 100,
      "heatTransferCoefficient": 10,
      "referenceTemperature": 320,
      "emissivity": 0.8,
      "radiationTemperature": 400,
      "area": 2
    },
    "exampleName": "unique-ansys-fluent-wall-thermal-radiation-convection",
    "limitations": "Host-f64 algebraic boundary closure only. Requires a prescribed wall temperature; does not solve wall temperature, fluid/solid conduction, participating-medium radiation, mesh faces, or transient energy conservation. Positive heat flux is into the wall.",
    "testsWritten": [
      "wall_thermal_flux_combines_convection_radiation_and_imposed_load",
      "wall_thermal_radiation_has_blackbody_and_zero_emissivity_limits",
      "wall_thermal_rejects_incomplete_invalid_and_gpu_requests"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/flu_ug/flu_ug_bcs_sec_bound_cond.html"
    ]
  },
  {
    "file": "sw_ansys_fluent_do.rs",
    "module": "sw-ansys-fluent-do",
    "product": "Fluent",
    "summary": "Fluent-style gray discrete-ordinates slab radiation now accepts prescribed cell-centred medium temperatures, with local Planck emission and local divQr coupling across a one-dimensional thermal gradient.",
    "selector": "method=slab with T_cells: array of nCells finite non-negative kelvin values; omitted T_cells preserves uniform T_med behavior.",
    "input": {
      "module": "sw-ansys-fluent-do",
      "method": "slab",
      "kappa": 1,
      "scattering": 0,
      "L": 1,
      "T1": 0,
      "T2": 0,
      "T_cells": [
        1000,
        1000,
        0,
        0
      ],
      "nTheta": 4,
      "nPhi": 8,
      "nCells": 4
    },
    "exampleName": "unique-ansys-fluent-do-cell-temperature-gradient",
    "limitations": "Host-f64 one-dimensional gray DO slab only; temperatures are prescribed cell-centred values and the energy equation is not solved. Non-gray bands, anisotropic scattering, unstructured 3D meshes, and CUDA are unsupported.",
    "testsWritten": [
      "slab_cell_temperature_field_matches_uniform_limit_and_resolves_gradient",
      "slab_temperature_field_admission_is_strict"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/flu_th/flu_th_sec_mod_disco.html"
    ]
  },
  {
    "file": "sw_ansys_fluent_fvm.rs",
    "module": "sw-ansys-fluent-fvm",
    "product": "Fluent",
    "summary": "Adds explicit periodic wrapping for cell-centered Green-Gauss and least-squares gradients, divergence, and Laplacian on a uniform structured Cartesian grid.",
    "selector": "boundary=periodic (defaults to zero-gradient); periodic with explicit CUDA is unsupported and auto uses the host implementation.",
    "input": {
      "module": "sw-ansys-fluent-fvm",
      "boundary": "periodic",
      "grid": {
        "nx": 4,
        "ny": 1,
        "dx": 1
      },
      "field": [
        0,
        1,
        0,
        -1
      ],
      "vectorField": {
        "ux": [
          0,
          1,
          0,
          -1
        ]
      }
    },
    "exampleName": "unique-ansys-fluent-fvm-periodic-four-cell-stencil",
    "limitations": "Host-f64 only for periodic boundaries; uniform structured Cartesian grid with periodicity applied across each full axis. No mixed per-face boundaries, unstructured meshes, coupled flow solve, turbulence models, or SIMPLE/PISO iteration.",
    "testsWritten": [
      "periodic_wraps_gradient_laplacian_and_divergence",
      "periodic_boundary_rejects_gpu_and_unknown_modes"
    ],
    "sourceUrls": [
      "https://ansys.synopsys.com/products/fluids/ansys-fluent"
    ]
  },
  {
    "file": "sw_ansys_fluent_gradient.rs",
    "module": "sw-ansys-fluent-gradient",
    "product": "Fluent",
    "summary": "Adds an optional scalar Barth-Jespersen neighbor-centroid limiter that bounds the linear cell reconstruction by the cell and face-neighbor value range and reports limited gradients plus per-cell factors.",
    "selector": "limiter=barth-jespersen; omitting limiter or setting none preserves existing behavior. Uses host f64; explicit CUDA requests are rejected for the limited path and auto selects host.",
    "input": {
      "module": "sw-ansys-fluent-gradient",
      "method": "least-squares",
      "limiter": "barth-jespersen",
      "cells": [
        {
          "centroid": [
            0.5,
            0.5
          ],
          "volume": 1,
          "value": 1
        },
        {
          "centroid": [
            1.5,
            0.5
          ],
          "volume": 1,
          "value": 2
        },
        {
          "centroid": [
            0.5,
            1.5
          ],
          "volume": 1,
          "value": 2
        },
        {
          "centroid": [
            1.5,
            1.5
          ],
          "volume": 1,
          "value": 3
        }
      ],
      "faces": [
        {
          "owner": 0,
          "neighbour": 1,
          "area": [
            1,
            0
          ]
        },
        {
          "owner": 0,
          "neighbour": 2,
          "area": [
            0,
            1
          ]
        },
        {
          "owner": 1,
          "neighbour": 3,
          "area": [
            0,
            1
          ]
        },
        {
          "owner": 2,
          "neighbour": 3,
          "area": [
            1,
            0
          ]
        },
        {
          "owner": 0,
          "area": [
            -1,
            0
          ]
        },
        {
          "owner": 0,
          "area": [
            0,
            -1
          ]
        },
        {
          "owner": 1,
          "area": [
            1,
            0
          ]
        },
        {
          "owner": 1,
          "area": [
            0,
            -1
          ]
        },
        {
          "owner": 2,
          "area": [
            -1,
            0
          ]
        },
        {
          "owner": 2,
          "area": [
            0,
            1
          ]
        },
        {
          "owner": 3,
          "area": [
            1,
            0
          ]
        },
        {
          "owner": 3,
          "area": [
            0,
            1
          ]
        }
      ]
    },
    "exampleName": "unique-ansys-fluent-gradient-bounded-reconstruction",
    "limitations": "The limiter evaluates predictions at neighboring cell centroids because face centroids are absent from the input schema. This is not Fluent's cell-to-face, cell-to-node, multidimensional, or differentiable limiter. Host f64 only for limited output; CUDA remains available for existing un-limited requests.",
    "testsWritten": [
      "barth_jespersen_neighbor_centroid_limiter_clips_local_undershoot",
      "limiter_rejects_unknown_and_explicit_cuda"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/flu_th/flu_th_sec_grad_limit.html",
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/flu_ug/flu_ug_use_grad_limit.html"
    ]
  },
  {
    "file": "sw_ansys_fluent_inlet_outlet.rs",
    "module": "sw-ansys-fluent-inlet-outlet",
    "product": "Fluent",
    "summary": "Derives uniform inlet turbulent kinetic energy and dissipation rate from turbulence intensity, resolved inlet speed, and hydraulic diameter.",
    "selector": "turbulenceIntensity plus turbulenceHydraulicDiameter",
    "input": {
      "module": "sw-ansys-fluent-inlet-outlet",
      "quantity": "velocity-inlet",
      "rho": 1,
      "area": 1,
      "velocity": [
        -10,
        0,
        0
      ],
      "normal": [
        1,
        0,
        0
      ],
      "turbulenceIntensity": 0.05,
      "turbulenceHydraulicDiameter": 0.2
    },
    "exampleName": "unique-ansys-fluent-inlet-turbulence-intensity-hydraulic-diameter",
    "limitations": "Host-f64 algebraic boundary calculation only; uniform inlet k/epsilon closure, no turbulence transport, other turbulence specifications, transient flow solve, compressible mass-flow iteration, or CUDA path.",
    "testsWritten": [
      "inlet_turbulence_intensity_hydraulic_diameter_closure",
      "inlet_turbulence_zero_limit_and_bad_specification_rejected"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/flu_ug/flu_ug_bcs_sec_bound_cond.html",
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/flu_ug/flu_ug_sec_turb_setup_bcs.html"
    ]
  },
  {
    "file": "sw_ansys_fluent_porous.rs",
    "module": "sw-ansys-fluent-porous",
    "product": "Fluent",
    "summary": "Computes a rotated orthotropic Darcy–Forchheimer momentum source from three principal viscous and inertial resistance values and a 3D principal frame.",
    "selector": "quantity=orthotropic-momentum-source; viscousResistancePrincipal, inertialResistancePrincipal, direction1, direction2",
    "input": {
      "module": "sw-ansys-fluent-porous",
      "quantity": "orthotropic-momentum-source",
      "mu": 0.001,
      "rho": 1000,
      "velocity": [
        0.1,
        0.02,
        0
      ],
      "viscousResistancePrincipal": [
        1000000,
        5000000,
        10000000
      ],
      "inertialResistancePrincipal": [
        100,
        200,
        300
      ],
      "direction1": [
        0,
        1,
        0
      ],
      "direction2": [
        1,
        0,
        0
      ]
    },
    "exampleName": "unique-ansys-fluent-orthotropic-porous-source",
    "limitations": "Host f64 algebraic source only; 3D orthotropic diagonal resistance in a right-handed orthonormal principal frame, with direction2 orthogonalized against direction1. No off-diagonal resistance tensor, mesh integration, transient PDE, or CUDA implementation.",
    "testsWritten": [
      "orthotropic_isotropic_limit_matches_scalar_source",
      "orthotropic_rotated_frame_and_invalid_parallel_axes"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/views/secured/corp/v261/en/flu_ug/flu_ug_bcs_sec_cell_zones.html"
    ]
  },
  {
    "file": "sw_ansys_fluent_real_gas.rs",
    "module": "sw-ansys-fluent-real-gas",
    "product": "Fluent",
    "summary": "Adds a local Peng-Robinson Joule-Thomson coefficient and Cp for a mechanically stable selected state, derived from EOS derivatives.",
    "selector": "Peng-Robinson quantity; adds result.jouleThomsonCoefficient (K/Pa) and result.cp (J/(mol K)); null coefficient where local Cp/mechanical stability preconditions fail.",
    "input": {
      "module": "sw-ansys-fluent-real-gas",
      "quantity": "peng-robinson",
      "criticalTemperature": 304.1282,
      "criticalPressure": 7377300,
      "acentricFactor": 0.22394,
      "molecularWeight": 44.0095,
      "temperature": 300,
      "pressure": 101325,
      "specificHeat": 843
    },
    "exampleName": "unique-ansys-fluent-pr-joule-thomson-co2",
    "limitations": "Local single-component Peng-Robinson state derivative only; no finite throttling-path solution, phase-equilibrium flash, mixture model or transport model. Reports null at unstable/non-finite local derivative states. Host f64 only; CUDA requests remain unsupported.",
    "testsWritten": [
      "peng_robinson_joule_thomson_isenthalpic_derivative",
      "peng_robinson_co2_vapor_golden",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://trc.nist.gov/TDE/TDE_Help/eos-Peng-Robinson.htm",
      "https://webbook.nist.gov/chemistry/fluid/"
    ]
  },
  {
    "file": "sw_ansys_fluent_time_integration.rs",
    "module": "sw-ansys-fluent-time-integration",
    "product": "Fluent",
    "summary": "Adds optional local-error-controlled step doubling for linear BDF1 and Crank-Nicolson integration over the existing requested interval, with bounded steps and accepted/rejected step reporting.",
    "selector": "adaptive=true; adaptiveTol is a positive absolute-plus-relative scaled tolerance; method must be bdf1 or crank-nicolson",
    "input": {
      "module": "sw-ansys-fluent-time-integration",
      "method": "bdf1",
      "adaptive": true,
      "adaptiveTol": 0.00001,
      "lambda": 2,
      "dt": 0.5,
      "steps": 4
    },
    "exampleName": "unique-ansys-fluent-adaptive-bdf1-step-doubling",
    "limitations": "Linear autonomous dy/dt=A y+b only; host f64 dense systems with n<=32; BDF1 and Crank-Nicolson only. Error is estimated by step doubling with an infinity norm scaled by 1+||y||∞. This is not Fluent's mesh/CFL adaptive controller and does not model nonlinear solver convergence. At most 100000 attempted steps.",
    "testsWritten": [
      "adaptive_bdf1_step_doubling_reaches_analytic_decay",
      "adaptive_rejects_variable_step_bdf2_and_invalid_tolerance"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/flu_ug/flu_ug_sec_solve_calc_time.html"
    ]
  },
  {
    "file": "sw_ansys_fluent_udf_uds.rs",
    "module": "sw-ansys-fluent-udf-uds",
    "product": "Fluent",
    "summary": "Adds Fluent-style specified scalar-flux boundary conditions to steady and implicit-transient 1D UDS transport, alongside existing specified-value boundaries.",
    "selector": "method=steady|transient with optional westFlux/eastFlux (positive into domain); a supplied flux overrides phi0/phiL on that side.",
    "input": {
      "module": "sw-ansys-fluent-udf-uds",
      "method": "steady",
      "gamma": 1,
      "L": 1,
      "nCells": 8,
      "westFlux": 1,
      "phiL": 0
    },
    "exampleName": "unique-ansys-fluent-uds-specified-flux",
    "limitations": "Host-f64, 1D uniform Cartesian, unit-area boundaries with uniform specified flux only; does not implement spatial UDF profiles, coupled walls, unstructured 3D meshes, or compiled/interpreted C UDFs.",
    "testsWritten": [
      "steady_specified_west_flux_matches_linear_diffusion_profile",
      "transient_specified_fluxes_change_domain_inventory",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/flu_ug/flu_ug_sec_ug_uds.html"
    ]
  },
  {
    "file": "sw_ansys_fluent_wall_bc.rs",
    "module": "sw-ansys-fluent-wall-bc",
    "product": "Fluent",
    "summary": "Adds an implicit roughness-modified Fluent standard/scalable log wall law using equivalent sand-grain height, Cebeci-Bradshaw roughness regimes, and a bounded solve for friction velocity.",
    "selector": "Existing bc=standard-wall-function or bc=scalable-wall-function with optional roughnessHeight (m) and roughnessConstant (dimensionless; defaults to 0.5).",
    "input": {
      "module": "sw-ansys-fluent-wall-bc",
      "bc": "standard-wall-function",
      "k": 1,
      "y": 0.01,
      "rho": 1.2,
      "mu": 0.000018,
      "uTangential": 20,
      "roughnessHeight": 0.0001,
      "roughnessConstant": 0.5
    },
    "exampleName": "unique-ansys-fluent-transitional-rough-wall",
    "limitations": "One-face algebraic equilibrium log-layer closure for uniform equivalent sand-grain roughness. Roughness is supported only with standard/scalable wall functions and the standard law requires a log-layer cell. No rough geometry, roughness heat transfer, mesh assembly, or transient near-wall PDE is modeled; host-f64 only.",
    "testsWritten": [
      "rough_wall_function_transitional_shift_increases_shear",
      "rejects_roughness_on_unsupported_wall_function"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/flu_th/x1-5720008.164.html"
    ]
  },
  {
    "file": "sw_ansys_fracture_mechanics.rs",
    "module": "sw-ansys-fracture-mechanics",
    "product": "Mechanical",
    "summary": "Adds a thresholded Paris-regime fatigue crack-growth rate calculation from stress range, crack length, geometry factor, and material coefficients.",
    "selector": "method=paris; inputs stressRange, crackLength, parisC, parisExponent, optional geometryFactor and deltaKThreshold",
    "input": {
      "module": "sw-ansys-fracture-mechanics",
      "method": "paris",
      "stressRange": 2,
      "crackLength": 0.3183098861837907,
      "parisC": 0.5,
      "parisExponent": 2,
      "geometryFactor": 1,
      "deltaKThreshold": 0
    },
    "exampleName": "unique-ansys-fracture-paris-fatigue-rate",
    "limitations": "Instantaneous constant-amplitude Paris-regime rate only. User-supplied C units must match the stress and length units. Omits load-ratio, closure, environment, near-threshold correction beyond a hard cutoff, rapid-growth behavior, crack propagation, and fatigue-life integration; host f64 only.",
    "testsWritten": [
      "paris_rate_matches_power_law_and_threshold_limit",
      "paris_rejects_invalid_and_cuda_requests"
    ],
    "sourceUrls": [
      "https://ntrs.nasa.gov/api/citations/20170011700/downloads/20170011700.pdf?attachment=true"
    ]
  },
  {
    "file": "sw_ansys_fwh.rs",
    "module": "sw-ansys-fwh",
    "product": "Fluent",
    "summary": "Adds modified Farassat Formulation 1A loading pressure from source-time surface-normal variation (TDNV), with Doppler weighting and host-only execution.",
    "selector": "mode=modified1a (or tdnv); each panel accepts normalRate=[dnx/dt,dny/dt,dnz/dt]. The contribution is included in pressureLoadingFarField. backend=cuda is explicitly unsupported; backend=auto uses host.",
    "input": {
      "module": "sw-ansys-fwh",
      "mode": "modified1a",
      "observer": [
        1,
        0,
        0
      ],
      "c": 1,
      "rho0": 1,
      "panels": [
        {
          "pos": [
            0,
            0,
            0
          ],
          "area": 1,
          "pressure": 2,
          "normal": [
            0,
            1,
            0
          ],
          "normalRate": [
            1,
            0,
            0
          ]
        }
      ]
    },
    "exampleName": "unique-ansys-fluent-fwh-modified-1a-normal-variation",
    "limitations": "Impermeable-surface loading extension only; the added term is p*dot(normalRate,rhat)/(c*r*(1-M_r)^2). Callers supply retarded-time panel states and normal derivatives. No permeable-surface or quadrupole terms. Modified mode is host-only.",
    "testsWritten": [
      "modified_1a_normal_variation_loading_golden",
      "modified_1a_normal_variation_respects_doppler_factor",
      "modified_1a_cuda_request_fails_closed",
      "normal_rate_requires_finite_three_vector"
    ],
    "sourceUrls": [
      "https://arxiv.org/abs/2606.07081",
      "https://ntrs.nasa.gov/citations/20070010579"
    ]
  },
  {
    "file": "sw_ansys_gamma_re_theta.rs",
    "module": "sw-ansys-gamma-re-theta",
    "product": "Fluent",
    "summary": "Adds the Langtry–Menter Thwaites pressure-gradient factor for the natural transition-onset equilibrium estimate, with bounded lambdaTheta admission and explicit corrected outputs.",
    "selector": "Optional lambdaTheta in [-0.1, 0.1]; reports FPressureGradient and ReThetatEquilibrium, while preserving the Tu-only onset value and transported ReThetat.",
    "input": {
      "module": "sw-ansys-gamma-re-theta",
      "Tu": 1,
      "ReThetat": 1000,
      "lambdaTheta": 0.05
    },
    "exampleName": "unique-ansys-fluent-gamma-re-theta-pressure-gradient",
    "limitations": "Host-f64 local correlations only. lambdaTheta is caller-supplied; the implicit theta_t coupling, transport equations, coupled SST solve, and full CFD workflow are not implemented. CUDA requests and the separate k-kl-omega model remain unsupported.",
    "testsWritten": [
      "pressure_gradient_factor_golden",
      "pressure_gradient_correction_is_optional_and_local",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://tmbwg.github.io/turbmodels/langtrymenter_4eqn.html",
      "https://ansyshelp.ansys.com/public/views/secured/corp/v261/en/flu_th/flu_th_sec_turb_sst_add_eq.html"
    ]
  },
  {
    "file": "sw_ansys_harmonic_response.rs",
    "module": "sw-ansys-harmonic-response",
    "product": "Mechanical",
    "summary": "Computes mode-superposition harmonic response to a complex base-acceleration phasor using caller-supplied mass-normalized modal participation factors, alongside the existing nodal-force path.",
    "selector": "baseAcceleration (mutually exclusive with force) and modes[].participationFactor",
    "input": {
      "module": "sw-ansys-harmonic-response",
      "system": "modal",
      "modes": [
        {
          "frequencyRads": 2,
          "dampingRatio": 0.1,
          "shape": [
            1
          ],
          "participationFactor": 2
        }
      ],
      "baseAcceleration": {
        "re": 3,
        "im": 0
      },
      "freqs": [
        0
      ]
    },
    "exampleName": "unique-ansys-mechanical-harmonic-base-acceleration",
    "limitations": "Real mass-normalized modes only. The caller must supply finite modal participation factors Gamma=phi^T M r; the module does not derive them from a mass matrix. Computes relative modal displacement and omits support scoping, enforced-motion absolute response, full FE direct solution and rotating loads.",
    "testsWritten": [
      "modal_base_acceleration_static_limit",
      "base_acceleration_requires_participation_and_exclusive_excitation"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/wb_sim/ds_Acceleration.html",
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/ans_thry/thy_anproc7.html"
    ]
  },
  {
    "file": "sw_ansys_hyperelastic.rs",
    "module": "sw-ansys-hyperelastic",
    "product": "Mechanical",
    "summary": "Host-f64 Gent limited-stretch and Blatz-Ko compressible-foam material point responses, plus bounded calibration of Gent shear modulus and locking parameter from uniaxial PK1 observations.",
    "selector": "model=gent|blatz-ko; method=method-uniaxial|method-response|method-fit-uniaxial; calibration accepts observations plus optional jmMin/jmMax bounds",
    "input": {
      "module": "sw-ansys-hyperelastic",
      "model": "gent",
      "method": "method-fit-uniaxial",
      "observations": [
        {
          "stretch": 1.2,
          "firstPiolaStress": 0.9
        },
        {
          "stretch": 1.5,
          "firstPiolaStress": 1.8
        },
        {
          "stretch": 1.9,
          "firstPiolaStress": 3.7
        }
      ],
      "jmMin": 3,
      "jmMax": 30
    },
    "exampleName": "unique-ansys-mechanical-hyperelastic-gent-calibration",
    "limitations": "Host-f64 material point/calibration only; Gent fit requires at least three distinct uniaxial observations, positive fitted shear modulus, and finite user/default Jm bounds above every observed I1-3. Least squares is unweighted and supports no uncertainty model. No element assembly, equilibrium solve, temperature dependence, viscoelasticity, or CUDA path.",
    "testsWritten": [
      "gent_uniaxial_goldens",
      "gent_reduces_to_neo_hookean",
      "blatz_ko_uniaxial_goldens",
      "blatz_ko_response_goldens",
      "identity_is_stress_free",
      "response_stress_matches_energy_gradient",
      "admission_is_fail_closed",
      "gent_uniaxial_calibration_recovers_parameters",
      "gent_uniaxial_calibration_rejects_bad_domain_and_other_models"
    ],
    "sourceUrls": [
      "https://rct.kglmeridian.com/view/journals/rcat/69/1/article-p59.xml",
      "https://authors.library.caltech.edu/records/1yrya-20y92"
    ]
  },
  {
    "file": "sw_ansys_icepak.rs",
    "module": "sw-ansys-icepak",
    "product": "Icepak",
    "summary": "Adds a bounded host-f64 board thermal-network solve with a gray surface exchanging radiation against a reference temperature alongside convection, then reports the solved case temperature and radiative heat rate.",
    "selector": "method=board-network with emissivity and radiating_area; optional view_factor (default 1) and T_rad (default T_amb)",
    "input": {
      "module": "sw-ansys-icepak",
      "method": "board-network",
      "T_amb": 298.15,
      "P": 40,
      "R_jc": 0.5,
      "R_ch": 0.2,
      "R_ha": 2,
      "emissivity": 0.85,
      "radiating_area": 0.12,
      "view_factor": 0.9,
      "T_rad": 250
    },
    "exampleName": "unique-ansys-icepak-reference-radiation-board-network",
    "limitations": "Lumped steady-state case node, gray-surface radiation to one fixed reference temperature, and scalar view factor. It does not solve surface-to-surface radiosity, transient response, airflow, or full 3D conjugate heat transfer. Host-f64 only.",
    "testsWritten": [
      "board_reference_radiation_energy_balance",
      "board_zero_emissivity_recovers_convection_only_solution",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/ice_ug/ice_ug_sec_rad_mdling.html",
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/ice_ug/ice_ug_sec_theory_sur_rad_mdl.html"
    ]
  },
  {
    "file": "sw_ansys_kepsilon.rs",
    "module": "sw-ansys-kepsilon",
    "product": "Fluent",
    "summary": "Adds the opt-in Fluent k-epsilon production clip Pk=min(Pk_raw, clipFactor*rho*eps), applied consistently to k and epsilon production sources; defaults preserve the prior unclipped outputs.",
    "selector": "productionLimiter=true with optional positive productionClipFactor (default 10)",
    "input": {
      "module": "sw-ansys-kepsilon",
      "variant": "standard",
      "k": 1,
      "eps": 1,
      "rho": 1,
      "strainSq": 500,
      "productionLimiter": true
    },
    "exampleName": "unique-ansys-fluent-kepsilon-production-clip",
    "limitations": "Host-f64 local closure/source calculation only. No mesh, momentum or continuity solve, diffusion assembly, wall treatment, buoyancy, or CUDA implementation. Production clipping is opt-in; input invariants and diffusion residuals remain caller supplied.",
    "testsWritten": [
      "fluent_production_limiter_clips_k_and_epsilon_sources",
      "production_limiter_rejects_invalid_clip_factor_and_flag"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/flu_th/flu_th_sec_prod_limit_two_eq_mod.html",
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/flu_ug/flu_ug_sec_turb_setup_options.html"
    ]
  },
  {
    "file": "sw_ansys_les_sgs.rs",
    "module": "sw-ansys-les-sgs",
    "product": "Fluent",
    "summary": "Adds the pointwise Vreman LES SGS closure with Fluent's default Cv=0.072, reporting eddy/effective viscosity and deviatoric SGS stress alongside the existing LES closures.",
    "selector": "method=\"vreman\" (or method=\"all\"); optional cvreman>=0 and isotropic delta>0",
    "input": {
      "module": "sw-ansys-les-sgs",
      "method": "vreman",
      "gradient": [
        [
          1,
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
          0
        ]
      ],
      "delta": 1
    },
    "exampleName": "unique-ansys-fluent-vreman-diagonal-gradient",
    "limitations": "Pointwise host-f64 closure only. Uses one scalar isotropic filter width and the documented Vreman algebraic model; no mesh, wall-distance treatment, SGS transport, field filtering, or CUDA implementation is included.",
    "testsWritten": [
      "vreman_laminar_shear_and_diagonal_golden",
      "vreman_rejects_invalid_constant_and_cuda"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/fluent_beta_doc/section_erz_yrv_xxb.html",
      "https://www.vremanresearch.nl/Vreman-PF2004-subgridmodel.pdf"
    ]
  },
  {
    "file": "sw_ansys_magnetic_transient.rs",
    "module": "sw-ansys-magnetic-transient",
    "product": "Maxwell",
    "summary": "Semi-infinite conductor step response reports cumulative Joule energy per surface area by integrating J^2/sigma over depth and elapsed time.",
    "selector": "No new selector; semiInfinite output adds jouleLossPerArea (J/m^2).",
    "input": {
      "module": "sw-ansys-magnetic-transient",
      "method": "semiInfinite",
      "conductivity": 58000000,
      "permeability": 0.00000125663706212,
      "surfaceH": 12,
      "time": 0.0025
    },
    "exampleName": "unique-ansys-maxwell-semi-infinite-joule-loss",
    "limitations": "Closed form is for an ideal field step into a semi-infinite, linear, homogeneous, isotropic conductor with constant conductivity and permeability. It does not include hysteresis, core loss, temperature dependence, finite geometry, motion, circuits, or 3D FEM; host-f64 only.",
    "testsWritten": [
      "semi_infinite_joule_loss_matches_integrated_analytic_profile",
      "semi_infinite_joule_loss_rejects_non_finite_result"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v251/en/Subsystems/Maxwell/Content/Maxwell/Solvers.htm"
    ]
  },
  {
    "file": "sw_ansys_maxwell_em_thermal.rs",
    "module": "sw-ansys-maxwell-em-thermal",
    "product": "Maxwell",
    "summary": "Supports distinct positive- and negative-face convection coefficients in the analytic AC eddy-current plate loss and steady thermal coupling, including the exact heat-flux split and peak-temperature recovery.",
    "selector": "hPositive and hNegative (default to h)",
    "input": {
      "module": "sw-ansys-maxwell-em-thermal",
      "thickness": 0.001,
      "frequency": 100000,
      "field": 8000,
      "sigma": 58000000,
      "mur": 1,
      "k": 400,
      "hPositive": 40,
      "hNegative": 10,
      "ambient": 293.15
    },
    "exampleName": "unique-ansys-maxwell-asymmetric-face-convection",
    "limitations": "Steady analytic 1-D homogeneous isotropic infinite plate under transverse sinusoidal excitation; no arbitrary geometry, transient thermal storage, radiation, contact, hysteresis, excess core loss, proximity loss, or temperature-dependent k, permeability, or convection. Host f64 only.",
    "testsWritten": [
      "asymmetric_face_convection_splits_heat_and_preserves_energy_balance",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v251/en/Subsystems/Maxwell/Content/Maxwell/ImpedanceBoundary.htm",
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v242/en/Subsystems/Maxwell/Content/SettingCoreLossforTransientandEddyCurrentSolvers.htm"
    ]
  },
  {
    "file": "sw_ansys_maxwell_force.rs",
    "module": "sw-ansys-maxwell-force",
    "product": "Maxwell",
    "summary": "Integrates planar magnetic Maxwell-stress traction across non-uniform sampled fields using caller-supplied positive area weights.",
    "selector": "quantity=force-integral (aliases: integrated-force, stress-integral, surface-force); fields: samples[{bNormal,bTangential?,areaWeight}], optional muR; host-f64 only.",
    "input": {
      "module": "sw-ansys-maxwell-force",
      "quantity": "force-integral",
      "samples": [
        {
          "bNormal": 1,
          "bTangential": 0.5,
          "areaWeight": 0.00004
        },
        {
          "bNormal": 0.8,
          "bTangential": 0.2,
          "areaWeight": 0.00006
        }
      ]
    },
    "exampleName": "unique-ansys-maxwell-nonuniform-stress-force",
    "limitations": "Host-f64 post-processing only; no Maxwell field solve, mesh interpretation, nonlinear constitutive law, or CUDA path. Samples represent planar magnetic stress quadrature in SI units and are limited to 100000; caller owns quadrature accuracy and the uniform scalar muR assumption.",
    "testsWritten": [
      "force_integral_uniform_samples_matches_closed_form",
      "force_integral_resolves_nonuniform_sample_contributions",
      "force_integral_rejects_invalid_samples_and_cuda"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v261/en/Subsystems/Maxwell/Content/Maxwell/ForceDensityCalculationinMaxwell.htm"
    ]
  },
  {
    "file": "sw_ansys_mcrt_gray.rs",
    "module": "sw-ansys-mcrt-gray",
    "product": "Fluent",
    "summary": "Adds an analytic local radiative heating/cooling profile dq/dx (W/m^3) for the non-scattering isothermal gray slab, aligned with the existing flux profile; validates positive finite optical thickness, absorption coefficient, and thickness.",
    "selector": "module=sw-ansys-mcrt-gray; result.profileRadiativeSource, sampled at result.profileX; inputs use opticalThickness or positive kappa and L",
    "input": {
      "module": "sw-ansys-mcrt-gray",
      "kappa": 2,
      "L": 0.5,
      "mediumTemperature": 1000,
      "hotWallTemperature": 1200,
      "coldWallTemperature": 800,
      "nPhotons": 1000,
      "nProfile": 5,
      "seed": 7
    },
    "exampleName": "unique-ansys-fluent-gray-radiation-source-profile",
    "limitations": "Host f64 gray non-scattering isothermal 1-D slab with black walls. The source profile is analytic RTE divergence; scattering, reflective gray walls, spectral bands, coupled radiation-energy iteration, and 3-D geometry remain unsupported. Tests were written but not run per wave instructions.",
    "testsWritten": [
      "radiative_source_profile_matches_flux_divergence_and_equilibrium"
    ],
    "sourceUrls": [
      "https://ansys.synopsys.com/products/fluids/ansys-fluent"
    ]
  },
  {
    "file": "sw_ansys_modal.rs",
    "module": "sw-ansys-modal",
    "product": "Mechanical",
    "summary": "Adds single-point acceleration response-spectrum displacement estimates from computed modal participation, with SRSS or equal-damping CQC combination.",
    "selector": "responseSpectrum: { points: [[frequencyHz, acceleration], ...], dampingRatio?, combination?: 'srss'|'cqc' }",
    "input": {
      "module": "sw-ansys-modal",
      "stiffness": [
        [
          4
        ]
      ],
      "mass": [
        1
      ],
      "responseSpectrum": {
        "points": [
          [
            0.1,
            8
          ],
          [
            1,
            8
          ]
        ],
        "combination": "srss"
      }
    },
    "exampleName": "unique-ansys-mechanical-modal-response-spectrum-srss",
    "limitations": "Linear single-point base-excitation relative displacement only. Uses linearly interpolated acceleration ordinates with constant endpoint extrapolation; omits missing-mass correction, residual vectors, stresses, absolute acceleration, multiple support excitation, and time-history response. Selected rigid-body modes are rejected.",
    "testsWritten": [
      "response_spectrum_single_mode_analytic_displacement",
      "response_spectrum_rejects_unsorted_points_and_rigid_modes"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/wb_sim/ds_response_spectrum_analysis_type.html",
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/ans_cmd/Hlp_C_CQC.html"
    ]
  },
  {
    "file": "sw_ansys_mom_cylinder.rs",
    "module": "sw-ansys-mom-cylinder",
    "product": "HFSS",
    "summary": "Adds optional far-field echo-width pattern sampling from the solved pulse-basis cylinder current at requested observation angles, alongside exact Mie reference values.",
    "selector": "echoAngles: optional non-empty array of up to 64 finite degree values; result.echoPattern returns echoWidth and mieEchoWidth per angle.",
    "input": {
      "module": "sw-ansys-mom-cylinder",
      "ka": 1,
      "nSegments": 240,
      "echoAngles": [
        0,
        90,
        180
      ]
    },
    "exampleName": "unique-ansys-hfss-mom-cylinder-echo-pattern",
    "limitations": "Host-f64 2-D TM EFIE pulse-basis point matching for a PEC circular cylinder of normalized radius 1; echo width is a far-field integral of the solved current. It is not the 3-D RWG surface-integral HFSS-IE solver and has no CUDA backend.",
    "testsWritten": [
      "echo_angle_pattern_uses_far_field_sum_and_preserves_symmetry",
      "echo_angles_reject_empty_nonfinite_and_oversized_requests"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_ansys_mrf.rs",
    "module": "sw-ansys-mrf",
    "product": "Fluent",
    "summary": "Adds each point's conservative centrifugal specific potential, -0.5*|Omega|^2*r_perp^2, to the existing MRF kinematics and source terms.",
    "selector": "Unconditional output field points[].centrifugalPotentialPerMass (J/kg); existing method selectors remain unchanged.",
    "input": {
      "module": "sw-ansys-mrf",
      "axis": [
        0,
        0,
        1
      ],
      "omega": 60,
      "omegaUnit": "rpm",
      "points": [
        [
          0.5,
          0,
          0
        ],
        [
          0,
          0,
          2
        ]
      ]
    },
    "exampleName": "unique-ansys-mrf-centrifugal-potential",
    "limitations": "Host-f64 MRF point evaluation for one constant angular-velocity axis per call; potential is a derived conservative centrifugal field quantity and does not solve flow, pressure, or interface coupling. Non-finite potential is rejected. Sliding/dynamic mesh remains unsupported.",
    "testsWritten": [
      "centrifugal_golden",
      "centrifugal_potential_scales_with_speed_and_axis_radius",
      "rejects_non_finite_centrifugal_potential"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_ansys_optislang.rs",
    "module": "sw-ansys-optislang",
    "product": "optiSLang",
    "summary": "Optional plain Monte Carlo reliability estimate for an Ishigami response limit, including failure count, empirical probability, standard error, and bounded Wilson 95% interval.",
    "selector": "parameters.failureThreshold (strict response > threshold event); omitted to preserve the existing output shape.",
    "input": {
      "module": "sw-ansys-optislang",
      "nSamples": 512,
      "seed": 91,
      "failureThreshold": 0
    },
    "exampleName": "unique-ansys-optislang-ishigami-reliability-exceedance",
    "limitations": "Host f64 reliability estimate over the module's existing independent Uniform(-pi, pi) Ishigami inputs. This plain Monte Carlo estimator is inefficient for rare failures, does not support other limit-state models or distributions, and is not vendor-equivalence evidence. Explicit unsupported CUDA behavior remains fail-closed.",
    "testsWritten": [
      "reliability_limit_counts_strict_exceedances_and_is_repeatable",
      "reliability_zero_and_full_failure_limits_have_valid_intervals",
      "reliability_output_is_absent_without_a_limit",
      "admission_fail_closed"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/opti_ug/opti_ug_mote_carlo.html",
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/opti_ug/opti_ug_reliability_analysis.html"
    ]
  },
  {
    "file": "sw_ansys_pdf_flamelet.rs",
    "module": "sw-ansys-pdf-flamelet",
    "product": "Fluent",
    "summary": "Builds a presumed beta PDF from supplied scalar mean and variance, evaluates PDF samples, and integrates a caller-supplied piecewise-linear flamelet/FGM scalar table against that PDF.",
    "selector": "module=sw-ansys-pdf-flamelet; optional method=presumed-pdf|beta-pdf|flamelet|fgm; manifold=[{z|c,value|phi}]; pdfAt=[...]; backend=host|cpu|auto",
    "input": {
      "module": "sw-ansys-pdf-flamelet",
      "method": "presumed-pdf",
      "meanFraction": 0.5,
      "variance": 0.05,
      "pdfAt": [
        0.25,
        0.5,
        0.75
      ],
      "manifold": [
        {
          "z": 0,
          "value": 300
        },
        {
          "z": 0.5,
          "value": 1200
        },
        {
          "z": 1,
          "value": 1800
        }
      ]
    },
    "exampleName": "unique-ansys-fluent-presumed-pdf-flamelet-closure",
    "limitations": "Host-f64 local closure only. Requires a caller-provided scalar table on the full [0,1] support and supplied moments; piecewise-linear interpolation is integrated against a presumed beta PDF. Does not transport the PDF, solve flow or chemistry, generate flamelet tables, parse Fluent cases, or provide CUDA execution. Table and PDF query arrays are capped at 4096 samples each.",
    "testsWritten": [
      "uniform_beta_shape_golden",
      "beta22_moments_and_pdf_golden",
      "linear_manifold_integrates_to_mean",
      "uniform_piecewise_quadratic_golden",
      "beta22_piecewise_quadratic_golden",
      "uncovered_models_unsupported",
      "gpu_backend_unsupported",
      "admission_fail_closed",
      "caller_supplied_arrays_are_bounded"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/flu_th/flu_th.html",
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/flu_th/flu_th_uns_sec_pdf_details.html"
    ]
  },
  {
    "file": "sw_ansys_pm_demag.rs",
    "module": "sw-ansys-pm-demag",
    "product": "Maxwell",
    "summary": "Adds supplier-coefficient quadratic temperature scaling for permanent-magnet remanence and intrinsic coercivity before the existing load-line and recoil-demagnetization calculations; the knee field follows coercivity scaling.",
    "selector": "temperature, referenceTemperature, remanenceTempCoeff1, remanenceTempCoeff2, coercivityTempCoeff1, coercivityTempCoeff2",
    "input": {
      "module": "sw-ansys-pm-demag",
      "remanence": 1.2,
      "recoilPermeability": 1,
      "permeanceCoefficient": 1,
      "temperature": 80,
      "referenceTemperature": 20,
      "remanenceTempCoeff1": -0.001,
      "remanenceTempCoeff2": 0,
      "coercivityTempCoeff1": -0.002,
      "coercivityTempCoeff2": 0,
      "kneeField": -500000,
      "intrinsicCoercivity": 1000000
    },
    "exampleName": "unique-ansys-maxwell-pm-demag-temperature-scaling",
    "limitations": "Lumped host-f64 load-line/recoil model; requires supplier-fitted coefficients and does not solve a spatial field or coupled thermal problem. Recoil permeability is fixed. Quadratic factors must remain positive and finite; coefficient validity outside the supplier fit range is caller-owned. Explicit CUDA/GPU requests remain unsupported.",
    "testsWritten": [
      "temperature_scaling_analytical",
      "temperature_scaled_demagnetization_behavior",
      "rejects_incomplete_or_nonphysical_temperature_scaling"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/Maxwell/Content/Maxwell/TemperatureDependentNonlinearPermanentMagnets.htm"
    ]
  },
  {
    "file": "sw_ansys_proximity_loss.rs",
    "module": "sw-ansys-proximity-loss",
    "product": "Maxwell",
    "summary": "Computes low-frequency transverse-field eddy loss per length and total for an isolated round conductor, accepting field amplitude directly or deriving it from a neighbouring long-wire current.",
    "selector": "module=sw-ansys-proximity-loss; method/algo=proximity|transverse-field; externalField or neighbourCurrent+spacing; optional neighbourCount, radius, conductivity, frequency, permeability, length, backend.",
    "input": {
      "module": "sw-ansys-proximity-loss",
      "radius": 0.00025,
      "conductivity": 58000000,
      "frequency": 10000,
      "neighbourCurrent": 10,
      "spacing": 0.001
    },
    "exampleName": "unique-ansys-maxwell-round-wire-proximity-loss",
    "limitations": "Host-f64 only. Uniform-internal-field leading-order formula is admitted only for radius no greater than skin depth. Models one isolated long round conductor; exact Kelvin-function skin/proximity solutions, winding-layer and bundle interactions, and combined AC resistance are unsupported.",
    "testsWritten": [
      "rejects_foreign_module",
      "routes_module",
      "neighbour_field_golden",
      "proximity_loss_golden",
      "external_field_source",
      "frequency_squared_scaling",
      "radius_fourth_power_scaling",
      "neighbour_count_scales",
      "zero_field_zero_loss",
      "rejects_out_of_domain_and_bad_params",
      "rejects_unsupported_method_and_gpu",
      "rejects_non_finite_derived_resistance"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_ansys_pv_coupling.rs",
    "module": "sw-ansys-pv-coupling",
    "product": "Fluent",
    "summary": "Adds optional initial-residual-relative convergence stopping for the combined momentum and continuity residual, reporting relativeResidual and the selected convergence criterion while retaining absolute tol as the default.",
    "selector": "relativeTol (0, 1]; when provided, convergence uses R/R0 < relativeTol where R is the maximum momentum/continuity infinity-norm residual and R0 is its value at u0,p0.",
    "input": {
      "module": "sw-ansys-pv-coupling",
      "algorithm": "coupled",
      "A": [
        [
          2,
          0
        ],
        [
          0,
          2
        ]
      ],
      "B": [
        [
          -1,
          1
        ]
      ],
      "f": [
        1,
        0
      ],
      "g": [
        0
      ],
      "relativeTol": 0.000001
    },
    "exampleName": "unique-ansys-fluent-relative-pv-convergence",
    "limitations": "Host f64 dense linearized coupling only, bounded by the module's existing dimension limits. Relative residual is a module-level initial-guess ratio over combined momentum and continuity infinity norms, not Fluent's mesh-scaled/local residual implementation. A zero initial residual can only be reported as relative zero if the final residual is also zero; otherwise relativeResidual is null and relative convergence is not declared.",
    "testsWritten": [
      "relative_residual_criterion_uses_initial_residual_scale",
      "relative_residual_handles_zero_initial_defect_and_rejects_bad_threshold"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/flu_ug/flu_ug_ribbon_dialog.html"
    ]
  },
  {
    "file": "sw_ansys_report.rs",
    "module": "sw-ansys-report",
    "product": "Fluent",
    "summary": "Surface mass-weighted averages preserve signed weighting by default; massWeighting=\"absolute\" opts into absolute face mass flux for mixed inflow and backflow, while mass-flow totals remain signed.",
    "selector": "method=surface-reports; massWeighting=signed (default) | absolute; fields=surfaces[].{area,value,rho,normalVelocity}",
    "input": {
      "module": "sw-ansys-report",
      "method": "surface-reports",
      "surfaces": [
        {
          "name": "recirculating",
          "area": [
            1,
            1
          ],
          "value": [
            10,
            20
          ],
          "rho": [
            1,
            1
          ],
          "normalVelocity": [
            -2,
            2
          ]
        }
      ],
      "massWeighting": "absolute"
    },
    "exampleName": "unique-ansys-fluent-absolute-mass-average-counterflow",
    "limitations": "Computes report arithmetic from caller-supplied face values; does not read Fluent case/data files or construct mesh topology. Flux uses mdot=rho*normalVelocity*area; absolute weighting is opt-in, and Fluent bulk/phase field selection is outside this module.",
    "testsWritten": [
      "surface_mass_average_handles_local_backflow"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/flu_th/flu_th_sec_compute_surfint.html"
    ]
  },
  {
    "file": "sw_ansys_rigid_body.rs",
    "module": "sw-ansys-rigid-body",
    "product": "Fluent",
    "summary": "Adds constant anisotropic body-axis rotational damping torque to the Newton-Euler 6DOF angular equations, with passive energy decay for non-negative coefficients.",
    "selector": "rotationalDamping: non-negative scalar or [Cx,Cy,Cz] in N m s/rad",
    "input": {
      "module": "sw-ansys-rigid-body",
      "mass": 1,
      "inertia": [
        1,
        1,
        2
      ],
      "angularVelocity": [
        0,
        0,
        1
      ],
      "rotationalDamping": [
        0,
        0,
        1
      ],
      "dt": 0.001,
      "steps": 1000
    },
    "exampleName": "unique-ansys-fluent-rigid-body-rotational-damping",
    "limitations": "Host f64 only; constant diagonal damping in body axes, relative to zero angular velocity. Does not model coupled damping matrices, fluid-relative rotation, springs, constraints, or dynamic mesh coupling; this is not a Fluent parity claim.",
    "testsWritten": [
      "rotational_damping_principal_axis_analytic",
      "rotational_damping_rejects_negative_and_cuda_requests"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/flu_th/flu_th_sec_six_dof_theory.html",
      "https://ansyshelp.ansys.com/public/views/secured/corp/v251/en/motion_pre/Property_of_Bushing.html"
    ]
  },
  {
    "file": "sw_ansys_rocky_dem.rs",
    "module": "sw-ansys-rocky-dem",
    "product": "Rocky",
    "summary": "Hertz-Mindlin contact evaluation now accepts independent sphere densities, computes each sphere's mass and Rayleigh critical timestep, and reports the limiting particle while preserving rho as the fallback.",
    "selector": "rho1 and rho2 input fields; result mass1, mass2, rayleighDt1, rayleighDt2, and rayleighLimiter fields",
    "input": {
      "module": "sw-ansys-rocky-dem",
      "r1": 0.002,
      "r2": 0.001,
      "rho1": 2500,
      "rho2": 100000
    },
    "exampleName": "unique-ansys-rocky-heterogeneous-density-rayleigh-limit",
    "limitations": "Evaluates one quasi-static spherical contact with host f64 Hertz-Mindlin assumptions; it is not a transient or multi-particle DEM solver, and material densities are assumed uniform within each solid sphere.",
    "testsWritten": [
      "heterogeneous_densities_set_mass_and_rayleigh_limiter",
      "rejects_gpu_backend_for_host_only_contact",
      "rejects_bad_inputs"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_ansys_rsm.rs",
    "module": "sw-ansys-rsm",
    "product": "Fluent",
    "summary": "Reports ordered Reynolds-stress anisotropy eigenvalues and Banerjee barycentric componentality weights and coordinates for the existing LRR algebraic stress solve/evaluation.",
    "selector": "New output fields: anisotropyEigenvalues and barycentricAnisotropy (weights, coordinates, realizability-triangle membership).",
    "input": {
      "module": "sw-ansys-rsm",
      "velocityGradient": [
        [
          0,
          0,
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
      "k": 1,
      "epsilon": 1
    },
    "exampleName": "unique-ansys-rsm-barycentric-isotropic",
    "limitations": "Host-f64 local LRR algebraic closure only; not a 7-equation RSM transport solve. Barycentric values diagnose componentality and do not project non-realizable stresses. No CUDA backend.",
    "testsWritten": [
      "barycentric_map_reports_componentality_limits",
      "barycentric_map_rejects_invalid_supplied_stress",
      "isotropic_when_no_mean_gradient"
    ],
    "sourceUrls": [
      "https://www.sankhabanerjee.info/Presentation_of_anisotropy_properties_of.pdf"
    ]
  },
  {
    "file": "sw_ansys_s2s_radiation.rs",
    "module": "sw-ansys-s2s-radiation",
    "product": "Fluent",
    "summary": "Balances symmetric exchange areas to produce view factors that satisfy both unit row sums and area-weighted reciprocity; rejects infeasible closed matrices.",
    "selector": "mode=closure with enforceReciprocity=true; areas and viewFactors are required",
    "input": {
      "module": "sw-ansys-s2s-radiation",
      "mode": "closure",
      "areas": [
        1,
        2,
        3
      ],
      "enforceReciprocity": true,
      "viewFactors": [
        [
          0.4,
          0.3,
          0.3
        ],
        [
          0.1,
          0.6,
          0.3
        ],
        [
          0.2,
          0.2,
          0.6
        ]
      ]
    },
    "exampleName": "unique-ansys-fluent-s2s-reciprocal-closure",
    "limitations": "Balances a supplied finite nonnegative dense view-factor matrix; this does not compute geometry factors or radiosity. Infeasible or nonconvergent matrices are rejected. The module remains host-f64 for this closure mode.",
    "testsWritten": [
      "closure_balances_area_reciprocity_and_row_sums_together",
      "closure_rejects_infeasible_reciprocal_zero_diagonal_case"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/ans_thry/thy_heat1.html"
    ]
  },
  {
    "file": "sw_ansys_structural_fem.rs",
    "module": "sw-ansys-structural-fem",
    "product": "Mechanical",
    "summary": "Adds constant beam line loads in local axes, integrated into the global RHS with exact Euler-Bernoulli consistent nodal forces and included in beam end-force recovery.",
    "selector": "model.elements[].lineLoadLocal = [qx, qy, qz] in force per length, expressed along the beam local x/y/z axes; beam elements only.",
    "input": {
      "module": "sw-ansys-structural-fem",
      "model": {
        "nodes": [
          [
            0,
            0,
            0
          ],
          [
            2,
            0,
            0
          ]
        ],
        "elements": [
          {
            "type": "beam",
            "nodes": [
              0,
              1
            ],
            "area": 0.01,
            "iy": 0.00001,
            "iz": 0.000008,
            "j": 0.00002,
            "lineLoadLocal": [
              0,
              -500,
              0
            ]
          }
        ]
      },
      "material": {
        "youngModulus": 200000000000,
        "poissonRatio": 0.3
      },
      "supports": [
        {
          "node": 0,
          "dof": "ux"
        },
        {
          "node": 0,
          "dof": "uy"
        },
        {
          "node": 0,
          "dof": "uz"
        },
        {
          "node": 0,
          "dof": "rx"
        },
        {
          "node": 0,
          "dof": "ry"
        },
        {
          "node": 0,
          "dof": "rz"
        }
      ]
    },
    "exampleName": "unique-ansys-mechanical-beam-uniform-line-load",
    "limitations": "Constant load intensity only; load components are in element-local axes and only beam elements accept this field. Uses linear small-deflection Euler-Bernoulli beam theory; no shear deformation or varying line-load interpolation.",
    "testsWritten": [
      "beam_uniform_distributed_load_matches_cantilever_solution",
      "distributed_line_load_is_rejected_for_non_beam_elements"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_ansys_thermal_fem.rs",
    "module": "sw-ansys-thermal-fem",
    "product": "Mechanical",
    "summary": "Adds piecewise-constant isotropic conductivity per bar or triangle element while retaining scalar conductivity for uniform meshes; assembled FEM steady and theta-transient equations use each element's value.",
    "selector": "Use elementConductivity as a positive finite array with exactly one value per mesh.elements entry; omit conductivity when using the array. Existing conductivity scalar remains the uniform-material path.",
    "input": {
      "module": "sw-ansys-thermal-fem",
      "mesh": {
        "element": "bar",
        "nodes": [
          [
            0
          ],
          [
            1
          ],
          [
            2
          ]
        ],
        "elements": [
          [
            0,
            1
          ],
          [
            1,
            2
          ]
        ]
      },
      "elementConductivity": [
        1,
        3
      ],
      "dirichlet": [
        {
          "node": 0,
          "temperature": 100
        },
        {
          "node": 2,
          "temperature": 0
        }
      ]
    },
    "exampleName": "unique-ansys-mechanical-thermal-fem-layered-bar",
    "limitations": "Piecewise-constant isotropic conductivity only; density and specific heat remain uniform in transient runs. Supplied linear bar/triangle mesh only, host f64 only; does not model contact, anisotropy, temperature-dependent materials, radiation, phase change, or vendor-specific Mechanical behavior.",
    "testsWritten": [
      "layered_bar_uses_elementwise_conductivity",
      "admission_is_fail_closed"
    ],
    "sourceUrls": []
  },
  {
    "file": "sw_ansys_touchstone.rs",
    "module": "sw-ansys-touchstone",
    "product": "HFSS",
    "summary": "Exports 1- through 4-port HFSS network parameter sweeps as Touchstone v1 text, including standards-based row-wise 3/4-port matrices.",
    "selector": "ports=3 or ports=4 with sweep entries shaped as N×N matrices; 1/2-port inputs remain supported.",
    "input": {
      "module": "sw-ansys-touchstone",
      "ports": 3,
      "freqUnit": "GHZ",
      "param": "S",
      "format": "RI",
      "ref": 50,
      "freqs": [
        1000000000
      ],
      "sweep": [
        [
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
      ]
    },
    "exampleName": "unique-ansys-hfss-touchstone-3port",
    "limitations": "Host-f64 only; maximum four ports; supports S/Y/Z and RI/MA/DB only; a scalar reference impedance is used; 3/4-port matrices emit row-wise data lines; zero magnitudes are rejected in DB format.",
    "testsWritten": [
      "touchstone_3port_emits_rowwise_matrix_rows",
      "touchstone_rejects_matrix_shape_backend_and_oversize_ports"
    ],
    "sourceUrls": [
      "https://www.ibis.org/touchstone_ver2.1/touchstone_ver2_1.pdf"
    ]
  },
  {
    "file": "sw_ansys_twinbuilder.rs",
    "module": "sw-ansys-twinbuilder",
    "product": "Twin Builder",
    "summary": "Adds an analytic configurable zero-state first-order transfer-block response to a constant step input, parameterized by gain, time constant, amplitude, and observation time.",
    "selector": "method-ansys-twinbuilder-lag-response; lagGain, lagTimeConstant, stepAmplitude, observationTime",
    "input": {
      "module": "sw-ansys-twinbuilder",
      "method": "method-ansys-twinbuilder-lag-response",
      "lagGain": 3,
      "lagTimeConstant": 0.4,
      "stepAmplitude": 2,
      "observationTime": 0.4
    },
    "exampleName": "unique-ansys-twinbuilder-first-order-step",
    "limitations": "Analytic response of the zero-state first-order block G(s)=gain/(timeConstant*s+1) to a constant step only; it does not solve interconnected block diagrams or provide a CUDA path.",
    "testsWritten": [
      "configurable_first_order_transfer_step_response",
      "admission_fail_closed",
      "method_selector_validates"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v242/en/Subsystems/TwinBuilder/Subsystems/Basic%20Elements/Content/GS.htm",
      "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v242/en/Subsystems/TwinBuilder/Subsystems/Basic%20Elements/Content/ModelingwithBlockDiagrams.htm"
    ]
  },
  {
    "file": "sw_ansys_vof_surface_tension_b.rs",
    "module": "sw-ansys-vof-surface-tension-b",
    "product": "Fluent",
    "summary": "Adds a cell-centred linear temperature-dependent surface-tension law and the corresponding tangential CSF Marangoni force to the field-level VOF force mode.",
    "selector": "csf-force with temperature, referenceTemperature, and dSigmaDTemperature; CUDA is rejected for this extension and auto selects host.",
    "input": {
      "module": "sw-ansys-vof-surface-tension-b",
      "method": "csf-force",
      "nx": 2,
      "ny": 2,
      "sigma": 0.07,
      "volumeFraction": [
        0,
        1,
        0,
        1
      ],
      "temperature": [
        300,
        302,
        300,
        302
      ],
      "referenceTemperature": 300,
      "dSigmaDTemperature": 0.0001
    },
    "exampleName": "unique-ansys-fluent-vof-marangoni-temperature-force",
    "limitations": "Host-f64 only; requires a cell-centred temperature value per cell and a linear sigma(T) law. Does not solve temperature transport or implement a user-defined nonlinear law. Admission fails if any cell evaluates to non-positive surface tension. Grid derivatives use the module's existing Cartesian finite-difference stencil.",
    "testsWritten": [
      "linear_temperature_gradient_adds_tangential_marangoni_force",
      "rejects_temperature_law_with_nonpositive_surface_tension"
    ],
    "sourceUrls": [
      "https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/flu_th/flu_th_vof_surf_tens.html"
    ]
  }
]
