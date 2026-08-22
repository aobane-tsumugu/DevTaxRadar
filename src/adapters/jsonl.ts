/// <reference types="node" />

import type { Hash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { opendir, realpath } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Transform } from 'node:stream'
import { extname, isAbsolute, join, relative, sep } from 'node:path'

import type { AdapterDiagnostics } from './types.ts'

export async function* discoverJsonlFiles(
  rootDirectory: string,
  diagnostics: AdapterDiagnostics,
): AsyncGenerator<string> {
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(rootDirectory)
  } catch {
    diagnostics.ioErrors += 1
    return
  }

  const visited = new Set<string>()
  yield* walkJsonlFiles(rootDirectory, canonicalRoot, visited, diagnostics)
}

async function* walkJsonlFiles(
  directoryPath: string,
  canonicalRoot: string,
  visited: Set<string>,
  diagnostics: AdapterDiagnostics,
): AsyncGenerator<string> {
  let canonicalDirectory: string
  try {
    canonicalDirectory = await realpath(directoryPath)
  } catch {
    diagnostics.ioErrors += 1
    return
  }

  if (!pathIsWithin(canonicalRoot, canonicalDirectory)) {
    // Windows junctions can report isDirectory() while resolving outside the
    // configured history root. Treat that as a source failure instead of
    // scanning an unintended directory or silently importing a partial tree.
    diagnostics.ioErrors += 1
    return
  }

  const visitKey =
    process.platform === 'win32' ? canonicalDirectory.toLowerCase() : canonicalDirectory
  if (visited.has(visitKey)) return
  visited.add(visitKey)

  let directory
  try {
    directory = await opendir(directoryPath)
  } catch {
    diagnostics.ioErrors += 1
    return
  }

  try {
    for await (const entry of directory) {
      const entryPath = join(directoryPath, entry.name)
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        yield* walkJsonlFiles(entryPath, canonicalRoot, visited, diagnostics)
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.jsonl') {
        diagnostics.filesDiscovered += 1
        yield entryPath
      }
    }
  } catch {
    diagnostics.ioErrors += 1
  }
}

function pathIsWithin(canonicalRoot: string, candidate: string): boolean {
  const child = relative(canonicalRoot, candidate)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
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

export type FileSnapshot = {
  byteSize: number
  fileMtime: string
}

export function readFileSnapshot(filePath: string): FileSnapshot | undefined {
  try {
    const stats = statSync(filePath)
    return { byteSize: stats.size, fileMtime: stats.mtime.toISOString() }
  } catch {
    return undefined
  }
}

export function sameFileSnapshot(
  before: FileSnapshot | undefined,
  after: FileSnapshot | undefined,
): boolean {
  return Boolean(
    before && after && before.byteSize === after.byteSize && before.fileMtime === after.fileMtime,
  )
}

/**
 * Finalizes the digest that `hash` accumulated while readJsonlObjects streamed
 * the selected file through it. Call only after that file's rows have all
 * been consumed and its before/after snapshots match -- the digest is
 * incomplete until every chunk has passed through the Transform.
 */
export function fileContentSummary(hash: Hash, snapshot: FileSnapshot): FileContentSummary {
  return {
    contentHash: hash.digest('hex'),
    byteSize: snapshot.byteSize,
    fileMtime: snapshot.fileMtime,
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
