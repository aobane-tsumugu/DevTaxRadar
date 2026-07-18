export type UsageProvider = "claude" | "codex";
export type AdapterConfidence = "A" | "B" | "C";

export type NormalizedUsage = {
  provider: UsageProvider;
  month: string;
  sessionKey: string;
  projectKey: string;
  projectLabel?: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  activeSeconds?: number;
  captureMethod: string;
  adapter: string;
  schemaVersion: string;
  confidence: AdapterConfidence;
};

export type AdapterDiagnostics = {
  filesDiscovered: number;
  filesRead: number;
  linesRead: number;
  blankLines: number;
  malformedJsonLines: number;
  unsupportedLines: number;
  invalidRecords: number;
  duplicateRecords: number;
  ioErrors: number;
};

export type AdapterResult = {
  events: NormalizedUsage[];
  diagnostics: AdapterDiagnostics;
};

export type AdapterOptions = {
  /**
   * A locally generated secret. It makes identifiers stable inside one
   * installation without leaking reversible paths or provider session IDs.
   */
  identifierSalt: string;
  /**
   * Local UI only. Exposes the final cwd segment, never the absolute path.
   * Keep false for fixtures, exports, logs, and any cloud-facing process.
   */
  includeLocalProjectLabel?: boolean;
};

export function createDiagnostics(): AdapterDiagnostics {
  return {
    filesDiscovered: 0,
    filesRead: 0,
    linesRead: 0,
    blankLines: 0,
    malformedJsonLines: 0,
    unsupportedLines: 0,
    invalidRecords: 0,
    duplicateRecords: 0,
    ioErrors: 0,
  };
}
