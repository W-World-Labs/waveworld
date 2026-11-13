import { matV4At, parseMatV4Matrices, type MatV4Matrix } from './matV4Reader';

export type MatResultSignal = {
  name: string;
  description: string;
  kind: 'time' | 'parameter' | 'series';
  values: number[];
};

export type ModelicaMatResult = {
  layout: 'binTrans' | 'binNormal';
  sampleCount: number;
  time: number[];
  signals: MatResultSignal[];
};

type NumericData = Float32Array | Float64Array | Int32Array | Uint8Array;
const RESULT_MATRIX_NAMES = ['Aclass', 'name', 'description', 'dataInfo', 'data_1', 'data_2'];
const MAX_SIGNALS = 10_000;
const MAX_SAMPLES = 100_000;
const MAX_EXPANDED_VALUES = 2_000_000;

function fail(message: string): never {
  throw new Error(`Invalid OpenModelica MAT result: ${message}`);
}

function matrix(matrices: Map<string, MatV4Matrix>, name: string): MatV4Matrix {
  const value = matrices.get(name);
  if (!value) return fail(`missing ${name}`);
  return value;
}

function assertMatrix(value: MatV4Matrix, name: string): asserts value is MatV4Matrix & { values: NumericData } {
  if (!(value.values instanceof Float32Array || value.values instanceof Float64Array || value.values instanceof Int32Array || value.values instanceof Uint8Array)) {
    fail(`${name} has an unsupported element type`);
  }
  if (!Number.isSafeInteger(value.rows) || !Number.isSafeInteger(value.columns) || value.rows < 1 || value.columns < 1) fail(`${name} must be two-dimensional`);
  if (value.rows * value.columns !== value.values.length) fail(`${name} dimensions do not match its data`);
}

function assertNumeric(value: MatV4Matrix, name: string): asserts value is MatV4Matrix & { values: NumericData } {
  if (value.class !== 'numeric') fail(`${name} must be a numeric matrix`);
  assertMatrix(value, name);
}

function logicalShape(value: MatV4Matrix, transposed: boolean): [number, number] {
  return transposed ? [value.columns, value.rows] : [value.rows, value.columns];
}

function at(value: MatV4Matrix & { values: NumericData }, row: number, col: number, transposed: boolean): number {
  return matV4At(value, transposed ? col : row, transposed ? row : col);
}

function rowsAsText(value: MatV4Matrix, expectedRows: number, transposed: boolean, label: string): string[] {
  if (value.class !== 'text') fail(`${label} must be a character matrix`);
  assertMatrix(value, label);
  const [rows, cols] = logicalShape(value, transposed);
  if (rows !== expectedRows || cols < 1) fail(`${label} has invalid dimensions`);
  const result: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    let s = '';
    for (let c = 0; c < cols; c += 1) {
      const code = at(value, r, c, transposed);
      if (!Number.isInteger(code) || code < 0 || code > 255) fail(`${label} contains an invalid character`);
      s += String.fromCharCode(code);
    }
    result.push(s.replace(/[\0 ]+$/g, ''));
  }
  return result;
}

function finiteValues(value: MatV4Matrix & { values: NumericData }, row: number, columns: number, transposed: boolean, label: string): number[] {
  const out: number[] = [];
  for (let c = 0; c < columns; c += 1) {
    const n = at(value, row, c, transposed);
    if (!Number.isFinite(n)) fail(`${label} contains a non-finite value`);
    out.push(n);
  }
  return out;
}

export function parseOpenModelicaMatResult(input: ArrayBuffer): ModelicaMatResult {
  const matrices = parseMatV4Matrices(input);
  if (matrices.size !== RESULT_MATRIX_NAMES.length || [...matrices.keys()].some((name, index) => name !== RESULT_MATRIX_NAMES[index])) {
    fail('expected exactly the six result matrices in documented order');
  }
  const aclass = matrix(matrices, 'Aclass');
  if (aclass.class !== 'text') fail('Aclass must be a character matrix');
  // OpenModelica writes Aclass as 4 x 11 for both result layouts.
  if (aclass.rows !== 4 || aclass.columns !== 11) fail('Aclass must be a 4-by-11 character matrix');
  const aclassLines = rowsAsText(aclass, 4, false, 'Aclass');
  if (aclassLines[0] !== 'Atrajectory' || aclassLines[1] !== '1.1' || aclassLines[2] !== '') {
    fail('unsupported Aclass header');
  }
  const layout = aclassLines[3];
  if (layout !== 'binTrans' && layout !== 'binNormal') fail('unsupported layout');
  // The layout name does not apply one blanket transpose to every MAT array:
  // OpenModelica stores metadata column-wise in binTrans, while numeric
  // trajectory tables use the logical row-per-signal form in that layout.
  const metadataTransposed = layout === 'binTrans';
  const dataTransposed = layout === 'binNormal';

  const namesMatrix = matrix(matrices, 'name');
  const descriptionsMatrix = matrix(matrices, 'description');
  const nameCount = metadataTransposed ? namesMatrix.columns : namesMatrix.rows;
  const descriptionCount = metadataTransposed ? descriptionsMatrix.columns : descriptionsMatrix.rows;
  if (nameCount < 1 || nameCount > MAX_SIGNALS || descriptionCount !== nameCount) fail('signal count or metadata dimensions are unsupported');
  const names = rowsAsText(namesMatrix, nameCount, metadataTransposed, 'name');
  const descriptions = rowsAsText(descriptionsMatrix, descriptionCount, metadataTransposed, 'description');
  if (names.length === 0 || names.length !== descriptions.length || names.some((n) => n.length === 0)) {
    fail('name and description rows are inconsistent');
  }
  if (names.length > MAX_SIGNALS || new Set(names).size !== names.length) fail('signal count or names are unsupported');

  const info = matrix(matrices, 'dataInfo');
  assertNumeric(info, 'dataInfo');
  if (info.type !== 'int32') fail('dataInfo must use signed int32 elements');
  const [infoRows, infoCols] = logicalShape(info, metadataTransposed);
  if (infoCols !== 4 || infoRows !== names.length) fail('dataInfo must have one four-column row per signal');

  const data1 = matrix(matrices, 'data_1');
  const data2 = matrix(matrices, 'data_2');
  assertNumeric(data1, 'data_1');
  assertNumeric(data2, 'data_2');
  if ((data1.type !== 'float32' && data1.type !== 'float64') || (data2.type !== 'float32' && data2.type !== 'float64')) {
    fail('data_1 and data_2 must use float32 or float64 elements');
  }
  for (const [label, values] of [['data_1', data1.values], ['data_2', data2.values]] as const) {
    for (let index = 0; index < values.length; index += 1) {
      if (!Number.isFinite(values[index])) fail(`${label} contains a non-finite value`);
    }
  }
  const [d1rows, d1cols] = logicalShape(data1, dataTransposed);
  const [d2rows, d2cols] = logicalShape(data2, dataTransposed);
  if (d1cols < 1 || d1cols > 2 || d2cols < 1 || d2rows < 1) fail('data matrices have unsupported dimensions');
  if (d2cols > MAX_SAMPLES) fail('sample count exceeds 100,000');

  let hasTime = false;
  const records: Array<{ source: 1 | 2; row: number; sign: number; isTime: boolean }> = [];
  for (let i = 0; i < infoRows; i += 1) {
    const table = at(info, i, 0, metadataTransposed);
    const signedRow = at(info, i, 1, metadataTransposed);
    if (!Number.isInteger(table) || !Number.isInteger(signedRow) || signedRow === 0) fail(`dataInfo row ${i} has invalid indices`);
    if (table !== 0 && table !== 1 && table !== 2) fail(`dataInfo row ${i} references an unsupported table`);
    const row = Math.abs(signedRow) - 1;
    const rowCount = table === 1 ? d1rows : d2rows;
    if (table !== 0 && row >= rowCount) fail(`dataInfo row ${i} is out of bounds`);
    if (table === 0) {
      if (row !== 0) fail('time may only reference row 1');
      if (signedRow !== 1 || hasTime) fail('time must be a single positive row-1 abscissa');
      hasTime = true;
      records.push({ source: 2, row: 0, sign: signedRow < 0 ? -1 : 1, isTime: true });
    } else {
      records.push({ source: table, row, sign: signedRow < 0 ? -1 : 1, isTime: false });
    }
  }
  if (!hasTime) fail('dataInfo does not contain time');
  const time = finiteValues(data2, 0, d2cols, dataTransposed, 'time');
  for (let i = 1; i < time.length; i += 1) if (time[i] < time[i - 1]) fail('time decreases');

  const expandedValues = records.reduce((count, record) => count + (record.source === 1 ? d1cols : d2cols), 0);
  if (expandedValues > MAX_EXPANDED_VALUES) fail('expanded result exceeds 2,000,000 values');

  const signals: MatResultSignal[] = names.map((name, i) => {
    const record = records[i];
    if (record.isTime) {
      return { name, description: descriptions[i], kind: 'time', values: time.map((v) => v * record.sign) };
    }
    const source = record.source === 1 ? data1 : data2;
    const colCount = record.source === 1 ? d1cols : d2cols;
    const values = finiteValues(source, record.row, colCount, dataTransposed, name).map((v) => v * record.sign);
    if (values.some((v) => !Number.isFinite(v))) fail(`${name} contains a non-finite value`);
    return { name, description: descriptions[i], kind: record.source === 1 ? 'parameter' : 'series', values };
  });
  return { layout, sampleCount: time.length, time, signals };
}
