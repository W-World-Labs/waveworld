'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileBox, Trash2, Check, AlertCircle, Sparkles } from 'lucide-react';
import { createWindTunnelModel, useProjectStore } from '@/lib/stores/project-store';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { parseModelFile } from '@/lib/models/parser';
import { publicAssetUrl } from '@/lib/models/preset-models';
import { PresetModelSelector } from './preset-model-selector';
import type { UploadedModel } from '@/types/model';

export function ModelUploader() {
  const { uploadedModels, activeModel, setActiveModel, addUploadedModel, removeUploadedModel, isUploading, uploadProgress, setUploading } = useProjectStore();
  const [error, setError] = useState<string | null>(null);
  const uploadGeneration = useRef(0);
  useEffect(() => () => {
    uploadGeneration.current++;
    useProjectStore.getState().setUploading(false, 0);
  }, []);

  const selectModel = useCallback((model: UploadedModel) => {
    const simulation = useSimulationStore.getState();
    simulation.stopSimulation();
    simulation.resetSimulation();
    simulation.setGPUContext({ errorMessage: null });
    setActiveModel(createWindTunnelModel(model.metadata));
  }, [setActiveModel]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const generation = ++uploadGeneration.current;
    const projectId = useProjectStore.getState().currentProject?.id;
    const current = () => generation === uploadGeneration.current && projectId === useProjectStore.getState().currentProject?.id;
    setError(null);
    
    for (const file of acceptedFiles) {
      // 检查文件类型
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (!['stl', 'obj', 'gltf', 'glb'].includes(extension || '')) {
        setError(`不支持的文件格式: ${extension}`);
        continue;
      }

      // 检查文件大小（限制 50MB）
      if (file.size > 50 * 1024 * 1024) {
        setError(`文件过大: ${(file.size / 1024 / 1024).toFixed(2)}MB（最大 50MB）`);
        continue;
      }

      try {
        setUploading(true, 0);
        
        // 解析模型
        const model = await parseModelFile(file, (progress) => {
          if (current()) setUploading(true, progress);
        });
        if (!current()) return;
        
        addUploadedModel(model);
        selectModel(model);
        setUploading(false, 100);
      } catch (err) {
        if (!current()) return;
        console.error('Model parsing error:', err);
        setError(err instanceof Error ? err.message : '模型解析失败');
        setUploading(false);
      }
    }
  }, [addUploadedModel, setUploading, selectModel]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'model/stl': ['.stl'],
      'model/obj': ['.obj'],
      'model/gltf+json': ['.gltf'],
      'model/gltf-binary': ['.glb'],
    },
    maxFiles: 5,
  });

  return (
    <div className="space-y-4">
      <Tabs defaultValue="preset" className="w-full">
        <TabsList className="w-full bg-zinc-900 grid grid-cols-2">
          <TabsTrigger value="preset" className="text-xs">
            <Sparkles className="w-3 h-3 mr-1" />
            预设模型
          </TabsTrigger>
          <TabsTrigger value="upload" className="text-xs">
            <Upload className="w-3 h-3 mr-1" />
            上传模型
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preset" className="mt-4">
          <PresetModelSelector />
        </TabsContent>

        <TabsContent value="upload" className="mt-4 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-white mb-2">模型上传</h3>
            <p className="text-xs text-zinc-500 mb-4">
              支持 STL、OBJ、glTF 格式，最大 50MB。glTF 动画仅导入源节点的静态姿态；蒙皮和形变需先烘焙为网格。
            </p>
          </div>

          {/* Dropzone */}
          <Card
            {...getRootProps()}
            className={`bg-zinc-900/50 border-2 border-dashed cursor-pointer transition-colors ${
              isDragActive
                ? 'border-cyan-500 bg-cyan-500/10'
                : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <CardContent className="flex flex-col items-center justify-center py-8">
              <input {...getInputProps()} />
              <Upload className={`w-12 h-12 mb-4 ${isDragActive ? 'text-cyan-400' : 'text-zinc-600'}`} />
              {isUploading ? (
                <div className="text-center">
                  <p className="text-sm text-zinc-300 mb-2">上传中...</p>
                  <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-zinc-500 mt-2">{uploadProgress.toFixed(0)}%</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-zinc-300 mb-1">
                    {isDragActive ? '释放以上传' : '拖拽文件到此处'}
                  </p>
                  <p className="text-xs text-zinc-500">或点击选择文件</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="min-w-0 break-all text-xs text-red-400">{error}</p>
            </div>
          )}
          <details className="rounded-lg border border-zinc-700 p-3 text-xs text-zinc-300">
            <summary className="cursor-pointer text-sm">下载真实服务器装配样例</summary>
            <p className="mt-2 leading-relaxed text-zinc-400">OCP / Microsoft Olympus 1U，含主板、机箱和六组风扇安装部件。下载后可在此上传并查看装配；材料、热源与风扇参数需另行设置。</p>
            <div className="mt-3 flex flex-wrap gap-3 text-cyan-300">
              <a className="underline" href={publicAssetUrl('/models/olympus-1u-preview.glb')} download>完整机壳 · 32 MB</a>
              <a className="underline" href={publicAssetUrl('/models/olympus-1u-cover-removed-preview.glb')} download>去盖查看 · 32 MB</a>
              <a className="underline" href={publicAssetUrl('/models/README.md')} target="_blank" rel="noreferrer">来源与使用说明</a>
            </div>
          </details>
        </TabsContent>
      </Tabs>

      {/* Uploaded Models List */}
      {uploadedModels.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-zinc-400 mb-1">
            已加载模型 ({uploadedModels.length})
          </h4>
          <p className="text-xs text-zinc-500 mb-2">仅当前模型显示在风洞中并参与计算；点击卡片切换。</p>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {uploadedModels.map((model) => (
                <ModelCard
                  key={model.metadata.id}
                  model={model}
                  active={model.metadata.id === activeModel?.id}
                  onSelect={() => selectModel(model)}
                  onDelete={() => removeUploadedModel(model.metadata.id)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function ModelCard({ model, active, onSelect, onDelete }: { model: UploadedModel; active: boolean; onSelect: () => void; onDelete: () => void }) {
  const { metadata } = model;
  
  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardHeader className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <div className="w-10 h-10 rounded bg-zinc-800 flex items-center justify-center flex-shrink-0">
              <FileBox className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm text-white truncate">
                {metadata.name}
              </CardTitle>
              <CardDescription className="text-xs text-zinc-500 mt-1">
                {metadata.format.toUpperCase()} • {(metadata.fileSize / 1024).toFixed(1)} KB
              </CardDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-400 hover:text-red-400"
            onClick={onDelete}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <Button type="button" variant="outline" className="mb-3 w-full" disabled={active} onClick={onSelect}>
          {active ? '当前模型' : '用于仿真'}
        </Button>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="text-zinc-500">
            顶点: <span className="text-zinc-300">{metadata.vertexCount.toLocaleString()}</span>
          </div>
          <div className="text-zinc-500">
            面: <span className="text-zinc-300">{metadata.faceCount.toLocaleString()}</span>
          </div>
        </div>
        {!!model.geometry.solidTriangleCounts?.length && <p className="mt-2 text-xs text-zinc-400">
          {model.geometry.solidTriangleCounts.length} 个已声明实体：重叠区域按实心合并，实体内部保留内腔。
        </p>}
        <div className="flex gap-2 mt-2">
          {metadata.topology && metadata.isWatertight && (
            <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 text-xs">
              <Check className="w-3 h-3 mr-1" />
              边闭合检查通过
            </Badge>
          )}
          {metadata.topology && !metadata.isWatertight && (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 text-xs">
              几何边界需检查
            </Badge>
          )}
          {!metadata.topology && <span className="text-xs text-zinc-400">旧模型未记录边界检查，请重新导入</span>}
        </div>
        {metadata.topology && <p className="mt-2 text-xs text-zinc-400">
          开口边 {metadata.topology.boundaryEdges} · 多面共边 {metadata.nonManifoldEdges} · 方向冲突 {metadata.topology.inconsistentEdges} · 退化面 {metadata.topology.degenerateFaces}
          <span className="mt-1 block">仅检查表面连接，未检查自交。流体域与结构单元需按求解任务另行检查。</span>
        </p>}
      </CardContent>
    </Card>
  );
}
