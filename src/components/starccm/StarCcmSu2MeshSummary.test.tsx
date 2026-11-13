// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../lib/i18n'
import { StarCcmSu2MeshSummary } from './StarCcmSu2MeshSummary'
import type { ValidatedSu2MeshResult } from './su2MeshResult'

const result: ValidatedSu2MeshResult = {
  format: 'su2-native',
  dimension: 3,
  elementDimension: 3,
  nodeCount: 12,
  elementCount: 4,
  markerCount: 2,
  markerElementCount: 10,
  markers: [{ tag: 'inlet', elementCount: 2, elementTypeCounts: {}, measure: 1 }, { tag: 'wall', elementCount: 8, elementTypeCounts: {}, measure: 4 }],
  boundingBox: { xMin: 0, xMax: 3, yMin: -1, yMax: 4, zMin: 2, zMax: 5 },
  elementTypeCounts: {},
  elementTypeMeasure: {},
  totalLength: 0,
  totalArea: 0,
  totalVolume: 7.5,
  totalMarkerMeasure: 0,
  minElementMeasure: 0.5,
  maxElementMeasure: 7.5,
  referencedNodeCount: 12,
  unusedNodeCount: 0,
  maxNodeIndex: 12,
  invertedElements: 0,
  ok: true,
  methodId: 'method-algo-su2-native-mesh-import',
  familyId: 'mesh-generation',
}

const roots: Root[] = []
const containers: HTMLElement[] = []

function render(props: React.ComponentProps<typeof StarCcmSu2MeshSummary>) {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, createElement(StarCcmSu2MeshSummary, props))))
  return container
}

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.restoreAllMocks()
})

describe('STAR-CCM+ SU2 mesh summary', () => {
  it('shows only the supplied native summary and honest scope text', () => {
    const container = render({ result, sourceText: 'original', submittedMeshText: 'submitted', jobId: 'job-1' })
    expect(container.textContent).toContain('12')
    expect(container.textContent).toContain('inlet')
    expect(container.textContent).toContain('7.5')
    expect(container.textContent).toContain('does not parse STAR-CCM+ .sim files')
    expect(container.textContent).toContain('job-1')
  })

  it('offers downloads only for source text explicitly passed by the parent', () => {
    const container = render({ result, sourceText: 'original mesh', submittedMeshText: 'processed mesh', jobId: 'job-1' })
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mesh')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.map(button => button.textContent)).toEqual(['Download original imported ASCII', 'Download submitted mesh text', 'Download full report (JSON)'])
    act(() => buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob)
  })
})
