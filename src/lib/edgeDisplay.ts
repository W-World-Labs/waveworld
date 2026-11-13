import type { ConversionEdge } from '../data/ontology/types'
import { EDGE_NAME_EN } from '../data/ontology/edges.nameEn'
import { EDGE_PRINCIPLE_EN } from '../data/ontology/edges.principleEn'
import { EDGE_EFFICIENCY_NOTE_EN } from '../data/ontology/edges.efficiencyNoteEn'
import type { Locale } from './i18n/types'

/** Prettify machine id when no curated English name exists. */
export function prettifyEdgeId(id: string): string {
  return id
    .replace(/-/g, ' ')
    .replace(/\s+to\s+/g, ' → ')
    .replace(/\b(em|el)\b/gi, (m) => m.toUpperCase())
    .replace(/\b(rf|pv|csp|led|lcd|oled|ac|dc)\b/gi, (m) => m.toUpperCase())
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Locale-aware conversion-edge display name.
 * zh → Chinese `name`; en → nameEn / EDGE_NAME_EN / prettified id.
 * Never returns raw id as primary label when a curated name exists.
 */
export function edgeDisplayName(
  edge: Pick<ConversionEdge, 'id' | 'name' | 'nameEn'>,
  locale: Locale = 'zh',
): string {
  if (locale !== 'en') return edge.name
  const curated = edge.nameEn?.trim() || EDGE_NAME_EN[edge.id]?.trim()
  if (curated) return curated
  return prettifyEdgeId(edge.id)
}

/**
 * Locale-aware conversion-edge principle text.
 * zh → Chinese `principle`; en → principleEn / EDGE_PRINCIPLE_EN / Chinese fallback.
 */
export function edgePrinciple(
  edge: Pick<ConversionEdge, 'id' | 'principle' | 'principleEn'>,
  locale: Locale = 'zh',
): string {
  if (locale !== 'en') return edge.principle
  const curated = edge.principleEn?.trim() || EDGE_PRINCIPLE_EN[edge.id]?.trim()
  return curated || edge.principle
}

/**
 * Locale-aware efficiency note under η/COP bars.
 * zh → efficiency.note; en → EDGE_EFFICIENCY_NOTE_EN / Chinese fallback.
 */
export function edgeEfficiencyNote(
  edge: Pick<ConversionEdge, 'id' | 'efficiency'>,
  locale: Locale = 'zh',
): string | undefined {
  const zh = edge.efficiency?.note
  if (!zh) return undefined
  if (locale !== 'en') return zh
  return EDGE_EFFICIENCY_NOTE_EN[edge.id]?.trim() || zh
}
