import { expect, test } from '@playwright/test'
import path from 'node:path'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'zh'))
})

const localLab = `http://127.0.0.1:${process.env.E2E_LAB_PORT ?? 4180}`
const fixtures = path.resolve('e2e/fixtures/fem-includes')

test.describe('结构工程导入', () => {
  test('从文件夹保留 include 相对路径、选择入口并导出 JobSpec', async ({ page }) => {
    await page.goto(`${localLab}/`)
    await page.getByRole('link', { name: '结构工程导入', exact: true }).first().click()
    await expect(page).toHaveURL(/\/import\/fem$/)
    await expect(page.getByRole('heading', { name: '结构工程导入' })).toBeVisible()

    await page.getByLabel('选择工程文件夹').setInputFiles(path.join(fixtures, 'cantilever'))
    await page.getByLabel('主 .inp 文件', { exact: true }).selectOption('main.inp')
    await expect(page.getByText('mesh/nodes.inc', { exact: true })).toBeVisible()
    await expect(page.getByText('mesh/elements.inc', { exact: true })).toBeVisible()
    await expect(page.getByText('1（单各向同性材料映射）')).toBeVisible()
    await expect(page.getByRole('button', { name: '导出 JobSpec JSON' })).toBeEnabled()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出 JobSpec JSON' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.json$/)
  })

  test('缺失的 include 显示来源行号并禁止导出', async ({ page }) => {
    await page.goto(`${localLab}/import/fem`)
    await page.getByLabel('选择主 .inp 文件').setInputFiles(path.join(fixtures, 'missing-include/main.inp'))
    await expect(page.getByText('mesh/missing-nodes.inp', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '导出 JobSpec JSON' })).toBeDisabled()
  })
})
