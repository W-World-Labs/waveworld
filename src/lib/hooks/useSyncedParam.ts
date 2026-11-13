import { useCallback, useRef, useState } from 'react'

/**
 * 控件参数双写：value 驱动 React 重绘，ref 供仿真 loop 每帧读取。
 * 任意「可调物理/显示参数」的基本组装单元，可嵌套在更复杂过程里。
 */
export function useSyncedParam<T>(initial: T) {
  const [value, setValueState] = useState(initial)
  const ref = useRef(initial)

  const set = useCallback((v: T) => {
    ref.current = v
    setValueState(v)
  }, [])

  return { value, ref, set }
}
