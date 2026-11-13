/**
 * 定位方法族 · TDOA ‖ 三角定位 并行。
 */
import { tdoaLocate } from './tdoa'
import { trilaterate } from './trilateration'
import { childrenOf, parallelGroup } from '../../data/methods/methods'

export const LOC_PARENT = 'method-tdoa-trilateration'
export const LOC_GEOMETRY_GROUP = 'loc-geometry'

type Pt = { x: number; y: number }

/** 三角定位：已知距离恢复点位。 */
export function runTrilaterationSample(): { err: number; est: Pt } {
  const target = { x: 3, y: 4 }
  const anchors = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ]
  const ranges = anchors.map((a) => Math.hypot(target.x - a.x, target.y - a.y))
  const est = trilaterate(anchors, ranges)
  const err = Math.hypot(est.x - target.x, est.y - target.y)
  return { err, est }
}

/** TDOA：由时延差恢复点位。rangeDiff[i]=|P−ai|−|P−a0|（i=0 忽略）。 */
export function runTdoaSample(): { err: number; est: Pt } {
  const target = { x: 5, y: 3 }
  const anchors: Pt[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 8 },
    { x: 10, y: 8 },
  ]
  const d0 = Math.hypot(target.x - anchors[0].x, target.y - anchors[0].y)
  const rangeDiff = anchors.map((a, i) => {
    if (i === 0) return 0
    return Math.hypot(target.x - a.x, target.y - a.y) - d0
  })
  const est = tdoaLocate(anchors, rangeDiff)
  const err = Math.hypot(est.x - target.x, est.y - target.y)
  return { err, est }
}

export function locChildCount(): number {
  return childrenOf(LOC_PARENT).length
}

export function locGeometryParallelCount(): number {
  return parallelGroup(LOC_GEOMETRY_GROUP).length
}
