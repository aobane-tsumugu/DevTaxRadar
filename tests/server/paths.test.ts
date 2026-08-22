import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  getAppDataDirectory,
  historyRootKey,
  normalizeHistoryRoot,
} from '../../src/server/paths.ts'

const originalDataDirectory = process.env.DEVTAX_RADAR_DATA_DIR
const temporaryDirectories: string[] = []

afterEach(() => {
  if (originalDataDirectory === undefined) {
    delete process.env.DEVTAX_RADAR_DATA_DIR
  } else {
    process.env.DEVTAX_RADAR_DATA_DIR = originalDataDirectory
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('application data isolation', () => {
  it('honors an explicit test data directory without touching user AppData', () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-paths-'))
    temporaryDirectories.push(root)
    process.env.DEVTAX_RADAR_DATA_DIR = join(root, 'isolated-data')

    expect(getAppDataDirectory()).toBe(join(root, 'isolated-data'))
  })
})

describe('history source path validation', () => {
  it('accepts and normalizes an absolute folder, but rejects a relative folder', () => {
    const root = join(tmpdir(), 'devtax-source', 'nested', '..', 'history')
    expect(normalizeHistoryRoot(root)).toBe(join(tmpdir(), 'devtax-source', 'history'))
    expect(() => normalizeHistoryRoot(join('relative', 'history'))).toThrow('絶対パス')
  })

  it.runIf(process.platform === 'win32')('folds Windows path case for duplicate detection', () => {
    expect(historyRootKey('C:\\Shared\\Claude')).toBe(historyRootKey('c:\\shared\\claude'))
    expect(normalizeHistoryRoot('\\\\server\\share\\claude')).toBe('\\\\server\\share\\claude')
  })
})
