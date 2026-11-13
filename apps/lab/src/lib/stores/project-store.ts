import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UploadedModel, WindTunnelModel, ModelMetadata } from '@/types/model';
import type { WindTunnelParameters } from '@/types/simulation';

/**
 * Cap retained model geometries in memory. Rapid multi-preset clicks used to
 * keep every mesh forever; only same-id reloads were replaced. Keep a small LRU
 * of recent models while always retaining the active + just-added entry.
 */
export const MAX_UPLOADED_MODELS = 4;

/**
 * Drop oldest non-protected entries when over budget.
 * keepIds: active model + the model just added (must not be dropped).
 */
export function pruneUploadedModels(
  models: UploadedModel[],
  keepIds: ReadonlySet<string>,
  max: number = MAX_UPLOADED_MODELS
): UploadedModel[] {
  if (models.length <= max) return models;
  const next = [...models];
  while (next.length > max) {
    const dropIdx = next.findIndex((m) => !keepIds.has(m.metadata.id));
    if (dropIdx === -1) {
      // Everything is protected; drop the oldest entry that is not the newest.
      if (next.length <= 1) break;
      next.shift();
    } else {
      next.splice(dropIdx, 1);
    }
  }
  return next;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  thumbnail?: string;
  
  // 项目数据
  models: WindTunnelModel[];
  parameters: Partial<WindTunnelParameters>;
  snapshots: any[]; // 仿真快照
}

interface ProjectStore {
  // 当前项目
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;
  
  // 项目列表
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  
  // 模型管理
  uploadedModels: UploadedModel[];
  addUploadedModel: (model: UploadedModel) => void;
  removeUploadedModel: (id: string) => void;
  
  // 风洞模型
  activeModel: WindTunnelModel | null;
  setActiveModel: (model: WindTunnelModel | null) => void;
  
  // UI 状态
  isUploading: boolean;
  uploadProgress: number;
  setUploading: (isUploading: boolean, progress?: number) => void;
}

const createNewProject = (name: string = '未命名项目'): Project => ({
  id: crypto.randomUUID(),
  name,
  description: '',
  createdAt: new Date(),
  updatedAt: new Date(),
  models: [],
  parameters: {},
  snapshots: [],
});

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set) => ({
      currentProject: createNewProject(),
      setCurrentProject: (project) => set({ currentProject: project, activeModel: null }),
      
      projects: [],
      setProjects: (projects) => set({ projects }),
      addProject: (project) =>
        set((state) => ({ projects: [...state.projects, project] })),
      updateProject: (id, updates) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
          ),
          currentProject:
            state.currentProject?.id === id
              ? { ...state.currentProject, ...updates, updatedAt: new Date() }
              : state.currentProject,
        })),
      deleteProject: (id) =>
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          currentProject:
            state.currentProject?.id === id ? null : state.currentProject,
        })),
      
      uploadedModels: [],
      addUploadedModel: (model) =>
        set((state) => {
          // A preset may be reloaded after a retry. Drop the previous entry so
          // its TypedArray geometry becomes unreachable for GC; ModelPreview
          // also disposes the Three BufferGeometry on geometry identity change.
          const withoutDup = state.uploadedModels.filter(
            (item) => item.metadata.id !== model.metadata.id
          );
          withoutDup.push(model);
          const keepIds = new Set<string>([model.metadata.id]);
          if (state.activeModel?.id) keepIds.add(state.activeModel.id);
          const next = pruneUploadedModels(withoutDup, keepIds, MAX_UPLOADED_MODELS);
          return { uploadedModels: next };
        }),
      removeUploadedModel: (id) =>
        set((state) => ({
          // Dropping the store entry releases CPU-side arrays; preview dispose
          // covers GPU BufferGeometry on the next render/unmount.
          uploadedModels: state.uploadedModels.filter((m) => m.metadata.id !== id),
          activeModel: state.activeModel?.id === id ? null : state.activeModel,
        })),
      
      activeModel: null,
      setActiveModel: (model) => set({ activeModel: model }),
      
      isUploading: false,
      uploadProgress: 0,
      setUploading: (isUploading, progress = 0) =>
        set({ isUploading, uploadProgress: progress }),
    }),
    {
      name: 'wind-tunnel-projects',
      version: 1,
      // 几何数据（Float32Array 等）不可 JSON 序列化，只持久化项目列表；
      // uploadedModels 保留在内存中，刷新后需重新加载模型
      partialize: (state) => ({
        projects: state.projects,
        currentProject: state.currentProject,
      }),
      // v0 曾持久化 uploadedModels（数据已损坏），升级时丢弃
      migrate: (persisted) => ({
        projects: (persisted as { projects?: Project[] })?.projects ?? [],
      }),
    }
  )
);

// 辅助函数
export const createProject = (name?: string): Project => createNewProject(name);

export const createWindTunnelModel = (
  metadata: ModelMetadata,
  transform: WindTunnelModel['transform'] = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }
): WindTunnelModel => ({
  id: metadata.id,
  name: metadata.name,
  sourceModel: metadata,
  transform,
  isActive: true,
  tunnelPosition: [0, 0, 0],
  tunnelRotation: [0, 0, 0],
});
