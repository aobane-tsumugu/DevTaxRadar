import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSession } from "../../src/server/sessionAggregation.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite persistence", () => {
  it("stores normalized metadata in an isolated application directory", () => {
    const dataDirectory = mkdtempSync(joinTempPrefix("devtax-db-"));
    temporaryDirectories.push(dataDirectory);

    const stdout = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("tests/server/helpers/database-probe.ts"),
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...process.env,
          DEVTAX_RADAR_DATA_DIR: dataDirectory,
        },
      },
    );
    const result = JSON.parse(stdout) as {
      databaseExists: boolean;
      overview: {
        providers: Array<Record<string, string | number>>;
        recentScans: Array<Record<string, string | number>>;
      };
    };

    expect(result.databaseExists).toBe(true);
    expect(result.overview.providers).toEqual([
      expect.objectContaining({
        provider: "claude",
        month: "2026-04",
        sessions: 1,
        projects: 1,
        inputTokens: 100,
        outputTokens: 20,
      }),
    ]);
    expect(result.overview.recentScans[0]).toEqual(
      expect.objectContaining({
        provider: "claude",
        filesSeen: 1,
        eventsWritten: 1,
        malformedLines: 0,
        status: "complete",
      }),
    );
  });
});

function joinTempPrefix(name: string): string {
  return `${tmpdir()}${process.platform === "win32" ? "\\" : "/"}${name}`;
}

const diagnostics = { filesSeen: 1, malformedLines: 0 };

function session(overrides: Partial<UsageSession> = {}): UsageSession {
  return {
    provider: "claude",
    sessionKey: "session_a",
    projectKey: "project_a",
    month: "2026-07",
    startedAt: "2026-07-15T10:00:00.000Z",
    endedAt: "2026-07-15T11:00:00.000Z",
    messageCount: 2,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    schemaVersion: "test-v1",
    confidence: "medium",
    ...overrides,
  };
}

describe("session storage", () => {
  let sessionDirectory: string;
  let db: typeof import("../../src/server/database.ts");

  beforeEach(async () => {
    sessionDirectory = mkdtempSync(joinTempPrefix("devtax-db-session-"));
    process.env.DEVTAX_RADAR_DATA_DIR = sessionDirectory;
    vi.resetModules();
    db = await import("../../src/server/database.ts");
  });

  afterEach(() => {
    db.getDatabase().close();
    delete process.env.DEVTAX_RADAR_DATA_DIR;
    rmSync(sessionDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  });

  it("同じセッションを二重に保存しない", () => {
    db.replaceProviderSessions("claude", [session(), session()], diagnostics);
    expect(db.getUsageSessions()).toHaveLength(1);
  });

  it("再スキャンで置き換えてもトークンが失われない", () => {
    db.replaceProviderSessions("claude", [session({ inputTokens: 100 })], diagnostics);
    db.replaceProviderSessions("claude", [session({ inputTokens: 250 })], diagnostics);
    const rows = db.getUsageSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.inputTokens).toBe(250);
  });

  it("生参照はopt-inしたときだけ保存する", () => {
    db.replaceProviderSessions("claude", [session()], diagnostics);
    expect(db.getSessionReference("claude", "session_a")).toBeUndefined();

    db.replaceProviderSessions("claude", [session({
      localReference: {
        nativeSessionId: "native-1",
        sourcePath: "/tmp/a.jsonl",
        workingDirectory: "/tmp/work",
      },
    })], diagnostics);
    expect(db.getSessionReference("claude", "session_a")).toMatchObject({
      nativeSessionId: "native-1",
      workingDirectory: "/tmp/work",
    });
  });

  it("セッション行に開始日時と終了日時を保持する", () => {
    db.replaceProviderSessions("claude", [session()], diagnostics);
    const row = db.getUsageSessions()[0];
    expect(row?.startedAt).toBe("2026-07-15T10:00:00.000Z");
    expect(row?.endedAt).toBe("2026-07-15T11:00:00.000Z");
  });
});
