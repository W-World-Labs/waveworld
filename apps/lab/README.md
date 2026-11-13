# Web Wind Tunnel Lab - 风洞实验室

Interactive 3D flow teaching and experiment UI mounted in WaveWorld. The Lab
loads models and presets, assembles solver requests, presents progress/results,
and connects to WaveWorld Host task APIs. It is an adapter and presentation
layer: numerical methods and shared runtime contracts belong to W-Sim.

## Ownership and execution paths

- `@w-sim/solvers-lbm/d3q19` owns the shared D3Q19 LBM implementation used by
  the Lab browser path. Browser execution can use WebGPU FP32; the Lab keeps
  model loading, UI, session lifecycle, visualization, and adapter wiring.
- The separate `mac-3d` path uses the shared MAC solver through CPU/WASM. It is
  a different method and execution path from D3Q19 LBM.
- The Lab assembles versioned job specifications and presents results. The
  canonical jobs API, durable task state/artifacts, authentication, and Agent
  lease/settlement lifecycle remain WaveWorld Host responsibilities. The Lab's
  remaining job routes are adapters; they are not a second production jobs
  plane.
- Project state and results are stored in the browser with IndexedDB. Preset
  files and supported upload formats are documented in
  [`public/models/README.md`](public/models/README.md).

The current solver paths do not make the Lab a general-purpose CFD package.
Preset geometry, parameter controls, or imported OpenFOAM metadata do not imply
complete turbulence-model support, arbitrary OpenFOAM compatibility, or
engineering validation. Use the capabilities and limits encoded in the shared
W-Sim contracts and the corresponding source/tests for specific claims.

## Stack

| Layer | Implementation |
|-------|----------------|
| App | Next.js 16 App Router, React 19, TypeScript |
| UI/state | Tailwind CSS 4, Zustand, TanStack Query, shadcn/ui components |
| 3D | Three.js, React Three Fiber, and Drei |
| LBM | Shared `@w-sim/solvers-lbm/d3q19` package; browser WebGPU path |
| MAC | Shared `@w-sim/solvers-lbm/mac3d` package; CPU/WASM path |
| Storage/tasks | IndexedDB for browser projects; Host APIs for durable batch jobs and artifacts |
| Agent | `apps/lab/agent` CLI and native executor build sources |

Dependency versions are pinned by `package.json` and `package-lock.json`.

## Development

Run commands from `apps/lab`:

```bash
npm install --legacy-peer-deps
npm run dev                 # defaults to 127.0.0.1:3000
npm run build
npm run start               # defaults to 127.0.0.1:3000
npm run lint
npm run models:generate
npm run models:manifest
```

The app's `predev` and `prebuild` scripts prepare same-origin Draco decoder
assets. WebAssembly and Web Workers are needed for browser computation;
WebGPU execution also requires browser/device support and a secure context.
The MAC CPU/WASM path remains distinct from the browser WebGPU LBM path.

## Agent CLI

The Agent connects to Host for queued work. From `apps/lab`:

```bash
npm run agent:install
npm run agent:build
./bin/tuanliu-agent register --name my-gpu
./bin/tuanliu-agent run
./bin/tuanliu-agent submit --preset cylinder --steps 800
```

`agent:build` creates local output under `bin/`; it is not source code. In
production, configure `TASK_API_URL` and `AGENT_TOKEN` through the deployment's
approved environment mechanism. Do not commit tokens. For local development,
`npm run agent:dev -- once --url http://127.0.0.1:3001` runs the TypeScript CLI
against a local Host.

## Source map

```text
src/app/                 Next.js pages and Lab adapter routes
src/lib/models/          Presets, model loading, geometry, session/job specs
src/lib/w-sim/           W-Sim kit, solver, and Host settlement adapters
src/components/          Panels, model UI, and visualization
src/lib/cfd/             Flow snapshot encoding/decoding and rendering helpers
agent/                   Agent CLI source and native executor source
validation/              Separate numerical regression package
public/models/            Preset assets and model setup/provenance notes
```

The Lab does not contain a parallel D2Q9/WGSL solver. Solver physics should be
changed through the owning W-Sim source and its versioned package contracts;
WaveWorld maintains the necessary Lab adapter and Host integration.

## Validation references

`npm run test:smoke` runs the Lab's configured Node smoke suite. The dedicated
`validation/` package has separate installation and device prerequisites;
consult its package scripts and source before running a physics validation.
