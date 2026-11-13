import { gunzipSync } from 'node:zlib';
import { isCompressedSequence, MAX_FLOW_SNAPSHOT_BYTES } from '../../../../lab/src/lib/cfd/flow-snapshot';

/**
 * Synchronous WVZ1 unwrap for the Node host: gzip envelope → raw WVS1/WVM
 * sequence bytes. maxOutputLength bounds decompression bombs; the declared
 * raw size in the header must match the inflated payload exactly.
 */
export function inflateSequenceArtifact(data: Buffer): Buffer {
  if (!isCompressedSequence(data)) return data;
  if (data.length < 8) throw new Error('invalid compressed sequence');
  const rawSize = data.readUInt32LE(4);
  if (rawSize < 8 || rawSize > MAX_FLOW_SNAPSHOT_BYTES) throw new Error('invalid compressed sequence size');
  const raw = gunzipSync(data.subarray(8), { maxOutputLength: rawSize });
  if (raw.byteLength !== rawSize) throw new Error('compressed sequence size mismatch');
  return raw;
}
