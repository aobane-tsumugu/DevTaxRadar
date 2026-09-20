import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

/** Hash a bundle file with bounded memory, including the final partial block. */
export function describeBundleFile(path: string): { bytes: number; sha256: string } {
  const descriptor = openSync(path, 'r')
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile()) throw new Error('バックアップには通常のファイルを指定してください。')
    const digest = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let bytes = 0
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null)
      if (count === 0) break
      digest.update(buffer.subarray(0, count))
      bytes += count
    }
    const after = fstatSync(descriptor)
    if (
      bytes !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new Error('検証中にバックアップ内容が変更されました。処理をやり直してください。')
    return { bytes, sha256: digest.digest('hex') }
  } finally {
    closeSync(descriptor)
  }
}
