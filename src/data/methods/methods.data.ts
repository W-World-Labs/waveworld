/**
 * Methods catalog barrel (#86 / #96).
 * Edit a single kind in `parts/<kind>.ts` — do not re-monolith this file.
 */
import type { FoundationalMethod } from './types'
import { METHODS_WAVE } from './parts/wave'
import { METHODS_SENSING } from './parts/sensing'
import { METHODS_PARTICLE } from './parts/particle'
import { METHODS_STATISTICAL } from './parts/statistical'
import { METHODS_CONTINUUM } from './parts/continuum'
import { METHODS_CIRCUIT } from './parts/circuit'
import { METHODS_IMAGING } from './parts/imaging'
import { METHODS_BIO } from './parts/bio'
import { METHODS_META } from './parts/meta'

export const METHODS: FoundationalMethod[] = [
  ...METHODS_WAVE,
  ...METHODS_SENSING,
  ...METHODS_PARTICLE,
  ...METHODS_STATISTICAL,
  ...METHODS_CONTINUUM,
  ...METHODS_CIRCUIT,
  ...METHODS_IMAGING,
  ...METHODS_BIO,
  ...METHODS_META,
]
