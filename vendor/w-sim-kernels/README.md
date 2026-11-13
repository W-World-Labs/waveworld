# Native and WASM numerical kernels

`w-sim-kernels` contains wave, 2D heat diffusion, TMz Yee electromagnetic, Lennard-Jones molecular dynamics, D3Q19 flow and conservative thermal kernels
for native execution and browser WASM wrappers. It has no dependencies,
allocator, I/O, process runner, or host-specific API. Native callers use the Rust
library; the browser wrapper exports these same functions through WASM memory.
The shared [WASM ABI](./wasm/README.md) owns the wave, heat, seed, FDTD, MD, Stable Fluids and D3Q19
exports, memory checks and native/WASM parity verification.

Flow/wave/FDTD/MD/Stable Fluids kernels reuse caller-owned `f32` buffers and calculate in
`f64` (mixed precision). The thermal energy, temperature and mass buffers are
fully `f64`; coupling to the f32 flow keeps the complete solver mixed precision. Wave and heat preserve their JavaScript reference operation
order. These mixed-precision flow kernels are not FP64 field solvers and do not
imply engineering CFD validation. The independent MAC flow step and pressure
projection below use fully f64 state and arithmetic. The wave kernel uses fixed zero walls and optional hard obstacles;
heat uses insulated boundaries. Coefficients outside the explicit CFL bounds
and non-finite updates return `KernelError` rather than an apparently valid field.

```rust
use w_sim_kernels::{step_heat, step_wave};
# fn main() -> Result<(), w_sim_kernels::KernelError> {
let mut current = vec![0.0f32; 25];
let mut previous_next = current.clone();
step_wave(&current, &mut previous_next, 5, 0.25, 0.999, None)?;
std::mem::swap(&mut current, &mut previous_next);

step_heat(&current, &mut previous_next, 5, 5, 0.25)?;
std::mem::swap(&mut current, &mut previous_next);
# Ok(())
# }
```

`seed_wave` applies equal circular displacements to both time levels, giving zero
initial velocity; `seed_heat` deposits initial heat. Neither creates a sustained
source. On a numerical error the output can be partially written: fail the job
or reset the buffers, without publishing that output.

## Three-dimensional MAC pressure projection

`mac_projection::project_mac3d` implements the constant-density pressure
constraint on a uniform cubic staggered grid. It is an independently testable
building block, with no advection, viscosity, momentum/body-force update,
turbulence, moving geometry, conjugate heat transfer or aerodynamic-force model.
It is not registered as a complete simulation method. The LBM timestep and
viscosity admission rules are unchanged.

`MacProjectionConfig` specifies `nx,ny,nz`, cell width `dx_m` [m], timestep
`dt_s` [s], and constant `density_kg_m3` [kg/m³]. Pressure samples are at cell
centres; velocity components are on their normal faces. All fields, work and
arithmetic are f64. The occupancy input follows the existing voxel convention:
zero is fluid, any nonzero flag is an impermeable stationary solid. Thermal
material meanings do not apply to this pressure-only kernel. Flags remain
unchanged; pressure inside solid cells is returned as zero, not a solid stress.

`open_faces` bits 0..5 mean xMin, xMax, yMin, yMax, zMin and zMax. A selected
whole outer face has ambient gauge pressure zero **at the boundary face**.
The pressure gradient uses the half-cell distance there (`2/dx`); internal
fluid faces use `1/dx`. Other outer faces and all faces touching solids have
zero normal velocity. This is the impermeability constraint only; projection
does not impose viscous tangential no-slip, a non-reflecting far field or a
fan pressure boundary. Partially occupied/cut cells are not represented.

The same face classification constructs the divergence D, gradient G and
pressure matrix `A=-DG`, then applies `u=u*-(dt/rho)G p`. The internal PCG
system is scaled by `dx²`: its diagonal contributions are 1 for an internal
fluid face and 2 for an ambient opening. Pressure is returned in Pa, not
kinematic pressure or pressure impulse. The derivation follows the pressure
projection and boundary treatment in [Bridson and Müller-Fischer's SIGGRAPH
2007 notes, chapter 4](https://www.cs.ubc.ca/~rbridson/fluidsimulation/fluids_notes.pdf);
the half-cell boundary corresponds to their ghost-pressure construction with
theta=1/2. No source from that implementation or external solver is imported.

Each face-connected fluid component without a pressure opening pins its first
cell to zero Pa. Jacobi-PCG solves that symmetric positive definite subspace;
the original physical RHS is retained, including at pinned cells. Closed wall
flux is imposed as zero before forming the RHS. There is no subtraction of an
incompatible RHS mean. Final acceptance recomputes the full physical Poisson
residual, including pins, and independently checks the actual corrected face
velocity divergence. A pinned equation cannot hide a local volume source.

`absolute_divergence_tol` is a hard bound on the maximum absolute fluid-cell
divergence [s⁻¹]. `relative_residual_tol` is dimensionless in [0,1), and if
positive tightens the bound to `min(absolute, relative*initial_divergence_linf)`.
Zero relative tolerance or zero initial divergence uses the absolute bound.
The initial divergence is measured after imposing stationary normal wall
velocities. Both the full physical residual (`rho/dt` times the allowed
divergence, in Pa/m²) and actual final divergence must pass. The report contains
initial/final/allowed divergence, full Poisson residual, iterations, fluid
count and closed-component count; it is not an error estimate for a continuous
flow solution. Roundoff can make an excessively strict request fail explicitly.

The caller supplies u/v/w with dimensions `(nx+1)*ny*nz`, `nx*(ny+1)*nz` and
`nx*ny*(nz+1)`, each with x-fastest storage, plus N cell pressures, 6N f64 work
and 2N u32 topology work. Pressure starts from zero and the kernel allocates
nothing. `max_iterations` is bounded to 1..4096. Invalid dimensions, buffers,
coefficients or nonfinite arithmetic fail; exhausted or unresolved iterations
return `MacProjectionError::NotConverged` with iteration count and physical
residual/limit. Any failure preserves input velocities; pressure and scratch
must be discarded. The corrected velocities are checked before being stored.

Short Rust tests check all three axis permutations of an analytic two-cell
opening (including physical-unit scaling), one-cell half-distance pressure,
retention of a nonzero divergence-free circulation, multiple sealed cavities
including a single-cell island, mixed open/closed components, a 24-cell discrete
manufactured pressure, hard divergence limits and explicit one-iteration
failure including the pinned-cell residual. They certify these discrete
properties, not mesh convergence or an engineering CFD application.

```sh
cargo test --manifest-path crates/w-sim-kernels/Cargo.toml --test mac_projection
```

## Constant-density laminar MAC flow step

`mac_step::step_mac3d` advances the actual three-dimensional incompressible
Navier–Stokes momentum equation: conservative donor-cell advection, explicit
physical kinematic-viscosity diffusion, a prescribed acceleration field, then
the existing MAC pressure projection. All fields and arithmetic are f64, with
no allocations or extra dependencies. This is a first-order time and advection
scheme for a uniform cubic voxel grid. Upwind advection introduces numerical
dissipation; keeping the physical viscosity unchanged does not remove that
discretization error. There is no automatic increase of viscosity, timestep
adjustment, turbulence model or change to the LBM stability admission.

`MacStepConfig` contains the existing `projection` config,
`kinematic_viscosity_m2_s` (finite, nonnegative, m²/s), and
`open_velocity_m_s[3]` (m/s). `MacStepBuffers` supplies immutable current u/v/w
and acceleration_u/v/w on their respective MAC faces, plus separate next_u/v/w,
pressure and the existing 6N f64 / 2N u32 projection scratch. Accelerations are
in m/s² and are applied only at active velocity degrees of freedom; prescribed
zero normal-wall nodes ignore them. No fan curve or fan geometry is inferred
from a generic acceleration field. Swap current and next after success only;
all next/pressure/scratch outputs are invalid after any failure.

The staggered momentum control volume consists of half of each adjacent fluid
cell: h³ at an internal active velocity and h³/2 at an outer pressure-opening
normal velocity. Each owner cell supplies a full frontal face at its centre
and half of each lateral face. Frontal transporting speed is the mean of the
two normal velocity nodes; lateral transporting speed is the owner's actual
normal MAC face speed. Each half-face independently selects its upstream
transported component. The same active/active interface flux appears with
opposite signs in its two control volumes. Averaging opposing half-face speeds
before selecting upstream values would lose the intended momentum transport.
The geometry follows the element-wise construction described by the
[DuMux staggered finite-volume documentation](https://dumux.org/docs/doxygen/master/group___face_centered_staggered_discretization.html);
no DuMux source or framework is imported.

Stationary solid and closed outer faces have zero normal velocity. Tangential
no-slip diffusion uses a wall half a cell from the velocity node (equivalent
to a reflected ghost velocity `-u`). At a voxel corner, an open fluid half-face
and a solid half-face remain separate: the solid half uses distance h/2, while
the fluid half may reach an already prescribed normal-wall velocity node at
distance h. Exchanges with that fixed node are included in the wall momentum
budget. Thus arbitrary existing occupancy masks are processed without silently
turning a mixed half-face into a full wall or a full fluid interface. This
staircase boundary still has geometric discretization error; it is not a
cut-cell treatment of the original curved CAD surface.

Pressure openings retain ambient gauge pressure zero through projection and
zero normal viscous gradient in the predictor. Normal momentum at the physical
opening uses its actual input normal velocity, including during backflow;
the reservoir does not prescribe a normal velocity on top of pressure.
Incoming **tangential** momentum uses the configured reservoir component,
while outgoing momentum uses the inside value. These artificial truncation
conditions are not non-reflecting exterior boundaries and do not constitute
an energy-stable backflow formulation. Their suitability and domain-distance
effects require validation for each later engineering application.

Input velocity must already have exactly zero normal-wall values and every
fluid cell must satisfy `|D u| <= projection.absolute_divergence_tol`. The
standalone projection can prepare arbitrary initial fields; the step does not
silently apply an extra initial projection. At each active momentum control
volume, explicit admission requires
`dt/V * (sum(A*max(outward_normal_speed,0)) + nu*sum(A/distance)) <= 1`.
The actual areas, half volumes and wall distances enter this **combined**
condition. Independent advection and diffusion limits alone are insufficient.
The three reported CFL numbers are the maxima of the local advection,
diffusion and combined coefficients; maximum combined need not equal the sum
of the other two maxima. This is a discrete explicit-operator constraint, not
a guarantee of temporal accuracy or engineering solution quality.

`MacStepError::TimeStepExceeded` reports the three actual CFL values and leaves
the chosen dt and nu unchanged. Nonfinite input/arithmetic and invalid buffers
fail explicitly. Projection errors preserve their existing residual evidence;
the kernel never reports a successful timestep when pressure failed to
converge. `MacStepStats` includes the original projection stats and impulses
**on the fluid** from predictor wall exchanges, open-boundary fluxes and body
acceleration, plus the dual-volume-weighted momentum change from projection.
All impulses are kg·m/s. The momentum quadrature is equivalent to averaging
the two component face velocities in every fluid cell. The projection impulse
is an observed discrete momentum change, not a separately integrated force on
the model; these budgets cannot be used directly as aerodynamic coefficients.

Ten tiny Rust tests cover uniform open flow, both signs of tangential inflow,
inside outflow donors, three-axis wall decay and a **discrete** Poiseuille
balance, nonzero donor-cell transport of a circulation, a mixed voxel corner
with an independently solved 3×3 pressure system, physical force/pressure
units, combined-CFL rejection, one-to-three actual steps, and failures that
preserve current fields. The discrete Poiseuille samples are not claimed to
equal the continuous parabola. No time-to-steady-state or mesh-convergence run
is part of CI. This core is not yet a registered product simulation method;
validated car/server workflows need their own integration and validation. The
thermal transport building block below consumes these actual MAC face flows.

```sh
cargo test --manifest-path crates/w-sim-kernels/Cargo.toml --test mac_step
```

## User-supplied fan pressure/flow curves

`fan_curve::pressure_rise` interpolates a static pressure rise in Pa from 2..256
user-supplied `FanCurvePoint { flow_m3_s, pressure_pa }` values. Flow coordinates
must be strictly increasing, finite and nonnegative; pressures must be finite
and nonnegative but may increase locally. The function preserves measured
nonmonotone shoulders, validates the entire curve, and does not sort, clamp,
extrapolate or install a manufacturer default. Each C-layout point is two f64s.

Actual RPM ratio `s` is in `(0,1]`, relative to the curve's reference speed.
The affinity approximation is `dp_s(Q)=s²*dp_ref(Q/s)` at unchanged geometry,
density and similar flow conditions. It is implemented by interpolating scaled
knots `(s*Q,s²*dp)` to preserve the scaled endpoints. This ratio is not a PWM
duty cycle, and the numeric accepted range is not a claim that every real fan
obeys similarity down to arbitrarily low speed. See the fan-law assumptions and
nonmonotone-curve discussion in [NIST CONTAM's variable-flow fan theory,
printed pp.265–266](https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.1887.pdf).
Callers must supply the pressure convention appropriate to their model; total
pressure and static pressure are not interchangeable.

Zero RPM and reverse flow return `UnsupportedFeature`: stationary-rotor
resistance and reverse operation have no model here. Invalid point count gives
`BufferLength`; bad coordinates/order or RPM ratio gives `InvalidCoefficient`;
nonfinite input/arithmetic gives `NonFiniteValue`. Querying outside the scaled
flow interval, underflow of a positive quantity or collapsed scaled knots gives
`InvalidState`. There is no output on error. The scalar is f64/no_std, allocation
free and stateless; it is not a rotor, motor, dynamic-stall or system operating
point solver. No assumption that pressure power equals motor heat is made.

Ten tiny scalar tests include hand interpolation, a nonmonotone shoulder, RPM
scaling, complete input validation, endpoints and extreme representable values.
Two independent `mac_fan` tests connect this function to real-air MAC flow on
5×3×3 cells for at most three steps. A synthetic curve `(0,20 Pa)` to
`(0.01 m³/s,0)` drives one interior face layer with `a=dp/(rho*dx)`; it is not
manufacturer data. With dx=0.01m, dt=0.0001s and rho=1.225kg/m³, the first step
matches `U=dp*dt/(rho*L)` and momentum `dp*A*dt`. The next curve query uses the
computed area-integrated flow; pressure decreases as that flow increases.
Removing the acceleration on step three removes the source impulse, while a
zero-source control stays at rest. A separate one-step comparison with ν=0
isolates the real-air wall-viscosity effect. These tests verify source/flow
coupling and discrete budgets, not full fan geometry, a steady operating point,
thermal transport or an engineering server result. The WASM parity suite also
executes the three-step synthetic P-Q feedback with byte-identical fields.

```sh
cargo test --manifest-path crates/w-sim-kernels/Cargo.toml --test fan_curve --test mac_fan
```

## MAC actuator disks and replay sampling

`mac_fan::mac_fan_accelerations` connects the same pressure curve to 0..16
axis-aligned actuator disks. `MacFanDisk` contains the grid axis, direction
(`+1` or `-1`), original centre in cell coordinates, radius in metres, actual
RPM ratio and a range in the shared reference-RPM curve point array. The normal
coordinate snaps to `floor(center+0.5)`; the reported plane is the actual grid
face plane. Callers retain the original centre and display the selected area,
which is `face_count*dx²`, rather than substituting the analytic circle area.

The complete circle must fit inside the transverse domain. Selected face
centres must lie inside that circle, with fluid cells on both sides. A disk
must select at least one face, must lie on an interior plane and cannot share
a selected face with another disk on the same axis. Blocked, clipped, empty or
overlapping disks fail; blade geometry is not a fluid-force mask. This uses
the existing MAC face classification for voxel solids.

For each disk, the signed forward flow is `Q=direction*sum(u_face)*dx²`.
The scalar curve supplies `dp(Q,rpm_ratio)`, and the selected face accelerations
are `direction*dp/(rho*dx)`. With full interior dual volumes, the integrated
force on the fluid is `direction*dp*face_count*dx²` N along the selected grid
axis. Curves must refer to the job's fluid density; no density correction is
inferred. Local reversed patches are allowed only when the signed net flow
remains within the supplied curve's supported range. Reverse net flow, stopped
RPM and out-of-curve operation retain the scalar's explicit errors.

`MacFanBuffers` takes immutable current face velocities and overwrites separate
fan-only acceleration arrays and one `MacFanReadout` per disk. Readouts contain
plane, face count, area, flow, pressure rise and signed force. Flow is sampled
at the **start** of the momentum step; the resulting pressure is applied during
that step. Rebuild these arrays before each flow step. An empty disk list clears
the source; it does not model resistance from a stopped rotor. On failure,
discard all acceleration/readout outputs and do not advance. The source does
not alter dt, fluid density or viscosity, and supplies no blade torque, swirl,
motor heat or steady operating-point certification.

`mac_fields::sample_mac_cells` provides shared native/WASM display sampling
through `MacCellFieldBuffers`. Each cell stores interleaved f32
`[ux,uy,uz,pressure]` in m/s and Pa, with optional absolute temperature in °C
as a fifth value. Fluid velocity is the arithmetic mean of its two component
faces. Solid velocity and pressure slots are zero, while temperature includes
solids and internal reservoirs; occupancy remains the authority for each slot's
meaning. Input temperatures are relative-to-ambient K. Without thermal fields,
only flags 0/1 are accepted. All inputs and f32 outputs must be finite, and
absolute temperature must exceed −273.15°C.

The sampler returns the maximum cell-centred speed computed in f64 before
display conversion. It preserves the immutable state and does not project,
normalize velocities or infer extra physics. Saved display fields support
visualization and replay; they are not restart checkpoints of the f64
staggered solver state. On error discard the partially written display buffer.

Five disk tests check three axes and both directions against a hand-selected
five-face circle, pressure/force units, multiple disks, source rebuilding,
geometry rejection and signed flow. Three sampler tests check analytic face
averages, pressure and temperature units, masking, errors and a maximum speed
whose extra f64 precision is absent from its f32 display value. These are tiny
interface/physical-budget checks, not fan geometry or CFD accuracy validation.

```sh
cargo test --manifest-path crates/w-sim-kernels/Cargo.toml --test mac_fan_disk --test mac_fields
```

## MAC conjugate heat transport

`mac_thermal::step_mac_thermal3d(&MacProjectionConfig,&ThermalConfig,flags,buffers)`
advances conservative sensible energy using actual staggered MAC face velocities.
It reuses the existing thermal material/mode/flag contract, contact conductance
and source-power allocation; it does not fabricate lattice populations or a
D3Q19 config. The module re-exports `ThermalConfig`, `ThermalMaterial`,
`ThermalMode`, `ThermalStep` and the existing capacity constants. LBM heat
transport continues to use its own population mass exchange and original inlet
behavior, unchanged by these shared material helpers.

Energy is in J relative to ambient, and reported temperature differences are K.
Every fluid or conducting-solid cell has its **full** heat capacity
`rho*cp*dx³`, including fluid cells adjoining pressure openings. Velocity-node
half control volumes are not heat-cell volumes. Fluid density, dx and dt must
agree exactly between the MAC and thermal configs. Solid capacities use the
material identified by that cell's flag. All capacities, fields, rates and
arithmetic are f64, with no allocation. Negative sensible energy is valid while
the resulting absolute temperature remains above absolute zero; it is not
clamped to ambient.

A fluid face transfers `rho*area*u*cp*upwind(deltaT)` watts, with one shared
signed flux applied equally and oppositely to its two cells. Internal fluid,
solid and mixed interfaces conduct through two half-cell material resistances:
`G=area/(dx/(2*kLeft)+Rcontact+dx/(2*kRight))` in W/K. Contact resistance is an
**area resistance**, in m²·K/W. Configured contacts must actually occur between
the material flags on a grid face; absent contacts fail. An explicit R=0 gives
the same conductance as perfect contact. The transport/conduction face sums
follow the cell-centred finite-volume balance documented by
[NIST FiPy](https://pages.nist.gov/fipy/en/stable/numerical/discret.html).

Flag 1 is insulated and stores no energy. Internal flag 2 is a fixed hot
reservoir and flag 3 an ambient reservoir, both with zero stored energy. Their
heat exchanges enter the boundary-energy ledger. Reservoir conductance uses
the active material's half-cell distance. Flags 4..20 are stationary conducting
solids; each material's **total** source power is divided among its own flagged
cells. The existing mode rules and requirements for actual thermal bodies and
configured material regions remain, and at least one fluid cell is required.

Closed domain faces are insulated. Pressure openings have zero normal
conduction: incoming fluid carries ambient sensible enthalpy (zero), while
outgoing fluid carries its cell's current sensible enthalpy. This applies to
either flow direction on all six possible opening faces. An inlet cell mixes
according to its actual face flux; its entire energy is never reset to zero.
Velocity must be finite, exactly zero on solid/closed normal faces, and satisfy
the MAC absolute cell-divergence tolerance. The heat step does not execute a
pressure solve or use its iteration/relative-residual settings.

Advection, conduction and source injection all use the same old temperature
within each explicit thermal substep. The combined positive-coefficient limit
is `dt_sub*(outgoing rho*cp*area*speed + sum(G))/capacity <= 0.9` for every active
cell. The kernel chooses the smallest integer number of equal substeps required
by this bound, at least one, and rejects a requirement above the configured
`max_substeps` (itself limited to 1..4096). The 0.9 margin follows the existing
explicit thermal kernel. Substeps cover the original physical dt; density,
conductivity, total power and macroscopic time are unchanged. A high-conductivity
solid or fine grid may require too many explicit substeps and is then rejected.
An implicit thermal method is not implemented here.

`MacThermalBuffers` holds immutable u/v/w and energy, plus separate N-element
next_energy, temperature_delta_k and work arrays. Work holds heat capacities
and may reuse the first N entries of projection scratch. Temperature is frozen
while each substep accumulates fluxes, then refreshed from the candidate energy.
Current energy and velocity never change; discard candidate/scratch outputs on
failure and swap energy buffers only after success. Nonfinite values, invalid
capacities, inaccessible contacts and unsupported settings fail explicitly.
`gravity_per_kelvin` must be zero: buoyancy feedback, temperature-dependent
properties, radiation and phase changes are outside this heat step.

The returned existing `ThermalStep` reports total stored energy, integrated
source energy, net boundary energy, residual `after-before-source-boundary`,
actual solid/fluid temperature maxima and the thermal substep count. Its
source/boundary budgets cover the entire original dt. Nine independent tiny
tests cover unequal capacities and two/three-layer contact conduction, material
power allocation, three-axis forward/reverse flow with a warm inlet cell,
positive/negative sensible energy and fixed reservoirs, combined stability,
three-substep equivalence and failures preserving inputs. The separate
fan/flow/heat integration test uses three small steps with actual air properties,
two conducting materials, a contact resistance and a synthetic fan curve. It
checks measured outflow enthalpy against an otherwise identical zero-flow case.
These checks establish the tested discrete balances, not a validated server
temperature prediction, mesh convergence or a full product simulation method.

```sh
cargo test --manifest-path crates/w-sim-kernels/Cargo.toml --test mac_thermal
```

## D3Q19 flow with optional conjugate heat transport

`lbm::init_d3q19` and `lbm::step_d3q19` implement actual BGK collision, optional
Smagorinsky stress correction, pull streaming, stationary-solid halfway
bounce-back and obstacle force from link momentum exchange. The native core is
available for executor integration; compiling the crate for WASM does not itself
register a browser D3Q19 module.

The layout matches the product WebGPU solver: `cell = x + nx * (y + ny*z)`,
`population = cell*19 + direction`, `velocity = cell*3 + axis`. Direction
constants are exported as `D3Q19_C`, `D3Q19_W`, `D3Q19_OPPOSITE`. The older CPU
reference fixtures use a different direction order and SoA layout, so their raw
population buffers cannot be passed without conversion. Flags are `0` for fluid
and `1` for insulated stationary obstacles; `2` and `3` are fixed hot and ambient
wall temperatures; `4` is the default conducting solid material and `5..20`
identify the optional region materials. Flags 2–20 require thermal.
Thermal init/step require at least one fluid cell and at least one flag-2 wall
(fixed-temperature) or conducting solid (solid-power). Every configured region
must have cells. Unknown flags fail.

Flow quantities are dimensionless lattice units (`dx=dt=rho_reference=1`).
Initialization sets density to 1 and uniform `u_inlet` velocity along +x; y is
the lift axis and z the spanwise axis. `f` and `post_collision` each need
`cell_count*19` elements, `velocity` needs `cell_count*3`, and `density` and
`flags` each need `cell_count`. Call `config.cell_count()` before allocation.
`step_d3q19` updates `f` in place through the separate collision buffer; do not
swap the buffers. Its step index starts at 1 and seeds deterministic inlet noise.
Both init and step take `Option<ThermalBuffers>` after the density buffer; pass
`None` without thermal. `D3q19Config::thermal` and the buffers must agree.

`D3q19Config` supports `WindTunnel`, `Periodic` and `Closed` boundaries.
Wind-tunnel mode uses current-stream non-equilibrium extrapolation (NEE) at
both x faces. At each immediate inner fluid node, compute `rho_i=sum(f_i)` and
bare `u_i=sum(c*f_i)/rho_i` from the **current streamed** populations. Replace
all 19 inlet populations with `feq(rho_i,u_inlet)+(f_i-feq(rho_i,u_i))`, where
`u_inlet` includes the existing deterministic step/noise vector. The outlet
remains `feq(1,u_i)+(f_i-feq(rho_i,u_i))`. No stale velocity, post-collision
snapshot or half-force correction supplies these donor moments.

This density-form D3Q19 adaptation uses the neighbor-pressure / prescribed-velocity
construction of [Guo, Zheng and Shi (2002), equations 11 and 14](https://cpb.iphy.ac.cn/en/article/pdf/preview/10.1088/1009-1963/11/4/310.pdf).
The original paper derives an incompressible D2Q9 formulation; we do not claim
its accuracy theorem or arbitrary forced-boundary accuracy for this adaptation.
The current-stream residual is not multiplied by another collision factor.
Its mass and momentum vanish to population rounding, retaining the inner
non-equilibrium stress while imposing the inlet velocity.

A fluid boundary with a solid immediate inner neighbor is rejected before init
or stepping. Adjust geometry/domain occupancy to leave a fluid donor layer;
there is no neighbor search, clipping or equilibrium fallback. GPU dispatch
reads only the inner layers and writes only x boundary nodes, with no added
buffer or pass. Side walls remain impermeable no-slip or specular walls;
this is not a certified non-reflecting exterior boundary. Specular half-way
streaming reflects only crossed y/z normals and retains tangential displacement.
A y/z corner reflects both normals only when both were crossed. Open x links
retain their bounce-back placeholder until the x boundary reconstruction.
Closed mode has no-slip walls on all six faces.

**[BREAKING CHANGE / CONTRACT IMPACT]** Velocity NEE requires native
`D3Q19_NEE_INLET_VERSION=1`, WASM ABI9 and feature `lbm-nee-inlet-v1`.
ABI11 retains this inlet convention: config is 1888 bytes with version 11 at byte 56; stats remain 152 bytes including the mass budget below.
WaveWorld and Agent must update their core pin/loader, capabilities, required
features and result markers. Old equilibrium-inlet executors/results cannot
satisfy the new contract. Existing `D3Q19_NEE_OUTLET_VERSION=1`,
`lbm-nee-outlet-v1` and gauge-force version 1 remain required and unchanged.

An inlet with zero prescribed speed is **not a sealed boundary**: copying inner
density can add/remove mass. The full budget is collision rounding plus
streaming transport plus x-boundary reconstruction. Thermal advection compares
actual completed population mass to transported mass. Incoming reservoir mass
has ambient enthalpy; outgoing mass removes mixed sensible enthalpy. The LBM
inlet cell additionally remains an ambient thermostat, charging all removed
heat to `boundary_energy_j`. This is unchanged and differs from MAC's face-only
ambient influx. No physical dt, viscosity, forcing or energy definitions change.

Independent 175-cell, one-step tests cover shear `s*(U²-1/3)`, density-pulse
current-time donor moments, explicit open-boundary mass budgets, donor rejection,
noise at ground/slip/no-slip corners, and warm backflow plus inlet conduction.
Native/WASM tests compare full populations and statistics, not updated golden
snapshots. Existing uniform, fan, outlet and moving-ground checks remain
required. These are local boundary checks, not automotive drag, high-Reynolds
or grid-convergence validation.

An explicit `ground_velocity: Option<f64>` overrides only yMin with a half-way
no-slip plane: `None` preserves the side-wall setting; `Some(0)` is stationary;
`Some(U)` moves along +x. This option requires `WindTunnel` and finite nonnegative
speed that remains below 0.2 when rounded to f32. For an incoming population q,
`f_q = post_opp(q) + 6*w_q*rho_post*c_q.x*U`. Thus the +x/-x diagonal corrections
cancel mass locally and transfer x momentum. The convention follows
[Derksen, LBM lecture notes §3.4, Eq. 3.4](https://homepages.abdn.ac.uk/jderksen/pages/lbm/ln03_pa.pdf).
A ray crossing yMin uses full bounce-back before any z mirror; rays crossing
only z retain the existing specular tangential travel. Ground impulse is excluded
from `obstacle_force`. The subsequent whole-node x inlet/outlet resets retain
priority, including their ground edges. This is an open domain: those reservoirs
can change total mass even though the ground correction sums to zero.

The ground is thermally insulated and has no heat capacity. Its reflected links
carry no mass or sensible enthalpy across the wall. Thermal transport keeps the
same link map and strict per-cell mass check; no viscous-work heating is added.
This boundary does not model a moving mesh, rotating wheels or a rough road.

The transport map is reversible: a link arriving in direction `r` reverses with
`opposite[r]`. If its reflected donor is solid, the complete blocked link uses
the same obstacle bounce-back and momentum-transfer accounting as a direct
solid link. This assigns that unresolved wall/solid junction link to the
obstacle; it does not resolve separate contact stresses. Ordinary specular wall
links contribute no obstacle force. Thermal advection uses these same physical
links, retaining separate direct and reflected links between the same cells.
Each pair is identified by its two `(cell, direction)` endpoints rather than by
half of the direction indices. The strict per-cell mass check remains enabled.

### Internal-fluid mass budget

`D3q19Step.mass_balance: D3q19MassBalance` measures one completed step in
lattice mass units. The control volume is **only flag-0 cells with
1 <= x <= nx-2**. The x=0 and x=nx-1 numerical boundary layers are excluded,
even at zero prescribed inlet speed. `mass` still includes all fluid cells.
The initial value is the actual sum of initialized f32 populations, not a
cell count times nominal rho=1.

The seven f64 fields are `bulk_mass_before`, `bulk_mass_after`,
`inlet_net_mass`, `outlet_net_mass`, `collision_mass_change`,
`inlet_replacement_mass`, `outlet_replacement_mass`. The first two sum input and
completed populations. Collision change sums **stored f32 post minus input**.
Inlet transport is signed **into** the internal volume; outlet transport is
signed **out**. Both count actual post populations on the fluid-donor branch
of the existing pull stream mapping. Wall/solid bounce-back and blocked ground
links are excluded. This preserves diagonal/specular links; area times mean
velocity would give a different answer at no-slip side walls.

The independently measured step balance is
`R = bulk_after - bulk_before - inlet_net + outlet_net - collision_change`.
It includes streaming/moving-wall writeback and diagnostic summation roundoff;
it is not forced to zero and is not a compressibility or accuracy certificate.
NEE replacements instead measure stored boundary populations minus their
streamed placeholders, separately at each x side. They are numerical-boundary
mass sources, **not** transport across the internal volume. Final boundary mass
is `step.mass - bulk_mass_after`. Periodic/closed kernels use the same internal
volume, with zero NEE replacements.

Multiply lattice mass by `rho_reference_kg_m3 * dx_meters^3` to obtain kg.
Runners accumulate signed transport, collision, reconstruction and step R over
**every** completed step, independent of force warmup, then convert once to SI;
`maxAbsStepBalanceResidualKg` is the maximum absolute **global per-step** R.
No extra native/WASM field traversal is introduced. ABI10 appends these seven
values after the old 12-f64 stats prefix. Consumers must allocate 152 bytes,
use `D3Q19_MASS_BALANCE_VERSION=1`, and require `lbm-mass-balance-v1`.

`tests/lbm_mass.rs` independently pushes immutable post populations forward
while the implementation pulls. Three-step slip/no-slip/ground/periodic/closed,
solid and fan cases check actual crossing and collision writeback. The no-slip
uniform 175-cell oracle gives net inlet **13/15**, not area*u=1. A zero-speed
rho pulse gives zero internal flux but about +0.125 inlet replacement. These
are short discrete budget checks, not grid/time convergence validation.

The returned `D3q19Step` contains `obstacle_force: [f64; 3]` for that one step,
fluid `mass: f64`, and `max_speed: f64`. Model force is now a **gauge force**:
for each existing model bounce-back link, with departure direction `q`,
`F += 2 * c_q * (post_q - f32(w_q))`. The reference density is fixed at 1,
with zero reference velocity; the reference population is rounded exactly as
in initialization. This removes the ambient pressure load from an unclosed
wetted surface such as a ground-contacting model. For a completely immersed
closed surface the reference load cancels. The ambient correction follows
[Conrad (2015), §3.2.3, Eq. 3.10](https://kluedo.ub.rptu.de/files/4058/_AViscosityAdaptiveLatticeBoltzmannMethod.pdf);
our stationary halfway bounce-back specialization makes the two exchanged
populations equal, yielding the factor 2 above.

The gauge correction itself changes only the force statistic. Collision, streaming populations, pressure
boundaries, fan and thermal buoyancy remain unchanged. Moving-ground and domain
wall reactions remain excluded. Never subtract local `rho`, the inlet-velocity
equilibrium, fan forcing or hydrostatic pressure variation: those include real
loads. For momentum accounting, recover raw model transfer as
`gauge force + sum_model_links(2*c_q*f32(w_q))`, and account separately for domain
wall reaction, body forcing and open-reservoir momentum. This correction does
not resolve contact stress, seal cavities, or validate a wind-tunnel lift curve.
`D3Q19_GAUGE_FORCE_VERSION=1` provides the native force handshake. WASM ABI7
introduced this convention in the first three entries of the 96-byte stats;
ABI11 retains it. Product executors require `lbm-gauge-force-v1`; older raw results
must not acquire that marker merely through a reader upgrade.

### LBM pressure display

`display_d3q19` accepts optional current populations and appends
`p_gauge_lattice = sum_q(f_q - f32(w_q)) / 3` for fluid cells. The reference is
the same stored rest-equilibrium distribution used by gauge momentum exchange.
The unrounded equation of state is `p = rho/3` in lattice units; see
[Zou and He, §II](https://arxiv.org/pdf/comp-gas/9611001). Our discrete subtraction
convention makes the exact stored rest state zero: the f64 sum of its rounded
weights is 1.0000000149011612, so subtracting the number 1 after summation would
introduce a pressure offset. Rounding density before subtracting also loses
small representable population differences. Neither a per-frame spatial mean
nor the observed outlet mean is subtracted, and the NEE outlet still imposes
its existing rho=1 condition.

The product saves `pressureScalePa = physical_density * (dx/dt)^2` and obtains
gauge pascals by multiplying this scale by the saved lattice pressure. This is
the dimensional pressure conversion used by
[OpenLB's UnitConverter](https://www.openlb.net/DoxyGen/html/d6/d92/classolb_1_1UnitConverter.html).
Native/WASM sum f32 population differences in f64 and store f32 display values;
WebGPU uses f32 arithmetic. Only requested display frames compute this channel;
it introduces no collision/stream changes or per-step full-field readback.

This scalar is density pressure, not Bernoulli pressure or the complete
nonequilibrium stress tensor. Equal pressure can coexist with different shear
moments. It cannot by itself reproduce total model force, which also depends
on nonequilibrium momentum transfer and discrete links. Solid cells contain
zero padding, not a material stress. `D3Q19_PRESSURE_FIELD_VERSION=1` identifies
the native convention; product requests/results use `lbm-pressure-field-v1`.

The tiny Rust and WASM checks cover exact zero, signed dyadic perturbations,
pressure below rounded-density resolution, a shear counterexample, input
immutability, legacy display prefixes, and invalid memory/nonfinite values.
The opt-in GPU check independently verifies these moments and compares both
thermal and isothermal trajectories with pressure enabled/disabled for three
steps. These verify output semantics; they do not establish mesh convergence
or automotive pressure-coefficient accuracy.

Velocity and density buffers are refreshed after streaming and boundaries, so
they describe the completed state. All distribution, velocity and density
buffers remain `f32`; collision, stress, boundary arithmetic, forces and
statistics use `f64`. This is mixed precision, not a complete FP64 solver, and
need not be bit-identical to the product's FP32 WebGPU arithmetic and workgroup
force sums.

Admission requires finite `tau > 0.5`, `0 <= smagorinsky_cs <= 0.3`, and low
lattice speed (`|u| < 0.2`), including the worst-case inlet noise amplitude.
Nonpositive density, non-finite values, overflow, or failure of the bounded
no_std square-root iteration return an error. General moving bodies,
compressible/high-Mach flow, radiation and multi-component materials are not
implemented by this core: a product adapter must reject those requested
features before calling it. The LES model and these small tests do not certify
automotive drag accuracy, high-Reynolds convergence, or industrial CFD readiness.

A single optional `D3q19Config::fan: Option<D3q19Fan>` applies a stationary,
constant-pressure actuator disk using Guo forcing. Its `center: [f64; 3]` and
`radius_cells: f64` are in lattice coordinates; `normal: [f64; 3]` is the unit
force direction after model rotation; `acceleration_lattice: f64` is
`pressure_rise_pa * dt² / (physical_density * dx²)` for one cell of thickness.
The host converts model coordinates and physical units before calling the core.
Cell centers `xyz + 0.5` lie in the disk when the signed normal distance is in
`[-0.5, 0.5)` and squared radial distance is at most `radius_cells²`.
Only fluid cells receive force. The disk must fit inside the one-cell boundary
margin, resolve a radius of at least 0.5 cells and include at least one fluid
cell. Parameters must be finite, acceleration positive, and the normal's squared
length within 1e-6 of 1; unresolved or fully masked disks are rejected.

The collision uses the force-corrected velocity `(momentum + 0.5 * rho * a)/rho`,
the Guo population source and a matching force correction to the LES stress.
Completed output velocity includes this same half-step correction exactly once.
Initialization still sets the inlet equilibrium; the fan acts from the first
step. `None` retains the pre-fan arithmetic path and field bits. There is no
rotating-blade, fan curve, swirl or pressure-dependent performance model.

## Conservative solid/fluid thermal model

`D3q19Config::thermal: Option<ThermalConfig>` selects the same thermal energy
solver for `ThermalMode::FixedTemperature` and `ThermalMode::SolidPower`.
The product supports an uploaded stationary model with default material/power
and up to 16 named material regions. Each total power is distributed uniformly
over that material's own voxel volume. It solves real solid
conduction and heat storage; power is not converted to a prescribed temperature.
Flags 1 are insulated obstacles with no thermal capacity. Flags 2/3 are hot/ambient
reservoir walls, located at the halfway bounce-back face; they store no energy.
External closed/side walls are insulated. Fluid density and constant cp/k are
explicit physical inputs. There is no radiation, phase
change, turbulence thermal diffusivity or pressure work.
The Boussinesq approximation with fixed +y buoyancy is a small-density-variation
model, not a temperature-dependent gas equation of state.

`ThermalBuffers { energy, next_energy, temperature_delta_k, mass }` contains four
separate `f64[N]` slices (32 bytes/cell). Initialize via `init_d3q19`; do not swap
buffers or change material/time/grid parameters without reinitializing. Dynamic
cells start at ambient. Energy is sensible energy in J relative to ambient:
`E_i = M_i cp_i (T_i - Tamb)`. Solid mass is `rho_s dx³`; fluid mass is
`rho_ref dx³ sum_q(f_iq)`, including weak LBM compressibility. Completed temperature
is always derived from this actual energy and mass, never clamped to an input range.
The method discretizes `d(M cp T)/dt + div(mass_flux cp T) = div(k grad T) + P`;
solid cells have zero advective flux. A constant ambient reference cancels from
the fluid advection equation only when the same mass balance is used.

Each flow step performs:

1. Derive temperature from energy/mass. Combine the fan acceleration with
   `gravity_per_kelvin * temperature_delta_k` along +y for a single Guo force.
2. Run unchanged D3Q19 collision, stream and flow boundary updates.
3. On each unique D3Q19 fluid link use the actual post-collision net population
   exchange `dm_ij = rho_ref dx³ (post_iq - post_j,opposite(q))`.
   Transfer `dm_ij cp_f theta_upwind` once with equal/opposite energy updates.
   Apply the same paired mass updates. This is first-order upwind transport,
   with numerical diffusion; it is not a central average-velocity stencil.
4. Reconcile completed flow mass at the two open x boundaries: incoming mass
   carries ambient sensible enthalpy (zero), outgoing mass removes the cell's
   mixed enthalpy. The inlet is additionally an ambient thermostat. All changes
   enter the signed external energy ledger. At interior cells only f32 flow
   rounding is tolerated (5e-6 relative mass consistency); no artificial heat is
   injected to hide this rounding. Heat conservation and uniform-temperature
   preservation consequently have different rounding tolerances.
5. Substep conduction and each region's local power. Every Cartesian face is evaluated once
   with shared conductance `G = dx / (1/(2 k_i) + 1/(2 k_j))`. This harmonic
   resistance imposes a common interface heat flux, including dissimilar fluid
   and solid conductivities. At fixed halfway wall faces `G = 2 k_i dx`.
   Fluid inlet cell-centres are full-cell-distance thermostats. Update paired
   cells with `dE_i = dt_sub G (T_j-T_i)` and its negative; reservoirs instead
   contribute to the external ledger. Each conducting cell receives
   `P_material dt/N_material`, split over the same conduction substeps.
6. Recompute temperatures and completed force-corrected velocity from the new
   state. Fan plus buoyancy receives one half-force correction.

Advective outgoing net mass may not exceed 0.9 of a fluid cell's mass per flow
step. Conduction chooses the smallest integer substep count satisfying
`dt_sub sum(G_i)/(M_i cp_i) <= 0.9` at every dynamic cell. `max_substeps` is
1–4096 (product default 1024); exceeding it fails the job, without silently
changing physical dt. These positive-coefficient checks do not prove global
flow stability. Low-Mach flow checks still apply after every update. Temperature,
energy, masses and all reported statistics must be finite.

`D3q19Step::thermal: Option<ThermalStep>` reports final total sensible energy,
single-step source energy, signed external boundary energy (positive inward),
and `residual = E_after - E_before - source - boundary`. It also reports the
completed solid/fluid maximum Celsius temperatures and conduction substep count.
`JobResultV1.thermal: LbmThermalResult` sums source/boundary/residual over steps,
retains final energy and spatial maxima, and records maximum absolute step
residual and maximum substep count. This is an explicit energy ledger, not an
industrial accuracy certificate. Small conservation and interface tests are
necessary but do not replace mesh refinement or experimental validation.

Product inputs `thermalMode`, `dtSeconds`, `solidDensityKgM3`,
`solidSpecificHeatJkgK`, `solidConductivityWmK`, `totalPowerW` describe the current
default-material power mode. All material properties must be positive/finite;
power is finite and nonnegative, including zero-power insulated tests. Fixed
mode requires `heatSourceTemp > ambientTemp > -273.15`; its unused solid/power
coefficients are zero. Power mode does not use `heatSourceTemp`. Fluid defaults
are air near room temperature (`rho=1.225 kg/m³`, `cp=1005 J/kg/K`, `k=.026 W/m/K`);
other fluids must supply cp/k/density/viscosity rather than inherit an air Prandtl
number. Thermal diffusivity is exactly `k/(rho cp)`.

Power defaults to `dtSeconds=1e-4`. The original physical viscosity determines
`tau = .5 + 3 nu dt/dx²`; thermal admission requires `tau >= .505` and reference
lattice speed below .2. No tau floor, changed viscosity or dt repair is applied.
Fixed mode may choose dt from the existing inlet/fan/buoyancy reference speed
when dt is omitted, subject to the same checks. For example a 10 mm body with
32 cells across, air nu=1.48e-5 and dt=1e-4 gives tau≈.5455; 0.05 m/s inlet gives
lattice speed .016. A 1 m body at the same resolution/dt is rejected. Large
vehicle-scale heat simulations need a feasible grid/time/flow combination;
this implementation does not guarantee their convergence.

`ThermalUnits` and `JobResultV1.derived` save `ambientC`, `temperatureScaleC`
and `thermalDiffusivityPhysical`. Display stores `theta_K / temperatureScaleC`;
power uses scale 1 K, fixed mode uses its warm-wall difference. Replay decodes
Celsius using the saved scale. Thermal jobs reject Cd-variance stopping.

**[BREAKING CHANGE / CONTRACT IMPACT]** ABI6 introduced the 1888-byte config with
a fixed material palette and contact-pair table. ABI9 retains that layout and
rejects ABI7 and earlier because the outlet convention changed. The same conservative
face energy solver is shared by Rust native and WASM; the default-only input
retains its previous arithmetic and regression fields.
The old D3Q7 GPU shaders, populations and dispatch are removed. The explicit FP32
WebGPU backend implements the same conservative link/face equations; it is not
bit-identical Rust code or FP64. See the [GPU thermal limits and checks](../../packages/solvers-lbm/README.md#conservative-thermal-webgpu).
Native/WASM no-thermal and fan-only regression field digests are unchanged.
Free-slip corner reflection now permutes outgoing populations by reflecting
both wall normals, avoiding duplicate diagonal populations and inconsistent mass.
Isothermal GPU velocity/density/display refresh
after the completed stream/boundary step, matching the native sampling time.

`parameters.thermalRegions` contains at most 16 `LbmThermalRegion` entries:
`{name,bounds:{min:[x,y,z],max:[x,y,z]},solidDensityKgM3,solidSpecificHeatJkgK,
solidConductivityWmK,totalPowerW}`. Bounds are normalized to the original model
bounding box, not the rotated outer box. Names are nonempty/unique after trim
and limited to 80 characters. Bounds use `[min,max)` (max=1 includes the upper
model boundary); positive-volume overlap is rejected, touching faces are allowed.
Each region must resolve at least one existing solid cell. Empty arrays behave
as absent. Regions require enabled `solid-power` thermal; fixed-temperature
remains a boundary option in the same algorithm without material regions.

The product supplies an inverse affine matrix from lattice coordinates to
normalized source coordinates. `geometry::assign_thermal_regions` classifies
cell centers in shared Rust/WASM; it does not approximate rotated regions by a
larger axis-aligned box or change mesh occupancy. Uncovered cells stay flag4.
Surface voxelization may occupy cells whose centers lie outside the source
bounding box; even regions covering `[0,1]³` leave these surface cells on the
default material. No coordinate clamp expands the region to absorb them.
Default totalPowerW goes only to those cells; region powers are additional and
are divided only among the corresponding region cells. A nonzero default power
with no default cells is rejected. This avoids spreading CPU-chip power over
the heatsink and enclosure. The summed source ledger includes default and all
region powers; neither source nor temperatures are fabricated from setpoints.

`ThermalConfig` keeps its default four solid scalars and adds `material_count`
plus `[ThermalMaterial;16]`; materials contain density, specific_heat,
conductivity and total_power_w. Unused entries are zero. Prepared product
`thermal.thermal.materials` uses the same four fields in camelCase; names and
bounds remain in the job spec. No extra per-cell array or file is needed.
Different materials use the same harmonic face conductance and per-cell heat
capacity in the existing CFL check. Contact defaults to perfect contact across resolved faces; explicit pairwise
resistance is supported as described below. Radiation and unresolved gaps are not modeled.

Three-step native/WASM region fixtures compare all fields, material mass,
temperatures and source/boundary/residual statistics exactly. Tiny Rust tests
also verify a two-material analytic face transfer, localized power, equal
material degeneration and rotated center assignment. Real SwiftShader tests
compare default+regions, region-only, isolated two-material and zero-inlet
no-fan natural convection cases under the same declared FP32 tolerances as the existing thermal backend. They retain only
two 64-byte control readbacks per step; no full-field CPU transfer is introduced.

`geometry::voxelize_triangles` accepts already-transformed `f32` xyz vertices,
`u32` triangle indices, grid dimensions, flags and caller-owned `f64` scratch
(five values per triangle). It uses the existing z-slice, DDA surface marking
and even-odd scanline fill convention. Off-grid DDA samples are skipped while
retaining their original sample positions, so very large off-grid triangles do
not cause unbounded scans. Malformed indices, non-finite coordinates and values
beyond the safe f64 cell-resolution range are rejected. Coplanar faces parallel
to a slice follow the original half-open intersection convention; this is not
CAD healing or watertight geometry repair.

`geometry::voxelize_solids` adds `solid_triangle_counts: &[u32]` after indices.
The TS mesh field is `solidTriangleCounts?: ArrayLike<number>`. Positive counts
partition the consecutive triangles and must sum exactly to the triangle count.
Each group is one solid boundary set: fill by even-odd within the group, then
OR the occupied cells across groups. Scratch remains five f64 values per total
triangle, reused for each group; there is no additional cell buffer. Counts and
frontal area are measured once over the union, without double-counting overlap.

Omitted or empty groups preserve one boundary set; disconnected shells are **not
automatically a union**. In particular, overlapping ungrouped boxes have an
even-parity intersection, while grouped boxes retain their solid intersection.
An outer shell and cavity shell can deliberately stay in one group. Neither
winding nor nesting is used to guess solid membership. The original native and
WASM voxelization entries only forward into this implementation without groups.
Before writing flags, the shared native/WASM kernel checks every declared set:
discard triangles with exactly zero cross-product area; require at least one
remaining triangle, and require each geometric edge exactly twice in opposite
directions. Edges use exact input-coordinate equality, including +0 = -0,
independent of vertex numbering. There is no epsilon welding. Scratch temporarily
holds three opaque u32 edge-index pairs per triangle using f64 `to_bits/from_bits`;
sorting compares vertex coordinates, never floating-point edge encodings. The same
scratch then holds the original scan data. Degenerate triangles are also skipped
during surface marking, so they cannot add occupied cells.

**[BREAKING CHANGE / CONTRACT IMPACT]** Empty meshes, open edges, more than two
incident faces and inconsistent edge directions now return
`KernelError::InvalidSolidTopology` (WASM status11), leaving flags/counts unchanged.
Callers must discard scratch on failure. WaveWorld preparation and native Agents
must update their W-Sim build to apply this gate; older executors do not gain the
check from unchanged task DTOs. This topology admission does not change layouts or the numerical update.
Empty-fluid numerical baselines can initialize flags directly. Coincident edges
across separate contacting solids require explicit groups, not an inferred union.

Callers still own the intended solid interpretation. Edge closure does not certify
manifold vertices, detect general self-intersections, repair input, or prove that
a thin wall resolves on this grid. The z-slice convention remains unchanged.

Short tests compare two overlapping boxes against an independent axis-aligned
occupancy expectation (1051 cells versus the ungrouped 946), retain the single
box and rotated/clipped reference results, distinguish nested cavity/union
semantics, and compare native/WASM flags and counts exactly. An open tube whose
old flags equalled its closed box now fails; exact-coordinate reindexing remains
valid, while a one-ULP seam, reversed/duplicate faces and degenerate-only groups
fail. This establishes
occupancy behavior, not CFD accuracy or a general CAD Boolean operation.

`lbm::display_d3q19(&config, velocity, flags, temperature, display)` writes
`cell_count*2` interleaved speed/vorticity magnitudes without thermal. With
thermal, pass `Some(temperature)` and reserve `cell_count*3`; the final channel
is `temperature_delta_k/temperature_scale_c`. It uses the product shader's clamped-neighbor
central differences. It shares the mixed-precision arithmetic and native/WASM
verification; a WebGPU FP32 comparison may differ by rounding.

Lightweight checks (small grids only):

```sh
cargo test --manifest-path crates/w-sim-kernels/Cargo.toml
cargo clippy --manifest-path crates/w-sim-kernels/Cargo.toml --all-targets -- -D warnings
cargo build --manifest-path crates/w-sim-kernels/Cargo.toml --target wasm32-unknown-unknown --release
```

The tests check exact two-step reference fields, insulated heat conservation and
the maximum principle, the undamped discrete wave energy invariant, fixed walls,
obstacles, degenerate rectangular grids, invalid dimensions, and numerical errors.
The 5×4×3 D3Q19 checks run at most six steps and cover transport conservation,
force versus fluid momentum loss, wall reflection, inlet/outlet fields, LES,
deterministic inlet noise, unsupported features and invalid states. The no_std
square root is checked against `std` across the LES range and finite extremes.
Four fan checks use at most four steps on 7×7×7 grids: zero-inlet acceleration
along positive/negative axes and a rotated normal, periodic mass balance, solid
shielding and momentum/obstacle reaction balance, one half-force correction,
and invalid fan admission before writes. Native/WASM parity uses a separate
five-step 5×4×3 fan fixture in the ABI check. Nine thermal checks use 5×5×5 grids and at most four steps: isolated power/capacity,
heterogeneous interface energy exchange, fixed-wall ledger, uniform temperature
with nonuniform flow mass, open-boundary energy, conduction substep cap, combined
fan/buoyancy, and invalid/non-finite state rejection. Native/WASM parity includes
both solid-power and fixed-temperature modes, all four f64 fields, f32 flow,
12 statistics and display, using three thermal/fan steps on 5×4×3 cells.

The throughput benchmark is opt-in, never part of ordinary CI:

```sh
cargo bench --manifest-path crates/w-sim-kernels/Cargo.toml --bench stencils
```

It reports wall time per step and cell updates/second for 128 wave/heat steps on
a 512×512 grid and 32 D3Q19 BGK/LES steps on a 32×16×16 wind tunnel with one
solid cell, including output validation and boundary treatment. Results depend on the
host and compiler; they measure stencil throughput, not total job latency or
the physical accuracy of a CFD, thermal design, MD, or DFT solver.

The shared D3Q19 transport-link helper is forced inline in flow and heat loops.
Each thermal step computes its material-pair conductances once in a local
21×21 f64 table (3528 bytes), using the existing formula for each **ordered**
pair. This preserves contact-resistance addition order. Validation still runs
every step, including declared-material flags, conduction bounds and non-finite
state checks; no geometry/configuration state is cached across calls.

A manual 2026-09-09 check against `bf3e374` used the 128×64×64 heatsink flags,
4554 fixed-temperature solid cells, original dt/tau/viscosity and three steps per
run, pinned to CPU4 on a Ryzen 9 9950X. Three alternating runs gave median native
musl step times 225.52→207.15 ms (8.1% less), and Node22/V8 with `--no-liftoff`
255.85→221.95 ms (13.3% less). Native host-load variation was visible; these are
short kernel timings, not a completed 11208-step job or browser throughput claim.
Flow populations, velocity/density, all four thermal fields, and every step's
force/thermal statistics matched the old native and WASM artifacts bit for bit.
Small fixed/power/contact/slip/ground cases and a 16-material WASM case also
matched, including failure statuses and state after non-finite input, invalid
material flags, coefficient overflow and the thermal substep limit. These manual
comparisons do not run in normal CI or change any numerical tolerance.


## Reduced-unit TMz Yee fields

`fdtd::step_fdtd(&FdtdConfig, eps, optional_pec_mask, &mut FdtdBuffers)`
advances the existing product 2D TMz model: H, then E, PEC mask, outer boundary,
then the four Mur histories. `ez`, `hx`, `hy` and `eps` each have `nx*ny` f32
values at `j*nx+i`; left/right histories have `ny` values and bottom/top have
`nx`. All arithmetic is f64 followed by the same f32 stores as the previous
TypeScript implementation. `mu` is a uniform scalar, not a per-cell field.

Grid dimensions must be at least 3. Finite positive `dt`, `mu` and every `eps`
are required, with `2*dt² <= mu*min(eps)` in the existing normalized units
(c=epsilon0=mu0=dx=dy=1 in vacuum). This rejects material-dependent CFL violations
that the former unchecked frontend could accept. Fields and all histories must
be finite and exactly sized. Initial validation errors leave fields unchanged;
on arithmetic overflow discard the partially advanced state.

`FdtdBoundary::Pec` zeros all outer Ez cells and leaves histories unchanged.
`Mur` preserves the previous vacuum coefficient `(dt-1)/(dt+1)`, updates left/right
before bottom/top, and saves histories after both pairs. An outer cell included
in the optional PEC mask is subsequently governed by the outer boundary; this
existing ordering is intentional compatibility behavior, not a general mixed
boundary solver. The highest H row/column has zero forward difference and retains
its stored value. This is first-order Mur, not material-matched absorption, CPML,
3D electromagnetics, dispersive materials or an engineering validation result.

`add_soft_source(ez,nx,ny,x,y,amplitude)` performs f64 addition and one f32 store;
waveforms and preset arrays stay in the product's one preparation function.
`energy_fdtd(config,eps,ez,hx,hy)` evaluates the same f64 sampled diagnostic
`0.5*sum(eps*Ez²+mu*(Hx²+Hy²))`. The electric and magnetic fields are staggered in
time; this diagnostic is not an exactly conserved discrete energy invariant.

Six tiny Rust tests cover an analytic impulse, local permittivity, mask/walls,
Mur history ordering, validation and overflow. The WASM suite checks all field
and history bits and the energy against native Rust and
`wasm/fdtd-reference.json`, captured from the original TypeScript implementation
with nonzero fields, dielectric material, nonzero histories, mask and three
prepared source samples. It also rejects invalid memory ranges, aliases,
coefficients and non-finite state. No waveform or preset algorithm is duplicated
in the numerical core.

## Shifted Lennard-Jones molecular dynamics

The `md` entry points ending in `_md` implement homogeneous LJ particles in a periodic square/cube, with
epsilon=sigma=mass=kB=1. The current product uses 2D and rc=2.5; the helpers admit
dim=2 or 3 and finite positive cutoff, box length and timestep. There is no
global box>2*rc rule because existing small-box helpers use minimum image; the
product must enforce its own box/cutoff admission. This is not a charged,
multi-species or arbitrary force-field model. Initial lattice/random velocity
preparation remains in the product; no random generator or presets are copied.

`MdConfig { n, dim, dt, rc }` and `MdScalars { box_l, potential, virial,
last_temperature }` accompany `MdBuffers { pos, vel, force, unwrapped }`.
Each buffer contains n*dim f32 values in particle/axis order. `init_md` accepts
prepared position/velocity arrays, copies positions to unwrapped coordinates,
and computes force, potential, virial and initial temperature. It does not
replace the caller's independent initial-position reference used for MSD.
`compute_lj_forces` also supports finite positions outside the current box.

The core preserves pair i<j order, the JS minimum-image half-box tie toward
positive infinity, the original f64 r² calculation, displacement f32 store,
and each pair's immediate f32 force accumulation. Potential is shifted to zero
at the cutoff; force is truncated, not force-shifted. `step_md` performs the
existing half-kick, drift/wrap and unwrapped stores, force recalculation, and
half-kick. Coincident particles now fail instead of silently contributing no
force. Non-finite state/updates, invalid dimensions/lengths and unsupported
batch sizes also fail. A numerical error can partially write buffers; discard
the failed state. Positive dt admission alone does not guarantee MD stability.

`batch_md` accepts **1–4** steps. Its thermostat computes one batch scale from
the preceding batch temperature and distributes it across those steps; changing
batch boundaries changes this existing coupling rule. After every Verlet step
it scales velocity and then calls `barostat_md`, which applies the existing
Berendsen linear-scale clamp, scales box/position/unwrapped coordinates, leaves
velocity unchanged and recomputes forces. Missing target pressure, nonpositive
or NaN tau are no-ops; infinite positive tau also gives scale 1. Targets must
otherwise be finite; temperature is nonnegative, kappa is nonnegative, and
max_scale is in [0,1). These weak-coupling controls do not produce a rigorous
NPT ensemble.

`read_md` returns temperature, kinetic/potential/total energy, pressure, MSD,
box length, volume and density, plus f32 particle speeds. `radial_distribution`
uses the current box and f64 pair counts with f32 radius/g outputs.
`diffusion_einstein` fits actual history times after a fractional prefix skip.
NPT unwrapped positions include affine box scaling, so their MSD must not be
reported as a physical diffusion coefficient; the product retains its null
NPT diffusion result.

No_std roots reuse the bounded square root and add a bounded cube root for the
existing 1–4-step thermostat/2D–3D barostat. They can differ in low f64 bits from
JavaScript Math.pow. Tiny captured original-TS fixtures (four particles, batches
4/1/2/3) retain every f32 field/statistic-array bit. NVE/NVT scalar outputs are
identical; the observed largest NPT scalar difference is 3.42e-13 in the 3D
helper. This is migration evidence, not a global error bound or a validation of
long-time trajectories. Native and WASM built from this Rust core match every
field/statistic/RDF/diffusion bit across those fixtures.

Eight small integration tests cover pair/periodic forces, NVE energy and
momentum, partial thermostat batches, 2D/3D pressure scaling and force refresh,
unwrapped MSD, RDF/diffusion and invalid state. Unit checks compare bounded
roots with std and test both neighbors of positive/negative half-integer ties.

## User-defined heterogeneous particles

`md::{init_particles, step_particles, batch_particles, compute_particle_forces}`
reuse the MD pair iteration, Verlet, thermostat and observable calculations.
The only additional force source is the product's current heterogeneous LJ plus
screened Coulomb model. It has equal unit masses, periodic 2D/3D coordinates,
and user-supplied charge, sigma and epsilon arrays; production uses 2D/rc=2.5.
Species names/kinds and initial random preparation remain product data. There
are no hard-coded materials, bonds, hopping, washout, long-range Ewald terms,
pressure bath or force-field plugin API in this particle path.

Pass `ParticleProperties { charge, sigma, epsilon }` (three n-element f32
slices) and `ScreeningParams { eps_r, lambda_d, k_coulomb }` by reference.
All property/scalar values must be finite, sigma>0, epsilon>=0 and k_coulomb>=0.
Missing sigma/epsilon in an existing helper is represented by caller-provided
arrays of ones; no second homogeneous charged algorithm is introduced.
`batch_particles` additionally takes `Option<f64>` target temperature and
steps 1–4. The last partial batch preserves the same thermostat cadence as MD.
`read_particles` wraps the existing nine `MdObservables` in `.md` and adds
`.total_charge`, summing the prepared f32 charges in f64. The existing RDF and
diffusion functions operate directly on these particle positions/history.

Each pair uses sigma_ij=(sigma_i+sigma_j)/2 and
epsilon_ij=sqrt(epsilon_i*epsilon_j). LJ potential is shifted at the **total**
cutoff; Coulomb uses `C=k_coulomb*q_i*q_j/max(eps_r,1e-6)` and
`exp(-r/max(lambda_d,1e-6))`, with its own `r²=max(actual_r²,1e-8)` floor.
The force/virial retain the product's original floor formula and original r²;
the floor region is not a newly derived smooth conservative potential. Coulomb
is truncated at the same rc and is not shifted. Thus neither cutoff crossings
nor the soft-core floor imply exact Hamiltonian energy conservation. Positive
and negative finite eps_r/lambda_d retain the existing 1e-6 floor behavior.
Overlapping particles, non-finite arithmetic and invalid buffers fail explicitly.

The loop adds LJ potential first, then Coulomb, and accumulates the combined
force into each pair's f32 force stores, using f64 minimum-image r² and f32
displacement exactly as the original CPU implementation. The explicit zero-kC
case with unit sigma/epsilon retains the homogeneous MD result bitwise. No
separate particle Verlet or thermostat loop is maintained.

The no_std exponential handles only exp(-x), finite x>=0. It uses ln(2) range
reduction, an 18-term Taylor evaluation and exponent scaling; x>=746 rounds to
zero in f64. In exact arithmetic the reduced-series truncation bound is below
3e-26; this does not bound all floating-point error. Tests compare 7,461 samples
in [0,746], plus normal/subnormal transition and extreme inputs, with std::exp
using `abs(error) <= 2e-15*exp(-x) + smallest_f64_subnormal`. It is deterministic
between native/WASM, with no dependency or libm, but does not promise correctly
rounded results or bitwise agreement with every JavaScript Math.exp input.

Six tiny Rust tests exercise heterogeneity, charge signs/zero, Coulomb floors,
2D/3D periodic helpers, MD degeneration, NVE energy/momentum/charge and invalid
inputs. Five captured original CPU particle fixtures (four particles; 4/1/2/3
step batches) cover NVE/NVT, mixed/zero charges, kC=0 and the 3D helper. Their
arrays, ten statistics and RDF match native and WASM bitwise; the observed old
TS difference is also zero for these fixtures. This is bounded migration
evidence, not a long-trajectory or physical-material validation.

### Solid contact resistance

`parameters.thermalContacts?: LbmThermalContact[]` and prepared
`thermal.thermal.contacts` use `{first,second,resistanceM2KW}`. Material index 0 is
the default solid; 1–16 map to region array indices plus one. Up to 136 unordered
pairs are admitted. Indices must be distinct and resolve a shared voxel face;
edge/corner contact, nonexistent materials and reversed duplicates are rejected,
including explicitly configured zero resistance. Empty arrays behave as absent.
Only `solid-power` supports contacts; fluid-solid and fixed-reservoir faces retain
their existing boundary physics.

The area-normalized resistance R has units m² K/W. Each configured solid-solid
face has conductance `G = dx² / (dx/(2*k1) + R + dx/(2*k2))`, in W/K. R>0 adds a
passive interface resistance with no heat storage or source. The same single
face transfer is subtracted/added from the adjacent energies and its G enters the
existing positive-weight explicit CFL. R=0 uses the original harmonic expression
without changing its arithmetic. This is not a finite-thickness gap or interface
material, and does not model pressure-dependent or temperature-dependent contact.
Non-finite or unrepresentable positive conductance is rejected, not converted to
an insulating or perfect interface.

Rust `ThermalConfig` adds `[f64;136] contact_resistance` and `[u32;5] contact_mask`.
Zero-initialize both, then call `set_contact(first,second,R)`. For material indices
`lo<hi`, pair index is `hi*(hi-1)/2+lo`. A presence bit distinguishes explicit zero
from absence. Unused slots and high mask bits are zero. Core thermal functions,
face lookup, acceleration and display borrow the palette rather than copying it
per face/cell. `geometry::thermal_contact_faces` supplies the same contact mask to
native/WASM validation and product/GPU admission, with optional periodic wrapping.
No per-cell arrays are added; GPU uniform parameters expand to 1216 bytes.

Capabilities advertise the fixed `LBM_THERMAL_FEATURES` list through existing
`features`: `lbm-thermal-regions-v1` and `lbm-thermal-contacts-v1`.
`requiredLbmFeatures(spec)` infers requirements from actual nonempty input
arrays even when job requirements omit them. A legacy thermal-only capability
cannot match those jobs. Thermal GPU results also emit numeric `derived[feature]=1`
for both implemented features, allowing consuming Hosts to reject old-image
results that silently ignored new parameters. Hosts own claim/settlement checks.

Tiny tests cover analytic two-solid transfer, decreasing flux with R, source-free
energy conservation, zero-R field/CFL identity, face versus edge/wrapped contact,
invalid masks/values and native/WASM exact arrays and statistics. SwiftShader
checks positive/zero R against native under the existing FP32 tolerances; it also
checks GPU zero-R bit identity and rejects unresolved faces, duplicate pairs and
FP32-underflowing R. These are short correctness checks, not long-time or hardware
performance certification.

### 2D Stable Fluids and thermal convection

`fluid.rs` owns the existing product 2D solver: velocity diffusion (when enabled),
in-place Gauss–Seidel pressure projection, semi-Lagrangian velocity advection,
second projection, temperature advection, optional dye diffusion and dye advection.
Buoyancy acts toward -y for temperature above ambient. Solid-cell clearing is
performed at the original points in that sequence; it zeroes velocity and dye
without a body-fitted pressure projection or solid heat solve. Boundary cells
reflect the selected component; optional left velocity inlet/right pressure
outlet use the original face-average rule. Iteration order and f32 stores match
the original JS discretization, including retained scratch fields.

`FluidConfig` contains n, iterations, dt, viscosity, diffusion, thermal, buoyancy,
ambient and optional inlet_speed. `FluidBuffers` borrows ten disjoint f32 arrays:
`vx,vy,vx0,vy0,dens,dens0,p,div,scalar0,temp`. `step_fluid` takes config, mutable
buffers and optional u8 mask; any nonzero mask entry is solid. It allocates no
memory and retains the original necessary field copies into persistent scratch.
`advance_fluid` additionally takes `FluidSource` with optional `DyeInlet` and
`density_decay`/`temperature_cooling`. It replenishes the first two dye columns
before stepping, then applies density decay and temperature cooling once per step.
Disabled factors are one. Randomness and scene/seed preparation remain with the
product, outside the numerical core.

Teaching helpers `set_boundary`, `linear_solve`, `diffuse`, `project`, `advect`,
`apply_buoyancy` and `apply_obstacle` call the same numerical functions. Configs
require n>=3, integer iterations<=4096, finite nonnegative dt/viscosity/diffusion,
and finite signed inlet/buoyancy/ambient. Zero dt/iterations are permitted. Source
spacing is finite positive, width finite nonnegative, density finite, and
multipliers finite nonnegative. Inputs and stored outputs must remain finite;
errors discard the step rather than fabricate a stable result.

`read_fluid` returns peak_density, mean_density, max_speed, min_temperature,
max_temperature and max_divergence. Its speed uses shared sqrt(vx²+vy²), so the
last f64 ulps may differ from JS Math.hypot; native/WASM statistics are identical.
Divergence retains the grid-index central difference, not calibrated SI units.
This is the existing educational/advection model: semi-Lagrangian dye is not
strictly conservative, temperature has no conductive material energy accounting,
and the mask approximation is not the 3D LBM conjugate heat model.

The compressed `wasm/fixtures/fluid-original-ts.json.gz` records ten-field initial
conditions, terminal field SHA256s and statistics from original source SHA256
`47d2a7d2d98b41ba8050dff01a6ab67236f82188f7169d199e0b670619ac92b6`.
It contains no retained TS numerical implementation. Five captured cases use
N=8/9/12 for three steps and product N=100/110 for two; ten additional fixtures
cover teaching helpers. Every terminal field hash matches JS exactly and all
native/WASM fields and six statistics match byte for byte. Six tiny Rust tests
cover uniform transport, inlet/outlet faces, projection, source/decay ordering,
hot/cold buoyancy, invalid inputs and overflow. The ABI suite includes these
checks; it does not run long convergence or performance benchmarks.

### 2D Ising Monte Carlo

`ising.rs` is the allocation-free native/WASM implementation of the product's
periodic square lattice, nearest-neighbor ferromagnetic J=kB=1, zero field model.
Spins are exact i8 values ±1 in row-major order. Mulberry32 uses explicit wrapping
u32 arithmetic; a hot start draws once per spin and a cold start draws nothing.
Each Metropolis sweep makes N random-site attempts, drawing an acceptance value
only for positive ΔE. Heat-bath draws exactly two values per attempt. Updating
temperature retains spins and RNG. This is a Monte Carlo sweep, not physical time.

`IsingConfig { size, temperature }` and a borrowed spin slice are shared by
`init_ising`, `sweep_ising`, `read_ising` and `delta_energy`; `next_random` serves
existing callers of the state's random accessor. Optional persistent
`IsingMoments { n,m,abs_m,m2,e,e2 }` holds f64 sample sums. Reset occurs before a
sweep; sampling occurs after it. `read_ising` returns current absolute
magnetization, energy per spin and `IsingPoint` with signed/absolute sample means,
energy mean, specific heat, susceptibility and the infinite-lattice Onsager/Yang
reference. Means are absent for zero samples, fluctuation estimates for fewer
than two. Burn-in, temperature lists and storing completed points remain with
the caller. No allocation, state copying or alternative JS numerical path is
needed in each sweep.

Dimensions require integer size>=2 and N<=i32::MAX (the original random-site
index range); temperature must be finite positive. Spins, lengths and moment
counts/ranges are validated before mutation. Counts cannot exceed 2^53−1.
Invalid or overflowing statistics return errors; no NaN/null sentinel is stored.
Reference-only calls retain finite T<=0→1; nonfinite T is rejected. Fluctuation
helpers require finite means, N in 1..i32::MAX and finite positive T; intermediate
or output overflow/undefined division is rejected. These explicit bounds replace
old JS propagation of NaN or Infinity.

Boltzmann factors reuse the deterministic exp(-x) already used by screened
Coulomb (18-term range-reduced expansion, measured relative error <=2e-15 over
normal values; subnormal error at most one minimum subnormal ulp). The shared
implementation avoids platform libm. Heat-bath evaluates negative local fields
as e/(1+e), avoiding positive exponential overflow. Tc is the correctly rounded
constant 2/ln(1+sqrt(2)); the eighth root uses three shared square roots. Near Tc,
magnetization evaluates sinh(ac+δ)-1 with a short Taylor expansion and a factored
1−sinh⁻⁴ expression to avoid cancellation. Below T=.1 the deviation from unity
is below f64 rounding. The reference is an equilibrium infinite-lattice curve,
not a promise that finite lattices or short samples have equilibrated.

Nine compressed original-JS fixtures cover L8/16/24/32/48 and product L256,
hot/cold starts, seed0/u32max, both algorithms, temperature changes and sample
counts 0/1/many. Every captured spin, RNG state, moment and fluctuation statistic
matches the old JS exactly. Boltzmann rounding can in principle change an
accept/reject choice within the numerical error of a random threshold; fixtures
do not establish equality for every possible seed. Native/WASM entire state,
readout and references match byte for byte. Reference comparison with old
Math.sinh/pow differs by at most 9.23e-12 in these fixtures (at Tc−1e-6), where
subtraction is ill-conditioned; away from the immediate critical neighborhood,
2268 scalar std comparisons at T=.001..2.268 differ by <3e-13. Adjacent f64
values below/at Tc remain finite and obey the intended branch. No equilibration
or large performance benchmark runs in CI. Captured source SHA256:
`ba51a32bc73aae59e511cd545d35910ca462cbd8e0f16d3faaa66477a08bc363`.

### RLC, coupled coils, forced oscillator and FHN neuron

`ode.rs` migrates the four existing small ODE families into the same Rust library.
Every config, state and trajectory value is f64. `rlc_step` and `mutual_step`
share exactly the same two-variable RK4 arithmetic order. The oscillator keeps
its existing RK4 stage expressions, including the cosine drive at each stage.
The FHN neuron retains explicit Euler and its v−v³/3−w+I, 0.08(v+.7−.8w)
right-hand sides. No solver changes into a different integrator or physical model.

`advance_rlc`, `advance_mutual`, `advance_oscillator` and `advance_neuron` write
only the next states into borrowed output slices and update a persistent state.
They do not allocate or copy trajectories. The caller stores the initial point
and can divide work into bounded chunks for cancellation. Time comes from the
absolute step index times dt, retaining the original arithmetic across chunks.
Product parameters, initial conditions, output JSON and scheduling remain with
the product. Standalone teaching step functions and batch advances call the same
private numerical implementation.

Mutual inductance is clamped only for integration to |M|<=.99 sqrt(L1 L2).
`read_mutual.coupling` reports the requested raw M/sqrt(L1 L2), even above one,
as the old scalar helper does. The substep count is ceil(dt trace(L^-1 R)/2), at
least one, computed with the effective clamped matrix; product inputs are within
the clamp limit. This also makes out-of-product generic inputs use the actual
matrix for stability instead of a singular raw matrix. More than 65536 substeps
fails explicitly. A sine-driven batch samples V1 sin(omega t) at each substep
midpoint and holds that voltage throughout that RK4 substep. Constant mode uses
V1 and requires omega=0. Primary and secondary Joule dissipation retain the
original trapezoidal accumulation; secondary_share is E2/(E1+E2), or zero for
zero dissipation. This is a loaded coupled-inductor ODE, not a transformer core,
magnetic saturation or electromagnetic field solve.

Neuron batches take sorted unique u32 pulse starts and a nonnegative integer
pulse duration. An overlapping interval activates the same single stimulus
current; pulses do not add together. Each next voltage has a u8 marker equal to
one only for previous v<0 and next v>=0. Callers reconstruct spike step numbers
from these markers. `peak` reads a nonempty finite voltage slice, including the
initial point when required by the product.

Scalar readouts use the same Rust math as stepping: RLC omega0, damping ratio,
quality factor, damped frequency and energy; mutual coupling, turns ratio and
secondary voltage; oscillator natural frequency, steady-state amplitude and
resonance curve; neuron peak. Lossless RLC quality factor uses `Option::None` in
Rust and a zero value plus an explicit validity flag in WASM: product JSON keeps
null, while a mathematical teaching helper can reconstruct Infinity. Singular
oscillator steady-state amplitude is an error, never a fake finite peak.

Every step requires finite positive dt, finite states/coefficients, positive
L/C/mass and nonnegative circuit resistance, stiffness and damping. Oscillator
stepping allows a signed drive amplitude/frequency as before; amplitude/curve
helpers require nonnegative amplitude and frequency. Invalid steps now return
errors rather than the old oscillator no-op. Nonfinite helper values and empty
peak inputs now fail explicitly rather than propagate NaN/Infinity. An
integration overflow invalidates the step; a batch may have partial outputs and
must be discarded on error. There is no automatic time-step adjustment for RLC,
oscillator or FHN, so finite output alone is not a stability or accuracy proof.

Sine/cosine use deterministic split-pi/2 reduction and twelve Taylor terms,
without libm or new dependencies. The original split reduction applies through
|phase|<=262144 rad; the plane-wave migration adds fixed-point reduction for
larger finite phases (see below), so these no longer return UnsupportedFeature.
The ODE product maximum is below 263 rad.
8193 uniformly spaced phase comparisons through the original range, additional
quadrant/tiny-phase values and scaled-hypot large/small-magnitude checks pass
with absolute sine/cosine error <7e-16 and hypot relative error <=3 epsilon.
This is a tested bound, not a guarantee of correctly rounded transcendental
results for every input. Oscillator amplitude uses a scaled hypot to avoid
unnecessary overflow. Shared sqrt and these functions can differ in the final
bits from JS Math.sqrt/hypot/sin/cos; native and WASM remain identical.

`wasm/fixtures/ode-original-ts.json.gz` retains 26 old-JS value fixtures (source
hashes embedded), including positive/negative M clamps, k=.99 at n=.3 and n=3,
constant/midpoint-sine drive, oscillator stages and resonance, pulse overlap,
empty stimulus and upward spikes. Most trajectories contain three or four
steps; two neuron fixtures use 60/120 Euler steps to cross a pulse boundary and
observe a spike. Old RLC/neuron trajectories and statistics are exact; maximum
absolute differences are 4.45e-16 for mutual and 2.23e-16 for oscillator. Full
native/WASM trajectories, persistent dissipation, readouts, curves and spike
markers match byte for byte. Six small Rust tests cover conservation/decay,
chunk invariance, pulse semantics, numerical math and invalid inputs; ABI tests
also reject alias, alignment, bounds, count, flags and NaN. CI runs no long
settling, performance or large field simulation.

### 2D ray-optics lab

`optics.rs` owns the complete existing optical bench calculation: laser seeding,
component segments and intersections, reflection, Snell refraction/TIR, thin-lens
slope adjustment, Malus transmission, beam splitting, screen deposition and
profile reduction. All geometry, ray values and intensities use f64. Numeric
component indices replace UI identifiers in the core; adapters map indices to
the original IDs and format event notes. Presets, component defaults, labels,
colors and SVG display remain product data/presentation.

`init_trace` resets a caller-owned `OpticsState` and `OpticsBuffers`, prepares
geometry and seeds nine rays per laser in the original component/ray order.
`advance_trace` processes a bounded number of rays without allocations, using
a persistent LIFO stack. A splitter pushes transmission then reflection, so
reflection is processed first. Work counts popped rays, including discarded
low-intensity/over-bounce rays. Components/config and geometry must stay unchanged
between init and completion; reset after editing a scene. Init supports reuse:
used geometry, ray seeds, profiles and bins are overwritten/reset; segment/hit/
event counters reset so stale capacity is never part of a result. It does not
clear megabytes of unused output capacity. `read_trace` only accepts a completed
trace and calculates bin-order totals, first maximum bin and peak position.
Profiles and direct screen powers stay in first-hit order.

The original decisions and losses are retained: skip intensity<1e-4 and
bounces>maxBounces; parallel determinant cutoff 1e-12; intersection t>1e-4 and
segment tolerance 1e-6; fixed scene boundary [−40,1000]×[−40,600]. Mirror keeps
94%, TIR 95%, refraction 97%, lens 98%, polarizer Malus×98%, split branches 97%.
A splitter's creation threshold is branch fraction×incoming intensity>1e-5,
before loss; a polarizer absorbs at outgoing intensity<1e-5. Focal length
|f|<=1e-6 passes the ray without a lens event. Offset distances .4/.5 and the
original nearest-hit tie/order are preserved. Screen bins use clamped floor(sN).
These strict comparisons have not been softened to force reference agreement.

This remains geometric, incoherent, 2D ray optics. The thin lens uses paraxial
slopes. A single interface decides nFrom/nTo from the incident direction and
its normal, preserving the existing plane convention; there is no persistent
closed-volume medium index. Loss factors are teaching-model constants, not
Fresnel coefficients. Wave phase, interference, diffraction, polarization
ellipses and engineering lens tolerances are not claimed by this solver.

At most 64 components, maxBounces 0..20000 and screenBins 1..4096 are admitted.
Caller storage has 20576 stack slots (20000+64×9), and 20000 segment/hit/event
slots each, with component-count geometry/profile slots and component-count×bins
f64 intensities. The worst pending stack is bounded by initial seeds plus
processed rays. Attempting ray 20001 returns `KernelError::RayLimitExceeded`
(WASM status8), with a specific message; no truncated result is published.
Other invalid dimensions, memory, flags, nonfinite inputs/outputs and overflowing
arithmetic fail explicitly. Zero components and zero source power are valid;
zero bins and empty/invalid work budgets are not. Finite nonnegative length and
power, positive wavelength and index are required. Public components use
explicit, already resolved defaults; generic splitT retains the original clamp.

The numerical helpers are the same functions used by tracing: unit direction,
normalization, reflection/refraction, incidence angle, Malus factor, component
segment, intersection and seeding. A length<=1e-12 direction retains the original
(1,0) normalization fallback. The sine/cosine and scaled hypot introduced for
ODE are now shared crate functions; existing ODE fixtures remain unchanged.
Incidence uses deterministic acos built from sqrt and an angle-reduced atan
series, with <7e-16 rad error in 1001 uniform unit-domain std comparisons plus
critical endpoint neighbors. There are no libm imports or new dependencies.
Angle conversion and UI summing of saved screenPower values can remain adapter
presentation operations.

`wasm/fixtures/optics-original-ts.json.gz` captures 21 whole scenes and 47 helpers
from old source SHA256
`2cbb589a45071d9395d1de37de7b7fd69d6853b3e1d7508dd8c8e315d42519a1`.
It includes all nine presets, zero/negative lens focal length, splitter0/1/.02,
crossed polarizers, blocker, TIR, bounce limit0, one-bin screens, zero power,
empty scene, two sources and adjacent f64 critical-angle helper inputs.
Segments/hits/events/profiles counts, interaction types and component order,
refraction-null/TIR branches, first-hit screen order, every hit's bin and peakBin
are checked strictly. Native/WASM every numeric record, helper output and
counter are byte-identical; one-/seven-/large-chunk progression and resetting
preserve order/results. Maximum observed old-JS differences are 6.83e-13 in
coordinates, 8.89e-14 degrees and 8.33e-17 in power. One TIR event's angle is
51.25° within last-bit error: old toFixed(1) shows 51.3, current 51.2. Its numeric
value and physical path remain equivalent; no bias is added to reproduce a UI
rounding tie. Near an untested exact geometric/critical threshold, floating-point
rounding can in principle change a branch; these fixtures are bounded evidence,
not a promise of identical topology for every possible scene.

## Analytic plane waves and large phases

`plane.rs` supplies the electromagnetic/sound plane-wave observations and field
samples, and the existing 140-point 3D EM view. These are analytic monochromatic
homogeneous fields, not additional Maxwell or acoustic grid solvers. All inputs,
samples and observations use FP64. Configs, arrays and readouts are caller-owned;
changing time requires no new kernel instance or per-sample allocation.

- `EmConfig {frequency_hz,refractive_index,e_peak,phase0}`;
  `em_observables(&config)` returns wavelength_m, phase_velocity, impedance,
  b_peak, intensity_w_m2. `sample_em(&config,time,xs,e,b)` overwrites both arrays.
- `AcousticConfig {frequency_hz,rho,c,p_peak,phase0}`;
  `acoustic_observables(&config)` returns wavelength_m, impedance, v_peak,
  intensity_w_m2. `sample_acoustic(&config,time,xs,pressure,velocity)` overwrites
  both arrays. Sample slice lengths must match, and may be zero.
- `Em3dConfig {wave_number,amplitude,time}`;
  `em3d_fields(&config,z,ey,cbx)` requires exactly 140 elements per array and
  returns wavelength. It retains `z=-14+2*14*i/(140-1)`,
  `ey=amplitude*sin(wave_number*(z-time))`, `cbx=-ey`, including signed zero.
- `phase_sin_cos(angle)` exposes the same deterministic math for direct audits.

Frequency, density, sound speed and wave number must be positive; refractive
index >=1 and amplitude/peak >=0. Configs/time/coordinates must be finite.
Signed finite time and phase remain valid for numerical helpers; the product's
nonnegative time validation remains at its input boundary. Nonfinite phase or
intermediate arithmetic overflow explicitly fails, including observations whose
`peak*peak` or `2*impedance` overflows. A numerical error may leave a written
output prefix, which must be discarded. Finite accepted product inputs are not
narrowed: f<=1e20, |x|<=1e20, t<=1e6 and acoustic c>=1e-6 produce phases around
6e46 and are supported. The phase remains exactly the original f64 operation
order `k*x - omega*time + phase0`; reduction cannot recover precision already
lost while constructing that phase.

`phase.rs` extends shared sine/cosine to all finite binary64 angles. Above 2^18,
the exact integer product of the 53-bit significand and a 1664-bit 2/pi table
retains the quadrant and fractional remainder. A 106-bit fractional extraction
and split pi/2 product feed the same twelve-term reduced Taylor loop. Native and
WASM use the same integer/f64 operations without FMA, platform libm or imports.
This follows the fractional-product reduction method described in
[Sun fdlibm's original `k_rem_pio2.c`](https://www.netlib.org/fdlibm/k_rem_pio2.c).
The implementation/table are independently generated, not copied fdlibm code.
The constant truncation contributes <2^-640 at the largest finite binary64;
floating-point evaluation dominates the observed error.

The existing <=2^18 reduction and arithmetic order are unchanged. The 266
captured previous-WASM direction records in `phase-small-wasm.json.gz` remain
byte-identical, alongside all prior ODE/optics regressions. For the new path,
`wasm/generate-phase-oracle.py` uses only Python's standard-library Decimal at
720 digits: Chudnovsky pi is cross-checked against Gauss-Legendre AGM through
700 decimal places and both produce the identical 1664-bit table. Its oracle
uses high-precision remainder and Taylor, independently of the Rust integer
reducer. Regeneration is opt-in:

```sh
python3 crates/w-sim-kernels/wasm/generate-phase-oracle.py
node crates/w-sim-kernels/wasm/plane-tests.mjs
```

The 498 saved oracle phases include signs/quadrants, neighbors of 2^18,
near large pi/2 multiples, subnormal inputs, deterministic random exponent/
significand pairs and f64::MAX. Maximum observed absolute error is 2.23e-16;
above 2^18 it is at most 2 ULP (test limits 7e-16 and 4 ULP). These are measured
finite fixtures, not a claim of correctly rounded transcendental results for
every binary64 input. Every oracle/native/WASM output pair is byte-identical.

`plane-original-ts.json.gz` captures 20 old-JS plane-wave cases from source SHA256
`25974e028efedd387991d8894a7710d8db2782ffea73a619c959600230f0ccf9`.
Native/WASM entire fields and readouts match exactly, including repeat sampling
on one memory owner. Maximum `abs(error)/max(1,abs(reference))` against JS is
4.18e-16; maximum absolute EM/acoustic/3D differences are 1.17e-10, 128 and
8.89e-16. The acoustic absolute difference occurs for a velocity around 1e18
at the admitted low impedance, and corresponds to 1.88e-16 scaled error.
Invalid config, coordinates, overflow, pointer alignment/range and alias cases
fail explicitly; JSON transport can remove the sign of zero and is outside the
byte-level kernel comparison.

## Antennas, Friis links and uniform phased arrays

`antenna.rs` implements the existing analytic far-field antenna modules in FP64:
isotropic, half-wave dipole and cos^20 directional field patterns; nominal
directivity; half-power angular scans; Friis loss/received power; polarization;
and uniform linear-array summation. These remain ideal free-space models, not a
new full-wave electromagnetic or measured-antenna solver. All fields/scan
scratch/readouts are caller-owned and reusable without per-call allocations.

The native product calls are `antenna_link(&AntennaLinkConfig,pattern361,powers121)`,
`antenna_3d(&Antenna3dConfig,pattern49)`, and
`array_result(&ArrayConfig,pattern361,scan2001,phasesN,grating20)`. Array pattern
and scan records are interleaved `ArraySample {theta,gain}` f64s. The first two
return their complete scalar readouts, the third returns width, clipping and
grating count. The grating buffer tail is explicitly reset to zero on reuse;
only its first `grating_count` values belong in the public result. No new JSON
shape is imposed by this numerical crate; ABI layouts are in `wasm/README.md`.

The same numerical functions serve the public scalar/batch helpers:
`pattern_2d`, `dipole_power`, `directivity_db`, `antenna_beamwidth`, `friis_link`,
`polarization_loss`, `array_factor`, `array_pattern`, `array_beamwidth` and
`grating_lobes`. The original math and operation order are retained: Friis forms
`(4*pi*distance*frequency)/c` before log10; angular grids retain their original
multiply/divide order; antenna beamwidth advances theta by repeated .0005-rad
addition. The phased array still sums real/imaginary terms in increasing
element order, computes all 2001 scan samples, rounds the requested steering
index with the same JS ties-to-positive-infinity helper, and scans down/up from
that index. It does not select a sampled grating-lobe maximum or substitute a
closed-form array factor. The first phase, and all phases at zero steering, are
explicit positive zeros as before. Grating detection retains m=-10..10 excluding
zero, inclusive visible interval tests and ascending output (at most 20).

The full-array product requires 2<=N<=48; scalar/batch helpers allow integer
0<=N<=4096. N=0 keeps the original zero array factor; d=0 keeps the all-in-phase
array and empty grating list. Finite signed spacing/steering remain meaningful
in the generic helpers. Sample buffers require at least two records; the JS
adapter normalizes its legacy `max(2,floor(samples))` size before reserving them.
Frequency and distance must be positive, all scalar inputs finite, antenna kind
0/1/2 and reserved fields zero. Product frequency/distance/power/gain/elevation/
polarization/spacing/steering admission ranges remain unchanged in WaveWorld.
Nonfinite arithmetic now fails explicitly instead of yielding an apparently
successful NaN result. An error can leave a written prefix: discard that call's
outputs. Subnormal spacing whose grating orders fall outside the visible
interval produces no lobes, as before.

`Antenna3dReadout.pr_dbm` is `Option<f64>`: exactly 90-degree polarization or a
dipole axial zero gives `None`. The WASM readout carries value0 plus a defined
flag, never a NaN sentinel. The generic polarization helper still returns cos²
without imposing a special 90-degree zero on unrelated helper inputs.

Deterministic math reuses the existing shared sine/cosine, sqrt, hypot, atan and
exp(-x). Directional cos^20 uses finite integer squaring. For log10 the positive
binary64 argument is split into its exact binary exponent and a mantissa around
one, then a 24-term `2*atanh((m-1)/(m+1))` series is evaluated; this uses the
identity and range described in [Sun's original logarithm method](https://www.netlib.org/fdlibm/e_log.c),
without copying its approximation coefficients. The link curve's required
10^x, x in [0,5], reuses exp(-x*ln10) via reciprocal. Asin reuses the existing
atan series and sqrt with an endpoint-safe argument, rather than introducing
platform libm calls. `math_value(0/1/2,x)` and `antenna_math` expose exactly these
log10/pow10/asin implementations for independent numerical audits.

`wasm/generate-antenna-oracle.py` generates 474 independent 190-digit Decimal
log10, power and inverse-sine references. It uses Decimal log10/power and a
direct asin series with the half-angle identity described in
[Sun's original asin method](https://www.netlib.org/fdlibm/e_asin.c), rather than
the Rust atan formulation. High-precision pi is recovered from the preceding
phase oracle's independently cross-checked 1664-bit constant (over 500 decimal
digits). Tests include subnormal/max finite log inputs, neighbors of one and
sqrt(2), every link-curve exponent, asin endpoints and their adjacent f64s.
Measured maximum errors are 2.20e-16 for log10 scaled by max(1,abs(reference)),
2.48e-15 relative for 10^x, and 2.23e-16 scaled for asin. The tests admit 7e-16,
4e-15 and 7e-16 respectively; these are tested error bounds, not universal
correct-rounding claims.

`antenna-original-ts.json.gz` preserves 39 complete old-JS scenes and 57 helpers,
including all antenna types, product input endpoints, axial/orthogonal nulls,
near-null finite power, clipped steering, coincident and grating peaks, N0/1
helpers, zero spacing and a 20-lobe helper. Source SHA256 values:
`b4a069b81315051ee70515465d14b97e99a6669d425380ce6dcc7c380de2daec`
(antennalink), `5efc2b1fe285d17d7adcc0ebf9a05b6972c25376d56b25eecd5037bf9f3edca5`
(antenna), `e6d72547f8c0250e423c2e9219706bb9d61078e4f61def767dab4fae56ce0c16`
(phasedarray). 111 product/helper native/WASM executions and all 474 oracle
outputs are byte-identical, including full scan buffers. Width/clipping,
grating counts/order and null decisions match the captured values strictly.
Maximum old-JS absolute differences: 6.37e-15 pattern amplitude, 5.69e-14 normal
link dB/array values, 5.00e-10 dB for nearly axial/orthogonal but nonzero power.
The latter amplifies the existing small-angle trigonometric final-bit error
through log10; no null/non-null decision changes in the reference cases.
Existing ODE/optics/plane-wave fixtures remain unchanged.

```sh
python3 crates/w-sim-kernels/wasm/generate-antenna-oracle.py
node crates/w-sim-kernels/wasm/antenna-tests.mjs
```

## Radar scene, laser rate equations and nonlinear junctions

`radar.rs`, `laser.rs` and `nljd.rs` provide the existing product models through
the same native and WASM functions. The radar scene is a reduced-unit scalar
wave demonstration with fixed obstacles; its separate free-space range equation
does not calibrate that field into a radar cross-section solver. Laser uses the
existing two-state rate equations, and NLJD uses a cubic response and harmonic
classification heuristic. This migration does not add electromagnetic material
identification, laser cavity geometry or an experimental accuracy claim.

Radar owns no allocation: `init_radar(&RadarConfig,&mut RadarState,&mut
RadarBuffers)` resets two 200×200 f32 fields, a u8 mask, and four channel-major
256-value f64 rings. `advance_radar(...,count)` calls the existing `seed_wave`
and `step_wave` kernels, retaining mixed precision and source-before-step order.
The current field is selected by `state.current`, without copying whole fields.
CW sets both time levels at TX=[24,100]; pulse deposits the original radius-2
Gaussian impulses at phases 0..5 of each 220-step cycle. Wave coefficients remain
.22 and .9985. Three inclusive obstacle rectangles are exported as `TARGETS`;
`radar_mask` exposes the same fixed geometry for numerical callers.

`RadarConfig` accepts total_steps1..2000, mode0=pulse/1=CW and four linear probe
indices, with `NO_PROBE` for absent channels. Advance accepts count1..64 and
rejects advancing beyond total_steps. Sampling occurs after each even completed
step and after a final odd step, independently of chunk boundaries. Ring heads
point to the oldest sample. `read_radar` returns four optional `{v,pp}` records,
using the last sample and peak-to-peak value over the active history. Empty
channels return `None`, never a fabricated measurement. Configuration and probe
changes require reinitialization; init fully resets reused buffers and state.

`RadarRangeParams` and `radar_max_range`, `radar_received_power`,
`radar_wavelength`, `radar_power_ratio_double_range` retain the free-space
inverse-fourth-power model. Actual physical inputs must be finite and positive;
received power ignores the unused sensitivity field. The numerator multiplication
order is unchanged. Small integer powers use multiplication, and the fourth
root uses two shared square roots instead of platform pow.

Laser's `laser_step(&LaserParams,&mut LaserState,pump,dt)` and
`laser_advance(&LaserConfig,&mut LaserState,count)` share the original Euler
update, with both derivatives evaluated from the preceding state and finite
negative next values clamped to zero. Tau values and B must be positive;
spontaneous emission, pump and both state values must be nonnegative; all must
be finite and dt positive. A batch accepts 1..65536 steps, so UI/Agent callers
can use their existing smaller chunks and final partial batches. Overflow is
rejected before the nonnegative clamp: an infinite derivative must not turn
into an apparently successful zero population. `threshold_pump`,
`steady_photons` and `laser_characteristics` use the same deterministic sqrt/
hypot functions. Characteristics fills exactly 51 caller-owned `LaserPoint`
records and returns threshold, pump_max and steady_photons; it uses the analytic
steady solution rather than running a convergence loop. The existing zero-pump
or zero-spontaneous-emission branch remains zero.

NLJD exposes `diode_response`, `harmonic_amplitudes`, `junction_coefficients`,
`harmonics`, `classify` and `nljd_result`. The full result fills exactly 81 f64
transfer samples and returns coefficients, harmonic amplitudes, relative
amplitudes and the verdict code. Codes are semiconductor0, corrosion1, metal2.
Custom finite signed cubic coefficients remain supported. Classification
requires finite nonnegative harmonic amplitudes and retains the strict 1e-3
metal threshold and second/third harmonic tie behavior. Invalid kinds, inputs,
buffer lengths or arithmetic overflow fail explicitly. A failed batch or curve
can leave a written prefix; discard its output before reset/reuse.

`wasm/fixtures/detection-original-ts.json.gz` preserves 43 cases from the original
WaveWorld sources, captured before replacing their numerical code. Source SHA256:
`ef11145c41d2fbd21c2da5ce881b0c8b0e90efb7c98dc958503708a30e4862ab`
(radar-algos), `fe2e2da972bc3abca165aec64354eff8d2b8eb45f9e80a55752568d907bacd79`
(laser), `4b65258c2464c5b401227b4276000d0c81b640a5313105158210024fad9c67e9`
(nljd). Radar's old scene/source/history code already called the shared wave
kernel: capture used that existing WASM artifact, source hash
`5a05c974c85dec410a7f0b32866ec64296ce9a4bb3aa6dd22288057bbd0b67e5`,
through a temporary memory adapter. No duplicate JS wave stencil was introduced.
The fixture also records the old mask. The full-ring case starts from a saved
synthetic 512-step checkpoint and advances only three steps; it does not run a
long simulation in CI.

All 43 native/WASM cases match exactly, including full fields, rings, readouts,
reset, 2-versus-8-step radar chunks and partial laser batches. Captured radar
f32 fields/traces, laser trajectories and NLJD outputs are unchanged. Maximum
observed old-JS differences are 1.01e-15 relative for range helpers and 1.43e-14
absolute for laser analytic steady values. These measured final-bit differences
come from deterministic root/hypot and integer-power evaluation; no reference
sampling, null or classification decision changes. Eight new Rust semantic
tests bring the crate suite to 100; strict Clippy, the complete prior WASM
regression and source/artifact consistency checks pass. No new dependency,
benchmark, convergence run or GPU path is needed for these models.

```sh
node crates/w-sim-kernels/wasm/detection-tests.mjs
```

## Calibrated spatial array sensing and reconstruction

`sensing::sense_array` implements one static FP64 linear sensing experiment;
`sense_array_sampled` adds optional serial RC sampling as described below:
input x[N], calibrated sensing matrix S[K,N] in V/input-unit, bias b[K] in V,
dimensionless encoding C[M,K], and seeded voltage noise. The caller supplies S;
the core does not infer it from structure, material, elasticity or conductivity.
It is neither finite-element mechanics nor electrical impedance tomography.
Geometry/grid layout and unit labels belong to the consuming product. The input
is constant during a scan; there is no evolving structure, nonlinear material
response or calibration fitting here.

The forward and decoding equations are:

```text
v = S*x + b
y = C*v + uniform(-noisePeakV, +noisePeakV)
A = C*S, z = y - C*b
minimize ||A*xReconstructed - z||² + lambda*||xReconstructed||²
```

Direct encoding is the identity. Normalized Sylvester Hadamard encoding requires
K to be a power of two, with M=K and `C[i,j]=(-1)^popcount(i&j)/sqrt(K)`.
It has the orthogonality normalization described in the
[MathWorks Hadamard definition](https://www.mathworks.com/help/matlab/ref/hadamard.html).
Custom encoding accepts a caller-supplied M×K matrix. All matrices use row-major
storage and increasing inner-index accumulation order. Each call restarts the
shared Mulberry32 RNG from config.seed and draws once per measurement, including
when noisePeakV=0. Noise is `(2*draw-1)*noisePeakV`, added after encoding. This is
independent measurement noise, not a model of correlated sensor noise. Reusing
buffers and repeating the same inputs reproduces the entire result exactly.

Reconstruction uses Householder QR with column pivoting and freshly recomputed
trailing-column norms at each pivot. Ties retain the first current column;
Householder transformations apply directly to the right-hand side. Q and the
normal equations AᵀA are never formed. This is a small, unblocked implementation
of the factorization described by [LAPACK's QR with column pivoting guide](https://netlib.org/lapack/lug/node42.html),
implemented here without copying its source or adding dependencies. Norms reuse
the existing deterministic scaled hypot/sqrt functions.

The reported rank always belongs to the original A. Its absolute threshold is
`epsilon_f64 * max(M,N) * firstPivotColumnNorm`; rank counts QR diagonal magnitudes
strictly above it. This is an explicitly chosen numerical-rank criterion, not an
SVD rank or a condition-number estimate. At lambda=0, rank<N returns status1:
forward voltages, encoding, measurements and rank remain valid, but reconstruction,
error and both RMS metrics are absent. Their native/ABI buffer slots are cleared
to zero only as undefined storage; adapters must publish null/absence. In
particular, underdetermined systems do not return a fabricated unique solution.
Minimum-norm solutions would require additional orthogonal-factorization/SVD
work outside this scope, as distinguished in [LAPACK's least-squares guide](https://www.netlib.org/lapack/lug/node27.html).

Positive lambda solves the augmented system `[A; sqrt(lambda)*I]` with right-hand
side `[z;0]`, using the same QR routine, and returns status2 (regularized). Original
rank/threshold remain in the readout. If the augmented matrix is itself numerically
rank-deficient at its own scale, the call fails with InvalidState/ABI status5;
it must not publish a finite but unreliable regularized solution. For example,
duplicate sensing rows [1,2] and [2,4] with lambda=1e-30 are rejected. There is no
fixed minimum lambda or automatic rescaling of the user's lambda: even the
smallest positive f64 works for A=0, whose regularized minimizer is zero.

Status0 means unregularized reconstruction is available. Available errors are
`xReconstructed-x`; RMSE is in the input's unit, and residual RMS is
`||A*xReconstructed-z||/sqrt(M)` in volts, excluding the ridge penalty. Lambda
has units consistent with squared V/input-unit. Regularization changes the
solution and does not create information or guarantee recovery of the original
input. Large offsets, ill-conditioning, cancellation or coefficients near the
limits of FP64 can still lose accuracy; rank threshold is a guard, not an error
bound. The forward and decode calculations retain actual finite roundoff rather
than replacing noisy or biased measurements with the known original input.

The native call is `sense_array(&SensingConfig,input,sensing,bias,custom_code,
&mut SensingBuffers) -> Result<SensingReadout,KernelError>`. Call
`config.dimensions()` before reserving buffers; it returns (N,K,M). Bounds are
N1..64, K1..64 and M1..128. Direct/Hadamard require M=K; only custom accepts a
separate measurement count. Input, sensing, bias and custom encoding values
must be finite with absolute value<=1e6; noisePeakV and lambda must be finite in
[0,1e6]. A custom matrix is required only for custom encoding and forbidden for
other modes. Unknown modes, reserved bits, wrong lengths, nonfinite data,
overflow and unresolvable augmented rank fail explicitly. An error invalidates
all outputs; the caller can correct inputs and reuse the same buffers.

Persistent buffers contain encoding M*K, sensor_voltages K, measurements M,
reconstructed N, error N, QR work (M+N)*N and RHS work M+N f64 values, plus N u32
permutation entries. Inputs and outputs/work must not alias. The largest custom
case uses 267520 bytes for inputs and these buffers, excluding ABI headers and
the existing WASM runtime. QR work is reused for the original rank and augmented
solve; there are no per-call allocations or full-trajectory copies.

Nine Rust semantic tests and 19 native/WASM cases check hand-derived 2×2 inverse
and bias, normalized H4, custom rectangular matrices, noisy overdetermined
least squares, underdetermined/zero-rank absence, diagonal/underdetermined ridge,
near-collinear matrices at several scales, seeded reuse, and malformed memory/
input/overflow. The noisy 2-variable overdetermined reference uses its independent
closed-form 2×2 inverse; it does not duplicate the QR algorithm. One sparse
64-input/64-sensor/128-measurement smoke exercises capacities without an iteration
or convergence loop. All output and QR-work bytes match native/WASM exactly.
The crate now passes 109 Rust tests, strict Clippy, the complete previous ABI
regression, TypeScript build and source/artifact consistency checks.

```sh
node crates/w-sim-kernels/wasm/sensing-tests.mjs
```

## Serial RC sampling and RC/RL transients

`sense_array_sampled` uses the same sensing/encoding/QR implementation and adds
one shared RC front end. Each row of C is selected in increasing row order for
one dwell interval. The spatial input remains constant during the complete scan.
For target `u[j]=C[j]*(S*x+b)`, initial capacitor voltage v0, tau=R*C, and
q=1-exp(-dwell/tau), the noiseless sample satisfies
`sample[j]=exp(-dwell/tau)*sample[j-1]+q*u[j]`, starting from sample[-1]=v0.
The core stores both ideal target and noiseless sampled voltages. Only then is
the existing seeded measurement noise added. This noise never feeds back into
the capacitor state, and each repeated call begins again at v0/config.seed.

Decoding uses the same causal filter, including its initial condition:
`A[j]=filter(A[j-1],C[j]*S)` with A[-1]=0 and
`baseline[j]=filter(baseline[j-1],C[j]*b)` with baseline[-1]=v0.
The QR right-hand side is measured[j]-baseline[j]. Rank/threshold and residual
refer to this actual filtered A, and positive lambda regularizes this same A.
The original C is still returned as encoding; no ideal-C inverse is applied to
the sampled voltage. Original rank deficiency and all prior absence/error rules
remain explicit. The caller's existing QR/RHS work is reused for the filtered
operator, the augmented solve and post-solve residual; no second matrix buffer
or solver is allocated.

The native extension is `sense_array_sampled(p,input,sensing,bias,custom_code,
buffers,sampling) -> Result<SampledSensingReadout,KernelError>`.
`SensingSampling` supplies optional `&RcSamplingConfig` and two M-element f64
buffers: ideal_voltages and sampled_voltages. RcSamplingConfig contains
resistance [ohm], capacitance [F], dwell [s] and initial_voltage [V]. Its admitted
ranges are 1e-3..1e12 ohm, 1e-15..1 F, 1e-12..1e3 s and +/-1e6 V, all finite.
`SampledSensingReadout` contains the previous sensing readout plus
settling_fraction, decay and tau. With no RC they are exactly1,0,0, and both new
voltage arrays equal the ideal targets. The legacy native/ABI entry is only a
thin boundary calling the same internal function with no sampling configuration;
its complete output and scratch patterns remain unchanged.

This is a single dominant-pole front-end model. Its motivation and limitations
match the first-order settling approximation discussed in
[Analog Devices' multichannel DAQ settling article](https://www.analog.com/en/resources/analog-dialogue/articles/performance-optimization-of-multichannel-data-acquisition-daq-systems.html).
It does not include ADC quantization, charge injection, parasitic charge sharing,
multiple amplifier poles, saturation or time-varying input within a dwell.
Those effects must not be inferred from the readout. Very short dwell can amplify
measurement noise during reconstruction; a large initial voltage can also hide
tiny changes below FP64 resolution. The reported reconstruction error reflects
that loss rather than substituting the known input as a perfect reconstruction.

`transient.rs` supplies the shared deterministic first-order math. For
0<=time/tau<=1 it evaluates q with a 24-term Horner series, avoiding subtraction
of nearly equal values. Beyond that range q is computed from the existing
exp_negative; exponentially underflowed decay is exactly0. This includes a
finite positive time/tau whose ratio exceeds finite f64, since the analytic
decay has already underflowed. Time constants themselves must be positive and
finite; zero, underflowed or overflowing R*C/L/R are rejected. Sampling uses
`previous+q*(target-previous)` for q<=.5 and the equivalent
`target+decay*(previous-target)` otherwise. The same operation is used for the
actual sample, every matrix coefficient and the baseline. No dwell or physical
parameter is silently clamped or replaced by an integration timestep.

Public transient helpers are `time_constant_rc`, `time_constant_rl`,
`rc_charge`, `rc_discharge`, `rl_current`, and `first_order_weights`.
They accept finite nonnegative time, finite signed voltage and positive finite
R/C/L. `TransientConfig {mode,reserved,v0,r,c,l}` and `transient_result` fill
exactly241 analytic samples spanning 0..5*tau and return tau, y_max and steady.
Mode0 is RC charge, mode1 RC discharge, mode2 RL current. The old sampling-time
expression `5*tau*i/240` is retained. `FirstOrderConfig
{voltage,resistance,capacitance,dt}`, `first_order_step` and
`first_order_advance` retain the separate teaching helper's original RK4 order,
with dt>0 and batch count1..65536; RC array sampling always uses the analytic
transition. Invalid/nonfinite input and overflowing updates fail rather than
publishing NaN or infinity; failed batches may contain a written prefix.

`transient-original-ts.json.gz` captures nine complete original curves, twelve
helper sets and three four-step RK4 traces from WaveWorld source SHA256
`e37987c01f7401392ba76362db60a3f3e71555f9ffcfe995f1fcf23802ef8225`.
All native/WASM arrays/readouts match exactly; the old RK4 bits remain unchanged.
The maximum old analytic absolute difference is 3.56e-15. Eleven independent
expm1 references (including neighboring branch values and ratio1e-24) show
maximum observed settling relative error1.76e-16. These are fixture measurements,
not a universal correctly-rounded math claim. Eleven serial-RC cases cover tau,
sign changes, finite initial voltage/bias, tiny/large dwell, noise isolation,
rank deficiency, ridge, aliases and invalid parameters. The nineteen static
cases additionally match saved complete-output/work hashes from the previously
committed artifact `a0abc7c964b7858c0464ce1e6c92dac27e0c758b398079eda7d4e0df804cb789`.
There are 117 passing Rust tests in total; strict Clippy, prior ABI regression,
TypeScript build and source/artifact checks pass without long convergence runs.

```sh
node crates/w-sim-kernels/wasm/rc-sampling-tests.mjs
node crates/w-sim-kernels/wasm/transient-tests.mjs
```

## Faraday induction

`faraday.rs` implements the existing SI analytic induction model: Lenz-sign
EMF `-N*dPhi/dt`, perpendicular motional EMF `B*length*velocity`, and the flux
linkage/EMF of a uniformly rotating coil in a uniform prescribed magnetic field.
It adds no field/material solver, loading, eddy-current loss or motor dynamics.
The recorded vacuum-permeability constant is not used in these B-input formulas.

`faraday_result(&FaradayConfig,flux361,emf361)` fills two caller-owned f64 arrays
and returns peak, linkage, motional_emf, frequency and period. The config fields
are omega, b, n, area, v_bar, b_mot and l_bar. Frequency remains omega/(2*pi),
period remains its reciprocal, and each time is formed as `2*period*i/360`
before computing omega*time. Endpoints include two complete periods. The shared
deterministic sin_cos is reused; the phase is not replaced with a simplified
index formula. All state/outputs and arithmetic are FP64, with no per-call
allocation or host math imports.

`induced_emf`, `motional_emf`, `rotating_coil_flux`, `rotating_coil_emf` and
`peak_emf` expose the same scalar formulas for teaching callers. They retain
finite signed inputs and multiplication order, including zero-turn/zero-speed
cases. `emf_from_flux_series(flux,dt,n,out)` uses forward/backward differences at
the endpoints and centered differences inside. Input flux is single-turn flux;
use n=1 for a series already containing total linkage. Empty series produce
empty output and a singleton retains `-N*0`, including the negative-zero sign.
The finite positive dt and equal input/output lengths are checked even for empty
series. Full product curves require omega>0, while general rotating helpers also
allow finite zero/signed omega. The product's original SI ranges and integer-turn
admission remain in its adapter. Nonfinite input, intermediate overflow, bad
lengths and invalid memory return an explicit error; discard failed outputs.

`faraday-original-ts.json.gz` was captured before replacing WaveWorld source
SHA256 `68099ba09dc95394981606aa1fa7c86049bfc360b635cc88d946dd678f8d83ed`.
Its 17 cases contain three complete 361-point scenes (default and input bounds),
six rotating helper sets including signed/zero/large-phase inputs, five derivative
sequences and three Lenz/motional sets. Native/WASM outputs are byte-identical,
including reusable buffers and all derivative signs. Against old JS, maximum
absolute differences are 4.55e-13 for full scenes and 4.45e-16 for helpers;
maximum abs(error)/max(1,abs(reference)) is 4.17e-16. These are observed final-bit
trigonometric differences, not a universal accuracy guarantee. Four independent
Rust tests cover hand-derived polynomial differentiation, signs, quarter-period
scales, the flux derivative relation and invalid/overflow cases. The crate now
passes 121 Rust tests, strict Clippy and the entire previous ABI regression;
TypeScript build and source/artifact checks also pass.

```sh
node crates/w-sim-kernels/wasm/faraday-tests.mjs
```
