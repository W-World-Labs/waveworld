'use client';

import { useMemo, useState } from 'react';
import type { JobResultV1 } from '@w-sim/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { summarizeFlowSnapshot, flowHasTemperature, flowPressureOffset } from '@/lib/cfd/flow-snapshot';
import { summarizeMacFlowSnapshot } from '@/lib/cfd/mac-flow-snapshot';
import { TrendingUp, Activity, Wind, Thermometer } from 'lucide-react';

function ForceHistory({ result }: { result: JobResultV1 | null }) {
  const [showForces, setShowForces] = useState(false);
  const [selection, setSelection] = useState<{ result: JobResultV1; index: number } | null>(null);
  const history = result?.history, dt = result?.derived?.dt;
  const coefficients = !!history?.cd?.length || !!history?.cl?.length;
  const forcesAvailable = !!history?.dragN?.length || !!history?.liftN?.length || !!history?.sideN?.length;
  const forceMode = showForces || !coefficients;
  const chart = useMemo(() => {
    const steps = history?.step;
    if (!Array.isArray(steps) || !steps.length || typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return null;
    let previous = 0;
    for (const step of steps) {
      if (!Number.isSafeInteger(step) || step <= previous || step > (result?.summary.steps ?? 0) || !Number.isFinite(step * dt)) return null;
      previous = step;
    }
    const quantities = forceMode ? [
      { key: 'dragN', label: '阻力', color: '#fb923c' },
      { key: 'liftN', label: '升力', color: '#22d3ee' },
      { key: 'sideN', label: '侧向力', color: '#a78bfa' },
    ] : [{ key: 'cd', label: 'Cd', color: '#fb923c' }, { key: 'cl', label: 'Cl', color: '#22d3ee' }];
    const series = quantities.flatMap(quantity => history?.[quantity.key] === undefined ? [] : [{ ...quantity, values: history[quantity.key]! }]);
    if (!series.length || series.some(({ values }) => !Array.isArray(values) || values.length !== steps.length || values.some(value => !Number.isFinite(value)))) return null;
    let low = Infinity, high = -Infinity;
    for (const { values } of series) for (const value of values) { low = Math.min(low, value); high = Math.max(high, value); }
    const padding = (high - low || Math.abs(high) || 1) * 0.05;
    low -= padding; high += padding;
    if (!Number.isFinite(high - low) || high <= low) return null;
    const first = steps[0] * dt, last = steps[steps.length - 1] * dt;
    const x = (index: number) => first === last ? 182 : 64 + (steps[index] * dt - first) / (last - first) * 236;
    const y = (value: number) => 128 - (value - low) / (high - low) * 104;
    return { steps, first, last, low, high, x, y, series: series.map(series => ({ ...series,
      path: series.values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(' '),
    })) };
  }, [history, dt, result, forceMode]);
  const steps = chart?.steps ?? [];
  const index = selection?.result === result ? Math.min(selection.index, steps.length - 1) : steps.length - 1;
  const unit = forceMode ? 'N' : '无量纲';
  return <Card className="bg-zinc-900/50 border-zinc-800" aria-label="气动力时序">
    <CardHeader className="p-4">
      <CardTitle className="text-sm text-white flex items-center gap-2"><TrendingUp className="w-4 h-4" />气动力变化曲线</CardTitle>
    </CardHeader>
    <CardContent className="p-4 pt-0 space-y-3">
      <div className="flex gap-2 text-xs">
        <button type="button" aria-pressed={!forceMode} disabled={!coefficients} className="rounded border border-zinc-700 px-2 py-1 aria-pressed:bg-cyan-800 disabled:opacity-40"
          onClick={() => setShowForces(false)}>力系数</button>
        <button type="button" aria-pressed={forceMode} disabled={!forcesAvailable} className="rounded border border-zinc-700 px-2 py-1 aria-pressed:bg-cyan-800 disabled:opacity-40"
          onClick={() => setShowForces(true)}>作用力（N）</button>
      </div>
      {chart && result && typeof dt === 'number' ? <>
        <svg viewBox="0 0 320 168" className="w-full rounded border border-zinc-800 bg-zinc-950" role="img" aria-label={`气动力时序图，${chart.first.toPrecision(4)} 至 ${chart.last.toPrecision(4)} 秒，${steps.length} 个采样点，${unit}`}>
          <text x="64" y="14" fill="#a1a1aa" fontSize="10">{unit}</text>
          {[0, 0.5, 1].map(fraction => <g key={fraction}>
            <line x1="64" x2="300" y1={24 + fraction * 104} y2={24 + fraction * 104} stroke="#27272a" />
            <text x="59" y={27 + fraction * 104} textAnchor="end" fill="#a1a1aa" fontSize="9">{(chart.high - fraction * (chart.high - chart.low)).toPrecision(3)}</text>
            <text x={64 + fraction * 236} y="143" textAnchor="middle" fill="#a1a1aa" fontSize="9">{(chart.first + fraction * (chart.last - chart.first)).toPrecision(3)}</text>
          </g>)}
          <text x="182" y="160" textAnchor="middle" fill="#a1a1aa" fontSize="10">物理时间（s）</text>
          {chart.series.map(series => <path key={series.key} data-quantity={series.key} d={series.path} fill="none" stroke={series.color} strokeWidth="1.5" />)}
          <line x1={chart.x(index)} x2={chart.x(index)} y1="24" y2="128" stroke="#71717a" strokeDasharray="3 3" />
          {chart.series.map(series => <circle key={series.key} cx={chart.x(index)} cy={chart.y(series.values[index])} r="3" fill={series.color} />)}
        </svg>
        <input type="range" min={0} max={steps.length - 1} step={1} value={index} disabled={steps.length < 2} aria-label="气动力采样点"
          className="w-full accent-cyan-300 disabled:opacity-40" onChange={event => setSelection({ result, index: event.currentTarget.valueAsNumber })} />
        <div className="space-y-1 text-xs" aria-label="气动力采样值">
          <p className="text-zinc-300">第 {steps[index]} 步 · 物理时间 {(steps[index] * dt).toPrecision(6)} s · 样本 {index + 1}/{steps.length}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">{chart.series.map(series => <span key={series.key} style={{ color: series.color }}>{series.label} {series.values[index].toPrecision(5)} {unit}</span>)}</div>
        </div>
        <p className="text-xs text-zinc-400">显示全部 {steps.length} 个已保存样本，横轴为采样时刻。当前求解器保存区间平均值；查看样本不改变最终结果。</p>
      </> : <p className="text-xs text-zinc-400">未保存有效的气动力时序，或缺少采样步数与物理时间步长；无法绘制物理时间曲线。</p>}
    </CardContent>
  </Card>;
}

export function ResultsPanel() {
  const { state, results, parameters, derived } = useSimulationStore();
  const savedUnits = results.job?.result.derived;
  const flow = useMemo(() => results.flowSnapshot ? 'fields' in results.flowSnapshot
    ? summarizeMacFlowSnapshot(results.flowSnapshot, derived) : summarizeFlowSnapshot(results.flowSnapshot,
      { ...derived, pressureScalePa: savedUnits?.pressureScalePa ?? derived?.pressureScalePa }) : null,
    [results.flowSnapshot, derived, savedUnits]);
  const savedPressure = !!results.flowSnapshot && ('fields' in results.flowSnapshot || flowPressureOffset(results.flowSnapshot) !== null);
  const savedTemperature = !!results.flowSnapshot && ('fields' in results.flowSnapshot ? results.flowSnapshot.displayStride === 5 : flowHasTemperature(results.flowSnapshot));
  const mac = results.flowSnapshot ? 'fields' in results.flowSnapshot : derived?.['mac-3d-v1'] === 1;
  const savedMassBalance = results.job?.result.lbmMassBalance;
  const massBalance = savedMassBalance?.scope === 'internal-fluid-x' &&
    ['initialMassKg', 'finalMassKg', 'inletMassKg', 'outletMassKg', 'collisionMassChangeKg',
      'balanceResidualKg', 'maxAbsStepBalanceResidualKg', 'boundaryFinalMassKg',
      'inletReconstructionMassKg', 'outletReconstructionMassKg'].every(key => {
        const value = savedMassBalance[key as keyof typeof savedMassBalance];
        return typeof value === 'number' && Number.isFinite(value);
      }) ? savedMassBalance : null;
  const hasCoefficients = state.dragCoefficient !== null || state.liftCoefficient !== null;
  if (state.isRunning && !results.job) return (
    <div className="p-5 text-sm leading-relaxed text-zinc-400" role="status">
      <p className="font-medium text-zinc-100">{results.flowSnapshot ? '计算中流场预览' : '等待第一组计算结果'}</p>
      <p className="mt-2">{results.flowSnapshot
        ? `正在显示第 ${results.flowSnapshot.step} 步的中间流场，计算尚未完成。最终指标和回放将在完整结果校验后显示。`
        : '计算完成后，这里将显示流场、温度和气动力结果。'}</p>
    </div>
  );
  if (state.currentIteration === 0 && !results.flowSnapshot) return (
    <div className="p-5 text-sm leading-relaxed text-zinc-400">
      <p className="font-medium text-zinc-100">{state.isRunning ? '等待第一组计算结果' : '尚未计算'}</p>
      <p className="mt-2">选择模型、设置输入，再点击“开始计算”。这里将显示流场、温度和气动力结果。</p>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {derived?.precision && <p className="text-xs text-zinc-400">数值表示：{derived.precision === 'float32' ? 'FP32' : derived.precision === 'float64' ? 'FP64' : derived.precision === 'mixed' ? 'FP32 / FP64 混合' : derived.precision}</p>}
      {!mac && <p className="text-xs text-zinc-400" aria-label="受力参考">{derived?.['lbm-gauge-force-v1'] === 1
        ? '气动力已扣除参考静压，地面反力单独排除。'
        : '此结果未记录参考静压修正；贴地模型的升力可能含参考静压载荷，请重新计算后比较。'}</p>}
      {derived && <div className="rounded-lg border border-zinc-800 p-3 space-y-2 text-xs" aria-label="本次物性">
        <p className={derived.viscosityMode === 'stabilized-preview' ? 'text-amber-300' : 'text-zinc-300'}>{mac ? '真实物性：MAC 使用输入黏度与时间步，不调整物性。' : derived.viscosityMode === 'stabilized-preview'
          ? '流动演示（调整黏度）：实际雷诺数由模拟黏度决定，不能将本结果当作目标工况的风阻预测。'
          : derived.viscosityMode === 'physical' ? '真实物性：本次使用输入黏度。' : '此结果未记录物性模式。'}</p>
        {!mac && <p className="text-zinc-300">目标 Re {derived.reynoldsPhysical.toExponential(3)} · 实际 Re {derived.reynoldsLattice.toExponential(3)}</p>}
        {derived.requestedViscosityM2s !== undefined && derived.simulatedViscosityM2s !== undefined && <p className="text-zinc-400">运动黏度：输入 {derived.requestedViscosityM2s.toExponential(3)} / 模拟 {derived.simulatedViscosityM2s.toExponential(3)} m²/s。</p>}
      </div>}
      {derived && !mac && <div className="rounded-lg border border-zinc-800 p-3 space-y-2 text-xs text-zinc-300" aria-label="本次地面">
        {derived['lbm-ground-v1'] === 1 && derived.groundMode ? <>
          <p>{derived.groundMode === 'moving' ? '随来流移动地面' : '固定地面'} · 速度 {derived.groundVelocityMps} m/s（+X）</p>
          <p>模型最低点距地面 {derived.groundClearanceM} m（含轮胎）。</p>
          {results.thermal && <p className="text-zinc-400">地面绝热；不计算黏性耗散生热。</p>}
        </> : <p>本次未设置道路地面，模型位于流域中心偏上游。</p>}
      </div>}
      {flow && <Card className="bg-zinc-900/50 border-zinc-800" aria-label="最终流场结果">
        <CardHeader className="p-4">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Thermometer className="w-4 h-4" />最终流场
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3 text-xs">
          <div className="flex justify-between gap-2"><span className="text-zinc-400">流体最高速度</span>
            <span className="font-mono text-cyan-300">{flow.maxSpeedMps === null ? '缺少速度单位' : `${flow.maxSpeedMps.toPrecision(4)} m/s`}</span></div>
          <div className="flex justify-between gap-2" aria-label="流体表压范围"><span className="text-zinc-400">流体表压范围</span>
            <span className="font-mono text-cyan-300">{flow.pressurePa ? `${flow.pressurePa.min.toPrecision(4)}–${flow.pressurePa.max.toPrecision(4)} Pa` : !savedPressure ? '未保存表压场' : '缺少保存单位或流体数据'}</span></div>
          {savedTemperature && <>
            <div className="flex justify-between gap-2"><span className="text-zinc-400">流体温度范围</span>
              <span className="font-mono text-orange-300">{flow.fluidTemperatureC ? `${flow.fluidTemperatureC.min.toFixed(2)}–${flow.fluidTemperatureC.max.toFixed(2)} °C` : '缺少温度刻度或流体数据'}</span></div>
            <div className="flex justify-between gap-2"><span className="text-zinc-400">模型温度范围</span>
              <span className="font-mono text-orange-300">{flow.solidTemperatureC ? `${flow.solidTemperatureC.min.toFixed(2)}–${flow.solidTemperatureC.max.toFixed(2)} °C` : '缺少温度刻度或固体数据'}</span></div>
            <p className="text-zinc-400">{mac ? '文件直接保存摄氏温度；绝热掩膜不参与温度统计。' : '温度使用本次结果保存的刻度，统计包括全部流体和模型单元。'}</p>
            {flow.solidRegions.some((region) => region.flag > 4) && <table className="w-full text-left" aria-label="部件温度">
              <thead className="text-zinc-400"><tr><th scope="col">部件</th><th scope="col">最高温度</th><th scope="col">体积</th></tr></thead>
              <tbody>{flow.solidRegions.map((region) => <tr key={region.flag}>
                <th scope="row" className="py-1 font-normal">{region.flag === 4 ? '其余固体' : parameters.thermalRegions?.[region.flag - 5]?.name || `区域 ${region.flag - 4}`}</th>
                <td className="font-mono text-orange-300">{region.temperatureC ? `${region.temperatureC.max.toFixed(3)} °C` : '—'}</td>
                <td className="font-mono">{region.volumeM3 === null ? '—' : `${(region.volumeM3 * 1e9).toPrecision(3)} mm³`}</td>
              </tr>)}</tbody>
            </table>}
          </>}
          <p className="text-zinc-400">第 {results.flowSnapshot?.step} 步 · {state.currentTime.toPrecision(4)} s。达到指定步数不代表已收敛。</p>
        </CardContent>
      </Card>}
      {mac && results.job?.result.mac && <Card className="bg-zinc-900/50 border-zinc-800" aria-label="风扇工作点">
        <CardHeader className="p-4"><CardTitle className="text-sm text-white">风扇工作点</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-3 text-xs">
          <p className="text-zinc-400">最后一步施力前采样（{((results.job.result.summary.steps - 1) * (derived?.dt ?? 0)).toPrecision(4)} s），使用圆盘有效网格面流量。尚未证明达到稳态工作点。</p>
          {results.job.result.mac.fans.map(fan => <div key={fan.name} className="space-y-1">
            <p className="text-zinc-200">{fan.name}</p>
            <p className="font-mono text-cyan-300">Q {fan.flowM3s.toPrecision(4)} m³/s · Δp {fan.pressureRisePa.toPrecision(4)} Pa</p>
            <p className="text-zinc-400">体力 {fan.forceN.toPrecision(4)} N · 有效面积 {fan.areaM2.toPrecision(4)} m²（{fan.faceCount} 面）</p>
          </div>)}
          {!results.job.result.mac.fans.length && <p className="text-zinc-400">本次未设置风扇。</p>}
        </CardContent>
      </Card>}
      {results.thermal && <Card className="bg-zinc-900/50 border-zinc-800" aria-label="热量收支">
        <CardHeader className="p-4"><CardTitle className="text-sm text-white">热量收支</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-2 text-xs">
          <p className="text-zinc-400">{results.thermal.mode === 'solid-power' ? '材料导热与发热功率' : '指定模型表面温度'} · 固体体积 {results.thermal.solidVolumeM3.toPrecision(4)} m³</p>
          {([
            ['当前相对热能', results.thermal.thermalEnergyJ],
            ['累计功率输入', results.thermal.sourceEnergyJ],
            ['累计边界输入（含散热）', results.thermal.boundaryEnergyJ],
            ['累计能量残差', results.thermal.energyResidualJ],
            ['单步最大绝对残差', results.thermal.maxAbsEnergyResidualJ],
          ] as const).map(([label, value]) => <div key={label} className="flex justify-between gap-2">
            <span className="text-zinc-400">{label}</span><span className="font-mono text-orange-300">{value.toPrecision(4)} J</span>
          </div>)}
          <p className="text-zinc-400">边界输入为正表示吸热，为负表示散热。每步最多 {results.thermal.thermalSubsteps} 个热子步；能量残差用于检查守恒，不代表结果已收敛。</p>
        </CardContent>
      </Card>}
      {/* 气动力系数仅在本次结果有定义时显示。 */}
      {hasCoefficients && <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader className="p-4">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Wind className="w-4 h-4" />
            气动力系数
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">升力系数 (Cl)</span>
            <span className="text-sm text-cyan-400 font-mono font-semibold">
              {state.liftCoefficient !== null ? state.liftCoefficient.toFixed(4) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">阻力系数 (Cd)</span>
            <span className="text-sm text-orange-400 font-mono font-semibold">
              {state.dragCoefficient !== null ? state.dragCoefficient.toFixed(4) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">力矩系数 (Cm)</span>
            <span className="text-sm text-purple-400 font-mono font-semibold">
              未计算
            </span>
          </div>
          
          <Separator className="bg-zinc-800" />
          
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">升阻比 (L/D)</span>
            <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20">
              {state.liftCoefficient !== null && state.dragCoefficient !== null && state.dragCoefficient !== 0 ? (state.liftCoefficient / state.dragCoefficient).toFixed(2) : '—'}
            </Badge>
          </div>
        </CardContent>
      </Card>}
      {!mac && !hasCoefficients && <p className="text-xs text-zinc-400">本次结果未提供力系数。入口速度为 0 时系数不适用；作用力仍以 N 显示。</p>}

      {!mac && <ForceHistory result={results.job?.result ?? null} />}

      {/* 力与力矩 */}
      {!mac && <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader className="p-4">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Activity className="w-4 h-4" />
            力与力矩
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-zinc-400">升力:</span>
              <div className="text-white font-mono mt-1">
                {results.forces.lift !== null ? `${results.forces.lift.toPrecision(5)} N` : '—'}
              </div>
            </div>
            <div>
              <span className="text-zinc-400">阻力:</span>
              <div className="text-white font-mono mt-1">
                {results.forces.drag !== null ? `${results.forces.drag.toPrecision(5)} N` : '—'}
              </div>
            </div>
            <div>
              <span className="text-zinc-400">侧向力:</span>
              <div className="text-white font-mono mt-1">
                {results.forces.side !== null ? `${results.forces.side.toPrecision(5)} N` : '未计算'}
              </div>
            </div>
            <div>
              <span className="text-zinc-400">力矩:</span>
              <div className="text-white font-mono mt-1">
                {results.forces.moment
                  ? `[${results.forces.moment.map(m => m.toFixed(2)).join(', ')}]`
                  : '未计算'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>}

      {/* 状态信息 */}
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader className="p-4">
          <CardTitle className="text-sm text-white">求解状态</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-zinc-400">运行状态:</span>
            <Badge
              variant="outline"
              className={
                state.isRunning
                  ? state.isPaused
                    ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                    : 'bg-green-500/10 text-green-400 border-green-500/20'
                  : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
              }
            >
              {state.isRunning ? (state.isPaused ? '已暂停' : '运行中') : '已结束，保留结果'}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">当前迭代:</span>
            <span className="text-white font-mono">{state.currentIteration}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">仿真时间:</span>
            <span className="text-white font-mono">{state.currentTime.toPrecision(4)} s</span>
          </div>
        </CardContent>
      </Card>

      <details className="rounded-lg border border-zinc-800 px-4 text-xs text-zinc-400">
        <summary className="cursor-pointer py-3 text-zinc-200">模型与验证范围</summary>
        <div className="space-y-2 pb-4 leading-relaxed">
          {savedPressure && <p>流体表压相对固定参考，不是绝对大气压；不能据此直接推算模型总气动力。</p>}
          {!mac && <div className="space-y-2" aria-label="质量收支">
            {massBalance ? <>
              <p className="text-zinc-200">内部流体质量收支（kg）</p>
              <p>覆盖第 1 至 {results.job?.result.summary.steps} 步，包含预热阶段；不含进出口的数值边界层。</p>
              <dl className="space-y-1">{([
                ['初始质量', massBalance.initialMassKg], ['最终质量', massBalance.finalMassKg],
                ['入口累计净流入', massBalance.inletMassKg], ['出口累计净流出', massBalance.outletMassKg],
                ['碰撞累计质量变化', massBalance.collisionMassChangeKg], ['累计收支残差', massBalance.balanceResidualKg],
                ['单步最大绝对残差', massBalance.maxAbsStepBalanceResidualKg], ['边界层最终质量', massBalance.boundaryFinalMassKg],
                ['入口累计重构量', massBalance.inletReconstructionMassKg], ['出口累计重构量', massBalance.outletReconstructionMassKg],
              ] as const).map(([label, value]) => <div key={label} className="flex justify-between gap-2">
                <dt>{label}</dt><dd className="font-mono text-zinc-300">{value.toExponential(4)}</dd>
              </div>)}</dl>
              <p>净传输按实际分布函数跨截面统计；边界重构量单列。残差包含数值运算误差，不代表流场已收敛或工程精度。</p>
            </> : <p>{savedMassBalance === undefined ? '本次结果未记录质量收支。' : '本次质量收支记录不完整，无法显示。'}</p>}
          </div>}
          <p>{mac ? 'MAC 使用常密度层流动量方程与压力投影。风扇依据输入静压曲线产生体力，传热采用面速度输运和材料接触导热；未接入转子、湍流、热浮力或辐射。' : <>低马赫数流动采用 D3Q19 格子玻尔兹曼方法。{results.thermal ? '热计算耦合流体热输运、固体导热和 Boussinesq 热浮力。' : ''}当前模型不含辐射换热。</>}</p>
          <p>{mac ? '固定固体表面无滑移；外域开口为零表压，其余面固定无滑移且绝热。风扇使用体力盘，不计算叶轮转动。' : '模型表面固定无滑移，车轮尚未旋转；地面条件以本次结果记录为准。'}</p>
          <p>{mac ? '流场显示最后一步，回放仅切换保存帧。此方法尚未提供模型气动力与 Cd/Cl。' : '作用力和系数是最近采样区间的平均；流场显示最后一步。'}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {!mac && <a className="text-cyan-300 underline" href="/method-depth?m=method-lattice-boltzmann" target="_blank" rel="noopener noreferrer">LBM 方法说明</a>}
            {results.thermal && <a className="text-cyan-300 underline" href="/method-depth?m=method-fourier-law" target="_blank" rel="noopener noreferrer">傅里叶导热说明</a>}
          </div>
          {derived && <p>本次空间步长 {derived.dx.toPrecision(4)} m；时间步长 {derived.dt.toPrecision(4)} s。FP32 / FP64 表示数值的存储和运算方式，不保证物理误差。</p>}
          {results.thermal && <p>材料热参数来自本次输入，尚未绑定测量来源与不确定度。修改模型或参数会清除当前显示的结果，重新计算后生成新记录。</p>}
          <p>本次结果未附带网格与时间步收敛报告、实验对照或形式化证明。计算完成和守恒残差只说明各自检查的范围。</p>
        </div>
      </details>
    </div>
  );
}
