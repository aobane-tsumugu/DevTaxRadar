import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'vitest'

const { verifyGeneratedBlueprint } = createRequire(import.meta.url)(
  '../../scripts/design/verify-docs.cjs',
)
const expected = '<html lang="ja">合成の生成結果</html>\n'
// Windows without Developer Mode or admin rights cannot create symlinks at all (EPERM).
// Only that case skips the link tests; any other probe failure is a real error.
const canSymlink = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'devtax-symlink-probe-'))
  try {
    writeFileSync(join(probe, 'target'), '')
    symlinkSync(join(probe, 'target'), join(probe, 'link'))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false
    throw error
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()
function fixture(action: (root: string, outside: string) => void, body = '') {
  const temp = mkdtempSync(join(tmpdir(), 'devtax-doc-isolation-'))
  const root = join(temp, 'repo'),
    outside = join(temp, 'outside.txt')
  try {
    for (const part of ['src', 'scripts/design', 'docs/design'])
      mkdirSync(join(root, part), { recursive: true })
    writeFileSync(outside, 'untouched')
    writeFileSync(join(root, 'docs/design/workflow-blueprint.html'), expected)
    writeFileSync(join(root, 'docs/design/current-design.json'), '{}')
    writeFileSync(join(root, 'docs/design/acceptance-scenarios.md'), 'synthetic')
    writeFileSync(join(root, 'docs/design/requirements-matrix.md'), 'synthetic')
    writeFileSync(
      join(root, 'scripts/design/render-current-design.cjs'),
      '// synthetic generator does not import a renderer',
    )
    writeFileSync(
      join(root, 'scripts/design/build-workflow-blueprint.cjs'),
      "const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'../..');\n" +
        body +
        `\nfs.writeFileSync(path.join(root,'docs/design/workflow-blueprint.html'),${JSON.stringify(expected)});\n`,
    )
    action(root, outside)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
describe('isolated generation uses only declared inputs, never live links', () => {
  it('runs an ordinary generator and leaves the original tree untouched', () =>
    fixture((root, outside) => {
      assert.equal(verifyGeneratedBlueprint(root).passes, 2)
      assert.equal(readFileSync(outside, 'utf8'), 'untouched')
      assert.equal(
        readFileSync(join(root, 'docs/design/workflow-blueprint.html'), 'utf8'),
        expected,
      )
    }))
  it.skipIf(!canSymlink)(
    'rejects a declared input symlink before the generator can follow it',
    () =>
      fixture((root, outside) => {
        const input = join(root, 'docs/design/current-design.json')
        rmSync(input)
        symlinkSync(outside, input)
        assert.throws(() => verifyGeneratedBlueprint(root), /symbolic link/)
        assert.equal(readFileSync(outside, 'utf8'), 'untouched')
      }),
  )
  it.skipIf(!canSymlink)('rejects a declared input parent symlink', () =>
    fixture((root, outside) => {
      const scripts = join(root, 'scripts')
      rmSync(scripts, { recursive: true })
      const external = join(root, '..', 'external')
      mkdirSync(external)
      symlinkSync(external, scripts, 'dir')
      assert.throws(() => verifyGeneratedBlueprint(root), /symbolic link/)
      assert.equal(readFileSync(outside, 'utf8'), 'untouched')
    }),
  )
  it.skipIf(!canSymlink)('does not traverse or copy an unrelated linked application source', () =>
    fixture((root, outside) => {
      symlinkSync(outside, join(root, 'src/link.txt'))
      assert.equal(verifyGeneratedBlueprint(root).passes, 2)
      assert.equal(readFileSync(outside, 'utf8'), 'untouched')
    }, "if(fs.existsSync(path.join(root,'src'))) throw new Error('application code copied');"),
  )
  it.skipIf(!canSymlink)('rejects a symlink used as the checked-in generated artifact', () =>
    fixture((root, outside) => {
      const output = join(root, 'docs/design/workflow-blueprint.html')
      rmSync(output)
      writeFileSync(outside, expected)
      symlinkSync(outside, output)
      assert.throws(() => verifyGeneratedBlueprint(root), /regular file/)
      assert.equal(readFileSync(outside, 'utf8'), expected)
    }),
  )
  for (const name of [
    '.env',
    '.env.local',
    '.npmrc',
    '.netrc',
    'identifier-salt',
    'devtax-radar.db',
    'devtax-radar.db-wal',
  ]) {
    it(`excludes ${name}, including files next to the generator`, () =>
      fixture(
        (root) => {
          writeFileSync(join(root, 'scripts/design', name), 'private synthetic value')
          assert.equal(verifyGeneratedBlueprint(root).passes, 2)
          assert.equal(
            readFileSync(join(root, 'scripts/design', name), 'utf8'),
            'private synthetic value',
          )
        },
        `if(fs.existsSync(path.join(root,'scripts/design',${JSON.stringify(name)})))throw new Error('private input copied');`,
      ))
  }
  it('rejects a missing declared input instead of substituting an empty placeholder', () =>
    fixture((root) => {
      rmSync(join(root, 'docs/design/current-design.json'))
      assert.throws(() => verifyGeneratedBlueprint(root), /ENOENT/)
    }))
  it.skipIf(!canSymlink)('rejects a symlink emitted in place of the generated file', () =>
    fixture((root) => {
      const script = join(root, 'scripts/design/build-workflow-blueprint.cjs')
      writeFileSync(
        script,
        "const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'../..');\n" +
          `fs.writeFileSync(path.join(root,'target.html'),${JSON.stringify(expected)});` +
          "fs.symlinkSync(path.join(root,'target.html'),path.join(root,'docs/design/workflow-blueprint.html'));\n",
      )
      assert.throws(() => verifyGeneratedBlueprint(root), /regular file/)
    }),
  )
})
