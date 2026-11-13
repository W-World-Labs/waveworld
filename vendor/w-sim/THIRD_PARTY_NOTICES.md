# Third-party boundaries

This source distribution contains W-Sim's first-party implementations and
project-authored synthetic inputs. It does not redistribute original OpenFOAM,
MATPOWER, Cantera, LAMMPS, Modelica or other external engine case collections,
measured engine outputs, proprietary solver software, models or datasets.

References to those projects identify file-format interoperability, numerical
methods or optional comparisons. They do not relicense upstream code or data.
Users separately obtain permission for any engine, software, native library,
model or data they install or supply.

The committed npm/Cargo manifests and lockfiles identify separately installed
dependencies. Those dependencies retain their original licenses and notices.
CI installs them into its isolated runner; its first-party library bundle does
not include `node_modules` or Cargo's registry source tree. A compiled native
executor must pass a separate dependency-notice and static-linking review
before distribution.

The browser WASM payload is generated from the included first-party kernel
source and links Rust runtime code. Although its default Cargo build has no
external crate dependencies, that does not remove Rust's runtime notices.
See [the embedded WASM notices](packages/solvers-lbm/THIRD_PARTY_NOTICES.md)
and the original upstream licenses in that package's `licenses/` directory;
these accompany its npm tarball. Compressed
kernel reference fixtures and the four synthetic SPICE input files are
first-party test material, not copies of external engine benchmark suites.
