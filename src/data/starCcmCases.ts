/** Curated W-Sim operation examples mapped to Simcenter STAR-CCM+ concepts; no vendor parity is implied. */
export interface StarCcmNativeCase {
  file: string
  module: string
  targetSoftware: 'Simcenter STAR-CCM+'
  mappedFeature: string
  product: 'Mesh and geometry' | 'Numerical methods' | 'Flow and boundaries' | 'Compressible flow' | 'Turbulence' | 'Heat transfer' | 'Multiphase and particles' | 'Reacting flow' | 'Motion and FSI' | 'Design and diagnostics' | 'Electromagnetics and acoustics'
  summary: string
  selector: string
  selectorChecks: { path: string; equals?: string | number | boolean; present?: true }[]
  input: { module: string; backend: 'host'; [key: string]: unknown }
  exampleName: string
  limitations: string[]
  testsWritten: string[]
  sourceUrls: string[]
}

import data from './starCcmCases.json?compressed'

export const STAR_CCM_NATIVE_CASES: readonly StarCcmNativeCase[] = data
