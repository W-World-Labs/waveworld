/**
 * 最小 OpenFOAM 算例提取器（浏览器端，纯正则）。
 *
 * 只读纯文本字典：system/controlDict、constant/(physical|transport)Properties、
 * constant/(turbulenceProperties|momentumTransport)、0/U、system/blockMeshDict。
 * polyMesh、场数据与非均匀/表达式边界不在本模块范围内——完整保真解析在
 * w-sim 的 @w-sim/openfoam-import；这里为 Lab「OpenFOAM」入口提供
 * 轻量 IR + 支持度分类（可求解 / 近似 / 不支持）+ JobSpecV1 生成。
 * 此 Lab 读取器独立于该包，不做 include 预处理；包源码的 include 能力
 * 不代表 Lab UI、已部署版本或 pinned 版本支持该行为。
 */

import {
  JOB_SPEC_SCHEMA_VERSION,
  LBM_GAUGE_FORCE_FEATURE,
  LBM_MASS_BALANCE_FEATURE,
  LBM_NEE_INLET_FEATURE,
  LBM_NEE_OUTLET_FEATURE,
  LBM_PRESSURE_FIELD_FEATURE,
  type FluidJobSpecV1,
} from '@w-sim/contracts';

// ---------------------------------------------------------------------------
// 文件收集
// ---------------------------------------------------------------------------

const NUM = '-?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?';
/** 单个字典文件超过此大小直接跳过（OpenFOAM 字典都是小文本）。 */
const MAX_DICT_BYTES = 512 * 1024;

/** 识别的算例文件（后缀匹配，路径统一小写化）。 */
const FILE_SUFFIXES = {
  controlDict: ['system/controldict'],
  blockMeshDict: ['system/blockmeshdict'],
  physical: ['constant/physicalproperties', 'constant/transportproperties'],
  turbulence: ['constant/turbulenceproperties', 'constant/momentumtransport'],
  U: ['0/u'],
  T: ['0/t'],
} as const;

/** 仅统计存在性、不解析的辅助文件（fvSchemes 等）。 */
const KNOWN_EXTRA_SUFFIXES = [
  '0/p', '0/k', '0/epsilon', '0/omega', '0/nut', '0/alphat',
  'system/fvschemes', 'system/fvsolution', 'system/decomposepardict', 'constant/g',
];

export interface FoamCaseSource {
  /** 归一化相对路径（小写）→ 文件文本，仅含识别到的字典。 */
  texts: Map<string, string>;
  /** 选择器给出的全部文件路径（归一化小写）。 */
  allPaths: string[];
}

function normalizePath(file: File): string {
  return (file.webkitRelativePath || file.name)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}

function matchesSuffix(path: string, suffix: string): boolean {
  return path === suffix || path.endsWith('/' + suffix);
}

/**
 * 读取目录选择器（webkitdirectory）或多选给出的文件。
 * 只为识别到的字典读取文本，其余文件仅记录路径。
 */
export async function readFoamCaseFiles(files: File[]): Promise<FoamCaseSource> {
  const texts = new Map<string, string>();
  const allPaths: string[] = [];
  const wanted = [
    ...Object.values(FILE_SUFFIXES).flat(),
    ...KNOWN_EXTRA_SUFFIXES,
  ];
  for (const file of files) {
    const path = normalizePath(file);
    allPaths.push(path);
    if (file.size > MAX_DICT_BYTES) continue;
    if (!wanted.some((suffix) => matchesSuffix(path, suffix))) continue;
    // 同名（如 0/U 与备份目录里的）取先出现者，通常即算例根目录下那份。
    if (texts.has(path)) continue;
    texts.set(path, await file.text());
  }
  return { texts, allPaths };
}

// ---------------------------------------------------------------------------
// 字典文本提取（regex-based，非完整 OpenFOAM 语法解析）
// ---------------------------------------------------------------------------

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/** `key [dims] 1e-5;` / `key 0.5;` → number；允许 key 与值之间夹一个词（如 `nu nu [...]`）。 */
function scalarEntry(text: string, key: string): number | null {
  const re = new RegExp(
    `\\b${key}\\s+(?:[A-Za-z_][\\w]*\\s+)?(?:\\[[^\\]]*\\]\\s*)?(${NUM})\\s*;`,
  );
  const m = text.match(re);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** `key word;` → word。 */
function wordEntry(text: string, key: string): string | null {
  const m = text.match(new RegExp(`\\b${key}\\s+([A-Za-z_][\\w.]*)\\s*;`));
  return m ? m[1] : null;
}

/** 提取 `keyword` 后第一个配对的 `{…}` / `(…)` 块内容。 */
function extractBraced(
  text: string,
  keyword: string,
  open: '{' | '(',
): string | null {
  const close = open === '{' ? '}' : ')';
  const at = text.search(new RegExp(`\\b${keyword}\\b`));
  if (at < 0) return null;
  const start = text.indexOf(open, at);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === open) depth++;
    else if (c === close && --depth === 0) return text.slice(start + 1, i);
  }
  return null;
}

export interface FoamPatchBC {
  patchName: string;
  /** 原始 type（fixedValue / zeroGradient / cyclic …）。 */
  type: string;
  /** fixedValue 的 uniform 载荷：三元矢量或标量；非均匀/表达式为 'nonuniform'。 */
  value?: [number, number, number] | number | 'nonuniform';
}

export interface FoamBlockMeshInfo {
  blockCount: number;
  /** 各 hex block 中每轴最大单元数。 */
  cellCount: [number, number, number] | null;
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
  patchTypes: { name: string; type: string }[];
}

export interface FoamCaseFileStatus {
  key: string;
  label: string;
  /** 命中的相对路径；未找到为 null。 */
  path: string | null;
  required: boolean;
}

export interface ParsedFoamCase {
  /** 算例目录名（webkitRelativePath 的首段），单文件多选时为 null。 */
  caseName: string | null;
  solver: string | null;
  startTime: number | null;
  endTime: number | null;
  deltaT: number | null;
  /** 运动黏度 m²/s（OpenFOAM incompressible 的 nu）。 */
  nu: number | null;
  rho: number | null;
  /** simulationType：laminar / RAS / LES。 */
  turbulenceModel: string | null;
  turbulenceModelName: string | null;
  patches: FoamPatchBC[];
  mesh: FoamBlockMeshInfo | null;
  /** 0/T 存在（热算例 → 不支持）。 */
  temperatureField: boolean;
  recognizedExtras: string[];
  files: FoamCaseFileStatus[];
}

function findPath(paths: string[], suffixes: readonly string[]): string | null {
  for (const suffix of suffixes) {
    const hits = paths.filter((p) => matchesSuffix(p, suffix));
    if (hits.length) return hits.sort((a, b) => a.length - b.length)[0];
  }
  return null;
}

function parseUPatches(text: string): FoamPatchBC[] {
  const bf = extractBraced(text, 'boundaryField', '{');
  if (!bf) return [];
  const patches: FoamPatchBC[] = [];
  const blockRe = /([A-Za-z_][\w]*)\s*\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(bf))) {
    const name = m[1];
    const body = m[2];
    const type = wordEntry(body, 'type') ?? '';
    let value: FoamPatchBC['value'];
    const vec = body.match(
      new RegExp(`\\bvalue\\s+uniform\\s*\\(\\s*(${NUM})\\s+(${NUM})\\s+(${NUM})\\s*\\)`),
    );
    if (vec) {
      value = [Number(vec[1]), Number(vec[2]), Number(vec[3])];
    } else if (/\bvalue\s+nonuniform/i.test(body) || /\bvalue\s+[#$]/.test(body)) {
      value = 'nonuniform';
    } else {
      const scalar = body.match(new RegExp(`\\bvalue\\s+uniform\\s+(${NUM})\\s*;`));
      if (scalar) value = Number(scalar[1]);
    }
    patches.push({ patchName: name, type, value });
  }
  return patches;
}

function parseBlockMesh(text: string): FoamBlockMeshInfo {
  const scale = scalarEntry(text, 'convertToMeters') ?? scalarEntry(text, 'scale') ?? 1;

  const verticesSec = extractBraced(text, 'vertices', '(') ?? '';
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let vertexCount = 0;
  const vertexRe = new RegExp(`\\(\\s*(${NUM})\\s+(${NUM})\\s+(${NUM})\\s*\\)`, 'g');
  let vm: RegExpExecArray | null;
  while ((vm = vertexRe.exec(verticesSec))) {
    vertexCount++;
    for (let a = 0; a < 3; a++) {
      const c = Number(vm[a + 1]) * scale;
      if (c < min[a]) min[a] = c;
      if (c > max[a]) max[a] = c;
    }
  }

  const cellCount: [number, number, number] = [0, 0, 0];
  let blockCount = 0;
  const blockRe = /hex\s*\([^)]*\)\s*\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(text))) {
    blockCount++;
    for (let a = 0; a < 3; a++) {
      const n = Number(bm[a + 1]);
      if (n > cellCount[a]) cellCount[a] = n;
    }
  }

  const patchTypes: { name: string; type: string }[] = [];
  const boundarySec = extractBraced(text, 'boundary', '(') ?? '';
  const patchRe = /([A-Za-z_][\w]*)\s*\{([^{}]*)\}/g;
  let pm: RegExpExecArray | null;
  while ((pm = patchRe.exec(boundarySec))) {
    patchTypes.push({ name: pm[1], type: wordEntry(pm[2], 'type') ?? '' });
  }

  return {
    blockCount,
    cellCount: blockCount > 0 ? cellCount : null,
    bbox: vertexCount > 0 ? { min, max } : null,
    patchTypes,
  };
}

function parseTurbulence(text: string): { model: string | null; name: string | null } {
  const model = wordEntry(text, 'simulationType');
  // 新式：RAS { model kEpsilon; }；旧式：RASModel kEpsilon;
  let name: string | null = null;
  for (const section of ['RAS', 'LES']) {
    const block = extractBraced(text, section, '{');
    if (block) name = wordEntry(block, 'model') ?? name;
  }
  name = name ?? wordEntry(text, 'RASModel') ?? wordEntry(text, 'LESModel');
  return { model, name };
}

/** 解析已收集的算例文件为轻量 IR。 */
export function parseFoamCase(source: FoamCaseSource): ParsedFoamCase {
  const paths = [...source.texts.keys()];
  const pick = (suffixes: readonly string[]) => {
    const path = findPath(paths, suffixes);
    return path ? { path, text: stripComments(source.texts.get(path)!) } : { path: null, text: null };
  };

  const control = pick(FILE_SUFFIXES.controlDict);
  const blockMesh = pick(FILE_SUFFIXES.blockMeshDict);
  const physical = pick(FILE_SUFFIXES.physical);
  const turbulence = pick(FILE_SUFFIXES.turbulence);
  const uField = pick(FILE_SUFFIXES.U);
  const tField = pick(FILE_SUFFIXES.T);

  const application = control.text ? wordEntry(control.text, 'application') : null;
  const solverModule = control.text ? wordEntry(control.text, 'solver') : null;
  // foamRun 的求解模块写在 controlDict 的 solver 键里。
  const solver = application?.toLowerCase() === 'foamrun'
    ? (solverModule ?? application)
    : (application ?? solverModule);

  const turb = turbulence.text ? parseTurbulence(turbulence.text) : { model: null, name: null };

  const controlPath = control.path;
  const caseName = controlPath
    ? controlPath.replace(/\/?system\/controldict$/, '').split('/').pop() || null
    : null;

  return {
    caseName,
    solver,
    startTime: control.text ? scalarEntry(control.text, 'startTime') : null,
    endTime: control.text ? scalarEntry(control.text, 'endTime') : null,
    deltaT: control.text ? scalarEntry(control.text, 'deltaT') : null,
    nu: physical.text ? scalarEntry(physical.text, 'nu') : null,
    rho: physical.text ? scalarEntry(physical.text, 'rho') : null,
    turbulenceModel: turb.model,
    turbulenceModelName: turb.name,
    patches: uField.text ? parseUPatches(uField.text) : [],
    mesh: blockMesh.text ? parseBlockMesh(blockMesh.text) : null,
    temperatureField: tField.path !== null,
    recognizedExtras: KNOWN_EXTRA_SUFFIXES.filter((s) => findPath(paths, [s]) !== null),
    files: [
      { key: 'controlDict', label: 'system/controlDict', path: control.path, required: true },
      { key: 'physical', label: 'constant/physicalProperties 或 transportProperties', path: physical.path, required: true },
      { key: 'U', label: '0/U', path: uField.path, required: true },
      { key: 'blockMeshDict', label: 'system/blockMeshDict', path: blockMesh.path, required: false },
      { key: 'turbulence', label: 'constant/turbulenceProperties 或 momentumTransport', path: turbulence.path, required: false },
    ],
  };
}

// ---------------------------------------------------------------------------
// 支持度分类（与 w-sim @w-sim/openfoam-import 的分级口径一致的最小版）
// ---------------------------------------------------------------------------

export interface FoamDiagnostic {
  level: 'unsupported' | 'approximation' | 'note';
  path: string;
  message: string;
}

export type FoamSupport = 'solvable' | 'approximate' | 'unsupported';

export interface FoamClassification {
  support: FoamSupport;
  diagnostics: FoamDiagnostic[];
  /** 判定的 +x 入口速度（无 driving patch 时为 0）。 */
  inletVelocity: number;
  wallCondition: 'no-slip' | 'slip';
  smagorinskyCs: number;
  /** endTime/deltaT 换算或回退的步数。 */
  maxSteps: number;
  gridPreset: 'fast' | 'standard' | 'fine' | 'ultra';
  modelResolution: 'coarse' | 'standard' | 'high';
  gridN?: number;
}

/** 不可压缩单相求解器（其余 → 不支持）。 */
const INCOMPRESSIBLE_SOLVERS = new Set([
  'icofoam', 'pisofoam', 'pimplefoam', 'simplefoam',
  'foamrun', 'incompressiblefluid', 'fluid',
]);

/** 无对应边界的 patch 类型。 */
const UNSUPPORTED_PATCH_TYPES = new Set([
  'cyclic', 'cyclicami', 'symmetryplane', 'symmetry', 'wedge', 'processor', 'processorcyclic',
]);

const SUPPORTED_U_BC = new Set(['fixedvalue', 'zerogradient', 'noslip', 'slip', 'empty']);

/** 与 units.ts GRID_PRESETS / MODEL_RESOLUTIONS 同表（本模块不依赖求解器包）。 */
const GRID_PRESETS = [
  { id: 'fast', nx: 128 },
  { id: 'standard', nx: 160 },
  { id: 'fine', nx: 176 },
  { id: 'ultra', nx: 240 },
] as const;
const MODEL_RESOLUTIONS = [
  { id: 'coarse', ratio: 1 / 6 },
  { id: 'standard', ratio: 1 / 4 },
  { id: 'high', ratio: 1 / 3 },
] as const;
const characteristicCells = (presetNx: number, ratio: number) =>
  Math.max(8, Math.round(presetNx * ratio));

const FALLBACK_STEPS = 2000;
const MAX_PRODUCT_STEPS = 1_000_000;

type PatchClass = 'driving' | 'outlet' | 'wall' | 'slip-wall' | 'empty';

function solverHint(solver: string): string {
  const s = solver.toLowerCase();
  if (/inter|multiphase|vof|twoLiquid|swirl/i.test(solver)) return '（多相流）';
  if (/^rho|^sonic|^buoyant|compressible|reacting|spray|engine|Xi|PDR|cold|fire/i.test(solver)) return '（可压缩/燃烧）';
  if (/thermal|heat|thermo|cht/i.test(s)) return '（传热耦合）';
  return '';
}

/** 分类算例并解出 JobSpec 所需的参数。 */
export function classifyFoamCase(parsed: ParsedFoamCase): FoamClassification {
  const diagnostics: FoamDiagnostic[] = [];
  const diag = (level: FoamDiagnostic['level'], path: string, message: string) =>
    diagnostics.push({ level, path, message });

  // ---- controlDict / 求解器门槛 ----
  if (!parsed.solver) {
    diag('unsupported', 'system/controlDict', '缺少 controlDict 或 application/solver 键，无法判定求解器');
  } else if (!INCOMPRESSIBLE_SOLVERS.has(parsed.solver.toLowerCase())) {
    diag('unsupported', 'system/controlDict.application',
      `求解器 '${parsed.solver}'${solverHint(parsed.solver)}不是不可压缩单相求解器——当前仅支持 icoFoam/pisoFoam/pimpleFoam/simpleFoam/foamRun(incompressibleFluid)`);
  }

  if (parsed.temperatureField) {
    diag('unsupported', '0/T', '存在温度场——传热算例暂不支持');
  }

  // ---- 步数 ----
  let maxSteps = FALLBACK_STEPS;
  if (parsed.endTime !== null && parsed.deltaT !== null && parsed.endTime > 0 && parsed.deltaT > 0) {
    const steps = Math.ceil((parsed.endTime - Math.max(0, parsed.startTime ?? 0)) / parsed.deltaT);
    if (steps >= 1) {
      maxSteps = Math.min(steps, MAX_PRODUCT_STEPS);
      if (steps > MAX_PRODUCT_STEPS) {
        diag('approximation', 'system/controlDict',
          `endTime/deltaT 给出 ${steps} 步，超出单次上限，截断为 ${MAX_PRODUCT_STEPS}`);
      }
      diag('note', 'system/controlDict',
        'endTime/deltaT 只换算步数；LBM 的物理时间步由格子单位决定，不等于 OpenFOAM deltaT');
    } else {
      diag('approximation', 'system/controlDict', 'endTime/deltaT 无有效步数，使用默认步数');
    }
  } else {
    diag('approximation', 'system/controlDict',
      `缺少有效 endTime/deltaT，使用默认 maxSteps=${FALLBACK_STEPS}`);
  }

  // ---- 黏度 ----
  if (!(parsed.nu !== null && parsed.nu > 0)) {
    diag('unsupported', 'constant/physicalProperties.nu',
      `运动黏度 nu=${parsed.nu ?? '未找到'}——需要正的有限 nu（m²/s）`);
  }

  // ---- patch 类型门槛（blockMesh + 0/U） ----
  for (const p of parsed.mesh?.patchTypes ?? []) {
    if (UNSUPPORTED_PATCH_TYPES.has(p.type.toLowerCase())) {
      diag('unsupported', `system/blockMeshDict.boundary.${p.name}`,
        `patch 类型 '${p.type}' 无对应边界（cyclic/对称/wedge/并行分解不支持）`);
    }
  }

  // ---- 0/U 边界分类 ----
  type Classified = { bc: FoamPatchBC; cls: PatchClass; vector?: [number, number, number] };
  const classified: Classified[] = [];
  if (parsed.patches.length === 0) {
    diag('unsupported', '0/U', '未找到速度场边界条件');
  }
  for (const bc of parsed.patches) {
    const t = bc.type.toLowerCase();
    if (UNSUPPORTED_PATCH_TYPES.has(t)) {
      diag('unsupported', `0/U.boundaryField.${bc.patchName}`, `边界类型 '${bc.type}' 无对应边界`);
      continue;
    }
    if (!SUPPORTED_U_BC.has(t)) {
      diag('unsupported', `0/U.boundaryField.${bc.patchName}`, `速度边界 '${bc.type}' 暂不支持`);
      continue;
    }
    if (bc.value === 'nonuniform') {
      diag('unsupported', `0/U.boundaryField.${bc.patchName}`,
        `边界 '${bc.type}' 使用非均匀/表达式值——仅支持 uniform`);
      continue;
    }
    if (t === 'fixedvalue') {
      if (!Array.isArray(bc.value)) {
        diag('unsupported', `0/U.boundaryField.${bc.patchName}`, 'fixedValue 缺少均匀速度矢量');
        continue;
      }
      const v = bc.value;
      classified.push({ bc, cls: v.every((x) => x === 0) ? 'wall' : 'driving', vector: v });
      continue;
    }
    classified.push({
      bc,
      cls: t === 'zerogradient' ? 'outlet' : t === 'noslip' ? 'wall' : t === 'slip' ? 'slip-wall' : 'empty',
    });
  }

  const driving = classified.filter((p) => p.cls === 'driving');
  const outlets = classified.filter((p) => p.cls === 'outlet');
  const walls = classified.filter((p) => p.cls === 'wall' || p.cls === 'slip-wall');

  let inletVelocity = 0;
  if (driving.length > 1) {
    diag('unsupported', '0/U',
      `多个非零 fixedValue patch（${driving.map((p) => p.bc.patchName).join(', ')}）——风洞域只有单一入口面`);
  } else if (driving.length === 1) {
    const v = driving[0].vector!;
    const mag = Math.hypot(...v);
    if (v[0] <= 0) {
      diag('unsupported', `0/U.boundaryField.${driving[0].bc.patchName}`,
        `入口速度 (${v.join(' ')}) 无正流向分量——本产品入口只沿 +x`);
    } else {
      inletVelocity = v[0];
      if (mag - v[0] > 1e-9 * mag) {
        diag('approximation', `0/U.boundaryField.${driving[0].bc.patchName}`,
          `入口速度 (${v.join(' ')}) 含横向分量，投影到 +x（${v[0]} m/s）`);
      }
      if (outlets.length === 0) {
        diag('approximation', '0/U', '无 zeroGradient 出口 patch——产品流域始终施加 +x 压力出口');
      }
    }
  } else {
    diag('note', '0/U', '无非零 fixedValue patch——静止入口（inletVelocity=0）');
  }
  if (outlets.length > 0) {
    diag('note', '0/U',
      `zeroGradient 出口 ${outlets.map((p) => p.bc.patchName).join(', ')} 映射为产品 NEE 压力出口`);
  }

  // ---- 壁面 ----
  let wallCondition: 'no-slip' | 'slip' = 'no-slip';
  const slipWalls = walls.filter((p) => p.cls === 'slip-wall');
  if (walls.length > 0 && slipWalls.length === walls.length) {
    wallCondition = 'slip';
  } else if (slipWalls.length > 0) {
    diag('approximation', '0/U',
      `滑移壁 ${slipWalls.map((p) => p.bc.patchName).join(', ')} 并入全局 no-slip（不支持逐 patch 混合壁面）`);
  }

  // ---- 湍流模型 ----
  let smagorinskyCs = 0;
  const tmodel = (parsed.turbulenceModel ?? '').toLowerCase();
  const tname = parsed.turbulenceModelName ?? '未指定';
  if (tmodel === 'ras') {
    smagorinskyCs = 0.12;
    diag('approximation', 'constant/turbulenceProperties.simulationType',
      `RAS ${tname} 映射为 Smagorinsky LES（smagorinskyCs=0.12）——RAS 不是 LES 亚格子模型，k/epsilon/nut 场不映射`);
  } else if (tmodel === 'les') {
    smagorinskyCs = 0.12;
    diag('note', 'constant/turbulenceProperties.simulationType',
      `LES ${tname}：系数不随算例迁移，使用 smagorinskyCs=0.12`);
  } else if (tmodel === '' ) {
    diag('note', 'constant/turbulenceProperties', '未找到湍流模型声明——按层流处理');
  } else if (tmodel !== 'laminar') {
    diag('approximation', 'constant/turbulenceProperties.simulationType',
      `未知 simulationType '${parsed.turbulenceModel}'，按层流处理`);
  }

  // ---- blockMesh 域尺寸 / 网格匹配 ----
  let gridPreset: FoamClassification['gridPreset'] = 'standard';
  let modelResolution: FoamClassification['modelResolution'] = 'standard';
  let gridN: number | undefined;
  const mesh = parsed.mesh;
  if (!mesh || !mesh.bbox) {
    diag('note', 'system/blockMeshDict', '未找到 blockMeshDict 或顶点——计算域尺寸不可用');
  } else {
    const needed = mesh.cellCount ? Math.max(...mesh.cellCount) : 0;
    if (needed > 0) {
      gridN = needed;
      let best: { p: (typeof GRID_PRESETS)[number]; r: (typeof MODEL_RESOLUTIONS)[number]; cells: number } | null = null;
      for (const p of GRID_PRESETS) {
        for (const r of MODEL_RESOLUTIONS) {
          const cells = characteristicCells(p.nx, r.ratio);
          if (cells >= needed && (best === null || cells < best.cells)) best = { p, r, cells };
        }
      }
      if (best === null) {
        const p = GRID_PRESETS[GRID_PRESETS.length - 1];
        const r = MODEL_RESOLUTIONS[MODEL_RESOLUTIONS.length - 1];
        best = { p, r, cells: characteristicCells(p.nx, r.ratio) };
        diag('approximation', 'system/blockMeshDict',
          `最细网格每特征长度仅 ${best.cells} 格 < 算例 ${needed} 格`);
      }
      gridPreset = best.p.id;
      modelResolution = best.r.id;
    }
    if (mesh.patchTypes.some((p) => p.type.toLowerCase() === 'empty') ||
        (mesh.cellCount?.some((c) => c === 1) ?? false)) {
      diag('note', 'system/blockMeshDict', "'empty'/单元格轴标记 2D 算例——产品运行为 3D，展向壁面增加约束");
    }
  }

  const support: FoamSupport = diagnostics.some((d) => d.level === 'unsupported')
    ? 'unsupported'
    : diagnostics.some((d) => d.level === 'approximation')
      ? 'approximate'
      : 'solvable';

  return { support, diagnostics, inletVelocity, wallCondition, smagorinskyCs, maxSteps, gridPreset, modelResolution, gridN };
}

// ---------------------------------------------------------------------------
// JobSpecV1 生成（spec-only；执行需要体素掩码服务 / 模型几何）
// ---------------------------------------------------------------------------

/**
 * 生成 lbm-d3q19 JobSpecV1。分类为 unsupported 时返回 null。
 * model.inline 携带 openfoamCase 描述符——当前 agent 尚不能将其体素化，
 * 调用方应如实提示提交需要体素掩码服务，而不是假装可提交。
 */
export function buildOpenFoamJobSpec(
  parsed: ParsedFoamCase,
  cls: FoamClassification,
): FluidJobSpecV1 | null {
  if (cls.support === 'unsupported' || !(parsed.nu !== null && parsed.nu > 0)) return null;

  const rho = parsed.rho ?? 1.225;
  const span = parsed.mesh?.bbox
    ? parsed.mesh.bbox.max.map((v, i) => v - parsed.mesh!.bbox!.min[i]) as [number, number, number]
    : null;

  const spec: FluidJobSpecV1 = {
    schemaVersion: JOB_SPEC_SCHEMA_VERSION,
    kind: 'lbm-d3q19',
    name: `openfoam-${parsed.caseName ?? 'import'}`,
    model: {
      source: 'inline',
      ...(span && span[0] > 0 ? { referenceLength: span[0] } : {}),
      inline: {
        openfoamCase: true,
        meta: {
          solver: parsed.solver,
          turbulenceModel: parsed.turbulenceModel,
          turbulenceModelName: parsed.turbulenceModelName,
          domain: parsed.mesh?.bbox ? { ...parsed.mesh.bbox, span } : null,
          blockCount: parsed.mesh?.blockCount ?? 0,
          cellCount: parsed.mesh?.cellCount ?? null,
          patches: parsed.patches.map((p) => ({ name: p.patchName, type: p.type })),
        },
      },
    },
    parameters: {
      inletVelocity: cls.inletVelocity,
      angleOfAttack: 0,
      turbulenceIntensity: 0,
      smagorinskyCs: cls.smagorinskyCs,
      fluidDensity: rho,
      // parameters.fluidViscosity 为动力黏度（Pa·s）：OpenFOAM nu × rho。
      fluidViscosity: parsed.nu * rho,
      viscosityMode: 'physical',
      wallCondition: cls.wallCondition,
      gridPreset: cls.gridPreset,
      modelResolution: cls.modelResolution,
      ...(cls.gridN !== undefined ? { gridN: cls.gridN } : {}),
      thermalEnabled: false,
    },
    run: {
      maxSteps: cls.maxSteps,
      forceSampleEvery: 20,
      warmupSteps: Math.min(200, Math.floor(cls.maxSteps / 4)),
    },
    outputs: {
      forces: true,
      history: true,
      fields: ['velocity', 'vorticity', 'pressure'],
      fieldFrames: 1,
    },
    requirements: {
      backends: ['webgpu', 'cpu'],
      precision: 'float32',
      features: [
        LBM_GAUGE_FORCE_FEATURE,
        LBM_NEE_OUTLET_FEATURE,
        LBM_NEE_INLET_FEATURE,
        LBM_MASS_BALANCE_FEATURE,
        LBM_PRESSURE_FIELD_FEATURE,
      ],
    },
  };
  return spec;
}
