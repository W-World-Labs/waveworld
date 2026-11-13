/**
 * 加载 Dawn WebGPU 原生绑定（Node / 二进制旁 .node）。
 * 使用 createRequire + process.dlopen 兼容路径，避免 bun 对 N-API ESM 的限制。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type DawnExports = {
  create: (args: unknown[]) => GPU;
  globals: Record<string, unknown>;
};

function nativeFileName(): string {
  if (process.platform === 'darwin') return 'darwin-universal.dawn.node';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64.dawn.node';
  if (process.platform === 'linux') return 'linux-x64.dawn.node';
  if (process.platform === 'win32') return 'win32-x64.dawn.node';
  throw new Error(`unsupported platform for Dawn: ${process.platform}/${process.arch}`);
}

function candidatePaths(): string[] {
  const name = nativeFileName();
  const list: string[] = [];

  // 1) 环境变量
  if (process.env.DAWN_NODE_PATH) list.push(process.env.DAWN_NODE_PATH);

  // 2) 二进制旁（Node SEA / 安装目录）
  try {
    const exeDir = path.dirname(process.execPath);
    list.push(path.join(exeDir, name));
    list.push(path.join(exeDir, 'native', name));
    list.push(path.join(exeDir, 'dist', name));
  } catch {
    /* ignore */
  }

  // 3) 开发：agent/node_modules/webgpu
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    list.push(path.join(here, '../../node_modules/webgpu/dist', name));
    list.push(path.join(here, '../../../agent/node_modules/webgpu/dist', name));
    list.push(path.join(here, '../../../validation/node_modules/webgpu/dist', name));
  } catch {
    /* ignore */
  }

  // 4) cwd
  list.push(path.join(process.cwd(), 'agent/node_modules/webgpu/dist', name));
  list.push(path.join(process.cwd(), 'bin/native', name));
  list.push(path.join(process.cwd(), 'bin', name));

  // 5) 打包后 __dirname（cjs bundle）
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
    list.push(path.join(dirname, 'native', name));
    list.push(path.join(dirname, name));
  } catch {
    /* ignore */
  }

  return list;
}

let cached: DawnExports | null = null;

export function loadDawn(): DawnExports {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  const tried: string[] = [];

  for (const p of candidatePaths()) {
    if (!p || !fs.existsSync(p)) continue;
    tried.push(p);
    try {
      const mod = require(p) as DawnExports;
      if (typeof mod.create === 'function') {
        cached = mod;
        if (process.env.DEBUG_DAWN) console.log('[dawn] loaded', p);
        return mod;
      }
    } catch (err) {
      tried.push(`${p} (${err instanceof Error ? err.message : err})`);
    }
  }

  // 标准包入口
  try {
    const mod = require('webgpu') as DawnExports;
    cached = mod;
    return mod;
  } catch {
    /* fallthrough */
  }

  throw new Error(
    `Failed to load Dawn (.node). Tried:\n  ${tried.join('\n  ') || '(none found)'}\n` +
      `Set DAWN_NODE_PATH or place ${nativeFileName()} next to the binary (bin/native/).`
  );
}
