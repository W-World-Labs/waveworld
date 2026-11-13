# FEM multi-file import example

Download `fem-include-example.zip`, extract it, and select the whole extracted folder in the FEM import page so the referenced `.inc` files retain their relative paths. The deck demonstrates a single linear C3D4 tetrahedron using the existing structural import subset; it is an import/diagnostics example, not a verified analysis case. Units are an explicit SI convention for this example: node coordinates in m, elastic modulus in Pa, density in kg/m³, and concentrated load in N (Abaqus itself does not assign units).

File relationships:

```text
main.inp
├── mesh/mesh.inc
│   └── ../nodes.inc
├── material.inc
└── loads.inc
```

The FEM `*INCLUDE` resolver and WaveWorld import-to-JobSpec flow are under development; unified tests are pending. Only the existing structural subset is intended. This sample does not claim complete Abaqus or CalculiX keyword compatibility.

`assembly-tetra-example.inp` is a synthetic one-part, one-instance C3D4 assembly example. It has no step or loads and is provided to show the supported assembly syntax only; the adjacent JSON records its explicit SI convention and provenance. The bounded importer accepts one named meshed part, one assembly, one matching instance, and either no placement data or one three-number translation row. It does not support rotations, multiple parts or instances, nested assemblies, or instance mesh overrides. This example is not vendor-validated.

`pressure-c3d8.inp` is a standalone unit-cube example of a C3D8 `*DLOAD` face pressure (`P1`). The importer supports a constant load in one linear static step, targeted by element label or ELSET; C3D4 triangular faces are integrated exactly and C3D8 quadrilateral faces are limited to planar parallelograms. Warped faces, modal/nonlinear steps and surface-based pressure are unsupported. The imported C3D8 stiffness still uses the existing tetra-split approximation. This is an import/JobSpec example, not a solver result or an Abaqus parity claim. Its explicit sample units are m, Pa and N/m²; Abaqus itself does not assign units.
