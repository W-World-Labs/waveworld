import { describe, expect, it } from 'vitest'
import {
  resolveHostApiBase,
  resolveFullLabPageUrl,
  resolveIsLabUiConfigured,
  resolveLabUiBase,
} from './labEntry'

describe('resolveHostApiBase', () => {
  it('uses same-origin ingress for Vite and production, with a private Next Lab proxy prefix', () => {
    for (const port of ['5173', '4173', '4174']) {
      expect(resolveHostApiBase({ hostname: 'localhost', port })).toBe('')
      expect(resolveHostApiBase({ hostname: '127.0.0.1', port })).toBe('')
    }
    expect(resolveHostApiBase({ hostname: 'localhost', port: '3000' })).toBe('/host-api')
    expect(resolveHostApiBase({ hostname: '127.0.0.1', port: '3000' })).toBe('/host-api')
    expect(resolveHostApiBase({ hostname: 'waveworld.example', port: '' })).toBe('')
  })
})

describe('resolveLabUiBase', () => {
  it('prefers explicit env URL (strip trailing slash)', () => {
    expect(
      resolveLabUiBase({
        envLabUrl: 'https://labs.auto.ml/app/lab/',
        hostname: 'labs.auto.ml',
        origin: 'https://labs.auto.ml',
      }),
    ).toBe('https://labs.auto.ml/app/lab')
  })

  it('public host without env → same-origin /app/lab (not empty)', () => {
    const base = resolveLabUiBase({
      hostname: 'labs.auto.ml',
      port: '',
      origin: 'https://labs.auto.ml',
    })
    expect(base).toBe('https://labs.auto.ml/app/lab')
    expect(resolveIsLabUiConfigured({
      hostname: 'labs.auto.ml',
      origin: 'https://labs.auto.ml',
    })).toBe(true)
  })

  it('full lab page appends /lab under base', () => {
    expect(
      resolveFullLabPageUrl({
        envLabUrl: 'https://labs.auto.ml/app/lab',
        hostname: 'labs.auto.ml',
        origin: 'https://labs.auto.ml',
      }),
    ).toBe('https://labs.auto.ml/app/lab/lab')
  })

  it('prerender/SSR without a request host uses same-origin /app/lab', () => {
    expect(resolveLabUiBase({})).toBe('/app/lab')
    expect(resolveFullLabPageUrl({})).toBe('/app/lab/lab')
    expect(resolveIsLabUiConfigured({})).toBe(true)
  })

  it('local vite defaults to loopback lab and is configured on localhost', () => {
    expect(
      resolveLabUiBase({ hostname: '127.0.0.1', port: '5173', origin: 'http://127.0.0.1:5173' }),
    ).toBe('http://127.0.0.1:3000')
    expect(
      resolveIsLabUiConfigured({
        hostname: '127.0.0.1',
        port: '5173',
        origin: 'http://127.0.0.1:5173',
      }),
    ).toBe(true)
  })

  it('public host ignores loopback env and uses same-origin /app/lab (#90)', () => {
    const input = {
      envLabUrl: 'http://127.0.0.1:3000',
      hostname: 'labs.auto.ml',
      origin: 'https://labs.auto.ml',
    }
    expect(resolveLabUiBase(input)).toBe('https://labs.auto.ml/app/lab')
    expect(resolveIsLabUiConfigured(input)).toBe(true)
    expect(resolveFullLabPageUrl(input)).toBe(
      'https://labs.auto.ml/app/lab/lab',
    )
  })

})

describe('embedded wind tunnel entry', () => {
  it('uses the shared URL resolver and waits for its own hydrated frame', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(import.meta.dirname, '../pages/TuanliuLab.tsx'), 'utf8')
    expect(src).toMatch(/fullLabPageUrl/)
    expect(src).toContain("url.searchParams.set('embedded', '1')")
    expect(src).toContain('event.origin !== embeddedUrl.origin')
    expect(src).toContain('event.source !== frame.current?.contentWindow')
    expect(src).toContain('waveworld:workspace-ready')
    expect(src).not.toContain('iframeOn')
    // No recursive iframe of /windtunnel without legacy
    expect(src).not.toMatch(/iframe[^>]+src=["']\/windtunnel["']/)
  })
})
