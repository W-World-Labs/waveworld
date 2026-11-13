import { describe, expect, it } from 'vitest'
import { parseMooseDiffusionInput } from './moose-inp'

const BASE = `[Mesh]
  type = GeneratedMesh
  dim = 2
  nx = 10
  ny = 10
[]

[Variables]
  [u]
  []
[]

[Kernels]
  [diff]
    type = Diffusion
    variable = u
  []
[]

[BCs]
  [left]
    type = DirichletBC
    variable = u
    boundary = left
    value = 0
  []
  [right]
    type = DirichletBC
    variable = u
    boundary = right
    value = 1
  []
[]

[Executioner]
  type = Steady
  solve_type = 'PJFNK'
[]

[Outputs]
  exodus = true
[]
`

describe('parseMooseDiffusionInput', () => {
  it('parses the simple_diffusion subset', () => {
    const c = parseMooseDiffusionInput(BASE)
    expect(c.mesh).toMatchObject({ dim: 2, nx: 10, ny: 10, xmin: 0, xmax: 1 })
    expect(c.variable).toBe('u')
    expect(c.bcs).toEqual([
      { boundary: 'left', type: 'dirichlet', value: 0 },
      { boundary: 'right', type: 'dirichlet', value: 1 },
    ])
    expect(c.executioner).toEqual({ type: 'steady' })
    expect(c.diffusionCoef).toBe(1)
    expect(c.transient).toBe(false)
  })

  it('handles sub-block mesh, inactive pruning, comments', () => {
    const src = BASE
      .replace('[Mesh]\n  type = GeneratedMesh\n  dim = 2\n  nx = 10\n  ny = 10',
        `[Mesh] # comment
  [gmg]
    type = GeneratedMeshGenerator
    dim = 2
    nx = 10
    ny = 10
  []
  [other]
    type = FileMesh
    file = 'x.e'
  []
  inactive = 'other'`)
      .replace('[diff]', '[diff] ! trailing')
    const c = parseMooseDiffusionInput(src)
    expect(c.mesh.nx).toBe(10)
  })

  it('parses the transient subset (CoefDiffusion + TimeDerivative)', () => {
    const src = BASE
      .replace('type = Diffusion', 'type = CoefDiffusion\n    coef = 0.1')
      .replace('  [diff]', '  [diff]').replace('  []\n[]\n\n[BCs]',
        '  []\n  [time]\n    type = TimeDerivative\n    variable = u\n  []\n[]\n\n[BCs]')
      .replace('type = Steady', 'type = Transient\n  dt = 0.1\n  num_steps = 20')
    const c = parseMooseDiffusionInput(src)
    expect(c.diffusionCoef).toBeCloseTo(0.1)
    expect(c.transient).toBe(true)
    expect(c.executioner).toEqual({ type: 'transient', dt: 0.1, numSteps: 20, endTime: 2 })
  })

  it('fails closed on out-of-subset input', () => {
    const variants: [string, RegExp][] = [
      [BASE.replace('type = GeneratedMesh', 'type = FileMesh'), /only GeneratedMesh/],
      [BASE.replace('dim = 2', 'dim = 3'), /only 1D\/2D/],
      [BASE.replace('type = Diffusion', 'type = MatDiffusion'), /unsupported kernel type/],
      [BASE.replace('type = Steady', "type = Transient\n  scheme = bdf2"), /unsupported time scheme/],
      [BASE.replace('type = DirichletBC', 'type = MatNeumannBC'), /unsupported BC type/],
      [BASE.replace('type = DirichletBC', 'type = FunctionDirichletBC'), /cannot set value/],
      [BASE.replace('boundary = left', 'boundary = walls'), /unknown boundary/],
      [BASE.replace('[u]', '[v]'), /kernel acts on 'u', expected 'v'/],
      [BASE + '\n[MultiApps]\n[]\n', /unsupported top-level block/],
      [BASE + '\n[Materials]\n  [m]\n    type = BadMaterial\n  []\n[]\n', /unsupported material type/],
      [BASE.replace('nx = 10', 'nx = two'), /must be a number/],
      [BASE.replace('order', 'order').replace('[u]\n  []', '[u]\n    order = SECOND\n  []'), /only FIRST-order/],
      [BASE.replace('[Variables]\n  [u]\n  []\n[]', '[Variables]\n  [u]\n  []\n  [v]\n  []\n[]'), /exactly one variable/],
      [BASE.replace('value = 0\n  []\n  [right]', "value = 0\n    function = 'f'\n  []\n  [right]"), /function value/],
    ]
    for (const [src, re] of variants) expect(() => parseMooseDiffusionInput(src), String(re)).toThrow(re)
  })

  it('parses the NAFEMS-style heat-conduction subset', () => {
    const src = BASE
      .replace('[diff]\n    type = Diffusion\n    variable = u\n  []',
        '[heat]\n    type = HeatConduction\n    variable = u\n  []\n  [tdot]\n    type = HeatConductionTimeDerivative\n    variable = u\n  []')
      .replace('[Variables]\n  [u]\n  []', '[Variables]\n  [u]\n    initial_condition = 0.0\n  []')
      .replace("type = DirichletBC\n    variable = u\n    boundary = right\n    value = 1",
        "type = FunctionDirichletBC\n    variable = u\n    boundary = right\n    function = '100.0 * sin(pi*t/40)'")
      .replace('type = Steady', 'type = Transient\n  dt = 1\n  end_time = 32.0')
      .replace('[Outputs]', `[Materials]
  [m]
    type = GenericConstantMaterial
    prop_names = 'thermal_conductivity specific_heat density'
    prop_values = '35.0 440.5 7200.0'
  []
[]

[Postprocessors]
  [probe]
    type = NodalVariableValue
    variable = u
    nodeid = 9
  []
[]

[Outputs]`)
    const c = parseMooseDiffusionInput(src)
    expect(c.diffusionCoef).toBe(35)
    expect(c.timeCoef).toBe(7200 * 440.5)
    expect(c.initial).toBe(0)
    const fn = c.bcs.find(b => b.type === 'dirichlet-fn')!
    if (fn.type !== 'dirichlet-fn') throw new Error('unreachable')
    expect(fn.fn(4)).toBeCloseTo(100 * Math.sin(Math.PI / 10), 9)
    expect(c.probeNodes).toEqual([9])
    expect(c.executioner).toEqual({ type: 'transient', dt: 1, numSteps: 32, endTime: 32 })
  })

  it('parses the dim=1 HeatSource + ParsedFunction subset', () => {
    const src = `[Mesh]
  [geom]
    type = GeneratedMeshGenerator
    dim = 1
    elem_type = EDGE2
    nx = 1
  []
[]
[Variables]
  [u]
  []
[]
[Functions]
  [exact]
    type = ParsedFunction
    symbol_names = 'q L k ui uo'
    symbol_values = '1200 1 12 100 0'
    expression = 'ui + (uo-ui)*x/L + (q/k) * x * (L-x) / 2'
  []
[]
[Kernels]
  [heat]
    type = HeatConduction
    variable = u
  []
  [src]
    type = HeatSource
    variable = u
    function = 1200
  []
[]
[BCs]
  [l]
    type = DirichletBC
    variable = u
    boundary = left
    value = 100
  []
  [r]
    type = DirichletBC
    variable = u
    boundary = right
    value = 0
  []
[]
[Materials]
  [m]
    type = GenericConstantMaterial
    prop_names = 'density specific_heat thermal_conductivity'
    prop_values = '1.0 1.0 12.0'
  []
[]
[Executioner]
  type = Steady
[]
`
    const c = parseMooseDiffusionInput(src)
    expect(c.mesh).toMatchObject({ dim: 1, nx: 1, ny: 1 })
    expect(c.diffusionCoef).toBe(12)
    expect(c.source).toBe(1200)
    const exact = c.functions.get('exact')!
    expect(exact({ x: 0.5 })).toBeCloseTo(62.5, 12)
  })

  it('parses ConvectiveHeatFluxBC and a stationary Transient executioner', () => {
    const src = `[Mesh]
  type = GeneratedMesh
  dim = 2
[]
[Problem]
  extra_tag_vectors = 'bcs'
[]
[Variables]
  [temp]
    initial_condition = 100.0
  []
[]
[Kernels]
  [hc]
    type = HeatConduction
    variable = temp
    thermal_conductivity = 10
  []
[]
[BCs]
  [l]
    type = DirichletBC
    variable = temp
    boundary = left
    value = 100.0
  []
  [r]
    type = ConvectiveHeatFluxBC
    variable = temp
    boundary = right
    T_infinity = 200.0
    heat_transfer_coefficient = 10
    heat_transfer_coefficient_dT = 0
  []
[]
[Executioner]
  type = Transient
  num_steps = 1.0
  nl_rel_tol = 1e-12
[]
`
    const c = parseMooseDiffusionInput(src)
    expect(c.mesh).toMatchObject({ dim: 2, nx: 1, ny: 1 })
    expect(c.diffusionCoef).toBe(10)
    expect(c.transient).toBe(false)
    expect(c.bcs[1]).toEqual({ boundary: 'right', type: 'robin', h: 10, tInf: 200 })
    expect(c.executioner).toEqual({ type: 'transient', dt: 1, numSteps: 1, endTime: 1 })
    // Nonzero dT Jacobian hook fails closed.
    expect(() => parseMooseDiffusionInput(src.replace('heat_transfer_coefficient_dT = 0', 'heat_transfer_coefficient_dT = 1')))
      .toThrow(/heat_transfer_coefficient_dT must be 0/)
  })
})
