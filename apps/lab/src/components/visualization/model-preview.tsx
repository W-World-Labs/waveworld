'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Bounds, Edges, OrbitControls, useBounds } from '@react-three/drei';
import * as THREE from 'three';
import { FileBox, Scan } from 'lucide-react';
import { useProjectStore } from '@/lib/stores/project-store';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { createLbmPreviewPlacement } from '@/lib/models/sim-session';

function FitModel({ geometry, request, focusBox }: { geometry: THREE.BufferGeometry; request: number; focusBox: THREE.Box3 | null }) {
  const bounds = useBounds();
  const camera = useThree(state => state.camera);
  useLayoutEffect(() => {
    // Refit model changes and explicit requests; resizing must preserve the user's view.
    if (focusBox && camera instanceof THREE.PerspectiveCamera) {
      const sphere = focusBox.getBoundingSphere(new THREE.Sphere());
      const direction = camera.position.clone().sub(sphere.center).normalize();
      if (direction.lengthSq() === 0) camera.getWorldDirection(direction).negate();
      const halfFov = THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2;
      const limitingAngle = Math.atan(Math.tan(halfFov) * Math.min(1, camera.aspect));
      // Fit the entire sphere in the narrower frustum, including view-axis depth.
      const distance = sphere.radius / Math.sin(limitingAngle) * 1.08;
      bounds.refresh(focusBox).clip().moveTo(sphere.center.clone().addScaledVector(direction, distance)).lookAt({ target: sphere.center });
    } else bounds.refresh().clip().fit();
  }, [bounds, camera, geometry, request, focusBox]);
  return null;
}

/**
 * 3D 模型预览
 * 加载模型后立即显示，可旋转/缩放查看；开始仿真后被流场画布替换。
 */
export function ModelPreview({ selectedPartId = null, onSelectPart }: {
  selectedPartId?: string | null;
  onSelectPart?: (id: string | null) => void;
}) {
  const { activeModel, uploadedModels } = useProjectStore();
  const [fitRequest, setFitRequest] = useState(0);
  const [focusPart, setFocusPart] = useState(false);
  const parameters = useSimulationStore((store) => store.parameters);
  const fan = parameters.fan;
  const uploaded = uploadedModels.find((model) => model.metadata.id === activeModel?.id);
  const sourceGeometry = uploaded?.geometry;
  const selected = sourceGeometry?.sourceParts?.find(part => part.id === selectedPartId);

  // 按 id 在已上传模型中查找几何数据
  const geometry = useMemo(() => {
    if (!sourceGeometry) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(sourceGeometry.vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(sourceGeometry.indices, 1));

    // 预设模型的法线数组为全零占位，需要重新计算
    const normals = sourceGeometry.normals;
    if (normals && normals.some((v) => v !== 0)) {
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    } else {
      geo.computeVertexNormals();
    }
    return geo;
  }, [sourceGeometry]);

  useLayoutEffect(() => {
    if (!geometry || !sourceGeometry) return;
    // Three draw groups select existing triangles; the solver's arrays remain untouched.
    geometry.clearGroups();
    if (!selected) geometry.addGroup(0, sourceGeometry.indices.length, 0);
    else {
      const start = selected.triangleStart * 3, count = selected.triangleCount * 3;
      if (start) geometry.addGroup(0, start, 0);
      const end = start + count;
      if (end < sourceGeometry.indices.length) geometry.addGroup(end, sourceGeometry.indices.length - end, 0);
      // Same-object transparent groups retain insertion order: draw the selected part last.
      geometry.addGroup(start, count, 1);
    }
  }, [geometry, sourceGeometry, selected]);

  // 几何体替换后释放旧 BufferGeometry（含 position/normal/index 的 GPU 缓冲）。
  // 注意：attribute 共享 store 中的 TypedArray，dispose 不释放 JS 堆；store 同 ID
  // 替换/移除后旧 TypedArray 才可被 GC。
  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  // The same affine transform positions geometry, fan and material markers.
  const placement = useMemo(() => {
    if (!activeModel || !uploaded) return null;
    try {
      const { grid, dx, transform } = createLbmPreviewPlacement(parameters, activeModel, uploaded.geometry);
      const dims = [grid.nx, grid.ny, grid.nz], maxN = Math.max(...dims);
      const origin = transform.point([0, 0, 0]);
      const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => transform.point(axis).map((value, i) => (value - origin[i]) / maxN));
      const translation = origin.map((value, i) => (value - dims[i] / 2) / maxN);
      const matrix = new THREE.Matrix4().set(
        axes[0][0], axes[1][0], axes[2][0], translation[0],
        axes[0][1], axes[1][1], axes[2][1], translation[1],
        axes[0][2], axes[1][2], axes[2][2], translation[2],
        0, 0, 0, 1,
      );
      const box = { min: transform.min, size: transform.max.map((max, axis) => max - transform.min[axis]) };
      return { grid, dx, box, maxN, matrix, error: null };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [activeModel, uploaded, parameters]);

  const focusBox = useMemo(() => {
    if (!focusPart || !selected || !sourceGeometry || placement?.error !== null) return null;
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    const end = (selected.triangleStart + selected.triangleCount) * 3;
    for (let i = selected.triangleStart * 3; i < end; i++) {
      point.fromArray(sourceGeometry.vertices, sourceGeometry.indices[i] * 3);
      box.expandByPoint(point.applyMatrix4(placement.matrix));
    }
    // A collapsed source part must not collapse the camera's near/far range.
    if (box.isEmpty() || box.getSize(point).lengthSq() === 0) return null;
    return box;
  }, [focusPart, selected, sourceGeometry, placement]);

  const pickPart = (event: ThreeEvent<MouseEvent>) => {
    if (event.faceIndex == null || !sourceGeometry?.sourceParts || !onSelectPart) return;
    const face = event.faceIndex;
    // Children follow parents; the last containing range is the actual source mesh occurrence.
    const part = sourceGeometry.sourceParts.findLast(part => face >= part.triangleStart && face < part.triangleStart + part.triangleCount);
    if (part) { event.stopPropagation(); onSelectPart(part.id); }
  };

  const fanPreviews = useMemo(() => {
    if (placement?.error !== null) return [];
    const box = placement.box;
    const length = placement.dx * placement.grid.characteristicCells;
    const fans = parameters.flowMethod === 'mac' ? parameters.macFans ?? [] : fan ? [fan] : [];
    return fans.map(fan => {
    const radius = fan.radiusM * box.size[0] / length;
    const position = new THREE.Vector3(...fan.center.map((t, i) => box.min[i] + t * box.size[i]) as [number, number, number]);
    const direction = new THREE.Vector3();
    direction.setComponent('xyz'.indexOf(fan.axis.at(-1)!), fan.axis.startsWith('-') ? -1 : 1);
    return { radius, position, direction, rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction) };
    });
  }, [fan, placement, parameters.flowMethod, parameters.macFans]);

  const thermalRegions = parameters.thermalEnabled && parameters.thermalMode === 'solid-power' ? parameters.thermalRegions ?? [] : [];

  if (!activeModel) {
    return (
      <div className="w-full h-full bg-zinc-900 flex flex-col items-center justify-center gap-3">
        <FileBox className="w-12 h-12 text-zinc-700" />
        <p className="text-sm text-zinc-500">尚未加载模型</p>
        <p className="text-xs text-zinc-600">在左侧「模型」标签页加载预设模型或上传文件</p>
      </div>
    );
  }

  if (!geometry) {
    return (
      <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
        <p className="text-sm text-zinc-500">未找到模型几何数据</p>
      </div>
    );
  }

  if (!placement || placement.error !== null) return <div role="status" className="p-4 text-sm text-amber-300">无法预览当前放置：{placement?.error}</div>;

  return (
    <div className="w-full h-full bg-zinc-900 relative">
      <Canvas camera={{ position: [1, 0.75, 1], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.2} />
        <directionalLight position={[-5, 3, -5]} intensity={0.4} />

        <OrbitControls makeDefault />
        <Bounds fit clip margin={1.15} maxDuration={0.2}>
          <group matrix={placement.matrix} matrixAutoUpdate={false}>
            <mesh geometry={geometry} onClick={pickPart}>
              <meshStandardMaterial attach="material-0" color="#22d3ee" metalness={0.3} roughness={0.5}
                transparent={!!selected} opacity={selected ? 0.14 : 1} depthWrite={!selected} />
              <meshStandardMaterial attach="material-1" color="#fbbf24" metalness={0.2} roughness={0.5} side={THREE.DoubleSide}
                transparent opacity={1} depthWrite depthTest />
            </mesh>
            {thermalRegions.map((region, index) => {
              const box = placement.box;
              const size = region.bounds.max.map((max, axis) => (max - region.bounds.min[axis]) * box.size[axis]) as [number, number, number];
              const center = region.bounds.min.map((min, axis) => box.min[axis] + (min + region.bounds.max[axis]) / 2 * box.size[axis]) as [number, number, number];
              if (!size.every((value) => Number.isFinite(value) && value > 0) || !center.every(Number.isFinite)) return null;
              return <mesh key={index} position={center} renderOrder={2}>
                <boxGeometry args={size} />
                <meshBasicMaterial visible={false} />
                <Edges color={`hsl(${(index * 67 + 25) % 360}, 85%, 65%)`} depthTest={false} depthWrite={false} renderOrder={2} />
              </mesh>;
            })}
            {fanPreviews.map((fanPreview, index) => <group key={index}>
              <mesh position={fanPreview.position} quaternion={fanPreview.rotation}>
                <circleGeometry args={[fanPreview.radius, 32]} />
                <meshBasicMaterial color="#fbbf24" side={THREE.DoubleSide} transparent opacity={0.55} depthWrite={false} depthTest={false} />
              </mesh>
              <arrowHelper args={[fanPreview.direction, fanPreview.position, fanPreview.radius * 1.5, 0xfbbf24]} onUpdate={(arrow) => {
                // Component markers remain visible through the case walls.
                for (const part of [arrow.line, arrow.cone]) {
                  for (const material of Array.isArray(part.material) ? part.material : [part.material]) material.depthTest = false;
                  part.renderOrder = 1;
                }
              }} />
            </group>)}
          </group>
          <FitModel geometry={geometry} request={fitRequest} focusBox={focusBox} />
        </Bounds>

        {parameters.flowMethod !== 'mac' && parameters.ground && <mesh position={[0, -placement.grid.ny / (2 * placement.maxN), 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[placement.grid.nx / placement.maxN, placement.grid.nz / placement.maxN]} />
          <meshStandardMaterial color="#52525b" side={THREE.DoubleSide} />
        </mesh>}
      </Canvas>

      <div className="absolute top-3 right-3 flex flex-wrap justify-end gap-2">
        {selected && <button type="button" onClick={() => { setFocusPart(true); setFitRequest(request => request + 1); }}
          className="rounded border border-amber-400/40 bg-zinc-950/85 px-2.5 py-1.5 text-xs text-amber-200 hover:bg-zinc-800">聚焦部件</button>}
        <button type="button" onClick={() => { setFocusPart(false); setFitRequest(request => request + 1); }}
          className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-950/85 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">
          <Scan className="h-3.5 w-3.5" />适应模型
        </button>
      </div>

      {thermalRegions.length > 0 && <div className="absolute top-3 left-3 max-h-36 overflow-auto rounded bg-zinc-950/85 px-3 py-2 text-xs" aria-label="部件区域预览">
        {thermalRegions.map((region, index) => <p key={index} style={{ color: `hsl(${(index * 67 + 25) % 360}, 85%, 65%)` }}>{region.name || `部件 ${index + 1}`} · {region.totalPowerW} W</p>)}
      </div>}

      {/* 模型信息角标 */}
      <div className="absolute bottom-4 right-4 max-w-[calc(100%-2rem)] bg-zinc-950/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-zinc-800">
        {selected && <p aria-label="高亮部件" className="mb-1 break-all text-xs text-amber-200">{selected.name} · {selected.triangleCount.toLocaleString()} 面</p>}
        <p className="text-xs text-white">{activeModel.name}</p>
        <p className="text-xs text-zinc-500">
          {activeModel.sourceModel.vertexCount.toLocaleString()} 顶点 ·{' '}
          {activeModel.sourceModel.faceCount.toLocaleString()} 面
        </p>
        <p className="text-xs text-zinc-400" aria-label="预览地面">{parameters.flowMethod === 'mac'
          ? '静止模型 · 风扇箭头为施力方向，无指定入口来流'
          : `${parameters.ground
          ? `${parameters.ground.mode === 'moving' ? '随来流移动地面' : '固定地面'} · 最低点间隙 ${parameters.ground.clearanceM} m（含轮胎）`
          : '无地面'} · 来流 +X`}</p>
      </div>
    </div>
  );
}
