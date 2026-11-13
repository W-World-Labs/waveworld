import { METHOD_DEPENDENCIES as RAW } from './dependencies.data'
import { METHOD_DEP_REASON_EN } from './dependencies.reasonsEn'
import { METHODS } from './methods'
import type { MethodDependency } from './types'

const methodIds = new Set(METHODS.map((m) => m.id))

function validate(edges: MethodDependency[]): MethodDependency[] {
  const seen = new Set<string>()
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (!e || typeof e.methodId !== 'string' || typeof e.prerequisiteId !== 'string') {
      throw new Error(`method-deps[${i}]: invalid edge`)
    }
    if (e.methodId === e.prerequisiteId) {
      throw new Error(`method-deps[${i}]: self-loop ${e.methodId}`)
    }
    if (!methodIds.has(e.methodId)) {
      throw new Error(`method-deps[${i}]: unknown methodId ${e.methodId}`)
    }
    if (!methodIds.has(e.prerequisiteId)) {
      throw new Error(`method-deps[${i}]: unknown prerequisiteId ${e.prerequisiteId}`)
    }
    if (e.strength !== 'hard' && e.strength !== 'soft') {
      throw new Error(`method-deps[${i}]: bad strength`)
    }
    const key = `${e.methodId}>${e.prerequisiteId}`
    if (seen.has(key)) throw new Error(`duplicate edge ${key}`)
    seen.add(key)
  }
  return edges
}

/** Merge English reasons without overwriting Chinese `reason`. */
function withReasonEn(edges: MethodDependency[]): MethodDependency[] {
  return edges.map((e) => {
    const key = `${e.methodId}>${e.prerequisiteId}`
    const reasonEn = e.reasonEn ?? METHOD_DEP_REASON_EN[key]
    return reasonEn ? { ...e, reasonEn } : e
  })
}

export const METHOD_DEPENDENCIES: MethodDependency[] = withReasonEn(validate(RAW))

/** methodId → 直接先修边 */
export function depsOf(methodId: string): MethodDependency[] {
  return METHOD_DEPENDENCIES.filter((e) => e.methodId === methodId)
}

/** prerequisiteId → 直接后继边（谁依赖我） */
export function dependentsOf(prerequisiteId: string): MethodDependency[] {
  return METHOD_DEPENDENCIES.filter((e) => e.prerequisiteId === prerequisiteId)
}

/** 传递闭包：所有祖先先修 id（不含自身） */
export function ancestorIds(methodId: string): Set<string> {
  const out = new Set<string>()
  const stack = [methodId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of depsOf(cur)) {
      if (!out.has(e.prerequisiteId)) {
        out.add(e.prerequisiteId)
        stack.push(e.prerequisiteId)
      }
    }
  }
  return out
}

/** 传递闭包：所有后代 id（不含自身） */
export function descendantIds(methodId: string): Set<string> {
  const out = new Set<string>()
  const stack = [methodId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of dependentsOf(cur)) {
      if (!out.has(e.methodId)) {
        out.add(e.methodId)
        stack.push(e.methodId)
      }
    }
  }
  return out
}

/**
 * 建议学习路径：全部祖先（按 yearIntroduced 升序，缺少年份靠后）+ 自身。
 * 不保证唯一拓扑序；仅作教学导航。
 */
export function learningPath(methodId: string): string[] {
  const anc = Array.from(ancestorIds(methodId))
  const yearOf = (id: string) => {
    const m = METHODS.find((x) => x.id === id)
    return m?.yearIntroduced ?? 9999
  }
  anc.sort((a, b) => {
    const dy = yearOf(a) - yearOf(b)
    if (dy !== 0) return dy
    return a.localeCompare(b)
  })
  return [...anc, methodId]
}

/** 节点度（入+出）— 用于点大小 / 中心性近似 */
export function degreeOf(methodId: string): number {
  return depsOf(methodId).length + dependentsOf(methodId).length
}

/** 粗检：若存在环则返回一个环上节点序列；否则 null */
export function findCycle(): string[] | null {
  const state = new Map<string, 0 | 1 | 2>() // 0 white 1 gray 2 black
  const parent = new Map<string, string>()
  for (const m of METHODS) state.set(m.id, 0)

  const path: string[] = []
  function dfs(u: string): string[] | null {
    state.set(u, 1)
    path.push(u)
    for (const e of depsOf(u)) {
      const v = e.prerequisiteId
      const s = state.get(v) ?? 0
      if (s === 1) {
        // cycle: path from v to u then back
        const i = path.indexOf(v)
        return [...path.slice(i), v]
      }
      if (s === 0) {
        parent.set(v, u)
        const c = dfs(v)
        if (c) return c
      }
    }
    path.pop()
    state.set(u, 2)
    return null
  }

  for (const m of METHODS) {
    if (state.get(m.id) === 0) {
      const c = dfs(m.id)
      if (c) return c
    }
  }
  return null
}

export type { MethodDependency } from './types'
