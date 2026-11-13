'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input, NumberInput } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { useProjectStore } from '@/lib/stores/project-store';
import { createActiveLbmJobSpec, createActiveFlowJobSpec, createLbmPreviewPlacement } from '@/lib/models/sim-session';
import { GRID_PRESETS, MODEL_RESOLUTIONS } from '@w-sim/solvers-lbm/d3q19';
import type { LbmFanComponent, LbmThermalRegion, MacFanComponent } from '@w-sim/contracts';
import { prepareProductLbmUnits, decimatedCellCount, lbmFieldSampleSteps } from '@w-sim/solvers-lbm/d3q19';
import { macFieldSampleSteps } from '@w-sim/solvers-lbm/mac3d';
import { MacGridCheck } from './mac-grid-check';
import { clearFrameExportDir, getFrameExportDir, isFrameExportSupported, pickFrameExportDir } from '@/lib/cfd/frame-export';
import { downloadMacFanCurveCsv, importMacFanCurveCsv } from '@/lib/models/fan-curve';

function MacFanCurveFile({ fan, index }: { fan: MacFanComponent; index: number }) {
  const input = useRef<HTMLInputElement>(null);
  const read = useRef<AbortController | null>(null);
  const running = useSimulationStore(store => store.state.isRunning);
  const [feedback, setFeedback] = useState<{ fan: MacFanComponent; pending?: boolean; error?: boolean; text: string } | null>(null);
  useEffect(() => () => { read.current?.abort(); }, []);
  const current = feedback?.fan === fan ? feedback : null;
  const importFile = async (file: File) => {
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    setFeedback({ fan, pending: true, text: '正在读取本地 CSV…' });
    try {
      const updated = await importMacFanCurveCsv(file, fan, controller.signal);
      if (!controller.signal.aborted) setFeedback({ fan: updated, text: `已替换为 ${updated.curve.length} 个参考转速曲线点（m³/s、Pa）` });
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ fan, error: true, text: error instanceof Error ? error.message : String(error) });
    }
  };
  return <div className="space-y-2">
    <input ref={input} type="file" accept=".csv,text/csv" className="hidden" aria-label={`MAC 风扇${index + 1}曲线 CSV 文件`}
      onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void importFile(file);
      }} />
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={running || current?.pending} onClick={() => input.current?.click()}>导入曲线 CSV</Button>
      <Button size="sm" variant="outline" onClick={() => {
        try { downloadMacFanCurveCsv(fan); }
        catch (error) { setFeedback({ fan, error: true, text: error instanceof Error ? error.message : String(error) }); }
      }}>导出曲线 CSV</Button>
      {current?.pending && <Button size="sm" variant="ghost" onClick={() => { read.current?.abort(); setFeedback(null); }}>取消导入</Button>}
    </div>
    {current && <p role={current.error ? 'alert' : 'status'} className={current.error ? 'text-xs text-amber-300' : 'text-xs text-zinc-400'}>{current.text}</p>}
  </div>;
}

function MacParameters() {
  const { parameters, updateParameters } = useSimulationStore();
  const activeModel = useProjectStore(store => store.activeModel);
  const fans = parameters.macFans ?? [], grid = parameters.macGrid ?? [48, 24, 24];
  const isServer = (activeModel?.sourceModel.id ?? activeModel?.id) === 'server-chassis';
  const updateFan = (index: number, changes: Partial<MacFanComponent>) => updateParameters({ macFans: fans.map((fan, i) => i === index ? { ...fan, ...changes } : fan) });
  const length = activeModel?.referenceLength ?? activeModel?.sourceModel.boundingBox.size[0];
  const dx = length === undefined ? undefined : length / (parameters.macCharacteristicCells ?? 16);
  return <div className="space-y-4" aria-label="MAC 风扇与边界">
    <h3 className="text-sm font-medium">空间网格与时间步</h3>
    <div className="grid grid-cols-3 gap-2">{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis} className="text-xs text-zinc-400">{axis} 格数
      <NumberInput aria-label={`MAC ${axis}格数`} integer min={3} max={256} value={grid[index]} onValueChange={value => {
        const next: [number, number, number] = [...grid]; next[index] = value; updateParameters({ macGrid: next });
      }} /></label>)}</div>
    <Label htmlFor="mac-characteristic" className="text-xs text-zinc-400">模型 X 长度占用格数</Label>
    <NumberInput id="mac-characteristic" min={1} step="any" value={parameters.macCharacteristicCells ?? 16}
      onValueChange={macCharacteristicCells => updateParameters({ macCharacteristicCells })} />
    <Label htmlFor="mac-dt" className="text-xs text-zinc-400">每步物理时间（s）</Label>
    <NumberInput id="mac-dt" min={Number.MIN_VALUE} step="any" value={parameters.dtSeconds} onValueChange={dtSeconds => updateParameters({ dtSeconds })} />
    {dx !== undefined && <p className="text-xs text-zinc-400">dx = {(dx * 1000).toPrecision(4)} mm；物理流域 {grid.map(n => (n * dx).toPrecision(4)).join(' × ')} m。薄壁、间隙与风扇必须被此网格解析；网格通过不代表精度验证。</p>}
    {isServer && <>
      <Button size="sm" variant="outline" onClick={() => updateParameters({ macGrid: [128, 64, 64], macCharacteristicCells: 43 })}>使用服务器结构检查网格</Button>
      <p className="text-xs text-amber-300">此结构示例的壁厚为 12 mm、鳍间隙 24 mm。检查网格为 128×64×64；40 mm 风扇直径仍只有约 3.8 格，适合起始过程检查。</p>
    </>}
    <MacGridCheck />
    <h3 className="text-sm font-medium">压力开口</h3>
    <div className="grid grid-cols-2 gap-2 text-xs">{['X−', 'X+', 'Y−', 'Y+', 'Z−', 'Z+'].map((name, index) => <label key={name} className="flex gap-2">
      <input type="checkbox" checked={!!((parameters.macOpenFaces ?? 3) & (1 << index))} onChange={event => {
        const bits = parameters.macOpenFaces ?? 3;
        updateParameters({ macOpenFaces: event.currentTarget.checked ? bits | (1 << index) : bits & ~(1 << index) });
      }} />{name} 环境压力开口</label>)}</div>
    <p className="text-xs text-zinc-400">勾选面为 0 Pa 表压开口，其余面固定、无滑移、绝热。开口允许流入和流出；入流空气为环境温度。这里不指定入口速度。</p>
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">风扇 P–Q 曲线</h3>
      <Button size="sm" variant="outline" disabled={fans.length >= 16} onClick={() => {
        let name = `示例风扇 ${fans.length + 1}`;
        while (fans.some(fan => fan.name === name)) name += ' +';
        updateParameters({ macFans: [...fans, { name, center: isServer ? [.388888886, .566666644, .5] : [.15, .5, .5],
          axis: 'x', radiusM: .02, rpmRatio: 1, curve: [{ flowM3s: 0, pressurePa: 20 }, { flowM3s: .01, pressurePa: 0 }] }] });
      }}>添加合成示例风扇</Button>
    </div>
    <p className="text-xs text-zinc-400">按钮填入 20 Pa / 0.01 m³/s 的合成示例，非厂家数据。请填写自己的静压曲线；不自动排序或外推。转速比是实际 RPM / 参考 RPM，不是 PWM 占空比。风扇停用请移除组件。</p>
    <p className="text-xs text-zinc-400">CSV 在本机读取，最大 64 KiB。只读取 flowM3PerSecond（或 flowM3s，m³/s）与 pressurePa（Pa）列，其他列不参与计算。导入替换参考转速曲线，不缩放、不补点；型号是否匹配由用户确认。</p>
    {!fans.length && <p className="text-xs text-amber-300">当前没有驱动力；静止流体不会因压力开口而自动产生风。</p>}
    {fans.map((fan, index) => <details key={index} open className="space-y-3 rounded border border-zinc-700 p-3">
      <summary className="cursor-pointer text-sm">{fan.name}</summary>
      <Input aria-label={`MAC 风扇${index + 1}名称`} value={fan.name} maxLength={80} onChange={event => updateFan(index, { name: event.currentTarget.value })} />
      <Select value={fan.axis} onValueChange={axis => { if (axis) updateFan(index, { axis }); }}>
        <SelectTrigger aria-label={`MAC 风扇${index + 1}方向`}><SelectValue /></SelectTrigger>
        <SelectContent>{(['x', '-x', 'y', '-y', 'z', '-z'] as const).map(axis => <SelectItem key={axis} value={axis}>{axis}</SelectItem>)}</SelectContent>
      </Select>
      <div className="grid grid-cols-3 gap-2">{(['X', 'Y', 'Z'] as const).map((axis, i) => <label key={axis} className="text-xs">{axis} 位置 (%)
        <NumberInput aria-label={`MAC 风扇${index + 1} ${axis}位置`} min={0} max={100} step="any" value={fan.center[i] * 100} onValueChange={value => {
          const center: [number, number, number] = [...fan.center]; center[i] = value / 100; updateFan(index, { center });
        }} /></label>)}</div>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs">直径 (mm)<NumberInput aria-label={`MAC 风扇${index + 1}直径`} min={Number.MIN_VALUE} step="any" value={fan.radiusM * 2000}
        onValueChange={value => updateFan(index, { radiusM: value / 2000 })} /></label>
        <label className="text-xs">转速比<NumberInput aria-label={`MAC 风扇${index + 1}转速比`} min={Number.MIN_VALUE} max={1} step="any" value={fan.rpmRatio}
          onValueChange={rpmRatio => updateFan(index, { rpmRatio })} /></label></div>
      <p className="text-xs text-zinc-400">位置相对原模型包围盒；出风方向沿模型坐标轴。有效圆盘面位于流体网格，可能与输入位置存在格距量化差异。</p>
      <MacFanCurveFile fan={fan} index={index} />
      <table className="w-full text-xs"><thead><tr><th>Q (m³/s)</th><th>静压升 (Pa)</th><th /></tr></thead><tbody>{fan.curve.map((point, row) => <tr key={row}>
        {(['flowM3s', 'pressurePa'] as const).map(key => <td key={key}><NumberInput aria-label={`MAC 风扇${index + 1}曲线${row + 1} ${key === 'flowM3s' ? '流量' : '压升'}`} min={0} step="any" value={point[key]}
          onValueChange={value => updateFan(index, { curve: fan.curve.map((p, i) => i === row ? { ...p, [key]: value } : p) })} /></td>)}
        <td><Button size="sm" variant="ghost" disabled={fan.curve.length <= 2} onClick={() => updateFan(index, { curve: fan.curve.filter((_, i) => i !== row) })}>移除点</Button></td>
      </tr>)}</tbody></table>
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={fan.curve.length >= 256} onClick={() => {
        const a = fan.curve.at(-2)!, b = fan.curve.at(-1)!;
        updateFan(index, { curve: [...fan.curve.slice(0, -1), { flowM3s: (a.flowM3s + b.flowM3s) / 2, pressurePa: (a.pressurePa + b.pressurePa) / 2 }, b] });
      }}>插入曲线点</Button><Button size="sm" variant="ghost" onClick={() => updateParameters({ macFans: fans.filter((_, i) => i !== index) })}>移除此风扇</Button></div>
    </details>)}
  </div>;
}

export function ParameterPanel() {
  const { parameters, updateParameters, derived } = useSimulationStore();
  const [frameDirName, setFrameDirName] = useState<string | null>(getFrameExportDir()?.name ?? null);
  const mac = parameters.flowMethod === 'mac';
  const { activeModel, uploadedModels, setActiveModel } = useProjectStore();
  const mesh = uploadedModels.find(model => model.metadata.id === activeModel?.id)?.geometry;
  const modelSetup = useMemo(() => {
    if (!activeModel) return null;
    try { return { model: createActiveLbmJobSpec({ ...parameters, durationSeconds: undefined }, activeModel).model, error: null }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [activeModel, parameters]);
  const placement = useMemo(() => {
    if (!activeModel || !mesh) return null;
    try { return { ...createLbmPreviewPlacement(parameters, activeModel, mesh), error: null }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [activeModel, mesh, parameters]);
  const referenceLength = modelSetup?.error === null ? modelSetup.model?.referenceLength ?? activeModel?.sourceModel.boundingBox?.size[0] : undefined;
  const referenceArea = modelSetup?.error === null ? modelSetup.model?.referenceArea : undefined;
  const runSetup = useMemo(() => {
    if (!activeModel || referenceLength === undefined) return null;
    try {
      const spec = createActiveFlowJobSpec(parameters, activeModel);
      const stride = spec.outputs.fieldStride ?? 1;
      if (spec.kind === 'mac-3d') {
        const [gnx, gny, gnz] = spec.parameters.grid;
        const cells = decimatedCellCount(gnx, gny, gnz, stride);
        const frames = macFieldSampleSteps(spec.run.maxSteps, spec.outputs.fieldFrames, cells, parameters.thermalEnabled);
        const frameBytes = 32 + cells * ((parameters.thermalEnabled ? 5 : 4) + 1) * 4;
        return { error: null, steps: spec.run.maxSteps, seconds: spec.run.maxSteps * spec.parameters.dtSeconds, dt: spec.parameters.dtSeconds, frames: frames.length, frameBytes };
      }
      const { units } = prepareProductLbmUnits(spec, referenceLength);
      const cells = decimatedCellCount(units.nx, units.ny, units.nz, stride);
      const frames = lbmFieldSampleSteps(spec.run.maxSteps, spec.outputs.fieldFrames, cells, parameters.thermalEnabled, spec.outputs.fields?.includes('pressure'));
      const frameBytes = 32 + cells * ((2 + Number(parameters.thermalEnabled) + Number(spec.outputs.fields?.includes('pressure'))) + 1) * 4;
      return { error: null, steps: spec.run.maxSteps, seconds: spec.run.maxSteps * units.dt, dt: units.dt, frames: frames.length, frameBytes };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [activeModel, parameters, referenceLength]);
  const fan = parameters.fan;
  const regions = parameters.thermalRegions ?? [];
  const contacts = parameters.thermalContacts ?? [];
  const materials = ['其余固体（默认材料）', ...regions.map(region => region.name)];
  const availableContacts = materials.flatMap((_, first) => materials.flatMap((_, second) =>
    first < second && !contacts.some(contact => Math.min(contact.first, contact.second) === first && Math.max(contact.first, contact.second) === second)
      ? [{ first, second, resistanceM2KW: 0 }] : []));
  const updateRegion = (index: number, changes: Partial<LbmThermalRegion>) => {
    updateParameters({ thermalRegions: regions.map((region, i) => i === index ? { ...region, ...changes } : region) });
  };
  const updateFan = (changes: Partial<LbmFanComponent>) => {
    if (fan) updateParameters({ fan: { ...fan, ...changes } });
  };

  return (
    <div key={activeModel?.id} className="space-y-6">
      <p className="text-xs text-zinc-400">修改物理参数或模型会重置流场与计算结果；显示设置可随时切换。数值输入按回车或离开输入框后应用；空白或无效值恢复上次值。</p>
      <div className="space-y-2">
        <Label>求解方法</Label>
        <Select value={parameters.flowMethod ?? 'lbm'} onValueChange={value => {
          if (value !== 'mac' && value !== 'lbm') return;
          updateParameters({ flowMethod: value });
          useSimulationStore.getState().setVisualizationMode('velocity');
          if (value === 'mac') useSimulationStore.getState().setComputeBackend('cpu');
        }}>
          <SelectTrigger aria-label="求解方法"><SelectValue>{mac ? '风扇驱动流动 / MAC' : '来流风洞 / LBM'}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="lbm">来流风洞 / LBM</SelectItem><SelectItem value="mac">风扇驱动流动 / MAC</SelectItem></SelectContent>
        </Select>
        {mac && <p className="text-xs text-zinc-400">静止模型、真实黏度、压力投影与层流传热，CPU / WASM 使用 FP64。空气由风扇推动；未接入来流速度、移动地面、湍流或热浮力。</p>}
      </div>
      {activeModel && <div className="space-y-3" aria-label="模型物理尺寸">
        <h3 className="text-sm font-medium text-white">模型物理尺寸</h3>
        <Label htmlFor="model-reference-length" className="text-xs text-zinc-400">模型流向长度（m）</Label>
        <NumberInput id="model-reference-length" min={Number.MIN_VALUE} step="any" value={referenceLength ?? ''}
          className="bg-zinc-900 border-zinc-800 text-white" onValueChange={referenceLength => setActiveModel({ ...activeModel, referenceLength })} />
        <p className="text-xs text-zinc-400">指定原始模型 X 跨度对应的米长度，整体等比例换算；不改写原文件。毫米导出的 4500 单位长度应填 4.5 m。{mac ? 'MAC 保留原模型方向，风扇轴向按此坐标系设置。上传和体素化成功不代表已完成真实设备的流体前处理与验证。' : '来流沿 +X，模型应以 Y 为上方、车头朝 −X；攻角在此基础上旋转。'}</p>
        {!mac && <><Label className="text-xs text-zinc-400">气动力参考面积</Label>
        <Select value={referenceArea === undefined ? 'automatic' : 'specified'} onValueChange={(mode) => {
          if (mode === 'automatic') setActiveModel({ ...activeModel, referenceArea: null });
          else if (mode === 'specified') setActiveModel({ ...activeModel, referenceArea: referenceArea ?? 1 });
        }}>
          <SelectTrigger aria-label="气动力参考面积" className="w-full bg-zinc-900 border-zinc-800 text-white">
            <SelectValue>{referenceArea === undefined ? '自动：离散迎风投影' : '指定参考面积'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="automatic">自动：离散迎风投影</SelectItem>
            <SelectItem value="specified">指定参考面积</SelectItem>
          </SelectContent>
        </Select>
        {referenceArea !== undefined && <>
          <Label htmlFor="model-reference-area" className="text-xs text-zinc-400">参考面积（m²）</Label>
          <NumberInput id="model-reference-area" min={Number.MIN_VALUE} step="any" value={referenceArea}
            className="bg-zinc-900 border-zinc-800 text-white" onValueChange={referenceArea => setActiveModel({ ...activeModel, referenceArea })} />
        </>}
        <p className="text-xs text-zinc-400">参考面积用于 Cd/Cl 的归一化，不改变模型几何。自动面积随网格和攻角变化；指定面积按输入 m² 保持，修改模型长度后请核对它。</p>
        </>}
        <Button type="button" variant="outline" size="sm" onClick={() => setActiveModel({ ...activeModel, referenceLength: undefined, referenceArea: undefined })}>恢复模型默认尺寸与面积</Button>
        {modelSetup?.error && <p role="alert" className="text-xs text-amber-300">{modelSetup.error}</p>}
      </div>}
      {mac && <MacParameters />}
      {/* 流场参数 */}
      {!mac && <>
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-white">流场参数</h3>
        <div className="space-y-2">
          <Label className="text-xs text-zinc-400">物性模式</Label>
          <Select value={parameters.thermalEnabled ? 'physical' : parameters.viscosityMode} disabled={parameters.thermalEnabled}
            onValueChange={(viscosityMode) => { if (viscosityMode) updateParameters({ viscosityMode }); }}>
            <SelectTrigger aria-label="物性模式" className="w-full bg-zinc-900 border-zinc-800 text-white">
              <SelectValue>{parameters.thermalEnabled || parameters.viscosityMode === 'physical' ? '真实物性（网格须满足要求）' : '流动演示（调整黏度）'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stabilized-preview">流动演示（调整黏度）</SelectItem>
              <SelectItem value="physical">真实物性（网格须满足要求）</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-zinc-400">{parameters.thermalEnabled
            ? '热计算始终使用真实物性；当前网格无法匹配输入黏度时会停止并说明网格要求。'
            : parameters.viscosityMode === 'stabilized-preview'
              ? '为使粗网格可运行，必要时提高模拟黏度、降低实际雷诺数；用于流动演示，不能当作真实汽车风阻预测。'
              : '使用输入黏度。网格无法匹配时停止，并给出所需特征长度格数；不会自动改成流动演示。'}</p>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-zinc-400">入口速度</Label>
              <span className="text-xs text-white font-mono">
                {parameters.inletVelocity.toFixed(1)} m/s
              </span>
            </div>
            <Slider
              value={[parameters.inletVelocity]}
              onValueChange={(value) => updateParameters({ inletVelocity: Array.isArray(value) ? value[0] : value })}
              min={parameters.thermalEnabled || fan ? 0 : 0.1}
              max={100}
              step={0.1}
              className="w-full"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-zinc-400">攻角</Label>
              <span className="text-xs text-white font-mono">
                {parameters.angleOfAttack.toFixed(1)}°
              </span>
            </div>
            <Slider
              value={[parameters.angleOfAttack]}
              onValueChange={(value) => updateParameters({ angleOfAttack: Array.isArray(value) ? value[0] : value })}
              min={-15}
              max={15}
              step={0.5}
              className="w-full"
            />
            <p className="text-xs text-zinc-400 mt-1">调整攻角会重新体素化模型并重置流场</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-zinc-400">入口湍流强度</Label>
              <span className="text-xs text-white font-mono">
                {parameters.turbulenceIntensity.toFixed(1)}%
              </span>
            </div>
            <Slider
              value={[parameters.turbulenceIntensity]}
              onValueChange={(value) => updateParameters({ turbulenceIntensity: Array.isArray(value) ? value[0] : value })}
              min={0}
              max={20}
              step={0.1}
              className="w-full"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-zinc-400">Smagorinsky 常数 (LES)</Label>
              <span className="text-xs text-white font-mono">
                {parameters.smagorinskyCs.toFixed(3)}
              </span>
            </div>
            <Slider
              value={[parameters.smagorinskyCs]}
              onValueChange={(value) => updateParameters({ smagorinskyCs: Array.isArray(value) ? value[0] : value })}
              min={0.05}
              max={0.25}
              step={0.005}
              className="w-full"
            />
            <p className="text-xs text-zinc-400 mt-1">亚格子模型增加局部涡黏度，不能补偿被改变的流体黏度或雷诺数</p>
          </div>
        </div>
      </div>
      </>}

      <Separator className="bg-zinc-800" />

      {/* 流体物性 */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-white">流体物性</h3>
        <Label htmlFor="fluid-viscosity" className="text-xs text-zinc-400">动力黏度（Pa·s）</Label>
        <NumberInput id="fluid-viscosity" min={Number.MIN_VALUE} step="any" value={parameters.fluidViscosity}
          onValueChange={fluidViscosity => updateParameters({ fluidViscosity })} />

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-zinc-400">流体密度</Label>
            <span className="text-xs text-white font-mono">
              {parameters.fluidDensity.toFixed(3)} kg/m³
            </span>
          </div>
          <Slider
            value={[parameters.fluidDensity]}
            onValueChange={(value) => updateParameters({ fluidDensity: Array.isArray(value) ? value[0] : value })}
            min={0.1}
            max={2}
            step={0.001}
            className="w-full"
          />
        </div>
      </div>

      {!mac && <>
      <Separator className="bg-zinc-800" />

      {/* 边界与地面 */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-white">边界与地面</h3>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-zinc-400 mb-2 block">地面</Label>
            <Select value={parameters.ground?.mode ?? 'none'} onValueChange={(mode) => {
              if (mode === 'none') updateParameters({ ground: undefined });
              else if (mode === 'stationary' || mode === 'moving') updateParameters({ ground: { mode, clearanceM: parameters.ground?.clearanceM ?? 0 } });
            }}>
              <SelectTrigger aria-label="地面" className="w-full bg-zinc-900 border-zinc-800 text-white">
                <SelectValue>{parameters.ground?.mode === 'moving' ? '随来流移动地面' : parameters.ground ? '固定地面' : '无地面'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">无地面</SelectItem>
                <SelectItem value="stationary">固定地面</SelectItem>
                <SelectItem value="moving">随来流移动地面</SelectItem>
              </SelectContent>
            </Select>
            {parameters.ground ? <div className="mt-3 space-y-2">
              <Label htmlFor="ground-clearance" className="text-xs text-zinc-400">模型最低点距地面（m）</Label>
              <NumberInput id="ground-clearance" min={0} step="0.01" value={parameters.ground.clearanceM}
                className="bg-zinc-900 border-zinc-800 text-white"
                onValueChange={clearanceM => updateParameters({ ground: { ...parameters.ground!, clearanceM } })} />
              <p className="text-xs text-zinc-400">从旋转后完整模型的最低点测量，含轮胎；不是底盘间隙。</p>
              <p className="text-xs text-zinc-400">{parameters.ground.mode === 'moving'
                ? `地面随来流沿 +X 以 ${parameters.inletVelocity.toFixed(1)} m/s 移动。` : '地面固定，表面无滑移。'}车轮仍不旋转。{parameters.thermalEnabled ? '地面绝热；不计算黏性耗散生热。' : ''}</p>
            </div> : <p className="text-xs text-zinc-400 mt-1">模型保持在流域中心偏上游，不设置道路地面。</p>}
          </div>

          <div>
            <Label className="text-xs text-zinc-400 mb-2 block">{parameters.ground ? '外域顶部与左右边界' : '外域上下与左右边界'}</Label>
            <Select
              value={parameters.wallCondition}
              onValueChange={(value) => {
                if (value) updateParameters({ wallCondition: value });
              }}
            >
              <SelectTrigger className="w-full bg-zinc-900 border-zinc-800 text-white">
                <SelectValue>{parameters.wallCondition === 'slip' ? '自由滑移（镜面反射）' : '固定无滑移'}</SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="slip">自由滑移（镜面反射）</SelectItem>
                <SelectItem value="no-slip">固定无滑移</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-400 mt-1">同时设置{parameters.ground ? '顶部与左右三面' : '四面'}外域边界，均不允许法向穿透；自由滑移通过镜面反射保留切向速度。模型表面仍为固定无滑移。</p>
          </div>
        </div>
      </div>

      <Separator className="bg-zinc-800" />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">风扇组件（恒压近似）</h3>
          <Switch aria-label="启用风扇" checked={!!fan} onCheckedChange={(enabled) => updateParameters({
            fan: enabled ? { center: [0.15, 0.5, 0.5], axis: 'x', radiusM: 0.01, pressureRisePa: 20 } : null,
          })} />
        </div>
        <p className="text-xs text-zinc-400">风扇在指定圆盘区域推动空气，前后端使用同一配置；预览中的金色圆盘和箭头表示位置与出风方向。</p>
        {fan && <div className="space-y-3">
          <div>
            <Label className="text-xs text-zinc-400">出风方向</Label>
            <Select value={fan.axis} onValueChange={(axis) => { if (axis) updateFan({ axis }); }}>
              <SelectTrigger aria-label="风扇出风方向" className="w-full bg-zinc-900 border-zinc-800 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>{(['x', '-x', 'y', '-y', 'z', '-z'] as const).map((axis) => <SelectItem key={axis} value={axis}>{axis.toUpperCase()} 方向</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <div className="flex justify-between text-xs"><Label>风扇直径</Label><span>{(fan.radiusM * 2000).toFixed(0)} mm</span></div>
            <Slider aria-label="风扇直径" value={[fan.radiusM * 2000]} min={2} max={400} step={2}
              onValueChange={(value) => updateFan({ radiusM: (Array.isArray(value) ? value[0] : value) / 2000 })} />
          </div>
          <div>
            <div className="flex justify-between text-xs"><Label>风扇压升</Label><span>{fan.pressureRisePa.toFixed(0)} Pa</span></div>
            <Slider aria-label="风扇压升" value={[fan.pressureRisePa]} min={1} max={200} step={1}
              onValueChange={(value) => updateFan({ pressureRisePa: Array.isArray(value) ? value[0] : value })} />
          </div>
          {(['X', 'Y', 'Z'] as const).map((axis, i) => <div key={axis}>
            <div className="flex justify-between text-xs"><Label>{axis} 位置</Label><span>{(fan.center[i] * 100).toFixed(0)}%</span></div>
            <Slider aria-label={`风扇 ${axis} 位置`} value={[fan.center[i]]} min={0} max={1} step={0.01} onValueChange={(value) => {
              const center: LbmFanComponent['center'] = [...fan.center];
              center[i] = Array.isArray(value) ? value[0] : value;
              updateFan({ center });
            }} />
          </div>)}
          <p className="text-xs text-zinc-400">位置相对于模型包围盒。改变风扇配置会重置计算；风扇直径需要能被当前网格解析。</p>
        </div>}
      </div>

      <Separator className="bg-zinc-800" />

      {/* 网格参数 */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-white">网格参数</h3>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-zinc-400 mb-2 block">3D 网格预设</Label>
            <Select
              value={parameters.gridPreset}
              onValueChange={(value) => {
                if (value) updateParameters({ gridPreset: value });
              }}
            >
              <SelectTrigger className="w-full bg-zinc-900 border-zinc-800 text-white">
                <SelectValue>{GRID_PRESETS.find(preset => preset.id === parameters.gridPreset)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                {GRID_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-400 mt-1">切换网格会重置流场；格子越多，计算和内存开销越大。</p>
          </div>

          <div>
            <Label className="text-xs text-zinc-400 mb-2 block">模型占域比例</Label>
            <Select
              value={parameters.modelResolution}
              onValueChange={(value) => {
                if (value) updateParameters({ modelResolution: value });
              }}
            >
              <SelectTrigger aria-label="模型占域比例" className="w-full bg-zinc-900 border-zinc-800 text-white">
                <SelectValue>{parameters.modelResolution === 'coarse' ? '约 1/6 流域长度' : parameters.modelResolution === 'high' ? '约 1/3 流域长度' : '约 1/4 流域长度'}</SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                {MODEL_RESOLUTIONS.map((res) => (
                  <SelectItem key={res.id} value={res.id}>
                    {res.id === 'coarse' ? '约 1/6 流域长度' : res.id === 'high' ? '约 1/3 流域长度' : '约 1/4 流域长度'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-400 mt-1">
              提高占比会减小格距，也会缩小物理流域、拉近外边界；不属于固定流域的网格加密，不能据此断言受力更准。
            </p>
          </div>

          {placement?.error === null && <div className="rounded-lg border border-zinc-800 p-3 space-y-1.5 text-xs text-zinc-300" aria-label="当前网格配置">
            <p>流向长度分为 {placement.grid.characteristicCells} 格 · dx = {placement.dx.toPrecision(4)} m</p>
            <p>物理流域 X/Y/Z：{[placement.grid.nx, placement.grid.ny, placement.grid.nz].map(n => (n * placement.dx).toPrecision(4)).join(' × ')} m</p>
            {(['X（入口 / 出口）', 'Y（底部 / 顶部）', 'Z（左右边界）'] as const).map((label, axis) => <p key={axis}>
              模型至 {label}：{(placement.transform.bounds.min[axis] * placement.dx).toPrecision(4)} / {(([placement.grid.nx, placement.grid.ny, placement.grid.nz][axis] - placement.transform.bounds.max[axis]) * placement.dx).toPrecision(4)} m
            </p>)}
            <p className="text-zinc-400">按旋转后的完整模型外形测量，含轮胎；当前配置预览不代表物理准入或收敛验证已通过。</p>
          </div>}
          {placement?.error && <p role="alert" className="text-xs text-amber-300">{placement.error}</p>}

          {/* 派生物理量（只读） */}
          {derived && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 space-y-1.5">
              <p className="text-xs font-medium text-zinc-400 mb-1">本次结果的物性与单位</p>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">格子间距 dx:</span>
                <span className="text-zinc-300 font-mono">{(derived.dx * 1000).toFixed(1)} mm</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">时间步长 dt:</span>
                <span className="text-zinc-300 font-mono">{derived.dt.toExponential(2)} s</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">目标雷诺数 Re:</span>
                <span className="text-zinc-300 font-mono">{derived.reynoldsPhysical.toExponential(2)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">实际雷诺数 Re:</span>
                <span className="text-cyan-400 font-mono">{derived.reynoldsLattice.toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">参考面积:</span>
                <span className="text-zinc-300 font-mono">{derived.referenceArea.toFixed(3)} m²</span>
              </div>
              {derived.requestedViscosityM2s !== undefined && <div className="flex justify-between text-xs">
                <span className="text-zinc-400">输入运动黏度:</span>
                <span className="text-zinc-300 font-mono">{derived.requestedViscosityM2s.toExponential(3)} m²/s</span>
              </div>}
              {derived.simulatedViscosityM2s !== undefined && <div className="flex justify-between text-xs">
                <span className="text-zinc-400">模拟运动黏度:</span>
                <span className="text-zinc-300 font-mono">{derived.simulatedViscosityM2s.toExponential(3)} m²/s</span>
              </div>}
              {derived.viscosityMode === 'stabilized-preview' && <p className="text-xs text-amber-300 pt-1">流动演示结果。实际雷诺数由模拟黏度决定，LES 不会恢复目标雷诺数。</p>}
            </div>
          )}
        </div>
      </div>
      </>}

      <Separator className="bg-zinc-800" />

      {/* 求解器参数 */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-white">计算时长与回放</h3>
        <div className="space-y-3">
          <div>
            <Label htmlFor="run-duration" className="text-xs text-zinc-400">仿真物理时长（s，至少 10 秒）</Label>
            <NumberInput id="run-duration" min={10} step="any" value={parameters.durationSeconds ?? 10}
              onValueChange={durationSeconds => updateParameters({ durationSeconds })} />
            <div className="mt-3 space-y-2">
              <Label htmlFor="field-fps" className="text-xs">回放帧率（帧/物理秒）</Label>
              <Select value={String(parameters.fieldFps ?? 0)} onValueChange={value => updateParameters({ fieldFps: Number(value) })}>
                <SelectTrigger id="field-fps" aria-label="回放帧率"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">仅最终帧</SelectItem>
                  <SelectItem value="8">8 fps</SelectItem>
                  <SelectItem value="15">15 fps</SelectItem>
                  <SelectItem value="30">30 fps</SelectItem>
                  <SelectItem value="60">60 fps</SelectItem>
                  <SelectItem value="120">120 fps</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(parameters.fieldFps ?? 0) > 0 && <div className="space-y-2">
              <Label htmlFor="field-stride" className="text-xs">回放空间分辨率</Label>
              <Select value={String(parameters.fieldStride ?? 1)} onValueChange={value => updateParameters({ fieldStride: Number(value) as 1 | 2 | 4 | 8 })}>
                <SelectTrigger id="field-stride" aria-label="回放空间分辨率"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">完整分辨率</SelectItem>
                  <SelectItem value="2">1/2（块平均）</SelectItem>
                  <SelectItem value="4">1/4（块平均）</SelectItem>
                  <SelectItem value="8">1/8（块平均）</SelectItem>
                </SelectContent>
              </Select>
            </div>}
            {isFrameExportSupported() && <div className="mt-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  void pickFrameExportDir().then(dir => setFrameDirName(dir?.name ?? null)).catch(() => setFrameDirName(null));
                }}>{frameDirName ? `保存目录：${frameDirName}` : '选择计算文件保存目录'}</Button>
                {frameDirName && <Button type="button" size="sm" variant="ghost" onClick={() => { clearFrameExportDir(); setFrameDirName(null); }}>取消</Button>}
              </div>
              <p className="text-xs text-zinc-400">{frameDirName
                ? '每帧生成时写入所选目录 run-*/frames/*.wvf，结束后附 spec/result/manifest；帧仍保留在内存中用于回放。'
                : '可选：把计算帧与任务参数流式写入本地目录，便于离线检查或外部工具后处理。'}</p>
            </div>}
            {runSetup?.error === null && <p className="mt-2 text-xs text-zinc-300" aria-label="计算时长预估">{runSetup.steps.toLocaleString()} 步 × {runSetup.dt.toPrecision(4)} s ≈ {runSetup.seconds.toPrecision(4)} s 物理过程；保存 {runSetup.frames} 帧{runSetup.frames > 1 ? `（约 ${(runSetup.frameBytes * runSetup.frames / 1048576).toFixed(0)} MiB）` : ''}。</p>}
            {runSetup?.error && <p className="mt-2 text-xs text-amber-300" role="alert">无法确定计算时长：{runSetup.error}</p>}
            <p className="mt-2 text-xs text-zinc-400">物理时长不是计算耗时。回放帧按物理时间均匀采样；序列上限 256 MiB，超出时自动减少帧数，可降低分辨率换取更高帧率。播放可减速和循环。本机计算可能需要较长时间，请保持页面打开；也可发布到后端计算。</p>
          </div>
        </div>
      </div>

      <Separator className="bg-zinc-800" />

      {/* 散热仿真 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">传热与发热</h3>
          <Switch
            aria-label="启用传热计算"
            checked={parameters.thermalEnabled}
            onCheckedChange={(checked) => updateParameters({ thermalEnabled: checked })}
          />
        </div>
        <p className="text-xs text-zinc-500">此处计算来流中的发热模型；机箱、笔记本等整机散热请使用<a href="/cooling" target="_top" className="text-cyan-400 hover:underline">散热解算</a>页。</p>

        {parameters.thermalEnabled && (
          <div className="space-y-3">
            <Label className="text-xs text-zinc-400">热源设置</Label>
            <Select value={parameters.thermalMode} onValueChange={(value) => {
              if (value === 'fixed-temperature' || value === 'solid-power') updateParameters({ thermalMode: value });
            }}>
              <SelectTrigger aria-label="热源设置" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed-temperature">指定模型表面温度</SelectItem>
                <SelectItem value="solid-power">材料导热与发热功率</SelectItem>
              </SelectContent>
            </Select>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-zinc-400">环境温度</Label>
                <span className="text-xs text-white font-mono">
                  {parameters.ambientTemp.toFixed(0)} °C
                </span>
              </div>
              <Slider
                value={[parameters.ambientTemp]}
                onValueChange={(value) => updateParameters({ ambientTemp: Array.isArray(value) ? value[0] : value })}
                min={-20}
                max={45}
                step={1}
                className="w-full"
              />
            </div>

            {parameters.thermalMode === 'fixed-temperature' ? <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-zinc-400">模型表面温度</Label>
                <span className="text-xs text-orange-400 font-mono">
                  {parameters.heatSourceTemp.toFixed(0)} °C
                </span>
              </div>
              <Slider
                value={[parameters.heatSourceTemp]}
                onValueChange={(value) => updateParameters({ heatSourceTemp: Array.isArray(value) ? value[0] : value })}
                min={25}
                max={150}
                step={1}
                className="w-full"
              />
            </div> : <div className="space-y-3">
              {([
                ['totalPowerW', regions.length ? '其余固体总功率 (W)' : '模型总发热功率 (W)', 0, 'any'],
                ['solidDensityKgM3', '默认固体密度 (kg/m³)', 0.001, 'any'],
                ['solidSpecificHeatJkgK', '默认固体比热容 (J/kg·K)', 0.001, 'any'],
                ['solidConductivityWmK', '默认固体导热系数 (W/m·K)', 0.000001, 'any'],
                ['dtSeconds', '每步物理时间 (s)', 0.000000001, 'any'],
              ] as const).filter(([key]) => !mac || key !== 'dtSeconds').map(([key, label, min, step]) => <div key={key}>
                <Label htmlFor={`thermal-${key}`} className="text-xs text-zinc-400">{label}</Label>
                <NumberInput id={`thermal-${key}`} min={min} step={step} value={parameters[key]}
                  onValueChange={value => updateParameters({ [key]: value })} />
              </div>)}
              <p className="text-xs text-zinc-400">默认材料用于未指定区域的固体。每个区域的功率只分配到自己的固体单元，初温等于环境温度。材料数值仅供演示，请填写自己的参数。</p>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm text-white">部件材料与发热</h4>
                <Button size="sm" variant="outline" disabled={regions.length >= 16} onClick={() => {
                  let name = `部件 ${regions.length + 1}`;
                  while (regions.some((region) => region.name === name)) name += ' +';
                  updateParameters({ thermalRegions: [...regions, { name,
                    bounds: { min: [0.25, 0.25, 0.25], max: [0.75, 0.75, 0.75] },
                    solidDensityKgM3: parameters.solidDensityKgM3, solidSpecificHeatJkgK: parameters.solidSpecificHeatJkgK,
                    solidConductivityWmK: parameters.solidConductivityWmK, totalPowerW: 0 }] });
                }}>添加部件区域</Button>
              </div>
              <p className="text-xs text-zinc-400">用模型各轴的百分比范围选择已有固体；预览中的方框显示选区。按固体网格中心划分，区域不能重叠，须包含可分辨的固体。边界外的表面网格仍使用默认材料。添加区域不会创建几何体。</p>
              {regions.map((region, index) => <details key={index} open={index === regions.length - 1} className="rounded-md border border-zinc-700 p-3">
                <summary className="cursor-pointer text-xs" style={{ color: `hsl(${(index * 67 + 25) % 360}, 85%, 65%)` }}>{region.name || `部件 ${index + 1}`} · {region.totalPowerW} W</summary>
                <fieldset className="mt-3 space-y-3" aria-label={`部件区域 ${index + 1}`}>
                <div className="flex items-center gap-2">
                  <Input aria-label={`部件 ${index + 1} 名称`} maxLength={80} value={region.name}
                    onChange={(event) => updateRegion(index, { name: event.currentTarget.value })} />
                  <Button size="sm" variant="ghost" aria-label={`移除部件 ${index + 1}`}
                    onClick={() => updateParameters({ thermalRegions: regions.filter((_, i) => i !== index),
                      thermalContacts: contacts.filter(contact => contact.first !== index + 1 && contact.second !== index + 1)
                        .map(contact => ({ ...contact, first: contact.first > index + 1 ? contact.first - 1 : contact.first,
                          second: contact.second > index + 1 ? contact.second - 1 : contact.second })) })}>移除</Button>
                </div>
                <div className="grid grid-cols-[2rem_1fr_1fr] gap-2 text-xs text-zinc-400"><span /><span>起点 (%)</span><span>终点 (%)</span></div>
                {(['x', 'y', 'z'] as const).map((axis, dimension) => <div key={axis} className="grid grid-cols-[2rem_1fr_1fr] items-center gap-2">
                  <span className="text-xs text-zinc-400">{axis.toUpperCase()}</span>
                  {(['min', 'max'] as const).map((edge) => <NumberInput key={edge} min={0} max={100} step={1}
                    aria-label={`部件 ${index + 1} ${axis} ${edge === 'min' ? '起点' : '终点'} (%)`}
                    value={Number((region.bounds[edge][dimension] * 100).toFixed(6))}
                    onValueChange={(value) => {
                      const point: [number, number, number] = [...region.bounds[edge]];
                      point[dimension] = value / 100;
                      updateRegion(index, { bounds: { ...region.bounds, [edge]: point } });
                    }} />)}
                </div>)}
                {([
                  ['totalPowerW', '发热功率 (W)', 0],
                  ['solidDensityKgM3', '密度 (kg/m³)', 0.001],
                  ['solidSpecificHeatJkgK', '比热容 (J/kg·K)', 0.001],
                  ['solidConductivityWmK', '导热系数 (W/m·K)', 0.000001],
                ] as const).map(([key, label, min]) => <div key={key}>
                  <Label htmlFor={`region-${index}-${key}`} className="text-xs text-zinc-400">{label}</Label>
                  <NumberInput id={`region-${index}-${key}`} min={min} step="any" value={region[key]}
                    onValueChange={value => updateRegion(index, { [key]: value })} />
                </div>)}
                </fieldset>
              </details>)}
              <p className="text-xs text-zinc-400">合计发热功率：{(parameters.totalPowerW + regions.reduce((sum, region) => sum + region.totalPowerW, 0)).toPrecision(4)} W。</p>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm text-white">部件接触</h4>
                <Button size="sm" variant="outline" disabled={!availableContacts.length} onClick={() => {
                  const pair = availableContacts.find(contact => contact.first === 1 && contact.second === 2) ?? availableContacts[0];
                  if (pair) updateParameters({ thermalContacts: [...contacts, pair] });
                }}>添加接触热阻</Button>
              </div>
              {contacts.map((contact, index) => <fieldset key={index} aria-label={`接触热阻 ${index + 1}`} className="space-y-2 rounded-md border border-zinc-700 p-3">
                <div className="flex items-center justify-between"><span className="text-xs text-zinc-400">接触 {index + 1}</span>
                  <Button size="sm" variant="ghost" aria-label={`移除接触 ${index + 1}`} onClick={() => updateParameters({ thermalContacts: contacts.filter((_, i) => i !== index) })}>移除</Button>
                </div>
                {(['first', 'second'] as const).map((side) => <Select key={side} value={String(contact[side])} onValueChange={(value) => {
                  if (value !== null) updateParameters({ thermalContacts: contacts.map((item, i) => i === index ? { ...item, [side]: Number(value) } : item) });
                }}>
                  <SelectTrigger aria-label={`接触 ${index + 1} ${side === 'first' ? '第一部件' : '第二部件'}`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{materials.map((name, material) => <SelectItem key={material} value={String(material)} disabled={material === contact[side === 'first' ? 'second' : 'first']}>{name}</SelectItem>)}</SelectContent>
                </Select>)}
                <Label htmlFor={`contact-${index}-resistance`} className="text-xs text-zinc-400">面积归一化热阻 (m²·K/W)</Label>
                <NumberInput id={`contact-${index}-resistance`} min={0} step="any" value={contact.resistanceM2KW} onValueChange={resistanceM2KW => updateParameters({ thermalContacts: contacts.map((item, i) => i === index ? { ...item, resistanceM2KW } : item) })} />
              </fieldset>)}
              <p className="text-xs text-zinc-400">未设置或热阻为 0 时按理想接触导热。热阻作用于所选两种材料的所有相邻固体面；网格必须解析出实际接触，同一对部件只能设置一次。此处单位为 m²·K/W，不是整件热阻 K/W。辐射尚未接入。</p>
            </div>}

            {([
              ['fluidSpecificHeatJkgK', '流体比热容 (J/kg·K)'],
              ['fluidConductivityWmK', '流体导热系数 (W/m·K)'],
            ] as const).map(([key, label]) => <div key={key}>
              <Label htmlFor={`thermal-${key}`} className="text-xs text-zinc-400">{label}</Label>
              <NumberInput id={`thermal-${key}`} min={0.000001} step="any" value={parameters[key]}
                onValueChange={value => updateParameters({ [key]: value })} />
            </div>)}

            <p className="text-xs text-zinc-400">
              {mac ? 'MAC 使用输入时间步和材料参数，风扇流动带走热量；未接入热浮力、辐射或黏性耗散生热。关闭风扇从静止开始时，只剩导热和功率输入。' : '流体默认参数对应空气近似，浮力使用小温差模型。关闭风扇并将入口速度设为 0 可计算自然对流。'}
              {!mac && parameters.thermalMode === 'fixed-temperature' ? '指定表面温度须高于环境温度；时间步根据流速、黏度和网格自动选取，实际值显示在结果中。' : '输入时间步固定；若超出稳定范围，计算会报错并要求调整。'}
              当前热求解优先用于小尺寸、低速案例；汽车与整机尺度散热仍需更细网格及后续验证。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
