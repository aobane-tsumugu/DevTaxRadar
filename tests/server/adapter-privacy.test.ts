import { describe, expect, it } from "vitest";

import { readClaudeHistory } from "../../src/adapters/claude.ts";
import { readCodexHistory } from "../../src/adapters/codex.ts";

const salt = "server-privacy-test-salt-1234";

describe("adapter local-label opt-in", () => {
  it.each([
    ["Claude Code", readClaudeHistory, "fixtures/claude", "Product-A"],
    ["Codex", readCodexHistory, "fixtures/codex", "Product-B"],
  ] as const)(
    "%s omits labels by default and reveals only a basename when opted in",
    async (_provider, adapter, fixture, expectedLabel) => {
      const privateResult = await adapter(fixture, { identifierSalt: salt });
      const localResult = await adapter(fixture, {
        identifierSalt: salt,
        includeLocalProjectLabel: true,
      });

      expect(privateResult.events[0]?.projectLabel).toBeUndefined();
      expect(localResult.events[0]?.projectLabel).toBe(expectedLabel);
      expect(localResult.events[0]?.projectLabel).not.toMatch(/[\\/]/);
      expect(JSON.stringify(localResult)).not.toContain("C:\\Synthetic");
      expect(JSON.stringify(localResult)).not.toContain("C:/Synthetic");
      expect(JSON.stringify(localResult)).not.toContain(
        "SYNTHETIC_PRIVATE_PROMPT_MUST_NOT_ESCAPE",
      );
    },
  );
});
