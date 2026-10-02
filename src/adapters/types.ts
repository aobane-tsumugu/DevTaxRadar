export type UsageProvider = 'claude' | 'codex'
export type AdapterConfidence = 'A' | 'B' | 'C'

export type LocalSessionReference = {
  nativeSessionId: string
  sourcePath: string
  workingDirectory: string
  /**
   * SHA-256 (hex) of the whole transcript file at import time. Lets a later
   * scan warn "the original history changed since we recorded it". This is
   * not tamper-proofing against the user themselves -- the same OS user
   * account can rewrite this hash just as easily as the transcript. It only
   * shows that records made on this machine stay internally consistent.
   */
  contentHash: string
  byteSize: number
  /** ISO timestamp, from a single statSync alongside byteSize. */
  fileMtime: string
}

export type NormalizedUsage = {
  provider: UsageProvider
  /** Opaque per-record identity used only to preserve Claude duplicate handling across cached files. */
  eventKey?: string
  month: string
  observedAt: string
  sessionKey: string
  projectKey: string
  projectLabel?: string
  localReference?: LocalSessionReference
  model: string
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  activeSeconds?: number
  captureMethod: string
  adapter: string
  schemaVersion: string
  confidence: AdapterConfidence
}

export type AdapterDiagnostics = {
  filesDiscovered: number
  filesRead: number
  /** Files whose prior sanitized contribution was used without opening them. */
  filesReused: number
  /** Changed files that were safely deferred to their prior contribution. */
  filesDeferred: number
  linesRead: number
  blankLines: number
  malformedJsonLines: number
  unsupportedLines: number
  invalidRecords: number
  duplicateRecords: number
  ioErrors: number
  unstableFiles: number
  incompatibleFiles: number
}

export type AdapterResult = {
  events: NormalizedUsage[]
  diagnostics: AdapterDiagnostics
}

/**
 * The ephemeral outcome for one transcript file. When local references were
 * requested, events can contain local-only source paths; cache callers must
 * strip them and keep their opaque file identity separately before persisting.
 */
export type AdapterFileReadResult = {
  events: NormalizedUsage[]
  diagnostics: AdapterDiagnostics
  state: 'accepted' | 'unstable' | 'incompatible' | 'io_error'
  /** Opaque identity, including recognized zero-usage Codex sessions. */
  sessionKeys?: string[]
  snapshot?: { byteSize: number; fileMtime: string }
}

export type AdapterOptions = {
  /**
   * A locally generated secret. It makes identifiers stable inside one
   * installation without leaking reversible paths or provider session IDs.
   */
  identifierSalt: string
  /**
   * Local UI only. Exposes the final cwd segment, never the absolute path.
   * Keep false for fixtures, exports, logs, and any cloud-facing process.
   */
  includeLocalProjectLabel?: boolean
  /**
   * Local UI only. Exposes the provider session ID, the transcript path and
   * the working directory so the app can offer resume. Never leaves this PC.
   */
  includeLocalReferences?: boolean
  /** Use the cwd's own Windows/POSIX syntax instead of the hub OS semantics. */
  portableProjectPaths?: boolean
  /**
   * Called once per discovered file, before that file is read, so a file that
   * turns out to be unreadable is still counted and the number only ever goes
   * up. Used only to report a count to the progress endpoint -- it takes no
   * arguments, so a file path cannot travel through it.
   */
  onFileScanned?: () => void
}

export function createDiagnostics(): AdapterDiagnostics {
  return {
    filesDiscovered: 0,
    filesRead: 0,
    filesReused: 0,
    filesDeferred: 0,
    linesRead: 0,
    blankLines: 0,
    malformedJsonLines: 0,
    unsupportedLines: 0,
    invalidRecords: 0,
    duplicateRecords: 0,
    ioErrors: 0,
    unstableFiles: 0,
    incompatibleFiles: 0,
  }
}
