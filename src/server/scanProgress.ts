export type ScanProgress = {
  running: boolean
  provider: 'claude' | 'codex' | null
  filesScanned: number
  sourceId?: string
  sourceName?: string
}

// Counts only. The file paths themselves stay inside the adapter: they are
// local references, and section 11 of the design keeps those out of every API
// response.
let state: ScanProgress = { running: false, provider: null, filesScanned: 0 }

export function beginScan(
  provider: 'claude' | 'codex',
  sourceId?: string,
  sourceName?: string,
): void {
  state = {
    running: true,
    provider,
    filesScanned: 0,
    ...(sourceId ? { sourceId } : {}),
    ...(sourceName ? { sourceName } : {}),
  }
}

export function reportScannedFile(): void {
  if (!state.running) return
  state = { ...state, filesScanned: state.filesScanned + 1 }
}

export function finishScan(): void {
  state = { running: false, provider: null, filesScanned: 0 }
}

export function readScanProgress(): ScanProgress {
  return state
}
