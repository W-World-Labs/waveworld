import type { NextConfig } from "next";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Public path under waveworld edge (Caddy → this Next process).
 * Production: TUANLIU_BASE_PATH=/app/lab so assets and routes live under
 * https://waveworld.example.invalid/app/lab/...
 * Local dev: leave unset (serves at /).
 */
const basePath = (
  process.env.WAVEWORLD_LAB_BASE_PATH ||
  process.env.TUANLIU_BASE_PATH ||
  process.env.BASE_PATH ||
  ""
).replace(/\/$/, "");

// Local browser calls must stay on the Lab origin, because Lab still has its
// legacy /api routes and Host owns the canonical authenticated jobs plane.
// Production ingress sends /api to Host directly, so this private rewrite is
// only the local development seam.
const configuredHost = (process.env.WAVEWORLD_HOST_URL || process.env.TASK_API_URL || "").replace(/\/$/, "");
const localHostProxyTarget = process.env.NODE_ENV === "production"
  ? ""
  : configuredHost || "http://127.0.0.1:3001";

/** apps/lab root — Next loads next.config.ts in a CJS-compatible context. */
const labRoot = __dirname;

/**
 * Resolve pinned, locally vendored @w-sim packages through this app's npm
 * dependency tree for Turbopack + webpack.
 */
function resolveWSimPackage(
  name: "contracts" | "fem-import" | "kit" | "runtime" | "solvers-lbm",
): string {
  const require = createRequire(path.join(labRoot, "package.json"));
  // W-Sim intentionally does not export package.json. Resolve its public
  // built entry and walk back to the package root.
  let cursor = path.dirname(require.resolve(`@w-sim/${name}`));
  while (cursor !== path.dirname(cursor)) {
    if (path.basename(cursor) === name) return cursor;
    cursor = path.dirname(cursor);
  }
  throw new Error(`Cannot find installed @w-sim/${name} package root`);
}

const solversLbmRoot = resolveWSimPackage("solvers-lbm");
const requireFromLab = createRequire(path.join(labRoot, "package.json"));
function resolveLbmEntry(name: "d3q19" | "mac3d") {
  try {
    return requireFromLab.resolve(`@w-sim/solvers-lbm/${name}`);
  } catch {
    return path.join(solversLbmRoot, `dist/${name}.js`);
  }
}
const wSimAliases: Record<string, string> = {
  "@w-sim/contracts": resolveWSimPackage("contracts"),
  "@w-sim/fem-import": resolveWSimPackage("fem-import"),
  "@w-sim/kit": resolveWSimPackage("kit"),
  "@w-sim/runtime": resolveWSimPackage("runtime"),
  "@w-sim/solvers-lbm/d3q19": resolveLbmEntry("d3q19"),
  "@w-sim/solvers-lbm/mac3d": resolveLbmEntry("mac3d"),
  "@w-sim/solvers-lbm": solversLbmRoot,
};

// Lab imports reach the WaveWorld repository root (src/lib/sim, apps/host,
// vendored W-Sim packages). Turbopack only resolves files inside `root`, so
// aliases are expressed relative to the WaveWorld repository root.
const repoParent = path.resolve(labRoot, "../..");
const rootRelative = (abs: string) => "./" + path.relative(repoParent, abs);
const turbopackAliases: Record<string, string> = Object.fromEntries(
  Object.entries({
    "@w-sim/contracts": wSimAliases["@w-sim/contracts"],
    "@w-sim/fem-import": wSimAliases["@w-sim/fem-import"],
    "@w-sim/kit": wSimAliases["@w-sim/kit"],
    "@w-sim/runtime": wSimAliases["@w-sim/runtime"],
    "@w-sim/solvers-lbm/d3q19": wSimAliases["@w-sim/solvers-lbm/d3q19"],
    "@w-sim/solvers-lbm/mac3d": wSimAliases["@w-sim/solvers-lbm/mac3d"],
    "@w-sim/solvers-lbm": wSimAliases["@w-sim/solvers-lbm"],
  }).map(([k, v]) => [k, rootRelative(v)]),
);

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(labRoot, '../..'),
  // Prod ship: agent/ + strict model optional fields still open TS debt
  typescript: { ignoreBuildErrors: false },
  // Local W-Sim tarballs are public package dependencies and must be transpiled.
  transpilePackages: [
    "@w-sim/contracts",
    "@w-sim/fem-import",
    "@w-sim/kit",
    "@w-sim/runtime",
    "@w-sim/solvers-lbm",
  ],
  turbopack: {
    root: repoParent,
    resolveAlias: turbopackAliases,
  },
  async rewrites() {
    return localHostProxyTarget
      ? [{ source: "/host-api/:path*", destination: `${localHostProxyTarget}/:path*` }]
      : [];
  },
  // Webpack production build (--webpack) needs aliases to the installed local
  // packages and their generated solver subpaths.
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string | false | string[]>),
      ...wSimAliases,
    };
    // serverExternalPackages does not externalize better-sqlite3 when the
    // importer is a monorepo sibling file (apps/host/src/lib/tasks/*) — the
    // bundled bindings loader then resolves .next/* and the deployed task
    // API 500s. Emit a real require for every issuer so node resolves
    // apps/lab/node_modules at runtime.
    if (isServer) {
      config.externals = [...(config.externals ?? []), 'better-sqlite3'];
    }
    return config;
  },
  // Expose basePath to client so /models/* fetches resolve under /app/lab
  env: {
    NEXT_PUBLIC_TUANLIU_BASE_PATH: basePath,
  },
  ...(basePath
    ? {
        basePath,
        assetPrefix: basePath,
      }
    : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
  reactCompiler: true, // 启用 React Compiler（opt-in）
  // better-sqlite3 为原生模块，仅服务端 API 使用
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@react-three/fiber",
      "@react-three/drei",
    ],
  },
};

export default nextConfig;
