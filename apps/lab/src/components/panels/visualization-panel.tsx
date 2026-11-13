'use client';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { flowHasTemperature, flowPressureOffset } from '@/lib/cfd/flow-snapshot';

export function VisualizationPanel() {
  const { state, results, parameters, setVisualizationMode, updateParameters, setSlicePlane, setSlicePosition, setState } = useSimulationStore();
  const savedFlow = results.flowSnapshot;
  const savedMac = savedFlow ? 'fields' in savedFlow : parameters.flowMethod === 'mac';
  const pressureScale = results.job?.result.derived?.pressureScalePa;
  const hasPressure = !!savedFlow && ('fields' in savedFlow || (flowPressureOffset(savedFlow) !== null &&
    typeof pressureScale === 'number' && Number.isFinite(pressureScale) && pressureScale > 0));
  const hasTemperature = savedFlow ? 'fields' in savedFlow ? savedFlow.displayStride === 5 : flowHasTemperature(savedFlow) : parameters.thermalEnabled;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-white">可视化设置</h3>
      <p className="text-xs text-zinc-400">
        体渲染显示场（运行时实时切换）
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant={state.visualizationMode === 'velocity' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setVisualizationMode('velocity')}
          className={state.visualizationMode === 'velocity' ? 'bg-cyan-600 hover:bg-cyan-700' : 'border-zinc-700 text-zinc-300'}
        >
          速度幅值
        </Button>
        {!savedMac && <Button
          variant={state.visualizationMode === 'vorticity' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setVisualizationMode('vorticity')}
          className={state.visualizationMode === 'vorticity' ? 'bg-cyan-600 hover:bg-cyan-700' : 'border-zinc-700 text-zinc-300'}
        >
          涡量幅值
        </Button>}
        <Button size="sm" disabled={!hasPressure}
          variant={state.visualizationMode === 'pressure' ? 'default' : 'outline'}
          onClick={() => setVisualizationMode('pressure')}
          title={hasPressure ? '相对固定参考的机械表压，单位 Pa' : '此结果未保存可用的表压场或单位'}
          className={state.visualizationMode === 'pressure' ? 'bg-cyan-600 hover:bg-cyan-700' : 'border-zinc-700 text-zinc-300'}>
          流体表压{!hasPressure && '（未保存）'}
        </Button>
        {hasTemperature && (
          <Button
            variant={state.visualizationMode === 'temperature' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVisualizationMode('temperature')}
            className={state.visualizationMode === 'temperature' ? 'bg-orange-600 hover:bg-orange-700' : 'border-zinc-700 text-zinc-300'}
          >
            温度场
          </Button>
        )}
      </div>

      <div>
        <p className="text-xs text-zinc-400 mb-2">渲染精度（步进采样）</p>
        <div className="grid grid-cols-3 gap-2">
          {([['fine', '精细'], ['standard', '标准'], ['fast', '快速']] as const).map(([id, label]) => (
            <Button
              key={id}
              variant={parameters.renderQuality === id ? 'default' : 'outline'}
              size="sm"
              onClick={() => updateParameters({ renderQuality: id })}
              className={parameters.renderQuality === id ? 'bg-cyan-600 hover:bg-cyan-700' : 'border-zinc-700 text-zinc-300'}
            >
              {label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-zinc-400 mt-1">精细档画质更高但帧率更低</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-zinc-400">显示阈值（背景削减）</p>
          <span className="text-xs text-white font-mono">
            {(parameters.displayThreshold * 100).toFixed(0)}%
          </span>
        </div>
        <Slider
          value={[parameters.displayThreshold]}
          onValueChange={(value) => updateParameters({ displayThreshold: Array.isArray(value) ? value[0] : value })}
          min={0}
          max={0.5}
          step={0.01}
          className="w-full"
        />
        <p className="text-xs text-zinc-400 mt-1">低于该比例的背景场完全透明，调高突出羽流/涡核心</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400">显示流域边界</p>
          <p className="text-xs text-zinc-400 mt-1">打开可看到最外层边界格子（含入口噪声/角部伪影）</p>
        </div>
        <Switch
          checked={state.showBoundary}
          onCheckedChange={(checked) => setState({ showBoundary: checked })}
        />
      </div>

      <div>
        <p className="text-xs text-zinc-400 mb-2">剖切平面（切开流域看内部）</p>
        <div className="grid grid-cols-4 gap-2">
          {([['none', '关'], ['xy', 'XY'], ['yz', 'YZ'], ['xz', 'XZ']] as const).map(([id, label]) => (
            <Button
              key={id}
              variant={state.slicePlane === id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSlicePlane(id)}
              className={state.slicePlane === id ? 'bg-cyan-600 hover:bg-cyan-700' : 'border-zinc-700 text-zinc-300'}
            >
              {label}
            </Button>
          ))}
        </div>
        {state.slicePlane !== 'none' && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-zinc-400">剖切位置</p>
              <span className="text-xs text-white font-mono">
                {(state.slicePosition * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              value={[state.slicePosition]}
              onValueChange={(value) => setSlicePosition(Array.isArray(value) ? value[0] : value)}
              min={0}
              max={1}
              step={0.01}
              className="w-full"
            />
          </div>
        )}
        <p className="text-xs text-zinc-400 mt-1">从坐标较小的一侧切开模型，露出截面与内部流场；旋转相机不改变剖切方向。二维模式显示对应网格切片。</p>
      </div>
    </div>
  );
}
