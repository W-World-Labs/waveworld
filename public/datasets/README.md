# MIT-BIH recording excerpt

Contains information from the [MIT-BIH Arrhythmia Database v1.0.0](https://physionet.org/content/mitdb/1.0.0/),
made available under the [Open Data Commons Attribution License v1.0](https://physionet.org/content/mitdb/view-license/1.0.0/).
Creators: George B. Moody and Roger G. Mark, MIT / Beth Israel Hospital.

`mit-bih-100-10s.csv` contains the first 3,600 frames (10 seconds) of record 100,
channels MLII and V5 at 360 samples/second, in mV. Values are recorded data,
not a synthesized waveform. No patient demographics or beat annotations are included.
Original source files: `https://physionet.org/files/mitdb/1.0.0/100.hea` and `https://physionet.org/files/mitdb/1.0.0/100.dat`.

Conversion: decode signed WFDB format 212 samples, subtract ADC zero 1024,
divide by gain 200 ADC units/mV. No resampling, filtering or normalization.
The complete source record's two signed 16-bit checksums were verified against
the header (-22131, 20052); first ADC values were verified (995, 1011).

Original `100.dat` SHA-256: `b2ea3c250e56e48f4b7b90697832b8ecd1afa1e0bb31f2dcfea4ed6e1075a639`.
Distributed CSV SHA-256: `914c8c8d8c4781f9964935859b5384bbbf649d7bc9dba38972bd613dc1c59bc5`.

Citation: Moody GB, Mark RG. The impact of the MIT-BIH Arrhythmia Database.
IEEE Engineering in Medicine and Biology 20(3):45–50, 2001.
Please also cite PhysioNet as requested on the linked dataset page.

CSV import format: metadata comment lines `# name=...`, `# sample_rate_hz=...`,
`# unit=...`, optionally `# source=https://...` and `# license=https://...`;
then unique channel names followed by rows of finite numeric samples.
The importer accepts 1–8 channels, 2–20,000 frames and files up to 4 MiB.
The sample rate is explicit; no timestamps or rates are guessed.

# LAMMPS 2D Lennard–Jones hello world

`lammps-lj-2d.data` is a 32-particle state generated with LAMMPS 22 Jul 2025 Update 4
from its [official 2D liquid example](https://raw.githubusercontent.com/lammps/lammps/3214c5b1a0e8ad562e436e9a81ec5e8e4883f61a/examples/VISCOSITY/in.gk.2d).
Original input SHA-256: `ab4cf71cfef5b4af50b7c913740f71dd77963d7e1b07d00bc694a7c75ca6693c`.
The original input was downloaded unchanged and run with command-line overrides
`-var x 4 -var y 4 -var nequil 2 -var nprod 4 -var p 2 -var s 1`.
The original two short runs generate an initial state; their viscosity estimate is
not a validated material property. `write_data` preserves coordinates, velocities,
masses and pair coefficients. This numerical dataset does not bundle LAMMPS.

`lammps-lj-2d-reference.json` contains a further **5 NVE steps** from that data file,
computed by real LAMMPS. Reproduce it with `scripts/research/lammps-hello.py` in a
separate environment containing the LAMMPS Python package. The reference uses
`units lj`, `dimension 2`, periodic x/y boundaries, `lj/cut 2.5`, mass 1,
`pair_modify shift yes mix arithmetic`, `timestep 0.005`, and
`compute_modify thermo_temp extra/dof 0` (2N degrees of freedom), with unnormalized
extensive energy totals (`thermo_modify norm no`). Energy shifting and temperature
DOF are set explicitly to match WaveWorld; the imported velocities are not reseeded.
The 32-particle reference is a format/short-trajectory check, not convergence or
transport-property validation. CI reads the checked-in snapshot and runs five
small internal steps; it does not download/install/run LAMMPS.

Data SHA-256: `ff8fed370ddd31848932dee727f7187a86c3a910f5f3c73affa2d30cbd563a1a`.
Reference SHA-256: `7e012e2bfa4e9ae017594b4ac010a03810892ca8055929e0b5b2101226ec14a8`.

The importer accepts **LAMMPS data**, not input scripts: 2–400 atoms, `Atoms # atomic`,
`Masses` (all 1), `Pair Coeffs # lj/cut` (cutoff 2.5), optional `Velocities`, a square
orthogonal x/y box and z=vz=0. LJ units, energy shifting and Lorentz–Berthelot mixing
are explicit assumptions of the selected WaveWorld method; a data file alone does
not encode all run settings. Files that explicitly declare other units are rejected.
Missing velocities are zero, not random. Particle indices are sorted by atom ID;
periodic image flags do not carry the previous run's MSD history into a new run.
Bonded sections, molecular/charge styles, triclinic boxes, nonplanar coordinates, other pair styles and
unknown sections fail explicitly. Maximum file size is 512 KiB. Gaussian `.gjf`,
Materials Studio `.xsd`, XYZ/CIF and complete LAMMPS scripts are not supported yet.

# ASE, FiPy and ngspice reference examples

`software-hello-reference.json` contains numerical output from **ASE 3.29.0**,
**FiPy 4.0.3** and **ngspice 42**. These programs ran in a temporary environment,
with Python 3.12, NumPy 2.5.3 and SciPy 1.18.1. They are not product dependencies.

| Software | Official example actually run | WaveWorld comparison |
| --- | --- | --- |
| [ASE LJ tests](https://gitlab.com/ase/ase/-/raw/3.29.0/ase/test/calculator/test_lj.py) | All 7 upstream tests passed, unmodified | The existing 32-particle LAMMPS data, read independently by ASE, followed by 5 NVE steps |
| [FiPy explicit diffusion](https://raw.githubusercontent.com/usnistgov/fipy/4.0.3/examples/diffusion/explicit/mesh1D.py) | All 22 doctest examples passed, including 100 steps on 100 cells and the upstream analytic check | The same equation adapted to our 192×120 unit-cell heat grid, 3 steps, center and corner deposits, insulated faces |
| [ngspice beginner tutorial](https://ngspice.sourceforge.io/ngspice-tutorial.html) | Its original dual RC topology ran to 50 ms, producing 1,029 adaptive samples | Separate one-pole RC charge/discharge and RL step cases matching our current module inputs; 241 uniformly resampled points per curve |

These are two distinct checks: upstream examples run in the upstream program,
and explicitly matched cases run in both programs. The original ngspice dual RC
network is **not** supported by WaveWorld's one-pole transient method.

ASE uses `units="ASE"` while reading the data, leaving its numerical coordinates,
velocities and unit masses unchanged. The atom label Ar is metadata, not a claim
to model physical argon. The comparison sets periodic x/y and nonperiodic z,
epsilon=sigma=mass=1, cutoff 2.5, energy shifting without force smoothing and
Verlet timestep 0.005 in numeric reduced units. No velocities are regenerated.
The maximum position difference from WaveWorld was 7.75e-7; total energy differed
by 1.91e-6. This also agrees with the independent LAMMPS reference above.

FiPy uses `TransientTerm() == ExplicitDiffusionTerm(coeff=1)`, floating-point
unit mesh spacing, dt=0.2, zero-flux faces and the exact deposits in the stored
input. Its maximum field difference was 1.11e-7; total difference was 2.61e-7.
Only the 56 nonzero reference cells are stored; the CI comparison reconstructs
and checks the complete field. Integer spacing in this FiPy environment produced
zero boundary distances; the runner uses `dx=dy=1.0` and rejects nonfinite output.

The ngspice comparisons use V=5 V, R=1 kΩ, C=100 µF and L=0.5 H, with initial
capacitor voltage 0 V for charging / 5 V for discharging and initial inductor
current 0 A. Each runs from 0 to 5 time constants with UIC, trapezoidal integration,
maximum internal timestep tau/1000, reltol=1e-9, abstol=1e-12 and vntol=1e-10.
`linearize` explicitly resamples the adaptive solution to 241 uniform points.
Maximum RC voltage differences were below 6.1e-7 V; RL current difference was
below 6.1e-10 A. The initial extrapolated samples have small numerical offsets.

`ngspice-rc-charge.csv` is the charging curve in the existing replay CSV format:
480 Hz, 241 samples, channel Vc, unit V. It is **simulated circuit output**, not a
measured signal or ECG. It can be imported through the current CSV replay control
on `/ecg`; sample rate and volts are preserved locally and in backend statistics.
This does not add a SPICE netlist parser. FiPy Python scripts, ASE projects,
general SPICE circuits and additional molecular file formats are not imported.

Reproduce outside CI (use a new output directory):

```bash
python3 -m venv /tmp/waveworld-reference-venv
/tmp/waveworld-reference-venv/bin/pip install ase==3.29.0 fipy==4.0.3 pytest==9.1.1 numpy==2.5.3 scipy==1.18.1
FIPY_SOLVERS=scipy OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
  /tmp/waveworld-reference-venv/bin/python scripts/research/software-hello.py \
  --ngspice /path/to/ngspice --output-dir /tmp/waveworld-reference-output
```

The runner downloads the three upstream sources, verifies the hashes in
`SOURCES`, runs the examples and writes generated decks, logs, references and
`provenance.json`. `--source-dir` can reuse previously downloaded, hash-verified
inputs. The ngspice tutorial HTML is checked as downloaded on 2026-09-07; changed
upstream content fails explicitly. Only the hash-matched example files are executed.
This run used Ubuntu's `ngspice_42+ds-3build1_amd64.deb`, extracted into `/tmp`
without installing it system-wide. The optional runner's `-n` flag disables
ngspice user startup files. No service or listener is started.

Reference SHA-256: `8c44748e70969e786127483fdc27d6cde669c206bfe430f89b5c42abbc0afeb9`.
CSV SHA-256: `601b8e7113140c3394c4127bdfc464a7cadce9a98bc61f919614d4775bf30376`.
The original dual-RC netlist extracted from the tutorial has SHA-256
`ad81658ed59ed4f59a3cb76ab7f6aa7ffffcb9f40b33d8ed53ee51e97ea0797e`.

Normal CI reads only these bundled numerical snapshots: five particle steps,
three heat steps and short analytic curves/replay. It never installs or runs
the external programs. These checks establish specific small-case agreement,
not general format compatibility or engineering validation.

# Touchstone import examples

`touchstone-example.s1p` and `touchstone-example.s2p` are small synthetic
Touchstone 1.0 examples for the local CST S11 import workflow. The one-port
example uses MA values in MHz; the two-port example uses RI values in GHz.
They are format fixtures only, not vendor data, measurements, or reference
device responses. The parser fixture test checks their parsed frequencies and
network shape.

`touchstone2-example.s2p` and `touchstone2-example.s3p` are authored synthetic
Touchstone 2.0 full-matrix RI examples with explicit counts and common 50-ohm
references. They are parser inputs only, not vendor oracles, measurements, or
reference device responses.

S1P SHA-256: `8ddddf2eec88eb70a57721e4789fc7f4b7d5797ffa3d07580d86823d3ea9f150`.
S2P SHA-256: `abbc2f490b466ce1c8c161b70e6f7072941c881547900e01bfbe32538d934c32`.
Touchstone 2.0 S2P SHA-256: `f771475b5ac0ba15a4321024ff073b1769fd070b7e6b495067d273bdef531faf`.
Touchstone 2.0 S3P SHA-256: `cbfa8753175be1679b1a8185d41784974ddb82fd87063ee21b685207bde1e5ef`.

# FEM and STAR-CCM import fixtures

These authored examples exercise bounded import workflows; they are not vendor-validated analysis results. Every nested file, including the FEM ZIP, is byte-pinned below.

| File | SHA-256 |
| --- | --- |
| `public/datasets/fem-import/README.md` | `e29a70bb36720e2336144590e4f993385d822a18f4d94b560e94fcbb646bb512` |
| `public/datasets/fem-import/assembly-tetra-example.inp` | `fa86c03548b976ecb04b39de23d527f463a6ea60b1166b6a2cc447cc1354c833` |
| `public/datasets/fem-import/assembly-tetra-example.json` | `a6f567083aaeb4372dbb7ec9f850704fe51446c9492cbdb8c55dbb06b9d07722` |
| `public/datasets/fem-import/fem-include-example.zip` | `4d1a7ca78063ccf46e1bfc0b6069f3bc380669a5c6e7d3107024928ae5e5eddf` |
| `public/datasets/fem-import/loads.inc` | `699c1096de8e8c2d7b122307102e6e7aa2fb5321aa50285cdec4f20279861358` |
| `public/datasets/fem-import/main.inp` | `d0f6742eb959316301bc6c83d0df9f141f0edc38f55b916429dc550fda0f492e` |
| `public/datasets/fem-import/material.inc` | `48c4a179c68c5c739a2b81d469a45bd1fdef3884e1d7e5d8ce497644baab46ff` |
| `public/datasets/fem-import/mesh/mesh.inc` | `3705a671507ab62b9b280ea820c9f7028bc1811789391962064cfdd3011b7d5b` |
| `public/datasets/fem-import/nodes.inc` | `ad0415cefd47a90e0105bed419f27d82bda6a01e1bd4e0f70591e2bb49c50267` |
| `public/datasets/fem-import/pressure-c3d8.inp` | `14703d5e95ae140d27a6afff35c042e268f1f9bfc75dc9b44191a551c5d9cd0e` |
| `public/datasets/star-ccm/directional-cfl-example.csv` | `d77fccd2af52162b76e1ebbd6e9edcb4e14fe649557de811532a20c3126883ca` |
