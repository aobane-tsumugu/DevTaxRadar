import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { discoverJsonlFiles } from '../../src/adapters/jsonl.ts'
import { createDiagnostics } from '../../src/adapters/types.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `devtax-jsonl-${label}-`))
  temporaryDirectories.push(directory)
  return directory
}

function directoryLink(target: string, linkPath: string): void {
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

async function discoveredFiles(root: string): Promise<{ files: string[]; ioErrors: number }> {
  const diagnostics = createDiagnostics()
  const files: string[] = []
  for await (const file of discoverJsonlFiles(root, diagnostics)) files.push(file)
  return { files, ioErrors: diagnostics.ioErrors }
}

describe('JSONL discovery root boundary', () => {
  it('does not follow a directory link outside the configured root', async () => {
    const root = temporaryDirectory('root')
    const outside = temporaryDirectory('outside')
    writeFileSync(join(outside, 'outside.jsonl'), '{}\n', 'utf8')
    directoryLink(outside, join(root, 'escape'))

    const result = await discoveredFiles(root)

    expect(result.files).toEqual([])
    expect(result.ioErrors).toBe(1)
  })

  it('visits an in-root directory once when a link points back to an ancestor', async () => {
    const root = temporaryDirectory('cycle')
    const nested = join(root, 'nested')
    mkdirSync(nested)
    writeFileSync(join(nested, 'history.jsonl'), '{}\n', 'utf8')
    directoryLink(root, join(nested, 'back-to-root'))

    const result = await discoveredFiles(root)

    expect(result.files).toEqual([join(nested, 'history.jsonl')])
    expect(result.ioErrors).toBe(0)
  })
})
