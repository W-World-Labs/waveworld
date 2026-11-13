'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createProject, useProjectStore } from '@/lib/stores/project-store';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { loadProject, loadModelData, loadProjectResult, saveProject } from '@/lib/storage/project-storage';
import type { ModelGeometry } from '@/types/model';
import { inspectGeometryTopology } from '@/lib/models/geometry-contract';

/** Storage seam — tests substitute a fake so persistence is observable without IndexedDB. */
const indexedDbStorage = { loadProject, loadModelData, loadProjectResult, saveProject };

/** Persist the existing single-model Lab scene, with geometry in its IndexedDB blob. */
export function useProjectPersistence(storage: typeof indexedDbStorage = indexedDbStorage) {
  const { currentProject, activeModel, uploadedModels } = useProjectStore();
  const parameters = useSimulationStore(store => store.parameters);
  const results = useSimulationStore(store => store.results);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const saves = useRef(Promise.resolve());
  const pendingSave = useRef<(() => Promise<void>) | null>(null);
  const savedGeometry = useRef<ModelGeometry | null>(null);
  const model = uploadedModels.find(model => model.metadata.id === activeModel?.id);
  const ready = !!currentProject && restoredId === currentProject.id;

  useEffect(() => {
    if (!currentProject) {
      useProjectStore.getState().setCurrentProject(createProject());
      return;
    }
    const selected = currentProject;
    let canceled = false;
    setError(null); setSavedAt(null);
    void (async () => {
      await pendingSave.current?.();
      await saves.current;
      const saved = await storage.loadProject(selected.id) ?? selected;
      const active = saved.models.find(model => model.isActive) ?? saved.models[0];
      const geometry = active ? await storage.loadModelData(active.id) : null;
      if (active && !geometry) throw new Error('项目模型数据缺失，无法恢复；请重新导入模型。');
      if (canceled) return;
      const simulation = useSimulationStore.getState();
      simulation.clearResults();
      simulation.resetParameters();
      // Older projects stored short step budgets, sometimes with an explicit undefined duration.
      simulation.updateParameters({ ...saved.parameters, durationSeconds: Math.max(10, saved.parameters.durationSeconds ?? 10) });
      const project = useProjectStore.getState();
      project.updateProject(saved.id, saved);
      if (active && geometry) {
        // Older saved metadata counted touching declared solids as one boundary set.
        const restored = geometry.solidTriangleCounts?.length
          ? { ...active, sourceModel: { ...active.sourceModel, ...inspectGeometryTopology(geometry) } } : active;
        project.addUploadedModel({ metadata: restored.sourceModel, geometry });
        project.setActiveModel(restored);
        savedGeometry.current = geometry;
      }
      try {
        const calculation = await storage.loadProjectResult(selected.id);
        if (canceled) return;
        if (calculation && active && geometry) {
          simulation.applyJobResult(calculation.result);
          simulation.updateResults({ job: { spec: calculation.spec, result: calculation.result }, flowFrames: calculation.frames,
            flowSnapshot: calculation.frames.at(-1)! });
        }
      } catch (cause) {
        if (!canceled) setError(`项目模型已恢复，结果无法恢复：${cause instanceof Error ? cause.message : String(cause)}`);
      }
      setRestoredId(saved.id);
    })().catch(cause => { if (!canceled) {
      // 恢复失败时上一项目的模型/参数/结果还留在 store 里；若不清理就标记 ready，
      // 自动保存会把残留场景写进这个打不开的项目——等于用别的模型"修复"了它。
      const simulation = useSimulationStore.getState();
      simulation.clearResults();
      simulation.resetParameters();
      const project = useProjectStore.getState();
      project.setActiveModel(null);
      for (const stale of [...project.uploadedModels]) project.removeUploadedModel(stale.metadata.id);
      savedGeometry.current = null;
      pendingSave.current = null;
      setError(`恢复项目失败：${cause instanceof Error ? cause.message : String(cause)}`);
      setRestoredId(selected.id);
    } });
    return () => { canceled = true; };
    // Saving project metadata must not restore over current edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  const saveCurrentProject = useCallback(() => {
    if (!ready || !currentProject || !activeModel || !model) return Promise.resolve();
    pendingSave.current = null;
    const snapshot = { ...currentProject, models: [activeModel], parameters, updatedAt: new Date() };
    const geometry = model.geometry;
    const next = saves.current.then(async () => {
      await storage.saveProject(snapshot, savedGeometry.current === geometry ? undefined : { id: activeModel.id, geometry },
        results.job && results.flowFrames.length ? { ...results.job, frames: results.flowFrames } : null);
      savedGeometry.current = geometry;
      const project = useProjectStore.getState();
      if (!project.projects.some(item => item.id === snapshot.id)) project.addProject(snapshot);
      project.updateProject(snapshot.id, snapshot);
      if (project.currentProject?.id === snapshot.id && project.activeModel === activeModel && useSimulationStore.getState().parameters === parameters) {
        setSavedAt(snapshot.updatedAt); setError(null);
      }
    }).catch(cause => {
      if (useProjectStore.getState().currentProject?.id === snapshot.id) setError(`保存项目失败：${cause instanceof Error ? cause.message : String(cause)}`);
    });
    saves.current = next;
    return next;
  }, [ready, currentProject, activeModel, model, parameters, results, storage]);

  useEffect(() => {
    if (!ready || !activeModel || !model) return;
    setSavedAt(null);
    pendingSave.current = saveCurrentProject;
    const timer = setTimeout(() => { void pendingSave.current?.(); }, 500);
    return () => clearTimeout(timer);
    // A completed save changes project metadata, not the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, currentProject?.id, activeModel, model, parameters, results]);

  useEffect(() => () => { void pendingSave.current?.(); }, []);

  return { ready, error, savedAt, saveCurrentProject };
}
