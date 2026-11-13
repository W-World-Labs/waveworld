// 汽车风洞端到端冒烟验收（无头运行，不经过浏览器）
//
// 对应 issue WaveWorld#112「汽车风洞端到端工作台算例及气动力结果验收」。
// 走真实加载链路：generatePresetModel('car') → voxelizeModel(groundClearanceCells)
// → D3Q19Solver(groundVelocityLattice)，即工作台「移动地面」算例（lbm-ground-v1）
// 的直接等价：y=0 为无滑移移动壁面，速度 = 入口来流（地面随来流运动）；
// 顶壁/侧壁自由滑移（应用默认 wallCondition='slip'）。
// 选 'car' 预设而非 ahmed-body：程序化几何为 y-up 且轮胎最低点在 y=0，
// 与 groundClearanceCells 放置口径直接绑定；ahmed-body 程序化几何是 z-up，
// 需要额外旋转才能落地面。
//
// 冒烟级断言（非工程标定；该预设几何无对应风洞实验参考值，不断言文献 Cd）：
//   ① 结构：体素化实心格>0、迎风投影>0、整车最低点在给定离地间隙附近、不出域；
//   ② 气动力：力历史全部有限（无 NaN/Inf），后半段 Cd 均值为正且量级合理——
//      Cd = Fx/(0.5·U²·A_front)（格子单位，ρ=1）。本用例 Re_L≈160、CC=32 粗网格，
//      钝体绕流 Cd 预期 O(1)，只要求宽松窗口 [0.05, 6]；
//      实测（Dawn lavapipe，800 步）移动地面 Cd_mean≈3.6、1600 步 ≈3.4，
//      尾流仍在瞬态衰减中——故窗口上界留足余量，只挡发散/符号错/NaN；
//   ③ 移动地面生效：来流上游 y=0 近地面流体 ux 被地面拖至 ≈U；
//      同几何固定地面对照的近地面 ux 明显更低（无滑移边界层），证明移动壁面生效；
//   ④ 流场有界：max|u|<0.3（低马赫），全场有限。
//
// #112 完整工程验收尚缺（本用例不覆盖）：
//   - ≥10s 物理时长长跑 + Cd 收敛窗口判定（run.stopWhen.maxCdVariance）；
//   - Ahmed 车体 Cd≈0.285（25° 斜背，SAE 840300）对比需换 ahmed-body 几何，
//     并按其参考面积/雷诺数口径对齐；
//   - 网格收敛性（CC≥64、域加长）与固定/移动地面阻力定量差异。
//
// 用法: npx tsx car.ts [steps]
//   环境变量: NX NY NZ CC(流向格子数,默认 nx/4) U(默认0.05) TAU(默认0.53)
//             CLEAR(最低点离地间隙格数,默认1) MODES(默认 "moving,stationary")

import { create, globals } from 'webgpu';
import { D3Q19Solver } from '@w-sim/solvers-lbm/d3q19';
import { generatePresetModel } from '../src/lib/models/preset-models';
import { voxelizeModel } from '@w-sim/solvers-lbm/d3q19';

Object.assign(globalThis, globals as object);
const nav = { gpu: create([]) } as { gpu: GPU };

type GroundMode = 'moving' | 'stationary';

interface CaseResult {
  mode: GroundMode;
  steps: number;
  cdMean: number;
  clMean: number;
  cdFinite: boolean;
  uxGround: number; // 车前方 y=0 行流体平均 ux
  maxU: number;
  fieldFinite: boolean;
  stepsPerSec: number;
  solidCells: number;
  frontalCells: number;
  minSolidX: number;
  maxSolidX: number;
  minSolidY: number;
  maxSolidY: number;
  massResidual: number | null;
}

const nx = Number(process.env.NX ?? 128), ny = Number(process.env.NY ?? 64), nz = Number(process.env.NZ ?? 64);
const cc = Number(process.env.CC ?? nx / 4); // 车长 4.5m → CC 格
const u = Number(process.env.U ?? 0.05);
const tau = Number(process.env.TAU ?? 0.53);
const clearance = Number(process.env.CLEAR ?? 1); // 轮胎最低点距地面格数（含轮胎，近似贴地带）
const nu = (tau - 0.5) / 3;
const reL = (u * cc) / nu;

// 体素化后扫描实心格范围（结构检查用）
function solidBounds(flags: Uint8Array) {
  let minX = nx, maxX = -1, minY = ny, maxY = -1;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (flags[z * nx * ny + y * nx + x] !== 1) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

async function runCase(device: GPUDevice, mode: GroundMode, steps: number): Promise<CaseResult> {
  // ---- 真实加载链路：预设几何 → 体素化（含地面间隙放置）----
  const { geometry } = generatePresetModel('car');
  const voxel = voxelizeModel({
    geometry, nx, ny, nz,
    characteristicCells: cc,
    angleOfAttackDeg: 0,
    groundClearanceCells: clearance,
  });
  const bounds = solidBounds(voxel.flags);
  console.log(
    `体素化: 实心 ${voxel.solidCells} 格，迎风投影 ${voxel.frontalAreaCells} 格，` +
    `实心 x∈[${bounds.minX},${bounds.maxX}] y∈[${bounds.minY},${bounds.maxY}]`
  );

  const solver = new D3Q19Solver(device, {
    nx, ny, nz,
    uInlet: u,
    tau,
    smagorinskyCs: Number(process.env.CS ?? 0.1),
    turbulenceIntensity: Number(process.env.TURB ?? 0.01),
    freeSlipWalls: true, // 与应用默认 wallCondition='slip' 一致；y=0 由地面边界接管
    groundVelocityLattice: mode === 'moving' ? u : 0, // 固定地面 = 无滑移 yMin 平面
    flags: voxel.flags,
  });

  const A = voxel.frontalAreaCells;
  const norm = 0.5 * u * u * A; // 格子单位 Cd = Fx / (0.5·ρ·U²·A)，ρ=1
  const cdHist: number[] = [];
  const clHist: number[] = [];
  let cdFinite = true;
  let massResidual: number | null = null;

  const READ_EVERY = 50;
  let pending = 0;
  const t0 = performance.now();
  for (let s = 0; s < steps; s++) {
    solver.step();
    pending++;
    if (pending >= READ_EVERY || s === steps - 1) {
      const raw = await solver.readForces();
      if (raw) {
        const cd = raw.fx / pending / norm;
        const cl = raw.fy / pending / norm;
        if (!Number.isFinite(cd) || !Number.isFinite(cl)) cdFinite = false;
        cdHist.push(cd);
        clHist.push(cl);
        if (raw.massBalance) massResidual = raw.massBalance.balanceResidual;
      }
      pending = 0;
    }
  }
  const elapsed = (performance.now() - t0) / 1000;

  // 流场读回：近地面速度（移动地面判别）+ 全局有界性
  const uField = await solver.readVelocity();
  let uxGround = 0, nGround = 0, maxU = 0, fieldFinite = true;
  if (uField) {
    const xCarFront = bounds.minX; // 车头最前格
    for (let z = 0; z < nz; z++) {
      for (let x = 2; x < xCarFront - 1; x++) {
        const i = z * nx * ny + 0 * nx + x; // y=0 行
        if (voxel.flags[i] !== 0) continue;
        const ux = uField[i * 3];
        if (!Number.isFinite(ux)) { fieldFinite = false; continue; }
        uxGround += ux;
        nGround++;
      }
    }
    uxGround = nGround > 0 ? uxGround / nGround : 0;
    for (let i = 0; i < nx * ny * nz; i++) {
      const m = Math.hypot(uField[i * 3], uField[i * 3 + 1], uField[i * 3 + 2]);
      if (!Number.isFinite(m)) fieldFinite = false;
      else if (m > maxU) maxU = m;
    }
  } else {
    fieldFinite = false;
  }

  solver.destroy();

  // 统计后半段（跳过启动瞬态）
  const half = Math.floor(cdHist.length / 2);
  const cdTail = cdHist.slice(Math.max(0, half));
  const clTail = clHist.slice(Math.max(0, half));
  const cdMean = cdTail.length ? cdTail.reduce((a, b) => a + b, 0) / cdTail.length : NaN;
  const clMean = clTail.length ? clTail.reduce((a, b) => a + b, 0) / clTail.length : NaN;

  return {
    mode, steps, cdMean, clMean, cdFinite, uxGround, maxU, fieldFinite,
    stepsPerSec: steps / elapsed,
    solidCells: voxel.solidCells, frontalCells: A,
    minSolidX: bounds.minX, maxSolidX: bounds.maxX,
    minSolidY: bounds.minY, maxSolidY: bounds.maxY,
    massResidual,
  };
}

function judgeStructure(r: CaseResult): { ok: boolean; text: string } {
  const resolved = r.solidCells > 0 && r.frontalCells > 0;
  // 轮胎最低点应落在给定离地间隙 ±1 格内；整车须在流域内部
  const placed = r.minSolidY >= 0 && r.minSolidY <= Math.ceil(clearance) + 1 &&
    r.maxSolidY <= ny - 2 && r.minSolidX >= 3 && r.maxSolidX <= nx - 4;
  const ok = resolved && placed;
  return {
    ok,
    text:
      `结构: 实心 ${r.solidCells} 格 迎风 ${r.frontalCells} 格 ` +
      `最低点 y=${r.minSolidY}（间隙 ${clearance}±1?） 最高点 y=${r.maxSolidY}(<${ny - 1}?） ` +
      `x∈[${r.minSolidX},${r.maxSolidX}]（内部?） => ${ok ? 'PASS' : 'FAIL'}`,
  };
}

function judgeAero(r: CaseResult): { ok: boolean; text: string } {
  // 冒烟窗口：只要求有限、正阻力、钝体量级。不断言文献值。
  const cdOk = r.cdFinite && Number.isFinite(r.cdMean) && r.cdMean >= 0.05 && r.cdMean <= 6;
  const fieldOk = r.fieldFinite && r.maxU > 0 && r.maxU < 0.3;
  const massOk = r.massResidual === null || Number.isFinite(r.massResidual);
  const ok = cdOk && fieldOk && massOk;
  return {
    ok,
    text:
      `气动力/流场: Cd_mean=${r.cdMean.toFixed(3)}∈[0.05,6]? Cl_mean=${r.clMean.toFixed(3)} ` +
      `全有限=${r.cdFinite} | max|u|=${r.maxU.toFixed(4)}∈(0,0.3)? 场有限=${r.fieldFinite}` +
      `${r.massResidual === null ? '' : ` | 质量残差=${r.massResidual.toExponential(2)}`} => ${ok ? 'PASS' : 'FAIL'}`,
  };
}

function judgeGround(moving: CaseResult, stationary: CaseResult | null): { ok: boolean; text: string } {
  // 移动地面：来流方向把 y=0 近地面流体拖到 ≈U；固定地面应明显更低
  const movingOk = moving.uxGround > 0.5 * u;
  let text = `移动地面: 上游 y=0 行 ux=${moving.uxGround.toFixed(4)}（>0.5·U=${(0.5 * u).toFixed(3)}?）`;
  let ok = movingOk;
  if (stationary) {
    const contrast = stationary.uxGround < moving.uxGround - 0.25 * u;
    text += ` | 固定地面对照 ux=${stationary.uxGround.toFixed(4)}（更低?）`;
    ok = ok && contrast;
  }
  return { ok, text: `${text} => ${ok ? 'PASS' : 'FAIL'}` };
}

async function main() {
  const adapter = await nav.gpu.requestAdapter();
  if (!adapter) throw new Error('无法获取 GPU 适配器');
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  console.log('Dawn 设备就绪');
  console.log(
    `网格 ${nx}×${ny}×${nz}，车长 ${cc} 格（dx≈${(4.5 / cc).toFixed(3)}m），` +
    `U=${u} tau=${tau}（Re_L≈${reL.toFixed(0)}），离地间隙 ${clearance} 格`
  );

  const steps = Number(process.argv[2] ?? process.env.STEPS ?? 800);
  const modes = (process.env.MODES ?? 'moving,stationary').split(',') as GroundMode[];

  const results: CaseResult[] = [];
  for (const mode of modes) {
    if (mode !== 'moving' && mode !== 'stationary') throw new Error(`未知地面模式: ${mode}`);
    console.log(`\n=== 地面模式 ${mode}，${steps} 步 ===`);
    results.push(await runCase(device, mode, steps));
  }

  console.log('\n========== 汽车风洞冒烟验收结果 ==========');
  let allPass = true;
  const moving = results.find((r) => r.mode === 'moving');
  const stationary = results.find((r) => r.mode === 'stationary') ?? null;
  for (const r of results) {
    console.log(
      `[${r.mode}] Cd=${r.cdMean.toFixed(3)} Cl_mean=${r.clMean.toFixed(3)} ` +
      `近地面ux=${r.uxGround.toFixed(4)} max|u|=${r.maxU.toFixed(4)} ` +
      `(${r.stepsPerSec.toFixed(0)} 步/秒, 实心 ${r.solidCells} 格, 迎风 ${r.frontalCells} 格)`
    );
    const s = judgeStructure(r);
    const a = judgeAero(r);
    console.log(`  ${s.text}`);
    console.log(`  ${a.text}`);
    allPass = allPass && s.ok && a.ok;
  }
  if (moving) {
    const g = judgeGround(moving, stationary);
    console.log(`  ${g.text}`);
    allPass = allPass && g.ok;
  }
  console.log(`总体 => ${allPass ? 'PASS' : 'FAIL'}（冒烟级，非工程验收）`);

  device.destroy();
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
