/**
 * KUX G 质量：经 edges 加载路径合并后的 plainZh 必须进入 explain 视图。
 * 抽查本批润色边，禁止回退到「仅机器推导、无手写人话」。
 */
import { describe, expect, it } from 'vitest'
import plainZhMap from './edges.plainZh.json'
import { EDGES } from './edges'
import { explainFormula } from '../../lib/formulaExplain'

/** 本质量 pass 明确润色过的代表 id（scenario-first 中文） */
const SPOT_POLISHED = [
  'electric-to-acoustic-loudspeaker',
  'mechanical-to-thermal-compression',
  'electric-to-thermal-joule',
  'em-micro-to-el-current-rectenna',
  'chemical-to-electric-salinity-gradient-pro',
  'electric-to-thermal-resonator-q-loss',
  'acoustic-to-electric-piezoelectric',
  'thermal-to-mechanical-brayton',
  'chemical-to-mechanical-airbag',
  // Q residual pass: end-use cues on short abstract samples
  'thermal-to-em-micro-thermalnoise',
  'nuclear-to-em-radio-nmr',
  'mechanical-to-radiant-michelson-path',
  'electric-to-electric-snr-limit',
  'thermal-to-electric-varshni-pv-derate',
  // Q residual thin glosses: device/scenario cues on still-abstract lines
  'mass-annihilation-thermal',
  'mechanical-to-chemical-mechanochemistry',
  'chemical-to-radiant-chemiluminescence',
  'acoustic-to-electric-emat-eddy',
  'el-field-to-thermal-dielectric-loss',
  'electric-to-thermal-spitzer-ohmic',
  'mechanical-to-mechanical-transmission',
  // Q residual more thin: end-use on still-short scenario lines
  'acoustic-to-electric-microphone',
  'el-current-to-el-current-transformer',
  'electric-to-chemical-electroplating',
  'mass-to-electric-betavoltaic',
  'electromagnetic-to-electric-link-rx',
  'el-field-to-chemical-excited-triplet-electrophosphorescence',
  'grav-mass-to-wave',
  // Q residual thin-again: end-use on still-abstract scenario lines
  'radiant-to-electric-michelson-photodiode',
  'nuclear-decay-to-electric',
  'electric-to-electric-critical-current-limit',
  'electromagnetic-to-electric-radar-return',
  'em-ir-to-acoustic-photoacoustic',
  'thermal-to-electric-fermi-thermionic-tail',
  'electromagnetic-to-thermal-finesse-cavity-loss',
  // Q residual thin remain: device/end-use on still-abstract physics lines
  'chemical-triplet-to-thermal-nonradiative',
  'electromagnetic-to-thermal-bohm-transport-loss',
  'electric-to-electric-twoport-pass',
  'electromagnetic-to-mechanical-alfven',
  'mass-accretion-xray',
  'radiant-to-thermal-malus-polarizer',
  'chemical-to-mechanical-morse-bond',
  // Q residual thin remain2: device/end-use on short abstract lines
  'mechanical-to-thermal-shock-rh',
  'electric-to-radiant-lamp',
  'chemical-electrochemical-to-electric',
  'mass-fission-to-thermal',
  'em-uv-to-radiant-luminescence-photoluminescence',
  'chemical-combustion-to-thermal',
  'electric-to-electromagnetic-coil-nearfield',
  // Q residual thin remain3: end-use on still-short scenario lines
  'edge-grav-pe-to-electric-hydro',
  'nuclear-to-thermal-district-heating',
  'grav-tidal-stream-electric',
  'em-radio-to-acoustic-thermoacoustic',
  'acoustic-audible-to-thermal-thermoacoustic-cooler',
  'nuclear-to-electric-fusion-lawson-gate',
  'edge-kinetic-to-electric-regen',
  'electric-to-mechanical-coulomb-force',
] as const

const PLAIN = plainZhMap as Record<string, string>

describe('plainZh quality — load + explain path', () => {
  it('spot-polished edges: map → EDGES.formula.plainZh → explainFormula', () => {
    for (const id of SPOT_POLISHED) {
      const expected = PLAIN[id]
      expect(expected, `map missing ${id}`).toBeTruthy()
      expect(expected.length).toBeGreaterThanOrEqual(16)
      // 场景句：含汉字且不只是裸公式
      expect(/[\u4e00-\u9fff]/.test(expected), id).toBe(true)

      const edge = EDGES.find((e) => e.id === id)
      expect(edge, `EDGES missing ${id}`).toBeDefined()
      expect(edge!.formula, `${id} formula`).toBeDefined()
      expect(edge!.formula!.plainZh).toBe(expected)

      const view = explainFormula(edge!.formula!)
      expect(view.plainZh).toBe(expected)
      // expr 仍在（机器校验用），人话优先
      expect(view.expr.length).toBeGreaterThan(0)
    }
  })

  it('every formula edge still carries non-empty plainZh after merge', () => {
    const withF = EDGES.filter((e) => e.formula)
    expect(withF.length).toBeGreaterThan(500)
    for (const e of withF) {
      expect(e.formula!.plainZh && e.formula!.plainZh.length >= 16, e.id).toBe(true)
    }
  })
})
