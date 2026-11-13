// 自然对流（散热）标定：瑞利-贝纳尔对流（无头运行，不经过浏览器）
//
// 物理：底部恒温加热、顶部恒温冷却的封闭腔体，浮力与黏滞/热扩散竞争。
//   Ra < Ra_c ≈ 1708 : 纯导热，Nu = 1（无对流）
//   Ra > Ra_c        : 对流胞发展，Nu > 1
//   Ra = g·β·ΔT·H³ / (ν·α)，Nu = 1 + H·⟨u_y·T⟩ / (α·ΔT)（体平均）
//
// 用法: npx tsx thermal.ts [steps]
//   环境变量: NX NY NZ RA(默认4000) TAU(默认0.8) TAUT(默认1.0) PERT(默认1，初始温度扰动)

import { create, globals } from 'webgpu';
import { D3Q19Solver } from '@w-sim/solvers-lbm/d3q19';

Object.assign(globalThis, globals as object);
const nav = { gpu: create([]) } as { gpu: GPU };

const W7 = [1 / 4, 1 / 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8];

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

  const nx = Number(process.env.NX ?? 104), ny = Number(process.env.NY ?? 52), nz = Number(process.env.NZ ?? 56);
  const Ra = Number(process.env.RA ?? 4000);
  const tau = Number(process.env.TAU ?? 0.8);
  const tauT = Number(process.env.TAUT ?? 1.0);
  const steps = Number(process.argv[2] ?? 60000);

  const nu = (tau - 0.5) / 3;   // 运动黏度
  const alpha = (tauT - 0.5) / 4; // 热扩散率（D3Q7 cs²=1/4）
  const H = ny - 4;              // 流体层高度（上下各 2 格恒温壁）
  const dT = 1.0;
  const gBeta = (Ra * nu * alpha) / (dT * H ** 3);
  console.log(`Ra=${Ra}  ν=${nu.toFixed(4)}  α=${alpha.toFixed(4)}  H=${H}  gβ=${gBeta.toExponential(3)}  扩散时间=${(H * H / alpha).toFixed(0)}步`);

  // 封闭腔体：上下恒温板（2热/3冷），四周绝热固体
  const flags = new Uint8Array(nx * ny * nz);
  const fidx = (x: number, y: number, z: number) => z * nx * ny + y * nx + x;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (y < 2) flags[fidx(x, y, z)] = 2;        // 底部热板 T=1
        else if (y >= ny - 2) flags[fidx(x, y, z)] = 3; // 顶部冷板 T=0
        else if (x < 2 || x >= nx - 2 || z < 2 || z >= nz - 2) flags[fidx(x, y, z)] = 1;
      }

  const solver = new D3Q19Solver(device, {
    nx, ny, nz,
    uInlet: 0,
    tau,
    smagorinskyCs: 0,
    turbulenceIntensity: 0,
    freeSlipWalls: false,
    flags,
    thermal: { gravityBeta: gBeta, tauT, tAmbient: 0, tHot: dT },
  });

  // 初始温度扰动（失稳种子：线性导热剖面 + 1% 随机）
  if (process.env.PERT !== '0') {
    const g0init = new Float32Array(nx * ny * nz * 7);
    for (let z = 2; z < nz - 2; z++)
      for (let y = 2; y < ny - 2; y++)
        for (let x = 2; x < nx - 2; x++) {
          const tLin = dT * (1 - (y - 1.5) / H); // 导热初值
          const t = tLin + dT * 0.01 * (Math.random() * 2 - 1);
          const base = fidx(x, y, z) * 7;
          for (let i = 0; i < 7; i++) g0init[base + i] = W7[i] * t;
        }
    // 恒温板内按各自温度填充（无所谓，collide 会钉死）
    device.queue.writeBuffer((solver as any).g0Buffer, 0, g0init);
  }

  // 诊断：流体内部的 Nu 与最大垂直速度
  const interior = (T: Float32Array, u: Float32Array) => {
    let conv = 0, n = 0, uMax = 0;
    for (let z = 2; z < nz - 2; z++)
      for (let y = 2; y < ny - 2; y++)
        for (let x = 2; x < nx - 2; x++) {
          const i = fidx(x, y, z);
          const uy = u[i * 3 + 1];
          conv += uy * T[i];
          uMax = Math.max(uMax, Math.abs(uy));
          n++;
        }
    const nu_ = 1 + (H * (conv / n)) / (alpha * dT);
    return { Nu: nu_, uMax };
  };

  const t0 = performance.now();
  const EVERY = 5000;
  let last = { Nu: 1, uMax: 0 };
  for (let s = 0; s < steps; s++) {
    solver.step();
    if ((s + 1) % EVERY === 0) {
      const [T, u] = await Promise.all([solver.readTemperature(), solver.readVelocity()]);
      last = interior(T!, u!);
      const rate = (((s + 1) / (performance.now() - t0)) * 1000).toFixed(0);
      console.log(`步数 ${s + 1}/${steps} (${rate} 步/秒)  Nu=${last.Nu.toFixed(4)}  u_y_max=${last.uMax.toExponential(3)}`);
    }
  }

  // 最终水平均温剖面（导热应为线性，对流会把中段拉平）
  const T = (await solver.readTemperature())!;
  console.log('\ny 方向水平均温剖面（流体层）:');
  for (let y = ny - 3; y >= 2; y -= 4) {
    let sum = 0, n = 0;
    for (let z = 2; z < nz - 2; z++) for (let x = 2; x < nx - 2; x++) { sum += T[fidx(x, y, z)]; n++; }
    console.log(`  y=${String(y).padStart(3)}  T=${(sum / n).toFixed(4)}`);
  }

  // 判据
  console.log('\n========== 热标定结果 ==========');
  const Rac = 1708;
  if (Ra < Rac) {
    const pass = last.Nu > 0.9 && last.Nu < 1.15;
    console.log(`Ra=${Ra} < ${Rac}（亚临界）: Nu=${last.Nu.toFixed(4)} 期望≈1  u_y_max=${last.uMax.toExponential(2)} => ${pass ? 'PASS' : 'FAIL'}`);
  } else {
    const pass = last.Nu > 1.15 && last.Nu < 3.0 && last.uMax > 1e-3;
    console.log(`Ra=${Ra} > ${Rac}（超临界）: Nu=${last.Nu.toFixed(4)} 期望>1.15  u_y_max=${last.uMax.toExponential(2)} => ${pass ? 'PASS' : 'FAIL'}`);
  }

  solver.destroy();
  device.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
