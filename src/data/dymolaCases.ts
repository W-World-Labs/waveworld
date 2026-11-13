/** Curated W-Sim operation examples mapped to Dymola concepts; no vendor parity is implied. */
export interface DymolaNativeCase {
  file: string
  module: string
  targetSoftware: 'Dymola'
  mappedFeature: string
  product: 'Equation systems' | 'Numerical methods' | 'Events and controls' | 'Electrical' | 'Thermal and fluid' | 'Mechanics' | 'Experiments and data'
  summary: string
  selector: string
  selectorChecks: { path: string; equals?: string | number | boolean; present?: true }[]
  input: { module: string; backend: 'host'; [key: string]: unknown }
  exampleName: string
  limitations: string[]
  testsWritten: string[]
  sourceUrls: string[]
}

import data from './dymolaCases.json?compressed'

export const DYMOLA_NATIVE_CASES: readonly DymolaNativeCase[] = data
