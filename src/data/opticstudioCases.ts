/** Curated W-Sim operation examples mapped to OpticStudio features; no vendor parity is implied. */
export interface OpticStudioNativeCase {
  file: string
  module: string
  targetSoftware: 'OpticStudio'
  opticStudioFeature: string
  product: 'Sequential' | 'Non-sequential' | 'Materials' | 'Polarization' | 'Physical optics' | 'Image analysis'
  summary: string
  selector: string
  input: { module: string; backend: 'host'; [key: string]: unknown }
  exampleName: string
  limitations: string[]
  testsWritten: string[]
  sourceUrls: string[]
}

import data from './opticstudioCases.json?compressed'

export const OPTICSTUDIO_NATIVE_CASES: readonly OpticStudioNativeCase[] = data
