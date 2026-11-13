// @vitest-environment happy-dom
import { act, createElement, useCallback, useRef, useState, type ContextType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModuleComputeContext } from '../../lib/hooks/useModuleCompute'
import { AbaqusMatrixStudyPanel } from './AbaqusMatrixStudyPanel'

const nativeResult = {
  module: 'sw-ansys-modal',
  familyId: 'method-ansys-modal-analysis',
  ok: true,
  methodId: 'method-block-lanczos',
  method: 'block-lanczos',
  backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
  n: 2,
  numModes: 2,
  solver: { algorithm: 'block-lanczos', converged: true, residual: 1e-14, tolerance: 1e-10 },
  eigenvalues: [3.5, 9.25],
  frequenciesHz: [Math.sqrt(3.5) / (2 * Math.PI), Math.sqrt(9.25) / (2 * Math.PI)],
  frequenciesRadS: [Math.sqrt(3.5), Math.sqrt(9.25)],
  periodsS: [2 * Math.PI / Math.sqrt(3.5), 2 * Math.PI / Math.sqrt(9.25)],
  modeShapes: [[1, 0], [0, 0.7071067811865476]],
  modalMass: [1, 1],
  participationFactors: [1, 0.707],
  effectiveMass: [1, 0.5],
  effectiveMassRatio: [0.667, 1],
  massNormalized: true,
  system: { type: 'explicit', n: 2 },
} as const

const stiffnessText = '20,2,20,2,9\n10,1,10,1,4\n20,2,10,1,-1'
const massText = '20,2,20,2,2\n10,1,10,1,1\n20,2,10,1,0'

type RunMode = 'success' | 'pending' | 'login' | 'error'
let runMode: RunMode = 'success'
let registeredCapture: (() => unknown) | undefined
let finishPending: (() => void) | undefined
let run: ReturnType<typeof vi.fn>

function ComputeHarness() {
  const [result, setResult] = useState<{ key: string; input: any; output: any } | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState<string | null>(null)
  const captureRef = useRef<(() => unknown) | undefined>(undefined)
  const register = useCallback((key: string | null, capture?: () => unknown) => {
    registeredCapture = key ? capture : undefined
    captureRef.current = key ? capture : undefined
  }, [])
  const start = useCallback(async () => {
    run()
    if (runMode === 'pending') {
      setBusy(true)
      setStatus('running')
      const input = captureRef.current?.()
      finishPending = () => {
        if (input) setResult({ key: JSON.stringify(input), input, output: nativeResult })
        setBusy(false)
        setStatus('succeeded')
      }
      return
    }
    if (runMode === 'login' || runMode === 'error') {
      setError(runMode === 'login' ? '需要登录' : 'Host job failed')
      setStatus('failed')
      return
    }
    const input = captureRef.current?.()
    if (input) setResult({ key: JSON.stringify(input), input, output: nativeResult })
    setBusy(false)
    setStatus('succeeded')
  }, [])
  const stop = useCallback(async () => {
    setBusy(false)
    setStatus('cancelled')
    return true
  }, [])
  const clear = useCallback(() => {
    setResult(null)
    setError(null)
    setBusy(false)
    setStatus('idle')
  }, [])
  const value = {
    target: 'backend' as const,
    setTarget: async () => {},
    register,
    reportLocalError: () => {},
    connected: true,
    browserAgent: false,
    precision: null,
    result,
    status,
    error,
    loginRequired: runMode === 'login' && !!error,
    jobId: result ? 'matrix-study-1' : busy ? 'matrix-study-pending' : null,
    busy,
    cancelPending: false,
    start,
    stop,
    clear,
  } as unknown as NonNullable<ContextType<typeof ModuleComputeContext>>
  return <ModuleComputeContext.Provider value={value}><AbaqusMatrixStudyPanel /></ModuleComputeContext.Provider>
}

let roots: Root[] = []
let containers: HTMLElement[] = []

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, createElement(ComputeHarness))))
  return { container }
}

function click(container: HTMLElement, testId: string) {
  const button = container.querySelector(`[data-testid="${testId}"]`)
  if (!(button instanceof HTMLElement)) throw new Error(`missing ${testId}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function change(container: HTMLElement, testId: string, value: string) {
  const input = container.querySelector(`[data-testid="${testId}"]`)
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing input ${testId}`)
  act(() => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function upload(container: HTMLElement, testId: string, name: string, contents: string) {
  const input = container.querySelector(`[data-testid="${testId}"]`)
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing file input ${testId}`)
  const file = new File([contents], name, { type: 'text/plain' })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function uploadPair(container: HTMLElement, k = stiffnessText, m = massText) {
  await upload(container, 'abaqus-matrix-stiffness-file', 'synthetic-stiffness.mtx', k)
  await upload(container, 'abaqus-matrix-mass-file', 'synthetic-mass.mtx', m)
  if (container.querySelector('[data-testid="abaqus-matrix-num-modes"]')) change(container, 'abaqus-matrix-num-modes', '2')
}

beforeEach(() => {
  runMode = 'success'
  registeredCapture = undefined
  finishPending = undefined
  run = vi.fn()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:matrix-study')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.restoreAllMocks()
})

describe('Abaqus assembled-matrix modal study panel', () => {
  it('previews both uploaded matrices and their sorted node/DOF mapping, with an explicit unit assumption', async () => {
    const { container } = render()
    expect((container.querySelector('[data-testid="abaqus-matrix-submit"]') as HTMLButtonElement).disabled).toBe(true)
    await uploadPair(container)

    expect(container.querySelector('[data-testid="abaqus-matrix-preview"]')?.textContent).toContain('synthetic-stiffness.mtx')
    expect(container.querySelector('[data-testid="abaqus-matrix-preview"]')?.textContent).toContain('synthetic-mass.mtx')
    expect(container.querySelector('[data-testid="abaqus-matrix-preview"]')?.textContent).toContain('[{"index":0,"node":10,"dof":1},{"index":1,"node":20,"dof":2}]')
    const submit = container.querySelector('[data-testid="abaqus-matrix-submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    expect(container.textContent).toMatch(/consistent unit system|consistent units|单位一致/i)
    expect(container.textContent).not.toMatch(/Matrix Market/i)
  })

  it('submits the exact Host Block-Lanczos payload with the sorted pair and the 16-DOF ceiling', async () => {
    const { container } = render()
    await uploadPair(container)
    click(container, 'abaqus-matrix-submit')

    expect(run).toHaveBeenCalledOnce()
    expect(registeredCapture).toBeTypeOf('function')
    expect((registeredCapture as () => Record<string, any>)()).toEqual({
      module: 'sw-ansys-modal',
      backend: 'host',
      method: 'block-lanczos',
      stiffness: [[4, -1], [-1, 9]],
      mass: [[1, 0], [0, 2]],
      numModes: 2,
      shift: 0,
      direction: [1, 1],
      tolerance: 1e-10,
    })
    expect((registeredCapture as () => Record<string, any>)().stiffness.length).toBeLessThanOrEqual(16)
  })

  it('rejects an invalid matrix pair and invalid options without calling start', async () => {
    const { container } = render()
    await uploadPair(container, '1,1,1,1,4\n2,1,2,1,9', '1,1,1,1,1')
    expect(container.querySelector('[data-testid="abaqus-matrix-import-error"]')).not.toBeNull()
    expect((container.querySelector('[data-testid="abaqus-matrix-submit"]') as HTMLButtonElement).disabled).toBe(true)
    expect(run).not.toHaveBeenCalled()

    const validView = render()
    await uploadPair(validView.container)
    change(validView.container, 'abaqus-matrix-num-modes', '3')
    expect((validView.container.querySelector('[data-testid="abaqus-matrix-submit"]') as HTMLButtonElement).disabled).toBe(true)
    click(validView.container, 'abaqus-matrix-submit')
    expect(run).not.toHaveBeenCalled()
  })

  it('shows backend, solver and modes, discloses units, exports reports, and avoids solver or parity claims', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createObjectUrl = URL.createObjectURL as ReturnType<typeof vi.fn>
    const { container } = render()
    await uploadPair(container)
    click(container, 'abaqus-matrix-submit')

    const results = container.querySelector('[data-testid="abaqus-matrix-results"]')
    expect(results?.textContent).toContain('host-f64')
    expect(results?.textContent).toContain('block-lanczos')
    expect(results?.textContent).toContain('frequenciesHz')
    expect(results?.textContent).toContain('modeShapes')
    expect(results?.textContent).toMatch(/consistent unit system|consistent units|单位一致/i)
    expect(results?.textContent).toMatch(/seconds|秒/)
    expect(results?.textContent).not.toMatch(/Abaqus (?:solver|solve)|Ansys (?:solver|solve)|vendor parity (?:verified|confirmed|match)/i)

    vi.useFakeTimers()
    try {
      click(container, 'abaqus-matrix-download-csv')
      click(container, 'abaqus-matrix-download-json')
      vi.runAllTimers()
    } finally { vi.useRealTimers() }
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    expect(anchorClick).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    const exportedJson = await (createObjectUrl.mock.calls[1]?.[0] as Blob).text()
    expect(exportedJson).toContain('consistent unit system')
    expect(exportedJson).toContain('synthetic-stiffness.mtx')
    expect(exportedJson).toContain('synthetic-mass.mtx')
    expect(exportedJson).not.toMatch(/Matrix Market/i)
  })

  it('cancels a pending request and drops results when the matrices are reset', async () => {
    runMode = 'pending'
    const { container } = render()
    await uploadPair(container)
    click(container, 'abaqus-matrix-submit')
    expect((container.querySelector('[data-testid="abaqus-matrix-submit"]') as HTMLButtonElement).disabled).toBe(true)
    expect(container.querySelector('[data-testid="abaqus-matrix-cancel"]')).not.toBeNull()
    click(container, 'abaqus-matrix-cancel')
    expect(container.querySelector('[data-testid="abaqus-matrix-results"]')).toBeNull()

    runMode = 'pending'
    click(container, 'abaqus-matrix-submit')
    click(container, 'abaqus-matrix-reset')
    expect(container.querySelector('[data-testid="abaqus-matrix-results"]')).toBeNull()
    expect(container.querySelector('[data-testid="abaqus-matrix-preview"]')).toBeNull()
    act(() => finishPending?.())
    expect(container.querySelector('[data-testid="abaqus-matrix-results"]')).toBeNull()
  })

  it('surfaces login and Host errors without presenting a result', async () => {
    const { container } = render()
    await uploadPair(container)

    runMode = 'login'
    click(container, 'abaqus-matrix-submit')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('需要登录')
    expect(container.querySelector('[data-testid="abaqus-matrix-results"]')).toBeNull()

    runMode = 'error'
    click(container, 'abaqus-matrix-submit')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Host job failed')
    expect(container.querySelector('[data-testid="abaqus-matrix-results"]')).toBeNull()
  })
})
