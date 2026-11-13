// 圆柱绕流标定（无头运行，不经过浏览器）
//
// 文献参考值（2D 圆柱绕流，Tritton / Braza et al.）：
//   Re=40 : 定常附着涡，Cd ≈ 1.5，无涡脱落（St ≈ 0）
//   Re=100: 卡门涡街，Cd ≈ 1.3-1.4，St ≈ 0.164
//   Re=200: 卡门涡街，Cd ≈ 1.3，    St ≈ 0.19-0.20
// 本计算为 3D 短展长 + 无滑移端壁，允许 ±20% 偏差判合格。
//
// 用法: npx tsx cylinder.ts [re] [steps]

import { create, globals } from 'webgpu';
import { D3Q19Solver } from '@w-sim/solvers-lbm/d3q19';
import { voxelizeModel } from '@w-sim/solvers-lbm/d3q19';
import type { ModelGeometry } from '../src/types/model';

Object.assign(globalThis, globals as object);
const nav = { gpu: create([]) } as { gpu: GPU };

// 封闭圆柱几何（轴沿 z，与来流 x 正交）
function cylinderGeometry(radius: number, height: number, segments = 24): ModelGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    vertices.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    vertices.push(Math.cos(a) * radius, Math.sin(a) * radius, height);
  }
  for (let i = 0; i < segments; i++) {
    const bl = i * 2, tl = i * 2 + 1, br = (i + 1) * 2, tr = (i + 1) * 2 + 1;
    indices.push(bl, br, tl, tl, br, tr);
  }
  // 端盖
  for (const z of [0, height]) {
    const center = vertices.length / 3;
    vertices.push(0, 0, z);
    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1) / segments) * Math.PI * 2;
      const v1 = vertices.length / 3;
      vertices.push(Math.cos(a1) * radius, Math.sin(a1) * radius, z);
      const v2 = vertices.length / 3;
      vertices.push(Math.cos(a2) * radius, Math.sin(a2) * radius, z);
      if (z === 0) indices.push(center, v2, v1);
      else indices.push(center, v1, v2);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(vertices.length),
    indices: new Uint32Array(indices),
  };
}

function cubeGeometry(side: number): ModelGeometry {
  const h = side / 2;
  const v = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const idx = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, // 底/顶
    0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, // 前/后
    1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3, // 右/左
  ];
  return {
    vertices: new Float32Array(v.flat()),
    normals: new Float32Array(v.length * 3),
    indices: new Uint32Array(idx),
  };
}

interface CaseResult {
  re: number;
  cdMean: number;
  clMean: number;
  clRms: number;
  strouhal: number;
  shedAmp: number;
  stepsPerSec: number;
  solidCells: number;
  frontalCells: number;
}

async function runCase(device: GPUDevice, re: number, steps: number): Promise<CaseResult> {
  const nx = Number(process.env.NX ?? 128), ny = Number(process.env.NY ?? 64), nz = Number(process.env.NZ ?? 64);
  const D = Number(process.env.D ?? 32); // 圆柱直径格子数
  const u = Number(process.env.U ?? 0.06); // 格子速度
  const nu = (u * D) / re;
  const tau = 3 * nu + 0.5;

  const geoKind = process.env.GEO ?? 'cylinder';
  const span = Number(process.env.SPAN ?? 0.5); // 圆柱展长（米，×scale 即格子数）
  let voxel: { flags: Uint8Array; solidCells: number; frontalAreaCells: number };
  if (geoKind === 'acylinder') {
    // 解析圆柱（标定专用：排除三角网格体素化误差）
    const flags = new Uint8Array(nx * ny * nz);
    const cx = nx / 3, cy = ny / 2 + Number(process.env.CY ?? 0), R = D / 2; // CY：横向偏置破对称
    const spanCells = Number(process.env.SPAN_CELLS ?? D); // 展长：默认 D，长展比 ≥4 才接近二维文献
    const z0 = Math.floor(nz / 2 - spanCells / 2), z1 = z0 + spanCells;
    let solid = 0;
    const front = new Uint8Array(ny * nz);
    for (let z = z0; z < z1; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= R * R) {
            flags[z * nx * ny + y * nx + x] = 1;
            front[z * ny + y] = 1;
            solid++;
          }
        }
      }
    }
    let frontal = 0;
    for (let i = 0; i < front.length; i++) frontal += front[i];
    voxel = { flags, solidCells: solid, frontalAreaCells: frontal };
  } else if (geoKind === 'channel') {
    // Poiseuille 测黏度：封闭上下两端只留中央槽道（x∈[8,nx-8)），缝高 H=48
    const flags = new Uint8Array(nx * ny * nz);
    const yLo = Math.floor(ny / 2) - 24, yHi = Math.floor(ny / 2) + 24; // 槽道 y∈[yLo, yHi)
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 8; x < nx - 8; x++) {
          if (y < yLo || y >= yHi) {
            flags[z * nx * ny + y * nx + x] = 1;
          }
        }
      }
    }
    let solid = 0;
    for (let i = 0; i < flags.length; i++) solid += flags[i];
    voxel = { flags, solidCells: solid, frontalAreaCells: 1 };
  } else {
    const geometry = geoKind === 'cube' ? cubeGeometry(0.25) : cylinderGeometry(0.5, span); // 直径 1m → D 格
    voxel = voxelizeModel({
      geometry, nx, ny, nz,
      characteristicCells: geoKind === 'cube' ? 8 : D,
      angleOfAttackDeg: 0,
    });
    if (geoKind === 'empty') voxel.flags.fill(0);
  }

  const turbBase = Number(process.env.TURB ?? 0.01);
  const kick = process.env.KICK === '1'; // 窗口期 25% 强扰动激发脱落（默认 3000-6000 步）
  const kickS = Number(process.env.KICK_S ?? 3000);
  const kickE = Number(process.env.KICK_E ?? 6000);
  const solver = new D3Q19Solver(device, {
    nx, ny, nz,
    uInlet: u,
    tau,
    smagorinskyCs: Number(process.env.CS ?? 0.1),
    turbulenceIntensity: kick && kickS === 0 ? 0.25 : turbBase,
    freeSlipWalls: process.env.FREESLIP === '1',
    flags: voxel.flags,
  });

  const A = voxel.frontalAreaCells;
  const norm = 0.5 * u * u * A; // 格子单位下 Cd = Fx / (0.5·ρ·U²·A)，ρ=1
  const cdHist: number[] = [];
  const clHist: number[] = [];

  // 尾流探针（热线的数值等价物）：测局部 uy 时序，避开展向积分相消
  const probe = process.env.PROBE === '1';
  const px = Math.floor(nx / 3 + D + 8), py = Math.floor(ny / 2 + D / 2 + 2), pz = Math.floor(nz / 2);
  const probeIdx = (pz * nx * ny + py * nx + px) * 3;
  const probeStaging = probe
    ? device.createBuffer({ size: 12, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
    : null;
  const uyHist: number[] = [];

  const READ_EVERY = 50;
  let pending = 0;
  const t0 = performance.now();

  for (let s = 0; s < steps; s++) {
    if (kick && s === kickS) solver.updateParams({ turbulenceIntensity: 0.25 });
    if (kick && s === kickE) solver.updateParams({ turbulenceIntensity: turbBase });
    solver.step();
    pending++;
    if (pending >= READ_EVERY) {
      if (probe && probeStaging) {
        const penc = device.createCommandEncoder();
        penc.copyBufferToBuffer((solver as any).uBuffer, probeIdx * 4, probeStaging, 0, 12);
        device.queue.submit([penc.finish()]);
        await probeStaging.mapAsync(GPUMapMode.READ);
        uyHist.push(new Float32Array(probeStaging.getMappedRange().slice(0))[1]);
        probeStaging.unmap();
      }
      const raw = await solver.readForces();
      if (raw) {
        cdHist.push(raw.fx / pending / norm);
        clHist.push(raw.fy / pending / norm);
      }
      pending = 0;
      if (cdHist.length % 100 === 0) {
        const rate = ((s + 1) / (performance.now() - t0)) * 1000;
        console.log(`  Re=${re} 步数 ${s + 1}/${steps} (${rate.toFixed(0)} 步/秒)`);
      }
    }
  }
  const elapsed = (performance.now() - t0) / 1000;
  const cellCount = nx * ny * nz;

  // 探针时序统计：uy rms + DFT 主频 → 局部 St
  if (probe && uyHist.length > 8) {
    const h2 = Math.floor(uyHist.length / 2);
    const tail = uyHist.slice(h2);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const rms = Math.sqrt(tail.reduce((a, b) => a + (b - mean) * (b - mean), 0) / tail.length);
    let bp = 0, bk = 0;
    for (let k = 1; k <= Math.floor(tail.length / 2); k++) {
      const w = (2 * Math.PI * k) / tail.length;
      let re2 = 0, im2 = 0;
      for (let n = 0; n < tail.length; n++) {
        re2 += tail[n] * Math.cos(w * n);
        im2 -= tail[n] * Math.sin(w * n);
      }
      const p = re2 * re2 + im2 * im2;
      if (p > bp) { bp = p; bk = k; }
    }
    const stLocal = bk > 0 ? (bk / (tail.length * READ_EVERY)) * (D / u) : 0;
    const ampLocal = bk > 0 ? (2 * Math.sqrt(bp)) / tail.length : 0;
    console.log(`  探针(${px},${py},${pz}): uy_mean=${mean.toFixed(4)} uy_rms=${rms.toFixed(4)} 局部St=${stLocal.toFixed(4)} 局部振幅=${ampLocal.toFixed(4)}`);
  }

  // 可选：读回速度场诊断（DUMP=1）
  if (process.env.DUMP === '1') {
    const staging = device.createBuffer({ size: cellCount * 12, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer((solver as any).uBuffer, 0, staging, 0, cellCount * 12);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const uField = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();

    const zm = Math.floor(nz / 2);
    const uAt = (x: number, y: number, z: number, c: number) => uField[(z * nx * ny + y * nx + x) * 3 + c];
    let maxU = 0;
    for (let i = 0; i < cellCount; i++) {
      const m = Math.hypot(uField[i * 3], uField[i * 3 + 1], uField[i * 3 + 2]);
      if (m > maxU) maxU = m;
    }
    console.log(`  最大 |u| = ${maxU.toFixed(4)} (入口 ${u})`);
    const stations = [40, 100, 160, 200].filter((s) => s < nx);
    for (const x of stations) {
      let line = `  ux(x=${String(x).padStart(2)}, z=${zm}) y=0..${ny - 1}: `;
      for (let y = 0; y < ny; y += 4) line += uAt(x, y, zm, 0).toFixed(3) + ' ';
      console.log(line);
    }
    let line = `  ux 中线 (y=${Math.floor(ny / 2)}, z=${zm}) x=0..${nx - 1}: `;
    for (let x = 0; x < nx; x += 4) line += uAt(x, Math.floor(ny / 2), zm, 0).toFixed(3) + ' ';
    console.log(line);

    // 尾流横向速度 uy（涡脱落直接特征）
    console.log('  uy 尾流剖面 (z 中面):');
    for (const x of [60, 70, 80, 90, 100, 120]) {
      if (x >= nx) break;
      let l2 = `    x=${x}: `;
      for (let y = Math.floor(ny / 2) - 20; y <= Math.floor(ny / 2) + 20; y += 4) {
        l2 += uAt(x, y, zm, 1).toFixed(4) + ' ';
      }
      console.log(l2);
    }

    // 密度场统计
    const rhoStaging = device.createBuffer({ size: cellCount * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc2 = device.createCommandEncoder();
    enc2.copyBufferToBuffer((solver as any).rhoBuffer, 0, rhoStaging, 0, cellCount * 4);
    device.queue.submit([enc2.finish()]);
    await rhoStaging.mapAsync(GPUMapMode.READ);
    const rhoField = new Float32Array(rhoStaging.getMappedRange().slice(0));
    rhoStaging.unmap();
    rhoStaging.destroy();
    let rMin = Infinity, rMax = -Infinity, rSum = 0;
    for (let i = 0; i < cellCount; i++) {
      const r = rhoField[i];
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
      rSum += r;
    }
    console.log(`  ρ: mean=${(rSum / cellCount).toFixed(4)} min=${rMin.toFixed(4)} max=${rMax.toFixed(4)}`);
    let rline = `  ρ 中线 (y=${Math.floor(ny / 2)}, z=${zm}) x=0..${nx - 1}: `;
    for (let x = 0; x < nx; x += 4) rline += rhoField[(zm * nx * ny + Math.floor(ny / 2) * nx + x)].toFixed(3) + ' ';
    console.log(rline);
  }

  // 可选：CPU 交叉校验动量交换力（CROSS=1，需 CS=0 使 ω=1/τ 与 CPU 一致）
  if (process.env.CROSS === '1') {
    const n19 = cellCount * 19;
    const fStaging = device.createBuffer({ size: n19 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc3 = device.createCommandEncoder();
    enc3.copyBufferToBuffer((solver as any).f0Buffer, 0, fStaging, 0, n19 * 4);
    device.queue.submit([enc3.finish()]);
    await fStaging.mapAsync(GPUMapMode.READ);
    const f0 = new Float32Array(fStaging.getMappedRange().slice(0));
    fStaging.unmap();
    fStaging.destroy();

    // 同一个 f0 再跑一步，读 GPU 单步力做直接对比
    solver.step();
    const one = await solver.readForces();
    console.log('  GPU 单步 force:', one);

    const CI = [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1],[0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1]];
    const W = [1/3, ...Array(6).fill(1/18), ...Array(12).fill(1/36)];
    const OPP = [0,2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15,18,17];
    const omega = 1 / tau;

    // 定位 NaN/Inf 分布
    let nanCells = 0, nanSolid = 0, shown = 0;
    for (let idx = 0; idx < cellCount; idx++) {
      let bad = false;
      for (let i = 0; i < 19; i++) if (!Number.isFinite(f0[idx * 19 + i])) bad = true;
      if (bad) {
        nanCells++;
        if (voxel.flags[idx]) nanSolid++;
        if (shown < 5) {
          const x = idx % nx, y = Math.floor(idx / nx) % ny, z = Math.floor(idx / (nx * ny));
          console.log(`  NaN 格 (${x},${y},${z}) solid=${voxel.flags[idx]} f=[${Array.from({ length: 19 }, (_, i) => f0[idx * 19 + i].toFixed(3)).join(',')}]`);
          shown++;
        }
      }
    }
    console.log(`  非有限格: ${nanCells} (其中实心 ${nanSolid})`);

    let fx = 0, fy = 0, fz = 0;
    let linkPosX = 0, linkNegX = 0, linkAxialPos = 0, linkAxialNeg = 0, linkCount = 0;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const idx = z * nx * ny + y * nx + x;
      if (voxel.flags[idx]) continue;
      let rhoL = 0, mx = 0, my = 0, mz = 0;
      for (let i = 0; i < 19; i++) {
        const f = f0[idx * 19 + i];
        rhoL += f; mx += CI[i][0] * f; my += CI[i][1] * f; mz += CI[i][2] * f;
      }
      const vx = mx / rhoL, vy = my / rhoL, vz = mz / rhoL;
      if (!Number.isFinite(rhoL) || !Number.isFinite(vx)) continue;
      const u2 = vx * vx + vy * vy + vz * vz;
      const post = new Array<number>(19);
      for (let i = 0; i < 19; i++) {
        const cu = CI[i][0] * vx + CI[i][1] * vy + CI[i][2] * vz;
        const fe = W[i] * rhoL * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * u2);
        post[i] = f0[idx * 19 + i] - omega * (f0[idx * 19 + i] - fe);
      }
      for (let i = 1; i < 19; i++) {
        const bx = x + CI[i][0], by = y + CI[i][1], bz = z + CI[i][2];
        if (bx < 0 || bx >= nx || by < 0 || by >= ny || bz < 0 || bz >= nz) continue;
        if (!voxel.flags[bz * nx * ny + by * nx + bx]) continue;
        const m = post[i] + post[OPP[i]];
        fx += CI[i][0] * m; fy += CI[i][1] * m; fz += CI[i][2] * m;
        linkCount++;
        if (CI[i][0] > 0) linkPosX += m;
        if (CI[i][0] < 0) linkNegX += m;
        if (i === 1) linkAxialPos += m;
        if (i === 2) linkAxialNeg += m;
      }
    }
    console.log(`  CPU ME 单步 force: fx=${fx.toFixed(4)} fy=${fy.toFixed(4)} fz=${fz.toFixed(4)}  (Cd=${(fx / norm).toFixed(3)})`);
    console.log(`  分解: c.x=+1 链 ${linkPosX.toFixed(4)} | c.x=-1 链 -(${linkNegX.toFixed(4)}) | 纯轴向 +x 链 ${linkAxialPos.toFixed(4)} | 纯轴向 -x 链 -(${linkAxialNeg.toFixed(4)}) | 链数 ${linkCount}`);
  }

  solver.destroy();

  // 统计后半段（跳过启动瞬态）
  const half = Math.floor(cdHist.length / 2);
  const cdTail = cdHist.slice(half);
  const clTail = clHist.slice(half);
  const cdMean = cdTail.reduce((a, b) => a + b, 0) / cdTail.length;
  const clMean = clTail.reduce((a, b) => a + b, 0) / clTail.length;
  const clRms = Math.sqrt(clTail.reduce((a, b) => a + (b - clMean) * (b - clMean), 0) / clTail.length);

  // St：去均值 Cl 的 DFT 主峰（Goertzel 逐频扫描），比数零交点对偏置/谐波鲁棒
  const tailN = clTail.length;
  let bestPower = 0, bestK = 0;
  for (let k = 1; k <= Math.floor(tailN / 2); k++) {
    const w = (2 * Math.PI * k) / tailN;
    let re = 0, im = 0;
    for (let n = 0; n < tailN; n++) {
      re += clTail[n] * Math.cos(w * n);
      im -= clTail[n] * Math.sin(w * n);
    }
    const power = re * re + im * im;
    if (power > bestPower) { bestPower = power; bestK = k; }
  }
  const tailSteps = tailN * READ_EVERY;
  const strouhal = bestK > 0 ? (bestK / tailSteps) * (D / u) : 0;
  const shedAmp = bestK > 0 ? (2 * Math.sqrt(bestPower)) / tailN : 0; // 主频振幅（Cl）

  return {
    re,
    cdMean,
    clMean,
    clRms,
    strouhal,
    shedAmp,
    stepsPerSec: steps / elapsed,
    solidCells: voxel.solidCells,
    frontalCells: A,
  };
}

function judge(r: CaseResult): string {
  if (r.re === 40) {
    const cdOk = r.cdMean > 1.2 && r.cdMean < 1.9;
    const stOk = r.clRms < 0.05; // 定常：基本无升力振荡
    return `Cd∈[1.2,1.9] ${cdOk ? '✓' : '✗'} | 无涡脱落 ${stOk ? '✓' : '✗'} => ${cdOk && stOk ? 'PASS' : 'FAIL'}`;
  }
  const cdRange: [number, number] = r.re === 100 ? [1.1, 1.7] : [1.0, 1.6];
  const stRange: [number, number] = r.re === 100 ? [0.13, 0.20] : [0.15, 0.24];
  const cdOk = r.cdMean >= cdRange[0] && r.cdMean <= cdRange[1];
  const stOk = r.strouhal >= stRange[0] && r.strouhal <= stRange[1];
  const shedOk = r.clRms > 0.05; // 必须有明显涡脱落
  return (
    `Cd∈[${cdRange.join(',')}] ${cdOk ? '✓' : '✗'} | St∈[${stRange.join(',')}] ${stOk ? '✓' : '✗'}` +
    ` | 涡脱落 ${shedOk ? '✓' : '✗'} => ${cdOk && stOk && shedOk ? 'PASS' : 'FAIL'}`
  );
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

  const argRe = Number(process.argv[2]);
  const argSteps = Number(process.argv[3]);
  const cases: Array<[number, number]> = argRe
    ? [[argRe, argSteps || 20000]]
    : [
        [40, 20000],
        [100, 45000],
        [200, 45000],
      ];

  const results: CaseResult[] = [];
  for (const [re, steps] of cases) {
    console.log(`\n=== Re=${re}，${steps} 步 ===`);
    results.push(await runCase(device, re, steps));
  }

  console.log('\n========== 标定结果 ==========');
  for (const r of results) {
    console.log(
      `Re=${r.re}: Cd=${r.cdMean.toFixed(3)} Cl_mean=${r.clMean.toFixed(4)} Cl_rms=${r.clRms.toFixed(4)} St=${r.strouhal.toFixed(4)} 主频振幅=${r.shedAmp.toFixed(4)}` +
      ` (${r.stepsPerSec.toFixed(0)} 步/秒, 实心 ${r.solidCells} 格, 迎风 ${r.frontalCells} 格)`
    );
    console.log(`  ${judge(r)}`);
  }

  device.destroy();
}

await main();
