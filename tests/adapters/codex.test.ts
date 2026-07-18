import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readCodexHistory } from "../../src/adapters/codex.ts";

const SALT = "synthetic-test-salt-at-least-16";

describe("Codex local history adapter", () => {
  it("uses the final cumulative token snapshot and emits no transcript body", async () => {
    const root = resolve("fixtures/codex");
    const result = await readCodexHistory(root, { identifierSalt: SALT });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      provider: "codex",
      month: "2026-04",
      model: "gpt-synthetic",
      inputTokens: 150,
      cacheReadTokens: 70,
      cacheWriteTokens: 8,
      outputTokens: 40,
      reasoningTokens: 12,
      adapter: "codex-local-jsonl",
      schemaVersion: "codex-local-v1",
      confidence: "B",
    });
    expect(result.diagnostics.malformedJsonLines).toBe(1);
    expect(result.diagnostics.unsupportedLines).toBe(1);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Product-B");
    expect(serialized).not.toContain("synthetic-codex-session-1");
    expect(serialized).not.toContain("SYNTHETIC_PRIVATE_PROMPT_MUST_NOT_ESCAPE");
  });

  it("produces stable local keys without exposing their input", async () => {
    const first = await readCodexHistory(resolve("fixtures/codex"), {
      identifierSalt: SALT,
    });
    const second = await readCodexHistory(resolve("fixtures/codex"), {
      identifierSalt: SALT,
    });
    const differentInstall = await readCodexHistory(resolve("fixtures/codex"), {
      identifierSalt: "different-install-salt-1234",
    });

    expect(first.events[0]?.sessionKey).toBe(second.events[0]?.sessionKey);
    expect(first.events[0]?.projectKey).toBe(second.events[0]?.projectKey);
    expect(first.events[0]?.sessionKey).not.toBe(
      differentInstall.events[0]?.sessionKey,
    );
  });
});
