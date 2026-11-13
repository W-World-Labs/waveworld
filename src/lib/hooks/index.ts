/**
 * UI 组装层 hooks：把「可运行过程」嵌套成页面，而不把物理写进 DOM。
 * 物理公理/算法仍在 lib/sim + lib/webgpu；此处只负责时间轴、参数端口、播放。
 */
export { useRunning } from './useRunning'
export { useSyncedParam } from './useSyncedParam'
export { usePlayController } from './usePlayController'
export { useRafLoop, useStartRafLoop, type RafFrameContext } from './useRafLoop'
