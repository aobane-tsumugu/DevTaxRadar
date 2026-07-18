import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const children: ChildProcess[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolveExit) => {
        const timeout = setTimeout(resolveExit, 2_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolveExit();
        });
      });
    }
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local test port"));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForRuntime(port: number): Promise<Response> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runtime`);
      if (response.ok) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Local server did not start: ${String(lastError)}`);
}

describe("local server boundary", () => {
  it("starts on loopback and protects the scan mutation", async () => {
    const port = await reservePort();
    const isolatedHome = mkdtempSync(join(tmpdir(), "devtax-server-home-"));
    const isolatedData = mkdtempSync(join(tmpdir(), "devtax-server-data-"));
    temporaryDirectories.push(isolatedHome, isolatedData);
    const claudeHistory = join(isolatedHome, ".claude", "projects");
    mkdirSync(claudeHistory, { recursive: true });
    copyFileSync(
      resolve("fixtures/claude/synthetic-history.jsonl"),
      join(claudeHistory, "synthetic-history.jsonl"),
    );

    const child = spawn(
      process.execPath,
      ["--import", "tsx", resolve("src/server/index.ts")],
      {
        cwd: resolve("."),
        stdio: "ignore",
        env: {
          ...process.env,
          PORT: String(port),
          HOME: isolatedHome,
          USERPROFILE: isolatedHome,
          DEVTAX_RADAR_DATA_DIR: isolatedData,
        },
      },
    );
    children.push(child);

    const runtimeResponse = await waitForRuntime(port);
    const runtime = await runtimeResponse.json() as {
      csrfToken: string;
      privacy: {
        localOnly: boolean;
        promptBodiesExtracted: boolean;
        telemetry: boolean;
      };
    };
    expect(runtime.privacy).toEqual({
      localOnly: true,
      promptBodiesExtracted: false,
      telemetry: false,
    });

    const nonLoopbackAddress = Object.values(networkInterfaces())
      .flat()
      .find((address) =>
        address?.family === "IPv4" &&
        !address.internal &&
        address.address !== "0.0.0.0"
      )?.address;
    if (nonLoopbackAddress) {
      await expect(
        fetch(`http://${nonLoopbackAddress}:${port}/api/health`, {
          signal: AbortSignal.timeout(750),
        }),
      ).rejects.toThrow();
    }

    const missingToken = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ providers: [] }),
    });
    expect(missingToken.status).toBe(403);

    const foreignOrigin = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "x-devtax-csrf": runtime.csrfToken,
      },
      body: JSON.stringify({ providers: [] }),
    });
    expect(foreignOrigin.status).toBe(403);

    const invalidButAuthorized = await fetch(
      `http://127.0.0.1:${port}/api/scan`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: `http://127.0.0.1:${port}`,
          "x-devtax-csrf": runtime.csrfToken,
        },
        body: JSON.stringify({ providers: [] }),
      },
    );
    expect(invalidButAuthorized.status).toBe(400);

    const scanResponse = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${port}`,
        "x-devtax-csrf": runtime.csrfToken,
      },
      body: JSON.stringify({ providers: ["claude"] }),
    });
    expect(scanResponse.status).toBe(200);

    const unconfiguredDashboard = await fetch(
      `http://127.0.0.1:${port}/api/dashboard`,
    ).then(async (response) => await response.json()) as {
      products: Array<{ projectKey: string }>;
    };
    const projectKey = unconfiguredDashboard.products[0]?.projectKey;
    expect(projectKey).toMatch(/^project_[0-9a-f]{24}$/);

    const configuration = {
      charges: { claude: 30_001, codex: 20_003 },
      monthlyCharges: [{
        provider: "claude",
        month: "2026-04",
        amountJpy: 31_337,
      }],
      unobservedRatio: 0.1,
      mappings: [{
        projectKey,
        productName: "Product A",
        assetName: "A-v1",
        classification: "new-development",
      }],
    };
    const saveResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${port}`,
        "x-devtax-csrf": runtime.csrfToken,
      },
      body: JSON.stringify(configuration),
    });
    expect(saveResponse.status).toBe(200);
    expect(await saveResponse.json()).toEqual({ saved: true });

    const storedConfiguration = await fetch(
      `http://127.0.0.1:${port}/api/config`,
    ).then(async (response) => await response.json());
    expect(storedConfiguration).toEqual(configuration);

    const dashboard = await fetch(
      `http://127.0.0.1:${port}/api/dashboard`,
    ).then(async (response) => await response.json()) as {
      meta: {
        source: string;
        sessionCount: number;
        allocatedRate: number;
      };
      months: Array<{
        label: string;
        current: number;
        future: number;
        review: number;
      }>;
      allocations: Array<{
        provider: string;
        amount: number;
        session: { folder: string };
      }>;
      assets: Array<{ product: string; name: string; total: number }>;
      boundaries: unknown[];
      guidance: unknown[];
      products: Array<{
        name: string;
        folder: string;
        sessions: number;
        projectKey: string;
      }>;
    };

    expect(dashboard.meta).toMatchObject({
      source: "local",
      sessionCount: 1,
      allocatedRate: 100,
    });
    expect(dashboard.months).toHaveLength(1);
    expect(dashboard.allocations.length).toBeGreaterThanOrEqual(2);
    expect(dashboard.assets).toEqual([
      expect.objectContaining({ product: "Product A", name: "A-v1" }),
    ]);
    expect(Array.isArray(dashboard.boundaries)).toBe(true);
    expect(Array.isArray(dashboard.guidance)).toBe(true);
    expect(dashboard.products[0]).toEqual(
      expect.objectContaining({
        name: "Product A",
        folder: "Product-A",
        sessions: 1,
        projectKey,
      }),
    );

    const claudeTotal = dashboard.allocations
      .filter((allocation) => allocation.provider === "Claude Code")
      .reduce((sum, allocation) => sum + allocation.amount, 0);
    expect(claudeTotal).toBe(configuration.monthlyCharges[0].amountJpy);
    expect(
      dashboard.months[0]!.current +
      dashboard.months[0]!.future +
      dashboard.months[0]!.review,
    ).toBe(configuration.monthlyCharges[0].amountJpy);

    const serializedDashboard = JSON.stringify(dashboard);
    expect(serializedDashboard).not.toContain("C:\\Synthetic");
    expect(serializedDashboard).not.toContain("C:/Synthetic");
    expect(serializedDashboard).not.toContain(
      "SYNTHETIC_PRIVATE_PROMPT_MUST_NOT_ESCAPE",
    );
    expect(serializedDashboard).not.toContain("synthetic-claude-session-1");

    const duplicateChargeResponse = await fetch(
      `http://127.0.0.1:${port}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: `http://127.0.0.1:${port}`,
          "x-devtax-csrf": runtime.csrfToken,
        },
        body: JSON.stringify({
          ...configuration,
          monthlyCharges: [
            configuration.monthlyCharges[0],
            configuration.monthlyCharges[0],
          ],
        }),
      },
    );
    expect(duplicateChargeResponse.status).toBe(400);

    if (existsSync(resolve("dist/index.html"))) {
      const staticResponse = await fetch(`http://127.0.0.1:${port}/`);
      expect(staticResponse.status).toBe(200);
      expect(await staticResponse.text()).toContain('<div id="root"></div>');
    }

    const clearedConfiguration = {
      ...configuration,
      monthlyCharges: [],
      mappings: [],
    };
    const clearResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${port}`,
        "x-devtax-csrf": runtime.csrfToken,
      },
      body: JSON.stringify(clearedConfiguration),
    });
    expect(clearResponse.status).toBe(200);
    const configurationAfterClear = await fetch(
      `http://127.0.0.1:${port}/api/config`,
    ).then(async (response) => await response.json());
    expect(configurationAfterClear).toEqual(clearedConfiguration);
  });
});
