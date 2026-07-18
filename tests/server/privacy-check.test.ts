import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const privacyScript = resolve("scripts/privacy-check.ts");
const tsxLoader = pathToFileURL(
  resolve("node_modules/tsx/dist/loader.mjs"),
).href;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createSurfaceFile(relativePath: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), "devtax-privacy-"));
  temporaryDirectories.push(root);
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return root;
}

function runPrivacyCheck(root: string, privateNames = "") {
  return spawnSync(
    process.execPath,
    ["--import", tsxLoader, privacyScript],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVTAX_PRIVATE_NAMES: privateNames,
      },
    },
  );
}

describe("release privacy check", () => {
  it("accepts a synthetic release surface", () => {
    const root = createSurfaceFile(
      "dist/demo.json",
      JSON.stringify({ provider: "claude", month: "2026-04", product: "Product A" }),
    );

    expect(() => execFileSync(
      process.execPath,
      ["--import", tsxLoader, privacyScript],
      { cwd: root, stdio: "pipe" },
    )).not.toThrow();
  });

  it.each([
    [
      "absolute home path",
      "dist/leak.json",
      JSON.stringify({ folder: "C:\\Users\\private-user\\secret" }),
      "",
    ],
    [
      "UUID",
      "public/leak.json",
      JSON.stringify({ session: "6a5b02c8-7df0-43e8-889c-581ea2ba14b7" }),
      "",
    ],
    [
      "raw content field",
      "fixtures/leak.json",
      JSON.stringify({ prompt: "private prompt" }),
      "",
    ],
    [
      "database artifact",
      "dist/devtax-radar.db",
      "sqlite bytes placeholder",
      "",
    ],
    [
      "configured private project name",
      "dist/index.js",
      "const project = 'secret-customer-project'",
      "secret-customer-project",
    ],
  ])("rejects %s on a release surface", (_name, path, content, privateNames) => {
    const root = createSurfaceFile(path, content);
    const result = runPrivacyCheck(root, privateNames);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBeTruthy();
  });
});
