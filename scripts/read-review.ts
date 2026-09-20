import { runReviewArchiveCli } from '../src/server/reviewArchiveCli.js'

try {
  process.stdout.write(runReviewArchiveCli(process.argv.slice(2)))
  console.error(
    '保存済み資料だけを読み取りました。元ログの再取得・再計算・復元・移行はしていません。' +
      '出力には理由や自由記述が含まれます。第三者へ渡す前に内容を確認してください。',
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
