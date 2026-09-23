import type { SourceCaptureContext } from '../accounting/observationRecord.js'

/** Stable factual warnings only: scan time changes do not invent changes to cost arithmetic. */
export function captureWarnings(
  sources: readonly SourceCaptureContext[] | undefined,
  provider: 'claude' | 'codex',
  selectedSourceIds?: readonly string[],
): string[] {
  if (!sources)
    return ['この資料には取得元別の来歴がありません。現在の取得状態で過去の根拠を補完しません。']
  const relevant = sources.filter(
    (source) =>
      source.provider === provider &&
      (!selectedSourceIds || selectedSourceIds.includes(source.sourceId)),
  )
  const messages: string[] = []
  for (const id of selectedSourceIds ?? []) {
    if (!relevant.some((source) => source.sourceId === id))
      messages.push(`選択した取得元 ${id} が見つかりません。取得範囲は未確認です。`)
  }
  for (const source of relevant) {
    const label = `取得元 ${source.sourceId}`
    if (!source.enabled)
      messages.push(`${label} は現在停止中です。保存済みの数値は削除していません。`)
    const capture = source.capture
    if (!capture || !capture.matchesCurrentValues) {
      messages.push(
        `${label} の取得来歴を現在の数値に対応付けられません。取得方式・前回値使用の範囲は不明です。`,
      )
      continue
    }
    if (capture.status !== 'complete')
      messages.push(`${label} の更新は未完了です。保存済み数値を使っています。`)
    const previous = capture.files.filter((file) => file.state === 'deferred-previous').length
    const missing = capture.files.filter((file) => file.state === 'deferred-missing').length
    if (previous || missing)
      messages.push(
        `${label}：前回値使用 ${previous}ファイル、初回取得保留 ${missing}ファイル。件数から欠落金額を推定していません。`,
      )
    const methods = [
      ...new Set(capture.files.map((file) => `${file.adapter}/${file.schemaVersion}`)),
    ].sort()
    messages.push(
      `${label}：取得暦 ${capture.timeZone}、方式 ${methods.join('、') || '記録なし'}。走査完了はアカウント全利用の捕捉を保証しません。`,
    )
  }
  return [...new Set(messages)]
}
