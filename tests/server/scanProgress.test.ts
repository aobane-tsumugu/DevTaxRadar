import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginScan,
  finishScan,
  readScanProgress,
  reportScannedFile,
} from '../../src/server/scanProgress.ts'

describe('scan progress', () => {
  beforeEach(() => {
    finishScan()
  })

  it('reports an idle state before any scan', () => {
    expect(readScanProgress()).toEqual({ running: false, provider: null, filesScanned: 0 })
  })

  it('counts files while a scan runs', () => {
    beginScan('claude')
    reportScannedFile()
    reportScannedFile()
    expect(readScanProgress()).toEqual({ running: true, provider: 'claude', filesScanned: 2 })
  })

  it('resets the counter when the next provider starts', () => {
    beginScan('claude')
    reportScannedFile()
    beginScan('codex')
    expect(readScanProgress()).toEqual({ running: true, provider: 'codex', filesScanned: 0 })
  })

  it('keeps the final count visible after the scan finishes', () => {
    beginScan('codex')
    reportScannedFile()
    finishScan()
    expect(readScanProgress()).toEqual({ running: false, provider: null, filesScanned: 0 })
  })

  it('ignores reports that arrive while no scan is running', () => {
    reportScannedFile()
    expect(readScanProgress().filesScanned).toBe(0)
  })
})
