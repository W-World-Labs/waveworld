/**
 * SHA-256 helpers for knowledge digests.
 * Uses Web Crypto (available in Node 18+ and modern browsers).
 */

const HEX = '0123456789abcdef'

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    out += HEX[b >> 4]! + HEX[b & 0xf]!
  }
  return out
}

function getSubtle(): SubtleCrypto {
  const c = globalThis.crypto
  if (!c?.subtle) {
    throw new Error('crypto.subtle is required for knowledge SHA-256 digests')
  }
  return c.subtle
}

/** SHA-256 hex digest of UTF-8 string or raw bytes. */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so the BufferSource type is exact (TS 5.x DOM lib).
  const src = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const copy = new Uint8Array(src.byteLength)
  copy.set(src)
  const digest = await getSubtle().digest('SHA-256', copy)
  return bytesToHex(new Uint8Array(digest))
}
