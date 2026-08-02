import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AdapterDiagnostics } from '../../src/adapters/types.ts'
import { readJsonlObjects } from '../../src/adapters/jsonl.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function jsonlFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'devtax-hash-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'session.jsonl')
  writeFileSync(path, contents, 'utf8')
  return path
}

function emptyDiagnostics(): AdapterDiagnostics {
  return {
    filesDiscovered: 0,
    filesRead: 0,
    linesRead: 0,
    blankLines: 0,
    malformedJsonLines: 0,
    unsupportedLines: 0,
    invalidRecords: 0,
    duplicateRecords: 0,
    ioErrors: 0,
  }
}

describe('readJsonlObjects content hashing', () => {
  it('hashes every byte of the file while parsing it once', async () => {
    const contents = '{"a":1}\n{"b":2}\n'
    const path = jsonlFile(contents)
    const hash = createHash('sha256')
    const diagnostics = emptyDiagnostics()

    const rows = []
    for await (const row of readJsonlObjects(path, diagnostics, hash)) rows.push(row)

    expect(rows).toEqual([{ a: 1 }, { b: 2 }])
    expect(hash.digest('hex')).toBe(createHash('sha256').update(contents, 'utf8').digest('hex'))
  })

  it('produces a different hash when one byte changes', async () => {
    const first = createHash('sha256')
    const second = createHash('sha256')
    const diagnostics = emptyDiagnostics()

    for await (const _ of readJsonlObjects(jsonlFile('{"a":1}\n'), diagnostics, first));
    for await (const _ of readJsonlObjects(jsonlFile('{"a":2}\n'), diagnostics, second));

    expect(first.digest('hex')).not.toBe(second.digest('hex'))
  })

  it('still parses when no hash is supplied', async () => {
    const diagnostics = emptyDiagnostics()
    const rows = []
    for await (const row of readJsonlObjects(jsonlFile('{"a":1}\n'), diagnostics)) rows.push(row)
    expect(rows).toEqual([{ a: 1 }])
  })
})
