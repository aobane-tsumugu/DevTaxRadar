import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'vitest'

const { verifyGeneratedBlueprint } = createRequire(import.meta.url)('../../scripts/design/verify-docs.cjs')
const expected = '<html lang="ja">合成の生成結果</html>\n'
function fixture(action: (root: string, outside: string) => void, body = '') {
  const temp = mkdtempSync(join(tmpdir(), 'devtax-doc-isolation-'))
  const root = join(temp, 'repo')
  const outside = join(temp, 'outside.txt')
  try {
    for (const part of ['src', 'scripts/design', 'docs/design']) mkdirSync(join(root, part), { recursive: true })
    writeFileSync(outside, 'untouched')
    writeFileSync(join(root, 'docs/design/workflow-blueprint.html'), expected)
    writeFileSync(join(root, 'scripts/design/build-workflow-blueprint.cjs'),
      "const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'../..');\n" +
      body + `\nfs.writeFileSync(path.join(root,'docs/design/workflow-blueprint.html'),${JSON.stringify(expected)});\n`)
    action(root, outside)
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

describe('isolated generation does not copy live links or private local files', () => {
  it('runs an ordinary generator and leaves the original tree untouched', () => fixture((root, outside) => {
    assert.equal(verifyGeneratedBlueprint(root).passes, 2)
    assert.equal(readFileSync(outside, 'utf8'), 'untouched')
    assert.equal(readFileSync(join(root, 'docs/design/workflow-blueprint.html'), 'utf8'), expected)
  }))

  it('rejects a file symlink before the copied generator can write through it', () => fixture((root, outside) => {
    symlinkSync(outside, join(root, 'src/link.txt'))
    assert.throws(() => verifyGeneratedBlueprint(root), /symbolic link/)
    assert.equal(readFileSync(outside, 'utf8'), 'untouched')
  }, "fs.writeFileSync(path.join(root,'src/link.txt'),'unexpected modification');"))

  it('rejects an input directory symlink', () => fixture((root, outside) => {
    const external = join(root, '..', 'external')
    mkdirSync(external)
    symlinkSync(external, join(root, 'src/linked-directory'), 'dir')
    assert.throws(() => verifyGeneratedBlueprint(root), /symbolic link/)
    assert.equal(readFileSync(outside, 'utf8'), 'untouched')
  }))

  it('rejects a symlink used as the checked-in generated artifact', () => fixture((root, outside) => {
    const output = join(root, 'docs/design/workflow-blueprint.html')
    rmSync(output)
    writeFileSync(outside, expected)
    symlinkSync(outside, output)
    assert.throws(() => verifyGeneratedBlueprint(root), /regular file/)
    assert.equal(readFileSync(outside, 'utf8'), expected)
  }))

  for (const name of ['.env', '.env.local', '.npmrc', '.netrc', 'identifier-salt', 'devtax-radar.db', 'devtax-radar.db-wal']) {
    it(`excludes ${name} from the generation copy`, () => fixture((root) => {
      writeFileSync(join(root, 'src', name), 'private synthetic value')
      assert.equal(verifyGeneratedBlueprint(root).passes, 2)
      assert.equal(readFileSync(join(root, 'src', name), 'utf8'), 'private synthetic value')
    }, `if(fs.existsSync(path.join(root,'src',${JSON.stringify(name)})))throw new Error('private input was copied');`))
  }

  it('rejects a symlink emitted in place of the generated file', () => fixture((root) => {
    const script = join(root, 'scripts/design/build-workflow-blueprint.cjs')
    writeFileSync(script,
      "const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'../..');\n" +
      `fs.writeFileSync(path.join(root,'target.html'),${JSON.stringify(expected)});` +
      "fs.symlinkSync(path.join(root,'target.html'),path.join(root,'docs/design/workflow-blueprint.html'));\n")
    assert.throws(() => verifyGeneratedBlueprint(root), /regular file/)
  }))
})
