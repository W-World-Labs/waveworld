import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export const SimulationModuleContext = createContext<
  (ReturnType<typeof useLocalRunning> & { fail: (error: unknown) => void; toolbar: ReactNode }) | null
>(null)

/**
 * 播放/暂停：React 状态供 UI，ref 供 rAF 热路径读取（避免闭包陈旧）。
 * 过程组装层的「运行开关」端口。
 */
export function useRunning(initial = true) {
  const module = useContext(SimulationModuleContext)
  const local = useLocalRunning(initial)
  return module ?? local
}

/** One owner per mounted module; standalone components retain local controls. */
export function useLocalRunning(initial = true) {
  const [running, setRunningState] = useState(initial)
  const runningRef = useRef(initial)

  const setRunning = useCallback((v: boolean) => {
    runningRef.current = v
    setRunningState(v)
  }, [])

  const toggle = useCallback(() => {
    const v = !runningRef.current
    runningRef.current = v
    setRunningState(v)
  }, [])

  return { running, runningRef, setRunning, toggle }
}
