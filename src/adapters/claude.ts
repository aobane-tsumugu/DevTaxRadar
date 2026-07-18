/// <reference types="node" />

import { localProjectLabel, privateKey } from "./identifiers.ts";
import {
  childRecord,
  discoverJsonlFiles,
  monthFromTimestamp,
  nonNegativeInteger,
  readJsonlObjects,
  stringValue,
} from "./jsonl.ts";
import {
  createDiagnostics,
  type AdapterOptions,
  type AdapterResult,
  type NormalizedUsage,
} from "./types.ts";

const ADAPTER = "claude-code-local-jsonl";
const SCHEMA_VERSION = "claude-local-v1";

export async function readClaudeHistory(
  rootDirectory: string,
  options: AdapterOptions,
): Promise<AdapterResult> {
  const diagnostics = createDiagnostics();
  const events: NormalizedUsage[] = [];
  const seenMessages = new Set<string>();

  for await (const filePath of discoverJsonlFiles(rootDirectory, diagnostics)) {
    for await (const row of readJsonlObjects(filePath, diagnostics)) {
      const event = normalizeClaudeRow(row, options, seenMessages, diagnostics);
      if (event) events.push(event);
    }
  }

  return { events, diagnostics };
}

function normalizeClaudeRow(
  row: Record<string, unknown>,
  options: AdapterOptions,
  seenMessages: Set<string>,
  diagnostics: AdapterResult["diagnostics"],
): NormalizedUsage | undefined {
  const message = childRecord(row, "message");
  const usage = message && childRecord(message, "usage");
  if (!message || !usage) {
    diagnostics.unsupportedLines += 1;
    return undefined;
  }

  const timestamp = row.timestamp;
  const month = monthFromTimestamp(timestamp);
  const cwd = stringValue(row.cwd);
  const sessionId = stringValue(row.sessionId) ?? stringValue(row.session_id);
  const messageId = stringValue(message.id);

  if (!month || !cwd || !sessionId || !messageId) {
    diagnostics.invalidRecords += 1;
    return undefined;
  }

  const messageKey = privateKey("message", messageId, options.identifierSalt);
  if (seenMessages.has(messageKey)) {
    diagnostics.duplicateRecords += 1;
    return undefined;
  }
  seenMessages.add(messageKey);

  return {
    provider: "claude",
    month,
    sessionKey: privateKey("session", sessionId, options.identifierSalt),
    projectKey: privateKey("project", cwd, options.identifierSalt),
    projectLabel: options.includeLocalProjectLabel
      ? localProjectLabel(cwd)
      : undefined,
    model: stringValue(message.model) ?? "unknown",
    inputTokens: nonNegativeInteger(usage.input_tokens),
    cacheReadTokens: nonNegativeInteger(usage.cache_read_input_tokens),
    cacheWriteTokens: nonNegativeInteger(usage.cache_creation_input_tokens),
    outputTokens: nonNegativeInteger(usage.output_tokens),
    reasoningTokens: 0,
    captureMethod: "local transcript compatibility adapter",
    adapter: ADAPTER,
    schemaVersion: SCHEMA_VERSION,
    confidence: "B",
  };
}
