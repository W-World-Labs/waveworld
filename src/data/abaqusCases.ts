/** W-Sim native modules mapped to Abaqus feature concepts; no solver parity is implied. */
export interface AbaqusNativeCase { file: string; module: string; targetSoftware: 'Abaqus'; product: string; abaqusFeature: string; summary: string; selector: string; input: { module: string; [key: string]: unknown }; exampleName: string; limitations: string; testsWritten: string[]; sourceUrls: string[] }

import data from './abaqusCases.json?compressed'

export const ABAQUS_NATIVE_CASES: readonly AbaqusNativeCase[] = data
