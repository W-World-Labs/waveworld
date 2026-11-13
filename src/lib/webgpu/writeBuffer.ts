/**
 * queue.writeBuffer 包装：TS 5.x 下 Float32Array 的 buffer 类型是 ArrayBufferLike，
 * 与 @webgpu/types 的 GPUAllowSharedBufferSource 偶发不兼容；运行时安全。
 */
export function writeGpuBuffer(
  queue: GPUQueue,
  buffer: GPUBuffer,
  offset: number,
  data: ArrayBufferView,
): void {
  queue.writeBuffer(buffer, offset, data as unknown as GPUAllowSharedBufferSource)
}
