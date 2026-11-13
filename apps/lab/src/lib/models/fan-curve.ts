import { validateMacFanCurve, type MacFanComponent } from '@w-sim/contracts';
import { useProjectStore } from '@/lib/stores/project-store';
import { useSimulationStore } from '@/lib/stores/simulation-store';

export const MAX_FAN_CURVE_CSV_BYTES = 64 * 1024;
export const FAN_CURVE_CSV_HEADER = 'flowM3PerSecond,pressurePa';

/** Small, comma-separated CSV profile; quoted fields are allowed, multiline fields are not. */
function csvRow(line: string, row: number): string[] {
  const field = /(?:"((?:[^"]|"")*)"|([^",]*))(,|$)/y;
  const cells: string[] = [];
  while (true) {
    const match = field.exec(line);
    if (!match) throw new Error(`CSV 第 ${row} 行格式无效；请使用逗号分隔，单个字段不要换行`);
    cells.push((match[1]?.replace(/""/g, '"') ?? match[2]).trim());
    if (!match[3]) return cells;
  }
}

/** Read explicit SI columns only. Extra provenance/unit columns never change the supplied SI data. */
export function parseMacFanCurveCsv(text: string): MacFanComponent['curve'] {
  if (new TextEncoder().encode(text).byteLength > MAX_FAN_CURVE_CSV_BYTES) throw new Error('风扇 CSV 最大 64 KiB');
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = csvRow(lines[0], 1);
  if (new Set(header).size !== header.length) throw new Error('CSV 表头不能重复');
  const flowColumns = header.flatMap((name, index) => name === 'flowM3PerSecond' || name === 'flowM3s' ? [index] : []);
  const pressure = header.indexOf('pressurePa');
  if (flowColumns.length !== 1 || pressure < 0) throw new Error(`CSV 需要明确 SI 表头 ${FAN_CURVE_CSV_HEADER}（m³/s、Pa）`);
  const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const curve = lines.slice(1).map((line, index) => {
    const cells = csvRow(line, index + 2);
    if (cells.length !== header.length || !number.test(cells[flowColumns[0]]) || !number.test(cells[pressure])) {
      throw new Error(`CSV 第 ${index + 2} 行需要完整数值；使用小数点和明确 SI 单位`);
    }
    return { flowM3s: Number(cells[flowColumns[0]]), pressurePa: Number(cells[pressure]) };
  });
  const check = validateMacFanCurve(curve);
  if (!check.ok) throw new Error(`P–Q 曲线无效：${check.message}`);
  return check.curve;
}

export function formatMacFanCurveCsv(curve: MacFanComponent['curve']): string {
  const check = validateMacFanCurve(curve);
  if (!check.ok) throw new Error(`P–Q 曲线无效：${check.message}`);
  return `${FAN_CURVE_CSV_HEADER}\r\n${check.curve.map(point => `${point.flowM3s},${point.pressurePa}`).join('\r\n')}\r\n`;
}

/** A file read may finish after editing or leaving the model. Only its exact original inputs may be replaced. */
export async function importMacFanCurveCsv(file: File, fan: MacFanComponent, signal: AbortSignal): Promise<MacFanComponent> {
  signal.throwIfAborted();
  if (!/\.csv$/i.test(file.name) || file.size < 1 || file.size > MAX_FAN_CURVE_CSV_BYTES) throw new Error('请选择不超过 64 KiB 的 .csv 文件');
  const project = useProjectStore.getState(), simulation = useSimulationStore.getState();
  const parameters = simulation.parameters, fans = parameters.macFans ?? [];
  const index = fans.indexOf(fan);
  if (parameters.flowMethod !== 'mac' || index < 0 || simulation.state.isRunning) throw new Error('当前风扇不可导入曲线；请停止计算后重试');
  const geometry = project.uploadedModels.find(model => model.metadata.id === project.activeModel?.id)?.geometry;
  let cancelled = false, cancelReason: unknown;
  let rejectCancelled: (reason: unknown) => void = () => {};
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const cancel = (reason: unknown) => { cancelled = true; cancelReason = reason; rejectCancelled(reason); };
  const changed = () => cancel(new Error('导入已取消：模型或参数已变化，请重新选择文件'));
  const abort = () => cancel(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const stopSimulation = useSimulationStore.subscribe(next => {
    if (next.parameters !== parameters || next.state.isRunning) changed();
  });
  const stopProject = useProjectStore.subscribe(next => {
    if (next.currentProject?.id !== project.currentProject?.id || next.activeModel !== project.activeModel ||
        next.uploadedModels.find(model => model.metadata.id === next.activeModel?.id)?.geometry !== geometry) changed();
  });
  let updated: MacFanComponent;
  try {
    const text = await Promise.race([file.text(), cancellation]);
    if (cancelled) throw cancelReason;
    signal.throwIfAborted();
    updated = { ...fan, curve: parseMacFanCurveCsv(text) };
  } finally {
    stopSimulation(); stopProject();
    signal.removeEventListener('abort', abort);
  }
  // No async boundary remains: this is still the same model, parameter object and fan occurrence.
  simulation.updateParameters({ macFans: fans.map((existing, i) => i === index ? updated : existing) });
  return updated;
}

export function downloadMacFanCurveCsv(fan: MacFanComponent): void {
  const csv = formatMacFanCurveCsv(fan.curve);
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  try {
    link.href = url;
    link.download = `${fan.name.replace(/[\\/:*?"<>|]/g, '_') || 'fan'}-pq.csv`;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Let the download consume the URL before releasing it on the next event-loop turn.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
