# WASM ABI v11

**[BREAKING CHANGE / CONTRACT IMPACT]** ABI11 adds the optional current-population
pointer to `d3q19_display(config, velocity, flags, temperature, populations, display)`.
Zero omits pressure and preserves the former display prefix. A nonzero pointer
must reference `19*N` current f32 populations, aligned4 and disjoint from every
other input/output. The display then appends one f32 lattice gauge-pressure
component after speed/vorticity and optional temperature: stride 3 for isothermal
pressure, 4 for thermal pressure. The caller owns and allocates this larger output.
Config remains **1888 bytes**, with version **11 at byte 56**; step stats remain
**152 bytes**. All other export signatures, numerical evolution and stats offsets
are unchanged. WaveWorld native/WASM/GPU executors, loader and Host field readers
must be upgraded together. Pressure requests require `lbm-pressure-field-v1`;
historical results without it do not acquire pressure through a reader upgrade.
See the [pressure definition and its limits](../README.md#lbm-pressure-display).

ABI10 appended seven f64 D3Q19
internal-fluid mass measurements to the existing 96-byte stats prefix.
Every `d3q19_step`, including isothermal calls, now requires **152 bytes**.
The config stays 1888 bytes. Old callers are rejected by the version
check before using their shorter output. Native consumers bind
`D3Q19_MASS_BALANCE_VERSION=1`; new LBM jobs, executors and results require
`lbm-mass-balance-v1` in addition to the existing gauge and NEE features.
WaveWorld/Agent must upgrade the shared core, stats allocation, loader, markers
and result accumulation together.

The appended values at offsets **96,104,112,120,128,136,144** are respectively
bulk mass before, bulk mass after, signed net inlet transport, signed net outlet
transport, collision writeback change, inlet NEE replacement and outlet NEE
replacement. All are f64 in lattice mass units; the bulk is flag-0 cells
1 <= x <= nx-2. Inlet sign is into bulk and outlet sign is out. See the
[core budget definitions and independent tests](../README.md#internal-fluid-mass-budget).
Old force/mass/max-speed/thermal stats at offsets 0..95 keep their meanings.

ABI9 introduced current-stream NEE at the velocity inlet; ABI10 retains it:
`feq(rho_i,u_target)+(f_i-feq(rho_i,u_i))` from immediate inner fluid bare
moments. A fluid inlet or outlet with a solid donor is rejected. The pressure
outlet remains rho=1 NEE. `D3Q19_NEE_INLET_VERSION=1`,
`lbm-nee-inlet-v1`, `lbm-nee-outlet-v1` and `lbm-gauge-force-v1` remain required.

ABI7 introduced fixed-`rho_ref=1` gauge momentum exchange in the first three
stats entries. This remains unchanged, with `D3Q19_GAUGE_FORCE_VERSION=1` and
`lbm-gauge-force-v1`; no raw-force option exists. Historical sections below
identify the ABI in which additive features appeared; the current artifact and
D3Q19 config always use 11.

## MAC3D pressure projection (additive ABI8 export)

**[BREAKING CHANGE / CONTRACT IMPACT]** Additive `mac_project` export and typed
W-Sim loader declaration; existing exports, layouts and numerical methods are
unchanged. This is a shared Rust/native/WASM numerical building block, **not a
complete CFD solver, fan model, thermal simulation or published job kind**.
WaveWorld job contracts and executor capabilities do not advertise it.

```text
mac_project(config64B, flags, u, v, w, pressure, work, topologyWork, output48B) -> u32
```

Config is u32 `nx@0, ny@4, nz@8, open_faces@12, max_iterations@16, reserved0@20`,
then f64 `dx_m@24, dt_s@32, density_kg_m3@40,
absolute_divergence_tol@48, relative_residual_tol@56`. All dimensions are positive;
max_iterations is in 1..=4096;
open bits 0..5 select xMin, xMax, yMin, yMax, zMin, zMax. Open faces prescribe
zero gauge pressure at the physical boundary face, half a cell from the pressure
sample. Other boundary faces and faces touching a solid have zero normal velocity.
This projection does not impose viscous tangential no-slip conditions.

For `N=nx*ny*nz`, flags are N u8 values (0 fluid, nonzero solid). Face velocities
are f64 m/s arrays: `u[(nx+1)*ny*nz]`, `v[nx*(ny+1)*nz]`,
`w[nx*ny*(nz+1)]`, each with x varying fastest. Pressure is N f64 values in Pa;
work is exactly 6N f64 and topologyWork is exactly 2N u32. Pressure and scratch
are overwritten, so their initial contents are ignored. All nonempty buffers,
including config and output, must be pairwise disjoint, aligned to their element
type and within caller-owned memory above `heap_base()`. Config/output align8.
No call allocates, grows memory, retains state or uses a host math import.

The absolute tolerance is a **hard upper bound on the final maximum absolute
divergence in s^-1**, over every fluid cell including pressure pins. Relative
tolerance is in [0,1); 0 uses only the absolute bound. A positive value can only
tighten it to `min(absolute, relative*initial_divergence_linf)`; a zero initial
divergence uses the absolute bound. Too-strict tolerances may fail explicitly.
See the [kernel description](../README.md) for discretization and limits.

On status0, output48B contains u32 `iterations@0, fluid_cells@4,
closed_components@8, reserved0@12`, then f64 `initial_divergence_linf@16,
final_divergence_linf@24, allowed_divergence_linf@32,
residual_linf_pa_per_m2@40`. Closed connected fluid regions have independent
pressure references. The first three floating-point fields are in s^-1; the last
is the unscaled Poisson residual in Pa/m².

Status9 specifically means **NotConverged**, with a different output48B failure
layout: u32 `iterations@0`, f64 `residual_linf_pa_per_m2@16` and
`allowed_residual_linf_pa_per_m2@24`; all other bytes are zero. Read this layout
only on status9. Existing error statuses apply to invalid inputs: 1 dimensions,
2 memory, 3 coefficients, 4 nonfinite values, 5 invalid state, 6 unsupported
feature, 7 unknown ABI config bits. On any error discard the pressure and velocity
outputs; output48B is valid only on status0 or status9. Reset inputs to reuse memory.

`node crates/w-sim-kernels/wasm/mac-projection-tests.mjs` runs nine tiny single
projections: exact native/WASM fields and diagnostics, two-cell analytic pressure
and velocity in three orientations, disconnected closed cavities, a deliberately
unconverged solve, and invalid memory/config checks. It is included in the existing
WASM CI entry point and runs no time integration or long engineering case.

## MAC3D momentum and fan P-Q (additive ABI8 exports)

**[BREAKING CHANGE / CONTRACT IMPACT]** Adds `mac_step` and `fan_curve_pressure`
to the shared artifact and typed loader. Existing `mac_project` and all prior
exports retain their signatures, memory layouts and numerical behavior. The
new native/WASM kernels are not registered product jobs or advertised executor
capabilities. No HTTP job contract or product default changes in this addition.

```text
mac_step(config96B, table52B, output168B) -> u32
fan_curve_pressure(points, count:u32, flow_m3_s:f64, rpm_ratio:f64, outputF64) -> u32
```

The step config starts with the exact preceding projection config64B, followed
by f64 `kinematic_viscosity_m2_s@64` and three f64 reservoir velocity components
at72,80,88. Reservoir values apply only to incoming tangential momentum at
pressure openings. Normal momentum uses the actual boundary-normal velocity.
The kernel performs conservative first-order advection, physical viscosity,
supplied acceleration, then the shared pressure projection; it changes neither
dt nor viscosity. See the [full equations and boundary limits](../README.md).

The pointer table is 13 u32 entries, aligned4, in this order:

| Index | Buffer | Elements / units |
|---|---|---|
| 0 | flags | N u8, 0 fluid / nonzero solid |
| 1..3 | current u, v, w | f64 face arrays, m/s |
| 4..6 | acceleration u, v, w | matching f64 face arrays, m/s² |
| 7..9 | next u, v, w | matching f64 face outputs, m/s |
| 10 | pressure | N f64, Pa |
| 11 | work | 6N f64 |
| 12 | topologyWork | 2N u32 |

N and the three face counts are identical to `mac_project`. Config/output
align8; every nonempty region, including all read-only fields, flags and the
pointer table, must be pairwise disjoint and within the caller's allocated
WASM memory. Current velocities, acceleration, config, flags and table remain
unchanged. Current velocities must already satisfy stationary normal walls
exactly and the absolute cell divergence limit; initialize with `mac_project`
if needed. Swap current/next table pointers only after status0. Initial next,
pressure and work contents are ignored. On any error discard candidate outputs;
the current state remains usable. No automatic memory growth or global state.

Success output168B begins with the projection output48B. Three f64 values at
48,56,64 give maximum local advection, diffusion and combined CFL respectively.
The combined value is the maximum of the local sums, not necessarily the sum
of the other maxima. Four xyz f64 triples at72,96,120,144 give wall, open,
body-acceleration and pressure-projection impulses **on the fluid**, in kg·m/s.
These are discrete momentum budgets, not directly model surface force or Cd/Cl.

Status9 retains the projection failure record in bytes0..47 and zeros all
remaining bytes. Status10 means the explicit combined CFL exceeds1; only the
three f64 CFL values at48,56,64 are populated, with all other bytes zero. No step
has succeeded in either case. Other invalid statuses retain their previous
meanings and have no valid output record. Restore inputs/config before retrying;
the caller decides whether to use a smaller dt rather than silently changing it.

`fan_curve_pressure` takes 2..256 C-layout points, each f64 flow [m³/s] followed
by f64 static pressure [Pa], aligned8. Output is one separate aligned f64.
It interpolates a supplied curve at a flow and actual RPM ratio `(0,1]` using
fixed-geometry/fixed-density affinity scaling; it does not solve for the fan's
operating point or infer PWM, rotor motion or motor heat. Nonmonotone pressure
is supported. Status2 rejects point counts/memory/aliases, 3 invalid coordinates,
ordering or RPM range, 4 nonfinite values, 5 out-of-domain/numerical underflow,
and 6 stopped/reversed operation without a model. Output is unchanged on error.

The existing WASM smoke entry point includes ten scalar fan cases and seven
small MAC flow cases, one to three steps each: uniform flow, circulation, voxel
corners, pressure nonconvergence, combined CFL, tangential reservoir and synthetic
P-Q-driven airflow. Native/WASM next fields, pressure and every diagnostic byte
match, including reset/reuse and successful-only buffer swaps. No long flow or
steady-state solve is added to CI.

## MAC actuator disks and SI replay fields (additive ABI8 exports)

```text
mac_fans(config64B, disks, count:u32, points, point_count:u32, table28B, output) -> u32
mac_sample(config64B, table28B, thermal:u32, ambient_c:f64, max_speed_f64) -> u32
```

Both exports consume the existing projection header; they do not advance
momentum or perform a pressure solve. Every nonempty region, including config,
tables and read-only data, must be pairwise disjoint, correctly aligned and in
caller-owned memory above `heap_base()`. All face arrays use the `mac_project`
counts and x-fastest indexing. Native and WASM call the same Rust implementations;
there is no JS duplicate of disk selection, P-Q evaluation or cell averaging.

`mac_fans` accepts 0..16 axis-aligned disks and at most 4096 shared curve points.
Each aligned8 disk is exactly 56B:

| Offset | Type | Value |
|---|---|---|
| 0,4 | u32,i32 | axis0/1/2 and direction+1/−1 |
| 8,16,24 | f64 | original centre in cell coordinates |
| 32,40 | f64 | radius in metres; actual/reference RPM ratio |
| 48,52 | u32 | offset and count in the shared P-Q point array |

Each curve point is two f64 values, flow in m³/s and static pressure rise in Pa,
as in `fan_curve_pressure`. Each disk selects 2..256 points from that array.
The circle must fit wholly inside the domain; normal position snaps to
`floor(center+0.5)` on an interior grid face plane. Selected face centres must
have fluid on both sides, at least one face must be selected, and same-axis
disks may not select the same face. Unsupported geometry fails without clipping
or removing blocked faces. Callers retain the original model centre and report
the actual plane and selected area returned by the kernel.

The seven table entries (u32, aligned4) are `flags, u, v, w, acceleration_u,
acceleration_v, acceleration_w`. Flags are N u8; all remaining arrays are f64.
Velocity, flags, descriptors and curve points stay unchanged. Acceleration
arrays are overwritten with fan-only m/s² values on each call. An empty fan
list clears them: when count=0, disks, output, points and point_count must all
be0. For point_count=0, points must be0; a nonempty disk still requires a valid
curve and will fail if it cannot select 2..256 points. This is an absent actuator,
not a stopped-rotor resistance model.

Each aligned8 output record is 40B: u32 `plane@0, face_count@4`, then f64
`area_m2@8, flow_m3_s@16, pressure_rise_pa@24, force_n@32`. Flow is signed in
the fan-forward direction; force is signed along the selected positive grid
axis, on the fluid. Flow is sampled before the momentum step and determines
the pressure applied during that step. Local reverse patches are summed with
their signs; reverse net flow and operation outside the supplied RPM/curve
domain fail explicitly. Pressure curves must use the job's fluid density.
On any error discard all acceleration/readout outputs; current velocity is
unchanged. Memory rejection precedes caller-memory writes; physical validation
can leave incomplete candidate outputs.

`mac_sample` takes table entries `flags, u, v, w, pressure, temperature_delta_k,
display`. Pressure and optional temperature are N f64 in Pa and relative-to-
ambient K. With thermal=0, the temperature pointer must be0 and flags must be0/1.
With thermal=1 it must point to a distinct N-element array; flags0..20 are
accepted. No other thermal value is supported. The display is an aligned4
f32 array of N×4 or N×5 values, interleaved as `ux,uy,uz,pressure[,temperature]`
in m/s, Pa and absolute °C. Fluid velocity averages the two faces of each
component; solid velocity and pressure are0, while thermal values preserve
materials and reservoirs. Occupancy remains necessary to interpret solid slots.

The aligned8 `max_speed_f64` output is one f64 cell-centred maximum speed,
computed before f32 display conversion. Every source value and display value
must be finite; thermal temperatures must exceed −273.15°C. On error the maximum
speed is unchanged but display may be partly written and must be discarded.
Inputs always stay unchanged. Display fields support replay, not restarting a
simulation from the full staggered f64 state.

`mac-step-tests.mjs` also checks these adapters on one 3×3×3 grid: hand-calculated
SI layouts/force/speed, immutable inputs, all pairs of data aliases, partial
overlaps, config/table overlaps, null/misaligned/out-of-bounds/truncated regions
and the zero-only optional pointer rules. Invalid memory returns status2 before
caller-memory writes; valid calls still succeed after rejected calls. Existing
1–3-step native/WASM momentum cases remain in the same smoke entry point.

## MAC conjugate heat export (additive)

```text
mac_thermal_step(config1816B, pointerTable32B, output56B) -> u32
```

This advances conservative sensible heat over the requested physical time using
supplied MAC face velocities. It does not advance momentum, solve pressure or
apply buoyancy. All calculations use the shared f64 Rust kernel, including the
existing material, source-power and contact-resistance definitions. No HTTP job
kind, production executor capability or ready-to-use server model is added by
this low-level export.

Config/output align8; the pointer table aligns4. Config begins with the exact
`mac_project` header64B. Geometry, opening bits, dx, dt, density and absolute
divergence tolerance apply; `max_iterations` and `relative_residual_tol` are
unused in the heat call. The remaining scalar block uses the same112B layout as
the existing D3Q19 thermal scalars, with the following full-config offsets:

| Offset | Type | Value / units |
|---|---|---|
| 64 | f64 | gravity_per_kelvin, must be0; nonzero unsupported |
| 72 | f64 | dt_seconds, equal to header dt |
| 80,88 | f64 | ambient_c, fixed_surface_c |
| 96,104 | f64 | dx_meters, fluid_density; equal to header dx/rho |
| 112,120 | f64 | fluid specific heat [J/(kg K)], conductivity [W/(m K)] |
| 128,136,144 | f64 | default solid density, specific heat, conductivity |
| 152 | f64 | default solid region's total power [W] |
| 160,164 | u32 | mode0=fixed temperature / 1=solid power; max_substeps1..4096 |
| 168 | f64 | positive temperature_scale_c, retained shared thermal field |
| 176,180 | u32 | material_count0..16, reserved0 |
| 184 | 16×32B | material palette; each density, cp, conductivity, total power as4 f64 |
| 696,716 | 5 u32,3 u32 | contact bitmask, reserved zeros |
| 728 | 136 f64 | contact resistance per area [m² K/W] |

Flags retain existing semantics: 0 fluid, 1 insulated obstacle, 2 fixed hot
reservoir, 3 ambient reservoir, 4 default solid, 5..20 material regions. Fixed
temperature mode requires a hot reservoir and no conducting materials; solid
power mode requires conducting solids and no hot reservoir. At least one fluid
cell is required. Each declared material must occur, every configured contact
must share a voxel face, and unused palette/contact entries must remain zero.
Contact index is `hi*(hi-1)/2+lo`, with default material0 and palette1..16;
mask bits distinguish explicit zero resistance from absent contacts.

The eight table entries are flags (N u8), u/v/w (the existing f64 face counts),
current energy (N f64 J), next energy (N f64 J), temperature difference from
ambient (N f64 K), and work (N f64). Every region, including config, table and
read-only inputs, must be pairwise disjoint, above `heap_base()` and in bounds.
Velocities and current energy stay unchanged. Initial next/temperature/work
contents are ignored; work may use the first N elements of projection scratch
when calls run sequentially. Swap current/next energy pointers only on success.

Input velocities must satisfy the absolute divergence limit and exactly zero
normal velocity at solid/closed faces. Pressure openings use ambient enthalpy
for incoming air and local enthalpy for outgoing air, with zero conductive
flux. Whole inlet cells are not held at ambient. Closed domain faces are
insulated; flags2/3 impose reservoirs at internal halfway faces. Each solid
region's total power is divided across its cells. A shared face transfers equal
and opposite heat, including contact resistance between different solid regions.

Advection and conduction share a positive-coefficient limit of0.9. The kernel
uses an integer number of thermal substeps to cover exactly the supplied dt;
it holds velocity constant during those substeps and reports the count. Required
substeps beyond the configured maximum fail explicitly, without changing dt or
material properties. This is a first-order explicit transport scheme; full
server accuracy, temperature-dependent properties, radiation, viscous heating
and buoyancy coupling are not established by this export.

Success output is seven f64 values, identical to the thermal tail of the D3Q19
readout: total sensible energy [J], source energy increment [J], net boundary
energy entering [J], energy residual [J], solid maximum [°C], fluid maximum
[°C], thermal substeps. On any error the readout is unchanged and candidate
next energy, temperature and work must be discarded. Status2 rejects memory,
3 invalid coefficients/mismatched scales or excess thermal substeps, 4 nonfinite
inputs/arithmetic, 5 invalid physical state/contacts/walls/divergence, 6 unsupported
features and7 nonzero reserved ABI fields. Existing exports/layouts remain intact.

The smoke entry includes one-to-three-step native/WASM byte comparisons for
three-axis forward/reverse heat transport, material contacts and regional power,
reservoirs, combined substeps and rejected states, plus all pointer-table guards.
The Rust coupling fixture also checks synthetic P–Q fan flow, solid-to-air heat
transfer and independently integrated outlet energy over three physical steps.
These checks do not run a long flow or steady-state thermal solve in CI.

## Antenna and phased-array exports (additive)

All existing ABI6 layouts remain intact. Scalar values/record members below
are f64 unless explicitly u32; all records/arrays align to 8 bytes. Every
nonempty region in one call must be disjoint, including config and scan scratch.
No export allocates memory, grows it, or retains global simulation state.

```text
antenna_link(config, pattern361, powers121, output32) -> u32
antenna_3d(config, pattern49, output32) -> u32
antenna_pattern(kind:u32, thetaRad:f64, output8) -> u32
antenna_directivity(kind:u32, output8) -> u32
antenna_beamwidth(kind:u32, output8) -> u32
antenna_friis(config, output16) -> u32
antenna_polarization(thetaRad:f64, output8) -> u32
antenna_dipole_power(thetaRad:f64, output8) -> u32
antenna_math(operation:u32, value:f64, output8) -> u32
array_factor(config, thetaDeg:f64, output8) -> u32
array_pattern(config, count:u32, outputSamples) -> u32
array_beamwidth(config, scanSamples, count:u32, output16) -> u32
array_grating(dOverLambda:f64, steerDeg:f64, output20, countPointer:u32) -> u32
array_result(config, pattern361, scan2001, phasesN, grating20, output24) -> u32
```

`antenna_math` operation0=log10 for positive finite input, 1=10^x with x in
[0,5], 2=asin with x in [-1,1]; it calls the same numerical helpers used by
the product. The `countPointer` points to one aligned u32 output, not a capacity.
`array_grating` always requires space for 20 f64s, clears the tail, and writes
the number of valid initial elements. Other array lengths are inferred from
the fixed sizes or count/config. `ArraySample` is two f64s: theta then gain
(16 bytes each). `array_result` validates 2<=n<=48 before accessing phasesN;
the phase buffer has exactly n f64s. Helpers allow 0<=n<=4096 and count>=2.

| Record | Bytes | Offset / fields |
|---|---:|---|
| AntennaLinkConfig | 48 | f64 offsets0,8,16,24,32: pt_dbm,gt_dbi,gr_dbi,frequency_hz,distance_m; u32 kind@40,reserved@44 |
| AntennaLinkReadout | 32 | f64 directivity_db,beamwidth_deg,pr_dbm,fspl_db |
| Friis readout | 16 | f64 pr_dbm,fspl_db |
| Antenna3dConfig | 40 | f64 frequency_hz,pt_dbm,distance_m,elevation_deg,polarization_deg |
| Antenna3d readout | 32 | f64 pr_or_zero,fspl_db,plf,pr_defined (0/1) |
| ArrayConfig | 24 | f64 d_over_lambda@0,steer_deg@8; u32 n@16,reserved@20 |
| Array result readout | 24 | f64 beamwidth_deg,beamwidth_clipped (0/1),grating_count |
| Array beamwidth readout | 16 | f64 width_deg,clipped (0/1) |

Kind0=isotropic, 1=half-wave dipole, 2=directional; unknown kinds fail status3.
Reserved words must be zero (status7 otherwise). Product source ranges are not
reduced by this ABI. Invalid pointer/range/alignment/alias fails status2 before
mutation; invalid coefficients status3; nonfinite values/overflow status4.
Partial outputs from a failed numerical call must be discarded. The native
3D result uses Option for null received power; the WASM defined flag preserves
this without NaN/Infinity sentinels. The loader checks these added product/math
exports so an older ABI6 artifact cannot claim the new ability.

## Plane-wave exports (additive; existing ABI6 layouts unchanged)

```text
plane_em_read(config, output) -> u32
plane_em_sample(config, time:f64, xs, count, E, B) -> u32
plane_acoustic_read(config, output) -> u32
plane_acoustic_sample(config, time:f64, xs, count, pressure, velocity) -> u32
plane_em3d(config, z, ey, cbx, wavelength) -> u32
plane_sincos(angle:f64, output) -> u32
```

All addresses and counts are u32; scalars and records below are f64, aligned to
8 bytes. The caller reserves each complete record/array above `heap_base()`.
All nonempty regions in one call, including read-only config and input samples,
must be pairwise disjoint. Invalid region/length/alignment returns status2 before
mutation; invalid physical coefficients status3; nonfinite inputs and arithmetic
overflow status4. A late arithmetic error can leave partial outputs: discard
them. All these exports allocate nothing and can reuse one owner every frame.

| Record | Bytes | f64 fields in offset order |
|---|---:|---|
| EM config | 32 | frequency_hz, refractive_index, e_peak, phase0 |
| EM readout | 40 | wavelength_m, phase_velocity, impedance, b_peak, intensity_w_m2 |
| Acoustic config | 40 | frequency_hz, rho, c, p_peak, phase0 |
| Acoustic readout | 32 | wavelength_m, impedance, v_peak, intensity_w_m2 |
| EM3D config | 24 | wave_number, amplitude, time |
| EM3D wavelength | 8 | wavelength |
| Sine/cosine readout | 16 | sin, cos |

The 2D sample input `xs` and each output array contain exactly `count` f64s;
count0 accepts ignored pointers and empty slices, while still validating config
and time. Each EM3D array has exactly 140 f64s (1120 bytes). All finite phases,
including beyond 2^18, use the shared deterministic core; phase construction
and 3D sample spacing retain the original f64 operation order. Coefficient
constraints, precision evidence and independent oracle generation are described
in the crate README. The loader checks the added plane-wave exports to reject
stale artifacts that still advertise ABI6 but predate these functions.

`abi.rs` is a standalone `no_std` wrapper linked to `w-sim-kernels`. It contains
memory validation and exports, with no separate numerical implementation.
Compile the shared library and wrapper using the same Rust toolchain:

```sh
rustc crates/w-sim-kernels/src/lib.rs --edition 2021 \
  --crate-name w_sim_kernels --crate-type rlib --target wasm32-unknown-unknown \
  -O -C panic=abort -o /tmp/libw_sim_kernels.rlib
rustc crates/w-sim-kernels/wasm/abi.rs --edition 2021 \
  --crate-type cdylib --target wasm32-unknown-unknown \
  --extern w_sim_kernels=/tmp/libw_sim_kernels.rlib \
  -O -C panic=abort -C link-arg=-zstack-size=16384 -o /tmp/w-sim-kernels.wasm
```

The module has no imports. It exports `memory`, `abi_version()` returning 10,
`heap_base()` returning the first usable byte address, and these functions:

```text
step(u, previous, n, a:f64, damping:f64, mask) -> u32
heat(u, next, width, height, r:f64) -> u32
seed_wave(u, previous, n, x:i32, y:i32, radius:u32, amount:f64) -> u32
seed_heat(field, width, height, x:i32, y:i32, radius:u32, amount:f64) -> u32
fdtd_step(config, eps, mask, ez, hx, hy, left, right, bottom, top) -> u32
fdtd_source(ez, nx, ny, x:u32, y:u32, amplitude:f64) -> u32
fdtd_energy(config, eps, ez, hx, hy, output) -> u32
md_init(config, state, pos, vel, force, unwrapped) -> u32
md_force(config, state, pos, force) -> u32
md_step(config, state, pos, vel, force, unwrapped) -> u32
md_batch(config, state, bath, pos, vel, force, unwrapped, steps) -> u32
md_barostat(config, state, bath, pos, vel, force, unwrapped, scale) -> u32
md_read(config, state, pos0, vel, unwrapped, speed, stats) -> u32
md_rdf(config, state, pos, bins, r_max:f64, hist, r, g, stats) -> u32
md_diffusion(times, msd, len, dim, skip:f64, output) -> u32
particles_init(config, state, screening, pos, vel, force, unwrapped, charge, sigma, epsilon) -> u32
particles_step(config, state, screening, pos, vel, force, unwrapped, charge, sigma, epsilon) -> u32
particles_batch(config, state, screening, pos, vel, force, unwrapped, charge, sigma, epsilon, target:f64, thermostat, steps) -> u32
particles_force(config, state, screening, pos, force, charge, sigma, epsilon) -> u32
particles_read(config, state, pos0, vel, unwrapped, charge, speed, stats) -> u32
d3q19_init(config, flags, f, post, velocity, density, energy, next_energy, temperature, mass) -> u32
d3q19_step(config, flags, f, post, velocity, density, energy, next_energy, temperature, mass, step_index, stats) -> u32
d3q19_display(config, velocity, flags, temperature, populations, display) -> u32
thermal_regions(flags, nx, ny, nz, matrix, bounds, region_count, counts) -> u32
thermal_contact_faces(flags, nx, ny, nz, periodic, mask) -> u32
voxelize(vertices, vertex_count, indices, triangle_count, nx, ny, nz, flags, scratch, counts) -> u32
voxelize_solids(vertices, vertex_count, indices, triangle_count, solid_counts, solid_count, nx, ny, nz, flags, scratch, counts) -> u32
```

All unannotated parameters are `u32` (WebAssembly `i32`); pointers are byte
offsets in the module's exported memory. Dimensions/radii must be unsigned
integers, seed coordinates signed integers, and scalar parameters finite. The
JavaScript adapter must validate values before WASM's automatic i32 coercion.
Wave/heat use the existing buffer/step signatures; wave and heat callers swap
their two buffers after a successful step. D3Q19 updates `f` in place and does
not swap buffers. Numerical behavior is described in the crate README.

## Memory ownership

The caller allocates and owns all buffers at or above `heap_base()`. It can use
free space there or append pages with `memory.grow`; after growing, recreate any
typed-array views because the old `ArrayBuffer` is detached. No exported
function allocates or grows memory. Do not write or grow memory during a call.

Every pointer must be nonzero, aligned and within current linear memory. All
regions passed to a call must be disjoint, including read-only config, flags,
obstacle mask and output statistics. The wrapper checks these conditions before
creating Rust slices. Space below `heap_base()` is rejected to protect the
module's stack and static data. Wave and FDTD obstacle masks accept pointer zero for an absent mask.
Zero-count mesh vertices/indices/scratch regions may use pointer zero. Their
slices never access protected memory, but empty topology returns status11.

Lengths are inferred from dimensions, so callers must reserve the full lengths
below. The ABI has no allocation table and cannot identify a smaller logical
allocation inside otherwise valid linear memory. Use an allocator in the
adapter that tracks each reserved region; passing adjacent typed-array views
does not resize or redefine the underlying reservation.

| Buffer | Element type / alignment | Required elements |
|---|---|---|
| wave `u`, `previous` | f32 / 4 bytes | n*n each |
| wave `mask`, when present | u8 / 1 byte | n*n |
| heat `u`, `next`, or seed `field` | f32 / 4 bytes | width*height each |
| D3Q19 `flags` | u8 / 1 byte | nx*ny*nz |
| D3Q19 `f`, `post` | f32 / 4 bytes | nx*ny*nz*19 each |
| D3Q19 `velocity` | f32 / 4 bytes | nx*ny*nz*3 |
| D3Q19 `density` | f32 / 4 bytes | nx*ny*nz |
| thermal `energy`, `next_energy`, `temperature` (delta K), `mass`, when enabled | f64 / 8 bytes | nx*ny*nz each |
| D3Q19 `config` | struct / 8 bytes | 1888 bytes |
| D3Q19 `stats` | f64 / 8 bytes | 19 values (152 bytes) |
| display output | f32 / 4 bytes | nx*ny*nz*(thermal ? 3 : 2), interleaved speed/vorticity/[normalized temperature] |
| mesh `vertices` | f32 / 4 bytes | vertex_count*3, already transformed xyz |
| mesh `indices` | u32 / 4 bytes | triangle_count*3 |
| mesh `solid_counts` (new optional grouped entry) | u32 / 4 bytes | solid_count consecutive triangle counts |
| mesh `flags` | u8 / 1 byte | nx*ny*nz |
| mesh `scratch` | f64 / 8 bytes | triangle_count*5 |
| mesh `counts` | u32 / 4 bytes | 2 values: solid count, frontal projection count |

`voxelize` checks oriented geometric edge closure then performs scan conversion;
model rotation, placement and physical unit preparation happen before this call.
It clears and fills flags with 0/1 only after all boundary sets pass the edge gate.
The input triangle indices must reference existing vertices, and all xyz values
must be finite and within the core's representable lattice-coordinate range.
`voxelize_solids` uses the same implementation with explicit groups. Every count
must be positive and their sum must equal `triangle_count`; invalid partitions
return status5 before modifying flags/counts. A zero-length group array (pointer0
allowed) retains the old single boundary-set meaning. Group memory follows the
same bounds/alignment/non-overlap checks as all other buffers (status2).
All buffers, including group counts, must be pairwise disjoint. `voxelize` only
forwards with no groups; ABI6 and its existing signatures are unchanged.

Within a group the even-odd fill preserves cavity shells; between groups flags
are ORed. The caller must supply the intended solid groups. Missing groups do not
imply component union. **[BREAKING CHANGE / CONTRACT IMPACT]** Each group now
requires nonzero-area triangles and exactly two oppositely directed occurrences
of every geometric edge; empty/open/non-manifold-at-edge/inconsistently-oriented
input returns status11 before modifying flags/counts. Both exports share this
gate. Native consumers must handle `KernelError::InvalidSolidTopology`; older
external Agent builds do not enforce it until upgraded. No layout/version change
or new job capability is introduced. Coordinates compare exactly (+0 = -0), not
by vertex index or epsilon; zero-area triangles are ignored by the gate and scan.
Scratch remains five f64 per triangle, is reused for sorting opaque edge-index
bits, and must be discarded after an error. Edge closure is not a certificate of
manifold vertices, self-intersection freedom or thin-wall resolution, and performs
no welding, thickening or hole repair. Model transforms apply
equally to every group. The loader requires the new export so an old artifact
cannot silently ignore `solidTriangleCounts`.
`d3q19_display` returns lattice speed and vorticity magnitudes using the existing
clamped-neighbor central-difference convention. Solid velocities are treated as
zero. Thermal output adds a normalized temperature channel; physical Celsius
scales travel in the job result, outside this numerical ABI.
Optional pressure is computed from current populations as `sum(f_q-f32(w_q))/3`,
with solid cells zero-filled. `derived.pressureScalePa` supplies the saved
physical conversion outside the ABI. Inputs remain unchanged; discard display
output on any failure, including nonfinite pressure or an invalid population
region. Pressure is neither a rounded-density proxy nor a full stress tensor.

## D3Q19 configuration

Use a 1888-byte, zero-initialized structure, aligned to 8 bytes, with little-endian
fields. The wrapper copies primitive configuration values before accessing
mutable fields. Unknown versions and nonzero reserved fields are rejected.

| Byte offset | Type | Value |
|---|---|---|
| 0, 4, 8 | u32 | nx, ny, nz |
| 12 | u32 | boundary: 0 WindTunnel, 1 Periodic, 2 Closed |
| 16 | u32 | free-slip side walls: 0 false, 1 true |
| 20 | u32 | fan enabled: 0 false, 1 true |
| 24 | f64 | tau |
| 32 | f64 | u_inlet |
| 40 | f64 | smagorinsky_cs |
| 48 | f64 | turbulence_intensity, fraction 0..1 |
| 56 | u32 | ABI version, must be 11 |
| 60 | u32 | thermal enabled: 0 false, 1 true |
| 64, 72, 80 | f64 | fan center x, y, z in lattice coordinates |
| 88 | f64 | fan radius in cells |
| 96, 104, 112 | f64 | fan unit normal x, y, z |
| 120 | f64 | fan acceleration, Δp·dt²/(ρ_phys·dx²) |
| 128 | f64 | +y acceleration per actual kelvin (not normalized display temperature) |
| 136 | f64 | physical dt_seconds (s) |
| 144 | f64 | ambient_c (°C) |
| 152 | f64 | fixed_surface_c (°C), zero in power mode |
| 160 | f64 | dx_meters (m) |
| 168 | f64 | fluid_density (kg/m³) |
| 176 | f64 | fluid_specific_heat (J/kg/K) |
| 184 | f64 | fluid_conductivity (W/m/K) |
| 192 | f64 | solid_density (kg/m³), zero in fixed mode |
| 200 | f64 | solid_specific_heat (J/kg/K), zero in fixed mode |
| 208 | f64 | solid_conductivity (W/m/K), zero in fixed mode |
| 216 | f64 | total_power_w (W), zero in fixed mode |
| 224 | u32 | mode: 0 fixed-temperature, 1 solid-power |
| 228 | u32 | max_substeps: 1–4096 |
| 232 | f64 | temperature_scale_c, positive |
| 240 | u32 | material_count, 0–16 |
| 244 | u32 | ground enabled: 0 absent, 1 no-slip yMin (including stationary) |
| 248 | f64 | ground velocity along +x in lattice units |
| 256 + i*32 | f64[4] | region i: density, specific_heat, conductivity, total_power_w |

The 16 material slots occupy bytes 256–767. Unused slots must be bitwise zero;
unknown counts/nonzero reserved or unused fields fail status 7. Fixed-temperature
and disabled thermal require material_count=0 and all material slots zero.
Ground is independent of the thermal extension.
Flag4 uses the existing default solid scalars; flags 5–20 select slots 0–15.
Every declared region must resolve at least one solid cell. If the default power
is nonzero, at least one flag4 cell is required. Per-material source energy is
distributed over its own cells; reported source energy sums default plus regions.
No thermal buffers or statistics offsets are added.

Ground was introduced using the former reserved bytes 244–255 in ABI6; ABI9
retains its 1888-byte config size and all signatures. Disabled ground requires bitwise +0 velocity;
enabled=1 permits a finite nonnegative velocity below 0.2 after f32 rounding.
Enabled ground is valid only in WindTunnel mode. Rust receives `Some(velocity)`,
so enabled stationary zero is distinct from absent. Unknown enabled values or
nonzero disabled velocity fail status7; invalid enabled speed fails status3.
An older ABI6 artifact rejects enabled ground through its former reserved-byte
check. Product Hosts must still require `lbm-ground-v1` from actual job input.
The ground takes precedence over specular z at yMin; x equilibrium boundaries
retain final priority. It is insulated in thermal mode and its force is excluded
from model force. See the core README for the bounce-back equation and open-inlet
mass accounting.

When the fan is disabled, bytes 64–127 must all be zero, including floating-point
sign bits: `-0.0`, NaN and stale fan data are rejected. When enabled, the core
validates finite parameters, unit normal, resolved radius, interior extent and
at least one fluid cell as documented in the crate README. Init and step both
validate this configuration; disabling a fan requires clearing its entire block.

When thermal is disabled, bytes 128–243 and 256–1887 must be zero and all four thermal
pointers must be zero. When enabled they are required, correctly sized and
non-overlapping with every other region. The core uses fixed +y Boussinesq
buoyancy combined with fan acceleration, one Guo source and one half-force
velocity correction. Temperature and velocity describe the completed step.

**[BREAKING CHANGE / CONTRACT IMPACT]** ABI v6 extends ABI5 with the solid-contact table: config is
1888 bytes, init/step use four f64 thermal buffers, display reads f64 temperature,
and stats originally required 96 bytes (ABI10 now requires 152), including isothermal calls. Earlier versions
are rejected, with no compatibility numerical path. Wave/2D heat/voxel exports
are unchanged. Disabled thermal coefficients and material/contact slots must be
bitwise zero (ground bytes 244–255 are independent); disabled pointers are all zero. Values are validated before init
and each step. Fixed mode requires a warm wall and zero unused solid/power
coefficients; power mode requires positive solid properties, P>=0, and zero
unused fixed_surface_c. Reset all fields when changing physical parameters.

| Stats byte offset | f64 value |
|---|---|
| 0, 8, 16 | Single-step obstacle Fx/Fy/Fz, lattice force units |
| 24 | Completed fluid mass in lattice units |
| 32 | Maximum lattice speed |
| 40 | Total completed sensible thermal energy (J, ambient reference) |
| 48 | This step's source energy (J) |
| 56 | This step's external boundary energy (J, positive inward) |
| 64 | This step's E_after−E_before−source−boundary residual (J) |
| 72 | Completed solid spatial maximum (°C) |
| 80 | Completed fluid spatial maximum (°C) |
| 88 | Conduction substep count, exact integer encoded as f64 |

When thermal is disabled, offsets 40–88 are zero; first five values retain their
previous meanings/arithmetic. Sum force then average over actual sampled steps.
Sum source/boundary/residual to make the run ledger; preserve final total energy
and spatial temperatures, and maxima over absolute step residual/substep count.
`step_index` starts at 1. Flags are 0 fluid, 1 insulated obstacle, 2 fixed hot
wall, 3 fixed ambient wall, 4 default conducting solid, 5–20 region solids. At least one fluid is required;
fixed mode requires a flag-2 wall, power mode a conducting flag 4–20 cell. Full equations,
physical units, stability admission and limitations are in the crate README.

`thermal_regions` classifies existing flag4 cells using their lattice centers.
Its matrix is 12 f64 values (96 bytes aligned to 8), row-major affine 3×4 from
lattice xyz to original-model normalized xyz. Bounds are region_count records
of six f64 values: min xyz, max xyz; they align to 8 and occupy 48 bytes each.
Counts are 17 u32 values (68 bytes aligned to 4), ordered default then regions.
Input flags 0–4 are accepted and only 4 is reassigned to 5–20. An empty bounds
list may use pointer zero. All other memory regions must be valid and disjoint.
Each AABB uses [min,max), with max=1 including the upper model boundary; positive
volume overlaps and unresolved regions fail. Numeric classification lives in the
same Rust core for native/WASM, while the product prepares only the transform.

## Status codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Invalid/overflowing dimensions |
| 2 | Null, misaligned, overlapping, protected or out-of-bounds memory |
| 3 | Invalid coefficients or stability admission |
| 4 | Non-finite field/update |
| 5 | Invalid density/velocity or failed numerical iteration |
| 6 | Unsupported physical feature, flag or boundary |
| 7 | Unsupported ABI version or nonzero reserved fields |

Always check the status. A numerical error can occur after partial writes;
discard/reset that job's buffers and do not publish output or old statistics.
Memory/structural validation precedes numerical calls. This ABI does not add
industrial CFD accuracy claims to the underlying kernels.

## Small verification

```sh
node crates/w-sim-kernels/wasm/tests.mjs
```

This compiles the native reference and WASM module in a temporary directory,
runs only five steps on 7×7 wave, 7×5 heat and 5×4×3 D3Q19 grids with and
without a rotated fan, plus three conservative thermal/fan steps per boundary/source mode on the same tiny grid.
It compares all f32 populations, velocity, density and display bits, four f64
thermal buffers and 12 D3Q19 statistics.
A captured pre-fan digest also checks that the no-fan field bits are unchanged. It also calls the real WASM exports
with invalid pointers, overlap, alignment, dimensions, versions, flags and
coefficients, disabled thermal pointers and overlapping thermal buffers to
verify explicit failures without traps. It needs the existing
Rust toolchain with `wasm32-unknown-unknown` installed; no npm or Rust dependency
is added. Temporary build files are removed when the check exits.

The same check includes a tiny cube's native/WASM voxel flags and counts, and
the completed D3Q19 display buffer. Product consumers load the only generated
WASM artifact through `instantiateWasmKernel()` and `WASM_KERNEL_SOURCE_SHA256`
from `@w-sim/solvers-lbm/d3q19`. Run `node scripts/build-wasm-kernels.mjs` after
changing Rust sources; `--check` detects stale generated bytes without rebuilding.


## FDTD configuration and buffers

The FDTD configuration is a distinct **32-byte** region, aligned to 8 bytes:

| Offset | Type | Value |
| --- | --- | --- |
| 0 / 4 | u32 | nx / ny (at least 3) |
| 8 | u32 | 0 = Mur; 1 = PEC |
| 12 | u32 | reserved; must be zero |
| 16 / 24 | f64 | dt / uniform mu |

Ez/Hx/Hy/eps each reserve `nx*ny*4` bytes and align to 4. The optional mask
reserves `nx*ny` bytes; any nonzero mask value is PEC. Left/right histories each
reserve `ny*4` bytes and bottom/top each `nx*4`, also aligned to 4. All buffers
are required even under PEC, to permit the caller's existing boundary switch.
Source coordinates are unsigned grid indices and amplitude is a finite f64.
The energy output reserves 8 bytes aligned to 8; it is written only on success.

Every region in one call must be disjoint, including config, permittivity, mask,
histories and energy output. The wrapper checks byte ranges and alignment before
forming Rust slices. Actual allocation lengths still belong to the caller; no
allocation table is introduced. Return statuses use the existing ABI values:
0 success, 1 dimensions/coordinate, 2 memory/length, 3 coefficient/CFL,
4 non-finite input/update, 6 unknown boundary, 7 nonzero reserved config field.
FDTD, wave and heat signatures remain unchanged under ABI6.

**[BREAKING CHANGE / CONTRACT IMPACT]** WaveWorld's native and WASM consumers
can replace their TS Yee update and energy loops with these shared exports.
The existing numeric behavior/order is retained for admitted inputs; invalid
CFL, material and non-finite inputs now fail explicitly. Source waveform/preset
preparation remains owned by WaveWorld. See the crate README for the reduced
physical model and Mur/PEC ordering limits.

## MD configuration and buffers

All structs below are little-endian and aligned to 8 bytes. Every call checks
that all of its regions are disjoint before forming slices, including read-only
arrays and config. Particle buffers use n*dim f32 values (4-byte alignment).
No operation allocates memory. MD function signatures and MD layouts remain unchanged under ABI6.

| Region | Bytes | Fields |
| --- | --- | --- |
| config | 32 | n:u32@0, dim:u32@4 (2/3), reserved:u32@8/@12 = 0, dt:f64@16, rc:f64@24 |
| state, read/write | 32 | f64: box_l@0, potential@8, virial@16, last_temperature@24 |
| bath | 48 | flags:u32@0, reserved:u32@4 = 0; f64 target_temperature@8, target_pressure@16, tau_p@24, kappa_t@32, max_scale@40 |
| read stats | 72 | nine f64: temperature, kinetic, potential, total, pressure, msd, box_l, volume, density |
| standalone barostat scale | 8 | f64 linear scale |
| RDF stats | 16 | two f64: actual r_max, unordered pair_count |
| diffusion output | 40 | five f64: diffusion, slope, intercept, r2, n_fit |

Bath flags are bit 0 thermostat, bit 1 barostat. Unknown bits, nonzero reserved
fields and nonzero **bit patterns** for disabled targets fail with status 7.
Disabled targets therefore use +0, not -0 or NaN. A JS caller maps its absent/NaN
target to a cleared flag and +0. Tau's nonpositive/NaN/infinite no-op behavior
remains as documented in the crate README; tau is not a disable flag.

`md_init` initializes unwrapped/force/scalars from prepared pos/vel and box_l.
`md_force` changes only force and state potential/virial. `md_step` is a single
Verlet step; `md_batch` accepts steps 1–4 and performs the same thermostat and
barostat code as the native library. `md_barostat` exposes that same pressure
update directly and writes its linear scale only on success. Mutation calls
copy scalar state back only on success, but a numerical error may already have
partially changed particle arrays: discard the failed state.

`md_read` receives the caller's independent initial pos0 array, current velocity
and unwrapped positions. Speed output has n f32 elements. RDF takes bins>0,
positive finite requested r_max, bins f64 histogram scratch, and bins f32 radius
and g outputs. Its actual r_max is min(requested, box_l/2). Diffusion takes two
len-element f64 arrays and dim 2/3, with finite skip in [0,1]; for len=0 their
pointers may be zero and the five outputs are zero. Counts are encoded as f64;
RDF pair counts beyond 2^53 would no longer have unit integer resolution.

Status 2 covers protected/out-of-bounds/misaligned/aliased regions, 3 invalid
coefficients or batch size, 4 non-finite state/update, 5 coincident particles or
failed root iteration, 6 unsupported dimension, and 7 reserved fields/flags.
Always check status before publishing fields or reading old statistics.

The small ABI suite compares native/WASM complete NVE/NVT/NPT fields, all nine
statistics, RDF and history diffusion in 2D and the 3D helper. Batches 4/1/2/3
exercise partial batches without long equilibration. `md-reference.json`
captures the former WaveWorld md/interactions/barostat/rdf/diffusion and 2D
CpuMdSim operations with fixed prepared input arrays; the 3D case uses those
same helpers in the same batch order. Native/WASM are bitwise identical.
Captured TS f32 arrays remain identical and its f64 outputs use a 2e-14 relative
or 2e-14 absolute comparison because bounded roots and integer volume products
can differ from Math.pow. Memory/error cases exercise all new exports.

**[BREAKING CHANGE / CONTRACT IMPACT]** WaveWorld can replace its CPU MD numeric
loops and native post-processing with the same Rust/WASM exports. Prepared
random initial states stay in WaveWorld; no alternate RNG, charged force field
or preset algorithm is introduced. Batch sizes outside 1–4, coincident particles
and invalid/non-finite state now fail explicitly. The existing NPT affine-MSD
limitation and weak-coupling semantics remain; do not infer physical diffusion
or a rigorous NPT ensemble from these diagnostic outputs.

## Heterogeneous particles

Particles reuse the unchanged MD config32B/state32B, n*dim f32 position/velocity/
force/unwrapped buffers, initial pos0 and n-element f32 speed. Three additional
read-only **n-element f32** arrays are required: charge, sigma and epsilon. The
separate **24-byte screening** region is aligned to 8 and contains f64 eps_r@0,
lambda_d@8 and k_coulomb@16. Each region in a call must be disjoint, including
the three properties, screening, state and read-only config; ordinary MD memory
range/alignment/status rules apply. Dimensions 2 and 3 are admitted by helpers;
the product's particle execution uses 2D and cutoff 2.5.

`particles_init` computes the initial heterogeneous force and scalar state from
prepared positions/velocities, and copies positions into unwrapped coordinates.
`particles_force` changes force, potential and virial only. `particles_step`
performs one Verlet step. `particles_batch` applies the existing 1–4-step
thermostat rule: thermostat is 0 or 1; when 0, target must have the **+0 bit
pattern**. NaN/-0 disabled targets and unknown flags reject with status 7.
When enabled, target must be finite and nonnegative. No particle pressure-bath
option is exposed. The caller must reset initial force when properties change.

`particles_read` writes **80 bytes** aligned to 8: the first nine f64 values
are unchanged MD observables, followed by total_charge at offset 72. Kind/species
ids remain product metadata. `md_rdf` and `md_diffusion` are reused unchanged.
Failed arithmetic can partially change arrays; scalar copies/statistics are
published only on success and callers must discard the failed field state.

Property arrays require finite charges, positive sigma and nonnegative epsilon.
All screening parameters must be finite, k_coulomb nonnegative. The preserved
formula clamps eps_r/lambda_d to 1e-6 and Coulomb r² to 1e-8; total rc still
truncates both terms. The core rejects coincident particles. Its bounded no_std
exp(-x) implementation and error-check range are described in the crate README.

The ABI small suite checks five captured original-TS particle fixtures against
native and WASM: 4 particles, batches 4/1/2/3, NVE/NVT, mixed/zero charge, zero
Coulomb strength and 3D helpers. It compares every field, all ten observables,
history MSD and RDF. Existing homogeneous MD fixtures remain unchanged.
Additional calls exercise every particle export's invalid aliases/ranges,
property/scalar validation, disabled thermostat and unsupported batch counts.

**[BREAKING CHANGE / CONTRACT IMPACT]** The additional exports allow WaveWorld
CPU/agent particle execution to share the same Rust core, replacing the former
TS pair-term/charged-Verlet implementation. Existing MD and particle function signatures
are unchanged under ABI6. Prepared particle composition and random arrays stay in the
product; the new native file consumer must pass those same f32 arrays. No
implicit PEDOT preset or unsupported chemical/transport model is introduced.

### Contact table in ABI6

D3Q19 config remains aligned to 8. Bytes 0–767 retain the ABI5 layout except
version at 56 must be 11 and former reserved bytes 244–255 now hold optional ground; its total size is now 1888 bytes. Stats remain 152 bytes since ABI10;
ABI11 adds the display population pointer described above. Init/step signatures
and thermal buffer layouts are unchanged.

| Offset | Type | Meaning |
| --- | --- | --- |
| 768 | 5 u32 | Explicit-contact presence mask, low 136 bits used |
| 788 | 3 u32 | Reserved, all zero |
| 800 | 136 f64 | Area-normalized resistance in m² K/W |

Material indices are 0 default, 1–16 regions. For `lo<hi`, table index is
`hi*(hi-1)/2+lo`; presence is mask[index/32] bit index%32. Set the presence bit
even for explicit R=0. An unset slot must be bitwise +0; the last 24 mask bits
and reserved words must be zero. Fixed-temperature/no-thermal modes require
the whole contact extension to be zero. Active R must be finite/nonnegative,
refer to configured materials, and the pair must share at least one voxel face.

`thermal_contact_faces` reads u8 flags and writes 5 u32 (20 bytes, aligned to 4)
using the same pair indexing. It supports periodic=0/1; other values are rejected.
Input flags and output mask must be nonoverlapping valid memory. Edge/corner
adjacency does not set a bit; periodic=1 includes shared faces across each domain
boundary. Invalid dimensions, memory, and flags use the existing status codes.
The function does not allocate and does not change flags. Product admission uses
this export once; native init/step checks use the same Rust scanner when contacts
are configured.

### 2D Stable Fluids exports (additive ABI6)

Existing ABI6 layouts are unchanged. Updated loaders also require `fluid_step`
to exist, so an older ABI6 artifact cannot silently claim this module.

```
fluid_step(config, fields, source) -> u32
fluid_apply(config, fields, operation) -> u32
fluid_set_boundary(config, b, x) -> u32
fluid_linear_solve(config, b, x, x0, a:f64, c:f64) -> u32
fluid_diffuse(config, b, x, x0, diffusion:f64) -> u32
fluid_project(config, vx, vy, pressure, divergence) -> u32
fluid_advect(config, b, output, input, vx, vy) -> u32
fluid_read(config, vx, vy, density, temperature, margin, stats) -> u32
fluid_max_divergence(vx, vy, n, margin, output) -> u32
```

All addresses/counts/flags are u32 unless noted. Config is 64 bytes, aligned to 8:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u32 | n, square grid side >=3 |
| 4 | u32 | iterations, 0–4096 |
| 8, 12 | u32 | thermal enabled, inlet enabled; each 0 or 1 |
| 16, 24, 32 | f64 | dt, viscosity, diffusion; finite nonnegative |
| 40, 48, 56 | f64 | buoyancy, ambient, inlet_speed; finite signed |

Disabled inlet_speed must be bitwise +0. The fields table is 44 bytes aligned
to 4: eleven u32 pointers in order vx, vy, vx0, vy0, dens, dens0, p, div, scalar0,
temp, obstacle. First ten point to persistent n² f32 values; obstacle is zero or
n² u8 values (any nonzero entry clears the solid cell). Config, table, all mutable
fields, optional mask and optional source must be disjoint and within memory.

source=0 selects bare Fluid.step. Otherwise source is 48 bytes aligned to 8:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0, 4 | u32 | dye reservoir enabled 0/1; reserved zero |
| 8, 16, 24 | f64 | dye density, spacing, width |
| 32, 40 | f64 | density_decay, temperature_cooling |

Disabled dye requires its three values bitwise +0. Enabled spacing must be
positive, width nonnegative; all values finite. Multipliers are finite
nonnegative, with one disabling decay/cooling. The operation is reservoir →
Fluid.step → density multiplication → temperature multiplication, once per call.
`fluid_apply` operation0 applies buoyancy only; operation1 clears obstacles only.
Other operations fail. Boundary b=0 scalar, 1 x velocity, 2 y velocity, 3 pressure.

`fluid_read` writes 48 bytes of six f64: peak_density, mean_density, max_speed,
min_temperature, max_temperature, max_divergence. `fluid_max_divergence` writes
one f64. Margin may be 0..n; an empty interior reports zero. Divergence retains
the original clamped grid-index stencil. Stats and all fields are checked for
finite values. Statistical read inputs and advect's read-only input/vx/vy may
alias each other; they cannot overlap config or mutable output. Other helper
buffers are distinct. These helper exports call the same Rust functions as step;
no JS stencil, per-step allocation or field download is required.

Nonfinite arrays return4, invalid coefficients3, bad dimensions1, bad/aligned/
aliased memory2, unknown operations/boundary codes6, malformed flags/reserved
fields7. Failed numerical calls may partially update fields and must be discarded.

## Ising additions (ABI 6, other layouts unchanged)

The loader requires `ising_sweep` in addition to existing exports, so an older
ABI6 artifact cannot silently advertise these additions. All addresses are byte
offsets >=`heap_base()`; every supplied region must fit the current memory and
be pairwise disjoint. Even readonly inputs are required disjoint in these
functions. Config, moments and outputs align to 8 bytes; RNG aligns to 4; spins
have byte alignment. Invalid ranges, alias, dimensions and flags are checked
before writable Rust references are formed. Returned status follows the common
0..7 contract. On success an output is completely written; do not consume an
output after an error.

- Config: 16 bytes: u32 size@0, u32 reserved=0@4, f64 temperature@8.
- Spins: size² signed i8 values, each -1 or +1, row-major.
- RNG: one u32 persistent Mulberry32 internal state (4 bytes).
- Moments: 48 bytes, six f64 in order `n,m,abs_m,m2,e,e2`. Initialize all zero.
- Readout: 80 bytes, ten f64 in order `magnetization,energy,samples,mean_m,
  mean_abs_m,mean_energy,specific_heat,susceptibility,reference,Tc`.
  Unsampled means and fluctuation slots are zero: reconstruct null means when
  samples==0 and null fluctuations when samples<2. Temperature is in config.

```text
ising_init(config, spins, rng, seed:u32, hot:u32) -> status
ising_next(rng, outputF64) -> status
ising_sweep(config, spins, rng, moments, algorithm, sample, reset) -> status
ising_read(config, spins, moments, output80B) -> status
ising_delta(config, spins, index:u32, outputF64) -> status
ising_reference(temperature:f64, output16B) -> status
ising_fluctuation(mean:f64, mean2:f64, N:u32, temperature:f64, kind, outputF64) -> status
```

`hot`, `sample`, `reset` accept only 0/1; algorithm 0=Metropolis, 1=Heat-bath.
Moments may be zero only for a sweep with sample=reset=0; `ising_read` requires
valid initialized moments. `ising_init` initializes spins/RNG, not moments.
`ising_next` writes one f64 draw in [0,1). `ising_reference` writes [Tc,m(T)],
retaining finite T<=0→1, finite T>=Tc→0. `ising_fluctuation` kind0 computes heat
capacity, kind1 susceptibility. Core validation and approximation ranges are
documented in the crate README. No optional imports, transcendental host calls,
per-sweep heap allocation or copies are used.

## Circuit, oscillator and neuron additions (ABI6)

The loader requires the four new `*_advance` exports. Previous ABI6 layouts are
unchanged. All configs/states/trajectory arrays below use f64 and alignment8.
Counts and start indices are u32. All supplied regions must be pairwise disjoint,
including the current state and next-state output; the usual heap/alignment/
bounds checks run before creating Rust references. Outputs are caller-owned
append slices, containing count next samples without the initial sample.

| Family | Config byte layout | Persistent state |
| --- | --- | --- |
| RLC | 40B: [L,R,C,V,dt] | 16B: [q,i] |
| Mutual | 64B: [L1,L2,M,R1,R2,V1,V2,dt] | 16B step: [i1,i2]; 32B batch/read: [i1,i2,primaryDissipation,secondaryDissipation] |
| Oscillator | 48B: [mass,stiffness,damping,driveAmp,driveOmega,dt] | 16B: [x,v] |
| Neuron | 24B: [current,dt,pulseSteps] (duration is integer f64) | 16B: [v,w] |

```text
rlc_step(config, state) -> status
rlc_advance(config, state, count, outPairs) -> status
rlc_read(config, state, output48B) -> status
mutual_step(config, state16B) -> status
mutual_advance(config, state32B, startStep, count, mode, omega:f64, outPairs, outShares) -> status
mutual_read(config, state32B, output40B) -> status
oscillator_step(config, state, time:f64) -> status
oscillator_advance(config, state, startStep, count, outPairs) -> status
oscillator_read(config, output16B) -> status
oscillator_omega0(mass:f64, stiffness:f64, outputF64) -> status
oscillator_amplitude(config, omega:f64, outputF64) -> status
oscillator_curve(config, min:f64, max:f64, count, outOmega, outAmplitude) -> status
neuron_step(config, state) -> status
neuron_advance(config, state, pulses, pulseCount, startStep, count, outVoltage, outUpward) -> status
ode_peak(values, count, outputF64) -> status
```

RLC readout: six f64 `[omega0,zeta,Q_or0,omegaD,energy,Q_defined]`. The final flag
is 0 for the ideal R=0 limit, 1 otherwise; no Infinity is stored. Mutual readout:
five f64 `[coupling,turnsRatio,secondaryVoltage,substeps,secondaryShare]`.
Oscillator readout: two f64 `[omega0,amplitude]`. Curves write two count-length
f64 arrays. Neuron output is count f64 voltages and count u8 upward flags. Its
pulse array is pulseCount u32 (alignment4); it must be sorted and unique. Pointer
zero is allowed only when pulseCount=0, and an empty pulse list must use zero.

`mutual_step` uses constant config voltages; the batch's mode0 does the same and
requires omega=0. Mode1 makes V1 the sine-drive amplitude. No other mode is
accepted. Steps require count>=1 and startStep+count<=u32::MAX; curves require
count>=2. Single steps are in-place and write state only on success. A failed
batch can contain a completed prefix; discard it rather than publish partial
results. The crate README specifies validation, numerical approximation and
physical scope. These are allocation-free Rust calls with no host math imports.

## Ray-optics additions (ABI6)

`optics_advance` is a required loader export. Existing layouts/statuses remain
unchanged; status8 specifically means the 20000 processed-ray safety limit was
exceeded. It invalidates the result, and must not be interpreted as completion.
Config/state/table contain u32 words (alignment4); records containing f64 align8.
All active regions must be disjoint, including immutable components/config/table
and every mutable buffer. Native sizes are asserted in the Rust tests.

| Record | Bytes | Fields in byte order |
| --- | --- | --- |
| Config | 16 | u32 componentCount,maxBounces,screenBins,reserved0 |
| Component | 88 | u32 kind,reserved0; f64 x,y,rot,length,power,wavelengthNm,focalLength,n,polAngleDeg,splitT |
| Ray | 64 | f64 x,y,dx,dy,intensity,wavelengthNm,polDeg; u32 bounces,polarized |
| Geometry | 48 | f64 x0,y0,x1,y1,nx,ny |
| Segment | 48 | f64 x0,y0,x1,y1,intensity,wavelengthNm |
| Hit | 48 | u32 componentIndex,kind; f64 x,y,intensity,wavelengthNm,s |
| Event | 80 | u32 type,componentIndex,kind,fieldsMask; f64 x,y,intensityIn,intensityOut,thetaI,thetaT,note0,note1 |
| Profile | 32 | u32 componentIndex,peakBin; f64 screenPower,total,peakS |
| State | 32 | u32 processed,stackLen,segmentCount,hitCount,eventCount,profileCount,initialized,reserved0 |
| Buffer table | 32 | u32 geometryPtr,stackPtr,segmentsPtr,hitsPtr,eventsPtr,profilesPtr,binsPtr,reserved0 |

Kind codes: laser0, mirror1, lens2, interface3, screen4, blocker5, polarizer6,
splitter7. Component defaults are resolved by the adapter: power1, wavelength635,
focalLength140, n1.5, polAngleDeg=rot, splitT=.5. Polarized is 0/1; an unpolarized
ray stores polDeg=0. Initial rays use polarized0.

Event types: reflect0, refract1, tir2, lens3, polarize4, split5, screen6, block7.
fieldsMask bits specify valid intensityOut1, thetaI2, thetaT4 and the unpolarized
polarizer input8. Unused numeric slots are zero, not NaN. For note0/note1:
refraction stores nFrom/nTo; lens stores f/height; polarizer stores factor/axis;
splitter stores T/R. Other events use zero. Adapters use those values and the
presence bits to reproduce the existing localized note templates without
putting UI strings inside the numerical core.

Geometry/profiles have componentCount slots. Bin storage has
componentCount×screenBins f64 slots, indexed componentIndex×screenBins+bin. Stack
capacity is exactly20576; segment/hit/event capacities are each20000. Only counts
in State are valid output prefixes. Screen profiles are in first-hit order,
which can differ from component order. Profiles carry both direct hit-order
screenPower and bin-order total because their floating-point sum order differs.

```text
optics_init(config, components, state, table) -> status
optics_advance(config, components, state, table, budget) -> status
optics_read(config, state, table) -> status
optics_unit(rot:f64, out16B) -> status
optics_normalize(dx:f64, dy:f64, out16B) -> status
optics_reflect(dx:f64, dy:f64, nx:f64, ny:f64, out16B) -> status
optics_refract(dx:f64, dy:f64, nx:f64, ny:f64, n1:f64, n2:f64, out24B) -> status
optics_incidence(dx:f64, dy:f64, nx:f64, ny:f64, outF64) -> status
optics_malus(pol:f64, polarized:u32, axis:f64, outF64) -> status
optics_segment(component88B, out48B) -> status
optics_intersection(ox:f64, oy:f64, dx:f64, dy:f64, geometry48B, eps:f64, out40B) -> status
optics_seed(components, count, outRays, capacity, outCountU32) -> status
```

Init supports reuse and sets initialized=1, all counters to zero except seeded
stackLen; it overwrites geometry/seeds and clears used bins/profiles. No caller
pre-clearing is needed. `optics_advance` accepts budget1..20000. Completion is
state.stackLen==0 after status0. `optics_read` requires completion and refreshes
profile totals/peak values; it rejects corrupt duplicate/out-of-range profile
indices or negative power. Config/components/geometry must stay immutable during
one trace; editing a scene requires init. A failed step can leave partial output:
discard it, and init before reuse.

Direction outputs are [dx,dy]. Refraction output is [dx,dy,valid], valid0 for
TIR. Intersection output is [t,s,x,y,valid], valid0 for no intersection. Invalid
optional values use zero slots. Unpolarized malus requires pol=+0 and flag0.
Seeding writes up to nine rays per laser and returns the actual count at the u32
output pointer; capacity must suffice and cannot exceed20576. Empty component
arrays and zero seed capacity have empty regions; their pointers are ignored.
Helpers require only small output/geometry buffers, not the full trace storage.

## Radar, laser and nonlinear-junction additions (ABI6)

Existing layouts and statuses remain unchanged. The loader requires
`radar_advance`, `laser_advance` and `nljd_result`, so an older ABI6 artifact
cannot silently appear to implement these additions. All pointers are byte
addresses in the existing caller-owned heap. Active regions must be disjoint;
alignment, bounds and alias checks run before creating references. Every export
returns the usual u32 status. No imports, per-step allocation or whole-field
copies are required.

| Radar record | Bytes | Fields in byte order |
| --- | --- | --- |
| Config | 32 | u32 totalSteps,mode,probes[4],reserved[2] |
| State | 40 | u32 completed,current,lengths[4],heads[4] |
| Range params | 48 | f64 pt,gt,gr,lambda,sigma,sMin |
| Readout | 96 | four f64 triples [v,pp,defined] |

Radar config/state align4, range/readout align8. Each field holds exactly 40000
f32 values (alignment4), mask 40000 u8, traces 1024 f64 (alignment8). Indexing is
x+200*y. Mode0 is pulse, mode1 CW. Probe0xffffffff is absent; all other indices
must be below40000. Reserved words must be zero. Current0/1 selects field0/1 as
the completed field; heads index the oldest ring element, not the next write.
The chronological sample i of channel ch is
`traces[ch*256 + (heads[ch]+i)%256]`, for i below lengths[ch]. Undefined readouts
are [0,0,0], not NaN sentinels.

```text
radar_init(config, state, field0, field1, mask, traces) -> status
radar_advance(config, state, field0, field1, mask, traces, count) -> status
radar_read(state, traces, output96B) -> status
radar_mask(mask) -> status
radar_max_range(params48B, outputF64) -> status
radar_received_power(params48B, range:f64, outputF64) -> status
radar_wavelength(frequency:f64, outputF64) -> status
radar_power_ratio(outputF64) -> status
```

Init clears both fields, traces and all state words, then writes the fixed mask.
It supports reuse without manual clearing. Advance requires count1..64 and
completed+count<=totalSteps<=2000. The core samples on even completed steps and
the final odd step, so different chunk sizes retain the same history. Configuration
and geometry stay unchanged during a run. Read may operate before completion;
empty channels are explicitly undefined. A failed advance may leave a completed
prefix; discard it and init before reuse. The standalone mask output contains
the same three fixed inclusive rectangles described by native `radar::TARGETS`.

All laser records align8: params32B=[tauN,tauC,B,spont], config48B adds [pump,dt],
state16B=[N,S], point16B=[p,s], readout24B=[threshold,pumpMax,steadyPhotons]. The
characteristic buffer contains exactly51 points (816B).

```text
laser_step(config48B, state16B) -> status
laser_advance(config48B, state16B, count) -> status
laser_threshold(params32B, outputF64) -> status
laser_steady(params32B, pump:f64, outputF64) -> status
laser_characteristics(params32B, pump:f64, curve816B, output24B) -> status
```

Single step changes state only on success. Advance accepts count1..65536 and
updates the persistent state after each successful step; discard the batch if
any step fails. Finite negative next populations are clamped to zero as in the
original model, but nonfinite derivatives/updates fail before clamping. The
parameter and numerical scope rules are documented in the crate README.

NLJD kind/verdict codes are semiconductor0, corrosion1, metal2. Coefficients16B
are f64[a2,a3]; harmonics24B are f64[f1,f2,f3]. Full readout72B is nine f64 values
`[a2,a3,f1,f2,f3,relative1,relative2,relative3,verdict]`, without native struct
padding. Transfer has exactly81 f64 entries (648B); all these buffers align8.
Only the standalone classify output is one u32, alignment4.

```text
nljd_response(v:f64, a2:f64, a3:f64, outputF64) -> status
nljd_coefficients(kind, output16B) -> status
nljd_harmonic_amplitudes(a2:f64, a3:f64, output24B) -> status
nljd_harmonics(kind, output24B) -> status
nljd_classify(harmonics24B, outputU32) -> status
nljd_result(kind, transfer648B, output72B) -> status
```

All outputs use the same Rust functions as native callers. The saved old-JS
fixtures and `detection-reference.rs` test the complete scene/helper outputs;
`detection-tests.mjs` also checks reset, chunk boundaries, invalid buffers,
reserved flags, nonfinite input and overflow without a long compute run.

## Static spatial sensing addition (ABI6)

`array_sense` is a required loader export; all previous ABI6 layouts remain
unchanged. Config/readout and every floating-point buffer align8; the pointer
table and permutation align4. All nonempty regions, including immutable inputs,
table/config, outputs and QR scratch, must be pairwise disjoint and inside the
caller-owned heap. No host imports or allocations are used.

```text
array_sense(config40B, input, sensing, bias, customCode, table32B, readout40B) -> status
```

Config40B byte offsets:

| Offset | Type | Value |
| --- | --- | --- |
| 0 | u32 | n: spatial input count, 1..64 |
| 4 | u32 | sensors: K, 1..64 |
| 8 | u32 | measurements: M, 1..128 |
| 12 | u32 | encoding: direct0, normalized Sylvester Hadamard1, custom2 |
| 16 | u32 | seed, all u32 values supported |
| 20 | u32 | reserved0 |
| 24 | f64 | noisePeakV, finite 0..1e6 |
| 32 | f64 | lambda, finite 0..1e6 |

Input is N f64, sensing K*N f64, bias K f64. Custom code is M*K f64 for mode2;
its pointer must be exactly0 in modes0/1. Matrices are row-major. Direct and
Hadamard require M=K; Hadamard also requires K to be a power of two. All supplied
input/matrix/bias values are finite and bounded by absolute value1e6.

The table has eight u32 pointers in this order:

| Index | Buffer | Elements |
| --- | --- | --- |
| 0 | encoding | M*K f64 |
| 1 | sensor_voltages | K f64 |
| 2 | measurements | M f64 |
| 3 | reconstructed | N f64 |
| 4 | error | N f64 |
| 5 | qr | (M+N)*N f64 |
| 6 | rhs | M+N f64 |
| 7 | permutation | N u32 |

Readout40B is f64 rmse@0, residual_rms@8, rank_tolerance@16, followed by u32
rank@24, resultStatus@28, rng_state@32, reserved0@36. The readout resultStatus
is distinct from the export's error status: result0=solved, result1=rank-deficient
without unique reconstruction, result2=regularized. On result1, reconstruction,
error and both RMS slots are zeroed undefined storage and must become null or
absence in product results; forward/encoding/measurement/rank values remain
valid. The original A rank and threshold are reported even for regularized solves.

Every successful call fully replaces the outputs/work and restarts the RNG from
config.seed. One draw is consumed per measurement even at zero noise. An error
may leave partial output and must invalidate the result. ABI status5 specifically
means the reconstruction is numerically indeterminate (e.g. the augmented ridge
matrix remains numerically rank-deficient); it is not a fluid density error.
Status4 includes nonfinite input/arithmetic overflow, status3 invalid coefficients,
status1 invalid counts, status2 invalid memory/length/alias and status7 reserved
config words. Correct inputs and call again to reuse the same memory.

The crate README describes the equations, rank criterion, physical units,
accuracy limits and independent small references. `sensing-tests.mjs` checks
all native/WASM outputs and scratch bytes, owner reuse, null semantics, bounds,
misalignment and aliases without a separate numerical implementation.

## Serial RC readout and transient additions (ABI6)

The loader additionally requires `array_sense_sampled`, `transient_result` and
`transient_advance`. ABI6 and all preceding layouts remain unchanged. The old
array_sense export is a thin compatibility boundary to the same numerical core.

```text
array_sense_sampled(config40B, input, sensing, bias, customCode, rcConfig,
                    table40B, readout64B) -> status
```

The sensing config and input matrices retain their preceding definitions.
rcConfig must be0 for static readout, or point to four f64 values
`[resistance,capacitance,dwell,initial_voltage]` (32B, align8). SI units and finite
parameter ranges are specified in the crate README. The table retains its first
eight u32 pointers and adds ideal_voltages[M] at byte32 and sampled_voltages[M] at
byte36; both are f64, align8. All pointers, including the optional RC config and
both new arrays, participate in the existing range/alignment/alias checks.

The first40 bytes of the readout retain SensingReadout. Three trailing f64 values
are settling_fraction@40, decay@48 and tau@56. Total size is64B, align8. Static
readout returns these as1,0,0 and fills both new voltage arrays with the encoded
target values. With RC enabled the first40 bytes refer to the filtered measurement
operator. Noise is added after the sampled_voltages output and never feeds back
into its recurrence. All outputs/work are reusable; each call restarts at the
configured initial voltage and RNG seed.

For transient helpers, TransientConfig is40B: u32 mode@0, reserved0@4, then f64
v0@8,r@16,c@24,l@32. Mode0=RC charge, 1=RC discharge, 2=RL current. The output
readout is24B f64[tau,y_max,steady]; curve storage is241 f64. Units are V for
RC and A for RL, derivable from the immutable mode. FirstOrderConfig is32B
f64[voltage,resistance,capacitance,dt], with one persistent f64 state. All of these
records/arrays align8 and must be disjoint.

```text
transient_result(config40B, values241, output24B) -> status
transient_step(config32B, stateF64) -> status
transient_advance(config32B, stateF64, count) -> status
transient_tau_rc(r:f64, c:f64, outputF64) -> status
transient_tau_rl(l:f64, r:f64, outputF64) -> status
transient_charge(t:f64, v0:f64, r:f64, c:f64, outputF64) -> status
transient_discharge(t:f64, v0:f64, r:f64, c:f64, outputF64) -> status
transient_current(t:f64, v0:f64, r:f64, l:f64, outputF64) -> status
transient_weights(time:f64, tau:f64, output16B) -> status
```

Weights16B is f64[decay,settling_fraction], in that order. Step is RK4 and writes
state only on success; advance repeats the same step count1..65536 times and may
leave a successful prefix on failure. Curves and RC sampling are analytic, not
RK4. The general helpers require positive finite time constants/components,
nonnegative finite time, finite signed voltage, and positive finite dt for RK4.
Unknown modes/reserved bits, invalid pointers and nonfinite arithmetic fail
explicitly under the existing statuses. Callers must discard any failed output.

## Faraday induction addition (ABI6)

The loader requires `faraday_result` and `faraday_series`. Previous ABI layouts
are unchanged. FaradayConfig is56B f64[omega,b,n,area,v_bar,b_mot,l_bar]; readout
is40B f64[peak,linkage,motional_emf,frequency,period]. Flux and EMF are each361
f64 elements. All these records/arrays align8 and must be pairwise disjoint,
inside the existing caller-owned heap. The product call writes both complete
curves and scalar readout, so memory may be reused without pre-clearing.

```text
faraday_result(config56B, flux361, emf361, output40B) -> status
faraday_induced(dPhiDt:f64, n:f64, outputF64) -> status
faraday_motional(b:f64, length:f64, v:f64, outputF64) -> status
faraday_peak(n:f64, b:f64, area:f64, omega:f64, outputF64) -> status
faraday_flux(t:f64, n:f64, b:f64, area:f64, omega:f64, outputF64) -> status
faraday_emf(t:f64, n:f64, b:f64, area:f64, omega:f64, outputF64) -> status
faraday_series(flux, count:u32, dt:f64, n:f64, output) -> status
```

Series input/output each contain count f64 values and must not overlap. For
count0 both pointers must be0; the function validates scalars without creating
a reference to a null pointer. A singleton writes -N*0 as before. Positive finite
dt is required; all other scalar helper inputs may be finite signed values.
The full curve requires positive finite omega. Nonfinite arithmetic and memory
errors retain the existing explicit statuses, and a failed output must be
discarded. No new allocator, library, global state or host math call is needed.
