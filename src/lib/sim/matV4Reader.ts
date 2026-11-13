/** A numeric or byte-valued matrix read from a MATLAB level-4 MAT file. */
export interface MatV4Matrix {
  name: string;
  rows: number;
  columns: number;
  /** MATLAB-v4 T field: numeric/full data or a character/text matrix. */
  class: 'numeric' | 'text';
  type: 'float32' | 'float64' | 'int32' | 'uint8';
  values: Float32Array | Float64Array | Int32Array | Uint8Array;
}

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_ELEMENTS = 2_000_000;
const MAX_MATRICES = 16;
const HEADER_BYTES = 20;

type Endian = 'little' | 'big';

function fail(message: string): never {
  throw new Error(`Invalid MAT-v4 file: ${message}`);
}

function decodeMopt(mopt: number): { endian: Endian; class: MatV4Matrix['class']; type: MatV4Matrix['type']; bytesPerElement: number } {
  // MAT-v4 MOPT is M*1000 + O*100 + P*10 + T. O=0 is the supported
  // column-major layout; M=0/1 denotes IEEE little/big endian.
  const machine = Math.floor(mopt / 1000);
  const order = Math.floor(mopt / 100) % 10;
  const precision = Math.floor(mopt / 10) % 10;
  const text = mopt % 10;
  if ((machine !== 0 && machine !== 1) || order !== 0 || (text !== 0 && text !== 1)) {
    return fail(`unsupported MOPT ${mopt}`);
  }

  if (precision === 0 && (text === 0 || text === 1)) {
    return { endian: machine === 0 ? 'little' : 'big', class: text === 1 ? 'text' : 'numeric', type: 'float64', bytesPerElement: 8 };
  }
  if (precision === 1 && text === 0) {
    return { endian: machine === 0 ? 'little' : 'big', class: 'numeric', type: 'float32', bytesPerElement: 4 };
  }
  if (precision === 2 && text === 0) {
    return { endian: machine === 0 ? 'little' : 'big', class: 'numeric', type: 'int32', bytesPerElement: 4 };
  }
  if (precision === 5 && text === 1) {
    return { endian: machine === 0 ? 'little' : 'big', class: 'text', type: 'uint8', bytesPerElement: 1 };
  }
  return fail(`unsupported precision/layout in MOPT ${mopt}`);
}

/** Parse the supported primitive subset of MATLAB level-4 binary MAT files. */
export function parseMatV4Matrices(input: ArrayBuffer): Map<string, MatV4Matrix> {
  if (!(input instanceof ArrayBuffer)) fail('input must be an ArrayBuffer');
  if (input.byteLength > MAX_FILE_BYTES) fail('file exceeds 16 MiB limit');

  const view = new DataView(input);
  const bytes = new Uint8Array(input);
  const result = new Map<string, MatV4Matrix>();
  let offset = 0;
  let totalElements = 0;
  let fileEndian: Endian | undefined;

  while (offset < input.byteLength) {
    if (result.size >= MAX_MATRICES) fail('matrix count exceeds 16');
    if (input.byteLength - offset < HEADER_BYTES) fail('truncated matrix header');

    // Determine byte order from MOPT, then validate every header field using it.
    const moptLE = view.getInt32(offset, true);
    const moptBE = view.getInt32(offset, false);
    let info: ReturnType<typeof decodeMopt>;
    if (moptLE >= 0 && moptLE <= 1999) info = decodeMopt(moptLE);
    else if (moptBE >= 0 && moptBE <= 1999) info = decodeMopt(moptBE);
    else fail('unsupported or invalid MOPT');

    // decodeMopt rejects unsupported combinations. The endian represented by
    // the accepted MOPT must also match the byte order in which it was read.
    const moptEndian: Endian = moptLE >= 0 && moptLE <= 1999 ? 'little' : 'big';
    if (info.endian !== moptEndian) fail('MOPT byte order is inconsistent');
    if (fileEndian !== undefined && fileEndian !== info.endian) fail('inconsistent byte order');
    fileEndian = info.endian;

    const littleEndian = info.endian === 'little';
    const rows = view.getInt32(offset + 4, littleEndian);
    const columns = view.getInt32(offset + 8, littleEndian);
    const imagf = view.getInt32(offset + 12, littleEndian);
    const nameLength = view.getInt32(offset + 16, littleEndian);
    if (rows <= 0 || columns <= 0) fail('matrix dimensions must be positive');
    if (imagf !== 0) fail('complex matrices are unsupported');
    if (nameLength <= 1) fail('matrix name must be non-empty and NUL-terminated');
    const elementCount = rows * columns;
    if (!Number.isSafeInteger(elementCount) || elementCount <= 0) fail('matrix dimensions overflow');
    if (totalElements + elementCount > MAX_ELEMENTS) fail('total element count exceeds 2,000,000');

    const nameStart = offset + HEADER_BYTES;
    if (nameLength > input.byteLength - nameStart) fail('truncated matrix name');
    const nameEnd = nameStart + nameLength;
    if (bytes[nameEnd - 1] !== 0) fail('matrix name is not NUL-terminated');
    let name = '';
    for (let i = nameStart; i < nameEnd - 1; i++) {
      if (bytes[i] === 0 || bytes[i] > 0x7f) fail('invalid matrix name encoding');
      name += String.fromCharCode(bytes[i]);
    }
    if (result.has(name)) fail(`duplicate matrix name ${name}`);

    const dataStart = nameEnd;
    const payloadBytes = elementCount * info.bytesPerElement;
    if (!Number.isSafeInteger(payloadBytes) || payloadBytes > input.byteLength - dataStart) fail('truncated matrix payload');
    const dataEnd = dataStart + payloadBytes;
    let values: MatV4Matrix['values'];
    if (info.type === 'float64') {
      const array = new Float64Array(elementCount);
      for (let i = 0, p = dataStart; i < elementCount; i++, p += 8) array[i] = view.getFloat64(p, littleEndian);
      values = array;
    } else if (info.type === 'float32') {
      const array = new Float32Array(elementCount);
      for (let i = 0, p = dataStart; i < elementCount; i++, p += 4) array[i] = view.getFloat32(p, littleEndian);
      values = array;
    } else if (info.type === 'int32') {
      const array = new Int32Array(elementCount);
      for (let i = 0, p = dataStart; i < elementCount; i++, p += 4) array[i] = view.getInt32(p, littleEndian);
      values = array;
    } else {
      // P=5 text is exposed as raw bytes.
      values = bytes.slice(dataStart, dataEnd);
    }

    result.set(name, { name, rows, columns, class: info.class, type: info.type, values });
    totalElements += elementCount;
    offset = dataEnd;
  }

  if (offset !== input.byteLength) fail('trailing malformed bytes');
  return result;
}

/** Read a matrix entry using MATLAB's column-major indexing. */
export function matV4At(matrix: MatV4Matrix, row: number, column: number): number {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= matrix.rows || column < 0 || column >= matrix.columns) {
    throw new RangeError('MAT-v4 matrix index is out of bounds');
  }
  return matrix.values[column * matrix.rows + row];
}
