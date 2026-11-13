import assert from 'node:assert/strict';
import test from 'node:test';
import { createHookHarness } from './test-hook-harness';
import type { ModelGeometry, ModelMetadata, WindTunnelModel } from '../types/model';
import type { Project } from '../lib/stores/project-store';

const tick = () => new Promise(resolve => setImmediate(resolve));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function makeMetadata(id: string, name: string): ModelMetadata {
  return { id, name, format: 'stl', fileSize: 36, uploadDate: new Date(0),
    vertexCount: 3, faceCount: 1,
    boundingBox: { min: [0, 0, 0], max: [1, 1, 0], center: [0.5, 0.5, 0], size: [1, 1, 0] },
    isWatertight: true, hasNormals: true, hasUVs: false, manifoldEdges: 0, nonManifoldEdges: 0 };
}

function makeGeometry(): ModelGeometry {
  return { vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) };
}

function makeTunnelModel(metadata: ModelMetadata): WindTunnelModel {
  return { id: metadata.id, name: metadata.name, sourceModel: metadata, isActive: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tunnelPosition: [0, 0, 0], tunnelRotation: [0, 0, 0] };
}

function makeProject(id: string, model: WindTunnelModel, inletVelocity: number): Project {
  return { id, name: id, description: '', createdAt: new Date(0), updatedAt: new Date(0),
    models: [model], parameters: { inletVelocity }, snapshots: [] };
}

for (const mode of ['missing', 'corrupt'] as const) {
  test(`failed restore (${mode} model blob) cannot autosave the previous scene into the failed project`, async t => {
    // zustand persist reads window.localStorage when the store module initializes; shim it first.
    const memory = new Map<string, string>();
    const localStorageShim = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, String(value)); },
      removeItem: (key: string) => { memory.delete(key); },
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() { return memory.size; },
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageShim });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: localStorageShim } });
    const { useProjectPersistence } = await import('./use-project-persistence');
    const { useProjectStore, createWindTunnelModel } = await import('../lib/stores/project-store');
    const { useSimulationStore } = await import('../lib/stores/simulation-store');
    type Storage = NonNullable<Parameters<typeof useProjectPersistence>[0]>;

    const metaA = makeMetadata(`model-a-${mode}`, 'Model A');
    const metaB = makeMetadata(`model-b-${mode}`, 'Model B');
    const geometryA = makeGeometry();
    const projectA = makeProject(`project-a-${mode}`, makeTunnelModel(metaA), 42);
    const projectB = makeProject(`project-b-${mode}`, makeTunnelModel(metaB), 7);

    const saves: { project: Project; model?: { id: string; geometry: ModelGeometry }; calculation?: unknown }[] = [];
    const storage: Storage = {
      loadProject: async id => id === projectA.id ? projectA : id === projectB.id ? projectB : null,
      // B's geometry blob is missing/corrupt → the hard restore path throws.
      loadModelData: mode === 'missing'
        ? async id => id === metaA.id ? geometryA : null
        : async id => { if (id === metaA.id) return geometryA; throw new Error('保存的模型数据格式无效'); },
      loadProjectResult: async () => null,
      saveProject: async (project, model, calculation) => { saves.push({ project, model, calculation }); },
    };

    useProjectStore.setState({ currentProject: projectA, projects: [projectA, projectB], uploadedModels: [], activeModel: null });
    useSimulationStore.getState().resetParameters();
    useSimulationStore.getState().clearResults();

    const harness = createHookHarness(() => useProjectPersistence(storage));
    t.after(() => harness.unmount());
    await tick(); await tick();
    assert.equal(harness.result.ready, true);
    assert.equal(useProjectStore.getState().activeModel?.id, metaA.id);
    assert.equal(useSimulationStore.getState().parameters.inletVelocity, 42);

    await sleep(600); // autosave debounce: A's own scene persists into A's record
    assert.equal(saves.filter(save => save.project.id === projectA.id).length, 1);
    saves.length = 0;

    useProjectStore.getState().setCurrentProject(projectB);
    await tick(); await tick();
    // ready stays true so the lab renders the error; the leftover scene is gone.
    assert.equal(harness.result.ready, true);
    assert.match(harness.result.error ?? '', /恢复项目失败/);
    assert.equal(useProjectStore.getState().activeModel, null);
    assert.deepEqual(useProjectStore.getState().uploadedModels, []);
    assert.equal(useSimulationStore.getState().parameters.inletVelocity, 10);
    assert.equal(useSimulationStore.getState().results.job, null);

    // 旧实现 uploadedModels 里还留着 A 的模型：在「已加载模型」里点「用于仿真」会重新激活
    // 旧场景，自动保存随即把 A 的模型/参数写进 B 的 IndexedDB 记录。现在列表已清空，model
    // 解析不到，自动保存必须保持静默。
    useProjectStore.getState().setActiveModel(createWindTunnelModel(metaA));
    await sleep(600);
    assert.equal(saves.filter(save => save.project.id === projectB.id).length, 0);

    // 错误提示引导用户重新导入；新导入的模型仍应能正常写回 B（修复路径不受影响）。
    const fresh = makeMetadata(`model-reimport-${mode}`, 'Reimported');
    const freshGeometry = makeGeometry();
    useProjectStore.getState().addUploadedModel({ metadata: fresh, geometry: freshGeometry });
    useProjectStore.getState().setActiveModel(createWindTunnelModel(fresh));
    await sleep(600);
    const repairs = saves.filter(save => save.project.id === projectB.id);
    assert.equal(repairs.length, 1);
    assert.equal(repairs[0].project.models[0].id, fresh.id);
    assert.equal(repairs[0].project.parameters.inletVelocity, 10);
    assert.equal(repairs[0].model?.id, fresh.id);
  });
}
