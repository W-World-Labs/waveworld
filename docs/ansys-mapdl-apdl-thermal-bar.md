# MAPDL APDL thermal-bar import

WaveWorld can import a narrow, literal subset of Mechanical APDL input for a
steady-state, linear, one-dimensional thermal bar. The importer translates
that input into a W-Sim native thermal FEM job. It does not read MAPDL archive
or binary databases, invoke Ansys, or claim to parse general APDL.

## Accepted model

The input must describe one material (`MAT,1`) with one constant `MP,KXX`
conductivity, one cross-section area (`R,1,<area>`), and a single `LINK33`
element type. The mesh is a straight x-axis chain of 2-node elements, with
strictly increasing x coordinates and 2 through 256 unique nodes (at most 255
elements). Each adjacent pair in geometric order must be connected. Numeric
APDL node labels are retained for display in imported results; the W-Sim mesh
uses its own ordered node indices.

Both chain endpoints must have prescribed temperatures. Nodal heat loads are
optional. The APDL `F,<node>,HEAT,<value>` form represents an applied nodal
heat rate; it is not volumetric heat generation. Only steady-state linear
conduction is in this importer subset.

## Literal command subset

The recognized commands are:

```text
/PREP7
ET,1,LINK33
R,1,<area>
MP,KXX,1,<conductivity>
N,<id>,<x>,<y>,<z>
TYPE,1
REAL,1
MAT,1
E,<nodeI>,<nodeJ>
EN,<elementId>,<nodeI>,<nodeJ>
FINISH
/SOLU
ANTYPE,STATIC  ! may instead appear in /PREP7, but only once
D,<endpoint>,TEMP,<value>
F,<node>,HEAT,<value>
SOLVE
FINISH
! comments
```

These are literal records with numeric values. The importer fails closed on
unrecognized commands or fields; it does not evaluate APDL. In particular,
NBLOCK/EBLOCK and archived or binary databases are unsupported, as are
macros, parameters, expressions, command substitution, selection commands,
coordinate-system transforms, and non-axis-aligned geometry. Multiple
materials, element types, or areas are unsupported. Transient analysis,
convection, radiation, contact, element body heat generation, and all other
unsupported commands are rejected. Input is bounded to 65,536 text bytes,
2,048 commands, and numeric magnitudes no greater than 10^12.
Native input bounds further restrict x coordinates to ±10^6 m, conductivity
to 10^-6 through 10^6 W/(m·K), area to 10^-12 through 10^6 m², endpoint
temperatures to -273.15 through 2000 °C, and nodal heat to ±10^12 W.
The element type, real constant set, and material selectors must be set to 1
before element records. `ANTYPE,STATIC` may appear in `/PREP7` or `/SOLU` and
must appear before load records, and
no command may follow `SOLVE` except `FINISH`.

## Units and mapping

APDL does not attach units to these literal numbers. The importer interprets
the input in SI: coordinates and area in m and m², conductivity in W/(m·K),
temperature in °C (temperature differences equal K), and nodal `HEAT` in W.
The one `KXX` value and area apply to the entire chain. Since the accepted
analysis is steady state, density and heat capacity are outside this format.

This subset assumes a standalone text deck in the default global Cartesian
coordinate system. Coordinates must lie along its x-axis; y and z do not define
a transformed or curved bar. Imported nodes are ordered by increasing x, and
connected `E`/`EN` elements must form one adjacent two-node chain. Original
external node labels remain available as display labels while the native
solver receives ordered mesh indices. `D` records must constrain the two
endpoints. Optional `F,...,HEAT,...` records apply nodal heat loads as supported
by the importer.

## Execution and report scope

After import, WaveWorld submits a `sw-ansys-thermal-fem` job to the native
W-Sim host FEM operation. The job is solved by W-Sim; the APDL text is not
passed to or executed by Ansys. The report presents the native W-Sim result
against the imported input and preserves original node labels for display.
This import path does not reproduce a complete MAPDL solution database or
Ansys post-processing output.

## Ansys syntax references

The official [LINK33 element reference](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/ans_elem/Hlp_E_LINK33.html)
describes the thermal bar and its `KXX` material property and cross-section
area. The [Verification Manual VM95 input listing](https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/ans_vm/Hlp_V_VM95TXT.html)
and [VM114 listing](https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/pdf/Ansys_Mechanical_APDL_Verification_Manual.pdf)
show literal LINK33, `R`, `MP,KXX`, node/element, temperature constraint, and
solution-command usage. The corresponding MAPDL [ET](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/ans_cmd/Hlp_C_ET.html),
[N](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/ans_cmd/Hlp_C_N.html),
[E](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/ans_cmd/Hlp_C_E.html),
[EN](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/ans_cmd/Hlp_C_EN.html),
[R](https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/ans_cmd/Hlp_C_R.html),
[MP](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/ans_cmd/Hlp_C_MP.html),
[D](https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/ans_cmd/Hlp_C_D.html),
[F](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/ans_cmd/Hlp_C_F.html),
and [ANTYPE](https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/ans_cmd/Hlp_C_ANTYPE.html)
command references define the corresponding fields and command processors.
These sources document APDL syntax and element usage; they do not establish
numerical parity between Ansys MAPDL and W-Sim.
