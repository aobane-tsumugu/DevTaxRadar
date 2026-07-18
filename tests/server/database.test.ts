import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
