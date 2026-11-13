'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { classifyGpuFailure } from '@/lib/lab-diagnostics';

function localGpuMessage(raw: string): string {
  const c = classifyGpuFailure(raw);
  // Prefix keeps Lab overlay classifiers stable across locales.
  if (c.kind === 'webgpu_unavailable') return c.message;
  if (c.kind === 'context_lost') return c.message;
  return c.message;
}

export function useWebGPU() {
  const { gpuContext, setGPUContext } = useSimulationStore();
  const [isInitializing, setIsInitializing] = useState(false);
  const initRef = useRef(false);

  const initialize = async () => {
    if (useSimulationStore.getState().gpuContext.device && useSimulationStore.getState().gpuContext.isInitialized) return;
    if (initRef.current || isInitializing) return;
    initRef.current = true;
    setIsInitializing(true);

    try {
      // 检查 WebGPU 支持
      if (!navigator.gpu) {
        setGPUContext({
          isSupported: false,
          errorMessage: localGpuMessage('当前浏览器不支持 WebGPU'),
        });
        return;
      }

      // 部分驱动上 adapter/device 请求会无限挂起（整页 RESULT_CODE_HUNG）。
      // 用超时兜底：15s 无响应按不支持处理，让用户仍可走 CPU。
      const gpuTimeout = <T>(promise: Promise<T>, what: string) =>
        Promise.race([
          promise,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} 超时（15s)`)), 15000)),
        ]);

      // 请求适配器
      const adapter = await gpuTimeout(navigator.gpu.requestAdapter(), 'GPU 适配器请求');
      if (!adapter) {
        setGPUContext({
          isSupported: false,
          errorMessage: localGpuMessage('无法获取 GPU 适配器'),
        });
        return;
      }

      // 请求设备：尽量提高 storage 绑定上限以支持大网格（失败则回退默认）。
      // 不请求 maxBufferSize —— 只放大求解器实际校验的 binding 上限，避免个别
      // 驱动为超大限额做昂贵校验而挂起。
      const raisedLimits: Record<string, number> = {};
      try {
        const { maxStorageBufferBindingSize } = adapter.limits;
        if (maxStorageBufferBindingSize > 128 * 1024 * 1024) {
          raisedLimits.maxStorageBufferBindingSize = maxStorageBufferBindingSize;
        }
      } catch { /* 读取上限失败则用默认 */ }
      let device: GPUDevice;
      try {
        device = await gpuTimeout(adapter.requestDevice({ requiredLimits: raisedLimits }), 'GPU 设备请求');
      } catch {
        device = await gpuTimeout(adapter.requestDevice(), 'GPU 设备请求');
      }

      // 监听未捕获的 GPU 校验错误（显示到 UI 便于排查；局部可恢复）
      device.addEventListener('uncapturederror', (event) => {
        if (useSimulationStore.getState().gpuContext.device !== device) return;
        const gpuError = (event as GPUUncapturedErrorEvent).error;
        console.error('WebGPU uncaptured error:', gpuError.message);
        setGPUContext({
          errorMessage: localGpuMessage(`WebGPU 错误: ${gpuError.message}`),
        });
      });

      setGPUContext({
        device,
        isSupported: true,
        isInitialized: true,
        errorMessage: null,
      });

      // 监听设备丢失 → context_lost（局部恢复，不拖垮整页）
      device.lost.then((info) => {
        if (useSimulationStore.getState().gpuContext.device !== device) return;
        console.error('WebGPU device lost:', info.message);
        setGPUContext({
          device: null,
          isInitialized: false,
          errorMessage: localGpuMessage(`GPU 设备丢失: ${info.message}`),
        });
      });

    } catch (error) {
      console.error('WebGPU initialization error:', error);
      const raw = error instanceof Error ? error.message : '初始化失败';
      setGPUContext({
        isSupported: false,
        errorMessage: localGpuMessage(raw),
      });
    } finally {
      initRef.current = false;
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    // 自动检测 WebGPU 支持
    if (navigator.gpu) {
      setGPUContext({ isSupported: true });
    } else {
      setGPUContext({
        isSupported: false,
        errorMessage: localGpuMessage('当前浏览器不支持 WebGPU'),
      });
    }
  }, [setGPUContext]);

  return {
    isSupported: gpuContext.isSupported,
    isInitialized: gpuContext.isInitialized,
    isInitializing,
    errorMessage: gpuContext.errorMessage,
    device: gpuContext.device,
    initialize,
  };
}
