/**
 * tuanliu ↔ W-Sim bridge.
 *
 * **Client components** must import from `./hq-lab-adapter` (or kit/contracts
 * directly). This barrel re-exports `@w-sim/runtime` for **server/agent** use
 * only — pulling it into the client graph breaks Next production builds.
 *
 * HQ Lab kit: use `assembleTuanliuHqLabKit` / `getTuanliuHqLabKit` (wraps
 * `@w-sim/kit` `assembleHqLabKit` — no local HqLabKit type).
 */

export * from '@w-sim/contracts'
export type {
  GeometryHandle,
  GeometryLoader,
  SolverSession,
  SolverFactory,
  VisualizationController,
  ParamField,
  ParameterSchema,
  ResultsSnapshot,
  SettlementClient,
  HqLabKit,
} from '@w-sim/kit'
export { assembleHqLabKit, memorySettlementClient } from '@w-sim/kit'
/** Server/agent-only — do not import this barrel from `'use client'` modules. */
export {
  type AgentIdentity,
  type ClaimedJob,
  type JobHostClient,
  type JobRunner,
  runClaimLoopOnce,
} from '@w-sim/runtime'
export { createSettlementClient, type CreateSettlementClientOptions } from './settlement-client'
export {
  TUANLIU_HQ_MODULE_ID,
  TUANLIU_LBM_KIND,
  TUANLIU_BROWSER_FLUID_CAPABILITY,
  assembleTuanliuHqLabKit,
  createTuanliuGeometryLoader,
  createTuanliuParameterSchema,
  createTuanliuSolverFactory,
  getTuanliuHqLabKit,
  registerTuanliuBrowserCapability,
  resetTuanliuHqLabKitForTests,
  submitViaKitSettlement,
  type AssembleTuanliuHqLabKitOptions,
  type LabSessionDiagnostics,
  type LabSessionPhase,
  type TuanliuHqLabKit,
  type TuanliuLabSolverSession,
} from './hq-lab-adapter'
