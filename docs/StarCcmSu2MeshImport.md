# STAR-CCM+ SU2 mesh import and preparation

WaveWorld's **SU2 mesh import and preparation** panel reads a bounded SU2 native ASCII mesh and sends it to the existing pinned W-Sim `sw-su2-mesh-import` module through the current authenticated local Host operation. It reports mesh structure and geometric measures for preparation and inspection. The module contract and released pin are unchanged.

## Workflow

1. Export or prepare an SU2 native ASCII mesh (`.su2`) and upload it in the panel. The panel reads the text locally; it does not open a STAR-CCM+ project.
2. Review the parsed dimension, node and element counts, marker summary, bounding box, per-type counts and measures, totals, minimum and maximum measures, unused-node count, and inverted 3D element count. `ok` indicates only that no inverted 3D elements were detected by this check.
3. Download the source mesh text when you need to retain or reuse the uploaded input. Keep it with your own export settings and provenance records.

The SU2 file has an order-sensitive structure: `NDIME= 2|3`, then the `NPOIN` coordinate block and `NELEM` volume-element block (the parser also accepts `NELEM` before `NPOIN`), followed by `NMARK` and its `MARKER_TAG` / `MARKER_ELEMS` blocks. `%` comment lines are accepted. Node references are zero-based and must address the declared point list. A point line has coordinates and may have a trailing node index; an element line has its type code, required node indices, and may have a trailing element index.

## Supported mesh subset and limits

Only linear VTK element codes used by SU2 are supported: `1` point, `3` line2, `5` tri3, `9` quad4, `10` tet4, `12` hex8, `13` wedge6, and `14` pyramid5. Unknown and higher-order types are rejected. The element topological dimension must not exceed `NDIME`.

The panel caps raw source text at **1 MiB UTF-8** and also requires the serialized Host input to fit within **1 MiB**; JSON framing means the effective source allowance is smaller than 1 MiB. The existing native module independently accepts at most **8 MiB** of mesh text, **5,000,000 nodes**, and **5,000,000 elements**. The panel's lower source and transport bounds apply first.

For safe preprocessing, retain a copy of the original export, remove unsupported/higher-order cells only when that is appropriate for your use, and keep `NDIME`, declared counts, node numbering, element references, and marker references consistent after edits. If extracting a subset, remap every affected reference and preserve boundary markers you need. Do not treat automatic linearization or index changes as harmless; validate the resulting file in the exporting tool or your own mesh workflow.

## What the summary validates

The importer checks section structure and counts, supported element codes and token counts, coordinate finiteness, node-index bounds, and dimension consistency. It computes linear-element length, area, or volume measures and reports geometric summaries and marker measures. A zero or inverted measure, skewness, aspect ratio, non-manifold connectivity, boundary closure, and solver suitability are not comprehensive quality gates. The result does not repair or optimize the mesh.

This workflow accepts SU2 native ASCII mesh text only. It does not read or write proprietary STAR-CCM+ `.sim` files, invoke STAR-CCM+ APIs or sessions, reconstruct a complete STAR-CCM+ mesh, solve a flow case, or establish full mesh or numerical parity with STAR-CCM+, SU2, or another vendor tool. A pinned-module preparation result is not a solver result or vendor PASS.

## Deferred checks

Mesh quality criteria such as skewness, aspect ratio, non-orthogonality, boundary closure, and application-specific suitability remain deferred. CGNS and other binary/container formats are outside this importer. Solver setup, boundary-condition transfer, convergence, accuracy, and comparison against vendor-generated data also remain outside this workflow.
