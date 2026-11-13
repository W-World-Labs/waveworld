'use client';

import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FolderOpen, FileText, Check, X, AlertTriangle, AlertCircle, Info, Copy, Loader2 } from 'lucide-react';
import {
  readFoamCaseFiles,
  parseFoamCase,
  classifyFoamCase,
  buildOpenFoamJobSpec,
  type ParsedFoamCase,
  type FoamClassification,
  type FoamDiagnostic,
} from '@/lib/openfoam/parse-case';
import type { FluidJobSpecV1 } from '@w-sim/contracts';

const SUPPORT_BADGE: Record<FoamClassification['support'], { text: string; className: string }> = {
  solvable: { text: '可求解', className: 'bg-green-500/10 text-green-400 border-green-500/20' },
  approximate: { text: '近似', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  unsupported: { text: '不支持', className: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

function DiagnosticRow({ diagnostic }: { diagnostic: FoamDiagnostic }) {
  const Icon = diagnostic.level === 'unsupported' ? AlertCircle
    : diagnostic.level === 'approximation' ? AlertTriangle : Info;
  const color = diagnostic.level === 'unsupported' ? 'text-red-400'
    : diagnostic.level === 'approximation' ? 'text-amber-400' : 'text-zinc-400';
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${color}`} />
      <p className="min-w-0 break-all">
        <span className="text-zinc-500">{diagnostic.path}：</span>
        <span className={color}>{diagnostic.message}</span>
      </p>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-zinc-500">
      {label}: <span className="text-zinc-300">{value}</span>
    </div>
  );
}

export function OpenFoamImportPanel() {
  const dirInput = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [parsed, setParsed] = useState<ParsedFoamCase | null>(null);
  const [cls, setCls] = useState<FoamClassification | null>(null);
  const [spec, setSpec] = useState<FluidJobSpecV1 | null>(null);
  const [copied, setCopied] = useState(false);

  const onPick = useCallback(async (files: File[]) => {
    setError(null);
    setSpec(null);
    setCopied(false);
    if (files.length === 0) {
      setParsed(null);
      setCls(null);
      setFileCount(null);
      return;
    }
    setLoading(true);
    try {
      const source = await readFoamCaseFiles(files);
      const next = parseFoamCase(source);
      setParsed(next);
      setCls(classifyFoamCase(next));
      setFileCount(files.length);
      if (source.texts.size === 0) {
        setError('所选目录中没有可识别的 OpenFOAM 字典（需要 system/controlDict、constant/ 物性、0/U 等文本文件）');
      }
    } catch (err) {
      console.error('OpenFOAM case parse error:', err);
      setParsed(null);
      setCls(null);
      setError(err instanceof Error ? err.message : '算例解析失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const generateSpec = useCallback(() => {
    if (!parsed || !cls) return;
    setCopied(false);
    setSpec(buildOpenFoamJobSpec(parsed, cls));
  }, [parsed, cls]);

  const copySpec = useCallback(async () => {
    if (!spec) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(spec, null, 2));
      setCopied(true);
    } catch {
      setError('复制失败，请手动选择 JSON 文本复制');
    }
  }, [spec]);

  const bbox = parsed?.mesh?.bbox ?? null;
  const span = bbox ? bbox.max.map((v, i) => v - bbox.min[i]) : null;
  const badge = cls ? SUPPORT_BADGE[cls.support] : null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-white mb-2">OpenFOAM 算例导入</h3>
        <p className="text-xs text-zinc-500">
          选择算例目录（含 system/、constant/、0/），本地解析 controlDict、物性、0/U 边界与 blockMeshDict。
          不读取 polyMesh 与场数据；仅不可压缩单相求解器可生成批算任务。
        </p>
      </div>

      {/* 目录选择（webkitdirectory 非 React 类型属性，用 ref 设置） */}
      <input
        ref={(el) => {
          dirInput.current = el;
          el?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        multiple
        className="hidden"
        aria-label="选择 OpenFOAM 算例目录"
        onChange={(event) => {
          void onPick(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}
      />
      <Card
        className="bg-zinc-900/50 border-2 border-dashed border-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors"
        onClick={() => dirInput.current?.click()}
      >
        <CardContent className="flex flex-col items-center justify-center py-8">
          {loading ? (
            <Loader2 className="w-12 h-12 mb-4 text-cyan-400 animate-spin" />
          ) : (
            <FolderOpen className="w-12 h-12 mb-4 text-zinc-600" />
          )}
          <p className="text-sm text-zinc-300 mb-1">
            {loading ? '解析中…' : fileCount !== null ? `已读取 ${fileCount} 个文件` : '点击选择算例目录'}
          </p>
          <p className="text-xs text-zinc-500">如 cavity、pitzDaily 等教程算例</p>
        </CardContent>
      </Card>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <p className="min-w-0 break-all text-xs text-red-400">{error}</p>
        </div>
      )}

      {parsed && cls && (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded bg-zinc-800 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-sm text-white truncate">
                    {parsed.caseName ?? 'OpenFOAM 算例'}
                  </CardTitle>
                  <CardDescription className="text-xs text-zinc-500 mt-1">
                    {parsed.solver ?? '未知求解器'}
                  </CardDescription>
                </div>
              </div>
              {badge && (
                <Badge variant="outline" className={`${badge.className} text-xs flex-shrink-0`}>
                  {badge.text}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-3">
            {/* 识别文件 */}
            <div className="flex flex-wrap gap-2">
              {parsed.files.map((file) => (
                <Badge
                  key={file.key}
                  variant="outline"
                  className={`text-xs ${
                    file.path
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : file.required
                        ? 'bg-red-500/10 text-red-400 border-red-500/20'
                        : 'bg-zinc-800/60 text-zinc-500 border-zinc-700'
                  }`}
                >
                  {file.path ? <Check className="w-3 h-3 mr-1" /> : <X className="w-3 h-3 mr-1" />}
                  {file.label}
                </Badge>
              ))}
            </div>

            {/* 解析摘要 */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <SummaryItem label="求解器" value={parsed.solver ?? '未识别'} />
              <SummaryItem
                label="运动黏度 nu"
                value={parsed.nu !== null ? `${parsed.nu} m²/s` : '未找到'}
              />
              <SummaryItem label="入口速度" value={`${cls.inletVelocity} m/s`} />
              <SummaryItem
                label="湍流模型"
                value={
                  parsed.turbulenceModel
                    ? `${parsed.turbulenceModel}${parsed.turbulenceModelName ? ` / ${parsed.turbulenceModelName}` : ''}`
                    : '未声明（按层流）'
                }
              />
              <SummaryItem
                label="计算域"
                value={span ? `${span.map((v) => v.toPrecision(4)).join(' × ')} m` : '未知'}
              />
              <SummaryItem
                label="blockMesh"
                value={
                  parsed.mesh
                    ? `${parsed.mesh.blockCount} 块${parsed.mesh.cellCount ? ` · ${parsed.mesh.cellCount.join('×')} 格` : ''}`
                    : '未找到'
                }
              />
              <SummaryItem label="时长" value={parsed.endTime !== null ? `${parsed.endTime} s` : '未知'} />
              <SummaryItem label="映射步数" value={`${cls.maxSteps}`} />
            </div>

            {/* 诊断 */}
            {cls.diagnostics.length > 0 && (
              <div className="space-y-1.5 border-t border-zinc-800 pt-3">
                {cls.diagnostics.map((diagnostic, i) => (
                  <DiagnosticRow key={i} diagnostic={diagnostic} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {parsed && cls && cls.support !== 'unsupported' && (
        <Button type="button" className="w-full" onClick={generateSpec}>
          生成批算任务
        </Button>
      )}

      {spec && (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader className="p-3 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm text-white">JobSpecV1（lbm-d3q19）</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={copySpec}>
                <Copy className="w-3 h-3 mr-1" />
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <pre className="max-h-64 overflow-auto rounded bg-zinc-950 p-2 text-[11px] leading-relaxed text-zinc-300">
              {JSON.stringify(spec, null, 2)}
            </pre>
            <p className="text-xs text-amber-300">
              提交需要体素掩码服务：现有批算路径只接受已加载的 3D 模型几何（上传 STL/glTF 或预设），
              尚不能将 OpenFOAM 算例直接体素化。可复制此 spec 交由支持 openfoamCase 模型源的 agent
              或体素掩码服务执行。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
