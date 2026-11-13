<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Web Wind Tunnel Lab (tuanliu)

Interactive browser teaching/experiment surface: upload/preset 3D models, operate
the supported experiment flow, and visualize provider results. UI language is
Chinese; code identifiers and comments are mixed Chinese/English (match
surrounding style).

## Product boundary

- W-Lab owns teaching experiments, interactive experiment UI, and experiment
  plugin lifecycle. W-Sim owns numerical methods and shared solver/runtime
  contracts; keep numerical implementations behind its published package/API
  contracts. WaveWorld remains the presentation/adapter host for this mounted
  Lab application, not a second experiment catalog or solver owner.
- The `/api/v1/jobs` routes, SQLite task state, artifacts, authentication, and
  Agent lease/cancel/settlement flow are currently live WaveWorld Host
  responsibilities. Preserve their API and stored data until a verified
  replacement exists. Treat them as an existing execution adapter, not a
  template for new independent job APIs.
- Browser code must use same-origin `/api` routes or deployment-injected
  runtime configuration. Never bake production origins into client bundles;
  keep provider-owned authentication and tenant checks at the provider.
- New Lab work should remain an independently callable experiment module with a
  stable, versioned contract. It must not create dependencies from W-Sim back to
  Lab, WaveWorld, or AI4S.

## Stack

| Layer | Choice |
|-------|--------|
| App | Next.js 16 App Router (`16.3.0-preview.9`), React 19, TypeScript |
| Style | Tailwind CSS 4, shadcn/ui (base-nova), lucide-react |
| State | Zustand (`project-store`, `simulation-store`); TanStack Query for server-ish data |
| 3D | three + @react-three/fiber + drei (client-only; no SSR) |
| CFD | WebGPU compute: shared Rust/WASM D3Q19 LBM + conservative thermal; optional WebGPU FP32 |
| Storage | Zustand persist + IndexedDB (`idb-keyval`) for projects |
| Batch tasks | SQLite (`data/tasks.db`) + `/api/v1/*` + `agent/` CLI (Dawn WebGPU) |

**Version constraints**

- Prefer versions already pinned in `package.json` / `VERSION_REPORT.md`.
- TypeScript: stay on the Next-compatible line (currently 6.x beta). Do not upgrade to TS 7 unless Next supports its compiler API.
- React Compiler is enabled via `next.config.ts` (`reactCompiler: true`).
- Native module `better-sqlite3` is `serverExternalPackages` only — never import from client components.

## Commands

```bash
npm install          # root app (--legacy-peer-deps if peer conflicts)
npm run dev          # http://localhost:3000
npm run build
npm run lint
npm run models:generate

# Agent 批算（替代后端预计算）
npm run agent:install
npm run agent:build          # → bin/tuanliu-agent + bin/native/*.dawn.node
./bin/tuanliu-agent register --name my-gpu
./bin/tuanliu-agent run
./bin/tuanliu-agent submit --preset cylinder --steps 800
# 开发调试仍可用: npm run agent:dev -- once
```

The existing fileProtocol1 CPU adapter requires an independently supplied,
verified compatible executable. This source edition does not publish a new formal
CPU/CUDA binary or claim hardware acceptance. Keep provider-owned installation
explicit; do not silently fetch private release assets or build a duplicate solver.



Validation suite (Node + Dawn WebGPU bindings, separate package):

```bash
cd validation && npm install
# run scripts with tsx, e.g. npx tsx cylinder.ts
```

Browser computation requires WebAssembly and Web Workers. Optional WebGPU computation and 3D rendering require a secure context (`localhost` or HTTPS).

## Architecture map

```
src/app/
  page.tsx              # Home: create/open/delete projects
  lab/page.tsx          # Lab UI: params, model, viz, run controls (?demo=true)
  jobs/page.tsx         # Agent 任务看板
  api/v1/               # 任务协议 REST（agents / jobs / artifacts）
  layout.tsx, globals.css

src/lib/
  cfd/
    flow-snapshot.ts, mac-flow-snapshot.ts   # 流场帧编码/解码（任务协议共享）
    volume-renderer.ts                       # 三维流场渲染
  # 求解器与批算统一在 @w-sim/solvers-lbm（d3q19 子路径），本目录不再有副本
  tasks/                # SQLite 队列、claim/lease、artifact 本地存储
  models/, stores/, storage/

agent/                  # CLI Agent：register → claim → runBatchLbm → complete
validation/             # 物理回归（非任务协议），直接用 @w-sim/solvers-lbm/d3q19
public/models/          # 预设 STL/glTF
```

### Agent 任务流

1. Lab「提交批算任务」或 `POST /api/v1/jobs` 写入 `queued`
2. Agent `POST /api/v1/jobs/claim` 原子领取（lease + heartbeat）
3. `@w-sim/solvers-lbm` `runBatchLbm` + Dawn/浏览器 WebGPU 求解
4. `complete` 回写 Cd/Cl history；lease 过期自动 requeue

协议类型：`src/types/task.ts`（JobSpecV1 / JobResultV1）。

### Routes

| Path | Role |
|------|------|
| `/` | Project dashboard |
| `/lab` | Full lab |
| `/lab?demo=true` | Auto-load cylinder preset |
| `/jobs` | Batch job board |
| `/api/v1/jobs` | Create/list jobs |
| `/api/v1/jobs/claim` | Agent pull next job |

## Coding conventions

- **Path alias**: `@/*` → `src/*`. Use it for all internal imports.
- **Client components**: anything using WebGPU, three, dropzone, or Zustand browser APIs needs `'use client'`. Dynamic-import three with `ssr: false` (see `lab/page.tsx`).
- **Task API**: only `runtime = 'nodejs'` routes; never pull `better-sqlite3` into client bundles.
- **CFD changes**: lattice stability sacred — `tau ≥ 0.505`, low Mach, grid buffer ≤ WebGPU storage binding limit.
- **Batch vs realtime**: lab canvas keeps its RAF loop; batch uses `runBatchLbm` from `@w-sim/solvers-lbm` so physics stay shared.
- **Do not invent Next APIs** — check `node_modules/next/dist/docs/`.

## Where to change what

| Goal | Primary files |
|------|----------------|
| Solver physics / WGSL | `@w-sim/solvers-lbm`（w-sim 仓库 `d3q19-solver.ts`）|
| Batch / agent solve path | `@w-sim/solvers-lbm` `runBatchLbm`, `agent/` |
| Task claim / lease | `src/lib/tasks/service.ts` |
| Task REST | `src/app/api/v1/**` |
| Job protocol types | `src/types/task.ts` |
| Viz / canvas loop | `src/components/visualization/wind-tunnel-canvas.tsx` |
