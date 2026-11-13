'use client';

import { useMemo, useRef, useState } from 'react';
import { Download, FileUp, FolderOpen, AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { inpFilesToJobSpec, type FemDiagnostic, type FemCaseMapping } from '@w-sim/fem-import';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type ProjectFile = { path: string; text: string; bytes: number };

function relativePath(file: File, stripFolderRoot = false): string {
  const raw = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
  const parts = raw.split('/').filter((part) => part && part !== '.');
  if (stripFolderRoot && file.webkitRelativePath && parts.length > 1) parts.shift();
  if (parts.some((part) => part === '..')) throw new Error('文件路径包含不安全的上级目录');
  return parts.join('/');
}

function diagnosticSource(path: string): string {
  const match = path.match(/^(.*?)(?: line (\d+))$/i);
  return match ? `${match[1]}:${match[2]}` : path;
}

function Diagnostic({ item }: { item: FemDiagnostic }) {
  const Icon = item.level === 'unsupported' ? AlertCircle : item.level === 'approximation' ? AlertTriangle : Info;
  const tone = item.level === 'unsupported' ? 'text-red-300' : item.level === 'approximation' ? 'text-amber-300' : 'text-zinc-400';
  return <li className="flex gap-2 text-sm"><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} /><span className="min-w-0 break-words"><code className="mr-2 text-xs text-zinc-500">{diagnosticSource(item.path)}</code><span className={tone}>{item.message}</span></span></li>;
}

function parameterRecord(mapping: FemCaseMapping | null): Record<string, unknown> {
  if (!mapping?.ok || !mapping.spec || typeof mapping.spec.parameters !== 'object' || mapping.spec.parameters === null) return {};
  return mapping.spec.parameters as Record<string, unknown>;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function FemImportPanel() {
  const folderInput = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [entryPath, setEntryPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mapping = useMemo<FemCaseMapping | null>(() => {
    if (!entryPath || files.length === 0) return null;
    const fileMap = Object.fromEntries(files.map((file) => [file.path, file.text]));
    return inpFilesToJobSpec(entryPath, fileMap);
  }, [entryPath, files]);

  const acceptFiles = async (incoming: File[], mode: 'folder' | 'append' | 'entry') => {
    setError(null);
    if (incoming.length === 0) return;
    try {
      const fresh = await Promise.all(incoming.map(async (file) => ({
        path: relativePath(file, mode === 'folder'),
        text: await file.text(),
        bytes: file.size,
      })));
      const next = mode === 'folder' ? fresh : [...files.filter((old) => !fresh.some((item) => item.path === old.path)), ...fresh];
      const duplicatePaths = next.some((file, index) => next.findIndex((other) => other.path === file.path) !== index);
      if (duplicatePaths) throw new Error('工程中存在重复相对路径，无法确定 include 文件');
      setFiles(next);
      if (mode === 'entry') setEntryPath(fresh[0]!.path);
      else if (mode === 'folder' && !fresh.some((file) => file.path === entryPath)) {
        setEntryPath(fresh.find((file) => /\.inp$/i.test(file.path))?.path ?? '');
      }
      if (next.length > 256 || next.reduce((sum, file) => sum + file.bytes, 0) > 20 * 1024 * 1024) {
        setFiles([]);
        setEntryPath('');
        throw new Error('工程文件总量超出浏览器导入上限（256 个文件或 20 MiB）');
      }
    } catch (cause) {
      setFiles([]);
      setEntryPath('');
      setError(cause instanceof Error ? cause.message : '读取工程文件失败');
    }
  };

  const selectEntry = async (file: File | undefined) => {
    if (!file) return;
    await acceptFiles([file], 'entry');
  };

  const exportSpec = () => {
    if (!mapping?.ok || !mapping.spec) return;
    const blob = new Blob([`${JSON.stringify(mapping.spec, null, 2)}\n`], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${entryPath.split('/').pop()?.replace(/\.inp$/i, '') || 'fem-import'}.jobspec.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const candidates = files.filter((file) => /\.inp$/i.test(file.path));
  const parameters = parameterRecord(mapping);
  const nodes = arrayLength(parameters.nodes);
  const elements = arrayLength(parameters.elements);
  const materials = parameters.youngsModulusPa ? 1 : 0;

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 bg-zinc-950 px-4 py-8 text-zinc-100 sm:px-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-widest text-cyan-300">Abaqus / CalculiX · W-Sim FEM</p>
        <h1 className="text-2xl font-semibold">结构工程导入</h1>
        <p className="max-w-3xl text-sm leading-6 text-zinc-400">读取 `.inp` 主 deck 与相对路径 `*INCLUDE` 文件，在本机生成 W-Sim 结构 JobSpec。除原有平铺 deck 外，也支持一个命名 `*PART` 在 `*ASSEMBLY` 中恰好实例化一次；可省略实例位置，或提供一行三数平移，节点与单元标签保持不变。实例上的数值成员 `*NSET` / `*ELSET` 可导入。多零件、多实例、嵌套装配、实例网格或截面覆盖、旋转及其他变换记录不支持；集合范围冲突、标签冲突或无法识别的实例限定会诊断并阻止导出。原有严格卡片子集仍适用：仅映射单个线性静力步中的常量元素面压力，C3D4 `*DLOAD P1–P4`、C3D8 `P1–P6`，可按 ELSET 或单元编号指定，正压力指向实体内部。C3D4 三角面精确积分；C3D8 四边形面仅支持平面平行四边形，C3D8 刚度仍为四面体拆分近似。翘曲面、模态/非线性步骤和表面压力会诊断并阻止导出。此导入器不会运行 Abaqus。</p>
      </header>

      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader>
          <CardTitle className="text-base">选择工程文件</CardTitle>
          <CardDescription className="text-zinc-400">选择整个工程文件夹可保留嵌套 INCLUDE 路径；也可先选主 `.inp`，再追加 include 文件。多选文件仅保留浏览器提供的相对路径。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input ref={(element) => { folderInput.current = element; element?.setAttribute('webkitdirectory', ''); }} type="file" multiple className="hidden" aria-label="选择工程文件夹" onChange={(event) => { void acceptFiles(Array.from(event.currentTarget.files ?? []), 'folder'); event.currentTarget.value = ''; }} />
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" onClick={() => folderInput.current?.click()}><FolderOpen className="mr-2 h-4 w-4" />选择工程文件夹</Button>
            <label className="inline-flex cursor-pointer items-center rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800">
              <FileUp className="mr-2 h-4 w-4" />选择主 .inp 文件
              <input className="sr-only" type="file" accept=".inp,text/plain" aria-label="选择主 .inp 文件" onChange={(event) => { void selectEntry(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
            </label>
            <label className="inline-flex cursor-pointer items-center rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800">
              <FileUp className="mr-2 h-4 w-4" />追加多个 include 文件
              <input className="sr-only" type="file" multiple aria-label="追加多个 include 文件" onChange={(event) => { void acceptFiles(Array.from(event.currentTarget.files ?? []), 'append'); event.currentTarget.value = ''; }} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <label className="space-y-1 text-xs text-zinc-400">主 .inp 文件
              <select className="block w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" aria-label="主 .inp 文件" value={entryPath} onChange={(event) => setEntryPath(event.currentTarget.value)}>
                <option value="">选择入口文件…</option>
                {candidates.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
              </select>
            </label>
            <div className="space-y-1 text-xs text-zinc-400">
              <span>已读取文件（相对路径）</span>
              <ul aria-label="工程文件清单" className="max-h-32 space-y-1 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-xs text-zinc-300">
                {files.length === 0 ? <li className="text-zinc-600">尚未选择文件</li> : files.map((file) => <li key={file.path} className="break-all">{file.path}</li>)}
              </ul>
            </div>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-400">
            <p className="font-medium text-zinc-300">示例工程文件</p>
            <p className="mt-1">多文件示例 ZIP 解压后选择整个文件夹以保留 include 相对路径；单文件面压力示例可直接选择 `.inp`。这些示例用于导入和 JobSpec 映射，不是求解结果。</p>
            <div className="mt-2 flex flex-wrap gap-4">
              <a className="text-cyan-300 underline" href="/datasets/fem-import/fem-include-example.zip" target="_top" rel="noreferrer" download>下载多文件示例 ZIP</a>
              <a className="text-cyan-300 underline" href="/datasets/fem-import/assembly-tetra-example.inp" target="_top" rel="noreferrer" download>下载单实例装配 `.inp`</a>
              <a className="text-cyan-300 underline" href="/datasets/fem-import/assembly-tetra-example.json" target="_top" rel="noreferrer" download>装配示例元数据</a>
              <a className="text-cyan-300 underline" href="/datasets/fem-import/pressure-c3d8.inp" target="_top" rel="noreferrer" download>下载 C3D8 面压力 `.inp`</a>
              <a className="text-cyan-300 underline" href="/datasets/fem-import/README.md" target="_top" rel="noreferrer">示例说明</a>
            </div>
            <p className="mt-2 font-mono text-[10px] text-zinc-500">多文件示例：main.inp → mesh/mesh.inc → ../nodes.inc · 压力示例：C3D8 `*DLOAD P1`</p>
          </div>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        </CardContent>
      </Card>

      {mapping && <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader>
          <CardTitle className="text-base">解析结果{mapping.ok ? ' · 可导出' : ' · 需要修正'}</CardTitle>
          <CardDescription className="text-zinc-400">入口：<code>{entryPath}</code> · {files.length} 个文件</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mapping.ok && mapping.spec && <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Summary label="分析类型" value={mapping.spec.kind} />
            <Summary label="节点" value={String(nodes)} />
            <Summary label="四面体单元" value={String(elements)} />
            <Summary label="材料" value={`${materials}（单各向同性材料映射）`} />
          </div>}
          {mapping.diagnostics.length > 0 && <section aria-label="解析诊断" className="space-y-2 border-t border-zinc-800 pt-4">
            <h2 className="text-sm font-medium">来源诊断</h2>
            <ul className="space-y-2">{mapping.diagnostics.map((item, index) => <Diagnostic key={`${item.path}:${item.message}:${index}`} item={item} />)}</ul>
          </section>}
          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-4">
            <Button type="button" disabled={!mapping.ok} onClick={exportSpec}><Download className="mr-2 h-4 w-4" />导出 JobSpec JSON</Button>
            <p className="text-xs text-zinc-500">此导入页不提交任务；导出的 JobSpec 可供现有 W-Sim jobs 工作流使用。</p>
          </div>
          {!mapping.ok && <p role="status" className="flex items-center gap-2 text-sm text-amber-300"><AlertCircle className="h-4 w-4" />存在不支持项，已禁用导出。</p>}
        </CardContent>
      </Card>}
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 font-medium text-zinc-200">{value}</p></div>;
}
