import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildResumeCommand, readSessionPreview } from '../../src/server/sessionPreview.js'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'devtax-preview-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('readSessionPreview', () => {
  it('Claude履歴の最初のユーザー発言を返す', async () => {
    const path = join(directory, 'claude.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'summary', summary: 'ignored' }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: '配賦ロジックを直したい' }] },
        }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: '二番目は無視する' }] },
        }),
      ].join('\n'),
      'utf8',
    )

    expect(await readSessionPreview(path, 'claude')).toBe('配賦ロジックを直したい')
  })

  it('コマンド呼び出しの行を読み飛ばす', async () => {
    const path = join(directory, 'claude-command.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: '<command-name>/model</command-name>' }],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: '本当の依頼はこちら' }] },
        }),
      ].join('\n'),
      'utf8',
    )

    expect(await readSessionPreview(path, 'claude')).toBe('本当の依頼はこちら')
  })

  it('文字列のcontentも読める', async () => {
    const path = join(directory, 'claude-string.jsonl')
    writeFileSync(
      path,
      JSON.stringify({ type: 'user', message: { role: 'user', content: '文字列の依頼' } }),
      'utf8',
    )

    expect(await readSessionPreview(path, 'claude')).toBe('文字列の依頼')
  })

  it('長い発言は120文字で切る', async () => {
    const path = join(directory, 'claude-long.jsonl')
    const long = 'あ'.repeat(300)
    writeFileSync(
      path,
      JSON.stringify({ type: 'user', message: { role: 'user', content: long } }),
      'utf8',
    )

    const preview = await readSessionPreview(path, 'claude')
    expect(preview).toHaveLength(121)
    expect(preview?.endsWith('...')).toBe(false)
    expect(preview?.slice(-1)).toBe('…')
  })

  it('Codex履歴の最初のユーザー発言を返す', async () => {
    const path = join(directory, 'codex.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'session_meta', payload: { cwd: '/work' } }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Codexへの依頼' },
        }),
      ].join('\n'),
      'utf8',
    )

    expect(await readSessionPreview(path, 'codex')).toBe('Codexへの依頼')
  })

  it('ファイルがなければundefinedを返す', async () => {
    expect(await readSessionPreview(join(directory, 'missing.jsonl'), 'claude')).toBeUndefined()
  })

  it('ユーザー発言がなければundefinedを返す', async () => {
    const path = join(directory, 'empty.jsonl')
    writeFileSync(path, JSON.stringify({ type: 'summary' }), 'utf8')
    expect(await readSessionPreview(path, 'claude')).toBeUndefined()
  })
})

describe('buildResumeCommand', () => {
  it('作業フォルダへの移動とセットで組み立てる', () => {
    expect(buildResumeCommand('claude', 'abc-123', 'C:\\work\\app', true)).toEqual({
      command: 'cd "C:\\work\\app" && claude --resume abc-123',
      changeDirectory: 'cd "C:\\work\\app"',
      resume: 'claude --resume abc-123',
      workingDirectoryExists: true,
    })
  })

  it('Codexはcodex resumeを使う', () => {
    expect(buildResumeCommand('codex', 'xyz-789', '/home/user/app', true).resume).toBe(
      'codex resume xyz-789',
    )
  })

  it('作業フォルダが存在しなければcdを外す', () => {
    const result = buildResumeCommand('claude', 'abc-123', 'C:\\gone', false)
    expect(result.command).toBe('claude --resume abc-123')
    expect(result.changeDirectory).toBeUndefined()
    expect(result.workingDirectoryExists).toBe(false)
  })

  it('引用符を含むパスをエスケープする', () => {
    const result = buildResumeCommand('claude', 'abc', 'C:\\wo"rk', true)
    expect(result.changeDirectory).toBe('cd "C:\\wo\\"rk"')
  })
})
