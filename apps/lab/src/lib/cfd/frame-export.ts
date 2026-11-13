'use client';

import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts';

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

let frameDir: FileSystemDirectoryHandle | null = null;

/** User-picked local directory for streaming computed frames to disk (File System Access API). */
export function getFrameExportDir(): FileSystemDirectoryHandle | null {
  return frameDir;
}

export function isFrameExportSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickFrameExportDir(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFrameExportSupported()) throw new Error('当前浏览器不支持本地目录写入，请使用 Chrome / Edge');
  frameDir = await window.showDirectoryPicker!({ mode: 'readwrite' });
  return frameDir;
}

export function clearFrameExportDir(): void {
  frameDir = null;
}

async function writeFile(dir: FileSystemDirectoryHandle, path: string[], name: string, data: ArrayBuffer | string): Promise<void> {
  let target = dir;
  for (const segment of path) target = await target.getDirectoryHandle(segment, { create: true });
  const handle = await target.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

/**
 * Streams each WVF/WVM frame to <dir>/<runName>/frames/ as it is produced, then writes
 * manifest.json, spec.json and result.json so the run can be replayed offline.
 * Write errors abort the export but never the solver — frames stay in memory.
 */
export function createFrameExportWriter(dir: FileSystemDirectoryHandle, runName: string, ext = 'wvf') {
  const frames: { file: string; step: number; bytes: number }[] = [];
  const queue: Promise<void>[] = [];
  let failed: unknown = null;
  const push = (frame: ArrayBuffer, step: number) => {
    const file = `frame-${String(frames.length).padStart(4, '0')}.${ext}`;
    frames.push({ file, step, bytes: frame.byteLength });
    queue.push(writeFile(dir, [runName, 'frames'], file, frame).catch((error) => { failed = error; }));
  };
  const finish = async (spec: JobSpecV1, result: JobResultV1) => {
    await Promise.allSettled(queue);
    if (failed) throw failed instanceof Error ? failed : new Error(String(failed));
    const manifest = {
      format: 'waveworld-flow-frames-v1',
      frameFormat: ext,
      createdAt: new Date().toISOString(),
      spec, result,
      frames,
    };
    await writeFile(dir, [runName], 'manifest.json', JSON.stringify(manifest, null, 2));
    await writeFile(dir, [runName], 'spec.json', JSON.stringify(spec, null, 2));
    await writeFile(dir, [runName], 'result.json', JSON.stringify(result, null, 2));
  };
  return { push, finish, count: () => frames.length };
}
