import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getAppDataDirectory } from "../../src/server/paths.ts";

const originalDataDirectory = process.env.DEVTAX_RADAR_DATA_DIR;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (originalDataDirectory === undefined) {
    delete process.env.DEVTAX_RADAR_DATA_DIR;
  } else {
    process.env.DEVTAX_RADAR_DATA_DIR = originalDataDirectory;
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("application data isolation", () => {
  it("honors an explicit test data directory without touching user AppData", () => {
    const root = mkdtempSync(join(tmpdir(), "devtax-paths-"));
    temporaryDirectories.push(root);
    process.env.DEVTAX_RADAR_DATA_DIR = join(root, "isolated-data");

    expect(getAppDataDirectory()).toBe(join(root, "isolated-data"));
  });
});
