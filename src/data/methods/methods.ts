import { METHODS as RAW } from './methods.data'
import { METHOD_SUMMARIES_EN } from './methods.summariesEn'
import { isFoundationalMethod, type FoundationalMethod, type MethodKind } from './types'

function validate(list: FoundationalMethod[]): FoundationalMethod[] {
  const seen = new Set<string>()
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!isFoundationalMethod(m)) {
      throw new Error(`methods[${i}] id=${(m as { id?: string })?.id}: invalid FoundationalMethod`)
    }
    if (seen.has(m.id)) throw new Error(`duplicate method id: ${m.id}`)
    seen.add(m.id)
  }

  // parentId: must exist, not self; cycle check via path-to-root walk
  for (const m of list) {
    if (!m.parentId) continue
    if (m.parentId === m.id) throw new Error(`method ${m.id}: parentId self-loop`)
    if (!seen.has(m.parentId)) {
      throw new Error(`method ${m.id}: unknown parentId ${m.parentId}`)
    }
  }

  for (const m of list) {
    if (!m.parentId) continue
    const path = new Set<string>([m.id])
    let cur: string | undefined = m.parentId
    while (cur) {
      if (path.has(cur)) {
        throw new Error(`method ${m.id}: parent cycle involving ${cur}`)
      }
      path.add(cur)
      const p = list.find((x) => x.id === cur)
      cur = p?.parentId
    }
  }

  return list
}

/** Merge English summaries without overwriting Chinese source fields. */
function withSummariesEn(list: FoundationalMethod[]): FoundationalMethod[] {
  return list.map((m) => {
    const summaryEn = METHOD_SUMMARIES_EN[m.id]
    return summaryEn ? { ...m, summaryEn } : m
  })
}

export const METHODS: FoundationalMethod[] = withSummariesEn(validate(RAW))

export function methodById(id: string): FoundationalMethod | undefined {
  return METHODS.find((m) => m.id === id)
}

export function methodsByKind(kind: MethodKind): FoundationalMethod[] {
  return METHODS.filter((m) => m.kind === kind)
}

/** 某仿真路由挂接的方法（可多个，含子算法节点）。 */
export function methodsForSimPath(path: string): FoundationalMethod[] {
  const p = path.replace(/^\//, '')
  return METHODS.filter((m) => m.simPaths?.includes(p))
}

/** 直接子方法（算法细分一层）。 */
export function childrenOf(parentId: string): FoundationalMethod[] {
  return METHODS.filter((m) => m.parentId === parentId)
}

/** 无 parentId 的根方法。 */
export function rootMethods(): FoundationalMethod[] {
  return METHODS.filter((m) => !m.parentId)
}

/** 自 leaf 沿 parent 上溯到根（含自身，根在末尾）。 */
export function pathToRoot(id: string): FoundationalMethod[] {
  const out: FoundationalMethod[] = []
  const seen = new Set<string>()
  let cur = methodById(id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.push(cur)
    cur = cur.parentId ? methodById(cur.parentId) : undefined
  }
  return out
}

/**
 * 深度优先扁平列表：根在前，子/孙递归紧随（便于目录展示）。
 * 过滤：子命中则祖先一并露出；父命中则整棵子树露出。
 */
export function methodsHierarchyFlat(
  filter?: (m: FoundationalMethod) => boolean,
): { method: FoundationalMethod; depth: number }[] {
  const out: { method: FoundationalMethod; depth: number }[] = []
  const pass = (m: FoundationalMethod) => !filter || filter(m)

  const matchesOrDesc = (m: FoundationalMethod): boolean => {
    if (pass(m)) return true
    return childrenOf(m.id).some(matchesOrDesc)
  }

  const walk = (m: FoundationalMethod, depth: number, force: boolean) => {
    const selfOk = pass(m)
    if (!force && !selfOk && !matchesOrDesc(m)) return
    out.push({ method: m, depth })
    const forceKids = force || selfOk
    for (const c of childrenOf(m.id)) {
      if (forceKids || matchesOrDesc(c)) walk(c, depth + 1, forceKids)
    }
  }

  for (const r of METHODS.filter((m) => !m.parentId)) walk(r, 0, false)

  // 孤儿防护（正常数据不应触发）
  const shown = new Set(out.map((x) => x.method.id))
  for (const m of METHODS) {
    if (!shown.has(m.id) && pass(m)) {
      out.push({ method: m, depth: Math.max(0, pathToRoot(m.id).length - 1) })
    }
  }
  return out
}

/** 与 id 同 parallelGroup 的其它并立模块（不含自身）。 */
export function parallelsOf(id: string): FoundationalMethod[] {
  const m = methodById(id)
  if (!m?.parallelGroupId) return []
  return METHODS.filter((x) => x.parallelGroupId === m.parallelGroupId && x.id !== id)
}

/** 某一并行组的全部模块。 */
export function parallelGroup(groupId: string): FoundationalMethod[] {
  return METHODS.filter((m) => m.parallelGroupId === groupId)
}

/** 所有并行组 id（≥2 成员才算「并立」组）。 */
export function parallelGroupIds(): string[] {
  const counts = new Map<string, number>()
  for (const m of METHODS) {
    if (!m.parallelGroupId) continue
    counts.set(m.parallelGroupId, (counts.get(m.parallelGroupId) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 2)
    .map(([id]) => id)
    .sort()
}

/** 推断展示用角色 */
export function effectiveRole(m: FoundationalMethod): import('./types').MethodModuleRole {
  if (m.role) return m.role
  if (m.parallelGroupId && m.parentId) return 'parallel-variant'
  if (m.parentId) return 'algorithm'
  if (childrenOf(m.id).length > 0) return 'family'
  return 'algorithm'
}

export type { FoundationalMethod, MethodKind, MethodModuleRole } from './types'
