import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startRafLoop } from './visibilityRaf'

let frames: Map<number, FrameRequestCallback>
let visibility: (() => void) | undefined
let hidden: boolean
beforeEach(() => {
  frames = new Map()
  hidden = false
  let id = 0
  vi.stubGlobal('document', {
    get hidden() { return hidden },
    addEventListener: (_: string, callback: () => void) => { visibility = callback },
    removeEventListener: () => { visibility = undefined },
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
})
afterEach(() => vi.unstubAllGlobals())

function tick() {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((callback) => callback(performance.now()))
}

it('runs one loop across visibility changes and cleans up', () => {
  const frame = vi.fn()
  const stop = startRafLoop(frame)
  expect(frame).toHaveBeenCalledTimes(1)
  visibility?.(); visibility?.()
  expect(frames.size).toBe(1)
  hidden = true
  tick()
  expect(frames.size).toBe(0)
  hidden = false
  visibility?.(); visibility?.()
  tick()
  expect(frame).toHaveBeenCalledTimes(3)
  stop()
  expect(frames.size).toBe(0)
  expect(visibility).toBeUndefined()
})

it('serializes async frames and ignores a disposed rejection', async () => {
  let reject!: (error: Error) => void
  const fail = vi.fn()
  const frame = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
  const stop = startRafLoop(frame, fail)
  visibility?.(); visibility?.(); tick()
  expect(frame).toHaveBeenCalledTimes(1)
  expect(frames.size).toBe(0)
  stop()
  reject(new Error('old device lost'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(fail).not.toHaveBeenCalled()
  expect(frames.size).toBe(0)
})

it.each(['sync', 'async'])('reports %s failure once and stops', async (kind) => {
  const fail = vi.fn()
  const error = new Error('solver failed')
  const stop = startRafLoop(() => {
    if (kind === 'sync') throw error
    return Promise.reject(error)
  }, fail)
  await new Promise((resolve) => setTimeout(resolve, 0))
  visibility?.(); tick()
  expect(fail).toHaveBeenCalledTimes(1)
  expect(fail).toHaveBeenCalledWith(error)
  expect(frames.size).toBe(0)
  stop()
})
