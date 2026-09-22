import { useState } from 'react'
import {
  createDataTransferBackup,
  getRuntime,
  restoreDataTransferBackup,
  verifyDataTransferBackup,
} from '../api'
import type { HistorySource, RuntimeData } from '../types'
import { sourceNeedsAttention } from '../taskHub'

type Result = { kind: 'ok' | 'error'; message: string }

export default function DataTransferPage({
  local,
  runtime,
  historySources,
  onManageSources,
}: {
  local: boolean
  runtime: RuntimeData | null
  historySources: HistorySource[]
  onManageSources: () => void
}) {
  const [backupDestination, setBackupDestination] = useState('')
  const [verifyBundle, setVerifyBundle] = useState('')
  const [restoreBundle, setRestoreBundle] = useState('')
  const [restoreDestination, setRestoreDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const unavailable = historySources.filter(sourceNeedsAttention)

  async function token() {
    return (runtime ?? (await getRuntime())).csrfToken
  }
  async function run(action: () => Promise<Result>) {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      setResult(await action())
    } catch (error) {
      setResult({
        kind: 'error',
        message: error instanceof Error ? error.message : '処理できませんでした。',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="panel">
        <h2>複数PCの履歴を1つのDevTaxへ集める</h2>
        <p>
          DevTaxを動かすPCから、別PCのClaude Code /
          Codex履歴フォルダをSMB・Samba等で読めるようにして、
          読み取り元として追加します。各PCへDevTaxを入れる必要はありません。
        </p>
        <p>これは履歴の集約です。DevTaxのSQLiteを複数PCで同時編集・同期する機能ではありません。</p>
        {historySources.length > 0 && (
          <ul>
            {historySources.map((source) => (
              <li key={source.id}>
                {source.name} / {source.provider === 'claude' ? 'Claude Code' : 'Codex'} /{' '}
                {!source.enabled
                  ? '走査しない'
                  : source.availability === 'available'
                    ? '読取可能'
                    : sourceNeedsAttention(source)
                      ? '現在読めない'
                      : 'このPCでは未使用（フォルダなし）'}
              </li>
            ))}
          </ul>
        )}
        {unavailable.length > 0 && (
          <p role="status">
            有効な読み取り元のうち{unavailable.length}
            件が現在読めません。前回の正常な集計は保持します。
          </p>
        )}
        <button type="button" className="primary-button" onClick={onManageSources}>
          履歴のPC・共有元を確認
        </button>
      </section>

      <section className="panel">
        <h2>DevTaxの保存データを別PCへ引っ越す</h2>
        <p>
          保存済みSQLite・dataset識別子・saltを一貫したバックアップにします。元ログ、証拠原本、
          外部アプリ設定、ブラウザだけに残っている未保存入力は含みません。
        </p>
        <p>
          引っ越す前に編集中の内容をDevTaxへ保存してください。別PCで復元した後は、元の履歴フォルダを勝手に
          新PCへ付け替えず、再接続を確認するまで走査を停止します。
        </p>
        {!local ? (
          <p>公開デモではPCのファイルを操作しません。ローカル版で利用できます。</p>
        ) : (
          <>
            <fieldset disabled={busy}>
              <legend>1. このPCでバックアップを作る</legend>
              <label>
                新しいバックアップフォルダの絶対パス
                <input
                  type="text"
                  value={backupDestination}
                  placeholder="例: D:\DevTax-backup-2026-09-21"
                  onChange={(event) => setBackupDestination(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={!backupDestination.trim()}
                onClick={() =>
                  void run(async () => {
                    const response = await createDataTransferBackup(
                      await token(),
                      backupDestination.trim(),
                    )
                    return {
                      kind: 'ok',
                      message: `検証済みバックアップを作成しました: ${response.destination} / ${response.manifest.createdAt}`,
                    }
                  })
                }
              >
                バックアップを作成して検証
              </button>
            </fieldset>

            <fieldset disabled={busy}>
              <legend>2. 移したバックアップを新PCで検証</legend>
              <label>
                バックアップフォルダの絶対パス
                <input
                  type="text"
                  value={verifyBundle}
                  onChange={(event) => setVerifyBundle(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={!verifyBundle.trim()}
                onClick={() =>
                  void run(async () => {
                    const response = await verifyDataTransferBackup(
                      await token(),
                      verifyBundle.trim(),
                    )
                    // On the new PC the verified folder is the one to restore; do not ask for it twice.
                    if (!restoreBundle.trim()) setRestoreBundle(response.bundle)
                    return {
                      kind: 'ok',
                      message: `バックアップのDB・salt・hash・schemaを確認しました: ${response.manifest.createdAt}`,
                    }
                  })
                }
              >
                バックアップを検証
              </button>
            </fieldset>

            <fieldset disabled={busy}>
              <legend>3. 新PCに復元用フォルダを作る</legend>
              <label>
                検証済みバックアップ
                <input
                  type="text"
                  value={restoreBundle}
                  onChange={(event) => setRestoreBundle(event.target.value)}
                />
              </label>
              <label>
                新しい復元先データフォルダ
                <input
                  type="text"
                  value={restoreDestination}
                  placeholder="例: C:\DevTax-Restored"
                  onChange={(event) => setRestoreDestination(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={!restoreBundle.trim() || !restoreDestination.trim()}
                onClick={() =>
                  void run(async () => {
                    const response = await restoreDataTransferBackup(
                      await token(),
                      restoreBundle.trim(),
                      restoreDestination.trim(),
                    )
                    return {
                      kind: 'ok',
                      message:
                        response.message +
                        ` 復元先: ${response.destination}。次回起動時にこのフォルダをDEVTAX_RADAR_DATA_DIRへ指定してください。`,
                    }
                  })
                }
              >
                新しい復元先を作成
              </button>
            </fieldset>
          </>
        )}
        {result && <p role={result.kind === 'error' ? 'alert' : 'status'}>{result.message}</p>}
        <p>
          復元は現在のデータを上書きしません。新しいフォルダだけを作ります。復元先で起動すると
          「復元した資料と履歴の接続を確認」が表示され、確認後に走査を再開できます。
        </p>
      </section>
    </>
  )
}
