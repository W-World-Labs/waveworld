'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type FdsCaseSetupProps = {
  maxSizeBytes: number;
  onSelect: (file: File | null) => void;
  disabled?: boolean;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/** Select one bounded FDS deck; parsing and job execution belong to the workflow. */
export function FdsCaseSetup({ maxSizeBytes, onSelect, disabled = false }: FdsCaseSetupProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectFile = (file: File | null) => {
    setError(null);
    if (file && !/\.fds$/i.test(file.name)) {
      setSelected(null);
      onSelect(null);
      setError('请选择扩展名为 .fds 的 FDS deck 文件。');
      return;
    }
    if (file && file.size > maxSizeBytes) {
      setSelected(null);
      onSelect(null);
      setError(`文件大小 ${formatFileSize(file.size)} 超出上限 ${formatFileSize(maxSizeBytes)}。`);
      return;
    }
    setSelected(file);
    onSelect(file);
  };

  return (
    <Card className="border-zinc-800 bg-zinc-950 text-zinc-100" aria-label="FDS deck 文件选择">
      <CardHeader>
        <CardTitle>选择 FDS deck</CardTitle>
        <CardDescription className="text-zinc-400">
          选择单个 `.fds` 文本文件；最大 {formatFileSize(maxSizeBytes)}。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept=".fds,text/plain"
          className="hidden"
          aria-label="选择 FDS deck 文件"
          disabled={disabled}
          onChange={(event) => {
            selectFile(event.currentTarget.files?.[0] ?? null);
            event.currentTarget.value = '';
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={disabled} onClick={() => inputRef.current?.click()}>
            选择文件
          </Button>
          {selected ? (
            <p className="min-w-0 break-all text-sm text-zinc-300">
              {selected.name} <span className="text-zinc-500">· {formatFileSize(selected.size)}</span>
            </p>
          ) : (
            <p className="text-sm text-zinc-500">尚未选择文件</p>
          )}
        </div>
        {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
        <p className="text-xs text-zinc-500">
          上传内容将交由 native FDS namelist parser 检查；此工作流不会运行 FDS solver。
        </p>
      </CardContent>
    </Card>
  );
}
