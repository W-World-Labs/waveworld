'use client';

import { useEffect, useRef, useState } from 'react';
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts';
import { createSettlementClient, RemoteJobCancelError, runRemoteJob } from '../../lib/w-sim/settlement-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getStoredUserToken, hostApiBase } from '../../../../../src/lib/hostApi';
import { createModuleJobSpec, readModuleJobInput, readModuleResult, type ModuleComputeInput } from '../../../../../src/lib/sim/module-compute';
import { FdsCaseSetup } from './fds-case-setup';

const MODULE_ID = 'sw-fds-namelist' as const;
const METHOD_PARSE = 'method-fds-namelist-parse' as const;
const MAX_INLINE_JSON_CHARS = 1 << 20;
const MAX_FDS_FILE_BYTES = 1 << 20;
const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdDqQ][+-]?\d+)?`;

type FdsGroup = { index: number; name: string; keys: Record<string, unknown>; keyCount: number };
type FdsNamelistResult = {
  module: typeof MODULE_ID;
  ok: true;
  familyId: 'method-fds-namelist';
  methodId: typeof METHOD_PARSE;
  backend: { id: 'w-sim-cuda-host'; kind: 'host-f64'; deviceName: 'w-sim-cuda-host' };
  result: { groups: FdsGroup[]; groupCount: number };
};

function withoutComments(text: string): string {
  return text.split(/\r?\n/).map((line) => {
    let quote: string | null = null;
    let result = '';
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quote) {
        result += char;
        if (char === quote) {
          if (line[i + 1] === quote) result += line[++i];
          else quote = null;
        }
      } else if (char === "'" || char === '"') {
        quote = char;
        result += char;
      } else if (char === '!') {
        break;
      } else {
        result += char;
      }
    }
    return result;
  }).join(' ');
}

function withoutQuotedValues(text: string): string {
  let quote: string | null = null;
  let output = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      output += /\s/.test(char) ? char : ' ';
      if (char === quote) {
        if (text[i + 1] === quote) output += text[++i];
        else quote = null;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      output += ' ';
    } else {
      output += char;
    }
  }
  return output;
}

/** The released pin drops blank comma slots, so reject them before submit. */
function hasOmittedListEntry(text: string): boolean {
  return /(?:=\s*,|,\s*,)/.test(withoutQuotedValues(withoutComments(text)));
}

/** Released pin predates whitespace-delimited numeric-vector parsing. */
function hasWhitespaceNumericVector(text: string): boolean {
  const assignment = new RegExp(String.raw`(?:^|[\s,])(?:[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^)]*\))?)\s*=\s*${NUMBER}\s+${NUMBER}(?:\s+${NUMBER})*(?=[\s,/]|$)`, 'm');
  return assignment.test(withoutComments(text));
}

function validateNativeResult(value: unknown): FdsNamelistResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('原生解析结果不是对象。');
  const result = value as Record<string, unknown>;
  if (result.module !== MODULE_ID || result.ok !== true || result.familyId !== 'method-fds-namelist' || result.methodId !== METHOD_PARSE) {
    throw new Error('原生响应的模块、解析方法或成功标记与本次提交不匹配。');
  }
  const backend = result.backend as Record<string, unknown> | undefined;
  if (!backend || backend.id !== 'w-sim-cuda-host' || backend.kind !== 'host-f64' || backend.deviceName !== 'w-sim-cuda-host') {
    throw new Error('原生响应没有报告预期的 host-f64 namelist parser 后端。');
  }
  const payload = result.result as Record<string, unknown> | undefined;
  if (!payload || !Array.isArray(payload.groups) || payload.groups.length === 0 || payload.groupCount !== payload.groups.length) {
    throw new Error('原生响应缺少有效的 namelist groups。');
  }
  const groups = payload.groups.map((entry, index): FdsGroup => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`第 ${index + 1} 个 group 不是对象。`);
    const group = entry as Record<string, unknown>;
    const keys = group.keys;
    if (group.index !== index || typeof group.name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(group.name) ||
      !keys || typeof keys !== 'object' || Array.isArray(keys) || group.keyCount !== Object.keys(keys).length) {
      throw new Error(`第 ${index + 1} 个 group 的序号、名称或 keys 结构无效。`);
    }
    return { index, name: group.name, keys: keys as Record<string, unknown>, keyCount: group.keyCount as number };
  });
  return result as unknown as FdsNamelistResult;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Upload one deck as bounded inline text and review the existing native parser result. */
export function FdsNamelistWorkflow() {
  const [file, setFile] = useState<File | null>(null);
  const [captured, setCaptured] = useState<{ parsed: FdsNamelistResult; source: { name: string; sizeBytes: number; lastModifiedMs: number }; jobId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelFailedJob, setCancelFailedJob] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const [client] = useState(() => createSettlementClient({
    baseUrl: hostApiBase(),
    fetchImpl: (url, init) => {
      const headers = new Headers(init?.headers);
      const token = getStoredUserToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    },
  }));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const selectFile = (next: File | null) => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setFile(next);
    setBusy(false);
    setCaptured(null);
    setError(null);
    setStatus('idle');
    setJobId(null);
  };

  const parseFile = async () => {
    if (!file || busy || cancelFailedJob) return;
    const selected = file;
    const generation = ++generationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () => mountedRef.current && generationRef.current === generation && controllerRef.current === controller;
    setBusy(true);
    setError(null);
    setCaptured(null);
    setStatus('reading');
    setJobId(null);
    try {
      const content = await selected.text();
      if (!content.trim()) throw new Error('FDS deck 不能为空。');
      if (!/[&][A-Za-z_]/.test(content)) throw new Error('文件中没有找到 FDS namelist group。');
      if (hasOmittedListEntry(content)) {
        throw new Error('此 deck 含有空缺的 namelist list 项（连续逗号）。已发布的 native parser pin 会丢弃这些位置，因此本页拒绝提交该输入。');
      }
      if (hasWhitespaceNumericVector(content)) {
        throw new Error('此 deck 含有空格分隔的数值向量（例如 XB/XYZ）。已发布的 native parser pin 尚不支持该语法，请先改用逗号分隔格式或等待 pin 更新。');
      }
      const input = {
        module: MODULE_ID,
        method: METHOD_PARSE,
        backend: 'host',
        content,
      } as ModuleComputeInput;
      if (JSON.stringify(input).length > MAX_INLINE_JSON_CHARS) {
        throw new Error('序列化后的 native job 输入超过 1 MiB 上限，请选择更小的 deck。');
      }
      const spec = createModuleJobSpec(input);
      const roundTrip = readModuleJobInput(spec);
      if (JSON.stringify(roundTrip) !== JSON.stringify(input)) throw new Error('FDS parser JobSpec 未能原样往返。');
      setStatus('authenticating');
      await client.requireUser(controller.signal);
      if (!isCurrent()) return;
      setStatus('submitting');
      let completedJobId = 'completed';
      const remote = await runRemoteJob(client, spec as JobSpecV1, {
        signal: controller.signal,
        onStatus: (id, next) => {
          if (!isCurrent()) return;
          completedJobId = id;
          setJobId(id);
          setStatus(next);
        },
      });
      if (!isCurrent()) return;
      const native = readModuleResult(remote as JobResultV1, input);
      const parsed = validateNativeResult(native);
      if (!isCurrent()) return;
      setCaptured({ parsed, source: { name: selected.name, sizeBytes: selected.size, lastModifiedMs: selected.lastModified }, jobId: completedJobId });
      setStatus('succeeded');
    } catch (cause) {
      if (!isCurrent()) return;
      if (cause instanceof RemoteJobCancelError) setCancelFailedJob(cause.jobId);
      else if (controller.signal.aborted) { setStatus('cancelled'); return; }
      setStatus('failed');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (mountedRef.current && generationRef.current === generation) setBusy(false);
      }
    }
  };

  const cancel = async () => {
    const controller = controllerRef.current;
    if (controller) {
      setStatus('canceling');
      controller.abort(new DOMException('FDS parser job cancelled', 'AbortError'));
      return;
    }
    if (!cancelFailedJob) return;
    setBusy(true);
    try {
      await client.cancel(cancelFailedJob);
      setCancelFailedJob(null);
      setError(null);
      setStatus('cancelled');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const exportResult = () => {
    if (!captured) return;
    downloadJson(`${captured.source.name.replace(/\.fds$/i, '') || 'fds'}-namelist.json`, {
      source: captured.source,
      jobId: captured.jobId,
      module: MODULE_ID,
      method: METHOD_PARSE,
      result: captured.parsed,
    });
  };

  return <main className="mx-auto min-h-dvh w-full max-w-5xl space-y-5 bg-zinc-950 px-4 py-8 text-zinc-100">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">FDS namelist 文件准备</h1>
      <p className="max-w-4xl text-sm leading-relaxed text-zinc-400">
        上传一个 `.fds` deck，经 WaveWorld 现有 native module job 提交到 pinned W-Sim namelist parser，再检查解析出来的 groups、keys 和 parser diagnostics。此流程只解析输入文件，不会运行 FDS、LES 或 combustion 求解。native JobSpec 的序列化输入上限为 1 MiB。
      </p>
    </header>

    <FdsCaseSetup maxSizeBytes={MAX_FDS_FILE_BYTES} onSelect={selectFile} disabled={busy || !!cancelFailedJob} />
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" onClick={() => { void parseFile(); }} disabled={!file || busy || !!cancelFailedJob}>
        {busy ? '正在解析…' : '上传并解析 namelist'}
      </Button>
      {(busy || cancelFailedJob) && <Button type="button" variant="outline" onClick={() => { void cancel(); }} disabled={status === 'canceling'}>取消任务</Button>}
      {jobId && <span className="text-xs text-zinc-500">Job {jobId}</span>}
      <span role="status" aria-live="polite" className="text-sm text-zinc-400">状态：{status}</span>
    </div>

    {error && <Card className="border-amber-700 bg-amber-950/30 text-zinc-100" role="alert">
      <CardHeader><CardTitle className="text-base">解析诊断</CardTitle><CardDescription className="text-amber-200">{error}</CardDescription></CardHeader>
    </Card>}

    {captured && <Card className="border-zinc-800 bg-zinc-950 text-zinc-100" aria-label="FDS namelist 解析结果">
      <CardHeader>
        <CardTitle>已验证的 parser 结果</CardTitle>
        <CardDescription className="text-zinc-400">
          {captured.source.name} · {captured.parsed.result.groupCount} groups · {captured.parsed.backend.deviceName} / host-f64
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {captured.parsed.result.groups.map((group) => <li key={`${group.index}:${group.name}`} className="rounded-lg border border-zinc-800 p-3">
            <p className="font-medium">{group.index + 1}. &amp;{group.name}</p>
            <p className="mt-1 text-xs text-zinc-400">{group.keyCount} parsed keys</p>
          </li>)}
        </ol>
        <details className="rounded-lg border border-zinc-800 p-3">
          <summary className="cursor-pointer text-sm">查看完整解析数据</summary>
          <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-300">{JSON.stringify(captured.parsed.result, null, 2)}</pre>
        </details>
        <Button type="button" variant="outline" onClick={exportResult}>导出已验证的 JSON 结果</Button>
      </CardContent>
    </Card>}

    <p className="text-xs leading-relaxed text-zinc-500">
      Parser 接受输入并不代表 FDS solver 的语义校验或物理验证。Released native pin 尚未包含本地 whitespace-vector parser 改进；遇到已识别的空格分隔 numeric vectors 时，本页会在提交前拒绝该 deck。
    </p>
  </main>;
}
