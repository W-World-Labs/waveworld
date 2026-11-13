#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const FORMAL_RADAR_BINDING = Object.freeze({
  bootstrapUrl: 'https://radar.myfastools.com/platform/bootstrap.js?v=1.4.86&release=b0a81fc548ac',
  clientKind: 'paas-platform',
  workspaceId: 'ws_platform',
  projectId: 'waveworld',
  trackingCode: 'W-WAVEWORLD-76B94EFF',
})

function attributeValue(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match?.[2]?.replace(/&amp;/gi, '&')
}

export function validateFormalSpaHtml(html) {
  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? []
  const bootstrapTags = scriptTags.filter(
    (tag) => attributeValue(tag, 'src') === FORMAL_RADAR_BINDING.bootstrapUrl,
  )

  if (bootstrapTags.length !== 1) {
    throw new Error(
      `expected exactly one ${FORMAL_RADAR_BINDING.bootstrapUrl} script, found ${bootstrapTags.length}`,
    )
  }

  const tag = bootstrapTags[0]
  const expectedAttributes = {
    'data-client-kind': FORMAL_RADAR_BINDING.clientKind,
    'data-workspace-id': FORMAL_RADAR_BINDING.workspaceId,
    'data-project-id': FORMAL_RADAR_BINDING.projectId,
    'data-code': FORMAL_RADAR_BINDING.trackingCode,
    'data-track-behavior': 'true',
  }

  for (const [name, expected] of Object.entries(expectedAttributes)) {
    const actual = attributeValue(tag, name)
    if (actual !== expected) {
      throw new Error(`${name} must be ${expected}; received ${actual ?? 'missing'}`)
    }
  }

  if (!/\sasync(?:\s|=|>)/i.test(tag)) {
    throw new Error('Radar bootstrap script must load asynchronously')
  }
  return tag
}

export function validateFormalSpaFile(target) {
  if (!existsSync(target)) {
    throw new Error(`${target} does not exist (run npm run build first)`)
  }
  validateFormalSpaHtml(readFileSync(target, 'utf8'))
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const projectRoot = resolve(scriptDir, '../..')
  const target = resolve(projectRoot, process.argv[2] || 'dist/index.html')

  try {
    validateFormalSpaFile(target)
    console.log(
      `assert-formal-spa: OK — ${target} has the formal ${FORMAL_RADAR_BINDING.projectId} Radar binding`,
    )
  } catch (error) {
    console.error(`assert-formal-spa: FAIL — ${error.message}`)
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  await main()
}
