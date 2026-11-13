export type StructuralTable = {
  columns: { key: string; unit?: string }[]
  rows: (number | null)[][]
}

type StructuralFields = { nodes: StructuralTable; elements: StructuralTable } | { unavailable: 'missing' | 'invalid' }

/** Decode only saved, aligned fields. Never reconstruct an old run from its inputs. */
export function readStructuralFields(derived: Record<string, unknown>): StructuralFields {
  const layouts: Record<string, { dofs: string[]; nodesPerElement: number }> = {
    bar: { dofs: ['ux'], nodesPerElement: 2 }, beam2d: { dofs: ['ux', 'uy', 'rz'], nodesPerElement: 2 },
    cst: { dofs: ['ux', 'uy'], nodesPerElement: 3 }, tet4: { dofs: ['ux', 'uy', 'uz'], nodesPerElement: 4 },
  }
  const layout = typeof derived.elementType === 'string' ? layouts[derived.elementType] : undefined
  const required = ['nodeIdsCsv', 'nodePositionsCsv', 'elementIdsCsv', 'elementConnectivityCsv', 'dofNamesCsv', 'displacementUnitsCsv', 'reactionUnitsCsv', 'displacementCsv', 'reactionCsv']
  if (!layout || required.some(key => derived[key] == null)) return { unavailable: 'missing' }
  try {
    const tokens = (key: string) => {
      const value = derived[key]
      if (typeof value !== 'string' || value.length === 0 || value.length > 100_000) throw new Error(key)
      return value.split(',').map(token => token.trim())
    }
    const numbers = (key: string, count?: number, nullable = false): (number | null)[] => {
      const values = tokens(key)
      if (count != null && values.length !== count) throw new Error(key)
      return values.map(value => {
        if (nullable && value === '') return null
        if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(key)
        return Number(value)
      })
    }
    const ids = (key: string, max: number) => {
      const values = numbers(key) as number[]
      if (values.length > max || values.some(value => !Number.isSafeInteger(value) || value < 0) || new Set(values).size !== values.length) throw new Error(key)
      return values
    }
    const nodeIds = ids('nodeIdsCsv', 96), elementIds = ids('elementIdsCsv', 256)
    const { dofs, nodesPerElement } = layout, dofCount = nodeIds.length * dofs.length
    const displacementUnits = dofs.map(dof => dof === 'rz' ? 'rad' : 'm')
    const reactionUnits = dofs.map(dof => dof === 'rz' ? 'N*m' : 'N')
    if (dofCount > 288 || derived.lengthUnit !== 'm' || tokens('dofNamesCsv').join(',') !== dofs.join(',') || tokens('displacementUnitsCsv').join(',') !== displacementUnits.join(',') || tokens('reactionUnitsCsv').join(',') !== reactionUnits.join(',')) throw new Error('units or DOFs')
    const positions = numbers('nodePositionsCsv', nodeIds.length * 3)
    const displacement = numbers('displacementCsv', dofCount), reaction = numbers('reactionCsv', dofCount)
    const connectivity = numbers('elementConnectivityCsv', elementIds.length * nodesPerElement)
    if (connectivity.some(id => id == null || !nodeIds.includes(id))) throw new Error('connectivity')
    const nodes: StructuralTable = {
      columns: [{ key: 'nodeId' }, ...['x', 'y', 'z'].map(key => ({ key, unit: 'm' })), ...dofs.map((key, i) => ({ key, unit: displacementUnits[i] })), ...dofs.map((key, i) => ({ key: `reaction_${key}`, unit: reactionUnits[i] }))],
      rows: nodeIds.map((id, i) => [id, ...positions.slice(i * 3, i * 3 + 3), ...displacement.slice(i * dofs.length, (i + 1) * dofs.length), ...reaction.slice(i * dofs.length, (i + 1) * dofs.length)]),
    }
    const elements: StructuralTable = {
      columns: [{ key: 'elementId' }, ...Array.from({ length: nodesPerElement }, (_, i) => ({ key: `n${i + 1}` }))],
      rows: elementIds.map((id, i) => [id, ...connectivity.slice(i * nodesPerElement, (i + 1) * nodesPerElement)]),
    }
    const add = (field: string, key: string, unit: string, nullable = false) => {
      if (derived[field] == null) return
      if (unit === 'Pa' && derived.stressUnit !== 'Pa' || unit === '1' && derived.strainUnit !== '1' || unit === 'N*m' && derived.bendingMomentUnit !== 'N*m') throw new Error('element units')
      const values = numbers(field, elementIds.length, nullable)
      elements.columns.push({ key, unit })
      elements.rows.forEach((row, i) => row.push(values[i]))
    }
    add('elementLengthMCsv', 'characteristicLength', 'm')
    add('elementAreaM2Csv', 'area', 'm²')
    add('elementVolumeM3Csv', 'volume', 'm³')
    if (derived.elementType === 'bar' || derived.elementType === 'beam2d') {
      add('elementAxialStressCsv', 'axialStress', 'Pa')
      add('elementAxialStrainCsv', 'axialStrain', '1')
    }
    if (derived.elementType === 'beam2d') {
      add('elementBendingMoment1NmCsv', 'endMoment1', 'N*m')
      add('elementBendingMoment2NmCsv', 'endMoment2', 'N*m')
      add('elementMaxBendingMomentNmCsv', 'maxAbsMoment', 'N*m')
      add('elementBendingStressPaCsv', 'bendingStress', 'Pa', true)
    }
    if (derived.elementType === 'cst' || derived.elementType === 'tet4') {
      for (const component of ['xx', 'yy', 'zz', 'xy', 'yz', 'zx']) add(`elementS${component}Csv`, `σ${component}`, 'Pa')
      for (const component of ['xx', 'yy', 'zz']) add(`elementE${component}Csv`, `ε${component}`, '1')
      for (const component of ['xy', 'yz', 'zx']) add(`elementG${component}Csv`, `γ${component}`, '1')
    }
    return { nodes, elements }
  } catch {
    return { unavailable: 'invalid' }
  }
}
