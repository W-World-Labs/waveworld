import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { MAX_MODEL_FILE_BYTES } from '../../src/lib/models/parser.ts';

const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedAddresses.addSubnet(address, prefix, 'ipv4');
// IPv6 permits global unicast only. Exclude special-purpose ranges and
// transition mechanisms which could route an embedded IPv4 address internally.
const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
blockedAddresses.addSubnet('2001::', 23, 'ipv6');
blockedAddresses.addSubnet('2001:db8::', 32, 'ipv6');
blockedAddresses.addSubnet('2002::', 16, 'ipv6');
blockedAddresses.addSubnet('3fff::', 20, 'ipv6');

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, 'ipv4');
  return family === 6 && globalIpv6.check(address, 'ipv6') && !blockedAddresses.check(address, 'ipv6');
}

const publicAddressError = () => new Error('model URL must resolve only to a public network address');

// Validate inside the socket's lookup callback so the checked DNS result is
// the one actually used to connect. A separate preflight followed by fetch()
// would permit DNS rebinding between validation and connection.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true }, (error, addresses) => {
    if (error) { callback(error, ''); return; }
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      callback(publicAddressError(), '');
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

/** Download untrusted job model URLs without exposing the worker's network. */
export async function downloadModelUrl(rawUrl: string, callerSignal?: AbortSignal): Promise<ArrayBuffer> {
  const deadline = AbortSignal.timeout(30_000);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  let url = new URL(rawUrl);
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('model URL must use HTTP(S) without credentials');
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    // Numeric hosts bypass Node's lookup callback, including URL-normalized
    // alternate IPv4 spellings and IPv4-mapped IPv6 literals.
    if (isIP(hostname) && !isPublicAddress(hostname)) throw publicAddressError();
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).get(url, {
        agent: false,
        lookup: publicLookup,
        signal,
        headers: { 'Accept-Encoding': 'identity' },
      }, resolve);
      request.on('error', reject);
    });
    try {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        if (!response.headers.location) throw new Error('model redirect lacks a location');
        if (redirects >= 5) throw new Error('model URL exceeds the redirect limit');
        url = new URL(response.headers.location, url);
        continue;
      }
      if (status < 200 || status >= 300) throw new Error(`model download returned HTTP ${status}`);
      if (Number(response.headers['content-length']) > MAX_MODEL_FILE_BYTES) {
        throw new Error('model exceeds 50 MiB');
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        signal.throwIfAborted();
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.byteLength;
        if (size > MAX_MODEL_FILE_BYTES) throw new Error('model exceeds 50 MiB');
        chunks.push(bytes);
      }
      signal.throwIfAborted();
      const bytes = Buffer.concat(chunks, size);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      response.destroy();
    }
  }
}
