# Source and third-party rights

The root MIT license applies only to W-owned code, documentation and authored
synthetic examples. It does not relicense third-party source, meshes, public
datasets, packages, native codecs or marks. Engine licenses grant no rights in
arbitrary user input or extracted output.

## Models

- **Duck:** copyright Sony, SCEA Shared Source License 1.0; **not CC-BY or MIT**.
  Preserve `licenses/models/Duck.README.md`, the complete `SCEA.txt`, source
  documentation, modification disclosures and all original conditions, including
  section 3. No OSI certification or separate patent/commercial clearance is claimed.
- **Cesium Milk Truck:** copyright 2017 Cesium, CC-BY-4.0, with separately reserved
  Cesium marks. Original attribution/source and mark terms remain in
  `licenses/models/CesiumMilkTruck.README.md` and
  `licenses/models/LicenseRef-LegalMark-Cesium.txt`. The solid STL is a voxel-
  remeshed watertight derivative. Lossless source gzip changes packaging only.
- **ToyCar:** original metadata and official README declare **CC0-1.0**, not the
  earlier CC-BY label. Retain `licenses/models/ToyCar.README.md`; the solid STL
  is a voxel-remeshed derivative.
- **NASA meshes and derived solid presets:** retain NASA attribution, the official
  free/without-copyright statement in `licenses/models/NASA-3D-Resources.README.md`,
  and the exact source/conversion notes in `apps/lab/public/models/README.md`.
  Marks and third-party rights remain separate; no NASA endorsement is implied.
  The oversized raw X-57 reference GLB is excluded; the actual solid preset remains.
- **OCP Project Olympus / Microsoft:** OWFa 1.0, independently of MIT. Exact
  revision, original notice, conversion parameters and hashes remain in the model
  README, adjacent `olympus-source.json`/original license, retained upstream
  `licenses/models/Project-Olympus.README.md` and GLB metadata. These are offline
  visualization tessellations, including a disclosed cover-removed preview, not
  validated thermal/fluid models. Explicit preparation restores lossless gzip bytes.
- **Ahmed:** the downloaded STL has no verified redistribution license and is
  excluded. Explicit preparation reuses the existing W-owned procedural generator.
  Its teaching approximation is not the downloaded mesh or a validation oracle.
- **PR2:** the optional unregistered reference mesh is excluded pending precise
  upstream license evidence. Generic model upload/import remains available.

## Other source and data

- Original Google Draco Apache-2.0 notice remains at
  `apps/lab/public/draco/LICENSE`. Explicit builds copy unmodified decoders from
  the locked Three.js package; runtime loaders do not install or patch engines.
- External software-case inputs retain complete original notices alongside their
  components under `scripts/research/software-cases/`: CalculiX, cclib, CP2K,
  EnergyPlus, Frame3DD, LAMMPS, MOOSE and Quantum ESPRESSO. Their terms remain
  authoritative for those inputs; the root MIT license does not replace them.
- The paired experimental curves under `research/golden-case/` are from Elin
  Sandberg, Chinmaya V. Srambickal, Joachim Piguet, Haichun Liu and Jerker
  Widengren, Zenodo record [7469900](https://doi.org/10.5281/zenodo.7469900),
  public record v2 (2023-04-28), **CC-BY-4.0**, independently of MIT. The original
  title, upstream entries, normalization and hashes remain in that directory's
  manifest and README. Recorded self-authored numerical failures, thresholds and
  pending independent review are retained; publication is not scientific acceptance.
- The recorded MIT-BIH excerpt remains under ODC Attribution 1.0 with
  Moody/Mark/PhysioNet attribution and exact conversion/source hashes in
  `public/datasets/README.md`. It is public database data, not an authored
  synthetic or clinical validation claim. Authored import fixtures and generated
  numerical snapshots retain their recorded provenance and limitations there.
- Runtime/build npm packages retain their own licenses. Lockfiles and source-pack
  metadata do not certify a future native application/container redistribution.
- The reviewed public xradar source pack retains its original MIT license and
  exact public mapping in `vendor/README.md`. W-Sim owns numerical packages and
  kernel source; its immutable bundle manifest and retained notices govern that
  dependency. Never introduce a parallel solver copy.
