// 项目持久化 - IndexedDB 存储

import { get, setMany, del, keys } from 'idb-keyval';
import type { Project } from '@/lib/stores/project-store';
import type { JobSpecV1, JobResultV1 } from '@w-sim/contracts';
import { assertFlowFrames, type LbmDisplaySnapshot } from '@/lib/cfd/flow-snapshot';
import { assertMacFlowFrames, type MacFlowSnapshot } from '@/lib/cfd/mac-flow-snapshot';
import type { ModelGeometry } from '@/types/model';
import { decodeModelGeometry, encodeModelGeometry, GeometryContractError } from '@/lib/models/geometry-contract';
import { assertModelSourceParts } from '@/lib/models/source-parts';

const PROJECT_PREFIX = 'wind-tunnel-project:';
const MODEL_PREFIX = 'wind-tunnel-model:';
const RESULT_PREFIX = 'wind-tunnel-result:';

export interface SavedLabResult {
  spec: JobSpecV1;
  result: JobResultV1;
  frames: (LbmDisplaySnapshot | MacFlowSnapshot)[];
}

function assertSavedFrames(calculation: SavedLabResult) {
  if (calculation.spec.kind === 'mac-3d') assertMacFlowFrames(calculation.frames as MacFlowSnapshot[], calculation.spec, calculation.result.summary.steps);
  else assertFlowFrames(calculation.frames as LbmDisplaySnapshot[], calculation.spec, calculation.result.summary.steps, calculation.result.derived);
}

export interface SavedModelData {
  data: ArrayBuffer;
  sourceParts?: ModelGeometry['sourceParts'];
}

/** Old projects stored bare WGM bytes. Assembly metadata stays local beside the same bytes. */
export function decodeStoredModel(value: unknown): ModelGeometry {
  const record = (value instanceof ArrayBuffer ? { data: value } : value) as SavedModelData | null;
  if (!record || typeof record !== 'object' || !(record.data instanceof ArrayBuffer)) {
    throw new GeometryContractError('format', '保存的模型数据格式无效');
  }
  const geometry = decodeModelGeometry(record.data);
  if (record.sourceParts !== undefined) geometry.sourceParts = record.sourceParts;
  assertModelSourceParts(geometry);
  return geometry;
}

export async function saveProject(project: Project, model?: { id: string; geometry: ModelGeometry }, calculation?: SavedLabResult | null): Promise<void> {
  try {
    const saved = { ...project, updatedAt: new Date() };
    const entries: [IDBValidKey, unknown][] = [[`${PROJECT_PREFIX}${project.id}`, saved]];
    if (model) {
      assertModelSourceParts(model.geometry);
      const record: SavedModelData = { data: encodeModelGeometry(model.geometry),
        ...(model.geometry.sourceParts === undefined ? {} : { sourceParts: model.geometry.sourceParts }) };
      entries.push([`${MODEL_PREFIX}${model.id}`, record]);
    }
    if (calculation) assertSavedFrames(calculation);
    // Metadata, geometry and result commit together; large fields never enter localStorage.
    if (calculation !== undefined) entries.push([`${RESULT_PREFIX}${project.id}`, calculation]);
    await setMany(entries);
  } catch (error) {
    console.error('保存项目失败:', error);
    throw error;
  }
}

export async function loadProjectResult(id: string): Promise<SavedLabResult | null> {
  const saved = await get<SavedLabResult | null>(`${RESULT_PREFIX}${id}`);
  if (!saved) return null;
  assertSavedFrames(saved);
  return saved;
}

export async function loadProject(id: string): Promise<Project | null> {
  try {
    const project = await get(`${PROJECT_PREFIX}${id}`);
    return project || null;
  } catch (error) {
    console.error('加载项目失败:', error);
    throw error;
  }
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await del(`${PROJECT_PREFIX}${id}`);
    await del(`${RESULT_PREFIX}${id}`);
  } catch (error) {
    console.error('删除项目失败:', error);
    throw error;
  }
}

export async function listProjects(): Promise<Project[]> {
  try {
    const allKeys = await keys();
    const projectKeys = allKeys.filter((key) =>
      typeof key === 'string' && key.startsWith(PROJECT_PREFIX)
    );
    
    const projects = await Promise.all(
      projectKeys.map(async (key) => {
        const id = (key as string).replace(PROJECT_PREFIX, '');
        return loadProject(id);
      })
    );
    
    return projects.filter((p): p is Project => p !== null);
  } catch (error) {
    console.error('列出项目失败:', error);
    throw error;
  }
}

export async function loadModelData(modelId: string): Promise<ModelGeometry | null> {
  try {
    const data = await get(`${MODEL_PREFIX}${modelId}`);
    return data === undefined || data === null ? null : decodeStoredModel(data);
  } catch (error) {
    console.error('加载模型数据失败:', error);
    throw error;
  }
}

export async function exportProject(project: Project): Promise<Blob> {
  const data = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    project,
  };
  
  return new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
}

export async function importProject(file: File): Promise<Project> {
  const text = await file.text();
  const data = JSON.parse(text);
  
  if (data.version !== '1.0') {
    throw new Error('不支持的项目文件版本');
  }
  
  return data.project;
}
