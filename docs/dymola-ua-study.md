# Guided steady exchanger UA study

WaveWorld's `/dymola` page includes a guided parameter study for the existing steady-effectiveness/NTU heat exchanger operation. It submits one bounded sweep to the existing native job path, then plots and tabulates the returned native cases. It does not introduce a local client-side physics solver.

## Study setup

Choose one of two arrangements: counterflow or parallel flow. Set the hot- and cold-side heat capacity rates (`Chot`, `Ccold`) in W/K and the inlet temperatures (`T_hot_in`, `T_cold_in`) in K. The guided study requires the hot inlet to be at least as warm as the cold inlet. Equal inlet temperatures are valid and produce zero heat transfer; counterflow outlet-temperature crossover is also valid.

Set the UA sweep start and end in W/K, the number of points, and linear or logarithmic spacing. Endpoints are included. The point count must be an integer from 2 through 64. Start and end must be finite, positive, and increasing. Each submitted UA and each heat capacity rate must be between 1e-6 and 1e9 W/K. The capacity-rate ratio must be at least 1e-6, and each UA divided by the smaller capacity rate (NTU) must be between 1e-6 and 1e6. Invalid, blank, or out-of-range values are rejected rather than silently rounded or clamped.

Temperatures, heat capacity rates, and arrangement are fixed throughout a sweep; only UA changes. Each case is a steady calculation (`dynamic: false`) using the host backend. Heat transfer `Q` and hot-side loss/cold-side gain are reported in W. Outlet temperatures are in K. The result view plots a selected native metric against UA and displays the returned cases in a table. CSV and JSON downloads capture the returned snapshot and submitted configuration. The JSON file is a WaveWorld study report, not a Dymola interchange format.

## Scope and limits

This is a guided study of the existing steady exchanger operation. It is not general Dymola or Modelica experiment automation, a transient simulation, calibration, optimization, FMI or MAT interchange, or a Dymola solver integration. It does not add pressure-drop, phase-change, or variable-property models. The page displays the native result; it does not fabricate or recompute result values in the browser. The host-f64 label describes the actual execution backend and does not imply GPU execution.

Dassault Systèmes describes Dymola's model-design tools as including parameter sweeps and plotting. That product reference provides context for the guided workflow; it does not imply that WaveWorld runs Dymola or supports Dymola file interchange: [Dymola model design tools](https://www.3ds.com/products/catia/dymola/model-design-tools).

## Verification status

Static type checks passed for the WaveWorld build (`npx tsc -b`), app tests (`npx tsc --noEmit -p tsconfig.app.tests.json`), the four focused exchanger-UA E2E spec sources, Host (`npm run typecheck --prefix apps/host`), and the W-Sim crate (`cargo check --tests --locked`). The focused E2E source check covered `exchanger-ua-study.spec.ts`, `exchanger-ua-lifecycle.spec.ts`, `exchanger-ua-admission.spec.ts`, and `exchanger-ua-results.spec.ts`. These checks do not execute tests. Browser, solver, numerical, and benchmark runs were not performed. Native `nvcc` is absent and available fatbin stubs are empty, so GPU execution is unverified. The API contract and pinned native source remain unchanged; changes are local and were not pushed or deployed.
