'use client';

import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Car, Wind, Box, Loader2 } from 'lucide-react';
import { PRESET_MODELS, loadPresetModel } from '@/lib/models/preset-models';
import {
  loadModelsManifest,
  manifestHasFile,
  type ModelsManifest,
} from '@/lib/models/models-manifest';
import { createWindTunnelModel, useProjectStore } from '@/lib/stores/project-store';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import type { PresetModel } from '@/types/model';

const CATEGORY_ICONS = {
  airfoil: Wind,
  vehicle: Car,
  building: Box,
  custom: Box,
};

const CATEGORY_LABELS: Record<PresetModel['category'], string> = {
  airfoil: '翼型',
  vehicle: '交通工具',
  building: '建筑',
  custom: '自定义',
};

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { name?: string }).name === 'AbortError';
}

const PRESET_IDS = new Set(PRESET_MODELS.map((preset) => preset.id));

export function PresetModelSelector() {
  const { addUploadedModel, setActiveModel, activeModel, removeUploadedModel } = useProjectStore();
  const { updateParameters, setVisualizationMode, stopSimulation, resetSimulation, setGPUContext } =
    useSimulationStore();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ presetId: string; kind: 'warning' | 'error'; text: string } | null>(null);
  const [manifest, setManifest] = useState<ModelsManifest | null>(null);

  // Cancel superseded loads when the user switches presets mid-fetch.
  const abortRef = useRef<AbortController | null>(null);
  const loadGenRef = useRef(0);

  useEffect(() => {
    // Single tiny GET of the build-time manifest — never 21 concurrent HEAD probes.
    const ac = new AbortController();
    void loadModelsManifest(ac.signal).then((m) => {
      if (!ac.signal.aborted) setManifest(m);
    });
    return () => {
      ac.abort();
      abortRef.current?.abort();
    };
  }, []);

  const handleSelectPreset = async (preset: PresetModel) => {
    // Abort any in-flight load so only the latest selection applies.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const gen = ++loadGenRef.current;

    try {
      setLoading(preset.id);
      setNotice(null);

      // 换模型前停止并重置仿真，避免旧 RAF/求解器与新几何交错导致整页崩溃
      stopSimulation();
      resetSimulation();
      setGPUContext({ errorMessage: null });

      // 加载预设模型：public/models/ 下有文件优先用真实模型，否则程序化生成
      const { metadata, geometry, fromFile, warning } = await loadPresetModel(preset, {
        signal: ac.signal,
      });

      // A newer click superseded this load — do not touch store/UI.
      if (gen !== loadGenRef.current || ac.signal.aborted) return;

      // 添加到已上传模型列表（store 按 id 替换 + LRU 内存预算）。
      // 预设是「换模型」语义：移除上一个预设来源的缓存条目，避免已加载列表无限累积；
      // 用户自己上传的文件保留。
      const uploadedModel = {
        metadata,
        geometry,
      };

      const project = useProjectStore.getState();
      for (const model of project.uploadedModels) {
        if (PRESET_IDS.has(model.metadata.id) && model.metadata.id !== preset.id) {
          project.removeUploadedModel(model.metadata.id);
        }
      }
      addUploadedModel(uploadedModel);

      // 应用预设默认参数（攻角/散热模式/入口速度等，真实生效）
      const { referenceArea: _area, referenceLength: _length, ...dp } = preset.defaultParameters;
      updateParameters({
        ...dp,
        angleOfAttack: dp.angleOfAttack ?? 0,
        thermalEnabled: dp.thermalEnabled ?? false,
        thermalMode: dp.thermalMode ?? 'fixed-temperature',
        inletVelocity: dp.inletVelocity ?? 10,
        modelResolution: dp.modelResolution ?? 'standard',
        durationSeconds: 10,
        fan: dp.fan ?? null,
        flowMethod: 'lbm', macFans: [],
        ground: dp.ground,
        thermalRegions: dp.thermalRegions ?? [],
        thermalContacts: dp.thermalContacts ?? [],
      });
      // 散热预设切到温度视图；运行后显示实际结果。
      setVisualizationMode(dp.thermalEnabled ? 'temperature' : 'velocity');

      // 设置为活动模型
      setActiveModel(createWindTunnelModel(metadata));

      if (!fromFile && warning) {
        setNotice({
          presetId: preset.id,
          kind: 'warning',
          text: `模型文件加载失败，已使用可运行的简化模型：${warning}`,
        });
      }

      setLoading(null);
    } catch (error) {
      // Superseded load — silent
      if (isAbortError(error) || gen !== loadGenRef.current) {
        if (gen === loadGenRef.current) setLoading(null);
        return;
      }
      console.error('加载预设模型失败:', error);
      setNotice({
        presetId: preset.id,
        kind: 'error',
        text: error instanceof Error ? error.message : String(error),
      });
      setLoading(null);
    }
  };

  // 设备散热预设（机箱/笔记本/手机等分区功耗模型）只属于散热解算页，不在风洞列表里混排
  const presets = PRESET_MODELS.filter((preset) =>
    !preset.defaultParameters.thermalEnabled &&
    `${preset.name} ${preset.id} ${preset.description}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-white mb-2">预设演示模型</h3>
        <p className="text-xs text-zinc-400">
          选择模型后可调整来流和计算参数，也可以切换到“上传模型”使用自己的文件。
        </p>
      </div>

      <label className="block text-sm text-zinc-300">
        查找模型
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="汽车、机箱、翼型…"
          className="mt-2 min-h-11 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 text-base text-white placeholder:text-zinc-400" />
      </label>
      <div className="grid gap-2">
        {presets.map((preset, index) => {
          const inManifest = manifestHasFile(manifest, preset.modelUrl);
          // Prefer build-time manifest; fall back to catalog modelUrl presence.
          const hasRealFile = manifest ? inManifest : !!preset.modelUrl;
          const showCategory = index === 0 || presets[index - 1].category !== preset.category;
          return (
            <div key={preset.id} className="contents">
              {showCategory && (
                <h4 className="mt-2 text-xs font-medium text-zinc-500 first:mt-0">{CATEGORY_LABELS[preset.category]}</h4>
              )}
              <PresetModelCard
                preset={preset}
                onSelect={() => handleSelectPreset(preset)}
                isLoading={loading === preset.id}
                isSelected={activeModel?.id === preset.id}
                hasRealFile={hasRealFile}
                notice={notice?.presetId === preset.id ? notice : null}
              />
            </div>
          );
        })}
        {presets.length === 0 && <p className="p-3 text-sm text-zinc-400">没有匹配的模型，请尝试其他关键词。</p>}
      </div>
      <p className="text-xs text-zinc-500">
        机箱、笔记本、手机等设备散热模型在<a href="/cooling" target="_top" className="text-cyan-400 hover:underline">散热解算</a>页。
      </p>
    </div>
  );
}

function PresetModelCard({
  preset,
  onSelect,
  isLoading,
  isSelected,
  hasRealFile,
  notice,
}: {
  preset: PresetModel;
  onSelect: () => void;
  isLoading: boolean;
  isSelected: boolean;
  hasRealFile: boolean;
  notice: { kind: 'warning' | 'error'; text: string } | null;
}) {
  const Icon = CATEGORY_ICONS[preset.category] || Box;
  const dp = preset.defaultParameters;
  const specs = [
    dp?.angleOfAttack !== undefined && dp.angleOfAttack !== 0 ? `攻角 ${dp.angleOfAttack}°` : null,
    dp?.referenceArea !== undefined ? `${dp.referenceArea} m²` : null,
    dp?.referenceLength !== undefined ? `长 ${dp.referenceLength} m` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Card aria-current={isSelected ? 'true' : undefined} className="bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-colors aria-current:border-cyan-400/60">
      <button
        type="button"
        onClick={onSelect}
        disabled={isLoading}
        aria-busy={isLoading}
        className="w-full text-left rounded-lg focus-visible:outline-2 focus-visible:outline-cyan-400"
      >
        <div className="flex items-center gap-3 p-3">
          <Icon className="w-5 h-5 shrink-0 text-cyan-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm text-white">{preset.name}</span>
              {isSelected && <span className="shrink-0 text-xs text-cyan-300">当前模型</span>}
            </div>
            <p className="truncate text-xs text-zinc-400">{preset.description}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {hasRealFile ? '模型文件' : '程序化'}{specs && ` · ${specs}`}
            </p>
          </div>
          {isLoading
            ? <Loader2 className="w-4 h-4 shrink-0 animate-spin text-cyan-400" aria-label="加载中" />
            : <span className="shrink-0 text-xs text-zinc-500">加载</span>}
        </div>
      </button>
      {notice && (
        <div
          role="alert"
          className={`mx-3 mb-3 rounded-md border px-2 py-1.5 text-xs space-y-2 ${
            notice.kind === 'error'
              ? 'border-red-800 bg-red-950/40 text-red-300'
              : 'border-amber-800 bg-amber-950/40 text-amber-300'
          }`}
        >
          <p>{notice.text}</p>
          {notice.kind === 'error' && (
            <Button
              size="sm"
              variant="outline"
              disabled={isLoading}
              onClick={onSelect}
              className="h-7 border-red-800 bg-red-950/60 text-red-200 hover:bg-red-900/50"
              data-preset-retry={preset.id}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  重试中
                </>
              ) : (
                '重试加载'
              )}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
