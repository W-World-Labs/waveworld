'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/lib/stores/project-store';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { createActiveFlowJobSpec } from '@/lib/models/sim-session';
import { inspectBrowserMacGrid } from '../../../../../src/lib/sim/browser-agent';
import type { MacGridInspection } from '../../../../../src/lib/sim/mac-inspection';

export function MacGridCheck() {
  const { activeModel, uploadedModels } = useProjectStore();
  const parameters = useSimulationStore(store => store.parameters);
  const running = useSimulationStore(store => store.state.isRunning);
  const geometry = uploadedModels.find(model => model.metadata.id === activeModel?.id)?.geometry;
  const setup = useMemo(() => {
    try { return { spec: createActiveFlowJobSpec(parameters, activeModel), error: null }; }
    catch (error) { return { spec: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [parameters, activeModel]);
  const inputKey = JSON.stringify(setup.spec);
  const controller = useRef<AbortController | null>(null);
  const [inspection, setInspection] = useState<{
    key: string; geometry: typeof geometry; pending: boolean; report?: MacGridInspection; error?: string;
  } | null>(null);
  // Discard work on input changes, solving transitions or component unmount.
  useEffect(() => () => { controller.current?.abort(); }, [inputKey, geometry, running]);
  const current = inspection?.key === inputKey && inspection.geometry === geometry ? inspection : null;
  const report = current?.report;
  const check = async () => {
    if (!setup.spec || !geometry || running) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setInspection({ key: inputKey, geometry, pending: true });
    try {
      const report = await inspectBrowserMacGrid(setup.spec, geometry, abort.signal);
      if (!abort.signal.aborted) setInspection({ key: inputKey, geometry, pending: false, report });
    } catch (error) {
      if (!abort.signal.aborted) setInspection({ key: inputKey, geometry, pending: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (abort.signal.aborted && controller.current === abort) setInspection(current => current?.pending ? null : current);
    }
  };
  return <div className="space-y-2 rounded border border-zinc-700 p-3 text-xs" aria-label="计算网格检查">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={!geometry || !setup.spec || running || current?.pending} onClick={() => void check()}>
        {current?.pending ? '正在检查网格…' : '检查计算网格'}
      </Button>
      {current?.pending && <Button size="sm" variant="ghost" onClick={() => { controller.current?.abort(); setInspection(null); }}>取消检查</Button>}
    </div>
    <p className="text-zinc-400">在本机检查实际体素与组件位置，不推进时间、不发布任务。修改输入后需重新检查。</p>
    {setup.error && <p role="status" className="text-amber-300">{setup.error}</p>}
    {current?.error && <div role="alert" className="space-y-1 text-amber-300"><p>网格检查未通过：{current.error}</p>
      <p>检查风扇是否穿入固体或彼此重叠、材料区域是否包含固体网格，以及配置热阻的两个区域是否相邻。</p></div>}
    {report && <div className="space-y-3" role="status" aria-label="网格检查结果">
      <p>离散布置检查完成 · 固体 {report.solidCells.toLocaleString()} 格 / 流体 {report.fluidCells.toLocaleString()} 格 · dx {(report.dxMeters * 1000).toPrecision(4)} mm</p>
      {!!report.fans.length && <details open><summary className="cursor-pointer font-medium">风扇有效圆盘</summary>
        <div className="mt-2 space-y-2">{report.fans.map((fan, index) => <div key={index} className="space-y-1">
          <p>{fan.name} · 直径 {fan.diameterCells.toPrecision(4)} 格</p>
          <p className="text-zinc-300">有效面积 {(fan.areaM2 * 1e6).toPrecision(4)} mm²（{fan.faceCount} 面），相对输入圆面积偏差 {(fan.areaErrorRatio * 100).toFixed(2)}%</p>
          <p className="text-zinc-400">沿模型坐标正轴的位置偏移 {(fan.normalOffsetMeters * 1000).toPrecision(4)} mm。</p>
        </div>)}</div>
      </details>}
      {!report.fans.length && <p className="text-amber-300">未配置风扇；本方法没有入口来流或热浮力，静止空气不会自行产生风。</p>}
      {report.fixedTemperature && <p>恒温固体 {report.fixedTemperature.cells.toLocaleString()} 格 · {report.fixedTemperature.temperatureC} °C；恒温边界未指定输入功率。</p>}
      {!!report.materials.length && <details open><summary className="cursor-pointer font-medium">材料与热源分配</summary>
        <div className="mt-2 space-y-2">{report.materials.map(material => <p key={material.index}>{material.name} · {material.cells.toLocaleString()} 格 · {(material.volumeM3 * 1e9).toPrecision(4)} mm³ · {material.totalPowerW} W</p>)}</div>
        <p className="mt-2 text-zinc-400">功率均分到各自区域的固体体素；默认材料功率作用于全部未分区实体。</p>
      </details>}
      {!!report.contacts.length && <details open><summary className="cursor-pointer font-medium">配置的热阻界面</summary>
        <div className="mt-2 space-y-2">{report.contacts.map((contact, index) => <p key={index}>{report.materials[contact.first].name} ↔ {report.materials[contact.second].name}：{contact.faces} 面 · {(contact.areaM2 * 1e6).toPrecision(4)} mm² · {contact.resistanceM2KW} m²·K/W</p>)}</div>
        <p className="mt-2 text-zinc-400">只统计共享网格面；未配置接触热阻的相邻材料仍按零接触热阻导热。</p>
      </details>}
      <p className="text-amber-300">此检查不证明网格精度、时间步稳定性或稳态收敛；圆盘面积和位置偏差会影响计算。</p>
    </div>}
  </div>;
}
