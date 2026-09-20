import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { describeBundleFile } from '../../src/server/bundleFile.js'

describe('bounded-memory bundle file verification', () => {
  for (const size of [0, 1, 65535, 65536, 65537, 3 * 65536 + 19]) {
    it(`hashes all ${size} bytes without including unused buffer contents`, () => {
      const root = mkdtempSync(join(tmpdir(), 'devtax-bundle-file-'))
      try {
        const bytes = Buffer.from(Array.from({ length: size }, (_, index) => index % 251))
        const file = join(root, 'snapshot.db')
        writeFileSync(file, bytes)
        assert.deepEqual(describeBundleFile(file), {
          bytes: size,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }

  it('detects equal-length corruption instead of relying on file size', () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-bundle-file-'))
    try {
      const file = join(root, 'snapshot.db')
      writeFileSync(file, 'original')
      const before = describeBundleFile(file)
      writeFileSync(file, 'modified')
      const after = describeBundleFile(file)
      assert.equal(before.bytes, after.bytes)
      assert.notEqual(before.sha256, after.sha256)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a missing file and a directory rather than describing them as empty files', () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-bundle-file-'))
    try {
      assert.throws(() => describeBundleFile(join(root, 'missing')))
      const folder = join(root, 'folder')
      mkdirSync(folder)
      assert.throws(() => describeBundleFile(folder))
      // On Windows, successful cleanup also detects a leaked directory handle.
      rmSync(folder, { recursive: true })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
