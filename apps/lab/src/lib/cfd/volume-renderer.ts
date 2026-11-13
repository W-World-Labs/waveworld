// WebGPU 体渲染器：光线步进渲染 3D 流场
//
// - 从轨道相机逐像素发射光线，与流域盒求交后步进采样
// - 速度幅值/涡量场三线性插值采样，发射-吸收式颜色累积（jet 色标）
// - 实心障碍格子渲染为光照着色表面，可直观看到绕流的汽车/飞机

export interface CameraState {
  theta: number; // 方位角（弧度）
  phi: number; // 仰角（弧度，限制在 ±1.45）
  radius: number; // 距离
}

export interface ViewOptions {
  threshold: number; // 显示阈值 0-0.5（背景削减比例）
  clipAxis: 0 | 1 | 2 | 3; // 剖切轴：0 不剖切，1/2/3 = x/y/z
  clipPos: number; // 剖切位置 0-1（保留坐标 ≥ 该比例的一侧）
  boundaryMargin: number; // 边界裁剪厚度（格）：0 = 显示边界，3 = 隐藏边界作用层
  groundEnabled?: boolean; // Saved physical ground at lattice y=0; retain the nearby flow.
  inletVelocityLattice?: number; // Actual saved LBM inlet, only for opacity; not the stability reference speed.
}

/** Saved-field ranges: speed, vorticity, temperature and gauge pressure (Pa). */
export type FlowValueRanges = readonly (readonly [number, number] | undefined)[];
export type FlowRenderMode = 0 | 1 | 2 | 3;

/** Same color scale for saved 2D slices and the 3D field. */
export function flowDisplayScale(mode: FlowRenderMode, uLattice: number): number {
  return mode === 0 ? 1 / uLattice : mode === 1 ? 1.8 / uLattice : 1;
}

/** Split pressure normalization into two FP32-safe factors for tiny lattice ranges. */
export function pressureScaleRoot(pressureScalePa: number, pressureBoundPa: number): number {
  return pressureScalePa > 0 && Number.isFinite(pressureScalePa) &&
    pressureBoundPa > 0 && Number.isFinite(pressureBoundPa)
    ? Math.fround(Math.sqrt(0.5 * (pressureScalePa / pressureBoundPa)))
    : 0;
}

export class VolumeRenderer {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext;
  private dims: { nx: number; ny: number; nz: number };
  private displayBuffer: GPUBuffer;
  private flagsBuffer: GPUBuffer;
  private uniformBuffer: GPUBuffer;
  private pipeline: GPURenderPipeline;
  private bindGroup: GPUBindGroup;
  private camera: CameraState = { theta: 0.6, phi: 0.35, radius: 2.6 };
  private uInlet: number;
  private displayStride: number;
  private physicalRanges?: FlowValueRanges;
  private pressureScalePa: number;

  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    dims: { nx: number; ny: number; nz: number },
    buffers: { display: GPUBuffer; flags: GPUBuffer },
    uInlet: number,
    displayStride: number,
    physicalRanges: FlowValueRanges,
    private layout: { mac: boolean; hasTemperature: boolean; pressureOffset: number | null; pressureScalePa: number },
  ) {
    this.device = device;
    this.canvas = canvas;
    this.dims = dims;
    this.displayBuffer = buffers.display;
    this.flagsBuffer = buffers.flags;
    this.uInlet = uInlet;
    this.displayStride = displayStride;
    this.physicalRanges = physicalRanges;
    this.pressureScalePa = layout.pressureScalePa;

    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('无法获取 WebGPU 画布上下文');
    this.context = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format, alphaMode: 'opaque' });

    this.uniformBuffer = device.createBuffer({
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({ code: this.getShaderCode() });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: 'vertexMain' },
      fragment: { module: shaderModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.displayBuffer } },
        { binding: 2, resource: { buffer: this.flagsBuffer } },
      ],
    });
  }

  setCamera(camera: Partial<CameraState>) {
    Object.assign(this.camera, camera);
    this.camera.phi = Math.max(-1.45, Math.min(1.45, this.camera.phi));
    this.camera.radius = Math.max(1.2, Math.min(8, this.camera.radius));
  }

  getCamera(): CameraState {
    return { ...this.camera };
  }

  /** Update an equal-layout frame and its saved-unit color ranges without rebuilding the pipeline. */
  updateFrame(
    display: Float32Array,
    flags: Uint32Array,
    options: { uInlet: number; physicalRanges: FlowValueRanges; pressureScalePa: number },
  ) {
    if (display.byteLength !== this.displayBuffer.size || flags.byteLength !== this.flagsBuffer.size) {
      throw new Error('流场帧布局与渲染缓冲区不一致');
    }
    this.device.queue.writeBuffer(this.displayBuffer, 0, display.buffer as ArrayBuffer, display.byteOffset, display.byteLength);
    this.device.queue.writeBuffer(this.flagsBuffer, 0, flags.buffer as ArrayBuffer, flags.byteOffset, flags.byteLength);
    this.uInlet = options.uInlet;
    this.physicalRanges = options.physicalRanges;
    this.pressureScalePa = options.pressureScalePa;
  }

  /** mode: 0 speed, 1 vorticity, 2 temperature, 3 gauge pressure (Pa). */
  render(mode: FlowRenderMode, stepScale = 1, view: ViewOptions = { threshold: 0.08, clipAxis: 0, clipPos: 0.5, boundaryMargin: 3 }) {
    const { nx, ny, nz } = this.dims;
    const maxN = Math.max(nx, ny, nz);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);

    // 相机基向量（世界系：流域盒中心在原点，最长轴半长为 1）
    const { theta, phi, radius } = this.camera;
    const camPos = [
      radius * Math.cos(phi) * Math.cos(theta),
      radius * Math.sin(phi),
      radius * Math.cos(phi) * Math.sin(theta),
    ];
    const fwd = normalize3([-camPos[0], -camPos[1], -camPos[2]]);
    const right = normalize3(cross3(fwd, [0, 1, 0]));
    const up = cross3(right, fwd);

    const fovScale = Math.tan((50 * Math.PI) / 180 / 2);
    // 场值 → 0-1 显示区间：速度按入口速度归一，涡量按量级估算，温度已归一
    // Pressure is normalized in the shader before interpolation; keep its Pa
    // conversion out of FP32 uniforms, where valid saved scales may overflow.
    const range = mode === 3 ? undefined : this.physicalRanges?.[mode];
    const fieldScale = range ? 1 / Math.max(range[1] - range[0], 1e-12) : flowDisplayScale(mode, this.uInlet);
    const voxelWorld = 2 / maxN;
    const stepWorld = voxelWorld * 0.9 * stepScale;
    // 步数需覆盖盒对角线，步长越小步数越多（上限保护帧率）
    const maxSteps = Math.min(1200, Math.ceil(3.6 / stepWorld));

    const data = new Float32Array(36);
    data.set([...camPos, fovScale], 0);
    data.set([...right, aspect], 4);
    data.set([...up, mode], 8);
    data.set([...fwd, fieldScale], 12);
    data.set([nx, ny, nz, maxN], 16);
    data.set([voxelWorld, stepWorld, 50.0, maxSteps], 20); // 密度系数 50
    data.set([this.displayStride, view.threshold, view.clipAxis, view.clipPos], 24);
    const inlet = view.inletVelocityLattice ?? 0;
    data.set([view.boundaryMargin, view.groundEnabled ? 1 : 0, range ? -range[0] : 0,
      Number.isFinite(inlet) && inlet > 0 ? inlet * fieldScale : 0], 28);
    data[32] = pressureScaleRoot(this.pressureScalePa, this.physicalRanges?.[3]?.[1] ?? 0);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.04, g: 0.04, b: 0.06, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy() {
    this.uniformBuffer.destroy();
    this.context.unconfigure();
  }

  private getShaderCode(): string {
    return `
const FIELD_IS_MAC = ${this.layout.mac};
const HAS_TEMPERATURE = ${this.layout.hasTemperature};
const PRESSURE_OFFSET: i32 = ${this.layout.pressureOffset ?? -1};
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) ndc: vec2<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.ndc = pos[vertexIndex];
  return output;
}

struct RParams {
  camPos: vec4<f32>,   // xyz, w = fovScale
  camRight: vec4<f32>, // xyz, w = aspect
  camUp: vec4<f32>,    // xyz, w = mode
  camFwd: vec4<f32>,   // xyz, w = fieldScale
  dimsF: vec4<f32>,    // nx, ny, nz, maxN
  gridInfo: vec4<f32>, // voxelWorld, stepWorld, density, maxSteps
  extra: vec4<f32>,    // displayStride, threshold, clipAxis, clipPos
  extra2: vec4<f32>,   // boundaryMargin, groundEnabled, fieldOffset, normalizedInlet
  pressure: vec4<f32>, // split pressure normalization; updated with saved result ranges
}

@group(0) @binding(0) var<uniform> rp: RParams;
@group(0) @binding(1) var<storage, read> display: array<f32>;
@group(0) @binding(2) var<storage, read> flags: array<u32>;

fn flagsAt(p: vec3<i32>) -> u32 {
  let d = vec3<i32>(rp.dimsF.xyz);
  let c3 = clamp(p, vec3<i32>(0), d - 1);
  let nx = u32(rp.dimsF.x);
  let ny = u32(rp.dimsF.y);
  let idx = u32(c3.z) * ny * nx + u32(c3.y) * nx + u32(c3.x);
  // Surface normals use occupancy, not the numeric material index.
  return min(1u, flags[idx]);
}

fn displayAt(cell: vec3<u32>, channel: u32) -> f32 {
  let nx = u32(rp.dimsF.x);
  let ny = u32(rp.dimsF.y);
  let idx = cell.z * ny * nx + cell.y * nx + cell.x;
  if (channel == 3u) {
    if (PRESSURE_OFFSET < 0) { return 0.0; }
    return (display[idx * u32(rp.extra.x) + u32(PRESSURE_OFFSET)] * rp.pressure.x) * rp.pressure.x + 0.5;
  }
  if (channel == 2u && !HAS_TEMPERATURE) { return 0.0; }
  if (FIELD_IS_MAC) {
    let offset = idx * u32(rp.extra.x);
    if (channel == 0u) { return length(vec3<f32>(display[offset], display[offset + 1u], display[offset + 2u])); }
    if (channel == 1u) { return 0.0; } // MAC snapshots do not save vorticity.
    if (rp.extra.x >= 5.0) { return display[offset + 4u]; }
    return 0.0;
  }
  return display[idx * u32(rp.extra.x) + channel];
}

// An insulated MAC mask has no temperature. Exclude its padding from both
// solid shading and the neighboring fluid's trilinear interpolation.
fn sampleValue(cell: vec3<u32>, channel: u32) -> vec2<f32> {
  let idx = cell.z * u32(rp.dimsF.y) * u32(rp.dimsF.x) + cell.y * u32(rp.dimsF.x) + cell.x;
  if ((FIELD_IS_MAC && channel == 2u && flags[idx] == 1u)
    || (channel == 3u && flags[idx] != 0u)) { return vec2<f32>(0.0); }
  return vec2<f32>(displayAt(cell, channel), 1.0);
}

// 三线性插值采样显示场，按有定义的温度权重归一。
fn sampleField(g: vec3<f32>, channel: u32) -> f32 {
  let p = clamp(g - 0.5, vec3<f32>(0.0), rp.dimsF.xyz - 1.001);
  let i0 = vec3<u32>(floor(p));
  let f = p - floor(p);
  let i1 = min(i0 + vec3<u32>(1u), vec3<u32>(rp.dimsF.xyz) - vec3<u32>(1u));

  let c000 = sampleValue(vec3<u32>(i0.x, i0.y, i0.z), channel);
  let c100 = sampleValue(vec3<u32>(i1.x, i0.y, i0.z), channel);
  let c010 = sampleValue(vec3<u32>(i0.x, i1.y, i0.z), channel);
  let c110 = sampleValue(vec3<u32>(i1.x, i1.y, i0.z), channel);
  let c001 = sampleValue(vec3<u32>(i0.x, i0.y, i1.z), channel);
  let c101 = sampleValue(vec3<u32>(i1.x, i0.y, i1.z), channel);
  let c011 = sampleValue(vec3<u32>(i0.x, i1.y, i1.z), channel);
  let c111 = sampleValue(vec3<u32>(i1.x, i1.y, i1.z), channel);

  let x00 = mix(c000, c100, f.x);
  let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x);
  let x11 = mix(c011, c111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  let sampled = mix(y0, y1, f.z);
  if (sampled.y > 0.0) { return sampled.x / sampled.y; }
  if (channel == 3u) { return 0.5; }
  return 0.0;
}

// jet 色标
fn colormap(x: f32) -> vec3<f32> {
  return vec3<f32>(
    clamp(1.5 - abs(4.0 * x - 3.0), 0.0, 1.0),
    clamp(1.5 - abs(4.0 * x - 2.0), 0.0, 1.0),
    clamp(1.5 - abs(4.0 * x - 1.0), 0.0, 1.0)
  );
}

// 障碍表面着色（flags 梯度做法线）
fn shadeSolid(cell: vec3<u32>) -> vec3<f32> {
  let idx = cell.z * u32(rp.dimsF.y) * u32(rp.dimsF.x) + cell.y * u32(rp.dimsF.x) + cell.x;
  let hasTemperature = HAS_TEMPERATURE && (!FIELD_IS_MAC || flags[idx] != 1u);
  if (rp.camUp.w == 2.0 && hasTemperature) {
    return colormap((displayAt(cell, 2u) + rp.extra2.z) * rp.camFwd.w);
  }
  let p = vec3<i32>(cell);
  let grad = vec3<f32>(
    f32(flagsAt(p + vec3<i32>(1, 0, 0))) - f32(flagsAt(p - vec3<i32>(1, 0, 0))),
    f32(flagsAt(p + vec3<i32>(0, 1, 0))) - f32(flagsAt(p - vec3<i32>(0, 1, 0))),
    f32(flagsAt(p + vec3<i32>(0, 0, 1))) - f32(flagsAt(p - vec3<i32>(0, 0, 1)))
  );
  var n = vec3<f32>(0.0, 1.0, 0.0);
  if (length(grad) > 0.001) {
    n = -normalize(grad);
  }
  let lightDir = normalize(vec3<f32>(0.5, 0.8, 0.4));
  let diff = max(dot(n, lightDir), 0.0);
  let base = vec3<f32>(0.62, 0.65, 0.70);
  return base * (0.25 + 0.75 * diff);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let ro = rp.camPos.xyz;
  let rd = normalize(
    rp.camFwd.xyz +
    rp.camRight.xyz * (input.ndc.x * rp.camPos.w * rp.camRight.w) +
    rp.camUp.xyz * (input.ndc.y * rp.camPos.w)
  );

  // 光线与流域盒求交（中心在原点，半长 h）
  let h = rp.dimsF.xyz / (2.0 * rp.dimsF.w);
  let invD = 1.0 / rd;
  let tA = (-h - ro) * invD;
  let tB = (h - ro) * invD;
  let tmin = max(max(min(tA.x, tB.x), min(tA.y, tB.y)), min(tA.z, tB.z));
  let tmax = min(min(max(tA.x, tB.x), max(tA.y, tB.y)), max(tA.z, tB.z));

  let bg = vec3<f32>(0.04, 0.04, 0.06);
  if (tmax <= max(tmin, 0.0)) {
    return vec4<f32>(bg, 1.0);
  }

  let channel = u32(round(rp.camUp.w));
  let fieldScale = rp.camFwd.w;
  let stepW = rp.gridInfo.y;
  let density = rp.gridInfo.z;
  let maxSteps = u32(rp.gridInfo.w);

  // The road is an actual y=0 boundary, separate from model occupancy/forces.
  let groundT = (-h.y - ro.y) / rd.y;
  let groundP = ro + rd * groundT;
  let groundG = (groundP + h) * rp.dimsF.w;
  let clipAxis = u32(rp.extra.z);
  var groundVisible = rp.extra2.y > 0.5 && abs(rd.y) > 0.000001 && groundT >= 0.0
    && abs(groundP.x) <= h.x && abs(groundP.z) <= h.z;
  if ((clipAxis == 1u && groundG.x < rp.extra.w * rp.dimsF.x)
    || (clipAxis == 2u && 0.0 < rp.extra.w * rp.dimsF.y)
    || (clipAxis == 3u && groundG.z < rp.extra.w * rp.dimsF.z)) { groundVisible = false; }

  var C = vec3<f32>(0.0);
  var A = 0.0;
  var t = max(tmin, 0.0);
  for (var s = 0u; s < maxSteps; s++) {
    if (t >= tmax || A > 0.985 || (groundVisible && t >= groundT)) { break; }
    let p = ro + rd * t;
    // 世界 → 格子坐标
    let g = (p + h) / (2.0 * h) * rp.dimsF.xyz;
    let cell = vec3<u32>(clamp(g, vec3<f32>(0.0), rp.dimsF.xyz - 1.0));

    // 剖切：丢弃剖切面相机侧的所有采样（含固体），露出内部结构
    if (clipAxis != 0u) {
      var clipped = false;
      if (clipAxis == 1u && g.x < rp.extra.w * rp.dimsF.x) { clipped = true; }
      if (clipAxis == 2u && g.y < rp.extra.w * rp.dimsF.y) { clipped = true; }
      if (clipAxis == 3u && g.z < rp.extra.w * rp.dimsF.z) { clipped = true; }
      if (clipped) {
        t += stepW;
        continue;
      }
    }

    // 边界裁剪：最外 boundaryMargin 格是边界条件作用层（入口噪声、角部伪影），不参与渲染
    let bm = rp.extra2.x;
    if (bm > 0.5 && (g.x < bm || g.z < bm || (rp.extra2.y < 0.5 && g.y < bm)
      || any(g > rp.dimsF.xyz - vec3<f32>(bm)))) {
      t += stepW;
      continue;
    }

    if (flagsAt(vec3<i32>(cell)) != 0u) {
      C += (1.0 - A) * shadeSolid(cell);
      A = 1.0;
      break;
    }

    // 场值整形：让内部结构可见，而不是整个流域糊成均匀立方体
    let raw = (sampleField(g, channel) + rp.extra2.z) * fieldScale;
    let thr = rp.extra.y;
    var sv: f32;
    if (channel == 0u && !FIELD_IS_MAC && rp.extra2.w > 0.0) {
      // A real imposed inlet may hide the uniform freestream. This affects
      // opacity only; a numerical stability reference is never an inlet.
      let disturbance = abs(raw - rp.extra2.w) / rp.extra2.w;
      sv = clamp((disturbance * 1.5 - thr) / (1.0 - thr), 0.0, 1.0);
    } else if (channel == 3u) {
      // A symmetric signed pressure scale: hide near-zero pressure equally
      // on both sides; preserve negative/positive colors independently.
      sv = clamp((abs(2.0 * raw - 1.0) - thr) / (1.0 - thr), 0.0, 1.0);
    } else if (channel == 2u) {
      // 温度：削掉导热形成的缓变背景，平方进一步突出热羽流核心
      sv = clamp((raw - thr) / (1.0 - thr), 0.0, 1.0);
      sv = sv * sv;
    } else {
      sv = clamp((raw - thr) / (1.0 - thr), 0.0, 1.0);
    }
    if (sv > 0.02) {
      let aStep = 1.0 - exp(-density * sv * stepW);
      // Thresholds, temperature shaping and inlet filtering affect opacity,
      // never the physical value represented by the color scale.
      C += (1.0 - A) * aStep * colormap(clamp(raw, 0.0, 1.0));
      A += (1.0 - A) * aStep;
    }
    t += stepW;
  }

  if (groundVisible) {
    let tile = (i32(floor(groundG.x / 4.0)) + i32(floor(groundG.z / 4.0))) & 1;
    C += (1.0 - A) * mix(vec3<f32>(0.22, 0.23, 0.25), vec3<f32>(0.30, 0.31, 0.33), f32(tile));
    A = 1.0;
  }

  return vec4<f32>(C + (1.0 - A) * bg, 1.0);
}
`;
  }
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
