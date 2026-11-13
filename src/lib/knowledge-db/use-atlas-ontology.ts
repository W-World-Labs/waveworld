/**
 * React hook: load Matrix/Graph/Paths ontology via knowledge adapter seam (K11).
 * Browser-safe (loader avoids static sqlite import).
 */
import { useEffect, useState } from 'react'
import type { ConversionEdge, EnergyNode } from '../../data/ontology/types.ts'
import {
  loadAtlasOntology,
  type AtlasOntologySource,
  type LoadAtlasOntologyOptions,
} from './atlas-ontology.ts'

export type UseAtlasOntologyState = {
  nodes: EnergyNode[]
  edges: ConversionEdge[]
  source: AtlasOntologySource
  usedFallback: boolean
  loading: boolean
  error?: string
}

const empty: UseAtlasOntologyState = {
  nodes: [],
  edges: [],
  source: 'static',
  usedFallback: false,
  loading: true,
}

export function useAtlasOntology(
  options?: LoadAtlasOntologyOptions,
): UseAtlasOntologyState {
  const [state, setState] = useState<UseAtlasOntologyState>(empty)

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    // Browser hook: never pull Node SQLite adapter into the SPA graph.
    loadAtlasOntology({ skipLocalAdapter: true, ...options })
      .then((bundle) => {
        if (cancelled) return
        setState({
          nodes: bundle.nodes,
          edges: bundle.edges,
          source: bundle.source,
          usedFallback: bundle.usedFallback,
          loading: false,
          error: bundle.error,
        })
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          nodes: [],
          edges: [],
          source: 'static',
          usedFallback: true,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    return () => {
      cancelled = true
    }
    // Options are expected stable per page mount; serialize key fields only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    options?.preferStatic,
    options?.skipLocalAdapter,
    options?.apiBase,
    options?.pageSize,
  ])

  return state
}
