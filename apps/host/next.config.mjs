import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hostSrc = path.resolve(__dirname, 'src');
const waveworldSrc = path.resolve(__dirname, '../../src');
const hostNodeModules = path.resolve(__dirname, 'node_modules');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Production asset prefix avoids Cloudflare long-cache of a prior SPA
  // fallback HTML that was incorrectly served for bare /_next/* paths.
  // Caddy must reverse_proxy /ww-next/* → host (strip prefix) + keep /_next/*.
  assetPrefix: process.env.NODE_ENV === 'production' ? '/ww-next' : undefined,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
  experimental: {
    externalDir: true,
  },
  serverExternalPackages: ['better-sqlite3'],
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  turbopack: {
    resolveAlias: {
      '@': hostSrc,
    },
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': hostSrc,
      // Allow ontology catalog to import WaveWorld methods source
      '@ww': waveworldSrc,
    };
    config.resolve.modules = [hostNodeModules, 'node_modules'];

    if (isServer) {
      // Native addon must not be bundled
      const prev = config.externals;
      config.externals = [
        ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
        'better-sqlite3',
      ];
    }
    return config;
  },
};

export default nextConfig;
