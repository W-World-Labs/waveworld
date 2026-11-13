# Public software inputs used by the offline CI corpus

This directory contains **42 cases, 123 case source files and 10 license files**
(408,795 upstream bytes) from maintainer repositories. The source files include
122 inputs/dictionaries/outputs and one upstream LAMMPS README. The manifest
`datasets` list also byte-pins the five bundled snapshots in `public/datasets`;
those files are reused, not duplicated. Files
such as `U`, `p` and `blockMeshDict` belong to one OpenFOAM case, not three cases.
`manifest.json` records each source repository, immutable commit, original URL,
SHA-256, size, license, physical assumptions and the check actually performed.
Downloaded files are unmodified source text; original notices are retained.

| Case family | Cases | Current CI check |
| --- | ---: | --- |
| Quantum ESPRESSO: silicon SCF, Gamma variant, succinic acid, CO relaxation, Ni spin SCF, As variable-cell relaxation | 6 | Input and license integrity only; pseudopotentials are not bundled |
| CP2K: H2, Ar, water geometry optimization, Li2/PBE in bohr, NO2/LSD | 5 | Input and license integrity only; basis/potential data are not bundled |
| OpenFOAM 8: icoFoam moving-lid cavity, interFoam dam break | 2 | **Both are executed**: the cavity's `transportProperties`, `blockMeshDict` and `U` are parsed and mapped to the W-Sim lid-cavity solver at the file's Re=10 (grid refinement checked). The dam break's parsed physics (water rho/nu, g, setFieldsDict column, tank bounds) drive the built-in 2D WCSPH solver for a bounded early-collapse window; asserted checks are physical invariants (non-increasing total energy, monotone surge front below the Ritter bound, tank containment) — not a VOF equivalence claim |
| OpenFOAM 12: cavity, planar Couette, planar Poiseuille, pitzDailySteady, shockTube | 5 | **Cavity, planar Couette, planar Poiseuille and shockTube are executed** through W-Sim runners or the built-in 1D Euler HLLC solver (Poiseuille/Couette vs analytic channel profiles; shockTube vs the exact Riemann solution; the Re=10000 k-epsilon RAS cavity as a bounded laminar surrogate — not a turbulence validation). pitzDaily remains dictionary integrity only |
| Frame3DD: Example A 2D truss with support settlement | 1 | **Executed**: `exA.3dd` is parsed, converted to SI and solved by the W-Sim beam2d FEM; nodal displacements and reactions are checked against the bundled upstream `exA.out` |
| CalculiX: `planestress.inp`, `planestrain.inp` + `planestrain2.inp` patches, `b31.inp` cantilever beam | 4 | **All are executed**: a fail-closed Abaqus-keyword subset interpreter parses the `.inp` inputs. Quadratic/linear quads run as CST triangles on the W-Sim structural solver (exact for these constant-strain patches; mid-side CLOADs fold 50/50 onto edge endpoints), and nodal displacements plus mean stress are checked against the bundled upstream `.dat.ref`. The 10-element B31 cantilever projects onto the beam2d Euler–Bernoulli element and is checked against the analytic cantilever field and the `b31.frd.ref` tip deflection (Timoshenko shear is documented, ~0.05% here) |
| MOOSE: `simple_diffusion.i`, `simple_transient_diffusion.i`, NAFEMS T3, CASL verification I.1 + I.4, ConvectiveHeatFluxBC hand-calc | 6 | **All are executed**: a fail-closed hit-syntax interpreter parses the GeneratedMesh(1D/2D)/Diffusion/CoefDiffusion/HeatConduction/TimeDerivative/HeatSource/DirichletBC/NeumannBC/FunctionDirichletBC/ConvectiveHeatFluxBC/CoupledConvectiveHeatFluxBC/ParsedFunction/Steady/Transient subset. The steady case runs on the 2-D conduction solver vs the analytic u=x profile; the transient case runs on the 1-D Crank–Nicolson solver vs the Fourier-series exact solution; NAFEMS T3 adds time-varying Dirichlet — verified vs the closed-form solution (T(0.08,32)=36.6) and the gold CSV; CASL I.1 runs with volumetricHeatWPerM3 and reproduces the upstream ∫\|u_h−u*\|dx convergence series; CASL I.4 adds a Neumann inflow + coupled-convective (Robin) outlet — the enclosure-cooling archetype — checked nodally vs the ParsedFunction exact solution (u(0)=1040) and energy balance; the convective-flux case reproduces the hand-calc surface T=150 and −500 W/m² gold flux |
| EnergyPlus: 1ZoneUncontrolled constructions | 1 | **Executed**: `Construction`/`Material`/`Material:NoMass` layers are parsed from the IDF and run as 1D steady conduction with film coefficients; each layer must reproduce its declared thermal resistance |
| LAMMPS: 2D LJ viscosity input and its saved state | 1 | Source integrity plus the existing 32-atom, **5-step NVE reference comparison** in `module-compute.test.ts` |
| LAMMPS: 3D melt input script | 1 | **Executed**: `in.melt` is read by a fail-closed input-script subset interpreter and run as 3D NVE FCC LJ on the shared WASM MD kernel; energy conservation and melting bands are asserted (the velocity RNG stream is ours, not LAMMPS's — no trajectory agreement is claimed) |
| LAMMPS: rigid bodies, triclinic FCC, Langevin thermal conduction, friction, molecular Poiseuille flow | 5 | Source integrity and explicit rejection by the current restricted 2D LJ data importer |
| Gaussian format: water MP2/HF PCM/CCSD(T), CO TD-PBE0, divinylbenzene Raman | 5 | Input and license integrity only; cclib-maintained BSD-3-Clause examples |

By software family this is **DFT 11, CFD 7, MD 7, Gaussian-format quantum
chemistry 5, structural 5, building-thermal 1 and MOOSE thermal 6**. These are
case counts, not
solver coverage percentages. Gaussian inputs include both DFT and non-DFT
methods, so they are listed separately.
There are **17 integrity-only cases, 5 expected rejections, 19 executed-solver
cases and 1 short numerical reference case**. Changing a manifest label or
removing a case cannot silently disable an existing rejection/reference check:
CI fixes those case IDs, input paths and reference paths in the test.

**Integrity-only and expected rejection are not solver compatibility passes.**
There is currently no QE, CP2K or Gaussian importer/solver behind these fixtures.
Gaussian software is proprietary and is not included. The cclib inputs are
reusable format examples, not a license to run Gaussian.
The existing LAMMPS check establishes short-trajectory agreement for the declared
2D, periodic, unit-mass, shifted-LJ subset; it does not validate viscosity or
general MD force fields. See `public/datasets/README.md` for its provenance.

**Executed-solver checks run the parsed upstream inputs through W-Sim solver
runners (or the built-in 1D Euler HLLC and 2D WCSPH solvers for the shock tube
and dam break) under matched physics** (`src/lib/sim/software-cases-exec.test.ts`).
No external solver binary is run: the Frame3DD check compares against the
upstream-published `exA.out`, the CalculiX checks compare against the bundled
upstream `planestress.dat.ref`/`planestrain.dat.ref`/`planestrain2.dat.ref`/
`b31.frd.ref`,
the MOOSE check compares against the analytic u=x field of the parsed
`simple_diffusion.i` case, the OpenFOAM checks compare
against the analytic
Poiseuille/Couette channel profiles, grid-refinement convergence, the exact
Riemann solution of the bundled shock-tube states and the dam-break physical
invariants, the LAMMPS melt check asserts NVE energy conservation and melting
bands for the interpreted `in.melt` script, and the EnergyPlus check compares
against each construction's declared R-value. The OpenFOAM-12 cavity
source case is Re=10000 with a k-epsilon RAS model; the executed check runs a
bounded laminar MRT surrogate and asserts finite, bounded output only — it is
not an equivalence claim against the turbulent reference. The planar Couette
source uses a Maxwell viscoelastic model; the check verifies the steady
velocity profile (identical under Newtonian shear), not normal stresses. The
dam-break check runs single-phase WCSPH for t≤0.25 s of the upstream 1 s
interFoam window; air and surface tension are not modeled.

OpenFOAM input sets retain external `#includeEtc` / `#includeFunc` directives and
dictionary substitutions as inert text. Some CP2K regression inputs deliberately
stop SCF early or exercise invalid diagnostic requests. A name such as “cavity”
or “water” does not establish shared physics, convergence or engineering accuracy.
The new dam-break and shock-tube cases retain `.orig` initial fields and require
mesh generation and field initialization before external execution. The molecular
Poiseuille example uses atomistic body forces and a loaded wall; it is not a
continuum pressure-inlet/outlet case. Gaussian `water_ccsdt.com` requests
**CCSD(T)**, not full CCSDT. Unit defaults and missing resources are documented
per case instead of inferred from file names.

These case tests run entirely offline after dependencies are installed. They
verify checked-in bytes and licenses, call the existing importer for five
rejection cases, reuse the existing five-step reference test, and run the fifteen
executed-solver checks described above. They never download/install external
solvers, invoke `Allrun`, expand includes or launch a full benchmark.
The numerical checks assert **32 atoms and 5 steps before computing**, including
the separate ASE comparison of the same state. Both CI workflows already invoke
these files through `test:smoke`; there is no second duplicate corpus run.

```bash
npm run test:software-cases
```

To independently re-download the exact upstream sources into a **new** directory:

```bash
python3 scripts/research/download-software-cases.py --output-dir /tmp/waveworld-case-sources
```

The optional downloader checks the pinned hashes before saving, limits each
request to 20 seconds and at most two retries, and caps files at 64 KiB and the
complete upstream download at 512 KiB. It does not run the files or regenerate
the numerical references. Adding a solver comparison requires an explicit test
with matched units, material model, boundary conditions and a small step budget;
changing a manifest label alone does not add a capability.
