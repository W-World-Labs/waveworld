# Orthotropic elastic material-card source workflow

WaveWorld's Abaqus page accepts a small standalone `*ELASTIC, TYPE=ENGINEERING CONSTANTS` source fragment and maps its nine engineering constants to the existing W-Sim `sw-calculix-orthotropic-elastic` card method (`method-algo-calculix-elastic-card`, `type: "engineering"`). It evaluates the material constitutive law in host f64 arithmetic and reports the material-axis stiffness `C`, compliance `S`, and stress for the optional supplied material-point strain. This is a material-card workflow, not an input-deck importer.

The existing method and row schema were checked at the WaveWorld CI/deploy pin `dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`; this workflow adds no W-Sim schema, method, or pin change.

The source reader accepts one `*ELASTIC` keyword with only the `TYPE=ENGINEERING CONSTANTS` option and nine finite decimal constants, optionally followed by one finite temperature value: `E1, E2, E3, nu12, nu13, nu23, G12, G13, G23[, temperature]`. It does not read a surrounding `*MATERIAL` block or other keywords. The source order places `nu13` before `nu23`; the importer assigns those values to the named native fields `nu13` and `nu23` respectively (the native method's internal engineering vector order is `nu12, nu23, nu13`). If present, the temperature becomes the single row's `temperature` in the native `lines` input. This does not provide temperature interpolation: multiple rows and a temperature query are outside this source reader. The source text is limited to 2 MiB; the native module job retains the shared 1 MiB inline input limit.

The nine values are passed through without unit inference or conversion. Use one internally consistent unit system for the elastic moduli and any reported stress; Poisson ratios and strains are dimensionless. The calculation uses material principal axes. It does not read or apply a deck `*ORIENTATION`. Strain and stress use Voigt order `11,22,33,12,13,23`; the three shear inputs are engineering shear strains, `gamma_ij = 2 epsilon_ij`, so the corresponding elastic shear terms are `G12`, `G13`, and `G23`.

When a material-point strain is supplied, the card method may also return `sigma = C epsilon` for that strain. This is a pointwise constitutive response only. The workflow does not integrate elements, assemble a mesh, solve global equilibrium, run Abaqus or CalculiX, or establish solver parity.

## Source evidence

The raw CalculiX fixture [`shell4.inp`](../../../vendor-suites/calculix/repo/test/shell4.inp) at lines 1673–1675 contains `*ELASTIC,TYPE=ENGINEERING CONSTANTS`, the nine constants `181000,10300,1000000,0.28,0,0,7150,5958.3333,5958.3333`, and trailing temperature `295`. This records literal card syntax and values from a CalculiX test deck; the source does not specify units. The values are source syntax evidence, not evidence of solver performance or numerical parity.

## Verification boundary

The workflow and source mapping were checked by static source inspection. No tests, build, parser execution, Abaqus or CalculiX solver, or numerical parity check was run.
