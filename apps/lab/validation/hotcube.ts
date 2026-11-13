// 热方块自然对流羽流冒烟测试（服务器被动散热的最小原型）
//
// 封闭绝热腔体底部中央放一个恒温热方块，空气受热上升形成羽流。
// 检查：羽流存在（方块上方 u_y>0）、温度场有界、长时间稳定不发散。
//
// 用法: npx tsx hotcube.ts [steps]
//   环境变量: NX NY NZ L(方块边长,默认16) GBETA(默认2e-4) TAU TAUT

import { create, globals } from 'webgpu';
import { D3Q19Solver } from '@w-sim/solvers-lbm/d3q19';

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
  const L = Number(process.env.L ?? 16);
  const gBeta = Number(process.env.GBETA ?? 2e-4);
  const tau = Number(process.env.TAU ?? 0.8);
  const tauT = Number(process.env.TAUT ?? 1.0);
  const steps = Number(process.argv[2] ?? 30000);
  const nu = (tau - 0.5) / 3, alpha = (tauT - 0.5) / 4;
  console.log(`Ra_L=${((gBeta * L ** 3) / (nu * alpha)).toExponential(2)}  自由落体速度尺度=${Math.sqrt(gBeta * L).toFixed(3)}`);

  const flags = new Uint8Array(nx * ny * nz);
  const fidx = (x: number, y: number, z: number) => z * nx * ny + y * nx + x;
  // 六面绝热壁
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (x < 2 || x >= nx - 2 || y < 2 || y >= ny - 2 || z < 2 || z >= nz - 2) flags[fidx(x, y, z)] = 1;
      }
  // 底部中央的恒温热方块（坐地）
  const x0 = Math.floor(nx / 2 - L / 2), z0 = Math.floor(nz / 2 - L / 2);
  for (let z = z0; z < z0 + L; z++)
    for (let y = 2; y < 2 + L; y++)
      for (let x = x0; x < x0 + L; x++) flags[fidx(x, y, z)] = 2;

  const solver = new D3Q19Solver(device, {
    nx, ny, nz,
    uInlet: 0,
    tau,
    smagorinskyCs: 0,
    turbulenceIntensity: 0,
    freeSlipWalls: false,
    flags,
    thermal: { gravityBeta: gBeta, tauT, tAmbient: 0, tHot: 1 },
  });

  const cx = Math.floor(nx / 2), cz = Math.floor(nz / 2);
  const probe = (T: Float32Array, u: Float32Array, y: number) => {
    const i = fidx(cx, y, cz);
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
      const p1 = probe(T!, u!, 2 + L + 4), p2 = probe(T!, u!, Math.floor(ny / 2));
      const rate = (((s + 1) / (performance.now() - t0)) * 1000).toFixed(0);
      console.log(
        `步数 ${s + 1}/${steps} (${rate} 步/秒)  T均值=${stats.tMean.toFixed(4)} T最大=${stats.tMax.toFixed(3)} u最大=${stats.uMax.toFixed(4)}` +
        `  方块顶+4: T=${p1.T.toFixed(3)} u_y=${p1.uy.toExponential(2)}  腔中: T=${p2.T.toFixed(3)} u_y=${p2.uy.toExponential(2)}`
      );
    }
  }

  console.log('\n========== 热方块冒烟结果 ==========');
  const [T, u] = await Promise.all([solver.readTemperature(), solver.readVelocity()]);
  const plume = probe(T!, u!, 2 + L + 4);
  const pass = !stats.nan && stats.uMax < 0.3 && stats.uMax > 1e-3 && plume.uy > 1e-3 && plume.T > stats.tMean;
  console.log(
    `NaN=${stats.nan}  u最大=${stats.uMax.toFixed(4)}(∈(0.001,0.3)?)  方块上方 u_y=${plume.uy.toExponential(2)}(>0?)  ` +
    `方块上方 T=${plume.T.toFixed(3)}(>均值 ${stats.tMean.toFixed(3)}?) => ${pass ? 'PASS' : 'FAIL'}`
  );

  solver.destroy();
  device.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
