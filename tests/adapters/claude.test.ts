import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readClaudeHistory } from "../../src/adapters/claude.ts";

const SALT = "synthetic-test-salt-at-least-16";

describe("Claude Code local history adapter", () => {
  it("deduplicates message usage and emits metadata-only events", async () => {
    const root = resolve("fixtures/claude");
    const result = await readClaudeHistory(root, { identifierSalt: SALT });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      provider: "claude",
      month: "2026-04",
      model: "claude-synthetic",
      inputTokens: 100,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      outputTokens: 25,
      reasoningTokens: 0,
      adapter: "claude-code-local-jsonl",
      schemaVersion: "claude-local-v1",
      confidence: "B",
    });
    expect(result.diagnostics.duplicateRecords).toBe(1);
    expect(result.diagnostics.malformedJsonLines).toBe(1);
    expect(result.diagnostics.unsupportedLines).toBe(1);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Product-A");
    expect(serialized).not.toContain("synthetic-claude-session-1");
    expect(serialized).not.toContain("SYNTHETIC_PRIVATE_PROMPT_MUST_NOT_ESCAPE");
  });
});
