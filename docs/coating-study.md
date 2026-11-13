# OpticStudio thin-film coating spectrum study

This bounded study describes using the existing W-Sim `sw-optics-thinfilm` R/T/A operation (`method-algo-thinfilm-rt`) for an OpticStudio coating-effects use case. It is a local characteristic-matrix calculation, not an OpticStudio project, API, coating-catalog connection, or ray-trace integration. OpticStudio’s coating-effects workflow is the source of the product-area comparison: [How to observe coating effects in OpticStudio](https://optics.ansys.com/hc/en-us/articles/43071115297043-How-to-observe-coating-effects-in-OpticStudio).

## Study envelope

The study uses an explicit `backend: "host"` and an explicit wavelength list. It bounds wavelengths to 100–2500 nm and 3–401 samples, and uses at most 16 layers. Each layer is described by refractive index `n` from 0.1 to 10, extinction coefficient `k` from 0 to 10, and thickness `d` from 0 to 10000 nm. Incidence angle `theta` is 0–89.9 degrees; incident-medium index `n0` and substrate index `ns` are 0.1–10, and substrate extinction coefficient `ks` is 0–10. Polarization may select s, p, or their unpolarized average.

These are study limits. The existing native parser admits a wider range of values and a larger number of layers and wavelengths; the study does not imply that the native API enforces these narrower bounds.

A request supplies `module: "sw-optics-thinfilm"`, `method: "method-algo-thinfilm-rt"`, `backend: "host"`, `lambda0`, `wavelengths`, `n0`, `ns`, `ks`, `theta`, `polarization`, and a `layers` array of `{n,k,d}` records. The explicit wavelengths define the spectral rows. The method also returns its point result at `lambda0`.

## Results and limits

The native JSON result reports point R/T/A, s- and p-polarized values, amplitudes, and physical checks. With an explicit wavelength list it also returns per-wavelength spectrum rows containing wavelength and R/T/A (including s/p values). A spectrum curve plots those returned rows, and its table presents the same values. CSV is a tabular serialization of these native rows; JSON retains the native result envelope. These are representations of the operation’s actual output data, not independent calculations or validation results.

The model is a planar isotropic multilayer characteristic-matrix calculation with caller-supplied optical constants. It does not load OpticStudio coating data, reproduce its catalog or ray-tracing workflow, or establish vendor parity. No numerical validation against OpticStudio and no GPU execution are claimed. The current describe example for this module covers its distinct coating-polarization selector; this R/T/A study does not claim a new describe example.

## Verification

The final shared static gates passed the WaveWorld SPA build and app-test source typecheck, focused coating E2E source typecheck, WaveWorld Host typecheck, and W-Sim native test-source compilation. The authored tests and browser flows were not executed. `nvcc` was unavailable, so native compilation used empty CUDA stubs; no solver, CUDA/GPU, or OpticStudio vendor run was performed. This study reuses the existing operation and does not change the historical count of 40 operation extensions and 93 regression tests in the inventory.
