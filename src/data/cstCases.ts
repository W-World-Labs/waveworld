/** Curated W-Sim host examples mapped to bounded CST Studio Suite concepts; no CST parity is implied. */
export interface CstNativeCase {
  file: string
  module: string
  targetSoftware: 'CST Studio Suite'
  mappedFeature: string
  product: 'High-frequency fields' | 'Materials and dispersion' | 'Sources and boundaries' | 'Ports and networks' | 'Antennas and radiation' | 'Mesh and discretization' | 'Low-frequency electromagnetics' | 'Charged particles' | 'Multiphysics and exposure' | 'Optimization and diagnostics'
  summary: string
  selector: string
  selectorChecks: { path: string; equals?: string | number | boolean; present?: true }[]
  input: { module: string; backend: 'host'; [key: string]: unknown }
  exampleName: string
  limitations: string[]
  testsWritten: string[]
  sourceUrls: string[]
}

import data from './cstCases.json?compressed'

export const CST_NATIVE_CASES: readonly CstNativeCase[] = data
