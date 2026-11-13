/**
 * Optics lab preset smoke: load /optics-lab headless, capture
 * pageerror / console.error / asset failures, then switch the new
 * classic wave-optics benches through the preset <select> and assert
 * the SVG scene + readouts actually rebuild (DOM checks, no pixel diffs).
 * Expected component counts are frozen from opticsPreset() — the module
 * is not imported here because its wasm-fields chain uses TS parameter
 * properties that the Playwright strip-only loader rejects.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import {
  isBenignSimVisualConsole,
  isBenignSimVisualFailedResponseUrl,
} from '../src/lib/sim/simVisualLaunchContract'

/** 可忽略的控制台噪声（同 smoke-routes：无头环境 WebGPU/WebGL 警告等）。 */
function isBenignConsole(text: string): boolean {
  if (isBenignSimVisualConsole(text)) return true
  const t = text.toLowerCase()
  if (t.includes('webgpu') && (t.includes('not supported') || t.includes('failed to get') || t.includes('no adapter'))) {
    return true
  }
  if (t.includes('webgl') && (t.includes('disabled') || t.includes('not supported'))) return true
  if (t.includes('fonts.googleapis.com') || t.includes('fonts.gstatic.com')) return true
  if (t.includes('react router future flag')) return true
  return false
}

type Capture = {
  pageErrors: string[]
  consoleErrors: string[]
  badResponses: string[]
  failedRequests: string[]
}

function attachCapture(page: Page): Capture {
  const cap: Capture = { pageErrors: [], consoleErrors: [], badResponses: [], failedRequests: [] }
  page.on('pageerror', (err) => {
    cap.pageErrors.push(err.message || String(err))
  })
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (isBenignConsole(text)) return
    cap.consoleErrors.push(text)
  })
  page.on('response', (res) => {
    const status = res.status()
    if (status < 400) return
    const url = res.url()
    if (isBenignSimVisualFailedResponseUrl(url)) return
    const ct = res.headers()['content-type'] ?? ''
    const isAsset =
      /\.(js|mjs|css|wasm|json|map)(\?|$)/i.test(url) ||
      ct.includes('javascript') ||
      ct.includes('css') ||
      ct.includes('wasm')
    if (isAsset || url.includes('/assets/')) {
      cap.badResponses.push(`${status} ${url}`)
    }
  })
  page.on('requestfailed', (req) => {
    const url = req.url()
    if (isBenignSimVisualFailedResponseUrl(url)) return
    cap.failedRequests.push(`${req.failure()?.errorText ?? 'failed'} ${url}`)
  })
  return cap
}

async function settleRoute(page: Page) {
  await page.waitForLoadState('domcontentloaded')
  await page.locator('#root').waitFor({ state: 'attached' })
  await page.locator('#root').evaluate(async (root) => {
    const start = performance.now()
    while (performance.now() - start < 12_000) {
      if (root.childElementCount > 0 && (root.textContent?.trim().length ?? 0) > 0) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('#root 在超时内仍无可见内容（懒加载或渲染失败）')
  })
  await page.waitForTimeout(400)
}

const SCENE = 'svg[aria-label="Optics scene"]'
const READOUT = 'div[data-optics-readout]'
/** zh / en 通用的惠更斯叠加读数标记。 */
const HUYGENS_RE = /惠更斯干涉|Huygens interference/
const FRINGE_RE = /Δy ≈ λD\/d/

/** 波动光学新预设：狭缝 / 马赫–曾德 / 波带片，各走不同惠更斯源路径。parts 为 opticsPreset(id).length。 */
const WAVE_PRESETS: {
  id: string
  label: string
  labelEn: string
  parts: number
  expectFringe: boolean
}[] = [
  { id: 'young-double-slit', label: '杨氏双缝', labelEn: "Young's double slit", parts: 5, expectFringe: true },
  { id: 'mach-zehnder', label: '马赫–曾德干涉仪', labelEn: 'Mach–Zehnder interferometer', parts: 7, expectFringe: true },
  { id: 'zone-plate', label: '菲涅耳波带片', labelEn: 'Fresnel zone plate', parts: 12, expectFringe: false },
]

test.describe('optics lab presets (headless)', () => {
  test('loads clean, then rebuilds the scene for classic wave benches', async ({ page }) => {
    const cap = attachCapture(page)

    const res = await page.goto('/optics-lab', { waitUntil: 'commit' })
    expect(res, 'no response: /optics-lab').toBeTruthy()
    expect(res!.status(), `HTTP ${res!.status()} /optics-lab`).toBeLessThan(400)

    await settleRoute(page)

    const scene = page.locator(SCENE)
    const readout = page.locator(READOUT)
    const presetSelect = page.getByRole('combobox')

    await expect(scene).toBeAttached()
    await expect(readout).toBeAttached()
    await expect(presetSelect).toHaveCount(1)

    // 初始布局 mirror-bounce：3 件纯几何光线，无惠更斯叠加标记
    await expect(presetSelect).toHaveValue('mirror-bounce')
    expect(
      await scene.locator('g').count(),
      'initial glyph count should match mirror-bounce components',
    ).toBe(3)
    await expect(readout.locator('strong').first()).toHaveText('3')
    await expect(readout).not.toContainText(HUYGENS_RE)

    for (const { id, label, labelEn, parts, expectFringe } of WAVE_PRESETS) {
      await presetSelect.selectOption(id)
      await expect(presetSelect).toHaveValue(id)

      // 场景重建：元件字形数 == 预设组件数，读数同步
      expect(
        await scene.locator('g').count(),
        `${id}: glyph count should match preset component count`,
      ).toBe(parts)
      await expect(readout.locator('strong').first()).toHaveText(String(parts))

      // 光线段已重算（WASM 内核本地跑通 → 屏上有段，而不是 '—'）
      const raySegs = await readout.locator('strong').nth(1).textContent()
      expect(
        Number(raySegs),
        `${id}: ray segment readout should be a positive number`,
      ).toBeGreaterThan(0)
      expect(
        await scene.locator(':scope > line').count(),
        `${id}: traced ray segments should render as svg lines`,
      ).toBeGreaterThan(0)

      // 波动预设叠加惠更斯场；双源布局还给出 Δy≈λD/d 教学标尺
      await expect(readout, `${id}: Huygens overlay readout`).toContainText(HUYGENS_RE)
      if (expectFringe) {
        await expect(readout, `${id}: fringe-scale readout`).toContainText(FRINGE_RE)
      }

      // 一键实验台卡片同步高亮当前预设（计算开关等其它 aria-pressed 控件不算卡片，
      // 用预设名过滤；zh/en 任一命中即可）
      const pressed = page.locator('button[aria-pressed="true"]')
      const activeCard = pressed
        .filter({ hasText: label })
        .or(pressed.filter({ hasText: labelEn }))
      await expect(activeCard, `${id}: exactly one pressed preset card`).toHaveCount(1)
    }

    // 致命：未捕获异常 / 控制台 error / 关键资源失败（含切换过程）
    const failures = [
      ...cap.pageErrors.map((m) => `[pageerror] ${m}`),
      ...cap.consoleErrors.map((m) => `[console.error] ${m}`),
      ...cap.badResponses.map((m) => `[response] ${m}`),
      ...cap.failedRequests.map((m) => `[requestfailed] ${m}`),
    ]
    expect(failures, failures.join('\n')).toEqual([])
  })
})
