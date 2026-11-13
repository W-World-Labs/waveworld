import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 解析项目根目录（public/models、data/）
 * - 源码：agent/src → 上两级
 * - bun 编译二进制：优先 exe 旁、cwd、TUANLIU_ROOT
 */
export function resolveProjectRoot(): string {
  if (process.env.TUANLIU_ROOT) {
    return path.resolve(process.env.TUANLIU_ROOT);
  }

  const candidates: string[] = [];

  // 二进制：可执行文件所在目录
  try {
    candidates.push(path.dirname(process.execPath));
  } catch {
    /* ignore */
  }

  // 当前工作目录
  candidates.push(process.cwd());

  // 源码运行
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, '../..'));
  } catch {
    /* ignore */
  }

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'public', 'models'))) return c;
    if (fs.existsSync(path.join(c, 'package.json')) && fs.existsSync(path.join(c, 'src', 'lib', 'cfd'))) {
      return c;
    }
  }

  return process.cwd();
}

export function resolveDataDir(root = resolveProjectRoot()): string {
  const fromEnv = process.env.TUANLIU_DATA;
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(root, 'data');
}

export function resolveModelsDir(root = resolveProjectRoot()): string {
  return path.join(root, 'public', 'models');
}
