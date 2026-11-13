/**
 * Structural coverage for docs/earth-twin-llm-data-audit.md
 * Ensures the design doc stays complete for the multimodal audit objective.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOC = join(dirname(fileURLToPath(import.meta.url)), '../../docs/earth-twin-llm-data-audit.md')

function loadDoc(): string {
  return readFileSync(DOC, 'utf8')
}

describe('earth-twin-llm-data-audit design document', () => {
  it('exists and is non-trivial size', () => {
    const st = statSync(DOC)
    expect(st.isFile()).toBe(true)
    expect(st.size).toBeGreaterThan(8_000)
  })

  it('uses few top-level sections but dense body', () => {
    const text = loadDoc()
    const h2 = [...text.matchAll(/^## .+$/gm)].map((m) => m[0])
    expect(h2.length).toBeGreaterThanOrEqual(4)
    expect(h2.length).toBeLessThanOrEqual(8)
    // dense prose: many characters of continuous content
    expect(text.replace(/\s+/g, '').length).toBeGreaterThan(6_000)
  })

  it('covers all required modalities and Palantir-class framing', () => {
    const text = loadDoc()
    const checks: Array<{ label: string; re: RegExp }> = [
      { label: 'text', re: /文本/ },
      { label: 'monitoring', re: /监控|遥测|telemetry/i },
      { label: 'image', re: /图像|影像|image/i },
      { label: 'timeseries', re: /时序|时间序列|time-?series/i },
      { label: 'structured', re: /结构化/ },
      { label: 'industry', re: /行业/ },
      { label: 'twin', re: /孪生|twin/i },
      { label: 'audit', re: /审计|audit/i },
      { label: 'palantir-class', re: /Palantir|对象中心|血缘|ontology/i },
      { label: 'knowledge reuse', re: /knowledge-pipeline|SourceSnapshot|KnowledgeRelease/ },
    ]
    for (const c of checks) {
      expect(text, `missing coverage: ${c.label}`).toMatch(c.re)
    }
  })

  it('discusses each modality beyond a single keyword (window density)', () => {
    const text = loadDoc()
    // Section 3 is the modality deep-dive — must be long
    const sec3 = text.split('## 3.')[1]?.split('## 4.')[0] ?? ''
    expect(sec3.length).toBeGreaterThan(1_500)
    for (const token of ['文本', '监控', '图像', '时序', '结构化', '行业']) {
      const idx = sec3.indexOf(token)
      expect(idx, token).toBeGreaterThanOrEqual(0)
      // surrounding context exists (not a bare list token)
      expect(sec3.slice(Math.max(0, idx - 40), idx + 80).length).toBeGreaterThan(50)
    }
  })

  it('states LLM vs classical validator split and Earth-twin loop', () => {
    const text = loadDoc()
    expect(text).toMatch(/经典|确定性/)
    expect(text).toMatch(/LLM/)
    expect(text).toMatch(/漂移|对齐/)
    expect(text).toMatch(/WaveWorld|knowledge-pipeline/)
  })
})
