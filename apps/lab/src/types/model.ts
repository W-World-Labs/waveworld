// 3D 模型类型定义
import type { FluidJobParameters, JobModelRef } from '@w-sim/contracts';

export interface ModelMetadata {
  id: string;
  name: string;
  format: 'stl' | 'obj' | 'gltf' | 'glb';
  fileSize: number;
  uploadDate: Date;
  
  // 几何信息
  vertexCount: number;
  faceCount: number;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    size: [number, number, number];
  };
  
  // 验证状态
  isWatertight: boolean;
  hasNormals: boolean;
  hasUVs: boolean;
  manifoldEdges: number;
  nonManifoldEdges: number;
  /** Exact-position edge check per declared solid (otherwise one boundary set); absent on older saved models. Does not test self-intersection. */
  topology?: {
    boundaryEdges: number;
    inconsistentEdges: number;
    degenerateFaces: number;
  };
}

/** Source assembly ranges refer to the flattened geometry's triangles, not CFD solids. */
export interface ModelSourcePart {
  id: string;
  name: string;
  parentId?: string;
  triangleStart: number;
  triangleCount: number;
}

export interface ModelGeometry {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  /** Contiguous triangle counts: parity within each solid (including cavities), union between solids. Never inferred from uploaded surfaces. */
  solidTriangleCounts?: Uint32Array;
  /** Local import metadata; persisted with geometry in IndexedDB, outside the solver wire format. */
  sourceParts?: ModelSourcePart[];
  
  // 材质信息
  materials?: MaterialInfo[];
  
  // 有向距离场（用于 CFD）
  sdf?: Float32Array;
  sdfResolution?: [number, number, number];
}

export interface MaterialInfo {
  name: string;
  color: [number, number, number];
  metallic: number;
  roughness: number;
  opacity: number;
}

export interface UploadedModel {
  metadata: ModelMetadata;
  geometry: ModelGeometry;
  previewUrl?: string;
}

export interface ModelTransform {
  position: [number, number, number];
  rotation: [number, number, number]; // Euler angles in radians
  scale: [number, number, number];
}

export interface WindTunnelModel extends Pick<JobModelRef, 'referenceLength'> {
  /** undefined uses the model default; null requests automatic projected area. */
  referenceArea?: JobModelRef['referenceArea'] | null;
  id: string;
  name: string;
  sourceModel: ModelMetadata;
  transform: ModelTransform;
  isActive: boolean;
  
  // 风洞中的位置（相对于风洞中心）
  tunnelPosition: [number, number, number];
  tunnelRotation: [number, number, number];
}

// 预设模型
export interface PresetModel {
  id: string;
  name: string;
  category: 'airfoil' | 'vehicle' | 'building' | 'custom';
  description: string;
  thumbnailUrl: string;
  modelUrl: string;
  defaultParameters: FluidJobParameters & {
    maxIterations?: number;
    referenceArea?: number;
    referenceLength?: number;
  };
}
