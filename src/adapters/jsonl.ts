/// <reference types="node" />

import { createReadStream } from "node:fs";
import { opendir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { extname, join } from "node:path";

import type { AdapterDiagnostics } from "./types.ts";

export async function* discoverJsonlFiles(
  rootDirectory: string,
  diagnostics: AdapterDiagnostics,
): AsyncGenerator<string> {
  let directory;
  try {
    directory = await opendir(rootDirectory);
  } catch {
    diagnostics.ioErrors += 1;
    return;
  }

  try {
    for await (const entry of directory) {
      const entryPath = join(rootDirectory, entry.name);
      if (entry.isDirectory()) {
        yield* discoverJsonlFiles(entryPath, diagnostics);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".jsonl") {
        diagnostics.filesDiscovered += 1;
        yield entryPath;
      }
    }
  } catch {
    diagnostics.ioErrors += 1;
  }
}

export async function* readJsonlObjects(
  filePath: string,
  diagnostics: AdapterDiagnostics,
): AsyncGenerator<Record<string, unknown>> {
  const stream = createReadStream(filePath, {
    encoding: "utf8",
    flags: "r",
  });
  stream.on("error", () => {
    diagnostics.ioErrors += 1;
  });

  const lines = createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  try {
    for await (const line of lines) {
      diagnostics.linesRead += 1;
      if (line.trim().length === 0) {
        diagnostics.blankLines += 1;
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(line);
        if (isRecord(parsed)) {
          yield parsed;
        } else {
          diagnostics.invalidRecords += 1;
        }
      } catch {
        diagnostics.malformedJsonLines += 1;
      }
    }
    diagnostics.filesRead += 1;
  } catch {
    // The stream error listener increments ioErrors without exposing file paths.
  } finally {
    lines.close();
    stream.destroy();
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function childRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = parent[key];
  return isRecord(value) ? value : undefined;
}

export function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? Math.floor(value)
    : 0;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function monthFromTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-\d{2}T/.exec(value);
  if (!match) return undefined;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : undefined;
}
