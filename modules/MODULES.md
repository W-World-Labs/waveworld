# WaveWorld modules (in-repo)

Single repository: **all module code lives in this tree** (no git submodules).

| Path | Role |
|------|------|
| `apps/lab` | WaveWorld Lab UI + agent shell. Lattice compute lives in `@w-sim/solvers-lbm`. |

## Develop

```bash
# Lab UI
cd apps/lab && npm install && npm run dev   # :3000

# Host API (uses apps/lab/src via path alias)
npm install --prefix apps/host --legacy-peer-deps
npm run dev:host   # :3001

# Atlas
npm run dev        # :5173
```

## History note

`apps/lab` was briefly a separate internal submodule. It is now included in
WaveWorld; this source tree is the canonical module source.
