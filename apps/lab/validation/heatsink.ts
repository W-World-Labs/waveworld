// 鳍片散热器自然对流端到端验证
//
// 走真实加载链路：generatePresetModel('heatsink') → voxelizeModel → 固体置恒温热源（flag 2）
// → D3Q19Solver 热模式（无来流，自由滑移壁面，与应用默认一致）跑 N 步。
// 检查：
//   ① 体素化结构：底座板近满填 + 鳍片高度处沿 z 数出 ~6 条分离鳍带；
//   ② 热羽流存在（鳍片上方 T > 均值且 u_y > 0）；
//   ③ 温度/速度有界，长时间不发散。
//
// 用法: npx tsx heatsink.ts [steps]
//   环境变量: NX NY NZ CC(模型特征格子数) GBETA(默认2e-4) TAU TAUT

import { create, globals } from 'webgpu';
import { D3Q19Solver } from '@w-sim/solvers-lbm/d3q19';
import { generatePresetModel } from '../src/lib/models/preset-models';
import { voxelizeModel } from '@w-sim/solvers-lbm/d3q19';

Object.assign(globalThis, globals as object);
const nav = { gpu: create([]) } as { gpu: GPU };

async function main() {
  const adapter = await nav.gpu.requestAdapter();
  if (!adapter) throw new Error('无法获取 GPU 适配器');
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
    },
  });
  console.log('Dawn 设备就绪');

  const nx = Number(process.env.NX ?? 128), ny = Number(process.env.NY ?? 64), nz = Number(process.env.NZ ?? 64);
  const cc = Number(process.env.CC ?? nx / 4);
  const gBeta = Number(process.env.GBETA ?? 2e-4);
  const tau = Number(process.env.TAU ?? 0.8);
  const tauT = Number(process.env.TAUT ?? 1.0);
  const steps = Number(process.argv[2] ?? 20000);

  // ---- 真实加载链路：预设几何 → 体素化 ----
  const { geometry } = generatePresetModel('heatsink');
  const voxel = voxelizeModel({ geometry, nx, ny, nz, characteristicCells: cc, angleOfAttackDeg: 0 });
  const flags = voxel.flags;
  console.log(`体素化: 实心格子 ${voxel.solidCells}，迎风投影 ${voxel.frontalAreaCells} 格`);

  // 模型几何常数（与 preset-models.generateHeatSink 同步）
  const H = 0.032, LB = 0.09; // 总高、特征长
  const scale = cc / LB;
  const placeX = nx / 3, placeY = ny / 2, placeZ = nz / 2;
  const cy = 0.016; // 包围盒中心 y
  const fidx = (x: number, y: number, z: number) => z * nx * ny + y * nx + x;

  // 检查①a：底座板中部近满填（底座 y∈[0,0.007]，中面格）
  const gyBase = Math.floor(placeY + (0.0035 - cy) * scale);
  const gx0 = Math.ceil(placeX - 0.045 * scale), gx1 = Math.floor(placeX + 0.045 * scale);
  const gz0 = Math.ceil(placeZ - 0.0315 * scale), gz1 = Math.floor(placeZ + 0.0315 * scale);
  let baseSolid = 0, baseTotal = 0;
  for (let z = gz0; z <= gz1; z++)
    for (let x = gx0; x <= gx1; x++) {
      baseTotal++;
      if (flags[fidx(x, gyBase, z)] === 1) baseSolid++;
    }
  const baseFill = baseSolid / baseTotal;

  // 检查①b：鳍片中高（y=0.0195）处沿 z 的实心条带数（应 ≈ 6）
  const gyFin = Math.floor(placeY + (0.0195 - cy) * scale);
  const gxC = Math.floor(placeX);
  let bands = 0, inBand = false;
  for (let z = gz0 - 2; z <= gz1 + 2; z++) {
    const s = flags[fidx(gxC, gyFin, z)] === 1;
    if (s && !inBand) { bands++; inBand = true; }
    if (!s) inBand = false;
  }
  console.log(`结构检查: 底座填充率=${(baseFill * 100).toFixed(1)}%（>80%?）  鳍带数=${bands}（5~7?）  底座格行 y=${gyBase} 鳍片格行 y=${gyFin}`);
  const structurePass = baseFill > 0.8 && bands >= 5 && bands <= 7;

  // ---- 热模式：固体 → 恒温热源 ----
  for (let i = 0; i < flags.length; i++) if (flags[i] === 1) flags[i] = 2;

  const solver = new D3Q19Solver(device, {
    nx, ny, nz,
    uInlet: 0,
    tau,
    smagorinskyCs: 0,
    turbulenceIntensity: 0,
    freeSlipWalls: true,
    flags,
    thermal: { gravityBeta: gBeta, tauT, tAmbient: 0, tHot: 1 },
  });

  // 鳍顶上方探针（鳍顶 y≈0.032 → 格，探针再高 6 格）
  const gyProbe = Math.min(ny - 1, Math.floor(placeY + (H - cy) * scale) + 6);
  const gzC = Math.floor(placeZ);
  const probe = (T: Float32Array, u: Float32Array, y: number) => {
    const i = fidx(gxC, y, gzC);
    return { T: T[i], uy: u[i * 3 + 1] };
  };

  const t0 = performance.now();
  const EVERY = 5000;
  let stats = { tMean: 0, tMax: 0, uMax: 0, nan: false };
  for (let s = 0; s < steps; s++) {
    solver.step();
    if ((s + 1) % EVERY === 0) {
      const [T, u] = await Promise.all([solver.readTemperature(), solver.readVelocity()]);
      let tSum = 0, n = 0;
      stats = { tMean: 0, tMax: 0, uMax: 0, nan: false };
      for (let i = 0; i < nx * ny * nz; i++) {
        if (flags[i] !== 0) continue;
        const speed = Math.hypot(u[i * 3], u[i * 3 + 1], u[i * 3 + 2]);
        if (Number.isNaN(T[i]) || Number.isNaN(speed)) stats.nan = true;
        tSum += T[i]; n++;
        stats.tMax = Math.max(stats.tMax, T[i]);
        stats.uMax = Math.max(stats.uMax, speed);
      }
      stats.tMean = tSum / n;
      const p = probe(T!, u!, gyProbe);
      const rate = (((s + 1) / (performance.now() - t0)) * 1000).toFixed(0);
      console.log(
        `步数 ${s + 1}/${steps} (${rate} 步/秒)  T均值=${stats.tMean.toFixed(4)} T最大=${stats.tMax.toFixed(3)} u最大=${stats.uMax.toFixed(4)}` +
        `  鳍顶上方: T=${p.T.toFixed(3)} u_y=${p.uy.toExponential(2)}`
      );
    }
  }

  console.log('\n========== 鳍片散热器验证结果 ==========');
  const [T, u] = await Promise.all([solver.readTemperature(), solver.readVelocity()]);
  const plume = probe(T!, u!, gyProbe);
  const flowPass = !stats.nan && stats.uMax < 0.3 && stats.uMax > 1e-4 && plume.uy > 1e-3 && plume.T > stats.tMean;
  console.log(
    `结构: 底座填充率 ${(baseFill * 100).toFixed(1)}%  鳍带数 ${bands}  => ${structurePass ? 'PASS' : 'FAIL'}`
  );
  console.log(
    `热羽流: NaN=${stats.nan}  u最大=${stats.uMax.toFixed(4)}(∈(1e-4,0.3)?)  鳍顶上方 u_y=${plume.uy.toExponential(2)}(>0?)  ` +
    `鳍顶上方 T=${plume.T.toFixed(3)}(>均值 ${stats.tMean.toFixed(3)}?) => ${flowPass ? 'PASS' : 'FAIL'}`
  );
  console.log(`总体 => ${structurePass && flowPass ? 'PASS' : 'FAIL'}`);

  solver.destroy();
  device.destroy();
  process.exit(structurePass && flowPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
