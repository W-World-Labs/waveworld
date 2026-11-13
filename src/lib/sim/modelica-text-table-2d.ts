import { parseModelicaTextTable } from './modelica-text-table'

/** Maximum number of knots accepted on either CombiTable2Dv axis. */
export const MODELICA_TEXT_TABLE_2D_MAX_AXIS_KNOTS = 128
/** Maximum number of interior surface values accepted. */
export const MODELICA_TEXT_TABLE_2D_MAX_GRID_CELLS = 16_384

/** Serializable CombiTable2Dv data; values are row-major in u1, then u2. */
export interface ModelicaTextTable2DSurface {
  name: string
  u1: number[]
  u2: number[]
  values: number[][]
}

/**
 * Select a Dymola-mapped CombiTable2Dv matrix from a Modelica #1 text table.
 * The first row after the corner contains u2 knots, the first column after
 * the corner contains u1 knots, and the remaining rectangle contains values.
 * This only validates and extracts data; it does not interpolate it.
 */
export function selectModelicaTextTable2D(
  text: string,
  selectedName: string,
): ModelicaTextTable2DSurface {
  const matrix = parseModelicaTextTable(text, selectedName)
  const u1Count = matrix.rows - 1
  const u2Count = matrix.columns - 1

  if (u1Count < 2 || u2Count < 2) {
    throw new Error(`Modelica 2-D matrix '${selectedName}' must have at least two knots on each axis`)
  }
  if (u1Count > MODELICA_TEXT_TABLE_2D_MAX_AXIS_KNOTS) {
    throw new Error(`Modelica 2-D matrix '${selectedName}' exceeds the ${MODELICA_TEXT_TABLE_2D_MAX_AXIS_KNOTS}-knot u1 axis limit`)
  }
  if (u2Count > MODELICA_TEXT_TABLE_2D_MAX_AXIS_KNOTS) {
    throw new Error(`Modelica 2-D matrix '${selectedName}' exceeds the ${MODELICA_TEXT_TABLE_2D_MAX_AXIS_KNOTS}-knot u2 axis limit`)
  }
  const gridCells = u1Count * u2Count
  if (!Number.isSafeInteger(gridCells) || gridCells > MODELICA_TEXT_TABLE_2D_MAX_GRID_CELLS) {
    throw new Error(`Modelica 2-D matrix '${selectedName}' exceeds the ${MODELICA_TEXT_TABLE_2D_MAX_GRID_CELLS}-cell grid limit`)
  }

  const u2 = matrix.values[0].slice(1)
  const u1: number[] = []
  const values: number[][] = []
  for (let row = 1; row < matrix.rows; row += 1) {
    u1.push(matrix.values[row][0])
    values.push(matrix.values[row].slice(1))
  }

  assertStrictlyIncreasing(u1, 'u1', selectedName)
  assertStrictlyIncreasing(u2, 'u2', selectedName)
  return { name: matrix.name, u1, u2, values }
}

function assertStrictlyIncreasing(axis: number[], label: string, name: string): void {
  for (let index = 0; index < axis.length; index += 1) {
    if (!Number.isFinite(axis[index])) {
      throw new Error(`Modelica 2-D matrix '${name}' ${label} axis values must be finite`)
    }
    if (index > 0 && axis[index] <= axis[index - 1]) {
      throw new Error(`Modelica 2-D matrix '${name}' ${label} axis must be strictly increasing`)
    }
  }
}
