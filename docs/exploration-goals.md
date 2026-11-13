# WaveWorld product exploration goals

Each goal is a user-visible product check: one **observable**, one **tool/command**.
Evidence for this run lives under the implementer scratch dir (see goal harness).

| # | Goal | Observable | Tool / command |
|---|------|------------|----------------|
| G1 | Smith chart is a first-class sim leaf | Path `smith` appears in `ALL_LEAVES`, `router` lazy route, and `PAGE_HEADERS` with English title | `npx vitest run src/lib/i18n/i18n.test.ts` + structural probe script |
| G2 | Smith / impedance math is self-consistent | `runSmithChartSample().ok === true` and registry binding for `method-algo-smith-chart` returns a truthy object with `ok: true` | `npx vitest run src/lib/sim/smith-chart.test.ts src/data/methods/moduleRegistry.test.ts` |
| G3 | Nav ↔ smoke-route coverage stays closed | Every `ALL_LEAVES` path (including `smith`) is present in `SMOKE_ROUTES` from `e2e/routes.ts` | Structural probe / new Vitest if missing |
| G4 | New method foundations have English overlays | Every foundation string on `method-algo-smith-chart` maps in `methods.foundationsEn` without CJK | Structural probe; add durable test + fix if gap |

## Pass/fail rule

- **Pass**: command exit 0 and log shows the named observable holds.
- **Fail**: assertion fails, or tool missing → add an in-repo check, re-run, then fix product if the check found a real gap.

## Run notes (2026-07-22)

| Goal | Result | Evidence / action |
|------|--------|-------------------|
| G1 | PASS | `i18n.test.ts` green; smith pageHeaders + leaf present |
| G2 | PASS | `smith-chart.test.ts` + `moduleRegistry.test.ts` green |
| G3 | PASS after tool add | Added durable `src/nav.routes.test.ts` (SMOKE_ROUTES ⊇ ALL_LEAVES, smith wiring) |
| G4 | FAIL → fixed | Missing EN for `莫比乌斯 Γ` / `恒阻圆` / `线长旋转` caused English taxonomy leak; filled `methods.foundationsEn.ts`; `methodDisplay.test.ts` now green |
