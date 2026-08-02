/// <reference types="node" />

import type { Hash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { opendir } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Transform } from 'node:stream'
import { extname, join } from 'node:path'

import type { AdapterDiagnostics } from './types.ts'

export async function* discoverJsonlFiles(
  rootDirectory: string,
  diagnostics: AdapterDiagnostics,
): AsyncGenerator<string> {
  let directory
  try {
    directory = await opendir(rootDirectory)
  } catch {
    diagnostics.ioErrors += 1
    return
  }

  try {
    for await (const entry of directory) {
      const entryPath = join(rootDirectory, entry.name)
      if (entry.isDirectory()) {
        yield* discoverJsonlFiles(entryPath, diagnostics)
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.jsonl') {
        diagnostics.filesDiscovered += 1
        yield entryPath
      }
    }
  } catch {
    diagnostics.ioErrors += 1
  }
}

export async function* readJsonlObjects(
  filePath: string,
  diagnostics: AdapterDiagnostics,
  hash?: Hash,
): AsyncGenerator<Record<string, unknown>> {
  const source = createReadStream(filePath, { flags: 'r' })

  // A Transform in the pipe chain sees every byte without switching the source
  // into flowing mode, which a bare 'data' listener would do -- that would race
  // readline for the same chunks. This keeps the file read exactly once, and
  // readline decodes the Buffer chunks it receives as utf8 by default, so line
  // splitting is unaffected by dropping `encoding` from createReadStream.
  const tap = hash
    ? new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk)
          callback(null, chunk)
        },
      })
    : undefined

  source.on('error', () => {
    diagnostics.ioErrors += 1
    // .pipe() does not forward errors. Without this the Transform would stay
    // open with no more data and no 'end', and readline's `for await` would
    // wait forever -- hanging the whole scan on one unreadable file (an
    // antivirus lock, a cloud-sync placeholder, a transcript still being
    // written). end() flushes and closes the readable side, which readline
    // sees as EOF, so the loop finishes and the scan moves to the next file.
    // destroy() is not enough: it leaves the iterator waiting.
    tap?.end()
  })

  const input = tap ? source.pipe(tap) : source

  const lines = createInterface({
    input,
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  try {
    for await (const line of lines) {
      diagnostics.linesRead += 1
      if (line.trim().length === 0) {
        diagnostics.blankLines += 1
        continue
      }

      try {
        const parsed: unknown = JSON.parse(line)
        if (isRecord(parsed)) {
          yield parsed
        } else {
          diagnostics.invalidRecords += 1
        }
      } catch {
        diagnostics.malformedJsonLines += 1
      }
    }
    diagnostics.filesRead += 1
  } catch {
    // The stream error listener increments ioErrors without exposing file paths.
  } finally {
    lines.close()
    source.destroy()
  }
}

export type FileContentSummary = {
  contentHash: string
  byteSize: number
  fileMtime: string
}

/**
 * Finalizes the digest that `hash` accumulated while readJsonlObjects streamed
 * `filePath` through it, alongside one statSync for size and mtime. Call only
 * after that file's rows have all been consumed -- the digest is incomplete
 * until every chunk has passed through the Transform.
 */
export function fileContentSummary(filePath: string, hash: Hash): FileContentSummary {
  const stats = statSync(filePath)
  return {
    contentHash: hash.digest('hex'),
    byteSize: stats.size,
    fileMtime: stats.mtime.toISOString(),
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function childRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = parent[key]
  return isRecord(value) ? value : undefined
}

export function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
