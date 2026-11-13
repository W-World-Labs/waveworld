import type { ModelGeometry, ModelSourcePart } from '../../types/model';
import { GeometryContractError } from './geometry-contract';

export const MODEL_SOURCE_PART_LIMITS = {
  maxParts: 16_384,
  maxTextLength: 256,
  maxDepth: 64,
} as const;

/** Source assembly intervals describe the existing faces; they never declare simulation solids. */
export function assertModelSourceParts(geometry: ModelGeometry): void {
  const parts = geometry.sourceParts;
  if (parts === undefined) return;
  function fail(message: string): never { throw new GeometryContractError('source_parts', `源部件信息无效：${message}`); }
  if (!Array.isArray(parts) || !parts.length || parts.length > MODEL_SOURCE_PART_LIMITS.maxParts) fail('部件数量超出范围');
  const faceCount = geometry.indices.length / 3;
  if (!Number.isSafeInteger(faceCount) || faceCount < 1) fail('三角面数量无效');
  const label = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= MODEL_SOURCE_PART_LIMITS.maxTextLength;
  const seen = new Map<string, { part: ModelSourcePart; depth: number }>();
  const children = new Map<string | undefined, ModelSourcePart[]>();
  for (const part of parts) {
    if (!part || typeof part !== 'object' || !label(part.id) || !label(part.name) || seen.has(part.id)) fail('部件名称或唯一标识无效');
    if (!Number.isSafeInteger(part.triangleStart) || part.triangleStart < 0 ||
        !Number.isSafeInteger(part.triangleCount) || part.triangleCount < 1 ||
        part.triangleStart > faceCount - part.triangleCount) fail('部件三角面范围越界');
    let depth = 1;
    if (part.parentId !== undefined) {
      if (!label(part.parentId)) fail('父部件标识无效');
      const parent = seen.get(part.parentId);
      if (!parent) fail('父部件必须先于子部件出现');
      depth = parent.depth + 1;
      if (part.triangleStart < parent.part.triangleStart ||
          part.triangleStart + part.triangleCount > parent.part.triangleStart + parent.part.triangleCount) fail('子部件超出父部件范围');
    }
    if (depth > MODEL_SOURCE_PART_LIMITS.maxDepth) fail('部件层级超过 64 层');
    seen.set(part.id, { part, depth });
    const siblings = children.get(part.parentId);
    if (siblings) siblings.push(part);
    else children.set(part.parentId, [part]);
  }
  // Each sibling set partitions its parent, including the virtual whole-model root.
  // Together these checks guarantee that the leaves cover every source face once.
  for (const [parentId, siblings] of children) {
    const parent = parentId === undefined ? undefined : seen.get(parentId)!.part;
    let next = parent?.triangleStart ?? 0;
    for (const part of siblings.sort((a, b) => a.triangleStart - b.triangleStart)) {
      if (part.triangleStart !== next) fail('同级部件范围重叠或存在未分配三角面');
      next += part.triangleCount;
    }
    if (next !== (parent ? parent.triangleStart + parent.triangleCount : faceCount)) fail('部件未完整覆盖父部件三角面');
  }
}
