import { useCallback, useRef, useState } from 'react'
import { drainSteps, type StepAccumulator } from '../playback'

/**
 * 变速播放控制器：不改物理 dt，只决定每帧 drain 多少仿真步。
 * 与 SpeedControl 成对使用。
 */
export function usePlayController(baseSteps: number) {
  const playRef = useRef(1)
  const [playSpeed, setPlaySpeedState] = useState(1)
  const acc = useRef<StepAccumulator>({ v: 0 })

  const setPlaySpeed = useCallback((v: number) => {
    playRef.current = v
    setPlaySpeedState(v)
  }, [])

  /** running=false 时返回 0（画面可继续画，但物理不推进）。 */
  const stepsThisFrame = useCallback(
    (running: boolean) => (running ? drainSteps(acc.current, playRef.current, baseSteps) : 0),
    [baseSteps],
  )

  return { playSpeed, setPlaySpeed, playRef, stepsThisFrame }
}
