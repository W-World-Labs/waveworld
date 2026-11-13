/**
 * WaveWorld → W-Sim dependency surface.
 *
 * Prefer importing from here (or directly from `@w-sim/*`) for any
 * simulation settlement / HQ contract / lab kit work — browser or backend.
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
  VizQuantity,
} from '@w-sim/kit'
export {
  type AgentIdentity,
  type ClaimedJob,
  type JobHostClient,
  type JobRunner,
  runClaimLoopOnce,
} from '@w-sim/runtime'
