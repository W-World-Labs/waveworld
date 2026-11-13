# W-Sim CI release package

Source revision: `f558f268922e498cd235c468ee7044586e23a24b`.

Downstream product CI consumes this package set to assemble its product runtime. Production deployment uses that assembled product runtime; it does not install these packages or compile source.

Install the required npm package tarballs by their local paths, for example:

```sh
npm install ./vendor/w-sim/w-sim-contracts-0.3.0.tgz ./vendor/w-sim/w-sim-ems-import-0.3.0.tgz ./vendor/w-sim/w-sim-fem-import-0.3.0.tgz ./vendor/w-sim/w-sim-kit-0.3.0.tgz ./vendor/w-sim/w-sim-lammps-import-0.3.0.tgz ./vendor/w-sim/w-sim-msh-import-0.3.0.tgz ./vendor/w-sim/w-sim-openfoam-import-0.3.0.tgz ./vendor/w-sim/w-sim-runtime-0.3.0.tgz ./vendor/w-sim/w-sim-solver-conformance-0.3.0.tgz ./vendor/w-sim/w-sim-solvers-acoustics-0.3.0.tgz ./vendor/w-sim/w-sim-solvers-em-fdtd-0.3.0.tgz ./vendor/w-sim/w-sim-solvers-export-report-0.3.0.tgz ./vendor/w-sim/w-sim-solvers-lbm-0.3.0.tgz ./vendor/w-sim/w-sim-solvers-md-0.3.0.tgz ./vendor/w-sim/w-sim-solvers-path-experiment-0.3.0.tgz ./vendor/w-sim/w-sim-solvers-structural-0.3.0.tgz ./vendor/w-sim/w-sim-solvers-thermal-0.3.0.tgz
```

The Rust source artifact is `w-sim-kernels-0.1.0.crate`. Extract it under `vendor/w-sim-kernels-0.1.0` and point Cargo path dependencies at that directory. Its Cargo.lock pins third-party crates; Cargo may fetch those locked crates from crates.io unless they are already cached.

This library archive does not include the native CUDA backend. Native backend binaries are released separately when a consuming product requires them.

Verify files against the SHA-256 values in `manifest.json` before use.

W-Sim source is MIT licensed; see LICENSE and THIRD_PARTY_NOTICES.md. Embedded WASM runtime notices accompany the solvers-lbm package; manifest.json lists the inner license files. Dependencies retain their own licenses.
