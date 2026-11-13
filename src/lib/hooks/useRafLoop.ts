import { useCallback, useContext, useEffect, type DependencyList } from 'react'
import { startRafLoop, type RafFrameContext } from '../visibilityRaf'
import { SimulationModuleContext } from './useRunning'

export type { RafFrameContext }
export type UseRafLoopOptions = { onError?: (err: unknown) => void }

/** For engines created inside an effect; stop the returned loop during cleanup. */
export function useStartRafLoop() {
  const module = useContext(SimulationModuleContext)
  const fail = module?.fail
  return useCallback((
    frame: (now: number, ctx: RafFrameContext) => void | Promise<void>,
    onError?: (err: unknown) => void,
  ) => startRafLoop(frame, (error) => {
    fail?.(error)
    onError?.(error)
  }), [fail])
}

/** Visibility, async serialization, failure and disposal share one scheduler. */
export function useRafLoop(
  frame: (ctx: RafFrameContext) => void | Promise<void>,
  deps: DependencyList,
  options?: UseRafLoopOptions,
): void {
  const start = useStartRafLoop()
  useEffect(() => start((_now, ctx) => frame(ctx), options?.onError), deps)
}
