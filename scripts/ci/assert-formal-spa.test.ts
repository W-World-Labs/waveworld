import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FORMAL_RADAR_BINDING,
  validateFormalSpaHtml,
} from './assert-formal-spa.mjs'

const validTag = `<script async src="${FORMAL_RADAR_BINDING.bootstrapUrl}" data-client-kind="${FORMAL_RADAR_BINDING.clientKind}" data-workspace-id="${FORMAL_RADAR_BINDING.workspaceId}" data-project-id="${FORMAL_RADAR_BINDING.projectId}" data-code="${FORMAL_RADAR_BINDING.trackingCode}" data-track-behavior="true"></script>`

describe('formal SPA Radar bootstrap gate', () => {
  it('accepts the registered WaveWorld binding regardless of attribute order', () => {
    expect(() =>
      validateFormalSpaHtml(
        `<html><head><script data-track-behavior="true" data-code="${FORMAL_RADAR_BINDING.trackingCode}" data-project-id="waveworld" src="${FORMAL_RADAR_BINDING.bootstrapUrl}" data-workspace-id="ws_platform" async data-client-kind="paas-platform"></script></head></html>`,
      ),
    ).not.toThrow()
  })

  it.each([
    ['missing bootstrap', '<html></html>', 'found 0'],
    [
      'stale cached bootstrap URL',
      validTag.replace(
        FORMAL_RADAR_BINDING.bootstrapUrl,
        'https://radar.myfastools.com/platform/bootstrap.js?v=1.4.86',
      ),
      'found 0',
    ],
    ['duplicate bootstrap', `${validTag}${validTag}`, 'found 2'],
    [
      'wrong tracking code',
      validTag.replace(FORMAL_RADAR_BINDING.trackingCode, 'W-WAVEWORLD-STALE'),
      'data-code must be',
    ],
    [
      'wrong project binding',
      validTag.replace('data-project-id="waveworld"', 'data-project-id="other"'),
      'data-project-id must be waveworld',
    ],
    ['blocking bootstrap', validTag.replace(' async', ''), 'must load asynchronously'],
  ])('rejects %s', (_label, html, message) => {
    expect(() => validateFormalSpaHtml(html)).toThrow(message)
  })

  it('pins the formal binding in source and the reviewed public build/archive workflow', () => {
    const shell = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    expect(() => validateFormalSpaHtml(shell)).not.toThrow()

    const ci = readFileSync(new URL('../../.github/workflows/source.yml', import.meta.url), 'utf8')
    expect(ci).toContain('npm run check:formal-spa')
    expect(ci).toContain('python3 scripts/package-public-source.py "$RUNNER_TEMP/waveworld-source"')
    expect(ci).toContain('name: waveworld-source-${{ github.sha }}')
  })
})
