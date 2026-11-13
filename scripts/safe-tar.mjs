import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const BLOCK = 512;
const MAX_EXPANDED = 2 * 1024 * 1024 * 1024;

function textField(block, start, length) {
  const end = block.indexOf(0, start);
  return block.toString('utf8', start, end < 0 || end >= start + length ? start + length : end);
}

function octal(block, start, length) {
  const raw = block.toString('ascii', start, start + length).replace(/\0.*$/, '').trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error('tar contains a non-octal size or checksum field');
  return Number.parseInt(raw, 8);
}

export function inspectTarGz(bytes) {
  const data = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED });
  const entries = [];
  const seen = new Map();
  let offset = 0;
  while (offset + BLOCK <= data.length) {
    const header = data.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const expected = octal(header, 148, 8);
    let checksum = 0;
    for (let i = 0; i < BLOCK; i += 1) checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (checksum !== expected) throw new Error('tar header checksum mismatch');
    const name = textField(header, 0, 100);
    const prefix = textField(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(header[156] || 48);
    if (type !== '0' && type !== '5') throw new Error(`tar contains a link or special entry: ${fullName || '(unnamed)'}`);
    if (!fullName && type !== '5') throw new Error('tar contains an unnamed regular file');
    const size = octal(header, 124, 12);
    if (type === '5' && size !== 0) throw new Error(`tar directory has content: ${fullName}`);
    const nextOffset = offset + BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (nextOffset > data.length) throw new Error(`truncated tar entry: ${fullName}`);
    const normalized = path.posix.normalize(fullName.replace(/^\.\//, '').replace(/\/$/, ''));
    if (fullName.startsWith('/') || normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..') || normalized.includes('\\')) {
      throw new Error(`unsafe tar path: ${fullName}`);
    }
    if (seen.has(normalized)) throw new Error(`duplicate tar path: ${fullName}`);
    for (const parent of seen.keys()) {
      if (parent && (normalized.startsWith(`${parent}/`) && seen.get(parent) === 'file' || parent.startsWith(`${normalized}/`) && type === '0')) {
        throw new Error(`tar file/directory path collision: ${fullName}`);
      }
    }
    seen.set(normalized, type === '5' ? 'directory' : 'file');
    entries.push({ name: fullName, type: type === '5' ? 'directory' : 'file', size });
    offset = nextOffset;
  }
  if (!entries.length) throw new Error('tar archive has no entries');
  return entries;
}
