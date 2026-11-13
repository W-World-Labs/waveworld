// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../lib/i18n/LocaleContext'
import { IgbtSpatialJobForm } from './IgbtSpatialJobForm'

const mocks = vi.hoisted(() => ({ submitSpatialIgbtJob: vi.fn() }))
vi.mock('../../lib/hostApi', () => ({ submitSpatialIgbtJob: mocks.submitSpatialIgbtJob }))

let root: Root | null = null
let container: HTMLElement | null = null
beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(createElement(LocaleProvider, null, createElement(MemoryRouter, null, createElement(IgbtSpatialJobForm)))))
})
afterEach(() => { if (root) act(() => root!.unmount()); root = null; container?.remove(); container = null })

async function clickSubmit() {
  const button = [...container!.querySelectorAll('button')].find(node => node.textContent?.includes('校验并提交'))
  if (!button) throw new Error('submit button missing')
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
}

describe('spatial IGBT submission form', () => {
  it('submits the validated native spec and displays the Host job link', async () => {
    mocks.submitSpatialIgbtJob.mockResolvedValue({ id: 'job-igbt-1', status: 'queued', kind: 'electro-thermal-igbt' })
    await clickSubmit()
    expect(mocks.submitSpatialIgbtJob).toHaveBeenCalledTimes(1)
    const [spec, signal] = mocks.submitSpatialIgbtJob.mock.calls[0]!
    expect(spec.requirements.backends).toEqual(['native-cuda'])
    expect(spec.requirements.features).toContain('thermal-igbt-spatial-chip-v1')
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(container!.textContent).toContain('job-igbt-1')
    expect(container!.querySelector('a')?.getAttribute('href')).toBe('/batch-jobs?job=job-igbt-1')
  })

  it('clears a ready result when an input is edited', async () => {
    mocks.submitSpatialIgbtJob.mockResolvedValue({ id: 'job-before-edit', status: 'queued', kind: 'electro-thermal-igbt' })
    await clickSubmit()
    expect(container!.textContent).toContain('job-before-edit')
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="Material 1 name"]')
    expect(input).not.toBeNull()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'Edited synthetic substrate')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container!.textContent).not.toContain('job-before-edit')
  })

  it('keeps focus while editing the die ID', async () => {
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="器件 1 ID"]')
    expect(input).not.toBeNull()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      input!.focus()
      setter?.call(input, 'Q1-edited')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.activeElement).toBe(input)
    expect(input?.value).toBe('Q1-edited')
  })

  it('warns that an in-flight submit may have reached Host when editing aborts the wait', async () => {
    let capturedSignal: AbortSignal | undefined
    mocks.submitSpatialIgbtJob.mockImplementation((_spec: unknown, signal: AbortSignal) => {
      capturedSignal = signal
      return new Promise(() => {})
    })
    await clickSubmit()
    const material = container!.querySelector<HTMLInputElement>('input[aria-label="Material 1 name"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(material, 'Edited while submitting')
      material.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(capturedSignal?.aborted).toBe(true)
    expect(container!.textContent).toContain('提交状态未确认')
    expect(container!.querySelector('a[href="/batch-jobs"]')).not.toBeNull()
  })

  it('shows the same queue warning after a network or response error', async () => {
    mocks.submitSpatialIgbtJob.mockRejectedValue(new Error('submit spatial IGBT HTTP 502'))
    await clickSubmit()
    expect(container!.textContent).toContain('提交状态未确认')
    expect(container!.textContent).toContain('HTTP 502')
    expect(container!.querySelector('a[href="/batch-jobs"]')).not.toBeNull()
  })

  it('aborts an in-flight submission when the form unmounts', async () => {
    let capturedSignal: AbortSignal | undefined
    mocks.submitSpatialIgbtJob.mockImplementation((_spec: unknown, signal: AbortSignal) => {
      capturedSignal = signal
      return new Promise(() => {})
    })
    await clickSubmit()
    expect(capturedSignal?.aborted).toBe(false)
    act(() => root!.unmount()); root = null
    expect(capturedSignal?.aborted).toBe(true)
  })
})
