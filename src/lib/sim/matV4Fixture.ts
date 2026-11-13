/**
 * Authored synthetic binary data for MAT-v4 parser tests. This is not
 * Dymola or OpenModelica vendor output and contains no vendored artifacts.
 */

export type MatV4Layout = 'binNormal' | 'binTrans';
export type MatV4Endian = 'little' | 'big';

export interface MatV4Matrix {
  rows: number;
  cols: number;
  /** Matrix payload values in column-major order, as stored by MAT-v4. */
  values: readonly number[] | readonly string[];
  kind?: 'double' | 'text';
  /** OpenModelica's MAT-v4 text/integer type code when it differs from default. */
  mopt?: number;
}

export interface MatV4FixtureOptions {
  layout?: MatV4Layout;
  endian?: MatV4Endian;
  /** Optional named matrices replace the corresponding authored defaults. */
  matrices?: Readonly<Record<string, MatV4Matrix>>;
}

const DEFAULT_NAMES = ['Time', 'T', 'temperature', '-temperature', 'gain'];
const DEFAULT_DESCRIPTIONS = ['Time [s]', 'Temperature [K]', 'Temperature alias [K]', 'Negated temperature [K]', 'Gain parameter'];
const DEFAULT_TIMES = [0, 1, 1, 2];
const DEFAULT_TEMPERATURE = [300, 310, 311, 320];

function textRows(lines: readonly string[], rows: number, cols: number): MatV4Matrix {
  const values: string[] = [];
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) values.push(lines[row]?.[col] ?? ' ');
  }
  return { rows, cols, values, kind: 'text', mopt: 51 };
}

function variableNames(names: readonly string[], layout: MatV4Layout): MatV4Matrix {
  const width = Math.max(...names.map((name) => name.length));
  const values: string[] = [];
  if (layout === 'binTrans') {
    for (const name of names) for (let row = 0; row < width; row += 1) values.push(name[row] ?? ' ');
    return { rows: width, cols: names.length, values, kind: 'text', mopt: 51 };
  }
  for (let col = 0; col < width; col += 1) {
    for (const name of names) values.push(name[col] ?? ' ');
  }
  return { rows: names.length, cols: width, values, kind: 'text', mopt: 51 };
}

function defaults(layout: MatV4Layout): Record<string, MatV4Matrix> {
  const infoColumns = [
    [0, 1, 0, 0], [2, 2, 0, 0], [2, 2, 0, 0], [2, -2, 0, 0], [1, 2, 0, 0],
  ];
  const info: number[] = [];
  if (layout === 'binTrans') {
    for (const column of infoColumns) info.push(...column);
  } else {
    for (let field = 0; field < 4; field += 1) {
      for (const column of infoColumns) info.push(column[field]);
    }
  }
  const samples = DEFAULT_TIMES.length;
  const variables = [DEFAULT_TIMES, DEFAULT_TEMPERATURE];
  // MAT-v4 values are column-major. binTrans columns hold one sample's
  // variable vector; binNormal columns hold a variable's sample series.
  const data2 = layout === 'binTrans'
    ? DEFAULT_TIMES.flatMap((time, index) => [time, DEFAULT_TEMPERATURE[index]])
    : variables.flatMap((variable) => variable);

  return {
    Aclass: textRows(['Atrajectory', '1.1', '', layout], 4, 11),
    name: variableNames(DEFAULT_NAMES, layout),
    description: variableNames(DEFAULT_DESCRIPTIONS, layout),
    dataInfo: {
      rows: layout === 'binTrans' ? 4 : DEFAULT_NAMES.length,
      cols: layout === 'binTrans' ? DEFAULT_NAMES.length : 4,
      values: info,
      mopt: 20,
    },
    // data_1: parameter constants and start/stop values; time is [0, 2], gain is 2.5.
    data_1: {
      rows: 2,
      cols: 2,
      values: layout === 'binTrans' ? [0, 2.5, 2, 2.5] : [0, 2, 2.5, 2.5],
    },
    data_2: {
      rows: layout === 'binTrans' ? variables.length : samples,
      cols: layout === 'binTrans' ? samples : variables.length,
      values: data2,
    },
  };
}

function encodeMatrix(name: string, matrix: MatV4Matrix, endian: MatV4Endian): Uint8Array {
  const isText = matrix.kind === 'text' || matrix.values.some((value) => typeof value === 'string');
  const mopt = (endian === 'little' ? 0 : 1) * 1000 + (matrix.mopt ?? (isText ? 51 : 0));
  const precision = Math.floor((mopt % 100) / 10);
  const textClass = mopt % 10 === 1;
  const nameBytes = new TextEncoder().encode(`${name}\0`);
  const elementBytes = precision === 0 ? 8 : precision === 1 || precision === 2 ? 4 : precision === 5 && textClass ? 1 : 0;
  if (elementBytes === 0 || (isText !== textClass)) throw new Error(`Unsupported authored fixture MOPT ${mopt}`);
  const output = new Uint8Array(20 + nameBytes.length + matrix.rows * matrix.cols * elementBytes);
  const view = new DataView(output.buffer);
  const header = [mopt, matrix.rows, matrix.cols, 0, nameBytes.length];
  header.forEach((value, index) => view.setInt32(index * 4, value, endian === 'little'));
  output.set(nameBytes, 20);
  const offset = 20 + nameBytes.length;
  if (textClass && precision === 5) {
    matrix.values.forEach((value, index) => { output[offset + index] = typeof value === 'string' ? value.charCodeAt(0) : value; });
  } else if (precision === 1) {
    matrix.values.forEach((value, index) => view.setFloat32(offset + index * 4, Number(value), endian === 'little'));
  } else if (precision === 2) {
    matrix.values.forEach((value, index) => view.setInt32(offset + index * 4, Number(value), endian === 'little'));
  } else {
    matrix.values.forEach((value, index) => view.setFloat64(offset + index * 8, Number(value), endian === 'little'));
  }
  return output;
}

/** Build a complete small MAT-v4 simulation result as an ArrayBuffer. */
export function makeMatResultFixture(options: MatV4FixtureOptions = {}): ArrayBuffer {
  const layout = options.layout ?? 'binTrans';
  const endian = options.endian ?? 'little';
  const matrices = { ...defaults(layout), ...options.matrices };
  const chunks = Object.entries(matrices).map(([name, matrix]) => encodeMatrix(name, matrix, endian));
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result.buffer;
}

/** Return a deliberately incomplete copy for truncation/error-path fixtures. */
export function truncateMatResultFixture(buffer: ArrayBuffer, byteLength = Math.max(0, buffer.byteLength - 1)): ArrayBuffer {
  return buffer.slice(0, Math.max(0, Math.min(byteLength, buffer.byteLength)));
}

/** Return a copy with one byte changed, useful for malformed-header cases. */
export function mutateMatResultFixture(buffer: ArrayBuffer, offset: number, value: number): ArrayBuffer {
  const copy = buffer.slice(0);
  if (offset >= 0 && offset < copy.byteLength) new Uint8Array(copy)[offset] = value & 0xff;
  return copy;
}
